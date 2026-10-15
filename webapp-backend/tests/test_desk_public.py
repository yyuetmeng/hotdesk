"""Plan changes cancel bookings; public (no sign-in) floor and activity endpoints (spec §2.7-2.8, §5)."""
import json

import pytest

from app.core.db import run_one
from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _republish(client, world, keep):
    """Save the draft keeping only the seats whose labels are in `keep` (with their tags), then publish."""
    tok = world["tok"]["root"]
    draft = client.get(f"/api/admin/floor-plans/{world['plan']}", headers=hdr(tok)).get_json()["elements"]
    kept = [keep[e["label"]](e) for e in draft if e["label"] in keep]
    assert client.put(f"/api/admin/floor-plans/{world['plan']}/elements", headers=hdr(tok),
                      json={"elements": kept}).status_code == 200
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/publish", headers=hdr(tok)).status_code == 200


def test_unpublish_cancels_bookings_and_ends_check_ins(client, world, monkeypatch):
    book(client, world, "jane", "F1", "pm")
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/unpublish", headers=hdr(world["tok"]["root"])).status_code == 200
    assert run_one("select end_reason from seat_bookings")["end_reason"] == "plan_changed"
    assert run_one("select end_reason from seat_checkins")["end_reason"] == "plan_changed"
    assert run_one("select count(*) as n from seat_booking_blocks")["n"] == 0


def test_republish_without_seat_or_retagged_cancels_its_bookings(client, world):
    keep_f2 = book(client, world, "jane", "F2").get_json()["id"]
    gone = book(client, world, "carl", "F1").get_json()["id"]
    _republish(client, world, {"F2": lambda e: e, "E1": lambda e: e})          # F1 deleted
    assert run_one("select end_reason from seat_bookings where id = cast(:b as uuid)", {"b": gone})["end_reason"] == "plan_changed"
    assert run_one("select end_reason from seat_bookings where id = cast(:b as uuid)", {"b": keep_f2})["end_reason"] is None
    _republish(client, world, {"F2": lambda e: {**e, "open_to_all": False, "department_id": world["eng"]},
                               "E1": lambda e: e})                              # F2 retagged
    assert run_one("select end_reason from seat_bookings where id = cast(:b as uuid)", {"b": keep_f2})["end_reason"] == "plan_changed"


def test_public_floor_shows_names_without_sign_in(client, world, monkeypatch):
    book(client, world, "ali", "F1", for_user="carl")
    set_now(monkeypatch, sg(DAY, 8, 5))
    r = client.get(f"/api/public/floors/{world['plan']}")
    assert r.status_code == 200
    seat = next(s for s in r.get_json()["seats"] if s["id"] == world["seats"]["F1"])
    assert seat["state"] == "booked" and seat["booking"]["booked_for"] == {"name": "Carl Lim", "initials": "CL"}
    raw = json.dumps(r.get_json())
    assert "@x.com" not in raw and "username" not in raw and "email" not in raw
    assert [f["id"] for f in client.get("/api/public/floors").get_json()["items"]] == [world["plan"]]


def test_public_activity_today_only(client, world, monkeypatch):
    book(client, world, "jane", "F1")                                            # made yesterday
    set_now(monkeypatch, sg(DAY, 8, 1))
    client.post(f"/api/desk/seats/{world['seats']['F1']}/check-in", headers=hdr(world["tok"]["jane"]))
    items = client.get(f"/api/public/seats/{world['seats']['F1']}/activity").get_json()["items"]
    assert [i["kind"] for i in items] == ["checked_in"]
    assert client.get("/api/public/seats/not-a-seat/activity").status_code == 404


def test_deleting_published_plan_cancels_bookings_and_ends_check_ins(client, world, monkeypatch):
    book(client, world, "jane", "F1", "pm")
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    assert client.delete(f"/api/admin/floor-plans/{world['plan']}", headers=hdr(world["tok"]["root"])).status_code == 204
    assert run_one("select end_reason from seat_bookings")["end_reason"] == "plan_changed"
    assert run_one("select end_reason from seat_checkins")["end_reason"] == "plan_changed"
    assert run_one("select count(*) as n from seat_booking_blocks")["n"] == 0
    assert client.get("/api/desk/me", headers=hdr(world["tok"]["carl"])).get_json()["checkin"] is None


def test_retagging_seat_away_from_free_for_all_ends_its_check_ins(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['F2']}/check-in", headers=hdr(world["tok"]["bob"])).status_code == 201
    _republish(client, world, {"F1": lambda e: e, "E1": lambda e: e,
                               "F2": lambda e: {**e, "open_to_all": False, "department_id": world["eng"]}})
    assert run_one("select end_reason from seat_checkins")["end_reason"] == "plan_changed"
