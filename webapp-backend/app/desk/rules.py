"""Booking time rules: 30-minute blocks, AM/PM/full-day presets, releases and automatic ends.

Pure functions (no database). All "today"/"tomorrow" and clock times are in BOOKING_TIMEZONE.
"Tomorrow" means the next working day: on a Friday (or at the weekend) it is Monday (owner 2026-10-16).
Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §2.2-2.6.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.config import Config

TZ = ZoneInfo(Config.BOOKING_TIMEZONE)
BLOCK = timedelta(minutes=30)
GRACE = timedelta(minutes=30)            # no-show grace and minimum bookable remainder
EARLY_CHECKIN = timedelta(minutes=30)
DAY_END = time(19, 0)                    # the bookable day ends at 19:00 (owner 2026-10-16; was 18:00)
FULL_DAY_RELEASE = time(10, 0)
PRESETS = {"am": (time(8, 0), time(13, 0)), "pm": (time(13, 0), DAY_END), "full": (time(8, 0), DAY_END)}
PRESET_LABELS = {"am": "AM", "pm": "PM", "full": "Full day"}


class BookingRuleError(ValueError):
    """A booking or check-in that the rules do not allow; the message is shown to the user."""


def now() -> datetime:
    """The only clock desk code may use (tests monkeypatch this)."""
    return datetime.now(timezone.utc)


def local_today(at: datetime) -> date:
    return at.astimezone(TZ).date()


def next_working_day(day: date) -> date:
    """The next Monday-Friday after `day` (no public holiday calendar)."""
    day += timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def bookable_days(at: datetime) -> tuple[date, date]:
    """Today and the next working day."""
    today = local_today(at)
    return today, next_working_day(today)


def at_local(day: date, clock: time) -> datetime:
    return datetime.combine(day, clock, TZ)


def next_boundary(at: datetime) -> datetime:
    """The first 30-minute boundary at or after `at` (local time)."""
    local = at.astimezone(TZ)
    floor = local.replace(minute=(local.minute // 30) * 30, second=0, microsecond=0)
    return floor if floor == local else floor + BLOCK


def preset_range(day: date, preset: str, at: datetime) -> tuple[datetime, datetime]:
    """Blocks a booking made at `at` would hold: the whole preset, or from the next boundary when
    the preset is already in progress. At least 30 minutes must remain."""
    if preset not in PRESETS:
        raise BookingRuleError(f"unknown booking slot '{preset}'")
    if day not in bookable_days(at):
        raise BookingRuleError("bookings are for today or the next working day")
    start, end = (at_local(day, clock) for clock in PRESETS[preset])
    begin = max(start, next_boundary(at))
    if end - begin < GRACE:
        raise BookingRuleError(f"too late to book {PRESET_LABELS[preset]}")
    return begin, end


def blocks(starts: datetime, ends: datetime) -> list[datetime]:
    out, cursor = [], starts
    while cursor < ends:
        out.append(cursor)
        cursor += BLOCK
    return out


def release_at(day: date, preset: str, created_at: datetime) -> datetime:
    """When an unclaimed booking frees up (spec §2.4)."""
    preset_start = at_local(day, PRESETS[preset][0])
    if created_at >= preset_start:
        return created_at + GRACE
    if preset == "full":
        return at_local(day, FULL_DAY_RELEASE)
    return preset_start + GRACE


def checkin_window_opens(starts_at: datetime) -> datetime:
    return starts_at - EARLY_CHECKIN


def walk_in_ends_at(at: datetime, next_booked_block: datetime | None) -> datetime:
    """A walk-in ends at the next booked block on the seat, else 19:00; after 19:00, at midnight."""
    day = local_today(at)
    day_end = at_local(day, DAY_END)
    if at >= day_end:
        return at_local(day + timedelta(days=1), time(0, 0))
    if next_booked_block is not None and at < next_booked_block < day_end:
        return next_booked_block
    return day_end
