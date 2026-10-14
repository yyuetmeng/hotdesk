# Floor Plan Catalog and Editor Enhancements — Implementation Plan (as built)

> **Record of completed work.** Written after implementation to document what changed, task by task. All tasks are done; use `superpowers:writing-plans` for new work.

**Goal:** Move the floor plan element catalog into the `floor_elements` table, update its contents, add per-element size and settings (seat "Allow booking"), and improve labels, colours and tooltips in the editor.

**Spec:** `docs/superpowers/specs/2026-10-14-floorplan-catalog-and-editor-design.md`

**Commits:** `6094b61` (token fix), `d71af4c` (everything else; the features share files, so they were committed together).

## Global Constraints

- Backend commands from `webapp-backend/`, frontend commands from `webapp-frontend/`.
- Schema changes are new numbered, idempotent scripts in `sql/`; never edit an applied one.
- The catalog must not be hard-coded in Python or JavaScript after Task 6.
- Gates: `python -m pytest -q tests/test_admin_floorplans.py tests/test_floorplan_schema.py tests/test_sql_schema.py`, `node scripts/smoke_floorplan_logic.mjs`, `npm run build`.

---

### Task 1: Fix floor plan auth after the frontend merge — `6094b61`

- [x] `src/api.js`: export `AUTH_TOKEN_KEY = 'hotdesk.auth.token'`; `readFlaskToken()` reads it from `sessionStorage`; remove the `?flask_token=` / `hotdesk.flask_token` path.
- [x] `src/auth.jsx`: use `AUTH_TOKEN_KEY` instead of its own string.
- [x] Verify: build green; Vite proxy returns Flask's 401 for missing/bad tokens.

### Task 2: Catalog contents

- [x] Rename `kitchen` → `pantry` (label "Pantry"); add `table` 2×1 `#ca8a04`, `stairs` 2×2 `#ea580c`, `window` 1×1 `#7dd3fc`; remove `meeting_room`.
- [x] `sql/0009_rename_kitchen_to_pantry.sql`, `sql/0010_remove_meeting_room.sql` (product owner chose deletion of saved meeting rooms).
- [x] Rotation tests switched from `meeting_room` (3×2) to `table` (2×1), the only non-square type left.
- [x] README element list and setup step ("run every `sql/*.sql` in order").

### Task 3: Editor labels and colours

- [x] Grid shows `el.label` only (no fallback to the type name).
- [x] 31 swatches, **Custom** `<input type="color">`, **Default** (sets `color: null`).
- [x] Label layer `.fp-el-label`: sized to the unrotated footprint, `rotate(<rotation>deg)`, centred with flexbox.
- [x] Element background set via `backgroundColor` (so CSS stripe patterns are not overridden).

### Task 4: Per-element settings (seat "Allow booking")

- [x] `sql/0011_floor_plan_element_config.sql`: `floor_plan_elements.config jsonb not null default '{}'`.
- [x] Backend validation of `config` (object, known keys, value types); defaults merged on save and in responses.
- [x] Editor: settings checkboxes; striped `.not-bookable` seats.
- [x] Tests: defaults + round-trip; invalid config cases.
- [x] Applied `0009`–`0011` to the app database (`public`) after the running API failed with `column floor_plan_elements.config does not exist`.

### Task 5: Per-element size

- [x] Backend: `_base_size()` (own `w`/`h` or catalog default; integers 1–20; fixed types must keep the default); bounds, overlap and grid-shrink checks use each element's size.
- [x] Frontend: `baseSize`, `sizeOf`, `isResizable`, `MAX_ELEMENT_SIZE` in `palette.js`; `resizeElement` in `logic.js`; `SizeFields` (Width, Height, Reset size, inline error) in `EditorPage.jsx`.
- [x] Seats fixed at 1×1 (product owner decision).
- [x] Tests: custom sizes saved and used for bounds and grid shrink; size rules; smoke cases for resize, rotate-after-resize, fixed seats, range, overlap.

### Task 6: Catalog in the database (`floor_elements`)

- [x] `sql/0012_floor_elements.sql`: table, seed rows (11 types, palette order), foreign key `floor_plan_elements.type → floor_elements.type` (`on update cascade on delete restrict`, guarded by `pg_constraint … conrelid`).
- [x] `FloorElement` ORM model; `FloorPlanElement.type` foreign key.
- [x] `floorplans.py`: remove `CATALOG` / `ELEMENT_CONFIG`; `_catalog()` loads the table once per request; `/catalog` returns `type, label, w, h, color, resizable, config`; settings validated against each type's default config.
- [x] Frontend: `palette.js` exports `setCatalog()` and empty live `CATALOG` / `catalogByType`; editor loads `/catalog` with the plan; settings UI generated from default config (`SETTING_LABELS`).
- [x] Tests: catalog shape and order; a type inserted into the table is served and saveable; smoke script uses a `setCatalog` fixture.
- [x] Applied `0012` to the app database; verified the 11 seeded rows and the foreign key.
- [x] README and `docs/CODING_GUIDELINES.md` §3.3 updated ("catalog lives in `floor_elements`").

### Task 7: Hover tooltip and navigation

- [x] `HoverTip`: label (if any), then `Type (x,y)`; `position: fixed` so the grid scroll area cannot clip it; flips below near the top, clamped sideways; hidden on leave, drag start and scroll.
- [x] Sidebar entry and page title "Manage Floor Plan".

### Verification (final)

- [x] Backend floor plan tests: 25 passed.
- [x] `node scripts/smoke_floorplan_logic.mjs`: `floorplan logic smoke OK`, `floorplan resize smoke OK`.
- [x] `npm run build`: green.
- [ ] Manual check in the browser by an admin (not possible during implementation without an admin login).

## Follow-ups

See spec §7: booking does not yet read "Allow booking"; no admin UI for `floor_elements`; undo noise; deferred review notes from `2026-10-13-admin-floorplan-builder.md`; ISO dates on the plan list.
