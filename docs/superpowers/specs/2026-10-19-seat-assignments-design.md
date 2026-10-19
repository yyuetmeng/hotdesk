# Seat assignments — design

Date: 2026-10-19. Owner decisions (chat, 2026-10-19) are marked **(owner)**; everything else is the designer's
call and is marked *(call)*.

## 1. Intent

Admins need to know who sits where and, above all, **when someone is leaving or has left**, so they can plan the
seat in time **(owner)**. This is a record for admins only. Later it may feed forecasting **(owner)**.

**Goals.**
- A separate admin page to assign seats to people, with an end date per assignment **(owner)**.
- An Insights card listing assignments ending soon or recently ended **(owner)**.

**Non-goals.** Any effect on booking, check-in, auto-book, the floor plan editor, project-team seat tags, the
usual seat, or what non-admins see **(owner: "neither used in floor plan, nor used in booking or checkin")**.
Notifications. Forecasting itself.

**Anti-goals.**
- An assignment ever blocking or steering a booking or check-in.
- Losing past assignments (they are the basis for later forecasting) *(call)*.

## 2. The assignment
- One person ↔ one seat: a person has at most one current assignment, and a seat at most one **(owner)**.
- Fields: seat, person, **end date** (optional: blank means no planned end), note (optional, short) *(call: note)*.
  The assignment's start is when it was made *(call)*.
- The end date is its own date, separate from the account's access end date in Manage Users; neither changes the
  other **(owner)**.
- Status: **assigned**; **leaving soon** when the end date is within the next 14 days; **left** once the end date
  has passed **(owner: 14 days)**. A "left" assignment still holds the seat until an admin clears or reassigns it
  *(call: the admin decides what happens to the seat)*.
- Clearing or reassigning closes the old assignment and keeps it as history; nothing is deleted *(call)*.
- People: active user accounts *(call)*. A person whose account is deactivated keeps their assignment (the admin
  sees it and decides).
- Seats: seats on published floors. If a republish removes a seat, its current assignment stays listed as
  "seat removed" until the admin clears it *(call)*.

## 3. The page (admin only): "Seat assignments"
- Floor picker at the top, as on Book a desk.
- **Left: the floor layout** (the same drawing as elsewhere). Each assigned seat shows the **person's name and end
  date beside it**, so the admin knows at a glance **(owner)**; leaving-soon and left seats are coloured
  (amber / red) *(call)*. Long names are shortened, as table labels are.
- **Right: a table** of the floor's seats: seat, person, end date, status, note **(owner: "floor plan layout with a
  table")**. Sortable by status and end date *(call)*.
- Clicking a seat on the map or a row in the table selects it in both and opens a small form: pick a person
  (search), set or change the end date, note, **Save** / **Clear assignment** **(owner)**.
- Assigning a person who already has a seat asks "Move Jane Tan from L3-A4 to L3-B2?" and, on yes, closes the old
  assignment *(call)*.
- Menu item "Seat assignments" in the admin section.

## 4. Insights card: "Seat assignments ending"
- Lists assignments ending in the **next 14 days** ("Leaving soon") and those that **ended in the last 14 days**
  ("Left"), soonest first, with person, seat, floor and end date *(call: reading of the owner's "last 14 days";
  older ended assignments drop off the card but stay in history)*.
- Each row links to the Seat assignments page with that seat selected.
- Empty state: "No seat assignments ending in the next 14 days."

## 5. Audit
New events: assignment created, changed, cleared (with seat, person, end date) *(call)*.

## 6. Tests
- One person ↔ one seat enforced (server), including two admins racing.
- Status boundaries: end date = today+14 is leaving soon, today+15 is assigned, yesterday is left, blank is
  assigned.
- Clearing and moving keep history.
- Booking, check-in, floor and auto-book responses are unchanged by assignments.
- Insights card window: ended 14 days ago is listed, 15 days ago is not.
- Non-admins get 403 on every assignment endpoint.

## 7. Settled details *(all calls)*
- **People** are user accounts (the app has no shared or guest accounts). The search offers active accounts; a
  deactivated person keeps any current assignment and still counts for one-person-one-seat until it is cleared.
- **Dates** use the booking timezone (`BOOKING_TIMEZONE`, Singapore), like the rest of the app. The end date is
  the person's last day: on and before it the status is assigned or leaving soon; from the day after, **left**.
  Leaving soon = end date from today to today+14 inclusive.
- **Seats** are identified by their permanent seat id, which survives republishing (the same id bookings use).
  Label, floor and zone are read from the published floor, so a renamed seat shows its new label. A seat no
  longer on any published floor shows as "seat removed".
- **History.** Each closed assignment keeps its planned end date *and* the date it was cleared or moved, and who
  did it, for later forecasting.
- **Insights card** lists current assignments only (a cleared one drops off at once); it is admin-only like the
  rest of Insights, sits with the other cards, and ignores date filters (its window is fixed).
- **Table** lists every seat on the chosen floor, assigned or not, with a "Show assigned only" toggle. One floor
  at a time; the Insights card is the cross-floor view.

## 8. Left to the builder
Storage shape (current + history), endpoint shape, how the name/end-date labels avoid overlapping on a dense floor,
component layout (follow Book a desk and Insights cards), exact wording tweaks.
