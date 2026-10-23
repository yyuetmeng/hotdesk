# Hot Desk web app (webapp-frontend)

React single-page app for Hot Desk, built with Vite. It talks to the Flask API in `../webapp-backend`. See the
[root README](../README.md) for the overall picture.

**Stack:** React 19, React Router 7, Vite 6, plain CSS with light/dark themes. `qrcode` draws desk labels;
`jsqr` reads QR codes in browsers without `BarcodeDetector` (Safari on iPhone). No UI framework, no state
library, no TypeScript.

## Local development

Start the API first (`python run.py` in `../webapp-backend`, port 5000), then:

```bash
npm install
npm run dev        # http://localhost:5173 (start.bat on Windows)
npm run build      # production build into dist/
```

Sign in with an account from the backend (`scripts/create_admin.py` makes the first admin).

Locally, leave `VITE_API_BASE_URL` empty: `vite.config.js` proxies the Flask paths (`/api/auth`, `/api/desk`,
`/api/public`, `/api/admin/...`) to `http://localhost:5000`. Point the proxy elsewhere with `VITE_DEV_AUTH_TARGET`
in `.env.local`, and restart Vite after changing it. A new `/api/admin/<area>` needs its own proxy line, or it
falls through to the catch-all `/api` rule (see Things to note).

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | Vercel (production) | The API origin, e.g. `https://jd-hotdesk-vercel.vercel.app`, no trailing slash. Empty locally |
| `VITE_DEV_AUTH_TARGET` | `.env.local` | Where the dev proxy sends Flask calls (default `http://localhost:5000`) |

`VITE_` variables end up in the browser bundle. Never put secrets in them.

## Code layout

```
src/
  main.jsx, App.jsx    entry; routes, sidebar, mobile bottom bar, role guards (AdminOnly, AccountManagersOnly)
  auth.jsx, session.js sign-in state; where the token is kept
  api.js               fetch wrapper: base URL, bearer token, JSON errors (flaskRequest / request)
  components.jsx       shared bits: PageTitle, Notice, Loading, AdminGate...
  format.js            the only place that formats dates and times (dd/MM/yyyy HH:mm:ss)
  layout.js, roles.js, theme.js, ThemeSettings.jsx, PinLoader.jsx, hooks.js, download.js
  desk/                Book a Desk, seat panel, QR scanner, check-in page
  display/             public floor display for TVs (/display/:slug) and the shared floor drawing
  floorplan/           floor plan list and editor (admins)
  qr/                  Print Desk Labels: label art, QR, ZIP download
  pages/<area>/        one folder per page: dashboard, overview, finder, users, insights, audit,
                       assignments, displays, account, login, set-password, forgot-password
scripts/smoke_*.mjs    tests for the pure logic files
```

**Convention:** each area keeps its rules in a plain `*Logic.js` file (`deskLogic.js`, `scanLogic.js`,
`dashboardLogic.js`, ...) with no React in it, and the `.jsx` components only render. The logic files are what
the smoke scripts test.

### Pages

| Route | Page | Who |
|---|---|---|
| `/login`, `/forgot-password`, `/set-password` | Sign in; request a reset link; set a password from an invitation or reset link | everyone |
| `/` | Dashboard | signed in |
| `/book` | Book a Desk (floor picker, seat panel, booking form) | signed in |
| `/scan` | QR scanner (centre button of the mobile bottom bar) | signed in |
| `/checkin/:seatId` | Seat page; checks in when opened by a scan | signed in |
| `/overview`, `/finder`, `/account` | Floor Overview, Colleague Finder, my account | signed in |
| `/users` | Manage Users / Project Teams, Excel import | admins, account managers |
| `/floor-plans`, `/floor-plans/:id` | Floor plan list and editor | admins |
| `/desk-labels`, `/displays`, `/seat-assignments`, `/insights`, `/audit` | Labels, displays, assignments, Insights, audit log | admins |
| `/display/:slug` | Floor display for a TV (no sign-in) | public |

## Tests

There is no test runner. Each smoke script runs with plain Node and exits non-zero on failure:

```bash
node scripts/smoke_desk_logic.mjs
for f in scripts/smoke_*.mjs; do node "$f" || echo "FAILED $f"; done
```

Then run `npm run build` to catch import and syntax errors.

## Deployment (Vercel)

Project `jd-hotdesk`, root directory `webapp-frontend`, Vite preset, output `dist`. `vercel.json` rewrites every
path to `/index.html` so deep links and QR label links (`/checkin/<id>`) load the app. Set
`VITE_API_BASE_URL` to the backend URL; the backend must allow this origin with CORS (it currently allows all).

## Things to note

- **Sign-in token:** stored as `hotdesk.auth.token` in `sessionStorage` (this tab only), or in `localStorage` with
  "Keep me signed in on this device" (5 days), so a desk QR scan opened in a new tab stays signed in. Signing out
  clears it locally; the server doesn't revoke tokens.
- **Check-in only by scan:** `/checkin/:seatId` checks in only when `openedByScan()` (`desk/scanLogic.js`) says
  the page came from the phone camera (a fresh page load) or the in-app scanner (`state.scanned`). Links inside the
  app must not pass `scanned`.
- **QR labels** encode `<site>/checkin/<seat id>`. The scanner uses only the seat id, so labels printed from
  another address still work, and other QR codes can't redirect anyone.
- **Camera needs HTTPS** (or `localhost`); on a plain `http://` address the scanner shows a message instead.
- **Dates and times:** always via `src/format.js`; never `toLocaleString`. See `docs/CODING_GUIDELINES.md`.
- **Legacy leftovers in `vite.config.js`:** the catch-all `/api`, `/labels` and `/healthz` proxy rules point at
  an old service on port 3000 that no longer exists, and `publicDir: '../public'` points at a folder that isn't in
  the repo. Both are harmless, but a request that reaches the catch-all fails locally.
- **OneDrive folder:** Vite's watcher can miss a second save made very quickly after the first. If the page doesn't
  update, save again or restart `npm run dev`.
