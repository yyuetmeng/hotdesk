"""Audit groundwork (spec 2026-10-16-audit-views §0): the full trail, and names kept on every entry."""
import pytest

from app.core.db import run_one, run_write
from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _entries(action):
    rows = run_one("select coalesce(json_agg(a order by a.id), '[]'::json) as rows from "
                   "(select id, actor_id::text, actor_name, action, target_id::text, details from audit_logs where action = :a) a",
                   {"a": action})["rows"]
    return rows


def _poke(client, world, who="jane"):
    """Any desk request runs settle."""
    assert client.get("/api/desk/me", headers=hdr(world["tok"][who])).status_code == 200


def test_no_show_release_is_audited(client, world, monkeypatch):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    set_now(monkeypatch, sg(DAY, 9))
    _poke(client, world)
    [e] = _entries("booking.released")
    assert e["actor_id"] is None and e["details"]["seat_label"] == "F1" and e["details"]["user_name"] == "Jane Tan"
    assert e["details"]["plan_name"] == "Level 1" and e["details"]["date"] == DAY.isoformat()


def test_automatic_check_out_is_audited(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["dina"])).status_code == 201
    set_now(monkeypatch, sg(DAY, 23))
    _poke(client, world)
    [e] = _entries("checkin.auto_ended")
    assert e["actor_id"] is None and (e["details"]["seat_label"], e["details"]["user_name"]) == ("E1", "Dina Koh")


def test_plan_change_cancellations_name_the_admin(client, world):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/unpublish", headers=hdr(world["tok"]["root"])).status_code == 200
    [e] = _entries("booking.plan_changed")
    assert e["actor_id"] == world["users"]["root"] and e["actor_name"] == "Root Admin" and e["details"]["user_name"] == "Jane Tan"


def test_auto_booking_is_audited(client, world):
    assert client.patch(f"/api/admin/users/{world['users']['jane']}", headers=hdr(world["tok"]["root"]),
                        json={"usual_seat_id": world["seats"]["F1"]}).status_code == 200
    assert client.patch("/api/desk/me", headers=hdr(world["tok"]["jane"]), json={"auto_book": True}).status_code == 200
    assert client.get("/api/desk/dashboard", headers=hdr(world["tok"]["jane"])).status_code == 200
    entries = _entries("booking.auto_created")
    assert len(entries) == 2 and all(e["actor_name"] == "Jane Tan" and e["details"]["seat_label"] == "F1" for e in entries)


def test_exports_and_label_downloads_are_audited(client, world):
    root = hdr(world["tok"]["root"])
    assert client.get("/api/admin/insights/teams.xlsx", headers=root).status_code == 200
    assert client.post("/api/admin/desk-labels/downloads", headers=root,
                       json={"seat_ids": [world["seats"]["F1"], world["seats"]["F2"]]}).status_code == 204
    [export] = _entries("insights.exported")
    assert export["details"]["kind"] == "project_teams" and export["actor_name"] == "Root Admin"
    [labels] = _entries("desk_label.downloaded")
    assert labels["details"]["count"] == 2


def test_actor_name_survives_user_deletion(client, world):
    run_write("delete from seat_bookings where booked_for = cast(:u as uuid)", {"u": world["users"]["bob"]})
    entries = _entries("auth.login_success")
    bob = [e for e in entries if e["actor_id"] == world["users"]["bob"]]
    assert bob and bob[0]["actor_name"] == "Bob Ong"
    assert client.delete(f"/api/admin/users/{world['users']['bob']}", headers=hdr(world["tok"]["root"])).status_code in (200, 204)
    kept = run_one("select actor_id, actor_name from audit_logs where action = 'auth.login_success' and actor_name = 'Bob Ong'")
    assert kept["actor_id"] is None and kept["actor_name"] == "Bob Ong"
