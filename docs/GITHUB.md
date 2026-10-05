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
   - installs dependencies (`npm ci`) and runs the unit and API tests (`npm test`) on Node 20 and Node 22;
   - starts the real server with an admin token and sensor key, feeds it simulated sensor data, and checks
     that the dashboard API reports all 125 desks, that the dashboard and check-in pages load, and that the
     label page produces 125 QR codes.
4. A green tick next to the commit means everything passed. Click a red cross to see the failing step's log.

Optional: require CI to pass before merging under **Settings → Branches → Add branch ruleset** (target `main`,
enable **Require status checks to pass**, add the `test` checks).

## 3. Run the app in GitHub Codespaces

A Codespace starts the whole app by itself. There's nothing to install or type.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/yyuetmeng/hotdesk?quickstart=1)

1. **Optional settings first:** **Settings → Secrets and variables → Codespaces → New repository secret**
   (or your personal Codespaces secrets at github.com/settings/codespaces):

   | Secret | Effect |
   |---|---|
   | `ADMIN_TOKEN` | Dashboard password. If not set, one is generated and shown when the Codespace starts |
   | `SENSOR_API_KEY` | Key for sensor webhooks. Generated if not set |
   | `HOTDESK_DEMO` = `1` | Also runs the sensor simulator, so the dashboard has live demo data |
   | `HOTDESK_PUBLIC` = `1` | Makes the app's address public, which phones scanning QR labels and sensor webhooks need |

2. Click the button above, or **Code → Codespaces → Create codespace on main**.
   The first build takes 2–3 minutes: dependencies are installed and the tests run.
3. The app then **starts automatically** and the dashboard opens in a new tab, already signed in. The terminal
   shows the addresses and passwords:

   ```
   Hot Desk Monitor (running)
   Dashboard     https://<codespace>-3000.app.github.dev/?token=...
   Admin token   ...
   Sensors page  https://<codespace>-3000.app.github.dev/sensors
   Desk labels   https://<codespace>-3000.app.github.dev/labels
   Sensor key    ...   (X-Api-Key for .../api/integrations/ttn)
   ```

   If no tab opens, use the **Ports** tab → port 3000 → globe icon.

Commands inside the Codespace:

| Command | What it does |
|---|---|
| `npm run codespace:status` | Show the addresses and passwords again |
| `npm run codespace` | Restart the app (after editing code or `config/building.json`) |
| `npm run codespace:stop` | Stop it |
| `bash scripts/codespace.sh logs` | Follow the app log |
| `HOTDESK_DEMO=1 npm run codespace` | Restart with demo sensor data |
| `AWAY_GRACE_MINUTES=1 HOTDESK_DEMO=1 npm run codespace` | Demo where desks free themselves within a minute |

**Who can open it.** A Codespace's forwarded address is **private** by default: only you, signed in to GitHub,
can open it. To let colleagues, phones (QR check-in) or a sensor network server (TTN/ChirpStack webhook) reach
it, set `HOTDESK_PUBLIC=1`, or right-click port 3000 in the **Ports** tab → **Port Visibility** →
**Public** (or **Private to Organization** for colleagues in your GitHub organization). The dashboard and
sensor endpoints still need the admin token / sensor key.

**What a Codespace is good for.** Demos, trials and a short pilot. It is **not** a 24/7 service:
- **It stops when idle,** after 30 minutes by default. You can raise this to 4 hours at
  github.com/settings/codespaces → *Default idle timeout*. While it's stopped, nobody can check in and sensor
  readings are lost.
- **It restarts the app by itself** when you reopen it. Desk data in `data/` is kept for the life of the Codespace.
- **Its address changes** if you create a new Codespace, which breaks printed QR labels and webhook settings.
  Print labels only from the permanent deployment.
- **Unused Codespaces are deleted** after 30 days by default, and with them their data.
- **Usage counts against your GitHub Codespaces quota** (personal accounts include a free monthly allowance).

For permanent use, deploy to AWS (next section).

## 4. Permanent deployment

For round-the-clock use, GitHub Actions deploys every merge to `main` to AWS (ECS Fargate behind an HTTPS
load balancer). Step-by-step: **[DEPLOY.md](DEPLOY.md)**.
