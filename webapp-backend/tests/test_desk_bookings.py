"""Booking rules over the API (spec 2026-10-15-seat-booking-and-checkin §2.3-2.4)."""
from datetime import timedelta
import pytest

from app.core.db import run_one, run_write
from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _seat(client, world, label, tok="jane", preset="am", day=DAY):
    r = client.get(f"/api/desk/floors/{world['plan']}?date={day.isoformat()}&preset={preset}",
                   headers=hdr(world["tok"][tok]))
    assert r.status_code == 200, r.get_json()
    return next(s for s in r.get_json()["seats"] if s["id"] == world["seats"][label])


def test_book_am_for_self_holds_ten_blocks(client, world):
    r = book(client, world, "jane", "F1")
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["preset"] == "am" and body["booked_for"]["name"] == "Jane Tan" and body["state"] == "active"
    assert run_one("select count(*) as n from seat_booking_blocks")["n"] == 10
    seat = _seat(client, world, "F1")
    assert seat["state"] == "booked" and seat["booking"]["booked_for"]["initials"] == "JT"


def test_overlap_refused_per_seat_and_per_person(client, world):
    assert book(client, world, "jane", "F1").status_code == 201
    assert book(client, world, "carl", "F1", "full").status_code == 409        # seat taken for AM
    assert book(client, world, "carl", "F1", "pm").status_code == 201          # PM still free
    assert book(client, world, "jane", "F2", "pm").status_code == 201          # Jane PM elsewhere
    assert book(client, world, "jane", "F2", "am").status_code == 409          # Jane already has AM


def test_only_free_for_all_seats(client, world):
    assert book(client, world, "jane", "E1").status_code == 400
    assert book(client, world, "jane", "U1").status_code == 400


def test_booking_for_colleagues_uses_allowance(client, world):
    assert book(client, world, "jane", "F1", for_user="carl").status_code == 403    # allowance 0
    assert book(client, world, "ali", "F1", for_user="carl").status_code == 201     # allowance 1
    r = book(client, world, "ali", "F2", for_user="jane")
    assert r.status_code == 403 and "allowance" in r.get_json()["error"]
    assert book(client, world, "ali", "F1", "pm", for_user="carl").status_code == 201  # same colleague
    assert book(client, world, "ali", "F2", "pm").status_code == 201                   # self is free
    mine = client.get("/api/desk/bookings/mine", headers=hdr(world["tok"]["carl"])).get_json()["items"]
    assert len(mine) == 2 and all(b["booked_by"]["name"] == "Ali Rahman" for b in mine)
    made = client.get("/api/desk/bookings/mine", headers=hdr(world["tok"]["ali"])).get_json()["items"]
    assert len(made) == 3


def test_colleague_rules(client, world):
    run_write("update users set booking_allowance = 5 where username = 'ali'")
    assert book(client, world, "ali", "F1", for_user="bob").status_code == 403      # no shared department
    assert book(client, world, "ali", "F1", for_user="dave").status_code == 400     # inactive
    found = client.get("/api/desk/colleagues?q=&date=" + DAY.isoformat(), headers=hdr(world["tok"]["ali"])).get_json()
    names = {c["name"] for c in found["items"]}
    assert names == {"Root Admin", "Jane Tan", "Carl Lim"} and found["allowance"]["limit"] == 5


def test_cancel_rights(client, world):
    b1 = book(client, world, "ali", "F1", for_user="carl").get_json()["id"]
    assert client.delete(f"/api/desk/bookings/{b1}", headers=hdr(world["tok"]["jane"])).status_code == 403
    assert client.delete(f"/api/desk/bookings/{b1}", headers=hdr(world["tok"]["carl"])).status_code == 204
    b2 = book(client, world, "jane", "F1").get_json()["id"]
    assert client.delete(f"/api/desk/bookings/{b2}", headers=hdr(world["tok"]["root"])).status_code == 204
    b3 = book(client, world, "jane", "F2").get_json()["id"]
    run_write("update seat_bookings set end_reason = 'checked_in', ended_at = now() where id = cast(:b as uuid)",
              {"b": b3})
    assert client.delete(f"/api/desk/bookings/{b3}", headers=hdr(world["tok"]["jane"])).status_code == 409
    assert run_one("select count(*) as n from seat_bookings")["n"] == 3     # rows are kept


def test_release_at_exactly_0830(client, world, monkeypatch):
    bid = book(client, world, "jane", "F1").get_json()["id"]
    set_now(monkeypatch, sg(DAY, 8, 29))
    assert _seat(client, world, "F1")["state"] == "booked"
    set_now(monkeypatch, sg(DAY, 8, 30))
    assert _seat(client, world, "F1")["state"] == "available"
    row = run_one("select end_reason from seat_bookings where id = cast(:b as uuid)", {"b": bid})
    assert row["end_reason"] == "released"
    assert run_one("select count(*) as n from seat_booking_blocks")["n"] == 0


def test_unpublished_plan_not_bookable(client, world):
    client.post(f"/api/admin/floor-plans/{world['plan']}/unpublish", headers=hdr(world["tok"]["root"]))
    r = client.get(f"/api/desk/floors/{world['plan']}", headers=hdr(world["tok"]["jane"]))
    assert r.status_code == 404
    assert book(client, world, "jane", "F1").status_code == 404
    assert client.get("/api/desk/floors", headers=hdr(world["tok"]["jane"])).get_json()["items"] == []


def _queries_for(client, url, tok):
    from sqlalchemy import event

    from app.core.db import get_engine
    count = {"n": 0}

    def on_execute(*_args):
        count["n"] += 1
    engine = get_engine()
    event.listen(engine, "before_cursor_execute", on_execute)
    try:
        assert client.get(url, headers=hdr(tok)).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", on_execute)
    return count["n"]


def test_floor_view_query_count_does_not_grow_with_seats(client, world):
    tok, root = world["tok"]["jane"], world["tok"]["root"]
    url = f"/api/desk/floors/{world['plan']}?date={DAY.isoformat()}&preset=am"
    small = _queries_for(client, url, tok)
    draft = client.get(f"/api/admin/floor-plans/{world['plan']}", headers=hdr(root)).get_json()["elements"]
    extra = [{"type": "seat", "x": x, "y": 5, "rotation": 0, "open_to_all": True} for x in range(8)]
    assert client.put(f"/api/admin/floor-plans/{world['plan']}/elements", headers=hdr(root),
                      json={"elements": draft + extra}).status_code == 200
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/publish", headers=hdr(root)).status_code == 200
    large = _queries_for(client, url, tok)
    assert large == small, (small, large)


def test_admins_can_book_for_anyone(client, world):
    """Owner 2026-10-16: an admin books for anyone - no shared project team, no allowance limit."""
    assert book(client, world, "root", "F1", for_user="bob").status_code == 201        # Ops: no shared team, allowance 0
    assert book(client, world, "root", "F2", for_user="jane").status_code == 201
    assert book(client, world, "root", "F1", "pm", for_user="carl").status_code == 201  # third colleague, same day
    assert book(client, world, "root", "F2", "pm", for_user="dave").status_code == 400  # still not for inactive accounts
    found = client.get("/api/desk/colleagues?q=&date=" + DAY.isoformat(), headers=hdr(world["tok"]["root"])).get_json()
    assert {"Bob Ong", "Jane Tan", "Carl Lim", "Ali Rahman"} <= {c["name"] for c in found["items"]}
    assert "Root Admin" not in {c["name"] for c in found["items"]} and "Dave Inactive" not in {c["name"] for c in found["items"]}
    assert found["allowance"]["limit"] is None and found["allowance"]["left"] is None    # no limit


def test_a_cancelled_booking_frees_the_seat_on_the_floor_and_can_be_booked_again(client, world, monkeypatch):
    """Owner 2026-10-16: after cancelling, the seat shows free again and the same person can book it again."""
    set_now(monkeypatch, sg(DAY, 16, 30))                       # Friday afternoon; the next working day is Monday
    monday = (DAY + timedelta(days=3)).isoformat()
    jane = hdr(world["tok"]["jane"])
    floor = lambda: {s["label"]: s for s in client.get(f"/api/desk/floors/{world['plan']}?date={monday}&preset=full", headers=jane).get_json()["seats"]}   # noqa: E731
    b = book(client, world, "jane", "F1", "full", day=DAY + timedelta(days=3))
    assert b.status_code == 201
    assert floor()["F1"]["state"] == "booked" and floor()["F1"]["can_book"]["full"] is False
    assert client.delete(f"/api/desk/bookings/{b.get_json()['id']}", headers=jane).status_code in (200, 204)
    f1 = floor()["F1"]
    assert f1["state"] == "available" and f1["can_book"]["full"] is True and f1["booking"] is None
    assert book(client, world, "jane", "F1", "full", day=DAY + timedelta(days=3)).status_code == 201
