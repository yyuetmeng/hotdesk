import datetime as dt
import logging
import uuid

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy.exc import IntegrityError

from app.auth.tokens import issue_token
from app.core.audit import write_audit
from app.core.db import run_one, run_query, run_write
from app.core.email import invitation_email, send_email
from app.core.errors import error
from app.core.security import admin_required
from app.core.users import SELECT_PUBLIC_USER, email_exists, public_user, username_exists

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


def _set_departments(user_id: str, department_ids: list[str]) -> None:
    run_write("delete from user_departments where user_id = :u", {"u": user_id})
    for d in department_ids:
        run_write("insert into user_departments (user_id, department_id) values (:u, :d)",
                  {"u": user_id, "d": d})


def _departments_exist(department_ids: list[str]) -> bool:
    if not department_ids:
        return True
    try:
        parsed = [str(uuid.UUID(d)) for d in department_ids]
    except (ValueError, TypeError, AttributeError):
        return False
    rows = run_query(
        "select id::text as id from departments where id = any(cast(:ids as uuid[]))",
        {"ids": parsed},
    )
    return {r["id"] for r in rows} == set(parsed)


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
    try:
        row = run_one(
            "insert into users (email, username, full_name, role_id, start_date, end_date) "
            "values (:email, :username, :full_name, "
            "cast((select id from roles where name = :role) as smallint), "
            ":start_date, :end_date) returning id::text as id",
            {"email": body["email"], "username": body["username"],
             "full_name": body["full_name"].strip(), "role": body["role"],
             "start_date": valid_date(body["start_date"]) if body.get("start_date") else None,
             "end_date": valid_date(body["end_date"]) if body.get("end_date") else None},
        )
    except IntegrityError:
        return error("email or username already exists", 409)
    uid = row["id"]
    _set_departments(uid, dept_ids)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "user.create", uid,
                {"email": body["email"], "username": body["username"], "role": body["role"]})
    _send_invitation(uid, body["email"], body["full_name"], body["username"])
    return jsonify(fetch_user(uid)), 201


def _send_invitation(user_id: str, email_addr: str, full_name: str, username: str) -> None:
    raw = issue_token(user_id, "activate", 72)
    link = f"{current_app.config['FRONTEND_URL']}/set-password?token={raw}"
    subject, html = invitation_email(full_name, link)
    try:
        send_email(email_addr, subject, html)
        write_audit(get_jwt_identity(), "user.invitation_sent", user_id, {"email": email_addr})
    except Exception as exc:
        log.error("invitation email failed for %s: %s", email_addr, exc)
        raise


def fetch_user(user_id: str):
    row = run_one(SELECT_PUBLIC_USER, {"id": user_id})
    return public_user(row) if row else None


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
    where, params = [], {}
    if q:
        where.append("(u.email ilike :q or u.username ilike :q or u.full_name ilike :q)")
        params["q"] = f"%{q}%"
    if role:
        where.append("r.name = :role")
        params["role"] = role
    if status == "active":
        where.append("u.is_active")
    elif status == "inactive":
        where.append("not u.is_active")
    if department:
        try:
            department = str(uuid.UUID(department))
            dept_match = "d2.id = cast(:dept as uuid)"
        except ValueError:
            dept_match = "d2.name ilike :dept"
        where.append(f"""exists (
            select 1 from user_departments ud join departments d2 on d2.id = ud.department_id
            where ud.user_id = u.id and {dept_match})""")
        params["dept"] = department
    where_sql = (" where " + " and ".join(where)) if where else ""
    params["limit"], params["offset"] = page_size, (page - 1) * page_size
    total = run_one(
        "select count(*) as n from users u join roles r on r.id = u.role_id" + where_sql, params
    )["n"]
    rows = run_query(
        "select u.id::text as id, u.email, u.username, u.full_name, r.name as role, "
        "u.is_active, u.start_date, u.end_date, u.password_hash, "
        "(select coalesce(json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name), '[]'::json) "
        " from user_departments ud join departments d on d.id = ud.department_id "
        " where ud.user_id = u.id) as departments "
        "from users u join roles r on r.id = u.role_id" + where_sql +
        " order by u.created_at desc limit :limit offset :offset",
        params,
    )
    g.jwt_uid = get_jwt_identity()
    return jsonify(items=[public_user(dict(r)) for r in rows], total=total,
                   page=page, page_size=page_size)


@admin_bp.get("/users/<uuid:user_id>")
@admin_required
def get_user(user_id):
    user = fetch_user(str(user_id))
    if user is None:
        return error("user not found", 404)
    return jsonify(user)
