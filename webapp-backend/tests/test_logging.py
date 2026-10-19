import logging

from app.core.db import run_one
from creds import SECRET, WRONG, hashed, sign_in


def _mk(client, db, email):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values (:e, :u, 'U', 1, :p) returning id",
            {"e": email, "u": email.split("@")[0], "p": hashed(SECRET)})


def test_failed_login_logs_warning_without_secret(client, db, caplog):
    _mk(client, db, "logme@x.com")
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        sign_in(client, "logme@x.com", WRONG)
    msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("failed login" in m for m in msgs)
    joined = "\n".join(msgs)
    assert WRONG not in joined
    assert SECRET not in joined


def test_request_log_line(client, db, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/admin/users")
    msgs = [r.getMessage() for r in caplog.records]
    assert any("/api/admin/users 401" in m for m in msgs)


def test_health_requests_not_logged(client, db, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/health")
    assert not [r for r in caplog.records if r.name == "app.request"]
