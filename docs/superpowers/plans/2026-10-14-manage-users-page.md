# Manage Users Page — Implementation Plan (as built)

> **Record of completed work.** Written after implementation to document what changed, task by task. All tasks are done; use `superpowers:writing-plans` for new work.

**Goal:** Admin page to manage users and departments on top of the existing `/api/admin/users` and `/api/admin/departments` APIs; make user creation survive a failed invitation email.

**Spec:** `docs/superpowers/specs/2026-10-14-manage-users-page-design.md`

**Commit:** `d00efc9`

## Global Constraints

- Backend commands from `webapp-backend/`, frontend commands from `webapp-frontend/`.
- No API shape changes other than the added `invitation_sent` field on create and the `502` on resend.
- Dates displayed with `formatDate` (`docs/CODING_GUIDELINES.md` §1).
- Gates: `python -m pytest -q tests/test_admin_users.py tests/test_admin_departments.py`, `npm run build`.

---

### Task 1: Invitation email failure is non-fatal (backend)

- [x] `app/admin/users.py`: `_send_invitation()` returns `bool`; logs and returns `False` on failure instead of raising.
- [x] `POST /users`: response `{...public_user, "invitation_sent": bool}` with `201`.
- [x] `POST /users/<id>/resend-invitation`: `502 {"error": "invitation email could not be sent"}` on failure.
- [x] Test `test_create_survives_email_failure`.

### Task 2: Route the APIs to Flask

- [x] `vite.config.js`: proxy `/api/admin/users` and `/api/admin/departments` to the Flask target (before the catch-all `/api` → Node rule).

### Task 3: Manage Users page

- [x] `src/pages/users/UsersPage.jsx`:
  - user table with search, role, status and department filters; paging (20 per page);
  - status pills (Active / Disabled / Pending activation); access window via `formatDate`;
  - `UserForm`: create and edit, per-field API errors, PATCH with changed fields only;
  - account actions: set password, resend invitation (pending only), delete (confirm; hidden for yourself);
  - self-protection in the UI (no role change or disabling yourself);
  - `DepartmentsSection`: add, rename, delete with user counts.
- [x] `src/pages/users/users.css` (reuses `card`, `toolbar`, `content-split`, `status-*`, `notice`).
- [x] `src/App.jsx`: route `/users`, sidebar **Manage Users** with a `users` icon.

### Verification (final)

- [x] `tests/test_admin_users.py` + `tests/test_admin_departments.py`: 27 passed.
- [x] `npm run build`: green.
- [ ] Manual check in the browser by an admin (requires restarting Vite for the new proxy rules, and an admin login).

## Follow-ups

See spec §5: configure Resend; fix `FRONTEND_URL`; build the `/set-password` page; hide admin links from non-admins; debounce search.
