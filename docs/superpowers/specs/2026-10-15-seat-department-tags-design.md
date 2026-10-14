# Seat Department Tags — Design

**Date:** 2026-10-15
**Status:** For approval
**Scope:** Piece 2 of the seat booking programme (see `2026-10-15-floorplan-publishing-design.md` §0). Every seat on a floor plan gets a **department tag**: one department/group, **free for all departments**, or **none**. Admins tag seats in the floor plan editor, one at a time or a whole block at once. This replaces the seat's "Allow booking" checkbox.

## 1. Why

Booking and check-in (piece 3) and the public dashboard (piece 4) decide who may use a seat from its tag:
- a seat tagged with a department/group can be used only by members of that department;
- a **free for all** seat can be used by anyone;
- an **untagged** seat cannot be booked or checked in at all.

Admins set up a floor for several teams plus shared desks, so tagging has to be quick for blocks of seats, and a forgotten seat must be easy to spot before publishing.

## 2. Goals, non-goals, anti-goals

**Goals**
- Each seat has exactly one of: one department/group, free for all, or none.
- The departments are the **same departments/groups users are assigned to in Manage Users** (`departments` table).
- Tag one seat, or many at once: **drag a box** on the grid, or **Ctrl/Shift-click** seats, then pick one value for all of them.
- See tags at a glance on the grid; untagged seats stand out.
- Publishing warns (does not block) when seats are untagged.
- Deleting a department **silently untags** its seats (product owner decision).
- Tags are part of the draft and reach staff only when the plan is published.

**Non-goals**
- Who may book/check in, and enforcing it (piece 3).
- Showing tags on the public dashboard (piece 4).
- A "paint" mode that tags seats while dragging across them.
- Tagging non-seat elements.
- Admin-chosen department colours.

**Anti-goals**
- A seat that looks bookable to the admin but is not (or the reverse).
- Losing an admin's tagging work through a confusing multi-select (e.g. a stray click clearing a selection mid-way without a way back — Undo must cover a bulk change in one step).

## 3. Behaviour

**Seat values** (shown in the inspector dropdown, in this order):
1. **None (not bookable)**
2. **Free for all departments**
3. Each department/group, alphabetical by name (as listed in Manage Users)

**Selecting seats**
- Click selects one element (as today).
- **Ctrl-click** or **Shift-click** a seat adds it to, or removes it from, the selection. Ctrl/Shift-clicking a non-seat element does nothing.
- **Drag a box** starting on an empty grid cell: every seat whose footprint lies **fully inside** the box is selected (Ctrl/Shift held while dragging adds to the existing selection). Non-seat elements inside the box are ignored. A live outline shows the box while dragging.
- Clicking an empty cell without dragging clears the selection (as today). Escape also clears it.

**Inspector**
- One seat selected: the existing inspector, with a **Department / group** dropdown where "Allow booking" used to be.
- Several seats selected: "**N seats selected**", one **Department / group** dropdown (shows the shared value, or "Mixed" when they differ), and **Remove** for all of them. Label, colour, size and rotate are hidden for multi-selection.
- Choosing a value applies to every selected seat as **one undo step**.

**Grid display**
- Each department gets an automatic colour (stable per department, from a fixed palette). Seats show a small corner marker in that colour; free-for-all seats a white marker with a dark outline; untagged seats a **dashed outline** instead of a marker.
- A key beside the grid lists the departments in use on this plan with their colours, plus "Free for all" and "Untagged (n)".
- The hover tooltip adds the seat's department line: e.g. `Desk A1` / `Seat (3,4)` / `Engineering`.
- The striped "not bookable" look from the old checkbox is removed (untagged = dashed outline).

**Publishing**
- If any seat is untagged, **Publish** first asks: "N seats have no department and can't be booked. Publish anyway?". Cancelling publishes nothing.

**Manage Users**
- Deleting a department untags its seats in every draft and every published version; nothing else changes, and no extra warning is shown (product owner: "silently").

## 4. Data model (builder's call)

New script `sql/0016_seat_department_tags.sql` (idempotent):

```sql
alter table floor_plan_elements
  add column if not exists department_id uuid references departments(id) on delete set null,
  add column if not exists open_to_all boolean not null default false;

alter table floor_plan_version_elements
  add column if not exists department_id uuid references departments(id) on delete set null,
  add column if not exists open_to_all boolean not null default false;

-- "Allow booking" is replaced by the tag: drop the seat's bookable setting.
update floor_elements set config = config - 'bookable' where type = 'seat';
update floor_plan_elements set config = config - 'bookable' where config ? 'bookable';
```

- Tag meaning: `open_to_all = true` → free for all; else `department_id` set → that department; else none.
- Both set at once is invalid (the API rejects it; a check constraint `not (open_to_all and department_id is not null)` on both tables enforces it).
- Only seats may carry a tag (API rejects tags on other types).
- `on delete set null` implements "deleting a department silently untags its seats", including in published versions. *Builder's note:* this is the one deliberate exception to "versions are never edited after insert"; a deleted department cannot be booked anyway, and piece 3 records the department on each booking/check-in for statistics.
- Existing seats become **none** (columns default to untagged). Existing `bookable` settings are dropped by the script (`floor_plan_version_elements.config` is left as history; the API ignores keys not in the catalog).
- Publishing copies `department_id` and `open_to_all` into the version (extend the publish copy list).

## 5. API changes (`@admin_required`)

| Endpoint | Change |
|---|---|
| `PUT /api/admin/floor-plans/<id>/elements` | Each element may send `department_id` (UUID string or null) and `open_to_all` (bool, default false). Errors: unknown department id; both set; tag on a non-seat. |
| `GET /api/admin/floor-plans/<id>`, `GET .../published` | Each element returns `department_id` and `open_to_all` (non-seats: `null` / `false`). |
| `POST .../publish` | Unchanged API; copies the tag columns. (The untagged warning is client-side.) |
| `GET /api/admin/departments` | Already exists; the editor uses it for the dropdown and key. |

## 6. Testing

- Backend: save and reload a department tag, free for all, none; reject unknown department id, both set, tag on a wall; publish copies tags; deleting a department untags seats in the draft and the published version; migration leaves no `bookable` key in the seat catalog or drafts; publish of a plan whose seats carried `bookable` before the script still succeeds.
- Frontend (smoke script, pure logic): selection helpers (seats fully inside a box; toggle with Ctrl/Shift; non-seats ignored); bulk tag returns one new elements array; "Mixed" detection; untagged count.
- Build green; manual check in the browser by an admin.

## 7. Builder's calls from the review

- **Delete key / Remove** with several seats selected removes all of them (one undo step). **R** (rotate) applies only to a single selection.
- **Moving a block** of selected seats by dragging is out of scope; dragging still moves one element. (A natural follow-up.)
- **Department colours** are picked by hashing the department id into a fixed palette of about 12 colours, so a department keeps its colour across plans and sessions.
- The **box drag** uses pointer events on the empty grid; HTML5 drag-and-drop of palette items and elements is unchanged.
- **Retagging a published plan** follows the publishing rules: the change is a draft change ("unpublished changes") until the admin publishes.

## 8. Left to the builder

The colour palette (distinct from element colours, readable on every element colour), marker size and position, key layout, and exact wording beyond the strings above.
