# Deploy Fleetlens Team Edition to Google Cloud

Zero-config installer. Provisions Cloud Run + Cloud SQL + Secret Manager + Cloud Scheduler and prints the public URL. ~5 minutes total.

## Prerequisites

<walkthrough-billing-setup></walkthrough-billing-setup>

A GCP project with **billing linked**. Cloud SQL has no free tier — expect ~$10–25/mo depending on usage.

## Step 1 — Pick your project

```bash
gcloud config set project <your-project-id>
gcloud config set run/region asia-southeast1   # or us-central1, europe-west1…
```

## Step 2 — Run the installer

```bash
./install.sh
```

That's it. The script:

1. Enables required APIs (Cloud Run, Cloud SQL Admin, Secret Manager, Cloud Scheduler, IAM)
2. Creates a Cloud SQL Postgres instance (`fleetlens-db`, ~4 min — the bottleneck)
3. Generates random DB password + encryption key + scheduler secret into Secret Manager
4. Creates the `fleetlens` database and user
5. Grants the Cloud Run runtime service account access to secrets + Cloud SQL
6. Deploys `ghcr.io/cowcow02/fleetlens-team-server:latest` to Cloud Run, wired to Cloud SQL via Unix socket
7. Creates a Cloud Scheduler job that hits `/api/admin/prune` every hour

At the end you'll see:

```
━━━ Fleetlens Team Edition is live ━━━

  URL:        https://fleetlens-team-server-xxxxx-as.a.run.app
  Signup:     https://.../signup
  Pair CLI:   fleetlens team join https://... <device-token>
```

## Step 3 — Create the first admin

Open the `Signup` URL. Fill in email, password, team name. The first account created is automatically the admin.

On the "You're in" screen, copy the `fleetlens team join …` command and run it on your laptop:

```bash
fleetlens team join https://<your-url> bt_<device-token>
fleetlens team sync
```

You'll see the full 30-day backfill land on the roster instantly.

## Configuration knobs

All optional env overrides for `install.sh`:

| Variable | Default | Purpose |
|---|---|---|
| `PROJECT` | `gcloud config get-value project` | Target GCP project |
| `REGION` | `gcloud config get-value run/region` | Cloud Run + Cloud SQL region |
| `IMAGE` | `ghcr.io/cowcow02/fleetlens-team-server:latest` | Container image to deploy |
| `DB_TIER` | `db-f1-micro` | Cloud SQL machine size — bump to `db-custom-1-3840` for production |
| `DB_INSTANCE` | `fleetlens-db` | Cloud SQL instance name |
| `SERVICE` | `fleetlens-team-server` | Cloud Run service name |

## What's different from Railway

- **Cloud Run has request-based CPU by default.** `setInterval` timers don't run reliably between requests, so the in-container scheduler is disabled (`FLEETLENS_EXTERNAL_SCHEDULER=1`) and Cloud Scheduler handles the hourly prune.
- **DB connection uses Unix sockets**, not TCP. Cloud Run auto-mounts `/cloudsql/<connection>` when `--add-cloudsql-instances` is set. The `pg` driver talks to it via `?host=/cloudsql/<connection>`.
- **No always-on CPU.** The service scales to zero after a few minutes of idle. First request after idle is ~1–3s cold start. If this bothers you, set `--min-instances 1` in the `gcloud run deploy` step (~$5–10/mo).

## Tearing it down

```bash
gcloud run services delete fleetlens-team-server --region $REGION --quiet
gcloud sql instances delete fleetlens-db --quiet
gcloud scheduler jobs delete fleetlens-prune --location $REGION --quiet
for s in fleetlens-database-url fleetlens-encryption-key fleetlens-scheduler-secret fleetlens-db-password; do
  gcloud secrets delete $s --quiet
done
```
