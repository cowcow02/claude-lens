# Fleetlens Team Edition on GCP — manual installation

This is the step-by-step equivalent of [`deploy/gcp/install.sh`](../deploy/gcp/install.sh). Use it if you want to understand each action, need to adapt the flow to your org's constraints, or prefer not to run a bash installer against your project.

Running every command in sequence yields the same end state: a Cloud Run service publicly serving the Team Edition UI, a Cloud SQL Postgres backend, secrets in Secret Manager, and a Cloud Scheduler cron for the hourly prune. **Wall time end-to-end: ~5–6 minutes**, dominated by Cloud SQL provisioning.

---

## 0. Prerequisites

- A GCP project with **billing enabled** (Cloud SQL has no free tier).
- `gcloud` ≥ 500 — either [Cloud Shell](https://shell.cloud.google.com) (always current) or locally installed and updated with `gcloud components update`.
- `docker` on the machine running these commands. Cloud Shell has it preinstalled.
- `openssl` for secret generation. Available on Cloud Shell and every Unix.

Set your working context:

```bash
export PROJECT=<your-project-id>
export REGION=asia-southeast1   # or us-central1, europe-west1, etc.
gcloud config set project "$PROJECT"
gcloud config set run/region "$REGION"
```

Verify you're where you think you are:

```bash
gcloud config list
gcloud auth list
```

---

## 1. Enable the required APIs

Eight APIs. First enable takes ~30–60 seconds; already-enabled ones are idempotent no-ops.

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --project "$PROJECT"
```

| API | Why |
|---|---|
| `run` | Cloud Run service |
| `sqladmin` | Manage Cloud SQL instances |
| `sql-component` | Required for Cloud Run ↔ Cloud SQL socket binding. Without this, `gcloud run deploy` fails with a cryptic "Aborted by user" when `--quiet` is set |
| `secretmanager` | Store DB password + encryption key |
| `cloudscheduler` | Trigger `/api/admin/prune` hourly |
| `artifactregistry` | Host the container image |
| `iam` + `iamcredentials` | Grant the Cloud Run runtime SA permissions |

---

## 2. Artifact Registry repo + image copy

Cloud Run only pulls images from `gcr.io`, `*-docker.pkg.dev`, or `docker.io`. Our public image on GHCR needs to be copied into a regional Artifact Registry repo owned by your project.

Create the repo:

```bash
gcloud artifacts repositories create fleetlens \
  --repository-format=docker \
  --location "$REGION" \
  --description="Fleetlens Team Edition container images" \
  --project "$PROJECT"
```

Copy the image (first pull from GHCR, then push to AR):

```bash
SOURCE_IMAGE=ghcr.io/cowcow02/fleetlens-team-server:latest
IMAGE="$REGION-docker.pkg.dev/$PROJECT/fleetlens/team-server:latest"

gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

docker pull --platform linux/amd64 "$SOURCE_IMAGE"
docker tag "$SOURCE_IMAGE" "$IMAGE"
docker push "$IMAGE"
```

The image is ~150 MB. Copy takes ~30–60 seconds.

> **Alternative for gcloud ≥ 472:** `gcloud artifacts docker images copy "$SOURCE_IMAGE" "$IMAGE"` does the same server-side without a local docker daemon.

---

## 3. Cloud SQL Postgres instance

**This is the slow step — ~4 minutes.** Start it early; subsequent steps can run in parallel while this provisions if you're willing to switch terminals.

```bash
gcloud sql instances create fleetlens-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-type=SSD \
  --storage-size=10GB \
  --project "$PROJECT"
```

Capture the connection name for later:

```bash
CONN_NAME="$(gcloud sql instances describe fleetlens-db --project "$PROJECT" --format='value(connectionName)')"
echo "$CONN_NAME"
# Expected format: <project>:<region>:fleetlens-db
```

### Production tier note

`db-f1-micro` is ~$7.50/mo and fine for a team of 5–20 engineers. For production workloads, bump to `db-custom-1-3840` (1 vCPU, 3.75 GB RAM, ~$25/mo) or `db-custom-2-7680` for real scale.

---

## 4. Generate secrets

Three random values + a composed DATABASE_URL. Generate once, store in Secret Manager.

```bash
DB_PASSWORD="$(openssl rand -hex 24)"
ENC_KEY="$(openssl rand -hex 32)"
SCHED_SECRET="$(openssl rand -hex 32)"
DATABASE_URL="postgresql://fleetlens:$DB_PASSWORD@localhost/fleetlens?host=/cloudsql/$CONN_NAME"

printf '%s' "$DB_PASSWORD"    | gcloud secrets create fleetlens-db-password       --data-file=- --project "$PROJECT"
printf '%s' "$ENC_KEY"        | gcloud secrets create fleetlens-encryption-key    --data-file=- --project "$PROJECT"
printf '%s' "$SCHED_SECRET"   | gcloud secrets create fleetlens-scheduler-secret  --data-file=- --project "$PROJECT"
printf '%s' "$DATABASE_URL"   | gcloud secrets create fleetlens-database-url      --data-file=- --project "$PROJECT"
```

Why the `DATABASE_URL` format? The `?host=/cloudsql/<conn>` query parameter tells `pg` to connect over a Unix socket instead of TCP. Cloud Run auto-mounts the socket at `/cloudsql/<conn>` when you set `--add-cloudsql-instances` on the service.

---

## 5. Create the Postgres user + database

```bash
gcloud sql users create fleetlens \
  --instance=fleetlens-db \
  --password="$DB_PASSWORD" \
  --project "$PROJECT"

gcloud sql databases create fleetlens \
  --instance=fleetlens-db \
  --project "$PROJECT"
```

---

## 6. Grant IAM to the Cloud Run runtime service account

Cloud Run services run as the project's default compute SA unless overridden. Grant that SA the rights it needs.

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in fleetlens-database-url fleetlens-encryption-key fleetlens-scheduler-secret; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/secretmanager.secretAccessor \
    --project "$PROJECT"
done

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role=roles/cloudsql.client \
  --condition=None
```

If your org policy disables the default compute SA, create a dedicated SA (e.g., `fleetlens-run@<project>.iam.gserviceaccount.com`), grant it these roles, and pass `--service-account` to `gcloud run deploy` in the next step.

---

## 7. Deploy Cloud Run service

```bash
gcloud run deploy fleetlens-team-server \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --allow-unauthenticated \
  --port 3322 \
  --min-instances 0 \
  --max-instances 3 \
  --cpu 1 --memory 512Mi \
  --add-cloudsql-instances "$CONN_NAME" \
  --set-env-vars "NODE_ENV=production,FLEETLENS_EXTERNAL_SCHEDULER=1" \
  --set-secrets "DATABASE_URL=fleetlens-database-url:latest,FLEETLENS_ENCRYPTION_KEY=fleetlens-encryption-key:latest,FLEETLENS_SCHEDULER_SECRET=fleetlens-scheduler-secret:latest"
```

| Flag | Why |
|---|---|
| `--allow-unauthenticated` | The UI is public; signup and CLI ingest require HTTPS reachability |
| `--port 3322` | Matches the Dockerfile `EXPOSE`; Next.js standalone reads `PORT` from env |
| `--min-instances 0` | Scales to zero after ~15 min idle. Set to 1 for ~$5–10/mo to avoid cold starts |
| `--add-cloudsql-instances` | Mounts the Cloud SQL socket at `/cloudsql/<conn>` inside the container |
| `FLEETLENS_EXTERNAL_SCHEDULER=1` | Disables the in-process `setInterval` (Cloud Run terminates idle instances; timers can't fire reliably). Cloud Scheduler handles the prune instead |
| `--set-secrets` | Mounts Secret Manager values as env vars at runtime |

Capture the URL:

```bash
URL="$(gcloud run services describe fleetlens-team-server --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo "$URL"
```

First boot runs the migrations (`runMigrations()` in `packages/team-server/src/instrumentation.ts`); the schema is CREATE-IF-NOT-EXISTS so re-deploys are idempotent.

---

## 8. Cloud Scheduler — hourly prune

```bash
gcloud scheduler jobs create http fleetlens-prune \
  --location "$REGION" \
  --project "$PROJECT" \
  --schedule="0 * * * *" \
  --uri "$URL/api/admin/prune" \
  --http-method POST \
  --headers "x-scheduler-secret=$SCHED_SECRET"
```

The `/api/admin/prune` endpoint requires the `x-scheduler-secret` header to match the `FLEETLENS_SCHEDULER_SECRET` env var the Cloud Run service reads from Secret Manager. Requests without a valid secret get 401.

---

## 9. Verify

```bash
curl -s "$URL/api/auth/preflight"
# Expect: {"isFirstUser":true,"allowPublicSignup":false}
```

Then open `$URL/signup` in a browser. Fill email, password, name, team name. The "You're in" screen gives a `fleetlens team join …` command for pairing your local CLI.

---

## 10. Tearing it down

`gcloud` ≥ 500 is required — the older versions hit a `finalBackup` config mismatch on the Cloud SQL delete. Cloud Shell is always fine.

```bash
gcloud run services delete fleetlens-team-server --region "$REGION" --quiet
gcloud sql instances delete fleetlens-db --quiet
gcloud scheduler jobs delete fleetlens-prune --location "$REGION" --quiet
gcloud artifacts repositories delete fleetlens --location "$REGION" --quiet
for s in fleetlens-database-url fleetlens-encryption-key fleetlens-scheduler-secret fleetlens-db-password; do
  gcloud secrets delete "$s" --quiet
done
```

---

## Architecture and design decisions

See [`deploy/gcp/README.md`](../deploy/gcp/README.md) for why this stack looks the way it does — in particular the choice of Cloud Run + Cloud SQL + Secret Manager + Cloud Scheduler, and what was changed in the team-server code to run correctly on Cloud Run's scale-to-zero model.
