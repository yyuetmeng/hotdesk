# Hot Desk Coding Guidelines

Rules for all code in this repository: the Flask API (`webapp-backend/`) and the React/Vite
frontend (`webapp-frontend/`). When a rule here conflicts with older code, follow the rule and
fix the old code when you next touch it.

---

## 1. Dates and times

### 1.1 Display format

Every date or time shown to a user uses one format:

| What | Format | Example |
|---|---|---|
| Date and time | `dd/MM/yyyy HH:mm:ss` | `14/10/2026 17:05:03` |
| Date only | `dd/MM/yyyy` | `14/10/2026` |

- **24-hour clock.** `HH` is 00–23. Do not use a 12-hour clock or AM/PM.
- **Zero-padded.** Always two digits for day, month, hour, minute and second (`04/09/2026 08:03:07`).
- **Viewer's local time.** Convert instants to the browser's time zone for display.
- **Never** use `toLocaleString`, `toLocaleDateString` or `toLocaleTimeString` for user-facing
  dates: their output changes with the browser's language and region.

Watch the format tokens: in most libraries `MM` is month and `mm` is minutes, `HH` is 24-hour and
`hh` is 12-hour, and in date-fns `YYYY` is the week-numbering year (use `yyyy`).

### 1.2 Use the shared helpers

Frontend: import from `src/format.js`, and do not write ad-hoc date formatting in components.

```jsx
import { formatDate, formatDateTime } from '../format.js';

<td>{formatDateTime(plan.updated_at)}</td>   // 14/10/2026 17:05:03
<td>{formatDate(user.start_date)}</td>       // 14/10/2026
```

Both return `—` for empty or invalid input. Date-only strings (`2026-10-14`) are treated as
calendar dates and never shift by a day across time zones.

### 1.3 APIs and storage stay ISO 8601

The display format is **only** for what a person reads. Everything machine-facing uses ISO 8601:

| Layer | Rule |
|---|---|
| Database | Instants are `timestamptz`; calendar dates are `date`. |
| API responses | Instants: `value.isoformat()` (includes the offset). Dates: `YYYY-MM-DD`. |
| API requests | Accept `YYYY-MM-DD` for dates (`dt.date.fromisoformat`), ISO 8601 for instants. |
| Logs and audit `details` | ISO 8601. |
| Server-side "now" | Prefer the database clock (`func.now()`) for anything compared in SQL (token expiry, `updated_at`). Seat booking code uses only `app.desk.rules.now()` (tests replace it) and `BOOKING_TIMEZONE` for "today" and slot times. |

Never send `dd/MM/yyyy` to or from the API: `04/09/2026` is 4 September here and 9 April in a
US locale.

Date input fields (`<input type="date">`) use `YYYY-MM-DD` values. Format the value for display
with `formatDate` wherever it is shown as text.

---

## 2. Backend (Flask, `webapp-backend/`)

### 2.1 Structure
- Routes live in blueprints: `app/auth/` (`/api/auth`) and `app/admin/` (`/api/admin`).
- Shared code lives in `app/core/`: `orm.py` (session), `*_models.py` (ORM models),
  `audit.py`, `errors.py`, `security.py`, `users.py`.

### 2.2 Data access
- Use SQLAlchemy 2.0 ORM models through `orm_session()`. Do not add new `run_one` /
  `run_query` / `run_write` calls; `app/core/db.py` only remains for legacy code and tests.
- Models mirror the SQL scripts in `sql/`. Never call `create_all`.
- Set `updated_at = func.now()` explicitly when changing a row that has it; there is no trigger.
- Catch `IntegrityError`, call `session.rollback()`, and return a 409 for unique-constraint
  conflicts.

### 2.3 Schema changes
- Add a new numbered script, `sql/NNNN_short_description.sql`, never edit an applied one.
- Scripts must be safe to run twice (`if not exists`, idempotent `update`/`delete`).
- Data changes that follow from code changes (renames, removed types) get their own script.
- Update the setup step in `webapp-backend/README.md` when the highest script number changes.

### 2.4 API responses
- Errors use `error(message, status, **extra)` from `app/core/errors.py`, which returns
  `{"error": message, ...}`. Validation failures are
  `error("validation failed", 400, fields={field: message})`.
- Status codes: 400 invalid input, 401 not signed in, 403 signed in but not allowed,
  404 not found, 409 conflict.
- IDs in JSON are strings.
- Admin endpoints use `@admin_required`; signed-in endpoints use `@auth_required`.

### 2.5 Audit and logging
- Record every admin change with `write_audit(actor_id, "area.action", target_id, details)`.
  Actions are lowercase `area.action` (e.g. `user.create`, `floorplan.delete`).
- **Never** log or audit passwords, password hashes, raw tokens or JWTs.

### 2.6 Tests
- Every endpoint change comes with a pytest test in `webapp-backend/tests/`.
- Tests run against a **local PostgreSQL only**, never the Supabase app database: set
  `TEST_DATABASE_URI` in `webapp-backend/.env` (see `.env.example`); `tests/conftest.py` refuses
  non-local hosts. The `hotdesk_test` schema is rebuilt from `sql/*.sql` at the start of each run.
- Run from `webapp-backend/`: `python -m pytest -q` (the full suite takes about 2 minutes). Do not run
  two sessions at once: they share the `hotdesk_test` schema.

---

## 3. Frontend (React + Vite, `webapp-frontend/`)

### 3.1 Structure
- Pages live in `src/pages/<page-name>/<PageName>Page.jsx`; the floor plan builder lives in
  `src/floorplan/`.
- Reuse `src/components.jsx` (`PageTitle`, `Notice`, `Loading`, ...) instead of writing new
  markup for page titles, messages and loading states.
- Keep pure logic (validation, geometry) out of components, in plain `.js` modules that can be
  tested with `node` (see `src/floorplan/logic.js`).

### 3.2 Talking to the API
- Use `request()` for the Node API and `flaskRequest()` for the Flask API, both in `src/api.js`.
  Do not call `fetch` directly from components.
- The signed-in Flask token is stored under `AUTH_TOKEN_KEY` in `sessionStorage`; read it only
  through `src/api.js`.
- Show a 401 as a sign-in prompt and a 403 as "not allowed", not as a generic error.

### 3.3 Shared definitions
- The floor plan element catalog lives in the `floor_elements` table. Do not hard-code element
  types, sizes or colours in Python or JavaScript; the editor loads them from
  `GET /api/admin/floor-plans/catalog` (`setCatalog` in `src/floorplan/palette.js`).
- Per-type element settings are the keys of `floor_elements.config`; each default value's
  JSON type is the allowed type. Add a label for a new setting in `SETTING_LABELS` (editor).

### 3.4 Checks before you commit
- `npm run build` succeeds.
- `node scripts/smoke_floorplan_logic.mjs` prints `floorplan logic smoke OK` if you touched the
  floor plan module.

---

## 4. Git

- Commit messages: `type: summary` in the imperative, lowercase type. Types: `feat`, `fix`,
  `refactor`, `docs`, `test`, `chore`.
- One logical change per commit; tests and docs go in the same commit as the code they cover.
- Never commit `.env` files, credentials or tokens.
