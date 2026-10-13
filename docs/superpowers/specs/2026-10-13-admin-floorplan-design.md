# Admin Floor Plan Builder — Design

**Date:** 2026-10-13
**Status:** Approved
**Scope:** New admin-only module (`/api/admin/floor-plans` + `webapp-frontend` Floor Plans pages) for designing grid-based floor plans: admin creates a plan with a custom label and grid size, then places catalog elements (walls, seats, toilets, ...) on cells with rotation. Admins only; user-facing "published plan" viewing is a later phase.

## 1. Background

The existing "floor plan" in `webapp-frontend` is not spatial: it is a CSS-grid board of seat status buttons (`SeatGrid`, `src/components.jsx`) fed by the legacy Node API. It has no geometry, walls, or rooms. This module adds a true grid-based plan editor. The current frontend has no real login — JWT auth exists in `webapp-backend` (`/api/auth/login`, `admin_required`). This module assumes a JWT is available from the login module and only sends it as `Authorization: Bearer` (see §5).

## 2. Approach (chosen: A)

Normalized tables + DOM CSS-grid editor. Grid geometry is generated from `cols × rows`; placements are one row per element (this table is the grid↔element mapping; no per-cell table). Rejected: SVG canvas editor (B — more code, defer to viewing phase) and single JSONB doc (C — no element table / no per-row constraints).

## 3. Data model

New migration script `webapp-backend/sql/0008_floor_plans.sql` (idempotent, applied to `public` by operators; test schema applies it automatically):

```sql
create table if not exists floor_plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  cols       int  not null check (cols between 5 and 80),
  rows       int  not null check (rows between 5 and 80),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists floor_plan_elements (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references floor_plans(id) on delete cascade,
  type     text not null,           -- validated against catalog in app layer
  x        int  not null check (x >= 0),
  y        int  not null check (y >= 0),
  w        smallint not null check (w between 1 and 20),
  h        smallint not null check (h between 1 and 20),
  rotation smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  label    text check (label is null or length(label) <= 60),
  color    text check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

create index if not exists floor_plan_elements_plan_idx on floor_plan_elements (plan_id);
```

Notes:
- Element type is validated against the fixed catalog in the app layer (a CHECK list would require a migration per catalog change; catalog lives in code).
- **Footprint:** `w × h` in cells. Effective size swaps w/h when rotation is 90/270. Occupied cells of a placement: x..x+ew-1, y..y+eh-1.
- **Overlap:** enforced at the app layer inside the bulk save (one transaction, all-or-nothing) — SQL exclusion constraints across swapped footprints are not practical here. DB unique `(plan_id, x, y)` is NOT used because multi-cell elements may share an anchor grid point legitimately only after overlap validation, and swapping makes a static anchor key meaningless; validation happens in save logic.
- `cols`/`rows` are non-reserved in Postgres (windowing keywords) and verified to work unquoted in column position, DDL and DML against the dev Supabase instance.

## 4. Element catalog (fixed, code constant)

Defined once in `webapp-backend/app/admin/floorplans.py` as `CATALOG: dict[str, dict]` and mirrored in `webapp-frontend/src/floorplan/palette.js`:

| type | label | default w×h | default color |
|---|---|---|---|
| `wall` | Wall | 1×1 | `#64748b` |
| `seat` | Seat | 1×1 | `#16a34a` |
| `toilet` | Toilet | 2×2 | `#0d9488` |
| `elevator` | Elevator | 2×2 | `#7c3aed` |
| `door` | Door | 1×1 | `#b45309` |
| `meeting_room` | Meeting room | 3×2 | `#2563eb` |
| `kitchen` | Kitchen | 2×2 | `#db2777` |
| `plant` | Plant | 1×1 | `#15803d` |
| `corridor` | Corridor | 1×1 | `#94a3b8` |

Catalog entry: `{type, label, w, h, color}`. Placed elements may override `label` and `color` per instance; w/h are always the catalog defaults (footprint changes per instance are out of scope). Rotation is the only geometric control. `GET /api/admin/floor-plans/catalog` returns the catalog so the frontend can render the palette without a second source of truth at runtime (palette.js is a static fallback/mirror).

## 5. Backend API (Flask, `app/admin/floorplans.py`, blueprint `admin_bp`)

All endpoints `@admin_required` (existing JWT guard; 401/403 JSON already handled globally). Errors follow the standard `{"error": ...}` / `{"error","fields"}` shape.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/admin/floor-plans` | — | `200 {items: [{id,name,cols,rows,element_count,created_at,updated_at}]}` ordered by created_at desc |
| POST | `/api/admin/floor-plans` | `{name, cols, rows}` | `201` full plan (empty elements); 400 fields `name/cols/rows`; audit `floorplan.create` |
| GET | `/api/admin/floor-plans/<id>` | — | `200 {id,name,cols,rows,elements:[{id,type,x,y,w,h,rotation,label,color}],updated_at}` or 404 |
| PATCH | `/api/admin/floor-plans/<id>` | any of `name, cols, rows` | `200` plan; 400 fields; shrinking that strands elements → `400 fields:{elements:"N elements fall outside the new grid: <ids>"}`; audit `floorplan.update` |
| DELETE | `/api/admin/floor-plans/<id>` | — | `204`; elements cascade; audit `floorplan.delete` |
| PUT | `/api/admin/floor-plans/<id>/elements` | `{elements:[{id?,type,x,y,rotation,label?,color?}]}` | **bulk replace**: delete-then-insert inside one transaction; `200` saved elements; 400 `fields:{elements:[messages]}`; audit `floorplan.elements_saved` with `{"count": n}` |
| GET | `/api/admin/floor-plans/catalog` | — | `200 {items:[catalog entries]}` |

Bulk-save rules (server):
1. Each element: `type` in catalog; `rotation` in {0,90,180,270}; `x,y ≥ 0`; effective footprint inside `cols×rows`; `color` matches `#rrggbb` if present; `label` ≤ 60 chars.
2. No two elements may occupy the same cell (after rotation swap).
3. Duplicate `id` referencing another plan or repeated twice → 400. (`id` is accepted but ignored on insert — rows are re-created with fresh ids on save. Client keeps ids only for selection/undo bookkeeping.)
4. All-or-nothing: any violation → 400, nothing written (single transaction).

Client sends fresh payloads each save (no diffing). w/h are never trusted from the client — always taken from the catalog.

## 6. Frontend

Vite proxy (`webapp-frontend/vite.config.js`): add `'/api/admin/floor-plans'` and `'/api/auth'` proxy entries targeting `http://localhost:5000` (env `VITE_FLASK_TARGET`, default `http://localhost:5000`) before the generic `/api` → :3000 rule (vite matches more specific keys first via object key order — put specific keys first).

Auth: this module assumes the login module (being implemented separately) provides a Flask JWT. `flaskRequest()` in `src/api.js` reads it from the agreed storage location (localStorage key, e.g. `hotdesk.token`/`flask_token` — aligned with login module at integration time), sends `Authorization: Bearer <jwt>`. On 401 → inline "Session expired — sign in again" message + Retry button. **No login UI in this module.**

New files under `webapp-frontend/src/floorplan/`:

- `palette.js` — catalog mirror + helpers (`effectiveSize(type, rotation)`, colors).
- `logic.js` — pure functions: `canPlace(elements, x, y, type, rotation, ignoreId, cols, rows)`, reducers `addEl/moveEl/rotateEl/removeEl`, `validateAll(plan, elements)` mirroring server rules, plus undo/redo stack helpers (`pushHistory`, `undo`, `redo`). No React — unit-testable and reused by UI.
- `FloorPlansPage.jsx` — list view: table (name, cols×rows, element count, updated), New-plan modal (label/cols/rows with inline validation), rename inline, delete with confirm.
- `EditorPage.jsx` — route `/floor-plans/:id`, three panes:
  - **Palette** (left): chips (swatch, label, `w×h`), HTML5 drag start with `type` in dataTransfer; also click-chip-to-arm then click-cell (keyboard/accessibility path).
  - **Grid** (center): `display:grid; grid-template-columns: repeat(cols, var(--cell))`; cells are divs; elements are absolutely positioned over the grid (`left/top` from x,y × cell size). Interactions: drop to add, click to select, drag to move, toolbar/R key rotate, Del/Backspace remove. Invalid targets highlight red on dragover. Zoom control = CSS cell size (default 28px, 16–48 range).
  - **Inspector** (right): selected element (type read-only, position read-only, rotation, custom label, color override with swatches + hex input); plan header: rename, cols/rows resize inputs.
- `floorplan.css` — reuses existing CSS variables (`--bg,--surface,--border,--accent`, status colors from `styles.css`).
- Wiring: `App.jsx` router + sidebar nav item "Floor plans". Dirty-state guard: confirm dialog on leaving editor with unsaved changes. Save button → `PUT .../elements`; success clears dirty; server 400 messages rendered under a "Problems" disclosure listing each offending element message.

Undo/redo: in-memory stack of full `elements` snapshots (cap 50) on every add/move/rotate/remove/inspector edit.

## 7. Testing

Backend (`webapp-backend/tests/test_admin_floorplans.py`, real DB on `hotdesk_test`):
- plan CRUD: create validation (name/cols/rows bounds), get 404, patch rename, shrink-resize guard message, delete cascades elements, `element_count` in list.
- bulk save: happy path replace semantics (old rows gone, new count correct), w/h swapped for rotation 90, unknown type / out-of-bounds / overlap / bad rotation / bad color → 400 with `fields.elements` messages, transaction rollback on invalid batch, foreign plan id rejection.
- auth: 401 no token, 403 non-admin on every endpoint.
- audits written: `floorplan.create`, `floorplan.elements_saved`, `floorplan.delete`.

Frontend: no test runner exists in the project; `logic.js` pure functions are smoke-checked via a manual checklist in the implementation plan (place, rotate into wall, overlap blocked, undo/redo, save round-trip). If a runner is added later, `logic.js` is designed for direct unit tests.

## 8. Out of scope (later phases)

Publishing/viewing plans for end users; overlaying live seat status; per-instance resize of elements; copying/duplicating plans; SVG/zoom-print export; multiple plans per floor linking to legacy floor ids; collaborative editing.
