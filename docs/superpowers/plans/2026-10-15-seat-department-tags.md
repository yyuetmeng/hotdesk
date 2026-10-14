# Seat Department Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every seat carries one department tag (a department/group, free for all, or none), set in the floor plan editor one seat at a time or for a whole selected block, replacing "Allow booking".

**Architecture:** Two new columns on draft and version elements (`department_id` FK `on delete set null`, `open_to_all`), validated in the existing save path and copied on publish. The editor gains multi-selection (box drag, Ctrl/Shift-click) and a department dropdown; pure selection/tag helpers live in a new `src/floorplan/selection.js` so the smoke script can test them.

**Tech Stack:** Flask 3, SQLAlchemy 2.0 ORM, PostgreSQL, pytest (`hotdesk_test`); React 19 + Vite, Node smoke script.

**Spec:** `docs/superpowers/specs/2026-10-15-seat-department-tags-design.md`

## Global Constraints

- Backend commands from `webapp-backend/` (`python -m pytest`); frontend from `webapp-frontend/`.
- Schema change only via new idempotent `sql/0016_seat_department_tags.sql` (spec §4, plus the check constraint `not (open_to_all and department_id is not null)` on both element tables, guarded for re-runs).
- Tag fields in JSON exactly: `department_id` (UUID string or `null`), `open_to_all` (boolean). Non-seats always `null` / `false`.
- Error strings exactly: `"unknown department id"`, `"choose a department or free for all, not both"`, `"only seats can have a department"`.
- Dropdown order and labels exactly: `None (not bookable)`, `Free for all departments`, then departments alphabetically.
- Multi-select inspector header: `{n} seats selected`; shared value or `Mixed`.
- Publish warning exactly: `{n} seats have no department and can't be booked. Publish anyway?` (singular: `1 seat has no department and can't be booked. Publish anyway?`).
- Only seats can be multi-selected; tags apply only to seats. Untagged = `department_id === null && !open_to_all`.
- Do not run two pytest sessions at once (each rebuilds `hotdesk_test`).

## Review Focus

1. **A department deleted (in Manage Users) while seats are tagged with it:** the draft and the published version show those seats untagged, and the next save/publish works. Test in Task 1 and Task 2.
2. **Drafts saved before this change carry `config.bookable`:** saving and publishing them after the migration succeeds (no "not supported" error). Test in Task 1.
3. **Ctrl/Shift-click on a wall while seats are selected:** the selection is unchanged. Smoke test in Task 3.
4. **Bulk tag then Undo:** one Undo restores every seat's previous tag. Smoke test in Task 3 (`setTag` returns one new array, committed once) plus manual check in Task 4.
5. **Starting a drag on an element** moves that element; only a drag that starts on an empty cell draws a selection box. Manual check in Task 4.

---

### Task 1: Schema, models, migration of "Allow booking"

**Files:**
- Create: `webapp-backend/sql/0016_seat_department_tags.sql`
- Modify: `webapp-backend/app/core/floorplan_models.py` (both element models)
- Test: `webapp-backend/tests/test_floorplan_schema.py`

**Interfaces:**
- Produces: `FloorPlanElement.department_id: uuid | None`, `FloorPlanElement.open_to_all: bool`, same on `FloorPlanVersionElement`; seat catalog `config == {}`.

- [ ] **Step 1: Write failing tests:**
  - `test_department_tag_columns_and_constraint(db)`: insert a department and a plan; insert a seat with `department_id` → ok; inserting a seat with both `department_id` and `open_to_all = true` → `IntegrityError`.
  - `test_deleting_department_untags_seats(db)`: seat in a draft and in a version element tagged with department D; `delete from departments where id = D`; both rows now have `department_id is null`.
  - `test_seat_catalog_has_no_bookable(db)`: `select config from floor_elements where type = 'seat'` → `{}`.
- [ ] **Step 2: Run** `python -m pytest -q tests/test_floorplan_schema.py -k "department or bookable"` → FAIL.
- [ ] **Step 3: Write `0016` and the model columns** (`department_id` FK `departments.id` `ondelete="SET NULL"`, `open_to_all` `server_default=text("false")`). Guard the check constraints with a `do $$ … pg_constraint … conrelid = '<table>'::regclass` block like `0012`.
- [ ] **Step 4: Run** the three tests, then `python -m pytest -q tests/test_floorplan_schema.py tests/test_sql_schema.py` → all pass.
- [ ] **Step 5: Apply `0016` to the app database** (one transaction) right away: the product owner's Flask dev server auto-reloads and would otherwise query missing columns. Verify the columns exist and the seat catalog config is `{}`.
- [ ] **Step 6: Commit** `feat: add department tag columns to floor plan seats`.

### Task 2: API — save, read and publish tags

**Files:**
- Modify: `webapp-backend/app/admin/floorplans.py` (`_validate_elements`, `_normalized`, `_element_dto`), `webapp-backend/app/admin/floorplan_publishing.py` (`_ELEMENT_FIELDS`, `_version_element_dto`)
- Test: `webapp-backend/tests/test_floorplan_publishing.py` (tags) and `webapp-backend/tests/test_admin_floorplans.py` (validation, old config)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: element JSON fields `department_id`, `open_to_all` on GET plan, PUT response and GET published.

- [ ] **Step 1: Write failing tests:**
  - `test_seat_tags_roundtrip`: save seats tagged with department D, free for all, and none → GET returns `(D, False)`, `(None, True)`, `(None, False)`; a wall returns `(None, False)`.
  - `test_seat_tag_validation`: unknown UUID → 400 `"unknown department id"`; both set → `"choose a department or free for all, not both"`; wall with `department_id` → `"only seats can have a department"`; non-UUID string → `"unknown department id"`.
  - `test_publish_copies_tags_and_department_delete_untags` (Review Focus 1): tag a seat with D, publish, `GET /published` shows D; `DELETE /api/admin/departments/D` → draft and published show `department_id is None`; saving and publishing again → 200.
  - `test_old_bookable_config_still_saves_and_publishes` (Review Focus 2): `run_write` a seat row with `config = '{"bookable": true}'`; re-save the GET payload unchanged → 200; publish → 200.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement.** Validation (per element, seats only): parse `department_id` with `_element_uuid`-style parsing; check existence with one query for all ids in the payload; `open_to_all` must be bool if present. `_normalized` stores both (non-seats: `None`/`False`). Add both names to `_ELEMENT_FIELDS` and both DTOs. Stored `config` keys not in the catalog are dropped by `_config_with_defaults` on save (already true); ensure validation of stored configs (`_draft_problems` at publish) ignores keys not in the catalog — normalise stored config before validating.
- [ ] **Step 4: Run** `python -m pytest -q tests/test_floorplan_publishing.py tests/test_admin_floorplans.py` → all pass.
- [ ] **Step 5: Commit** `feat: save, read and publish seat department tags`.

### Task 3: Selection and tagging logic (pure)

**Files:**
- Create: `webapp-frontend/src/floorplan/selection.js`
- Test: `webapp-frontend/scripts/smoke_floorplan_logic.mjs`

**Interfaces:**
- Produces (all pure, elements are the editor's element objects):
  - `isSeat(el) -> boolean`
  - `seatsInBox(elements, box: {x1, y1, x2, y2}) -> string[]` — ids of seats whose rotated footprint (`sizeOf`) lies fully inside the inclusive cell box (corners in any order).
  - `toggleSelection(ids: string[], el) -> string[]` — adds/removes a seat; returns `ids` unchanged for non-seats.
  - `tagOf(el) -> 'none' | 'all' | <departmentId>`
  - `setTag(elements, ids, tag) -> elements` — new array; selected seats get `{department_id, open_to_all}` for the tag.
  - `sharedTag(elements, ids) -> tag | 'mixed'`
  - `countUntagged(elements) -> number`
  - `departmentColor(id: string) -> string` — stable hash into a 12-colour palette.

- [ ] **Step 1: Add smoke cases:** a 2×1 table and two seats in a box returns only the seat ids, and a seat half outside the box is excluded; box corners given reversed give the same result; `toggleSelection` adds, removes, and ignores a wall (Review Focus 3); `setTag(…, 'all')` then `sharedTag` → `'all'`; tagging one of two selected seats → `'mixed'`; `setTag` returns a new array and leaves the input untouched (Review Focus 4); `countUntagged` counts seats only; `departmentColor(x) === departmentColor(x)` and is one of the palette values.
- [ ] **Step 2: Run** `node scripts/smoke_floorplan_logic.mjs` → FAIL (missing module).
- [ ] **Step 3: Implement** `selection.js` with the signatures above.
- [ ] **Step 4: Run** → all smoke lines OK, ending with `floorplan selection smoke OK`.
- [ ] **Step 5: Commit** `feat: add seat selection and tagging helpers`.

### Task 4: Editor — multi-select, department dropdown, markers, key, publish warning

**Files:**
- Modify: `webapp-frontend/src/floorplan/EditorPage.jsx`, `webapp-frontend/src/floorplan/floorplan.css`

**Interfaces:**
- Consumes: Task 3 helpers; `GET /api/admin/departments` (`items: [{id, name, …}]`); Task 2 JSON fields.

- [ ] **Step 1: State.** Replace `selectedId` with `selectedIds: string[]` (single selection = one id). Load departments with the catalog and plan.
- [ ] **Step 2: Selection input.** Click selects one; Ctrl/Shift-click uses `toggleSelection`; pointer-down on the empty grid starts a box (live outline), pointer-up selects `seatsInBox` (Ctrl/Shift adds); a click without movement clears; Escape clears. Element drag-and-drop unchanged (Review Focus 5).
- [ ] **Step 3: Inspector.** One seat: existing inspector with a **Department / group** select (values from the Global Constraints order) replacing "Allow booking". Several seats: `{n} seats selected`, the select (shared value or `Mixed`), **Remove**; Delete key removes all selected; R rotates only a single selection. Each change is one `commit(setTag(…))`.
- [ ] **Step 4: Display.** Corner marker per seat (`departmentColor`; free for all: white with dark outline); untagged seats: dashed outline; key beside the grid (departments used on this plan, Free for all, `Untagged (n)`); tooltip third line with the department name (`Free for all` / `No department`). Remove `isUnbookable`, `SETTING_LABELS['bookable']` usage and `.not-bookable` styles.
- [ ] **Step 5: Publish warning.** Before `lifecycle('publish')`, if `countUntagged(elements) > 0`, confirm with the exact warning text; cancel → nothing happens.
- [ ] **Step 6: Verify** `node scripts/smoke_floorplan_logic.mjs` and `npm run build` green; manual check list: box-select a block, tag it, Undo once restores; Ctrl-click a wall keeps the selection; drag an element still moves it; delete a department in Manage Users → its seats show dashed.
- [ ] **Step 7: Commit** `feat: tag seats with departments in the floor plan editor`.

### Task 5: Docs, rollout, release gate

**Files:**
- Modify: `webapp-backend/README.md` (elements payload, setup line `0016_...`), `docs/superpowers/specs/2026-10-15-seat-department-tags-design.md` (Status: Implemented), `docs/superpowers/specs/2026-10-14-floorplan-catalog-and-editor-design.md` (seat row: default config `{}`, "Allow booking" replaced by department tags)

- [ ] **Step 1:** Update the docs above.
- [ ] **Step 2:** Full backend suite `python -m pytest -q` → all pass (one session only).
- [ ] **Step 3: Commit** `docs: document seat department tags`.
