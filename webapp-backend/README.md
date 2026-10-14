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

## Floor plans (`Authorization: Bearer <admin token>` required)

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/floor-plans` | List plans (name, grid size, element count) |
| `POST /api/admin/floor-plans` | Create plan `{name, cols, rows}` (5–80 grid) |
| `GET /api/admin/floor-plans/<id>` | Plan with all placed elements |
| `PATCH /api/admin/floor-plans/<id>` | Rename / resize grid (guards stranded elements) |
| `DELETE /api/admin/floor-plans/<id>` | Delete plan + elements |
| `PUT /api/admin/floor-plans/<id>/elements` | Bulk save placements `{elements:[{type,x,y,rotation,w?,h?,label?,color?,config?}]}` (`w`/`h` default to the catalog size; `config` keys come from the type's default config) |
| `GET /api/admin/floor-plans/catalog` | Element catalog from the `floor_elements` table (label, default size, colour, resizable, default config) |

Frontend editor: `webapp-frontend` → sidebar "Manage Floor Plan" (Vite proxies
`/api/auth` and `/api/admin/floor-plans` to the Flask API; set
`VITE_FLASK_TARGET` if it is not on `http://localhost:5000`).
Element types live in the `floor_elements` table (seeded by `sql/0012_floor_elements.sql`):
wall, seat, table, toilet, elevator, stairs, door, window, pantry, plant, corridor. Each row
sets the default size and colour, whether the type can be resized (seats are fixed at 1x1),
and its default `config` (seats: `{"bookable": true}`). Elements can be rotated
0/90/180/270 and, unless fixed, resized from 1 to 20 cells per side. Add or change a type
with SQL; the API and editor pick it up without a code change.

## Setup

1. Copy `.env.example` to `.env` and fill in Supabase, JWT and Resend values.
2. Run every `sql/*.sql` script (`0001_...` through the highest number, currently `0012_...`) in the Supabase SQL editor, in order.
3. `pip install -r requirements.txt`
4. `python scripts/create_admin.py` to create the first admin.
5. `python run.py` to start the API; `python -m pytest` to run tests.

Security notes: accounts lock after 5 failed logins (admin re-enable via PATCH);
login is rejected outside the account start/end date window; all admin actions,
logins and password events are recorded in `audit_logs`.
