# Manage Users Page — Design

**Date:** 2026-10-14
**Status:** Implemented (written after implementation; records the decisions made)
**Scope:** Frontend admin page for the user and department APIs specified in `2026-10-13-admin-users-design.md`, whose scope excluded frontend pages. Plus one backend behaviour change: a failed invitation email no longer fails user creation.
**Implemented in:** commit `d00efc9` (see `docs/superpowers/plans/2026-10-14-manage-users-page.md`).

## 1. Background

The Flask backend already provides `/api/admin/users` (list with filters and paging, create with invitation, get, patch, delete, set password, resend invitation) and `/api/admin/departments` (list with user counts, create, rename, delete), all `@admin_required`. There was no page to use them.

Email is sent through Resend. In the current environment `RESEND_API_KEY` and `EMAIL_FROM` are not set, so every invitation email fails. Before this change, `POST /api/admin/users` committed the user, then raised when the email failed, so the admin saw a server error although the user existed.

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Location | Sidebar **Administration → Manage Users**, route `/users`, `src/pages/users/UsersPage.jsx` (+ `users.css`). | Follows the `src/pages/<name>/` convention. |
| Layout | Reuses `content-split`: filterable user table on the left, edit panel on the right; departments section below. | Matches existing pages; no new layout system. |
| Departments | Managed on the same page (add, rename, delete). Labelled "Departments / groups" in the UI: the same records serve as departments or ad-hoc groups (the API and table stay `departments`). | Users cannot be assigned departments if none can be created; product owner asked for the wider wording. |
| Invitation failure | `_send_invitation` returns `False` instead of raising (the error is logged). `POST /users` returns `201` with `invitation_sent: false`; `POST /users/<id>/resend-invitation` returns `502 {"error": "invitation email could not be sent"}`. | The user exists either way; the admin needs a clear message and a way forward (set a password, or resend later). |
| Routing | Vite proxies `/api/admin/users` and `/api/admin/departments` to Flask (only specific paths, because `/api` otherwise goes to the legacy Node API). | Same pattern as `/api/admin/floor-plans`. |
| Dates | Access window shown as `dd/MM/yyyy` via `formatDate`; date inputs send `YYYY-MM-DD`. | `docs/CODING_GUIDELINES.md` §1. |
| Self-protection | The UI disables role change and "Account enabled" for the signed-in admin and hides Delete for them; the backend still enforces the same rules (409). | Avoids locking yourself out; server stays the authority. |

## 3. Page behaviour

**User list**
- Filters: search (name, username, email), role, status (active / disabled), department. Changing a filter returns to page 1.
- Columns: name + `@username`, email, role, departments, access window (`Always`, or `from – until`), status pill (**Active**, **Disabled**, **Pending activation** when no password is set yet).
- Paging: 20 per page, total count, previous/next.
- Clicking a row opens it in the edit panel.

**Create / edit panel**
- Fields: full name, username, email, role, access from / until, departments (checkboxes), account enabled (edit only).
- Create sends `POST /api/admin/users` and reports whether the invitation email was sent.
- Edit sends `PATCH` with only the fields that changed; "Nothing to save." when nothing changed.
- Field-level validation errors from the API (`fields`) appear under the matching inputs; other errors (e.g. 409 duplicate email, last active admin) appear at the top of the panel.
- Account actions (edit only): **Set password** (min 8 characters; also enables and unlocks the account), **Resend invitation** (pending users only), **Delete user** (with confirmation; hidden for yourself).

**Departments section**
- Table of departments with user counts; **Add department**, **Rename** (prompt), **Delete** (confirmation mentions how many users are removed from it).

**Errors**
- 401 → "Session expired — sign in again."; 403 → "You need an administrator account to manage users."

## 4. Testing

- Backend: new `test_create_survives_email_failure` (email sender raises → `201`, `invitation_sent: false`, user persisted; resend → `502`). Full `tests/test_admin_users.py` + `tests/test_admin_departments.py`: 27 passed.
- Frontend: `npm run build` green. Not exercised in a browser at implementation time (requires an admin login).

## 5. Known gaps / follow-ups

1. **Email not configured:** set `RESEND_API_KEY` and `EMAIL_FROM` in `webapp-backend/.env` for invitations and password resets to send.
2. **Invitation links are wrong:** `FRONTEND_URL` is `http://localhost:3000` (the legacy Node app), but the React app runs on the Vite port (5173 by default).
3. ~~**No set-password page**~~ — done: `/set-password` and `/forgot-password` (see `2026-10-14-password-pages-design.md`).
4. **Admin links visible to everyone:** the sidebar shows Administration entries to non-admin users; the pages then show a 403 message. Hiding them by role is a small follow-up.
5. Search sends a request on every keystroke (no debounce).
