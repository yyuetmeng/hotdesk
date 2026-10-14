"""Floor plan publishing: numbered, immutable versions of a plan's draft.

See docs/superpowers/specs/2026-10-15-floorplan-publishing-design.md.
"""
from flask import g, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.audit import write_audit
from app.core.errors import error
from app.core.floorplan_models import FloorPlan, FloorPlanVersion, FloorPlanVersionElement
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp
from .floorplans import (_catalog, _config_with_defaults, _get_plan, _plan_payload,
                         _validate_elements, plan_status)

_ELEMENT_FIELDS = ("type", "x", "y", "w", "h", "rotation", "label", "color", "config")


def _draft_problems(plan: FloorPlan) -> list[str]:
    raw = [{"id": str(el.id), **{f: getattr(el, f) for f in _ELEMENT_FIELDS}} for el in plan.elements]
    return _validate_elements(raw, plan.cols, plan.rows, {item["id"] for item in raw})


def _version_element_dto(el: FloorPlanVersionElement) -> dict:
    entry = _catalog().get(el.type)
    return {"id": str(el.element_id), "type": el.type, "x": el.x, "y": el.y, "w": el.w, "h": el.h,
            "rotation": el.rotation, "label": el.label, "color": el.color,
            "config": _config_with_defaults(entry, el.config) if entry else (el.config or {})}


def _reloaded_payload(plan: FloorPlan):
    session = orm_session()
    session.expire(plan)
    if plan.published_version is not None:
        session.refresh(plan.published_version)
    return jsonify(_plan_payload(plan))


@admin_bp.post("/floor-plans/<uuid:plan_id>/publish")
@admin_required
def publish_plan(plan_id):
    plan_id = str(plan_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    if plan_status(plan) == "published":
        return error("nothing to publish: no changes since the last publish", 409)
    problems = _draft_problems(plan)
    if problems:
        return error("validation failed", 400, fields={"elements": problems})

    session = orm_session()
    number = (session.scalar(select(func.max(FloorPlanVersion.version))
                             .where(FloorPlanVersion.plan_id == plan.id)) or 0) + 1
    version = FloorPlanVersion(plan_id=plan.id, version=number, name=plan.name,
                               cols=plan.cols, rows=plan.rows, published_by=actor)
    version.elements = [FloorPlanVersionElement(element_id=el.id,
                                                **{f: getattr(el, f) for f in _ELEMENT_FIELDS})
                        for el in plan.elements]
    session.add(version)
    session.flush()
    plan.published_version_id = version.id
    plan.unpublished_at = None
    session.commit()
    write_audit(actor, "floorplan.publish", plan_id,
                {"version": number, "element_count": len(version.elements)})
    return _reloaded_payload(plan)


@admin_bp.get("/floor-plans/<uuid:plan_id>/published")
@admin_required
def get_published(plan_id):
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(str(plan_id))
    if plan is None:
        return error("plan not found", 404)
    live = plan.published_version
    if live is None:
        return error("plan is not published", 404)
    return jsonify(id=str(plan.id), version=live.version, name=live.name, cols=live.cols, rows=live.rows,
                   published_at=live.published_at.isoformat(),
                   elements=[_version_element_dto(el) for el in live.elements])
