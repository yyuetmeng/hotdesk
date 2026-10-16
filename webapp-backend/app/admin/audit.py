"""Audit log for admins (spec 2026-10-16-audit-views §1-2).

GET /api/admin/audit             filtered, newest first, with a readable summary per entry and counts per category
GET /api/admin/audit.xlsx        the same filters as an Excel file (up to 5,000 rows)
GET /api/admin/audit/security-summary   failed sign-ins today, locked accounts, invitations not accepted
Entries older than AUDIT_RETENTION_DAYS (default 365) are deleted when the log is read.
"""
import uuid
from datetime import date, datetime, timedelta

from flask import Response, current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import Text, cast, delete, func, or_, select, union_all

from app.auth.routes import MAX_FAILED_ATTEMPTS
from app.core.audit import write_audit
from app.core.auth_models import AuditLog, User
from app.core.desk_models import DashboardDisplay
from app.core.errors import error
from app.core.floorplan_models import FloorPlan
from app.core.orm import orm_session
from app.core.security import admin_required
from app.core.xlsx import write_xlsx
from app.desk import rules
from app.desk.dashboard import seat_places

from . import admin_bp

PAGE_SIZE = 50
EXPORT_LIMIT = 5000
CATEGORIES = {"security": ("auth.", "account.", "password_reset."), "users": ("user.",), "teams": ("department.",),
              "floor_plans": ("floorplan.",), "displays": ("display.",), "desks": ("booking.", "checkin."),
              "exports": ("insights.", "desk_label.")}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def category_of(action: str) -> str:
    return next((name for name, prefixes in CATEGORIES.items() if action.startswith(prefixes)), "other")


def _category_clause(name):
    return or_(*[AuditLog.action.startswith(p) for p in CATEGORIES[name]])


MIN_RETENTION_DAYS, DEFAULT_RETENTION_DAYS = 30, 365


def _purge():
    """Delete entries older than AUDIT_RETENTION_DAYS (at least 30 days, so a bad setting cannot wipe the log)."""
    try:
        days = int(current_app.config.get("AUDIT_RETENTION_DAYS") or DEFAULT_RETENTION_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_RETENTION_DAYS
    days = max(days, MIN_RETENTION_DAYS)
    session = orm_session()
    session.execute(delete(AuditLog).where(AuditLog.created_at < func.now() - timedelta(days=days)))
    session.commit()


def _uuid(text):
    try:
        return uuid.UUID(str(text))
    except (TypeError, ValueError):
        return None


def _filters():
    """(clauses without the category, the category clause or None) from the query string; raises ValueError."""
    args, clauses = request.args, []
    for key, column in (("actor", AuditLog.actor_id), ("target", AuditLog.target_id)):
        if args.get(key):
            value = _uuid(args[key])
            if value is None:
                raise ValueError(f"{key} must be an id")
            clauses.append(column == value)
    if args.get("subject"):
        subject = _uuid(args["subject"])
        if subject is None:
            raise ValueError("subject must be an id")
        clauses.append(or_(AuditLog.actor_id == subject, AuditLog.target_id == subject))
    for key, op in (("from", "ge"), ("to", "lt")):
        if args.get(key):
            try:
                day = date.fromisoformat(args[key])
            except ValueError:
                raise ValueError(f"{key} must be YYYY-MM-DD")
            start = datetime.combine(day + (timedelta(days=1) if op == "lt" else timedelta()), datetime.min.time(), rules.TZ)
            clauses.append(AuditLog.created_at >= start if op == "ge" else AuditLog.created_at < start)
    if args.get("q"):
        like = f"%{args['q'].strip()}%"
        clauses.append(or_(AuditLog.actor_name.ilike(like), AuditLog.action.ilike(like), cast(AuditLog.details, Text).ilike(like)))
    category = args.get("category") or None
    if category and category not in CATEGORIES:
        raise ValueError("unknown category")
    return clauses, (_category_clause(category) if category else None)


def _names(entries):
    """Display names for targets: users, floor plans and displays."""
    ids = {e.target_id for e in entries if e.target_id}
    if not ids:
        return {}
    query = union_all(select(User.id, User.full_name).where(User.id.in_(ids)),
                      select(FloorPlan.id, FloorPlan.name).where(FloorPlan.id.in_(ids)),
                      select(DashboardDisplay.id, DashboardDisplay.name).where(DashboardDisplay.id.in_(ids)))
    return dict(orm_session().execute(query).all())


class _LazyPlaces:
    """Seat places loaded only if an entry needs a seat label it did not store (older entries)."""

    def __init__(self):
        self._places = None

    def get(self, key, default=None):
        if self._places is None:
            self._places = seat_places()
        return self._places.get(key, default)


def describe(e: AuditLog, target: str | None, places) -> str:
    """A readable sentence for an audit entry; falls back to "<who>: <action>" if its details are malformed."""
    try:
        return _describe(e, target, places)
    except Exception:   # noqa: BLE001 - one malformed entry must not break the log, History tabs or lists
        return f"{e.actor_name or ('System' if e.actor_id is None else 'Someone')}: {e.action}"


def _describe(e: AuditLog, target: str | None, places) -> str:
    d = e.details if isinstance(e.details, dict) else {}
    who = e.actor_name or ("System" if e.actor_id is None else "Someone")
    seat = d.get("seat_label") or ((places.get(_uuid(d.get("seat_id"))) or {}).get("seat_label") if d.get("seat_id") else None) or "a seat"
    where = f"{seat}{' · ' + d['plan_name'] if d.get('plan_name') else ''}"
    person = d.get("user_name")
    target = target or d.get("name") or d.get("slug") or d.get("email") or "an item"
    a = e.action
    texts = {
        "auth.login_success": f"{who} signed in" + (" (kept signed in on this device)" if d.get("remember") else ""),
        "auth.login_failed": f"Failed sign-in for “{d.get('identifier', '?')}”",
        "account.locked": f"{target} was locked after {d.get('failed_attempts', 'several')} failed sign-ins",
        "account.activated": f"{target} activated their account",
        "password_reset.requested": f"{target} asked for a password reset",
        "password_reset.completed": f"{target} reset their password",
        "user.create": f"{who} created user {target}",
        "user.invitation_sent": f"{who} sent an invitation to {d.get('email', target)}",
        "user.update": f"{who} changed {', '.join(str(f).replace('_', ' ') for f in (d.get('fields') or []) if f is not None) or 'details'} for {target}",
        "user.departments_updated": f"{who} changed the project teams of {target}",
        "user.enable": f"{who} enabled {target}",
        "user.disable": f"{who} disabled {target}",
        "user.delete": f"{who} deleted user {target}",
        "user.password_reset": f"{who} set a new password for {target}",
        "user.auto_book": f"{who} turned auto-booking {'on' if d.get('auto_book') else 'off'}",
        "department.create": f"{who} created project team {d.get('name', '')}".strip(),
        "department.update": f"{who} changed project team {d.get('name', '') or ''}".strip(),
        "department.delete": f"{who} deleted project team {d.get('name', '')} ({d.get('user_count', 0)} members)",
        "floorplan.create": f"{who} created floor plan {target}",
        "floorplan.update": f"{who} changed floor plan {target}",
        "floorplan.delete": f"{who} deleted floor plan {target}",
        "floorplan.elements_saved": f"{who} saved floor plan {target} ({d.get('count', '?')} elements)",
        "floorplan.publish": f"{who} published floor plan {target} (v{d.get('version', '?')})",
        "floorplan.unpublish": f"{who} unpublished floor plan {target}",
        "floorplan.discard": f"{who} discarded the draft of floor plan {target}",
        "display.create": f"{who} created display {target}",
        "display.update": f"{who} changed display {target}",
        "display.delete": f"{who} deleted display {target}",
        "booking.create": f"{who} booked {where}" + (f" for {person}" if person and person != who else "") + (f" ({d['date']})" if d.get("date") else ""),
        "booking.cancel": f"{who} cancelled a booking for {where}",
        "booking.released": f"Released {where} for {person or 'someone'} (no check-in)",
        "booking.auto_created": f"Auto-booked {where} for {person or who}" + (f" ({d['date']})" if d.get("date") else ""),
        "booking.plan_changed": f"Cancelled {person or 'a'}{chr(39) + 's' if person else ''} booking for {where} (floor plan changed)",
        "checkin.start": f"{who} checked in at {where}" + (" (walk-in)" if d.get("method") == "walk_in" else ""),
        "checkin.end": f"{who} gave up {where}",
        "checkin.auto_ended": f"{person or 'Someone'} was checked out of {where} automatically",
        "checkin.plan_changed": f"Ended {person or 'a'}{chr(39) + 's' if person else ''} check-in at {where} (floor plan changed)",
        "insights.exported": f"{who} exported {str(d.get('kind', 'data')).replace('_', ' ')} to Excel",
        "desk_label.downloaded": f"{who} downloaded {d.get('count', '?')} desk label{'s' if d.get('count') != 1 else ''}",
    }
    return texts.get(a, f"{who}: {a}")


def _dto(e, names, places):
    target = names.get(e.target_id)
    return {"id": e.id, "at": e.created_at.astimezone(rules.TZ).isoformat(), "actor_id": str(e.actor_id) if e.actor_id else None,
            "actor_name": e.actor_name, "action": e.action, "category": category_of(e.action),
            "target_id": str(e.target_id) if e.target_id else None, "target_name": target, "details": e.details or {},
            "summary": describe(e, target, places)}


def audit_page(clauses, category_clause, page: int, page_size: int = PAGE_SIZE):
    session = orm_session()
    where = clauses + ([category_clause] if category_clause is not None else [])
    total = session.scalar(select(func.count()).select_from(AuditLog).where(*where))
    rows = session.scalars(select(AuditLog).where(*where).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
                           .offset((page - 1) * page_size).limit(page_size)).all()
    names, places = _names(rows), _LazyPlaces()
    return total, [_dto(e, names, places) for e in rows]


@admin_bp.get("/audit")
@admin_required
def audit_list():
    g.jwt_uid = get_jwt_identity()
    _purge()
    try:
        clauses, category_clause = _filters()
        page = max(int(request.args.get("page", 1)), 1)
        size = min(max(int(request.args.get("page_size", PAGE_SIZE)), 1), 200)
    except ValueError as exc:
        return error("validation failed", 400, fields={"filters": str(exc)})
    total, items = audit_page(clauses, category_clause, page, size)
    session = orm_session()
    row = session.execute(select(*[func.count().filter(_category_clause(name)) for name in CATEGORIES])
                          .select_from(AuditLog).where(*clauses)).one()
    counts = dict(zip(CATEGORIES, row))
    return jsonify(items=items, total=total, page=page, page_size=size, counts=counts)


@admin_bp.get("/audit.xlsx")
@admin_required
def audit_export():
    actor = get_jwt_identity()
    g.jwt_uid = actor
    try:
        clauses, category_clause = _filters()
    except ValueError as exc:
        return error("validation failed", 400, fields={"filters": str(exc)})
    _, items = audit_page(clauses, category_clause, 1, EXPORT_LIMIT)
    rows = [["When", "Category", "Who", "What", "Target", "Action"]]
    rows += [[i["at"][:16].replace("T", " "), i["category"].replace("_", " "), i["actor_name"] or ("System" if not i["actor_id"] else ""),
              i["summary"], i["target_name"] or "", i["action"]] for i in items]
    write_audit(actor, "insights.exported", None, {"kind": "audit_log", "rows": len(items)})
    stamp = rules.local_today(rules.now()).isoformat()
    return Response(write_xlsx([("Audit log", rows)]), mimetype=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="audit-log-{stamp}.xlsx"'})


@admin_bp.get("/audit/security-summary")
@admin_required
def security_summary():
    g.jwt_uid = get_jwt_identity()
    session = orm_session()
    start = datetime.combine(rules.local_today(rules.now()), datetime.min.time(), rules.TZ)
    return jsonify(
        failed_today=session.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.action == "auth.login_failed", AuditLog.created_at >= start)),
        locked=session.scalar(select(func.count()).select_from(User).where(User.failed_attempts >= MAX_FAILED_ATTEMPTS)),
        pending=session.scalar(select(func.count()).select_from(User).where(User.password_hash.is_(None))))


def last_changes(target_ids) -> dict:
    """The latest audit entry per target id: {id: {summary, actor_name, at}} (plans and displays lists)."""
    ids = [i for i in target_ids if i]
    if not ids:
        return {}
    rows = orm_session().scalars(select(AuditLog).where(AuditLog.target_id.in_(ids))
                                 .distinct(AuditLog.target_id).order_by(AuditLog.target_id, AuditLog.created_at.desc())).all()
    names, places = _names(rows), _LazyPlaces()
    return {e.target_id: {"summary": describe(e, names.get(e.target_id), places), "actor_name": e.actor_name,
                          "at": e.created_at.astimezone(rules.TZ).isoformat()} for e in rows}


def history_for(target_id) -> list[dict]:
    """A target's audit entries, newest first, with consecutive saves by the same person collapsed into one."""
    rows = orm_session().scalars(select(AuditLog).where(AuditLog.target_id == target_id)
                                 .order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(200)).all()
    names, places = _names(rows), _LazyPlaces()
    out = []
    for e in rows:
        item = _dto(e, names, places)
        prev = out[-1] if out else None
        if prev and e.action == "floorplan.elements_saved" and prev["action"] == e.action and prev["actor_id"] == item["actor_id"]:
            prev["times"] += 1
            prev["summary"] = f"{e.actor_name or 'Someone'} saved floor plan {names.get(e.target_id) or 'the plan'} ({prev['times']} saves)"
            continue
        item["times"] = 1
        out.append(item)
    return out
