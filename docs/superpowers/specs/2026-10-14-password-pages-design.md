# Set Password and Forgot Password Pages — Design

**Date:** 2026-10-14
**Status:** Implemented
**Scope:** Two public pages in `webapp-frontend` for the password flows the backend already provides (`2026-10-13-admin-users-design.md` §4): **Set password** (`/set-password?token=…`) for invitation links and reset links, and **Forgot password** (`/forgot-password`) to request a reset link. Plus a "Forgot your password?" link on the sign-in page.

## 1. Background

The backend emails links of the form `{FRONTEND_URL}/set-password?token=<raw>`:
- **Invitation** (`activate` token, valid 72 h) when an admin creates a user or resends the invitation.
- **Reset** (`reset` token, valid 1 h) after `POST /api/auth/forgot-password`.

`webapp-frontend` has no route for either page, so invited users cannot activate their account and nobody can reset a forgotten password. The sign-in page only says "Contact your administrator". This was the top follow-up in `2026-10-14-manage-users-page-design.md` §5.

Backend endpoints (unchanged by this work; all under `/api/auth`, already proxied to Flask by Vite):

| Endpoint | Behaviour |
|---|---|
| `GET /set-password/verify?token=&purpose=activate\|reset` | `{"valid": bool}`. A reset token is only valid if the user is active. Default purpose is `reset`. |
| `POST /set-password {token, password}` | Accepts either token type. `204` on success (sets password, activates and unlocks the account, consumes the token). `400 {"error":"validation failed","fields":{"password":…}}` if shorter than 8; `400 {"error":"invalid or expired token"}`. |
| `POST /forgot-password {email}` | Always `204` (no account enumeration). Looks the user up by email **or username**; emails a reset link only for active users. |

## 2. Goals, non-goals

**Goals**
- An invited user can open the email link, choose a password, and sign in.
- A user who forgot their password can request a link from the sign-in page and set a new one.
- Clear outcomes for bad links (expired, already used, incomplete).

**Non-goals**
- Changing your own password while signed in (needs a new backend endpoint; separate work).
- Email delivery setup (`RESEND_API_KEY`, `EMAIL_FROM`, `FRONTEND_URL`) — configuration, tracked separately.
- Password strength rules beyond the backend's minimum of 8 characters.

**Anti-goals**
- Revealing whether an account exists from the forgot-password page.
- Leaving the token visible in the address bar after the page has read it.

## 3. Decisions

| Topic | Decision |
|---|---|
| Look and feel | Same `AuthLayout` / `auth-card` / `auth-*` styles as the sign-in page. |
| Routes | `/set-password` and `/forgot-password`, outside `RequireAuth` (public). Available whether or not someone is signed in. |
| Token type | The link does not say which kind it is, so the page verifies `purpose=activate` first, then `purpose=reset`, and words the page accordingly ("Activate your account" vs "Reset your password"). |
| Token in URL | Read once into state, then removed from the address bar with `history.replaceState` (keeps it out of screenshots, history and shared URLs). |
| Password entry | New password + confirm, with a Show/Hide toggle like sign-in; client-side checks for minimum 8 and matching; server errors still shown. |
| Invalid link | One message covering both kinds: the link has expired or was already used; reset links → "Request a new link" (to `/forgot-password`); invitations → ask the administrator to resend the invitation. |
| Success | "Your account is activated" / "Your password has been reset", with a **Sign in** button. No automatic sign-in (the backend does not return a token). |
| Forgot password | Single field "Email or username" (the backend matches either). After submit, always the same confirmation: "If an account matches, we've emailed a link to reset your password. It expires in 1 hour." |
| Sign-in page | Add a "Forgot your password?" link; keep "Need access? Contact your administrator." |

## 4. Page states

**Set password:** `checking` → `form` (activate | reset) → `done`; or `invalid` / `missing` (no token in the URL). A submit that returns "invalid or expired token" moves to `invalid`.

**Forgot password:** `form` → `sent`. Network or server failure shows an error on the form so the user can retry.

## 5. Testing

- No frontend test runner exists; gate is `npm run build` plus a manual walkthrough.
- Manual walkthrough against the local API. Email is not configured and the database stores only token hashes, so issue a raw token directly: in `webapp-backend/`, run `app.auth.tokens.issue_token(<user id>, "activate", 72)` (or `"reset", 1`) inside `create_app().app_context()`. Then open `/set-password?token=<raw>`, set a password, and sign in. For forgot password, check the page always confirms, for known and unknown identities.
- Backend behaviour is already covered by `tests/test_password_flows.py`.

## 6. Left to the builder

Exact copy beyond the messages above, component structure, and minor layout details, within the existing auth styles.
