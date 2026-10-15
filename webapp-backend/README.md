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
wall, seat, table, sofa, locker, toilet, elevator, stairs, door, window, pantry, plant, corridor. Each row
sets the default size and colour, whether the type can be resized (seats are fixed at 1x1),
and its default `config` (currently `{}` for every type). Seats carry a department tag
(`department_id` or `open_to_all`; untagged seats cannot be booked). Elements can be rotated
0/90/180/270 and, unless fixed, resized from 1 to 20 cells per side. Add or change a type
with SQL; the API and editor pick it up without a code change.

## Setup

1. Copy `.env.example` to `.env` and fill in Supabase, JWT and Resend values.
2. Run every `sql/*.sql` script (`0001_...` through the highest number, currently `0016_...`) in the Supabase SQL editor, in order.
3. `pip install -r requirements.txt`
4. `python scripts/create_admin.py` to create the first admin.
5. `python run.py` to start the API; `python -m pytest` to run tests. Tests need a **local**
   PostgreSQL (with `citext` and `pg_trgm`) set as `TEST_DATABASE_URI` in `.env`; they never use Supabase.

Security notes: accounts lock after 5 failed logins (admin re-enable via PATCH);
login is rejected outside the account start/end date window; all admin actions,
logins and password events are recorded in `audit_logs`.
