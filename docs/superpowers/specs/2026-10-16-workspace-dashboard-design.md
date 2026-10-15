# Workspace dashboard — design

Date: 2026-10-16. Status: approved by the product owner (mockup "Workspace dashboard", 2026-10-16).

## 1. Intent

Replace the legacy "Floor plan" page under Workspace with a **Dashboard**, the home page (`/`) for every signed-in user. It shows, at a glance:

- where you are sitting now,
- your coming bookings,
- where the people in your project teams are sitting,
- your recent history,
- your check-in and check-out pattern,
- a quick way to book your usual seats again.

## 2. Goals and non-goals

**Goals.** Implement the six cards of the approved mockup (§4). Make "Book again" open Book a desk on that floor with the seat selected. Pages a user may not open (and unknown addresses) land on the Dashboard.

**Non-goals.** Admin statistics: those belong to the paused piece 5. Editing bookings anywhere other than Cancel. Showing people outside your project teams.

**Anti-goals.** Showing one person's data to someone who shouldn't see it. The Team card only lists people who share a project team with the viewer.

## 3. Data: `GET /api/desk/dashboard` (any signed-in user; runs `settle(at)` first like every desk endpoint)

All times are in Singapore time. "Today" means `rules.local_today(at)`. "Working days" are Monday to Friday.

```
{ now, me: {name, teams: [{id, name}]},
  current:   null | {seat_id, seat_label, plan_id, plan_name, zone, checked_in_at, ends_at},
  upcoming:  [ {id, seat_id, seat_label, plan_id, plan_name, zone, date, preset, starts_at, ends_at, booked_by_name|null} ],
  team:      [ {team_id, team_name, size, members: [ {name, initials, today: null|{state: checked_in|booked, seat_label, plan_name, zone, since|preset}, tomorrow: null|{seat_label, plan_name, preset}} ]} ],
  trend:     {days: [ {date, weekday, check_in: "HH:MM"|null, check_out: "HH:MM"|null} ] (10 working days ending today, oldest first),
              days_in_office, usual_arrival: "HH:MM"|null, usual_leave: "HH:MM"|null},
  history:   [ {date, seat_label, plan_name, kind: booking|walk_in, outcome: checked_in|released|cancelled|plan_changed|active, from: "HH:MM"|null, to: "HH:MM"|null, preset|null} ] (latest 10),
  favourites:[ {seat_id, plan_id, seat_label, plan_name, zone, count} ] (top 4, last 90 days, seats still on a published floor) }
```

**Field rules.**

- **current:** the viewer's open check-in, if any.
- **upcoming:** the viewer's active bookings (booked for them, `end_reason` null) for today and tomorrow, ordered by start.
- **team:**
  - One entry per project team of the viewer.
  - `size` counts the team's active members.
  - `members` lists the team's other active users who have something today or tomorrow, sorted checked-in first, then booked today, then tomorrow only.
  - `today` is their open check-in, or else their active booking today. `tomorrow` is their active booking tomorrow.
- **trend:**
  - Built from the viewer's check-ins on each day.
  - `check_in` is the first `checked_in_at` of the day. `check_out` is the last `checked_out_at`, or `ends_at` if still open.
  - `days_in_office` counts days that have a check-in.
  - `usual_arrival` and `usual_leave` are the medians over those days.
- **history:**
  - The viewer's bookings (booked for them), plus walk-in check-ins (`method = walk_in`), newest first, at most 10.
  - A booking's outcome is its `end_reason`, or `active`.
  - For a checked-in booking, `from`/`to` come from its check-in. For a walk-in, they come from the check-in itself.
- **favourites:**
  - Counts uses per seat over the last 90 days: each of the viewer's check-ins counts once. Each of their bookings counts once
    only if it didn't turn into a check-in and wasn't cancelled or ended by a floor plan change.
  - Only seats that still exist on a currently published floor count.
  - Ties are broken by most recent use.
- **zone:** the zone that contains the seat on the published floor (`zones.zone_name`), or null.

## 4. Page (`/`, sidebar Workspace → **Dashboard**, first item)

1. **Greeting:** "Good morning/afternoon/evening, <first name>", the date and the viewer's teams.
2. **Right now** (wide banner):
   - When checked in: the seat in large type, "<floor> · <zone> · since HH:MM, until HH:MM", and *Open my seat* (`/checkin/<seat>`).
   - Otherwise, with a booking today: "Your next booking: <seat> · <floor> · <slot>".
   - Otherwise: "You're not at a desk", with *Book a desk* and *Scan to check in* (`/checkin`).
3. **My upcoming bookings:** one row per booking with its slot, seat, floor and zone. Show "booked by X" when someone else made it. Each row has *Cancel* (`DELETE /api/desk/bookings/<id>`, then reload). When empty: "No bookings for today or tomorrow."
4. **My team today:**
   - A team picker appears when the viewer has several teams.
   - The header reads "<team> · N of <size> in" (N = members checked in today).
   - Each member row has initials, name, seat · floor · zone, and a pill: Checked in / Booked / Tomorrow.
   - When the viewer has no team: "You're not in a project team yet."
5. **My check-in and check-out:**
   - Three figures: days in office, usual arrival and usual leave.
   - Below them, a bar chart over 08:00–18:00 with one bar per working day, running from check-in to check-out. Times outside that range are clamped.
   - Days without a check-in show an empty column.
6. **Recent history:** a row per item with seat · floor, the date and time or slot, and an outcome pill: Checked in, Released (no check-in), Cancelled, Cancelled (floor plan changed), Booked.
7. **Book again:** a chip per favourite showing "<seat> · <floor>", "<zone> · used N times". It links to `/book?plan=<plan_id>&seat=<seat_id>`. Book a desk then opens that floor and selects that seat once it has loaded.

The page keeps its title and description while loading, with the page loader, like the other pages.

## 5. Routing

- `/` renders the Dashboard. The legacy Floor plan page (`pages/floor-plan/FloorPlanPage.jsx`, legacy `/api` server) is removed.
- Admin-only pages and unknown paths already redirect to `/`, which is now the Dashboard.

## 6. Constraints

Same stack and conventions as before. Tests run on the local Postgres only. No schema change.
