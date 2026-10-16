"""Insights: project teams today (+ Excel export) and recent activity (admins).

A check-in counts for the project teams the person was in when they checked in (seat_checkins
.user_department_ids). Someone in two teams counts in both rows, but once in the total.
"""
from datetime import datetime, timedelta

from flask import Response, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import select

from app.core.auth_models import Department, User
from app.core.desk_models import SeatCheckin
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required
from app.core.xlsx import write_xlsx
from app.desk import rules, service
from app.desk.dashboard import seat_places

from . import admin_bp

ACTIVITY_LIMIT = 5
NO_TEAM = "No project team"
ENDED = {"given_up": "checked out", "auto": "ended automatically", "plan_changed": "floor plan changed"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _hhmm(at):
    return at.astimezone(rules.TZ).strftime("%H:%M") if at else None


def _day_bounds(day):
    start = datetime.combine(day, datetime.min.time(), rules.TZ)
    return start, start + timedelta(days=1)


def _team_names():
    return dict(orm_session().execute(select(Department.id, Department.name).order_by(Department.name)).all())


def _today(at):
    session = orm_session()
    start, end = _day_bounds(rules.local_today(at))
    ins = session.scalars(select(SeatCheckin).where(SeatCheckin.checked_in_at >= start, SeatCheckin.checked_in_at < end)
                          .order_by(SeatCheckin.checked_in_at)).all()
    open_now = session.scalars(select(SeatCheckin).where(SeatCheckin.checked_out_at.is_(None), SeatCheckin.ends_at > at)).all()
    outs = session.scalars(select(SeatCheckin).where(SeatCheckin.checked_out_at >= start, SeatCheckin.checked_out_at < end)).all()
    return ins, open_now, outs


def _team_seats() -> dict:
    """Seats on published floors tagged to each project team (free-for-all seats belong to no team)."""
    counts = {}
    for plan in service.published_floors():
        for el in plan.published_version.elements:
            if el.type == "seat" and el.department_id and not el.open_to_all:
                counts[el.department_id] = counts.get(el.department_id, 0) + 1
    return counts


def teams_today(at) -> dict:
    names = _team_names()
    seats = _team_seats()
    ins, open_now, outs = _today(at)

    def of(team_id, rows):
        """Check-ins of a team (team_id None: people with no project team)."""
        if team_id is None:
            return [c for c in rows if not c.user_department_ids]
        return [c for c in rows if team_id in (c.user_department_ids or [])]

    def row(team_id, name):
        today_ins = of(team_id, ins)
        return {"team_id": str(team_id) if team_id else None, "name": name, "seats": seats.get(team_id, 0) if team_id else 0,
                "in_now": len(of(team_id, open_now)),
                "check_ins": len(today_ins), "check_outs": len(of(team_id, outs)),
                "people": sorted({c.user_name for c in today_ins}, key=str.casefold)}

    rows = [row(tid, name) for tid, name in names.items()]
    no_team = row(None, NO_TEAM)
    if no_team["in_now"] or no_team["check_ins"] or no_team["check_outs"]:
        rows.append(no_team)
    return {"date": rules.local_today(at).isoformat(), "rows": rows,
            "total": {"seats": sum(seats.get(t, 0) for t in names), "in_now": len(open_now), "check_ins": len(ins), "check_outs": len(outs),
                      "people": len({c.user_id or c.user_name for c in ins})}}


@admin_bp.get("/insights/teams")
@admin_required
def insights_teams():
    g.jwt_uid = get_jwt_identity()
    at = rules.now()
    service.settle(at)
    return jsonify(teams_today(at))


LINE_HEADERS = ("Date", "Person", "Username", "Project teams", "Seat", "Floor", "Zone", "Method", "Checked in", "Checked out", "Ended")


def check_in_lines(at, team=None) -> list[dict]:
    """Today's check-ins, one line each (Excel sheet 2 and the View pop-up). team: None (all), "none"
    (people with no project team) or a project team id."""
    names, places = _team_names(), seat_places()
    ins, _, _ = _today(at)
    if team == "none":
        ins = [c for c in ins if not c.user_department_ids]
    elif team is not None:
        ins = [c for c in ins if team in (c.user_department_ids or [])]
    users = dict(orm_session().execute(select(User.id, User.username).where(User.id.in_([c.user_id for c in ins if c.user_id]))).all()) if ins else {}
    out = []
    for c in ins:
        place = places.get(c.seat_id) or {}
        out.append({"date": rules.local_today(at).isoformat(), "person": c.user_name, "username": users.get(c.user_id, ""),
                    "teams": ", ".join(sorted((names.get(d, "") for d in (c.user_department_ids or [])), key=str.casefold)) or NO_TEAM,
                    "seat": place.get("seat_label") or c.seat_label, "floor": place.get("plan_name") or "", "zone": place.get("zone") or "",
                    "method": "walk-in" if c.method == "walk_in" else "booking", "checked_in": _hhmm(c.checked_in_at),
                    "checked_out": _hhmm(c.checked_out_at) or "", "ended": ENDED.get(c.end_reason, c.end_reason or "still in")})
    return out


@admin_bp.get("/insights/teams/lines")
@admin_required
def insights_team_lines():
    g.jwt_uid = get_jwt_identity()
    team = request.args.get("team") or None
    if team not in (None, "none"):
        team = service._uuid(team)
        if team is None:
            return error("validation failed", 400, fields={"team": "unknown project team"})
    at = rules.now()
    service.settle(at)
    return jsonify(items=check_in_lines(at, team))


@admin_bp.get("/insights/teams.xlsx")
@admin_required
def insights_teams_xlsx():
    g.jwt_uid = get_jwt_identity()
    at = rules.now()
    service.settle(at)
    data = teams_today(at)
    summary = [["Project team", "Total seats", "In now", "Check-ins", "Check-outs", "People"]]
    summary += [[r["name"], r["seats"], r["in_now"], r["check_ins"], r["check_outs"], ", ".join(r["people"])] for r in data["rows"]]
    t = data["total"]
    summary.append(["Total", t["seats"], t["in_now"], t["check_ins"], t["check_outs"], f"{t['people']} people"])

    keys = ("date", "person", "username", "teams", "seat", "floor", "zone", "method", "checked_in", "checked_out", "ended")
    lines = [list(LINE_HEADERS)] + [[line[k] for k in keys] for line in check_in_lines(at)]
    body = write_xlsx([("Project teams", summary), ("Check-ins", lines)])
    return Response(body, mimetype=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="project-teams-{data["date"]}.xlsx"'})


@admin_bp.get("/insights/activity")
@admin_required
def insights_activity():
    g.jwt_uid = get_jwt_identity()
    at = rules.now()
    service.settle(at)
    session = orm_session()
    ins = session.scalars(select(SeatCheckin).order_by(SeatCheckin.checked_in_at.desc()).limit(ACTIVITY_LIMIT)).all()
    outs = session.scalars(select(SeatCheckin).where(SeatCheckin.checked_out_at.is_not(None))
                           .order_by(SeatCheckin.checked_out_at.desc()).limit(ACTIVITY_LIMIT)).all()
    names, places = _team_names(), seat_places()
    events = [("check_in", c.checked_in_at, c) for c in ins] + [("check_out", c.checked_out_at, c) for c in outs]
    events.sort(key=lambda e: e[1], reverse=True)
    items = []
    for kind, when, c in events[:ACTIVITY_LIMIT]:
        place = places.get(c.seat_id) or {}
        items.append({"kind": kind, "at": when.astimezone(rules.TZ).isoformat(), "person": c.user_name,
                      "initials": service.initials(c.user_name),
                      "teams": sorted((names[d] for d in (c.user_department_ids or []) if d in names), key=str.casefold),
                      "seat_label": place.get("seat_label") or c.seat_label, "plan_name": place.get("plan_name"),
                      "zone": place.get("zone"), "ended": ENDED.get(c.end_reason) if kind == "check_out" else None})
    return jsonify(items=items)
