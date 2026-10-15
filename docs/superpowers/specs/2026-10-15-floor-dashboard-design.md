# Public Floor Dashboard — Design

**Date:** 2026-10-15
**Status:** For approval
**Scope:** Piece 4 of the seat booking programme (`2026-10-15-floorplan-publishing-design.md` §0). Public, no-sign-in **displays** for wall-mounted TVs: each display shows a chosen set of published floors drawn in style **E** (architectural plan with icons), live seat states with initials, per-floor and overall capacity, and today's seat activity on click. Admins configure displays; each has its own link so every location's TV shows only its own floors.

## 1. Why

A TV at each office shows, at a glance, how full the office is and where free seats are, and lets people identify who is sitting where. Different locations need different views (Office A's TV shows Office A's floors), and admins must be able to change what a TV shows without touching the TV.

## 2. Decisions

**Product owner (2026-10-15)**
- Shown on a **wall-mounted TV**: current capacity and live views of locations.
- **Admin-configurable**: which floor plans a display shows, with usage capacity per floor and an **overall** capacity/availability.
- **Different links for different locations** (e.g. Office A shows only Office A's floors).
- Drawing style **E**; seats **green** available, **amber** booked, **red** occupied, **grey** not bookable; **initials** on seats, full name on hover/click; clicking a seat shows **today's activity**; public; **today only**; names only.

**Builder's calls (approved with "proceed")**
- **Saved displays** with a short link `/display/<slug>` (e.g. `/display/office-a`), managed on a new admin page. The TV keeps one URL; admins change its content centrally.
- **Layout per display:** `rotate` (one floor at a time, every N seconds, default 20) or `grid` (all floors side by side). Default `rotate`.
- **Capacity** counts bookable (tagged) seats only: available, booked, occupied, and **occupancy %** = occupied ÷ bookable. Shown per floor and, if enabled, overall for the display.
- **Live updates:** the TV refreshes every 30 seconds; no sign-in, no interaction needed.
- Times on the TV use **Asia/Singapore** regardless of the device's time zone.
- The legacy Node-backed **Floor display** page is replaced by the admin **Displays** page (sidebar "Floor display"); the TV view has no sidebar.

## 3. Behaviour

**TV view (`/display/<slug>`, public, full screen)**
- **Header:** display name, current date and time (`dd/MM/yyyy HH:mm:ss`, ticking), "Updated HH:mm:ss".
- **Overall capacity** (if enabled): totals across the display's floors — bookable, available, booked, occupied, occupancy % with a bar.
- **Floor panel** per floor: floor name, its capacity line (same counts), and the drawing:
  - walls as thick lines, doors with a swing arc, windows as glass in the wall line;
  - tables (wood), sofas, lockers, plants drawn with icons; rooms (pantry, toilet, stairs, lift) as outlined boxes with an icon and name;
  - seats as circles in the state colour with a chair icon and the person's **initials** when booked/occupied;
  - legend: Available / Booked / Occupied / Not bookable.
- **Rotate layout:** one floor at a time, advancing every `rotate_seconds`; dots show which floor; a floor with no published version is skipped. **Grid layout:** all floors in a responsive grid.
- **Clicking/tapping a seat** (for touch TVs or a laptop): a panel with the seat label, department ("Free for all" / department name), state, who is on or booked, and **today's activity** (times + names). It closes after 20 seconds or on tap outside, and rotation pauses while it is open.
- **Errors:** unknown display → "Display not found"; a display whose floors are all unpublished → "No published floors for this display"; network loss → keeps the last data with "Offline — last updated HH:mm:ss" and retries.

**Admin page (`/displays`, admins; sidebar "Floor display")**
- List of displays: name, link, floors, layout; **Open** (new tab) and **Copy link**.
- Create / edit: **Name**; **Link name** (slug, lowercase letters, digits and dashes, unique; prefilled from the name); **Floors** (choose published or draft plans, ordered; drafts show as "not published" and are skipped on the TV); **Show overall capacity**; **Layout** (rotate / grid); **Seconds per floor** (10–120, rotate only). Delete with confirmation.

## 4. Data model

New script `sql/0018_dashboard_displays.sql`:

```sql
create table if not exists dashboard_displays (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name           text not null check (length(name) between 1 and 80),
  plan_ids       uuid[] not null default '{}',     -- ordered; unknown/deleted ids are skipped
  show_overall   boolean not null default true,
  layout         text not null default 'rotate' check (layout in ('rotate', 'grid')),
  rotate_seconds smallint not null default 20 check (rotate_seconds between 10 and 120),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

## 5. API

| Endpoint | Purpose |
|---|---|
| `GET /api/public/displays/<slug>` | Display config + ordered floors `[{id, name, published}]` (no sign-in). 404 if unknown. |
| `GET /api/public/floors/<plan_id>` | (exists) adds `summary: {bookable, available, booked, occupied, occupancy_pct}` and seat `department` names. |
| `GET /api/public/seats/<seat_id>/activity` | (exists) today's activity. |
| `GET/POST /api/admin/displays`, `PATCH/DELETE /api/admin/displays/<id>` | Admin CRUD with validation (slug format/unique 409, name, plan ids exist, layout, seconds). Audit `display.create/update/delete`. |

**Backend hardening needed by polling TVs** (deferred minors from piece 3's review):
- `settle()` must not fail requests when two TVs settle at once: lock rows in a fixed order (`FOR UPDATE SKIP LOCKED`, ordered by id) and, on a database conflict, roll back and continue (settle is idempotent).
- The "now" seat state must include the block that is in progress (floor `now` to the 30-minute boundary), so a seat held for its last half hour shows **booked**, not available.

## 6. Frontend

- New `src/display/`: `DisplayPage.jsx` (TV route, outside the signed-in shell), `FloorDrawing.jsx` (style E renderer from the published elements + catalog, inline SVG icons — no new dependency), `CapacityBar.jsx`, `SeatPopover.jsx`; `src/pages/displays/DisplaysPage.jsx` (admin list/editor).
- Routes: `/display/:slug` public; `/displays` admin; sidebar "Floor display" → `/displays`; remove the legacy `FloorDisplayPage` and its Node calls.
- Pure helpers (`capacity(seats)`, `overall(floors)`, `nextFloorIndex`, `slugify`, SG-time formatting) covered by a smoke script.

## 7. Non-goals and anti-goals

**Non-goals:** booking or checking in from the TV; showing other days; statistics/history (piece 5); per-display branding/themes; dark mode (style F was not chosen); replacing the legacy home "Floor plan" page.

**Anti-goals:** showing anything beyond full names publicly; a TV that goes blank on a short network loss; a display link that silently shows another location's floors; a seat shown as free while it is held.

## 8. Testing

- Backend (local PostgreSQL): display CRUD validation (slug format/uniqueness, seconds range, unknown plan ids); public display endpoint (ordered floors, unpublished flagged, 404); floor `summary` counts across states; current-block state (seat booked for its last half hour shows booked); `settle()` tolerates a concurrent call (two sessions settling the same due rows → no error).
- Frontend: smoke tests for capacity/overall/rotation/slugify/SG time helpers; build; manual check on a TV/browser at `/display/<slug>`.
