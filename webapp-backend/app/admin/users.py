from datetime import timedelta
import datetime as dt
import logging
import uuid

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import DateTime, func, literal, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.exc import IntegrityError

from app.auth.tokens import invalidate_tokens, issue_token
from app.core.audit import write_audit
from app.auth.routes import MAX_FAILED_ATTEMPTS
from app.core.auth_models import AuditLog, Department, Role, User, UserDepartment
from app.core.email import invitation_email, send_email
from app.core.errors import error
from app.core.orm import orm_session
from app.core.passwords import password_problem
from app.core.security import admin_required, hash_password
from app.core.users import email_exists, fetch_user, public_user, username_exists
from app.desk.dashboard import seat_places

from . import admin_bp

log = logging.getLogger("app.admin")

ROLE_NAMES = {"user", "admin"}
MAX_PAGE_SIZE = 100


def _valid_email(value: str) -> bool:
    return bool(value) and "@" in value and "." in value.split("@")[-1]


def valid_date(value):
    try:
        return dt.date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def VALIDATION_ERRORS(body: dict) -> dict:
    fields = {}
    if not _valid_email((body.get("email") or "").strip()):
        fields["email"] = "a valid email is required"
    username = (body.get("username") or "").strip()
    if len(username) < 2 or not username.replace("_", "").isalnum():
        fields["username"] = "username must be alphanumeric, at least 2 characters"
    if not (body.get("full_name") or "").strip():
        fields["full_name"] = "full_name is required"
    if body.get("role") not in ROLE_NAMES:
        fields["role"] = "role must be one of: user, admin"
    start = valid_date(body["start_date"]) if body.get("start_date") else None
    end = valid_date(body["end_date"]) if body.get("end_date") else None
    if body.get("start_date") and start is None:
        fields["start_date"] = "invalid date (use YYYY-MM-DD)"
    if body.get("end_date") and end is None:
        fields["end_date"] = "invalid date (use YYYY-MM-DD)"
    if start and end and start > end:
        fields["end_date"] = "end_date must be on or after start_date"
    return fields


def _parse_ids(department_ids) -> list[str] | None:
    try:
        return [str(uuid.UUID(d)) for d in department_ids]
    except (ValueError, TypeError, AttributeError):
        return None


def _departments_exist(department_ids) -> bool:
    if not department_ids:
        return True
    parsed = _parse_ids(department_ids)
    if parsed is None or len(set(parsed)) != len(parsed):
        return False
    rows = orm_session().scalars(select(Department.id).where(Department.id.in_(parsed))).all()
    return {str(r) for r in rows} == set(parsed)


def _set_departments(user: User, department_ids: list[str]) -> None:
    session = orm_session()
    user.departments = [session.get(Department, d) for d in _parse_ids(department_ids)]


def _role_id(name: str):
    return orm_session().scalar(select(Role.id).where(Role.name == name))


@admin_bp.post("/users")
@admin_required
def create_user():
    body = request.get_json(silent=True) or {}
    fields = VALIDATION_ERRORS(body)
    dept_ids = body.get("department_ids") or []
    if not _departments_exist(dept_ids):
        fields["department_ids"] = "unknown department id"
    if fields:
        return error("validation failed", 400, fields=fields)
    if email_exists(body["email"]):
        return error("email already exists", 409)
    if username_exists(body["username"]):
        return error("username already exists", 409)
    session = orm_session()
    user = User(
        email=body["email"], username=body["username"], full_name=body["full_name"].strip(),
        role_id=_role_id(body["role"]),
        start_date=valid_date(body["start_date"]) if body.get("start_date") else None,
        end_date=valid_date(body["end_date"]) if body.get("end_date") else None,
    )
    _set_departments(user, dept_ids)
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("email or username already exists", 409)
    uid = str(user.id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "user.create", uid,
                {"email": body["email"], "username": body["username"], "role": body["role"]})
    sent = _send_invitation(uid, body["email"], body["full_name"], body["username"])
    session.refresh(user)  # reload server defaults and name-ordered departments
    return jsonify({**public_user(user), "invitation_sent": sent}), 201


def _send_invitation(user_id: str, email_addr: str, full_name: str, username: str) -> bool:
    """Issue an activation token and email it. Returns False (logged) if the email fails;
    the user still exists and an admin can resend the invitation or set a password."""
    raw = issue_token(user_id, "activate", 72)
    link = f"{current_app.config['FRONTEND_URL']}/set-password?token={raw}"
    subject, html = invitation_email(full_name, link)
    try:
        send_email(email_addr, subject, html)
        write_audit(get_jwt_identity(), "user.invitation_sent", user_id, {"email": email_addr})
    except Exception as exc:
        log.error("invitation email failed for %s: %s", email_addr, exc)
        return False
    return True


@admin_bp.get("/users")
@admin_required
def list_users():
    q = (request.args.get("q") or "").strip()
    role = (request.args.get("role") or "").strip()
    status = (request.args.get("status") or "").strip()
    department = (request.args.get("department") or "").strip()
    try:
        page = max(int(request.args.get("page", 1)), 1)
        page_size = min(max(int(request.args.get("page_size", 20)), 1), MAX_PAGE_SIZE)
    except ValueError:
        return error("page and page_size must be integers", 400)
    conds = []
    if q:
        pattern = f"%{q}%"
        conds.append(or_(User.email.ilike(pattern), User.username.ilike(pattern),
                         User.full_name.ilike(pattern)))
    if role:
        conds.append(Role.name == role)
    if status == "active":
        conds.append(User.is_active.is_(True))
    elif status == "inactive":
        conds.append(User.is_active.is_(False))
    elif status == "locked":
        conds.append(User.failed_attempts >= MAX_FAILED_ATTEMPTS)
    elif status == "pending":
        conds.append(User.password_hash.is_(None))
    if department:
        try:
            dept_match = Department.id == str(uuid.UUID(department))
        except ValueError:
            dept_match = Department.name.ilike(department)
        conds.append(
            select(UserDepartment.user_id)
            .join(Department, Department.id == UserDepartment.department_id)
            .where(UserDepartment.user_id == User.id, dept_match)
            .exists())
    session = orm_session()
    total = session.scalar(select(func.count()).select_from(User)
                           .join(Role, Role.id == User.role_id).where(*conds))
    users = session.scalars(
        select(User).join(Role, Role.id == User.role_id).where(*conds)
        .order_by(User.created_at.desc()).limit(page_size).offset((page - 1) * page_size)
    ).unique().all()
    g.jwt_uid = get_jwt_identity()
    ids = [u.id for u in users]
    last_login = dict(session.execute(select(AuditLog.actor_id, func.max(AuditLog.created_at)).where(
        AuditLog.action == "auth.login_success", AuditLog.actor_id.in_(ids)).group_by(AuditLog.actor_id)).all()) if ids else {}
    # Failed sign-ins in the last 7 days, counting only those after the account was last re-enabled or had its
    # password reset, so the badge clears once an admin has dealt with it.
    unlocked = (select(func.max(AuditLog.created_at)).where(
        AuditLog.target_id == aliased_fail.target_id,
        AuditLog.action.in_(UNLOCK_ACTIONS)).scalar_subquery())
    failed = dict(session.execute(select(aliased_fail.target_id, func.count()).where(
        aliased_fail.action == "auth.login_failed", aliased_fail.target_id.in_(ids),
        aliased_fail.created_at >= func.now() - timedelta(days=7),
        aliased_fail.created_at > func.coalesce(unlocked, literal("-infinity").cast(DateTime(timezone=True))))
        .group_by(aliased_fail.target_id)).all()) if ids else {}
    return jsonify(items=[{**public_user(u), "last_login_at": last_login[u.id].isoformat() if u.id in last_login else None,
                           "failed_logins_7d": failed.get(u.id, 0), "locked": u.failed_attempts >= MAX_FAILED_ATTEMPTS}
                          for u in users], total=total, page=page, page_size=page_size)


@admin_bp.get("/users/<uuid:user_id>")
@admin_required
def get_user(user_id):
    user = fetch_user(str(user_id))
    if user is None:
        return error("user not found", 404)
    return jsonify(user)


def is_last_active_admin(user_id: str) -> bool:
    count = orm_session().scalar(
        select(func.count()).select_from(User).join(Role, Role.id == User.role_id)
        .where(Role.name == "admin", User.is_active.is_(True), User.id != user_id))
    return count == 0


# Admin actions that unlock an account: after them, earlier failed sign-ins no longer count on the badge.
UNLOCK_ACTIONS = ("user.enable", "user.password_reset", "password_reset.completed")
aliased_fail = aliased(AuditLog)

PATCHABLE = ("full_name", "username", "email", "role", "is_active",
             "start_date", "end_date", "department_ids", "booking_allowance", "usual_seat_id")


@admin_bp.patch("/users/<uuid:user_id>")
@admin_required
def patch_user(user_id):
    user_id = str(user_id)
    body = request.get_json(silent=True) or {}
    unknown = set(body) - set(PATCHABLE)
    if unknown:
        return error("validation failed", 400,
                     fields={k: "unknown field" for k in sorted(unknown)})
    if not body:
        return error("no fields provided", 400)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    session = orm_session()
    user = session.get(User, user_id)

    fields = {}
    if "email" in body and not _valid_email((body["email"] or "").strip()):
        fields["email"] = "a valid email is required"
    if "username" in body:
        username = (body["username"] or "").strip()
        if len(username) < 2 or not username.replace("_", "").isalnum():
            fields["username"] = "username must be alphanumeric, at least 2 characters"
    if "full_name" in body and not (body["full_name"] or "").strip():
        fields["full_name"] = "full_name is required"
    if "role" in body and body["role"] not in ROLE_NAMES:
        fields["role"] = "role must be one of: user, admin"
    start = valid_date(body["start_date"]) if body.get("start_date") else None
    end = valid_date(body["end_date"]) if body.get("end_date") else None
    if body.get("start_date") and start is None:
        fields["start_date"] = "invalid date (use YYYY-MM-DD)"
    if body.get("end_date") and end is None:
        fields["end_date"] = "invalid date (use YYYY-MM-DD)"
    if "booking_allowance" in body:
        allowance = body["booking_allowance"]
        if type(allowance) is not int or not 0 <= allowance <= 20:
            fields["booking_allowance"] = "booking_allowance must be a whole number from 0 to 20"
    if (start or end) and user is not None:
        s = start if "start_date" in body else user.start_date
        e = end if "end_date" in body else user.end_date
        if s and e and s > e:
            fields["end_date"] = "end_date must be on or after start_date"
    usual = None
    if body.get("usual_seat_id"):
        try:
            usual = uuid.UUID(str(body["usual_seat_id"]))
        except ValueError:
            usual = None
        if usual is None or usual not in seat_places():
            fields["usual_seat_id"] = "choose a seat on a published floor plan"
    dept_ids = body.get("department_ids")
    if dept_ids is not None and not _departments_exist(dept_ids):
        fields["department_ids"] = "unknown department id"
    if fields:
        return error("validation failed", 400, fields=fields)

    if user is None:
        return error("user not found", 404)

    demoting = body.get("role") and body["role"] != user.role.name
    disabling = body.get("is_active") is False
    if user_id == actor and (demoting or disabling):
        return error("you cannot demote or disable your own account", 409)
    if (demoting or disabling) and user.role.name == "admin" and user.is_active:
        if is_last_active_admin(user_id):
            return error("cannot remove or disable the last active admin", 409)

    if "email" in body and email_exists(body["email"], exclude_id=user_id):
        return error("email already exists", 409)
    if "username" in body and username_exists(body["username"], exclude_id=user_id):
        return error("username already exists", 409)

    pending_before = user.password_hash is None
    for col in ("full_name", "username", "email"):
        if col in body:
            setattr(user, col, body[col].strip())
    if "role" in body:
        user.role_id = _role_id(body["role"])
    if "is_active" in body:
        user.is_active = body["is_active"]
        if body["is_active"]:
            user.failed_attempts = 0
    if "start_date" in body:
        user.start_date = start
    if "end_date" in body:
        user.end_date = end
    if "booking_allowance" in body:
        user.booking_allowance = body["booking_allowance"]
    if "usual_seat_id" in body:
        user.usual_seat_id = usual
    if set(body) - {"department_ids"}:
        user.updated_at = func.now()
    if dept_ids is not None:
        _set_departments(user, dept_ids)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("email or username already exists", 409)

    if "department_ids" in body:
        write_audit(actor, "user.departments_updated", user_id, {"department_ids": dept_ids})
    changed = [k for k in body if k != "department_ids"]
    if changed:
        write_audit(actor, "user.update", user_id, {"fields": sorted(changed)})
    if "is_active" in body:
        write_audit(actor, "user.enable" if body["is_active"] else "user.disable",
                    user_id, {})
    if "email" in body and pending_before:
        invalidate_tokens(user_id, "activate")
        _send_invitation(user_id, user.email, user.full_name, user.username)
    session.refresh(user)
    return jsonify(public_user(user))


@admin_bp.delete("/users/<uuid:user_id>")
@admin_required
def delete_user(user_id):
    user_id = str(user_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    session = orm_session()
    user = session.get(User, user_id)
    if user is None:
        return error("user not found", 404)
    if user_id == actor:
        return error("you cannot delete your own account", 409)
    if user.role.name == "admin" and user.is_active and is_last_active_admin(user_id):
        return error("cannot remove the last active admin", 409)
    session.delete(user)
    session.commit()
    write_audit(actor, "user.delete", user_id, {})
    return ("", 204)


@admin_bp.post("/users/<uuid:user_id>/password")
@admin_required
def admin_set_password(user_id):
    user_id = str(user_id)
    body = request.get_json(silent=True) or {}
    password = body.get("password") or ""
    session = orm_session()
    user = session.get(User, user_id)
    if user is None:
        return error("user not found", 404)
    problem = password_problem(password, username=user.username, email=user.email)
    if problem:
        return error("validation failed", 400, fields={"password": problem})
    user.password_hash = hash_password(password)
    user.failed_attempts = 0
    user.is_active = True
    user.updated_at = func.now()
    session.commit()
    invalidate_tokens(user_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "user.password_reset", user_id, {})
    return ("", 204)


@admin_bp.post("/users/<uuid:user_id>/resend-invitation")
@admin_required
def resend_invitation(user_id):
    user_id = str(user_id)
    user = orm_session().get(User, user_id)
    if user is None:
        return error("user not found", 404)
    if user.password_hash is not None:
        return error("user already activated", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    if not _send_invitation(user_id, user.email, user.full_name, user.username):
        return error("invitation email could not be sent", 502)
    return ("", 204)
