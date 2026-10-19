"""Team seats first (spec 2026-10-19-team-seats-first-design): ranking and suggestions."""
import uuid

import pytest

from app.core.auth_models import User
from app.core.orm import orm_session
from app.desk import rules, service
from desk_helpers import DAY, _login, _user, add_floor, book, build_world, hdr, set_now, sg

FILL_DESIGN = (("erin", "E1"), ("frank", "D2"), ("gus", "D3"), ("hana", "D4"))


@pytest.fixture()
def world(client, db, monkeypatch):
    """build_world plus four Design-only people and Level 2: Design seats D2, D3 (zone North), D4 and free-for-all F3."""
    world = build_world(client, monkeypatch)
    design = world["design"]
    for username, full_name in (("erin", "Erin Goh"), ("frank", "Frank Ho"), ("gus", "Gus Lee"), ("hana", "Hana Ali")):
        world["users"][username] = _user(username, full_name, depts=[design])
        world["tok"][username] = _login(client, username)
    add_floor(client, world, "Level 2", seats=[
        {"label": "D2", "x": 2, "y": 2, "department_id": design}, {"label": "D3", "x": 4, "y": 2, "department_id": design},
        {"label": "D4", "x": 8, "y": 8, "department_id": design}, {"label": "F3", "x": 6, "y": 6, "open_to_all": True}],
        zones=[{"label": "North", "x": 0, "y": 0, "w": 6, "h": 4}])
    return world


def _set_usual(client, world, who, seat):
    r = client.patch(f"/api/admin/users/{world['users'][who]}", headers=hdr(world["tok"]["root"]),
                     json={"usual_seat_id": world["seats"][seat] if seat else None})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def check_in(client, world, who, seat):
    return client.post(f"/api/desk/seats/{world['seats'][seat]}/check-in", headers=hdr(world["tok"][who]))


def _floor(client, world, who, day=DAY, preset=None):
    query = f"date={day.isoformat()}" + (f"&preset={preset}" if preset else "")
    return client.get(f"/api/desk/floors/{world['plan']}?{query}", headers=hdr(world["tok"][who])).get_json()


def _suggest(app, world, who, preset="am", day=DAY, purpose="book"):
    with app.app_context():
        user = orm_session().get(User, world["users"][who])
        return service.suggest_seats(user, day, preset, rules.now(), purpose)


def test_suggest_order_usual_zone_floor_then_other_floors(app, client, world):
    _set_usual(client, world, "dina", "D3")
    got = _suggest(app, world, "dina")
    assert got["tier"] == "team"
    assert [s["seat_label"] for s in got["seats"]] == ["D3", "D2", "D4", "E1"]
    assert got["seats"][0] == {"seat_id": world["seats"]["D3"], "seat_label": "D3", "plan_id": world["plans"]["Level 2"],
                               "plan_name": "Level 2", "zone": "North"}


def test_suggest_without_usual_seat_is_floor_then_label(app, world):
    assert [s["seat_label"] for s in _suggest(app, world, "dina")["seats"]] == ["E1", "D2", "D3", "D4"]


def test_suggest_open_tier_without_team_seats(app, client, world):
    _set_usual(client, world, "bob", "F3")
    got = _suggest(app, world, "bob")                      # Ops has no seats: free for all, usual seat's floor first
    assert got["tier"] == "open" and [s["seat_label"] for s in got["seats"]] == ["F3", "F1", "F2"]


def test_published_seats_is_one_query_and_none_without_a_match(app, world):
    from sqlalchemy import event
    seen = []
    listener = lambda *a, **k: seen.append(1)   # noqa: E731
    with app.app_context():
        engine = orm_session().get_bind()
        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert service.published_seats(also=frozenset({None})) == [] and not seen
            got = service.published_seats({uuid.UUID(world["design"])}, open_to_all=True)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
    assert len(seen) == 1
    assert [(s["seat_label"], s["plan_name"], s["zone"], s["floor_rank"]) for s in got] == [
        ("E1", "Level 1", None, 0), ("F1", "Level 1", None, 0), ("F2", "Level 1", None, 0),
        ("D2", "Level 2", "North", 1), ("D3", "Level 2", "North", 1), ("D4", "Level 2", None, 1), ("F3", "Level 2", None, 1)]


def test_suggest_none_when_nothing_free(app, client, world):
    for who, seat in (("jane", "F1"), ("carl", "F2"), ("ali", "F3")):
        assert book(client, world, who, seat, "full").status_code == 201
    assert _suggest(app, world, "bob", "full") == {"tier": "none", "seats": []}


def test_team_member_books_own_team_seat_and_others_cannot(client, world):
    assert book(client, world, "dina", "E1").status_code == 201
    r = book(client, world, "jane", "D2")
    assert r.status_code == 403 and r.get_json()["error"] == "This seat is for another project team."
    r = book(client, world, "jane", "U1")
    assert r.status_code == 400 and r.get_json()["error"] == "This seat cannot be booked: it has no project team."


def test_free_for_all_refused_while_team_seat_on_another_floor_is_free(client, world):
    assert book(client, world, "erin", "E1", "full").status_code == 201
    r = book(client, world, "dina", "F1", "am")
    assert r.status_code == 409
    assert r.get_json() == {"error": "Your project team has a free seat: D2 on Level 2. Book that one instead.",
                            "suggestion": {"seat_id": world["seats"]["D2"], "seat_label": "D2",
                                           "plan_id": world["plans"]["Level 2"], "plan_name": "Level 2", "zone": "North"}}


def test_free_for_all_allowed_once_every_team_seat_is_taken(app, client, world):
    for who, seat in FILL_DESIGN:
        assert book(client, world, who, seat, "full").status_code == 201
    assert _suggest(app, world, "dina", "am")["tier"] == "open"
    assert book(client, world, "dina", "F1", "am").status_code == 201


def test_team_first_is_slot_aware(client, world):
    for who, seat in FILL_DESIGN:
        assert book(client, world, who, seat, "am").status_code == 201
    assert book(client, world, "dina", "F1", "am").status_code == 201
    assert book(client, world, "dina", "F2", "pm").status_code == 409


def test_rule_uses_the_colleagues_teams_and_binds_admins(client, world):
    r = book(client, world, "ali", "F1", for_user="dina")
    assert r.status_code == 409 and r.get_json()["error"].startswith("Dina Koh's project team has a free seat: E1 on Level 1.")
    assert book(client, world, "dina", "F1", for_user="carl").status_code == 201   # dina's own free team seats don't matter
    assert book(client, world, "root", "F2", for_user="dina").status_code == 409


def test_team_seat_on_unpublished_floor_does_not_block(client, world):
    # Unpublish Level 2 and take E1: dina's only free team seats are now on a draft floor.
    assert client.post(f"/api/admin/floor-plans/{world['plans']['Level 2']}/unpublish", headers=hdr(world["tok"]["root"])).status_code == 200
    assert book(client, world, "erin", "E1", "am").status_code == 201
    assert book(client, world, "dina", "F1", "am").status_code == 201


def test_walk_up_free_for_all_refused_while_team_seat_can_be_checked_in(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    r = check_in(client, world, "dina", "F2")
    assert r.status_code == 409
    assert r.get_json()["error"] == "Your project team has a free seat: E1 on Level 1. Check in there instead."
    assert r.get_json()["suggestion"]["seat_id"] == world["seats"]["E1"]
    info = client.get(f"/api/desk/seats/{world['seats']['F2']}", headers=hdr(world["tok"]["dina"])).get_json()
    assert info["can_check_in"] is False and info["suggestion"]["seat_label"] == "E1"
    assert check_in(client, world, "dina", "E1").status_code == 201


def test_checking_in_to_own_free_for_all_booking_is_allowed(client, world, monkeypatch):
    ids = {who: book(client, world, who, seat, "am").get_json()["id"] for who, seat in FILL_DESIGN}
    assert book(client, world, "dina", "F1", "am").status_code == 201        # legal: every team seat taken
    assert client.delete(f"/api/desk/bookings/{ids['erin']}", headers=hdr(world["tok"]["erin"])).status_code == 204
    set_now(monkeypatch, sg(DAY, 7, 45))
    r = check_in(client, world, "dina", "F1")
    assert r.status_code == 201 and r.get_json()["method"] == "booking"


def test_booked_team_seat_later_today_still_counts_as_free_now(client, world, monkeypatch):
    assert book(client, world, "erin", "E1", "pm").status_code == 201
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "dina", "F2").get_json()["suggestion"]["seat_label"] == "E1"


def test_checked_in_elsewhere_gets_give_up_message_not_team_first(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "dina", "E1").status_code == 201
    r = check_in(client, world, "dina", "F2")
    assert r.status_code == 409 and r.get_json()["error"] == "Give up your seat at E1 first." and "suggestion" not in r.get_json()


def test_suggest_for_check_in_uses_now(app, client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "erin", "E1").status_code == 201
    got = _suggest(app, world, "dina", preset=None, purpose="checkin")
    assert got["tier"] == "team" and got["seats"][0]["seat_label"] == "D2"
