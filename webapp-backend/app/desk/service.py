"""Seat booking and check-in logic over published floor plans.

Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md. Every public entry
point calls settle(at) first, so releases and automatic ends are applied without a scheduler.
"""
import logging
import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.auth_models import Department, User, UserDepartment
from app.core.desk_models import SeatBooking, SeatBookingBlock, SeatCheckin
from app.core.floorplan_models import FloorPlan, FloorPlanVersionElement
from app.core.orm import orm_session

from . import rules

log = logging.getLogger("app.desk")


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
    """Release unclaimed bookings past their release time and end check-ins past their end.

    Safe under concurrent requests (several TVs polling): rows another request is already settling
    are skipped (SKIP LOCKED, fixed order), and a database conflict is rolled back instead of
    failing the request — settle is idempotent, so the next request finishes the job.
    """
    session = orm_session()
    try:
        due = session.scalars(select(SeatBooking).where(
            SeatBooking.end_reason.is_(None), SeatBooking.release_at <= at)
            .order_by(SeatBooking.id).with_for_update(skip_locked=True)).all()
        for booking in due:
            booking.ended_at, booking.end_reason = booking.release_at, "released"
            booking.blocks = []
        ended = session.scalars(select(SeatCheckin).where(
            SeatCheckin.checked_out_at.is_(None), SeatCheckin.ends_at <= at)
            .order_by(SeatCheckin.id).with_for_update(skip_locked=True)).all()
        for checkin in ended:
            checkin.checked_out_at, checkin.end_reason = checkin.ends_at, "auto"
            _free_booking_blocks(checkin.booking_id)
        session.commit()
    except (OperationalError, IntegrityError):
        session.rollback()
        log.warning("settle rolled back; releases and automatic ends retry on the next request", exc_info=True)


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
    boundary = rules.next_boundary(at)
    current = boundary - rules.BLOCK if boundary != at else at
    # The block in progress, plus blocks whose booked person may already check in (30 min early),
    # so a seat is never shown free while check-in already holds it for someone.
    return current, at + rules.EARLY_CHECKIN


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


def floor_context(seat_ids, day: date, at: datetime, viewer: User | None = None) -> dict:
    """Everything the floor view needs for `day`, loaded with a fixed number of queries."""
    session = orm_session()
    day_start, day_end = _day_bounds(day)
    blocks = _blocks_in(seat_ids, day_start, day_end)
    held_ids = {b.booking_id for b in blocks}
    held = {b.id: b for b in session.scalars(select(SeatBooking).where(SeatBooking.id.in_(held_ids)))} if held_ids else {}
    active_by_seat: dict = {}
    for b in session.scalars(select(SeatBooking).where(
            SeatBooking.seat_id.in_(seat_ids), SeatBooking.booking_date == day,
            SeatBooking.end_reason.is_(None)).order_by(SeatBooking.starts_at)):
        active_by_seat.setdefault(b.seat_id, []).append(b)
    blocks_by_seat: dict = {}
    for block in blocks:
        blocks_by_seat.setdefault(block.seat_id, []).append(block)
    return {"blocks_by_seat": blocks_by_seat, "held": held, "active_by_seat": active_by_seat,
            "open": open_checkins(seat_ids), "mine": open_checkin_of(viewer) if viewer is not None else None}


def _overlaps(checkin: SeatCheckin | None, starts: datetime, ends: datetime) -> bool:
    return checkin is not None and checkin.checked_in_at < ends and checkin.ends_at > starts


def seat_states(plan: FloorPlan, day: date, preset: str | None, at: datetime,
                viewer: User | None = None) -> list[dict]:
    seats = [el for el in plan.published_version.elements if el.type == "seat"]
    ctx = floor_context([el.element_id for el in seats], day, at, viewer)
    is_today = day == rules.local_today(at)
    starts, ends = _window(day, preset, at)
    ranges = {}
    for p in rules.PRESETS:
        try:
            ranges[p] = rules.preset_range(day, p, at)
        except rules.BookingRuleError:
            ranges[p] = None
    out = []
    for el in seats:
        seat_blocks = ctx["blocks_by_seat"].get(el.element_id, [])
        checkin = ctx["open"].get(el.element_id) if is_today else None
        if not _overlaps(checkin, starts, ends):
            checkin = None
        holding = next((b for b in seat_blocks if starts <= b.block_start < ends), None)
        booking = ctx["held"].get(holding.booking_id) if holding else None
        tagged = el.open_to_all or el.department_id is not None
        state = ("occupied" if checkin else "booked" if booking else "available" if tagged else "not_bookable")
        seat = {"id": str(el.element_id), "label": seat_label(el), "x": el.x, "y": el.y,
                "department_id": str(el.department_id) if el.department_id else None,
                "open_to_all": bool(el.open_to_all), "state": state,
                "occupant": person(checkin.user_name) if checkin else None,
                "booking": _booking_view(booking) if booking and not checkin else None}
        if viewer is not None:
            open_now = ctx["open"].get(el.element_id)
            seat["can_book"] = {
                p: bool(el.open_to_all and r and not any(r[0] <= b.block_start < r[1] for b in seat_blocks)
                        and not _overlaps(open_now, *r))
                for p, r in ranges.items()}
            seat["can_check_in"] = is_today and checkin_decision(viewer, el, at, ctx)["ok"]
            seat["can_give_up"] = bool(is_today and checkin is not None and checkin.user_id == viewer.id)
        out.append(seat)
    return out


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
            raise DeskError("you can only book for colleagues in your project teams", 403)
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


# --- check-in -----------------------------------------------------------------------------

def _hhmm(at: datetime) -> str:
    return at.astimezone(rules.TZ).strftime("%H:%M")


def open_checkin_of(user: User) -> SeatCheckin | None:
    return orm_session().scalars(select(SeatCheckin).where(
        SeatCheckin.user_id == user.id, SeatCheckin.checked_out_at.is_(None))).first()


def _active_bookings_on(seat_id, day: date) -> list[SeatBooking]:
    return orm_session().scalars(select(SeatBooking).where(
        SeatBooking.seat_id == seat_id, SeatBooking.booking_date == day,
        SeatBooking.end_reason.is_(None)).order_by(SeatBooking.starts_at)).all()


def _refuse(reason: str, status: int) -> dict:
    return {"ok": False, "reason": reason, "status": status, "booking": None, "ends_at": None, "warning": None}


def checkin_decision(viewer: User, el: FloorPlanVersionElement, at: datetime, ctx: dict | None = None) -> dict:
    """Whether `viewer` may check in to seat `el` now, and on what terms. `ctx` (floor_context for
    today) avoids per-seat queries on the floor view.

    Returns {"ok", "reason", "status", "booking", "ends_at", "warning"}; used by the check-in
    itself and by the seat page so the two never disagree.
    """
    day = rules.local_today(at)
    if not (el.open_to_all or el.department_id):
        return _refuse("This seat cannot be used: it has no project team.", 403)
    if not is_usable(viewer, day):
        return _refuse("Your account is not active today.", 403)
    if not may_use_seat(viewer, el):
        return _refuse("This seat is for another project team.", 403)
    mine = ctx["mine"] if ctx is not None else open_checkin_of(viewer)
    if mine is not None:
        if mine.seat_id == el.element_id:
            return _refuse("You are already checked in here.", 409)
        return _refuse(f"Give up your seat at {mine.seat_label} first.", 409)
    taken = (ctx["open"] if ctx is not None else open_checkins([el.element_id])).get(el.element_id)
    if taken is not None:
        return _refuse(f"This seat is occupied until {_hhmm(taken.ends_at)}.", 409)

    bookings = (ctx["active_by_seat"].get(el.element_id, []) if ctx is not None
                else _active_bookings_on(el.element_id, day))
    for b in bookings:
        if b.booked_for == viewer.id and rules.checkin_window_opens(b.starts_at) <= at < b.ends_at:
            return {"ok": True, "reason": None, "status": 201, "booking": b, "ends_at": b.ends_at, "warning": None}
    # Once someone else's check-in window has opened (30 min before their booking), the seat is theirs.
    current = next((b for b in bookings if rules.checkin_window_opens(b.starts_at) <= at < b.ends_at), None)
    if current is not None:
        return _refuse(f"Booked for someone else until {_hhmm(current.release_at)} unless they check in.", 403)
    mine_later = next((b for b in bookings if b.booked_for == viewer.id and b.starts_at > at), None)
    if mine_later is not None:
        return _refuse(f"Your booking starts at {_hhmm(mine_later.starts_at)}; check in from "
                       f"{_hhmm(rules.checkin_window_opens(mine_later.starts_at))}.", 403)
    upcoming = next((b.starts_at for b in bookings if b.starts_at > at), None)
    ends_at = rules.walk_in_ends_at(at, upcoming)
    warning = f"Booked from {_hhmm(upcoming)}: your check-in ends then." if upcoming and ends_at == upcoming else None
    return {"ok": True, "reason": None, "status": 201, "booking": None, "ends_at": ends_at, "warning": warning}


def check_in(viewer: User, seat_id, at: datetime) -> tuple[SeatCheckin, str | None]:
    plan, el = seat_element(seat_id)
    decision = checkin_decision(viewer, el, at)
    if not decision["ok"]:
        raise DeskError(decision["reason"], decision["status"])
    booking = decision["booking"]
    checkin = SeatCheckin(plan_id=plan.id, version_id=plan.published_version_id, seat_id=el.element_id,
                          seat_label=seat_label(el), user_id=viewer.id, user_name=viewer.full_name,
                          checked_in_at=at, ends_at=decision["ends_at"],
                          booking_id=booking.id if booking else None,
                          method="booking" if booking else "walk_in",
                          seat_department_id=el.department_id, seat_open_to_all=bool(el.open_to_all),
                          user_department_ids=sorted(department_ids(viewer), key=str))
    if booking is not None:
        booking.ended_at, booking.end_reason = at, "checked_in"
    session = orm_session()
    session.add(checkin)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise DeskError("This seat was just taken, or you are checked in elsewhere.", 409)
    return checkin, decision["warning"]


def give_up(viewer: User, seat_id, at: datetime) -> SeatCheckin:
    _, el = seat_element(seat_id)
    mine = open_checkin_of(viewer)
    if mine is None or mine.seat_id != el.element_id:
        raise DeskError("You are not checked in to this seat.", 409)
    mine.checked_out_at, mine.end_reason = at, "given_up"
    _free_booking_blocks(mine.booking_id)
    orm_session().commit()
    return mine


def checkin_dto(c: SeatCheckin) -> dict:
    return {"id": str(c.id), "seat_id": str(c.seat_id), "seat_label": c.seat_label,
            "plan_id": str(c.plan_id) if c.plan_id else None, "user": person(c.user_name),
            "checked_in_at": c.checked_in_at.isoformat(), "ends_at": c.ends_at.isoformat(), "method": c.method}


def seat_info(viewer: User | None, seat_id, at: datetime) -> dict:
    plan, el = seat_element(seat_id)
    day = rules.local_today(at)
    state = next(s for s in seat_states(plan, day, None, at) if s["id"] == str(el.element_id))
    upcoming = next((b for b in _active_bookings_on(el.element_id, day) if b.starts_at > at), None)
    dept = orm_session().get(Department, el.department_id) if el.department_id else None
    info = {**state, "plan": {"id": str(plan.id), "name": plan.published_version.name},
            "department": "Free for all" if el.open_to_all else (dept.name if dept else None),
            "next_booking_at": upcoming.starts_at.isoformat() if upcoming else None}
    if viewer is not None:
        decision = checkin_decision(viewer, el, at)
        mine = open_checkin_of(viewer)
        here = bool(mine and mine.seat_id == el.element_id)
        info.update(can_check_in=decision["ok"], reason=decision["reason"], warning=decision["warning"],
                    can_give_up=here, my_checkin=checkin_dto(mine) if here else None)
    return info


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = rules.at_local(day, time(0, 0))
    return start, start + timedelta(days=1)


def seat_activity(seat_id, at: datetime) -> list[dict]:
    """Today's events on a seat, oldest first (spec §2.8): names and times only."""
    _, el = seat_element(seat_id)
    start, end = _day_bounds(rules.local_today(at))
    session = orm_session()
    events = []
    checkins = session.scalars(select(SeatCheckin).where(
        SeatCheckin.seat_id == el.element_id, SeatCheckin.checked_in_at < end,
        or_(SeatCheckin.checked_out_at.is_(None), SeatCheckin.checked_out_at >= start))).all()
    for c in checkins:
        how = " (walk-in)"
        if c.booking_id:
            b = session.get(SeatBooking, c.booking_id)
            how = f" (booked by {b.booked_by_name})" if b and b.booked_by and b.booked_by != b.booked_for else " (booked)"
        if start <= c.checked_in_at < end:
            events.append({"at": c.checked_in_at, "kind": "checked_in", "text": f"{c.user_name} checked in{how}"})
        if c.checked_out_at and start <= c.checked_out_at < end:
            gave_up = c.end_reason == "given_up"
            events.append({"at": c.checked_out_at, "kind": "gave_up" if gave_up else "ended",
                           "text": f"{c.user_name} {'gave up the seat' if gave_up else 'check-in ended'}"})
    bookings = session.scalars(select(SeatBooking).where(
        SeatBooking.seat_id == el.element_id,
        or_(SeatBooking.created_at.between(start, end), SeatBooking.ended_at.between(start, end)))).all()
    ended_texts = {"cancelled": "booking was cancelled", "released": "booking was released (no check-in)",
                   "plan_changed": "booking was cancelled (floor plan changed)"}
    for b in bookings:
        by = f" by {b.booked_by_name}" if b.booked_by_name and b.booked_by != b.booked_for else ""
        if start <= b.created_at < end:
            slot = rules.PRESET_LABELS.get(b.preset, "custom time")
            events.append({"at": b.created_at, "kind": "booked", "text": f"Booked for {b.booked_for_name}{by} ({slot})"})
        if b.ended_at and start <= b.ended_at < end and b.end_reason in ended_texts:
            events.append({"at": b.ended_at, "kind": b.end_reason,
                           "text": f"{b.booked_for_name}'s {ended_texts[b.end_reason]}"})
    events.sort(key=lambda e: e["at"])
    return [{**e, "at": e["at"].isoformat()} for e in events]


# --- plan changes (spec §2.7) -------------------------------------------------------------

def cancel_for_plan_change(plan: FloorPlan, at: datetime, removed: bool = False) -> int:
    """After publish/unpublish (or before deleting the plan, `removed=True`): cancel today/tomorrow
    bookings on seats that are gone or no longer free for all, and end check-ins on seats that are
    gone or were free for all and no longer are (spec §2.7). Returns how many rows changed."""
    session = orm_session()
    live = {}
    if plan.published_version is not None and not removed:
        live = {el.element_id: el for el in plan.published_version.elements if el.type == "seat"}
    changed = 0
    for b in session.scalars(select(SeatBooking).where(
            SeatBooking.plan_id == plan.id, SeatBooking.booking_date.in_(rules.bookable_days(at)),
            SeatBooking.end_reason.is_(None))).all():
        el = live.get(b.seat_id)
        if el is None or not el.open_to_all:
            b.ended_at, b.end_reason = at, "plan_changed"
            b.blocks = []
            changed += 1
        else:
            b.version_id = plan.published_version_id
    for c in session.scalars(select(SeatCheckin).where(
            SeatCheckin.plan_id == plan.id, SeatCheckin.checked_out_at.is_(None))).all():
        el = live.get(c.seat_id)
        if el is None or (c.seat_open_to_all and not el.open_to_all):
            c.checked_out_at, c.end_reason = at, "plan_changed"
            _free_booking_blocks(c.booking_id)
            changed += 1
    session.commit()
    return changed
