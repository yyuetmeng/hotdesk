"""Insights: team seat planning (owner 2026-10-22). Per project team: seats required (set by admins, saved), seats
allocated (seats tagged to the team on published floors) and utilisation: the most of the team's members checked in
at the same time in the period. The admins' planned split (the Try numbers) is saved too, but it is a plan only:
nothing here moves a seat.

A check-in counts for the project teams the person was in when they checked in (seat_checkins.user_department_ids),
as on the Project teams widget.
"""
from datetime import datetime, timedelta
from uuid import UUID

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, or_, select

from app.core.audit import write_audit
from app.core.auth_models import Department
from app.core.desk_models import SeatCheckin
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required
from app.desk import rules, service

from . import admin_bp
from .team_insights import _team_seats

RANGES = (7, 14, 30)


def peak_at_once(spans) -> int:
    """Most spans (start, end) open at the same moment. A span ending exactly when another starts doesn't overlap it."""
    events = sorted([(start, 1) for start, _ in spans] + [(end, -1) for _, end in spans], key=lambda e: (e[0], e[1]))
    peak = now = 0
    for _, step in events:
        now += step
        peak = max(peak, now)
    return peak


def utilisation(since: datetime, at: datetime) -> dict:
    """Team id -> the most of its members checked in at once between `since` and `at`."""
    rows = orm_session().scalars(select(SeatCheckin).where(
        SeatCheckin.checked_in_at < at,
        or_(SeatCheckin.checked_out_at.is_(None), SeatCheckin.checked_out_at > since),
        SeatCheckin.ends_at > since)).all()
    spans = {}
    for c in rows:
        start, end = max(c.checked_in_at, since), min(c.checked_out_at or c.ends_at, c.ends_at, at)
        if end <= start:
            continue
        for team_id in c.user_department_ids or []:
            spans.setdefault(team_id, []).append((start, end))
    return {team_id: peak_at_once(s) for team_id, s in spans.items()}


@admin_bp.get("/insights/team-seats")
@admin_required
def insights_team_seats():
    g.jwt_uid = get_jwt_identity()
    try:
        days = int(request.args.get("days", 30))
    except ValueError:
        days = 0
    if days not in RANGES:
        return error("validation failed", 400, fields={"days": f"days must be one of {', '.join(map(str, RANGES))}"})
    at = rules.now()
    service.settle(at)
    since = datetime.combine(rules.local_today(at) - timedelta(days=days - 1), datetime.min.time(), rules.TZ)
    allocated, used = _team_seats(), utilisation(since, at)
    teams = orm_session().execute(select(Department.id, Department.name, Department.color, Department.seats_required,
                                         Department.seats_planned).order_by(func.lower(Department.name))).all()
    return jsonify(days=days, since=since.date().isoformat(), teams=[
        {"id": str(t.id), "name": t.name, "color": t.color, "required": t.seats_required,
         "allocated": allocated.get(t.id, 0), "utilisation": used.get(t.id, 0), "planned": t.seats_planned}
        for t in teams])


def _plan_problem(plan) -> str | None:
    """The plan: {team id: whole number 0-500, or null = as allocated}."""
    if not isinstance(plan, dict):
        return "plan must be an object of project team id to seats"
    for team_id in plan:
        try:
            UUID(team_id)
        except ValueError:
            return f"unknown project team: {team_id}"
    if any(not (v is None or (type(v) is int and 0 <= v <= 500)) for v in plan.values()):
        return "planned seats must be whole numbers from 0 to 500, or null"
    return None


@admin_bp.put("/insights/team-seats/plan")
@admin_required
def save_team_seat_plan():
    """Saves the planned seats for the teams given (others are left alone), in one go."""
    actor = get_jwt_identity()
    g.jwt_uid = actor
    plan = (request.get_json(silent=True) or {}).get("plan")
    if problem := _plan_problem(plan):
        return error("validation failed", 400, fields={"plan": problem})
    session = orm_session()
    teams = {str(d.id): d for d in session.scalars(select(Department).where(Department.id.in_(list(plan)))).all()}         if plan else {}
    if unknown := sorted(set(plan) - set(teams)):
        return error("validation failed", 400, fields={"plan": f"unknown project team: {', '.join(unknown)}"})
    for team_id, seats in plan.items():
        teams[team_id].seats_planned = seats
    session.commit()
    write_audit(actor, "team_seat_plan.update", None, {"teams": len(plan)})
    return jsonify(saved=len(plan))
