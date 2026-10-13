from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy.exc import IntegrityError

from app.core.audit import write_audit
from app.core.db import run_one, run_query, run_write
from app.core.errors import error
from app.core.security import admin_required

from . import admin_bp

SELECT_DEPTS = (
    "select d.id::text as id, d.name, d.description, "
    "(select count(*) from user_departments ud where ud.department_id = d.id) as user_count "
    "from departments d"
)


def _dept(dept_id: str):
    row = run_one(SELECT_DEPTS + " where d.id = cast(:i as uuid)", {"i": dept_id})
    return dict(row) if row else None


@admin_bp.get("/departments")
@admin_required
def list_departments():
    g.jwt_uid = get_jwt_identity()
    rows = run_query(SELECT_DEPTS + " order by d.name")
    return jsonify(items=[dict(r) for r in rows])


@admin_bp.post("/departments")
@admin_required
def create_department():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return error("validation failed", 400, fields={"name": "name is required"})
    try:
        row = run_one("insert into departments (name, description) values (:n, :d) "
                      "returning id::text as id",
                      {"n": name, "d": (body.get("description") or None)})
    except IntegrityError:
        return error("department name already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.create", None, {"name": name, "department_id": row["id"]})
    return jsonify(_dept(row["id"])), 201


@admin_bp.patch("/departments/<uuid:dept_id>")
@admin_required
def update_department(dept_id):
    body = request.get_json(silent=True) or {}
    dept_id = str(dept_id)
    if _dept(dept_id) is None:
        return error("department not found", 404)
    sets, params = [], {"i": dept_id}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return error("validation failed", 400, fields={"name": "name is required"})
        sets.append("name = :n")
        params["n"] = name
    if "description" in body:
        sets.append("description = :d")
        params["d"] = body["description"]
    if not sets:
        return error("no fields provided", 400)
    try:
        run_write("update departments set " + ", ".join(sets) + " where id = cast(:i as uuid)",
                  params)
    except IntegrityError:
        return error("department name already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.update", None,
                {"department_id": dept_id, "fields": sorted(body)})
    return jsonify(_dept(dept_id))


@admin_bp.delete("/departments/<uuid:dept_id>")
@admin_required
def delete_department(dept_id):
    dept_id = str(dept_id)
    dept = _dept(dept_id)
    if dept is None:
        return error("department not found", 404)
    run_write("delete from departments where id = cast(:i as uuid)", {"i": dept_id})
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.delete", None,
                {"department_id": dept_id, "name": dept["name"],
                 "user_count": dept["user_count"]})
    return ("", 204)
