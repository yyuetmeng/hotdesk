# Public Floor Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-configured public displays (`/display/<slug>`) that show chosen published floors in style E with live seat states, initials, per-floor and overall capacity, and today's seat activity, refreshing every 30 seconds.

**Architecture:** New table `dashboard_displays` with admin CRUD (`/api/admin/displays`) and a public lookup (`/api/public/displays/<slug>`); the existing public floor endpoint gains a capacity `summary` and seat department names. Polling hardening in `settle()` and the "now" window. Frontend adds `src/display/` (TV page, style-E SVG renderer, capacity, seat popover) outside the signed-in shell, and an admin Displays page replacing the legacy Floor display.

**Tech Stack:** Flask 3, SQLAlchemy 2.0, PostgreSQL (tests on local Postgres); React 19 + Vite; inline SVG; `Intl.DateTimeFormat` with `Asia/Singapore`.

**Spec:** `docs/superpowers/specs/2026-10-15-floor-dashboard-design.md`

## Global Constraints

- Backend from `webapp-backend/` (`python -m pytest -q`, local Postgres only, one session at a time); frontend from `webapp-frontend/`.
- Schema only via idempotent `sql/0018_dashboard_displays.sql`, applied to the app DB as soon as it lands.
- Slug regex exactly `^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`; name 1–80 chars; layout `rotate | grid`; `rotate_seconds` 10–120 (default 20); `show_overall` default true.
- Capacity counts bookable (tagged) seats; `occupancy_pct = round(100 * occupied / bookable)` (0 when no bookable seats).
- Public responses: full names and initials only; today only.
- TV refresh every 30 s; times shown in Asia/Singapore as `dd/MM/yyyy HH:mm:ss` / `HH:mm:ss`.
- No new npm dependencies.

## Review Focus

1. **Two TVs settling the same expired booking at once:** neither request errors; the booking ends once. Test in Task 2.
2. **A seat held only for its last half hour** (same-day PM booked at 17:25 → 17:30–18:00): at 17:40 it shows **booked** publicly. Test in Task 2.
3. **A display listing a deleted or unpublished floor:** the floor is skipped/flagged, the display still loads. Test in Task 3.
4. **Duplicate or badly formed link name:** 409 / 400 with a field message. Test in Task 3.
5. **Network loss on the TV:** the last data stays with "Offline — last updated HH:mm:ss" and polling resumes. Manual check in Task 5 (logic in the page; no browser runner).

---

### Task 1: Displays table and model

**Files:** Create `webapp-backend/sql/0018_dashboard_displays.sql`, add `DashboardDisplay` to `webapp-backend/app/core/desk_models.py`; test `webapp-backend/tests/test_desk_schema.py`.

- [ ] **Step 1: Failing test** `test_display_slug_and_layout_constraints(db)`: valid row inserts; slug `"Office A"` / `"-a"` → IntegrityError; layout `"carousel"` → IntegrityError; duplicate slug → IntegrityError.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (DDL exactly spec §4). **Step 4: Run** schema tests → PASS.
- [ ] **Step 5: Apply 0018 to the app database.** **Step 6: Commit** `feat: add dashboard displays table`.

### Task 2: Polling hardening (settle, current block)

**Files:** Modify `webapp-backend/app/desk/service.py` (`settle`, `_window`); tests `tests/test_desk_public.py`.

- [ ] **Step 1: Failing tests:**
  - `test_seat_held_for_its_last_half_hour_shows_booked`: clock DAY 17:25, Jane books PM on F1 (17:30–18:00, release 17:55); clock 17:40 → `/api/public/floors/<plan>` seat F1 `state == "booked"`.
  - `test_settle_skips_rows_locked_by_another_request`: a booking due for release; a separate connection holds `select … for update` on that booking row; a public floor request at that time returns 200 promptly (no error), and after the lock is released the next request releases it.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement:** `_window(day, None, at)` starts at the current 30-minute boundary (`at` floored); `settle` selects due bookings/check-ins `with_for_update(skip_locked=True)` ordered by id, and on `OperationalError`/`IntegrityError` rolls back and returns.
- [ ] **Step 4: Run** desk tests → PASS. **Step 5: Commit** `fix: settle tolerates concurrent requests and shows the current block`.

### Task 3: Display API and floor summary

**Files:** Create `webapp-backend/app/admin/displays.py` (register in `app/admin/__init__.py`); modify `webapp-backend/app/public/routes.py` (display lookup; `summary`; seat `department` name); test `tests/test_displays.py`.

**Interfaces — Produces:** `GET/POST /api/admin/displays`, `PATCH/DELETE /api/admin/displays/<id>` → display DTO `{id, slug, name, plan_ids, show_overall, layout, rotate_seconds, floors: [{id, name, published}]}`; `GET /api/public/displays/<slug>` → same DTO (no ids of unknown plans; unpublished flagged); public floor adds `summary {bookable, available, booked, occupied, occupancy_pct}` and seat `department` (name, "Free for all", or null).

- [ ] **Step 1: Failing tests:** create/list/patch/delete as admin (audit rows); non-admin 403; slug format 400 and duplicate 409 (Review Focus 4); `rotate_seconds` 5 → 400; unknown plan id → 400; public display returns floors in order with `published` flags, a deleted plan dropped and an unpublished one flagged (Review Focus 3); unknown slug → 404; public floor `summary` counts (one available, one booked, one occupied, one untagged → bookable 3, occupancy 33) and seat `department` names.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `tests/test_displays.py` + desk tests → PASS.
- [ ] **Step 5: Commit** `feat: add admin displays and public display lookup with capacity`.

### Task 4: Display helpers (pure)

**Files:** Create `webapp-frontend/src/display/displayLogic.js`; test `webapp-frontend/scripts/smoke_display_logic.mjs`.

**Interfaces — Produces:** `overall(summaries) -> {bookable, available, booked, occupied, occupancy_pct}`; `nextFloorIndex(i, count) -> number`; `slugify(name) -> string` (matches the slug regex, max 40); `sgDateTime(iso|Date) -> 'dd/MM/yyyy HH:mm:ss'` and `sgTime(...) -> 'HH:mm:ss'` in Asia/Singapore.

- [ ] **Step 1: Smoke cases:** overall of two summaries (and zero bookable → 0%); rotation wraps; `slugify("Office A — Lobby!") === "office-a-lobby"`, empty → `"display"`; `sgTime("2026-10-16T01:02:03Z") === "09:02:03"` regardless of the machine time zone.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → `display logic smoke OK`. **Step 5: Commit** `feat: add display helpers`.

### Task 5: TV page with style-E floor drawing

**Files:** Create `src/display/FloorDrawing.jsx` (SVG: walls as thick strokes; doors with swing arc; windows as glass in the wall; tables/sofa/locker/plant icons; rooms boxed with icon + name; seats as state circles with chair icon + initials), `src/display/icons.js` (line icons: seat, table, sofa, locker, door, window, toilet, stairs, elevator, pantry, plant, corridor, wall), `src/display/CapacityBar.jsx`, `src/display/SeatPopover.jsx`, `src/display/DisplayPage.jsx`, `src/display/display.css`; modify `src/App.jsx` (route `/display/:slug` outside `RequireAuth`).

- [ ] **Step 1:** DisplayPage: load `/api/public/displays/<slug>`, then each published floor; poll every 30 s; keep last data on failure with "Offline — last updated …"; rotate/grid per config; ticking SG clock; overall capacity when enabled.
- [ ] **Step 2:** FloorDrawing renders from `elements` + `catalog` + `seats`; seat click → SeatPopover (seat, department, state, person, today's activity from `/api/public/seats/<id>/activity`), closes after 20 s or outside tap; rotation pauses while open.
- [ ] **Step 3: Verify** smoke scripts + `npm run build` green; manual: `/display/<slug>` in a browser, unplug network → offline note, reconnect → resumes (Review Focus 5).
- [ ] **Step 4: Commit** `feat: add public floor display for TVs`.

### Task 6: Admin Displays page

**Files:** Create `src/pages/displays/DisplaysPage.jsx`; modify `src/App.jsx` (route `/displays`, sidebar "Floor display" → `/displays`), remove `src/pages/floor-display/FloorDisplayPage.jsx` and its route `/display`.

- [ ] **Step 1:** List (name, link, floors, layout, Open, Copy link) and editor (name, slug prefilled via `slugify`, ordered floors from `/api/admin/floor-plans` with move up/down, overall toggle, layout, seconds), field errors from the API, delete with confirm.
- [ ] **Step 2: Verify** build green; manual create → open link.
- [ ] **Step 3: Commit** `feat: add admin page to configure floor displays`.

### Task 7: Docs and release gate

- [ ] **Step 1:** README (display endpoints, setup `0018_...`), spec status → Implemented.
- [ ] **Step 2:** Full backend suite → all pass; smoke scripts + build green.
- [ ] **Step 3: Commit** `docs: document floor displays`.
