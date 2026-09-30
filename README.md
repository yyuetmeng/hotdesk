# Hot Desk Monitor

Monitors which desks in a building are taken, automatically frees desks when people stop using them,
and gives administrators a live dashboard of seat availability.

- **Detection:** under-desk presence sensors (primary) plus QR-code check-in (fallback / sensorless areas).
- **Auto-release:** a desk whose occupant has been gone longer than a grace period (default 20 min)
  becomes available again. Unconfirmed or expired check-ins are released too.
- **Admin dashboard:** live floor plan, KPIs, 24 h occupancy trend, per-zone utilisation, activity feed.

![Admin dashboard](docs/dashboard.png)

The full proposal (sensor options, state rules, architecture, rollout) is in [docs/DESIGN.md](docs/DESIGN.md).

## Quick start

Requires Node.js 20.11 or newer. There are no npm dependencies.

```bash
npm start                    # http://localhost:3000  (admin dashboard)
npm run simulate             # in a second terminal: fake sensors + check-ins
npm test
```

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
| `CHECKIN_TTL_MINUTES` | 240 | How long a check-in lasts on a desk with no working sensor |
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

Each zone is an ASCII `map`, one string per row of desks: a space is no desk (aisle or pod gap), `.` is
an unassigned hot desk, and a letter assigns the desk to a team defined under `"teams"`. The team
colours match the coloured blocks in the deck. The deck has no legend, so the teams are named by
colour (e.g. "Amber team"). **Rename them in `building.json` to the real team names.**

```json
"map": [
  "mm lc gg",
  "mm lc gg",
  "mm ll gg",
  "",
  "rr cc ll"
]
```

Desk IDs are `<floor>-<zone>-<nn>`, numbered in reading order (left to right, top to bottom, e.g.
`L1-DF-01`). Sensor IDs are `S-<deskId>`. For QR-only areas, set `"sensors": false` on a zone or list
desk IDs in `"sensorless"`. A zone can also use plain `"rows"`/`"cols"` instead of a `map`.

The dashboard's **Team assignment** view colours desks by team, the same way as the deck. The symbol on
each desk still shows its live status. A team filter and a per-team utilisation table show how well
each team's allocated desks are used.

The latest revision of the deck blanks out the Level 2 UAT Stations block, so it is no longer part of the
layout. Level 2 now has only the General Office.

## Sending sensor data

```bash
curl -X POST localhost:3000/api/sensors/events \
  -H 'content-type: application/json' -H "x-api-key: $SENSOR_API_KEY" \
  -d '[{"sensorId":"S-L1-A-01","presence":true},{"sensorId":"S-L1-A-02"}]'
```

Omit `presence` for a heartbeat. `at` (an ISO timestamp) is optional and is used to discard out-of-order readings.

## Project layout

```
src/occupancy.js   rules engine: seat states, auto-release, summaries (pure, clock-injectable)
src/server.js      HTTP API, SSE stream, static pages
src/store.js       JSON persistence
src/index.js       wiring + periodic sweep
public/index.html  admin dashboard
public/checkin.html employee QR check-in page
scripts/simulate.js sensor/check-in simulator
docs/DESIGN.md     proposal & design
```
