# Usual seat and auto-booking — design

Date: 2026-10-16. Owner decisions:
- one usual seat per person;
- the tag is only a label, so booking rules are unchanged;
- "auto-reserve for the next working day", switched on by the user in Settings.

## 1. Usual seat (admins, Manage Users)

- **Storage:** `users.usual_seat_id` (uuid, nullable), the permanent seat id (`sql/0022_usual_seat_and_auto_book.sql`). Several people may share one usual seat.
- **Setting it:**
  - `PATCH /api/admin/users/<id>` accepts `usual_seat_id`: null clears it.
  - It must be a seat on a currently published floor. Otherwise the request fails with 400, `fields.usual_seat_id = "choose a seat on a published floor plan"`.
  - `public_user` returns `usual_seat_id`.
- **UI:** the user edit form gets a "Usual seat" select. The seats are grouped by floor, with "None" first. The users table shows the seat label under the name.

## 2. Where it shows

- **Colleague Finder:**
  - Every person has `usual_seat` (`{seat_id, seat_label, plan_id, plan_name, zone}` or null).
  - The detail panel shows a "Usually sits at" fact.
  - When the person has no seat today or tomorrow (`away`), the floor shows their usual seat blinking, headed "Usual seat".
- **Dashboard:** the viewer's `usual_seat` comes first in "Book again", marked **Your seat**, with *Check in* (`/checkin/<seat>`) and *Book*. It isn't repeated in the list below.

## 3. Auto-booking (each user, Settings)

- **Storage:** `users.auto_book` (boolean, default false).
- **Reading it:** `GET /api/desk/me` also returns `auto_book` and `usual_seat` (with `bookable`: whether the seat is free for all).
- **Changing it:** `PATCH /api/desk/me {auto_book}`.
- **Settings panel:** under the theme toggle, a switch "Auto-book my usual seat (<seat> · <floor>)".
  - It's **shown only when** the user has a usual seat that can be booked, i.e. free for all (owner decision).
  - With no usual seat, or with a project-team seat (those need no booking), the switch isn't shown at all.
- **When it runs:**
  - On a successful sign-in, after the token is issued. It never fails the sign-in.
  - On every dashboard load.
  - Each run checks `auto_book` is on and the usual seat is free for all on a published floor.
- **Which days:**
  - **Today:** if today is a working day (Mon–Fri) and the viewer has no active booking and no check-in today, book `full`. Booking rules shorten it to what's left of the day, or refuse when too little is left.
  - **Tomorrow:** if tomorrow is a working day and the viewer has no active booking that day, book `full`.
  - Bookings use the normal `create_booking`, so every booking rule applies: availability, the person being active, and so on.
- **Outcome:**
  - The dashboard payload has `auto_book: [{date, seat_label, ok, message}]`. Entries are for this run's attempts only, and days already booked are skipped silently.
  - The page shows a notice, such as "Auto-booked A1 for tomorrow (full day)". When it couldn't, the notice reads "Your usual seat A1 is taken for Mon 19 Oct", with a link to Book a desk.

## 4. Out of scope

Holding a usual seat for its owner, notifications, and admin bulk assignment.
