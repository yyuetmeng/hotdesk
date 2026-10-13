from sqlalchemy import text

from app.core.audit import write_audit
from app.core.db import run_one, run_write
from app.core.security import hash_password, verify_password


def test_run_one_and_run_write(app, db):
    uid = run_one(
        "insert into users (email, username, full_name, role_id) "
        "values ('x@y.com', 'xy', 'X Y', 1) returning id")["id"]
    row = run_one("select email from users where id = :i", {"i": uid})
    assert row["email"] == "x@y.com"
    n = run_write("update users set full_name = 'Z' where id = :i", {"i": uid})
    assert n == 1


def test_bcrypt_roundtrip():
    h = hash_password("secret123")
    assert h != "secret123"
    assert verify_password("secret123", h)
    assert not verify_password("wrong", h)


def test_write_audit_row(db):
    uid = run_one(
        "insert into users (email, username, full_name, role_id) "
        "values ('a2@b.com', 'a2', 'A', 1) returning id")["id"]
    write_audit(str(uid), "user.create", str(uid), {"role": "user"})
    with db.connect() as conn:
        row = conn.execute(text("select actor_id, action, details from audit_logs")).mappings().one()
    assert row["action"] == "user.create"
    assert row["details"] == {"role": "user"}


def test_admin_required_guard(app, client, db):
    from flask import jsonify

    @app.route("/api/_t/admin-only")
    def _t_admin():
        from app.core.security import admin_required

        @admin_required
        def view():
            return jsonify(ok=True)

        return view()

    assert client.get("/api/_t/admin-only").status_code == 401

    from flask_jwt_extended import create_access_token

    tok = create_access_token(identity="u-1", additional_claims={"role": "user", "email": "a@b.com"})
    r = client.get("/api/_t/admin-only", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
    assert r.get_json() == {"error": "admin required"}

    tok = create_access_token(identity="u-2", additional_claims={"role": "admin", "email": "a@b.com"})
    r = client.get("/api/_t/admin-only", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
