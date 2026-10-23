# Hot Desk API (webapp-backend)

Flask REST API for Hot Desk, on PostgreSQL (Supabase). Every endpoint is under `/api`. See the
[root README](../README.md) for the overall picture and deployment.

## Setup

1. `pip install -r requirements.txt` (Python 3.12).
2. Copy `.env.example` to `.env` and fill it in (see Configuration).
3. Build the database. For a **new** database, run `sql_prod/` (one file per table, plus the project teams and
   published floors; see `sql_prod/README.md`). For an existing one, run any `sql/*.sql` migrations it doesn't
   have yet, in number order (currently up to `0033_department_seats_planned.sql`).
4. `python scripts/create_admin.py` to create the first admin. It takes `--email`, `--username` and `--full-name`,
   or the `BOOTSTRAP_ADMIN_*` values in `.env`, and asks for the password unless `BOOTSTRAP_ADMIN_PASSWORD` is set.
   Safe to re-run: it updates the admin with that email.
5. `python run.py` starts the API on `http://localhost:5000` with auto-reload (`start.bat` on Windows).

> `.env` normally points at the **live** Supabase database. The local API then reads and writes real data.

## Configuration (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_CONNECTION_STRING` | yes | PostgreSQL URL (`postgresql://...`). The app won't start without it |
| `SECRET_KEY` | yes | Flask secret; also the JWT key unless `JWT_SECRET_KEY` is set |
| `JWT_SECRET_KEY` | no | Separate key for signing tokens |
| `JWT_ACCESS_TOKEN_EXPIRES` | no | Token lifetime in seconds (default 43200 = 12 h) |
| `JWT_REMEMBER_EXPIRES` | no | "Keep me signed in" lifetime (default 432000 = 5 days) |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | Resend key and sender (`Hot Desk <noreply@your-domain>`). Without them invitation and reset emails fail; the failure is logged and the request still succeeds |
| `FRONTEND_URL` | for email | Where email links point (`http://localhost:5173` locally) |
| `BOOKING_TIMEZONE` | no | Default `Asia/Singapore` |
| `LOG_LEVEL`, `LOG_FILE` | no | Logging; leave `LOG_FILE` empty on Vercel (read-only file system) |
| `BOOTSTRAP_ADMIN_EMAIL`, `_USERNAME`, `_FULL_NAME`, `_PASSWORD` | no | Defaults for `scripts/create_admin.py` |
| `TEST_DATABASE_URI` | for tests | A **local** PostgreSQL; tests refuse anything else |
| `SUPABASE_URL`, `SUPABASE_KEY` | no | Supabase REST client (`app/core/supabase_client.py`), not used by the main flows |

## Code layout

```
run.py                 local entry point (debug server)
api/index.py           Vercel entry point (exposes the Flask app)
app/__init__.py        create_app(): config, CORS, DB, JWT, logging, blueprints, request logging
app/routes.py          /api/health and /api/health/db
app/core/              shared building blocks (no routes)
app/auth/              /api/auth: sign-in, tokens, passwords
app/desk/              /api/desk: booking, check-in, dashboard, people (any signed-in user)
app/admin/             /api/admin: admin and account-manager features
app/public/            /api/public: no sign-in, for floor displays
scripts/create_admin.py
sql/                   numbered migrations for existing databases
sql_prod/              one file per table, for new databases
tests/                 pytest suite
```

### `app/core/`

| Module | What it does |
|---|---|
| `config.py` | Reads `.env` into `Config` |
| `db.py` | SQLAlchemy engine per URI, one connection per request; `run_query` / `run_one` / `run_write` for raw SQL |
| `orm.py` | ORM session per request (`orm_session()`) |
| `auth_models.py`, `desk_models.py`, `floorplan_models.py`, `assignment_models.py` | ORM models |
| `users.py` | User lookups (email/username ignore case), `public_user` DTO |
| `security.py`, `passwords.py` | bcrypt hashing; password policy (8+ chars, letters and numbers, not common or your name) |
| `team_scope.py` | Which accounts an account manager may manage |
| `audit.py` | `write_audit()` into `audit_logs` |
| `email.py` | Resend wrapper and email templates |
| `errors.py`, `logging.py` | JSON errors; log setup |
| `xlsx.py`, `xlsx_read.py` | Minimal Excel writer/reader (no extra dependency) for exports and imports |

### `app/desk/` (signed-in users)

| Module | What it does |
|---|---|
| `routes.py` | HTTP layer for `/api/desk` |
| `service.py` | Booking and check-in logic over published floors: seat states, permissions (`can_book`, `can_check_in`, `can_give_up`), suggestions |
| `rules.py` | Time rules: 30-minute blocks, AM/PM/full-day presets, working days, release and auto-end times |
| `autobook.py` | Usual seat and auto-booking |
| `dashboard.py` | Data for the user's dashboard |
| `people.py` | Colleague Finder |
| `zones.py` | Which seats are in which zone (from positions, never stored) |

### `app/admin/`

| Module | What it does |
|---|---|
| `users.py`, `departments.py`, `bulk_import.py` | Users, project teams, Excel import; invitations |
| `floorplans.py`, `floorplan_publishing.py` | Floor plan drafts, catalog, publish/unpublish/discard, history |
| `desk_labels.py` | Records which QR labels were downloaded |
| `displays.py` | Floor display configuration |
| `seat_assignments.py` | Who is assigned to which seat, with end dates |
| `insights.py`, `occupancy.py`, `team_insights.py`, `funnel.py`, `team_seat_plan.py` | Insights cards |
| `audit.py` | Audit log views, Excel export, clearing |

## Tests

```bash
python -m pytest                    # everything (several minutes)
python -m pytest tests/test_auth_login.py -q
```

- Tests need a **local** PostgreSQL with `citext` and `pg_trgm`, set as `TEST_DATABASE_URI`. They build the schema
  from `sql/` and never touch Supabase.
- `tests/test_sql_prod.py` checks that `sql_prod/` builds exactly what the migrations build.
- `tests/test_query_budget.py` caps the number of SQL queries per endpoint; keep it passing when adding queries.

## Things to note

- **Times:** stored as UTC instants; booking days and presets use `BOOKING_TIMEZONE`.
- **No background jobs.** Releasing unclaimed bookings (30 minutes after the slot starts; Full day at 10:00) and
  ending check-ins happen on every desk/public request. Several TVs polling at once are safe: expired bookings
  are settled with `SKIP LOCKED`.
- **Check-in is meant to come from a QR scan.** The API itself accepts `POST /seats/<id>/check-in` from any
  signed-in user who may use the seat; the "scan only" rule lives in the frontend.
- **citext columns:** email and username are `citext`, but bound parameters arrive as `text`, which compares
  case-sensitively. Compare with `func.lower(...)` as `app/core/users.py` does.
- **Serverless:** on Vercel each instance keeps its own small connection pool. If you see "too many clients",
  switch to Supabase's transaction pooler (port 6543) and turn off psycopg prepared statements.
- **Security:** accounts lock after 5 failed sign-ins (an admin re-enables with `PATCH {"is_active": true}`);
  sign-in is refused outside the account's start/end dates; admin actions, sign-ins and password events go to
  `audit_logs`. A disabled account's existing token keeps working until it expires.
- **Adding a floor element type** is SQL only (a row in `floor_elements`); the API and editor pick it up.

## API reference

All protected calls need `Authorization: Bearer <token>`.

### Health

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | API liveness: `{"status": "ok"}` |
| `GET /api/health/db` | Database: `{"status": "ok", "database": "connected"}`, or `503` with the error |

### Auth (`/api/auth`)

| Endpoint | Purpose |
|---|---|
| `POST /login` | `{email_or_username, password, remember?}` → `{token, user}` |
| `GET /me` | Current user |
| `POST /change-password` | Signed-in password change |
| `POST /forgot-password` | `{email}`; emails a reset link (always `204`) |
| `GET /set-password/verify` | Check a token (`?token=&purpose=activate\|reset`) |
| `POST /set-password` | `{token, password}`: activate an account or reset a password |
| `GET /common-password-hashes` | Hashes of well-known passwords, for the live strength check |

### Desk (`/api/desk`, any signed-in user)

Bookable seats are on **published** floors and tagged Free for all or with a project team. Bookings are for today
or the next working day: AM (08:00–13:00), PM (13:00–18:00) or Full day (08:00–18:00), stored as 30-minute
blocks. Spec: `docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md`.

| Endpoint | Purpose |
|---|---|
| `GET /floors`, `GET /floors/<plan_id>?date=&preset=` | Published floors; layout, zones and per-seat state (`available` / `booked` / `occupied` / `not_bookable`) with `can_book`, `can_check_in`, `can_give_up` |
| `POST /bookings` | `{plan_id, seat_id, date, preset, user_id?}` (yourself, or a colleague within your `booking_allowance`) |
| `GET /bookings/mine`, `DELETE /bookings/<id>` | My bookings (and ones I made for others); cancel before check-in |
| `GET /colleagues?q=&date=` | People I may book for, with allowance used/left |
| `GET /seats/<seat_id>`, `GET /seats/<seat_id>/activity` | Seat info for the check-in page; today's activity |
| `POST /seats/<seat_id>/check-in`, `POST /seats/<seat_id>/give-up` | Check in (optional `{location}`), give the seat up |
| `GET /me`, `PATCH /me` | My active check-in; my settings (usual seat, auto-book) |
| `GET /dashboard` | Dashboard data |
| `GET /people?q=` | Colleague Finder |
| `GET /suggest`, `GET /teams`, `GET /displays` | Seat suggestions, project teams, display links |

### Public (`/api/public`, no sign-in; today only, names and initials only)

`GET /floors`, `GET /floors/<plan_id>` (with `summary` and zones), `GET /seats/<seat_id>/activity`,
`GET /displays/<slug>` (a display's config and floors).

### Admin (`/api/admin`)

Admins only, except Manage Users, which account managers can use for their own teams.

| Area | Endpoints |
|---|---|
| Users | `GET/POST /users`, `GET/PATCH/DELETE /users/<id>`, `POST /users/<id>/password`, `POST /users/<id>/resend-invitation`, `POST /users/import`, `GET /users/import-template.xlsx` |
| Project teams | `GET/POST /departments`, `PATCH/DELETE /departments/<id>` |
| Floor plans | `GET/POST /floor-plans`, `GET /floor-plans/catalog`, `GET/PATCH/DELETE /floor-plans/<id>`, `PUT /floor-plans/<id>/elements`, `POST /floor-plans/<id>/publish \| unpublish \| discard`, `GET /floor-plans/<id>/published \| history` |
| Desk labels | `GET/POST /desk-labels/downloads` |
| Displays | `GET/POST /displays`, `PATCH/DELETE /displays/<id>` |
| Seat assignments | `GET /seat-assignments`, `PUT /seat-assignments/seats/<seat_id>`, `DELETE /seat-assignments/<id>` |
| Insights | `GET /insights/zones \| occupancy \| teams \| teams.xlsx \| teams/lines \| funnel \| activity \| seat-assignments-ending \| team-seats`, `PUT /insights/team-seats/plan` |
| Audit | `GET /audit`, `GET /audit.xlsx`, `GET /audit/security-summary`, `POST /audit/clear` |

**Creating a user** sends no password: the user gets an invitation email (valid 72 hours) and sets one on
`/set-password`. The response has `invitation_sent: false` if the email failed; the user still exists, and an
admin can resend the invitation or set a password.

**Floor plans:** a plan has a draft and numbered, immutable published versions. Saving elements keeps their
`id`s, so seat ids (and printed QR labels) survive edits and republishing. Element types come from the
`floor_elements` table (wall, seat, table, sofa, locker, toilet, elevator, stairs, door, window, pantry, plant,
corridor, zone). Seats are 1×1 and carry `department_id` or `open_to_all`; untagged seats can't be booked.
**Zones** are named rectangles; a seat belongs to the zone that contains its cell.
