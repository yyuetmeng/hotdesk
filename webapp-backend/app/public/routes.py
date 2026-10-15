"""Public floor endpoints for the dashboard: today's seat states and activity, no sign-in.

Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §2.8, §5. Responses
carry full names and initials only (never emails, usernames or people's departments).
"""
from functools import wraps

from flask import jsonify
from sqlalchemy import select

from app.admin.floorplan_publishing import _version_element_dto
from app.admin.floorplans import _catalog, _catalog_dto
from app.admin.displays import display_dto
from app.core.auth_models import Department
from app.core.desk_models import DashboardDisplay
from app.core.errors import error
from app.core.orm import orm_session
from app.desk import rules, service

from . import public_bp


def public_endpoint(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        at = rules.now()
        service.settle(at)
        try:
            return fn(at, *args, **kwargs)
        except service.DeskError as exc:
            return error(str(exc), exc.status)
    return wrapper


@public_bp.get("/floors")
@public_endpoint
def floors(at):
    return jsonify(items=[{"id": str(p.id), "name": p.published_version.name} for p in service.published_floors()])


@public_bp.get("/floors/<plan_id>")
@public_endpoint
def floor(at, plan_id):
    plan = service.published_plan(plan_id)
    live = plan.published_version
    seats = service.seat_states(plan, rules.local_today(at), None, at)
    dept_ids = {s["department_id"] for s in seats if s["department_id"]}
    names = {str(d.id): d.name for d in orm_session().scalars(select(Department).where(Department.id.in_(dept_ids)))}         if dept_ids else {}
    for s in seats:
        s["department"] = "Free for all" if s["open_to_all"] else names.get(s["department_id"])
    return jsonify(id=str(plan.id), name=live.name, cols=live.cols, rows=live.rows,
                   date=rules.local_today(at).isoformat(), now=at.isoformat(),
                   elements=[_version_element_dto(el) for el in live.elements],
                   seats=seats, summary=capacity(seats),
                   catalog=[_catalog_dto(entry) for entry in _catalog().values()])


def capacity(seats: list[dict]) -> dict:
    """Counts over bookable (tagged) seats; occupancy = occupied / bookable (spec §2)."""
    counts = {state: sum(1 for s in seats if s["state"] == state) for state in ("available", "booked", "occupied")}
    bookable = sum(counts.values())
    return {"bookable": bookable, **counts,
            "occupancy_pct": round(100 * counts["occupied"] / bookable) if bookable else 0}


@public_bp.get("/displays/<slug>")
@public_endpoint
def display(at, slug):
    found = orm_session().scalars(select(DashboardDisplay).where(DashboardDisplay.slug == slug)).first()
    if found is None:
        raise service.DeskError("display not found", 404)
    return jsonify(display_dto(found))


@public_bp.get("/seats/<seat_id>/activity")
@public_endpoint
def seat_activity(at, seat_id):
    return jsonify(items=service.seat_activity(seat_id, at))
