# Seat Booking and Check-in — Design

**Date:** 2026-10-15 (revised with product owner's slot, release, visibility and activity decisions)
**Status:** Implemented 2026-10-15 (plan `docs/superpowers/plans/2026-10-15-seat-booking-and-checkin.md`)
**Scope:** Piece 3 of the seat booking programme (`2026-10-15-floorplan-publishing-design.md` §0). People book free-for-all seats for today or tomorrow in **AM / PM / Full day** slots built from **30-minute blocks**, for themselves or for named colleagues up to a per-user limit, and check in or give a seat up by scanning the seat's QR code. Every booking and check-in is stored. Seats show who booked or occupies them, and clicking a seat shows today's activity. New **Book a desk** and **Desk check-in** pages replace the legacy Node-backed ones. This piece also provides the public data endpoint the dashboard (piece 4) will use. Builds on published plans (piece 1) and seat department tags (piece 2).

## 1. Why and what success looks like

Teams sit on seats tagged with their department; shared **free-for-all** seats are booked or taken on the day. Success:
- A team member books free-for-all seats for today or tomorrow, for a morning, afternoon or whole day, for themselves and named colleagues, in a few clicks.
- On arrival a person scans the seat's QR code and is checked in; scanning again lets them give it up.
- Seat state is always right: booked seats are held for the right person and slot, no-shows free up after 30 minutes, nobody holds two seats at once.
- Anyone looking at a floor can see who is on (or booked for) a seat and, by clicking it, today's check-ins and check-outs — to identify the person.
- Every booking and check-in is kept with the context needed for statistics (piece 5).

## 2. Rules (product owner decisions, 2026-10-15)

### 2.1 Who may use a seat
- Seat tagged with a department/group → only members of that department (users can belong to several; any of them counts).
- Seat **free for all** → anyone.
- **Untagged** seat → nobody can book or check in.
- Only seats of **published** plans (the live version) can be booked or checked in to.
- Only active accounts within their access dates (start/end) can book, be booked for, or check in.

### 2.2 Time model: 30-minute blocks
- A day is divided into **30-minute blocks** (e.g. 08:00–08:30). Bookings and check-ins are expressed in block boundaries; this keeps custom times possible later.
- Booking **presets** offered now (configurable in backend config, not in the app):

  | Preset | Time | Blocks |
  |---|---|---|
  | **AM** | 08:00–13:00 | 10 |
  | **PM** | 13:00–18:00 | 10 |
  | **Full day** | 08:00–18:00 | 20 |

- All times are **Asia/Singapore**.

### 2.3 Booking
- Only **free-for-all** seats can be booked; department seats are walk-in only.
- Bookings are for **today or tomorrow**. A preset that has already ended cannot be booked; one in progress can be booked until 30 minutes before it ends (the booking then covers the remaining blocks).
- A seat's blocks can be booked by different people (e.g. AM by one, PM by another); a booking is refused if any of its blocks is already booked.
- A person can hold **one booking per block** (e.g. AM on seat A and PM on seat B is allowed; two bookings overlapping in time are not).
- Everyone can book **for themselves**; this does not count towards their limit.
- A person can also book for **named colleagues** who share at least one of their departments/groups, up to their **booking allowance** (0–20, default 0): the number of *different colleagues* per day (booking a colleague AM and PM counts once). 0 = cannot book for others.
- Only the **named person** can check in to a booked seat.
- **Cancelling:** the booker, the booked person or an admin, until the person checks in.
- No email is sent; bookings appear under **My bookings** for both booker and booked person.

### 2.4 Release of unclaimed bookings (no-shows)
A booking nobody has checked in to is **released** (its blocks free up for walk-ins and new bookings) at:
- **Booked before its slot starts:** AM → **08:30**, PM → **13:30**, Full day → **10:00**.
- **Booked after its slot has started** (same day): **30 minutes after the booking was made** (e.g. AM booked at 09:30 → released at 10:00; Full day booked at 09:00 → released at 09:30).

Released bookings keep their record (end reason "released").

### 2.5 Check-in and giving up a seat
- Scanning a seat's QR code opens its check-in page and **checks in automatically** if allowed: the person may use the seat (2.1) and it is either available now or booked for them within their check-in window (2.6).
- Scanning again while checked in there shows **Give up seat**; a tap ends the check-in and frees the seat. Applies to every seat (department and free for all).
- One active check-in per person: checking in elsewhere while checked in is refused ("Give up your seat at {seat} first").
- **Automatic end:**
  - a check-in made against a booking ends at the booking's end (AM 13:00; PM / Full day 18:00);
  - a walk-in ends at the start of the next booked block on that seat (e.g. walk-in at 09:00 on a seat booked for PM ends at 13:00, so the PM person can check in), otherwise at **18:00**;
  - a check-in made after 18:00 ends at midnight.
- A walk-in on a seat with a later booking sees a warning: "Booked from 13:00".
- A booked person who gives the seat up cannot reuse the rest of that booking; the blocks free up.

### 2.6 Check-in against a booking
- The booked person can check in from **30 minutes before** their booking starts until it is released (e.g. AM from 07:30).
- If someone else holds a walk-in check-in on the seat when a booking starts, that walk-in has already ended automatically (2.5).

### 2.7 Plan changes
- If a plan is unpublished, or a booked seat is deleted, retagged away from free for all, or missing from a newly published version, its today/tomorrow bookings are **cancelled** (reason "plan changed") and active check-ins on it end. They show as cancelled in My bookings.

### 2.8 Who can see what (product owner: "to aid identifying the person")
- On a floor view, an **occupied** seat shows who is checked in; a **booked** seat shows who it is booked for (and who booked it, if someone else). The seat shows the person's **initials**; hovering or clicking shows the full name.
- **Clicking a seat** opens its **activity for today**: check-ins, check-outs (given up / ended), bookings made, cancelled and released, each with time (`HH:mm:ss`) and names, e.g. "09:02:14 Jane Tan checked in (booked by Ali Rahman)".
- This is shown **publicly** on the dashboard (piece 4, no sign-in) and to signed-in users on Book a desk. **Only today** is shown; past days are never exposed publicly (they remain stored for statistics).
- Shown fields: full name only (no email, username or department of the person).

## 3. Seat state at a moment

Computed for the **current** time (or, on Book a desk, for the chosen date and slot):

| State | Meaning |
|---|---|
| **occupied** | an active check-in on this seat now |
| **booked** | an active, unreleased booking covers the current block (or the chosen slot) and nobody has checked in |
| **available** | usable now (tagged), no active check-in, no booking on the current block / chosen slot |
| **not bookable** | untagged |

Responses for signed-in users also say what they may do: `can_book` (per preset), `can_check_in`, `can_give_up`.

## 4. Data model (builder's call)

New script `sql/0017_seat_booking.sql` (idempotent):

- `users.booking_allowance smallint not null default 0 check (booking_allowance between 0 and 20)`.
- `seat_bookings` (one row per booking; never deleted): `id`, `plan_id`, `version_id` (published at booking time), `seat_id` (= permanent element id), `seat_label` (snapshot), `booking_date date`, `starts_at`, `ends_at` (timestamptz on 30-minute boundaries), `preset` (`'am' | 'pm' | 'full'`, nullable for future custom ranges), `booked_for` (FK users), `booked_by` (FK users, set null), `created_at`, `release_at` (computed by the rules in 2.4 when created), `ended_at`, `end_reason` (`'checked_in' | 'cancelled' | 'released' | 'plan_changed'`), `cancelled_by`.
- `seat_booking_blocks` (the 30-minute blocks an **active** booking holds): `booking_id` (FK, cascade), `seat_id`, `block_start timestamptz`, `booked_for`; **unique `(seat_id, block_start)`** and **unique `(booked_for, block_start)`** — the database refuses overlapping bookings on a seat and double-booking a person. Blocks are deleted when a booking is cancelled, released or ends; the booking row stays.
- `seat_checkins` (never deleted): `id`, `plan_id`, `version_id`, `seat_id`, `seat_label`, `user_id`, `checked_in_at`, `ends_at` (the automatic end per 2.5), `checked_out_at`, `end_reason` (`'given_up' | 'auto' | 'plan_changed'`), `booking_id` (nullable), `method` (`'walk_in' | 'booking'`), snapshots for statistics: `seat_department_id`, `seat_open_to_all`, `user_department_ids uuid[]`.
  - **Active** = `checked_out_at is null and now() < ends_at`. A partial unique index on open check-ins per seat and per user, plus the end-time rule, prevents double occupancy.
- **No scheduler:** releases and automatic ends are applied by a single `settle(now)` step at the start of every booking/check-in/floor request: it ends bookings whose `release_at` has passed (deleting their blocks, end reason "released") and stamps `checked_out_at = ends_at` for check-ins past their end (end reason "auto").
- Config: `BOOKING_TIMEZONE=Asia/Singapore`, presets and release times as in 2.2 / 2.4.

## 5. API (Flask)

Signed-in, prefix `/api/desk` (Vite proxies `/api/desk` to Flask; the legacy Node service owns `/api/seats`):

| Endpoint | Purpose |
|---|---|
| `GET /api/desk/floors` | Published plans (id, name, version). |
| `GET /api/desk/floors/<plan_id>?date=&preset=` | Published layout + per-seat state for today/tomorrow and the chosen preset (default: now), occupant/booking names and initials, and the user's `can_*`. |
| `POST /api/desk/bookings` `{plan_id, seat_id, date, preset, user_id?}` | Book (default for yourself). Clear errors per rule in 2.3. |
| `GET /api/desk/bookings/mine` | My bookings and those I made for others (today/tomorrow), with state and end reason. |
| `DELETE /api/desk/bookings/<id>` | Cancel (booker, booked person, admin; before check-in). |
| `GET /api/desk/colleagues?q=&date=` | People I may book for (shared departments, active), with allowance used/left for the date. |
| `GET /api/desk/seats/<seat_id>` | Seat info for the check-in page (plan, label, department, state, next booking, what I may do). |
| `POST /api/desk/seats/<seat_id>/check-in` | Check in (walk-in or my booking). |
| `POST /api/desk/seats/<seat_id>/give-up` | End my active check-in on this seat. |
| `GET /api/desk/seats/<seat_id>/activity` | Today's activity for the seat (2.8). |
| `GET /api/desk/me` | My active check-in, if any. |

Public, no sign-in (for the dashboard, piece 4):

| Endpoint | Purpose |
|---|---|
| `GET /api/public/floors` and `GET /api/public/floors/<plan_id>` | Published plans and current seat states with occupant/booked-for names and initials — **today only**. |
| `GET /api/public/seats/<seat_id>/activity` | Today's activity for the seat. |

Admin: Manage Users gains **"Can book for others"** (0–20) via `PATCH /api/admin/users/<id>` (`booking_allowance`; returned by `public_user`). The editor gains **Print QR codes** for a published plan.

Audit: `booking.create`, `booking.cancel`, `checkin.start`, `checkin.end`.

## 6. Pages (frontend)

- **Book a desk** (`/book`, replaces the legacy page): Today / Tomorrow, **AM / PM / Full day**, floor picker, read-only floor plan with seats coloured by state for the chosen slot (green / amber / red / grey) and initials; clicking a seat shows its details and today's activity, and for an available free-for-all seat **Book for me** and, if the allowance is above 0, **Book for a colleague** (search, "x of N colleagues used today"). **My bookings** with Cancel.
- **Desk check-in** (`/checkin/:seatId`, from the QR code): seat, floor, department, state, next booking; checks in automatically when allowed ("You're checked in at {seat} since {HH:mm:ss}, until {HH:mm}"); **Give up seat** button when checked in there; a clear reason when not allowed. `/checkin` without a seat shows my current check-in.
- **Sign-in from a QR code** returns to the scanned seat's page.
- **Print QR codes** (`/floor-plans/:id/qr`, admins): A4 labels, one per seat of the published version (QR = `{origin}/checkin/{seat_id}`, seat label or "Seat x,y", plan name).
- **Manage Users:** "Can book for others" field (0–20).
- Formats: `dd/MM/yyyy`, `HH:mm:ss` (`docs/CODING_GUIDELINES.md` §1).

## 7. Non-goals and anti-goals

**Non-goals:** the public dashboard page itself (piece 4 — this piece provides its endpoints); statistics pages (piece 5); custom booking times in the UI (the block model allows them later); recurring bookings; booking beyond tomorrow; email/push notifications; admin screens for bookings beyond cancel; the legacy home "Floor plan" and "Floor display" pages.

**Anti-goals:** two people holding the same seat at the same time; a person holding two seats at once; a booked seat lost to a walk-in during its booking; a scan that accidentally gives a seat up (giving up needs a tap); exposing anything but today's names publicly, or anything beyond full names.

## 8. Testing

- Backend (local PostgreSQL, injectable clock): presets → blocks; overlap refusal per seat and per person; allowance counted per distinct colleague per day; shared-department rule; release times for all cases in 2.4 (including the three worked examples); walk-in auto-end at the next booked block; booked check-in window; one active check-in; give-up; plan unpublish/retag cancels; settle step idempotent; public endpoints return today only and no emails/usernames; Manage Users allowance field.
- Frontend: smoke tests for pure state/time helpers; build; manual check scanning a printed QR code with a phone.

## 9. Builder's calls (to confirm while reading)

1. 30-minute blocks are rows (`seat_booking_blocks`) with unique `(seat, block)` and `(person, block)`, so the database itself refuses overlaps.
2. Releases and automatic ends happen in a `settle(now)` step on each request — no background job.
3. Booked people can check in from 30 minutes before their booking starts.
4. Walk-ins end automatically at the next booked block (or 18:00; after 18:00, at midnight).
5. A preset in progress can be booked until 30 minutes before it ends.
6. The "book for others" allowance counts distinct colleagues per day.
7. Initials on seats, full name on hover/click; no emails or usernames in any seat view.
8. Check-in on scan is automatic; giving up needs a tap.
9. New prefixes `/api/desk` (signed in) and `/api/public` (dashboard); legacy Book a desk / Desk check-in pages are removed from the frontend, the Node service is untouched.
10. QR codes generated in the browser with a small pinned npm package; they contain only the seat link.
11. Booking someone already checked in elsewhere is allowed; they give up the other seat before checking in.
