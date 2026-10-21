# Web App Backend

Flask REST API with a Supabase (Postgres) connector.

## Healthcheck

Start the server first:

```bat
python run.py
```

| Endpoint | Purpose | curl command |
|---|---|---|
| `GET /api/health` | API liveness | `curl http://127.0.0.1:5000/api/health` |
| `GET /api/health/db` | Database connectivity | `curl http://127.0.0.1:5000/api/health/db` |

Expected responses:

```json
{ "status": "ok" }
```

```json
{ "status": "ok", "database": "connected" }
```

If the database check fails it returns HTTP `503` with:

```json
{ "status": "error", "database": "<error detail>" }
```

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
| `POST /api/admin/users` | Create user (no password; sends an invitation email). Returns `invitation_sent: false` if the email fails — the user is still created |
| `GET /api/admin/users/<id>` | Get user |
| `PATCH /api/admin/users/<id>` | Update any field incl. email, role, active toggle (also unlocks: `{"is_active": true}`) |
| `DELETE /api/admin/users/<id>` | Delete user |
| `POST /api/admin/users/<id>/password` | Admin sets password for user |
| `POST /api/admin/users/<id>/resend-invitation` | Resend activation email (pending users only); `502` if the email cannot be sent |
| `GET /api/admin/departments` | List departments with user counts |
| `POST /api/admin/departments` | Create department |
| `PATCH /api/admin/departments/<id>` | Rename/update |
| `DELETE /api/admin/departments/<id>` | Delete (detaches members) |

All protected calls pass `-H "Authorization: Bearer <token>"`.

Frontend: sidebar **Manage Users** (`webapp-frontend/src/pages/users/`) — user list with
filters and paging, create/edit, set password, resend invitation, delete, and departments.
Vite proxies `/api/admin/users` and `/api/admin/departments` to this API (restart Vite after
changing proxy rules). Invitation and reset emails need `RESEND_API_KEY`, `EMAIL_FROM` and a
`FRONTEND_URL` pointing at the React app, whose `/set-password` page handles both invitation and
reset links (`/forgot-password` requests a reset link).

## Seat booking and check-in (`Authorization: Bearer <token>`, any signed-in user)

Free-for-all seats on **published** floor plans can be booked for today or tomorrow in AM
(08:00–13:00), PM (13:00–18:00) or Full day (08:00–18:00), stored as 30-minute blocks. Times are
Asia/Singapore (`BOOKING_TIMEZONE`). Spec: `docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md`.

| Endpoint | Purpose |
|---|---|
| `GET /api/desk/floors` | Published floors |
| `GET /api/desk/floors/<plan_id>?date=&preset=` | Layout, catalog and per-seat state (`available` / `booked` / `occupied` / `not_bookable`), names/initials, `can_book`, `can_check_in`, `can_give_up` |
| `POST /api/desk/bookings` | Book `{plan_id, seat_id, date, preset, user_id?}` (for yourself, or a colleague within your `booking_allowance`) |
| `GET /api/desk/bookings/mine` | My bookings and those I made for others |
| `DELETE /api/desk/bookings/<id>` | Cancel (booker, booked person, admin; before check-in) |
| `GET /api/desk/colleagues?q=&date=` | People I may book for, with allowance used/left |
| `GET /api/desk/seats/<seat_id>` | Seat info for the check-in page |
| `POST /api/desk/seats/<seat_id>/check-in` / `give-up` | Check in / give the seat up |
| `GET /api/desk/seats/<seat_id>/activity` | Today's activity on the seat |
| `GET /api/desk/me` | My active check-in |

Public, no sign-in (for the floor dashboard; today only, names and initials only):
`GET /api/public/floors`, `GET /api/public/floors/<plan_id>`, `GET /api/public/seats/<seat_id>/activity`.

Unclaimed bookings are released 30 minutes after their slot starts (Full day at 10:00), or 30
minutes after a same-day booking was made; check-ins end automatically. Both are applied on every
desk/public request (no background job). Frontend: **Book a desk** (`/book`), **Desk check-in**
(`/checkin/<seat_id>`, opened by a seat's QR code) and **Print Desk Labels** (`/desk-labels`, admins: filter by floor, zone,
project team or label; download one PNG or several as a ZIP).

## Floor displays (public TVs)

Admins configure displays at sidebar **Manage Floor Display** (`/displays`); each display has a link
`/display/<slug>` to open on a location's TV (no sign-in). Spec: `docs/superpowers/specs/2026-10-15-floor-dashboard-design.md`.

| Endpoint | Purpose |
|---|---|
| `GET/POST /api/admin/displays`, `PATCH/DELETE /api/admin/displays/<id>` | Configure displays `{name, slug, plan_ids, show_overall, layout: rotate\|grid, rotate_seconds 10-120}` (admins) |
| `GET /api/public/displays/<slug>` | Display config with its floors in order (`published` flag) — no sign-in |
| `GET /api/public/floors/<plan_id>` | Also returns `summary {bookable, available, booked, occupied, occupancy_pct}` and each seat's `department` |

The TV refreshes every 30 seconds and keeps the last data when offline. Several TVs polling at once
are safe: expired bookings are settled with `SKIP LOCKED` and conflicts are retried on the next request.

## Floor plans (`Authorization: Bearer <admin token>` required)

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/floor-plans` | List plans (name, grid size, element count, `status`, `published_version`, `published_at`) |
| `POST /api/admin/floor-plans` | Create plan `{name, cols, rows}` (5–80 grid) |
| `GET /api/admin/floor-plans/<id>` | Plan with its **draft** elements, plus `status` (`draft` / `published` / `changed` / `unpublished`), `published_version`, `published_at`, `published_by` |
| `PATCH /api/admin/floor-plans/<id>` | Rename / resize grid (guards stranded elements) |
| `DELETE /api/admin/floor-plans/<id>` | Delete plan + elements |
| `PUT /api/admin/floor-plans/<id>/elements` | Bulk save the draft; element `id`s are kept (UUIDs must belong to this plan; new elements omit `id`). Placements `{elements:[{type,x,y,rotation,w?,h?,label?,color?,config?,department_id?,open_to_all?}]}` (`w`/`h` default to the catalog size; `config` keys come from the type's default config) |
| `GET /api/admin/floor-plans/catalog` | Element catalog from the `floor_elements` table (label, default size, colour, resizable, default config) |
| `POST /api/admin/floor-plans/<id>/publish` | Publish the draft as the next numbered version (409 if nothing changed; 400 if the draft is invalid) |
| `POST /api/admin/floor-plans/<id>/unpublish` | Take the plan down (versions kept) |
| `POST /api/admin/floor-plans/<id>/discard` | Reset the draft to the published version |
| `GET /api/admin/floor-plans/<id>/published` | The published version (read-only; 404 if not published) |

Frontend editor: `webapp-frontend` → sidebar "Manage Floor Plan" (Vite proxies
`/api/auth` and `/api/admin/floor-plans` to the Flask API; set
`VITE_FLASK_TARGET` if it is not on `http://localhost:5000`).
Element types live in the `floor_elements` table (seeded by `sql/0012_floor_elements.sql`):
wall, seat, table, sofa, locker, toilet, elevator, stairs, door, window, pantry, plant, corridor, zone. Each row
sets the default size and colour, whether the type can be resized (seats are fixed at 1x1),
and its default `config` (currently `{}` for every type). Seats carry a department tag
(`department_id` or `open_to_all`; untagged seats cannot be booked). Elements can be rotated
0/90/180/270 and, unless fixed, resized from 1 to 20 cells per side. Add or change a type
with SQL; the API and editor pick it up without a code change.

**Zones** (`sql/0020_floor_zones.sql`, spec `docs/superpowers/specs/2026-10-15-floor-zones-design.md`) are
named outlines: up to 80 cells per side, never rotated, never overlapping another zone, but drawn around
seats and other elements. A seat belongs to the zone whose rectangle contains its cell (worked out from
positions, never stored). `GET /api/desk/floors/<id>` and `GET /api/public/floors/<id>` return
`zones [{id, name, x, y, w, h, color, total, free, occupied, booked, pct}]`; `GET /api/admin/insights/zones`
(admins) returns live utilisation rows for every published floor (`No zone` / `Whole floor` rows included),
shown on the Insights page.

## Setup

1. Copy `.env.example` to `.env` and fill in Supabase, JWT and Resend values.
2. Build the database. For a **new** database, run `sql_prod/` (one file per table, plus the project teams and
   published floors; see `sql_prod/README.md`). For an existing one, run any `sql/*.sql` migrations it doesn't have yet,
   in number order (currently up to `0031_...`).
3. `pip install -r requirements.txt`
4. `python scripts/create_admin.py` to create the first admin.
5. `python run.py` to start the API; `python -m pytest` to run tests. Tests need a **local**
   PostgreSQL (with `citext` and `pg_trgm`) set as `TEST_DATABASE_URI` in `.env`; they never use Supabase.

Security notes: accounts lock after 5 failed logins (admin re-enable via PATCH);
login is rejected outside the account start/end date window; all admin actions,
logins and password events are recorded in `audit_logs`.
