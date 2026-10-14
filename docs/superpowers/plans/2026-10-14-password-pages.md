# Set Password and Forgot Password Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public pages so invited users can activate their account and anyone can reset a forgotten password, using the existing `/api/auth` password endpoints.

**Architecture:** Two React pages in `webapp-frontend/src/pages/` (`set-password/`, `forgot-password/`) rendered inside the existing `AuthLayout`, routed outside `RequireAuth`; they call the Flask API through the existing `request()` helper (`/api/auth` is already proxied to Flask). No backend changes.

**Spec:** `docs/superpowers/specs/2026-10-14-password-pages-design.md`

**Tech Stack:** React 19, react-router 7, existing `auth.css` styles.

## Global Constraints

- Frontend commands from `webapp-frontend/`.
- Reuse `AuthLayout` and `auth-*` classes; no new CSS unless a style is missing.
- Never log or display tokens; remove the token from the address bar once read.
- Forgot password must show the same confirmation for every identity.
- Gate: `npm run build`; then the manual walkthrough in spec §5.

---

### Task 1: Set password page

**Files:** Create `src/pages/set-password/SetPasswordPage.jsx`.

- [x] Read `token` from the query string into state; if present, remove it from the URL with `history.replaceState`.
- [x] No token → `missing` state ("This link is incomplete") with a link to `/forgot-password`.
- [x] Verify: `GET /api/auth/set-password/verify?purpose=activate`, then `purpose=reset` if not valid; set `kind` to `activate` / `reset`, else `invalid` state. Network failure → error with **Try again**.
- [x] Form: New password + Confirm password, Show/Hide toggle; client checks (min 8, match); `POST /api/auth/set-password {token, password}`.
- [x] Results: `204` → `done` ("Your account is activated" / "Your password has been reset", **Sign in** link to `/login`); `400` with `fields.password` → field error; `400` invalid/expired → `invalid` state.
- [x] `invalid` state: "This link has expired or was already used." Reset → **Request a new link**; invitation → "Ask your administrator to resend your invitation."

### Task 2: Forgot password page

**Files:** Create `src/pages/forgot-password/ForgotPasswordPage.jsx`.

- [x] Field "Email or username"; `POST /api/auth/forgot-password {email: <value>}`.
- [x] `204` → `sent` state: "If an account matches, we've emailed a link to reset your password. It expires in 1 hour." plus **Back to sign in**.
- [x] Failure → error on the form, retry possible.

### Task 3: Wire up routes and the sign-in link

**Files:** Modify `src/App.jsx`, `src/pages/login/LoginPage.jsx`.

- [x] Routes `/set-password` and `/forgot-password` next to `/login` (outside `RequireAuth`).
- [x] Sign-in page: "Forgot your password?" link to `/forgot-password`; keep "Need access? Contact your administrator."

### Task 4: Verify and document

- [x] `npm run build` green.
- [x] API checks through the Vite proxy (no data changed): verify returns `valid:false` for a bogus token for both purposes; submit with a bad token → `400 invalid or expired token`; short password → `400` with `fields.password`; forgot password for an unknown identity → `204`; `/set-password` and `/forgot-password` served.
- [ ] Manual browser walkthrough with a real invitation/reset token (spec §5) — to be done by an admin.
- [x] Update `2026-10-14-manage-users-page-design.md` §5 and `webapp-backend/README.md` (the `/set-password` page now exists).
- [x] Commit: `feat: add set password and forgot password pages`.
