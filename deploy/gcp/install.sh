#!/usr/bin/env bash
# Fleetlens Team Edition — one-shot GCP installer.
#
# Provisions Cloud SQL (Postgres) + Cloud Run + Secret Manager + Cloud
# Scheduler, wires them together, and prints the public URL.
#
# Two-phase flow:
#   1. Preflight — read-only. Inspects your environment and prints a
#      summary of everything this script WOULD create or modify.
#   2. Execute  — runs only after you confirm with 'y'.
#
# Idempotent: safe to re-run. Existing resources are detected and reused.
# Skip the prompt with --yes or ASSUME_YES=1 (useful in CI).

set -euo pipefail

#—— Configurable via flags / env vars ——————————————————————————————
REGION="${REGION:-$(gcloud config get-value run/region 2>/dev/null || echo us-central1)}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
SOURCE_IMAGE="${SOURCE_IMAGE:-ghcr.io/cowcow02/fleetlens-team-server:latest}"
DB_TIER="${DB_TIER:-db-f1-micro}"
DB_INSTANCE="${DB_INSTANCE:-fleetlens-db}"
SERVICE="${SERVICE:-fleetlens-team-server}"
AR_REPO="${AR_REPO:-fleetlens}"
ASSUME_YES="${ASSUME_YES:-0}"
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

#—— tiny logger ———————————————————————————————————————————————————
b=$'\033[1m'; d=$'\033[2m'; g=$'\033[32m'; y=$'\033[33m'; r=$'\033[31m'; c=$'\033[36m'; x=$'\033[0m'
hdr()  { printf "\n%s━━━ %s ━━━%s\n" "$b" "$1" "$x"; }
step() { printf "\n%s▶ %s%s\n" "$b" "$1" "$x"; }
ok()   { printf "%s✓%s %s\n" "$g" "$x" "$1"; }
info() { printf "  %s%s%s\n" "$d" "$1" "$x"; }
warn() { printf "%s!%s %s\n" "$y" "$x" "$1"; }
die()  { printf "%s✗%s %s\n" "$r" "$x" "$1" >&2; exit 1; }
plan() { printf "  %s%-12s%s %s\n" "$c" "$1" "$x" "$2"; }

#—— Tooling ————————————————————————————————————————————————————————
command -v gcloud  >/dev/null || die "gcloud CLI not found. Use Cloud Shell or install https://cloud.google.com/sdk."
command -v openssl >/dev/null || die "openssl required for secret generation."
command -v docker  >/dev/null || die "docker required to copy image from GHCR to Artifact Registry. Cloud Shell has it preinstalled."

ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[ -n "$ACCOUNT" ] || die "No active gcloud account. Run: gcloud auth login"

#—— Interactive edit (skipped in non-TTY or ASSUME_YES=1) ——————————
# Defaults come from env vars or gcloud config. Three most-edited fields
# get a type-with-default prompt; everything else is env-var-only.
prompt_default() {
  local label="$1" current="$2" hint="${3:-}" input=""
  local line="$label [$current]"
  [ -n "$hint" ] && line="$line $d($hint)$x"
  line="$line: "
  printf "%s" "$line" >/dev/tty
  IFS= read -r input </dev/tty || input=""
  printf '%s' "${input:-$current}"
}

if [ "$ASSUME_YES" != "1" ] && [ -t 0 ] && [ -r /dev/tty ]; then
  hdr "Pick your install targets (press Enter to keep the default)"
  PROJECT="$(prompt_default "Project"        "$PROJECT"       "any GCP project ID with billing linked")"
  REGION="$(prompt_default  "Region"         "$REGION"        "us-central1 · europe-west1 · asia-southeast1 · asia-east1")"
  DB_TIER="$(prompt_default "Cloud SQL tier" "$DB_TIER"       "db-f1-micro · db-g1-small · db-custom-1-3840")"
fi

[ -n "$PROJECT" ] || die "No project set. Run: gcloud config set project <id> (or pass PROJECT=<id>)."

#—— Preflight inspection (READ ONLY) ————————————————————————————————
hdr "Preflight — inspecting environment (no changes yet)"

# Verify the project exists and we can describe it (implicitly checks auth)
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || true)"
[ -n "$PROJECT_NUMBER" ] || die "Cannot access project '$PROJECT' as $ACCOUNT. Check gcloud auth list / gcloud config set project."

# Billing status — non-fatal probe. If the 'beta' component isn't installed,
# we fall back to a heuristic (if any paid API is enabled, billing is linked).
BILLING_OK="unknown"
if gcloud beta billing projects describe "$PROJECT" --format="value(billingEnabled)" 2>/dev/null | grep -q True; then
  BILLING_OK="yes"
elif gcloud services list --enabled --project "$PROJECT" --filter="name:run.googleapis.com OR name:cloudbuild.googleapis.com" --format="value(name)" 2>/dev/null | grep -q .; then
  BILLING_OK="yes (inferred from enabled APIs)"
fi

# Derive final image path
IMAGE_TAG="${SOURCE_IMAGE##*:}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/team-server:$IMAGE_TAG"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Check which APIs need enabling
REQUIRED_APIS=(
  run.googleapis.com
  sqladmin.googleapis.com
  sql-component.googleapis.com
  secretmanager.googleapis.com
  cloudscheduler.googleapis.com
  artifactregistry.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
)
ENABLED_APIS="$(gcloud services list --enabled --project "$PROJECT" --format='value(config.name)' 2>/dev/null || true)"
APIS_TO_ENABLE=()
for api in "${REQUIRED_APIS[@]}"; do
  grep -qx "$api" <<<"$ENABLED_APIS" || APIS_TO_ENABLE+=("$api")
done

# Check which resources already exist
action_for() {
  gcloud "$@" >/dev/null 2>&1 && echo "reuse" || echo "create"
}
AR_ACTION="$(action_for artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT")"
SQL_ACTION="$(action_for sql instances describe "$DB_INSTANCE" --project "$PROJECT")"
RUN_ACTION="$(action_for run services describe "$SERVICE" --region "$REGION" --project "$PROJECT")"
SCH_ACTION="$(action_for scheduler jobs describe fleetlens-prune --location "$REGION" --project "$PROJECT")"

SECRET_ACTIONS=()
for secret in fleetlens-db-password fleetlens-encryption-key fleetlens-scheduler-secret fleetlens-database-url; do
  SECRET_ACTIONS+=("$secret=$(action_for secrets describe "$secret" --project "$PROJECT")")
done

#—— Summary banner ————————————————————————————————————————————————
hdr "What this installer will do"

printf "%sEnvironment%s\n" "$b" "$x"
plan "Account"  "$ACCOUNT"
plan "Project"  "$PROJECT  (number $PROJECT_NUMBER)"
plan "Region"   "$REGION"
plan "Billing"  "$BILLING_OK"
plan "Image"    "$SOURCE_IMAGE"

printf "\n%sGCP APIs%s\n" "$b" "$x"
if [ ${#APIS_TO_ENABLE[@]} -eq 0 ]; then
  info "All 8 required APIs are already enabled."
else
  info "${#APIS_TO_ENABLE[@]} of 8 required APIs need enabling:"
  for api in "${APIS_TO_ENABLE[@]}"; do plan "  enable" "$api"; done
  for api in "${REQUIRED_APIS[@]}"; do
    grep -qx "$api" <<<"$ENABLED_APIS" && plan "  already-on" "$api"
  done
fi

printf "\n%sResources%s\n" "$b" "$x"
plan "$AR_ACTION"   "Artifact Registry repo '$AR_REPO' in $REGION"
plan "copy"         "Image  $SOURCE_IMAGE  →  $IMAGE"
plan "$SQL_ACTION"  "Cloud SQL instance '$DB_INSTANCE' ($DB_TIER, POSTGRES_15, 10 GB SSD)"
for line in "${SECRET_ACTIONS[@]}"; do plan "${line##*=}" "Secret Manager: ${line%%=*}"; done
plan "$RUN_ACTION"  "Cloud Run service '$SERVICE' (1 vCPU / 512 MiB, min=0 max=3, public HTTPS)"
plan "$SCH_ACTION"  "Cloud Scheduler job 'fleetlens-prune' (hourly → /api/admin/prune)"

printf "\n%sIAM changes on %s%s\n" "$b" "$RUNTIME_SA" "$x"
info "roles/secretmanager.secretAccessor on 3 secrets"
info "roles/cloudsql.client at project scope"

printf "\n%sCost + time estimate%s\n" "$b" "$x"
info "~\$10/mo idle (Cloud SQL db-f1-micro is the floor at \$7.50)"
info "~\$25/mo under moderate usage"
info "~5–6 min wall time for a fresh install; ~1 min on re-run"

printf "\n%sTo undo everything later:%s see deploy/gcp/TUTORIAL.md 'Tearing it down'.\n" "$b" "$x"

#—— Confirmation ——————————————————————————————————————————————————
if [ "$ASSUME_YES" = "1" ]; then
  printf "\n%sProceed (ASSUME_YES=1, skipping prompt)...%s\n" "$y" "$x"
else
  printf "\n%sProceed?%s [y/N] " "$b" "$x"
  read -r REPLY </dev/tty || die "No controlling TTY — re-run with ASSUME_YES=1 or --yes"
  [[ "$REPLY" =~ ^[Yy]$ ]] || die "Aborted."
fi

#—— Execution ——————————————————————————————————————————————————————
hdr "Executing"

#—— 1. Enable APIs ———————————————————————————————————————————————
step "Enabling required APIs (idempotent)"
gcloud services enable "${REQUIRED_APIS[@]}" --project "$PROJECT" --quiet
ok "APIs enabled"

#—— 2. Artifact Registry + image copy —————————————————————————————
step "Artifact Registry repo '$AR_REPO' in $REGION"
if [ "$AR_ACTION" = "reuse" ]; then
  ok "Repository exists — reusing"
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location "$REGION" \
    --description="Fleetlens Team Edition container images" \
    --project "$PROJECT" --quiet
  ok "Repository created"
fi

step "Copying image $SOURCE_IMAGE → $IMAGE"
if gcloud artifacts docker images describe "$IMAGE" --project "$PROJECT" >/dev/null 2>&1; then
  ok "Image already present in Artifact Registry — reusing"
else
  gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
  docker pull --platform linux/amd64 "$SOURCE_IMAGE" --quiet
  docker tag "$SOURCE_IMAGE" "$IMAGE"
  docker push --quiet "$IMAGE"
  ok "Image copied"
fi

#—— 3. Cloud SQL instance + DB ——————————————————————————————————————
step "Cloud SQL Postgres ($DB_INSTANCE, tier=$DB_TIER)"
if [ "$SQL_ACTION" = "reuse" ]; then
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

#—— 4. Generate / load secrets ————————————————————————————————————
step "Secrets"

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

DB_PASSWORD="$(gcloud secrets versions access latest --secret=fleetlens-db-password --project "$PROJECT")"
SCHED_SECRET="$(gcloud secrets versions access latest --secret=fleetlens-scheduler-secret --project "$PROJECT")"

DATABASE_URL="postgresql://fleetlens:$DB_PASSWORD@localhost/fleetlens?host=/cloudsql/$CONN_NAME"
ensure_secret "fleetlens-database-url" "$DATABASE_URL"

#—— 5. DB user + database ————————————————————————————————————————
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

#—— 6. IAM bindings —————————————————————————————————————————————————
step "IAM bindings on $RUNTIME_SA"

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

#—— 7. Deploy Cloud Run ——————————————————————————————————————————————
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

#—— 8. Cloud Scheduler ———————————————————————————————————————————————
step "Cloud Scheduler job (hourly ingest_log prune)"
if [ "$SCH_ACTION" = "reuse" ]; then
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
hdr "Fleetlens Team Edition is live"
printf "  %sURL:%s        %s\n" "$b" "$x" "$URL"
printf "  %sSignup:%s     %s/signup\n" "$b" "$x" "$URL"
printf "  %sPair CLI:%s   fleetlens team join %s <device-token>\n" "$b" "$x" "$URL"
printf "\nThe first account to sign up becomes team #1's admin.\n"
printf "Teardown commands: see deploy/gcp/TUTORIAL.md\n\n"
