"""Usual seat and auto-booking (spec 2026-10-16-usual-seat-and-auto-book-design §3).

With auto-booking on, signing in and opening the dashboard book the user's usual seat (free for all) for
today and tomorrow when those are working days and the user has nothing booked yet. Normal booking rules
apply; a refusal (seat taken, too late today) is reported, never raised.
"""
from datetime import datetime

from sqlalchemy import func, select

from app.core.auth_models import User
from app.core.desk_models import SeatBooking, SeatCheckin
from app.core.audit import write_audit
from app.core.orm import orm_session

from . import rules, service


def usual_seat(user: User, places: dict) -> dict | None:
    """The user's usual seat on a published floor, with `bookable` (free for all), or None."""
    place = places.get(user.usual_seat_id) if user.usual_seat_id else None
    if not place:
        return None
    return {"seat_id": str(user.usual_seat_id), "seat_label": place["seat_label"], "plan_id": place["plan_id"],
            "plan_name": place["plan_name"], "zone": place["zone"], "bookable": place["open_to_all"]}


def _has_booking(user: User, day) -> bool:
    return bool(orm_session().scalar(select(func.count()).select_from(SeatBooking).where(
        SeatBooking.booked_for == user.id, SeatBooking.booking_date == day, SeatBooking.end_reason.is_(None))))


def _checked_in_today(user: User, day) -> bool:
    start = datetime.combine(day, datetime.min.time(), rules.TZ)
    return bool(orm_session().scalar(select(func.count()).select_from(SeatCheckin).where(
        SeatCheckin.user_id == user.id, SeatCheckin.checked_in_at >= start)))


def run_auto_book(user: User, at: datetime, places: dict) -> list[dict]:
    """Book the usual seat where needed; one note per attempt: {date, seat_label, ok, message}."""
    seat = usual_seat(user, places)
    if not (user.auto_book and seat and seat["bookable"]):
        return []
    today = rules.local_today(at)
    notes = []
    for day in rules.bookable_days(at):
        if day.weekday() >= 5 or _has_booking(user, day) or (day == today and _checked_in_today(user, day)):
            continue
        try:
            booking = service.create_booking(user, seat["plan_id"], seat["seat_id"], day.isoformat(), "full", None, at)
            write_audit(user.id, "booking.auto_created", booking.id, service._booking_details(booking))
            notes.append({"date": day.isoformat(), "seat_label": seat["seat_label"], "ok": True, "message": None})
        except service.DeskError as exc:
            orm_session().rollback()
            notes.append({"date": day.isoformat(), "seat_label": seat["seat_label"], "ok": False, "message": str(exc)})
    return notes
