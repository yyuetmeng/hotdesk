import pytest

from app.core.db import run_one
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
    assert client.delete(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).status_code == 204
    assert client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).status_code == 404
    for action in ("floorplan.create", "floorplan.update", "floorplan.delete"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_get_unknown_plan_404(client, db, admin_token):
    assert client.get("/api/admin/floor-plans/" + "0" * 36,
                      headers=hdr(admin_token)).status_code == 404


def test_catalog(client, db, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    by_type = {i["type"]: i for i in items}
    assert by_type["seat"] == {"type": "seat", "label": "Seat", "w": 1, "h": 1, "color": "#16a34a"}
    assert set(by_type) == {"wall", "seat", "toilet", "elevator", "door",
                            "meeting_room", "kitchen", "plant", "corridor"}
