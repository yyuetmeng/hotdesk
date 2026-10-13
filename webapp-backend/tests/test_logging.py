import logging

from app.core.db import run_one
from app.core.security import hash_password

PW = "secret123"


def _mk(client, db, email):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values (:e, :u, 'U', 1, :p) returning id",
            {"e": email, "u": email.split("@")[0], "p": hash_password(PW)})


def test_failed_login_logs_warning_without_secret(client, db, caplog):
    _mk(client, db, "logme@x.com")
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        client.post("/api/auth/login",
                    json={"email_or_username": "logme@x.com", "password": "wrong-pass-9"})
    msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("failed login" in m for m in msgs)
    joined = "\n".join(msgs)
    assert "wrong-pass-9" not in joined
    assert "secret123" not in joined


def test_request_log_line(client, db, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/admin/users")
    msgs = [r.getMessage() for r in caplog.records]
    assert any("/api/admin/users 401" in m for m in msgs)


def test_health_requests_not_logged(client, db, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/health")
    assert not [r for r in caplog.records if r.name == "app.request"]
