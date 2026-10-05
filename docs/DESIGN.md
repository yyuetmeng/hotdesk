# Hot Desk Seat Monitoring: Proposal & Design

## 1. Problem

The company is moving to hot desking. We need to:

1. Know, in near real time, whether each desk is **taken**.
2. Automatically show a desk as **available again** once the person is no longer using it
   (no "ghost" desks held by a jacket on the chair or a forgotten booking).
3. Give administrators an **overall dashboard** of seat availability and utilisation.

## 2. How we detect whether a seat is taken

No single signal is both reliable and cheap, so the proposal combines a **primary automatic signal**
with a **manual fallback**, and uses **time-based rules** to decide when a seat is free again.

### 2.1 Primary: under-desk presence sensors (recommended)

A small battery-powered sensor is mounted under each desk. Suitable off-the-shelf types:

| Sensor type | How it works | Pros | Cons |
|---|---|---|---|
| **PIR + thermal (recommended)** | Detects body heat / micro-movement at the desk | Anonymous, 3–5 yr battery, ~US$40–80/desk, ignores bags & coats | Very still users need a thermal (not pure PIR) model |
| Pressure pad on chair | Detects weight on the seat | Very accurate for "sitting" | Chairs move between desks, wear & tear |
| Monitor/dock connection | Docking station reports when a laptop is plugged in | Reuses existing hardware | Misses people who don't dock; needs IT integration |
| Ceiling people-counting camera/radar | One device covers many desks | Fewer devices | Privacy concerns, higher cost, harder to map to a single desk |

Sensors report over **LoRaWAN or BLE** to a gateway on each floor. The gateway forwards readings to this
application's webhooks (TTN, ChirpStack, or the generic `POST /api/sensors/events`). Each reading becomes
`{ sensorId, presence, at }`, and an admin links each sensor ID to its desk on the Sensors page
(see [SENSORS.md](SENSORS.md)).
Sensors also send periodic heartbeats (every 5–10 min) so we can tell a quiet desk from a dead sensor.

**Privacy:** sensors only report "someone is / is not at desk X". No camera, no identity. Identity is only
known if the person voluntarily checks in.

### 2.2 Fallback: QR code check-in

Every desk has a QR sticker that opens `/checkin?seat=<id>` on the employee's phone. The stickers are printed
from the admin dashboard (**Print desk labels**, see the README). It's used for:

- Areas where sensors are not installed yet.
- Desks whose sensor is offline.
- Letting colleagues and facilities know *who* is at a desk (optional).

In production the name field would come from company SSO instead of free text.

### 2.3 Rules for "taken" vs "available" (auto-release)

Each seat is always in one of four states:

| State | Meaning | Shown to admin as |
|---|---|---|
| **Occupied** | Presence detected now, or a fresh check-in | Blue ● |
| **Away (held)** | Person was there but has stepped away for less than the grace period (lunch, meeting) | Amber … |
| **Available** | Nobody there and the grace has expired, or the person checked out | Green ✓ |
| **Sensor offline** | Sensor silent too long and no check-in; needs maintenance | Grey ! |

The time rules (all configurable via environment variables):

| Rule | Default | Effect |
|---|---|---|
| `AWAY_GRACE_MINUTES` | 20 | Presence lost for longer than this → seat released automatically |
| `CHECKIN_CONFIRM_MINUTES` | 15 | A QR check-in on a sensor desk must be confirmed by presence within this time, or it's released (stops people "reserving" by scanning and walking away) |
| `CHECKIN_DURATION_MINUTES` | 180 | Every check-in lasts 3 hours by default (the user may choose 1–8 h). It expires at the end unless renewed by scanning again. On sensor desks, live presence keeps the desk occupied after that |
| `SENSOR_OFFLINE_MINUTES` | 15 | No reading for this long → sensor considered offline |

Other rules:

- **"I'm leaving" / checkout** releases the desk immediately, skipping the away grace.
- **One desk per person**: checking in somewhere else releases your previous desk.
- A desk actively held by someone else can't be checked into (HTTP 409).
- Out-of-order or duplicate sensor readings are ignored.

```
            presence=true                   presence=false
 AVAILABLE ───────────────▶ OCCUPIED ─────────────────────▶ AWAY
     ▲                        ▲  │                           │
     │                        │  └── checkout ──────────────┐│
     │                        └──── presence=true ──────────┼┘ (back within grace)
     └────────────── grace expired / checkout ◀──────────────┘
```

## 3. Architecture

```
 [Desk sensors] --LoRaWAN/BLE--> [Floor gateway] --HTTPS + API key--> ┐
                                                                      │
 [Employee phone: QR check-in page] --HTTPS----------------------->  [Hot Desk service]
                                                                      │  - rules engine (src/occupancy.js)
                                                                      │  - REST API + Server-Sent Events
                                                                      │  - periodic sweep (every 15s) for auto-release
                                                                      │  - state persisted to JSON (swap for Postgres/Redis)
                                                                      ▼
                                                   [Admin dashboard (browser, live via SSE)]
```

- **Rules engine** (`src/occupancy.js`): the seat state is derived by a *pure function* of the last sensor
  reading, the last check-in and the current time. That makes it easy to test and means a restart can't
  leave a seat stuck: state is re-derived on load.
- **Sweep**: every 15 s the service re-evaluates all seats, performs auto-releases, pushes changes to
  dashboards and records a one-minute occupancy sample (24 h kept) for the trend chart.
- **Live updates**: the dashboard subscribes to `/api/stream` (Server-Sent Events), so desks change colour
  within a second of a sensor reading.

## 4. Administrator dashboard

`/` (protected by `ADMIN_TOKEN`) shows:

- **KPI tiles**: occupancy rate, available / occupied / away / offline counts.
- **Live floor plan**: every desk by floor and zone, colour **and** symbol coded, with a floor switcher and
  status filter. Hover or focus a desk to see who checked in, sensor state, when it was last used, and
  when it will auto-release.
- **Occupancy trend** over the last 24 h.
- **Utilisation by zone** table, which helps right-size the number of desks per team.
- **Recent activity** feed (check-ins, checkouts, auto-releases, status changes).
- Optional **team assignment** view and **utilisation by team**: shown only if the layout assigns desks to
  teams, so admins can see whether a team's block is under- or over-used. The current layout has no teams.

## 5. API

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/sensors/events` | Gateway (`X-Api-Key`) | One reading or an array of `{sensorId, presence?, at?}`; omit `presence` for a heartbeat |
| `POST /api/integrations/ttn` | The Things Stack webhook (`X-Api-Key`) | Uplink messages; DevEUI or device ID identifies the sensor |
| `POST /api/integrations/chirpstack?event=up` | ChirpStack v4 HTTP integration (`X-Api-Key`) | Uplink events; other event types ignored |
| `GET /api/sensors` | Admin | Every desk's sensor link and health, plus sensors reporting without a desk |
| `POST /api/sensors/links` | Admin | Bulk link `[{seatId, sensorId}]` (null unlinks) |
| `PUT /api/seats/:id/sensor` | Admin | Link one desk: `{sensorId}` |
| `GET /api/availability?floor=` | Employees | Seat statuses, with no personal data |
| `GET /api/seats/:id` | Employees | One seat's status |
| `POST /api/seats/:id/checkin` | Employees | `{user, projectTeam, minutes?}`. The project team is required |
| `POST /api/seats/:id/checkout` | Employees | `{user, projectTeam}`. The project team is required |
| `GET /api/project-teams` | Employees | The project teams to choose from |
| `GET /api/project-teams/summary` | Admin | Per project team: checked in now, today's check-ins/outs, requesters |
| `GET /api/requesters.csv` | Admin | Requesters with project team, desk and check-in history |
| `GET /api/summary` | Admin | Totals per building / floor / zone |
| `GET /api/seats?floor=&zone=&status=` | Admin | Full seat details including who checked in |
| `GET /api/history` | Admin | Per-minute occupancy samples, 24 h |
| `GET /api/activity` | Admin | Latest 100 events |
| `GET /api/stream` | Admin | Server-Sent Events: `snapshot`, then `seat` changes |

Admin endpoints accept `Authorization: Bearer <ADMIN_TOKEN>` or `?token=`.

## 6. Rollout plan

1. **Pilot (1 floor, ~4 weeks):** install sensors on one floor and put QR stickers on every desk. Tune the
   grace periods against real behaviour.
2. **Building rollout:** add gateways per floor and move persistence to a database (Postgres) behind
   the same `JsonStore` interface.
3. **Integrations:** SSO for check-in, a Teams/Slack "find me a desk" bot backed by `/api/availability`,
   lobby screens showing free desks per floor, and export of utilisation reports for space planning.

## 7. Production hardening checklist

- Replace the free-text name with SSO (OIDC) and give admins role-based access instead of a shared token.
- Serve over HTTPS behind the corporate reverse proxy. Rotate `SENSOR_API_KEY` per gateway.
- Move persistence to Postgres or Redis if running more than one instance, and use a pub/sub for SSE fan-out.
- Alert facilities when sensors go offline or batteries run low (most sensors report battery level).
- Data retention: keep only aggregated utilisation long term. Purge check-in names daily.
