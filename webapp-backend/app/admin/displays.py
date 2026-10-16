"""Admin configuration of public floor displays (/api/admin/displays).

Spec: docs/superpowers/specs/2026-10-15-floor-dashboard-design.md §3-5.
"""
import re
import uuid

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.audit import write_audit
from app.core.desk_models import DashboardDisplay
from app.core.errors import error
from app.core.floorplan_models import FloorPlan
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp

SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$")
LAYOUTS = ("rotate", "grid")
FIELDS = ("name", "slug", "plan_ids", "show_overall", "layout", "rotate_seconds")


def display_dto(d: DashboardDisplay) -> dict:
    """Display config with its floors in order; deleted plans are dropped, drafts flagged."""
    plans = {p.id: p for p in orm_session().scalars(select(FloorPlan).where(FloorPlan.id.in_(d.plan_ids or [])))}
    floors = []
    for pid in d.plan_ids or []:
        plan = plans.get(pid)
        if plan is None:
            continue
        live = plan.published_version
        floors.append({"id": str(plan.id), "name": live.name if live else plan.name, "published": live is not None})
    return {"id": str(d.id), "slug": d.slug, "name": d.name, "plan_ids": [str(p) for p in d.plan_ids or []],
            "show_overall": d.show_overall, "layout": d.layout, "rotate_seconds": d.rotate_seconds,
            "floors": floors}


def _validate(body: dict, partial: bool) -> tuple[dict, dict]:
    fields, values = {}, {}
    if not partial or "name" in body:
        name = (body.get("name") or "").strip() if isinstance(body.get("name"), str) else ""
        if not 1 <= len(name) <= 80:
            fields["name"] = "name is required (1-80 characters)"
        values["name"] = name
    if not partial or "slug" in body:
        slug = body.get("slug")
        if not isinstance(slug, str) or not SLUG_RE.match(slug):
            fields["slug"] = "link name: lowercase letters, digits and dashes (max 40), not starting or ending with a dash"
        values["slug"] = slug
    if not partial or "plan_ids" in body:
        raw = body.get("plan_ids", [])
        ids = []
        if not isinstance(raw, list):
            fields["plan_ids"] = "plan_ids must be a list of floor plan ids"
        else:
            for item in raw:
                try:
                    ids.append(uuid.UUID(str(item)))
                except ValueError:
                    fields["plan_ids"] = "unknown floor plan id"
                    break
            if "plan_ids" not in fields and ids:
                known = set(orm_session().scalars(select(FloorPlan.id).where(FloorPlan.id.in_(ids))))
                if len(set(ids)) != len(ids) or not set(ids) <= known:
                    fields["plan_ids"] = "unknown or repeated floor plan id"
        values["plan_ids"] = ids
    if "show_overall" in body or not partial:
        value = body.get("show_overall", True)
        if not isinstance(value, bool):
            fields["show_overall"] = "show_overall must be true or false"
        values["show_overall"] = value
    if "layout" in body or not partial:
        value = body.get("layout", "rotate")
        if value not in LAYOUTS:
            fields["layout"] = "layout must be rotate or grid"
        values["layout"] = value
    if "rotate_seconds" in body or not partial:
        value = body.get("rotate_seconds", 20)
        if type(value) is not int or not 10 <= value <= 120:
            fields["rotate_seconds"] = "seconds per floor must be a whole number from 10 to 120"
        values["rotate_seconds"] = value
    return fields, values


def _get(display_id) -> DashboardDisplay | None:
    try:
        return orm_session().get(DashboardDisplay, uuid.UUID(str(display_id)))
    except ValueError:
        return None


@admin_bp.get("/displays")
@admin_required
def list_displays():
    g.jwt_uid = get_jwt_identity()
    items = orm_session().scalars(select(DashboardDisplay).order_by(DashboardDisplay.name)).all()
    from .audit import last_changes   # local import: audit imports app.desk
    changes = last_changes([d.id for d in items])
    return jsonify(items=[{**display_dto(d), "last_change": changes.get(d.id)} for d in items])


@admin_bp.post("/displays")
@admin_required
def create_display():
    actor = get_jwt_identity()
    g.jwt_uid = actor
    fields, values = _validate(request.get_json(silent=True) or {}, partial=False)
    if fields:
        return error("validation failed", 400, fields=fields)
    session = orm_session()
    display = DashboardDisplay(**values)
    session.add(display)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("that link name is already used by another display", 409)
    write_audit(actor, "display.create", str(display.id), {"slug": display.slug})
    return jsonify(display_dto(display)), 201


@admin_bp.patch("/displays/<display_id>")
@admin_required
def update_display(display_id):
    actor = get_jwt_identity()
    g.jwt_uid = actor
    display = _get(display_id)
    if display is None:
        return error("display not found", 404)
    body = request.get_json(silent=True) or {}
    unknown = set(body) - set(FIELDS)
    if unknown or not body:
        return error("validation failed", 400, fields={k: "unknown field" for k in sorted(unknown)} or {"body": "no fields"})
    fields, values = _validate(body, partial=True)
    if fields:
        return error("validation failed", 400, fields=fields)
    for key, value in values.items():
        setattr(display, key, value)
    display.updated_at = func.now()
    session = orm_session()
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("that link name is already used by another display", 409)
    session.refresh(display)
    write_audit(actor, "display.update", str(display.id), {"fields": sorted(body)})
    return jsonify(display_dto(display))


@admin_bp.delete("/displays/<display_id>")
@admin_required
def delete_display(display_id):
    actor = get_jwt_identity()
    g.jwt_uid = actor
    display = _get(display_id)
    if display is None:
        return error("display not found", 404)
    slug = display.slug
    session = orm_session()
    session.delete(display)
    session.commit()
    write_audit(actor, "display.delete", str(display_id), {"slug": slug})
    return ("", 204)
