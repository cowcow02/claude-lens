#!/usr/bin/env bash
# Fleetlens Team Edition — one-shot GCP installer.
#
# Provisions Cloud SQL (Postgres) + Cloud Run + Secret Manager + Cloud
# Scheduler, wires them together, and prints the public URL.
#
# Idempotent: safe to re-run. Existing resources are detected and reused.

set -euo pipefail

#—— Configurable via flags / env vars ——————————————————————————————
REGION="${REGION:-$(gcloud config get-value run/region 2>/dev/null || echo us-central1)}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
SOURCE_IMAGE="${SOURCE_IMAGE:-ghcr.io/cowcow02/fleetlens-team-server:latest}"
DB_TIER="${DB_TIER:-db-f1-micro}"
DB_INSTANCE="${DB_INSTANCE:-fleetlens-db}"
SERVICE="${SERVICE:-fleetlens-team-server}"
AR_REPO="${AR_REPO:-fleetlens}"

#—— tiny logger ———————————————————————————————————————————————————
b=$'\033[1m'; g=$'\033[32m'; y=$'\033[33m'; r=$'\033[31m'; x=$'\033[0m'
step() { printf "\n%s▶ %s%s\n" "$b" "$1" "$x"; }
ok()   { printf "%s✓%s %s\n" "$g" "$x" "$1"; }
warn() { printf "%s!%s %s\n" "$y" "$x" "$1"; }
die()  { printf "%s✗%s %s\n" "$r" "$x" "$1" >&2; exit 1; }

#—— Preflight ——————————————————————————————————————————————————————
command -v gcloud >/dev/null || die "gcloud CLI not found. Use Cloud Shell or install https://cloud.google.com/sdk."
command -v openssl >/dev/null || die "openssl required for secret generation."

[ -n "$PROJECT" ] || die "No project set. Run: gcloud config set project <id> (or pass PROJECT=<id>)."

step "Fleetlens Team Edition — deploying to project ${b}${PROJECT}${x} in ${b}${REGION}${x}"
echo "   Cloud SQL tier: $DB_TIER    Source image: $SOURCE_IMAGE"

if ! gcloud beta billing projects describe "$PROJECT" --format="value(billingEnabled)" 2>/dev/null | grep -q True; then
  # `beta` may not be installed; fall back to a permission-based probe.
  if ! gcloud services list --project "$PROJECT" --filter name=cloudbilling --enabled >/dev/null 2>&1; then
    warn "Could not verify billing. If the next step errors with BILLING_DISABLED, link a billing account:"
    warn "    https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  fi
fi

#—— 1. Enable APIs ———————————————————————————————————————————————
step "Enabling required APIs (idempotent)"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --project "$PROJECT" --quiet
ok "APIs enabled"

#—— 1b. Artifact Registry repo + image copy ————————————————————————
# Cloud Run cannot pull directly from ghcr.io (only gcr.io, docker.pkg.dev,
# docker.io). We server-side-copy the public GHCR image into a regional
# Artifact Registry repo owned by this project on first install.
step "Artifact Registry ($AR_REPO in $REGION)"
if gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  ok "Repository exists — reusing"
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location "$REGION" \
    --description="Fleetlens Team Edition container images" \
    --project "$PROJECT" --quiet
  ok "Repository created"
fi

# Derive the destination tag from the source tag
IMAGE_TAG="${SOURCE_IMAGE##*:}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/team-server:$IMAGE_TAG"

step "Copying image $SOURCE_IMAGE → $IMAGE"
if gcloud artifacts docker images describe "$IMAGE" --project "$PROJECT" >/dev/null 2>&1; then
  ok "Image already present in Artifact Registry — reusing"
else
  command -v docker >/dev/null || die "docker required to copy image. Cloud Shell has it preinstalled."
  gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
  docker pull --platform linux/amd64 "$SOURCE_IMAGE" --quiet
  docker tag "$SOURCE_IMAGE" "$IMAGE"
  docker push --quiet "$IMAGE"
  ok "Image copied"
fi

#—— 2. Cloud SQL instance + DB ——————————————————————————————————————
step "Cloud SQL Postgres ($DB_INSTANCE, tier=$DB_TIER, region=$REGION)"
if gcloud sql instances describe "$DB_INSTANCE" --project "$PROJECT" >/dev/null 2>&1; then
  ok "Instance exists — reusing"
else
  warn "Creating new instance — this is the slow step (~4 min)"
  gcloud sql instances create "$DB_INSTANCE" \
    --database-version=POSTGRES_15 \
    --tier="$DB_TIER" \
    --region="$REGION" \
    --storage-type=SSD \
    --storage-size=10GB \
    --project "$PROJECT" --quiet
  ok "Instance created"
fi

CONN_NAME="$(gcloud sql instances describe "$DB_INSTANCE" --project "$PROJECT" --format='value(connectionName)')"

#—— 3. Generate / load secrets ————————————————————————————————————
step "Secrets (generate on first run, reuse on re-run)"

ensure_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    ok "Secret $name exists — reusing"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --project "$PROJECT" --quiet
    ok "Secret $name created"
  fi
}

DB_PASSWORD="$(openssl rand -hex 24)"
ENC_KEY="$(openssl rand -hex 32)"
SCHED_SECRET="$(openssl rand -hex 32)"

ensure_secret "fleetlens-db-password"       "$DB_PASSWORD"
ensure_secret "fleetlens-encryption-key"    "$ENC_KEY"
ensure_secret "fleetlens-scheduler-secret"  "$SCHED_SECRET"

# If secrets already existed, read them back so DATABASE_URL uses the correct password.
DB_PASSWORD="$(gcloud secrets versions access latest --secret=fleetlens-db-password --project "$PROJECT")"
SCHED_SECRET="$(gcloud secrets versions access latest --secret=fleetlens-scheduler-secret --project "$PROJECT")"

DATABASE_URL="postgresql://fleetlens:$DB_PASSWORD@localhost/fleetlens?host=/cloudsql/$CONN_NAME"
ensure_secret "fleetlens-database-url" "$DATABASE_URL"

#—— 4. DB user + database ——————————————————————————————————————————
step "Database + user inside Cloud SQL"
if gcloud sql users list --instance="$DB_INSTANCE" --project "$PROJECT" --format='value(name)' | grep -qx fleetlens; then
  ok "User fleetlens exists — updating password"
  gcloud sql users set-password fleetlens --instance="$DB_INSTANCE" --password="$DB_PASSWORD" --project "$PROJECT" --quiet
else
  gcloud sql users create fleetlens --instance="$DB_INSTANCE" --password="$DB_PASSWORD" --project "$PROJECT" --quiet
  ok "User fleetlens created"
fi

if gcloud sql databases list --instance="$DB_INSTANCE" --project "$PROJECT" --format='value(name)' | grep -qx fleetlens; then
  ok "Database fleetlens exists — reusing"
else
  gcloud sql databases create fleetlens --instance="$DB_INSTANCE" --project "$PROJECT" --quiet
  ok "Database fleetlens created"
fi

#—— 5. IAM: Cloud Run runtime SA gets secret + cloudsql access ————————
step "IAM bindings"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in fleetlens-database-url fleetlens-encryption-key fleetlens-scheduler-secret; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role=roles/secretmanager.secretAccessor \
    --project "$PROJECT" --quiet >/dev/null
done
ok "Runtime SA can read secrets"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$RUNTIME_SA" \
  --role=roles/cloudsql.client --condition=None --quiet >/dev/null
ok "Runtime SA can connect to Cloud SQL"

#—— 6. Deploy Cloud Run service ————————————————————————————————————
step "Cloud Run deploy"
gcloud run deploy "$SERVICE" \
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
  --set-secrets "DATABASE_URL=fleetlens-database-url:latest,FLEETLENS_ENCRYPTION_KEY=fleetlens-encryption-key:latest,FLEETLENS_SCHEDULER_SECRET=fleetlens-scheduler-secret:latest" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
ok "Service live at $URL"

#—— 7. Cloud Scheduler — hourly prune ———————————————————————————————
step "Cloud Scheduler job (hourly ingest_log prune)"
if gcloud scheduler jobs describe fleetlens-prune --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud scheduler jobs update http fleetlens-prune \
    --location "$REGION" \
    --project "$PROJECT" \
    --schedule="0 * * * *" \
    --uri "$URL/api/admin/prune" \
    --http-method POST \
    --update-headers "x-scheduler-secret=$SCHED_SECRET" \
    --quiet
  ok "Scheduler job updated"
else
  gcloud scheduler jobs create http fleetlens-prune \
    --location "$REGION" \
    --project "$PROJECT" \
    --schedule="0 * * * *" \
    --uri "$URL/api/admin/prune" \
    --http-method POST \
    --headers "x-scheduler-secret=$SCHED_SECRET" \
    --quiet
  ok "Scheduler job created"
fi

#—— Done ——————————————————————————————————————————————————————————
printf "\n%s━━━ Fleetlens Team Edition is live ━━━%s\n\n" "$g" "$x"
printf "  %sURL:%s        %s\n" "$b" "$x" "$URL"
printf "  %sSignup:%s     %s/signup\n" "$b" "$x" "$URL"
printf "  %sPair CLI:%s   fleetlens team join %s <device-token>\n" "$b" "$x" "$URL"
printf "\nThe first account to sign up becomes team #1's admin.\n\n"
