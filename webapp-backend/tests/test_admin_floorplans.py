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
    # Rotation-aware: a table (2x1) rotated 90 effectively needs 1x2.
    run_write(
        "insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation) "
        "values (cast(:p as uuid), 'table', 7, 7, 2, 1, 90)", {"p": plan["id"]})
    r2 = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                      json={"cols": 9, "rows": 8})
    assert r2.status_code == 400 and "elements" in r2.get_json()["fields"]


def test_get_unknown_plan_404(client, db, admin_token):
    assert client.get("/api/admin/floor-plans/" + "0" * 36,
                      headers=hdr(admin_token)).status_code == 404
    assert client.get("/api/admin/floor-plans/00000000-0000-0000-0000-000000000000",
                      headers=hdr(admin_token)).status_code == 404


def test_catalog(client, db, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    by_type = {i["type"]: i for i in items}
    assert by_type["seat"] == {"type": "seat", "label": "Seat", "w": 1, "h": 1, "color": "#16a34a",
                               "resizable": False, "config": {}}
    assert by_type["wall"]["resizable"] is True and by_type["wall"]["config"] == {}
    assert [i["type"] for i in items] == ["wall", "seat", "table", "sofa", "locker", "toilet", "elevator", "stairs",
                                          "door", "window", "pantry", "plant", "corridor"]


def test_catalog_comes_from_floor_elements_table(client, db, admin_token):
    run_write("insert into floor_elements (type, label, w, h, color, sort_order) "
              "values ('bench', 'Bench', 1, 2, '#334155', 200)")
    try:
        items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
        assert items[-1]["type"] == "bench"
        plan = _mk_plan(client, admin_token)
        assert _save(client, admin_token, plan["id"],
                     [{"type": "bench", "x": 0, "y": 0, "rotation": 0}]).status_code == 200
    finally:
        run_write("delete from floor_plan_elements where type = 'bench'")
        run_write("delete from floor_elements where type = 'bench'")


def test_custom_size_saved_and_used_for_bounds(client, db, admin_token):
    plan = _mk_plan(client, admin_token, cols=6, rows=6)
    ok = _save(client, admin_token, plan["id"],
               [{"type": "wall", "x": 0, "y": 0, "rotation": 0, "w": 6, "h": 1},
                {"type": "table", "x": 0, "y": 1, "rotation": 90, "w": 3, "h": 2}])
    assert ok.status_code == 200
    sizes = {e["type"]: (e["w"], e["h"]) for e in ok.get_json()["elements"]}
    assert sizes == {"wall": (6, 1), "table": (3, 2)}
    # Rotated 3x2 table occupies 2x3: at y=4 it would need rows up to 7.
    bad = _save(client, admin_token, plan["id"],
                [{"type": "table", "x": 0, "y": 4, "rotation": 90, "w": 3, "h": 2}])
    assert bad.status_code == 400
    # Grid shrink is checked against the custom size, not the catalog size.
    r = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                     json={"cols": 5})
    assert r.status_code == 400 and "elements" in r.get_json()["fields"]


def test_size_rules(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    cases = [
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0, "w": 2, "h": 1}], "fixed at 1x1"),
        ([{"type": "wall", "x": 0, "y": 0, "rotation": 0, "w": 0, "h": 1}], "between 1 and 20"),
        ([{"type": "wall", "x": 0, "y": 0, "rotation": 0, "w": "3", "h": 1}], "must be integers"),
    ]
    for elements, fragment in cases:
        r = _save(client, admin_token, plan["id"], elements)
        assert r.status_code == 400, elements
        assert any(fragment in m for m in r.get_json()["fields"]["elements"]), (fragment, r.get_json())
    # Seats may still send their (fixed) size back unchanged.
    assert _save(client, admin_token, plan["id"],
                 [{"type": "seat", "x": 0, "y": 0, "rotation": 0, "w": 1, "h": 1}]).status_code == 200


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
               [{"type": "table", "x": 1, "y": 3, "rotation": 90}])
    assert ok.status_code == 200
    bad = _save(client, admin_token, plan["id"],
                [{"type": "table", "x": 1, "y": 4, "rotation": 90}])
    assert bad.status_code == 400


def test_type_config_defaults_and_roundtrip(client, db, admin_token):
    # No catalog type has settings since "Allow booking" became seat department tags; give seats a
    # test-only setting to keep the per-type settings mechanism covered.
    run_write("""update floor_elements set config = '{"quiet": false}' where type = 'seat'""")
    try:
        plan = _mk_plan(client, admin_token)
        r = _save(client, admin_token, plan["id"], [
            {"type": "seat", "x": 0, "y": 0, "rotation": 0},
            {"type": "seat", "x": 2, "y": 0, "rotation": 0, "config": {"quiet": True}},
            {"type": "wall", "x": 4, "y": 0, "rotation": 0},
        ])
        assert r.status_code == 200
        els = client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).get_json()["elements"]
        assert {e["x"]: e["config"] for e in els} == {0: {"quiet": False}, 2: {"quiet": True}, 4: {}}
        bad = _save(client, admin_token, plan["id"],
                    [{"type": "seat", "x": 0, "y": 0, "rotation": 0, "config": {"quiet": "yes"}}])
        assert bad.status_code == 400 and any("must be bool" in m for m in bad.get_json()["fields"]["elements"])
    finally:
        run_write("update floor_elements set config = '{}' where type = 'seat'")


def test_save_rejects_bad_elements(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    cases = [
        ([{"type": "desk", "x": 0, "y": 0, "rotation": 0}], "unknown type"),
        ([{"type": "seat", "x": 10, "y": 0, "rotation": 0}], "outside"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 45}], "rotation"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0, "color": "red"}], "#rrggbb"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0, "config": {"bookable": True}}], "not supported"),
        ([{"type": "wall", "x": 0, "y": 0, "rotation": 0, "config": {"bookable": True}}], "not supported"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0, "config": []}], "must be an object"),
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


def test_save_keeps_element_ids(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    first = _save(client, admin_token, plan["id"], [
        {"type": "seat", "x": 0, "y": 0, "rotation": 0},
        {"type": "seat", "x": 2, "y": 0, "rotation": 0}]).get_json()["elements"]
    by_x = {e["x"]: e for e in first}
    a, b = by_x[0], by_x[2]
    moved = {**a, "x": 5, "y": 5}
    second = _save(client, admin_token, plan["id"], [
        moved, b, {"id": "local-1", "type": "wall", "x": 9, "y": 9, "rotation": 0}]).get_json()["elements"]
    ids = {e["type"] + str(e["x"]): e["id"] for e in second}
    assert ids["seat5"] == a["id"] and ids["seat2"] == b["id"]
    assert ids["wall9"] not in (a["id"], b["id"]) and len(ids["wall9"]) == 36
    third = _save(client, admin_token, plan["id"], [{**moved}]).get_json()["elements"]
    assert [e["id"] for e in third] == [a["id"]]


def test_save_rejects_foreign_and_duplicate_ids(client, db, admin_token):
    plan_a, plan_b = _mk_plan(client, admin_token), _mk_plan(client, admin_token)
    a_el = _save(client, admin_token, plan_a["id"],
                 [{"type": "seat", "x": 0, "y": 0, "rotation": 0}]).get_json()["elements"][0]
    b_el = _save(client, admin_token, plan_b["id"],
                 [{"type": "seat", "x": 0, "y": 0, "rotation": 0}]).get_json()["elements"][0]
    r = _save(client, admin_token, plan_b["id"], [{**a_el, "x": 3}])
    assert r.status_code == 400
    assert any("unknown element id" in m for m in r.get_json()["fields"]["elements"])
    r = _save(client, admin_token, plan_b["id"], [b_el, {**b_el, "x": 4}])
    assert r.status_code == 400
    assert any("duplicate element id" in m for m in r.get_json()["fields"]["elements"])
    a_now = client.get(f"/api/admin/floor-plans/{plan_a['id']}", headers=hdr(admin_token)).get_json()
    assert [(e["id"], e["x"]) for e in a_now["elements"]] == [(a_el["id"], 0)]


def test_save_and_patch_set_draft_changed_at(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    q = "select draft_changed_at from floor_plans where id = cast(:p as uuid)"
    _save(client, admin_token, plan["id"], [{"type": "seat", "x": 0, "y": 0, "rotation": 0}])
    after_save = run_one(q, {"p": plan["id"]})["draft_changed_at"]
    assert after_save is not None
    client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token), json={"name": "Renamed"})
    assert run_one(q, {"p": plan["id"]})["draft_changed_at"] > after_save
