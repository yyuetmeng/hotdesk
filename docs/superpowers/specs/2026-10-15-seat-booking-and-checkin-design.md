# Seat Booking and Check-in — Design

**Date:** 2026-10-15
**Status:** For approval
**Scope:** Piece 3 of the seat booking programme (`2026-10-15-floorplan-publishing-design.md` §0). People book free-for-all seats for today or tomorrow, for themselves or for named colleagues up to a per-user limit, and check in or give a seat up by scanning the seat's QR code. Every booking and check-in is stored for statistics. New **Book a desk** and **Desk check-in** pages replace the legacy Node-backed ones. Builds on published floor plans (piece 1) and seat department tags (piece 2).

## 1. Why and what success looks like

Teams sit on seats tagged with their department; shared **free-for-all** seats are booked in advance or taken on the day. Success:
- A team member books tomorrow's free-for-all seats for themselves and named colleagues in a few clicks.
- On arrival, a person scans the QR code on their seat and is checked in; on leaving a free-for-all seat (or any seat) they scan again to give it up.
- Seat state is always right: booked seats are held for the right person, no-shows free up, nobody holds two seats.
- Every booking and check-in is kept with the context needed later for usage statistics (piece 5).

## 2. Rules (product owner decisions, 2026-10-15)

**Who may use a seat**
- Seat tagged with a department/group → only members of that department (users can belong to several; any of them counts).
- Seat **free for all** → anyone.
- **Untagged** seat → nobody can book or check in.
- Only seats of **published** plans (the live version) can be booked or checked in to.

**Booking**
- Only **free-for-all** seats can be booked. Department seats are walk-in only.
- Bookings are for **today or tomorrow** (Singapore time). Booking opens any time; tomorrow's seats can be booked until midnight today.
- Everyone can book **one seat for themselves** per day; this does not count towards their limit.
- A person can also book for **named colleagues**: up to their **booking allowance** (0–20, default 0) per day. 0 = cannot book for others.
- They can book only for colleagues who share at least one of their departments/groups.
- **One booking per person per day** and **one booking per seat per day**; a second booking for the same person or seat is refused.
- Only the **named person** can check in to a booked seat.
- **No-shows:** a booking not checked in by **10:00** on its day is released; the seat becomes available for walk-ins. A same-day booking made at or after 10:00 is held for **1 hour** from when it was made (*builder's call, see §9*).
- **Cancelling:** the booker, the booked person, or an admin can cancel, until the person checks in.
- No email is sent (email delivery is not set up); bookings appear under **My bookings** for both the booker and the booked person.

**Check-in and giving up a seat**
- Scanning a seat's QR code opens that seat's check-in page; if the person may use the seat and it is available (or booked for them), they are **checked in**. The seat turns **occupied** for the rest of the day.
- Scanning the seat again while checked in there offers **Give up seat**; giving up frees the seat (it turns available again) and ends that check-in. This applies to **all seats** (department and free for all).
- One active check-in per person: scanning another seat while checked in elsewhere is refused with "Give up your seat at {seat} first".
- Check-ins not given up end automatically at **midnight**.
- A booked person who gives the seat up cannot reuse the booking later that day; the seat goes back to walk-ins.

**Plan changes**
- If a plan is unpublished, or a booked seat is deleted, retagged away from free for all, or its plan republished without it, the affected **future/today bookings are cancelled** (reason "plan changed") and show as cancelled in My bookings. Active check-ins on such seats end.

## 3. Seat state for a day (used by Book a desk, check-in and the dashboard in piece 4)

| State | Meaning |
|---|---|
| **occupied** | someone has an active check-in on this seat today |
| **booked** | an active (not cancelled, not released) booking exists for this seat and day, not yet checked in |
| **available** | usable (tagged), no active check-in, no active booking |
| **not bookable** | untagged |

Each seat in an API response also tells the signed-in user what they may do: `can_book` (free-for-all, available, date today/tomorrow, own or allowance), `can_check_in`, `can_give_up`.

## 4. Data model (builder's call)

New script `sql/0017_seat_booking.sql` (idempotent):

- `users.booking_allowance smallint not null default 0 check (booking_allowance between 0 and 20)`.
- `seat_bookings`: `id`, `plan_id` (FK floor_plans, cascade), `seat_id` (= permanent element id), `version_id` (published version at booking time), `booking_date date`, `booked_for` (FK users, cascade), `booked_by` (FK users, set null), `created_at`, `cancelled_at`, `cancelled_by`, `cancel_reason` (`'user' | 'admin' | 'plan_changed'`), `seat_label` (snapshot).
  - Partial unique indexes where `cancelled_at is null`: `(seat_id, booking_date)` and `(booked_for, booking_date)`.
  - "Released" (no-show) is **derived** from the booking time and the release rule, not stored, so it needs no scheduler.
- `seat_checkins`: `id`, `plan_id`, `seat_id`, `version_id`, `user_id` (FK users, cascade), `checkin_date date` (Singapore date), `checked_in_at`, `checked_out_at` (null while active), `end_reason` (`'given_up' | 'end_of_day' | 'plan_changed'`; end of day is derived when reading an old row and written lazily), `booking_id` (FK seat_bookings, nullable), `method` (`'walk_in' | 'booking'`), snapshots for statistics: `seat_department_id`, `seat_open_to_all`, `user_department_ids uuid[]`, `seat_label`.
  - Partial unique indexes on active check-ins (`checked_out_at is null`): `(seat_id, checkin_date)` and `(user_id, checkin_date)` — the database itself refuses double occupancy and double check-in.
- Records are never deleted by normal use (statistics); cancelling and giving up set timestamps.
- All "today", "tomorrow" and 10:00 calculations use **Asia/Singapore** (`BOOKING_TIMEZONE`, `NO_SHOW_RELEASE_TIME=10:00` in config).

## 5. API (Flask, prefix `/api/desk`, signed-in users; Vite proxies `/api/desk` to Flask)

| Endpoint | Purpose |
|---|---|
| `GET /api/desk/floors` | Published plans (id, name, published version). |
| `GET /api/desk/floors/<plan_id>?date=YYYY-MM-DD` | Published layout + per-seat state for the date (today/tomorrow) + `can_book` / `can_check_in` / `can_give_up` for the current user; booked seats show who they are booked for only to the booker, the booked person and admins. |
| `POST /api/desk/bookings` `{plan_id, seat_id, date, user_id?}` | Book (default: for yourself). Errors: not free for all, not available, date not today/tomorrow, person already has a booking, allowance used up, colleague not in a shared department. |
| `GET /api/desk/bookings/mine` | Today's and tomorrow's bookings for me and made by me, with state (active / checked in / released / cancelled + reason). |
| `DELETE /api/desk/bookings/<id>` | Cancel (booker, booked person, admin; before check-in). |
| `GET /api/desk/colleagues?q=` | People the current user may book for (shared departments), with whether they already have a booking for the date. |
| `GET /api/desk/seats/<seat_id>` | Seat info for the check-in page: plan, label, department, state, and what the user may do. |
| `POST /api/desk/seats/<seat_id>/check-in` | Check in (walk-in or own booking). |
| `POST /api/desk/seats/<seat_id>/give-up` | End my active check-in on this seat. |
| `GET /api/desk/me` | My active check-in today, if any. |

Admin: Manage Users edit form gains **"Can book for others"** (0–20) via the existing `PATCH /api/admin/users/<id>` (`booking_allowance`); `public_user` returns it. The floor plan editor gains **Print QR codes** for a published plan.

Audit: `booking.create`, `booking.cancel`, `checkin.start`, `checkin.end` (actor, seat, plan, booked_for where relevant).

## 6. Pages (frontend)

- **Book a desk** (`/book`, replaces the legacy page): Today / Tomorrow switch, floor picker, read-only floor plan with seats coloured by state (green available, amber booked, red occupied, grey not bookable; free-for-all vs department marked as in the editor). Clicking an available free-for-all seat opens a panel: **Book for me**, and — if the user's allowance is above 0 — **Book for a colleague** with a search box and "x of N bookings for others used". **My bookings** lists my bookings and the ones I made for others, with Cancel.
- **Desk check-in** (`/checkin/:seatId`, opened by the QR code): seat name, floor, department, state. Scanning **checks in automatically** when allowed and shows "You're checked in at {seat} since {HH:mm:ss}". If already checked in there: a **Give up seat** button. If not allowed: the reason (e.g. "This seat is for Engineering", "Booked for someone else until 10:00", "Give up your seat at A3 first"). `/checkin` without a seat shows my current check-in and how to scan.
- **Sign-in from a QR code** returns to the scanned seat's page after signing in.
- **Print QR codes** (`/floor-plans/:id/qr`, admins): A4 sheet of labels, one per seat of the published version, each with the QR code (link `{origin}/checkin/{seat_id}`), seat label (or "Seat x,y") and plan name.
- **Manage Users:** "Can book for others" number field (0–20).
- Dates and times use `formatDate` / `formatDateTime` (`dd/MM/yyyy`, `HH:mm:ss`).

## 7. Goals, non-goals, anti-goals

**Non-goals:** the public dashboard (piece 4); statistics pages (piece 5); email or push notifications; recurring bookings; booking more than one day ahead; admin screens for today's bookings/check-ins (beyond cancel via API); the legacy home "Floor plan" and "Floor display" pages (piece 4 replaces them).

**Anti-goals:** two people holding the same seat; a person holding two seats; a booked seat lost to a walk-in before 10:00; a QR scan that accidentally gives a seat up (giving up always needs a tap); revealing who booked a seat to everyone.

## 8. Testing

- Backend (local PostgreSQL): booking rules (free-for-all only, today/tomorrow, self + allowance, shared department, one per person/seat/day, cancel rights), no-show release at 10:00 and the 1-hour same-day hold (with an injectable clock), check-in rules per tag/booking/membership, one active check-in per person, give-up, end-of-day, plan unpublish/retag cancelling bookings, snapshots recorded, Manage Users allowance field.
- Frontend: smoke tests for pure state helpers; build; manual check with a phone scanning a printed QR code.

## 9. Builder's calls (to confirm while reading)

1. Release rule for a same-day booking made at or after 10:00: held for 1 hour from booking.
2. Check-in on scan is automatic; giving up needs a tap (prevents a refresh or double scan from giving the seat up).
3. Booked-for names are visible only to the booker, the booked person and admins; others see "Booked".
4. New prefix `/api/desk` (the legacy Node service already uses `/api/seats`).
5. QR codes are generated in the browser with a small pinned npm package; the QR encodes only the seat link (no secrets) — the check-in itself requires sign-in.
6. The legacy Book a desk and Desk check-in pages and their Node calls are removed from the frontend; the Node service itself is untouched.
7. Bookings for colleagues are allowed only for active accounts within their access dates (start/end) on the booking day; the same applies to booking or checking in yourself.
8. A booking for someone who is already checked in elsewhere that day is allowed; checking in to the booked seat then needs them to give up the other seat first.
