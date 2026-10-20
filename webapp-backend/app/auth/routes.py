import datetime as dt
import logging
from functools import wraps

from flask import current_app, g, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, verify_jwt_in_request
from sqlalchemy import func

from app.core.audit import write_audit
from app.core.auth_models import User
from app.core.email import send_email
from app.core.errors import error
from app.core.orm import orm_session
from app.core.passwords import common_hashes, password_problem
from app.core.security import hash_password, verify_password
from app.core.team_scope import managed_departments
from app.core.users import fetch_user, find_user_by_identity, public_user

from . import auth_bp
from .tokens import consume_token, issue_token, validate_token

log = logging.getLogger("app.auth")
MAX_FAILED_ATTEMPTS = 5
RESET_HOURS = 1


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


def _manages(role: str, user_id: str) -> list[dict]:
    return [] if role == "admin" else managed_departments(user_id)


def _identity(body: dict) -> str:
    return (body.get("email_or_username") or body.get("email") or body.get("username") or "").strip()


@auth_bp.post("/login")
def login():
    body = request.get_json(silent=True) or request.form.to_dict() or {}
    identity, password = _identity(body), body.get("password") or ""
    user = find_user_by_identity(identity)
    if user is None:
        write_audit(None, "auth.login_failed", None, {"identifier": identity})
        return error("invalid credentials", 401)
    uid = str(user.id)
    if not user.password_hash:
        write_audit(None, "auth.login_failed", uid, {"identifier": identity})
        log.warning("login attempt for user with no password set: %s", identity)
        return error("password not set, check your email to activate your account", 403)
    session = orm_session()
    if not verify_password(password, user.password_hash):
        attempts = min(user.failed_attempts + 1, MAX_FAILED_ATTEMPTS)
        locked = attempts >= MAX_FAILED_ATTEMPTS and user.is_active
        user.failed_attempts = attempts
        if locked:
            user.is_active = False
        user.updated_at = func.now()
        session.commit()
        if locked:
            write_audit(uid, "account.locked", uid, {"failed_attempts": attempts})
            log.warning("account locked after %d failed attempts: %s", attempts, identity)
        write_audit(None, "auth.login_failed", uid, {"identifier": identity})
        log.warning("failed login for %s", identity)
        return error("invalid credentials", 401)

    if not user.is_active:
        return error("account disabled", 403)
    today = dt.date.today()
    if user.start_date and today < user.start_date:
        return error("account not yet active", 403)
    if user.end_date and today > user.end_date:
        return error("account expired", 403)
    if user.failed_attempts:
        user.failed_attempts = 0
        user.updated_at = func.now()
        session.commit()
    remember = body.get("remember") is True
    write_audit(uid, "auth.login_success", uid, {"remember": remember})
    lifetime = dt.timedelta(seconds=current_app.config["JWT_REMEMBER_EXPIRES"]) if remember else None
    token = create_access_token(identity=uid, expires_delta=lifetime,
                                additional_claims={"role": user.role.name, "email": user.email})
    g.jwt_uid = uid
    _auto_book_after_sign_in(user)
    return jsonify(token=token, user={**public_user(user), "manages": _manages(user.role.name, uid)}, remember=remember)


def _auto_book_after_sign_in(user):
    """Auto-book the first suggested seat (spec 2026-10-19-team-seats-first). Never fails the sign-in."""
    if not user.auto_book:
        return
    try:
        from app.desk import rules, service
        from app.desk.autobook import run_auto_book
        from app.desk.dashboard import seat_places
        at = rules.now()
        service.settle(at)
        run_auto_book(user, at, seat_places())
    except Exception:  # noqa: BLE001 - signing in must not break because of a booking problem
        orm_session().rollback()
        log.exception("auto-booking after sign-in failed for %s", user.id)


@auth_bp.get("/me")
@auth_required
def me():
    user = get_current_user_row()
    if user is None:
        return error("user not found", 401)
    return jsonify({**user, "manages": _manages(user["role"], user["id"])})


@auth_bp.get("/common-password-hashes")
def common_password_hashes():
    """SHA-256 hashes of well-known passwords, so the browser can warn while you type without sending the password."""
    return jsonify(hashes=common_hashes())


@auth_bp.post("/change-password")
@auth_required
def change_password():
    """Change your own password (My account): the current one must be right; the new one follows the policy."""
    body = request.get_json(silent=True) or {}
    current, new = body.get("current_password") or "", body.get("new_password") or ""
    session = orm_session()
    user = session.get(User, get_jwt_identity())
    if user is None:
        return error("user not found", 401)
    if not (user.password_hash and verify_password(current, user.password_hash)):
        return error("validation failed", 400, fields={"current_password": "Your current password is not right."})
    problem = password_problem(new, username=user.username, email=user.email)
    if not problem and new == current:
        problem = "Choose a password you have not used just now."
    if problem:
        return error("validation failed", 400, fields={"new_password": problem})
    user.password_hash = hash_password(new)
    user.updated_at = func.now()
    session.commit()
    write_audit(str(user.id), "account.password_changed", str(user.id), {})
    return ("", 204)


@auth_bp.post("/forgot-password")
def forgot_password():
    body = request.get_json(silent=True) or {}
    user = find_user_by_identity((body.get("email") or "").strip())
    if user and user.is_active:
        uid = str(user.id)
        raw = issue_token(uid, "reset", RESET_HOURS)
        link = f"{current_app.config['FRONTEND_URL']}/set-password?token={raw}"
        try:
            send_email(user.email, "Reset your password",
                       f'<p>Use the link within 1 hour to set a new password:</p>'
                       f'<p><a href="{link}">{link}</a></p>')
        except Exception as exc:
            log.error("forgot-password email failed: %s", exc)
        write_audit(uid, "password_reset.requested", uid, {})
    return ("", 204)


@auth_bp.get("/set-password/verify")
def verify_set_password():
    raw = request.args.get("token", "")
    purpose = request.args.get("purpose", "reset")
    if purpose not in ("reset", "activate"):
        return error("invalid purpose", 400)
    rec = validate_token(raw, purpose)
    valid = rec is not None
    if valid and purpose == "reset":
        user = orm_session().get(User, rec["user_id"])
        valid = bool(user and user.is_active)
    return jsonify(valid=valid)


@auth_bp.post("/set-password")
def set_password():
    body = request.get_json(silent=True) or {}
    raw, password = body.get("token", ""), body.get("password") or ""
    problem = password_problem(password)
    if problem:
        return error("validation failed", 400, fields={"password": problem})
    rec = validate_token(raw, "activate") or validate_token(raw, "reset")
    if rec is None:
        log.warning("invalid or expired set-password token used")
        return error("invalid or expired token", 400)
    session = orm_session()
    user = session.get(User, rec["user_id"])
    if user is not None:
        user.password_hash = hash_password(password)
        user.failed_attempts = 0
        user.is_active = True
        user.updated_at = func.now()
        session.commit()
    consume_token(rec["token_hash"])
    write_audit(rec["user_id"], "account.activated" if rec["purpose"] == "activate"
                else "password_reset.completed", rec["user_id"], {})
    return ("", 204)
