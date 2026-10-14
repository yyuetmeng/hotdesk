# Floor Plan Drafts and Publishing — Design

**Date:** 2026-10-15
**Status:** Implemented 2026-10-15 (plan `docs/superpowers/plans/2026-10-15-floorplan-publishing.md`, commits 73364f5..cc83a32)
**Scope:** Piece 1 of the seat booking programme (below). Floor plans get a working **draft** and a **published** version; admins publish explicitly. Element IDs become permanent so seats keep their identity across saves and publishes.

## 0. The programme this belongs to

Agreed with the product owner on 2026-10-15, built in this order, each with its own spec and plan:

1. **Drafts and publishing + permanent seat IDs** (this document).
2. **Seat department tags:** one department/group, "free for all", or none (replaces "Allow booking"). The tags are the **same departments/groups users are assigned to in Manage Users** (`departments` table), so a user may use a seat tagged with any department they belong to.
3. **Booking and check-in in the Flask backend:** book a seat one day ahead, check in by QR code, department rules, every booking and check-in stored for statistics; printable QR codes; new Book a desk / check-in pages replacing the legacy Node-backed ones.
4. **Public floor dashboard** (no sign-in), drawing style "E" from brainstorming: architectural walls/doors/windows with icons; seats green (available), amber (booked, not checked in), red (checked in today), grey (not bookable); live counts.
5. **Statistics pages** (later): seat usage rate, usage by team.

Rules already agreed for later pieces, recorded here so this piece does not block them:
- A seat is **occupied** only when someone has checked in to it **today**; **booked** = booked for today, nobody checked in yet.
- Booking opens one day in advance; people choose their seat freely among seats they may use.
- Walk-in check-in via the seat's QR code only on **available** seats; a **booked** seat can be checked in by any member of the department the booking was made for; seats are usable by members of the seat's department, or by anyone if "free for all"; untagged seats cannot be booked or checked in.
- Check-ins and bookings are kept permanently for statistics, recording the seat's tag and the person's department as they were at the time.

## 1. Why

Admins build or rework a floor plan over several days. Today every save is immediately "the plan", with no way to keep unfinished work away from staff. Once bookings exist (piece 3), a half-edited layout must never be bookable, and an edit in progress must not disturb today's bookings.

Separately, the save endpoint deletes all elements and inserts new ones with new IDs on every save (`PUT /floor-plans/<id>/elements`). Bookings, check-ins and statistics (pieces 3 and 5) need a seat to keep the same identity for its whole life.

## 2. Goals, non-goals, anti-goals

**Goals**
- Each plan has an editable **draft** and at most one **published** version.
- **Publish** makes the current draft the published version; staff-facing features (pieces 3–4) read only the published version.
- Editing a published plan changes only the draft; the published version stays as it is until the admin publishes again.
- Admins can see whether a plan is a draft, published, or published with unpublished changes.
- Element IDs persist across saves and publishes; a new ID only for a newly placed element.
- Every published version is kept (history), so later pieces can tell which layout applied on a given day.

**Non-goals**
- Booking, check-in, QR codes, the public dashboard, statistics (pieces 3–5).
- Seat department tags (piece 2).
- Comparing versions, or rolling back to an older version (history is stored; no UI for it yet).
- Scheduling a publish for a future date.

**Anti-goals**
- A half-finished draft becoming visible or bookable by accident.
- A seat silently getting a new identity because it was moved, retagged or the plan was re-saved.

## 3. Behaviour

**States** (derived, shown on the list page and in the editor):

| State | Meaning |
|---|---|
| **Draft** | Never published. |
| **Published** | Published, and the draft has no changes since. |
| **Published · unpublished changes** | Published, and the draft has been changed since the last publish. |
| **Unpublished** | Was published, then taken down (see *Unpublish*). |

**Editor**
- **Save** stores the draft (as today). Saving never affects the published version.
- **Publish** button: saves the draft first if needed, then publishes it. Disabled while the draft has validation problems (same checks as save) or when there is nothing new to publish.
- A banner shows the state, e.g. "Published 14/10/2026 23:18:03 by Jane Tan · you have unpublished changes".
- **Discard changes** (only when published with unpublished changes): resets the draft to the published version, after confirmation.

**List page (Manage Floor Plan)**
- New **Status** column with the state, and the last published time (`dd/MM/yyyy HH:mm:ss`).

**Unpublish** (product owner: yes): takes the plan off staff-facing pages; the draft and history stay. Pieces 3–4 will treat an unpublished plan as not bookable and will not show it on the dashboard.

**Plan name and grid size** (rename / resize in the editor toolbar) are part of the draft and take effect on publish.

**Delete plan:** allowed as today; once piece 3 exists, a plan with bookings will need a different rule (out of scope here).

## 4. Data model (decided as builder's call)

New script `sql/0014_floor_plan_publishing.sql` (idempotent):

```sql
create table if not exists floor_plan_versions (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references floor_plans(id) on delete cascade,
  version      int  not null,                      -- 1, 2, 3 ... per plan
  name         text not null,
  cols         int  not null,
  rows         int  not null,
  published_at timestamptz not null default now(),
  published_by uuid references users(id) on delete set null,
  unique (plan_id, version)
);

create table if not exists floor_plan_version_elements (
  version_id uuid not null references floor_plan_versions(id) on delete cascade,
  element_id uuid not null,                        -- = floor_plan_elements.id at publish time; stable seat identity
  type       text not null references floor_elements(type) on update cascade,
  x int not null, y int not null, w smallint not null, h smallint not null,
  rotation smallint not null, label text, color text,
  config jsonb not null default '{}'::jsonb,
  primary key (version_id, element_id)
);

alter table floor_plans add column if not exists published_version_id uuid
  references floor_plan_versions(id) on delete set null;
alter table floor_plans add column if not exists draft_changed_at timestamptz;   -- set on every draft save
alter table floor_plans add column if not exists unpublished_at timestamptz;     -- set by Unpublish, cleared by Publish
```

- The **draft** stays in `floor_plans` + `floor_plan_elements` (no change to the editor's data).
- **Publish** = insert a `floor_plan_versions` row (next version number, copying name/cols/rows) and copy every draft element into `floor_plan_version_elements` with the **same element ID**; set `published_version_id`, clear `unpublished_at`; audit `floorplan.publish`.
- "Unpublished changes" = `draft_changed_at > published version's published_at`.
- Versions are never edited after insert.
- *Builder's calls from the review:*
  - Existing plans start as **Draft** (`published_version_id` null); no data migration needed.
  - **Unpublish** sets `unpublished_at` and clears `published_version_id` (version rows are kept), so "`published_version_id` is set" always means "live". Pieces 3–4 read only plans with a `published_version_id`.
  - **Discard** sets `draft_changed_at` to the published version's `published_at`, so the state returns to **Published**.
  - The "nothing to publish" 409 applies only while the plan is currently published with no draft changes; publishing an **Unpublished** plan is always allowed (it creates a new version even if the layout is identical, so history shows when it went live again).

## 5. Permanent element IDs

- `PUT /floor-plans/<id>/elements` keeps the ID of every element whose `id` is a UUID already belonging to this plan's draft: those rows are **updated in place**; elements absent from the payload are deleted; elements with no ID or a temporary editor ID (`local-…`) are inserted with a new UUID.
- An ID that is a UUID but does not belong to this plan is rejected (400) — it cannot be used to adopt another plan's seat.
- The editor already sends existing IDs back and keeps temporary IDs for new elements; it needs no change for this beyond reading the returned IDs (it already replaces its elements with the server response).
- Because published versions copy element IDs, a seat keeps one ID across all versions for as long as it is not deleted from the draft. Moving, resizing, rotating, relabelling or retagging keeps the ID.

## 6. API (all `@admin_required`)

| Endpoint | Change |
|---|---|
| `GET /api/admin/floor-plans` | Each item adds `status` (`draft` \| `published` \| `changed` \| `unpublished`), `published_at`, `published_version`. |
| `GET /api/admin/floor-plans/<id>` | Adds the same fields plus `published_by` (name). Elements are the **draft**. |
| `PUT /api/admin/floor-plans/<id>/elements` | Keeps IDs (§5); sets `draft_changed_at`. |
| `PATCH /api/admin/floor-plans/<id>` | Sets `draft_changed_at`. |
| `POST /api/admin/floor-plans/<id>/publish` | New. Validates the draft (same rules as save); 400 with `fields.elements` if invalid; 409 if nothing changed since the last publish. Returns the plan payload. |
| `POST /api/admin/floor-plans/<id>/unpublish` | New. 409 if not published. |
| `POST /api/admin/floor-plans/<id>/discard` | New. Resets the draft (name, grid, elements, IDs) to the published version; 409 if not published. |
| `GET /api/admin/floor-plans/<id>/published` | New. The published version (read-only), for checking what staff see. 404 if none. |

Audit actions: `floorplan.publish` (details: `version`, `element_count`), `floorplan.unpublish`, `floorplan.discard`.

## 7. Product owner decisions (2026-10-15)

1. **Unpublish:** yes, admins can take a published plan down.
2. **Who may publish:** admins only (any admin, directly); no approval step.

## 8. Testing

- Backend: publish creates version 1 with matching elements and IDs; editing after publish leaves the published version unchanged and reports `changed`; publish again → version 2 with the same IDs for unchanged and moved seats; discard restores the draft and IDs; unpublish/republish; save keeps IDs, inserts new ones, deletes missing ones, rejects foreign UUIDs; 409 cases; audit rows.
- Frontend: smoke tests unchanged (IDs are opaque); build; manual check of the banner, buttons and list status.

## 9. Left to the builder

Exact wording and placement of the banner and buttons within the existing editor toolbar; whether "Publish" also saves (recommended: yes, one click).
