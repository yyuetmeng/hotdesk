import datetime as dt
import logging
from functools import wraps

from flask import g, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, verify_jwt_in_request

from app.core.audit import write_audit
from app.core.db import run_one, run_write
from app.core.errors import error
from app.core.security import verify_password
from app.core.users import fetch_user

from . import auth_bp

log = logging.getLogger("app.auth")
MAX_FAILED_ATTEMPTS = 5


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except Exception:
            return error("authentication required", 401)
        return fn(*args, **kwargs)

    return wrapper


def get_current_user_row():
    return fetch_user(get_jwt_identity())


def _identity(body: dict) -> str:
    return (body.get("email_or_username") or body.get("email") or body.get("username") or "").strip()


@auth_bp.post("/login")
def login():
    body = request.get_json(silent=True) or request.form.to_dict() or {}
    identity, password = _identity(body), body.get("password") or ""
    row = run_one(
        "select u.id::text as id, u.password_hash, u.is_active, u.start_date, u.end_date, "
        "u.failed_attempts, r.name as role, u.email "
        "from users u join roles r on r.id = u.role_id "
        "where u.email = :i or u.username = :i",
        {"i": identity},
    )
    if not row:
        write_audit(None, "auth.login_failed", None, {"identifier": identity})
        return error("invalid credentials", 401)
    if not row["password_hash"]:
        write_audit(None, "auth.login_failed", row["id"], {"identifier": identity})
        log.warning("login attempt for user with no password set: %s", identity)
        return error("password not set, check your email to activate your account", 403)
    if not verify_password(password, row["password_hash"]):
        attempts = min(row["failed_attempts"] + 1, MAX_FAILED_ATTEMPTS)
        run_write("update users set failed_attempts = :n, updated_at = now() where id = :id",
                  {"n": attempts, "id": row["id"]})
        if attempts >= MAX_FAILED_ATTEMPTS and row["is_active"]:
            run_write("update users set is_active = false, updated_at = now() where id = :id",
                      {"id": row["id"]})
            write_audit(row["id"], "account.locked", row["id"], {"failed_attempts": attempts})
            log.warning("account locked after %d failed attempts: %s", attempts, identity)
        write_audit(None, "auth.login_failed", row["id"], {"identifier": identity})
        log.warning("failed login for %s", identity)
        return error("invalid credentials", 401)

    if not row["is_active"]:
        return error("account disabled", 403)
    today = dt.date.today()
    if row["start_date"] and today < row["start_date"]:
        return error("account not yet active", 403)
    if row["end_date"] and today > row["end_date"]:
        return error("account expired", 403)
    if row["failed_attempts"]:
        run_write("update users set failed_attempts = 0, updated_at = now() where id = :id",
                  {"id": row["id"]})
    write_audit(row["id"], "auth.login_success", row["id"], {})
    token = create_access_token(identity=row["id"],
                                additional_claims={"role": row["role"], "email": row["email"]})
    g.jwt_uid = row["id"]
    return jsonify(token=token, user=fetch_user(row["id"]))


@auth_bp.get("/me")
@auth_required
def me():
    user = get_current_user_row()
    if user is None:
        return error("user not found", 401)
    return jsonify(user)
