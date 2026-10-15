"""Colleague Finder: where an active colleague is right now, or where they are booked to be.

Any signed-in user may search all active colleagues by name or username (product decision 2026-10-16).
"""
from datetime import datetime, timedelta

from sqlalchemy import or_, select

from app.core.auth_models import Department, User, UserDepartment
from app.core.desk_models import SeatBooking, SeatCheckin
from app.core.orm import orm_session

from . import rules, service
from .dashboard import seat_places

MIN_QUERY = 2
MAX_RESULTS = 20


def _hhmm(at: datetime | None) -> str | None:
    return at.astimezone(rules.TZ).strftime("%H:%M") if at else None


def find_people(q: str, at: datetime) -> list[dict]:
    q = (q or "").strip()
    if len(q) < MIN_QUERY:
        return []
    session = orm_session()
    today = rules.local_today(at)
    tomorrow = today + timedelta(days=1)
    like = f"%{q}%"
    users = session.scalars(select(User).where(User.is_active.is_(True), or_(User.full_name.ilike(like), User.username.ilike(like)))
                            .order_by(User.full_name).limit(MAX_RESULTS * 2)).unique().all()
    users = [u for u in users if service.is_usable(u, today)][:MAX_RESULTS]
    if not users:
        return []
    ids = [u.id for u in users]
    teams = {}
    for uid, name in session.execute(select(UserDepartment.user_id, Department.name)
                                     .join(Department, Department.id == UserDepartment.department_id)
                                     .where(UserDepartment.user_id.in_(ids)).order_by(Department.name)):
        teams.setdefault(uid, []).append(name)
    checkins = {c.user_id: c for c in session.scalars(select(SeatCheckin).where(
        SeatCheckin.user_id.in_(ids), SeatCheckin.checked_out_at.is_(None), SeatCheckin.ends_at > at))}
    bookings = {}
    for b in session.scalars(select(SeatBooking).where(
            SeatBooking.booked_for.in_(ids), SeatBooking.end_reason.is_(None), SeatBooking.ends_at > at,
            SeatBooking.booking_date.in_((today, tomorrow))).order_by(SeatBooking.starts_at)):
        bookings.setdefault((b.booked_for, b.booking_date), b)
    places = seat_places()

    def seat(seat_id, label):
        place = places.get(seat_id)
        return {"seat_id": str(seat_id), "seat_label": (place or {}).get("seat_label") or label,
                "plan_id": (place or {}).get("plan_id"), "plan_name": (place or {}).get("plan_name"),
                "zone": (place or {}).get("zone")}

    out = []
    for u in users:
        base = {"id": str(u.id), "name": u.full_name, "initials": service.initials(u.full_name), "teams": teams.get(u.id, [])}
        c, b_today, b_tomorrow = checkins.get(u.id), bookings.get((u.id, today)), bookings.get((u.id, tomorrow))
        if c:
            out.append({**base, "status": "checked_in", "seat": seat(c.seat_id, c.seat_label), "date": today.isoformat(),
                        "since": _hhmm(c.checked_in_at), "until": _hhmm(c.ends_at), "preset": None})
        elif b_today:
            out.append({**base, "status": "booked", "seat": seat(b_today.seat_id, b_today.seat_label), "date": today.isoformat(),
                        "since": None, "until": _hhmm(b_today.ends_at), "preset": b_today.preset})
        elif b_tomorrow:
            out.append({**base, "status": "tomorrow", "seat": seat(b_tomorrow.seat_id, b_tomorrow.seat_label),
                        "date": tomorrow.isoformat(), "since": None, "until": None, "preset": b_tomorrow.preset})
        else:
            out.append({**base, "status": "away", "seat": None, "date": None, "since": None, "until": None, "preset": None})
    return out
