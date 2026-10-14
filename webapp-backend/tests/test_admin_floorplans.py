import pytest

from app.core.db import run_one, run_write
from app.core.security import hash_password

ADMIN_PW = "adminpw1"
USER_PW = "userpw12"


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id", {"p": hash_password(ADMIN_PW)})
    return client.post("/api/auth/login",
                       json={"email_or_username": "root@x.com", "password": ADMIN_PW}).get_json()["token"]


@pytest.fixture()
def user_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('plain@x.com', 'plain', 'Plain', 1, :p) returning id", {"p": hash_password(USER_PW)})
    return client.post("/api/auth/login",
                       json={"email_or_username": "plain@x.com", "password": USER_PW}).get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_floorplans_require_auth_and_admin(client, db, user_token):
    assert client.get("/api/admin/floor-plans").status_code == 401
    assert client.get("/api/admin/floor-plans", headers=hdr(user_token)).status_code == 403


def test_create_validation(client, db, admin_token):
    r = client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                    json={"name": "", "cols": 2, "rows": 100})
    assert r.status_code == 400
    fields = r.get_json()["fields"]
    assert "name" in fields and "cols" in fields and "rows" in fields


def test_create_get_list_update_delete(client, db, admin_token):
    r = client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                    json={"name": "Level 9", "cols": 20, "rows": 15})
    assert r.status_code == 201
    plan = r.get_json()
    assert plan["name"] == "Level 9" and plan["elements"] == []
    got = client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token))
    assert got.status_code == 200 and got.get_json()["cols"] == 20
    items = client.get("/api/admin/floor-plans", headers=hdr(admin_token)).get_json()["items"]
    assert items[0]["element_count"] == 0
    patched = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                           json={"name": "Renamed"})
    assert patched.status_code == 200 and patched.get_json()["name"] == "Renamed"
    assert patched.get_json()["updated_at"] != plan["updated_at"]
    assert client.delete(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).status_code == 204
    assert client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).status_code == 404
    for action in ("floorplan.create", "floorplan.update", "floorplan.delete"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_patch_rejects_empty_body_and_unknown_fields(client, db, admin_token):
    plan = client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                       json={"name": "Grid", "cols": 10, "rows": 10}).get_json()
    assert client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                        json={}).status_code == 400
    r = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                     json={"bogus": 1})
    assert r.status_code == 400 and r.get_json()["fields"]["bogus"] == "unknown field"


def test_patch_shrink_guard_blocks_without_applying(client, db, admin_token):
    # The element bulk-save endpoint (PUT .../elements) is added in a later task;
    # insert the element directly to exercise the PATCH resize guard in isolation.
    plan = client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                       json={"name": "Grid", "cols": 10, "rows": 10}).get_json()
    run_write(
        "insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation) "
        "values (cast(:p as uuid), 'seat', 8, 8, 1, 1, 0)", {"p": plan["id"]})
    r = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                     json={"cols": 5, "rows": 5})
    assert r.status_code == 400 and "elements" in r.get_json()["fields"]
    unchanged = client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).get_json()
    assert (unchanged["cols"], unchanged["rows"]) == (10, 10)
    # Rotation-aware: a meeting_room (3x2) rotated 90 effectively needs 2x3.
    run_write(
        "insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation) "
        "values (cast(:p as uuid), 'meeting_room', 7, 7, 3, 2, 90)", {"p": plan["id"]})
    r2 = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                      json={"cols": 8, "rows": 9})
    assert r2.status_code == 400 and "elements" in r2.get_json()["fields"]


def test_get_unknown_plan_404(client, db, admin_token):
    assert client.get("/api/admin/floor-plans/" + "0" * 36,
                      headers=hdr(admin_token)).status_code == 404
    assert client.get("/api/admin/floor-plans/00000000-0000-0000-0000-000000000000",
                      headers=hdr(admin_token)).status_code == 404


def test_catalog(client, db, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    by_type = {i["type"]: i for i in items}
    assert by_type["seat"] == {"type": "seat", "label": "Seat", "w": 1, "h": 1, "color": "#16a34a"}
    assert set(by_type) == {"wall", "seat", "toilet", "elevator", "door",
                            "meeting_room", "kitchen", "plant", "corridor"}


def _mk_plan(client, admin_token, cols=10, rows=10):
    return client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                       json={"name": "Grid", "cols": cols, "rows": rows}).get_json()


def _save(client, admin_token, pid, elements):
    return client.put(f"/api/admin/floor-plans/{pid}/elements",
                      headers=hdr(admin_token), json={"elements": elements})


def test_save_replaces_and_persists(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [
        {"type": "seat", "x": 1, "y": 1, "rotation": 0, "label": "A1"},
        {"type": "toilet", "x": 5, "y": 5, "rotation": 90, "color": "#ff0000"},
    ])
    assert r.status_code == 200
    els = r.get_json()["elements"]
    assert len(els) == 2
    toilet = next(e for e in els if e["type"] == "toilet")
    assert (toilet["w"], toilet["h"]) == (2, 2) and toilet["rotation"] == 90
    r = _save(client, admin_token, plan["id"], [{"type": "wall", "x": 0, "y": 0, "rotation": 0}])
    assert len(r.get_json()["elements"]) == 1
    assert run_one("select count(*) as n from floor_plan_elements")["n"] == 1
    assert run_one("select action from audit_logs where action = 'floorplan.elements_saved'")


def test_save_rotation_swaps_footprint(client, db, admin_token):
    plan = _mk_plan(client, admin_token, cols=5, rows=5)
    ok = _save(client, admin_token, plan["id"],
               [{"type": "meeting_room", "x": 1, "y": 2, "rotation": 90}])
    assert ok.status_code == 200
    bad = _save(client, admin_token, plan["id"],
                [{"type": "meeting_room", "x": 1, "y": 3, "rotation": 90}])
    assert bad.status_code == 400


def test_save_rejects_bad_elements(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    cases = [
        ([{"type": "desk", "x": 0, "y": 0, "rotation": 0}], "unknown type"),
        ([{"type": "seat", "x": 10, "y": 0, "rotation": 0}], "outside"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 45}], "rotation"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0, "color": "red"}], "#rrggbb"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0},
          {"type": "seat", "x": 0, "y": 0, "rotation": 0}], "overlap"),
    ]
    for elements, fragment in cases:
        r = _save(client, admin_token, plan["id"], elements)
        assert r.status_code == 400, elements
        assert any(fragment in m for m in r.get_json()["fields"]["elements"]), (fragment, r.get_json())


def test_save_invalid_batch_keeps_previous(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    _save(client, admin_token, plan["id"], [{"type": "seat", "x": 0, "y": 0, "rotation": 0}])
    bad = _save(client, admin_token, plan["id"], [
        {"type": "seat", "x": 1, "y": 1, "rotation": 0},
        {"type": "seat", "x": 1, "y": 1, "rotation": 0}])
    assert bad.status_code == 400
    els = client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).get_json()["elements"]
    assert [e["x"] for e in els] == [0]


def test_save_requires_elements_list(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    r = client.put(f"/api/admin/floor-plans/{plan['id']}/elements",
                   headers=hdr(admin_token), json={"elements": "nope"})
    assert r.status_code == 400 and "elements" in r.get_json()["fields"]
