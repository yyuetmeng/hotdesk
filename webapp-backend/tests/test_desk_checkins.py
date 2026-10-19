"""Check-in rules over the API (spec 2026-10-15-seat-booking-and-checkin §2.5-2.6, 2.8)."""
import pytest

from app.core.db import run_one
from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def check_in(client, world, who, seat):
    return client.post(f"/api/desk/seats/{world['seats'][seat]}/check-in", headers=hdr(world["tok"][who]))


def give_up(client, world, who, seat):
    return client.post(f"/api/desk/seats/{world['seats'][seat]}/give-up", headers=hdr(world["tok"][who]))


def test_walk_in_rules_by_tag(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "bob", "E1").status_code == 403        # Ops on a Design seat
    assert check_in(client, world, "bob", "U1").status_code == 403        # untagged
    assert check_in(client, world, "jane", "E1").status_code == 403       # another team's seat
    r = check_in(client, world, "dina", "E1")
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["ends_at"] == sg(DAY, 19).isoformat() and r.get_json()["method"] == "walk_in"
    row = run_one("select seat_department_id::text as d, user_department_ids from seat_checkins")
    assert row["d"] == world["design"] and sorted(str(x) for x in row["user_department_ids"]) == sorted([world["eng"], world["design"]])


def test_walk_in_before_someone_elses_booking_ends_at_it(client, world, monkeypatch):
    assert book(client, world, "carl", "F2", "pm").status_code == 201
    set_now(monkeypatch, sg(DAY, 9))
    r = check_in(client, world, "jane", "F2")
    assert r.status_code == 201
    assert r.get_json()["ends_at"] == sg(DAY, 13).isoformat() and "13:00" in r.get_json()["warning"]


def test_booked_person_checks_in_inside_window_and_others_cannot(client, world, monkeypatch):
    bid = book(client, world, "jane", "F1").get_json()["id"]          # AM, booked the day before
    set_now(monkeypatch, sg(DAY, 7, 20))
    assert check_in(client, world, "jane", "F1").status_code == 403    # window opens 07:30
    set_now(monkeypatch, sg(DAY, 7, 45))
    assert check_in(client, world, "carl", "F1").status_code == 403    # booked for Jane
    r = check_in(client, world, "jane", "F1")
    assert r.status_code == 201 and r.get_json()["method"] == "booking"
    assert r.get_json()["ends_at"] == sg(DAY, 13).isoformat()
    assert run_one("select end_reason from seat_bookings where id = cast(:b as uuid)", {"b": bid})["end_reason"] == "checked_in"


def test_one_active_check_in_and_give_up(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))      # jane (Eng) has no team seat, so team first never applies
    assert check_in(client, world, "jane", "F2").status_code == 201
    r = check_in(client, world, "jane", "F1")
    assert r.status_code == 409 and "Give up your seat at F2" in r.get_json()["error"]
    assert give_up(client, world, "carl", "F2").status_code == 409     # not Carl's check-in
    assert give_up(client, world, "jane", "F2").status_code == 204
    seat = client.get(f"/api/desk/seats/{world['seats']['F2']}", headers=hdr(world["tok"]["carl"])).get_json()
    assert seat["state"] == "available" and seat["can_check_in"] is True
    assert run_one("select end_reason from seat_checkins")["end_reason"] == "given_up"
    assert check_in(client, world, "jane", "F1").status_code == 201


def test_early_booked_person_waits_for_walk_in_to_end(client, world, monkeypatch):
    assert book(client, world, "carl", "F1", "pm").status_code == 201
    set_now(monkeypatch, sg(DAY, 12))
    assert check_in(client, world, "jane", "F1").status_code == 201    # walk-in until 13:00
    set_now(monkeypatch, sg(DAY, 12, 40))
    r = check_in(client, world, "carl", "F1")
    assert r.status_code == 409 and "occupied until 13:00" in r.get_json()["error"]
    set_now(monkeypatch, sg(DAY, 13))
    assert check_in(client, world, "carl", "F1").status_code == 201
    assert run_one("select end_reason from seat_checkins where user_name = 'Jane Tan'")["end_reason"] == "auto"


def test_me_and_auto_end(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    check_in(client, world, "dina", "E1")
    me = client.get("/api/desk/me", headers=hdr(world["tok"]["dina"])).get_json()
    assert me["checkin"]["seat_label"] == "E1"
    assert me["user_id"] == world["users"]["dina"]      # the Desk check-in page picks out bookings for me
    set_now(monkeypatch, sg(DAY, 19, 5))
    assert client.get("/api/desk/me", headers=hdr(world["tok"]["dina"])).get_json()["checkin"] is None
    assert run_one("select end_reason from seat_checkins")["end_reason"] == "auto"


def test_seat_activity_today_with_names(client, world, monkeypatch):
    assert book(client, world, "ali", "F1", for_user="carl").status_code == 201   # made yesterday
    set_now(monkeypatch, sg(DAY, 8, 10))
    assert check_in(client, world, "carl", "F1").status_code == 201
    set_now(monkeypatch, sg(DAY, 11))
    assert give_up(client, world, "carl", "F1").status_code == 204
    items = client.get(f"/api/desk/seats/{world['seats']['F1']}/activity",
                       headers=hdr(world["tok"]["bob"])).get_json()["items"]
    assert [i["kind"] for i in items] == ["checked_in", "gave_up"]          # yesterday's booking omitted
    assert "Carl Lim" in items[0]["text"] and "Ali Rahman" in items[0]["text"]
    assert items[0]["at"] == sg(DAY, 8, 10).isoformat()
