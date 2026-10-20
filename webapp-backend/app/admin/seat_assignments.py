"""Seat assignments: an admin-only record of who is assigned to which seat, with an end date.

Booking and check-in never read it. Spec: 2026-10-19-seat-assignments-design.
"""
import datetime as dt
import uuid

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.core.assignment_models import SeatAssignment
from app.core.audit import audit_row
from app.core.auth_models import User
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required
from app.desk import rules
from app.desk.dashboard import seat_places

from . import admin_bp

WINDOW_DAYS = 14
MAX_NOTE = 200
RACE = "That seat or person was just assigned by someone else. Reload and try again."


def status_of(end_date: dt.date | None, today: dt.date) -> str:
    """The end date is the person's last day: left once it has passed, leaving soon within WINDOW_DAYS."""
    if end_date is None:
        return "assigned"
    if end_date < today:
        return "left"
    return "leaving_soon" if end_date <= today + dt.timedelta(days=WINDOW_DAYS) else "assigned"


def assignment_dto(a: SeatAssignment, places: dict, today: dt.date) -> dict:
    place = places.get(a.seat_id)
    user = a.user
    return {"id": str(a.id), "seat_id": str(a.seat_id),
            "seat_label": place["seat_label"] if place else a.seat_label,
            "plan_id": place["plan_id"] if place else None,
            "plan_name": place["plan_name"] if place else a.plan_name,
            "seat_removed": place is None,
            "user": {"id": str(user.id), "full_name": user.full_name, "is_active": user.is_active} if user else None,
            "person_name": a.person_name,
            "end_date": a.end_date.isoformat() if a.end_date else None,
            "note": a.note, "status": status_of(a.end_date, today),
            "created_at": a.created_at.isoformat() if a.created_at else None}


def _today() -> dt.date:
    return rules.local_today(rules.now())


def _current():
    return select(SeatAssignment).where(SeatAssignment.closed_at.is_(None)).options(selectinload(SeatAssignment.user))


@admin_bp.get("/seat-assignments")
@admin_required
def list_seat_assignments():
    """Current assignments of one floor, plus every current assignment whose seat is no longer published."""
    try:
        plan_id = str(uuid.UUID(request.args.get("plan_id", "")))
    except ValueError:
        return error("validation failed", 400, fields={"plan_id": "choose a floor plan"})
    places = seat_places()
    today = _today()
    items = [assignment_dto(a, places, today) for a in orm_session().scalars(_current().order_by(SeatAssignment.created_at))]
    items = [i for i in items if i["plan_id"] == plan_id or i["seat_removed"]]
    return jsonify(items=items, today=today.isoformat())


def _validate(seat_id, body, places):
    """(fields, user, end_date, note)."""
    fields, user, end = {}, None, None
    if seat_id not in places:
        fields["seat_id"] = "choose a seat on a published floor plan"
    try:
        user = orm_session().get(User, uuid.UUID(str(body.get("user_id"))))
    except ValueError:
        user = None
    if user is None or not user.is_active:
        fields["user_id"] = "choose an active account"
        user = None
    raw = body.get("end_date")
    if raw not in (None, ""):
        try:
            end = dt.date.fromisoformat(raw)
        except (ValueError, TypeError):
            fields["end_date"] = "invalid date (use YYYY-MM-DD)"
    note = body.get("note")
    note = note.strip() if isinstance(note, str) else None
    if note and len(note) > MAX_NOTE:
        fields["note"] = f"at most {MAX_NOTE} characters"
    return fields, user, end, note or None


@admin_bp.put("/seat-assignments/seats/<uuid:seat_id>")
@admin_required
def put_seat_assignment(seat_id):
    """Assign a person to a seat, or change the end date / note of the current assignment."""
    actor = get_jwt_identity()
    g.jwt_uid = actor
    body = request.get_json(silent=True) or {}
    places = seat_places()
    fields, user, end, note = _validate(seat_id, body, places)
    if fields:
        return error("validation failed", 400, fields=fields)
    place = places[seat_id]
    session = orm_session()
    seat_row = session.scalars(_current().where(SeatAssignment.seat_id == seat_id)).first()
    person_row = session.scalars(_current().where(SeatAssignment.user_id == user.id)).first()
    other = person_row if person_row is not None and person_row is not seat_row else None
    if other is not None and body.get("move") is not True:
        label = (places.get(other.seat_id) or {}).get("seat_label") or other.seat_label
        return error(f"{user.full_name} already has seat {label}.", 409, needs_move=True, current_seat_label=label)
    actor_id = uuid.UUID(str(actor))
    try:
        if other is not None:
            other.closed_at, other.closed_by, other.closed_reason = func.now(), actor_id, "moved"
        if seat_row is not None and seat_row.user_id != user.id:
            seat_row.closed_at, seat_row.closed_by, seat_row.closed_reason = func.now(), actor_id, "reassigned"
        session.flush()     # free the old rows before the unique indexes see the new one
        if seat_row is not None and seat_row.user_id == user.id:
            seat_row.end_date, seat_row.note = end, note
            row, action = seat_row, "seat_assignment.change"
        else:
            row = SeatAssignment(seat_id=seat_id, user_id=user.id, person_name=user.full_name, seat_label=place["seat_label"],
                                 plan_name=place["plan_name"], end_date=end, note=note, created_by=actor_id)
            session.add(row)
            action = "seat_assignment.create"
        session.flush()
        audit_row(actor, action, row.id, {"seat_id": str(seat_id), "seat_label": place["seat_label"], "plan_name": place["plan_name"],
                                          "user_id": str(user.id), "person_name": user.full_name,
                                          "end_date": end.isoformat() if end else None})
        session.commit()
    except IntegrityError:
        session.rollback()
        return error(RACE, 409)
    session.refresh(row)
    return jsonify(assignment_dto(row, places, _today()))


@admin_bp.delete("/seat-assignments/<uuid:assignment_id>")
@admin_required
def clear_seat_assignment(assignment_id):
    """End a current assignment; the row stays as history."""
    actor = get_jwt_identity()
    g.jwt_uid = actor
    session = orm_session()
    row = session.scalars(_current().where(SeatAssignment.id == assignment_id)).first()
    if row is None:
        return error("assignment not found", 404)
    row.closed_at, row.closed_by, row.closed_reason = func.now(), uuid.UUID(str(actor)), "cleared"
    audit_row(actor, "seat_assignment.clear", row.id, {"seat_id": str(row.seat_id), "seat_label": row.seat_label,
                                                       "plan_name": row.plan_name, "user_id": str(row.user_id) if row.user_id else None,
                                                       "person_name": row.person_name})
    session.commit()
    return "", 204
