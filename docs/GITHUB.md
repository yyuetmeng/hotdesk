# Running Hot Desk Monitor on GitHub

GitHub runs this project in two ways:

| What | GitHub feature | Use it for |
|---|---|---|
| Automatic tests on every push and pull request | **GitHub Actions** (`.github/workflows/ci.yml`) | Catching breakage before merging |
| Running the live app (server + dashboard) in the browser | **GitHub Codespaces** (`.devcontainer/devcontainer.json`) | Demos, trying changes, pilot testing |

GitHub Pages will **not** work: it only serves static files, and this app needs a running Node.js server
(for sensor ingestion, check-ins and the live dashboard stream). For a permanent deployment, see step 4.

---

## 1. Get the code onto the main branch

The work is on the branch `claude/seat-occupancy-monitoring-n192gb`.

1. Open the repository on GitHub: `https://github.com/yyuetmeng/hotdesk`.
2. Click **Pull requests → New pull request**, choose base `main` and compare
   `claude/seat-occupancy-monitoring-n192gb`, then **Create pull request**.
3. Wait for the **CI** check to go green (see step 2), then click **Merge pull request**.

> If the repository has no `main` branch yet (it started empty), go to **Settings → General → Default branch**,
> switch it to `claude/seat-occupancy-monitoring-n192gb`, or create `main` from that branch under
> **Code → Branches → New branch**.

## 2. Automatic tests with GitHub Actions

Nothing to install: the workflow file is already in the repo.

1. Go to **Settings → Actions → General** and make sure **Allow all actions and reusable workflows** is
   selected (it is by default on personal repositories).
2. Push any commit, or open the **Actions** tab → **CI** → **Run workflow**.
3. Each run:
   - runs the unit and API tests (`npm test`) on Node 20 and Node 22;
   - starts the real server with an admin token and sensor key, feeds it simulated sensor data, and checks
     that the dashboard API reports all 125 desks and that the dashboard and check-in pages load.
4. A green tick next to the commit means everything passed. Click a red cross to see the failing step's log.

Optional: require CI to pass before merging under **Settings → Branches → Add branch ruleset** (target `main`,
enable **Require status checks to pass**, add the `test` checks).

## 3. Run the app in GitHub Codespaces

1. **Set the secrets (recommended, so the dashboard isn't open to anyone):**
   **Settings → Secrets and variables → Codespaces → New repository secret**, and add:
   - `ADMIN_TOKEN`: the password administrators enter to open the dashboard
   - `SENSOR_API_KEY`: the key sensor gateways send in the `X-Api-Key` header

   Codespaces makes these available to the app as environment variables automatically.
2. On the repository page click **Code → Codespaces → Create codespace on main**.
   The first start takes a minute or two. The tests run once when it has been built.
3. In the Codespace terminal, start the server:
   ```bash
   npm start
   ```
   Port 3000 opens in a new browser tab with the admin dashboard. If it doesn't, open the **Ports** tab and
   click the globe icon next to port 3000.
4. To see live data without real sensors, open a second terminal (**+** in the terminal panel) and run:
   ```bash
   SENSOR_API_KEY=$SENSOR_API_KEY npm run simulate
   ```
   Add `AWAY_GRACE_MINUTES=1` in front of `npm start` to watch desks free themselves within a minute.
5. **Sharing:** forwarded ports are private by default (only you, signed in to GitHub). To let colleagues or a
   test sensor gateway reach it, right-click port 3000 in the **Ports** tab → **Port Visibility** →
   **Private to Organization** or **Public**. Only do this with `ADMIN_TOKEN` and `SENSOR_API_KEY` set.
6. The employee check-in page for a desk is `<forwarded URL>/checkin?seat=L1-DF-01`.

A Codespace stops after 30 minutes of inactivity and its data (`data/state.json`) lasts only as long as the
Codespace. It suits demos and pilots, not a 24/7 production service.

## 4. Permanent deployment (beyond GitHub)

For round-the-clock use, the sensors need a server that is always on. Any host that runs Node.js 20+ works
(an internal VM, Azure App Service, AWS, Render, Fly.io and so on):

```bash
git clone https://github.com/yyuetmeng/hotdesk.git && cd hotdesk
ADMIN_TOKEN=... SENSOR_API_KEY=... PORT=3000 npm start
```

- Keep `data/` on persistent storage (or set `STATE_FILE` to a path that survives restarts).
- Put it behind HTTPS (your corporate reverse proxy or the host's built-in TLS).
- Point the floor sensor gateways at `https://<host>/api/sensors/events` with the `X-Api-Key` header.
- Encode `https://<host>/checkin?seat=<desk id>` in each desk's QR sticker.

GitHub Actions can deploy there automatically after CI passes. The steps depend on the host you choose.
