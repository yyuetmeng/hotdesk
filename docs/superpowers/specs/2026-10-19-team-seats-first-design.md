# Team seats first — design

Date: 2026-10-19. Owner decisions (chat, 2026-10-19) are marked **(owner)**; everything else is the designer's
call and is marked *(call)*.

## 1. Intent

An admin pre-allocates seats to a project team (the seat's project-team tag). The stakeholder wants each team to
**sit in its own seats first**. Only when every one of the team's seats is taken may a member use a free-for-all
seat. The app enforces this when someone books or checks in, and recommends seats in the same order.

**Goals.**
- A rule that refuses a free-for-all seat while the person has a free team seat **(owner)**.
- Team seats become bookable by members of that team **(owner)**.
- Seat suggestions in the same order: on Book a desk ("Find me a seat"), when booking for a colleague, at check-in,
  and for auto-book **(owner)**.

**Non-goals.** Moving existing bookings, notifications, admin statistics, holding a seat for its usual sitter.

**Anti-goals.**
- Refusing someone with no way forward. Every refusal names the free team seat and offers to use it.
- Slowing the floor view. The rule is worked out with a fixed number of queries, like `floor_context`.

## 2. Terms

- **Person:** who the seat is for. That's the signed-in user when booking for yourself or checking in, and the
  colleague when booking for someone else **(owner)**.
- **Team seats:** seats on any **published** floor whose `department_id` is one of the person's project teams.
  Seats on all floors count, not just the floor being viewed **(owner)**. A seat is exactly one of: one team, free
  for all, or untagged (check constraint, spec 2026-10-15-seat-department-tags).
- **Free for a booking:** for the requested day and slot (`full`, `am`, `pm`, as `rules.preset_range` gives it),
  the seat has no booking block in the range and no open check-in overlapping it. This is the same test as today's
  `can_book` *(call)*. A seat that's free only for part of the slot is not free.
- **Free for a check-in:** `checkin_decision(person, seat, now)` returns ok (not occupied, not inside someone
  else's booking window, the person not already checked in) *(call)*. A team seat booked by someone else later
  today still counts as free now. The walk-in check-in there simply ends when their booking starts, as it does
  today, and the suggestion shows that end time.

## 3. The rule

### 3.1 Booking (`service.create_booking`)
1. **Team seats are bookable** by members of that team (the person's teams, not the booker's). A team seat for a
   team the person isn't in is refused with 403 "This seat is for another project team." The existing
   "only free-for-all seats can be booked" refusal stays for untagged seats only, reworded "This seat cannot be
   booked: it has no project team." **(owner)**
2. **Team first:** a free-for-all seat is refused when the person has at least one team seat that is free for
   the same day and slot. Response: 409 with
   `{"error": "<Your|Jane Tan's> project team has a free seat: L3-A4 on Level 3. Book that one instead.",
   "suggestion": {seat_id, seat_label, plan_id, plan_name, zone}}`. The suggestion is the first team seat from §4.
   **(owner)**
3. **Everyone follows it, admins included** *(call: the owner said booking for others follows the colleague's
   teams; an admin override is out of scope unless the owner asks)*.
4. A person with no team, or whose teams have no seats on a published floor, is unaffected.
5. "Both days" bookings are checked day by day, as separate bookings are today.
6. Existing bookings are left alone. The rule applies to new bookings only.
7. **Races:** the rule is checked when the request arrives. Two people taking the last team seat at the same moment
   is settled by the existing unique booking block (one gets "seat or person already booked").

### 3.2 Check-in (`service.checkin_decision`)
- A **walk-up** check-in at a free-for-all seat is refused when the person has a team seat free for a check-in
  now. It uses the same message shape as booking, with `suggestion`, status 409 **(owner)**.
- Checking in **to your own booking** at a free-for-all seat is allowed, because that booking was legal when it was
  made *(call)*.
- Since `checkin_decision` feeds both the check-in and the floor's `can_check_in`, the floor, Desk check-in and
  Scan all agree.

### 3.3 Performance
- One extra query per request: the person's team seats across published floors (seat ids, labels, plan, zone).
- One `floor_context` per floor that holds those seats, for the day.
- Do not call `checkin_decision` per team seat with `ctx=None`, which would be one query per seat.

## 4. Suggestions (`service.suggest_seats(person, day, preset, at, purpose="book"|"checkin", limit=5)`)
The order, best first:
1. **Team seats** free for the purpose:
   - the person's usual seat, if it is one of them;
   - then seats on the same floor and zone as the usual seat;
   - then the same floor;
   - then the rest, in published-floor order (as in `published_floors()`) and by seat label *(call)*.
   - With no usual seat, just floor order then label.
2. **Only when no team seat is free:** free-for-all seats, in the same order (usual seat first if it is free for
   all) **(owner)**.

Returns `{"tier": "team"|"open"|"none", "seats": [{seat_id, seat_label, plan_id, plan_name, zone}]}`.

**Endpoint:** `GET /api/desk/suggest?date=YYYY-MM-DD&preset=full|am|pm&purpose=book|checkin&user_id=<optional>`.
- `user_id` for someone else needs the same permission as booking for them (shares a team, or is an admin).
  Otherwise 403, with the same message as `create_booking`.
- `purpose=checkin` ignores `date` and `preset` (today, now).

## 5. Floor payload (`seat_states`)
- `can_book[preset]` becomes true for **team seats of the viewer's teams** that are free.
- `can_book[preset]` becomes false for a free-for-all seat while the viewer has a free team seat for that preset.
- New per-viewer field on the floor response: `team_first: {preset: suggestion|null}`, the viewer's first free
  team seat per preset. The UI uses it for the hint and the button in §6.
- `can_check_in` follows from §3.2 automatically.
- Booking for **someone else** isn't pre-checked on the floor: the panel asks the server (§6.2).

## 6. Screens

### 6.1 Book a desk
- **"Find me a seat"** button beside the day and slot controls. It calls `suggest` for yourself. It switches the
  map to the suggested seat's floor and selects that seat, so the normal booking panel opens on it. Nothing is
  booked until Confirm **(owner)**.
- With tier `none`, it shows a notice: "No free seat for <day> <slot>."
- Clicking a free-for-all seat while `team_first[preset]` is set opens the seat panel with a hint instead of the
  booking form: "Your project team has a free seat: L3-A4 on Level 3." with a **Book L3-A4 instead** button. The
  button switches floor and selects that seat.
- Free-for-all seats stay drawn as available. The rule shows in the panel, not on the map *(call: keeps the floor
  the same for everyone, including the TV display)*.

### 6.2 Booking for someone else
- When a colleague is chosen for a row, the panel calls `suggest?user_id=<them>`. If the row's seat is a
  free-for-all seat and the tier is `team`, the row shows "Jane's team has a free seat: L3-A4." with **Use
  L3-A4**. That button swaps the row's seat **(owner)**.
- With "One seat", **Find a seat for <name>** fills the row from `suggest` without the user clicking a seat first
  **(owner)**.
- Rows may now hold seats from different floors. Each booking request carries its row's own `plan_id` (today
  `bookingRequests` uses one `planId` for every row).
- The server's 409 (§3.1) is still shown per row in the result list, with its suggestion button. That covers the
  case where a team seat frees up between choosing and Confirm.

### 6.3 Check-in (seat panel, Desk check-in page, Scan to check in)
- A refused check-in shows the message and a **Go to L3-A4** button. It opens the Desk check-in page for that seat
  (`/checkin/<seat_id>`), where the person can check in **(owner)**.
- The Scan result screen shows the same message under its cross, with the button.

### 6.4 Auto-book (spec 2026-10-16-usual-seat-and-auto-book §3, changed)
- For each day it runs, it books `suggest_seats(user, day, "full")[0]`. That's the usual seat when it's allowed
  and free, otherwise the next seat in §4 order **(owner)**.
- It runs for users with no usual seat too, as long as they have a team seat or a free-for-all seat is free
  **(owner: "auto-book fallback when the usual seat is taken or unset")**.
- **Settings switch:**
  - Shown to every user with `auto_book` available. That means every active user; the free-for-all restriction is
    gone, since team seats are now bookable *(call)*.
  - Label: "Auto-book a seat for me (my usual seat first, then my team's seats)."
- **Notes:**
  - "Auto-booked L3-A4 for tomorrow (full day)."
  - When a different seat than the usual one was booked: "Your usual seat A1 was not available; auto-booked L3-A4
    for tomorrow."
  - When none was free: "Could not auto-book for Mon 19 Oct: no free seat."

## 7. Audit
- No new events. Bookings and check-ins are audited as today, and auto-booked ones as `booking.auto_created`.
- Refusals are not audited (none are today).

## 8. Tests (backend, local Postgres; frontend smoke for pure helpers)
- **Booking:**
  - A team member books their team seat.
  - A non-member is refused that seat (403).
  - An untagged seat is refused.
- **Team first:**
  - A free-for-all booking is refused while a team seat on **another floor** is free. The 409 body carries the
    suggestion.
  - It's allowed once every team seat is booked or occupied for that slot.
  - It's slot-aware: when every team seat is booked for `am` only, an `am` free-for-all booking is allowed and a
    `pm` one is refused.
- **For others:** the rule uses the colleague's teams, not the booker's. Admins follow it too.
- **Check-in:**
  - A walk-up at a free-for-all seat is refused while a team seat can be checked in to now.
  - Checking in to your own free-for-all booking is allowed.
- **Suggestions:**
  - Order: usual seat, same zone, same floor, other floors, then free for all only when no team seat is free.
  - Tier values.
  - The `user_id` permission.
- **Floor payload:**
  - `can_book` is true for own team seats and false for free-for-all seats while a team seat is free.
  - `team_first` is set per preset.
  - Query count stays fixed (extend `test_query_budget`).
- **Auto-book:** books the usual seat; else a team seat; else free for all; with no usual seat; the notes' wording.
- **Frontend smoke:**
  - `bookingRequests` with per-row `plan_id`.
  - A helper deciding when to show the "Book L3-A4 instead" hint.

## 9. Left to the builder
Component layout of the hint and buttons (follow the booking panel's existing style), exact wording tweaks,
and where the suggestion helpers live (`deskLogic.js` / `bookingLogic.js`).
