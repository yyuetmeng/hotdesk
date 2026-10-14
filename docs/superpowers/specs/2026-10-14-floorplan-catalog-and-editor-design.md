# Floor Plan Catalog and Editor Enhancements — Design

**Date:** 2026-10-14
**Status:** Implemented (written after implementation; records the decisions made)
**Scope:** Follow-up to `2026-10-13-admin-floorplan-design.md`. Moves the element catalog from code into the database, changes the catalog contents, adds per-element size and per-type settings (seat "Allow booking"), and improves how elements, labels and colours look in the editor.
**Implemented in:** commits `6094b61`, `d71af4c` (see `docs/superpowers/plans/2026-10-14-floorplan-catalog-and-editor.md`).

## 1. Background

The original design fixed the element catalog as a code constant duplicated in `app/admin/floorplans.py` and `webapp-frontend/src/floorplan/palette.js` (§4 of the original spec), with fixed footprints and no per-element settings. Using the editor surfaced these requests:

- Rename Kitchen to Pantry; add Table, Stairs and Window; remove Meeting room.
- Seats need extra settings, starting with an "Allow booking" toggle.
- Elements other than seats need a configurable size.
- The catalog should live in the database (`floor_elements`) with its defaults, not in code.
- Labels: show only what the admin typed; rotate and centre them with the element; show the full label, type and position on hover because small elements cannot fit text.
- More colour choices.
- Sidebar entry renamed to "Manage Floor Plan".

A separate bug blocked the page entirely: after the frontend merge, sign-in stores the Flask JWT in `sessionStorage` under `hotdesk.auth.token`, but floor plan requests read the old dev-only `hotdesk.flask_token` key, so every request returned 401 ("Session expired — sign in again").

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Catalog storage | New table `floor_elements`, one row per type; API and editor read it. No hard-coded catalog in Python or JavaScript. | Single source of truth; new types need only SQL. |
| Placed element → type | Foreign key `floor_plan_elements.type → floor_elements.type`, `on update cascade on delete restrict`. | Saved elements can never reference a missing type; renaming a type carries through. |
| Per-type settings | `floor_elements.config` (jsonb) holds the default settings. Its keys are the settings a type allows; each default value's JSON type is the allowed type. Each placed element stores its own `config` (jsonb). | Extensible (more seat settings expected) without schema changes per setting. |
| Seat booking | Seat default config `{"bookable": true}`; editor toggle "Allow booking"; non-bookable seats drawn with stripes. | Seats are bookable unless switched off. |
| Element size | Each placed element keeps its own unrotated `w`/`h` (1–20 cells); new elements start at the catalog default. Rotation swaps them as before. | `w`/`h` columns already existed; only the code ignored them. |
| Fixed sizes | `floor_elements.resizable`; seats are `false` (always 1×1). | A seat is one bookable spot. |
| Removed / renamed types | Data migrations: rename saved `kitchen` → `pantry`; delete saved `meeting_room` elements (chosen by the product owner over converting them). | Saved plans would otherwise reference unknown types. |
| Token fix | `flaskRequest` reads the sign-in token via `AUTH_TOKEN_KEY` (`hotdesk.auth.token`, `sessionStorage`), exported from `src/api.js` and used by `src/auth.jsx`; the `?flask_token=` dev workaround is removed. | One definition shared by sign-in and API calls. |

## 3. Data model

New scripts in `webapp-backend/sql/` (idempotent; operators run them in order on `public`, the test schema applies them automatically):

| Script | Change |
|---|---|
| `0009_rename_kitchen_to_pantry.sql` | `update floor_plan_elements set type = 'pantry' where type = 'kitchen'` |
| `0010_remove_meeting_room.sql` | `delete from floor_plan_elements where type = 'meeting_room'` |
| `0011_floor_plan_element_config.sql` | `floor_plan_elements.config jsonb not null default '{}'` |
| `0012_floor_elements.sql` | Creates and seeds `floor_elements`; adds the type foreign key |

```sql
create table if not exists floor_elements (
  type       text primary key check (type ~ '^[a-z][a-z0-9_]{0,39}$'),
  label      text not null check (length(label) between 1 and 60),
  w          smallint not null check (w between 1 and 20),
  h          smallint not null check (h between 1 and 20),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  resizable  boolean not null default true,
  config     jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0
);
```

Seeded catalog (palette order):

| type | label | default size | colour | resizable | default config |
|---|---|---|---|---|---|
| wall | Wall | 1×1 | `#64748b` | yes | `{}` |
| seat | Seat | 1×1 | `#16a34a` | **no** | `{"bookable": true}` |
| table | Table | 2×1 | `#ca8a04` | yes | `{}` |
| toilet | Toilet | 2×2 | `#0d9488` | yes | `{}` |
| elevator | Elevator | 2×2 | `#7c3aed` | yes | `{}` |
| stairs | Stairs | 2×2 | `#ea580c` | yes | `{}` |
| door | Door | 1×1 | `#b45309` | yes | `{}` |
| window | Window | 1×1 | `#7dd3fc` | yes | `{}` |
| pantry | Pantry | 2×2 | `#db2777` | yes | `{}` |
| plant | Plant | 1×1 | `#15803d` | yes | `{}` |
| corridor | Corridor | 1×1 | `#94a3b8` | yes | `{}` |

ORM: `FloorElement` model in `app/core/floorplan_models.py`; `FloorPlanElement.type` declares the foreign key and `FloorPlanElement.config` the jsonb column.

## 4. Backend API changes (`app/admin/floorplans.py`)

- `GET /api/admin/floor-plans/catalog` returns rows of `floor_elements` in `sort_order`:
  `{"items": [{"type", "label", "w", "h", "color", "resizable", "config"}]}`.
  The catalog is loaded once per request (`_catalog()`, cached on `flask.g`).
- `PUT /api/admin/floor-plans/<id>/elements` element payload: `{type, x, y, rotation, w?, h?, label?, color?, config?}`.
  - `w`/`h` default to the catalog size; must be integers 1–20; a non-resizable type must keep its catalog size (`"seat size is fixed at 1x1"`).
  - `config` must be an object; unknown keys (`"config 'x' is not supported for wall"`) and wrong value types (`"config 'bookable' must be bool"`) are rejected. Missing keys are filled from the defaults when saving.
  - Bounds and overlap checks use the element's own size, rotated.
- `GET /api/admin/floor-plans/<id>` returns each element with `w`, `h` and `config` (defaults merged for keys missing in stored rows).
- `PATCH /api/admin/floor-plans/<id>` (grid resize) checks stranded elements using each element's own size.

## 5. Frontend (`webapp-frontend/src/floorplan/`)

- `palette.js` no longer contains a catalog. `setCatalog(items)` fills `CATALOG` / `catalogByType` (live ES module bindings); the editor loads `/catalog` together with the plan. Helpers: `isResizable`, `baseSize(el)` (own size or catalog default; always the default for fixed types), `sizeOf(el)` (rotated footprint), `MAX_ELEMENT_SIZE = 20`.
- `logic.js` uses `sizeOf` for bounds and overlap; new `resizeElement(elements, id, w, h, cols, rows)` returns an error for fixed types, out-of-range sizes, overlap or leaving the grid.
- Editor inspector:
  - **Width / Height** fields plus **Reset size** (fixed types show "Size: 1 × 1 (fixed)"); rejected sizes show the reason under the fields.
  - **Settings** built from the type's default config: one checkbox per boolean key, labelled via `SETTING_LABELS` (`bookable` → "Allow booking").
  - **Colour:** 31 swatches, a **Custom** colour picker and **Default** (clears the override).
- Grid rendering:
  - Text appears only when the element has a label (no fallback to the type name).
  - The label is laid out in the element's unrotated footprint, rotated with the element, and centred both ways.
  - Non-bookable seats are drawn with diagonal stripes (`.not-bookable`).
  - Hover tooltip (`HoverTip`): label (if any) on the first line, then `Type (x,y)`. It is fixed to the viewport so the grid's scroll area cannot clip it, sits above the element, flips below near the top of the screen, and is clamped inside the screen sideways.
- Navigation: sidebar entry and page title "Manage Floor Plan" (route stays `/floor-plans`).

## 6. Testing

- Backend (`tests/test_admin_floorplans.py`): catalog shape and order from the table; a type inserted into `floor_elements` appears in the catalog and can be saved; custom sizes saved and used for bounds and grid shrink; size rules (fixed seat, range, integer); seat config defaults, round-trip and invalid config; rotation tests use the 2×1 table.
- Frontend smoke (`scripts/smoke_floorplan_logic.mjs`): uses a catalog fixture via `setCatalog`; covers resize, rotation of a resized element, fixed seats, out-of-range sizes and overlap.
- Result at implementation time: 25 floor plan backend tests passed; smoke and build green.

## 7. Known gaps / follow-ups

1. **Booking ignores "Allow booking".** The Book a desk page still reads seats from the legacy Node API (`/api/availability` on `:3000`), not from floor plans. Connecting booking to floor plan seats is a separate piece of work.
2. **No admin UI for the catalog.** Types are added or changed with SQL in `floor_elements`. A setting key also needs a label in `SETTING_LABELS` to read well.
3. **Undo history noise.** Each keystroke in label/size fields and each move of the custom colour picker is a separate undo step (already noted as a Minor review item for the original editor).
4. **Deferred review notes** from the original plan remain open: Task 3 (2 Minor), Task 5 (1 Important: secondary failures wipe the list page into an error), Task 6 (2 Minor).
5. Dates on the floor plan list (`updated_at`) are shown as raw ISO strings; they should use `formatDateTime` per `docs/CODING_GUIDELINES.md`.
