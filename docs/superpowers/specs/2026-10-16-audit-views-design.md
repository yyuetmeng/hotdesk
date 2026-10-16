# Audit views across administration — design

Date: 2026-10-16. Owner: "do all the suggestions before building, and the suggested order".

## 0. Groundwork

**A. Complete trail.** New events:

| Event | Actor | When |
|---|---|---|
| `booking.released` | none (system) | `settle`: a no-show booking is released |
| `checkin.auto_ended` | none (system) | `settle`: a check-in reaches its end time |
| `booking.plan_changed` | the admin who published, unpublished or deleted the plan | `cancel_for_plan_change`: a booking is cancelled |
| `checkin.plan_changed` | the same admin | `cancel_for_plan_change`: a check-in is ended |
| `booking.auto_created` | the user | auto-booking created a booking |
| `insights.exported` | the admin | an Excel export was made |
| `desk_label.downloaded` | the admin | desk labels were downloaded |

- **Details:** system and desk events carry `seat_label`, `plan_name`, `user_name` and `date` in `details`, so they read well without joins.
- **Same transaction:** audit rows are added in the same transaction as the change they describe, via the helper `audit_row(...)`. `write_audit` stays as it is for request handlers.

**B. Names kept.**
- `audit_logs` gets an `actor_name` column (`sql/0023_audit_names_and_retention.sql`), filled at write time from the actor's full name.
- A deleted user's entries still read "by Jane Tan".

**C. Retention and indexes.**
- `AUDIT_RETENTION_DAYS` defaults to 365.
- Entries older than that are deleted when the Audit log page is loaded. There are no background jobs.
- New indexes: `(created_at desc)`, and a trigram-free `lower(actor_name)` index for the person filter.

## 1. Shared endpoint and the Audit log page

**Categories** (from the action prefix):

| Category | Prefixes |
|---|---|
| security | `auth`, `account`, `password_reset` |
| users | `user` |
| teams | `department` |
| floor_plans | `floorplan` |
| displays | `display` |
| desks | `booking`, `checkin` |
| exports | `insights`, `desk_label` |

**`GET /api/admin/audit`** (admins)
- **Filters:**
  - `category`
  - `actor` (user id)
  - `subject` (user id: they acted, or were acted on)
  - `target` (any id)
  - `q` (person name, action or details text)
  - `from` / `to` (Singapore dates)
  - `page` (newest first, 50 per page)
- **Returns:**
  - `items: [{id, at, actor_id, actor_name, action, category, target_id, target_name, details, summary}]`
  - `counts` per category for the same filters, ignoring the category filter itself
  - `total`
- **`summary`:** a readable sentence built on the server, for example "Published floor plan DF-L1 (v5)" or "Released booking F1 for Jane Tan (no check-in)".
- **`target_name`:** resolved for users, floor plans and displays, otherwise taken from details.

**`GET /api/admin/audit.xlsx`:** the same filters, up to 5,000 rows. It writes `insights.exported` with `kind: "audit"`.

**Page:** Administration → **Audit log** (`/audit`).
- **Strip:** category chips with counts and a colour per category. Security is red, configuration (users, teams, floor plans, displays) is blue, desks are green, exports are grey.
- **Filters:** search box, person (text), from/to dates, and Excel.
- **Table:** time, who, what (summary), target. The details expand in place.
- **Highlighting:** failed sign-ins and lockouts are tinted red.

## 2. Users and teams (Manage Users)

- **History tab:** the user's edit panel gets **Details** and **History** tabs. History is a timeline of `subject=<user>` entries: an icon, the summary and the time.
- **Security badges in the users table:**
  - "Last sign-in: <when>".
  - An amber "N failed sign-ins (7 days)" when N > 0.
  - A red "Locked" when the account was locked and not re-enabled (`failed_attempts` at the maximum).

  The users list returns `last_login_at` and `failed_logins_7d`.
- **Sign-in health strip:** at the top, from `GET /api/admin/audit/security-summary`: failed sign-ins today, locked accounts, and invitations not accepted (no password yet). Clicking a figure filters the table (locked or pending), or opens the Audit log for failed sign-ins.
- **Project teams changes:** a "Recent changes" disclosure under the teams table, showing the latest 10 team events.

## 3. Floor plans, displays and labels

- **Editor version history:** `GET /api/admin/floor-plans/<id>/history` returns:
  - `versions: [{version, published_at, published_by, elements}]`
  - `events`: this plan's audit entries, where consecutive `elements_saved` entries collapse into "N saves".

  The editor gets a **History** button that opens a stepper (v1 → vN), with unpublish and discard marked.
- **"Last change" lines:** the plans list and the displays list each return a `last_change: {summary, actor_name, at}` per item, shown as a small line.
- **Desk labels:** the downloads endpoint returns `{seat_id: {at, by}}`. Each label card's tooltip shows "Downloaded <date> by <name>".

## 4. Insights: booking funnel

**`GET /api/admin/insights/funnel?days=14`** returns:
- `days: [{date, booked, checked_in, released, cancelled, plan_changed, active}]`, by booking date.
- `teams: [{name, bookings, no_shows, rate}]` over the period. Team is the booked person's current project teams.
- `auto: {booked, used, unused}`, from `booking.auto_created`.

**Card:** "Bookings" sits above the occupancy row. It shows a stacked bar per day, a ranked no-show rate per team, and an auto-booking line.

## 5. Out of scope

Editing or deleting audit entries by hand, alerts, and a per-display history page.
