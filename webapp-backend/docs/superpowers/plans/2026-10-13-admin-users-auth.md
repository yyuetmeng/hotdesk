# Admin Users, Auth & Password Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-managed auth + admin-user module for `webapp-backend`: JWT form login, admin CRUD over users (invitation/activation, password reset, lockout, validity dates), departments M2M, audit logging, app logging, and a bootstrap-admin script.

**Architecture:** Flask blueprints segregated into `app/core` (shared infra: config, db, security, audit, email, logging, errors, user queries), `app/auth` (login, me, token flows) and `app/admin` (users, departments). Raw SQL through `core.db` against Supabase Postgres; schema owned by numbered scripts in `sql/`. Email via Resend behind `core/email.py`.

**Tech Stack:** Flask 3, Flask-JWT-Extended, passlib[bcrypt] (bcrypt<4.1), SQLAlchemy 2 + psycopg3, resend, python-dotenv, pytest.

**Spec:** `docs/superpowers/specs/2026-10-13-admin-users-design.md`

## Global Constraints

- All SQL is raw SQL via `app/core/db.py` helpers (`run_query`, `run_one`, `run_write`). No ORM, no Alembic.
- All API errors are JSON `{"error": "<message>"}`; 400 validation errors add `fields: {...}`. Status codes: 400/401/403/404/409/502 per spec section 6.
- Never log or audit-dump: passwords, password hashes, raw or hashed tokens, JWTs.
- Passwords: bcrypt via passlib; minimum length 8.
- JWT access tokens: TTL 12h default (`JWT_ACCESS_TOKEN_EXPIRES` seconds), claims `sub` (user id), `role`, `email`.
- Lockout: 5 consecutive bad passwords auto-disable the account; only admin re-enable (PATCH `is_active: true`) clears the counter.
- Validity: login rejected when `is_active=false`, today `< start_date`, or today `> end_date`, or `password_hash IS NULL`.
- Activation tokens 72h, reset tokens 30min, sha256 stored, single-use, purpose-bound.
- Every state-changing or security-relevant action writes `audit_logs` via `core.audit.write_audit` only.
- Default 20, max 100, `page_size`.
- Scripts in `sql/` are idempotent; tests run against a real Postgres (Supabase `.env`) in isolated schema `hotdesk_test`.
- Commit after every green task; commit messages use `feat:`/`test:`/`docs:`/`refactor:` prefixes.

## File Structure

```
webapp-backend/
  pytest.ini                          # created (Task 2)
  requirements.txt                    # modified (Task 1)
  .env.example                        # modified (Task 1)
  sql/0001_extensions.sql             # created (Task 2)
  sql/0002_roles.sql                  # created (Task 2)
  sql/0003_users.sql                  # created (Task 2)
  sql/0004_departments.sql            # created (Task 2)
  sql/0005_user_tokens.sql            # created (Task 2)
  sql/0006_audit_logs.sql             # created (Task 2)
  sql/0007_seed_roles.sql             # created (Task 2)
  app/__init__.py                     # modified: core imports, JWT, logging, blueprint registration
  app/routes.py                       # modified: import path only
  app/core/__init__.py                # created (Task 1)
  app/core/config.py                  # moved from app/config.py + new settings (Task 1)
  app/core/db.py                      # moved from app/db.py + run_one/run_write/schema (Task 1, Task 3)
  app/core/supabase_client.py         # moved from app/supabase_client.py (Task 1)
  app/core/errors.py                  # created (Task 1)
  app/core/logging.py                 # created (Task 1)
  app/core/security.py                # created (Task 3)
  app/core/audit.py                   # created (Task 3)
  app/core/email.py                   # created (Task 7)
  app/core/users.py                   # created (Task 4)
  app/auth/__init__.py                # created (Task 4)
  app/auth/tokens.py                  # created (Task 4)
  app/auth/routes.py                  # created (Task 5: login/me; Task 6: forgot/set-password)
  app/admin/__init__.py               # created (Task 7)
  app/admin/users.py                  # created (Task 7: create/list/get; Task 8: patch/delete; Task 9: password/resend)
  app/admin/departments.py            # created (Task 10)
  scripts/create_admin.py             # created (Task 11)
  tests/conftest.py                   # created (Task 2)
  tests/test_health.py                # created (Task 1)
  tests/test_core_db.py               # created (Task 3)
  tests/test_departments_sql.py       # created (Task 2)  -> renamed usage in Task 10 to test_admin_departments.py additions
  tests/test_auth_tokens.py           # created (Task 4)
  tests/test_auth_login.py            # created (Task 5)
  tests/test_password_flows.py        # created (Task 6)
  tests/test_admin_users.py           # created (Task 7) + extended (Tasks 8, 9)
  tests/test_admin_departments.py     # created (Task 10)
  tests/test_create_admin_script.py   # created (Task 11)
  README.md                           # modified (Task 12)
```

---

### Task 1: Restructure into `app/core`, add logging, errors, deps

**Files:**
- Create: `app/core/__init__.py`, `app/core/errors.py`, `app/core/logging.py`
- Move+modify: `app/config.py` -> `app/core/config.py`; `app/db.py` -> `app/core/db.py`; `app/supabase_client.py` -> `app/core/supabase_client.py`
- Modify: `app/__init__.py`, `app/routes.py`, `requirements.txt`, `.env.example`
- Test: `tests/test_health.py`, `pytest.ini` (created here is fine too; Task 2 overwrites if needed)

**Interfaces:**
- Consumes: nothing.
- Produces: `app.core.config.Config`; `app.core.db.get_engine() -> Engine`, `run_query(sql, params) -> list[Row]`, `init_db(app)`; `app.core.errors.error(message, status=400, **extra) -> (Response, int)`; `app.core.logging.setup_logging(app) -> logging.Logger` (returns logger named `"app"`); `create_app()` from `app`.

- [ ] **Step 1: Update dependencies**

`requirements.txt` becomes:

```
flask>=3.0
flask-cors>=4.0
flask-jwt-extended>=4.6
python-dotenv>=1.0
sqlalchemy>=2.0
psycopg[binary]>=3.1
supabase>=2.32
passlib>=1.7.4
bcrypt<4.1
resend>=2.0
pytest>=8.0
```

Run: `pip install -r requirements.txt`
Expected: "Successfully installed" including flask-jwt-extended, passlib, resend, pytest.

- [ ] **Step 2: Write the failing regression test for the restructured app**

`pytest.ini`:

```ini
[pytest]
testpaths = tests
pythonpath = .
```

`tests/test_health.py`:

```python
def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_create_app_registers_blueprints(app):
    rules = {r.rule for r in app.url_map.iter_rules()}
    assert "/api/health" in rules
```

- [ ] **Step 3: Run to verify it fails**

Run: `python -m pytest tests/test_health.py -v`
Expected: ERROR/FAIL — no `client`/`app` fixtures yet and `tests/` may not exist.

- [ ] **Step 4: Create `app/core` package and move files**

Move `app/config.py`, `app/db.py`, `app/supabase_client.py` into `app/core/` (e.g. `git mv` equivalents; plain file move is fine — this is not a git repo until Task 1 Step 9, use `Move-Item`). Create empty `app/core/__init__.py`.

`app/core/errors.py`:

```python
from flask import jsonify


def error(message: str, status: int = 400, **extra):
    payload = {"error": message}
    payload.update(extra)
    return jsonify(payload), status
```

`app/core/logging.py`:

```python
import logging
import time
from logging.handlers import RotatingFileHandler


def setup_logging(app):
    logging.Formatter.converter = time.gmtime
    level = getattr(logging, str(app.config.get("LOG_LEVEL", "INFO")).upper(), logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    logging.getLogger().setLevel(logging.WARNING)
    log = logging.getLogger("app")
    log.setLevel(level)
    if not log.handlers:
        console = logging.StreamHandler()
        console.setFormatter(fmt)
        log.addHandler(console)
        path = app.config.get("LOG_FILE")
        if path:
        file_handler = RotatingFileHandler(path, maxBytes=1_000_000, backupCount=5)
        file_handler.setFormatter(fmt)
        log.addHandler(file_handler)
    return log
```

Append settings to `app/core/config.py` `Config` class (keep existing attributes):

```python
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", SECRET_KEY)
    JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRES", "43200"))
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", "")
    FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    LOG_FILE = os.getenv("LOG_FILE", "")
```

Append to `.env.example`:

```
JWT_SECRET_KEY=
JWT_ACCESS_TOKEN_EXPIRES=43200
RESEND_API_KEY=
EMAIL_FROM=
FRONTEND_URL=http://localhost:3000
LOG_LEVEL=INFO
LOG_FILE=
BOOTSTRAP_ADMIN_EMAIL=
BOOTSTRAP_ADMIN_USERNAME=
BOOTSTRAP_ADMIN_FULL_NAME=Administrator
BOOTSTRAP_ADMIN_PASSWORD=
```

- [ ] **Step 5: Rewrite `app/__init__.py`**

```python
import time

from flask import Flask, g, jsonify, request
from flask_cors import CORS

from .core.config import Config
from .core.db import init_db
from .core.logging import setup_logging
from .routes import api_bp


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)
    CORS(app)
    init_db(app)
    setup_logging(app)
    _register_request_logging(app)
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.errorhandler(404)
    def not_found(err):
        return jsonify(error="not found"), 404

    return app


def _register_request_logging(app):
    @app.before_request
    def _start():
        g.request_started = time.perf_counter()

    @app.after_request
    def _log(resp):
        if not request.path.startswith("/api/health"):
            import logging

            started = getattr(g, "request_started", time.perf_counter())
            ms = int((time.perf_counter() - started) * 1000)
            logging.getLogger("app.request").info(
                "%s %s %s %dms user=%s", request.method, request.path, resp.status_code, ms,
                getattr(g, "jwt_uid", "-"),
            )
        return resp
```

Update imports in `app/routes.py` (line 3): `from .core.db import get_engine`.

- [ ] **Step 6: Add minimal `tests/conftest.py` (grown properly in Task 2)**

```python
import pytest

from app import create_app


@pytest.fixture()
def app():
    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture()
def client(app):
    return app.test_client()
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `python -m pytest tests/test_health.py -v`
Expected: 2 passed.

- [ ] **Step 8: Manual smoke check**

Run: `python -c "from app import create_app; app=create_app(); print(sorted(r.rule for r in app.url_map.iter_rules()))"`
Expected: list including `/api/health`, `/api/health/db`.

- [ ] **Step 9: Initialize git and commit**

```powershell
git init
git add -A
git commit -m "refactor: segregate app into core package with logging and error helpers"
```

(Every later task: `git add <files>; git commit -m "..."` at the end.)

---

### Task 2: SQL schema scripts + test database fixtures

**Files:**
- Create: `sql/0001_extensions.sql`, `sql/0002_roles.sql`, `sql/0003_users.sql`, `sql/0004_departments.sql`, `sql/0005_user_tokens.sql`, `sql/0006_audit_logs.sql`, `sql/0007_seed_roles.sql`
- Create: `.gitignore`
- Modify: `tests/conftest.py` (replace Task 1 version)
- Test: `tests/test_sql_schema.py`

**Interfaces:**
- Consumes: `Config.SQLALCHEMY_DATABASE_URI` (dev DB from `.env`).
- Produces: schema objects `roles`, `users`, `departments`, `user_departments`, `user_tokens`, `audit_logs` in schema `hotdesk_test` (tests) — identical DDL is applied manually by operators to Supabase `public`. Fixtures for all later tasks: `admin_conn` (session, autocommit engine to base URI), `app` (Flask app with `SQL_SEARCH_PATH=hotdesk_test`), `client`, `db` (function-scoped truncate + role seed, returns `admin_conn`).

**Prerequisite:** `.env` must contain a working `SUPABASE_CONNECTION_STRING` (tests run against a real Postgres).

- [ ] **Step 1: Write the SQL scripts**

`sql/0001_extensions.sql`:

```sql
create extension if not exists citext;
create extension if not exists pg_trgm;
```

`sql/0002_roles.sql`:

```sql
create table if not exists roles (
  id   smallint primary key,
  name text not null unique check (name ~ '^[a-z][a-z0-9_]{1,49}$')
);
```

`sql/0003_users.sql`:

```sql
create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  username        citext not null unique,
  full_name       text not null check (length(full_name) between 1 and 200),
  password_hash   text,
  role_id         smallint not null references roles(id) on delete restrict,
  is_active       boolean not null default true,
  start_date      date,
  end_date        date,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint users_date_range_chk check (start_date is null or end_date is null
                                         or start_date <= end_date)
);

create index if not exists users_role_id_idx       on users (role_id);
create index if not exists users_is_active_idx     on users (is_active);
create index if not exists users_email_trgm_idx    on users using gin (email gin_trgm_ops);
create index if not exists users_username_trgm_idx on users using gin (username gin_trgm_ops);
create index if not exists users_full_name_trgm_idx on users using gin (full_name gin_trgm_ops);
```

`sql/0004_departments.sql`:

```sql
create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        citext not null unique,
  description text check (description is null or length(description) <= 500),
  created_at  timestamptz not null default now()
);

create table if not exists user_departments (
  user_id       uuid not null references users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);

create index if not exists user_departments_dept_idx on user_departments (department_id);
```

`sql/0005_user_tokens.sql`:

```sql
create table if not exists user_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  purpose    text not null check (purpose in ('activate', 'reset')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_tokens_user_purpose_idx on user_tokens (user_id, purpose, used_at);
create index if not exists user_tokens_expires_idx      on user_tokens (expires_at);
```

`sql/0006_audit_logs.sql`:

```sql
create table if not exists audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references users(id) on delete set null,
  action     text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_id  uuid,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_target_idx on audit_logs (target_id, created_at desc);
create index if not exists audit_logs_actor_idx  on audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx on audit_logs (action, created_at desc);
```

`sql/0007_seed_roles.sql`:

```sql
insert into roles (id, name) values (1, 'user'), (2, 'admin')
on conflict (id) do nothing;
```

`.gitignore`:

```
.env
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 2: Write the failing schema tests**

`tests/test_sql_schema.py`:

```python
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def test_citext_email_unique_case_insensitive(db):
    with db.connect() as conn:
        conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('a@b.com', 'aaa', 'A', 1)"))
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into users (email, username, full_name, role_id) "
                "values ('A@B.COM', 'bbb', 'B', 1)"))


def test_username_unique(db):
    with db.connect() as conn:
        conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('a@b.com', 'same', 'A', 1)"))
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into users (email, username, full_name, role_id) "
                "values ('c@d.com', 'SAME', 'B', 1)"))


def test_date_range_check(db):
    with db.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into users (email, username, full_name, role_id, start_date, end_date) "
                "values ('c@d.com', 'ccc', 'C', 1, '2026-01-10', '2026-01-01')"))


def test_department_delete_cascades_membership(db):
    with db.connect() as conn:
        uid = conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('d@e.com', 'ddd', 'D', 1) returning id")).scalar_one()
        did = conn.execute(text("insert into departments (name) values ('Eng') returning id")).scalar_one()
        conn.execute(text("insert into user_departments (user_id, department_id) values (:u, :d)"),
                     {"u": uid, "d": did})
        conn.execute(text("delete from departments where id = :d"), {"d": did})
        n = conn.execute(text("select count(*) from user_departments where user_id = :u"),
                         {"u": uid}).scalar_one()
        assert n == 0


def test_audit_actor_set_null_when_user_deleted(db):
    with db.connect() as conn:
        uid = conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('e@f.com', 'eee', 'E', 1) returning id")).scalar_one()
        conn.execute(text(
            "insert into audit_logs (actor_id, action, target_id) values (:a, 'user.create', :t)"),
            {"a": uid, "t": uid})
        conn.execute(text("delete from users where id = :u"), {"u": uid})
        actor = conn.execute(text("select actor_id from audit_logs where action = 'user.create'")).scalar_one()
        assert actor is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_sql_schema.py -v`
Expected: ERROR — `db` fixture undefined (conftest still the minimal Task 1 version).

- [ ] **Step 4: Write the real `tests/conftest.py`**

```python
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, text

from app import create_app
from app.core.config import Config

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"
TEST_SCHEMA = "hotdesk_test"
BASE_URI = os.getenv("TEST_DATABASE_URI", Config.SQLALCHEMY_DATABASE_URI)


@pytest.fixture(scope="session")
def admin_conn():
    engine = create_engine(BASE_URI, isolation_level="autocommit")

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, _record):
        dbapi_conn.execute(f"set search_path to {TEST_SCHEMA}, public")
        dbapi_conn.commit()

    with engine.connect() as conn:
        conn.execute(text(f"drop schema if exists {TEST_SCHEMA} cascade"))
        conn.execute(text(f"create schema {TEST_SCHEMA}"))
        for script in sorted(SQL_DIR.glob("*.sql")):
            conn.execute(text(script.read_text(encoding="utf-8")))
    yield engine
    engine.dispose()


@pytest.fixture()
def app(admin_conn):
    application = create_app()
    application.config.update(
        TESTING=True,
        SQL_SEARCH_PATH=TEST_SCHEMA,
        JWT_SECRET_KEY="**",
        JWT_ACCESS_TOKEN_EXPIRES=3600,
    )
    return application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def db(app, admin_conn):
    with app.app_context(), admin_conn.connect() as conn:
        conn.execute(text(
            "truncate users, departments, user_departments, user_tokens, audit_logs "
            "restart identity cascade"))
        conn.execute(text(
            "insert into roles (id, name) values (1, 'user'), (2, 'admin') "
            "on conflict (id) do nothing"))
    return admin_conn
```

Note: the `db` fixture pushes an app context, so tests may call `issue_token` /
`run_one` / `create_access_token` directly without wrapping in `app.app_context()`.

- [ ] **Step 5: Make `db.py` honor `SQL_SEARCH_PATH`**

Replace `get_engine` in `app/core/db.py`:

```python
def get_engine() -> Engine:
    uri = current_app.config["SQLALCHEMY_DATABASE_URI"]
    search_path = current_app.config.get("SQL_SEARCH_PATH", "public")
    options = current_app.config.get("SQLALCHEMY_ENGINE_OPTIONS", {})
    key = (uri, search_path)
    if key not in _engines:
        engine = create_engine(uri, **options)

        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def _set_search_path(dbapi_conn, _record):
            dbapi_conn.execute(f"set search_path to {search_path}, public")
            dbapi_conn.commit()

        _engines[key] = engine
    return _engines[key]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass (health tests + 5 schema tests).

- [ ] **Step 7: Commit**

```powershell
git add sql .gitignore tests/conftest.py tests/test_sql_schema.py app/core/db.py
git commit -m "feat: add numbered sql schema scripts and isolated test schema fixtures"
```

---

### Task 3: Core security (bcrypt + admin guard), audit writer, db helpers

**Files:**
- Modify: `app/core/db.py` (add `run_one`, `run_write`)
- Create: `app/core/security.py`, `app/core/audit.py`
- Modify: `app/__init__.py` (init JWT + JSON error handlers)
- Test: `tests/test_core_db.py`

**Interfaces:**
- Consumes: `db` fixture, `app`/`client` fixtures (Task 2); `roles` table.
- Produces:
  - `app.core.db.run_one(sql, params) -> dict | None`
  - `app.core.db.run_write(sql, params) -> int` (rowcount; commits)
  - `app.core.security.hash_password(plain: str) -> str`
  - `app.core.security.verify_password(plain: str, hashed: str) -> bool`
  - `app.core.security.admin_required(fn)` decorator (JWT + role claim, 401/403 JSON)
  - `app.core.audit.write_audit(actor_id: str | None, action: str, target_id: str | None, details: dict | None = None) -> None`

- [ ] **Step 1: Write failing tests**

`tests/test_core_db.py`:

```python
from sqlalchemy import text

from app.core.audit import write_audit
from app.core.db import run_one, run_write
from app.core.security import hash_password, verify_password


def test_run_one_and_run_write(app, db):
    uid = run_one(
        "insert into users (email, username, full_name, role_id) "
        "values ('x@y.com', 'xy', 'X Y', 1) returning id")["id"]
    row = run_one("select email from users where id = :i", {"i": uid})
    assert row["email"] == "x@y.com"
    n = run_write("update users set full_name = 'Z' where id = :i", {"i": uid})
    assert n == 1


def test_bcrypt_roundtrip():
    h = hash_password("secret123")
    assert h != "secret123"
    assert verify_password("secret123", h)
    assert not verify_password("wrong", h)


def test_write_audit_row(db):
    uid = run_one(
        "insert into users (email, username, full_name, role_id) "
        "values ('a2@b.com', 'a2', 'A', 1) returning id")["id"]
    write_audit(str(uid), "user.create", str(uid), {"role": "user"})
    with db.connect() as conn:
        row = conn.execute(text("select actor_id, action, details from audit_logs")).mappings().one()
    assert row["action"] == "user.create"
    assert row["details"] == {"role": "user"}


def test_admin_required_guard(app, client, db):
    from flask import jsonify

    @app.route("/api/_t/admin-only")
    def _t_admin():
        from app.core.security import admin_required

        @admin_required
        def view():
            return jsonify(ok=True)

        return view()

    assert client.get("/api/_t/admin-only").status_code == 401

    from flask_jwt_extended import create_access_token

    tok = create_access_token(identity="u-1", additional_claims={"role": "user", "email": "a@b.com"})
    r = client.get("/api/_t/admin-only", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403
    assert r.get_json() == {"error": "admin required"}

    tok = create_access_token(identity="u-2", additional_claims={"role": "admin", "email": "a@b.com"})
    r = client.get("/api/_t/admin-only", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_core_db.py -v`
Expected: FAIL — `ImportError` for `run_one` / `security` / `audit`.

- [ ] **Step 3: Implement**

Append to `app/core/db.py`:

```python
def run_one(sql: str, params: dict | None = None):
    session = get_session()
    return session.execute(text(sql), params or {}).mappings().first()


def run_write(sql: str, params: dict | None = None) -> int:
    session = get_session()
    result = session.execute(text(sql), params or {})
    session.commit()
    return result.rowcount
```

`app/core/security.py`:

```python
from functools import wraps

import jwt as _pyjwt
from flask_jwt_extended import get_jwt, verify_jwt_in_request
from passlib.context import CryptContext

from .errors import error

_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ctx.verify(plain, hashed)
    except ValueError:
        return False


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except _pyjwt.ExpiredSignatureError:
            return error("token expired", 401)
        except _pyjwt.PyJWTError:
            return error("invalid token", 401)
        claims = get_jwt()
        if claims.get("role") != "admin":
            return error("admin required", 403)
        return fn(*args, **kwargs)

    return wrapper
```

`app/core/audit.py`:

```python
import json

from .db import run_write


def write_audit(actor_id, action: str, target_id, details: dict | None = None) -> None:
    run_write(
        "insert into audit_logs (actor_id, action, target_id, details) "
        "values (:actor_id, :action, :target_id, cast(:details as jsonb))",
        {
            "actor_id": actor_id,
            "action": action,
            "target_id": target_id,
            "details": json.dumps(details or {}),
        },
    )
```

In `app/__init__.py`, add JWT init and JSON handlers for auth errors — insert after `setup_logging(app)`:

```python
    from flask import jsonify as _jsonify
    from flask_jwt_extended import JWTManager

    jwt_mgr = JWTManager(app)

    @jwt_mgr.unauthorized_loader
    def _unauthorized(reason):
        return _jsonify(error="authentication required"), 401

    @jwt_mgr.invalid_token_loader
    def _invalid(reason):
        return _jsonify(error="invalid token"), 401

    @jwt_mgr.expired_token_loader
    def _expired(hdr, claims):
        return _jsonify(error="token expired"), 401
```

(Replace the duplicate `JWTManager(app)` block above with this single block.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/core/db.py app/core/security.py app/core/audit.py app/__init__.py tests/test_core_db.py
git commit -m "feat: add bcrypt security, admin guard, audit writer and db helpers"
```

---

### Task 4: Token service + shared user query helpers

**Files:**
- Create: `app/auth/__init__.py`, `app/auth/tokens.py`, `app/core/users.py`
- Modify: `app/__init__.py` (register `auth_bp`)
- Test: `tests/test_auth_tokens.py`

**Interfaces:**
- Consumes: `db` fixture; `run_one`/`run_write`/`run_query` (Task 3); `users`, `user_tokens` tables (Task 2).
- Produces:
  - `app.auth.tokens.issue_token(user_id: str, purpose: str, hours: int) -> str` (returns raw URL-safe token; stores sha256 hash; invalidates prior unused tokens of same purpose for that user)
  - `app.auth.tokens.validate_token(raw: str, purpose: str) -> dict | None` (`{"user_id", "token_hash"}` or None; checks hash, purpose, expiry, unused)
  - `app.auth.tokens.consume_token(token_hash: str) -> None` (sets `used_at = now()`)
  - `app.auth.tokens.invalidate_tokens(user_id: str, purpose: str | None = None) -> None` (soft-invalidate via `used_at = now()`)
  - `app.core.users.DEPT_AGG` — SQL fragment exposing departments JSON per user (see code)
  - `app.core.users.public_user(row: dict) -> dict` — API shape (no password hash; parses `departments` JSON to list; `status` = `"pending_activation"` if `password_hash` is NULL else `"active"`; keys: `id, email, username, full_name, role, is_active, start_date, end_date, departments, status`)
  - `app.core.users.fetch_user(user_id: str, conn=None) -> dict | None` — full public shape by id
  - `app.core.users.email_exists(email, exclude_id=None) / username_exists(username, exclude_id=None) -> bool`

- [ ] **Step 1: Write failing tests**

`tests/test_auth_tokens.py`:

```python
import datetime as dt

from sqlalchemy import text

from app.auth.tokens import consume_token, invalidate_tokens, issue_token, validate_token


def _mk_user(db, email="t@u.com", username="tub"):
    with db.connect() as conn:
        return str(conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values (:e, :u, 'T', 1) returning id"), {"e": email, "u": username}).scalar_one())


def test_issue_and_validate_roundtrip(db):
    uid = _mk_user(db)
    raw = issue_token(uid, "activate", 72)
    rec = validate_token(raw, "activate")
    assert rec and rec["user_id"] == uid


def test_wrong_purpose_rejected(db):
    uid = _mk_user(db, "p@u.com", "pub")
    raw = issue_token(uid, "activate", 72)
    assert validate_token(raw, "reset") is None


def test_expired_rejected(db):
    uid = _mk_user(db, "e@u.com", "eub")
    raw = issue_token(uid, "reset", 72)
    with db.connect() as conn:
        conn.execute(text("update user_tokens set expires_at = now() - interval '1 hour'"))
    assert validate_token(raw, "reset") is None


def test_consume_then_revalidate_fails(db):
    uid = _mk_user(db, "c@u.com", "cub")
    raw = issue_token(uid, "reset", 72)
    rec = validate_token(raw, "reset")
    consume_token(rec["token_hash"])
    assert validate_token(raw, "reset") is None


def test_issue_invalidates_previous_same_purpose(db):
    uid = _mk_user(db, "i@u.com", "iub")
    first = issue_token(uid, "activate", 72)
    issue_token(uid, "activate", 72)
    assert validate_token(first, "activate") is None


def test_invalidate_all_purposes(db):
    uid = _mk_user(db, "ia@u.com", "iab")
    a = issue_token(uid, "activate", 72)
    r = issue_token(uid, "reset", 1)
    invalidate_tokens(uid)
    assert validate_token(a, "activate") is None
    assert validate_token(r, "reset") is None
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_auth_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: app.auth`.

- [ ] **Step 3: Implement `app/auth/tokens.py`**

```python
import hashlib
import secrets

from app.core.db import run_one, run_write


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_token(user_id: str, purpose: str, hours: int) -> str:
    raw = secrets.token_urlsafe(32)
    invalidate_tokens(user_id, purpose)
    run_write(
        "insert into user_tokens (user_id, token_hash, purpose, expires_at) "
        "values (:u, :h, :p, now() + make_interval(hours => :hrs))",
        {"u": user_id, "h": _hash(raw), "p": purpose, "hrs": hours},
    )
    return raw


def validate_token(raw: str, purpose: str):
    return run_one(
        "select user_id::text as user_id, token_hash from user_tokens "
        "where token_hash = :h and purpose = :p and used_at is null and expires_at > now()",
        {"h": _hash(raw), "p": purpose},
    )


def consume_token(token_hash: str) -> None:
    run_write("update user_tokens set used_at = now() where token_hash = :h", {"h": token_hash})


def invalidate_tokens(user_id: str, purpose: str | None = None) -> None:
    if purpose:
        run_write(
            "update user_tokens set used_at = now() "
            "where user_id = :u and purpose = :p and used_at is null",
            {"u": user_id, "p": purpose},
        )
    else:
        run_write(
            "update user_tokens set used_at = now() "
            "where user_id = :u and used_at is null",
            {"u": user_id},
        )
```

`app/auth/__init__.py`:

```python
from flask import Blueprint

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

from . import routes  # noqa: E402,F401
```

(Do NOT create `app/auth/routes.py` yet — registering it would fail. Instead, for now make `__init__.py` only contain the blueprint definition line without the `from . import routes` import; add the import line in Task 5 when `routes.py` exists.)

`app/core/users.py`:

```python
import json

from .db import run_one, run_query

DEPT_AGG = (
    "(select coalesce(json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name), '[]'::json) "
    "from user_departments ud join departments d on d.id = ud.department_id "
    "where ud.user_id = u.id) as departments"
)

SELECT_PUBLIC_USER = (
    "select u.id::text as id, u.email, u.username, u.full_name, r.name as role, "
    "u.is_active, u.start_date, u.end_date, u.password_hash, "
    + DEPT_AGG + " "
    "from users u join roles r on r.id = u.role_id where u.id = cast(:id as uuid)"
)


def public_user(row: dict) -> dict:
    data = dict(row)
    depts = data.get("departments")
    if isinstance(depts, str):
        depts = json.loads(depts)
    return {
        "id": data["id"],
        "email": data["email"],
        "username": data["username"],
        "full_name": data["full_name"],
        "role": data["role"],
        "is_active": data["is_active"],
        "start_date": data["start_date"].isoformat() if data.get("start_date") else None,
        "end_date": data["end_date"].isoformat() if data.get("end_date") else None,
        "departments": depts or [],
        "status": "pending_activation" if data.get("password_hash") is None else "active",
    }


def fetch_user(user_id: str):
    row = run_one(SELECT_PUBLIC_USER, {"id": user_id})
    return public_user(row) if row else None


def email_exists(email: str, exclude_id: str | None = None) -> bool:
    row = run_one(
        "select 1 from users where email = :e and (:ex is null or id != cast(:ex as uuid))",
        {"e": email, "ex": exclude_id},
    )
    return row is not None


def username_exists(username: str, exclude_id: str | None = None) -> bool:
    row = run_one(
        "select 1 from users where username = :u and (:ex is null or id != cast(:ex as uuid))",
        {"u": username, "ex": exclude_id},
    )
    return row is not None
```

Register in `app/__init__.py` inside `create_app` (after `app.register_blueprint(api_bp, ...)`):

```python
    from .auth import auth_bp

    app.register_blueprint(auth_bp)
```

But `app/auth/__init__.py` currently has no `routes` import — keep blueprint-only until Task 5. The auth blueprint has no routes yet; registering it is harmless and lets `test_create_app_registers_blueprints` stay unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/auth app/core/users.py app/__init__.py tests/test_auth_tokens.py
git commit -m "feat: add user token service and shared user query helpers"
```

---

### Task 5: Login and /me endpoints (lockout, validity window, audits)

**Files:**
- Create: `app/auth/routes.py`
- Modify: `app/auth/__init__.py` (uncomment/add `from . import routes`)
- Test: `tests/test_auth_login.py`

**Interfaces:**
- Consumes: `hash_password`/`verify_password` (Task 3), `write_audit` (Task 3), `fetch_user`/`public_user` (Task 4), `users` table.
- Produces:
  - `POST /api/auth/login` — body `{"email_or_username", "password"}` (also accepts `email` or `username` key). 200 `{"token", "user"}`; 401 `{"error":"invalid credentials"}`; 403 `{"error":"account disabled"|"account not yet active"|"account expired"|"password not set, check your email to activate your account"}`. Lockout: 5th consecutive failure disables account. Audits `auth.login_success`, `auth.login_failed`, `account.locked`. Logs failed logins at WARNING (identifier only).
  - `GET /api/auth/me` — JWT required → current user public shape.
  - `app.auth.routes.auth_required(fn)` decorator (valid JWT of any role → 401 otherwise) for reuse by `/me`.
  - `app.auth.routes.get_current_user_row() -> dict` (live DB row for JWT `sub`, None if gone) for `/me` and later modules.

- [ ] **Step 1: Write failing tests**

`tests/test_auth_login.py`:

```python
import datetime as dt

from sqlalchemy import text

from app.core.db import run_one, run_write
from app.core.security import hash_password

PW = "secret123"


def mk_user(db, email="u@x.com", username="ux", password=PW, role="user", **cols):
    cols.setdefault("password_hash", hash_password(password) if password else None)
    names, vals = ["email", "username", "full_name", "role_id"], [email, username, "U X", role]
    keys = ["email", "username", "full_name", "role_id"]
    for k, v in cols.items():
        keys.append(k)
        names.append(k)
        vals.append(f":{k}")
    sql = f"insert into users ({', '.join(names)}) values ({', '.join(vals)}) returning id"
    params = dict(zip(["email", "username", "full_name", "role_id"],
                      [email, username, "U X", 2 if role == "admin" else 1]))
    params.update(cols)
    return run_one(sql, params)["id"]


def login(client, identifier, password=PW):
    return client.post("/api/auth/login",
                       json={"email_or_username": identifier, "password": password})


def test_login_success_by_email_or_username(client, db):
    mk_user(db, email="a@x.com", username="aa")
    r = login(client, "a@x.com")
    assert r.status_code == 200
    body = r.get_json()
    assert body["token"]
    assert body["user"]["email"] == "a@x.com"
    assert "password_hash" not in body["user"]
    assert login(client, "aa").status_code == 200


def test_login_wrong_password_401_and_audit(client, db):
    mk_user(db, email="b@x.com", username="bb")
    r = login(client, "b@x.com", "nope")
    assert r.status_code == 401
    assert r.get_json() == {"error": "invalid credentials"}
    row = run_one("select action from audit_logs where action = 'auth.login_failed'")
    assert row


def test_login_unknown_user_generic_401(client, db):
    assert login(client, "ghost@x.com").get_json() == {"error": "invalid credentials"}


def test_login_inactive_403(client, db):
    mk_user(db, email="c@x.com", username="cc", is_active=False)
    r = login(client, "c@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account disabled"}


def test_login_pending_activation_403(client, db):
    mk_user(db, email="d@x.com", username="dd", password=None)
    r = login(client, "d@x.com")
    assert r.status_code == 403
    assert "password not set" in r.get_json()["error"]


def test_login_before_start_or_after_end(client, db):
    mk_user(db, email="e@x.com", username="ee",
            start_date=dt.date.today() + dt.timedelta(days=1))
    r = login(client, "e@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account not yet active"}
    run_write("update users set start_date = null, end_date = :d where email = 'e@x.com'",
              {"d": dt.date.today() - dt.timedelta(days=1)})
    r = login(client, "e@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account expired"}


def test_five_failures_lock_and_success_resets(client, db):
    uid = mk_user(db, email="f@x.com", username="ff")
    for _ in range(4):
        login(client, "f@x.com", "nope")
    assert run_one("select failed_attempts from users where id = :i", {"i": uid})["failed_attempts"] == 4
    r = login(client, "f@x.com", "nope")
    assert r.status_code == 401
    assert run_one("select is_active from users where id = :i", {"i": uid})["is_active"] is False
    r = login(client, "f@x.com")
    assert r.status_code == 403 and r.get_json() == {"error": "account disabled"}
    row = run_one("select action from audit_logs where action = 'account.locked'")
    assert row
    run_write("update users set is_active = true, failed_attempts = 0 where id = :i", {"i": uid})
    assert login(client, "f@x.com").status_code == 200


def test_me_returns_current_user(client, db):
    mk_user(db, email="g@x.com", username="gg", role="admin")
    tok = login(client, "g@x.com").get_json()["token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.get_json()["email"] == "g@x.com"


def test_me_requires_auth(client, db):
    assert client.get("/api/auth/me").status_code == 401
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_auth_login.py -v`
Expected: FAIL — 404 from `/api/auth/login` (routes module not implemented).

- [ ] **Step 3: Implement `app/auth/routes.py`**

```python
import datetime as dt
import logging

from flask import g, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt, get_jwt_identity, verify_jwt_in_request

from app.core.audit import write_audit
from app.core.db import run_one, run_write
from app.core.errors import error
from app.core.security import verify_password
from app.core.users import fetch_user

from . import auth_bp

log = logging.getLogger("app.auth")
MAX_FAILED_ATTEMPTS = 5


def auth_required(fn):
    from functools import wraps

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
    row = run_one(
        "select u.id::text as id, u.password_hash, u.is_active, u.start_date, u.end_date, "
        "u.failed_attempts, r.name as role, u.email "
        "from users u join roles r on r.id = u.role_id "
        "where u.email = :i or u.username = :i",
        {"i": identity},
    )
    if not row or not row["password_hash"] or not verify_password(password, row["password_hash"]):
        if row:
            attempts = row["failed_attempts"] + 1
            run_write("update users set failed_attempts = :n, updated_at = now() where id = :id",
                      {"n": attempts, "id": row["id"]})
            if attempts >= MAX_FAILED_ATTEMPTS:
                run_write("update users set is_active = false, updated_at = now() where id = :id",
                          {"id": row["id"]})
                write_audit(row["id"], "account.locked", row["id"], {"failed_attempts": attempts})
                log.warning("account locked after %d failed attempts: %s", attempts, identity)
        write_audit(None, "auth.login_failed", row["id"] if row else None, {"identifier": identity})
        if row:
            log.warning("failed login for %s", identity)
        return error("invalid credentials", 401)

    if not row["is_active"]:
        return error("account disabled", 403)
    today = dt.date.today()
    if row["start_date"] and today < row["start_date"]:
        return error("account not yet active", 403)
    if row["end_date"] and today > row["end_date"]:
        return error("account expired", 403)
    if row["failed_attempts"]:
        run_write("update users set failed_attempts = 0, updated_at = now() where id = :id",
                  {"id": row["id"]})
    write_audit(row["id"], "auth.login_success", row["id"], {})
    token = create_access_token(identity=row["id"],
                                additional_claims={"role": row["role"], "email": row["email"]})
    g.jwt_uid = row["id"]
    return jsonify(token=token, user=fetch_user(row["id"]))


@auth_bp.get("/me")
@auth_required
def me():
    user = get_current_user_row()
    if user is None:
        return error("user not found", 401)
    return jsonify(user)
```

`app/auth/__init__.py` — append:

```python
from . import routes  # noqa: E402,F401
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/auth tests/test_auth_login.py
git commit -m "feat: add login with lockout and validity checks plus /me endpoint"
```

---

### Task 6: Forgot-password / set-password (activate + reset) flows

**Files:**
- Modify: `app/auth/routes.py` (append 3 endpoints)
- Test: `tests/test_password_flows.py`

**Interfaces:**
- Consumes: `issue_token`, `validate_token`, `consume_token`, `invalidate_tokens` (Task 4); `write_audit`; `verify_password`/`hash_password`; stubbed `app.core.email.send_email` (patched in tests; module created in Task 7 — until then tests monkeypatch `app.auth.routes.send_email` which we import in Step 3, so create a minimal `app/core/email.py` **now** with only `send_email`).
- Produces:
  - `POST /api/auth/forgot-password` — always 204; audits `password_reset.requested` when user exists.
  - `GET /api/auth/set-password/verify?token=*** -> `{"valid": bool}`.
  - `POST /api/auth/set-password` — `{"token", "password"}`; 204 on success; audits `account.activated` or `password_reset.completed`; 400 invalid/expired.
  - `app.core.email.send_email(to: str, subject: str, html: str) -> None` (resend SDK; raises on provider error).

- [ ] **Step 1: Create minimal `app/core/email.py`**

```python
import logging

import resend

from app.core.config import Config

log = logging.getLogger("app.email")


def send_email(to: str, subject: str, html: str) -> None:
    resend.api_key = Config.RESEND_API_KEY
    resp = resend.Emails.send({"from": Config.EMAIL_FROM, "to": to,
                               "subject": subject, "html": html})
    if resp is None or (isinstance(resp, dict) and resp.get("name") and not resp.get("id")):
        log.error("resend send failed: %s", resp)
        raise RuntimeError("email send failed")
```

- [ ] **Step 2: Write failing tests**

`tests/test_password_flows.py`:

```python
import re

import pytest

from app.auth.tokens import validate_token
from app.core.db import run_one
from app.core.security import hash_password
from app.core.users import public_user  # noqa: F401 (ensures module importable)

PW = "secret123"


@pytest.fixture(autouse=True)
def stub_email(monkeypatch):
    calls = []
    monkeypatch.setattr("app.auth.routes.send_email",
                        lambda to, subject, html: calls.append((to, subject, html)))
    return calls


def _mk(db, email, username, password=PW, **cols):
    cols.setdefault("password_hash", hash_password(password) if password else None)
    return run_one(
        "insert into users (email, username, full_name, role_id, password_hash) "
        "values (:e, :u, 'U', 1, :p) returning id",
        {"e": email, "u": username, "p": cols["password_hash"]})["id"]


def _extract_token(mail_calls):
    return re.search(r"token=([\w\-]+)", mail_calls[-1][2]).group(1)


def test_forgot_password_known_user_emails(client, db, stub_email):
    _mk(db, "fp@x.com", "fp1")
    r = client.post("/api/auth/forgot-password", json={"email": "fp@x.com"})
    assert r.status_code == 204
    assert stub_email and stub_email[0][0] == "fp@x.com"
    assert run_one("select action from audit_logs where action = 'password_reset.requested'")


def test_forgot_password_unknown_still_204(client, db, stub_email):
    assert client.post("/api/auth/forgot-password", json={"email": "no@x.com"}).status_code == 204
    assert not stub_email


def test_reset_flow_invalidates_old_tokens(client, db, stub_email):
    _mk(db, "rs@x.com", "rs1")
    client.post("/api/auth/forgot-password", json={"email": "rs@x.com"})
    t1 = _extract_token(stub_email)
    client.post("/api/auth/forgot-password", json={"email": "rs@x.com"})
    t2 = _extract_token(stub_email)
    assert validate_token(t1, "reset") is None
    assert client.get(f"/api/auth/set-password/verify?token=**}&purpose=reset").get_json() == {"valid": True}
    r = client.post("/api/auth/set-password", json={"token": t2, "password": "brandnew1"})
    assert r.status_code == 204
    assert client.post("/api/auth/set-password", json={"token": t2, "password": "x12345678"}).status_code == 400
    assert client.post("/api/auth/login", json={"email_or_username": "rs@x.com", "password": "brandnew1"}).status_code == 200
    assert run_one("select action from audit_logs where action = 'password_reset.completed'")


def test_activate_flow(client, db, stub_email):
    uid = _mk(db, "ac@x.com", "ac1", password=None)
    client.post("/api/auth/login", json={"email_or_username": "ac@x.com", "password": "whatever"})
    from app.auth.tokens import issue_token
    raw = issue_token(uid, "activate", 72)
    assert client.get(f"/api/auth/set-password/verify?token=**}&purpose=activate").get_json() == {"valid": True}
    r = client.post("/api/auth/set-password", json={"token": raw, "password": "firstpw1"})
    assert r.status_code == 204
    assert run_one("select action from audit_logs where action = 'account.activated'")
    assert client.post("/api/auth/login", json={"email_or_username": "ac@x.com", "password": "firstpw1"}).status_code == 200


def test_set_password_rejects_short_and_invalid(client, db, stub_email):
    assert client.post("/api/auth/set-password", json={"token": "nope", "password": "abcdefgh"}).status_code == 400
    uid = _mk(db, "sh@x.com", "sh1", password=None)
    from app.auth.tokens import issue_token
    raw = issue_token(uid, "activate", 72)
    r = client.post("/api/auth/set-password", json={"token": raw, "password": "short"})
    assert r.status_code == 400
    assert "password" in r.get_json().get("fields", {})
```

- [ ] **Step 3: Append endpoints to `app/auth/routes.py`**

Add import at top of `app/auth/routes.py`:

```python
from app.core.email import send_email
from app.core.security import hash_password
from .tokens import consume_token, issue_token, validate_token
```

Append:

```python
RESET_HOURS = 1


def _find_identifier(identity: str):
    return run_one(
        "select id::text as id, email, is_active, password_hash from users "
        "where email = :i or username = :i", {"i": identity})


@auth_bp.post("/forgot-password")
def forgot_password():
    body = request.get_json(silent=True) or {}
    row = _find_identifier((body.get("email") or "").strip())
    if row and row["is_active"]:
        raw = issue_token(row["id"], "reset", RESET_HOURS)
        link = f"{current_app.config['FRONTEND_URL']}/set-password?token={**}"
        try:
            send_email(row["email"], "Reset your password",
                       f'<p>Use the link within 1 hour to set a new password:</p>'
                       f'<p><a href="{link}">{link}</a></p>')
        except Exception as exc:
            log.error("forgot-password email failed: %s", exc)
        write_audit(row["id"], "password_reset.requested", row["id"], {})
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
        user = run_one("select is_active from users where id = :i", {"i": rec["user_id"]})
        valid = bool(user and user["is_active"])
    return jsonify(valid=valid)


@auth_bp.post("/set-password")
def set_password():
    body = request.get_json(silent=True) or {}
    raw, password = body.get("token", ""), body.get("password") or ""
    fields = {}
    if len(password) < 8:
        fields["password"] = "password must be at least 8 characters"
    if fields:
        return error("validation failed", 400, fields=fields)
    rec = validate_token(raw, "activate") or validate_token(raw, "reset")
    if rec is None:
        log.warning("invalid or expired set-password token used")
        return error("invalid or expired token", 400)
    run_write("update users set password_hash = :h, failed_attempts = 0, "
              "is_active = true, updated_at = now() where id = :i",
              {"h": hash_password(password), "i": rec["user_id"]})
    consume_token(rec["token_hash"])
    write_audit(rec["user_id"], "account.activated" if rec["purpose"] == "activate"
                else "password_reset.completed", rec["user_id"], {})
    return ("", 204)
```

Also add to the imports in `app/auth/routes.py`:

```python
from flask import current_app
```

and make `validate_token` return `purpose` — adjust `app/auth/tokens.py` `validate_token` select to include `purpose`:

```python
        "select user_id::text as user_id, token_hash, purpose from user_tokens "
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/core/email.py app/auth/routes.py app/auth/tokens.py tests/test_password_flows.py
git commit -m "feat: add forgot-password and set-password flows with activate and reset purposes"
```

---

### Task 7: Admin module — create (invitation), list, get

**Files:**
- Create: `app/admin/__init__.py`, `app/admin/users.py`
- Modify: `app/core/email.py` (add content builders), `app/__init__.py` (register `admin_bp`)
- Test: `tests/test_admin_users.py`

**Interfaces:**
- Consumes: `admin_required` (Task 3), `write_audit`, `issue_token` (Task 4), `email_exists`/`username_exists`/`fetch_user`/`public_user`/`SELECT_PUBLIC_USER` (Task 4), `send_email` (Task 6), `hash_password` (unused here but available).
- Produces:
  - `app.admin.users.admin_bp` — `Blueprint("admin", __name__, url_prefix="/api/admin")`
  - `POST /api/admin/users` — invitation create. Body: `email, username, full_name, role` + optional `start_date, end_date, department_ids`. 201 + user (`status: pending_activation`). Errors: 400 fields, 409 duplicate. Audits `user.create`, `user.invitation_sent`.
  - `GET /api/admin/users` — `?q=&role=&status=active|inactive&department=&page=&page_size=` → `{items, total, page, page_size}`.
  - `GET /api/admin/users/<id>` — 200 user / 404.
  - `app.admin.users.VALIDATION_ERRORS(body, current_app) -> dict` — shared field validator returning `{field: message}`.
  - `app.core.email.invitation_email(full_name: str, link: str) -> tuple[subject, html]` and `reset_email(full_name, link) -> tuple[subject, html]`.

- [ ] **Step 1: Write failing tests**

`tests/test_admin_users.py`:

```python
import pytest
from sqlalchemy import text

from app.core.db import run_one
from app.core.security import hash_password

ADMIN_PW = "adminpw1"
USER_PW = "userpw12"


@pytest.fixture(autouse=True)
def stub_email(monkeypatch):
    calls = []
    monkeypatch.setattr("app.admin.users.send_email",
                        lambda to, subject, html: calls.append((to, subject, html)))
    return calls


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id",
            {"p": hash_password(ADMIN_PW)})
    r = client.post("/api/auth/login",
                    json={"email_or_username": "root@x.com", "password": ADMIN_PW})
    return r.get_json()["token"]


@pytest.fixture()
def user_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('plain@x.com', 'plain', 'Plain', 1, :p) returning id",
            {"p": hash_password(USER_PW)})
    r = client.post("/api/auth/login",
                    json={"email_or_username": "plain@x.com", "password": USER_PW})
    return r.get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_non_admin_forbidden_403(client, db, user_token):
    assert client.get("/api/admin/users", headers=hdr(user_token)).status_code == 403


def test_no_token_401(client, db):
    assert client.get("/api/admin/users").status_code == 401


def test_create_invites_and_persists(client, db, admin_token, stub_email):
    did = run_one("insert into departments (name) values ('Ops') returning id::text as id")["id"]
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "new@x.com", "username": "newbie", "full_name": "New Bie",
                          "role": "user", "department_ids": [did]})
    assert r.status_code == 201
    body = r.get_json()
    assert body["status"] == "pending_activation"
    assert body["departments"][0]["name"] == "Ops"
    assert "password_hash" not in body
    row = run_one("select password_hash, role_id from users where email = 'new@x.com'")
    assert row["password_hash"] is None and row["role_id"] == 1
    assert stub_email and stub_email[0][0] == "new@x.com"
    for action in ("user.create", "user.invitation_sent"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_create_duplicate_email_409(client, db, admin_token):
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "dup@x.com", "username": "d1", "full_name": "D", "role": "user"})
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "DUP@X.COM", "username": "d2", "full_name": "D", "role": "user"})
    assert r.status_code == 409


def test_create_validation_errors(client, db, admin_token):
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "bad", "username": "x", "full_name": "", "role": "boss"})
    assert r.status_code == 400
    fields = r.get_json()["fields"]
    assert "email" in fields and "username" in fields and "full_name" in fields and "role" in fields


def test_create_bad_date_range_400(client, db, admin_token):
    r = client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": "dr@x.com", "username": "dr1", "full_name": "D",
                          "role": "user", "start_date": "2026-06-01", "end_date": "2026-05-01"})
    assert r.status_code == 400 and "end_date" in r.get_json()["fields"]


def test_list_filters_and_pagination(client, db, admin_token):
    for i in range(3):
        client.post("/api/admin/users", headers=hdr(admin_token),
                    json={"email": f"n{i}@x.com", "username": f"n{i}", "full_name": "Alice",
                          "role": "user"})
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "adm2@x.com", "username": "adm2", "full_name": "Bob", "role": "admin"})
    r = client.get("/api/admin/users", headers=hdr(admin_token), query_string={"q": "alice"})
    assert r.get_json()["total"] == 3
    r = client.get("/api/admin/users", headers=hdr(admin_token), query_string={"role": "admin"})
    emails = {u["email"] for u in r.get_json()["items"]}
    assert emails == {"root@x.com", "adm2@x.com"}
    r = client.get("/api/admin/users", headers=hdr(admin_token),
                   query_string={"page": 2, "page_size": 2})
    assert len(r.get_json()["items"]) == 2


def test_get_one_and_404(client, db, admin_token):
    uid = client.post("/api/admin/users", headers=hdr(admin_token),
                      json={"email": "g@x.com", "username": "g1", "full_name": "G",
                            "role": "user"}).get_json()["id"]
    assert client.get(f"/api/admin/users/{uid}", headers=hdr(admin_token)).status_code == 200
    assert client.get("/api/admin/users/" + "0" * 36, headers=hdr(admin_token)).status_code == 404


def test_department_filter(client, db, admin_token):
    did = run_one("insert into departments (name) values ('Tagged') returning id::text as id")["id"]
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "t1@x.com", "username": "t1", "full_name": "T",
                      "role": "user", "department_ids": [did]})
    client.post("/api/admin/users", headers=hdr(admin_token),
                json={"email": "t2@x.com", "username": "t2", "full_name": "T", "role": "user"})
    r = client.get("/api/admin/users", headers=hdr(admin_token),
                   query_string={"department": "tagged"})
    assert [u["email"] for u in r.get_json()["items"]] == ["t1@x.com"]
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_admin_users.py -v`
Expected: FAIL — 404 (no admin blueprint).

- [ ] **Step 3: Add email content builders to `app/core/email.py`**

```python
def invitation_email(full_name: str, link: str) -> tuple[str, str]:
    return (
        "Activate your HotDesk account",
        f'<p>Hi {full_name},</p><p>An account has been created for you. '
        f'Set your password to activate it (link valid 72 hours):</p>'
        f'<p><a href="{link}">Set password</a></p>',
    )


def reset_email(full_name: str, link: str) -> tuple[str, str]:
    return (
        "Reset your HotDesk password",
        f'<p>Hi {full_name},</p><p>Use the link within 1 hour to set a new password:</p>'
        f'<p><a href="{link}">Reset password</a></p>',
    )
```

- [ ] **Step 4: Implement `app/admin/__init__.py` and `app/admin/users.py`**

`app/admin/__init__.py`:

```python
from flask import Blueprint

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

from . import users, departments  # noqa: E402,F401
```

`app/admin/users.py`:

```python
import datetime as dt
import logging
import uuid

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy.exc import IntegrityError

from app.auth.tokens import issue_token
from app.core.audit import write_audit
from app.core.db import run_one, run_query, run_write
from app.core.email import invitation_email, send_email
from app.core.errors import error
from app.core.security import admin_required
from app.core.users import SELECT_PUBLIC_USER, email_exists, public_user, username_exists

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


def _set_departments(user_id: str, department_ids: list[str]) -> None:
    run_write("delete from user_departments where user_id = :u", {"u": user_id})
    for d in department_ids:
        run_write("insert into user_departments (user_id, department_id) values (:u, :d)",
                  {"u": user_id, "d": d})


def _departments_exist(department_ids: list[str]) -> bool:
    if not department_ids:
        return True
    rows = run_query(
        "select id::text as id from departments where id = any(cast(:ids as uuid[]))",
        {"ids": department_ids},
    )
    return {r["id"] for r in rows} == set(department_ids)


@admin_bp.post("/users")
@admin_required
def create_user():
    body = request.get_json(silent=True) or {}
    fields = VALIDATION_ERRORS(body)
    dept_ids = body.get("department_ids") or []
    if not _departments_exist(dept_ids):
        fields["department_ids"] = "unknown department id"
    if fields:
        return error("validation failed", 400, fields=fields)
    if email_exists(body["email"]):
        return error("email already exists", 409)
    if username_exists(body["username"]):
        return error("username already exists", 409)
    try:
        row = run_one(
            "insert into users (email, username, full_name, role_id, start_date, end_date) "
            "values (:email, :username, :full_name, "
            "cast((select id from roles where name = :role) as smallint), "
            ":start_date, :end_date) returning id::text as id",
            {"email": body["email"], "username": body["username"],
             "full_name": body["full_name"].strip(), "role": body["role"],
             "start_date": valid_date(body["start_date"]) if body.get("start_date") else None,
             "end_date": valid_date(body["end_date"]) if body.get("end_date") else None},
        )
    except IntegrityError:
        return error("email or username already exists", 409)
    uid = row["id"]
    _set_departments(uid, dept_ids)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "user.create", uid,
                {"email": body["email"], "username": body["username"], "role": body["role"]})
    _send_invitation(uid, body["email"], body["full_name"], body["username"])
    return jsonify(fetch_user(uid)), 201


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


def fetch_user(user_id: str):
    row = run_one(SELECT_PUBLIC_USER, {"id": user_id})
    return public_user(row) if row else None


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
    where, params = [], {}
    if q:
        where.append("(u.email ilike :q or u.username ilike :q or u.full_name ilike :q)")
        params["q"] = f"%{q}%"
    if role:
        where.append("r.name = :role")
        params["role"] = role
    if status == "active":
        where.append("u.is_active")
    elif status == "inactive":
        where.append("not u.is_active")
    if department:
        where.append("""exists (
            select 1 from user_departments ud join departments d2 on d2.id = ud.department_id
            where ud.user_id = u.id and (d2.id = cast(:dept as uuid) or d2.name ilike :dept))""")
        params["dept"] = department
    where_sql = (" where " + " and ".join(where)) if where else ""
    params["limit"], params["offset"] = page_size, (page - 1) * page_size
    total = run_one(
        "select count(*) as n from users u join roles r on r.id = u.role_id" + where_sql, params
    )["n"]
    rows = run_query(
        "select u.id::text as id, u.email, u.username, u.full_name, r.name as role, "
        "u.is_active, u.start_date, u.end_date, u.password_hash, "
        "(select coalesce(json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name), '[]'::json) "
        " from user_departments ud join departments d on d.id = ud.department_id "
        " where ud.user_id = u.id) as departments "
        "from users u join roles r on r.id = u.role_id" + where_sql +
        " order by u.created_at desc limit :limit offset :offset",
        params,
    )
    g.jwt_uid = get_jwt_identity()
    return jsonify(items=[public_user(dict(r)) for r in rows], total=total,
                   page=page, page_size=page_size)


@admin_bp.get("/users/<uuid:user_id>")
@admin_required
def get_user(user_id):
    user = fetch_user(str(user_id))
    if user is None:
        return error("user not found", 404)
    return jsonify(user)
```

`app/__init__.py` — add inside `create_app` after auth registration:

```python
    from .admin import admin_bp

    app.register_blueprint(admin_bp)
```

- [ ] **Step 5: Create `app/admin/departments.py` placeholder (full build in Task 10)**

```python
# full implementation added in Task 10
```

(The `from . import users, departments` import in `__init__.py` requires the file to exist.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add app/admin app/core/email.py app/__init__.py tests/test_admin_users.py
git commit -m "feat: add admin user invitation create, list with filters, and get endpoints"
```

---

### Task 8: Admin users PATCH / DELETE (safeguards, re-invite on email change)

**Files:**
- Modify: `app/admin/users.py` (append)
- Test: extend `tests/test_admin_users.py`

**Interfaces:**
- Consumes: Task 7 helpers (`fetch_user`, `_set_departments`, `_departments_exist`, `fetch_user`, `fetch_user`... reuse `_send_invitation`), `invalidate_tokens` (Task 4), `admin_required`, `write_audit`.
- Produces:
  - `PATCH /api/admin/users/<id>` — any of `full_name, username, email, role, is_active, start_date, end_date, department_ids`; 200 updated user. `is_active=true` also clears `failed_attempts` (admin unlock). Safeguards → 409. Email change on pending user → invalidate activate tokens + resend.
  - `DELETE /api/admin/users/<id>` — 204, safeguards, cascade.
  - `app.admin.users.is_last_active_admin(user_id) -> bool`.

- [ ] **Step 1: Write failing tests (append to `tests/test_admin_users.py`)**

```python
def _mk_plain(client, admin_token, email, username, role="user"):
    return client.post("/api/admin/users", headers=hdr(admin_token),
                       json={"email": email, "username": username,
                             "full_name": "P Q", "role": role}).get_json()


def test_patch_fields_and_departments(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "p1@x.com", "p1")["id"]
    d1 = run_one("insert into departments (name) values ('D1') returning id::text as id")["id"]
    r = client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token),
                     json={"full_name": "Renamed", "email": "p1new@x.com",
                           "is_active": False, "department_ids": [d1],
                           "start_date": "2026-01-01", "end_date": "2026-12-31"})
    assert r.status_code == 200
    body = r.get_json()
    assert body["email"] == "p1new@x.com" and body["is_active"] is False
    assert body["full_name"] == "Renamed" and body["departments"][0]["id"] == d1
    assert run_one("select action from audit_logs where action = 'user.update'")
    assert run_one("select action from audit_logs where action = 'user.disable'")


def test_patch_duplicate_email_409(client, db, admin_token):
    _mk_plain(client, admin_token, "q1@x.com", "q1")
    uid2 = _mk_plain(client, admin_token, "q2@x.com", "q2")["id"]
    r = client.patch(f"/api/admin/users/{uid2}", headers=hdr(admin_token),
                     json={"email": "q1@X.com"})
    assert r.status_code == 409


def test_patch_invalid_role_or_date_400(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "r1@x.com", "r1")["id"]
    r = client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token), json={"role": "king"})
    assert r.status_code == 400 and "role" in r.get_json()["fields"]
    r = client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token),
                     json={"start_date": "2026-05-05", "end_date": "2026-01-01"})
    assert r.status_code == 400


def test_patch_unlock_clears_failed_attempts(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "lk@x.com", "lk")["id"]
    run_one("update users set failed_attempts = 3, is_active = false where id = :i", {"i": uid})
    client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token), json={"is_active": True})
    row = run_one("select failed_attempts, is_active from users where id = :i", {"i": uid})
    assert row["failed_attempts"] == 0 and row["is_active"] is True
    assert run_one("select action from audit_logs where action = 'user.enable'")


def test_self_safeguards_409(client, db, admin_token):
    me = run_one("select id::text as id from users where username = 'root'")["id"]
    for body in ({"is_active": False}, {"role": "user"}):
        r = client.patch(f"/api/admin/users/{me}", headers=hdr(admin_token), json=body)
        assert r.status_code == 409, body
    assert client.delete(f"/api/admin/users/{me}", headers=hdr(admin_token)).status_code == 409


def test_last_active_admin_safeguard_409(client, db, admin_token):
    other = _mk_plain(client, admin_token, "ad2@x.com", "ad2", role="admin")["id"]
    assert client.patch(f"/api/admin/users/{other}", headers=hdr(admin_token),
                        json={"is_active": False}).status_code == 409
    me = run_one("select id::text as id from users where username = 'root'")["id"]
    run_write("update users set is_active = false where id = :i", {"i": me})
    assert client.delete(f"/api/admin/users/{other}", headers=hdr(admin_token)).status_code == 409


def test_delete_removes_user_and_membership(client, db, admin_token):
    d1 = run_one("insert into departments (name) values ('Z') returning id::text as id")["id"]
    uid = client.post("/api/admin/users", headers=hdr(admin_token),
                      json={"email": "dl@x.com", "username": "dl", "full_name": "DL",
                            "role": "user", "department_ids": [d1]}).get_json()["id"]
    assert client.delete(f"/api/admin/users/{uid}", headers=hdr(admin_token)).status_code == 204
    assert run_one("select 1 from users where id = :i", {"i": uid}) is None
    assert run_one("select action from audit_logs where action = 'user.delete'")


def test_email_change_on_pending_resends_invitation(client, db, admin_token, stub_email):
    uid = _mk_plain(client, admin_token, "pc@x.com", "pc")["id"]
    assert len(stub_email) == 1
    client.patch(f"/api/admin/users/{uid}", headers=hdr(admin_token),
                 json={"email": "pcnew@x.com"})
    assert stub_email[-1][0] == "pcnew@x.com"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_admin_users.py -v`
Expected: new tests FAIL (405 method not allowed).

- [ ] **Step 3: Append to `app/admin/users.py`**

Add imports at top of the file:

```python
from app.auth.tokens import invalidate_tokens
```

Append:

```python
def is_last_active_admin(user_id: str) -> bool:
    row = run_one(
        "select count(*) as n from users u join roles r on r.id = u.role_id "
        "where r.name = 'admin' and u.is_active and u.id != cast(:i as uuid)",
        {"i": user_id},
    )
    return row["n"] == 0


def _is_pending(user_id: str) -> bool:
    row = run_one("select password_hash from users where id = :i", {"i": user_id})
    return row is not None and row["password_hash"] is None


PATCHABLE = ("full_name", "username", "email", "role", "is_active",
             "start_date", "end_date", "department_ids")


@admin_bp.patch("/users/<uuid:user_id>")
@admin_required
def patch_user(user_id):
    user_id = str(user_id)
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
        cur = run_one("select start_date, end_date from users where id = :i", {"i": user_id})
        s = start if "start_date" in body else cur["start_date"]
        e = end if "end_date" in body else cur["end_date"]
        if s and e and s > e:
            fields["end_date"] = "end_date must be on or after start_date"
    dept_ids = body.get("department_ids")
    if dept_ids is not None and not _departments_exist(dept_ids):
        fields["department_ids"] = "unknown department id"
    if fields:
        return error("validation failed", 400, fields=fields)

    target = run_one("select r.name as role, u.is_active from users u "
                     "join roles r on r.id = u.role_id where u.id = :i", {"i": user_id})
    if target is None:
        return error("user not found", 404)

    demoting = body.get("role") and body["role"] != target["role"]
    disabling = body.get("is_active") is False
    if user_id == actor and (demoting or disabling):
        return error("you cannot demote or disable your own account", 409)
    if (demoting or disabling) and target["role"] == "admin" and target["is_active"]:
        if is_last_active_admin(user_id):
            return error("cannot remove or disable the last active admin", 409)

    if "email" in body and email_exists(body["email"], exclude_id=user_id):
        return error("email already exists", 409)
    if "username" in body and username_exists(body["username"], exclude_id=user_id):
        return error("username already exists", 409)

    pending_before = _is_pending(user_id)
    sets, params = [], {"i": user_id}
    for col in ("full_name", "username", "email"):
        if col in body:
            sets.append(f"{col} = :{col}")
            params[col] = body[col].strip()
    if "role" in body:
        sets.append("role_id = (select id from roles where name = :role)")
        params["role"] = body["role"]
    if "is_active" in body:
        sets.append("is_active = :is_active")
        params["is_active"] = body["is_active"]
        if body["is_active"]:
            sets.append("failed_attempts = 0")
    if "start_date" in body:
        sets.append("start_date = :start_date")
        params["start_date"] = start
    if "end_date" in body:
        sets.append("end_date = :end_date")
        params["end_date"] = end
    if sets:
        run_write("update users set " + ", ".join(sets) + ", updated_at = now() "
                  "where id = :i", params)
    if dept_ids is not None:
        _set_departments(user_id, dept_ids)

    if "department_ids" in body and "department_ids" not in fields:
        write_audit(actor, "user.departments_updated", user_id, {"department_ids": dept_ids})
    changed = [k for k in body if k != "department_ids"]
    if changed:
        write_audit(actor, "user.update", user_id, {"fields": sorted(changed)})
    if "is_active" in body:
        write_audit(actor, "user.enable" if body["is_active"] else "user.disable",
                    user_id, {})
    if ("email" in body and pending_before and _is_pending(user_id)) or \
       ("email" in body and pending_before):
        user = fetch_user(user_id)
        invalidate_tokens(user_id, "activate")
        _send_invitation(user_id, user["email"], user["full_name"], user["username"])
    return jsonify(fetch_user(user_id))


@admin_bp.delete("/users/<uuid:user_id>")
@admin_required
def delete_user(user_id):
    user_id = str(user_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    target = run_one("select r.name as role, u.is_active from users u "
                     "join roles r on r.id = u.role_id where u.id = :i", {"i": user_id})
    if target is None:
        return error("user not found", 404)
    if user_id == actor:
        return error("you cannot delete your own account", 409)
    if target["role"] == "admin" and target["is_active"] and is_last_active_admin(user_id):
        return error("cannot remove the last active admin", 409)
    run_write("delete from users where id = :i", {"i": user_id})
    write_audit(actor, "user.delete", user_id, {"email": (target.get("email") or None)})
    return ("", 204)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass. (If the duplicate `pending_before` condition above looks redundant, simplify it to `if "email" in body and pending_before:` — same behavior, clearer.)

- [ ] **Step 5: Commit**

```powershell
git add app/admin/users.py tests/test_admin_users.py
git commit -m "feat: add admin user patch and delete with safeguards and re-invitation"
```

---

### Task 9: Admin password set + resend invitation

**Files:**
- Modify: `app/admin/users.py` (append)
- Test: extend `tests/test_admin_users.py`

**Interfaces:**
- Consumes: `hash_password` (Task 3), `invalidate_tokens`/`issue_token` (Task 4), `_send_invitation` (Task 7), `write_audit`, `fetch_user`.
- Produces:
  - `POST /api/admin/users/<id>/password` — body `{"password"}` (min 8; 400 fields). Re-hashes, clears `failed_attempts`, activates pending user, invalidates all user tokens, audit `user.password_reset`. 204.
  - `POST /api/admin/users/<id>/resend-invitation` — only pending users (else 409); reissues activate token + emails; audit `user.invitation_sent`. 204.

- [ ] **Step 1: Write failing tests (append to `tests/test_admin_users.py`)**

```python
def test_admin_sets_password_and_user_can_login(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "ps@x.com", "ps")["id"]
    r = client.post(f"/api/admin/users/{uid}/password", headers=hdr(admin_token),
                    json={"password": "set-by-adm"})
    assert r.status_code == 204
    assert client.post("/api/auth/login",
                       json={"email_or_username": "ps@x.com", "password": "set-by-adm"}).status_code == 200
    assert run_one("select action from audit_logs where action = 'user.password_reset'")


def test_admin_password_short_rejected_400(client, db, admin_token):
    uid = _mk_plain(client, admin_token, "ps2@x.com", "ps2")["id"]
    r = client.post(f"/api/admin/users/{uid}/password", headers=hdr(admin_token),
                    json={"password": "short"})
    assert r.status_code == 400 and "password" in r.get_json()["fields"]


def test_admin_password_invalidates_tokens_and_unlocks(client, db, admin_token):
    from app.auth.tokens import issue_token, validate_token
    uid = _mk_plain(client, admin_token, "ps3@x.com", "ps3")["id"]
    raw = issue_token(uid, "reset", 1)
    run_one("select 1")  # noop
    from app.core.db import run_write
    run_write("update users set is_active = false, failed_attempts = 5 where id = :i and false",
              {"i": uid})
    client.post(f"/api/admin/users/{uid}/password", headers=hdr(admin_token),
                json={"password": "freshpw1"})
    assert validate_token(raw, "reset") is None


def test_resend_invitation_only_pending(client, db, admin_token, stub_email):
    uid = _mk_plain(client, admin_token, "ri@x.com", "ri")["id"]
    assert len(stub_email) == 1
    r = client.post(f"/api/admin/users/{uid}/resend-invitation", headers=hdr(admin_token))
    assert r.status_code == 204
    assert len(stub_email) == 2 and stub_email[-1][0] == "ri@x.com"
    from app.core.db import run_write
    run_write("update users set password_hash = :p where id = :i",
              {"p": hash_password("activated1"), "i": uid})
    assert client.post(f"/api/admin/users/{uid}/resend-invitation",
                       headers=hdr(admin_token)).status_code == 409
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_admin_users.py -v`
Expected: new tests FAIL (405).

- [ ] **Step 3: Append to `app/admin/users.py`**

```python
@admin_bp.post("/users/<uuid:user_id>/password")
@admin_required
def admin_set_password(user_id):
    user_id = str(user_id)
    body = request.get_json(silent=True) or {}
    password = body.get("password") or ""
    if len(password) < 8:
        return error("validation failed", 400,
                     fields={"password": "password must be at least 8 characters"})
    if run_one("select 1 from users where id = :i", {"i": user_id}) is None:
        return error("user not found", 404)
    run_write("update users set password_hash = :h, failed_attempts = 0, "
              "is_active = true, updated_at = now() where id = :i",
              {"h": hash_password(password), "i": user_id})
    invalidate_tokens(user_id)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "user.password_reset", user_id, {})
    return ("", 204)


@admin_bp.post("/users/<uuid:user_id>/resend-invitation")
@admin_required
def resend_invitation(user_id):
    user_id = str(user_id)
    target = run_one("select email, full_name, username, password_hash from users "
                     "where id = :i", {"i": user_id})
    if target is None:
        return error("user not found", 404)
    if target["password_hash"] is not None:
        return error("user already activated", 409)
    _send_invitation(user_id, target["email"], target["full_name"], target["username"])
    return ("", 204)
```

Add to imports at top of `app/admin/users.py`:

```python
from app.core.security import admin_required, hash_password
```

(replaces the existing `from app.core.security import admin_required` line)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/admin/users.py tests/test_admin_users.py
git commit -m "feat: add admin password reset and resend invitation endpoints"
```

---

### Task 10: Departments CRUD

**Files:**
- Modify: `app/admin/departments.py` (replace placeholder)
- Test: `tests/test_admin_departments.py`

**Interfaces:**
- Consumes: `admin_required`, `write_audit`, `run_one`/`run_query`/`run_write`, `error`.
- Produces:
  - `GET /api/admin/departments` -> `[{id, name, description, user_count}]`
  - `POST /api/admin/departments` — `{name, description?}`; 409 duplicate name; 400 missing name; audit `department.create`; 201
  - `PATCH /api/admin/departments/<id>` — `{name?, description?}`; 409 dup; 404; audit `department.update`; 200
  - `DELETE /api/admin/departments/<id>` — 404 or 204; cascades memberships; audit `department.delete` with `{"user_count": n}`

- [ ] **Step 1: Write failing tests**

`tests/test_admin_departments.py` (reuse the `admin_token` fixture pattern from `tests/test_admin_users.py`; fixtures are module-local there, so duplicate them):

```python
import pytest
from sqlalchemy import text

from app.core.db import run_one, run_write
from app.core.security import hash_password

ADMIN_PW = "adminpw1"


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id",
            {"p": hash_password(ADMIN_PW)})
    r = client.post("/api/auth/login",
                    json={"email_or_username": "root@x.com", "password": ADMIN_PW})
    return r.get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_create_list_update_delete(client, db, admin_token):
    r = client.post("/api/admin/departments", headers=hdr(admin_token),
                    json={"name": "Engineering", "description": "Eng"})
    assert r.status_code == 201
    dept = r.get_json()
    assert dept["name"] == "Engineering" and dept["user_count"] == 0
    r = client.patch(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token),
                     json={"description": "Changed"})
    assert r.status_code == 200 and r.get_json()["description"] == "Changed"
    r = client.delete(f"/api/admin/departments/{dept['id']}", headers=hdr(admin_token))
    assert r.status_code == 204
    for action in ("department.create", "department.update", "department.delete"):
        assert run_one("select action from audit_logs where action = :a", {"a": action})


def test_duplicate_name_409(client, db, admin_token):
    client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "Ops"})
    r = client.post("/api/admin/departments", headers=hdr(admin_token), json={"name": "ops"})
    assert r.status_code == 409


def test_missing_name_400(client, db, admin_token):
    r = client.post("/api/admin/departments", headers=hdr(admin_token), json={})
    assert r.status_code == 400 and "name" in r.get_json()["fields"]


def test_user_count_reflects_memberships(client, db, admin_token):
    did = client.post("/api/admin/departments", headers=hdr(admin_token),
                      json={"name": "Cnt"}).get_json()["id"]
    with db.connect() as conn:
        uid = conn.execute(text("insert into users (email, username, full_name, role_id) "
                                "values ('m@x.com', 'mem1', 'M', 1) returning id")).scalar_one()
        conn.execute(text("insert into user_departments (user_id, department_id) values (:u, :d)"),
                     {"u": uid, "d": did})
    items = client.get("/api/admin/departments", headers=hdr(admin_token)).get_json()["items"]
    assert next(d for d in items if d["id"] == did)["user_count"] == 1


def test_delete_unknown_404(client, db, admin_token):
    assert client.delete("/api/admin/departments/" + "0" * 36,
                         headers=hdr(admin_token)).status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_admin_departments.py -v`
Expected: FAIL (placeholder file has no routes).

- [ ] **Step 3: Implement `app/admin/departments.py` (replace file)**

```python
from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy.exc import IntegrityError

from app.core.audit import write_audit
from app.core.db import run_one, run_query, run_write
from app.core.errors import error
from app.core.security import admin_required

from . import admin_bp

SELECT_DEPTS = (
    "select d.id::text as id, d.name, d.description, "
    "(select count(*) from user_departments ud where ud.department_id = d.id) as user_count "
    "from departments d"
)


def _dept(dept_id: str):
    return run_one(SELECT_DEPTS + " where d.id = cast(:i as uuid)", {"i": dept_id})


@admin_bp.get("/departments")
@admin_required
def list_departments():
    g.jwt_uid = get_jwt_identity()
    rows = run_query(SELECT_DEPTS + " order by d.name")
    return jsonify(items=[dict(r) for r in rows])


@admin_bp.post("/departments")
@admin_required
def create_department():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return error("validation failed", 400, fields={"name": "name is required"})
    try:
        row = run_one("insert into departments (name, description) values (:n, :d) "
                      "returning id::text as id",
                      {"n": name, "d": (body.get("description") or None)})
    except IntegrityError:
        return error("department name already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.create", None, {"name": name, "department_id": row["id"]})
    return jsonify(_dept(row["id"])), 201


@admin_bp.patch("/departments/<uuid:dept_id>")
@admin_required
def update_department(dept_id):
    body = request.get_json(silent=True) or {}
    dept_id = str(dept_id)
    if _dept(dept_id) is None:
        return error("department not found", 404)
    sets, params = [], {"i": dept_id}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return error("validation failed", 400, fields={"name": "name is required"})
        sets.append("name = :n")
        params["n"] = name
    if "description" in body:
        sets.append("description = :d")
        params["d"] = body["description"]
    if not sets:
        return error("no fields provided", 400)
    try:
        run_write("update departments set " + ", ".join(sets) + " where id = cast(:i as uuid)",
                  params)
    except IntegrityError:
        return error("department name already exists", 409)
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.update", None,
                {"department_id": dept_id, "fields": sorted(body)})
    return jsonify(_dept(dept_id))


@admin_bp.delete("/departments/<uuid:dept_id>")
@admin_required
def delete_department(dept_id):
    dept_id = str(dept_id)
    dept = _dept(dept_id)
    if dept is None:
        return error("department not found", 404)
    run_write("delete from departments where id = cast(:i as uuid)", {"i": dept_id})
    actor = get_jwt_identity()
    g.jwt_uid = actor
    write_audit(actor, "department.delete", None,
                {"department_id": dept_id, "name": dept["name"],
                 "user_count": dept["user_count"]})
    return ("", 204)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add app/admin/departments.py tests/test_admin_departments.py
git commit -m "feat: add department CRUD endpoints with user counts and cascade delete"
```

---

### Task 11: `scripts/create_admin.py` bootstrap/recovery script

**Files:**
- Create: `scripts/create_admin.py`
- Test: `tests/test_create_admin_script.py`

**Interfaces:**
- Consumes: `app.core.db` (engine honoring `SQL_SEARCH_PATH` via app context), `app.core.security.hash_password`, `app.core.audit.write_audit`.
- Produces: `ensure_admin(email: str, username: str, full_name: str, password: str) -> str` — idempotent upsert; returns `"created"` or `"updated"`; main() reads env/flags and prints `admin <email> ready`.

- [ ] **Step 1: Write failing tests**

`tests/test_create_admin_script.py`:

```python
from app.core.db import run_one


def _app_ctx(app):
    return app.app_context()


def test_creates_new_admin(app, db):
    from scripts.create_admin import ensure_admin

    with _app_ctx(app):
        assert ensure_admin("sa@x.com", "sa", "Super Admin", "sp-password1") == "created"
    row = run_one("select r.name as role, u.is_active, u.password_hash is not null as pw "
                  "from users u join roles r on r.id = u.role_id where u.email = 'sa@x.com'")
    assert row["role"] == "admin" and row["is_active"] and row["pw"]
    assert run_one("select action from audit_logs where action = 'user.create'")


def test_upsert_unlocks_and_repromotes(app, db):
    from app.core.db import run_write
    from scripts.create_admin import ensure_admin

    with _app_ctx(app):
        ensure_admin("sa@x.com", "sa", "Super Admin", "sp-password1")
        uid = run_one("select id from users where email = 'sa@x.com'")["id"]
        run_write("update users set is_active = false, failed_attempts = 5, role_id = 1 "
                  "where id = :i", {"i": uid})
        assert ensure_admin("sa@x.com", "sa2", "SA", "sp-password2") == "updated"
    row = run_one("select r.name as role, u.is_active, u.failed_attempts "
                  "from users u join roles r on r.id = u.role_id where u.email = 'sa@x.com'")
    assert row["role"] == "admin" and row["is_active"] and row["failed_attempts"] == 0
    assert run_one("select id from users where email = 'sa@x.com'")  # single row
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_create_admin_script.py -v`
Expected: FAIL — `ModuleNotFoundError: scripts.create_admin`.

- [ ] **Step 3: Implement `scripts/create_admin.py`**

Create empty `scripts/__init__.py` (so tests can import it).

```python
"""Create or repair the bootstrap admin account. Idempotent upsert on email.

Usage: python scripts/create_admin.py [--email E --username U --full-name N]
Password comes from BOOTSTRAP_ADMIN_PASSWORD or an interactive prompt.
"""
import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from app.core.audit import write_audit
from app.core.db import run_one, run_write
from app.core.security import hash_password


def ensure_admin(email: str, username: str, full_name: str, password: str) -> str:
    existing = run_one("select id::text as id from users where email = :e", {"e": email})
    if existing:
        run_write(
            "update users set username = :u, full_name = :f, password_hash = :p, "
            "role_id = (select id from roles where name = 'admin'), "
            "is_active = true, failed_attempts = 0, updated_at = now() where id = :i",
            {"u": username, "f": full_name, "p": hash_password(password),
             "i": existing["id"]},
        )
        write_audit(None, "user.update", existing["id"],
                    {"source": "create_admin_script", "fields": ["role", "is_active", "password"]})
        return "updated"
    row = run_one(
        "insert into users (email, username, full_name, password_hash, role_id) "
        "values (:e, :u, :f, :p, (select id from roles where name = 'admin')) "
        "returning id::text as id",
        {"e": email, "u": username, "f": full_name, "p": hash_password(password)},
    )
    write_audit(None, "user.create", row["id"],
                {"source": "create_admin_script", "role": "admin"})
    return "created"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all pass.

- [ ] **Step 5: Manual smoke (optional, dev DB)**

Run: `$env:BOOTSTRAP_ADMIN_EMAIL='me@example.com'; $env:BOOTSTRAP_ADMIN_USERNAME='bootadmin'; $env:BOOTSTRAP_ADMIN_PASSWORD='boot-pass-1'; python scripts/create_admin.py`
Expected: `admin me@example.com ready` (run against the dev Supabase DB, not the test schema).

- [ ] **Step 6: Commit**

```powershell
git add scripts tests/test_create_admin_script.py
git commit -m "feat: add idempotent create_admin bootstrap and recovery script"
```

---

### Task 12: Logging assertions + README documentation

**Files:**
- Create: `tests/test_logging.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything; `caplog` fixture.
- Produces: verified logging guarantees + updated README.

- [ ] **Step 1: Write failing logging tests**

`tests/test_logging.py`:

```python
import logging

from app.core.db import run_one
from app.core.security import hash_password

PW = "secret123"


def _mk(client, db, email):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values (:e, :u, 'U', 1, :p) returning id",
            {"e": email, "u": email.split("@")[0], "p": hash_password(PW)})


def test_failed_login_logs_warning_without_secret(client, db, caplog):
    _mk(client, db, "logme@x.com")
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        client.post("/api/auth/login",
                    json={"email_or_username": "logme@x.com", "password": "wrong-pass-9"})
    msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("failed login" in m for m in msgs)
    joined = "\n".join(msgs)
    assert "wrong-pass-9" not in joined
    assert "secret123" not in joined


def test_request_log_line(client, db, admin_dummy, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/admin/users")
    msgs = [r.getMessage() for r in caplog.records]
    assert any("/api/admin/users 401" in m for m in msgs)


def test_health_requests_not_logged(client, db, caplog):
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/health")
    assert not [r for r in caplog.records if r.name == "app.request"]
```

The `admin_dummy` fixture isn't needed — remove it from the second test signature (`def test_request_log_line(client, db, caplog):`).

- [ ] **Step 2: Run to verify pass/fail**

Run: `python -m pytest tests/test_logging.py -v`
Expected: likely PASS (logging already implemented in Tasks 1/5). If no `app.request`
lines appear, check `setup_logging` keeps propagation enabled (root handlers must receive
`app.*` records for `caplog`); fix `setup_logging`, not the assertion.

- [ ] **Step 3: Update README.md**

Replace the endpoint table with:

```markdown
## Auth

| Endpoint | Purpose | curl command |
|---|---|---|
| `POST /api/auth/login` | Login (email or username), returns JWT | `curl -X POST http://127.0.0.1:5000/api/auth/login -H "Content-Type: application/json" -d '{"email_or_username":"admin@example.com","password":"***"}'` |
| `GET /api/auth/me` | Current user | `curl http://127.0.0.1:5000/api/auth/me -H "Authorization: Bearer <token>"` |
| `POST /api/auth/forgot-password` | Email a reset link | `curl -X POST http://127.0.0.1:5000/api/auth/forgot-password -H "Content-Type: application/json" -d '{"email":"a@b.com"}'` |
| `GET /api/auth/set-password/verify` | Check a token (`?token=***&purpose=activate|reset`) | `curl "http://127.0.0.1:5000/api/auth/set-password/verify?token=***&purpose=activate"` |
| `POST /api/auth/set-password` | Activate account / set new password | `curl -X POST http://127.0.0.1:5000/api/auth/set-password -H "Content-Type: application/json" -d '{"token":"<raw>","password":"***"}'` |

## Admin users (`Authorization: Bearer <admin token>` required)

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/users` | List (`q, role, status, department, page, page_size`) |
| `POST /api/admin/users` | Create user (invitation email sent; no password) |
| `GET /api/admin/users/<id>` | Get user |
| `PATCH /api/admin/users/<id>` | Update any field incl. email, role, active toggle (also unlocks: `{"is_active": true}`) |
| `DELETE /api/admin/users/<id>` | Delete user |
| `POST /api/admin/users/<id>/password` | Admin sets password for user |
| `POST /api/admin/users/<id>/resend-invitation` | Resend activation email (pending users only) |
| `GET /api/admin/departments` | List departments with user counts |
| `POST /api/admin/departments` | Create department |
| `PATCH /api/admin/departments/<id>` | Rename/update |
| `DELETE /api/admin/departments/<id>` | Delete (detaches members) |

All protected calls pass `-H "Authorization: Bearer <token>"`.

## Setup

1. Copy `.env.example` to `.env` and fill in Supabase, JWT and Resend values.
2. Run `sql/0001_...sql` through `sql/0007_seed_roles.sql` in the Supabase SQL editor, in order.
3. `pip install -r requirements.txt`
4. `python scripts/create_admin.py` to create the first admin.
5. `python run.py` to start the API; `python -m pytest` to run tests.

Security notes: accounts lock after 5 failed logins (admin re-enable via PATCH);
login is rejected outside the account start/end date window; all admin actions,
logins and password events are recorded in `audit_logs`.
```

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest -v`
Expected: ALL PASS — this is the release gate for the whole plan.

- [ ] **Step 5: Commit**

```powershell
git add tests/test_logging.py README.md
git commit -m "docs: document admin/auth endpoints and add logging assertions"
```

---

## Definition of Done

- `python -m pytest` fully green against the real dev Supabase DB (test schema `hotdesk_test`).
- SQL scripts applied cleanly to the dev Supabase `public` schema in order.
- `python scripts/create_admin.py` creates, and re-running repairs, the bootstrap admin.
- Manual smoke via curl: create -> invitation (check inbox or Resend dashboard) -> set-password -> login -> PATCH toggle -> login blocked when disabled.
- No passwords/hashes/tokens in logs or audit `details`.

