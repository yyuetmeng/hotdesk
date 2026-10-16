"""Insights occupancy chart (/api/admin/insights/occupancy?range=1h|6h|24h|7d|30d).

Occupancy at a moment = seats with a check-in covering that moment / usable seats on published floors
(tagged with a project team or free for all), as a percentage. Short ranges are plain samples; 7d is an
hourly average with the hour's peak; 30d is a daily average over office hours (08:00-19:00) with the peak.
"""
from datetime import datetime, timedelta

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.desk_models import SeatCheckin
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required
from app.desk import rules, service

from . import admin_bp

SAMPLES = {"1h": (timedelta(hours=1), timedelta(minutes=5)), "6h": (timedelta(hours=6), timedelta(minutes=15)),
           "24h": (timedelta(hours=24), timedelta(minutes=30))}
HOURS_7D, DAYS_30D = 168, 30
OFFICE_START, OFFICE_END = 8, 19


def capacity() -> int:
    """Usable seats on published floors (tagged with a project team, or free for all)."""
    return sum(1 for plan in service.published_floors() for el in plan.published_version.elements
               if el.type == "seat" and (el.open_to_all or el.department_id))


def _intervals(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    rows = orm_session().execute(select(SeatCheckin.checked_in_at, func.coalesce(SeatCheckin.checked_out_at, SeatCheckin.ends_at))
                                 .where(SeatCheckin.checked_in_at <= end,
                                        func.coalesce(SeatCheckin.checked_out_at, SeatCheckin.ends_at) > start)).all()
    return [(a, b) for a, b in rows]


def _pct(intervals, t: datetime, cap: int) -> float:
    in_use = sum(1 for a, b in intervals if a <= t < b)
    return round(100 * in_use / cap, 1) if cap else 0.0


def _point(t: datetime, pct: float, peak: float | None) -> dict:
    return {"t": t.astimezone(rules.TZ).isoformat(), "pct": pct, "peak": peak}


def occupancy(rng: str, at: datetime) -> dict:
    cap = capacity()
    local = at.astimezone(rules.TZ)
    if rng in SAMPLES:
        span, step = SAMPLES[rng]
        start = at - span
        intervals = _intervals(start, at)
        n = int(span / step)
        points = [_point(start + k * step, _pct(intervals, start + k * step, cap), None) for k in range(n + 1)]
        aggregate = "sample"
    elif rng == "7d":
        hour = local.replace(minute=0, second=0, microsecond=0)
        start = hour - timedelta(hours=HOURS_7D - 1)
        intervals = _intervals(start, at)
        points = []
        for k in range(HOURS_7D):
            b = start + timedelta(hours=k)
            samples = [_pct(intervals, b + timedelta(minutes=m), cap) for m in (0, 15, 30, 45) if b + timedelta(minutes=m) <= at]
            points.append(_point(b, round(sum(samples) / len(samples), 1) if samples else 0.0, max(samples, default=0.0)))
        aggregate = "hourly"
    else:   # 30d
        today = local.date()
        first = datetime.combine(today - timedelta(days=DAYS_30D - 1), datetime.min.time(), rules.TZ)
        intervals = _intervals(first, at)
        points = []
        for k in range(DAYS_30D):
            day = first + timedelta(days=k)
            ticks = [day.replace(hour=OFFICE_START) + timedelta(minutes=30 * i) for i in range((OFFICE_END - OFFICE_START) * 2 + 1)]
            samples = [_pct(intervals, t, cap) for t in ticks if t <= at]
            points.append(_point(day, round(sum(samples) / len(samples), 1) if samples else 0.0, max(samples, default=0.0)))
        aggregate = "daily"
    return {"range": rng, "now": at.isoformat(), "since": points[0]["t"], "capacity": cap, "aggregate": aggregate, "points": points}


@admin_bp.get("/insights/occupancy")
@admin_required
def occupancy_chart():
    g.jwt_uid = get_jwt_identity()
    rng = request.args.get("range", "24h")
    if rng not in (*SAMPLES, "7d", "30d"):
        return error("validation failed", 400, fields={"range": "range must be one of 1h, 6h, 24h, 7d, 30d"})
    at = rules.now()
    service.settle(at)
    return jsonify(occupancy(rng, at))
