# Admin User Module + Auth + Password Management — Design

Date: 2026-10-13
Status: Approved (pending user review of this document)
Scope: `webapp-backend` (Flask + Supabase Postgres)

## Goal

Give the HotDesking web app a self-managed user/admin module:

- Roles table seeded with `user` and `admin`
- Form login (`/api/auth/login`) returning a JWT used to authenticate all protected APIs
- Admin CRUD over users (create, list/search, update any field incl. email and active toggle, delete, admin password reset)
- Account validity window: optional start date and end date; outside the window the user cannot log in
- Account lockout: account auto-disabled after 5 consecutive failed logins; only an admin can re-enable
- Invitation flow: admin creates an account, user receives email and must set a password before login is possible
- Password reset flow: user requests reset by email, uses a tokenized page/API to set a new password
- Departments/groups: a separate `departments` table with many-to-many tagging of users
- Audit log of all admin actions on users and all password lifecycle events

Out of scope: frontend pages (backend exposes the APIs they need), refresh tokens, rate limiting, fine-grained permissions, auto-unlock timers.

## Decisions

| Topic | Decision |
|---|---|
| Identity | Own `users` table + own auth (no Supabase Auth) |
| Roles | `roles` table seeded with `user`, `admin` |
| Tokens | JWT via Flask-JWT-Extended, 12h TTL, no refresh tokens |
| Passwords | bcrypt via `passlib[bcrypt]` |
| Email | Resend API (`resend` SDK) behind a thin `email.py` wrapper (SMTP swappable later) |
| Delete | Soft disable via `is_active`; hard DELETE endpoint also exists |
| Lockout | 5 consecutive failed logins → auto-disabled until admin re-enables (no auto-unlock timer) |
| Validity window | Nullable `start_date`/`end_date` (date); login rejected outside window |
| Departments | `departments` + `user_departments` join table; tagged via whole-set `department_ids` replace |
| Migrations | Plain SQL scripts under `webapp-backend/sql/`, one file per concern, run in Supabase SQL editor in numeric order |
| Style | Raw SQL through existing `run_query()` helper, blueprints, `{"error": ...}` JSON errors |

## 1. Database schema

Scripts live in `webapp-backend/sql/`, executed in numeric order (Supabase SQL editor or
`psql`). Each script is idempotent where feasible (`create table if not exists`,
`create index if not exists`, `on conflict do nothing` for seeds).

| File | Contents |
|---|---|
| `sql/0001_extensions.sql` | `create extension if not exists citext;` (`gen_random_uuid()` is core in PG13+) |
| `sql/0002_roles.sql` | `roles` table + seed |
| `sql/0003_users.sql` | `users` table, constraints, indexes |
| `sql/0004_departments.sql` | `departments`, `user_departments` |
| `sql/0005_user_tokens.sql` | `user_tokens` |
| `sql/0006_audit_logs.sql` | `audit_logs` |
| `sql/0007_seed_roles.sql` | role seed (separate so re-seeding is safe) |

```sql
create table roles (
  id   smallint primary key,
  name text not null unique check (name ~ '^[a-z][a-z0-9_]{1,49}$')
);

create table users (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  username        citext not null unique,
  full_name       text not null check (length(full_name) between 1 and 200),
  password_hash   text,                                   -- NULL = pending activation
  role_id         smallint not null references roles(id) on delete restrict,
  is_active       boolean not null default true,
  start_date      date,                                   -- NULL = active immediately
  end_date        date,                                   -- NULL = never expires
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint users_date_range_chk check (start_date is null or end_date is null
                                         or start_date <= end_date)
);

create index users_role_id_idx      on users (role_id);
create index users_is_active_idx    on users (is_active);
create index users_email_trgm_idx   on users using gin (email gin_trgm_ops); -- requires pg_trgm; optional, see note
create index users_username_trgm_idx on users using gin (username gin_trgm_ops);
create index users_full_name_trgm_idx on users using gin (full_name gin_trgm_ops);

create table departments (
  id          uuid primary key default gen_random_uuid(),
  name        citext not null unique,
  description text check (description is null or length(description) <= 500),
  created_at  timestamptz not null default now()
);

create table user_departments (
  user_id       uuid not null references users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);
create index user_departments_dept_idx on user_departments (department_id);

create table user_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,            -- sha256 of raw token; raw token only in email
  purpose    text not null check (purpose in ('activate', 'reset')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index user_tokens_user_purpose_idx on user_tokens (user_id, purpose, used_at);
create index user_tokens_expires_idx      on user_tokens (expires_at);

create table audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references users(id) on delete set null,  -- NULL = system/unauthenticated
  action     text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_id  uuid,                        -- affected user (or department for dept actions)
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_target_idx on audit_logs (target_id, created_at desc);
create index audit_logs_actor_idx  on audit_logs (actor_id, created_at desc);
create index audit_logs_action_idx on audit_logs (action, created_at desc);
```

FK notes: `users.role_id` is `on delete restrict` (roles are seeded, never dropped);
`audit_logs.actor_id` is `on delete set null` (hard-deleting a user keeps the audit trail
with actor anonymized); `target_id` has no FK so department actions (and audit rows for a
deleted user) still record. Cascade deletes on `user_departments`/`user_tokens`.

The `pg_trgm` GIN indexes in `users` power the list `?q=` search; if `pg_trgm` is not
enabled, the app falls back to `ilike '%…%'` (fine at HotDesking user volumes).
`sql/0001_extensions.sql` therefore also runs `create extension if not exists pg_trgm;`.

`updated_at` maintained by trigger or set explicitly in UPDATE statements.

Seed (`sql/0007_seed_roles.sql`):

```sql
insert into roles (id, name) values (1, 'user'), (2, 'admin')
on conflict (id) do nothing;
```

Audit actions (all state-changing or security-relevant actions across the whole app must
be captured here — admin actions, user self-service actions, and auth events):
`auth.login_success`, `auth.login_failed` (details include identifier tried + attempt
count, never the password), `account.activated`, `account.locked`, `account.unlocked`,
`password_reset.requested`, `password_reset.completed`,
`user.create`, `user.update`, `user.enable`, `user.disable`, `user.delete`,
`user.password_reset`, `user.invitation_sent`, `user.departments_updated`,
`department.create`, `department.update`, `department.delete`.
`actor_id` is the acting admin for admin actions, the user themselves for self-service
actions (e.g. their own password reset), and NULL for unauthenticated events
(failed logins).

Default admin account script — `webapp-backend/scripts/create_admin.py`, run with
`python scripts/create_admin.py`:

- Reads `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`,
  `BOOTSTRAP_ADMIN_FULL_NAME` from `.env` (or `--email/--username/--full-name` flags;
  password flag omitted -> prompts via `getpass`).
- Idempotent upsert on email: creates the admin (bcrypt-hashed password, role `admin`,
  active, no invitation email) or, if the user exists, resets it to a working admin
  (updates username/full_name, sets the password, `is_active=true`, `failed_attempts=0`,
  `role=admin`). This doubles as the break-glass recovery for a locked-out sole admin.
- Writes `user.create`/`user.update` audit rows with `actor_id NULL` (system).
- Prints only non-sensitive confirmation (`admin <email> ready`). Exit code 0/1.

## 2. Auth mechanism

Deps: `Flask-JWT-Extended`, `passlib[bcrypt]`.

- `POST /api/auth/login` — form login. Accepts JSON or form-encoded with
  `{"email_or_username", "password"}` (also accepts `email` or `username` key alone).
  - Unknown user or wrong password → `401 {"error":"invalid credentials"}` (identical for both; no enumeration). Each wrong password increments `failed_attempts`, audits `auth.login_failed`, and at 5 auto-disables the account (`is_active=false`, audit `account.locked`); further attempts also return the generic invalid-credentials message.
  - `is_active = false` → `403 {"error":"account disabled"}`.
  - Outside validity window (`start_date > today` or `end_date < today`) → `403 {"error":"account not yet active" | "account expired"}`.
  - `password_hash IS NULL` → `403 {"error":"password not set, check your email to activate your account"}`.
  - Success → `200`, `failed_attempts` reset to 0, audit `auth.login_success`:
    ```json
    { "token": "<jwt>",
      "user": { "id": "...", "email": "...", "username": "...", "full_name": "...", "role": "admin",
                "is_active": true, "start_date": null, "end_date": null,
                "departments": [{"id": "...", "name": "..."}] } }
    ```
- JWT claims: `sub` = user id, `role`, `email`. TTL from `JWT_ACCESS_TOKEN_EXPIRES` (default 12h).
  `JWT_SECRET_KEY` falls back to `SECRET_KEY`. Protected APIs use `Authorization: Bearer <token>`.
- `@admin_required` decorator (in `app/core/security.py`): `@jwt_required()` + role claim check.
  Missing/expired token → `401`; authenticated but not admin → `403 {"error":"admin required"}`.
- `GET /api/auth/me` — authenticated, any role; returns current user object.

## 3. Admin user APIs

All under `/api/admin/users`, all `@admin_required`. Never expose `password_hash`.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/admin/users` | List. `?q=` matches email/username/full_name; `?role=`; `?status=active\|inactive`; `?department=` (department id or name); `?page=&page_size=` (default 20). Items include `departments`. Returns `{items, total, page, page_size}`. |
| POST | `/api/admin/users` | Create (invitation). Body: `email, username, full_name, role` + optional `start_date, end_date, department_ids`. No password. Validates formats, unique email/username (409), date range (`start_date <= end_date`, 400), departments exist (400). Creates user with `password_hash NULL`, issues 72h `activate` token, sends invitation email. Audit `user.create` + `user.invitation_sent`. → `201` + user with `"status": "pending_activation"`. |
| GET | `/api/admin/users/<id>` | Single user incl. departments, 404 if unknown. |
| PATCH | `/api/admin/users/<id>` | Edit-user form endpoint. Any subset of `full_name, username, email, role, is_active, start_date, end_date, department_ids` (`role` is the role name; `department_ids` replaces the whole set atomically). Validates uniqueness (409), role/departments exist (400), date range (400), safeguards (409). Setting `is_active=true` also resets `failed_attempts` (this is the admin unlock). Audits `user.enable`/`user.disable`/`user.update`/`user.departments_updated`. Re-enabling via PATCH is the only way to clear a lockout. If email of a pending user changes, old activation tokens are invalidated and a new invitation is emailed. → `200` + updated user. |
| DELETE | `/api/admin/users/<id>` | Hard delete. Safeguards apply. Audit `user.delete`. → `204`. |
| POST | `/api/admin/users/<id>/password` | Admin sets a new password directly: `{ "password": "***" }` (min 8 chars). Re-hashes, invalidates outstanding tokens, audit `user.password_reset`. → `204`. Also activates a pending user and clears `failed_attempts`. |
| POST | `/api/admin/users/<id>/resend-invitation` | Only for pending users (`password_hash IS NULL`), else `409`. Replaces prior activation tokens, re-emails. Audit `user.invitation_sent`. → `204`. |

Safeguards (PATCH/DELETE → `409` with a clear error message):

1. Admin cannot demote, disable, or delete their own account.
2. Cannot disable/demote/delete the last active admin.
3. Auto-disable from lockout does not bypass these safeguards (lockout can disable any
   user incl. an admin who fails their own login 5 times — only self-lockout is possible
   there, and the other admins can re-enable; if the sole admin locks themselves out, the
   `scripts/create_admin.py` can be re-run to unlock, since it upserts the bootstrap admin).

### Department/group APIs

All under `/api/admin/departments`, all `@admin_required`:

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/admin/departments` | List all, each with `user_count`. |
| POST | `/api/admin/departments` | Create: `{name, description?}`. Duplicate name → 409. Audit `department.create`. → `201`. |
| PATCH | `/api/admin/departments/<id>` | Update `name`/`description`. Duplicate name → 409. Audit `department.update`. → `200`. |
| DELETE | `/api/admin/departments/<id>` | Delete + cascade rows in `user_departments`. Audit `department.delete` (details include detached `user_count`). → `204`. |

Tagging itself is done through the user's `department_ids` field on create/PATCH (whole-set
replace), not per-membership endpoints; a `GET /api/admin/departments/<id>/users` listing
endpoint is deferred (YAGNI — the user list's `?department=` filter covers it).

## 4. Invitation (set-password) and password reset flows

Reset page is a frontend route (`{FRONTEND_URL}/set-password?token=<raw>`); this backend
only serves the APIs and emails the link. One page/token endpoint serves both purposes.

Emails (Resend; `RESEND_API_KEY`, `EMAIL_FROM`, `FRONTEND_URL` in `.env`):
simple HTML with a button/link. Wrapper `app/core/email.py` isolates the provider.

Public endpoints (no auth):

- `POST /api/auth/forgot-password` — body `{"email"}` (or username). Always `204`,
  even if user unknown/inactive. Issues 30-min `reset` token (invalidating previous
  `reset` tokens for that user), emails `{FRONTEND_URL}/set-password?token=<raw>`.
  Audit `password_reset.requested`.
- `GET /api/auth/set-password/verify?token=***` — `{"valid": true|false}`. Valid means:
  token hash exists, purpose matches, not expired, not used, user `is_active`.
- `POST /api/auth/set-password` — body `{"token", "password"}` (min 8 chars).
  - Valid `activate` token → sets `password_hash`, marks token used, audit `account.activated`.
    Account can now log in.
  - Valid `reset` token → sets new `password_hash`, marks token used, invalidates all
    older tokens for the user, audit `password_reset.completed`.
  - Invalid/expired/used → `400 {"error":"invalid or expired token"}`. Success → `204`.

Token security: 32 random URL-safe bytes; only sha256 stored; single-use; purpose-bound.

## 5. Module layout

Code is segregated into a shared `core` package plus one package per feature module.
Each module package exposes its blueprint from `__init__.py` and keeps routes/business
logic inside itself; cross-module sharing goes through `core` only.

```
webapp-backend/
  sql/                     # numbered DDL/seed scripts (see section 1)
  app/
    __init__.py          # create_app: init_jwt, CORS, register blueprints
    routes.py            # existing /api/health endpoints (unchanged)
    core/                # shared infrastructure
      __init__.py
      config.py          # Config (moved from app/config.py)
      db.py              # engine/session/run_query (moved from app/db.py)
      supabase_client.py # moved from app/supabase_client.py
      security.py        # bcrypt hash/verify, @admin_required
      audit.py           # write_audit(actor_id, action, target_id, details)
      logging.py         # setup_logging(app): app-level logging config
      email.py           # send_email + invitation/reset content builders (Resend)
      errors.py          # error payloads/handlers -> {"error": ...}
      users.py           # shared user query/public-shape helpers
    auth/                # authentication module
      __init__.py        # auth_bp
      routes.py          # login, me, forgot-password, set-password (+verify)
      tokens.py          # create/consume user_tokens (activate/reset)
    admin/               # admin module
      __init__.py        # admin_bp, url_prefix="/api/admin"
      users.py           # /api/admin/users CRUD
      departments.py     # /api/admin/departments CRUD
  scripts/
    create_admin.py      # default admin bootstrap/recovery script
  tests/
    conftest.py          # Flask test client; isolated hotdesk_test schema, SQL applied,
                         # roles + seeded admin, email auto-stubbed
    test_auth.py
    test_admin_users.py
    test_password_flows.py
    test_departments.py
```

- Existing `app/config.py`, `app/db.py`, `app/supabase_client.py` move into `app/core/`
  (imports in `__init__.py`, `routes.py`, `db.py` updated accordingly).
- `core/audit.py` is the single writer to `audit_logs`; modules never insert directly.
- Module routes call SQL through `core.db.run_query`; no ORM.

New deps: `Flask-JWT-Extended`, `passlib[bcrypt]`, `resend`, `pytest`.

## 6. Error handling & config

- All errors: `{"error": "<message>"}`; validation errors `400` include field details.
- Status codes: 400 validation, 401 unauthenticated, 403 forbidden (role/disabled),
  404 unknown id, 409 conflict (duplicates, safeguards), 502 email send failure
  (logged; invitation/reset still treated per-case — reset returns generic 204 to caller
  to avoid enumeration, admin-facing sends surface the error).
- `.env` additions: `JWT_SECRET_KEY`, `JWT_ACCESS_TOKEN_EXPIRES`, `RESEND_API_KEY`,
  `EMAIL_FROM`, `FRONTEND_URL`, `LOG_LEVEL`, `LOG_FILE`,
  `BOOTSTRAP_ADMIN_EMAIL/USERNAME/PASSWORD` (mirrored in `.env.example`).

## 7. Application logging

Distinct from the `audit_logs` table (security-relevant, queryable DB records): this is
runtime logging for operations and debugging, using Python stdlib `logging` only.

- `core/logging.py::setup_logging(app)` called from `create_app()`:
  - Format: `%(asctime)s %(levelname)s [%(name)s] %(message)s`, UTC timestamps.
  - Console handler always on; if `LOG_FILE` is set, also a `RotatingFileHandler`
    (1 MB x 5 backups). Level from `LOG_LEVEL` (default `INFO`).
  - Configures the root logger so third-party noise stays at WARNING while `app.*`
    loggers run at `LOG_LEVEL`.
- Per-module loggers via `logging.getLogger("app.auth")` / `"app.admin"` / `"app.core"`.
- What gets logged:
  - `after_request` hook: `METHOD PATH STATUS DURATION_MS user=<jwt sub or ->` at INFO
    (skips `/api/health*`).
  - Security events at WARNING: failed logins (with identifier tried, never the password),
    lockouts triggered, 401/403 on protected routes, invalid/expired set-password tokens,
    safeguard rejections.
  - Email send failures at ERROR (with Resend response detail).
  - Unhandled exceptions at ERROR with traceback (Flask `generic_exception` handler logs
    then returns `500 {"error":"internal server error"}`).
- Never log: passwords, password hashes, raw or hashed tokens, JWTs, full `.env` values.
- Tests: failed login emits WARNING record (via `caplog`); passwords/tokens absent from
  captured log output.

## 7. Testing

pytest against the real Supabase DB configured via `.env` (matches project's thin setup):

- Login: ok (email or username), wrong password, unknown user, disabled, pending activation,
  before start_date / after end_date rejected; 5 consecutive wrong passwords → auto-disabled
  (login attempt 6 says "account disabled") + `account.locked` audit; success resets counter;
  admin re-enable via PATCH clears counter and restores login.
- Role guard: 401 without/expired token, 403 for non-admin, admin access ok.
- CRUD: create + invitation email asserted (email wrapper stubbed), list filters/search
  (incl. `?department=`), PATCH every field incl. email change, active toggle, dates,
  department re-tagging, GET, DELETE; invalid date range → 400.
- Departments: CRUD + duplicate name 409; delete cascades memberships, user's
  `departments` shrinks; user_count correct.
- Conflicts: duplicate email/username on create and PATCH → 409.
- Safeguards: self-demote/self-disable/self-delete → 409; last-active-admin → 409.
- Flows: forgot-password always 204 + token issued; set-password activate → login works,
  token single-use, expired token rejected; reset invalidates old tokens; resend-invitation
  only for pending users.
- Audit rows written for each mutating action. Whole-app coverage check: every endpoint in
  sections 2-4 that mutates state or signals a security event produces its audit row —
  `auth.login_success`/`auth.login_failed`, self-service `password_reset.requested` /
  `password_reset.completed` (actor = the user themself), failed login with actor NULL,
  and no audit row (or log line) ever contains a password, hash, or token.

- Default admin script: creates new admin; re-run on existing email upserts (unlock,
  password reset, role admin) without duplicating; no plaintext password in output.

## 8. Documentation

Update `webapp-backend/README.md` endpoint table (login, me, forgot/set-password, admin CRUD)
in the existing curl-table style.
