"""Public floor endpoints for the dashboard: today's seat states and activity, no sign-in.

Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §2.8, §5. Responses
carry full names and initials only (never emails, usernames or people's departments).
"""
from functools import wraps

from flask import jsonify

from app.admin.floorplan_publishing import _version_element_dto
from app.core.errors import error
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
    return jsonify(id=str(plan.id), name=live.name, cols=live.cols, rows=live.rows,
                   date=rules.local_today(at).isoformat(), now=at.isoformat(),
                   elements=[_version_element_dto(el) for el in live.elements],
                   seats=service.seat_states(plan, rules.local_today(at), None, at))


@public_bp.get("/seats/<seat_id>/activity")
@public_endpoint
def seat_activity(at, seat_id):
    return jsonify(items=service.seat_activity(seat_id, at))
