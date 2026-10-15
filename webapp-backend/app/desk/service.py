"""Seat booking and check-in logic over published floor plans.

Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md. Every public entry
point calls settle(at) first, so releases and automatic ends are applied without a scheduler.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.core.auth_models import User, UserDepartment
from app.core.desk_models import SeatBooking, SeatBookingBlock, SeatCheckin
from app.core.floorplan_models import FloorPlan, FloorPlanVersionElement
from app.core.orm import orm_session

from . import rules


class DeskError(Exception):
    """A request the rules refuse; `status` is the HTTP status to return."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def initials(name: str | None) -> str:
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()


def person(name: str | None) -> dict:
    return {"name": name, "initials": initials(name)}


def _uuid(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


# --- settle -------------------------------------------------------------------------------

def settle(at: datetime) -> None:
    """Release unclaimed bookings past their release time and end check-ins past their end."""
    session = orm_session()
    due = session.scalars(select(SeatBooking).where(
        SeatBooking.end_reason.is_(None), SeatBooking.release_at <= at)).all()
    for booking in due:
        booking.ended_at, booking.end_reason = booking.release_at, "released"
        booking.blocks = []
    ended = session.scalars(select(SeatCheckin).where(
        SeatCheckin.checked_out_at.is_(None), SeatCheckin.ends_at <= at)).all()
    for checkin in ended:
        checkin.checked_out_at, checkin.end_reason = checkin.ends_at, "auto"
        _free_booking_blocks(checkin.booking_id)
    if due or ended:
        session.commit()


def _free_booking_blocks(booking_id) -> None:
    if booking_id is not None:
        orm_session().execute(delete(SeatBookingBlock).where(SeatBookingBlock.booking_id == booking_id))


# --- published floors ---------------------------------------------------------------------

def published_plan(plan_id) -> FloorPlan:
    pid = _uuid(plan_id)
    plan = orm_session().get(FloorPlan, pid) if pid else None
    if plan is None or plan.published_version is None:
        raise DeskError("floor not found", 404)
    return plan


def published_floors() -> list[FloorPlan]:
    return orm_session().scalars(select(FloorPlan).where(FloorPlan.published_version_id.is_not(None))
                                 .order_by(FloorPlan.name)).all()


def seat_element(seat_id) -> tuple[FloorPlan, FloorPlanVersionElement]:
    """The live seat for a permanent seat id, with its plan."""
    sid = _uuid(seat_id)
    row = None
    if sid:
        row = orm_session().execute(
            select(FloorPlan, FloorPlanVersionElement)
            .join(FloorPlanVersionElement, FloorPlanVersionElement.version_id == FloorPlan.published_version_id)
            .where(FloorPlanVersionElement.element_id == sid, FloorPlanVersionElement.type == "seat")).first()
    if row is None:
        raise DeskError("seat not found", 404)
    return row[0], row[1]


def seat_label(el: FloorPlanVersionElement) -> str:
    return el.label or f"Seat {el.x},{el.y}"


# --- people -------------------------------------------------------------------------------

def department_ids(user: User) -> set[uuid.UUID]:
    return {d.id for d in user.departments}


def is_usable(user: User, day: date) -> bool:
    return bool(user.is_active and (user.start_date is None or user.start_date <= day)
                and (user.end_date is None or user.end_date >= day))


def may_use_seat(user: User, el: FloorPlanVersionElement) -> bool:
    if el.open_to_all:
        return True
    return el.department_id is not None and el.department_id in department_ids(user)


def colleagues(viewer: User, q: str, day: date) -> list[User]:
    shared = select(UserDepartment.user_id).where(UserDepartment.department_id.in_(department_ids(viewer)))
    stmt = select(User).where(User.id.in_(shared), User.id != viewer.id)
    if q:
        stmt = stmt.where(or_(User.full_name.ilike(f"%{q}%"), User.username.ilike(f"%{q}%")))
    found = orm_session().scalars(stmt.order_by(User.full_name)).unique().all()
    return [u for u in found if is_usable(u, day)]


def allowance_used(viewer: User, day: date) -> int:
    """Distinct colleagues the viewer booked for on `day` (cancelled bookings do not count)."""
    return orm_session().scalar(
        select(func.count(func.distinct(SeatBooking.booked_for))).where(
            SeatBooking.booked_by == viewer.id, SeatBooking.booked_for != viewer.id,
            SeatBooking.booking_date == day,
            or_(SeatBooking.end_reason.is_(None), SeatBooking.end_reason.not_in(("cancelled", "plan_changed")))))


# --- seat state ---------------------------------------------------------------------------

def _window(day: date, preset: str | None, at: datetime) -> tuple[datetime, datetime]:
    if preset in rules.PRESETS:
        start, end = rules.PRESETS[preset]
        return rules.at_local(day, start), rules.at_local(day, end)
    return at, at + rules.BLOCK


def _blocks_in(seat_ids, starts: datetime, ends: datetime) -> list[SeatBookingBlock]:
    return orm_session().scalars(select(SeatBookingBlock).where(
        SeatBookingBlock.seat_id.in_(seat_ids), SeatBookingBlock.block_start >= starts,
        SeatBookingBlock.block_start < ends)).all()


def open_checkins(seat_ids) -> dict[uuid.UUID, SeatCheckin]:
    rows = orm_session().scalars(select(SeatCheckin).where(
        SeatCheckin.seat_id.in_(seat_ids), SeatCheckin.checked_out_at.is_(None))).all()
    return {c.seat_id: c for c in rows}


def _booking_view(booking: SeatBooking) -> dict:
    by = None
    if booking.booked_by and booking.booked_by != booking.booked_for:
        by = {"name": booking.booked_by_name}
    return {"id": str(booking.id), "booked_for": person(booking.booked_for_name), "booked_by": by,
            "starts_at": booking.starts_at.isoformat(), "ends_at": booking.ends_at.isoformat()}


def seat_states(plan: FloorPlan, day: date, preset: str | None, at: datetime,
                viewer: User | None = None) -> list[dict]:
    seats = [el for el in plan.published_version.elements if el.type == "seat"]
    ids = [el.element_id for el in seats]
    starts, ends = _window(day, preset, at)
    held = {}
    for block in _blocks_in(ids, starts, ends):
        held.setdefault(block.seat_id, block.booking_id)
    bookings = {b.id: b for b in orm_session().scalars(
        select(SeatBooking).where(SeatBooking.id.in_(set(held.values())))).all()} if held else {}
    occupied = open_checkins(ids) if day == rules.local_today(at) else {}
    out = []
    for el in seats:
        checkin = occupied.get(el.element_id)
        if checkin is not None and not (checkin.checked_in_at < ends and checkin.ends_at > starts):
            checkin = None
        booking = bookings.get(held.get(el.element_id))
        tagged = el.open_to_all or el.department_id is not None
        state = ("occupied" if checkin else "booked" if booking else "available" if tagged else "not_bookable")
        seat = {"id": str(el.element_id), "label": seat_label(el), "x": el.x, "y": el.y,
                "department_id": str(el.department_id) if el.department_id else None,
                "open_to_all": bool(el.open_to_all), "state": state,
                "occupant": person(checkin.user_name) if checkin else None,
                "booking": _booking_view(booking) if booking and not checkin else None}
        if viewer is not None:
            seat["can_book"] = {p: _can_book(el, day, p, at) for p in rules.PRESETS}
        out.append(seat)
    return out


def _can_book(el: FloorPlanVersionElement, day: date, preset: str, at: datetime) -> bool:
    if not el.open_to_all:
        return False
    try:
        starts, ends = rules.preset_range(day, preset, at)
    except rules.BookingRuleError:
        return False
    if _blocks_in([el.element_id], starts, ends):
        return False
    checkin = open_checkins([el.element_id]).get(el.element_id)
    return not (checkin and checkin.checked_in_at < ends and checkin.ends_at > starts)


# --- bookings -----------------------------------------------------------------------------

def booking_state(b: SeatBooking) -> str:
    return b.end_reason or "active"


def booking_dto(b: SeatBooking) -> dict:
    return {"id": str(b.id), "plan_id": str(b.plan_id) if b.plan_id else None, "seat_id": str(b.seat_id),
            "seat_label": b.seat_label, "date": b.booking_date.isoformat(), "preset": b.preset,
            "starts_at": b.starts_at.isoformat(), "ends_at": b.ends_at.isoformat(),
            "release_at": b.release_at.isoformat(), "state": booking_state(b),
            "booked_for": {"id": str(b.booked_for) if b.booked_for else None, "name": b.booked_for_name},
            "booked_by": {"id": str(b.booked_by) if b.booked_by else None, "name": b.booked_by_name},
            "created_at": b.created_at.isoformat() if b.created_at else None}


def create_booking(viewer: User, plan_id, seat_id, day_text, preset, for_user_id, at: datetime) -> SeatBooking:
    plan = published_plan(plan_id)
    _, el = seat_element(seat_id)
    if el.version_id != plan.published_version_id:
        raise DeskError("seat not found", 404)
    try:
        day = date.fromisoformat(str(day_text))
    except ValueError:
        raise DeskError("date must be YYYY-MM-DD")
    if not el.open_to_all:
        raise DeskError("only free-for-all seats can be booked")
    try:
        starts, ends = rules.preset_range(day, str(preset), at)
    except rules.BookingRuleError as exc:
        raise DeskError(str(exc))

    session = orm_session()
    target = viewer
    if for_user_id and _uuid(for_user_id) != viewer.id:
        target = session.get(User, _uuid(for_user_id)) if _uuid(for_user_id) else None
        if target is None:
            raise DeskError("colleague not found", 404)
        if not is_usable(target, day):
            raise DeskError(f"{target.full_name}'s account is not active on that day")
        if not (department_ids(target) & department_ids(viewer)):
            raise DeskError("you can only book for colleagues in your departments", 403)
        if viewer.booking_allowance <= 0:
            raise DeskError("you are not allowed to book for others", 403)
        already = session.scalar(select(func.count()).select_from(SeatBooking).where(
            SeatBooking.booked_by == viewer.id, SeatBooking.booked_for == target.id, SeatBooking.booking_date == day,
            or_(SeatBooking.end_reason.is_(None), SeatBooking.end_reason.not_in(("cancelled", "plan_changed")))))
        if not already and allowance_used(viewer, day) >= viewer.booking_allowance:
            raise DeskError(f"booking allowance used: {viewer.booking_allowance} colleague(s) per day", 403)
    elif not is_usable(viewer, day):
        raise DeskError("your account is not active on that day")

    checkin = open_checkins([el.element_id]).get(el.element_id)
    if checkin and checkin.checked_in_at < ends and checkin.ends_at > starts:
        raise DeskError("seat is occupied at that time", 409)

    booking = SeatBooking(plan_id=plan.id, version_id=plan.published_version_id, seat_id=el.element_id,
                          seat_label=seat_label(el), booking_date=day, starts_at=starts, ends_at=ends, preset=preset,
                          booked_for=target.id, booked_for_name=target.full_name, booked_by=viewer.id,
                          booked_by_name=viewer.full_name, created_at=at,
                          release_at=rules.release_at(day, preset, at))
    booking.blocks = [SeatBookingBlock(seat_id=el.element_id, block_start=b, booked_for=target.id)
                      for b in rules.blocks(starts, ends)]
    session.add(booking)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DeskError("seat or person already booked for that time", 409)
    return booking


def my_bookings(viewer: User, at: datetime) -> list[SeatBooking]:
    today, tomorrow = rules.bookable_days(at)
    return orm_session().scalars(select(SeatBooking).where(
        or_(SeatBooking.booked_for == viewer.id, SeatBooking.booked_by == viewer.id),
        SeatBooking.booking_date.in_((today, tomorrow))).order_by(SeatBooking.starts_at)).all()


def cancel_booking(viewer: User, booking_id, at: datetime) -> SeatBooking:
    bid = _uuid(booking_id)
    session = orm_session()
    booking = session.get(SeatBooking, bid) if bid else None
    if booking is None:
        raise DeskError("booking not found", 404)
    if viewer.id not in (booking.booked_for, booking.booked_by) and viewer.role.name != "admin":
        raise DeskError("you cannot cancel this booking", 403)
    if booking.end_reason is not None:
        raise DeskError(f"booking is already {booking.end_reason.replace('_', ' ')}", 409)
    booking.ended_at, booking.end_reason, booking.cancelled_by = at, "cancelled", viewer.id
    booking.blocks = []
    session.commit()
    return booking
