# Deploying Hot Desk Monitor to AWS (from GitHub)

Every merge to `main` deploys automatically. GitHub Actions tests the code, builds the container image,
pushes it to Amazon ECR and updates a CloudFormation stack that runs the app.

```
 push to main ─▶ GitHub Actions ─▶ tests ─▶ image ─▶ Amazon ECR
                       │ (OIDC: short-lived AWS credentials, no keys stored in GitHub)
                       ▼
                 CloudFormation stack "hotdesk"
                       │
 users, phones,        ▼
 TTN/ChirpStack ─https─▶ Application Load Balancer ─▶ ECS Fargate task ─▶ EFS (desk state, daily backup)
                       (ACM certificate,              (the app container)
                        HTTP → HTTPS)                       ▲
                                     Secrets Manager: ADMIN_TOKEN, SENSOR_API_KEY
```

| AWS service | What it does here |
|---|---|
| **ECS Fargate** | Runs the app container (one copy, 0.25 vCPU / 0.5 GB). No servers to patch |
| **Application Load Balancer + ACM** | Serves HTTPS with a free, auto-renewing certificate and redirects HTTP to HTTPS |
| **EFS** | Network disk holding the desk state file. Survives redeploys, encrypted, backed up daily by AWS Backup |
| **Secrets Manager** | Generates and stores the dashboard password and the sensor webhook key |
| **CloudWatch Logs** | App logs, kept 30 days |
| **Route 53** *(optional)* | DNS record and automatic certificate validation |
| **ECR** | Stores the container images (last 30 kept) |

Everything is defined in two templates: `deploy/aws/github-access.yml` (one-time access setup) and
`deploy/aws/hotdesk.yml` (the app).

**Rough cost** (Singapore region): load balancer ~US$20, Fargate ~US$10, EFS/Secrets/logs/ECR ~US$2–3,
so about **US$30–35 per month**.

---

## 1. Decide the address

Pick the name people will use, e.g. `hotdesk.yourcompany.com`, and the AWS region (e.g. `ap-southeast-1`).

- **DNS in Route 53:** note the **hosted zone ID** (Route 53 → Hosted zones). The stack then creates the DNS
  record and the HTTPS certificate for you.
- **DNS elsewhere** (e.g. corporate DNS): request a certificate first in **AWS Certificate Manager** (same
  region) → *Request public certificate* → your domain → DNS validation. Ask whoever runs DNS to add the
  validation CNAME, then wait until it says *Issued*. Note its **ARN**. After the first deploy you'll also
  add a CNAME for the app itself (step 5).

## 2. Give GitHub access to AWS (once, about 5 minutes)

In the AWS console, in your chosen region:

1. **CloudFormation → Create stack → With new resources**, then **Upload a template file**: choose
   `deploy/aws/github-access.yml` from this repo.
2. Stack name: `hotdesk-github-access`. Keep the defaults (`GitHubOwner` = `yyuetmeng`, `GitHubRepo` = `hotdesk`,
   `GitHubEnvironment` = `production`, `AppStackName` = `hotdesk`).
   If your account already has a GitHub identity provider (IAM → Identity providers →
   `token.actions.githubusercontent.com`), set `CreateOidcProvider` = `false`.
3. Tick *I acknowledge that AWS CloudFormation might create IAM resources*, then **Submit**.
4. When it shows `CREATE_COMPLETE`, open the **Outputs** tab. You need `AwsRoleArn`, `CloudFormationRoleArn`
   and `EcrRepository`.

This creates the ECR repository and two roles:
- **The role GitHub signs in as.** Only jobs from this repository's `production` environment can use it,
  and it can only push images and update the `hotdesk` stack.
- **The role CloudFormation uses to build the app.** It can't create IAM roles beyond the app's own.

## 3. Configure the GitHub repository (once)

In `github.com/yyuetmeng/hotdesk`:

1. **Settings → Environments → New environment** named `production`. Optionally add yourself as a
   **required reviewer** so each deploy waits for your approval.
2. **Settings → Secrets and variables → Actions → Variables tab → New repository variable**:

   | Variable | Value |
   |---|---|
   | `AWS_REGION` | e.g. `ap-southeast-1` |
   | `AWS_ROLE_ARN` | `AwsRoleArn` from step 2 |
   | `AWS_CFN_ROLE_ARN` | `CloudFormationRoleArn` from step 2 |
   | `DOMAIN_NAME` | e.g. `hotdesk.yourcompany.com` |
   | `HOSTED_ZONE_ID` | Route 53 hosted zone ID (**or** leave unset and use the next one) |
   | `CERTIFICATE_ARN` | ACM certificate ARN, only if your DNS is not in Route 53 |
   | `TIME_ZONE` | *(optional)* default `Asia/Singapore` |

   None of these are secret, so they are variables rather than secrets. There are no AWS keys anywhere.

## 4. Deploy

1. Create `main` from the work branch: **Code → Branches → New branch**, name `main`, source
   `claude/seat-occupancy-monitoring-n192gb`. Or merge a pull request into `main`.
2. **Actions → Deploy to AWS** runs. The first run takes **10–15 minutes** while AWS creates the network, load
   balancer, certificate, file system and service. Later runs take about 3–5 minutes.
3. When it's green, the run summary shows the URL.

Every later merge to `main` redeploys. **Actions → Deploy to AWS → Run workflow** redeploys without a change.
During a deploy the old copy stops before the new one starts (the app keeps desk state in one place), so
expect about a minute of downtime. If the new version doesn't come up healthy, ECS rolls back automatically.

## 5. After the first deploy

1. **DNS (only if not in Route 53):** in **CloudFormation → hotdesk → Outputs**, copy `LoadBalancerDnsName` and
   create a **CNAME** from your domain to it.
2. **Get the passwords:** **Secrets Manager → `hotdesk/admin-token` → Retrieve secret value** is the dashboard
   password. **`hotdesk/sensor-api-key`** is the `X-Api-Key` for the sensor webhooks.
3. Open `https://hotdesk.yourcompany.com` and sign in with the admin token.
4. **Connect sensors.** Set up the TTN or ChirpStack webhook to `https://<domain>/api/integrations/...` with the
   sensor key, then link sensors to desks. See [SENSORS.md](SENSORS.md).
5. **Print the desk labels** from the dashboard (**Print desk labels**). The QR codes contain the permanent
   `https://` address.

## Day-to-day

| Task | Where |
|---|---|
| Is it up? | **ECS → Clusters → hotdesk-… → Services** (1/1 running), or open `/healthz` |
| Logs | **CloudWatch → Log groups → `/ecs/hotdesk`** |
| Restart | **ECS → service → Update service → Force new deployment** |
| Change settings (grace period, check-in length) | Edit the parameters in `deploy/aws/hotdesk.yml` and merge to `main` |
| Change the floor plan | Edit `config/building.json` and merge to `main` |
| Roll back | **Actions → Deploy to AWS** → open an older successful run → **Re-run all jobs** |
| Rotate the admin token | **Secrets Manager** → change the value, then force a new deployment |
| Restore desk state | **AWS Backup → Protected resources → the EFS file system** → restore |
| Restrict who can reach it | Set the `AllowedCidr` parameter (cloud LoRaWAN servers like TTN must still reach the webhooks) |

## Removing it

Delete the `hotdesk` stack, then `hotdesk-github-access`. The EFS file system and the two secrets are
**kept on purpose** so desk data and passwords aren't lost by accident. Delete them by hand if you're sure.

## Troubleshooting

- **The workflow says "Not deploying":** one of the variables in step 3 is missing.
- **"Not authorized to perform sts:AssumeRoleWithWebIdentity":** the job must run in the `production`
  environment, the repository name must match the `github-access` stack parameters, and the GitHub identity
  provider must exist in IAM.
- **The stack is stuck creating the certificate:** the DNS validation record isn't in place. With Route 53, check
  that `HOSTED_ZONE_ID` is the zone for `DOMAIN_NAME`.
- **The service keeps restarting:** open the CloudWatch logs. Under ECS → service → **Deployments and events**
  you'll see why tasks stopped (for example, an EFS mount error or failing health checks).
