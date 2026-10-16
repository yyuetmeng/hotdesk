"""Audit log page API (spec 2026-10-16-audit-views §1-2)."""
import io
import zipfile

import pytest

from app.core.db import run_write
from desk_helpers import DAY, book, build_world, hdr, set_now, sg

URL = "/api/admin/audit"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _get(client, world, **params):
    r = client.get(URL, query_string=params, headers=hdr(world["tok"]["root"]))
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def test_admins_only(client, world):
    assert client.get(URL, headers=hdr(world["tok"]["jane"])).status_code == 403


def test_lists_newest_first_with_summaries_and_counts(client, world):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    body = _get(client, world)
    first = body["items"][0]
    assert first["action"] == "booking.create" and first["category"] == "desks"
    assert first["summary"] == f"Jane Tan booked F1 · Level 1 ({DAY.isoformat()})" and first["actor_name"] == "Jane Tan"
    assert body["counts"]["security"] == 5          # the five sign-ins of build_world
    assert body["counts"]["desks"] == 1 and body["counts"]["floor_plans"] >= 3   # create, save, publish
    published = next(i for i in body["items"] if i["action"] == "floorplan.publish")
    assert published["summary"] == "Root Admin published floor plan Level 1 (v1)" and published["target_name"] == "Level 1"


def test_filters(client, world):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    assert {i["category"] for i in _get(client, world, category="security")["items"]} == {"security"}
    jane = _get(client, world, subject=world["users"]["jane"])["items"]
    assert {i["action"] for i in jane} == {"auth.login_success", "booking.create"}
    assert [i["action"] for i in _get(client, world, q="F1")["items"]] == ["booking.create"]   # q searches name, action, details
    assert all(i["actor_name"] == "Carl Lim" for i in _get(client, world, q="carl")["items"])
    assert _get(client, world, **{"from": "2030-01-01"})["items"] == []
    assert client.get(URL, query_string={"category": "nope"}, headers=hdr(world["tok"]["root"])).status_code == 400
    assert client.get(URL, query_string={"actor": "x"}, headers=hdr(world["tok"]["root"])).status_code == 400


def test_old_entries_are_purged(client, world):
    run_write("insert into audit_logs (action, details, created_at) values ('auth.login_failed', '{}', now() - interval '400 days')")
    _get(client, world)
    assert not [i for i in _get(client, world, category="security")["items"] if i["at"] < "2026-01-01"]


def test_export(client, world):
    r = client.get("/api/admin/audit.xlsx", query_string={"category": "floor_plans"}, headers=hdr(world["tok"]["root"]))
    assert r.status_code == 200 and "audit-log-" in r.headers["Content-Disposition"]
    sheet = zipfile.ZipFile(io.BytesIO(r.data)).read("xl/worksheets/sheet1.xml").decode()
    assert "published floor plan Level 1" in sheet and "signed in" not in sheet


def test_security_summary(client, world):
    client.post("/api/auth/login", json={"email_or_username": "jane", "password": "wrong"})
    run_write("update users set failed_attempts = 5 where username = 'bob'")
    run_write("insert into users (email, username, full_name, role_id) values ('new@x.com', 'newbie', 'New Person', 1)")
    s = client.get("/api/admin/audit/security-summary", headers=hdr(world["tok"]["root"])).get_json()
    assert (s["failed_today"], s["locked"], s["pending"]) == (1, 1, 1)
