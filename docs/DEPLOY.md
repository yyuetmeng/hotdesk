# Deploying Hot Desk Monitor (with GitHub)

GitHub can't host this app by itself: GitHub Pages only serves static files, and Codespaces stop when idle.
The app is a server that must run 24/7 so sensors can report to it. So the setup is:

```
 push to main ──▶ GitHub Actions ──▶ tests ──▶ builds image ──▶ ghcr.io/yyuetmeng/hotdesk
                                                                     │
                                                    SSH: pull + restart
                                                                     ▼
                                     your server:  Caddy (HTTPS) ──▶ hotdesk container ──▶ /data volume
```

- **GitHub** keeps the code, runs the tests, builds the container image, stores it in GitHub Container
  Registry (GHCR), and updates your server on every merge to `main`.
- **Your server** (a company VM or a small cloud VM) runs the app and Caddy, which provides HTTPS with
  automatic certificates.

You set this up once (about 30 minutes). After that, deploying is just merging to `main`.

---

## 1. Get a server

Any Linux VM works. The app is light: **1 vCPU, 1 GB RAM, 10 GB disk** is plenty for 125 desks.

| Option | Notes |
|---|---|
| Company VM (on-prem / private cloud) | Best fit if sensors and users are on the corporate network. Ask IT for Ubuntu 22.04/24.04 |
| Azure VM (B1s/B1ms), AWS EC2 (t3.micro/small), Google Compute (e2-small) | A few dollars to ~US$15 a month |

You need:
- **A DNS name** pointing at the server, e.g. `hotdesk.yourcompany.com`.
- **Open ports:** 443 (HTTPS) and 80 (certificate issuance and redirect to HTTPS) from users and from
  your LoRaWAN network server. Port 22 (SSH) open to GitHub Actions; see the note in step 4.

## 2. Prepare the server (once)

SSH in and run:

```bash
# Docker + Compose plugin
curl -fsSL https://get.docker.com | sudo sh

# A deploy user that GitHub Actions logs in as
sudo useradd -m -s /bin/bash -G docker deploy
sudo mkdir -p /opt/hotdesk && sudo chown deploy:deploy /opt/hotdesk

# Settings for the app (secrets stay on the server, never in GitHub)
sudo -u deploy tee /opt/hotdesk/.env > /dev/null <<EOF
DOMAIN=hotdesk.yourcompany.com
ADMIN_TOKEN=$(openssl rand -hex 24)
SENSOR_API_KEY=$(openssl rand -hex 24)
TZ=Asia/Singapore
EOF
sudo chmod 600 /opt/hotdesk/.env
sudo cat /opt/hotdesk/.env      # note ADMIN_TOKEN (dashboard) and SENSOR_API_KEY (sensor webhooks)
```

Then create an SSH key just for deployments:

```bash
ssh-keygen -t ed25519 -N '' -C github-deploy -f ~/hotdesk-deploy
sudo -u deploy mkdir -p ~deploy/.ssh
cat ~/hotdesk-deploy.pub | sudo -u deploy tee -a ~deploy/.ssh/authorized_keys
cat ~/hotdesk-deploy          # private key: goes into the GitHub secret below, then delete this file
```

From your own computer, `ssh-keyscan -H hotdesk.yourcompany.com` prints the server's host key for the
optional `DEPLOY_KNOWN_HOSTS` secret.

## 3. Configure the GitHub repository (once)

In `github.com/yyuetmeng/hotdesk`:

1. **Settings → Secrets and variables → Actions → New repository secret**:

   | Secret | Value |
   |---|---|
   | `DEPLOY_HOST` | the server's DNS name or IP |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | the whole private key from `~/hotdesk-deploy`, including the BEGIN/END lines |
   | `DEPLOY_KNOWN_HOSTS` | *(recommended)* output of `ssh-keyscan -H <server>`. If left out, the workflow trusts the key it sees on first connect |

   Optional variable (**Variables** tab): `DEPLOY_PATH` if you used a folder other than `/opt/hotdesk`.
2. **Settings → Environments → New environment → `production`** (optional but recommended). Add yourself
   under **Required reviewers** if every deployment should wait for a click to approve.
3. **Settings → Actions → General → Workflow permissions**: leave **Read repository contents and packages
   permissions**. The workflow asks for `packages: write` itself to publish the image.

## 4. Deploy

1. Create the `main` branch from the work branch: **Code → Branches → New branch**, name `main`, source
   `claude/seat-occupancy-monitoring-n192gb`. Or open a pull request into `main` and merge it.
2. The push to `main` starts **Actions → Build and deploy**:
   - **test**: runs the full test suite.
   - **image**: builds the container image and pushes `ghcr.io/yyuetmeng/hotdesk:latest` and `:<commit>`.
   - **deploy**: copies `deploy/docker-compose.yml` and `deploy/Caddyfile` to the server, pulls the new
     image, restarts with `docker compose up -d`, and waits until the app reports healthy.
3. Open `https://hotdesk.yourcompany.com` and enter the `ADMIN_TOKEN`.

The first start takes a minute while Caddy obtains the HTTPS certificate.

From then on, **every merge to `main` deploys automatically**. To redeploy without a code change, go to
**Actions → Build and deploy → Run workflow**.

> **Server not reachable from the internet?** GitHub's hosted runners connect over the internet, so they can't
> SSH into a VM on a private network. Either install a **self-hosted runner** on a machine inside the
> network (**Settings → Actions → Runners → New self-hosted runner**) and change the deploy job to
> `runs-on: self-hosted`, or leave the `DEPLOY_*` secrets unset. The workflow then only publishes the image,
> and you update the server by hand (step 6).
>
> On an internal-only host, Caddy can't get a public certificate. Add `tls internal` (or your company
> certificate) in `deploy/Caddyfile`, as described in the comments there.

## 5. After the first deploy

1. **Point the sensors at it.** Set up the TTN or ChirpStack webhook with `SENSOR_API_KEY`, then link the
   sensors to desks. See [SENSORS.md](SENSORS.md).
2. **Print the desk labels.** On the dashboard click **Print desk labels**. The QR codes now contain the
   permanent `https://` address. See the README's "Desk labels" section.
3. **Back up the data.** All state (check-ins, sensor links, 24 h history) is one small JSON file in the
   `hotdesk-data` Docker volume. A nightly copy is enough:
   ```bash
   docker compose -f /opt/hotdesk/docker-compose.yml cp hotdesk:/data/state.json /opt/hotdesk/backup-$(date +%F).json
   ```

## 6. Day-to-day operations

Run these on the server, in `/opt/hotdesk`:

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f hotdesk` (Caddy: `docker compose logs caddy`) |
| Restart | `docker compose restart hotdesk` |
| Manual update (no SSH deploy) | `docker compose pull && docker compose up -d` |
| Roll back to an earlier version | `HOTDESK_IMAGE=ghcr.io/yyuetmeng/hotdesk:<commit-sha> docker compose up -d` |
| Change settings | edit `.env`, then `docker compose up -d` |
| Change the floor plan | edit `config/building.json` in the repo and merge to `main` |

If the repository is private, a manual `docker compose pull` needs a login first:
`docker login ghcr.io -u <github-user>`, with a personal access token that has `read:packages` as the
password. The automated deploy logs in and out by itself.

## Without Docker (alternative)

On a server with Node.js 20.11+:

```bash
sudo useradd -r -s /usr/sbin/nologin hotdesk
sudo git clone https://github.com/yyuetmeng/hotdesk.git /opt/hotdesk && cd /opt/hotdesk
sudo npm ci --omit=dev
sudo tee /etc/hotdesk.env > /dev/null <<EOF
ADMIN_TOKEN=...
SENSOR_API_KEY=...
PUBLIC_URL=https://hotdesk.yourcompany.com
EOF
sudo cp deploy/hotdesk.service /etc/systemd/system/ && sudo systemctl enable --now hotdesk
```

Then put your usual reverse proxy (nginx, IIS, Caddy) in front of port 3000 with HTTPS. Make sure the
proxy doesn't buffer `/api/stream`, which carries the dashboard's live updates.
