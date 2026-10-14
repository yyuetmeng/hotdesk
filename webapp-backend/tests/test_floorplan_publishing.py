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


def _url(pid, suffix=""):
    return f"/api/admin/floor-plans/{pid}{suffix}"


def _mk_plan(client, tok, name="Floor", cols=10, rows=10):
    return client.post("/api/admin/floor-plans", headers=hdr(tok),
                       json={"name": name, "cols": cols, "rows": rows}).get_json()


def _save(client, tok, pid, elements):
    return client.put(_url(pid, "/elements"), headers=hdr(tok), json={"elements": elements})


def _seats(*cells):
    return [{"type": "seat", "x": x, "y": y, "rotation": 0} for x, y in cells]


def _publish(client, tok, pid):
    return client.post(_url(pid, "/publish"), headers=hdr(tok))


def test_new_plan_is_draft(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    got = client.get(_url(plan["id"]), headers=hdr(admin_token)).get_json()
    assert got["status"] == "draft" and got["published_version"] is None and got["published_at"] is None
    listed = client.get("/api/admin/floor-plans", headers=hdr(admin_token)).get_json()["items"][0]
    assert listed["status"] == "draft" and listed["published_version"] is None


def test_publish_creates_version_with_same_ids(client, db, admin_token):
    plan = _mk_plan(client, admin_token, name="Level 1")
    ids = sorted(e["id"] for e in _save(client, admin_token, plan["id"],
                                         _seats((0, 0), (2, 0), (4, 0))).get_json()["elements"])
    r = _publish(client, admin_token, plan["id"])
    assert r.status_code == 200
    body = r.get_json()
    assert body["status"] == "published" and body["published_version"] == 1
    assert body["published_by"] == "Root" and body["published_at"]
    pub = client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).get_json()
    assert pub["version"] == 1 and (pub["name"], pub["cols"], pub["rows"]) == ("Level 1", 10, 10)
    assert sorted(e["id"] for e in pub["elements"]) == ids
    audit = run_one("select details from audit_logs where action = 'floorplan.publish'")
    assert audit["details"] == {"version": 1, "element_count": 3}


def test_edit_after_publish_is_changed_and_published_unchanged(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    els = _save(client, admin_token, plan["id"], _seats((0, 0))).get_json()["elements"]
    _publish(client, admin_token, plan["id"])
    saved = _save(client, admin_token, plan["id"], [{**els[0], "x": 7}]).get_json()
    assert saved["status"] == "changed"
    pub = client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).get_json()
    assert [(e["id"], e["x"]) for e in pub["elements"]] == [(els[0]["id"], 0)]


def test_republish_keeps_ids_and_history(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    els = _save(client, admin_token, plan["id"], _seats((0, 0), (2, 0), (4, 0))).get_json()["elements"]
    by_x = {e["x"]: e for e in els}
    _publish(client, admin_token, plan["id"])
    _save(client, admin_token, plan["id"], [by_x[0], {**by_x[2], "y": 5}])  # delete x=4, move x=2
    r = _publish(client, admin_token, plan["id"])
    assert r.status_code == 200 and r.get_json()["published_version"] == 2
    pub = client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).get_json()
    assert {e["id"]: (e["x"], e["y"]) for e in pub["elements"]} == {
        by_x[0]["id"]: (0, 0), by_x[2]["id"]: (2, 5)}
    v1 = run_one("select count(*) as n from floor_plan_version_elements ve "
                 "join floor_plan_versions v on v.id = ve.version_id where v.version = 1")
    assert v1["n"] == 3


def test_publish_rejections(client, db, admin_token, user_token):
    plan = _mk_plan(client, admin_token)
    assert client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).status_code == 404
    _save(client, admin_token, plan["id"], _seats((0, 0)))
    assert _publish(client, admin_token, plan["id"]).status_code == 200
    assert _publish(client, admin_token, plan["id"]).status_code == 409
    run_write("insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation) "
              "values (cast(:p as uuid), 'seat', 0, 0, 1, 1, 0)", {"p": plan["id"]})
    run_write("update floor_plans set draft_changed_at = now() where id = cast(:p as uuid)", {"p": plan["id"]})
    bad = _publish(client, admin_token, plan["id"])
    assert bad.status_code == 400 and any("overlaps" in m for m in bad.get_json()["fields"]["elements"])
    assert _publish(client, user_token, plan["id"]).status_code == 403
