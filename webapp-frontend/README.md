# Hot Desk React Frontend

React + Vite frontend for the Hot Desk Monitor API. It is intentionally kept
separate from the existing Node service while the backend migration is pending.

## Local development

Start the existing API from the repository root:

```bash
npm start
```

Then start Vite in this directory:

```bash
npm install
npm run dev
```

Vite proxies `/api`, `/labels`, and `/healthz` to `http://localhost:3000` by
default. Set `VITE_DEV_API_TARGET` to use another local API origin.

## Deployment

The repository-root `vercel.json` builds and serves this application for a
Vercel project linked at the repository root. Redeploy after pulling this
change. Alternatively, configure `webapp-frontend` as Vercel's Root Directory,
then use the Vite preset, `npm run build`, and `dist` output. Set this
environment variable to the HTTPS origin of the deployed API:

```text
VITE_API_BASE_URL=https://api.hotdesk.example.com
```

`VITE_` variables are public browser configuration. Do not put database,
administrator, sensor, display, or cron secrets in this project.

The API must permit the Vercel frontend origin with CORS. See
`../docs/VERCEL_REACT_MIGRATION.md` for the planned serverless API migration.
