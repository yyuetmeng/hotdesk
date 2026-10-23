# Hot Desk

A hot-desking web app: people book desks on published floor plans, check in by scanning the QR code on the desk,
and give the seat up when they leave. Admins draw the floor plans, manage users and project teams, print desk
labels, run floor displays on office TVs, and see utilisation in Insights.

All times are Asia/Singapore.

## Repository layout

| Path | What it is |
|---|---|
| `webapp-backend/` | Flask REST API (Python), all business logic and database access. See its [README](webapp-backend/README.md) |
| `webapp-backend/sql/` | Numbered migrations (`0001`–`0033`) for an existing database |
| `webapp-backend/sql_prod/` | The same schema folded into one file per table, to build a **new** database ([README](webapp-backend/sql_prod/README.md)) |
| `webapp-frontend/` | React single-page app built with Vite. See its [README](webapp-frontend/README.md) |
| `docs/CODING_GUIDELINES.md` | Rules for all code here (date formats, naming, structure). Read before changing code |
| `docs/BUGFIXES.md` | Notable bugs and how they were fixed |
| `docs/superpowers/specs/`, `plans/` | Design specs and implementation plans per feature, referenced from code comments |
| `.agents/`, `skills/`, `opencode.json` | AI coding-assistant configuration; not part of the app |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, Vite 6, plain CSS (light/dark themes). `qrcode` draws desk labels, `jsqr` reads QR codes where the browser has no `BarcodeDetector` |
| Backend | Python 3.12, Flask 3, Flask-JWT-Extended (bearer tokens), Flask-CORS, SQLAlchemy 2 (ORM plus raw SQL), psycopg 3, passlib/bcrypt |
| Database | PostgreSQL on Supabase (Singapore), with the `citext` and `pg_trgm` extensions |
| Email | Resend (account invitations and password resets) |
| Hosting | Vercel: one project per folder (see Deployment) |
| Tests | pytest against a **local** PostgreSQL (backend); Node `assert` smoke scripts for pure frontend logic |

## Features

| Feature | Who | Frontend route | Backend |
|---|---|---|---|
| Sign in, forgot / set password, "keep me signed in" | everyone | `/login`, `/forgot-password`, `/set-password` | `app/auth/` |
| Dashboard: where I sit, my bookings, my team today, my check-in pattern | users | `/` | `app/desk/dashboard.py` |
| Book a desk (AM, PM or full day, today or the next working day; for yourself or colleagues) | users | `/book` | `app/desk/` |
| Check in by scanning the desk's QR code; give up the seat | users | `/scan`, `/checkin/<seat id>` | `app/desk/` |
| Floor overview and Colleague Finder | users | `/overview`, `/finder` | `app/desk/`, `app/desk/people.py` |
| Usual seat and auto-booking | users, admins | dashboard, Manage Users | `app/desk/autobook.py` |
| Floor plan editor with publish / unpublish / version history, zones | admins | `/floor-plans` | `app/admin/floorplans.py`, `floorplan_publishing.py` |
| Print desk QR labels (PNG / ZIP) | admins | `/desk-labels` | `app/admin/desk_labels.py` |
| Floor displays for office TVs (no sign-in) | admins set up, public views | `/displays`, `/display/<slug>` | `app/admin/displays.py`, `app/public/` |
| Users and project teams, Excel bulk import, team account managers | admins, account managers | `/users` | `app/admin/users.py`, `departments.py`, `bulk_import.py` |
| Seat assignments (who owns a seat, until when) | admins | `/seat-assignments` | `app/admin/seat_assignments.py` |
| Insights: occupancy, zones, teams, booking funnel, activity, team seat plan | admins | `/insights` | `app/admin/insights.py` and siblings |
| Audit log with Excel export | admins | `/audit` | `app/admin/audit.py` |

**Roles:** `user` and `admin`. A user can also be an **account manager** for chosen project teams, which shows
only Manage Users, limited to those teams.

## Quick start (local)

Prerequisites: Python 3.12, Node.js 20.11+, and a local PostgreSQL 15+ for the tests.

```bash
# 1. Backend (http://localhost:5000)
cd webapp-backend
cp .env.example .env          # fill in SUPABASE_CONNECTION_STRING, SECRET_KEY, etc.
pip install -r requirements.txt
python scripts/create_admin.py --email you@example.com --username admin  # first admin, once per database
python run.py

# 2. Frontend (http://localhost:5173), in a second terminal
cd webapp-frontend
npm install
npm run dev
```

Vite proxies `/api/...` to Flask on port 5000, so `VITE_API_BASE_URL` stays empty locally.

> **The local backend talks to whatever database `.env` points at, which is normally the live Supabase
> database.** Anything you do in the local app changes real data. Automated tests never use it: they need
> `TEST_DATABASE_URI` pointing at a local PostgreSQL.

On Windows, `start.bat` in each folder starts that part.

## Database

- **New database:** run `webapp-backend/sql_prod/` (`ddl/`, then `dml/`, then `data/`), then `create_admin.py`.
- **Existing database:** run any `webapp-backend/sql/NNNN_*.sql` it doesn't have yet, in number order.
- Every schema change is a new numbered file in `sql/` **and** the same change in `sql_prod/`.
  `tests/test_sql_prod.py` fails if they differ.

## Deployment (Vercel)

Two Vercel projects are linked to this repo (`.vercel/repo.json`):

| Project | Root directory | Notes |
|---|---|---|
| `jd-hotdesk` (frontend) | `webapp-frontend` | Vite preset, output `dist`. `vercel.json` rewrites every path to `index.html` so deep links work. Env: `VITE_API_BASE_URL` = the backend URL |
| `jd-hotdesk-vercel` (backend) | `webapp-backend` | Python serverless function `api/index.py` wraps the Flask app. `vercel.json` pins the region to `sin1` (next to the Supabase database). `.vercelignore` leaves out tests, SQL and scripts |

Backend env vars on Vercel: `SUPABASE_CONNECTION_STRING`, `SECRET_KEY`, `FRONTEND_URL` (the frontend URL, used
in email links), and for email `RESEND_API_KEY` and `EMAIL_FROM`. Add others from `.env.example` as needed.

Health checks: `GET /api/health` (API) and `GET /api/health/db` (database).

## Things to know

- **Check-in needs a scan.** Desk labels encode `<site>/checkin/<seat id>`. A seat page opened by the phone camera
  or the in-app scanner checks in; opened from a link inside the app, it only shows the seat. The server cannot
  tell a scan from a typed URL, so this is a usability rule, not a security control.
- **The camera needs HTTPS** (or `localhost`). On a plain `http://` LAN address the scanner can't start.
- **No background jobs.** Unclaimed bookings are released and check-ins ended lazily, on every desk or public
  request, so the app works on serverless hosting.
- **Email and username ignore case** for sign-in, password reset and duplicate checks.
- **Resend's test sender** (`onboarding@resend.dev`) only delivers to the Resend account owner's address. Verify a
  domain in Resend before inviting other people.
- **Accounts lock** after 5 failed sign-ins; an admin re-enables them. Admin actions, sign-ins and password events
  are written to `audit_logs`.
- **OneDrive folder:** Vite's file watcher here can miss a second save made very quickly after the first. If the
  page doesn't update, save again or restart `npm run dev`.
