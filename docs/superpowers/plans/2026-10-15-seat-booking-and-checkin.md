# Seat Booking and Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Book free-for-all seats in AM/PM/Full-day presets of 30-minute blocks for today or tomorrow (self + named colleagues up to an allowance), check in / give up by QR scan, with releases, automatic ends, today's seat activity and names, public read endpoints, QR printing, and new Book a desk / Desk check-in pages.

**Architecture:** New Flask blueprints `app/desk/` (`/api/desk`, signed-in) and `app/public/` (`/api/public`, no auth) over new tables (`seat_bookings`, `seat_booking_blocks`, `seat_checkins`, `users.booking_allowance`). Pure time rules live in `app/desk/rules.py` (unit-tested without a database); a `settle(now)` step applies releases and automatic ends on every desk/public request. Frontend adds `src/desk/` (read-only floor view, Book a desk, check-in, QR sheet) and removes the legacy Node-backed pages.

**Tech Stack:** Flask 3, SQLAlchemy 2.0 ORM, PostgreSQL (tests on local Postgres via `TEST_DATABASE_URI`), `zoneinfo`; React 19 + react-router 7 + Vite; npm `qrcode@1.5.4` (pinned).

**Spec:** `docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md`

## Global Constraints

- Backend commands from `webapp-backend/` (`python -m pytest -q`, local PostgreSQL only, never two sessions at once); frontend from `webapp-frontend/`.
- Schema only via new idempotent `sql/0017_seat_booking.sql`; apply it to the app database right after it lands (the dev Flask auto-reloads).
- Time zone exactly `Asia/Singapore` (config `BOOKING_TIMEZONE`); block length 30 minutes; presets `am` 08:00–13:00, `pm` 13:00–18:00, `full` 08:00–18:00 (config `BOOKING_PRESETS`).
- Release rules exactly spec §2.4; automatic ends exactly spec §2.5; check-in window spec §2.6.
- The current time comes only from `app.desk.rules.now()` (tests monkeypatch it); never call `datetime.now()` elsewhere in desk code.
- Public responses contain full names and initials only — never email, username or departments of people; today only.
- Prefixes: `/api/desk`, `/api/public` (Vite proxies both to Flask).
- Displayed times `HH:mm:ss`, dates `dd/MM/yyyy` (`src/format.js`).
- Every booking/check-in row is kept (no deletes); deleting a user keeps rows with the user set null and a name snapshot.

## Review Focus

1. **Booking a preset already in progress near its end:** the booking starts at the next 30-minute boundary; AM booked at 12:20 covers 12:30–13:00 (allowed, 30 minutes remain) and at 12:45 is refused ("too late to book AM"). Test in Task 2.
2. **Exactly at the release minute** (08:30:00 for AM booked earlier): the booking is released (release is `now >= release_at`). Test in Task 3.
3. **Booked person arrives early while a walk-in sits there:** early check-in (from 30 min before) is refused with "occupied until 13:00"; at the booking start the walk-in has ended and the booked person can check in. Test in Task 4.
4. **Deleting a user who has bookings/check-ins:** rows stay (user set null, name snapshot), statistics not lost, seat activity still shows the name. Test in Task 1.
5. **Midnight boundary:** a booking for "tomorrow" made at 23:59 SG is for the next date, and at 00:01 that date is "today" (no UTC date drift). Test in Task 2.

---

### Task 1: Schema and models

**Files:** Create `webapp-backend/sql/0017_seat_booking.sql`, `webapp-backend/app/core/desk_models.py`; modify `app/core/auth_models.py` (`User.booking_allowance`), `app/core/orm.py` (import `desk_models` in `init_orm`); test `tests/test_desk_schema.py`.

**Interfaces — Produces:** `SeatBooking`, `SeatBookingBlock`, `SeatCheckin` ORM models with the columns in spec §4 plus `booked_for_name`, `booked_by_name` (bookings) and `user_name` (check-ins) snapshots; `booked_for`/`booked_by`/`user_id` are nullable FKs `on delete set null`; `User.booking_allowance: int`.

- [ ] **Step 1: Failing tests:** `test_booking_blocks_unique_per_seat_and_person` (two blocks with the same `(seat_id, block_start)` → IntegrityError; same `(booked_for, block_start)` → IntegrityError); `test_booking_allowance_range` (`booking_allowance = 21` → IntegrityError; default 0); `test_deleting_user_keeps_booking_and_checkin_rows` (Review Focus 4: rows remain with `booked_for` / `user_id` null and name snapshots intact).
- [ ] **Step 2: Run** `python -m pytest -q tests/test_desk_schema.py` → FAIL.
- [ ] **Step 3: Write `0017`** (tables, partial unique index on open check-ins `(seat_id) where checked_out_at is null` and `(user_id) where checked_out_at is null`, check constraint on allowance) **and the models**.
- [ ] **Step 4: Run** the file and `tests/test_floorplan_schema.py tests/test_sql_schema.py` → PASS.
- [ ] **Step 5: Apply `0017` to the app database** (one transaction); verify the tables.
- [ ] **Step 6: Commit** `feat: add seat booking and check-in tables`.

### Task 2: Time rules (pure)

**Files:** Create `webapp-backend/app/desk/__init__.py` (blueprint `desk_bp`, prefix `/api/desk`), `webapp-backend/app/desk/rules.py`; modify `app/core/config.py` (`BOOKING_TIMEZONE`, `BOOKING_PRESETS`); test `tests/test_desk_rules.py` (no database fixtures).

**Interfaces — Produces** (all times timezone-aware; `day` is a `date` in Singapore):
- `now() -> datetime` (UTC-aware; monkeypatch target)
- `local_today(at: datetime) -> date`; `bookable_days(at) -> tuple[date, date]` (today, tomorrow)
- `preset_range(day, preset, at) -> tuple[datetime, datetime]` — full preset range, or from the next 30-minute boundary at/after `at` when in progress; raises `BookingRuleError("too late to book {AM|PM|Full day}")` when fewer than 30 minutes remain or the preset ended; `BookingRuleError("bookings are for today or tomorrow")` for other days.
- `blocks(starts, ends) -> list[datetime]` (30-minute starts)
- `release_at(preset, starts_at, created_at, preset_start) -> datetime` — spec §2.4 (`am` start+30, `pm` start+30, `full` 10:00; booked after the preset started → `created_at + 30 min`).
- `checkin_window_opens(starts_at) -> datetime` (starts − 30 min)
- `walk_in_ends_at(at, next_booked_block_start | None) -> datetime` (next booked block, else 18:00 that day, else midnight if `at` ≥ 18:00)
- `class BookingRuleError(ValueError)`

- [ ] **Step 1: Failing tests:** presets map to 10/10/20 blocks; spec worked examples (AM booked 09:30 → release 10:00; full day booked 09:00 → 09:30; PM booked in the morning → 13:30; AM booked the day before → 08:30; full day booked the day before → 10:00); AM at 12:20 → range 12:30–13:00 and at 12:45 → "too late to book AM" (Review Focus 1); day after tomorrow refused; 23:59 SG "tomorrow" is the next date and at 00:01 it is today (Review Focus 5); walk-in at 09:00 with a booked block at 13:00 → ends 13:00, without → 18:00, at 19:00 → midnight.
- [ ] **Step 2: Run** `python -m pytest -q tests/test_desk_rules.py` → FAIL.
- [ ] **Step 3: Implement** `rules.py` with `zoneinfo.ZoneInfo(Config.BOOKING_TIMEZONE)`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: add booking time rules`.

### Task 3: Bookings — settle, floors, book, cancel, mine, colleagues

**Files:** Create `webapp-backend/app/desk/service.py` (settle, seat states, booking ops), `webapp-backend/app/desk/routes.py`; modify `app/__init__.py` (register `desk_bp`); test `tests/test_desk_bookings.py`.

**Interfaces:**
- Consumes: Task 1 models, Task 2 rules, published versions (`FloorPlan.published_version`, version elements with `department_id`, `open_to_all`), `auth_required`.
- Produces: `settle(at) -> None`; `seat_states(plan, day, preset | None, at, viewer: User | None) -> list[dict]` with per seat `{id, label, state, department_id, open_to_all, occupant: {name, initials} | None, booking: {id, booked_for: {name, initials}, booked_by: {name} | None, starts_at, ends_at} | None, next_booking_at, can_book: {am, pm, full}, can_check_in, can_give_up}` (viewer-dependent fields only when `viewer`); `create_booking(viewer, plan_id, seat_id, day, preset, for_user_id) -> SeatBooking`; `cancel_booking(viewer, booking_id)`; endpoints per spec §5 (`/floors`, `/floors/<id>`, `/bookings`, `/bookings/mine`, `/bookings/<id>` DELETE, `/colleagues`).

- [ ] **Step 1: Failing tests** (monkeypatch `rules.now`; seed a published plan with a free-for-all seat, a department seat and an untagged seat; users in departments): book AM for self → 201, blocks 10; second booking of overlapping AM on the same seat → 409; same person PM on another seat → 201, AM on another seat → 409; department or untagged seat → 400; booking for a colleague without allowance → 403, with allowance 1 → 201, a second distinct colleague → 403 "allowance used", same colleague PM → 201; colleague outside shared departments → 403; inactive colleague → 400; cancel by booker / booked person / admin → 204, by a stranger → 403, after check-in → 409; release at exactly 08:30 → seat `available` and booking end reason `released` (Review Focus 2); unpublished plan → 404 on floors; `/bookings/mine` lists both directions.
- [ ] **Step 2: Run** `python -m pytest -q tests/test_desk_bookings.py` → FAIL.
- [ ] **Step 3: Implement.** `settle(at)` first in every desk/public handler; booking creates the row + one block row per 30 minutes inside one transaction; `IntegrityError` on blocks → 409 "seat or person already booked for that time".
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: book seats in 30-minute blocks with AM/PM/full-day presets`.

### Task 4: Check-in, give up, activity

**Files:** Modify `app/desk/service.py`, `app/desk/routes.py`; test `tests/test_desk_checkins.py`.

**Interfaces — Produces:** `check_in(viewer, seat_id) -> SeatCheckin`; `give_up(viewer, seat_id)`; `seat_activity(seat_id, day) -> list[{at, kind, text}]` with kinds `checked_in`, `gave_up`, `ended`, `booked`, `cancelled`, `released`; endpoints `GET /seats/<id>`, `POST /seats/<id>/check-in`, `POST /seats/<id>/give-up`, `GET /seats/<id>/activity`, `GET /me`.

- [ ] **Step 1: Failing tests:** walk-in on own department seat → 201, `ends_at` 18:00; on another department's seat → 403; on untagged → 403; walk-in on a free seat booked from 13:00 → 201 with `ends_at` 13:00 and warning; booked person checks in inside window (07:30–release) → `method = booking`, booking end reason `checked_in`; a third person on a booked seat → 403; second check-in elsewhere while active → 409 "Give up your seat at …"; give up → seat available, `end_reason = given_up`; early check-in while a walk-in sits there → 409 "occupied until 13:00", then at 13:00 → 201 (Review Focus 3); auto end recorded by settle at `ends_at`; activity lists check-in/give-up/booking events with names, today only; snapshots (`seat_department_id`, `user_department_ids`) stored.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest -q tests/test_desk_checkins.py tests/test_desk_bookings.py` → PASS.
- [ ] **Step 5: Commit** `feat: check in and give up seats with automatic ends and activity`.

### Task 5: Plan changes and public endpoints

**Files:** Create `webapp-backend/app/public/__init__.py` (`public_bp`, `/api/public`), `app/public/routes.py`; modify `app/admin/floorplan_publishing.py` (after publish/unpublish call `cancel_for_plan_change(plan)`), `app/__init__.py`; test `tests/test_desk_public.py`.

**Interfaces:** Consumes `seat_states(..., viewer=None)`, `seat_activity`; Produces `cancel_for_plan_change(plan, at) -> int` and public endpoints per spec §5.

- [ ] **Step 1: Failing tests:** unpublish cancels today/tomorrow bookings (`plan_changed`) and ends active check-ins; republish without a booked seat, or retagging it away from free for all, cancels its bookings; public floor shows names + initials, no `email`/`username` keys anywhere in the JSON; public activity today only (an event dated yesterday is absent); public endpoints need no token.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: cancel bookings on plan changes and add public floor endpoints`.

### Task 6: Booking allowance in Manage Users

**Files:** Modify `app/admin/users.py` (`PATCHABLE` + validation 0–20), `app/core/users.py` (`public_user` adds `booking_allowance`), `webapp-frontend/src/pages/users/UsersPage.jsx` (number field "Can book for others (0–20)"); test `tests/test_admin_users.py`.

- [ ] **Step 1: Failing tests:** PATCH `booking_allowance` 5 → 200 and returned; 21 / -1 / "x" → 400 `fields.booking_allowance`; default 0 on create.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** backend + field. **Step 4: Run** `python -m pytest -q tests/test_admin_users.py` → PASS; `npm run build` green.
- [ ] **Step 5: Commit** `feat: set how many colleagues a user can book for`.

### Task 7: Frontend — floor view and Book a desk

**Files:** Create `webapp-frontend/src/desk/deskLogic.js` (pure: `initials(name)`, `stateLabel`, `presetLabel`, `canBookAny(seat)`), `src/desk/FloorView.jsx` (read-only grid reusing `palette.js` sizes/catalog; seat colours by state; initials; click callback), `src/desk/SeatPanel.jsx` (details + today's activity + book actions), `src/desk/BookDeskPage.jsx`, `src/desk/desk.css`; modify `src/App.jsx` (route `/book` → new page), `vite.config.js` (proxy `/api/desk`, `/api/public`); delete `src/pages/book-desk/BookDeskPage.jsx`; test `scripts/smoke_desk_logic.mjs`.

- [ ] **Step 1: Smoke tests** for `initials` ("Jane Tan" → "JT", "Prince" → "P", "  " → "?"), `presetLabel`, `canBookAny`.
- [ ] **Step 2: Run** `node scripts/smoke_desk_logic.mjs` → FAIL. **Step 3: Implement** helpers, then the page (Today/Tomorrow, AM/PM/Full day, floor picker, FloorView, SeatPanel with Book for me / Book for a colleague (search `/api/desk/colleagues`, "x of N colleagues used"), My bookings with Cancel).
- [ ] **Step 4: Run** smoke → OK; `npm run build` green.
- [ ] **Step 5: Commit** `feat: add Book a desk page on published floor plans`.

### Task 8: Frontend — check-in, sign-in return, QR printing

**Files:** Create `src/desk/CheckInPage.jsx`, `src/desk/QrSheetPage.jsx`; modify `src/App.jsx` (routes `/checkin`, `/checkin/:seatId`, `/floor-plans/:id/qr`), `src/auth.jsx` (`RequireAuth` passes `state.from`), `src/pages/login/LoginPage.jsx` (navigate to `state.from` after sign-in), `src/floorplan/EditorPage.jsx` (**Print QR codes** button when published), `package.json` (`"qrcode": "1.5.4"`); delete `src/pages/desk-check-in/DeskCheckInPage.jsx`.

- [ ] **Step 1:** Check-in page: load `GET /api/desk/seats/:id`; if `can_check_in`, POST check-in once (guarded against double effects in StrictMode) and show "You're checked in at {seat} since {HH:mm:ss}, until {HH:mm}"; if `can_give_up`, show **Give up seat**; else the reason. `/checkin` shows `GET /api/desk/me`.
- [ ] **Step 2:** Sign-in return: opening `/checkin/abc` signed out → login → back to `/checkin/abc`.
- [ ] **Step 3:** QR sheet: one label per seat of the published version, QR of `${window.location.origin}/checkin/${seat.id}`, label, plan name; print CSS for A4.
- [ ] **Step 4: Verify** `npm install`, smoke scripts, `npm run build` green; manual: print a label, scan with a phone on the same network.
- [ ] **Step 5: Commit** `feat: add QR check-in page and printable seat QR codes`.

### Task 9: Docs and release gate

**Files:** Modify `webapp-backend/README.md` (desk + public endpoints, setup `0017_...`), `docs/CODING_GUIDELINES.md` (time source rule), spec status → Implemented.

- [ ] **Step 1:** Docs. **Step 2:** `python -m pytest -q` (full suite) → all pass; frontend smoke + build green. **Step 3: Commit** `docs: document seat booking and check-in`.
