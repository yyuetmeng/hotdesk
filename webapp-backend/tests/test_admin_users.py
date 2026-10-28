import pytest

from app.core.db import run_one, run_write
from creds import SECRET, hashed, new_secret, secret_body, sign_in, too_short


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
            {"p": hashed(SECRET)})
    r = sign_in(client, "root@x.com")
    return r.get_json()["token"]


@pytest.fixture()
def user_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('plain@x.com', 'plain', 'Plain', 1, :p) returning id",
            {"p": hashed(SECRET)})
    r = sign_in(client, "plain@x.com")
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


def test_list_page_size_all_returns_everyone(client, db, admin_token):
    for i in range(3):
        _mk_plain(client, admin_token, f"all{i}@x.com", f"all{i}")
    r = client.get("/api/admin/users", headers=hdr(admin_token), query_string={"page": 3, "page_size": "all"})
    body = r.get_json()
    assert r.status_code == 200 and body["total"] == 4 and len(body["items"]) == 4
    assert body["page"] == 1 and body["page_size"] == "all"
    assert client.get("/api/admin/users", headers=hdr(admin_token),
                      query_string={"page_size": "lots"}).status_code == 400


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


def _mk_plain(client, admin_token, email, username, role="user"):
    return client.post("/api/admin/users", headers=hdr(admin_token),
                       json={"email": email, "username": username,
                             "full_name": "P Q", "role": role}).get_json()


def test_patch_fields_and_departments(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "p1@x.com", "p1")["id"]
    d1 = run_one("insert into departments (name) values ('D1') returning id::text as id")["id"]
    r = client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token),
                     json={"full_name": "Renamed", "email": "p1new@x.com",
                           "is_active": False, "department_ids": [d1],
                           "start_date": "2026-01-01", "end_date": "2026-12-31"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["email"] == "p1new@x.com" and body["is_active"] is False
    assert body["full_name"] == "Renamed" and body["departments"][0]["id"] == d1
    assert run_one("select action from audit_logs where action = 'user.update'")
    assert run_one("select action from audit_logs where action = 'user.disable'")


def test_patch_duplicate_email_409(client, db, admin_token):
    _mk_plain(client, admin_token, "q1@x.com", "q1")
    uid2 = _mk_plain(client, admin_token, "q2@x.com", "q2")["id"]
    r = client.patch(f"/api/admin/users/{uid2}", headers=hdr(admin_token),
                     json={"email": "q1@X.com"})
    assert r.status_code == 409


def test_patch_invalid_role_or_date_400(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "r1@x.com", "r1")["id"]
    r = client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token), json={"role": "king"})
    assert r.status_code == 400 and "role" in r.get_json()["fields"]
    r = client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token),
                     json={"start_date": "2026-05-05", "end_date": "2026-01-01"})
    assert r.status_code == 400


def test_patch_unlock_clears_failed_attempts(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "lk@x.com", "lk")["id"]
    run_write("update users set failed_attempts = 3, is_active = false where id = :i", {"i": uid})
    client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token), json={"is_active": True})
    row = run_one("select failed_attempts, is_active from users where id = :i", {"i": uid})
    assert row["failed_attempts"] == 0 and row["is_active"] is True
    assert run_one("select action from audit_logs where action = 'user.enable'")


def test_self_safeguards_409(client, db, admin_token):
    me = run_one("select id::text as id from users where username = 'root'")["id"]
    for body in ({"is_active": False}, {"role": "user"}):
        r = client.patch(f"/api/admin/users/{me}", headers=hdr(admin_token), json=body)
        assert r.status_code == 409, body
    assert client.delete(f"/api/admin/users/{me}", headers=hdr(admin_token)).status_code == 409


def test_last_active_admin_safeguard_409(client, db, admin_token):
    other = _mk_plain(client, admin_token, "ad2@x.com", "ad2", role="admin")["id"]
    assert client.patch(f"/api/admin/users/{other}", headers=hdr(admin_token),
                        json={"is_active": False}).status_code == 200
    client.patch(f"/api/admin/users/{other}", headers=hdr(admin_token),
                 json={"is_active": True})
    me = run_one("select id::text as id from users where username = 'root'")["id"]
    run_write("update users set is_active = false where id = :i", {"i": me})
    assert client.delete(f"/api/admin/users/{other}", headers=hdr(admin_token)).status_code == 409


def test_delete_removes_user_and_membership(client, db, admin_token):
    d1 = run_one("insert into departments (name) values ('Z') returning id::text as id")["id"]
    uid = client.post("/api/admin/users", headers=hdr(admin_token),
                      json={"email": "dl@x.com", "username": "dl", "full_name": "DL",
                            "role": "user", "department_ids": [d1]}).get_json()["id"]
    assert client.delete(f"/api/admin/users/{uid}", headers=hdr(admin_token)).status_code == 204
    assert run_one("select 1 from users where id = :i", {"i": uid}) is None
    assert run_one("select action from audit_logs where action = 'user.delete'")


def test_bulk_delete_removes_each_and_audits_each(client, db, admin_token):
    a = _mk_plain(client, admin_token, "b1@x.com", "b1")["id"]
    b = _mk_plain(client, admin_token, "b2@x.com", "b2", role="admin")["id"]
    r = client.post("/api/admin/users/bulk-delete", headers=hdr(admin_token), json={"ids": [a, b]})
    assert r.status_code == 200
    assert sorted(r.get_json()["deleted"]) == sorted([a, b]) and r.get_json()["skipped"] == []
    assert run_one("select count(*) as n from users where id in (:a, :b)", {"a": a, "b": b})["n"] == 0
    assert run_one("select count(*) as n from audit_logs where action = 'user.delete'")["n"] == 2


def test_bulk_delete_skips_self_and_unknown(client, db, admin_token):
    me = run_one("select id::text as id from users where username = 'root'")["id"]
    a = _mk_plain(client, admin_token, "b3@x.com", "b3")["id"]
    ghost = "00000000-0000-0000-0000-000000000001"
    r = client.post("/api/admin/users/bulk-delete", headers=hdr(admin_token), json={"ids": [me, a, ghost]})
    assert r.status_code == 200
    body = r.get_json()
    assert body["deleted"] == [a]
    assert {s["id"]: s["reason"] for s in body["skipped"]} == {
        me: "you cannot delete your own account", ghost: "user not found"}
    assert run_one("select 1 from users where id = :i", {"i": me})


def test_bulk_delete_keeps_the_last_active_admin(client, db, admin_token):
    other = _mk_plain(client, admin_token, "b4@x.com", "b4", role="admin")["id"]
    me = run_one("select id::text as id from users where username = 'root'")["id"]
    run_write("update users set is_active = false where id = :i", {"i": me})
    r = client.post("/api/admin/users/bulk-delete", headers=hdr(admin_token), json={"ids": [other]})
    assert r.get_json() == {"deleted": [], "skipped": [{"id": other, "reason": "cannot remove the last active admin"}]}


@pytest.mark.parametrize("body", [{}, {"ids": []}, {"ids": "x"}, {"ids": ["not-a-uuid"]}])
def test_bulk_delete_rejects_bad_ids_400(client, db, admin_token, body):
    assert client.post("/api/admin/users/bulk-delete", headers=hdr(admin_token), json=body).status_code == 400


def test_bulk_delete_forbidden_for_plain_user(client, db, user_token):
    r = client.post("/api/admin/users/bulk-delete", headers=hdr(user_token), json={"ids": []})
    assert r.status_code == 403


def test_create_survives_email_failure(client, db, admin_token, monkeypatch):
    def fail(to, subject, html):
        raise RuntimeError("email send failed")
    monkeypatch.setattr("app.admin.users.send_email", fail)
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "nomail@x.com", "username": "nomail", "full_name": "No Mail",
                          "role": "user"})
    assert r.status_code == 201
    body = r.get_json()
    assert body["invitation_sent"] is False and body["status"] == "pending_activation"
    assert run_one("select 1 from users where email = 'nomail@x.com'")
    resend = client.post(f"/api/admin/users/{body['id']}/resend-invitation", headers=hdr(admin_token))
    assert resend.status_code == 502


def test_email_change_on_pending_resends_invitation(client, db, admin_token, stub_email):
    uid = _mk_plain(client, admin_token, "pc@x.com", "pc")["id"]
    assert len(stub_email) == 1
    client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token),
                 json={"email": "pcnew@x.com"})
    assert stub_email[-1][0] == "pcnew@x.com"


def test_admin_sets_a_secret_and_user_can_login(client, db, admin_token):
    chosen = new_secret()
    uid = _mk_plain(client, admin_token, "ps@x.com", "ps")["id"]
    r = client.post(f"/api/admin/users/{uid}/password", headers=hdr(admin_token),
                    json=secret_body(chosen))
    assert r.status_code == 204
    assert sign_in(client, "ps@x.com", chosen).status_code == 200
    assert run_one("select action from audit_logs where action = 'user.password_reset'")


def test_admin_short_secret_rejected_400(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "ps2@x.com", "ps2")["id"]
    r = client.post(f"/api/admin/users/{uid}/password", headers=hdr(admin_token),
                    json=secret_body(too_short()))
    assert r.status_code == 400 and "password" in r.get_json()["fields"]


def test_admin_new_secret_invalidates_tokens_and_unlocks(client, db, admin_token):
    from app.auth.tokens import issue_token, validate_token
    uid = _mk_plain(client, admin_token, "ps3@x.com", "ps3")["id"]
    raw = issue_token(uid, "reset", 1)
    client.post(f"/api/admin/users/{uid}/password", headers=hdr(admin_token),
                json=secret_body(new_secret()))
    assert validate_token(raw, "reset") is None


def test_resend_invitation_only_pending(client, db, admin_token, stub_email):
    uid = _mk_plain(client, admin_token, "ri@x.com", "ri")["id"]
    assert len(stub_email) == 1
    r = client.post(f"/api/admin/users/{uid}/resend-invitation", headers=hdr(admin_token))
    assert r.status_code == 204
    assert len(stub_email) == 2 and stub_email[-1][0] == "ri@x.com"
    run_write("update users set password_hash = :p where id = :i",
              {"p": hashed(new_secret()), "i": uid})
    assert client.post(f"/api/admin/users/{uid}/resend-invitation",
                       headers=hdr(admin_token)).status_code == 409


def test_booking_allowance_field(client, db, admin_token):
    user = _mk_plain(client, admin_token, "al@x.com", "allow")
    assert user["booking_allowance"] == 0
    r = client.patch(f"/api/admin/users/{user['id']}", headers=hdr(admin_token), json={"booking_allowance": 5})
    assert r.status_code == 200 and r.get_json()["booking_allowance"] == 5
    for bad in (21, -1, "x", True):
        r = client.patch(f"/api/admin/users/{user['id']}", headers=hdr(admin_token), json={"booking_allowance": bad})
        assert r.status_code == 400 and "booking_allowance" in r.get_json()["fields"], bad
