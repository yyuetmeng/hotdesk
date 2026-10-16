import re
import uuid

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.audit import write_audit
from app.core.errors import error
from app.core.auth_models import Department, User
from app.core.floorplan_models import FloorElement, FloorPlan, FloorPlanElement
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp

MIN_DIM, MAX_DIM = 5, 80
MAX_ELEMENT_SIZE = 20
ZONE_TYPE = "zone"  # outline grouping the seats inside it; own layer, up to the grid size
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ROTATIONS = (0, 90, 180, 270)


def _catalog() -> dict[str, FloorElement]:
    """Element catalog from the floor_elements table, in palette order (loaded once per request)."""
    if "floor_catalog" not in g:
        rows = orm_session().scalars(
            select(FloorElement).order_by(FloorElement.sort_order, FloorElement.type)).all()
        g.floor_catalog = {row.type: row for row in rows}
    return g.floor_catalog


def _catalog_dto(entry: FloorElement) -> dict:
    return {"type": entry.type, "label": entry.label, "w": entry.w, "h": entry.h,
            "color": entry.color, "resizable": entry.resizable, "config": entry.config}


def _size(w: int, h: int, rotation: int):
    return (h, w) if rotation in (90, 270) else (w, h)


def _config_with_defaults(entry: FloorElement, config: dict | None) -> dict:
    stored = config or {}
    return {key: stored.get(key, default) for key, default in entry.config.items()}


def _config_problems(entry: FloorElement, config) -> list[str]:
    if config is None:
        return []
    if not isinstance(config, dict):
        return ["config must be an object"]
    problems = []
    for key, value in config.items():
        if key not in entry.config:
            problems.append(f"config '{key}' is not supported for {entry.type}")
        elif type(value) is not type(entry.config[key]):
            problems.append(f"config '{key}' must be {type(entry.config[key]).__name__}")
    return problems


def _element_dto(el: FloorPlanElement) -> dict:
    entry = _catalog().get(el.type)
    return {"id": str(el.id), "type": el.type, "x": el.x, "y": el.y,
            "w": el.w, "h": el.h, "rotation": el.rotation,
            "label": el.label, "color": el.color,
            "config": _config_with_defaults(entry, el.config) if entry else (el.config or {}),
            **_tag_dto(el)}


def _tag_dto(el) -> dict:
    """Seat department tag (spec 2026-10-15-seat-department-tags §5); non-seats are never tagged."""
    return {"department_id": str(el.department_id) if el.department_id else None,
            "open_to_all": bool(el.open_to_all)}


def _tag_problems(el: dict, known_departments: set[str]) -> list[str]:
    dept, open_to_all = el.get("department_id"), el.get("open_to_all", False)
    if not dept and not open_to_all:
        return []
    if el.get("type") != "seat":
        return ["only seats can have a project team"]
    if dept and open_to_all:
        return ["choose a project team or free for all, not both"]
    if not isinstance(open_to_all, bool):
        return ["open_to_all must be true or false"]
    # A well-formed id of a department that no longer exists is not an error: deleting a
    # department silently untags its seats, also for editors opened before the delete
    # (_normalized saves those seats untagged). Only malformed ids are rejected.
    if dept and _element_uuid({"id": dept}) is None:
        return ["unknown project team id"]
    return []


def _known_or_none(dept, known_departments: set[str]) -> str | None:
    dept_id = _element_uuid({"id": dept})
    return dept_id if dept_id in known_departments else None


def _known_departments(raw) -> set[str]:
    ids = {_element_uuid({"id": el.get("department_id")}) for el in raw if isinstance(el, dict)}
    ids.discard(None)
    if not ids:
        return set()
    return {str(d) for d in orm_session().scalars(select(Department.id).where(Department.id.in_(ids)))}


def _get_plan(plan_id: str) -> FloorPlan | None:
    try:
        pid = plan_id if isinstance(plan_id, uuid.UUID) else uuid.UUID(str(plan_id))
    except ValueError:
        return None
    return orm_session().get(FloorPlan, pid)


def plan_status(plan: FloorPlan) -> str:
    """draft | published | changed | unpublished (docs/superpowers/specs/2026-10-15-floorplan-publishing-design.md §3)."""
    live = plan.published_version
    if live is None:
        return "unpublished" if plan.unpublished_at else "draft"
    if plan.draft_changed_at and plan.draft_changed_at > live.published_at:
        return "changed"
    return "published"


def _publish_fields(plan: FloorPlan) -> dict:
    live = plan.published_version
    return {"status": plan_status(plan),
            "published_version": live.version if live else None,
            "published_at": live.published_at.isoformat() if live else None}


def _plan_payload(plan: FloorPlan) -> dict:
    live = plan.published_version
    publisher = orm_session().get(User, live.published_by) if live and live.published_by else None
    return {"id": str(plan.id), "name": plan.name, "cols": plan.cols, "rows": plan.rows,
            "updated_at": plan.updated_at.isoformat(), **_publish_fields(plan),
            "published_by": publisher.full_name if publisher else None,
            "elements": [_element_dto(el) for el in plan.elements]}


@admin_bp.get("/floor-plans/catalog")
@admin_required
def floorplan_catalog():
    g.jwt_uid = get_jwt_identity()
    return jsonify(items=[_catalog_dto(entry) for entry in _catalog().values()])


@admin_bp.get("/floor-plans")
@admin_required
def list_plans():
    g.jwt_uid = get_jwt_identity()
    session = orm_session()
    plans = session.scalars(select(FloorPlan).order_by(FloorPlan.created_at.desc())).all()
    from .audit import last_changes   # local import: audit imports app.desk, which imports this module
    changes = last_changes([p.id for p in plans])
    return jsonify(items=[
        {"id": str(p.id), "name": p.name, "cols": p.cols, "rows": p.rows, "last_change": changes.get(p.id),
         "element_count": session.scalar(
             select(func.count()).select_from(FloorPlanElement)
             .where(FloorPlanElement.plan_id == p.id)),
         "updated_at": p.updated_at.isoformat(), **_publish_fields(p)}
        for p in plans])


def _validate_dims(body: dict, fields: dict, defaults=None):
    """Validate cols/rows in body, falling back to defaults when absent. Returns (cols, rows)."""
    defaults = defaults or {}
    cols_in, rows_in = "cols" in body, "rows" in body
    try:
        cols = int(body["cols"]) if cols_in else defaults.get("cols")
        rows = int(body["rows"]) if rows_in else defaults.get("rows")
    except (TypeError, ValueError):
        if cols_in:
            fields["cols"] = "cols and rows must be integers"
        if rows_in:
            fields["rows"] = "cols and rows must be integers"
        return None, None
    if cols is not None and not (MIN_DIM <= cols <= MAX_DIM):
        fields["cols"] = f"cols must be between {MIN_DIM} and {MAX_DIM}"
    if rows is not None and not (MIN_DIM <= rows <= MAX_DIM):
        fields["rows"] = f"rows must be between {MIN_DIM} and {MAX_DIM}"
    return cols, rows


@admin_bp.post("/floor-plans")
@admin_required
def create_plan():
    body = request.get_json(silent=True) or {}
    fields = {}
    name = (body.get("name") or "").strip()
    if not (1 <= len(name) <= 120):
        fields["name"] = "name is required (1-120 characters)"
    cols, rows = _validate_dims(body, fields)
    if "cols" not in body:
        fields["cols"] = "cols is required"
    if "rows" not in body:
        fields["rows"] = "rows is required"
    if fields:
        return error("validation failed", 400, fields=fields)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    session = orm_session()
    plan = FloorPlan(name=name, cols=cols, rows=rows, created_by=actor)
    session.add(plan)
    session.commit()
    write_audit(actor, "floorplan.create", str(plan.id), {"name": name, "cols": cols, "rows": rows})
    return jsonify(_plan_payload(plan)), 201


@admin_bp.get("/floor-plans/<uuid:plan_id>")
@admin_required
def get_plan(plan_id):
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(str(plan_id))
    if plan is None:
        return error("plan not found", 404)
    return jsonify(_plan_payload(plan))


@admin_bp.patch("/floor-plans/<uuid:plan_id>")
@admin_required
def update_plan(plan_id):
    plan_id = str(plan_id)
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    body = request.get_json(silent=True) or {}
    if not body:
        return error("no fields provided", 400)
    unknown = set(body) - {"name", "cols", "rows"}
    fields = {k: "unknown field" for k in sorted(unknown)}

    name = None
    if "name" in body:
        name = (body["name"] or "").strip()
        if not (1 <= len(name) <= 120):
            fields["name"] = "name is required (1-120 characters)"

    new_cols, new_rows = _validate_dims(
        body, fields, defaults={"cols": plan.cols, "rows": plan.rows})

    if not fields and (new_cols, new_rows) != (plan.cols, plan.rows):
        strayed = sum(1 for el in plan.elements
                      if el.x + _size(el.w, el.h, el.rotation)[0] > new_cols
                      or el.y + _size(el.w, el.h, el.rotation)[1] > new_rows)
        if strayed:
            fields["elements"] = f"{strayed} elements fall outside the new grid; move them first"

    if fields:
        return error("validation failed", 400, fields=fields)

    if "name" in body:
        plan.name = name
    plan.cols, plan.rows = new_cols, new_rows
    # updated_at is a SQL expression (func.now()) until the row round-trips; the
    # session is expire_on_commit=False, so expire() is required below to force
    # a reload before _plan_payload() reads it as a real datetime.
    plan.updated_at = func.now()
    _mark_draft_changed(plan)
    session = orm_session()
    session.commit()
    actor = get_jwt_identity()
    write_audit(actor, "floorplan.update", plan_id, {"fields": sorted(body)})
    session.expire(plan)
    return jsonify(_plan_payload(plan))


@admin_bp.delete("/floor-plans/<uuid:plan_id>")
@admin_required
def delete_plan(plan_id):
    plan_id = str(plan_id)
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    name = plan.name
    from app.desk import rules, service  # local import: app.desk imports the admin modules

    service.cancel_for_plan_change(plan, rules.now(), removed=True, actor_id=get_jwt_identity())
    session = orm_session()
    session.delete(plan)
    session.commit()
    actor = get_jwt_identity()
    write_audit(actor, "floorplan.delete", plan_id, {"name": name})
    return ("", 204)


def _base_size(entry: FloorElement, el: dict):
    """(w, h) for an element payload: its own size, or the catalog default when absent.
    Returns (None, message) when invalid."""
    w, h = el.get("w", entry.w), el.get("h", entry.h)
    if type(w) is not int or type(h) is not int:
        return None, "w and h must be integers"
    if not entry.resizable and (w, h) != (entry.w, entry.h):
        return None, f"{entry.type} size is fixed at {entry.w}x{entry.h}"
    cap = MAX_DIM if entry.type == ZONE_TYPE else MAX_ELEMENT_SIZE
    if not (1 <= w <= cap and 1 <= h <= cap):
        return None, f"w and h must be between 1 and {cap}"
    return (w, h), None


def _element_uuid(el: dict) -> str | None:
    """The element's id if it is a UUID (an existing element); None for new ones (no id, or an
    editor-side temporary id such as "local-...")."""
    try:
        return str(uuid.UUID(str(el.get("id"))))
    except (ValueError, TypeError, AttributeError):
        return None


def _mark_draft_changed(plan: FloorPlan) -> None:
    plan.draft_changed_at = func.now()


def _validate_elements(raw, cols, rows, existing_ids: set[str]):
    catalog = _catalog()
    known_departments = _known_departments(raw)
    problems, seen_ids = [], set()
    layers = {True: {}, False: {}}  # zones only clash with zones, other elements with each other
    for i, el in enumerate(raw):
        etype = el.get("type") if isinstance(el, dict) else None
        if etype not in catalog:
            problems.append(f"element {i}: unknown type '{etype}'")
            continue
        el_id = _element_uuid(el)
        if el_id is not None:
            if el_id not in existing_ids:
                problems.append(f"element {i}: unknown element id")
            elif el_id in seen_ids:
                problems.append(f"element {i}: duplicate element id")
            seen_ids.add(el_id)
        entry = catalog[etype]
        problems.extend(f"element {i}: {p}" for p in _tag_problems(el, known_departments))
        try:
            x, y, rotation = int(el.get("x")), int(el.get("y")), int(el.get("rotation", 0))
        except (TypeError, ValueError):
            problems.append(f"element {i}: x, y and rotation must be integers")
            continue
        if rotation not in ROTATIONS:
            problems.append(f"element {i}: rotation must be one of 0, 90, 180, 270")
            continue
        if etype == ZONE_TYPE and rotation != 0:
            problems.append(f"element {i}: zones cannot be rotated")
            continue
        color = el.get("color")
        if color and not COLOR_RE.match(str(color)):
            problems.append(f"element {i}: color must be #rrggbb")
        label = el.get("label")
        if label is not None and len(str(label)) > 60:
            problems.append(f"element {i}: label must be 60 characters or fewer")
        problems.extend(f"element {i}: {p}" for p in _config_problems(entry, el.get("config")))
        base, size_problem = _base_size(entry, el)
        if size_problem:
            problems.append(f"element {i}: {size_problem}")
            continue
        w, h = _size(*base, rotation)
        if x < 0 or y < 0 or x + w > cols or y + h > rows:
            problems.append(f"element {i} ({etype}): outside the {cols}x{rows} grid")
            continue
        cells = [(x + dx, y + dy) for dx in range(w) for dy in range(h)]
        seen = layers[etype == ZONE_TYPE]
        clash = next((c for c in cells if c in seen), None)
        if clash is not None:
            problems.append(f"element {i} ({etype}) overlaps element {seen[clash]}")
            continue
        for c in cells:
            seen[c] = i
    return problems


def _normalized(raw):
    catalog, out = _catalog(), []
    known_departments = _known_departments(raw)
    for item in raw:
        entry = catalog[item["type"]]
        (w, h), _ = _base_size(entry, item)
        out.append({"type": item["type"], "x": int(item["x"]), "y": int(item["y"]),
                    "w": w, "h": h, "rotation": int(item.get("rotation", 0)),
                    "label": (item.get("label") or None), "color": (item.get("color") or None),
                    "config": _config_with_defaults(entry, item.get("config")),
                    "department_id": (_known_or_none(item.get("department_id"), known_departments)
                                      if item["type"] == "seat" else None),
                    "open_to_all": item["type"] == "seat" and item.get("open_to_all") is True})
    return out


@admin_bp.put("/floor-plans/<uuid:plan_id>/elements")
@admin_required
def save_elements(plan_id):
    plan_id = str(plan_id)
    g.jwt_uid = get_jwt_identity()
    session = orm_session()
    plan = _get_plan(plan_id)
    if plan is None:
        return error("plan not found", 404)
    body = request.get_json(silent=True) or {}
    raw = body.get("elements")
    if not isinstance(raw, list):
        return error("validation failed", 400, fields={"elements": ["elements must be a list"]})
    existing = {str(el.id): el for el in plan.elements}
    problems = _validate_elements(raw, plan.cols, plan.rows, set(existing))
    if problems:
        return error("validation failed", 400, fields={"elements": problems})
    # Element ids are permanent: update existing rows in place, insert new ones, and drop the
    # rows missing from the payload (delete-orphan).
    kept = []
    for item, values in zip(raw, _normalized(raw)):
        el_id = _element_uuid(item)
        if el_id is None:
            kept.append(FloorPlanElement(**values))
        else:
            row = existing[el_id]
            for key, value in values.items():
                setattr(row, key, value)
            kept.append(row)
    plan.elements = kept
    plan.updated_at = func.now()
    _mark_draft_changed(plan)
    session.commit()
    write_audit(get_jwt_identity(), "floorplan.elements_saved", plan_id, {"count": len(raw)})
    # expire_on_commit=False means plan.elements still holds the pre-commit Python
    # objects/order in memory; expire() forces a clean reload of both the scalar
    # columns (updated_at) and the elements relationship (fresh ids, DB order).
    session.expire(plan)
    return jsonify(_plan_payload(plan))
