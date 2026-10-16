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


def test_seat_held_for_its_last_half_hour_shows_booked(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 18, 25))
    assert book(client, world, "jane", "F1", "pm").status_code == 201        # 18:30-19:00, release 18:55
    set_now(monkeypatch, sg(DAY, 18, 40))
    seat = next(s for s in client.get(f"/api/public/floors/{world['plan']}").get_json()["seats"]
                if s["id"] == world["seats"]["F1"])
    assert seat["state"] == "booked"


def test_settle_skips_rows_locked_by_another_request(client, world, monkeypatch):
    import threading

    from sqlalchemy import create_engine, text

    from conftest import BASE_URI, TEST_SCHEMA

    bid = book(client, world, "jane", "F1").get_json()["id"]                # AM, release 08:30
    set_now(monkeypatch, sg(DAY, 8, 31))
    url = f"/api/public/floors/{world['plan']}"
    result = {}
    engine = create_engine(BASE_URI)
    try:
        with engine.connect() as locker:
            locker.execute(text(f"set search_path to {TEST_SCHEMA}, public, extensions"))
            locker.execute(text("select id from seat_bookings where id = cast(:b as uuid) for update"), {"b": bid})
            worker = threading.Thread(target=lambda: result.setdefault("status", client.get(url).status_code))
            worker.start()
            worker.join(timeout=10)
            finished = not worker.is_alive()
            locker.rollback()                                              # release the lock either way
        worker.join(timeout=30)
    finally:
        engine.dispose()
    assert finished, "request blocked on a row locked by another request"
    assert result["status"] == 200
    client.get(url)
    assert run_one("select end_reason from seat_bookings where id = cast(:b as uuid)", {"b": bid})["end_reason"] == "released"


def test_seat_shows_booked_in_the_half_hour_before_its_booking(client, world, monkeypatch):
    assert book(client, world, "jane", "F1").status_code == 201              # AM from 08:00, booked the day before
    set_now(monkeypatch, sg(DAY, 7, 45))
    seat = next(s for s in client.get(f"/api/public/floors/{world['plan']}").get_json()["seats"]
                if s["id"] == world["seats"]["F1"])
    assert seat["state"] == "booked"


def test_settle_logs_when_it_rolls_back(client, world, monkeypatch, caplog):
    import logging

    from sqlalchemy.exc import OperationalError

    from app.desk import service

    def boom(*_a, **_k):
        raise OperationalError("select", {}, Exception("simulated deadlock"))
    monkeypatch.setattr(service, "_free_booking_blocks", boom)
    book(client, world, "jane", "F1")
    set_now(monkeypatch, sg(DAY, 13, 30))
    client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["jane"]))
    set_now(monkeypatch, sg(DAY, 19, 30))                                       # check-in due to end -> boom
    with caplog.at_level(logging.WARNING):
        assert client.get(f"/api/public/floors/{world['plan']}").status_code == 200
    assert any("settle rolled back" in r.getMessage() for r in caplog.records)


def test_occupied_seat_says_since_and_until_for_the_floor_tooltip(client, world, monkeypatch):
    """Owner 2026-10-16: hover on a seat shows who sits there and until when (live floor and TV)."""
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    seat = next(s for s in client.get(f"/api/public/floors/{world['plan']}").get_json()["seats"] if s["id"] == world["seats"]["E1"])
    assert seat["state"] == "occupied" and seat["occupant"]["name"] == "Carl Lim"
    assert seat["occupant"]["since"].startswith(f"{DAY.isoformat()}T09:00") and seat["occupant"]["until"].startswith(f"{DAY.isoformat()}T19:00")
