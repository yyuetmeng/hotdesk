# Floor Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can draw named zone outlines on a floor plan. Seats inside an outline belong to that zone. Zones show on the floor drawings with "N of M free", and Insights gets a live "Utilisation by zone" card.

**Architecture:**
- A zone is a new catalog element type, `zone`, stored like any placed element: draft rows, plus snapshot rows on publish.
- Zones live on their own layer. They may overlap non-zone elements, but not each other.
- Membership and counts are computed in one backend function, `zone_summary`, from published element positions and the existing `seat_states`. The floor payloads and the admin Insights endpoint both use it, so the numbers can't disagree.

**Tech Stack:** Flask + SQLAlchemy 2.0 ORM; React 19 + Vite; pytest on local Postgres; node smoke scripts for pure frontend logic.

**Spec:** `docs/superpowers/specs/2026-10-15-floor-zones-design.md`

## Global Constraints

- Catalog type name: `zone`. Palette label: `Zone`.
- Zone size: 1 to 80 cells per side. Every other type keeps `MAX_ELEMENT_SIZE` = 20.
- Zones never share a cell with another zone. They may cover any non-zone element. Non-zone elements still never overlap one another.
- Zone rotation is always 0.
- A seat is in a zone when `zx <= x < zx + w` and `zy <= y < zy + h`. Membership is never stored.
- A zone's name is its label, stripped, or `"Unnamed zone"` when the label is empty.
- A seat is usable when its state is not `not_bookable` (state rule, spec §5).
- Counts per row: total = usable seats; free = `available`; occupied = `occupied`; booked = `booked`. pct = `round(100 * (occupied + booked) / total)`, or `None` / "—" when total is 0.
- Row names: `"No zone"` holds the usable seats outside every zone, on a floor that has zones, and is listed last for that floor. `"Whole floor"` is the single row for a floor with no zones.
- Card copy:
  - Title: "Utilisation by zone".
  - Subtitle: "Free seats and how the rest are used, per zone."
  - Freshness note: "Live · updated HH:MM", in Singapore time.
  - Legend: "Occupied (checked in)" and "Booked, not yet checked in".
  - Empty state: "No zones yet. Draw zones in Manage Floor Plan and publish."
- The card refreshes every 30 s. "Right now" means `seat_states(plan, today, None, now)`.
- Tests run only against local Postgres (`TEST_DATABASE_URI` from `webapp-backend/.env`). Never run two pytest sessions at once.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.

## Review Focus

1. A seat on the zone's last row or column is inside, and the next cell is outside. That edge is where an off-by-one would show. Tested in Task 2 (`test_zone_summary_edges`).
2. A floor's grid is shrunk so an existing zone would stick out. The save must be refused, the same as for any element. Tested in Task 1 (`test_shrinking_grid_rejects_zone_outside`).
3. A seat that lost its tag but still has an open check-in counts as occupied in its zone, matching Book a desk. Tested in Task 3 (`test_insights_untagged_occupied_seat_counts`).
4. Draft-only zones and unpublished plans are not counted on Insights. Tested in Task 3 (`test_insights_ignores_drafts_and_unpublished`).
5. A zone with an empty label shows as "Unnamed zone" everywhere. Tested in Task 2 (`test_zone_summary_unnamed`) and covered by the Task 4 smoke.

---

### Task 1: Zone catalog type and save validation

**Files:**
- Create: `webapp-backend/sql/0020_floor_zones.sql`
- Modify: `webapp-backend/app/admin/floorplans.py` (`_base_size`, `_validate_elements`)
- Test: `webapp-backend/tests/test_floor_zones.py`

**Interfaces:**
- Produces: catalog row `('zone', 'Zone', 6, 4, '#3b82f6', true, '{}', 120)`, and `ZONE_TYPE = "zone"` in `app/admin/floorplans.py`.

- [ ] **Step 1: Write the failing tests** in `tests/test_floor_zones.py`. Use the `client` and `db` fixtures and the `hdr` / `_login` / `_user` helpers from `desk_helpers` to create an admin and a 30×30 plan.
  - `test_zone_in_catalog`: GET `/api/admin/floor-plans/catalog` contains `type == "zone"` with `resizable` true.
  - `test_zone_may_surround_seats`: PUT elements `[zone x0 y0 w10 h10 label "AI Lab", seat x2 y2, table x4 y4 w2 h1]` → 200.
  - `test_zone_larger_than_20`: zone `w=30, h=25` on the 30×30 plan → 200. A table with `w=21` → 400, message contains `"between 1 and 20"`.
  - `test_zones_may_not_overlap`: two zones sharing one cell → 400, message contains `"(zone) overlaps element 0"`.
  - `test_zone_rotation_refused`: zone with `rotation: 90` → 400, message contains `"zones cannot be rotated"`.
  - `test_shrinking_grid_rejects_zone_outside`: save zone x0 y0 w25 h5, then PATCH the plan to `cols=20` → 400. This is the existing outside-the-grid path, so check the message names `zone`.
  - `test_zone_snapshot_on_publish`: save zone + seat, publish, GET the published version. The zone element is present with its label, w and h.

- [ ] **Step 2: Run** `python -m pytest -q -p no:cacheprovider tests/test_floor_zones.py`
  Expected: FAIL. The catalog has no `zone` (unknown type / missing row).

- [ ] **Step 3: Write `sql/0020_floor_zones.sql`**, re-runnable:
  - Insert the catalog row above with `on conflict (type) do nothing`.
  - On `floor_plan_elements`, run `drop constraint if exists` for the w and h checks, then add `check (w between 1 and 80)` and `check (h between 1 and 80)`.
  - Find the actual constraint names with `select conname from pg_constraint where conrelid = 'floor_plan_elements'::regclass`. They are expected to be `floor_plan_elements_w_check` / `_h_check`. Ledger a ruling if they differ.

- [ ] **Step 4: Change `floorplans.py`:**
  - `_base_size` caps zones at `MAX_DIM` (80) and other types at `MAX_ELEMENT_SIZE`. The message stays `"w and h must be between 1 and {cap}"`.
  - In `_validate_elements`:
    - A `zone` with rotation ≠ 0 adds `"element {i}: zones cannot be rotated"`.
    - Overlap tracking uses two maps, `seen` for non-zones and `seen_zones` for zones. Each element checks and fills only its own layer's map.

- [ ] **Step 5: Run** the Step 2 command, then `tests/test_admin_floorplans.py tests/test_floorplan_publishing.py`
  Expected: all PASS.

- [ ] **Step 6: Apply to the app DB and commit.**
  - Run `.superpowers/tools/apply_sql.py "<backend dir>" 0020_floor_zones.sql`.
  - Run `git add sql/0020_floor_zones.sql app/admin/floorplans.py tests/test_floor_zones.py`.
  - Commit with `feat: add zone element type to floor plans`.

### Task 2: `zone_summary` and zones on the floor payloads

**Files:**
- Create: `webapp-backend/app/desk/zones.py`
- Modify: `webapp-backend/app/desk/routes.py` (`floor`) and `webapp-backend/app/public/routes.py` (`floor`)
- Test: `webapp-backend/tests/test_floor_zones.py`

**Interfaces:**
- Consumes: `seat_states(...)` dicts (`id`, `x`, `y`, `state`) and published `FloorPlanVersionElement`s.
- Produces: `zone_summary(elements, seats) -> list[dict]`, rows ordered as described below. Each row has these keys:
  - `id` (str | None) and `name`
  - `x`, `y`, `w`, `h`, `color` (`None` for the No zone / Whole floor rows)
  - `total`, `free`, `occupied`, `booked`
  - `pct` (int | None)

  The order is real zones by `name.casefold()`, then `"No zone"` only if some usable seat is outside every zone. A floor with no zones gets a single `"Whole floor"` row, even at 0/0. Both floor endpoints add `zones=[z for z in zone_summary(...) if z["id"]]`.

- [ ] **Step 1: Write the failing tests.** Pure tests build fake elements with `types.SimpleNamespace(type=, x=, y=, w=, h=, label=, color=, element_id=)` and seat dicts.
  - `test_zone_summary_edges`:
    - A zone at x2 y2 w3 h2. Seats at (4,3) and (2,2) are inside; seats at (5,3) and (4,4) are outside.
    - The states are available, occupied, booked and available.
    - Expected rows: zone total 2, free 1, occupied 1, pct 50. Then `No zone` with total 2, free 1, booked 1, pct 50.
  - `test_zone_summary_not_bookable_excluded`: a `not_bookable` seat inside a zone doesn't count. A zone whose only seat is not bookable gives total 0 and pct `None`.
  - `test_zone_summary_unnamed`: labels `None` and `"  "` give name `"Unnamed zone"`.
  - `test_zone_summary_whole_floor`: no zones and 3 usable seats → one row, `name == "Whole floor"`, total 3.
  - `test_floor_payload_has_zones`: use `build_world`, then republish the plan with a zone covering F1 and F2 (x0 y0 w4 h1).
    - GET `/api/public/floors/<plan>` gives `zones == [{... "name": "Z", "total": 2, "free": 2 ...}]`.
    - GET `/api/desk/floors/<plan>` (signed in as jane) gives the same `zones`.

- [ ] **Step 2: Run** `pytest tests/test_floor_zones.py -k "summary or payload"`
  Expected: FAIL with an ImportError for `app.desk.zones`.

- [ ] **Step 3: Implement `zone_summary` in `app/desk/zones.py`.** A zone is an element with `type == "zone"`. For pct use the same `round` as `public.routes.capacity`. Then add `zones` to both floor responses.

- [ ] **Step 4: Run** `pytest tests/test_floor_zones.py tests/test_desk_public.py`
  Expected: PASS.

- [ ] **Step 5: Commit** with `feat: count seats per zone on floor payloads`.

### Task 3: Admin Insights endpoint

**Files:**
- Create: `webapp-backend/app/admin/insights.py` (registered in `app/admin/__init__.py`)
- Test: `webapp-backend/tests/test_floor_zones.py`

**Interfaces:**
- Consumes: `zone_summary`, `service.published_floors()`, `service.seat_states`, `rules.now()`, `rules.local_today`.
- Produces: `GET /api/admin/insights/zones`, decorated `@admin_required`. It returns `{"now": iso, "has_zones": bool, "rows": [...]}`.
  - Each row is `{"plan_id", "level", "zone_id", "name", "total", "free", "occupied", "booked", "pct"}`.
  - `level` is the published version name. Floors are ordered by `level.casefold()`, and each floor's rows keep `zone_summary`'s order.
  - `has_zones` is true when any published floor has a zone.

- [ ] **Step 1: Write the failing tests:**
  - `test_insights_zones_rows`:
    - Set up with `build_world` and a republish with zone "Z" over F1 and F2.
    - Jane books F1 for AM; at `sg(DAY, 9)` carl checks in to E1.
    - GET as root, at `sg(DAY, 9)`. The rows are `[Z: total 2, free 1, booked 1, pct 50]`, then `No zone: total 1 (E1), occupied 1, pct 100`. `has_zones` is true.
  - `test_insights_requires_admin`: as jane → 403.
  - `test_insights_whole_floor_and_empty`:
    - With `build_world` and no zones, `has_zones` is false and there is one `Whole floor` row, total 3.
    - With no published plans, `rows == []`.
  - `test_insights_untagged_occupied_seat_counts`:
    - Carl checks in to E1, then republish with E1's tag removed, inside a zone.
    - If `cancel_for_plan_change` ends that check-in, assert the seat is then excluded, and ledger which branch applied.
    - Otherwise the zone row shows occupied 1, total 1.
  - `test_insights_ignores_drafts_and_unpublished`:
    - A zone saved to the draft but not published doesn't appear.
    - After unpublishing, the floor disappears from `rows`.

- [ ] **Step 2: Run** `pytest tests/test_floor_zones.py -k insights`
  Expected: FAIL with 404 on the route.

- [ ] **Step 3: Implement the endpoint.**

- [ ] **Step 4: Run** `pytest tests/test_floor_zones.py`
  Expected: PASS.

- [ ] **Step 5: Commit** with `feat: admin endpoint for utilisation by zone`.

### Task 4: Editor logic for zones

**Files:**
- Modify: `webapp-frontend/src/floorplan/palette.js`, `webapp-frontend/src/floorplan/logic.js`, `webapp-frontend/src/floorplan/selection.js`
- Test: `webapp-frontend/scripts/smoke_floorplan_logic.mjs` (append)

**Interfaces:**
- Produces:
  - `isZone(el)` (selection.js).
  - `maxSizeFor(type) -> number` (palette.js): 80 for `zone`, `MAX_ELEMENT_SIZE` otherwise.
  - `zoneName(el) -> string` (logic.js): the stripped label, or `'Unnamed zone'`.
  - `seatsInZone(elements, zone) -> string[]` (logic.js).
  - Layer-aware `placementError`, `validateAll`, `resizeElement` and `rotateElement`. `rotateElement` on a zone returns the error `'zones cannot be rotated'`.

- [ ] **Step 1: Append failing assertions** to the smoke script. Call `setCatalog` with a catalog that includes `{type:'zone', w:6, h:4, resizable:true}`.
  - A seat placed inside an existing zone → `placementError` is null.
  - A zone overlapping another zone → `'overlaps another element'`.
  - `resizeElement` of a zone to 30×25 on a 40×40 grid works. A table at 21 fails.
  - `seatsInZone` uses the edge cases from Task 2 Step 1.
  - `zoneName({label:'  '}) === 'Unnamed zone'`.
  - `validateAll` with a zone over a seat returns no problems.

- [ ] **Step 2: Run** `node scripts/smoke_floorplan_logic.mjs`
  Expected: FAIL (missing exports).

- [ ] **Step 3: Implement the changes.**

- [ ] **Step 4: Run** the smoke script again.
  Expected: it prints `floorplan ctrl-click smoke OK` and then a new line, `floorplan zones smoke OK`.

- [ ] **Step 5: Commit** with `feat: zone placement rules in the floor plan editor`.

### Task 5: Editor UI for zones

**Files:**
- Modify: `webapp-frontend/src/floorplan/EditorPage.jsx`, `webapp-frontend/src/floorplan/floorplan.css`

**Interfaces:**
- Consumes: Task 4 exports.

- [ ] **Step 1: Render zones before the other elements**, sorted to the front of the array.
  - The zone `div` has `pointer-events: none`, a 1.5px border in its colour, and a faint fill (colour at about 8% alpha). Its contents:
    - A `.fp-zone-label` chip in the top-left corner showing `zoneName(el)` and `"N seats"` (from `seatsInZone`).
    - Four `.fp-zone-edge` strips, 6px wide, along the border.
  - The chip and the strips set `pointer-events: auto` and carry the element's existing `draggable`, `onDragStart`, `onClick` and tooltip handlers. Press-drag inside the zone therefore reaches `onGridPointerDown`, so box-select keeps working.
- [ ] **Step 2: In the selected-element panel**, a selected zone shows:
  - Name (the label input).
  - An outline colour picker with the swatches `#3b82f6`, `#10b981`, `#8b5cf6`, `#f59e0b`, `#ef4444` and `#64748b`.
  - "Seats inside: N (automatic)".
  - The existing width and height inputs, limited by `maxSizeFor`.

  Hide the rotate button for zones, and make the R key a no-op on them. Update the hint text with: "Zones: drag by the outline or name."
- [ ] **Step 3: Verify.**
  - Run `npm run build`; expected `✓ built`. Also run `node scripts/smoke_floorplan_logic.mjs`.
  - Manual check in `npm run dev`:
    - Draw a 12×8 zone around seats.
    - Box-select the seats inside it.
    - Drag the zone by its label.
    - Save and publish.

  Ledger whether the manual check was done.
- [ ] **Step 4: Commit** with `feat: draw and edit zones in the floor plan editor`.

### Task 6: Zones on Book a desk and the floor display

**Files:**
- Modify: `webapp-frontend/src/desk/FloorView.jsx`, `webapp-frontend/src/desk/desk.css`, `webapp-frontend/src/display/FloorDrawing.jsx`, `webapp-frontend/src/display/display.css`
- Add: `zoneCaption(zone) -> string` to `webapp-frontend/src/desk/deskLogic.js`. It returns `"N of M free"`, or `''` when `total` is 0. Smoke assertions go in `scripts/smoke_desk_logic.mjs`.

**Interfaces:**
- Consumes: `floor.zones` from Task 2.

- [ ] **Step 1: Add smoke assertions:** `zoneCaption({free:16,total:16}) === '16 of 16 free'` and `zoneCaption({free:0,total:0}) === ''`. Run them and confirm they fail.
- [ ] **Step 2: Draw zones on both floors.**
  - In `FloorView`, skip `type === 'zone'` in `floor.elements`. Draw each `floor.zones` entry first as an absolutely positioned outline with the name and `zoneCaption`. It is not clickable.
  - In `FloorDrawing`, draw each zone first as an SVG `rect` with stroke in its colour and low-opacity fill, plus two `text` lines in the top-left corner. Also exclude `zone` from the `Element` path.
- [ ] **Step 3: Verify.** Run `node scripts/smoke_desk_logic.mjs && node scripts/smoke_display_logic.mjs && npm run build`; all should pass.
- [ ] **Step 4: Commit** with `feat: show zones on booking and display floors`.

### Task 7: "Utilisation by zone" card on Insights

**Files:**
- Create: `webapp-frontend/src/pages/insights/ZoneUtilisationCard.jsx`, `webapp-frontend/src/pages/insights/zoneLogic.js`, `webapp-frontend/scripts/smoke_insights_logic.mjs`
- Modify: `webapp-frontend/src/pages/insights/InsightsPage.jsx` (render the card above the existing content), plus styles in `webapp-frontend/src/styles.css` or a new `insights.css`
- Modify: `README.md` / docs, if the floor-plan docs list element types. Add one line about zones.

**Interfaces:**
- Consumes: `GET /api/admin/insights/zones` from Task 3.
- Produces:
  - `barWidths(row) -> {occupied: string, booked: string}`, as percentages of total; both `'0%'` when total is 0.
  - `pctText(row) -> string`: `'44%'`, or `'—'` when `pct` is null.

- [ ] **Step 1: Write the smoke script.**
  - `barWidths({total:36, occupied:12, booked:4})` gives `{occupied:'33.33%', booked:'11.11%'}`. Round to 2 decimals.
  - `pctText({pct:null}) === '—'`.
  - `pctText({pct:44}) === '44%'`.

  Run it and confirm it fails.
- [ ] **Step 2: Implement `zoneLogic.js` and the card.**
  - The card fetches with `flaskRequest` on mount and every 30 s, and clears the interval on unmount.
  - It shows the copy from Global Constraints. The time comes from `sgTime(now).slice(0, 5)` (`display/displayLogic.js`).
  - The empty state appears when `has_zones` is false and `rows` is empty. It links to `/floor-plans`.
  - A fetch error shows `<Notice kind="error">` and keeps the last rows.
  - The table columns are ZONE (name, with `level` in `<small>`), FREE (green free, then ` / total`), IN USE (bar) and pct.
  - The bar colours are occupied `#3b82f6` and booked `#f59e0b`.
- [ ] **Step 3: Verify.** Run `node scripts/smoke_insights_logic.mjs && npm run build`.
- [ ] **Step 4: Commit** with `feat: utilisation by zone card on Insights`.

### Final

- Run the full backend suite once (about 10 minutes) and all four smoke scripts. Then do the whole-branch review per executing-plans.
