"""Signed-in seat booking and check-in endpoints (/api/desk)."""
from datetime import date
from functools import wraps

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import select

from app.admin.floorplan_publishing import _version_element_dto
from app.admin.floorplans import _catalog, _catalog_dto
from app.auth.routes import auth_required
from app.core.audit import write_audit
from app.core.auth_models import User
from app.core.desk_models import DashboardDisplay
from app.core.errors import error
from app.core.orm import orm_session

from . import desk_bp, rules, service
from .zones import drawn_zones
from .dashboard import dashboard as desk_dashboard
from .people import find_people, project_teams
from .autobook import usual_seat
from .dashboard import seat_places


def desk_endpoint(fn):
    """Signed-in user + settle(now) + DeskError → JSON error."""
    @auth_required
    @wraps(fn)
    def wrapper(*args, **kwargs):
        viewer = orm_session().get(User, get_jwt_identity())
        if viewer is None:
            return error("authentication required", 401)
        g.jwt_uid = str(viewer.id)
        at = rules.now()
        service.settle(at)
        try:
            return fn(viewer, at, *args, **kwargs)
        except service.DeskError as exc:
            return error(str(exc), exc.status)
    return wrapper


def _day_arg(at):
    text = request.args.get("date")
    if not text:
        return rules.local_today(at)
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise service.DeskError("date must be YYYY-MM-DD")


@desk_bp.get("/floors")
@desk_endpoint
def floors(viewer, at):
    return jsonify(items=[{"id": str(p.id), "name": p.published_version.name, "version": p.published_version.version}
                          for p in service.published_floors()],
                   days=[d.isoformat() for d in rules.bookable_days(at)])


@desk_bp.get("/floors/<plan_id>")
@desk_endpoint
def floor(viewer, at, plan_id):
    plan = service.published_plan(plan_id)
    day = _day_arg(at)
    if day not in rules.bookable_days(at):
        raise service.DeskError("only today or the next working day can be shown")
    preset = request.args.get("preset") or None
    if preset is not None and preset not in rules.PRESETS:
        raise service.DeskError(f"unknown booking slot '{preset}'")
    live = plan.published_version
    seats = service.seat_states(plan, day, preset, at, viewer)
    return jsonify(id=str(plan.id), name=live.name, cols=live.cols, rows=live.rows, version=live.version,
                   date=day.isoformat(), preset=preset,
                   elements=[_version_element_dto(el) for el in live.elements],
                   seats=seats, zones=drawn_zones(live.elements, seats),
                   catalog=[_catalog_dto(entry) for entry in _catalog().values()])


@desk_bp.post("/bookings")
@desk_endpoint
def create_booking(viewer, at):
    body = request.get_json(silent=True) or {}
    booking = service.create_booking(viewer, body.get("plan_id"), body.get("seat_id"), body.get("date"),
                                     body.get("preset"), body.get("user_id"), at)
    write_audit(str(viewer.id), "booking.create", str(booking.id),
                {**service._booking_details(booking), "booked_for": str(booking.booked_for)})
    return jsonify(service.booking_dto(booking)), 201


@desk_bp.get("/bookings/mine")
@desk_endpoint
def my_bookings(viewer, at):
    return jsonify(items=[service.booking_dto(b) for b in service.my_bookings(viewer, at)])


@desk_bp.delete("/bookings/<booking_id>")
@desk_endpoint
def cancel_booking(viewer, at, booking_id):
    booking = service.cancel_booking(viewer, booking_id, at)
    write_audit(str(viewer.id), "booking.cancel", str(booking.id), service._booking_details(booking))
    return ("", 204)


@desk_bp.get("/colleagues")
@desk_endpoint
def colleagues(viewer, at):
    day = _day_arg(at)
    people = service.colleagues(viewer, (request.args.get("q") or "").strip(), day)
    used = service.allowance_used(viewer, day)
    return jsonify(items=[{"id": str(u.id), "name": u.full_name, "initials": service.initials(u.full_name)}
                          for u in people],
                   allowance={"limit": None, "used": used, "left": None} if service.is_admin(viewer)   # admins: no limit
                   else {"limit": viewer.booking_allowance, "used": used, "left": max(viewer.booking_allowance - used, 0)})


@desk_bp.get("/seats/<seat_id>")
@desk_endpoint
def seat(viewer, at, seat_id):
    return jsonify(service.seat_info(viewer, seat_id, at))


@desk_bp.post("/seats/<seat_id>/check-in")
@desk_endpoint
def check_in(viewer, at, seat_id):
    location = service.parse_location(request.get_json(silent=True) or {}, at)
    checkin, warning = service.check_in(viewer, seat_id, at, location)
    write_audit(str(viewer.id), "checkin.start", str(checkin.id),
                {**service._checkin_details(checkin), "method": checkin.method, **service.location_details(checkin)})
    return jsonify({**service.checkin_dto(checkin), "warning": warning}), 201


@desk_bp.post("/seats/<seat_id>/give-up")
@desk_endpoint
def give_up(viewer, at, seat_id):
    checkin = service.give_up(viewer, seat_id, at)
    write_audit(str(viewer.id), "checkin.end", str(checkin.id), {**service._checkin_details(checkin), "reason": "given_up"})
    return ("", 204)


@desk_bp.get("/seats/<seat_id>/activity")
@desk_endpoint
def seat_activity(viewer, at, seat_id):
    return jsonify(items=service.seat_activity(seat_id, at))


@desk_bp.get("/people")
@desk_endpoint
def people(viewer, at):
    team = request.args.get("team") or None
    team_id = service._uuid(team) if team else None
    if team and team_id is None:
        raise service.DeskError("unknown project team")
    return jsonify(items=find_people(request.args.get("q", ""), at, team_id))


@desk_bp.get("/teams")
@desk_endpoint
def teams(viewer, at):
    return jsonify(items=project_teams())


@desk_bp.get("/dashboard")
@desk_endpoint
def dashboard(viewer, at):
    return jsonify(desk_dashboard(viewer, at))


@desk_bp.get("/displays")
@desk_endpoint
def displays(viewer, at):
    """Displays by name, for the Floor overview picker (it then reads /api/public/displays/<slug>)."""
    rows = orm_session().execute(select(DashboardDisplay.name, DashboardDisplay.slug).order_by(DashboardDisplay.name)).all()
    return jsonify(items=[{"name": name, "slug": slug} for name, slug in rows])


@desk_bp.get("/me")
@desk_endpoint
def me(viewer, at):
    mine = service.open_checkin_of(viewer)
    return jsonify(user_id=str(viewer.id), checkin=service.checkin_dto(mine) if mine else None,
                   usual_seat=usual_seat(viewer, seat_places()), auto_book=viewer.auto_book)


@desk_bp.patch("/me")
@desk_endpoint
def update_me(viewer, at):
    body = request.get_json(silent=True) or {}
    if type(body.get("auto_book")) is not bool:
        raise service.DeskError("auto_book must be true or false")
    viewer.auto_book = body["auto_book"]
    orm_session().commit()
    write_audit(str(viewer.id), "user.auto_book", str(viewer.id), {"auto_book": viewer.auto_book})
    return jsonify(auto_book=viewer.auto_book)
