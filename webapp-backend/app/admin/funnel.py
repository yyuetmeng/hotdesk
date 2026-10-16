"""Insights booking funnel (spec 2026-10-16-audit-views §4): GET /api/admin/insights/funnel?days=14

Per booking date: booked, checked in, released (no-show), cancelled, cancelled by a floor plan change,
still active. Per project team (the person's current teams): bookings that were not cancelled, no-shows,
and the no-show rate. Auto-booking: how many auto-booked seats were used or released.
"""
from datetime import timedelta

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import select

from app.core.auth_models import AuditLog, Department, UserDepartment
from app.core.desk_models import SeatBooking
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required
from app.desk import rules, service

from . import admin_bp

MAX_DAYS = 90
OUTCOMES = {"checked_in": "checked_in", "released": "released", "cancelled": "cancelled", "plan_changed": "plan_changed", None: "active"}


@admin_bp.get("/insights/funnel")
@admin_required
def booking_funnel():
    g.jwt_uid = get_jwt_identity()
    try:
        days = int(request.args.get("days", 14))
    except ValueError:
        days = 0
    if not 1 <= days <= MAX_DAYS:
        return error("validation failed", 400, fields={"days": f"days must be 1 to {MAX_DAYS}"})
    at = rules.now()
    service.settle(at)
    today = rules.local_today(at)
    first = today - timedelta(days=days - 1)
    session = orm_session()
    bookings = session.scalars(select(SeatBooking).where(SeatBooking.booking_date >= first, SeatBooking.booking_date <= today)).all()

    per_day = {first + timedelta(days=i): {"booked": 0, "checked_in": 0, "released": 0, "cancelled": 0, "plan_changed": 0, "active": 0}
               for i in range(days)}
    for b in bookings:
        row = per_day[b.booking_date]
        row["booked"] += 1
        row[OUTCOMES.get(b.end_reason, "active")] += 1

    people = {b.booked_for for b in bookings if b.booked_for}
    teams_of = {}
    for uid, name in session.execute(select(UserDepartment.user_id, Department.name)
                                     .join(Department, Department.id == UserDepartment.department_id)
                                     .where(UserDepartment.user_id.in_(people))) if people else []:
        teams_of.setdefault(uid, []).append(name)
    per_team = {}
    for b in bookings:
        if b.end_reason in ("cancelled", "plan_changed"):
            continue
        for team in teams_of.get(b.booked_for, ["No project team"]):
            t = per_team.setdefault(team, {"bookings": 0, "no_shows": 0})
            t["bookings"] += 1
            t["no_shows"] += b.end_reason == "released"
    teams = sorted(({"name": n, **v, "rate": round(100 * v["no_shows"] / v["bookings"]) if v["bookings"] else 0}
                    for n, v in per_team.items()), key=lambda t: (-t["rate"], t["name"].casefold()))

    auto_ids = set(session.scalars(select(AuditLog.target_id).where(AuditLog.action == "booking.auto_created")))
    auto = [b for b in bookings if b.id in auto_ids]
    return jsonify(days=[{"date": d.isoformat(), **v} for d, v in per_day.items()], teams=teams,
                   auto={"booked": len(auto), "used": sum(b.end_reason == "checked_in" for b in auto),
                         "unused": sum(b.end_reason == "released" for b in auto)})
