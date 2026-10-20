"""Usual seat and auto-booking (spec 2026-10-16-usual-seat-and-auto-book-design §3).

With auto-booking on, signing in and opening the dashboard book a full day for today and tomorrow when those
are working days and the user has nothing booked yet. The seat is the first `suggest_seats` pick: the usual
seat when allowed and free, else the user's team seats, else a free-for-all seat (spec 2026-10-19-team-seats-first).
A usual seat is optional. Normal booking rules apply; a refusal (nothing free) is reported, never raised, and a day
already too late for a full day is skipped.
"""
from datetime import datetime

from sqlalchemy import func, select

from app.core.auth_models import User
from app.core.desk_models import SeatBooking, SeatCheckin
from app.core.audit import write_audit
from app.core.orm import orm_session

from . import rules, service


def usual_seat(user: User, places: dict) -> dict | None:
    """The user's usual seat on a published floor, with `bookable` (free for all or one of their teams), or None."""
    place = places.get(user.usual_seat_id) if user.usual_seat_id else None
    if not place:
        return None
    return {"seat_id": str(user.usual_seat_id), "seat_label": place["seat_label"], "plan_id": place["plan_id"],
            "plan_name": place["plan_name"], "zone": place["zone"],
            "bookable": place["open_to_all"] or place["department_id"] in {str(d) for d in service.department_ids(user)}}


def _has_booking(user: User, day) -> bool:
    return bool(orm_session().scalar(select(func.count()).select_from(SeatBooking).where(
        SeatBooking.booked_for == user.id, SeatBooking.booking_date == day, SeatBooking.end_reason.is_(None))))


def _checked_in_today(user: User, day) -> bool:
    start = datetime.combine(day, datetime.min.time(), rules.TZ)
    return bool(orm_session().scalar(select(func.count()).select_from(SeatCheckin).where(
        SeatCheckin.user_id == user.id, SeatCheckin.checked_in_at >= start)))


def run_auto_book(user: User, at: datetime, places: dict) -> list[dict]:
    """Book the first suggested seat where needed; one note per attempt:
    {date, seat_label, ok, message, usual_seat_label (the usual seat, when another seat was booked or none was free)}."""
    if not user.auto_book:
        return []
    usual = usual_seat(user, places)
    today = rules.local_today(at)
    notes = []
    for day in rules.bookable_days(at):
        if day.weekday() >= 5 or _has_booking(user, day) or (day == today and _checked_in_today(user, day)):
            continue
        try:
            rules.preset_range(day, "full", at)
        except rules.BookingRuleError:
            continue                                  # too late for a full day today: skip it, no note
        note = {"date": day.isoformat(), "seat_label": None, "ok": False, "message": "no free seat",
                "usual_seat_label": usual["seat_label"] if usual else None}
        seats = service.suggest_seats(user, day, "full", at)["seats"]   # per day: an earlier booking changes what's free
        if seats:
            seat = seats[0]
            note.update(seat_label=seat["seat_label"], message=None)
            if not usual or seat["seat_id"] == usual["seat_id"]:
                note["usual_seat_label"] = None
            try:
                booking = service.create_booking(user, seat["plan_id"], seat["seat_id"], day.isoformat(), "full", None, at)
                write_audit(user.id, "booking.auto_created", booking.id, service._booking_details(booking))
                note["ok"] = True
            except service.DeskError as exc:
                orm_session().rollback()
                note["message"] = str(exc)
        notes.append(note)
    return notes
