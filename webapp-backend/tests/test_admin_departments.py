import pytest
from sqlalchemy import text

from app.core.db import run_one
from app.core.security import hash_password

ADMIN_PW = "adminpw1"


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id",
            {"p": hash_password(ADMIN_PW)})
    r = client.post("/api/auth/login",
                    json={"email_or_username": "root@x.com", "password": ADMIN_PW})
    return r.get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_create_list_update_delete(client, db, admin_token):
    r = client.post("/api/admin/departments", headers=hdr(admin_token),
                    json={"name": "Engineering", "description": "Eng"})
    assert r.status_code == 201
    dept = r.get_json()
    assert dept["name"] == "Engineering" and dept["user_count"] == 0
    r = client.patch(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token),
                     json={"description": "Changed"})
    assert r.status_code == 200 and r.get_json()["description"] == "Changed"
    r = client.delete(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token))
    assert r.status_code == 204
    for action in ("department.create", "department.update", "department.delete"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_duplicate_name_409(client, db, admin_token):
    client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "Ops"})
    r = client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "ops"})
    assert r.status_code == 409


def test_missing_name_400(client, db, admin_token):
    r = client.post("/api/admin/departments", headers=hdr(admin_token), json={})
    assert r.status_code == 400 and "name" in r.get_json()["fields"]


def test_user_count_reflects_memberships(client, db, admin_token):
    did = client.post("/api/admin/departments", headers=hdr(admin_token),
                      json={"name": "Cnt"}).get_json()["id"]
    with db.connect() as conn:
        uid = conn.execute(text("insert into users (email, username, full_name, role_id) "
                                "values ('m@x.com', 'mem1', 'M', 1) returning id")).scalar_one()
        conn.execute(text("insert into user_departments (user_id, department_id) values (:u, :d)"),
                     {"u": uid, "d": did})
    items = client.get("/api/admin/departments", headers=hdr(admin_token)).get_json()["items"]
    assert next(d for d in items if d["id"] == did)["user_count"] == 1


def test_delete_unknown_404(client, db, admin_token):
    assert client.delete("/api/admin/departments/" + "0" * 36,
                         headers=hdr(admin_token)).status_code == 404
