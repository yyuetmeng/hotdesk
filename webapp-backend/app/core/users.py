import json

from .db import run_one

DEPT_AGG = (
    "(select coalesce(json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name), '[]'::json) "
    "from user_departments ud join departments d on d.id = ud.department_id "
    "where ud.user_id = u.id) as departments"
)

SELECT_PUBLIC_USER = (
    "select u.id::text as id, u.email, u.username, u.full_name, r.name as role, "
    "u.is_active, u.start_date, u.end_date, u.password_hash, "
    + DEPT_AGG + " "
    "from users u join roles r on r.id = u.role_id where u.id = cast(:id as uuid)"
)


def public_user(row: dict) -> dict:
    data = dict(row)
    depts = data.get("departments")
    if isinstance(depts, str):
        depts = json.loads(depts)
    return {
        "id": data["id"],
        "email": data["email"],
        "username": data["username"],
        "full_name": data["full_name"],
        "role": data["role"],
        "is_active": data["is_active"],
        "start_date": data["start_date"].isoformat() if data.get("start_date") else None,
        "end_date": data["end_date"].isoformat() if data.get("end_date") else None,
        "departments": depts or [],
        "status": "pending_activation" if data.get("password_hash") is None else "active",
    }


def fetch_user(user_id: str):
    row = run_one(SELECT_PUBLIC_USER, {"id": user_id})
    return public_user(row) if row else None


def email_exists(email: str, exclude_id: str | None = None) -> bool:
    row = run_one(
        "select 1 from users where email = :e "
        "and (cast(:ex as uuid) is null or id != cast(:ex as uuid))",
        {"e": email, "ex": exclude_id},
    )
    return row is not None


def username_exists(username: str, exclude_id: str | None = None) -> bool:
    row = run_one(
        "select 1 from users where username = :u "
        "and (cast(:ex as uuid) is null or id != cast(:ex as uuid))",
        {"u": username, "ex": exclude_id},
    )
    return row is not None
