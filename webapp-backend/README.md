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

## Setup

1. Copy `.env.example` to `.env` and fill in Supabase, JWT and Resend values.
2. Run `sql/0001_...sql` through `sql/0007_seed_roles.sql` in the Supabase SQL editor, in order.
3. `pip install -r requirements.txt`
4. `python scripts/create_admin.py` to create the first admin.
5. `python run.py` to start the API; `python -m pytest` to run tests.

Security notes: accounts lock after 5 failed logins (admin re-enable via PATCH);
login is rejected outside the account start/end date window; all admin actions,
logins and password events are recorded in `audit_logs`.
