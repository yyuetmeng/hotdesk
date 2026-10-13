from app.core.db import run_one


def _app_ctx(app):
    return app.app_context()


def test_creates_new_admin(app, db):
    from scripts.create_admin import ensure_admin

    with _app_ctx(app):
        assert ensure_admin("sa@x.com", "sa", "Super Admin", "sp-password1") == "created"
    row = run_one("select r.name as role, u.is_active, u.password_hash is not null as pw "
                  "from users u join roles r on r.id = u.role_id where u.email = 'sa@x.com'")
    assert row["role"] == "admin" and row["is_active"] and row["pw"]
    assert run_one("select action from audit_logs where action = 'user.create'")


def test_upsert_unlocks_and_repromotes(app, db):
    from app.core.db import run_write
    from scripts.create_admin import ensure_admin

    with _app_ctx(app):
        ensure_admin("sa@x.com", "sa", "Super Admin", "sp-password1")
        uid = run_one("select id from users where email = 'sa@x.com'")["id"]
        run_write("update users set is_active = false, failed_attempts = 5, role_id = 1 "
                  "where id = :i", {"i": uid})
        assert ensure_admin("sa@x.com", "sa2", "SA", "sp-password2") == "updated"
    row = run_one("select r.name as role, u.is_active, u.failed_attempts "
                  "from users u join roles r on r.id = u.role_id where u.email = 'sa@x.com'")
    assert row["role"] == "admin" and row["is_active"] and row["failed_attempts"] == 0
    assert run_one("select id from users where email = 'sa@x.com'")
