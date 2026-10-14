# Auth & Users ORM Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-SQL data access in the shipped auth/admin users module with SQLAlchemy 2.0 ORM models, without changing any HTTP/API behavior.

**Architecture:** New `app/core/auth_models.py` maps the existing tables (DDL stays owned by `sql/` scripts); rewrite `core/audit.py`, `core/users.py`, `auth/tokens.py`, `auth/routes.py`, `admin/users.py`, `admin/departments.py`, `scripts/create_admin.py` to use the models through the shared `app/core/orm.py` session layer. HTTP contracts, JSON shapes, status codes, audit actions and app logs stay byte-identical.

**Tech Stack:** SQLAlchemy 2.0 ORM (DeclarativeBase, Mapped/mapped_column), Flask 3 blueprints, pytest (existing suite is the regression gate).

## Global Constraints

- **PREREQUISITE:** `app/core/orm.py` (`Base`, `orm_session()`, `init_orm`) and its wiring in `create_app` must exist first. They are created by Task 1 of `docs/superpowers/plans/2026-10-13-admin-floorplan-builder.md` — run that task first (or verify the files exist).
- **The existing test suite is the contract.** Do NOT modify any test under `tests/` except where a task step explicitly says so (expected: nowhere). Every task ends with `python -m pytest` fully green (~63+ tests).
- `app/core/db.py` (`run_query`/`run_one`/`run_write`) stays in place — legacy code and tests still use it. This refactor only moves the modules listed in Goal off it.
- No API-visible changes: identical response JSON keys (ids are strings), status codes, error bodies (`{"error"}` / `fields`), audit `action` strings and `details` keys, app-log messages, lockout clamping (≤5), validity-window rules, token TTLs (activate 72h / reset 1h), password min length 8.
- Never log or audit passwords/hashes/tokens/JWTs.
- DDL is unchanged — no new SQL scripts, no `create_all`, no Alembic. Models mirror existing DDL (server defaults via `server_default=text(...)`).
- Every attribute change that the old SQL marked with `updated_at = now()` must set `obj.updated_at = func.now()` explicitly before commit (there is no DB trigger).
- Commit after every green task; `refactor:` prefix.
- All commands from `webapp-backend/`.

---

### Task 1: ORM models for auth tables + mapping smoke test

**Files:**
- Create: `webapp-backend/app/core/auth_models.py`
- Test: `webapp-backend/tests/test_auth_models.py`

**Interfaces:**
- Consumes: `app.core.orm.Base` (prerequisite), existing tables `roles`, `users`, `departments`, `user_departments`, `user_tokens`, `audit_logs` in `hotdesk_test`/`public`.
- Produces: `Role`, `User`, `Department`, `UserDepartment`, `UserToken`, `AuditLog` mapped classes (used by all later tasks). `User.role` eager-joined; `User.departments` many-to-many via `UserDepartment` ordered by department name.

- [ ] **Step 1: Write the failing mapping test**

`webapp-backend/tests/test_auth_models.py`:

```python
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.auth_models import AuditLog, Department, Role, User, UserToken
from app.core.db import run_one
from app.core.orm import orm_session


def test_user_orm_roundtrip(app, db):
    session = orm_session()
    dept = Department(name="Eng")
    session.add(dept)
    user = User(email="m@x.com", username="mm", full_name="M M", role_id=1)
    user.departments = [dept]
    session.add(user)
    session.commit()
    loaded = session.get(User, str(user.id))
    assert loaded.id is not None and isinstance(loaded.id.hex, str)
    assert loaded.role.name == "user"
    assert [d.name for d in loaded.departments] == ["Eng"]
    assert loaded.is_active is True and loaded.failed_attempts == 0
    assert loaded.created_at is not None


def test_token_and_audit_orm(app, db):
    session = orm_session()
    uid = str(run_one("insert into users (email, username, full_name, role_id) "
                      "values ('t@x.com', 'tt', 'T', 1) returning id")["id"])
    session.add(UserToken(user_id=uid, token_hash="hash-1", purpose="reset",
                          expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    session.add(AuditLog(actor_id=uid, action="user.create", target_id=uid, details={"role": "user"}))
    session.commit()
    assert session.scalar(select(func.count()).select_from(UserToken)) == 1
    audit = session.scalars(select(AuditLog)).one()
    assert audit.details == {"role": "user"} and str(audit.actor_id) == uid


def test_roles_seed_visible(app, db):
    names = set(orm_session().scalars(select(Role.name)).all())
    assert {"user", "admin"} <= names
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_auth_models.py -v`
Expected: ERROR — `ModuleNotFoundError: No module named 'app.core.auth_models'`.

- [ ] **Step 3: Implement `app/core/auth_models.py`**

```python
import datetime as dt
import uuid

from sqlalchemy import (BigInteger, Boolean, Date, DateTime, ForeignKey, PrimaryKeyConstraint,
                        SmallInteger, Text, func, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .orm import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())


class UserDepartment(Base):
    __tablename__ = "user_departments"
    __table_args__ = (PrimaryKeyConstraint("user_id", "department_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    department_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default=text("gen_random_uuid()"))
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    start_date: Mapped[dt.date | None] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)
    failed_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0,
                                                 server_default=text("0"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())

    role: Mapped[Role] = relationship(lazy="joined")
    departments: Mapped[list[Department]] = relationship(
        secondary=UserDepartment, lazy="joined", order_by=Department.name)


class UserToken(Base):
    __tablename__ = "user_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict,
                                          server_default=text("'{}'::jsonb"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())
```

Notes for the implementer:
- `citext` columns are mapped as plain `Text` — case-insensitive equality is done by Postgres, so `==` comparisons keep working unchanged.
- `User.departments` uses `secondary=UserDepartment` (association object keeps `created_at`). `lazy="joined"` replicates the old single-query `DEPT_AGG` fetch.
- `AuditLog.id` is a `BIGINT GENERATED ALWAYS AS IDENTITY` key — SQLAlchemy's autoincrement behavior omits it on INSERT and fetches it via RETURNING.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_auth_models.py -v`
Expected: 3 passed.

- [ ] **Step 5: Run the full suite (must stay green — pure addition)**

Run: `python -m pytest -q`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/core/auth_models.py tests/test_auth_models.py
git commit -m "feat: add SQLAlchemy models for auth and users tables"
```

---

### Task 2: Refactor the full auth+admin vertical to models (single atomic rewrite)

`public_user` changes from a raw-row-dict input to a `User` model input, and `SELECT_PUBLIC_USER`/`DEPT_AGG` disappear. `admin/users.py` imports those names, so the core helpers, both verticals and the endpoints must move together in ONE task or the suite cannot stay green mid-way.

**Files:**
- Modify: `webapp-backend/app/core/audit.py` (full rewrite)
- Modify: `webapp-backend/app/core/users.py` (full rewrite)
- Modify: `webapp-backend/app/auth/tokens.py` (full rewrite)
- Modify: `webapp-backend/app/auth/routes.py` (full rewrite)
- Modify: `webapp-backend/app/admin/users.py` (full rewrite)
- Modify: `webapp-backend/app/admin/departments.py` (full rewrite)
- Test: no new files — `tests/test_core_db.py`, `tests/test_auth_tokens.py`, `tests/test_auth_login.py`, `tests/test_password_flows.py`, `tests/test_admin_users.py`, `tests/test_admin_departments.py`, `tests/test_logging.py` are the gate

**Interfaces:**
- Consumes: Task 1 models, `orm_session()`.
- Produces (signatures unchanged unless noted):
  - `app.core.audit.write_audit(actor_id, action, target_id, details=None)` — same behavior, ORM insert
  - `app.core.users.public_user(user: User) -> dict` — **input changed from raw row dict to `User` model**
  - `app.core.users.fetch_user(user_id: str) -> dict | None`
  - `app.core.users.find_user_by_identity(identity: str) -> User | None` — NEW (email OR username, citext case-insensitive); replaces `_find_identifier` in `auth/routes.py` and the login lookup
  - `app.core.users.email_exists(email, exclude_id=None)` / `username_exists(username, exclude_id=None)`
  - `DEPT_AGG` / `SELECT_PUBLIC_USER` are REMOVED (the admin rewrite in this same task stops importing them)
  - `app.auth.tokens.*` — identical signatures/return dicts (`validate_token` returns `{"user_id": str, "token_hash": str, "purpose": str}`)

- [ ] **Step 1: Rewrite `app/core/audit.py`**

```python
from app.core.auth_models import AuditLog

from .orm import orm_session


def write_audit(actor_id, action: str, target_id, details: dict | None = None) -> None:
    session = orm_session()
    session.add(AuditLog(actor_id=actor_id, action=action, target_id=target_id,
                         details=details or {}))
    session.commit()
```

- [ ] **Step 2: Rewrite `app/core/users.py`**

```python
from sqlalchemy import or_, select

from app.core.auth_models import User

from .orm import orm_session


def public_user(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role.name,
        "is_active": user.is_active,
        "start_date": user.start_date.isoformat() if user.start_date else None,
        "end_date": user.end_date.isoformat() if user.end_date else None,
        "departments": [{"id": str(d.id), "name": d.name} for d in user.departments],
        "status": "pending_activation" if user.password_hash is None else "active",
    }


def fetch_user(user_id: str):
    user = orm_session().get(User, user_id)
    return public_user(user) if user else None


def find_user_by_identity(identity: str):
    return orm_session().scalars(
        select(User).where(or_(User.email == identity, User.username == identity))).first()


def _exists(column, value: str, exclude_id: str | None) -> bool:
    stmt = select(User.id).where(column == value)
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return orm_session().scalar(stmt) is not None


def email_exists(email: str, exclude_id: str | None = None) -> bool:
    return _exists(User.email, email, exclude_id)


def username_exists(username: str, exclude_id: str | None = None) -> bool:
    return _exists(User.username, username, exclude_id)
```

- [ ] **Step 3: Rewrite `app/auth/tokens.py`**

```python
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.core.auth_models import UserToken
from app.core.orm import orm_session


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def issue_token(user_id: str, purpose: str, hours: int) -> str:
    raw = secrets.token_urlsafe(32)
    invalidate_tokens(user_id, purpose)
    session = orm_session()
    session.add(UserToken(user_id=user_id, token_hash=_hash(raw), purpose=purpose,
                          expires_at=_now() + timedelta(hours=hours)))
    session.commit()
    return raw


def validate_token(raw: str, purpose: str):
    row = orm_session().execute(
        select(UserToken.user_id, UserToken.token_hash, UserToken.purpose)
        .where(UserToken.token_hash == _hash(raw), UserToken.purpose == purpose,
               UserToken.used_at.is_(None), UserToken.expires_at > _now())
    ).mappings().first()
    if row is None:
        return None
    return {"user_id": str(row["user_id"]), "token_hash": row["token_hash"],
            "purpose": row["purpose"]}


def consume_token(token_hash: str) -> None:
    session = orm_session()
    session.execute(update(UserToken).where(UserToken.token_hash == token_hash)
                    .values(used_at=_now()))
    session.commit()


def invalidate_tokens(user_id: str, purpose: str | None = None) -> None:
    stmt = update(UserToken).where(UserToken.user_id == user_id, UserToken.used_at.is_(None))
    if purpose:
        stmt = stmt.where(UserToken.purpose == purpose)
    session = orm_session()
    session.execute(stmt.values(used_at=_now()))
    session.commit()
```

- [ ] **Step 4: Rewrite `app/auth/routes.py`**

```python
import datetime as dt
import logging
from functools import wraps

from flask import current_app, g, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, verify_jwt_in_request
from sqlalchemy import func

from app.core.audit import write_audit
from app.core.email import send_email
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import hash_password, verify_password
from app.core.users import fetch_user, find_user_by_identity, public_user

from . import auth_bp
from .tokens import consume_token, issue_token, validate_token

log = logging.getLogger("app.auth")
MAX_FAILED_ATTEMPTS = 5
RESET_HOURS = 1


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except Exception:
            return error("authentication required", 401)
        return fn(*args, **kwargs)

    return wrapper


def get_current_user_row():
    return fetch_user(get_jwt_identity())


def _identity(body: dict) -> str:
    return (body.get("email_or_username") or body.get("email") or body.get("username") or "").strip()


@auth_bp.post("/login")
def login():
    body = request.get_json(silent=True) or request.form.to_dict() or {}
    identity, password = _identity(body), body.get("password") or ""
    user = find_user_by_identity(identity)
    session = orm_session()
    if user is None:
        write_audit(None, "auth.login_failed", None, {"identifier": identity})
        return error("invalid credentials", 401)
    if not user.password_hash:
        write_audit(None, "auth.login_failed", str(user.id), {"identifier": identity})
        log.warning("login attempt for user with no password set: %s", identity)
        return error("password not set, check your email to activate your account", 403)
    if not verify_password(password, user.password_hash):
        attempts = min(user.failed_attempts + 1, MAX_FAILED_ATTEMPTS)
        user.failed_attempts = attempts
        user.updated_at = func.now()
        locked = attempts >= MAX_FAILED_ATTEMPTS and user.is_active
        if locked:
            user.is_active = False
        session.commit()
        if locked:
            write_audit(str(user.id), "account.locked", str(user.id), {"failed_attempts": attempts})
            log.warning("account locked after %d failed attempts: %s", attempts, identity)
        write_audit(None, "auth.login_failed", str(user.id), {"identifier": identity})
        log.warning("failed login for %s", identity)
        return error("invalid credentials", 401)

    if not user.is_active:
        return error("account disabled", 403)
    today = dt.date.today()
    if user.start_date and today < user.start_date:
        return error("account not yet active", 403)
    if user.end_date and today > user.end_date:
        return error("account expired", 403)
    if user.failed_attempts:
        user.failed_attempts = 0
        user.updated_at = func.now()
        session.commit()
    write_audit(str(user.id), "auth.login_success", str(user.id), {})
    token = create_access_token(identity=str(user.id),
                                additional_claims={"role": user.role.name, "email": user.email})
    g.jwt_uid = str(user.id)
    return jsonify(token=token, user=public_user(user))


@auth_bp.get("/me")
@auth_required
def me():
    user = get_current_user_row()
    if user is None:
        return error("user not found", 401)
    return jsonify(user)


@auth_bp.post("/forgot-password")
def forgot_password():
    body = request.get_json(silent=True) or {}
    user = find_user_by_identity((body.get("email") or "").strip())
    if user and user.is_active:
        raw = issue_token(str(user.id), "reset", RESET_HOURS)
        link = f"{current_app.config['FRONTEND_URL']}/set-password?token={**}"
        try:
            send_email(user.email, "Reset your password",
                       f'<p>Use the link within 1 hour to set a new password:</p>'
                       f'<p><a href="{link}">{link}</a></p>')
        except Exception as exc:
            log.error("forgot-password email failed: %s", exc)
        write_audit(str(user.id), "password_reset.requested", str(user.id), {})
    return ("", 204)


@auth_bp.get("/set-password/verify")
def verify_set_password():
    raw = request.args.get("token", "")
    purpose = request.args.get("purpose", "reset")
    if purpose not in ("reset", "activate"):
        return error("invalid purpose", 400)
    rec = validate_token(raw, purpose)
    valid = rec is not None
    if valid and purpose == "reset":
        from app.core.auth_models import User

        target = orm_session().get(User, rec["user_id"])
        valid = bool(target and target.is_active)
    return jsonify(valid=valid)


@auth_bp.post("/set-password")
def set_password():
    body = request.get_json(silent=True) or {}
    raw, password = body.get("token", ""), body.get("password") or ""
    if len(password) < 8:
        return error("validation failed", 400,
                     fields={"password": "password must be at least 8 characters"})
    rec = validate_token(raw, "activate") or validate_token(raw, "reset")
    if rec is None:
        log.warning("invalid or expired set-password token used")
        return error("invalid or expired token", 400)
    from app.core.auth_models import User

    session = orm_session()
    user = session.get(User, rec["user_id"])
    user.password_hash = hash_password(password)
    user.failed_attempts = 0
    user.is_active = True
    user.updated_at = func.now()
    session.commit()
    consume_token(rec["token_hash"])
    write_audit(rec["user_id"], "account.activated" if rec["purpose"] == "activate"
                else "password_reset.completed", rec["user_id"], {})
    return ("", 204)
```

Move the two `from app.core.auth_models import User` imports to the top of the file when you finalize (shown inline to keep the diff readable).

- [ ] **Step 5: Rewrite `app/admin/users.py`**

```python
import datetime as dt
import logging
import uuid

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.auth.tokens import invalidate_tokens, issue_token
from app.core.audit import write_audit
from app.core.auth_models import Department, Role, User, UserDepartment
from app.core.email import invitation_email, send_email
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required, hash_password
from app.core.users import email_exists, fetch_user, public_user, username_exists

from . import admin_bp

log = logging.getLogger("app.admin")

ROLE_NAMES = {"user", "admin"}
MAX_PAGE_SIZE = 100


def _valid_email(value: str) -> bool:
    return bool(value) and "@" in value and "." in value.split("@")[-1]


def valid_date(value):
    try:
        return dt.date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def VALIDATION_ERRORS(body: dict) -> dict:
    fields = {}
    if not _valid_email((body.get("email") or "").strip()):
        fields["email"] = "a valid email is required"
    username = (body.get("username") or "").strip()
    if len(username) < 2 or not username.replace("_", "").isalnum():
        fields["username"] = "username must be alphanumeric, at least 2 characters"
    if not (body.get("full_name") or "").strip():
        fields["full_name"] = "full_name is required"
    if body.get("role") not in ROLE_NAMES:
        fields["role"] = "role must be one of: user, admin"
    start = valid_date(body["start_date"]) if body.get("start_date") else None
    end = valid_date(body["end_date"]) if body.get("end_date") else None
    if body.get("start_date") and start is None:
        fields["start_date"] = "invalid date (use YYYY-MM-DD)"
    if body.get("end_date") and end is None:
        fields["end_date"] = "invalid date (use YYYY-MM-DD)"
    if start and end and start > end:
        fields["end_date"] = "end_date must be on or after start_date"
    return fields


def _parse_ids(department_ids: list[str]) -> list[str] | None:
    try:
        return [str(uuid.UUID(d)) for d in department_ids]
    except (ValueError, TypeError, AttributeError):
        return None


def _departments_exist(department_ids: list[str]) -> bool:
    parsed = _parse_ids(department_ids)
    if parsed is None or len(set(parsed)) != len(parsed):
        return False
    rows = orm_session().scalars(select(Department.id).where(Department.id.in_(parsed))).all()
    return {str(r) for r in rows} == set(parsed)


def _set_departments(user: User, department_ids: list[str]) -> None:
    session = orm_session()
    user.departments = [session.get(Department, d) for d in department_ids]


@admin_bp.post("/users")
@admin_required
def create_user():
    body = request.get_json(silent=True) or {}
    fields = VALIDATION_ERRORS(body)
    dept_ids = _parse_ids(body.get("department_ids") or [])
    if (body.get("department_ids") or []) and dept_ids is None:
        fields["department_ids"] = "unknown department id"
        dept_ids = []
    if dept_ids and not _departments_exist(dept_ids):
        fields["department_ids"] = "unknown department id"
    if fields:
        return error("validation failed", 400, fields=fields)
    if email_exists(body["email"]):
        return error("email already exists", 409)
    if username_exists(body["username"]):
        return error("username already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    session = orm_session()
    user = User(
        email=body["email"], username=body["username"], full_name=body["full_name"].strip(),
        role_id=session.scalar(select(Role.id).where(Role.name == body["role"])),
        start_date=valid_date(body["start_date"]) if body.get("start_date") else None,
        end_date=valid_date(body["end_date"]) if body.get("end_date") else None,
    )
    if dept_ids:
        user.departments = [session.get(Department, d) for d in dept_ids]
    try:
        session.add(user)
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("email or username already exists", 409)
    write_audit(actor, "user.create", str(user.id),
                {"email": body["email"], "username": body["username"], "role": body["role"]})
    _send_invitation(str(user.id), body["email"], body["full_name"], body["username"])
    return jsonify(public_user(user)), 201


def _send_invitation(user_id: str, email_addr: str, full_name: str, username: str) -> None:
    raw = issue_token(user_id, "activate", 72)
    link = f"{current_app.config['FRONTEND_URL']}/set-password?token={**}"
    subject, html = invitation_email(full_name, link)
    try:
        send_email(email_addr, subject, html)
        write_audit(get_jwt_identity(), "user.invitation_sent", user_id, {"email": email_addr})
    except Exception as exc:
        log.error("invitation email failed for %s: %s", email_addr, exc)
        raise


@admin_bp.get("/users")
@admin_required
def list_users():
    q = (request.args.get("q") or "").strip()
    role = (request.args.get("role") or "").strip()
    status = (request.args.get("status") or "").strip()
    department = (request.args.get("department") or "").strip()
    try:
        page = max(int(request.args.get("page", 1)), 1)
        page_size = min(max(int(request.args.get("page_size", 20)), 1), MAX_PAGE_SIZE)
    except ValueError:
        return error("page and page_size must be integers", 400)
    conds = []
    if q:
        pattern = f"%{q}%"
        conds.append(or_(User.email.ilike(pattern), User.username.ilike(pattern),
                         User.full_name.ilike(pattern)))
    if role:
        conds.append(Role.name == role)
    if status == "active":
        conds.append(User.is_active.is_(True))
    elif status == "inactive":
        conds.append(User.is_active.is_(False))
    if department:
        try:
            dept_cond = UserDepartment.department_id == str(uuid.UUID(department))
        except ValueError:
            dept_cond = Department.name.ilike(department)
        subquery = (select(UserDepartment.user_id)
                    .join(Department, Department.id == UserDepartment.department_id)
                    .where(UserDepartment.user_id == User.id, dept_cond)
                    .correlate(User).exists())
        conds.append(subquery)
    session = orm_session()
    total = session.scalar(select(func.count()).select_from(User)
                           .join(Role, Role.id == User.role_id).where(*conds))
    users = session.scalars(
        select(User).join(Role, Role.id == User.role_id).where(*conds)
        .order_by(User.created_at.desc()).limit(page_size).offset((page - 1) * page_size)).all()
    g.jwt_uid = get_jwt_identity()
    return jsonify(items=[public_user(u) for u in users], total=total,
                   page=page, page_size=page_size)


@admin_bp.get("/users/<uuid:user_id>")
@admin_required
def get_user(user_id):
    user = fetch_user(str(user_id))
    if user is None:
        return error("user not found", 404)
    return jsonify(user)


def is_last_active_admin(user_id: str) -> bool:
    count = orm_session().scalar(
        select(func.count()).select_from(User).join(Role, Role.id == User.role_id)
        .where(Role.name == "admin", User.is_active.is_(True), User.id != user_id))
    return count == 0


PATCHABLE = ("full_name", "username", "email", "role", "is_active",
             "start_date", "end_date", "department_ids")


@admin_bp.patch("/users/<uuid:user_id>")
@admin_required
def patch_user(user_id):
    session = orm_session()
    user = session.get(User, str(user_id))
    if user is None:
        return error("user not found", 404)
    body = request.get_json(silent=True) or {}
    unknown = set(body) - set(PATCHABLE)
    if unknown:
        return error("validation failed", 400,
                     fields={k: "unknown field" for k in sorted(unknown)})
    if not body:
        return error("no fields provided", 400)
    actor = get_jwt_identity()
    g.jwt_uid = actor

    fields = {}
    if "email" in body and not _valid_email((body["email"] or "").strip()):
        fields["email"] = "a valid email is required"
    if "username" in body:
        username = (body["username"] or "").strip()
        if len(username) < 2 or not username.replace("_", "").isalnum():
            fields["username"] = "username must be alphanumeric, at least 2 characters"
    if "full_name" in body and not (body["full_name"] or "").strip():
        fields["full_name"] = "full_name is required"
    if "role" in body and body["role"] not in ROLE_NAMES:
        fields["role"] = "role must be one of: user, admin"
    start = valid_date(body["start_date"]) if body.get("start_date") else None
    end = valid_date(body["end_date"]) if body.get("end_date") else None
    if body.get("start_date") and start is None:
        fields["start_date"] = "invalid date (use YYYY-MM-DD)"
    if body.get("end_date") and end is None:
        fields["end_date"] = "invalid date (use YYYY-MM-DD)"
    if start or end:
        s = start if "start_date" in body else user.start_date
        e = end if "end_date" in body else user.end_date
        if s and e and s > e:
            fields["end_date"] = "end_date must be on or after start_date"
    dept_ids = None
    if "department_ids" in body:
        dept_ids = _parse_ids(body["department_ids"] or [])
        if dept_ids is None or not _departments_exist(dept_ids):
            fields["department_ids"] = "unknown department id"
    if fields:
        return error("validation failed", 400, fields=fields)

    demoting = body.get("role") and body["role"] != user.role.name
    disabling = body.get("is_active") is False
    if str(user.id) == actor and (demoting or disabling):
        return error("you cannot demote or disable your own account", 409)
    if (demoting or disabling) and user.role.name == "admin" and user.is_active:
        if is_last_active_admin(str(user.id)):
            return error("cannot remove or disable the last active admin", 409)
    if "email" in body and email_exists(body["email"].strip(), exclude_id=str(user.id)):
        return error("email already exists", 409)
    if "username" in body and username_exists(body["username"].strip(), exclude_id=str(user.id)):
        return error("username already exists", 409)

    pending_before = user.password_hash is None
    if "full_name" in body:
        user.full_name = body["full_name"].strip()
    if "username" in body:
        user.username = body["username"].strip()
    if "email" in body:
        user.email = body["email"].strip()
    if "role" in body:
        user.role_id = session.scalar(select(Role.id).where(Role.name == body["role"]))
    if "is_active" in body:
        user.is_active = body["is_active"]
        if body["is_active"]:
            user.failed_attempts = 0
    if "start_date" in body:
        user.start_date = start
    if "end_date" in body:
        user.end_date = end
    if dept_ids is not None:
        _set_departments(user, dept_ids)
    user.updated_at = func.now()
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("email or username already exists", 409)

    if "department_ids" in body:
        write_audit(actor, "user.departments_updated", str(user.id),
                    {"department_ids": dept_ids})
    changed = [k for k in body if k != "department_ids"]
    if changed:
        write_audit(actor, "user.update", str(user.id), {"fields": sorted(changed)})
    if "is_active" in body:
        write_audit(actor, "user.enable" if body["is_active"] else "user.disable",
                    str(user.id), {})
    if "email" in body and pending_before:
        invalidate_tokens(str(user.id), "activate")
        _send_invitation(str(user.id), user.email, user.full_name, user.username)
    return jsonify(public_user(user))


@admin_bp.delete("/users/<uuid:user_id>")
@admin_required
def delete_user(user_id):
    session = orm_session()
    user = session.get(User, str(user_id))
    if user is None:
        return error("user not found", 404)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    if str(user.id) == actor:
        return error("you cannot delete your own account", 409)
    if user.role.name == "admin" and user.is_active and is_last_active_admin(str(user.id)):
        return error("cannot remove the last active admin", 409)
    session.delete(user)
    session.commit()
    write_audit(actor, "user.delete", str(user_id), {})
    return ("", 204)


@admin_bp.post("/users/<uuid:user_id>/password")
@admin_required
def admin_set_password(user_id):
    body = request.get_json(silent=True) or {}
    password = body.get("password") or ""
    if len(password) < 8:
        return error("validation failed", 400,
                     fields={"password": "password must be at least 8 characters"})
    session = orm_session()
    user = session.get(User, str(user_id))
    if user is None:
        return error("user not found", 404)
    user.password_hash = hash_password(password)
    user.failed_attempts = 0
    user.is_active = True
    user.updated_at = func.now()
    session.commit()
    invalidate_tokens(str(user_id))
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "user.password_reset", str(user_id), {})
    return ("", 204)


@admin_bp.post("/users/<uuid:user_id>/resend-invitation")
@admin_required
def resend_invitation(user_id):
    user = orm_session().get(User, str(user_id))
    if user is None:
        return error("user not found", 404)
    if user.password_hash is not None:
        return error("user already activated", 409)
    g.jwt_uid = get_jwt_identity()
    _send_invitation(str(user.id), user.email, user.full_name, user.username)
    return ("", 204)
```

- [ ] **Step 6: Rewrite `app/admin/departments.py`**

```python
from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.audit import write_audit
from app.core.auth_models import Department, UserDepartment
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp


def _dept_dto(dept: Department, user_count: int) -> dict:
    return {"id": str(dept.id), "name": dept.name, "description": dept.description,
            "user_count": user_count}


def _count_subquery():
    return (select(func.count()).select_from(UserDepartment)
            .where(UserDepartment.department_id == Department.id)
            .correlate(Department).scalar_subquery())


def _dept(dept_id: str):
    row = orm_session().execute(
        select(Department, _count_subquery().label("user_count"))
        .where(Department.id == dept_id)).first()
    return None if row is None else _dept_dto(row[0], row[1])


@admin_bp.get("/departments")
@admin_required
def list_departments():
    g.jwt_uid = get_jwt_identity()
    rows = orm_session().execute(
        select(Department, _count_subquery().label("user_count"))
        .order_by(Department.name)).all()
    return jsonify(items=[_dept_dto(d, c) for d, c in rows])


@admin_bp.post("/departments")
@admin_required
def create_department():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return error("validation failed", 400, fields={"name": "name is required"})
    session = orm_session()
    dept = Department(name=name, description=body.get("description") or None)
    try:
        session.add(dept)
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("department name already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.create", None,
                {"name": name, "department_id": str(dept.id)})
    return jsonify(_dept(str(dept.id))), 201


@admin_bp.patch("/departments/<uuid:dept_id>")
@admin_required
def update_department(dept_id):
    body = request.get_json(silent=True) or {}
    session = orm_session()
    dept = session.get(Department, str(dept_id))
    if dept is None:
        return error("department not found", 404)
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return error("validation failed", 400, fields={"name": "name is required"})
        dept.name = name
    if "description" in body:
        dept.description = body["description"]
    if not set(body) & {"name", "description"}:
        return error("no fields provided", 400)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        return error("department name already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.update", None,
                {"department_id": str(dept_id), "fields": sorted(body)})
    return jsonify(_dept(str(dept_id)))


@admin_bp.delete("/departments/<uuid:dept_id>")
@admin_required
def delete_department(dept_id):
    session = orm_session()
    dept = session.get(Department, str(dept_id))
    if dept is None:
        return error("department not found", 404)
    user_count = session.scalar(select(func.count()).select_from(UserDepartment)
                                .where(UserDepartment.department_id == dept.id))
    name = dept.name
    session.delete(dept)
    session.commit()
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.delete", None,
                {"department_id": str(dept_id), "name": name, "user_count": user_count})
    return ("", 204)
```

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest -q`
Expected: ALL PASS. Behavioral notes the tests pin down and this code must match: duplicate email/username checks are case-insensitive (citext `==`), department filter accepts uuid-or-name, patch audits fire in the order `user.departments_updated` → `user.update` → `user.enable/disable`, delete audits have empty details, `element`→`user_count` shape unchanged.

- [ ] **Step 8: Confirm no raw-SQL remains in the refactored modules**

Run: `python -c "import pathlib; [print(f) for f in ['app/core/audit.py','app/core/users.py','app/auth/tokens.py','app/auth/routes.py','app/admin/users.py','app/admin/departments.py'] if 'run_write' in pathlib.Path(f).read_text(encoding='utf-8') or 'run_one' in pathlib.Path(f).read_text(encoding='utf-8') or 'run_query' in pathlib.Path(f).read_text(encoding='utf-8')]"`
Expected: no output (empty).

- [ ] **Step 9: Commit**

```powershell
git add app/core/audit.py app/core/users.py app/auth/tokens.py app/auth/routes.py app/admin/users.py app/admin/departments.py
git commit -m "refactor: move auth and admin users modules to SQLAlchemy models"
```

---

### Task 3: Bootstrap script + release gate

**Files:**
- Modify: `webapp-backend/scripts/create_admin.py` (full rewrite of `ensure_admin` + main unchanged)
- Test: no new files — `tests/test_create_admin_script.py` is the gate

**Interfaces:**
- Consumes: `User`, `Role` models, `orm_session`, `write_audit`.
- Produces: `ensure_admin(email, username, full_name, password) -> "created"|"updated"` — same semantics: upsert by email, re-promotes, unlocks, clears `failed_attempts`, audits `user.create`/`user.update` with `source: create_admin`.

- [ ] **Step 1: Rewrite `scripts/create_admin.py`**

```python
"""Create or repair the bootstrap admin account. Idempotent upsert on email."""
import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, or_, select

from app import create_app
from app.core.audit import write_audit
from app.core.auth_models import Role, User
from app.core.orm import orm_session
from app.core.security import hash_password


def ensure_admin(email: str, username: str, full_name: str, password: str) -> str:
    session = orm_session()
    role_id = session.scalar(select(Role.id).where(Role.name == "admin"))
    existing = session.scalars(select(User).where(User.email == email)).first()
    if existing:
        existing.username = username
        existing.full_name = full_name
        existing.password_hash = hash_password(password)
        existing.role_id = role_id
        existing.is_active = True
        existing.failed_attempts = 0
        existing.updated_at = func.now()
        session.commit()
        write_audit(None, "user.update", str(existing.id),
                    {"fields": ["password", "role", "is_active"], "source": "create_admin"})
        return "updated"
    user = User(email=email, username=username, full_name=full_name,
                password_hash=hash_password(password), role_id=role_id)
    session.add(user)
    session.commit()
    write_audit(None, "user.create", str(user.id),
                {"email": email, "username": username, "role": "admin", "source": "create_admin"})
    return "created"


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or repair the bootstrap admin account")
    parser.add_argument("--email")
    parser.add_argument("--username")
    parser.add_argument("--full-name", dest="full_name")
    args = parser.parse_args()
    email = args.email or os.getenv("BOOTSTRAP_ADMIN_EMAIL")
    username = args.username or os.getenv("BOOTSTRAP_ADMIN_USERNAME")
    full_name = args.full_name or os.getenv("BOOTSTRAP_ADMIN_FULL_NAME", "Administrator")
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    if not email or not username or len(password) < 8:
        print("error: email, username and a password of >= 8 characters are required",
              file=sys.stderr)
        return 1
    app = create_app()
    with app.app_context():
        ensure_admin(email, username, full_name, password)
    print(f"admin {email} ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the full suite (release gate)**

Run: `python -m pytest -v`
Expected: ALL PASS (including `tests/test_create_admin_script.py` — note its `with _app_ctx(app):` block requires `orm_session` to work under a bare app context, which it does).

- [ ] **Step 3: Manual smoke against dev DB (optional but recommended)**

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL='me@example.com'; $env:BOOTSTRAP_ADMIN_USERNAME='bootadmin'; $env:BOOTSTRAP_ADMIN_PASSWORD='***'; python scripts/create_admin.py
```
Expected: `admin me@example.com ready`. Re-run after disabling that user in `public.users` — re-running must re-enable (idempotent upsert on real schema).

- [ ] **Step 4: Commit**

```powershell
git add scripts/create_admin.py
git commit -m "refactor: move create_admin bootstrap script to SQLAlchemy models"
```

---

## Definition of Done

- Full suite green (existing tests only — no test modified).
- No `run_one`/`run_query`/`run_write` imports left in `core/audit.py`, `core/users.py`, `auth/tokens.py`, `auth/routes.py`, `admin/users.py`, `admin/departments.py`, `scripts/create_admin.py`.
- `app/core/db.py` still exists and serves remaining legacy helpers/tests.
- Live smoke: `create_admin.py` upserts against dev `public`; login through the running app works.
