import re

import pytest

from app.auth.tokens import validate_token
from app.core.db import run_one
from app.core.security import hash_password
from app.core.users import public_user  # noqa: F401 (ensures module importable)

PW = "secret123"


@pytest.fixture(autouse=True)
def stub_email(monkeypatch):
    calls = []
    monkeypatch.setattr("app.auth.routes.send_email",
                        lambda to, subject, html: calls.append((to, subject, html)))
    return calls


def _mk(db, email, username, password=PW, **cols):
    cols.setdefault("password_hash", hash_password(password) if password else None)
    return run_one(
        "insert into users (email, username, full_name, role_id, password_hash) "
        "values (:e, :u, 'U', 1, :p) returning id",
        {"e": email, "u": username, "p": cols["password_hash"]})["id"]


def _extract_token(mail_calls):
    return re.search(r"token=([\w\-]+)", mail_calls[-1][2]).group(1)


def test_forgot_password_known_user_emails(client, db, stub_email):
    _mk(db, "fp@x.com", "fp1")
    r = client.post("/api/auth/forgot-password", json={"email": "fp@x.com"})
    assert r.status_code == 204
    assert stub_email and stub_email[0][0] == "fp@x.com"
    assert run_one("select action from audit_logs where action = 'password_reset.requested'")


def test_forgot_password_unknown_still_204(client, db, stub_email):
    assert client.post("/api/auth/forgot-password", json={"email": "no@x.com"}).status_code == 204
    assert not stub_email


def test_reset_flow_invalidates_old_tokens(client, db, stub_email):
    _mk(db, "rs@x.com", "rs1")
    client.post("/api/auth/forgot-password", json={"email": "rs@x.com"})
    t1 = _extract_token(stub_email)
    client.post("/api/auth/forgot-password", json={"email": "rs@x.com"})
    t2 = _extract_token(stub_email)
    assert validate_token(t1, "reset") is None
    assert client.get(f"/api/auth/set-password/verify?token={t2}&purpose=reset").get_json() == {"valid": True}
    r = client.post("/api/auth/set-password", json={"token": t2, "password": "brandnew1"})
    assert r.status_code == 204
    assert client.post("/api/auth/set-password", json={"token": t2, "password": "x12345678"}).status_code == 400
    assert client.post("/api/auth/login", json={"email_or_username": "rs@x.com", "password": "brandnew1"}).status_code == 200
    assert run_one("select action from audit_logs where action = 'password_reset.completed'")


def test_activate_flow(client, db, stub_email):
    uid = _mk(db, "ac@x.com", "ac1", password=None)
    client.post("/api/auth/login", json={"email_or_username": "ac@x.com", "password": "whatever"})
    from app.auth.tokens import issue_token
    raw = issue_token(uid, "activate", 72)
    assert client.get(f"/api/auth/set-password/verify?token={raw}&purpose=activate").get_json() == {"valid": True}
    r = client.post("/api/auth/set-password", json={"token": raw, "password": "firstpw1"})
    assert r.status_code == 204
    assert run_one("select action from audit_logs where action = 'account.activated'")
    assert client.post("/api/auth/login", json={"email_or_username": "ac@x.com", "password": "firstpw1"}).status_code == 200


def test_set_password_rejects_short_and_invalid(client, db, stub_email):
    assert client.post("/api/auth/set-password", json={"token": "nope", "password": "abcdefgh"}).status_code == 400
    uid = _mk(db, "sh@x.com", "sh1", password=None)
    from app.auth.tokens import issue_token
    raw = issue_token(uid, "activate", 72)
    r = client.post("/api/auth/set-password", json={"token": raw, "password": "short"})
    assert r.status_code == 400
    assert "password" in r.get_json().get("fields", {})
