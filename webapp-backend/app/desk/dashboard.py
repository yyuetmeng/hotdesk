"""Workspace dashboard data for the signed-in user (spec 2026-10-16-workspace-dashboard-design §3).

Everything is about the viewer, plus the people who share a project team with them.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from statistics import median

from sqlalchemy import select

from app.core.auth_models import Department, User, UserDepartment
from app.core.desk_models import SeatBooking, SeatCheckin
from app.core.orm import orm_session

from . import rules, service
from .zones import ZONE_TYPE, zone_name

TREND_DAYS = 10
HISTORY_LIMIT = 10
FAVOURITES_LIMIT = 4
FAVOURITE_WINDOW = timedelta(days=90)
NOT_A_USE = ("cancelled", "plan_changed", "checked_in")   # a checked-in booking is counted via its check-in


def _hhmm(at: datetime | None) -> str | None:
    return at.astimezone(rules.TZ).strftime("%H:%M") if at else None


def _minutes_to_hhmm(minutes: float) -> str:
    m = int(round(minutes))
    return f"{m // 60:02d}:{m % 60:02d}"


def seat_places() -> dict:
    """Every seat on a published floor: seat id -> {plan_id, plan_name, seat_label, zone}."""
    places = {}
    for plan in service.published_floors():
        live = plan.published_version
        zones = [el for el in live.elements if el.type == ZONE_TYPE]
        for el in live.elements:
            if el.type != "seat":
                continue
            zone = next((z for z in zones if z.x <= el.x < z.x + z.w and z.y <= el.y < z.y + z.h), None)
            places[el.element_id] = {"plan_id": str(plan.id), "plan_name": live.name, "seat_label": service.seat_label(el),
                                     "zone": zone_name(zone.label) if zone else None, "open_to_all": bool(el.open_to_all)}
    return places


def _where(places, seat_id, label=None) -> dict:
    """Floor and zone of a seat (from the published floors), falling back to the stored label."""
    place = places.get(seat_id) or {}
    return {"seat_id": str(seat_id), "seat_label": place.get("seat_label") or label, "plan_id": place.get("plan_id"),
            "plan_name": place.get("plan_name"), "zone": place.get("zone")}


def _current(viewer, places):
    c = service.open_checkin_of(viewer)
    if c is None:
        return None
    return {**_where(places, c.seat_id, c.seat_label), "checked_in_at": c.checked_in_at.isoformat(), "ends_at": c.ends_at.isoformat()}


def _upcoming(viewer, places, today, tomorrow, at):
    rows = orm_session().scalars(select(SeatBooking).where(
        SeatBooking.booked_for == viewer.id, SeatBooking.end_reason.is_(None), SeatBooking.ends_at > at,
        SeatBooking.booking_date.in_((today, tomorrow))).order_by(SeatBooking.starts_at)).all()
    return [{"id": str(b.id), **_where(places, b.seat_id, b.seat_label), "date": b.booking_date.isoformat(), "preset": b.preset,
             "starts_at": b.starts_at.isoformat(), "ends_at": b.ends_at.isoformat(),
             "booked_by_name": b.booked_by_name if b.booked_by and b.booked_by != viewer.id else None} for b in rows]


def _teams(viewer):
    return orm_session().execute(select(Department.id, Department.name).join(UserDepartment, UserDepartment.department_id == Department.id)
                                 .where(UserDepartment.user_id == viewer.id).order_by(Department.name)).all()


def _team(viewer, teams, places, today, tomorrow, at):
    session = orm_session()
    out = []
    for team_id, team_name in teams:
        users = session.scalars(select(User).join(UserDepartment, UserDepartment.user_id == User.id)
                                .where(UserDepartment.department_id == team_id, User.is_active.is_(True))).unique().all()
        others = {u.id: u for u in users if u.id != viewer.id}
        checkins = {c.user_id: c for c in session.scalars(select(SeatCheckin).where(
            SeatCheckin.user_id.in_(others), SeatCheckin.checked_out_at.is_(None)))} if others else {}
        bookings = session.scalars(select(SeatBooking).where(
            SeatBooking.booked_for.in_(others), SeatBooking.end_reason.is_(None),
            SeatBooking.booking_date.in_((today, tomorrow))).order_by(SeatBooking.starts_at)).all() if others else []
        first = {}
        for b in bookings:
            first.setdefault((b.booked_for, b.booking_date), b)
        members = []
        for uid, user in others.items():
            c, b_today, b_tomorrow = checkins.get(uid), first.get((uid, today)), first.get((uid, tomorrow))
            if c:
                now = {"state": "checked_in", **_where(places, c.seat_id, c.seat_label), "since": _hhmm(c.checked_in_at), "preset": None}
            elif b_today and b_today.ends_at > at:
                now = {"state": "booked", **_where(places, b_today.seat_id, b_today.seat_label), "since": None, "preset": b_today.preset}
            else:
                now = None
            later = {**_where(places, b_tomorrow.seat_id, b_tomorrow.seat_label), "preset": b_tomorrow.preset} if b_tomorrow else None
            if now or later:
                members.append({"name": user.full_name, "initials": service.initials(user.full_name), "today": now, "tomorrow": later})
        rank = {"checked_in": 0, "booked": 1}
        members.sort(key=lambda m: (rank.get((m["today"] or {}).get("state"), 2), m["name"].casefold()))
        out.append({"team_id": str(team_id), "team_name": team_name, "size": len(users), "members": members})
    return out


def _working_days(today, count):
    days, day = [], today
    while len(days) < count:
        if day.weekday() < 5:
            days.append(day)
        day -= timedelta(days=1)
    return list(reversed(days))


def _trend(viewer, today):
    days = _working_days(today, TREND_DAYS)
    start = datetime.combine(days[0], datetime.min.time(), rules.TZ)
    rows = orm_session().scalars(select(SeatCheckin).where(SeatCheckin.user_id == viewer.id, SeatCheckin.checked_in_at >= start)).all()
    per_day = defaultdict(list)
    for c in rows:
        per_day[c.checked_in_at.astimezone(rules.TZ).date()].append(c)
    out, arrivals, leaves = [], [], []
    for day in days:
        cs = per_day.get(day, [])
        first_in = min((c.checked_in_at for c in cs), default=None)
        last_out = max((c.checked_out_at or c.ends_at for c in cs), default=None)
        if first_in:
            local_in, local_out = first_in.astimezone(rules.TZ), last_out.astimezone(rules.TZ)
            arrivals.append(local_in.hour * 60 + local_in.minute)
            leaves.append(local_out.hour * 60 + local_out.minute)
        out.append({"date": day.isoformat(), "weekday": day.strftime("%a"), "check_in": _hhmm(first_in), "check_out": _hhmm(last_out)})
    return {"days": out, "days_in_office": len(arrivals),
            "usual_arrival": _minutes_to_hhmm(median(arrivals)) if arrivals else None,
            "usual_leave": _minutes_to_hhmm(median(leaves)) if leaves else None}


def _history(viewer, places):
    session = orm_session()
    bookings = session.scalars(select(SeatBooking).where(SeatBooking.booked_for == viewer.id)
                               .order_by(SeatBooking.starts_at.desc()).limit(HISTORY_LIMIT)).all()
    linked = {c.booking_id: c for c in session.scalars(select(SeatCheckin).where(
        SeatCheckin.booking_id.in_([b.id for b in bookings])))} if bookings else {}
    walk_ins = session.scalars(select(SeatCheckin).where(SeatCheckin.user_id == viewer.id, SeatCheckin.method == "walk_in")
                               .order_by(SeatCheckin.checked_in_at.desc()).limit(HISTORY_LIMIT)).all()
    items = []
    for b in bookings:
        c = linked.get(b.id)
        items.append((b.starts_at, {"date": b.booking_date.isoformat(), **_where(places, b.seat_id, b.seat_label), "kind": "booking",
                                    "outcome": b.end_reason or "active", "preset": b.preset,
                                    "from": _hhmm(c.checked_in_at) if c else None, "to": _hhmm(c.checked_out_at or c.ends_at) if c else None}))
    for c in walk_ins:
        items.append((c.checked_in_at, {"date": c.checked_in_at.astimezone(rules.TZ).date().isoformat(), **_where(places, c.seat_id, c.seat_label),
                                        "kind": "walk_in", "outcome": "checked_in", "preset": None,
                                        "from": _hhmm(c.checked_in_at), "to": _hhmm(c.checked_out_at or c.ends_at)}))
    items.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in items[:HISTORY_LIMIT]]


def _favourites(viewer, places, at):
    since = at - FAVOURITE_WINDOW
    session = orm_session()
    uses = defaultdict(lambda: [0, None])   # seat id -> [count, last used]
    def note(seat_id, when):
        entry = uses[seat_id]
        entry[0] += 1
        entry[1] = max(entry[1], when) if entry[1] else when
    for c in session.scalars(select(SeatCheckin).where(SeatCheckin.user_id == viewer.id, SeatCheckin.checked_in_at >= since)):
        note(c.seat_id, c.checked_in_at)
    for b in session.scalars(select(SeatBooking).where(SeatBooking.booked_for == viewer.id, SeatBooking.starts_at >= since)):
        if b.end_reason not in NOT_A_USE:
            note(b.seat_id, b.starts_at)
    ranked = sorted(((sid, n, last) for sid, (n, last) in uses.items() if sid in places), key=lambda t: (-t[1], -t[2].timestamp()))
    return [{**_where(places, sid), "count": n} for sid, n, _ in ranked[:FAVOURITES_LIMIT]]


def dashboard(viewer: User, at: datetime) -> dict:
    today = rules.local_today(at)
    tomorrow = today + timedelta(days=1)
    places = seat_places()
    from .autobook import run_auto_book, usual_seat   # local import: autobook uses this module's seat_places
    auto = run_auto_book(viewer, at, places)            # before reading bookings, so new ones show at once
    teams = _teams(viewer)
    return {"now": at.isoformat(), "today": today.isoformat(),
            "me": {"name": viewer.full_name, "teams": [{"id": str(t_id), "name": name} for t_id, name in teams]},
            "current": _current(viewer, places),
            "upcoming": _upcoming(viewer, places, today, tomorrow, at),
            "team": _team(viewer, teams, places, today, tomorrow, at),
            "trend": _trend(viewer, today),
            "history": _history(viewer, places),
            "favourites": _favourites(viewer, places, at),
            "usual_seat": usual_seat(viewer, places), "auto_book": auto}
