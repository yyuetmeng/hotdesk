from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.audit import write_audit
from app.core.auth_models import Department, UserDepartment
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp


def _user_count():
    return (select(func.count()).select_from(UserDepartment)
            .where(UserDepartment.department_id == Department.id)
            .correlate(Department).scalar_subquery().label("user_count"))


def _select_depts():
    return select(Department.id, Department.name, Department.description, _user_count())


def _dto(row) -> dict:
    return {"id": str(row.id), "name": row.name, "description": row.description,
            "user_count": row.user_count}


def _dept(dept_id: str):
    row = orm_session().execute(_select_depts().where(Department.id == dept_id)).first()
    return _dto(row) if row else None


@admin_bp.get("/departments")
@admin_required
def list_departments():
    g.jwt_uid = get_jwt_identity()
    rows = orm_session().execute(_select_depts().order_by(Department.name)).all()
    return jsonify(items=[_dto(r) for r in rows])


@admin_bp.post("/departments")
@admin_required
def create_department():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return error("validation failed", 400, fields={"name": "name is required"})
    session = orm_session()
    dept = Department(name=name, description=body.get("description") or None)
    session.add(dept)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("project team name already exists", 409)
    dept_id = str(dept.id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.create", None, {"name": name, "department_id": dept_id})
    return jsonify(_dept(dept_id)), 201


@admin_bp.patch("/departments/<uuid:dept_id>")
@admin_required
def update_department(dept_id):
    body = request.get_json(silent=True) or {}
    dept_id = str(dept_id)
    session = orm_session()
    dept = session.get(Department, dept_id)
    if dept is None:
        return error("project team not found", 404)
    changes = {}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return error("validation failed", 400, fields={"name": "name is required"})
        changes["name"] = name
    if "description" in body:
        changes["description"] = body["description"]
    if not changes:
        return error("no fields provided", 400)
    for key, value in changes.items():
        setattr(dept, key, value)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("project team name already exists", 409)
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
        return error("project team not found", 404)
    session = orm_session()
    session.delete(session.get(Department, dept_id))
    session.commit()
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.delete", None,
                {"department_id": dept_id, "name": dept["name"],
                 "user_count": dept["user_count"]})
    return ("", 204)
