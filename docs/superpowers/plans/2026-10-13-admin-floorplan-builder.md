# Admin Floor Plan Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only module where admins create grid-based floor plans (custom label + grid size) and place/rotate fixed-catalog elements (wall, seat, toilet, ...) via a visual drag editor; stored in `floor_plans` + `floor_plan_elements`.

**Architecture:** Flask `app/admin/floorplans.py` blueprint (`/api/admin/floor-plans`, `@admin_required`) using SQLAlchemy 2.0 ORM models for all queries (schema still owned by `sql/` scripts); frontend adds `webapp-frontend/src/floorplan/` (list page + editor page with pure `logic.js`/`palette.js` modules) talking to the Flask backend through specific Vite proxy rules. Spec: `docs/superpowers/specs/2026-10-13-admin-floorplan-design.md`.

**Tech Stack:** Flask 3 blueprints, SQLAlchemy 2.0 ORM (declarative models) over the existing engine, pytest (real Postgres test schema `hotdesk_test`); React 19 + Vite 6 + react-router 7, plain CSS.

## Global Constraints

- Backend working directory for all pytest/python commands: `webapp-backend/`. Frontend commands: `webapp-frontend/`.
- Floor-plan data access uses SQLAlchemy 2.0 ORM models (`FloorPlan`, `FloorPlanElement`, `orm_session()` helper) — no SQL strings except test assertions. Existing modules keep their raw-SQL style; do not refactor them.
- SQL scripts live in `webapp-backend/sql/` (numbered, idempotent). The test `db` fixture applies all of `sql/*.sql` to schema `hotdesk_test` automatically.
- All API errors JSON `{"error": ...}`; validation adds `fields`. 401/403 handled by existing JWT loaders + `admin_required`. Every mutating action writes `audit_logs` via `write_audit`.
- Grid bounds: `cols`, `rows` between 5 and 80. Rotations only 0/90/270/180; effective footprint swaps w/h at 90/270. Stored w/h are ALWAYS the catalog defaults (client cannot resize footprints).
- Element catalog is fixed and identical in `app/admin/floorplans.py` (`CATALOG`) and `webapp-frontend/src/floorplan/palette.js`: wall 1×1 `#64748b`, seat 1×1 `#16a34a`, toilet 2×2 `#0d9488`, elevator 2×2 `#7c3aed`, door 1×1 `#b45309`, meeting_room 3×2 `#2563eb`, kitchen 2×2 `#db2777`, plant 1×1 `#15803d`, corridor 1×1 `#94a3b8`.
- No login UI in this module: `flaskRequest` sends `Authorization: Bearer` from localStorage key `hotdesk.flask_token` (also accepts `?flask_token=` URL param) and surfaces 401 as "Session expired — sign in again."
- Frontend JWT assumption: the separate login module stores the Flask JWT at `hotdesk.flask_token`; smoke tests use the `?flask_token=` param.
- Commit after every green task; messages use `feat:`/`test:`/`docs:` prefixes.

---

### Task 1: SQL migration + shared ORM layer + schema fixtures

**Files:**
- Create: `webapp-backend/sql/0008_floor_plans.sql`
- Create: `webapp-backend/app/core/orm.py` (shared SQLAlchemy 2.0 layer for new modules)
- Modify: `webapp-backend/app/__init__.py` (call `init_orm(app)`)
- Modify: `webapp-backend/tests/conftest.py` (`db` fixture truncate list)
- Test: `webapp-backend/tests/test_floorplan_schema.py`

**Interfaces:**
- Consumes: existing `db`/`admin_conn` fixtures (truncate + seed), `core.db.get_engine`.
- Produces: tables `floor_plans(id, name, cols, rows, created_by, created_at, updated_at)` and `floor_plan_elements(id, plan_id, type, x, y, w, h, rotation, label, color)` in every schema the tests/apps use; FK cascade verified; shared ORM layer `app.core.orm.Base` (DeclarativeBase), `orm_session() -> sqlalchemy.orm.Session` (request-scoped, own pooled connection, closed on teardown), `init_orm(app)`.

- [ ] **Step 1: Write the migration script**

`webapp-backend/sql/0008_floor_plans.sql`:

```sql
create table if not exists floor_plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  cols       int  not null check (cols between 5 and 80),
  rows       int  not null check (rows between 5 and 80),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists floor_plan_elements (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references floor_plans(id) on delete cascade,
  type     text not null,
  x        int  not null check (x >= 0),
  y        int  not null check (y >= 0),
  w        smallint not null check (w between 1 and 20),
  h        smallint not null check (h between 1 and 20),
  rotation smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  label    text check (label is null or length(label) <= 60),
  color    text check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

create index if not exists floor_plan_elements_plan_idx on floor_plan_elements (plan_id);
```

(`cols`/`rows` are safe unquoted — non-reserved, verified against the dev Supabase instance.)

- [ ] **Step 2: Write the failing schema test**

`webapp-backend/tests/test_floorplan_schema.py`:

```python
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def test_plan_bounds_checks(db):
    with db.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plans (name, cols, rows) values ('x', 2, 10)"))
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plans (name, cols, rows) values ('x', 10, 2)"))


def test_element_rotation_and_color_checks(db):
    with db.connect() as conn:
        pid = conn.execute(text(
            "insert into floor_plans (name, cols, rows) values ('p', 10, 10) returning id")).scalar_one()
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation) "
                              "values (:p, 'wall', 0, 0, 1, 1, 45)"), {"p": pid})
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plan_elements (plan_id, type, x, y, w, h, color) "
                              "values (:p, 'wall', 0, 0, 1, 1, 'red')"), {"p": pid})


def test_elements_cascade_with_plan(db):
    with db.connect() as conn:
        pid = conn.execute(text(
            "insert into floor_plans (name, cols, rows) values ('p2', 10, 10) returning id")).scalar_one()
        conn.execute(text("insert into floor_plan_elements (plan_id, type, x, y, w, h) "
                          "values (:p, 'seat', 1, 1, 1, 1)"), {"p": pid})
        conn.execute(text("delete from floor_plans where id = :p"), {"p": pid})
        n = conn.execute(text("select count(*) from floor_plan_elements")).scalar_one()
        assert n == 0
```

- [ ] **Step 3: Create the shared ORM layer `webapp-backend/app/core/orm.py`**

```python
from flask import g
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase, Session

NAMING_CONVENTION = {
    "ix": "ix_%(table)s_%(column)s",
    "uq": "uq_%(table)s_%(column)s",
    "ck": "ck_%(table)s_%(name)s",
    "fk": "fk_%(table)s_%(column)s",
    "pk": "pk_%(table)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def orm_session() -> Session:
    if "orm_session" not in g:
        g.orm_session = Session(get_engine_for_orm(), expire_on_commit=False)
    return g.orm_session


def get_engine_for_orm():
    from .db import get_engine

    return get_engine()


def init_orm(app):
    from . import floorplan_models  # noqa: F401  (registers all mappers on Base)

    @app.teardown_appcontext
    def _close(exc):
        session = g.pop("orm_session", None)
        if session is not None:
            session.close()
```

- [ ] **Step 4: Create the models `webapp-backend/app/core/floorplan_models.py`**

```python
import datetime as dt
import uuid

from sqlalchemy import (CheckConstraint, DateTime, ForeignKey, Integer, SmallInteger,
                        String, Text, func)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .orm import Base


class FloorPlan(Base):
    __tablename__ = "floor_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    cols: Mapped[int] = mapped_column(Integer, nullable=False)
    rows: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())

    elements: Mapped[list["FloorPlanElement"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan",
        order_by="FloorPlanElement.y, FloorPlanElement.x")


class FloorPlanElement(Base):
    __tablename__ = "floor_plan_elements"
    __table_args__ = (CheckConstraint("rotation in (0, 90, 180, 270)", name="rotation_values"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plans.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    w: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    h: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    rotation: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    label: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(7))

    plan: Mapped[FloorPlan] = relationship(back_populates="elements")
```

(DDL — defaults, checks — stays owned by `sql/0008_floor_plans.sql`; the model mirrors it for reads/writes. The CHECK here is declarative metadata only and is never emitted, since we do not call `create_all`.)

- [ ] **Step 5: Wire into the app factory**

In `webapp-backend/app/__init__.py`, extend the core imports to include `from .core.orm import init_orm`, and call `init_orm(app)` directly after `init_db(app)`.

- [ ] **Step 6: Add an ORM smoke test to `tests/test_floorplan_schema.py`** (proves model<->table mapping)

```python
def test_orm_insert_select(app, db):
    from app.core.floorplan_models import FloorPlan
    from app.core.orm import orm_session

    plan = FloorPlan(name="ORM check", cols=10, rows=8)
    session = orm_session()
    session.add(plan)
    session.commit()
    loaded = session.get(FloorPlan, plan.id)
    assert loaded.name == "ORM check" and loaded.cols == 10 and loaded.rows == 8
```

- [ ] **Step 6: Run to verify failure, then make it pass**

Run: `python -m pytest tests/test_floorplan_schema.py tests/test_health.py -v`
Expected first: ERROR — missing modules (`app.core.orm` / models) until Steps 3–4 are done (create the SQL script + ORM files per Steps 1, 3, 4 before this run). After the files exist: ALL PASS.

- [ ] **Step 7: Update the `db` fixture truncate list**

In `webapp-backend/tests/conftest.py`, replace the truncate SQL inside the `db` fixture:

```python
            conn.execute(text(
                "truncate users, departments, user_departments, user_tokens, audit_logs, "
                "floor_plan_elements, floor_plans restart identity cascade"))
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `python -m pytest tests/test_floorplan_schema.py tests/test_health.py -v`
Expected: all pass.

- [ ] **Step 9: Apply to dev `public` schema (Definition-of-Done parity)**

Run (from `webapp-backend/`):
```powershell
python -c "from sqlalchemy import create_engine, text; from app.core.config import Config; e=create_engine(Config.SQLALCHEMY_DATABASE_URI, isolation_level='autocommit'); conn=e.connect(); conn.execute(text(open('sql/0008_floor_plans.sql', encoding='utf-8').read())); print('applied 0008'); e.dispose()"
```
Expected: `applied 0008`.

- [ ] **Step 10: Commit**

```powershell
git add webapp-backend/sql/0008_floor_plans.sql webapp-backend/app/core/orm.py webapp-backend/app/core/floorplan_models.py webapp-backend/app/__init__.py webapp-backend/tests/conftest.py webapp-backend/tests/test_floorplan_schema.py
git commit -m "feat: add floor plan tables, shared ORM layer and schema tests"
```

---

### Task 2: Backend — catalog + plan CRUD endpoints

**Files:**
- Create: `webapp-backend/app/admin/floorplans.py`
- Modify: `webapp-backend/app/admin/__init__.py` (import line)
- Test: `webapp-backend/tests/test_admin_floorplans.py`

**Interfaces:**
- Consumes: `admin_required`, `write_audit`, `error` (existing core), `orm_session`/`Base` from Task 1, `users` table for audit FK.
- Produces (used by Task 3 and all frontend tasks):
  - `CATALOG: dict[str, dict]` — `{"wall": {"label": "Wall", "w": 1, "h": 1, "color": "#64748b"}, ...}` (see Global Constraints for all nine)
  - `GET /api/admin/floor-plans` → `200 {"items": [{id,name,cols,rows,element_count,updated_at}]}`
  - `POST /api/admin/floor-plans` `{name,cols,rows}` → `201 {id,name,cols,rows,updated_at,elements:[]}`
  - `GET /api/admin/floor-plans/<id>` → `200 {id,name,cols,rows,updated_at,elements:[{id,type,x,y,w,h,rotation,label,color}]}` / 404
  - `PATCH /api/admin/floor-plans/<id>` `{name?,cols?,rows?}` → `200` full payload; stranded elements → `400 fields.elements`
  - `DELETE /api/admin/floor-plans/<id>` → `204`
  - `GET /api/admin/floor-plans/catalog` → `200 {"items": [{"type","label","w","h","color"}]}`
  - `_get_plan(plan_id: str) -> FloorPlan | None`, `_plan_payload(plan: FloorPlan) -> dict`, `_element_dto(el) -> dict`, `_size(etype, rotation) -> (w, h)` (reused in Task 3)

- [ ] **Step 1: Write failing tests**

`webapp-backend/tests/test_admin_floorplans.py`:

```python
import pytest

from app.core.db import run_one
from app.core.security import hash_password

ADMIN_PW = "adminpw1"
USER_PW = "userpw12"


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id", {"p": hash_password(ADMIN_PW)})
    return client.post("/api/auth/login",
                       json={"email_or_username": "root@x.com", "password": ADMIN_PW}).get_json()["token"]


@pytest.fixture()
def user_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('plain@x.com', 'plain', 'Plain', 1, :p) returning id", {"p": hash_password(USER_PW)})
    return client.post("/api/auth/login",
                       json={"email_or_username": "plain@x.com", "password": USER_PW}).get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_floorplans_require_auth_and_admin(client, db, user_token):
    assert client.get("/api/admin/floor-plans").status_code == 401
    assert client.get("/api/admin/floor-plans", headers=hdr(user_token)).status_code == 403


def test_create_validation(client, db, admin_token):
    r = client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                    json={"name": "", "cols": 2, "rows": 100})
    assert r.status_code == 400
    fields = r.get_json()["fields"]
    assert "name" in fields and "cols" in fields and "rows" in fields


def test_create_get_list_update_delete(client, db, admin_token):
    r = client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                    json={"name": "Level 9", "cols": 20, "rows": 15})
    assert r.status_code == 201
    plan = r.get_json()
    assert plan["name"] == "Level 9" and plan["elements"] == []
    got = client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token))
    assert got.status_code == 200 and got.get_json()["cols"] == 20
    items = client.get("/api/admin/floor-plans", headers=hdr(admin_token)).get_json()["items"]
    assert items[0]["element_count"] == 0
    patched = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                           json={"name": "Renamed"})
    assert patched.status_code == 200 and patched.get_json()["name"] == "Renamed"
    assert client.delete(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).status_code == 204
    assert client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).status_code == 404
    for action in ("floorplan.create", "floorplan.update", "floorplan.delete"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_get_unknown_plan_404(client, db, admin_token):
    assert client.get("/api/admin/floor-plans/" + "0" * 36,
                      headers=hdr(admin_token)).status_code == 404


def test_catalog(client, db, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    by_type = {i["type"]: i for i in items}
    assert by_type["seat"] == {"type": "seat", "label": "Seat", "w": 1, "h": 1, "color": "#16a34a"}
    assert set(by_type) == {"wall", "seat", "toilet", "elevator", "door",
                            "meeting_room", "kitchen", "plant", "corridor"}
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_admin_floorplans.py -v`
Expected: FAIL — 404 on `/api/admin/floor-plans` (blueprint module not created).

- [ ] **Step 3: Implement `app/admin/floorplans.py` (this task's half)**

```python
import re

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.audit import write_audit
from app.core.errors import error
from app.core.floorplan_models import FloorPlan, FloorPlanElement
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp

CATALOG = {
    "wall": {"label": "Wall", "w": 1, "h": 1, "color": "#64748b"},
    "seat": {"label": "Seat", "w": 1, "h": 1, "color": "#16a34a"},
    "toilet": {"label": "Toilet", "w": 2, "h": 2, "color": "#0d9488"},
    "elevator": {"label": "Elevator", "w": 2, "h": 2, "color": "#7c3aed"},
    "door": {"label": "Door", "w": 1, "h": 1, "color": "#b45309"},
    "meeting_room": {"label": "Meeting room", "w": 3, "h": 2, "color": "#2563eb"},
    "kitchen": {"label": "Kitchen", "w": 2, "h": 2, "color": "#db2777"},
    "plant": {"label": "Plant", "w": 1, "h": 1, "color": "#15803d"},
    "corridor": {"label": "Corridor", "w": 1, "h": 1, "color": "#94a3b8"},
}
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ROTATIONS = (0, 90, 180, 270)
MIN_DIM, MAX_DIM = 5, 80


def _size(etype: str, rotation: int):
    entry = CATALOG[etype]
    w, h = entry["w"], entry["h"]
    return (h, w) if rotation in (90, 270) else (w, h)


def _element_dto(el: FloorPlanElement) -> dict:
    return {"id": str(el.id), "type": el.type, "x": el.x, "y": el.y,
            "w": el.w, "h": el.h, "rotation": el.rotation,
            "label": el.label, "color": el.color}


def _get_plan(plan_id: str) -> FloorPlan | None:
    return orm_session().get(FloorPlan, plan_id)


def _plan_payload(plan: FloorPlan) -> dict:
    return {"id": str(plan.id), "name": plan.name, "cols": plan.cols, "rows": plan.rows,
            "updated_at": plan.updated_at.isoformat(),
            "elements": [_element_dto(el) for el in plan.elements]}


@admin_bp.get("/floor-plans/catalog")
@admin_required
def floorplan_catalog():
    g.jwt_uid = get_jwt_identity()
    return jsonify(items=[{"type": t, **entry} for t, entry in CATALOG.items()])


@admin_bp.get("/floor-plans")
@admin_required
def list_plans():
    g.jwt_uid = get_jwt_identity()
    session = orm_session()
    plans = session.scalars(select(FloorPlan).order_by(FloorPlan.created_at.desc())).all()
    return jsonify(items=[
        {"id": str(p.id), "name": p.name, "cols": p.cols, "rows": p.rows,
         "element_count": session.scalar(select(func.count()).select_from(FloorPlanElement)
                                         .where(FloorPlanElement.plan_id == p.id)),
         "updated_at": p.updated_at.isoformat()}
        for p in plans])


@admin_bp.post("/floor-plans")
@admin_required
def create_plan():
    body = request.get_json(silent=True) or {}
    fields = {}
    name = (body.get("name") or "").strip()
    if not (1 <= len(name) <= 120):
        fields["name"] = "name is required (1-120 characters)"
    try:
        cols, rows = int(body.get("cols")), int(body.get("rows"))
    except (TypeError, ValueError):
        cols = rows = None
        fields["cols"] = "cols and rows must be integers"
        fields["rows"] = fields["cols"]
    if cols is not None and not (MIN_DIM <= cols <= MAX_DIM):
        fields["cols"] = f"cols must be between {MIN_DIM} and {MAX_DIM}"
    if rows is not None and not (MIN_DIM <= rows <= MAX_DIM):
        fields["rows"] = f"rows must be between {MIN_DIM} and {MAX_DIM}"
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
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(str(plan_id))
    if plan is None:
        return error("plan not found", 404)
    body = request.get_json(silent=True) or {}
    unknown = set(body) - {"name", "cols", "rows"}
    fields = {k: "unknown field" for k in sorted(unknown)}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not (1 <= len(name) <= 120):
            fields["name"] = "name is required (1-120 characters)"
    new_cols, new_rows = plan.cols, plan.rows
    if "cols" in body or "rows" in body:
        try:
            new_cols = int(body["cols"]) if "cols" in body else plan.cols
            new_rows = int(body["rows"]) if "rows" in body else plan.rows
        except (TypeError, ValueError):
            fields["cols"] = "cols and rows must be integers"
            fields["rows"] = fields["cols"]
        if not fields.get("cols"):
            if not (MIN_DIM <= new_cols <= MAX_DIM):
                fields["cols"] = f"cols must be between {MIN_DIM} and {MAX_DIM}"
            if not (MIN_DIM <= new_rows <= MAX_DIM):
                fields["rows"] = f"rows must be between {MIN_DIM} and {MAX_DIM}"
        if not fields and (new_cols, new_rows) != (plan.cols, plan.rows):
            strayed = sum(1 for el in plan.elements
                          if el.x + _size(el.type, el.rotation)[0] > new_cols
                          or el.y + _size(el.type, el.rotation)[1] > new_rows)
            if strayed:
                fields["elements"] = f"{strayed} elements fall outside the new grid; move them first"
    if fields:
        return error("validation failed", 400, fields=fields)
    if "name" in body:
        plan.name = name
    plan.cols, plan.rows = new_cols, new_rows
    plan.updated_at = func.now()
    orm_session().commit()
    write_audit(get_jwt_identity(), "floorplan.update", str(plan.id), {"fields": sorted(body)})
    orm_session().expire(plan)
    return jsonify(_plan_payload(plan))


@admin_bp.delete("/floor-plans/<uuid:plan_id>")
@admin_required
def delete_plan(plan_id):
    g.jwt_uid = get_jwt_identity()
    plan = _get_plan(str(plan_id))
    if plan is None:
        return error("plan not found", 404)
    name = plan.name
    session = orm_session()
    session.delete(plan)
    session.commit()
    write_audit(get_jwt_identity(), "floorplan.delete", str(plan_id), {"name": name})
    return ("", 204)
```

(`plan.updated_at = func.now()` keeps the timestamp server-side; `expire` reloads it for the response. `created_by=actor` works because `actor` is a UUID string the psycopg/UUID type coerces, same pattern as `users.id`.)

- [ ] **Step 4: Register the module**

`webapp-backend/app/admin/__init__.py` — change the import line to:

```python
from . import users, departments, floorplans  # noqa: E402,F401
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_admin_floorplans.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```powershell
git add webapp-backend/app/admin/floorplans.py webapp-backend/app/admin/__init__.py webapp-backend/tests/test_admin_floorplans.py
git commit -m "feat: add floor plan catalog and plan CRUD endpoints"
```

---

### Task 3: Backend — bulk element save (replace + validation)

**Files:**
- Modify: `webapp-backend/app/admin/floorplans.py` (append save endpoint + validators)
- Test: extend `webapp-backend/tests/test_admin_floorplans.py`

**Interfaces:**
- Consumes: Task 2's `CATALOG`, `_size`, `_get_plan`, `_plan_payload`; `orm_session` for the atomic replace via the `FloorPlan.elements` relationship (cascade delete-orphan).
- Produces:
  - `PUT /api/admin/floor-plans/<id>/elements` — `{elements: [{id?, type, x, y, rotation, label?, color?}]}` → `200` full plan payload (fresh server ids); `400 {"error":"validation failed","fields":{"elements":[messages]}}`
  - `_validate_elements(raw_list, cols, rows) -> list[str]` (empty = valid), `_normalized(raw_list) -> list[dict]`, `_replace_elements(plan_id, normalized)` (single transaction)

- [ ] **Step 1: Write failing tests (append to `tests/test_admin_floorplans.py`)**

```python
def _mk_plan(client, admin_token, cols=10, rows=10):
    return client.post("/api/admin/floor-plans", headers=hdr(admin_token),
                       json={"name": "Grid", "cols": cols, "rows": rows}).get_json()


def _save(client, admin_token, pid, elements):
    return client.put(f"/api/admin/floor-plans/{pid}/elements",
                      headers=hdr(admin_token), json={"elements": elements})


def test_save_replaces_and_persists(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [
        {"type": "seat", "x": 1, "y": 1, "rotation": 0, "label": "A1"},
        {"type": "toilet", "x": 5, "y": 5, "rotation": 90, "color": "#ff0000"},
    ])
    assert r.status_code == 200
    els = r.get_json()["elements"]
    assert len(els) == 2
    toilet = next(e for e in els if e["type"] == "toilet")
    assert (toilet["w"], toilet["h"]) == (2, 2) and toilet["rotation"] == 90
    r = _save(client, admin_token, plan["id"], [{"type": "wall", "x": 0, "y": 0, "rotation": 0}])
    assert len(r.get_json()["elements"]) == 1
    assert run_one("select count(*) as n from floor_plan_elements")["n"] == 1
    assert run_one("select action from audit_logs where action = 'floorplan.elements_saved'")


def test_save_rotation_swaps_footprint(client, db, admin_token):
    plan = _mk_plan(client, admin_token, cols=5, rows=5)
    ok = _save(client, admin_token, plan["id"],
               [{"type": "meeting_room", "x": 1, "y": 2, "rotation": 90}])
    assert ok.status_code == 200
    bad = _save(client, admin_token, plan["id"],
                [{"type": "meeting_room", "x": 1, "y": 3, "rotation": 90}])
    assert bad.status_code == 400


def test_save_rejects_bad_elements(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    cases = [
        ([{"type": "desk", "x": 0, "y": 0, "rotation": 0}], "unknown type"),
        ([{"type": "seat", "x": 10, "y": 0, "rotation": 0}], "outside"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 45}], "rotation"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0, "color": "red"}], "#rrggbb"),
        ([{"type": "seat", "x": 0, "y": 0, "rotation": 0},
          {"type": "seat", "x": 0, "y": 0, "rotation": 0}], "overlap"),
    ]
    for elements, fragment in cases:
        r = _save(client, admin_token, plan["id"], elements)
        assert r.status_code == 400, elements
        assert any(fragment in m for m in r.get_json()["fields"]["elements"]), (fragment, r.get_json())


def test_save_invalid_batch_keeps_previous(client, db, admin_token):
    plan = _mk_plan(client, admin_token)
    _save(client, admin_token, plan["id"], [{"type": "seat", "x": 0, "y": 0, "rotation": 0}])
    bad = _save(client, admin_token, plan["id"], [
        {"type": "seat", "x": 1, "y": 1, "rotation": 0},
        {"type": "seat", "x": 1, "y": 1, "rotation": 0}])
    assert bad.status_code == 400
    els = client.get(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token)).get_json()["elements"]
    assert [e["x"] for e in els] == [0]


def test_patch_resize_guard(client, db, admin_token):
    plan = _mk_plan(client, admin_token, cols=10, rows=10)
    _save(client, admin_token, plan["id"], [{"type": "seat", "x": 8, "y": 8, "rotation": 0}])
    r = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                     json={"cols": 5, "rows": 5})
    assert r.status_code == 400 and "elements" in r.get_json()["fields"]
    r = client.patch(f"/api/admin/floor-plans/{plan['id']}", headers=hdr(admin_token),
                     json={"cols": 9, "rows": 9})
    assert r.status_code == 200
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_admin_floorplans.py -v`
Expected: new tests FAIL (405 on PUT).

- [ ] **Step 3: Implement (append to `app/admin/floorplans.py`)**

No new imports needed (Task 2 already imports `FloorPlanElement`, `orm_session`, `func`).

```python
def _validate_elements(raw, cols, rows):
    problems, seen = [], {}
    for i, el in enumerate(raw):
        etype = el.get("type") if isinstance(el, dict) else None
        if etype not in CATALOG:
            problems.append(f"element {i}: unknown type '{etype}'")
            continue
        try:
            x, y, rotation = int(el.get("x")), int(el.get("y")), int(el.get("rotation", 0))
        except (TypeError, ValueError):
            problems.append(f"element {i}: x, y and rotation must be integers")
            continue
        if rotation not in ROTATIONS:
            problems.append(f"element {i}: rotation must be one of 0, 90, 180, 270")
            continue
        color = el.get("color")
        if color and not COLOR_RE.match(str(color)):
            problems.append(f"element {i}: color must be #rrggbb")
        label = el.get("label")
        if label is not None and len(str(label)) > 60:
            problems.append(f"element {i}: label must be 60 characters or fewer")
        w, h = _size(etype, rotation)
        if x < 0 or y < 0 or x + w > cols or y + h > rows:
            problems.append(f"element {i} ({etype}): outside the {cols}x{rows} grid")
            continue
        cells = [(x + dx, y + dy) for dx in range(w) for dy in range(h)]
        clash = next((c for c in cells if c in seen), None)
        if clash is not None:
            problems.append(f"element {i} ({etype}) overlaps element {seen[clash]}")
            continue
        for c in cells:
            seen[c] = i
    return problems


@admin_bp.put("/floor-plans/<uuid:plan_id>/elements")
@admin_required
def save_elements(plan_id):
    g.jwt_uid = get_jwt_identity()
    session = orm_session()
    plan = _get_plan(str(plan_id))
    if plan is None:
        return error("plan not found", 404)
    body = request.get_json(silent=True) or {}
    raw = body.get("elements")
    if not isinstance(raw, list):
        return error("validation failed", 400, fields={"elements": ["elements must be a list"]})
    problems = _validate_elements(raw, plan.cols, plan.rows)
    if problems:
        return error("validation failed", 400, fields={"elements": problems})
    plan.elements.clear()  # cascade delete-orphan: removes old rows on flush
    for item in raw:
        entry = CATALOG[item["type"]]
        plan.elements.append(FloorPlanElement(
            type=item["type"], x=int(item["x"]), y=int(item["y"]),
            w=entry["w"], h=entry["h"], rotation=int(item.get("rotation", 0)),
            label=(item.get("label") or None), color=(item.get("color") or None)))
    plan.updated_at = func.now()
    session.commit()
    write_audit(get_jwt_identity(), "floorplan.elements_saved", str(plan.id), {"count": len(raw)})
    session.expire(plan)
    return jsonify(_plan_payload(plan))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_admin_floorplans.py -v`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```powershell
git add webapp-backend/app/admin/floorplans.py webapp-backend/tests/test_admin_floorplans.py
git commit -m "feat: add atomic floor plan element bulk save with validation"
```

---

### Task 4: Frontend plumbing — proxy, flaskRequest, pure modules

**Files:**
- Modify: `webapp-frontend/vite.config.js`, `webapp-frontend/src/api.js` (append)
- Create: `webapp-frontend/src/floorplan/palette.js`, `webapp-frontend/src/floorplan/logic.js`, `webapp-frontend/scripts/smoke_floorplan_logic.mjs`

**Interfaces:**
- Consumes: backend catalog/plan API shapes from Tasks 2–3.
- Produces (used by Tasks 5–6):
  - `palette.js`: `CATALOG: Array<{type,label,w,h,color}>`, `catalogByType: Record<string, entry>`, `effectiveSize(type, rotation) -> {w,h}`
  - `logic.js`: `cellsOf(el)`, `placementError(el, elements, cols, rows) -> string|null`, `addElement(elements, type, x, y, cols, rows, nextId) -> {elements, error}`, `moveElement(elements, id, x, y, cols, rows)`, `rotateElement(elements, id, cols, rows)`, `removeElement(elements, id)`, `validateAll(elements, cols, rows) -> string[]`
  - `api.js`: `readFlaskToken() -> string`, `flaskRequest(path, {method, body}) -> Promise<any>` (throws `Error` with `.status` and `.fields`)
  - Vite dev proxy: `/api/auth` and `/api/admin/floor-plans` → Flask (`VITE_FLASK_TARGET`, default `http://localhost:5000`), all other `/api` unchanged (legacy :3000)

- [ ] **Step 1: Update the proxy**

Replace `webapp-frontend/vite.config.js` entirely:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';
const flaskBackend = process.env.VITE_FLASK_TARGET ?? 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  publicDir: '../public',
  server: {
    proxy: {
      '/api/auth': { target: flaskBackend, changeOrigin: true },
      '/api/admin/floor-plans': { target: flaskBackend, changeOrigin: true },
      '/api': { target: backend, changeOrigin: true },
      '/labels': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
    },
  },
});
```

(Vite proxy keys match in definition order — specific prefixes must come first.)

- [ ] **Step 2: Append `flaskRequest` to `src/api.js`**

```js
const FLASK_TOKEN_KEY = 'hotdesk.flask_token';

export function readFlaskToken() {
  const supplied = new URLSearchParams(window.location.search).get('flask_token');
  if (supplied) storage.set(FLASK_TOKEN_KEY, supplied);
  return storage.get(FLASK_TOKEN_KEY);
}

export async function flaskRequest(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = readFlaskToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || response.statusText || 'Request failed');
    err.status = response.status;
    err.fields = data.fields;
    throw err;
  }
  return data;
}
```

- [ ] **Step 3: Create `src/floorplan/palette.js`** (mirror of backend `CATALOG` — keep byte-identical)

```js
export const CATALOG = [
  { type: 'wall', label: 'Wall', w: 1, h: 1, color: '#64748b' },
  { type: 'seat', label: 'Seat', w: 1, h: 1, color: '#16a34a' },
  { type: 'toilet', label: 'Toilet', w: 2, h: 2, color: '#0d9488' },
  { type: 'elevator', label: 'Elevator', w: 2, h: 2, color: '#7c3aed' },
  { type: 'door', label: 'Door', w: 1, h: 1, color: '#b45309' },
  { type: 'meeting_room', label: 'Meeting room', w: 3, h: 2, color: '#2563eb' },
  { type: 'kitchen', label: 'Kitchen', w: 2, h: 2, color: '#db2777' },
  { type: 'plant', label: 'Plant', w: 1, h: 1, color: '#15803d' },
  { type: 'corridor', label: 'Corridor', w: 1, h: 1, color: '#94a3b8' },
];

export const catalogByType = Object.fromEntries(CATALOG.map((c) => [c.type, c]));

export function effectiveSize(type, rotation) {
  const { w, h } = catalogByType[type];
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}
```

- [ ] **Step 4: Create `src/floorplan/logic.js`** (pure, no React — mirrors server validation)

```js
import { effectiveSize } from './palette.js';

export function cellsOf(el) {
  const { w, h } = effectiveSize(el.type, el.rotation || 0);
  const cells = [];
  for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < h; dy += 1) cells.push([el.x + dx, el.y + dy]);
  return cells;
}

export function placementError(el, elements, cols, rows) {
  if (!el.type) return 'unknown type';
  const { w, h } = effectiveSize(el.type, el.rotation || 0);
  if (el.x < 0 || el.y < 0 || el.x + w > cols || el.y + h > rows) return 'outside the grid';
  const occupied = new Set();
  for (const other of elements) {
    if (other.id === el.id) continue;
    for (const [cx, cy] of cellsOf(other)) occupied.add(`${cx},${cy}`);
  }
  for (let dx = 0; dx < w; dx += 1)
    for (let dy = 0; dy < h; dy += 1)
      if (occupied.has(`${el.x + dx},${el.y + dy}`)) return 'overlaps another element';
  return null;
}

export function addElement(elements, type, x, y, cols, rows, nextId) {
  const el = { id: nextId(), type, x, y, rotation: 0 };
  const error = placementError(el, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: [...elements, el], error: null };
}

export function moveElement(elements, id, x, y, cols, rows) {
  const current = elements.find((e) => e.id === id);
  if (!current) return { elements, error: 'element not found' };
  const moved = { ...current, x, y };
  const error = placementError(moved, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: elements.map((e) => (e.id === id ? moved : e)), error: null };
}

export function rotateElement(elements, id, cols, rows) {
  const current = elements.find((e) => e.id === id);
  if (!current) return { elements, error: 'element not found' };
  const rotated = { ...current, rotation: ((current.rotation || 0) + 90) % 360 };
  const error = placementError(rotated, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: elements.map((e) => (e.id === id ? rotated : e)), error: null };
}

export function removeElement(elements, id) {
  return elements.filter((e) => e.id !== id);
}

export function validateAll(elements, cols, rows) {
  const problems = [];
  const seen = new Map();
  elements.forEach((el, i) => {
    const error = placementError(el, [], cols, rows);
    if (error) { problems.push(`element ${i} (${el.type}): ${error}`); return; }
    for (const [cx, cy] of cellsOf(el)) {
      const key = `${cx},${cy}`;
      if (seen.has(key)) problems.push(`element ${i} (${el.type}) overlaps element ${seen.get(key)}`);
      else seen.set(key, i);
    }
  });
  return [...new Set(problems)];
}
```

- [ ] **Step 5: Create the automated logic smoke script**

`webapp-frontend/scripts/smoke_floorplan_logic.mjs`:

```js
import assert from 'node:assert/strict';
import { addElement, moveElement, rotateElement, removeElement, placementError, validateAll } from '../src/floorplan/logic.js';

let seq = 0;
const nextId = () => `t${seq++}`;
const COLS = 10, ROWS = 10;

let state = [];
let res = addElement(state, 'seat', 1, 1, COLS, ROWS, nextId);
assert.equal(res.error, null); state = res.elements;
assert.equal(state.length, 1);

res = addElement(state, 'seat', 1, 1, COLS, ROWS, nextId);
assert.match(res.error, /overlaps/);

res = addElement(state, 'toilet', 9, 9, COLS, ROWS, nextId);
assert.match(res.error, /outside/);

state = addElement(state, 'meeting_room', 1, 4, COLS, ROWS, nextId).elements;
res = rotateElement(state, state[1].id, COLS, ROWS);
assert.equal(res.error, null);
assert.equal(res.elements[1].rotation, 90);

res = moveElement(state, state[0].id, 0, 0, COLS, ROWS);
assert.equal(res.error, null);
assert.deepEqual([res.elements[0].x, res.elements[0].y], [0, 0]);

state = removeElement(state, state[0].id);
assert.equal(state.length, 1);

const overlap = [{ id: 'a', type: 'seat', x: 2, y: 2, rotation: 0 },
                 { id: 'b', type: 'seat', x: 2, y: 2, rotation: 0 }];
assert.equal(validateAll(overlap, COLS, ROWS).length, 1);
assert.match(validateAll(overlap, COLS, ROWS)[0], /overlaps/);

assert.equal(placementError({ id: 'z', type: 'seat', x: 10, y: 0, rotation: 0 }, [], COLS, ROWS), 'outside the grid');

console.log('floorplan logic smoke OK');
```

- [ ] **Step 6: Run the smoke script**

Run (from `webapp-frontend/`): `node scripts/smoke_floorplan_logic.mjs`
Expected: `floorplan logic smoke OK`

- [ ] **Step 7: Commit**

```powershell
git add webapp-frontend/vite.config.js webapp-frontend/src/api.js webapp-frontend/src/floorplan webapp-frontend/scripts
git commit -m "feat: add floor plan frontend plumbing, catalog mirror and placement logic"
```

---

### Task 5: Frontend — plan list page + routing

**Files:**
- Create: `webapp-frontend/src/floorplan/FloorPlansPage.jsx`
- Modify: `webapp-frontend/src/App.jsx` (nav + routes)
- Create: `webapp-frontend/src/floorplan/floorplan.css` (shared styles, grown in Task 6)

**Interfaces:**
- Consumes: `flaskRequest` (Task 4), backend CRUD (Task 2).
- Produces: route `/floor-plans` → `FloorPlansPage`; nav entry "Floor plans"; shared css classes `fp-table`, `fp-form`.

- [ ] **Step 1: Create `src/floorplan/FloorPlansPage.jsx`**

```jsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import './floorplan.css';

export default function FloorPlansPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ name: '', cols: 20, rows: 15 });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await flaskRequest('/api/admin/floor-plans')).items);
      setError(null);
    } catch (err) {
      setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setCreating(true); setNotice(null);
    try {
      await flaskRequest('/api/admin/floor-plans', {
        method: 'POST', body: { name: form.name, cols: Number(form.cols), rows: Number(form.rows) },
      });
      setForm({ name: '', cols: 20, rows: 15 });
      await load();
    } catch (err) {
      if (err.status === 400 && err.fields) setNotice(Object.values(err.fields).join('; '));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    } finally { setCreating(false); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete plan “${item.name}”? Its elements are removed too.`)) return;
    try { await flaskRequest(`/api/admin/floor-plans/${item.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.status === 401 ? 'Session expired — sign in again.' : err.message); }
  };

  return <main className="page">
    <section className="card">
      <h1>Floor plans</h1>
      {error && <p className="notice-error">{error}</p>}
      {notice && <p className="notice-info">{notice}</p>}
      <form className="fp-form" onSubmit={create}>
        <input aria-label="Plan name" placeholder="Plan label" value={form.name}
               onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Cols <input type="number" min="5" max="80" value={form.cols} aria-label="Columns"
               onChange={(e) => setForm({ ...form, cols: e.target.value })} /></label>
        <label>Rows <input type="number" min="5" max="80" value={form.rows} aria-label="Rows"
               onChange={(e) => setForm({ ...form, rows: e.target.value })} /></label>
        <button className="button" disabled={creating}>New plan</button>
      </form>
      <table className="fp-table">
        <thead><tr><th>Name</th><th>Grid</th><th>Elements</th><th>Updated</th><th /></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <td><Link to={`/floor-plans/${item.id}`}>{item.name}</Link></td>
          <td>{item.cols}×{item.rows}</td>
          <td>{item.element_count}</td>
          <td>{item.updated_at}</td>
          <td><button className="button subtle" onClick={() => remove(item)}>Delete</button></td>
        </tr>)}</tbody>
      </table>
      {!items.length && !error && <p>No plans yet — create one above.</p>}
    </section>
  </main>;
}
```

- [ ] **Step 2: Create `src/floorplan/floorplan.css`** (base — Task 6 appends editor styles)

```css
.fp-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin: 12px 0 16px; }
.fp-form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.fp-form input { padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
.fp-form input[placeholder] { min-width: 220px; }
.fp-table { width: 100%; border-collapse: collapse; }
.fp-table th, .fp-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.fp-table .button.subtle { background: none; border: 1px solid var(--border); color: var(--muted); }
```

- [ ] **Step 3: Wire routing and nav in `src/App.jsx`**

Add import after the existing pages import:

```js
import FloorPlansPage from './floorplan/FloorPlansPage.jsx';
```

Change the `adminLinks` line to:

```js
const adminLinks = [['/floor-plans', 'Floor plans', 'floorplan'], ['/insights', 'Insights', 'insights'], ['/sensors', 'Sensors', 'sensors'], ['/display', 'Floor display', 'display']];
```

Add the route before the catch-all:

```jsx
<Route path="/floor-plans" element={<FloorPlansPage />} />
```

- [ ] **Step 4: Manual smoke (real data, no browser mock)**

1. Terminal A (in `webapp-backend/`): `python run.py` — Flask on :5000.
2. Get a token (Flask must already have an admin via `python scripts/create_admin.py ...`):
```powershell
curl.exe -X POST http://127.0.0.1:5000/api/auth/login -H "Content-Type: application/json" -d '{\"email_or_username\":\"<admin>\",\"password\":\"***\"}'
```
3. Terminal B (in `webapp-frontend/`): `npm run dev`; open `http://localhost:5173/floor-plans?flask_token=<token>`.
Expected: page renders (empty list or existing plans); create "Test plan 20×15" via the form → row appears; reload → still listed (proxy + Flask confirmed); Delete works.

- [ ] **Step 5: Commit**

```powershell
git add webapp-frontend/src/floorplan/FloorPlansPage.jsx webapp-frontend/src/floorplan/floorplan.css webapp-frontend/src/App.jsx
git commit -m "feat: add floor plan list page with create and delete"
```

---

### Task 6: Frontend — visual editor page (palette, grid drag, rotate, inspector, save)

**Files:**
- Create: `webapp-frontend/src/floorplan/EditorPage.jsx`
- Modify: `webapp-frontend/src/floorplan/floorplan.css` (append editor styles), `webapp-frontend/src/App.jsx` (editor route)

**Interfaces:**
- Consumes: Task 4 `logic.js`/`palette.js`/`flaskRequest`; Task 2/3 endpoints (`GET/PATCH plan`, `PUT elements`, `GET catalog` optional — palette uses the static `CATALOG`).
- Produces: route `/floor-plans/:id` → `EditorPage`.

- [ ] **Step 1: Create `src/floorplan/EditorPage.jsx`**

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { CATALOG, catalogByType, effectiveSize } from './palette.js';
import { addElement, moveElement, placementError, removeElement, rotateElement, validateAll } from './logic.js';
import './floorplan.css';

let localSeq = 0;
const nextId = () => `local-${Date.now()}-${localSeq++}`;
const SWATCHES = ['#64748b', '#16a34a', '#0d9488', '#7c3aed', '#b45309', '#2563eb', '#db2777', '#15803d', '#94a3b8'];

export default function EditorPage() {
  const { id } = useParams();
  const [plan, setPlan] = useState(null);
  const [elements, setElements] = useState([]);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cell, setCell] = useState(28);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ name: '', cols: 20, rows: 15 });
  const gridRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    flaskRequest(`/api/admin/floor-plans/${id}`)
      .then((data) => {
        setPlan(data); setElements(data.elements);
        setMeta({ name: data.name, cols: data.cols, rows: data.rows });
      })
      .catch((err) => setError(err.status === 401 ? 'Session expired — sign in again.' : err.message));
  }, [id]);

  const commit = useCallback((next) => {
    setPast((old) => [...old.slice(-49), elements]);
    setFuture([]); setElements(next); setDirty(true); setProblems([]);
  }, [elements]);

  const undo = () => {
    if (!past.length) return;
    setFuture([elements, ...future]); setElements(past[past.length - 1]);
    setPast(past.slice(0, -1)); setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast([...past, elements]); setElements(future[0]);
    setFuture(future.slice(1)); setDirty(true);
  };

  const cellFromEvent = (event) => {
    const rect = gridRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max(Math.floor((event.clientX - rect.left) / cell), 0), plan.cols - 1),
      y: Math.min(Math.max(Math.floor((event.clientY - rect.top) / cell), 0), plan.rows - 1),
    };
  };

  const dragSpec = (point) => {
    if (!dragRef.current) return null;
    if (dragRef.current.kind === 'add') return { id: null, type: dragRef.current.type, ...point, rotation: 0 };
    const current = elements.find((el) => el.id === dragRef.current.id);
    return current ? { ...current, ...point } : null;
  };

  const onDragOver = (event) => {
    if (!dragRef.current) return;
    event.preventDefault();
    const spec = dragSpec(cellFromEvent(event));
    if (spec) setPreview({ ...spec, valid: !placementError(spec, elements, plan.cols, plan.rows) });
  };

  const onDrop = (event) => {
    event.preventDefault();
    setPreview(null);
    const point = cellFromEvent(event);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const result = drag.kind === 'add'
      ? addElement(elements, drag.type, point.x, point.y, plan.cols, plan.rows, nextId)
      : moveElement(elements, drag.id, point.x, point.y, plan.cols, plan.rows);
    if (!result.error) commit(result.elements);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!plan || !selectedId || event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      if (event.key === 'r' || event.key === 'R') {
        const result = rotateElement(elements, selectedId, plan.cols, plan.rows);
        if (!result.error) commit(result.elements);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        commit(removeElement(elements, selectedId)); setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan, selectedId, elements, commit]);

  const updateSelected = (patch) => {
    commit(elements.map((el) => (el.id === selectedId ? { ...el, ...patch } : el)));
  };

  const save = async () => {
    const local = validateAll(elements, plan.cols, plan.rows);
    if (local.length) { setProblems(local); return; }
    setSaving(true); setProblems([]);
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}/elements`,
        { method: 'PUT', body: { elements } });
      setPlan(data); setElements(data.elements); setDirty(false); setSelectedId(null);
    } catch (err) {
      if (err.fields && err.fields.elements) setProblems([].concat(err.fields.elements));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    } finally { setSaving(false); }
  };

  const applyMeta = async () => {
    if (dirty && !window.confirm('Save grid changes reloads the plan and discards unsaved edits. Continue?')) return;
    try {
      const data = await flaskRequest(`/api/admin/floor-plans/${id}`,
        { method: 'PATCH', body: { name: meta.name, cols: Number(meta.cols), rows: Number(meta.rows) } });
      setPlan(data); setElements(data.elements); setDirty(false); setError(null);
    } catch (err) {
      if (err.status === 400 && err.fields) setProblems(Object.values(err.fields));
      else setError(err.status === 401 ? 'Session expired — sign in again.' : err.message);
    }
  };

  if (error) return <main className="page"><section className="card"><h1>Floor plan</h1><p className="notice-error">{error}</p></section></main>;
  if (!plan) return <main className="page"><section className="card">Loading…</section></main>;
  const selected = elements.find((el) => el.id === selectedId);

  return <main className="page fp-editor">
    <header className="fp-toolbar">
      <input aria-label="Plan label" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
      <label>Cols <input type="number" min="5" max="80" value={meta.cols} aria-label="Columns"
        onChange={(e) => setMeta({ ...meta, cols: e.target.value })} /></label>
      <label>Rows <input type="number" min="5" max="80" value={meta.rows} aria-label="Rows"
        onChange={(e) => setMeta({ ...meta, rows: e.target.value })} /></label>
      <button className="button subtle" onClick={applyMeta}>Apply</button>
      <span className="fp-spacer" />
      <label>Zoom <input type="range" min="16" max="48" value={cell} aria-label="Zoom"
        onChange={(e) => setCell(Number(e.target.value))} /></label>
      <button className="button subtle" onClick={undo} disabled={!past.length}>Undo</button>
      <button className="button subtle" onClick={redo} disabled={!future.length}>Redo</button>
      <button className="button" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save *' : 'Saved'}</button>
    </header>
    {problems.length > 0 && <p className="notice-error">{problems.join(' · ')}</p>}
    <div className="fp-panes">
      <aside className="fp-palette">
        <h2>Elements</h2>
        {CATALOG.map((entry) => <div key={entry.type} className="fp-chip" draggable
          onDragStart={(e) => { dragRef.current = { kind: 'add', type: entry.type }; e.dataTransfer.setData('text/plain', entry.type); }}>
          <span className="fp-swatch" style={{ background: entry.color }} />
          <b>{entry.label}</b><small>{entry.w}×{entry.h}</small>
        </div>)}
        <p className="fp-hint">Drag onto the grid. Click an element to select; R rotates, Del removes.</p>
      </aside>
      <div className="fp-grid-wrap">
        <div ref={gridRef} className="fp-grid" onDragOver={onDragOver} onDrop={onDrop}
          style={{ width: plan.cols * cell, height: plan.rows * cell, '--cell': `${cell}px` }}
          onClick={(e) => { if (e.target === gridRef.current) setSelectedId(null); }}>
          {elements.map((el) => {
            const size = effectiveSize(el.type, el.rotation || 0);
            const entry = catalogByType[el.type];
            return <div key={el.id} draggable
              className={`fp-el${selectedId === el.id ? ' selected' : ''}`}
              onDragStart={(e) => { dragRef.current = { kind: 'move', id: el.id }; e.dataTransfer.setData('text/plain', el.id); }}
              onClick={(e) => { e.stopPropagation(); setSelectedId(el.id); }}
              title={`${el.type} (${el.x},${el.y})`}
              style={{ left: el.x * cell, top: el.y * cell, width: size.w * cell, height: size.h * cell,
                       background: el.color || entry.color }}>
              {el.label || entry.label}
            </div>;
          })}
          {preview && <div className={`fp-preview ${preview.valid ? 'ok' : 'bad'}`}
            style={{ left: preview.x * cell, top: preview.y * cell,
                     width: effectiveSize(preview.type, preview.rotation).w * cell,
                     height: effectiveSize(preview.type, preview.rotation).h * cell }} />}
        </div>
      </div>
      <aside className="fp-inspector">
        <h2>{selected ? (catalogByType[selected.type].label) : 'Nothing selected'}</h2>
        {selected && <>
          <p>Type: {selected.type} · at {selected.x},{selected.y} · rotation {selected.rotation}°</p>
          <label>Label <input value={selected.label || ''} maxLength={60} aria-label="Element label"
            onChange={(e) => updateSelected({ label: e.target.value })} /></label>
          <p>Colour</p>
          <div className="fp-swatches">{SWATCHES.map((hex) => <button key={hex} aria-label={hex}
            className={selected.color === hex ? 'active' : ''} style={{ background: hex }}
            onClick={() => updateSelected({ color: hex })} />)}</div>
          <div className="fp-actions">
            <button className="button subtle" onClick={() => {
              const result = rotateElement(elements, selected.id, plan.cols, plan.rows);
              if (!result.error) commit(result.elements);
            }}>Rotate (R)</button>
            <button className="button subtle" onClick={() => {
              commit(removeElement(elements, selected.id)); setSelectedId(null);
            }}>Remove (Del)</button>
          </div>
        </>}
      </aside>
    </div>
  </main>;
}
```

- [ ] **Step 2: Append editor styles to `src/floorplan/floorplan.css`**

```css
.fp-editor .fp-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
.fp-editor .fp-toolbar input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
.fp-editor .fp-toolbar label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.fp-editor .fp-toolbar label input[type="number"] { width: 64px; }
.fp-spacer { flex: 1; }
.fp-panes { display: grid; grid-template-columns: 180px minmax(0, 1fr) 220px; gap: 14px; align-items: start; }
.fp-palette .fp-chip { display: flex; align-items: center; gap: 8px; padding: 8px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); cursor: grab; }
.fp-chip small { color: var(--muted); margin-left: auto; }
.fp-swatch { width: 16px; height: 16px; border-radius: 4px; flex: none; }
.fp-hint { color: var(--muted); font-size: 12px; }
.fp-grid-wrap { overflow: auto; }
.fp-grid { position: relative; background-color: var(--surface); background-image: linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px); background-size: var(--cell) var(--cell); border: 1px solid var(--border); border-radius: 6px; }
.fp-el { position: absolute; color: #fff; font-size: 11px; padding: 3px; overflow: hidden; border-radius: 4px; border: 1px solid rgba(0, 0, 0, .25); cursor: grab; user-select: none; }
.fp-el.selected { outline: 3px solid var(--accent); outline-offset: -1px; }
.fp-preview { position: absolute; border-radius: 4px; pointer-events: none; opacity: .55; }
.fp-preview.ok { outline: 2px dashed #16a34a; background: rgba(22, 163, 74, .35); }
.fp-preview.bad { outline: 2px dashed #dc2626; background: rgba(220, 38, 38, .35); }
.fp-inspector label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; margin: 8px 0; }
.fp-inspector input { padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
.fp-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.fp-swatches button { width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; }
.fp-swatches button.active { border-color: var(--text); }
.fp-actions { display: flex; gap: 8px; margin-top: 12px; }
@media (max-width: 1100px) { .fp-panes { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Register the editor route in `src/App.jsx`**

Import alongside `FloorPlansPage`:

```js
import EditorPage from './floorplan/EditorPage.jsx';
```

Route (before catch-all):

```jsx
<Route path="/floor-plans/:id" element={<EditorPage />} />
```

- [ ] **Step 4: Manual smoke (full round trip)**

With Flask (:5000) and Vite (:5173) running and `?flask_token=` still in the URL:
1. List page → click a plan → editor loads its grid (grid lines visible, zoom slider works).
2. Drag `Seat` chip onto grid → green seat appears; drag a second seat onto it → red preview, drop rejected.
3. Drag `Meeting room`, press R → preview swaps 3×2↔2×3; move near right edge until it doesn't fit → red preview.
4. Select an element, set label `A-01` and a swatch color → shown on the element.
5. Undo/Redo buttons restore states. Del removes.
6. Save → button shows "Saved"; reload page → elements come back from Flask with ids (verify `curl.exe http://127.0.0.1:5000/api/admin/floor-plans/<id> -H "Authorization: Bearer <token>"` returns the same count).
7. Change rows below an element's extent → Apply → problem message "N elements fall outside the new grid; move them first".

- [ ] **Step 5: Commit**

```powershell
git add webapp-frontend/src/floorplan/EditorPage.jsx webapp-frontend/src/floorplan/floorplan.css webapp-frontend/src/App.jsx
git commit -m "feat: add visual floor plan editor with palette drag, rotation and save"
```

---

### Task 7: Documentation + release gate

**Files:**
- Modify: `webapp-backend/README.md`
- Test: full pytest run

**Interfaces:**
- Consumes: everything above.
- Produces: documented endpoints; green full suite (release gate).

- [ ] **Step 1: Append to `webapp-backend/README.md`** (after the Admin users table)

```markdown
## Floor plans (`Authorization: Bearer <admin token>` required)

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/floor-plans` | List plans (name, grid size, element count) |
| `POST /api/admin/floor-plans` | Create plan `{name, cols, rows}` (5–80 grid) |
| `GET /api/admin/floor-plans/<id>` | Plan with all placed elements |
| `PATCH /api/admin/floor-plans/<id>` | Rename / resize grid (guards stranded elements) |
| `DELETE /api/admin/floor-plans/<id>` | Delete plan + elements |
| `PUT /api/admin/floor-plans/<id>/elements` | Bulk save placements `{elements:[{type,x,y,rotation,label?,color?}]}` |
| `GET /api/admin/floor-plans/catalog` | Fixed element catalog |

Frontend editor: `webapp-frontend` → sidebar “Floor plans” (Vite proxies
`/api/auth` and `/api/admin/floor-plans` to the Flask API; set
`VITE_FLASK_TARGET` if it is not on `http://localhost:5000`).
Element types: wall, seat, toilet, elevator, door, meeting_room, kitchen,
plant, corridor — fixed footprints, rotation 0/90/180/270.
```

- [ ] **Step 2: Run the full backend suite (release gate)**

Run (from `webapp-backend/`): `python -m pytest -v`
Expected: ALL PASS (previous 63 + ~14 new).

- [ ] **Step 3: Run the logic smoke**

Run (from `webapp-frontend/`): `node scripts/smoke_floorplan_logic.mjs`
Expected: `floorplan logic smoke OK`

- [ ] **Step 4: Commit**

```powershell
git add webapp-backend/README.md
git commit -m "docs: document floor plan endpoints and editor wiring"
```

---

## Definition of Done

- `python -m pytest` fully green (test schema `hotdesk_test`), including floor plan schema, CRUD, bulk-save, and auth tests.
- `sql/0008_floor_plans.sql` idempotent and applied to dev Supabase `public`.
- Frontend: create/rename/resize/delete plans; drag-place all 9 catalog types with live valid/invalid preview; rotate with w/h swap; overlap/out-of-bounds blocked client-side AND server-side; bulk save round-trips through Flask; undo/redo; 401 shows "Session expired — sign in again."
- `node scripts/smoke_floorplan_logic.mjs` passes.
- No legacy pages affected (`/api` still proxies to :3000 for everything else).
