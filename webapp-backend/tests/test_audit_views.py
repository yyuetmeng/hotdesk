"""Audit shown inside the admin modules (spec 2026-10-16-audit-views §2-4)."""
from datetime import timedelta

import pytest

from app.core.db import run_write
from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _root(world):
    return hdr(world["tok"]["root"])


# --- §2 users: security badges and filters ------------------------------------------------------

def test_users_list_has_last_sign_in_and_failed_count(client, world):
    client.post("/api/auth/login", json={"email_or_username": "jane", "password": "wrong"})
    client.post("/api/auth/login", json={"email_or_username": "jane", "password": "wrong"})
    items = {u["username"]: u for u in client.get("/api/admin/users", headers=_root(world)).get_json()["items"]}
    assert items["jane"]["failed_logins_7d"] == 2 and items["jane"]["last_login_at"]
    assert items["bob"]["failed_logins_7d"] == 0
    assert items["dave"]["last_login_at"] is None                      # inactive, never signed in


def test_enabling_a_user_clears_the_failed_and_locked_badges(client, world):
    for _ in range(2):
        client.post("/api/auth/login", json={"email_or_username": "jane", "password": "wrong"})
    run_write("update users set is_active = false, failed_attempts = 5 where username = 'jane'")
    before = {u["username"]: u for u in client.get("/api/admin/users", headers=_root(world)).get_json()["items"]}["jane"]
    assert before["locked"] is True and before["failed_logins_7d"] == 2
    assert client.patch(f"/api/admin/users/{world['users']['jane']}", headers=_root(world), json={"is_active": True}).status_code == 200
    after = {u["username"]: u for u in client.get("/api/admin/users", headers=_root(world)).get_json()["items"]}["jane"]
    assert after["locked"] is False and after["failed_logins_7d"] == 0     # only failures after the re-enable count


def test_users_filter_locked_and_pending(client, world):
    run_write("update users set failed_attempts = 5 where username = 'bob'")
    run_write("insert into users (email, username, full_name, role_id) values ('new@x.com', 'newbie', 'New Person', 1)")
    locked = client.get("/api/admin/users", query_string={"status": "locked"}, headers=_root(world)).get_json()["items"]
    pending = client.get("/api/admin/users", query_string={"status": "pending"}, headers=_root(world)).get_json()["items"]
    assert [u["username"] for u in locked] == ["bob"] and [u["username"] for u in pending] == ["newbie"]


# --- §3 floor plans, displays, labels -----------------------------------------------------------

def test_floor_plan_history(client, world):
    r = client.get(f"/api/admin/floor-plans/{world['plan']}/history", headers=_root(world))
    body = r.get_json()
    assert r.status_code == 200
    assert [(v["version"], v["published_by"], v["elements"]) for v in body["versions"]] == [(1, "Root Admin", 4)]
    assert [e["action"] for e in body["events"]][:3] == ["floorplan.publish", "floorplan.elements_saved", "floorplan.create"]
    assert body["events"][0]["summary"] == "Root Admin published floor plan Level 1 (v1)"


def test_history_collapses_consecutive_saves(client, world):
    tok = world["tok"]["root"]
    draft = client.get(f"/api/admin/floor-plans/{world['plan']}", headers=hdr(tok)).get_json()["elements"]
    for _ in range(3):
        assert client.put(f"/api/admin/floor-plans/{world['plan']}/elements", headers=hdr(tok), json={"elements": draft}).status_code == 200
    events = client.get(f"/api/admin/floor-plans/{world['plan']}/history", headers=_root(world)).get_json()["events"]
    assert events[0]["action"] == "floorplan.elements_saved" and events[0]["times"] == 3
    assert events[0]["summary"] == "Root Admin saved floor plan Level 1 (3 saves)"


def test_last_change_on_plans_and_displays(client, world):
    plan = next(p for p in client.get("/api/admin/floor-plans", headers=_root(world)).get_json()["items"] if p["id"] == world["plan"])
    assert plan["last_change"]["actor_name"] == "Root Admin" and "published" in plan["last_change"]["summary"]
    created = client.post("/api/admin/displays", headers=_root(world), json={"name": "Lobby", "slug": "lobby", "plan_ids": [world["plan"]]})
    assert created.status_code == 201, created.get_json()
    [d] = client.get("/api/admin/displays", headers=_root(world)).get_json()["items"]
    assert d["last_change"]["summary"] == "Root Admin created display Lobby"


def test_label_downloads_say_who_and_when(client, world):
    f1 = world["seats"]["F1"]
    assert client.post("/api/admin/desk-labels/downloads", headers=_root(world), json={"seat_ids": [f1]}).status_code == 204
    body = client.get("/api/admin/desk-labels/downloads", headers=_root(world)).get_json()
    assert body["seat_ids"] == [f1] and body["details"][f1]["by"] == "Root Admin" and body["details"][f1]["at"]


# --- §4 Insights: booking funnel ----------------------------------------------------------------

def test_booking_funnel(client, world, monkeypatch):
    assert book(client, world, "jane", "F1", "am").status_code == 201          # released (no check-in)
    gone = book(client, world, "ali", "F2", "pm").get_json()["id"]             # cancelled
    assert client.delete(f"/api/desk/bookings/{gone}", headers=hdr(world["tok"]["ali"])).status_code == 204
    assert book(client, world, "carl", "F2", "am").status_code == 201          # checked in
    set_now(monkeypatch, sg(DAY, 8, 10))
    assert client.post(f"/api/desk/seats/{world['seats']['F2']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    set_now(monkeypatch, sg(DAY, 9))
    body = client.get("/api/admin/insights/funnel", query_string={"days": 7}, headers=_root(world)).get_json()
    day = next(d for d in body["days"] if d["date"] == DAY.isoformat())
    assert (day["booked"], day["checked_in"], day["released"], day["cancelled"]) == (3, 1, 1, 1)
    assert len(body["days"]) == 7 and body["days"][-1]["date"] == DAY.isoformat()
    eng = next(t for t in body["teams"] if t["name"] == "Engineering")
    assert (eng["bookings"], eng["no_shows"], eng["rate"]) == (2, 1, 50)       # cancelled bookings are not counted
    assert body["auto"] == {"booked": 0, "used": 0, "unused": 0}
    assert client.get("/api/admin/insights/funnel", query_string={"days": 400}, headers=_root(world)).status_code == 400
