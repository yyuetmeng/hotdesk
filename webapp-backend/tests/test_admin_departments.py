import pytest
from sqlalchemy import text

from app.core.db import run_one
from creds import SECRET, hashed, sign_in



@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id",
            {"p": hashed(SECRET)})
    r = sign_in(client, "root@x.com")
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


def test_colour_set_listed_and_cleared(client, db, admin_token):
    dept = client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "G&C"}).get_json()
    assert dept["color"] is None                                                   # automatic until chosen
    r = client.patch(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token), json={"color": "#1D4ED8"})
    assert r.status_code == 200 and r.get_json()["color"] == "#1D4ED8"
    listed = client.get("/api/admin/departments", headers=hdr(admin_token)).get_json()["items"]
    assert [d["color"] for d in listed] == ["#1D4ED8"]
    r = client.patch(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token), json={"color": None})
    assert r.status_code == 200 and r.get_json()["color"] is None
    created = client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "STREAM", "color": "#0d9488"})
    assert created.status_code == 201 and created.get_json()["color"] == "#0d9488"


@pytest.mark.parametrize("value", ["red", "#12345", "#1234567", "1d4ed8", 7, ""])
def test_bad_colour_400(client, db, admin_token, value):
    dept = client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "Ops"}).get_json()
    r = client.patch(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token), json={"color": value})
    assert r.status_code == 400 and r.get_json()["fields"] == {"color": "colour must be #rrggbb"}
    r = client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "Ops2", "color": value})
    assert r.status_code == 400


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
