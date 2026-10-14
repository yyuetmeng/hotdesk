# Floor Plan Drafts and Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Floor plans get an editable draft and numbered, immutable published versions (publish / unpublish / discard), and element IDs become permanent across saves and publishes.

**Architecture:** The draft stays in `floor_plans` + `floor_plan_elements`. Publishing snapshots the draft into new tables `floor_plan_versions` + `floor_plan_version_elements`, copying element IDs. Status is derived from `published_version_id`, `unpublished_at` and `draft_changed_at`. Publishing endpoints live in a new module next to `app/admin/floorplans.py`; the editor and list page get status, Publish, Unpublish and Discard.

**Tech Stack:** Flask 3, SQLAlchemy 2.0 ORM, PostgreSQL (Supabase), pytest against schema `hotdesk_test`; React 19 + react-router 7 + Vite.

**Spec:** `docs/superpowers/specs/2026-10-15-floorplan-publishing-design.md`

## Global Constraints

- Backend commands from `webapp-backend/` using `python -m pytest`; frontend commands from `webapp-frontend/`.
- Schema changes only via a new idempotent script `sql/0014_floor_plan_publishing.sql` (DDL exactly as spec §4); never edit applied scripts. The test schema applies all `sql/*.sql` automatically.
- All new endpoints `@admin_required`; errors via `error(message, status, **extra)`; validation errors as `fields={"elements": [...]}` like the existing save.
- Status values exactly: `draft`, `published`, `changed`, `unpublished`.
- Audit actions exactly: `floorplan.publish` (details `{"version": n, "element_count": n}`), `floorplan.unpublish`, `floorplan.discard`.
- Displayed timestamps use `formatDateTime` (`dd/MM/yyyy HH:mm:ss`, `src/format.js`); API timestamps are ISO 8601 (`.isoformat()`).
- "Changed" means `draft_changed_at > published_at` of the published version (strictly greater).
- Element types come only from `floor_elements` (no hard-coded catalog).

## Review Focus

1. **Duplicate element ID in one save payload** (the same UUID twice): expect 400, nothing saved. Test in Task 2.
2. **A UUID from another plan's draft in the payload:** expect 400 ("unknown element id"), the other plan untouched. Test in Task 2.
3. **Publishing straight after editing in the browser without pressing Save:** the editor must save first, then publish, so the published version matches what the admin sees. Checked manually in Task 5 (no frontend test runner).
4. **Deleting a seat and republishing:** version 2 lacks it, version 1 still has it with the same ID. Test in Task 3.
5. **Discard after adding, deleting and moving seats and renaming/resizing the grid:** the draft returns exactly to the published version (name, cols, rows, element set and IDs), and status becomes `published`. Test in Task 4.

---

### Task 1: Schema and ORM models for versions

**Files:**
- Create: `webapp-backend/sql/0014_floor_plan_publishing.sql`
- Modify: `webapp-backend/app/core/floorplan_models.py`
- Test: `webapp-backend/tests/test_floorplan_schema.py`

**Interfaces:**
- Produces: `FloorPlanVersion` (`id`, `plan_id`, `version`, `name`, `cols`, `rows`, `published_at`, `published_by`, relationship `elements` ordered by `y, x`), `FloorPlanVersionElement` (`version_id`, `element_id`, `type`, `x`, `y`, `w`, `h`, `rotation`, `label`, `color`, `config`); `FloorPlan.published_version_id`, `FloorPlan.draft_changed_at`, `FloorPlan.unpublished_at`, relationship `FloorPlan.published_version` (`foreign_keys=[published_version_id]`, `post_update=True`).

- [ ] **Step 1: Write the failing test** `test_version_tables_roundtrip(app, db)`: create a plan and a version row via ORM with one version element whose `element_id` equals an existing draft element's id; set `plan.published_version_id`; commit; reload and assert `plan.published_version.version == 1`, `plan.published_version.elements[0].element_id == draft_el.id`; then delete the plan and assert both version tables are empty (cascade).
- [ ] **Step 2: Run** `python -m pytest tests/test_floorplan_schema.py::test_version_tables_roundtrip -v` → FAIL (import error / missing tables).
- [ ] **Step 3: Write `0014_floor_plan_publishing.sql`** exactly as spec §4 (`create table if not exists`, `add column if not exists`), and add the two models plus the three `FloorPlan` columns. `FloorPlan.published_version_id` and `FloorPlanVersion.plan_id` form a cycle: use `use_alter=True` on the `published_version_id` FK and `post_update=True` on the relationship.
- [ ] **Step 4: Run** the test → PASS; run `python -m pytest -q tests/test_floorplan_schema.py tests/test_sql_schema.py` → all pass.
- [ ] **Step 5: Commit** `feat: add floor plan version tables`.

### Task 2: Permanent element IDs on save, draft change time

**Files:**
- Modify: `webapp-backend/app/admin/floorplans.py` (`_validate_elements`, `_normalized`, `save_elements`, `update_plan`)
- Test: `webapp-backend/tests/test_admin_floorplans.py`

**Interfaces:**
- Consumes: `FloorPlan.draft_changed_at` (Task 1).
- Produces: save keeps IDs; `_mark_draft_changed(plan: FloorPlan) -> None` (sets `draft_changed_at = func.now()`), used by Tasks 3–4.

- [ ] **Step 1: Write failing tests:**
  - `test_save_keeps_element_ids`: save two seats; re-save the returned elements with the first moved to a new cell plus one new element with id `"local-1"`; assert the first two ids are unchanged, the new one is a fresh UUID; save again without the second element → it is gone and the first keeps its id.
  - `test_save_rejects_foreign_and_duplicate_ids`: plan A and plan B each with one seat; saving plan B with plan A's element id → 400 with `"unknown element id"` in `fields.elements`; saving B with the same own id twice → 400 with `"duplicate element id"`; plan A unchanged.
  - `test_save_and_patch_set_draft_changed_at`: after a save, `floor_plans.draft_changed_at` is not null (check with `run_one`); after `PATCH {"name": ...}` it increases.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement.** In `_validate_elements(raw, cols, rows, existing_ids: set[str])`: an `id` that parses as a UUID must be in `existing_ids` (else `"element {i}: unknown element id"`) and must not repeat (`"element {i}: duplicate element id"`); any other `id` value (e.g. `local-…`, missing) means new. In `save_elements`: update matching rows in place, delete draft rows whose id is not in the payload, insert new rows (ORM default uuid4); call `_mark_draft_changed`. `update_plan` also calls `_mark_draft_changed`.
- [ ] **Step 4: Run** the new tests and `python -m pytest -q tests/test_admin_floorplans.py` → all pass.
- [ ] **Step 5: Commit** `feat: keep floor plan element ids across saves`.

### Task 3: Publish, status fields, published view

**Files:**
- Create: `webapp-backend/app/admin/floorplan_publishing.py`
- Modify: `webapp-backend/app/admin/__init__.py` (import the module), `webapp-backend/app/admin/floorplans.py` (`_plan_payload`, `list_plans`)
- Test: `webapp-backend/tests/test_floorplan_publishing.py` (new; reuse the `admin_token`/`hdr`/`_mk_plan`/`_save` patterns from `test_admin_floorplans.py`)

**Interfaces:**
- Consumes: Task 1 models; `_get_plan`, `_validate_elements`, `_plan_payload`, `_mark_draft_changed` from `floorplans.py`.
- Produces: `plan_status(plan: FloorPlan) -> str`; `_plan_payload` adds `status`, `published_version` (int | None), `published_at` (ISO | None), `published_by` (full name | None); list items add `status`, `published_version`, `published_at`. Endpoints `POST /api/admin/floor-plans/<id>/publish`, `GET /api/admin/floor-plans/<id>/published`.

- [ ] **Step 1: Write failing tests:**
  - `test_new_plan_is_draft`: `status == "draft"`, `published_version is None` in both GET and list.
  - `test_publish_creates_version_with_same_ids`: save 3 seats, publish → 200, `status == "published"`, `published_version == 1`; `GET .../published` returns version 1 with the same 3 element ids and the plan's name/cols/rows; audit row `floorplan.publish` with `{"version": 1, "element_count": 3}`.
  - `test_edit_after_publish_is_changed_and_published_unchanged`: after publish, move a seat and save → `status == "changed"`; `/published` still shows the old position.
  - `test_republish_keeps_ids_and_history` (Review Focus 4): delete one seat, move another, publish → version 2 has 2 elements with their original ids; version 1 rows still exist (`run_one` count on `floor_plan_version_elements` for v1 == 3).
  - `test_publish_rejections`: publishing with no changes since the last publish → 409; publishing a draft that fails validation (insert an overlapping element row directly with `run_write`) → 400 with `fields.elements`; `/published` for a never-published plan → 404; non-admin → 403.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `plan_status` (`draft` if no `published_version_id` and no `unpublished_at`; `unpublished` if `unpublished_at` set; `changed` if `draft_changed_at > published_version.published_at`; else `published`) and `publish_plan(plan_id)`: validate current draft rows (convert to the payload shape, `existing_ids` = their own ids), compute next `version` (`max + 1`), copy plan name/cols/rows and every element (same `element_id`), set `published_version_id`, clear `unpublished_at`, `published_by = get_jwt_identity()`, audit, return `_plan_payload`. 409 rule per spec §4 builder's calls.
- [ ] **Step 4: Run** `python -m pytest -q tests/test_floorplan_publishing.py tests/test_admin_floorplans.py` → all pass.
- [ ] **Step 5: Commit** `feat: publish floor plans as numbered versions`.

### Task 4: Unpublish and discard

**Files:**
- Modify: `webapp-backend/app/admin/floorplan_publishing.py`
- Test: `webapp-backend/tests/test_floorplan_publishing.py`

**Interfaces:**
- Consumes: Task 3 (`plan_status`, payload fields).
- Produces: `POST /api/admin/floor-plans/<id>/unpublish`, `POST /api/admin/floor-plans/<id>/discard`.

- [ ] **Step 1: Write failing tests:**
  - `test_unpublish_and_republish`: publish → unpublish → `status == "unpublished"`, `/published` → 404, audit `floorplan.unpublish`; unpublish again → 409; publish with no changes → 200 and `published_version == 2`; unpublish a never-published plan → 409.
  - `test_discard_restores_published_draft` (Review Focus 5): publish 3 seats on a 10×10 grid named "A"; then add a seat, delete one, move one, `PATCH {"name": "B", "cols": 12}`; discard → 200; draft name "A", cols 10, element ids and positions equal to version 1; `status == "published"`; audit `floorplan.discard`. Discard on a draft-only plan → 409.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Unpublish: requires `published_version_id`; sets `unpublished_at = now()` and `published_version_id = None` (keep the version rows). *Note:* `plan_status` returns `unpublished` via `unpublished_at`. Discard: requires `published_version_id`; replace draft name/cols/rows and all draft elements with the version's (re-using `element_id` as the draft row id; delete the current draft rows first in the same transaction); set `draft_changed_at` to the version's `published_at`.
- [ ] **Step 4: Run** `python -m pytest -q tests/test_floorplan_publishing.py` → all pass.
- [ ] **Step 5: Commit** `feat: unpublish floor plans and discard draft changes`.

### Task 5: Editor and list page

**Files:**
- Modify: `webapp-frontend/src/floorplan/FloorPlansPage.jsx`, `webapp-frontend/src/floorplan/EditorPage.jsx`, `webapp-frontend/src/floorplan/floorplan.css`

**Interfaces:**
- Consumes: payload fields and endpoints from Tasks 3–4.

- [ ] **Step 1: List page.** New **Status** column: `Draft` / `Published` / `Unpublished changes` / `Unpublished`, plus `v{published_version} · {formatDateTime(published_at)}` when published.
- [ ] **Step 2: Editor banner** above the grid with the status text, e.g. `Published v2 · 15/10/2026 10:02:11 by Jane Tan` and, for `changed`, `· you have unpublished changes`; `Draft · not visible to staff` for drafts.
- [ ] **Step 3: Buttons** in the editor toolbar: **Publish** (if the editor has unsaved changes it saves first, then calls `/publish`; disabled while there are local validation problems or when status is `published` and nothing is unsaved), **Unpublish** (only when `published`/`changed`, with confirmation), **Discard changes** (only when `changed`, confirmation, then reload the plan into the editor and clear undo history). After each call, replace plan and elements with the response.
- [ ] **Step 4: Verify** `npm run build` green and `node scripts/smoke_floorplan_logic.mjs` prints both OK lines; manual check (Review Focus 3): move a seat without saving, press Publish, then `GET /published` shows the moved seat.
- [ ] **Step 5: Commit** `feat: publish, unpublish and discard in the floor plan editor`.

### Task 6: Docs, migration rollout, release gate

**Files:**
- Modify: `webapp-backend/README.md` (Floor plans endpoint table, setup line "currently `0014_...`"), `docs/superpowers/specs/2026-10-15-floorplan-publishing-design.md` (Status: Implemented)

- [ ] **Step 1:** Add the four new endpoints and the `status` fields to the README table; bump the setup line to `0014_...`.
- [ ] **Step 2:** Run the full backend suite `python -m pytest -q` → all pass (about 11 minutes against the networked test DB).
- [ ] **Step 3:** Apply `sql/0014_floor_plan_publishing.sql` to the app database (`public`) in one transaction; verify the two tables and three columns exist. Existing plans show as **Draft**.
- [ ] **Step 4: Commit** `docs: document floor plan publishing`.
