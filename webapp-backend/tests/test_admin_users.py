import pytest

from app.core.db import run_one
from app.core.security import hash_password

ADMIN_PW = "adminpw1"
USER_PW = "userpw12"


@pytest.fixture(autouse=True)
def stub_email(monkeypatch):
    calls = []
    monkeypatch.setattr("app.admin.users.send_email",
                        lambda to, subject, html: calls.append((to, subject, html)))
    return calls


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id",
            {"p": hash_password(ADMIN_PW)})
    r = client.post("/api/auth/login",
                    json={"email_or_username": "root@x.com", "password": ADMIN_PW})
    return r.get_json()["token"]


@pytest.fixture()
def user_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('plain@x.com', 'plain', 'Plain', 1, :p) returning id",
            {"p": hash_password(USER_PW)})
    r = client.post("/api/auth/login",
                    json={"email_or_username": "plain@x.com", "password": USER_PW})
    return r.get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_non_admin_forbidden_403(client, db, user_token):
    assert client.get("/api/admin/users", headers=hdr(user_token)).status_code == 403


def test_no_token_401(client, db):
    assert client.get("/api/admin/users").status_code == 401


def test_create_invites_and_persists(client, db, admin_token, stub_email):
    did = run_one("insert into departments (name) values ('Ops') returning id::text as id")["id"]
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "new@x.com", "username": "newbie", "full_name": "New Bie",
                          "role": "user", "department_ids": [did]})
    assert r.status_code == 201
    body = r.get_json()
    assert body["status"] == "pending_activation"
    assert body["departments"][0]["name"] == "Ops"
    assert "password_hash" not in body
    row = run_one("select password_hash, role_id from users where email = 'new@x.com'")
    assert row["password_hash"] is None and row["role_id"] == 1
    assert stub_email and stub_email[0][0] == "new@x.com"
    for action in ("user.create", "user.invitation_sent"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_create_duplicate_email_409(client, db, admin_token):
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "dup@x.com", "username": "d1", "full_name": "D", "role": "user"})
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "DUP@X.COM", "username": "d2", "full_name": "D", "role": "user"})
    assert r.status_code == 409


def test_create_validation_errors(client, db, admin_token):
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "bad", "username": "x", "full_name": "", "role": "boss"})
    assert r.status_code == 400
    fields = r.get_json()["fields"]
    assert "email" in fields and "username" in fields and "full_name" in fields and "role" in fields


def test_create_bad_date_range_400(client, db, admin_token):
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "dr@x.com", "username": "dr1", "full_name": "D",
                          "role": "user", "start_date": "2026-06-01", "end_date": "2026-05-01"})
    assert r.status_code == 400 and "end_date" in r.get_json()["fields"]


def test_list_filters_and_pagination(client, db, admin_token):
    for i in range(3):
        client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": f"n{i}@x.com", "username": f"n{i}", "full_name": "Alice",
                          "role": "user"})
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "adm2@x.com", "username": "adm2", "full_name": "Bob", "role": "admin"})
    r = client.get("/api/admin/users", headers=hdr(admin_token), query_string={"q": "alice"})
    assert r.get_json()["total"] == 3
    r = client.get("/api/admin/users", headers=hdr(admin_token), query_string={"role": "admin"})
    emails = {u["email"] for u in r.get_json()["items"]}
    assert emails == {"root@x.com", "adm2@x.com"}
    r = client.get("/api/admin/users", headers=hdr(admin_token),
                   query_string={"page": 2, "page_size": 2})
    assert len(r.get_json()["items"]) == 2


def test_get_one_and_404(client, db, admin_token):
    uid = client.post("/api/admin/users", headers=hdr(admin_token),
                      json={"email": "g@x.com", "username": "g1", "full_name": "G",
                            "role": "user"}).get_json()["id"]
    assert client.get(f"/api/admin/users/{uid}", headers=hdr(admin_token)).status_code == 200
    assert client.get("/api/admin/users/" + "0" * 36, headers=hdr(admin_token)).status_code == 404


def test_department_filter(client, db, admin_token):
    did = run_one("insert into departments (name) values ('Tagged') returning id::text as id")["id"]
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "t1@x.com", "username": "t1", "full_name": "T",
                      "role": "user", "department_ids": [did]})
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "t2@x.com", "username": "t2", "full_name": "T", "role": "user"})
    r = client.get("/api/admin/users", headers=hdr(admin_token),
                   query_string={"department": "tagged"})
    assert [u["email"] for u in r.get_json()["items"]] == ["t1@x.com"]
