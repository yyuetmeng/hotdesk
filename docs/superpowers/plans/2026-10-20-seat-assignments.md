# Seat Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only Seat assignments page and an Insights card for assignments ending soon or recently
ended:
- the page shows the floor layout with each assigned seat's person and end date beside it;
- next to the layout is a table;
- the admin assigns one person to one seat, with an optional end date.

**Architecture:**
- One new table, `seat_assignments`. A current assignment has `closed_at` null; a closed one is history and is never
  deleted. Two partial unique indexes enforce one person ↔ one seat in the database, so racing admins can't break it.
- A new admin module `app/admin/seat_assignments.py` holds the endpoints and a pure `status_of`. Labels and floors
  come from `seat_places()`.
- Nothing in booking, check-in, auto-book or the floor editor reads the table.
- The frontend has a new page that draws the public floor layout through `FloorDrawing`. A new optional `notes` prop
  puts a name/date plate beside a seat. There is also a new Insights card.

**Tech Stack:** Flask + SQLAlchemy 2.0 ORM, SQL migrations in `webapp-backend/sql/`, pytest on local Postgres;
React 19 + Vite, node smoke scripts.

**Spec:** `docs/superpowers/specs/2026-10-19-seat-assignments-design.md`

## Global Constraints

- Tests run only against local Postgres (`TEST_DATABASE_URI`, localhost:5432), never Supabase. Run them from
  `webapp-backend/` with `python -m pytest`.
- No password literals in tests: use `tests/creds.py` through `tests/desk_helpers.py` (`build_world`).
- Frontend files live in OneDrive, and Vite misses quick second writes. Write each frontend file once per step, then
  run `npm run build`.
- Dates are in `BOOKING_TIMEZONE`: "today" is `rules.local_today(rules.now())`.
- Status, with the end date as the person's last day:
  - `left` when `end_date < today`;
  - `leaving_soon` when `today <= end_date <= today + 14`;
  - otherwise `assigned`, including when there is no end date.
- Insights window:
  - leaving soon is `today..today+14`;
  - left is `today-14..today-1`;
  - current assignments only, soonest end first.
- Insights empty state: `"No seat assignments ending in the next 14 days."`
- Move prompt: `"Move {full_name} from {old_label} to {new_label}?"`
- Card title `"Seat assignments ending"`; page and menu item `"Seat assignments"` (Administration section).
- Assignments never change booking, check-in, auto-book, floor or editor responses.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan rulings (calls the spec left to the builder)

- **Storage:**
  - one table, current and history together, with `closed_at`, `closed_by` and
    `closed_reason in ('cleared', 'moved', 'reassigned')`;
  - `user_id` uses `on delete set null`, and `person_name` is kept, so deleting an account never deletes history;
  - `seat_label` and `plan_name` are copied in at creation, so a removed seat can still be named.
- **One person ↔ one seat** is enforced by partial unique indexes `where closed_at is null` on `seat_id` and on
  `user_id`. A lost race is an `IntegrityError` and returns 409 `"That seat or person was just assigned by someone
  else. Reload and try again."`
- **Endpoints:**
  - `GET /api/admin/seat-assignments?plan_id=` returns the floor's current assignments plus every current assignment
    whose seat is no longer published;
  - `PUT /api/admin/seat-assignments/seats/<seat_id>` assigns or changes;
  - `DELETE /api/admin/seat-assignments/<id>` clears;
  - `GET /api/admin/insights/seat-assignments-ending` feeds the card.
- **Moving:** a PUT for a person who already holds another seat answers 409 with `needs_move: true` and
  `current_seat_label`, unless the body has `"move": true`. The page asks the move question and resends with
  `move: true`.
- **Reassigning a seat:** saving a different person on an occupied seat closes the old assignment with reason
  `reassigned`. The page confirms first: `"Replace {old_name} with {new_name} on {label}?"`
- **Note:** optional, trimmed, at most 200 characters.
- **Labels on a dense floor:** the plate beside a seat shows the first name, shortened with "…" to fit 10
  characters, and `dd/MM` for the end date. The full name and date are in the hover tip and the table.
- **Audit:** the actions are `seat_assignment.create`, `seat_assignment.change` and `seat_assignment.clear`. They go
  in the audit `"users"` category and are described in plain words.

## Review Focus

1. **Two admins assign the same person, or the same seat, at once.** One wins and the other gets the 409 race
   message; the database never holds two current rows. Task 1 tests the index directly.
2. **A seat is removed by a republish while it is assigned.** It still shows, as "Seat removed" with its old label,
   on every floor's page and in the card, and it can be cleared. Task 2 tests it.
3. **A deactivated or deleted person's assignment.** Deactivated: kept and shown, and they can't be picked for a new
   seat. Deleted: the row keeps `person_name`. Task 2 tests both.
4. **Status boundaries around midnight in Singapore.** Status uses `rules.local_today`, never the server's local
   date. Task 1 pins `status_of`, and Task 3 pins the card window using `set_now`.
5. **An assignment changes nothing anywhere else.** Floor, suggest and booking responses for an assigned seat are
   byte-identical before and after. Task 2 tests it.

---

### Task 1: Storage, status rule, assign / change / move / clear API

**Files:**
- Create: `webapp-backend/sql/0029_seat_assignments.sql`. If the team account plan has not landed `0028` yet, use
  the next free number.
- Create: `webapp-backend/app/core/assignment_models.py`
- Create: `webapp-backend/app/admin/seat_assignments.py`
- Modify: `webapp-backend/app/admin/__init__.py` (import the module)
- Modify: `webapp-backend/app/admin/audit.py` (three descriptions; `"seat_assignment."` in the `"users"` category
  tuple)
- Test: `webapp-backend/tests/test_seat_assignments.py` (new)

**Interfaces:**
- Produces `SeatAssignment(Base)`, table `seat_assignments`, with these columns:
  - `id` uuid pk;
  - `seat_id` uuid, not null;
  - `user_id` uuid, FK users, set null;
  - `person_name` text, not null;
  - `seat_label` text; `plan_name` text;
  - `end_date` date, null;
  - `note` text, null;
  - `created_at`; `created_by` uuid, FK users, set null;
  - `closed_at` timestamptz, null; `closed_by` uuid, null; `closed_reason` text, null.
- Produces `status_of(end_date: date | None, today: date) -> str`, giving `"assigned" | "leaving_soon" | "left"`.
  `WINDOW_DAYS = 14`.
- Produces `assignment_dto(a: SeatAssignment, places: dict, today: date) -> dict`, with the keys `id`, `seat_id`,
  `seat_label`, `plan_id`, `plan_name`, `seat_removed`, `user` (`{"id", "full_name", "is_active"}` or `None`),
  `person_name`, `end_date`, `note`, `status` and `created_at`.
  - Label and floor come from `places` when the seat is published; otherwise from the stored copies, with
    `seat_removed: true` and `plan_id: None`.
- Produces these API endpoints, all `@admin_required`:
  - `GET /api/admin/seat-assignments?plan_id=<uuid>` gives `{"items": [dto...], "today": "YYYY-MM-DD"}`.
  - `PUT /api/admin/seat-assignments/seats/<uuid:seat_id>`, body `{user_id, end_date?, note?, move?}`, gives 200 with
    the dto.
    - 400 field errors: `seat_id` `"choose a seat on a published floor plan"`; `user_id` `"choose an active
      account"`; `end_date` `"invalid date (use YYYY-MM-DD)"`; `note` `"at most 200 characters"`.
    - 409 `{"error": "{full_name} already has seat {label}.", "needs_move": true, "current_seat_label": label}`.
    - 409 race message.
  - `DELETE /api/admin/seat-assignments/<uuid:id>` gives 204, and 404 if it isn't current.

- [ ] **Step 1: Write the failing tests**

  Use `build_world(client, monkeypatch)` from `tests/desk_helpers.py`. Its clock starts on 2026-10-15 at 15:00
  Singapore time, so today is 2026-10-15. The helpers are `put(client, w, seat, who, **body)`, which PUTs as root
  with `user_id = w["users"][who]`, and `current_rows()`, which selects from `seat_assignments where closed_at is
  null`.

```python
from datetime import date
from app.admin.seat_assignments import status_of

def test_status_boundaries():
    today = date(2026, 10, 15)
    assert status_of(None, today) == "assigned"
    assert status_of(date(2026, 10, 29), today) == "leaving_soon"     # today + 14
    assert status_of(date(2026, 10, 30), today) == "assigned"         # today + 15
    assert status_of(date(2026, 10, 15), today) == "leaving_soon"     # last day is today
    assert status_of(date(2026, 10, 14), today) == "left"

def test_assign_lists_with_label_and_status(client, monkeypatch, db):
    w = build_world(client, monkeypatch)
    r = put(client, w, "E1", "jane", end_date="2026-10-20", note="Contract ends")
    assert r.status_code == 200
    item = client.get(f"/api/admin/seat-assignments?plan_id={w['plan']}", headers=hdr(w["tok"]["root"])).get_json()["items"][0]
    assert (item["seat_label"], item["person_name"], item["status"], item["seat_removed"]) == ("E1", "Jane Tan", "leaving_soon", False)

def test_change_end_date_keeps_one_row_and_audits_change(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    assert put(client, w, "E1", "jane", end_date="2026-12-31").status_code == 200
    assert len(current_rows()) == 1
    assert [r["action"] for r in run_all("select action from audit_logs where action like 'seat_assignment.%' order by id")] \
        == ["seat_assignment.create", "seat_assignment.change"]

def test_person_with_a_seat_needs_move_then_moves_keeping_history(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    r = put(client, w, "U1", "jane")
    assert r.status_code == 409 and r.get_json() == {"error": "Jane Tan already has seat E1.", "needs_move": True, "current_seat_label": "E1"}
    assert put(client, w, "U1", "jane", move=True).status_code == 200
    rows = run_all("select seat_label, closed_reason from seat_assignments order by created_at")
    assert [(r["seat_label"], r["closed_reason"]) for r in rows] == [("E1", "moved"), ("U1", None)]

def test_reassign_seat_closes_previous_person(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    assert put(client, w, "E1", "ali").status_code == 200
    assert run_one("select closed_reason from seat_assignments where person_name = 'Jane Tan'")["closed_reason"] == "reassigned"

def test_clear_keeps_history(client, monkeypatch, db):
    w = build_world(client, monkeypatch); a = put(client, w, "E1", "jane").get_json()
    assert client.delete(f"/api/admin/seat-assignments/{a['id']}", headers=hdr(w["tok"]["root"])).status_code == 204
    row = run_one("select closed_reason, closed_by::text as by from seat_assignments")
    assert row == {"closed_reason": "cleared", "by": w["users"]["root"]}

def test_database_refuses_two_current_rows_for_one_person_or_seat(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    with pytest.raises(Exception):
        run_write("insert into seat_assignments (seat_id, user_id, person_name) values (cast(:s as uuid), cast(:u as uuid), 'x')",
                  {"s": w["seats"]["U1"], "u": w["users"]["jane"]})
    with pytest.raises(Exception):
        run_write("insert into seat_assignments (seat_id, user_id, person_name) values (cast(:s as uuid), cast(:u as uuid), 'x')",
                  {"s": w["seats"]["E1"], "u": w["users"]["ali"]})

@pytest.mark.parametrize("seat,who,body,field", [
    ("nope", "jane", {}, "seat_id"), ("E1", "dave", {}, "user_id"),
    ("E1", "jane", {"end_date": "15/10/2026"}, "end_date"), ("E1", "jane", {"note": "x" * 201}, "note")])
def test_validation(client, monkeypatch, db, seat, who, body, field):
    w = build_world(client, monkeypatch)
    w["seats"]["nope"] = "00000000-0000-0000-0000-000000000000"
    r = put(client, w, seat, who, **body)
    assert r.status_code == 400 and field in r.get_json()["fields"]

def test_non_admin_403_everywhere(client, monkeypatch, db):
    w = build_world(client, monkeypatch); h = hdr(w["tok"]["jane"]); sid = w["seats"]["E1"]
    assert client.get(f"/api/admin/seat-assignments?plan_id={w['plan']}", headers=h).status_code == 403
    assert client.put(f"/api/admin/seat-assignments/seats/{sid}", headers=h, json={"user_id": w["users"]["jane"]}).status_code == 403
    assert client.delete(f"/api/admin/seat-assignments/{sid}", headers=h).status_code == 403
```

  `dave` is deactivated in `build_world`. Task 3 adds the 403 check for the Insights endpoint.

- [ ] **Step 2: Run them and confirm they fail**

  Run: `python -m pytest tests/test_seat_assignments.py -q`
  Expected: FAIL, with an import error for `app.admin.seat_assignments`.

- [ ] **Step 3: Implement**
  - **Migration:** the table plus `create unique index if not exists seat_assignments_one_per_seat on
    seat_assignments (seat_id) where closed_at is null`, and the same on `user_id`. The note length is checked as
    `check (note is null or length(note) <= 200)`. The `closed_reason` check is in `('cleared', 'moved',
    'reassigned')`.
  - **Model:** write the ORM model to match.
  - **PUT order:**
    1. validate;
    2. load the seat's current row and the person's current row;
    3. if the person holds another seat and `move` is not true, send the needs-move 409;
    4. close the person's other row (`moved`) and the seat's other-person row (`reassigned`);
    5. if the seat's current row is this person, update `end_date` and `note` (`change`); otherwise insert
       (`create`);
    6. commit, mapping `IntegrityError` to the race 409;
    7. then audit with `{seat_id, seat_label, user_id, person_name, end_date}`.
  - **`person_name`:** the user's `full_name` at the moment of assignment.
  - **Today:** `rules.local_today(rules.now())`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `python -m pytest tests/test_seat_assignments.py tests/test_audit_views.py -q`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "feat: admins assign seats to people with an end date (history kept)"`

  Stage the new files.

---

### Task 2: Removed seats, inactive and deleted people, no effect elsewhere

**Files:**
- Modify: `webapp-backend/app/admin/seat_assignments.py`, only if a test fails
- Test: `webapp-backend/tests/test_seat_assignments.py`

**Interfaces:** consumes Task 1. Produces no new names.

- [ ] **Step 1: Write the tests**

```python
def test_removed_seat_still_listed_and_clearable(client, monkeypatch, db):
    w = build_world(client, monkeypatch); a = put(client, w, "U1", "jane").get_json()
    h = hdr(w["tok"]["root"])
    els = client.get(f"/api/admin/floor-plans/{w['plan']}", headers=h).get_json()["elements"]
    client.put(f"/api/admin/floor-plans/{w['plan']}/elements", headers=h,
               json={"elements": [e for e in els if e.get("label") != "U1"]})
    client.post(f"/api/admin/floor-plans/{w['plan']}/publish", headers=h)
    other = add_floor(client, w, "Level 2", [{"label": "L2-A", "x": 0, "y": 0, "open_to_all": True}])
    for plan in (w["plan"], other):                                     # shown on every floor's page
        item = client.get(f"/api/admin/seat-assignments?plan_id={plan}", headers=h).get_json()["items"][0]
        assert (item["seat_removed"], item["seat_label"], item["plan_id"]) == (True, "U1", None)
    assert client.delete(f"/api/admin/seat-assignments/{a['id']}", headers=h).status_code == 204

def test_deactivated_person_keeps_assignment(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    client.patch(f"/api/admin/users/{w['users']['jane']}", headers=hdr(w["tok"]["root"]), json={"is_active": False})
    item = client.get(f"/api/admin/seat-assignments?plan_id={w['plan']}", headers=hdr(w["tok"]["root"])).get_json()["items"][0]
    assert item["user"]["is_active"] is False and item["person_name"] == "Jane Tan"

def test_deleted_person_history_kept(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "carl")
    client.delete(f"/api/admin/users/{w['users']['carl']}", headers=hdr(w["tok"]["root"]))
    assert run_one("select person_name, user_id from seat_assignments") == {"person_name": "Carl Lim", "user_id": None}

def test_assignment_changes_nothing_elsewhere(client, monkeypatch, db):
    w = build_world(client, monkeypatch); h = hdr(w["tok"]["jane"])
    urls = [f"/api/desk/floors/{w['plan']}?date=2026-10-16", "/api/desk/suggest?date=2026-10-16&preset=am",
            "/api/desk/bookings/mine", f"/api/public/floors/{w['plan']}"]
    before = [client.get(u, headers=h).get_json() for u in urls]
    put(client, w, "E1", "jane"); put(client, w, "F1", "ali")
    assert [client.get(u, headers=h).get_json() for u in urls] == before
    assert book(client, w, "dina", "E1").status_code == 201      # jane's assigned seat is still bookable by its team
    assert book(client, w, "jane", "F2").status_code == 201      # and jane is not steered to her assigned seat
```

  Check the floor-plans GET/PUT shapes against `tests/test_admin_floorplans.py` before writing the removed-seat test.

- [ ] **Step 2: Run them**

  Run: `python -m pytest tests/test_seat_assignments.py -q`
  Expected: PASS. If any fails, fix `seat_assignments.py`, never the other modules.

- [ ] **Step 3: Commit**

  `git commit -am "test: seat assignments survive removed seats and deleted people, and change nothing else"`

---

### Task 3: Insights endpoint

**Files:**
- Modify: `webapp-backend/app/admin/seat_assignments.py` (the route lives with its module)
- Test: `webapp-backend/tests/test_seat_assignments.py`

**Interfaces:**
- Produces `GET /api/admin/insights/seat-assignments-ending`, giving `{"today": "YYYY-MM-DD", "items": [dto...]}`.
  It holds current assignments with `today - 14 <= end_date <= today + 14`, ordered by `end_date`, then
  `person_name`. Items carry `status` (`leaving_soon` or `left`).

- [ ] **Step 1: Write the failing test.** Today is 2026-10-15.

```python
def test_insights_window(client, monkeypatch, db):
    w = build_world(client, monkeypatch)
    add_floor(client, w, "Level 2", [{"label": l, "x": i * 2, "y": 0, "open_to_all": True} for i, l in enumerate("ABCD")])
    put(client, w, "A", "jane", end_date="2026-10-01")    # ended 14 days ago: listed
    put(client, w, "B", "ali", end_date="2026-09-30")     # 15 days ago: not listed
    put(client, w, "C", "carl", end_date="2026-10-29")    # today + 14: listed
    put(client, w, "D", "bob", end_date="2026-10-30")     # today + 15: not listed
    put(client, w, "E1", "dina")                          # no end: not listed
    body = client.get("/api/admin/insights/seat-assignments-ending", headers=hdr(w["tok"]["root"])).get_json()
    assert [(i["person_name"], i["status"]) for i in body["items"]] == [("Jane Tan", "left"), ("Carl Lim", "leaving_soon")]
    a = body["items"][0]["id"]
    client.delete(f"/api/admin/seat-assignments/{a}", headers=hdr(w["tok"]["root"]))          # cleared: drops off at once
    assert [i["person_name"] for i in client.get("/api/admin/insights/seat-assignments-ending",
            headers=hdr(w["tok"]["root"])).get_json()["items"]] == ["Carl Lim"]
```

- [ ] **Step 2: Run it and confirm it fails**

  Run: `python -m pytest tests/test_seat_assignments.py::test_insights_window -q`
  Expected: FAIL (404).

  Also add `test_insights_non_admin_403`: jane's token gets 403 from the endpoint.

- [ ] **Step 3: Implement** the route.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `python -m pytest tests/test_seat_assignments.py -q`, then the full suite, `python -m pytest -q`.
  Expected: all PASS.

- [ ] **Step 5: Commit**

  `git commit -am "feat: Insights lists seat assignments ending soon or ended in the last 14 days"`

---

### Task 4: Frontend helpers, and the `notes` plate in FloorDrawing

**Files:**
- Create: `webapp-frontend/src/pages/assignments/assignmentLogic.js`
- Create: `webapp-frontend/scripts/smoke_assignment_logic.mjs`
- Modify: `webapp-frontend/src/display/FloorDrawing.jsx` (optional `notes` prop)
- Modify: `webapp-frontend/src/display/floor.css` (plate and tone styles)

**Interfaces:**
- Produces in `assignmentLogic.js`:
  - `STATUS_TEXT = { assigned: 'Assigned', leaving_soon: 'Leaving soon', left: 'Left' }`;
  - `plateName(fullName) -> string`: the first word, cut to 10 characters with "…" (9 characters plus "…");
  - `shortDate(iso) -> string`: `'2026-10-20'` gives `'20/10'`, and null gives `''`;
  - `seatNotes(items) -> { [seatId]: { name, date, tone, tip } }`:
    - `tone` is `'ok' | 'soon' | 'left'`;
    - `tip` is `['{label} · {Full name}', 'Until dd/MM/yyyy']`, with `'No end date'` when there is none;
    - only items that are not `seat_removed`.
  - `sortRows(rows, key) -> rows`, with `key` `'status' | 'end_date'`:
    - status order is left, then leaving soon, then assigned, then unassigned;
    - by end date, the ones with no date go last;
    - ties are broken by seat label;
  - `tableRows(seats, items, assignedOnly) -> rows`, with one row per seat on the floor in label order,
    `{ seat_id, seat_label, assignment | null }`, plus the removed-seat items at the end;
  - `moveQuestion(fullName, from, to)`, giving `'Move {fullName} from {from} to {to}?'`;
  - `replaceQuestion(oldName, newName, label)`, giving `'Replace {oldName} with {newName} on {label}?'`;
  - `cardRows(items) -> [{ id, seat_id, plan_id, person_name, seat_label, plan_name, end_date, status, link }]`,
    where `link` is `/seat-assignments?floor={plan_id}&seat={seat_id}`, and for a removed seat
    `/seat-assignments?assignment={id}`.
- Produces in `FloorDrawing`: an optional prop `notes = null`.
  - When `notes[seat.id]` exists, the seat gets the extra class `assign-{tone}` on its chair.
  - It gets a plate to its right (the left when the plate would leave the drawing): a rect with class
    `fd-assign-plate`, and two text lines, class `fd-assign-text`, at 9px and 8px.
  - The hover tip uses `note.tip` in place of `seatTip(seat)`.
  - With no `notes`, the output is unchanged.

- [ ] **Step 1: Write the smoke script**

```js
import assert from 'node:assert/strict';
import { cardRows, moveQuestion, plateName, seatNotes, shortDate, sortRows, tableRows } from '../src/pages/assignments/assignmentLogic.js';
assert.equal(plateName('Jane Tan'), 'Jane');
assert.equal(plateName('Bartholomew Lee'), 'Bartholom…');
assert.equal(shortDate('2026-10-20'), '20/10'); assert.equal(shortDate(null), '');
const a = { id: 'a1', seat_id: 's1', seat_label: 'E1', plan_id: 'p', person_name: 'Jane Tan', end_date: '2026-10-20', status: 'leaving_soon', seat_removed: false };
assert.deepEqual(seatNotes([a]).s1, { name: 'Jane', date: '20/10', tone: 'soon', tip: ['E1 · Jane Tan', 'Until 20/10/2026'] });
assert.deepEqual(seatNotes([{ ...a, seat_removed: true }]), {});
const rows = tableRows([{ id: 's2', label: 'A2' }, { id: 's1', label: 'E1' }], [a], false);
assert.deepEqual(rows.map((r) => [r.seat_label, Boolean(r.assignment)]), [['A2', false], ['E1', true]]);
assert.deepEqual(tableRows([{ id: 's2', label: 'A2' }, { id: 's1', label: 'E1' }], [a], true).map((r) => r.seat_label), ['E1']);
assert.deepEqual(sortRows(rows, 'status').map((r) => r.seat_label), ['E1', 'A2']);
assert.equal(moveQuestion('Jane Tan', 'L3-A4', 'L3-B2'), 'Move Jane Tan from L3-A4 to L3-B2?');
assert.equal(cardRows([a])[0].link, '/seat-assignments?floor=p&seat=s1');
console.log('assignment logic smoke OK');
```

- [ ] **Step 2: Run it and confirm it fails**

  Run: `node scripts/smoke_assignment_logic.mjs`
  Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `assignmentLogic.js`, the `notes` prop in `FloorDrawing.jsx` and the CSS:
  - `--fd-assign-plate` and `--fd-assign-text` tokens in both the light and the dark palette;
  - `.fd .fd-chair.assign-soon { fill: #f59e0b }` and `.fd .fd-chair.assign-left { fill: #ef4444 }`;
  - `assign-ok` uses the theme's chair colour with a solid outline.

  Write each file once.

- [ ] **Step 4: Verify**

  Run: `node scripts/smoke_assignment_logic.mjs && node scripts/smoke_display_logic.mjs && npm run build`
  Expected: OK, OK, and the build succeeds.

- [ ] **Step 5: Commit**

  `git commit -m "feat: seat assignment helpers and name/end-date plates on the floor drawing"`

  Stage the new files.

---

### Task 5: Seat assignments page, menu, and Insights card

**Files:**
- Create: `webapp-frontend/src/pages/assignments/SeatAssignmentsPage.jsx`
- Create: `webapp-frontend/src/pages/assignments/assignments.css`
- Create: `webapp-frontend/src/pages/insights/SeatAssignmentsEndingCard.jsx`
- Modify: `webapp-frontend/src/App.jsx` (an `adminLinks` entry placed before Audit Log, and the `/seat-assignments`
  route under `AdminOnly`, plus an icon `seat` in `NavIcon`)
- Modify: `webapp-frontend/src/pages/insights/InsightsPage.jsx` (the card in the bottom grid)

**Interfaces:**
- Consumes the Task 1 and Task 3 API and the Task 4 helpers.
- Also consumes `GET /api/public/floors` and `/api/public/floors/<id>` for the layout. Before drawing, map every
  seat to `{ ...seat, state: 'available', occupant: null, booking: null }`, so live use never shows here.
- Uses `GET /api/admin/users?q=&status=active&page_size=10` for the person search.

- [ ] **Step 1: Build `SeatAssignmentsPage.jsx`.** Write it once.
  - **Top:** floor picker (as on Book a desk), reading `?floor=`, and a "Show assigned only" toggle.
  - **Left:** `<FloorDrawing floor={neutralFloor} notes={seatNotes(items)} selectedId={selectedSeatId}
    onSeatClick={...}/>`.
  - **Right:** a table with Seat, Person, End date, Status and Note columns. The Status and End date headers sort
    with `sortRows`. Clicking a row selects the seat, and the drawing and the table share the selection. `?seat=`
    and `?assignment=` preselect a seat.
  - **Form under the table, for the selected seat:**
    - person search (active accounts), end date, note (maxLength 200), **Save**, and **Clear assignment** when
      assigned;
    - Save on a seat held by someone else asks `replaceQuestion` first;
    - a 409 with `needs_move` asks `moveQuestion(name, current_seat_label, label)` and resends with `move: true`;
    - the race 409 shows its message and reloads.
  - **Removed-seat rows:** the label is followed by "Seat removed", and only Clear is offered.
  - **Empty floor:** "This floor has no seats."

- [ ] **Step 2: Build `SeatAssignmentsEndingCard.jsx`.** Follow `ZoneUtilisationCard`: load once, with no refresh
  timer.
  - Title "Seat assignments ending" and two groups, **Leaving soon** and **Left**.
  - Each row shows the person, the seat, the floor (or "Seat removed") and the end date via `formatDate`, and links
    to `row.link`.
  - The empty state is the Global Constraints text.

- [ ] **Step 3: Wire up `App.jsx` and `InsightsPage.jsx`.** Write each file once.

- [ ] **Step 4: Verify**

  Run: `npm run build`, then every smoke script, `for f in scripts/smoke_*.mjs; do node $f; done`.
  Expected: the build succeeds and every smoke script prints OK.

- [ ] **Step 5: Commit**

  `git commit -m "feat: Seat assignments page and Insights card"`

  Stage the new files.

- [ ] **Step 6: Click paths for the hand-over report.** List them; don't run them.
  - As admin, open Administration → Seat assignments and pick a floor. Click a seat, search for Jane, set an end
    date 5 days ahead, and save. Jane's name and the date appear beside the seat in amber, and the table row reads
    "Leaving soon".
  - Assign Jane to another seat. Answer yes to "Move Jane Tan from … to …?". The first seat is free again.
  - In Insights, "Seat assignments ending" lists Jane. Clicking the row opens the page with her seat selected.
  - In Book a desk, the seat looks and books exactly as before.
