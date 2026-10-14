import uuid

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.audit import write_audit
from app.core.errors import error
from app.core.floorplan_models import FloorPlan, FloorPlanElement
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp

CATALOG = {
    "wall": {"label": "Wall", "w": 1, "h": 1, "color": "#64748b"},
    "seat": {"label": "Seat", "w": 1, "h": 1, "color": "#16a34a"},
    "toilet": {"label": "Toilet", "w": 2, "h": 2, "color": "#0d9488"},
    "elevator": {"label": "Elevator", "w": 2, "h": 2, "color": "#7c3aed"},
    "door": {"label": "Door", "w": 1, "h": 1, "color": "#b45309"},
    "meeting_room": {"label": "Meeting room", "w": 3, "h": 2, "color": "#2563eb"},
    "kitchen": {"label": "Kitchen", "w": 2, "h": 2, "color": "#db2777"},
    "plant": {"label": "Plant", "w": 1, "h": 1, "color": "#15803d"},
    "corridor": {"label": "Corridor", "w": 1, "h": 1, "color": "#94a3b8"},
}
MIN_DIM, MAX_DIM = 5, 80


def _size(etype: str, rotation: int):
    entry = CATALOG[etype]
    w, h = entry["w"], entry["h"]
    return (h, w) if rotation in (90, 270) else (w, h)


def _element_dto(el: FloorPlanElement) -> dict:
    return {"id": str(el.id), "type": el.type, "x": el.x, "y": el.y,
            "w": el.w, "h": el.h, "rotation": el.rotation,
            "label": el.label, "color": el.color}


def _get_plan(plan_id: str) -> FloorPlan | None:
    try:
        pid = plan_id if isinstance(plan_id, uuid.UUID) else uuid.UUID(str(plan_id))
    except (ValueError, AttributeError, TypeError):
        return None
    return orm_session().get(FloorPlan, pid)


def _plan_payload(plan: FloorPlan) -> dict:
    return {"id": str(plan.id), "name": plan.name, "cols": plan.cols, "rows": plan.rows,
            "updated_at": plan.updated_at.isoformat(),
            "elements": [_element_dto(el) for el in plan.elements]}


@admin_bp.get("/floor-plans/catalog")
@admin_required
def floorplan_catalog():
    g.jwt_uid = get_jwt_identity()
    return jsonify(items=[{"type": t, **entry} for t, entry in CATALOG.items()])


@admin_bp.get("/floor-plans")
@admin_required
def list_plans():
    g.jwt_uid = get_jwt_identity()
    session = orm_session()
    plans = session.scalars(select(FloorPlan).order_by(FloorPlan.created_at.desc())).all()
    return jsonify(items=[
        {"id": str(p.id), "name": p.name, "cols": p.cols, "rows": p.rows,
         "element_count": session.scalar(
             select(func.count()).select_from(FloorPlanElement)
             .where(FloorPlanElement.plan_id == p.id)),
         "updated_at": p.updated_at.isoformat()}
        for p in plans])


def _validate_dims(body: dict, fields: dict, defaults=None):
    """Validate cols/rows in body, falling back to defaults when absent. Returns (cols, rows)."""
    defaults = defaults or {}
    cols_in, rows_in = "cols" in body, "rows" in body
    try:
        cols = int(body["cols"]) if cols_in else defaults.get("cols")
        rows = int(body["rows"]) if rows_in else defaults.get("rows")
    except (TypeError, ValueError):
        if cols_in:
            fields["cols"] = "cols and rows must be integers"
        if rows_in:
            fields["rows"] = "cols and rows must be integers"
        return None, None
    if cols is not None and not (MIN_DIM <= cols <= MAX_DIM):
        fields["cols"] = f"cols must be between {MIN_DIM} and {MAX_DIM}"
    if rows is not None and not (MIN_DIM <= rows <= MAX_DIM):
        fields["rows"] = f"rows must be between {MIN_DIM} and {MAX_DIM}"
    return cols, rows


@admin_bp.post("/floor-plans")
@admin_required
def create_plan():
    body = request.get_json(silent=True) or {}
    fields = {}
    name = (body.get("name") or "").strip()
    if not (1 <= len(name) <= 120):
        fields["name"] = "name is required (1-120 characters)"
    cols, rows = _validate_dims(body, fields)
    if "cols" not in body:
        fields["cols"] = "cols is required"
    if "rows" not in body:
        fields["rows"] = "rows is required"
    if fields:
        return error("validation failed", 400, fields=fields)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    session = orm_session()
    plan = FloorPlan(name=name, cols=cols, rows=rows, created_by=actor)
    session.add(plan)
    session.commit()
    write_audit(actor, "floorplan.create", str(plan.id), {"name": name, "cols": cols, "rows": rows})
    return jsonify(_plan_payload(plan)), 201


@admin_bp.get("/floor-plans/<uuid:plan_id>")
@admin_required
def get_plan(plan_id):
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(str(plan_id))
    if plan is None:
        return error("plan not found", 404)
    return jsonify(_plan_payload(plan))


@admin_bp.patch("/floor-plans/<uuid:plan_id>")
@admin_required
def update_plan(plan_id):
    plan_id = str(plan_id)
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    body = request.get_json(silent=True) or {}
    unknown = set(body) - {"name", "cols", "rows"}
    fields = {k: "unknown field" for k in sorted(unknown)}

    name = None
    if "name" in body:
        name = (body["name"] or "").strip()
        if not (1 <= len(name) <= 120):
            fields["name"] = "name is required (1-120 characters)"

    new_cols, new_rows = _validate_dims(
        body, fields, defaults={"cols": plan.cols, "rows": plan.rows})

    if not fields and (new_cols, new_rows) != (plan.cols, plan.rows):
        strayed = sum(1 for el in plan.elements
                      if el.x + _size(el.type, el.rotation)[0] > new_cols
                      or el.y + _size(el.type, el.rotation)[1] > new_rows)
        if strayed:
            fields["elements"] = f"{strayed} elements fall outside the new grid; move them first"

    if fields:
        return error("validation failed", 400, fields=fields)

    if "name" in body:
        plan.name = name
    plan.cols, plan.rows = new_cols, new_rows
    plan.updated_at = func.now()
    session = orm_session()
    session.commit()
    actor = get_jwt_identity()
    write_audit(actor, "floorplan.update", plan_id, {"fields": sorted(body)})
    session.expire(plan)
    return jsonify(_plan_payload(plan))


@admin_bp.delete("/floor-plans/<uuid:plan_id>")
@admin_required
def delete_plan(plan_id):
    plan_id = str(plan_id)
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    name = plan.name
    session = orm_session()
    session.delete(plan)
    session.commit()
    actor = get_jwt_identity()
    write_audit(actor, "floorplan.delete", plan_id, {"name": name})
    return ("", 204)
