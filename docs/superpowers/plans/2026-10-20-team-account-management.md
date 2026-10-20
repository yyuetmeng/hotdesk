# Team Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can let an ordinary user manage the accounts of chosen project teams. That user gets a cut-down
Manage Users page: list, basic edits, on/off, resend invitation, create, upload. The server enforces every limit.

**Architecture:**
- A new table `user_managed_departments` holds (holder, team) pairs.
- One scope module, `app/core/team_scope.py`, answers "who may this actor manage" from the database on every request.
- The existing `/api/admin/users*` endpoints that holders need move from `@admin_required` to a new
  `@account_manager_required` guard, and branch on the scope. Every other admin endpoint stays `@admin_required`.
- The frontend reuses `UsersPage` and `ImportPanel` in a "holder" mode chosen from the new `manages` list on the
  signed-in user.

**Tech Stack:** Flask + SQLAlchemy 2.0 ORM, plain SQL migrations in `webapp-backend/sql/`, pytest on local Postgres;
React 19 + Vite, node smoke scripts in `webapp-frontend/scripts/`.

**Spec:** `docs/superpowers/specs/2026-10-19-team-account-management-design.md`

## Global Constraints

- Tests run only against local Postgres (`TEST_DATABASE_URI`, localhost:5432), never Supabase. Run them from
  `webapp-backend/` with `python -m pytest`.
- No password literals in tests: use `tests/creds.py` (`SECRET`, `hashed`, `sign_in`, `secret_body`).
- Frontend files live in OneDrive, and Vite misses quick second writes. Write each frontend file once per step (one
  Write, or all of its Edits together), then run `npm run build`.
- Out-of-scope person: 403 `"You can only manage accounts in your project teams."`
- Refused field: 403 `"Only an administrator can change this."`
- Holder upload row with no team or a team they don't manage: `"You can only add people to the teams you manage."`
- Holder page line: `"You can manage accounts in: Engineering, Design."` (team names joined with `", "`, in name
  order).
- Admin grant section legend: `"Can manage accounts for"`.
- Manageable people: users in at least one of the holder's chosen teams, never `role = admin`, never the holder.
- Holders' changes use the same audit events as admins', with the holder as actor.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan rulings (calls the spec left to the builder)

- **Storage:** a pair table with `ON DELETE CASCADE` on both foreign keys. Deleting a team or a user ends the
  permission with no extra code.
- **Endpoints:** holders use the same URLs as admins, under a wider guard. Delete, set password, departments, audit
  and everything else stay `@admin_required`.
- **Holder role:** "is admin" comes from the token claim, exactly as `admin_required` does today. The holder's
  managed teams and the target's role and teams are read from the database on every request.
- **Unknown ids:** a holder asking for a user id that doesn't exist gets the same 403 as an out-of-scope id, so ids
  can't be probed.
- **Create form fields:** a holder's New user form has the admin form's fields (name, username, email, access dates,
  teams). Booking allowance and usual seat are set afterwards in the edit panel, as admins do today. The spec lists
  them under 3.1 only by way of "same form as an admin's".
- **Upload invitations:** a holder's upload always sends invitations. The checkbox is hidden and the server ignores
  `send_invitations`, because a holder's new users have no other way to get a password.
- **List badges:** last sign-in and the failed sign-ins badge stay in the holder's table. They are per-person account
  facts, not the audit log screen.
- **Admin targets:** `manages_department_ids` on a user who is or becomes an admin is a 400 field error,
  `"admins already manage every account"`.

## Review Focus

1. **A holder sends a refused field with an unchanged value**, for example the whole form with the same email.
   It must save, with that field ignored. A changed refused field must refuse the whole save with nothing written.
   Task 2 tests both.
2. **A holder targets someone in a managed team who is also an admin.** That gets the out-of-scope 403 on GET, PATCH
   and resend. Task 2 tests it.
3. **The permission is removed or the team deleted while the holder's page is open.** Their next request must be
   refused (token unchanged). Task 2 tests deleting the team and the admin unticking.
4. **A holder creates or uploads into a mix of managed and unmanaged teams.** The whole create is refused. Only the
   offending upload rows are errors. Task 3 tests both.
5. **A holder with permission for a team they are not in.** They can manage it, and the list must not depend on their
   own membership. Task 2 tests it.

---

### Task 1: Permission storage, scope helper, admin grant, profile `manages`

**Files:**
- Create: `webapp-backend/sql/0028_user_managed_departments.sql`
- Create: `webapp-backend/app/core/team_scope.py`
- Modify: `webapp-backend/app/core/auth_models.py` (new model after `UserDepartment`)
- Modify: `webapp-backend/app/admin/users.py` (`PATCHABLE`, `patch_user`, `list_users` items, `get_user`)
- Modify: `webapp-backend/app/auth/routes.py` (`me`, `login` response)
- Test: `webapp-backend/tests/test_team_accounts.py` (new)

**Interfaces:**
- Produces, in `app/core/auth_models.py`: `class UserManagedDepartment(Base)`. Its table is
  `user_managed_departments`, with `user_id` and `department_id` (both FK, cascade, composite PK) and `created_at`.
- Produces, in `app/core/team_scope.py`:
  - `managed_departments(user_id: str) -> list[dict]`, giving `[{"id": str, "name": str}]` ordered by name;
  - `managed_ids(user_id: str) -> set[uuid.UUID]`;
  - `set_managed(user: User, department_ids: list[str]) -> None`, which replaces the rows without committing;
  - `manageable_clause(actor_id: str, department_ids: set[uuid.UUID])`, a SQLAlchemy boolean for
    `select(User).join(Role)`: in one of the teams, `Role.name != "admin"`, `User.id != actor_id`;
  - `can_manage(actor_id: str, department_ids: set[uuid.UUID], target: User | None) -> bool`.
- Produces in API:
  - `GET /api/auth/me` and the `user` object in `POST /api/auth/login` gain `"manages": [{"id", "name"}]`, which is
    `[]` for most people and for admins.
  - Admin `PATCH /api/admin/users/<id>` accepts `"manages_department_ids": [uuid, ...]`.
  - Admin `GET /api/admin/users` items and `GET /api/admin/users/<id>` gain `"manages": [{"id", "name"}]`.

- [ ] **Step 1: Write the failing tests** in `tests/test_team_accounts.py`

  The module sets up a small world with a fixture `world(client, db)`:
  - teams Eng, Design and Ops;
  - users: admin `root` (role 2), holder `hana` (in Eng), `eve` (Eng), `dan` (Eng and Design), `oli` (Ops only), and
    `ada` (an admin in Eng);
  - each user has a `password_hash` of `hashed(SECRET)`;
  - the fixture returns a dict of their ids, the team ids and signed-in tokens for `root` and `hana`.

  Stub email the same way as `test_admin_users.py` (`app.admin.users.send_email`). The helper is
  `grant(client, tok, uid, ids)`, which PATCHes `manages_department_ids`.

```python
def test_admin_grants_and_profile_lists_managed_teams(client, world):
    r = grant(client, world["root_tok"], world["hana"], [world["eng"]])
    assert r.status_code == 200 and r.get_json()["manages"] == [{"id": world["eng"], "name": "Eng"}]
    me = client.get("/api/auth/me", headers=hdr(world["hana_tok"])).get_json()
    assert me["manages"] == [{"id": world["eng"], "name": "Eng"}]
    assert sign_in(client, "hana@x.com").get_json()["user"]["manages"] == [{"id": world["eng"], "name": "Eng"}]
    assert run_one("select details from audit_logs where action = 'user.update' order by id desc limit 1")["details"] \
        == {"fields": ["manages_department_ids"]}

def test_grant_any_team_even_one_the_user_is_not_in(client, world):
    assert grant(client, world["root_tok"], world["hana"], [world["ops"]]).status_code == 200

def test_untick_all_removes_and_list_marks_holders(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"], world["design"]])
    items = client.get("/api/admin/users?page_size=100", headers=hdr(world["root_tok"])).get_json()["items"]
    assert [d["name"] for d in next(u for u in items if u["id"] == world["hana"])["manages"]] == ["Design", "Eng"]
    grant(client, world["root_tok"], world["hana"], [])
    assert client.get("/api/auth/me", headers=hdr(world["hana_tok"])).get_json()["manages"] == []

def test_grant_refused_for_admin_target_and_unknown_team(client, world):
    r = grant(client, world["root_tok"], world["ada"], [world["eng"]])
    assert r.status_code == 400 and r.get_json()["fields"]["manages_department_ids"] == "admins already manage every account"
    r = grant(client, world["root_tok"], world["hana"], ["00000000-0000-0000-0000-000000000000"])
    assert r.status_code == 400 and "manages_department_ids" in r.get_json()["fields"]

def test_deleting_a_team_ends_the_permission(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"]])
    client.delete(f"/api/admin/departments/{world['eng']}", headers=hdr(world["root_tok"]))
    assert client.get("/api/auth/me", headers=hdr(world["hana_tok"])).get_json()["manages"] == []
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `python -m pytest tests/test_team_accounts.py -q`
  Expected: FAIL. The PATCH answers 400 "unknown field" for `manages_department_ids`, and `manages` is missing.

- [ ] **Step 3: Implement**
  - **Migration:** `sql/0028_user_managed_departments.sql` is `create table if not exists user_managed_departments`.
    It has `user_id uuid references users(id) on delete cascade`, the same for `department_id` against
    `departments(id)`, `created_at timestamptz not null default now()` and `primary key (user_id, department_id)`.
    Start it with a one-line comment naming the spec.
  - **Model:** add `UserManagedDepartment`, mirroring `UserDepartment`.
  - **Scope module:** write `team_scope.py` with the functions in Interfaces.
  - **`patch_user`:**
    - add `manages_department_ids` to `PATCHABLE`;
    - validate it with `_departments_exist`;
    - give the admin-target field error when the user's role after this save would be `admin` and the list is
      not empty;
    - write it with `set_managed`.
    - It stays in the existing `user.update` audit (`changed` already includes every key except `department_ids`),
      so there's no new event.
    - If a user is promoted to admin in a save with no `manages_department_ids`, call `set_managed(user, [])`.
  - **`public_user` callers in `users.py`:** add `"manages": managed_departments(id)` to the `get_user` and
    `patch_user` responses. For `list_users`, fetch every listed id in one query, not one query per row.
  - **`auth/routes.py`:** in `me` and the login response, add `"manages": managed_departments(...)`, which is `[]`
    when the role is admin.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `python -m pytest tests/test_team_accounts.py tests/test_admin_users.py tests/test_auth_login.py -q`
  Expected: all PASS.

- [ ] **Step 5: Commit**

  `git add webapp-backend/sql/0028_user_managed_departments.sql webapp-backend/app webapp-backend/tests/test_team_accounts.py`

  `git commit -m "feat: admins can let a user manage accounts for chosen project teams"`

---

### Task 2: Holder guard; list, view, edit, on/off, resend within scope

**Files:**
- Modify: `webapp-backend/app/core/security.py` (new decorator)
- Modify: `webapp-backend/app/admin/users.py` (`list_users`, `get_user`, `patch_user`, `resend_invitation`)
- Test: `webapp-backend/tests/test_team_accounts.py`

**Interfaces:**
- Consumes the Task 1 scope functions.
- Produces in `app/core/security.py`: `account_manager_required(fn)`.
  - It verifies the JWT the same way `admin_required` does.
  - If the `role` claim is `admin`, it sets `g.team_scope = None` (no limit).
  - Otherwise it sets `g.team_scope = managed_ids(identity)`, and when that set is empty it returns
    `error("admin required", 403)`, exactly like today.
- Produces in `users.py`:
  - `HOLDER_FIELDS = ("full_name", "start_date", "end_date", "usual_seat_id", "booking_allowance", "is_active")`;
  - `OUT_OF_SCOPE = "You can only manage accounts in your project teams."`;
  - `ADMIN_ONLY = "Only an administrator can change this."`

- [ ] **Step 1: Write the failing tests.** Each test starts with `grant(root → hana, [eng])` unless it says otherwise.

```python
def ids_listed(client, tok, query=""):
    return {u["id"] for u in client.get(f"/api/admin/users?page_size=100{query}", headers=hdr(tok)).get_json()["items"]}

def test_holder_lists_only_manageable_people(client, world):
    assert ids_listed(client, world["hana_tok"]) == {world["eve"], world["dan"]}   # not ada (admin), hana, oli, root

def test_holder_without_permission_gets_403(client, world):
    grant(client, world["root_tok"], world["hana"], [])
    assert client.get("/api/admin/users", headers=hdr(world["hana_tok"])).status_code == 403

def test_holder_manages_a_team_they_are_not_in(client, world):
    grant(client, world["root_tok"], world["hana"], [world["ops"]])
    assert ids_listed(client, world["hana_tok"]) == {world["oli"]}

def test_out_of_scope_is_403_for_view_edit_resend_and_unknown_ids(client, world):
    tok = world["hana_tok"]
    for uid in (world["oli"], world["ada"], world["hana"], "00000000-0000-0000-0000-000000000000"):
        for r in (client.get(f"/api/admin/users/{uid}", headers=hdr(tok)),
                  client.patch(f"/api/admin/users/{uid}", headers=hdr(tok), json={"full_name": "X"}),
                  client.post(f"/api/admin/users/{uid}/resend-invitation", headers=hdr(tok))):
            assert (r.status_code, r.get_json()["error"]) == (403, "You can only manage accounts in your project teams.")

def test_holder_allowed_edits_work_and_are_audited_as_holder(client, world):
    r = client.patch(f"/api/admin/users/{world['eve']}", headers=hdr(world["hana_tok"]),
                     json={"full_name": "Eve Ng", "start_date": "2026-11-01", "end_date": "2026-12-31",
                           "booking_allowance": 3, "is_active": False})
    assert r.status_code == 200 and r.get_json()["full_name"] == "Eve Ng"
    assert run_one("select actor_id::text as a from audit_logs where action = 'user.disable'")["a"] == world["hana"]

@pytest.mark.parametrize("field,value", [("email", "new@x.com"), ("username", "newname"), ("role", "admin"),
                                         ("department_ids", [])])   # manages_department_ids: next test
def test_changed_refused_field_refuses_whole_save(client, world, field, value):
    before = run_one("select full_name from users where id = :i", {"i": world["eve"]})["full_name"]
    r = client.patch(f"/api/admin/users/{world['eve']}", headers=hdr(world["hana_tok"]),
                     json={"full_name": "Changed", field: value})
    assert (r.status_code, r.get_json()["error"]) == (403, "Only an administrator can change this.")
    assert run_one("select full_name from users where id = :i", {"i": world["eve"]})["full_name"] == before

def test_unchanged_refused_fields_are_ignored(client, world):
    eve = client.get(f"/api/admin/users/{world['eve']}", headers=hdr(world["hana_tok"])).get_json()
    r = client.patch(f"/api/admin/users/{world['eve']}", headers=hdr(world["hana_tok"]),
                     json={"full_name": "Eve Two", "email": eve["email"], "username": eve["username"], "role": "user",
                           "department_ids": [d["id"] for d in eve["departments"]][::-1]})
    assert r.status_code == 200 and r.get_json()["full_name"] == "Eve Two"

def test_holder_cannot_grant_permission_to_anyone(client, world):
    r = grant(client, world["hana_tok"], world["eve"], [world["eng"]])
    assert r.status_code == 403 and run_one("select count(*) as n from user_managed_departments")["n"] == 1

def test_removal_takes_effect_on_next_request(client, world):
    tok = world["hana_tok"]
    assert client.get(f"/api/admin/users/{world['eve']}", headers=hdr(tok)).status_code == 200
    grant(client, world["root_tok"], world["hana"], [])
    assert client.get(f"/api/admin/users/{world['eve']}", headers=hdr(tok)).status_code == 403

def test_holder_still_blocked_from_admin_only_endpoints(client, world):
    tok, eve = world["hana_tok"], world["eve"]
    assert client.delete(f"/api/admin/users/{eve}", headers=hdr(tok)).status_code == 403
    assert client.post(f"/api/admin/users/{eve}/password", headers=hdr(tok), json=secret_body(new_secret())).status_code == 403
    assert client.post("/api/admin/departments", headers=hdr(tok), json={"name": "Z"}).status_code == 403
    assert client.get("/api/admin/audit", headers=hdr(tok)).status_code == 403
    assert client.get("/api/admin/audit/security-summary", headers=hdr(tok)).status_code == 403
```

  Leaving or joining a team doesn't change the permission, and the "not in" test above covers that. Also add
  `test_holder_resend_invitation_in_scope`: make `eve` pending (`password_hash` null), then POST resend and expect
  204, with one email stubbed.

- [ ] **Step 2: Run them and confirm they fail**

  Run: `python -m pytest tests/test_team_accounts.py -q`
  Expected: the new tests FAIL with 403 "admin required", or with refused-field saves succeeding.

- [ ] **Step 3: Implement**
  - **Guard:** add `account_manager_required` to `security.py`. It imports `managed_ids` inside the wrapper to avoid
    an import cycle.
  - **Endpoints:** switch `list_users`, `get_user`, `patch_user` and `resend_invitation` to it.
  - **When `g.team_scope` is not None:**
    - `list_users` adds `manageable_clause(actor, g.team_scope)` to `conds`;
    - the other three load the user, and if `not can_manage(...)` return `error(OUT_OF_SCOPE, 403)`. A missing user
      is also out of scope.
  - **In `patch_user`,** before validation, for a holder:
    - for each key in the body that is not in `HOLDER_FIELDS`, compare it with the current value. `email` and
      `username` compare after `.strip()`. `role` compares with `user.role.name`. `department_ids` and
      `manages_department_ids` compare as sets of ids.
    - drop the key if it's equal;
    - if it differs, return `error(ADMIN_ONLY, 403)` before anything is written.
  - The rest of `patch_user` runs unchanged, so it keeps the same validation, side effects and audit.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `python -m pytest tests/test_team_accounts.py tests/test_admin_users.py -q`
  Expected: all PASS.

- [ ] **Step 5: Commit**

  `git commit -am "feat: account managers can view and edit people in the teams they manage"`

  Include the new test lines.

---

### Task 3: Holder create and upload

**Files:**
- Modify: `webapp-backend/app/admin/users.py` (`create_user`)
- Modify: `webapp-backend/app/admin/bulk_import.py` (`users_template`, `_check_users`, `import_users`)
- Test: `webapp-backend/tests/test_team_accounts.py`

**Interfaces:**
- Consumes `account_manager_required`, `g.team_scope`, `ADMIN_ONLY` and `managed_departments`.
- Produces `_check_users(rows, create_teams: bool, allowed_teams: set[str] | None = None) -> list[dict]`.
  `allowed_teams` is the set of lower-case team names a holder may use; `None` means admin, with no limit.
- Produces `TEAM_LIMIT = "You can only add people to the teams you manage."` (in `bulk_import.py`, reused by
  `create_user`).

- [ ] **Step 1: Write the failing tests.** Grant `hana → [eng]` first. Upload helpers follow `tests/test_bulk_import.py`:
  build a CSV with the `USER_COLUMNS` header, and POST multipart to `/api/admin/users/import`.

```python
def test_holder_creates_user_in_managed_team(client, world, stub_email):
    r = client.post("/api/admin/users", headers=hdr(world["hana_tok"]),
                    json={"email": "neo@x.com", "username": "neo", "full_name": "Neo", "department_ids": [world["eng"]]})
    assert r.status_code == 201 and r.get_json()["role"] == "user" and r.get_json()["invitation_sent"]
    assert stub_email[-1][0] == "neo@x.com"
    assert run_one("select actor_id::text as a from audit_logs where action = 'user.create'")["a"] == world["hana"]

@pytest.mark.parametrize("extra,status,message", [
    ({"department_ids": []}, 400, None),
    ({"department_ids": ["<eng>", "<ops>"]}, 403, "You can only add people to the teams you manage."),
    ({"department_ids": ["<eng>"], "role": "admin"}, 403, "Only an administrator can change this."),
])
def test_holder_create_refusals(client, world, extra, status, message):
    body = {"email": "neo@x.com", "username": "neo", "full_name": "Neo", "role": "user",
            **{k: [world[x.strip("<>")] for x in v] if k == "department_ids" else v for k, v in extra.items()}}
    r = client.post("/api/admin/users", headers=hdr(world["hana_tok"]), json=body)
    assert r.status_code == status and (message is None or r.get_json()["error"] == message)
    assert not run_one("select 1 as x from users where email = 'neo@x.com'")

def test_holder_create_taken_email_uses_admin_message(client, world):
    r = client.post("/api/admin/users", headers=hdr(world["hana_tok"]),
                    json={"email": "oli@x.com", "username": "neo", "full_name": "Neo", "department_ids": [world["eng"]]})
    assert (r.status_code, r.get_json()["error"]) == (409, "email already exists")

def test_holder_upload_rows(client, world, stub_email):
    rows = [["Ann", "ann@x.com", "", "Eng", "", "", ""], ["Ben", "ben@x.com", "", "", "", "", ""],
            ["Cat", "cat@x.com", "", "Eng; Ops", "", "", ""]]
    body = upload(client, world["hana_tok"], rows).get_json()
    assert [r["status"] for r in body["rows"]] == ["create", "error", "error"]
    assert body["rows"][1]["messages"] == ["You can only add people to the teams you manage."]
    assert body["imported"] == 1 and [c[0] for c in stub_email] == ["ann@x.com"]   # invited without asking

@pytest.mark.parametrize("form", [{"create_teams": "1"}, {"default_password": "<new>"}])
def test_holder_upload_admin_only_options_refused(client, world, form):
    form = {k: new_secret() if v == "<new>" else v for k, v in form.items()}
    r = upload(client, world["hana_tok"], [["Ann", "ann@x.com", "", "Eng", "", "", ""]], **form)
    assert (r.status_code, r.get_json()["error"]) == (403, "Only an administrator can change this.")

def test_holder_template_lists_only_managed_teams(client, world):
    r = client.get("/api/admin/users/import-template.xlsx", headers=hdr(world["hana_tok"]))
    sheets = read_xlsx_sheets(r.data)        # same reader test_bulk_import.py uses
    teams = [row[0] for row in sheets["Instructions"] if row][-1:]
    assert r.status_code == 200 and teams == ["Eng"] and "Ops" not in str(sheets["Instructions"])
```

  `upload(client, tok, rows, **form)` is a local helper. If `test_bulk_import.py` has no xlsx reader helper, read
  the Instructions sheet with `app.core.xlsx_read.read_xlsx`, the way that file already does.

- [ ] **Step 2: Run them and confirm they fail**

  Run: `python -m pytest tests/test_team_accounts.py -q`
  Expected: the new tests FAIL with 403 "admin required".

- [ ] **Step 3: Implement**
  - **`create_user` → `@account_manager_required`.** For a holder:
    - default `role` to `"user"` when it's absent;
    - `role` not `"user"` gives `ADMIN_ONLY` 403;
    - empty `department_ids` gives a 400 field error, `"choose at least one of your project teams"`;
    - any id not in `g.team_scope` gives `TEAM_LIMIT` 403;
    - all of these run before the existence checks, then the admin flow runs unchanged.
  - **`users_template`, `import_users` → `@account_manager_required`.** For a holder:
    - the template's "Existing project teams" list and its sample row use only `managed_departments`;
    - `create_teams` set or `default_password` non-empty gives `ADMIN_ONLY` 403;
    - pass `allowed_teams`;
    - always send invitations.
  - **`_check_users` with `allowed_teams`:** a row whose picked teams are empty, or include any name outside the
    set, gets the problem `TEAM_LIMIT` in place of "Unknown project team". Skip rows (email already exists) stay skip.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run: `python -m pytest tests/test_team_accounts.py tests/test_bulk_import.py tests/test_admin_users.py -q`
  Expected: all PASS.

  Then run the full suite: `python -m pytest -q`. Expected: all PASS.

- [ ] **Step 5: Commit**

  `git commit -am "feat: account managers can create and upload users for the teams they manage"`

---

### Task 4: Frontend helpers and smoke tests

**Files:**
- Modify: `webapp-frontend/src/roles.js`
- Create: `webapp-frontend/src/pages/users/teamAccess.js`
- Modify: `webapp-frontend/scripts/smoke_roles_logic.mjs`, `webapp-frontend/scripts/smoke_users_logic.mjs`

**Interfaces:**
- Produces in `roles.js`:
  - `canManageAccounts(user) -> boolean`, which is `isAdmin(user) || (user?.manages?.length ?? 0) > 0`;
  - `isAccountManager(user) -> boolean`, which is `!isAdmin(user) && canManageAccounts(user)`.
- Produces in `teamAccess.js`:
  - `managedLine(manages) -> string`, giving `"You can manage accounts in: A, B."`, or `''` when empty;
  - `teamsOwnFirst(departments, ownIds) -> departments[]`: the user's own teams first, then the rest, each group in
    the given order;
  - `HOLDER_EDIT_FIELDS = ['full_name', 'start_date', 'end_date', 'usual_seat_id', 'booking_allowance', 'is_active']`;
  - `holderChanges(form, user) -> object`: only `HOLDER_EDIT_FIELDS` whose value differs from `user`. It uses the
    same normalising as `UserForm`'s existing diff: dates and seat `'' → null`, allowance to a Number.
  - `errorText(err) -> string`:
    - 401 → `'Session expired — sign in again.'`;
    - 403 with message `'admin required'` → `'You need an administrator account to manage users.'`;
    - other 403 and anything else → `err.message`.

- [ ] **Step 1: Write the smoke assertions**

```js
// smoke_roles_logic.mjs
assert.equal(canManageAccounts({ role: 'user', manages: [{ id: 't', name: 'Eng' }] }), true);
assert.equal(canManageAccounts({ role: 'user', manages: [] }), false);
assert.equal(canManageAccounts({ role: 'admin', manages: [] }), true);
assert.equal(isAccountManager({ role: 'admin', manages: [] }), false);
assert.equal(isAccountManager({ role: 'user', manages: [{ id: 't', name: 'Eng' }] }), true);
// smoke_users_logic.mjs
assert.equal(managedLine([{ name: 'Design' }, { name: 'Engineering' }]), 'You can manage accounts in: Design, Engineering.');
assert.equal(managedLine([]), '');
assert.deepEqual(teamsOwnFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map((d) => d.id), ['c', 'a', 'b']);
const user = { full_name: 'Eve', start_date: null, end_date: null, usual_seat_id: null, booking_allowance: 0, is_active: true, email: 'e@x.com' };
assert.deepEqual(holderChanges({ ...user, full_name: 'Eve Ng', start_date: '', usual_seat_id: '', booking_allowance: '2', email: 'z@x.com' }, user),
  { full_name: 'Eve Ng', booking_allowance: 2 });
assert.equal(errorText({ status: 403, message: 'admin required' }), 'You need an administrator account to manage users.');
assert.equal(errorText({ status: 403, message: 'Only an administrator can change this.' }), 'Only an administrator can change this.');
```

- [ ] **Step 2: Run them and confirm they fail**

  Run: `node scripts/smoke_roles_logic.mjs && node scripts/smoke_users_logic.mjs`
  Expected: FAIL (the import is not exported).

- [ ] **Step 3: Implement** the functions above. Write each file once.

- [ ] **Step 4: Run them and confirm they pass**

  Run the same commands. Expected: both print their OK lines.

- [ ] **Step 5: Commit**

  `git commit -am "feat: helpers for the account manager view of Manage Users"`

  Add `teamAccess.js` to the commit.

---

### Task 5: Screens: menu and route, grant section, holder page, holder upload

**Files:**
- Modify: `webapp-frontend/src/App.jsx`
- Modify: `webapp-frontend/src/pages/users/UsersPage.jsx`
- Modify: `webapp-frontend/src/pages/users/ImportPanel.jsx`
- Modify: `webapp-frontend/src/pages/users/users.css` (only if the badge needs a style; reuse `users-badge`)

**Interfaces:**
- Consumes everything from Task 4, the `manages` field on `useAuth().user` and on admin list items (Task 1), and
  `manages_department_ids` in the admin PATCH.
- Produces: `ImportPanel` gains a `holder` boolean prop.

- [ ] **Step 1: `App.jsx`**
  - **Admins:** unchanged.
  - **Account managers** (`isAccountManager(user)`): the sidebar shows an "Administration" label with one link,
    `['/users', 'Manage Users', 'users']`.
  - **The `/users` route** uses a new `AccountManagersOnly` wrapper (`canManageAccounts`), in place of `AdminOnly`.

- [ ] **Step 2: `UsersPage.jsx`.** Write it once with all of these changes. Set `holder = isAccountManager(me)`.

  - **Holder page:**
    - title "Manage Users", with `managedLine(me.manages)` as its text;
    - no `SecurityStrip`, no `DepartmentsSection` and no Role filter;
    - the Project team filter and the New user team checkboxes list `me.manages`, not `/api/admin/departments`,
      which a holder can't fetch, so skip that request;
    - `ImportPanel` gets `holder`.
  - **Holder edit panel (existing user):**
    - no History tab;
    - username, email and project teams shown as read-only text; role, password and delete not shown;
    - Save sends `holderChanges(form, user)`.
  - **Holder New user:** name, username, email, access dates and team checkboxes (managed teams only). There is no
    role, and the body sends `role: 'user'`.
  - **Admin edit panel:**
    - a `fieldset` with legend "Can manage accounts for", with checkboxes from
      `teamsOwnFirst(departments, form.department_ids)`;
    - it's hidden when `form.role === 'admin'`, and for new users, where granting happens after creation;
    - form state key `manages_department_ids`, initialised from `user.manages`; the existing diff sends it only
      when it changed.
  - **Admin users table:** a `users-badge` reading "Manages accounts" on rows where `u.manages?.length`, with
    `title` set to the team names.
  - **Errors:** `messageOf` becomes `errorText`.

- [ ] **Step 3: `ImportPanel.jsx`.** With `holder`, hide "Create missing project teams", "Send invitation emails to
  new users" and "Set a default password", and show `New users get an invitation email to set their password.` in
  their place. Never send those three options.

- [ ] **Step 4: Verify**

  Run: `npm run build` (in `webapp-frontend/`), then every smoke script: `for f in scripts/smoke_*.mjs; do node $f; done`.
  Expected: the build succeeds and every smoke script prints OK.

- [ ] **Step 5: Commit**

  `git commit -am "feat: Manage Users for account managers, and the admin grant section"`

- [ ] **Step 6: Click paths for the hand-over report.** List them; don't run them.
  - As admin, open Manage Users and edit an ordinary user. Tick Engineering under "Can manage accounts for" and
    save. The row shows "Manages accounts".
  - Sign in as that user. The menu shows Administration → Manage Users, the page reads "You can manage accounts in:
    Engineering.", and the table lists only Engineering non-admins other than themselves.
  - Edit a teammate's name and access dates, then turn the account off. You can't change their email or teams.
  - Create a user in Engineering. Upload a CSV with one Engineering row and one row with no team. The preview shows
    one New and one Error.
