# Hot Desk Monitor

Monitors which desks in a building are taken, automatically frees desks when people stop using them,
and gives administrators a live dashboard of seat availability.

- **Detection:** under-desk presence sensors (primary) plus QR-code check-in (fallback / sensorless areas).
- **Auto-release:** a desk whose occupant has been gone longer than a grace period (default 20 min)
  becomes available again. Unconfirmed or expired check-ins are released too.
- **Admin dashboard:** interactive live floor plan with a two-tab side panel: a **Colleague finder** (who is in and
  where) and **Seat booking** (check someone in, extend or check out). KPIs that follow the floor filter, 24 h occupancy trend,
  per-zone utilisation, activity feed.
- **For employees:** a self-service reservation page (`/book`) with the floor plan (reserve a desk for a morning,
  afternoon or full day, today or tomorrow), and a phone check-in page (`/checkin`) that a desk's QR code opens,
  or that takes a typed desk ID. A reservation only holds the desk: the person still checks in when they arrive.
- **Floor display:** a page for a projector or wall screen at the office (`/display`): the live floor plan and a
  colleague finder that shows who is checked in or has booked, and where.

![Admin dashboard](docs/dashboard.png)

The current desk layout is in [docs/seat-layout.png](docs/seat-layout.png).

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/yyuetmeng/hotdesk?quickstart=1)

**Try it in GitHub Codespaces:** click the button and the app starts by itself (details in
[docs/GITHUB.md](docs/GITHUB.md#3-run-the-app-in-github-codespaces)).
**To deploy it to AWS from GitHub (ECS Fargate, HTTPS load balancer, EFS), follow [docs/DEPLOY.md](docs/DEPLOY.md).**
To connect real desk sensors, follow [docs/SENSORS.md](docs/SENSORS.md).

The full proposal (sensor options, state rules, architecture, rollout) is in [docs/DESIGN.md](docs/DESIGN.md).

## Quick start

Requires Node.js 20.11 or newer. Run `npm install` once (one small dependency, used to draw the QR codes).

```bash
npm install
npm start                    # http://localhost:3000  (admin dashboard)
npm run simulate             # in a second terminal: fake sensors + check-ins
npm test
```

**For a demo, one command:** `npm run demo` starts the server and the simulator together at **10x speed**. People
come and go within a minute or two, team bookings appear, and away holds clear within 2 minutes. It keeps your
projects and seat allocations. Add `-- --fresh` to start from an empty floor (`npm run demo -- --fresh`), or
`-- --speed=20` for another speed. Stop your normal server first (it uses the same port), and press Ctrl+C to stop
the demo. Its shortened hold times last only while the demo runs: `npm start` uses the normal ones again.

The simulator plays an office day:

- **People:** 70 people with proper names (from the 80 sample names in `public/demo-names.js`), from the project teams (the server's current list, including projects added or deleted
  on the dashboard; only 10% are External, the rest are spread evenly over the projects) arrive, sit down so the desk sensor sees them, and leave again. They stay about 20 minutes
  and are out about 10.
- **Check-ins:** most check in with their project, so desks show in team colours, and most check out when they
  leave.
- **Seat choice:** people prefer their project's pre-allocated seats, and seats booked for their team.
- **Team bookings:** every few minutes (and once at the start), a team lead books 2–4 seats for the team, preferring
  the team's pre-allocated seats, and teammates come and sit in them.
- **Visitors:** a few sit down without checking in (plain occupied).
- **Broken sensors:** two sensors stop reporting, so their desks turn *sensor offline* after 15 minutes.

If the server was started with `SENSOR_API_KEY`, give the simulator the same key: `SENSOR_API_KEY=... npm run
simulate`. Team bookings need the admin token too, if the server has one: `ADMIN_TOKEN=... SENSOR_API_KEY=... npm
run simulate`. Without it, the simulator says so and carries on without team bookings.

To start again from an empty floor without losing your projects and seat allocations, run
`npm run simulate:fresh` instead (or `npm run demo -- --fresh`). It first clears every seat's live state (who sits
where, check-ins, team bookings, *away* holds) and the people history of earlier runs (the requester lists, the
activity feed and today's check-in counts per project), then simulates as usual. Use it only on a demo server: it
also clears real people's check-ins and history. It needs the admin token if the server has one. In a Codespace: `HOTDESK_DEMO=fresh npm run codespace`.
Behind it is `POST /api/seats/reset` (admin; `{"people": true}` also clears the history). To point it at another address:
`npm run simulate -- http://host:port`. In a Codespace, set the `HOTDESK_DEMO` secret to `1`, or run
`HOTDESK_DEMO=1 npm run codespace`; the right key and token are passed for you.

To watch seats auto-release quickly while simulating, shorten the grace:

```bash
AWAY_GRACE_MINUTES=1 npm start
```

The employee check-in page for a desk is `http://localhost:3000/checkin?seat=L1-A-01`. Encode that URL
in the QR sticker on each desk.

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | 3000 | |
| `ADMIN_TOKEN` | *(unset → open)* | Required for the dashboard and admin API. The dashboard prompts for it |
| `SENSOR_API_KEY` | *(unset → open)* | Gateways send it as `X-Api-Key` |
| `AWAY_GRACE_MINUTES` | 20 | How long a desk is held after the person leaves |
| `CHECKIN_CONFIRM_MINUTES` | 15 | A check-in on a sensor desk must be confirmed by presence within this time |
| `CHECKIN_DURATION_MINUTES` | 180 | Only for API calls that pass `minutes` instead of `slot` (the pages use slots, see Check-in duration) |
| `CHECKIN_MAX_MINUTES` | 480 | Longest `minutes` an API call can ask for |
| `PUBLIC_URL` | *(address the page was opened at)* | Base URL encoded in the desk QR labels, e.g. `https://hotdesk.example.com` |
| `DISPLAY_KEY` | *(none)* | Key for the floor display (`/display?key=…`), which shows names; the admin token works too |
| `TEAM_BOOKING_MAX_SEATS` | `10` | Most desks an employee can reserve for their team at once on `/book` (admins on the dashboard: 100) |
| `SENSOR_OFFLINE_MINUTES` | 15 | Silence after which a sensor counts as offline |
| `BUILDING_FILE` | `config/building.json` | Floors, zones and desk grid |
| `STATE_FILE` | `data/state.json` | Persisted state |

### Building layout

`config/building.json` holds the **DIC Annex @ Depot Road** layout, transcribed from
`CIO_DF_Seat_Assignment.pptx`. It has 125 desks:

| Floor | Zone | Desks | Notes |
|---|---|---|---|
| Level 1 | Digital Factory | 36 | 6 pods of 3×2 desks |
| Level 1 | Discussion Area | 16 | Former discussion area converted to desks (red outline in the deck): 4 single desks + 2 pods |
| Level 1 | AI Lab | 30 | 6 single desks along the stair wall + 2 pods of 6×2 |
| Level 2 | General Office | 43 | 5 pods in the top section (the last one single-sided) + 2 pods of 4×2 |

Each zone is an ASCII `map`, one string per row of desks: `.` is a desk and a space is no desk (an aisle or
the gap between pods). All desks are open hot desks. The coloured blocks in the deck are not used.

```json
"map": [
  ".. .. ..",
  ".. .. ..",
  "",
  ".. .. .."
]
```

Desk IDs are `<floor>-<zone>-<nn>`, numbered in reading order (left to right, top to bottom, e.g.
`L1-DF-01`). Sensor IDs are `S-<deskId>`. For QR-only areas, set `"sensors": false` on a zone or list
desk IDs in `"sensorless"`. A zone can also use plain `"rows"`/`"cols"` instead of a `map`.

Optionally, desks can be assigned to teams. Define `"teams": { "a": { "name": "...", "color": "#..." } }`
and use the team's letter in the map instead of `.`. When a layout has teams, the dashboard adds a
**Team assignment** view, a team filter and a utilisation-by-team table. Otherwise these are hidden.

The deck's blue arrows and "OSN" label are ignored. The latest revision of the deck blanks out the Level 2
UAT Stations block, so it is no longer part of the layout. Level 2 now has only the General Office.

### Floor-plan drawing (optional)

The dashboard draws each floor as an office plan. Tables come from the desk `map`: desks that touch form
a table. A bank two desks wide is a table with chairs on both sides, a bank one desk wide is a bench, and a
single row of three or more is a counter with chairs along it.

Each seat is drawn as a workstation: its own segment of the table with a monitor, and an office chair, in
neutral colours. A free desk has no marker. A taken desk gets a small status light: an occupied seat also
shows a person in the chair, and an away seat shows the chair pushed back. The selected seat's chair turns
blue and glows.

To draw walls and facilities, give the floor a `"plan"`. All numbers are plan units (about 10 cm), with
`0,0` at the top-left corner of the outer wall:

```json
"plan": {
  "width": 171, "height": 73,
  "zones": { "DF": { "x": 8, "y": 6, "w": 52, "h": 46 } },
  "walls": [[0, 55, 4.5, 55]],
  "windows": [[9, 0, 17.5, 0]],
  "doors": [{ "x": 9.5, "y": 55, "r": 5, "from": 180, "to": 270 }],
  "rooms": [{ "kind": "pantry", "x": 0, "y": 55, "w": 26, "h": 18, "label": "Pantry" }],
  "fixtures": [{ "kind": "planter", "x": 71, "y": 48, "w": 29, "h": 4 }],
  "plants": [[4.5, 4.5]]
}
```

- `zones` places each zone's area. Its tables are centred inside, and the box grows if the desks need more room.
  An optional `"cut": { "x", "y", "w", "h" }` removes a corner of the box, making the zone L-shaped (Level 2 uses it
  for the toilets in the office's empty corner).
- `walls` and `windows` are lines `[x1, y1, x2, y2]`. The outer wall is drawn from `width` and `height`.
- `doors` are hinged at `x,y` with leaf length `r`, swinging from angle `from` to `to` (degrees,
  0 = right, 90 = down).
- Room kinds are `pantry`, `toilet-m`, `toilet-f`, `lift`, `stairs`, `store` and `service`. Fixture kinds are
  `planter` and `storage`.

Level 1 has its three zones with a narrow staircase between the Discussion Area and the AI Lab. Level 2 has the
General Office, with toilets in its empty corner and a staircase on the right. A floor without a `plan` still
shows its zones and tables, inside a generic office outline with windows, plants and storage; the dashboard
labels that outline as generic.

The plan is served by `GET /api/floorplan`. After updating the app, restart the server so it serves the new
drawing data (in a Codespace: `bash scripts/codespace.sh start`). If it can't, the dashboard shows a warning
above the plan.

## Occupancy chart

The Occupancy card shows the share of seats in use (occupied or away) over **1H, 6H, 24H, 7D or 30D**; the
choice is remembered in the browser. Up to 24 hours it plots one sample per minute. For 7 and 30 days it plots
hourly averages, with each hour's peak as a dashed line; the server keeps these for 30 days in its state file.
`GET /api/history?period=1h|6h|24h|7d|30d` (admin) returns the same data.

## Check-in duration

A check-in holds the desk to the end of a **slot**, the same slots as reservations. The QR check-in page and
the dashboard (check-in, extend and team booking) offer the slots open at that moment:

| Time now | Choices (default in bold) |
|---|---|
| Before 12:45 | Morning (until 13:00), **Full day** (until 19:00) |
| 12:45–13:00 | Morning, Afternoon, **Full day** |
| 13:00–19:00 | **Afternoon** (until 19:00) |
| After 19:00 | **Rest of the day** (until midnight) |

A check-in that confirms a reservation lasts at least to the end of the reserved slot. When the time is up the
check-in expires and the activity feed records it:

- On a desk **without a sensor**, the desk becomes available.
- On a desk **with a sensor**, the desk stays occupied while someone is still detected there. It is freed
  by the normal away grace once they leave.
- Scanning the desk's QR code again (or **Extend** on the dashboard) moves the end to the chosen slot's end.
- A check-in on a sensor desk is still dropped after 15 minutes if nobody sits down, and checking out
  frees the desk immediately.

## Project teams

Every requester belongs to a **project team**, which they choose when they **check in and when they check out**
(both refuse to continue without one). The default teams are **External, Bolt On, eWorkplace, G&C, STREAM,
SAP, ITGC, DDAP**. Manage them on the dashboard (see *Seat allocation* below), or in `config/building.json` →
`"projectTeams"`. Once the list has been edited on the dashboard, the saved list is used and the file's list is
ignored.

- **Check-in page:** a required *Your project team* dropdown. The phone remembers the person's team for next time.
- **Admin dashboard → Project teams:** per team, the number checked in now, check-ins and check-outs today, and
  its requesters (expand to see who is at which desk until when). A *project team* filter on the floor plan
  highlights that team's desks, and tooltips and the activity feed show each person's team.
- **Colour by project team (default floor-plan view):** the person seated at an occupied desk, and the desk's
  status light, take their team's colour. Desks occupied without a check-in use the plain occupied blue.
  **Status** switches back to colouring by availability only. Without a chosen colour, teams take the dashboard's
  8-colour palette (no greens, so a team can't be mistaken for a free seat), with separate light and dark shades.
- **Download requesters (the CSV button on Project teams):** every requester with their project team, current desk, last desk, last
  check-in/out and totals (`/api/requesters.csv`, admin only).
- A requester's team is the one they gave most recently, so someone who moves to another team is re-grouped at
  their next check-in or check-out. A team removed from the list still appears in reports, marked
  *no longer offered*.

## Seat allocation (pre-booking)

On the dashboard, switch the floor plan to **Seat allocation** (or use *Seat allocation* in the sidebar). The
plan then shows which project each seat is allocated to, in that project's colour. The side panel manages the
projects:

- **Choose a project**, then **click seats** on the plan to add or remove them. You can also type seat IDs
  (`L1-DF-01, L1-DF-02 …`) and press **Save seats**.
- **Add a project:** name, optional short code (made from the name if left empty) and colour. New projects can
  be chosen on the check-in page straight away.
- **Change a colour** with the swatch next to the project. **Delete** a project with the bin icon. Its seats are
  released, people can no longer choose it at check-in, and its history stays in the reports.
- A seat belongs to at most one project. Seats allocated to another project can't be taken until they are
  removed from that project.

Allocations are saved with the app's state (`data/state.json`), and each seat's view carries `allocatedTo`.

**Booking against allocations.** Pre-allocation guides people to their project's seats but doesn't block other
seats:

- **Dashboard side panel:** two tabs. **Colleague finder** (the default) lists everyone checked in or with booked
  desks on the plan's floor, with search and a project filter, and the same Away / Booked / Booked for team tags as
  the floor display. Clicking a taken desk on the plan opens its person in the finder (their desks are highlighted);
  **Manage** opens that desk in Seat booking to extend or check out. Clicking a free desk (or one where someone sits
  without a check-in) opens **Seat booking**. The sidebar's **Colleague finder** link jumps to the search.
- **Dashboard seat booking:** checking someone in follows four steps in the Seat booking tab:
  1. **Choose a project.** Its pre-allocated seats are highlighted on the plan in its colour, with how many are free.
  2. **Choose a seat** on the plan.
  3. **Fill in the details** (name, duration). The project is the one from step 1 and isn't asked for again.
  4. **Check in.**

  If the seat isn't one of the project's, step 3 says so, names the project it belongs to (if any), lists the
  project's free pre-allocated seats (click one to switch, or click any other seat on the plan), and offers
  **Continue with this seat**. Check-in is held until another seat is chosen or that is pressed. Changing the project in step 1 re-checks the
  selected seat straight away. A project with no pre-allocated seats gets a note instead of a warning. Selecting
  a seat before choosing a project points back to step 1.
- **Booking several seats for the team (dashboard):** under step 1, switch to **Several seats for the team**,
  click free seats on the plan (click again, or the × on its chip, to remove one), enter your name and a duration,
  and **Book N seats**. All the seats are booked under your name for the project:
  - All or nothing: if any seat has just been taken, none are booked and the reply names the seat.
  - Team-booked seats are held for the whole duration, even before anyone sits down (no 15-minute no-show
    release), and expire at the end like any check-in. Each can be extended or checked out on its own.
  - They don't count against your one seat: checking in somewhere for yourself keeps the team's seats, and
    booking more seats for the team adds to them.
  - The pre-allocation warning lists any chosen seats that aren't the project's, with **Continue with these seats**.
  - On phones, the panel stays below the plan while you pick, and a bar at the bottom shows how many seats are
    chosen.
  - API (admin): `POST /api/bookings` with `{ "user", "projectTeam", "minutes"?, "seats": [...] }`.
- **QR check-in page:** a desk shows which project it's pre-allocated to. If someone checks in for a project that
  has pre-allocated desks elsewhere, the first tap warns them and lists that project's free pre-allocated desks.
  They can go to one of those, or tap **Check in here anyway**.
- A project with no pre-allocated seats is never warned about (the dashboard shows a note).

Admin API (token required):

| Method and path | Body | Does |
|---|---|---|
| `GET /api/projects` | | Projects with `name`, `code`, `color`, `slot` and allocated `seats` |
| `POST /api/projects` | `{ "name", "code"?, "color"? }` | Add a project (409 if the name exists) |
| `PATCH /api/projects/:name` | `{ "code"?, "color"? }` | Change its short code or colour (`#rrggbb`) |
| `DELETE /api/projects/:name` | | Delete it and release its seats |
| `PUT /api/projects/:name/seats` | `{ "seats": ["L1-DF-01", …] }` | Replace its allocated seats (400 for unknown seats, 409 for seats held by another project) |

## Ways to book a desk

**A check-in is always what makes a desk taken. A reservation is optional:** it holds a desk for a slot so
nobody else can take it, until the person arrives and checks in.

| Way | Who | Page |
|---|---|---|
| Scan the QR code on the desk (check in) | Anyone | `/checkin?seat=<desk>` opens with the desk chosen |
| Type the desk ID printed on the label (when a camera won't scan) | Anyone | `/checkin`: enter the ID, e.g. `L1-DF-07`; suggestions show each desk's status |
| Reserve a desk ahead | Anyone | `/book`: choose your project (its pre-allocated desks are highlighted), the day and slot, tap a free chair and enter your name |
| Reserve several desks for your team | Anyone | `/book` → **Desks for my team**: tap free chairs (up to 10); anyone in the project confirms a desk by checking in at it |
| Check someone in, or book several seats for a team | Admin | The dashboard's side panel |

`/book` and `/checkin` need no admin token and show no names. `/book` remembers the person's project and the
names they reserved under, and lists them under **My reservations** with **Show on plan**, **Check in** (once the
window opens) and **Cancel**. It refreshes every 10 seconds.
In demo mode (`npm run demo`, or `DEMO_MODE=1`, or `?demo` on the page), `/book` and `/checkin` fill the name with a
random sample name from a list of 80 Chinese names (`public/demo-names.js`), with **Another sample name** to pick a
different one. Each desk or booking gets a new name, and sample names are not remembered; `?demo=0` turns it off.

### Reservations

| Rule | Value |
|---|---|
| How far ahead | Today and tomorrow only |
| Slots | **Morning** 08:00–13:00, **Afternoon** 13:00–19:00, **Full day** 08:00–19:00 (server local time). A slot can't be reserved in its last hour |
| Check-in window | From 15 minutes before the slot starts until 30 minutes after (for a reservation made after the start: 30 minutes after it was made) |
| No-show | Nobody checked in by the end of the window: the reservation is released and the activity feed records a no-show |
| Limits | One desk per person per slot (overlapping slots count), and at most 5 reservations per person per week. Team reservations are exempt |
| Team reservations | Up to `TEAM_BOOKING_MAX_SEATS` desks for a project; any member of that project confirms one by checking in at it |

- While a reservation's window is open the desk shows as **Reserved** (teal, dashed chair) on every plan, and only
  the person it is for (same name; for a team reservation, anyone in the project) can check in there. Their
  check-in confirms the reservation and holds the desk to the end of the slot.
- Before the window opens anyone can still use the desk: a walk-in check-in is cut short when the window opens.
- Checking in confirms a reservation the same way whether the person scans the desk's QR code, uses **Check in**
  under **My reservations**, or an admin checks them in.
- Admins see the reservation (who, slot, deadline) in the seat panel and can **Cancel reservation**. The dashboard
  and the floor display count reserved desks, and list the person in the colleague finder with a **Reserved** tag.
- The dashboard's own multi-seat team booking (`POST /api/bookings`) is unchanged: it holds the seats straight
  away for a set time, without a check-in.

API (no admin token needed; responses never include who reserved a desk):

| Call | Body / query | Does |
|---|---|---|
| `GET /api/checkin-options` | | `checkinSlots` (open now, each with its `until`) and `checkinDefault`; `reservations`: the dates that can be reserved, the slots, the window and the weekly limit |
| `POST /api/seats/:id/checkin` | `{ "user", "projectTeam", "slot"? }` | Check in to the end of `am`, `pm`, `day` or `late` (default: `checkinDefault`); also confirms the person's reservation |
| `GET /api/availability?date=&slot=` | | Each desk with `slotState` (`free`, `reserved` or `taken`) for that slot |
| `POST /api/reservations` | `{ "seatId" or "seats", "user", "projectTeam", "date", "slot", "forTeam"? }` | Reserve (201), 409 if taken or over a limit |
| `GET /api/reservations?user=` | | That person's reservations (admins: everyone's, without `user`) |
| `POST /api/reservations/:id/cancel` | `{ "user" }` | Cancel (only the person who made it; admins without `user`) |

### Demo on one laptop (no phone needed)

1. `npm run demo`, then open `http://localhost:3000` (the dashboard).
2. Click a seat, then **Open check-in page** in its panel. Or open **Print desk labels** and click a label. Either
   opens that desk's check-in page in a phone-sized window, just as scanning its QR code would. Check in there and
   the seat changes on the dashboard.
3. **Desk check-in (phone)** in the sidebar opens the same window without a desk, to show typing a desk ID.
4. **Book a desk** in the sidebar opens the self-service booking page.

To scan with a real phone, both devices must be on the same Wi-Fi: open the dashboard at the laptop's network
address (e.g. `http://192.168.1.23:3000`, from `ipconfig`) so the labels encode it, and allow Node through the
Windows firewall on private networks.

## Floor display (colleague finder)

`/display` is made for a projector or wall screen at the office (landscape, full screen). It shows:

- four summary cards for the whole office above the plan: **Occupancy**, **Available** (noting desks reserved and
  waiting for their check-in), **Occupied** and **Away (held)**, the same as the dashboard's (they stay put while the
  plan moves between tabs);

- the live floor plan with taken desks in their project's colour. A floor with several zones is shown one zone at
  a time so it fills the screen (tabs **L1 · Digital Factory**, **L1 · Discussion Area**, **L1 · AI Lab**, then
  **Level 2**); only the display splits floors like this;
- a **Colleague Finder**: everyone who is checked in or has booked desks today, with their project and desk
  (floor and area underneath). Most people are simply at their desk; the others get a small tag by their name:
  **Away** (stepped away, desk held), **Not arrived** (checked in but not at the desk yet), **Reserved** (a
  reservation waiting for its check-in, with the time it is released) or **Booked for team** (one row per person
  who booked several desks). People who sit down without checking in are not listed;
- search by name, project or desk, and filters for project and floor. Tapping a name switches to their
  floor and makes their desk pulse.

After a minute without input it clears the search and runs on its own: it moves to the next tab every 20 seconds and
slowly scrolls the list, until someone touches it. Tune with `?idle=60&rotate=20` (seconds). `?theme=dark` (or the
moon button) suits a projector.

Because it shows names, it needs a key: set `DISPLAY_KEY` and open `/display?key=<DISPLAY_KEY>`. The key opens
only the display, nothing else. The admin token also works (the dashboard's **Floor display** link uses it); with
neither set (as in `npm run demo`), it is open like the dashboard.

## Insights: capacity and demand planning (simulated)

`/insights` (admin; **Insights** in the dashboard sidebar) is a planning board built entirely on **simulated data**.
It is labelled as such everywhere and is **not linked to the live system**: it reads only the building layout (zones,
seat counts, project names) and generates its own 16-week history, so live check-ins, sensors, projects and seat
allocations never change it (`src/insights.js`, served by `GET /api/insights`).

- **Capacity outlook** (the headline): weekly or daily peak seat demand, the last 8 weeks and a 12-week forecast with
  its likely range (P10–P90), against the seats and a 90% comfort line; cards for when capacity is reached, the seats
  needed to stay under 90%, the peak forecast, utilisation and the forecast's measured accuracy.
- **Project demand vs pre-allocated seats:** seats each project needs on its busiest day (P80) against a simulated
  pre-allocation, with the gap.
- **What-if planner:** change the seats, the headcount and the threshold, and see busy days over the threshold, people
  without a seat, and the seats needed.
- **Next 7 days hour by hour**, a **typical week** heatmap, **utilisation by zone** and **recommendations**.
- Every view can be narrowed to a floor or a zone (project demand is office-wide).

The simulation has team sizes that grow over time, weekday patterns per project, Singapore public and school holidays,
noise and occasional all-hands days. The forecast is a weekday pattern times a linear trend with holiday effects; its
accuracy is checked by forecasting the last 4 weeks from the weeks before (shown on the page). The data is regenerated
each day from a fixed seed. **How the simulation and forecasts work** at the bottom of the page explains it in full.

## Desk labels (QR codes)

Each desk gets a printable label with a QR code that opens its check-in page, plus the desk ID and location.
Labels are laid out for **A4 sheets of 21 labels (3 × 7, 63.5 × 38.1 mm, e.g. Avery L7160)**. Plain paper
works too (cut along the dashed guides shown on screen).

- **From the running app:** click **Print desk labels** on the dashboard, or open `/labels` (admin only).
  Filter with `/labels?floor=L1` or `/labels?floor=L1&zone=DF`. The QR codes use `PUBLIC_URL` if set,
  otherwise the address you opened the page at (in Codespaces that is the forwarded URL).
- **Simulate a scan:** on screen, clicking a label opens its check-in page in a phone-sized window.
- **Without a server:** `PUBLIC_URL=https://hotdesk.example.com npm run labels` writes
  `labels/desk-labels.html`. Open it in a browser and print at 100% scale (no "fit to page").

Print the labels only once the app has its permanent address. The QR codes contain that address, so a
Codespaces URL on a sticker stops working when the Codespace is deleted.

## Connecting sensors

Sensors report through a LoRaWAN network server (The Things Stack or ChirpStack) or any system that can POST
JSON. Each sensor is then linked to its desk. **Step-by-step guide: [docs/SENSORS.md](docs/SENSORS.md).**

- **Webhooks:** `POST /api/integrations/ttn` and `POST /api/integrations/chirpstack` (TTN / ChirpStack v4
  uplinks). Generic: `POST /api/sensors/events` with `{"sensorId": "...", "presence": true}`. All of them
  need the `X-Api-Key` header.
- **Linking:** open **Sensors** on the dashboard (`/sensors`). Link sensors as they start reporting, paste
  IDs per desk, or bulk-link from a `desk,sensor` CSV. Alternatively, name each device in the network
  server after its desk (e.g. `s-l1-df-01`) and it links itself.
- **Before hardware arrives:** a desk with no sensor (or only its placeholder ID `S-<desk>`) works as a
  QR check-in desk.

## Project layout

```
src/occupancy.js   rules engine: seat states, auto-release, sensor links, summaries (pure, clock-injectable)
src/integrations.js TTN / ChirpStack uplink parsing
src/labels.js      printable QR desk labels
src/server.js      HTTP API, SSE stream, static pages
src/store.js       JSON persistence
src/index.js       wiring + periodic sweep
public/index.html  admin dashboard (markup and styles)
public/dashboard.js admin dashboard (behaviour)
public/floorplan.js floor-plan layout and SVG drawing
public/checkin.html employee QR check-in page
public/sensors.html admin page for linking sensors to desks
scripts/simulate.js sensor/check-in simulator
scripts/codespace.sh starts/stops the app inside a GitHub Codespace (run automatically)
.devcontainer/     Codespaces configuration
docs/DESIGN.md     proposal & design
docs/SENSORS.md    connecting and linking sensors
docs/GITHUB.md     running on GitHub (CI, Codespaces)
docs/DEPLOY.md     production deployment to AWS from GitHub Actions
Dockerfile         container image
deploy/aws/        CloudFormation: hotdesk.yml (the app) and github-access.yml (one-time GitHub → AWS access)
```
