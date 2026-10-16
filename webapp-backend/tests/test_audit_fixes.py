"""Review fixes for the audit views (2026-10-16 final review)."""
import pytest
from flask import g
from sqlalchemy import event

from app.core.audit import audit_row
from app.core.auth_models import User
from app.core.db import get_engine, run_write
from app.core.orm import orm_session
from desk_helpers import book, build_world, hdr


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _statements(app, fn):
    with app.app_context():
        engine = get_engine()
    seen = []
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)   # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return seen


def test_audit_write_reuses_the_loaded_user(app, world):
    """Writing an audit entry for an already-loaded user must not query users again (string id from the JWT)."""
    with app.test_request_context():
        uid = world["users"]["jane"]
        viewer = orm_session().get(User, __import__("uuid").UUID(uid))  # held by the request, as desk/admin endpoints do
        seen = _statements(app, lambda: [audit_row(uid, "booking.cancel", None, {}) for _ in range(5)])
        orm_session().rollback()
        g.pop("orm_session", None)
    assert viewer is not None and not [s for s in seen if "FROM users" in s]


def test_audit_log_page_query_budget(app, client, world):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    seen = _statements(app, lambda: client.get("/api/admin/audit", headers=hdr(world["tok"]["root"])))
    assert len(seen) <= 6, seen


def test_plans_and_displays_lists_stay_cheap(app, client, world):
    root = hdr(world["tok"]["root"])
    assert len(_statements(app, lambda: client.get("/api/admin/floor-plans", headers=root))) <= 6
    assert len(_statements(app, lambda: client.get("/api/admin/displays", headers=root))) <= 6


def test_a_malformed_entry_does_not_break_the_views(client, world):
    run_write("insert into audit_logs (action, target_id, details) values "
              "('user.update', cast(:u as uuid), '{\"fields\": [1, null]}'), "
              "('floorplan.update', cast(:p as uuid), '\"not an object\"')",
              {"u": world["users"]["jane"], "p": world["plan"]})
    root = hdr(world["tok"]["root"])
    r = client.get("/api/admin/audit", headers=root)
    assert r.status_code == 200
    assert all(i["summary"] for i in r.get_json()["items"])
    assert client.get("/api/admin/floor-plans", headers=root).status_code == 200
    assert client.get(f"/api/admin/audit?subject={world['users']['jane']}", headers=root).status_code == 200


@pytest.mark.parametrize("setting", [0, -5, ""])
def test_retention_setting_has_a_floor(app, client, world, setting):
    app.config["AUDIT_RETENTION_DAYS"] = setting
    run_write("insert into audit_logs (action, details, created_at) values ('auth.login_failed', '{\"identifier\": \"keepme\"}', now() - interval '10 days')")
    r = client.get("/api/admin/audit", query_string={"q": "keepme"}, headers=hdr(world["tok"]["root"]))
    assert r.status_code == 200 and len(r.get_json()["items"]) == 1


def test_plan_change_looks_the_admin_up_once(app, client, world):
    """Unpublishing cancels several bookings; the admin's name is read once, not once per audit row."""
    for who, seat in (("jane", "F1"), ("ali", "F2"), ("carl", "F1")):
        book(client, world, who, seat, "pm" if who == "carl" else "am")
    seen = _statements(app, lambda: client.post(f"/api/admin/floor-plans/{world['plan']}/unpublish", headers=hdr(world["tok"]["root"])))
    assert sum(1 for s in seen if "FROM users" in s) <= 1, [s[:80] for s in seen if "FROM users" in s]
