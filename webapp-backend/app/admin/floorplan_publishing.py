"""Floor plan publishing: numbered, immutable versions of a plan's draft.

See docs/superpowers/specs/2026-10-15-floorplan-publishing-design.md.
"""
from flask import g, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.audit import write_audit
from app.core.errors import error
from app.core.floorplan_models import (FloorPlan, FloorPlanElement, FloorPlanVersion,
                                       FloorPlanVersionElement)
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp
from .floorplans import (_catalog, _config_with_defaults, _get_plan, _plan_payload, _tag_dto,
                         _validate_elements, plan_status)

_ELEMENT_FIELDS = ("type", "x", "y", "w", "h", "rotation", "label", "color", "config",
                   "department_id", "open_to_all")


def _draft_problems(plan: FloorPlan) -> list[str]:
    """Validate the stored draft as if it were saved now. Stored settings are normalised to the
    current catalog first, so settings since removed from it (e.g. seat "bookable") do not block
    publishing."""
    catalog = _catalog()
    raw = []
    for el in plan.elements:
        item = {"id": str(el.id), **{f: getattr(el, f) for f in _ELEMENT_FIELDS}, **_tag_dto(el)}
        if el.type in catalog:
            item["config"] = _config_with_defaults(catalog[el.type], el.config)
        raw.append(item)
    return _validate_elements(raw, plan.cols, plan.rows, {item["id"] for item in raw})


def _version_element_dto(el: FloorPlanVersionElement) -> dict:
    entry = _catalog().get(el.type)
    return {"id": str(el.element_id), "type": el.type, "x": el.x, "y": el.y, "w": el.w, "h": el.h,
            "rotation": el.rotation, "label": el.label, "color": el.color,
            "config": _config_with_defaults(entry, el.config) if entry else (el.config or {}),
            **_tag_dto(el)}


def _reloaded_payload(plan: FloorPlan):
    session = orm_session()
    session.expire(plan)
    if plan.published_version is not None:
        session.refresh(plan.published_version)
    return jsonify(_plan_payload(plan))


def _after_plan_change(plan: FloorPlan) -> None:
    """Cancel bookings / end check-ins that the new state of the plan no longer allows (spec §2.7)."""
    from app.desk import rules, service  # local import: app.desk imports this module

    service.cancel_for_plan_change(plan, rules.now(), actor_id=get_jwt_identity())


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
    payload = _reloaded_payload(plan)
    _after_plan_change(plan)
    return payload


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


@admin_bp.post("/floor-plans/<uuid:plan_id>/unpublish")
@admin_required
def unpublish_plan(plan_id):
    plan_id = str(plan_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    if plan.published_version is None:
        return error("plan is not published", 409)
    version = plan.published_version.version
    # Version rows are kept as history; a set published_version_id always means "live".
    plan.published_version_id = None
    plan.unpublished_at = func.now()
    orm_session().commit()
    write_audit(actor, "floorplan.unpublish", plan_id, {"version": version})
    payload = _reloaded_payload(plan)
    _after_plan_change(plan)
    return payload


@admin_bp.post("/floor-plans/<uuid:plan_id>/discard")
@admin_required
def discard_changes(plan_id):
    plan_id = str(plan_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    live = plan.published_version
    if live is None:
        return error("plan is not published", 409)
    plan.name, plan.cols, plan.rows = live.name, live.cols, live.rows
    # Same ids as the published version: update matching draft rows in place, re-create the
    # ones deleted since, and drop the ones added since (delete-orphan).
    draft = {el.id: el for el in plan.elements}
    restored = []
    for ve in live.elements:
        row = draft.get(ve.element_id) or FloorPlanElement(id=ve.element_id)
        for f in _ELEMENT_FIELDS:
            setattr(row, f, getattr(ve, f))
        restored.append(row)
    plan.elements = restored
    plan.updated_at = func.now()
    plan.draft_changed_at = live.published_at
    orm_session().commit()
    write_audit(actor, "floorplan.discard", plan_id, {"version": live.version})
    return _reloaded_payload(plan)
