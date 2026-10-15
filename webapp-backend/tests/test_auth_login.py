import datetime as dt

from app.core.db import run_one, run_write
from app.core.security import hash_password

PW = "secret123"


def mk_user(db, email="u@x.com", username="ux", password=PW, role="user", **cols):
    cols.setdefault("password_hash", hash_password(password) if password else None)
    cols["email"], cols["username"] = email, username
    cols["full_name"] = "U X"
    cols["role_id"] = 2 if role == "admin" else 1
    names = ", ".join(cols)
    binds = ", ".join(f":{k}" for k in cols)
    return run_one(f"insert into users ({names}) values ({binds}) returning id", cols)["id"]


def login(client, identifier, password=PW):
    return client.post("/api/auth/login",
                       json={"email_or_username": identifier, "password": password})


def test_login_success_by_email_or_username(client, db):
    mk_user(db, email="a@x.com", username="aa")
    r = login(client, "a@x.com")
    assert r.status_code == 200
    body = r.get_json()
    assert body["token"]
    assert body["user"]["email"] == "a@x.com"
    assert "password_hash" not in body["user"]
    assert login(client, "aa").status_code == 200


def test_login_wrong_password_401_and_audit(client, db):
    mk_user(db, email="b@x.com", username="bb")
    r = login(client, "b@x.com", "nope")
    assert r.status_code == 401
    assert r.get_json() == {"error": "invalid credentials"}
    row = run_one("select action from audit_logs where action = 'auth.login_failed'")
    assert row


def test_login_unknown_user_generic_401(client, db):
    assert login(client, "ghost@x.com").get_json() == {"error": "invalid credentials"}


def test_login_inactive_403(client, db):
    mk_user(db, email="c@x.com", username="cc", is_active=False)
    r = login(client, "c@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account disabled"}


def test_login_pending_activation_403(client, db):
    mk_user(db, email="d@x.com", username="dd", password=None)
    r = login(client, "d@x.com")
    assert r.status_code == 403
    assert "password not set" in r.get_json()["error"]


def test_login_before_start_or_after_end(client, db):
    mk_user(db, email="e@x.com", username="ee",
            start_date=dt.date.today() + dt.timedelta(days=1))
    r = login(client, "e@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account not yet active"}
    run_write("update users set start_date = null, end_date = :d where email = 'e@x.com'",
              {"d": dt.date.today() - dt.timedelta(days=1)})
    r = login(client, "e@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account expired"}


def test_five_failures_lock_and_success_resets(client, db):
    uid = mk_user(db, email="f@x.com", username="ff")
    for _ in range(4):
        login(client, "f@x.com", "nope")
    assert run_one("select failed_attempts from users where id = :i", {"i": uid})["failed_attempts"] == 4
    r = login(client, "f@x.com", "nope")
    assert r.status_code == 401
    assert run_one("select is_active from users where id = :i", {"i": uid})["is_active"] is False
    r = login(client, "f@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account disabled"}
    row = run_one("select action from audit_logs where action = 'account.locked'")
    assert row
    run_write("update users set is_active = true, failed_attempts = 0 where id = :i", {"i": uid})
    assert login(client, "f@x.com").status_code == 200


def test_login_wrong_password_on_locked_account_does_not_500(client, db):
    uid = mk_user(db, email="fl@x.com", username="flk")
    run_write("update users set is_active = false, failed_attempts = 5 where id = :i", {"i": uid})
    r = login(client, "fl@x.com", "nope")
    assert r.status_code == 401
    assert run_one("select failed_attempts from users where id = :i", {"i": uid})["failed_attempts"] == 5


def test_me_returns_current_user(client, db):
    mk_user(db, email="g@x.com", username="gg", role="admin")
    tok = login(client, "g@x.com").get_json()["token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.get_json()["email"] == "g@x.com"


def test_me_requires_auth(client, db):
    assert client.get("/api/auth/me").status_code == 401


def _lifetime(token):
    import jwt
    claims = jwt.decode(token, options={"verify_signature": False})
    return claims["exp"] - claims["iat"]


def test_keep_me_signed_in_gives_a_five_day_token(client, db):
    mk_user(db)
    normal = login(client, "ux").get_json()["token"]
    kept = client.post("/api/auth/login", json={"email_or_username": "ux", "password": PW, "remember": True}).get_json()
    assert _lifetime(normal) == client.application.config["JWT_ACCESS_TOKEN_EXPIRES"]
    assert _lifetime(kept["token"]) == 5 * 24 * 3600
    assert kept["remember"] is True
