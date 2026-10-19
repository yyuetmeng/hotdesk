# Team Seats First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members of a project team can book their team's seats. They must use a free team seat before a free-for-all seat, and the app suggests seats in that order: on Book a desk, when booking for a colleague, at check-in and for auto-book.

**Architecture:**
- One new section in `app/desk/service.py` ("team first") holds all the logic:
  - load the relevant published seats with their zones in one query;
  - test which ones are free for a booking slot or a check-in, using one `floor_context`;
  - rank them (usual seat, then same zone, same floor, floor order, label).
- `create_booking`, `checkin_decision`, the floor payload (`floor_view`), the new `GET /api/desk/suggest` and auto-book all call that section. They never reimplement it.
- On the frontend, pure helpers in `bookingLogic.js` / `deskLogic.js` decide which hint or button to show; the components only render them.

**Tech Stack:** Flask + SQLAlchemy 2.0 ORM, pytest on local Postgres (`localhost:5432`, never Supabase); React 19 + Vite, node smoke scripts for pure helpers.

**Spec:** `docs/superpowers/specs/2026-10-19-team-seats-first-design.md`

## Global Constraints

- **Team seats:** seats on **published** floors whose `department_id` is one of the person's project teams. All floors count, not just the one being viewed.
- **Person:** the signed-in user, or the colleague when booking for someone else. Admins follow the rule too.
- **Free for a booking:** no booking block within `rules.preset_range(day, preset, at)` and no open check-in overlapping it. This is today's `can_book` test.
- **Free for a check-in:** the check-in decision *without* the team-first step returns ok.
- **Suggestion dict** (every API that returns one): `{"seat_id", "seat_label", "plan_id", "plan_name", "zone"}`. The ids are strings and `zone` may be `null`.
- **Messages** (exact):
  - untagged seat on booking (400): `This seat cannot be booked: it has no project team.`
  - another team's seat on booking (403): `This seat is for another project team.`
  - team first on booking (409): `<Your|{full_name}'s> project team has a free seat: {seat_label} on {plan_name}. Book that one instead.`
  - team first on a walk-up check-in (409): `Your project team has a free seat: {seat_label} on {plan_name}. Check in there instead.` *(plan call: the spec asks for the same shape as booking. "Book that one" would be wrong at a check-in.)*
  - not allowed to suggest for that colleague (403): `you can only book for colleagues in your project teams` (same as `create_booking`).
  - auto-book with nothing free: message `no free seat`.
- **Error body with a suggestion:** `{"error": <message>, "suggestion": <suggestion dict>}`.
- **Suggest response:** `{"tier": "team"|"open"|"none", "seats": [suggestion, ...]}`, at most `limit` (default 5) seats.
- **Ranking**, best first:
  1. the person's usual seat;
  2. the same floor and same zone as the usual seat (only when that zone is not null);
  3. the same floor as the usual seat;
  4. the rest.
  - Ties: published-floor order (`FloorPlan.name`, as in `published_floors()`), then `seat_label.casefold()`.
  - With no usual seat on a published floor, it's only floor order, then label.
  - Free-for-all seats are suggested only when no team seat is free.
- **Floor UI copy:**
  - hint: `Your project team has a free seat: {label} on {plan}.`
  - hint button: `Book {label} instead`
  - Find button: `Find me a seat`
  - nothing free: `No free seat for {day} {slot}.`
  - colleague row hint: `{first name}'s team has a free seat: {label}.`
  - row button: `Use {label}`
  - Find for colleague: `Find a seat for {first name}`
  - check-in button: `Go to {label}`
- **Settings label:** `Auto-book a seat for me (my usual seat first, then my team's seats).`
- **Auto-book notes:**
  - booked: `Auto-booked {label} for {day} (full day).`
  - booked another seat than the usual one: `Your usual seat {usual} was not available; auto-booked {label} for {day}.`
  - failed: `Could not auto-book for {day}: {message}.`
- **No new audit events.** Refusals are not audited.
- **Frontend edits:** Vite in this OneDrive folder misses quick second writes, so make **one write per file** per change (combine edits to a file into a single Edit/Write).
- **Tests:** never put a written-out password in tests (coding guidelines 2.7). Use `creds.py`.
- **Commits:** `type: summary`, with tests in the same commit as the code they cover.

## Review Focus

1. **Republishing a floor cancels team-seat bookings.** `cancel_for_plan_change` cancels every booking whose seat is "no longer free for all". Once team seats are bookable, a plain republish would wrongly cancel valid team-seat bookings. Expected: a booking survives while its seat is free for all **or** tagged with one of the booked person's teams. *(Task 3 adds `test_republish_keeps_team_seat_bookings`.)*
2. **"Go to L3-A4" from one check-in page to another.** React Router reuses `SeatCheckIn`, so its `attempted` ref stays true and the new seat never checks in. Expected: opening the suggested seat checks in there, as a scan would. *(Task 9 adds `key={seatId}` and a manual check step.)*
3. **A user who is already checked in walks up to a free-for-all seat.** Expected: "Give up your seat at X first.", not the team-first message. The team-first step runs only after every other check has passed. *(Task 4 adds `test_checked_in_elsewhere_gets_give_up_message_not_team_first`.)*
4. **A team seat on an unpublished floor.** Expected: it doesn't count, so a free-for-all booking is allowed. *(Task 3 adds `test_team_seat_on_unpublished_floor_does_not_block`.)*
5. **Late in the day, when some slots can no longer be booked** (e.g. 18:45 today). Expected: the floor still loads, and `team_first` is `null` for slots that can't be booked. *(Task 5 adds `test_floor_late_in_day_team_first_is_null`.)*

---

## File Structure

**Backend (`webapp-backend/`)**
- `app/desk/zones.py`: add `zone_at(zones, el)`, the name of the zone containing a seat.
- `app/desk/service.py`: `DeskError.extra`; `colleague_for`; the team-first section (`published_seats`, `suggestion`, `rank_seats`, `free_to_book`, `free_to_check_in`, `team_first_seat`, `suggest_seats`); changes to `create_booking`, `checkin_decision`, `check_in`, `seat_info`, `floor_view`/`seat_states`, `cancel_for_plan_change`.
- `app/desk/routes.py`: pass `DeskError.extra` into the error body; `team_first` on the floor; `GET /suggest`.
- `app/desk/dashboard.py`: `seat_places` uses `zone_at` and adds `department_id`.
- `app/desk/autobook.py`: book `suggest_seats(...)[0]`; new note fields; runs without a usual seat.
- `app/auth/routes.py`: sign-in auto-book no longer requires a usual seat.
- `tests/desk_helpers.py`: Design team, user `dina`, E1 retagged, `add_floor`, `book()` with a per-seat plan.
- `tests/test_team_first.py` (new): booking, check-in, suggestions and floor-payload tests.
- `tests/test_usual_seat.py`, `tests/test_query_budget.py`: updated.

**Frontend (`webapp-frontend/`)**
- `src/api.js`: `err.suggestion`.
- `src/desk/bookingLogic.js`: per-row `plan_id`; `canAddSeat` uses `free`; `bookBlock`; `rowTeamHint`; `firstName`.
- `src/desk/deskLogic.js`: `teamSeatText`.
- `src/desk/BookDeskPage.jsx`: Find me a seat; `jumpTo`; passes `teamFirst`/`jumpTo` down.
- `src/desk/SeatPanel.jsx`: booking panel for tagged seats; check-in refusal with Go to.
- `src/desk/BookingPanel.jsx`: hint for yourself; colleague suggestions; per-row swaps; a suggestion button on 409 results.
- `src/desk/CheckInPage.jsx`, `src/desk/scanLogic.js`: suggestion on the refused result; `key={seatId}`.
- `src/ThemeSettings.jsx`: the switch for everyone; new label.
- `src/pages/dashboard/dashboardLogic.js`, `DashboardPage.jsx`: `autoBookText`.
- Smoke scripts: `smoke_booking_logic.mjs`, `smoke_desk_logic.mjs`, `smoke_scan_logic.mjs`, `smoke_dashboard_logic.mjs`.

---

### Task 1: Test world with a Design team (no product change)

The team-first rule would refuse most existing tests: jane, ali, carl and root are in Engineering, and E1 (Engineering) sits free beside F1/F2. Owner decision (2026-10-19): retag E1 to a new team, Design. The new user dina is in **Engineering and Design**, so she stays a teammate of jane/carl, and E1 is now *her* team seat.

**Files:**
- Modify: `webapp-backend/tests/desk_helpers.py`
- Modify (mechanical): every test that uses E1 as "my own team's seat". From the grep: `test_audit_trail.py`, `test_checkin_location.py`, `test_desk_checkins.py`, `test_desk_dashboard.py`, `test_desk_people.py`, `test_desk_public.py`, `test_displays.py`, `test_floor_zones.py`, `test_insights_occupancy.py`, `test_insights_teams.py`, `test_usual_seat.py`

**Interfaces:**
- Produces:
  - `build_world(...)` returns the existing keys plus `"design": <dept id>`, `users["dina"]`, `tok["dina"]`, and `"seat_plan": {label: plan_id}` (every seat on Level 1 → `world["plan"]`).
  - E1 has `department_id = design`. dina = `_user("dina", "Dina Koh", depts=[eng, design], allowance=1)`.
  - `add_floor(client, world, name: str, seats: list[dict], zones: list[dict] = ()) -> str` creates and publishes a floor and returns its plan id. It adds each seat label to `world["seats"]` and `world["seat_plan"]`, and records `world.setdefault("plans", {})[name] = plan_id`.
    - Seat dict: `{"label", "x", "y", "department_id"?, "open_to_all"?}`.
    - Zone dict: `{"label", "x", "y", "w", "h"}`. Zones are posted as `{"type": "zone", ..., "rotation": 0}`.
  - `book(...)` uses `world["seat_plan"].get(seat, world["plan"])` as `plan_id`.

- [ ] **Step 1: Change `desk_helpers.py`.** Add the Design department and dina, tag E1 with `design`, sign dina in, and add `seat_plan`, `add_floor` and the `book()` change.
- [ ] **Step 2: Update the E1 tests by one rule.** Where a test checks in or books E1 *as a member of its team*, use `dina` instead of `carl`/`jane`, and `"Dina Koh"`/`"DK"` instead of `"Carl Lim"`/`"CL"`. Where a test asserts team seat counts, Engineering now has 0 seats and Design has 1; `rows` lists `["Design", "Engineering", "Ops"]`. In `test_walk_in_rules_by_tag`, `jane` on E1 becomes the "another team" case (403), and dina's check-in stores `seat_department_id == design` and `user_department_ids == sorted([eng, design])`. Change nothing else.
- [ ] **Step 3: Run the full suite.**
  Run: `cd webapp-backend && python -m pytest -q`
  Expected: everything passes (same count as before; product code is unchanged).
- [ ] **Step 4: Commit.**
  `git commit -m "test: Design team and dina in the desk test world (E1 retagged) ahead of team-first"`

---

### Task 2: Seat lookup, ranking and `suggest_seats` for booking

**Files:**
- Modify: `webapp-backend/app/desk/zones.py`, `app/desk/dashboard.py` (`seat_places` uses `zone_at` and adds `"department_id": str|None`)
- Modify: `webapp-backend/app/desk/service.py` (new section `# --- team first ---` after `seat state`)
- Test: `webapp-backend/tests/test_team_first.py` (new)

**Interfaces:**
- Produces (in `service`):
  - `zones.zone_at(zones: list, el) -> str | None`: the `zone_name` of the zone containing `el`, by the existing containment rule.
  - `published_seats(departments: set[uuid.UUID] = frozenset(), open_to_all: bool = False, also: frozenset = frozenset()) -> list[dict]`.
    - **One query.** It selects the live seat elements matching (`department_id in departments`) OR (`open_to_all` when the flag is set) OR (`element_id in also`), plus the zone elements of the same published versions, together with the plan id and the live version name. It returns `[]` without querying when there is nothing to match.
    - Each item: `{"el", "seat_id": str, "seat_label", "plan_id": str, "plan_name", "zone", "floor_rank": int}`.
    - Sorted by (`floor_rank`, `seat_label.casefold()`). `floor_rank` follows `FloorPlan.name` order.
  - `suggestion(seat: dict) -> dict`: the five public keys.
  - `rank_seats(seats: list[dict], usual: dict | None) -> list[dict]`: the Global Constraints ranking. `usual` is an item from `published_seats`.
  - `_slot_free(seat_blocks: list, open_now, r: tuple | None) -> bool`: the existing `can_book` expression, minus the `open_to_all` test (`r` is None → False). `seat_states` switches to it in Task 5.
  - `free_to_book(seats: list[dict], day: date, preset: str, at: datetime, ctx: dict | None = None) -> list[dict]`: keeps the seats free for the slot. It calls `floor_context` once for all the seats when `ctx` is None, and returns `[]` when `rules.preset_range` raises.
  - `suggest_seats(person: User, day: date, preset: str | None, at: datetime, purpose: str = "book", limit: int = 5) -> dict`: the Suggest response. This task implements `purpose="book"`; Task 4 adds `"checkin"`.
    - Team tier: free team seats, ranked.
    - Open tier: only if the team tier is empty, from `published_seats(open_to_all=True)` free for the slot, ranked.
    - Otherwise `{"tier": "none", "seats": []}`.
    - Load the usual seat with `also={person.usual_seat_id}` in the same `published_seats` call.

- [ ] **Step 1: Write the module setup and the failing tests** in `tests/test_team_first.py`.
  - **Fixture `world`:**
    - `build_world(client, monkeypatch)`;
    - four more Design-only users, `erin` "Erin Goh", `frank` "Frank Ho", `gus` "Gus Lee" and `hana` "Hana Ali" (`_user(..., depts=[world["design"]])`), each signed in with `_login`, added to `world["users"]`/`world["tok"]`. One person holds one block per slot, so filling the four Design seats needs four people;
    - `add_floor(client, world, "Level 2", seats=[{"label": "D2", "x": 2, "y": 2, "department_id": design}, {"label": "D3", "x": 4, "y": 2, "department_id": design}, {"label": "D4", "x": 8, "y": 8, "department_id": design}, {"label": "F3", "x": 6, "y": 6, "open_to_all": True}], zones=[{"label": "North", "x": 0, "y": 0, "w": 6, "h": 4}])`.
  - **Module helpers** (later tasks reuse them):
    - `_set_usual(client, world, who, seat)` (copy from `test_usual_seat.py`);
    - `check_in(client, world, who, seat)` (copy from `test_desk_checkins.py`);
    - `_floor(client, world, who, day, preset)` → JSON of `GET /api/desk/floors/{world['plan']}?date=..&preset=..`, with `preset` omitted when None;
    - `_suggest(app, world, who, preset="am", day=DAY, purpose="book")` → inside `app.app_context()`, load the user with `orm_session().get(User, world["users"][who])` and return `service.suggest_seats(user, day, preset, rules.now(), purpose)`.
    - `FILL_DESIGN = (("erin", "E1"), ("frank", "D2"), ("gus", "D3"), ("hana", "D4"))`.

```python
def test_suggest_order_usual_zone_floor_then_other_floors(app, client, world):
    _set_usual(client, world, "dina", "D3")
    got = _suggest(app, world, "dina")
    assert got["tier"] == "team"
    assert [s["seat_label"] for s in got["seats"]] == ["D3", "D2", "D4", "E1"]
    assert got["seats"][0] == {"seat_id": world["seats"]["D3"], "seat_label": "D3", "plan_id": world["plans"]["Level 2"],
                               "plan_name": "Level 2", "zone": "North"}

def test_suggest_without_usual_seat_is_floor_then_label(app, world):
    assert [s["seat_label"] for s in _suggest(app, world, "dina")["seats"]] == ["E1", "D2", "D3", "D4"]

def test_suggest_open_tier_without_team_seats(app, client, world):
    _set_usual(client, world, "bob", "F3")
    got = _suggest(app, world, "bob")                      # Ops has no seats: free for all, usual seat's floor first
    assert got["tier"] == "open" and [s["seat_label"] for s in got["seats"]] == ["F3", "F1", "F2"]

def test_suggest_none_when_nothing_free(app, client, world):
    for who, seat in (("jane", "F1"), ("carl", "F2"), ("ali", "F3")):
        assert book(client, world, who, seat, "full").status_code == 201
    assert _suggest(app, world, "bob", "full") == {"tier": "none", "seats": []}
```

- [ ] **Step 2: Run them to see them fail.**
  Run: `python -m pytest tests/test_team_first.py -q`
  Expected: FAIL. `suggest_seats` is not defined.
- [ ] **Step 3: Implement** `zone_at`, `seat_places` changes, `published_seats`, `suggestion`, `rank_seats`, `_slot_free`, `free_to_book`, and `suggest_seats` (book purpose) with the signatures above.
- [ ] **Step 4: Run** `python -m pytest tests/test_team_first.py tests/test_desk_dashboard.py tests/test_usual_seat.py -q`
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat: team-first seat ranking and suggest_seats for booking`

---

### Task 3: Booking rule in `create_booking`, plus plan changes

**Files:**
- Modify: `webapp-backend/app/desk/service.py` (`DeskError`, `colleague_for`, `create_booking`, `cancel_for_plan_change`), `app/desk/routes.py` (`desk_endpoint`)
- Modify: `webapp-backend/tests/test_desk_bookings.py` (`test_only_free_for_all_seats` → `test_booking_by_seat_tag`)
- Test: `webapp-backend/tests/test_team_first.py`

**Interfaces:**
- Consumes: `published_seats`, `free_to_book`, `rank_seats`, `suggestion` (Task 2).
- Produces:
  - `DeskError(message, status=400, **extra)` with `self.extra: dict`. `desk_endpoint` returns `error(str(exc), exc.status, **exc.extra)`.
  - `colleague_for(viewer: User, user_id) -> User`: raises 404 `colleague not found`, and 403 `you can only book for colleagues in your project teams` unless the viewer is an admin. It doesn't check usability or allowance (those stay in `create_booking`).
  - `team_first_seat(person: User, purpose: str, at: datetime, day: date | None = None, preset: str | None = None, ctx: dict | None = None) -> dict | None`: the first ranked free team seat as a `suggestion`, or None.
  - `team_first_message(person: User, viewer: User, s: dict, purpose: str) -> str`: the exact Global Constraints messages.
- `create_booking` order: plan/seat/date parsing → person (`colleague_for` + the existing usability/allowance checks) → tag:
  - neither tagged nor free for all → 400 untagged message;
  - team seat and `not may_use_seat(target, el)` → 403;
  - then `preset_range`, the occupancy check, and, **only for a free-for-all seat**, `team_first_seat(target, "book", at, day, preset)`. When that returns a seat, raise `DeskError(team_first_message(...), 409, suggestion=s)`.
- `cancel_for_plan_change`: keep a booking when `el.open_to_all` or `el.department_id in teams_of[b.booked_for]`. Load `teams_of` with **one** `UserDepartment` query over the booked users.

- [ ] **Step 1: Write the failing tests** (in `test_team_first.py` unless noted):

```python
def test_team_member_books_own_team_seat_and_others_cannot(client, world):
    assert book(client, world, "dina", "E1").status_code == 201
    r = book(client, world, "jane", "D2")
    assert r.status_code == 403 and r.get_json()["error"] == "This seat is for another project team."
    r = book(client, world, "jane", "U1")
    assert r.status_code == 400 and r.get_json()["error"] == "This seat cannot be booked: it has no project team."

def test_free_for_all_refused_while_team_seat_on_another_floor_is_free(client, world):
    assert book(client, world, "erin", "E1", "full").status_code == 201
    r = book(client, world, "dina", "F1", "am")
    assert r.status_code == 409
    assert r.get_json() == {"error": "Your project team has a free seat: D2 on Level 2. Book that one instead.",
                            "suggestion": {"seat_id": world["seats"]["D2"], "seat_label": "D2",
                                           "plan_id": world["plans"]["Level 2"], "plan_name": "Level 2", "zone": "North"}}

def test_free_for_all_allowed_once_every_team_seat_is_taken(app, client, world):
    for who, seat in FILL_DESIGN:
        assert book(client, world, who, seat, "full").status_code == 201
    assert _suggest(app, world, "dina", "am")["tier"] == "open"
    assert book(client, world, "dina", "F1", "am").status_code == 201

def test_team_first_is_slot_aware(client, world):
    for who, seat in FILL_DESIGN:
        assert book(client, world, who, seat, "am").status_code == 201
    assert book(client, world, "dina", "F1", "am").status_code == 201
    assert book(client, world, "dina", "F2", "pm").status_code == 409

def test_rule_uses_the_colleagues_teams_and_binds_admins(client, world):
    r = book(client, world, "ali", "F1", for_user="dina")
    assert r.status_code == 409 and r.get_json()["error"].startswith("Dina Koh's project team has a free seat: E1 on Level 1.")
    assert book(client, world, "dina", "F1", for_user="carl").status_code == 201   # dina's own free team seats don't matter
    assert book(client, world, "root", "F2", for_user="dina").status_code == 409

def test_team_seat_on_unpublished_floor_does_not_block(client, world):
    # Unpublish Level 2 and take E1: dina's only free team seats are now on a draft floor.
    assert client.post(f"/api/admin/floor-plans/{world['plans']['Level 2']}/unpublish", headers=hdr(world["tok"]["root"])).status_code == 200
    assert book(client, world, "erin", "E1", "am").status_code == 201
    assert book(client, world, "dina", "F1", "am").status_code == 201

def test_republish_keeps_team_seat_bookings(client, world):     # in test_desk_public.py, using its _republish
    kept = book(client, world, "dina", "E1").get_json()["id"]
    _republish(client, world, {"F1": lambda e: e, "F2": lambda e: e, "E1": lambda e: e, "U1": lambda e: e})
    assert _state(kept) == "active"
    _republish(client, world, {"F1": lambda e: e, "F2": lambda e: e, "E1": lambda e: {**e, "department_id": world["ops"]}})
    assert _state(kept) == "plan_changed"
```

  (`_state(id)` reads `end_reason` like the existing `test_republish_without_seat_or_retagged_cancels_its_bookings`. Check the unpublish route's actual path in `app/admin/floorplan_publishing.py` and use it.)

  In `test_desk_bookings.py`, replace `test_only_free_for_all_seats` with `test_booking_by_seat_tag`: jane on E1 → 403, jane on U1 → 400.
- [ ] **Step 2: Run them to see them fail.**
  Run: `python -m pytest tests/test_team_first.py tests/test_desk_bookings.py tests/test_desk_public.py -q`
  Expected: FAIL. Team seats are refused with "only free-for-all seats can be booked".
- [ ] **Step 3: Implement** `DeskError.extra`, `desk_endpoint`, `colleague_for`, `team_first_seat` (book purpose), `team_first_message`, the `create_booking` order and `cancel_for_plan_change` as specified.
- [ ] **Step 4: Run** `python -m pytest -q` (full suite; booking order changes touch many tests).
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat: team seats are bookable by their team; free-for-all refused while a team seat is free`

---

### Task 4: Check-in rule and suggestions for check-in

**Files:**
- Modify: `webapp-backend/app/desk/service.py` (`_refuse`, `checkin_decision`, `check_in`, `seat_info`, `free_to_check_in`, `team_first_seat`/`suggest_seats` for `"checkin"`)
- Test: `webapp-backend/tests/test_team_first.py`

**Interfaces:**
- Consumes: Task 3's `team_first_seat`, `team_first_message`.
- Produces:
  - Every decision dict gains `"suggestion": dict | None` (`_refuse(reason, status, suggestion=None)`).
  - `_base_decision(viewer, el, at, ctx=None) -> dict`: today's `checkin_decision` body, unchanged.
  - `checkin_decision(viewer, el, at, ctx=None, team_seat="lookup") -> dict` = `_base_decision`. Then, only if the result is ok **and** `booking is None` **and** `el.open_to_all`:
    - `s = team_first_seat(viewer, "checkin", at)` when `team_seat == "lookup"`, else the given value (a suggestion or None);
    - a seat → `_refuse(team_first_message(viewer, viewer, s, "checkin"), 409, s)`.
  - `free_to_check_in(person, seats, at, ctx=None) -> list[dict]`: the seats where `_base_decision(person, s["el"], at, ctx)["ok"]`. It uses one `floor_context(ids, today, at, person)` when `ctx` is None. **Never** call it per seat with `ctx=None`.
  - `suggest_seats(..., purpose="checkin")` ignores `day`/`preset` and uses today, `at` and `free_to_check_in`.
  - `check_in` raises `DeskError(reason, status, **({"suggestion": s} if s else {}))`.
  - `seat_info` adds `suggestion=decision["suggestion"]` to the viewer fields.

- [ ] **Step 1: Write the failing tests:**

```python
def test_walk_up_free_for_all_refused_while_team_seat_can_be_checked_in(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    r = check_in(client, world, "dina", "F2")
    assert r.status_code == 409
    assert r.get_json()["error"] == "Your project team has a free seat: E1 on Level 1. Check in there instead."
    assert r.get_json()["suggestion"]["seat_id"] == world["seats"]["E1"]
    info = client.get(f"/api/desk/seats/{world['seats']['F2']}", headers=hdr(world["tok"]["dina"])).get_json()
    assert info["can_check_in"] is False and info["suggestion"]["seat_label"] == "E1"
    assert check_in(client, world, "dina", "E1").status_code == 201

def test_checking_in_to_own_free_for_all_booking_is_allowed(client, world, monkeypatch):
    ids = {who: book(client, world, who, seat, "am").get_json()["id"] for who, seat in FILL_DESIGN}
    assert book(client, world, "dina", "F1", "am").status_code == 201        # legal: every team seat taken
    assert client.delete(f"/api/desk/bookings/{ids['erin']}", headers=hdr(world["tok"]["erin"])).status_code == 204
    set_now(monkeypatch, sg(DAY, 7, 45))
    r = check_in(client, world, "dina", "F1")
    assert r.status_code == 201 and r.get_json()["method"] == "booking"

def test_booked_team_seat_later_today_still_counts_as_free_now(client, world, monkeypatch):
    assert book(client, world, "erin", "E1", "pm").status_code == 201
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "dina", "F2").get_json()["suggestion"]["seat_label"] == "E1"

def test_checked_in_elsewhere_gets_give_up_message_not_team_first(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "dina", "E1").status_code == 201
    r = check_in(client, world, "dina", "F2")
    assert r.status_code == 409 and r.get_json()["error"] == "Give up your seat at E1 first." and "suggestion" not in r.get_json()

def test_suggest_for_check_in_uses_now(app, client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert check_in(client, world, "erin", "E1").status_code == 201
    got = _suggest(app, world, "dina", preset=None, purpose="checkin")
    assert got["tier"] == "team" and got["seats"][0]["seat_label"] == "D2"
```

- [ ] **Step 2: Run them to see them fail.**
  Run: `python -m pytest tests/test_team_first.py -k "check" -q`
  Expected: FAIL. The walk-up is allowed (201).
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** `python -m pytest tests/test_team_first.py tests/test_desk_checkins.py tests/test_checkin_location.py -q`
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat: walk-up check-in follows team-first, with a suggested team seat`

---

### Task 5: Floor payload: `can_book`, `free`, `team_first`

**Files:**
- Modify: `webapp-backend/app/desk/service.py` (`floor_view`, `seat_states`), `app/desk/routes.py` (`floor`)
- Modify: `webapp-backend/tests/test_query_budget.py`
- Test: `webapp-backend/tests/test_team_first.py`

**Interfaces:**
- Consumes: `published_seats`, `rank_seats`, `_slot_free`, `checkin_decision(..., team_seat=...)`.
- Produces:
  - `floor_view(plan, day, preset, at, viewer=None) -> {"seats": [...], "team_first": {preset: suggestion|None} | None}`.
  - `seat_states(...)` returns `floor_view(...)["seats"]`; the signature and other callers are unchanged.
  - With a viewer, the method makes **one** `floor_context` call over this floor's seat ids **∪** the viewer's team seat ids (plus the usual seat from the same `published_seats` call). Per seat:
    - `free[p]` = `_slot_free(...)` and the seat is tagged (viewer-independent, used when booking for others; *plan call, needed by §6.2*).
    - `can_book[p]` = `free[p]` and `may_use_seat(viewer, el)` and not (`el.open_to_all` and `team_first[p]`).
    - `can_check_in` = `is_today and checkin_decision(viewer, el, at, ctx, team_seat=team_now)["ok"]`, where `team_now` is the first ranked team seat free for check-in (computed once with the same `ctx`; None when not today).
  - `team_first[p]`: the first ranked team seat free for `p`. It's None when the range raises (too late) or nothing is free.
  - The floor JSON gains `team_first`.

- [ ] **Step 1: Write the failing tests:**

```python
def test_floor_can_book_and_team_first_for_team_member(client, world):
    body = _floor(client, world, "dina", DAY, "am")
    seats = {s["label"]: s for s in body["seats"]}
    assert seats["E1"]["can_book"]["am"] is True and seats["F1"]["can_book"]["am"] is False and seats["F1"]["free"]["am"] is True
    assert body["team_first"]["am"]["seat_label"] == "E1" and set(body["team_first"]) == {"am", "pm", "full"}

def test_floor_for_someone_without_team_seats(client, world):
    body = _floor(client, world, "jane", DAY, "am")
    seats = {s["label"]: s for s in body["seats"]}
    assert seats["E1"]["can_book"]["am"] is False and seats["F1"]["can_book"]["am"] is True
    assert body["team_first"] == {"am": None, "pm": None, "full": None}

def test_floor_team_first_per_preset(client, world):
    for who, seat in FILL_DESIGN:
        assert book(client, world, who, seat, "am").status_code == 201
    body = _floor(client, world, "dina", DAY, "am")
    assert body["team_first"]["am"] is None and body["team_first"]["pm"]["seat_label"] == "E1"

def test_floor_late_in_day_team_first_is_null(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 18, 45))
    body = _floor(client, world, "dina", DAY, None)
    assert body["team_first"]["am"] is None and body["team_first"]["full"] is None
```

  In `test_query_budget.py`, change the parametrisation to `(path, budget, who)`. Set `/api/desk/floors/{plan}` to budget 8 for `root`, and add a row with budget 8 for `dina`. Keep the others with `root`.
- [ ] **Step 2: Run** `python -m pytest tests/test_team_first.py -k floor tests/test_query_budget.py -q`
  Expected: FAIL. There's no `team_first`/`free` key yet.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** `python -m pytest tests/test_team_first.py tests/test_query_budget.py tests/test_desk_bookings.py tests/test_desk_public.py tests/test_floor_zones.py -q`
  Expected: PASS. `test_floor_view_query_count_does_not_grow_with_seats` still passes.
- [ ] **Step 5: Commit.** `feat: floor payload shows team seats as bookable and the viewer's first free team seat`

---

### Task 6: `GET /api/desk/suggest`

**Files:**
- Modify: `webapp-backend/app/desk/routes.py`
- Test: `webapp-backend/tests/test_team_first.py` (switch `_suggest` to the endpoint where it helps)

**Interfaces:**
- Consumes: `suggest_seats`, `colleague_for`.
- Produces: `GET /api/desk/suggest?date=&preset=&purpose=book|checkin&user_id=`.
  - `purpose` defaults to `book`; anything else is a 400 `purpose must be book or checkin`.
  - For `book`: `date` comes from `_day_arg`, must be one of `rules.bookable_days(at)`, and `preset` must be in `rules.PRESETS`. Errors are 400 with the existing messages.
  - The person is `colleague_for(viewer, user_id)` when `user_id` is given and isn't the viewer.

- [ ] **Step 1: Write the failing tests:**

```python
def test_suggest_endpoint_and_permission(client, world):
    q = f"/api/desk/suggest?date={DAY.isoformat()}&preset=am"
    r = client.get(q, headers=hdr(world["tok"]["dina"]))
    assert r.status_code == 200 and r.get_json()["tier"] == "team"
    assert client.get(q + f"&user_id={world['users']['dina']}", headers=hdr(world["tok"]["ali"])).get_json()["seats"][0]["seat_label"] == "E1"
    r = client.get(q + f"&user_id={world['users']['bob']}", headers=hdr(world["tok"]["jane"]))
    assert r.status_code == 403 and r.get_json()["error"] == "you can only book for colleagues in your project teams"
    assert client.get(q + f"&user_id={world['users']['bob']}", headers=hdr(world["tok"]["root"])).status_code == 200
    assert client.get(q + "&purpose=nap", headers=hdr(world["tok"]["dina"])).status_code == 400
```

- [ ] **Step 2: Run** `python -m pytest tests/test_team_first.py -k endpoint -q`
  Expected: FAIL (404).
- [ ] **Step 3: Implement the route.**
- [ ] **Step 4: Run** `python -m pytest tests/test_team_first.py -q`
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat: GET /api/desk/suggest`

---

### Task 7: Auto-book books the first suggestion

**Files:**
- Modify: `webapp-backend/app/desk/autobook.py`, `app/auth/routes.py` (`_auto_book_after_sign_in`: drop the `usual_seat_id` condition)
- Modify: `webapp-backend/tests/test_usual_seat.py`

**Interfaces:**
- Consumes: `suggest_seats(user, day, "full", at)`, `service.create_booking`.
- Produces:
  - `usual_seat(user, places)["bookable"]` = `place["open_to_all"] or place["department_id"] in {str(d) for d in service.department_ids(user)}`.
  - `run_auto_book(user, at, places) -> list[dict]` runs whenever `user.auto_book` is on (a usual seat is optional). It keeps the existing day skips. Each note is `{"date", "seat_label": str|None, "ok": bool, "message": str|None, "usual_seat_label": str|None}`.
  - `usual_seat_label` is set only when the user has a usual seat and a **different** seat was booked.
  - When there's no suggestion: `ok False`, `seat_label None`, `message "no free seat"`. A `DeskError` from `create_booking` is reported as today (rolled back).

- [ ] **Step 1: Update and add tests** in `test_usual_seat.py`:
  - keep `test_auto_book_today_and_tomorrow_once` (jane, F1);
  - replace `test_team_seat_is_not_bookable` with `test_usual_seat_bookable_for_its_team` (dina's E1 is bookable, jane's E1 isn't);
  - replace `test_auto_book_off_or_team_seat_does_nothing` with:

```python
def test_auto_book_off_does_nothing(client, world):
    _set_usual(client, world, "jane", "F1")
    assert _dash(client, world, "jane")["auto_book"] == []

def test_auto_book_team_seat_before_free_for_all_usual_seat(client, world):
    _set_usual(client, world, "dina", "F1"); _auto_on(client, world, "dina")
    notes = _dash(client, world, "dina")["auto_book"]
    assert [(n["seat_label"], n["ok"], n["usual_seat_label"]) for n in notes] == [("E1", True, "F1")] * 2

def test_auto_book_usual_team_seat(client, world):
    _set_usual(client, world, "dina", "E1"); _auto_on(client, world, "dina")
    assert [(n["seat_label"], n["usual_seat_label"]) for n in _dash(client, world, "dina")["auto_book"]] == [("E1", None)] * 2

def test_auto_book_without_usual_seat(client, world):
    _auto_on(client, world, "bob")
    assert [(n["seat_label"], n["ok"]) for n in _dash(client, world, "bob")["auto_book"]] == [("F1", True)] * 2

def test_auto_book_nothing_free(client, world):
    for who, seat in (("jane", "F1"), ("carl", "F2")):
        assert book(client, world, who, seat, "full").status_code == 201
    _auto_on(client, world, "bob")
    friday = next(n for n in _dash(client, world, "bob")["auto_book"] if n["date"] == DAY.isoformat())
    assert (friday["ok"], friday["seat_label"], friday["message"]) == (False, None, "no free seat")
```

  Update `test_auto_book_reports_a_taken_seat`: Friday now books F2 with `usual_seat_label == "F1"`. Update `test_auto_book_on_sign_in` to add a case with no usual seat (bob).
- [ ] **Step 2: Run** `python -m pytest tests/test_usual_seat.py -q`
  Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** `python -m pytest -q` (full suite).
  Expected: PASS.
- [ ] **Step 5: Commit.** `feat: auto-book books the first suggested seat (usual seat, team seats, then free for all)`

---

### Task 8: Frontend helpers (pure, smoke-tested)

**Files:**
- Modify: `webapp-frontend/src/api.js` (`flaskRequest`: `err.suggestion = data.suggestion ?? null`)
- Modify: `webapp-frontend/src/desk/bookingLogic.js`, `src/desk/deskLogic.js`, `src/desk/scanLogic.js`, `src/pages/dashboard/dashboardLogic.js`
- Test: `scripts/smoke_booking_logic.mjs`, `smoke_desk_logic.mjs`, `smoke_scan_logic.mjs`, `smoke_dashboard_logic.mjs`

**Interfaces:**
- Produces:
  - `bookingRequests(...)`: `plan_id: row.seat.plan_id ?? planId`.
  - `canAddSeat(seat, preset, pickedIds)` = `Boolean(seat.free?.[preset] && !pickedIds.includes(seat.id))`.
  - `bookBlock({ seat, preset, forWho, teamFirst }) -> null | { kind: 'team_hint', suggestion } | { kind: 'other_team' } | { kind: 'not_free' }`:
    - `forWho === 'me'`:
      - `team_hint` when `seat.open_to_all` and `teamFirst?.[preset]` is set and its `seat_id !== seat.id`;
      - else `other_team` when `!seat.open_to_all && seat.free?.[preset] && !seat.can_book?.[preset]`;
      - else `not_free` when `!seat.can_book?.[preset]`;
      - else null.
    - `forWho === 'other'`: `not_free` when `!seat.free?.[preset]`, else null.
  - `firstName(name) -> string` (first word).
  - `rowTeamHint(row, result) -> suggestion | null`: `result?.tier === 'team'`, `row.seat.open_to_all` and `result.seats[0].seat_id !== row.seat.id` → `result.seats[0]`.
  - `toRowSeat(s) -> { id, label, plan_id, open_to_all: false }` (a suggestion as a row seat).
  - `teamSeatText(s, whose = 'Your project team')` → `` `${whose} has a free seat: ${s.seat_label} on ${s.plan_name}.` ``
  - `checkInOutcome`: a `bad` outcome carries `suggestion` (from `result.suggestion`, or `seat.suggestion`).
  - `autoBookText(n, dayLabel) -> string`, with the three Global Constraints notes. `dayLabel` is the existing `dayText` result, lower-cased when it is "Today", as `DashboardPage` does now.

- [ ] **Step 1: Add the smoke assertions** (one write per file):

```js
// smoke_booking_logic.mjs
const f1 = { id: 'f1', label: 'F1', open_to_all: true, free: { am: true }, can_book: { am: false } };
const e1s = { seat_id: 'e1', seat_label: 'E1', plan_id: 'p1', plan_name: 'Level 1', zone: null };
assert.deepEqual(bookingRequests({ forWho: 'other', rows: [{ seat: { id: 'd2', plan_id: 'p2' }, person: tan }, { seat: s1, person: priya }],
  dayChoice: 'first', days, preset: 'am', planId: 'p' }).map((r) => r.plan_id), ['p2', 'p']);
assert.deepEqual(bookBlock({ seat: f1, preset: 'am', forWho: 'me', teamFirst: { am: e1s } }), { kind: 'team_hint', suggestion: e1s });
assert.deepEqual(bookBlock({ seat: { ...f1, open_to_all: false }, preset: 'am', forWho: 'me', teamFirst: { am: null } }), { kind: 'other_team' });
assert.equal(bookBlock({ seat: f1, preset: 'am', forWho: 'other', teamFirst: { am: e1s } }), null);
assert.deepEqual(bookBlock({ seat: { ...f1, free: { am: false } }, preset: 'am', forWho: 'other' }), { kind: 'not_free' });
assert.equal(canAddSeat({ ...f1, open_to_all: false }, 'am', []), true);            // team seats can join (free decides)
assert.equal(rowTeamHint({ seat: f1 }, { tier: 'team', seats: [e1s] }), e1s);
assert.equal(rowTeamHint({ seat: f1 }, { tier: 'open', seats: [] }), null);
assert.equal(firstName('Jane Tan'), 'Jane');
// smoke_desk_logic.mjs
assert.equal(teamSeatText(e1s), 'Your project team has a free seat: E1 on Level 1.');
// smoke_scan_logic.mjs
assert.equal(checkInOutcome({ seat: null, result: { kind: 'error', text: 'x', suggestion: e1s } }).suggestion, e1s);
// smoke_dashboard_logic.mjs
assert.equal(autoBookText({ ok: true, seat_label: 'E1', usual_seat_label: null }, 'tomorrow'), 'Auto-booked E1 for tomorrow (full day).');
assert.equal(autoBookText({ ok: true, seat_label: 'E1', usual_seat_label: 'A1' }, 'tomorrow'),
  'Your usual seat A1 was not available; auto-booked E1 for tomorrow.');
assert.equal(autoBookText({ ok: false, message: 'no free seat' }, 'Mon 19 Oct'), 'Could not auto-book for Mon 19 Oct: no free seat.');
```

  The existing `canAddSeat` assertions change to the `free` shape. Update them, keeping their intent (taken slot → false, already picked → false).
- [ ] **Step 2: Run** `node scripts/smoke_booking_logic.mjs && node scripts/smoke_desk_logic.mjs && node scripts/smoke_scan_logic.mjs && node scripts/smoke_dashboard_logic.mjs`
  Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** the helpers and the `api.js` change.
- [ ] **Step 4: Run the same commands.**
  Expected: each prints its `... logic smoke OK` line.
- [ ] **Step 5: Commit.** `feat: frontend helpers for team-first hints, per-row plans and auto-book notes`

---

### Task 9: Screens: Book a desk, booking for others, check-in, settings, dashboard

**Files:**
- Modify: `webapp-frontend/src/desk/BookDeskPage.jsx`, `SeatPanel.jsx`, `BookingPanel.jsx`, `CheckInPage.jsx`, `src/ThemeSettings.jsx`, `src/pages/dashboard/DashboardPage.jsx`

**Interfaces:**
- Consumes: Task 8 helpers; floor `team_first`, seat `free`; `GET /api/desk/suggest`; `err.suggestion`; `seat_info.suggestion`.
- Produces (props):
  - `BookDeskPage` defines `jumpTo(s)`: set `wantSeat.current = s.seat_id`, then `setPlanId(s.plan_id)`, or call `load()` directly when `s.plan_id === planId`.
  - It passes `teamFirst={floor.team_first}` and `jumpTo` into `SeatPanel` → `BookingPanel`.

- [ ] **Step 1: Book a desk (`BookDeskPage`).**
  - Add a **Find me a seat** button in `.desk-controls`. It calls `/api/desk/suggest?date=${date}&preset=${preset}`.
    - tier `none` → set a notice `No free seat for ${dayName} ${presetLabel(preset)}.`
    - otherwise → `jumpTo(seats[0])`.
  - Title copy: "Book a seat for today or the next working day, for yourself or a colleague." The empty-panel text: "Click a seat to see who is there, today's activity, and to book it."
- [ ] **Step 2: Seat panel and booking panel.**
  - `SeatPanel` renders `BookingPanel` for any tagged seat (`seat.open_to_all || seat.department_id`).
  - `BookingPanel` replaces the `!seatFree` notice with the `bookBlock` result:
    - `team_hint` → `teamSeatText(s)`, plus a button `Book ${s.seat_label} instead` that calls `jumpTo(s)`, and the booking form is hidden;
    - `other_team` → `This seat is for another project team.`;
    - `not_free` → the existing not-free notice.
  - The Confirm-disabled condition uses `bookBlock(...) !== null`.
- [ ] **Step 3: Booking for others (`BookingPanel`).**
  - Keep `swaps` state: `{ [originalSeatId]: rowSeat }`, so `row.seat = swaps[s.id] ?? s`, reset on `seat.id` change.
  - Keep `suggested` state, per person id. When a person is picked, fetch `/api/desk/suggest?date=${dates[0]}&preset=${preset}&user_id=${p.id}`.
  - Under a row with `rowTeamHint(row, suggested[row.person.id])`, show `${firstName(name)}'s team has a free seat: ${label}.` and a button `Use ${label}`, which sets `swaps[row's original seat id] = toRowSeat(s)`.
  - In One seat mode, with a person picked, show **Find a seat for {first name}**. It swaps the row to `suggested[...].seats[0]` (shown only when the tier is not `none`). *Plan interpretation of §6.2: the panel opens on any clicked seat, and this button fills the seat so the user doesn't hunt on the map.*
  - Results: push `suggestion: err.suggestion` onto failed rows. A failed row with a suggestion shows a `Use ${label}` button: for `me` it calls `jumpTo`, for `other` it swaps that row and clears `results`.
- [ ] **Step 4: Check-in.**
  - In `SeatPanel.act()`, on error keep `err.suggestion` in `message`. Render a `Go to ${label}` link to `/checkin/${seat_id}` under the error notice. Do the same when `info?.suggestion` is set and the seat can't be checked in to.
  - `CheckInPage`: render `<SeatCheckIn key={seatId} seatId={seatId} />`. On a POST failure, store `{ kind: 'error', text: err.message, suggestion: err.suggestion }`.
  - `CheckInResult`, for a `bad` outcome with a suggestion:
    - show `teamSeatText(outcome.suggestion)` under the reason;
    - show `Go to ${label}` as the primary action, linking to `/checkin/${seat_id}`;
    - keep the other buttons.
  - Scan lands on the same page, so it needs nothing more.
- [ ] **Step 5: Settings and dashboard.**
  - `ThemeSettings` shows the switch whenever `me` has loaded, labelled `Auto-book a seat for me (my usual seat first, then my team's seats).` The `<small>` reads `${seat.seat_label} · ${seat.plan_name}, next working day` when there's a usual seat, else `Next working day`.
  - `DashboardPage` `AutoBookNotes` renders `autoBookText(n, label)` and keeps the `Book another desk` link on failures.
- [ ] **Step 6: Build and smoke.**
  Run: `npm run build` and the four smoke scripts from Task 8.
  Expected: the build succeeds and every smoke prints OK.
- [ ] **Step 7: Manual check in the running app** (backend + `npm run dev`), signed in as a user with a team seat:
  1. Find me a seat selects the team seat on its floor.
  2. Clicking a free-for-all seat shows the hint, and the button switches floor.
  3. Booking for a teammate shows the row hint, and Use swaps the seat; Confirm books it on the right floor.
  4. A walk-up at a free-for-all seat on the Desk check-in page shows the cross with Go to. Following it **checks in on the suggested seat** (Review Focus 2).
  5. The settings switch shows without a usual seat.
- [ ] **Step 8: Commit.** `feat: team-first screens - Find me a seat, team hints, colleague suggestions, Go to seat on check-in`

---

## Self-review notes

- **Spec coverage:**
  - §3.1 → Task 3, with §3.1.5 (both days) covered by per-request checks in the existing panel loop;
  - §3.2 → Task 4;
  - §3.3 → Tasks 2 and 5 (one `published_seats` query plus one `floor_context`);
  - §4 → Tasks 2, 4 and 6;
  - §5 → Task 5;
  - §6.1–6.3 → Task 9;
  - §6.4 → Tasks 7 and 9;
  - §7: no new audit calls;
  - §8 → tests in Tasks 2–8.
- **Deviations, all called out above:**
  - the check-in message wording;
  - the extra per-seat `free` map;
  - "Find a seat for {name}" works inside the panel;
  - one `floor_context` covers all floors (fewer queries than the spec's "one per floor").
