# Hot Desk React Frontend

React + Vite frontend for the Hot Desk Monitor API. It is intentionally kept
separate from the existing Node service while the backend migration is pending.

## Local development

For login, start the configured Flask backend from `../webapp-backend`:

```bash
python run.py
```

Then start Vite in this directory:

```bash
npm install
npm run dev
```

Open `http://localhost:5173/login` and sign in with an existing backend account.
The backend requires its database configuration, migrations, and an account;
see `../webapp-backend/README.md` for setup and administrator bootstrap.

Keep `VITE_API_BASE_URL` empty for local development. Vite proxies `/api/auth`
to Flask at `http://localhost:5000`; override with `VITE_DEV_AUTH_TARGET` in
`.env.local`. Restart Vite after changing configuration.

Other `/api` requests, `/labels`, and `/healthz` still target the separate legacy
service at `http://localhost:3000` (`VITE_DEV_API_TARGET` overrides that target).
The legacy service is not included in this checkout. Flask login does not
provide its desk APIs or replace its administrator token.

## Account session

`/login` posts `{email_or_username, password}` to `/api/auth/login` and opens
`/` after verification through `/api/auth/me`. All workspace routes require a
validated session; signed-out visitors are redirected to `/login`. Valid
authenticated deep links remain on their requested page. Signed-in visitors
to `/login` are redirected to `/`. The `/account` page displays
identity, role, and departments. A failed session verification offers retry;
an invalid or expired token returns the user to sign-in.

The JWT is stored in `sessionStorage` as `hotdesk.auth.token`, independently
of legacy credentials. It survives refresh within the tab session; browsers
may preserve session storage when restoring tabs. If storage is blocked, login
works in memory only. Passwords are never persisted. Logout clears this local
session but does not revoke the server token. Tokens expire after 12 hours by
default. No password-reset or activation UI is included.

The backend currently does not recheck account eligibility in `/api/auth/me`;
disabling an account does not immediately invalidate its existing JWT.

Validation: run `npm run build`, then check login success with a test account,
invalid credentials, refresh, direct `/account` access, logout, expired tokens,
and offline retry. Use a disposable account: five incorrect passwords can lock
an account. Do not run database tests against a production database.

## Deployment

Configure `webapp-frontend` as Vercel's Root Directory,
then use the Vite preset, `npm run build`, and `dist` output. Set this
environment variable to the HTTPS origin of the deployed API:

```text
VITE_API_BASE_URL=https://api.hotdesk.example.com
```

`VITE_` variables are public browser configuration. Do not put database,
administrator, sensor, display, or cron secrets in this project.

The API must permit the frontend origin with CORS. Vite development proxies
are not included in production builds. The configured API origin must serve
`/api/auth/login` and `/api/auth/me`; use HTTPS in production.
