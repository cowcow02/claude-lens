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
INSPECT_ONLY="${INSPECT_ONLY:-0}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-10}"
GRANT_STAFF_EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)        ASSUME_YES=1 ;;
    --inspect-only)  INSPECT_ONLY=1; ASSUME_YES=1 ;;
    --grant-staff)   shift; GRANT_STAFF_EMAIL="${1:-}"; [ -n "$GRANT_STAFF_EMAIL" ] || { echo "--grant-staff requires an email" >&2; exit 1; } ;;
    --grant-staff=*) GRANT_STAFF_EMAIL="${1#--grant-staff=}" ;;
  esac
  shift
done

# Bounded wait for gcloud probes. In preference order:
#   1. GNU coreutils `timeout` (Linux / Cloud Shell)
#   2. `gtimeout` (macOS with `brew install coreutils`)
#   3. `perl -e 'alarm N; exec ...'` — portable, present on every macOS and
#      Cloud Shell by default, replaces perl with gcloud via exec so command
#      substitution captures gcloud's stdout normally.
# Stdin is redirected from /dev/null so any interactive prompt (e.g.
# "install beta component?") fails fast instead of blocking.
if command -v timeout   >/dev/null; then TIMEOUT_KIND=timeout
elif command -v gtimeout >/dev/null; then TIMEOUT_KIND=gtimeout
elif command -v perl     >/dev/null; then TIMEOUT_KIND=perl
else TIMEOUT_KIND=none; fi

g() {
  case "$TIMEOUT_KIND" in
    timeout|gtimeout) "$TIMEOUT_KIND" "$PROBE_TIMEOUT" gcloud "$@" </dev/null ;;
    perl)             perl -e '$SIG{ALRM}=sub{exit 124}; alarm shift; exec @ARGV' "$PROBE_TIMEOUT" gcloud "$@" </dev/null ;;
    none)             gcloud "$@" </dev/null ;;
  esac
}

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

if [ -z "$GRANT_STAFF_EMAIL" ] && [ "$ASSUME_YES" != "1" ] && [ -t 0 ] && [ -r /dev/tty ]; then
  hdr "Pick your install targets (press Enter to keep the default)"
  PROJECT="$(prompt_default "Project"        "$PROJECT"       "any GCP project ID with billing linked")"
  REGION="$(prompt_default  "Region"         "$REGION"        "us-central1 · europe-west1 · asia-southeast1 · asia-east1")"
  DB_TIER="$(prompt_default "Cloud SQL tier" "$DB_TIER"       "db-f1-micro · db-g1-small · db-custom-1-3840")"
fi

[ -n "$PROJECT" ] || die "No project set. Run: gcloud config set project <id> (or pass PROJECT=<id>)."

#—— --grant-staff recovery flag ————————————————————————————————————
# Shell-access recovery path for sites that lose access to their sole staff
# account. Requires the Cloud SQL instance + fleetlens-db-password secret to
# already exist (i.e. a completed install). Pipes one UPDATE statement into
# psql via `gcloud sql connect`, then exits — the main install does NOT run.
if [ -n "$GRANT_STAFF_EMAIL" ]; then
  command -v psql >/dev/null || die "psql required for --grant-staff. Install postgresql-client (Cloud Shell has it)."
  hdr "Granting staff to $GRANT_STAFF_EMAIL"
  info "Project: $PROJECT · Instance: $DB_INSTANCE"
  DB_PASSWORD="$(gcloud secrets versions access latest --secret=fleetlens-db-password --project "$PROJECT" 2>/dev/null || true)"
  [ -n "$DB_PASSWORD" ] || die "Could not read fleetlens-db-password secret — has install.sh completed against this project?"
  # `gcloud sql connect` temporarily whitelists the caller's public IP and
  # execs psql. PGPASSWORD lets it run non-interactively.
  step "Running UPDATE user_accounts SET is_staff=true"
  PGPASSWORD="$DB_PASSWORD" gcloud sql connect "$DB_INSTANCE" \
    --user=fleetlens --database=fleetlens --project "$PROJECT" --quiet \
    <<SQL
UPDATE user_accounts SET is_staff = true WHERE email = '$GRANT_STAFF_EMAIL' RETURNING id, email;
SQL
  ok "Staff grant applied (row count above; 0 rows = no such email)"
  exit 0
fi

#—— Preflight inspection (READ ONLY) ————————————————————————————————
# Each probe prints a line the moment it starts and updates in place on
# completion. Without this the user stares at a silent header for 20–30s.
probe_start() { printf "  %s…%s %-46s" "$d" "$x" "$1"; }
probe_end()   { printf "\r  %s✓%s %-46s %s\n" "$g" "$x" "$1" "$2"; }
probe_fail()  { printf "\r  %s✗%s %-46s %s\n" "$r" "$x" "$1" "$2"; }

hdr "Preflight — inspecting environment (no changes yet)"
[ "$TIMEOUT_KIND" = "none" ] && warn "No timeout mechanism (timeout / gtimeout / perl) found — gcloud calls have no bounded wait."

probe_start "Resolving project number"
PROJECT_NUMBER="$(g projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null || true)"
if [ -z "$PROJECT_NUMBER" ]; then
  probe_fail "Resolving project number" "failed or timed out"
  die "Cannot access project '$PROJECT' as $ACCOUNT. Check: gcloud auth list / gcloud config set project <id>"
fi
probe_end "Resolving project number" "$PROJECT_NUMBER"

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

# The enabled-APIs probe does double duty: it tells us which APIs need
# enabling AND gives a reliable billing signal (any paid API being enabled
# means billing is linked). Replaces the old `gcloud beta billing` call,
# which could hang prompting to install the `beta` component.
probe_start "Listing enabled APIs (of 8 required)"
ENABLED_APIS="$(g services list --enabled --project "$PROJECT" --format='value(config.name)' 2>/dev/null || true)"
APIS_TO_ENABLE=()
for api in "${REQUIRED_APIS[@]}"; do
  grep -qx "$api" <<<"$ENABLED_APIS" || APIS_TO_ENABLE+=("$api")
done
ENABLED_COUNT=$((${#REQUIRED_APIS[@]} - ${#APIS_TO_ENABLE[@]}))
probe_end "Listing enabled APIs (of 8 required)" "$ENABLED_COUNT already on, ${#APIS_TO_ENABLE[@]} to enable"

probe_start "Checking billing status"
if grep -qE "^(run|sqladmin|cloudbuild)\.googleapis\.com$" <<<"$ENABLED_APIS"; then
  BILLING_OK="yes (inferred: paid API is enabled)"
else
  BILLING_OK="unknown — link billing at console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
fi
probe_end "Checking billing status" "$BILLING_OK"

# Derive final image path
IMAGE_TAG="${SOURCE_IMAGE##*:}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/team-server:$IMAGE_TAG"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

action_for() {
  g "$@" >/dev/null 2>&1 && echo "reuse" || echo "create"
}

probe_start "Probing Artifact Registry '$AR_REPO'"
AR_ACTION="$(action_for artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT")"
probe_end "Probing Artifact Registry '$AR_REPO'" "$AR_ACTION"

probe_start "Probing Cloud SQL '$DB_INSTANCE'"
SQL_ACTION="$(action_for sql instances describe "$DB_INSTANCE" --project "$PROJECT")"
probe_end "Probing Cloud SQL '$DB_INSTANCE'" "$SQL_ACTION"

probe_start "Probing Cloud Run '$SERVICE'"
RUN_ACTION="$(action_for run services describe "$SERVICE" --region "$REGION" --project "$PROJECT")"
probe_end "Probing Cloud Run '$SERVICE'" "$RUN_ACTION"

probe_start "Probing Cloud Scheduler 'fleetlens-prune'"
SCH_ACTION="$(action_for scheduler jobs describe fleetlens-prune --location "$REGION" --project "$PROJECT")"
probe_end "Probing Cloud Scheduler 'fleetlens-prune'" "$SCH_ACTION"

probe_start "Probing 4 Secret Manager entries"
SECRET_ACTIONS=()
SECRETS_EXIST=0
for secret in fleetlens-db-password fleetlens-encryption-key fleetlens-scheduler-secret fleetlens-database-url; do
  a="$(action_for secrets describe "$secret" --project "$PROJECT")"
  SECRET_ACTIONS+=("$secret=$a")
  [ "$a" = "reuse" ] && SECRETS_EXIST=$((SECRETS_EXIST+1))
done
probe_end "Probing 4 Secret Manager entries" "$SECRETS_EXIST exist, $((4 - SECRETS_EXIST)) to create"

#—— Summary banner ————————————————————————————————————————————————
# Numbered steps the installer will run. Each step shows 'create' or
# 'reuse'; reused resources include a console URL so the user can open
# the existing resource and see what we're skipping.
step_line()  { printf "  %s%-2d.%s  %s%-8s%s  %s\n" "$b" "$1" "$x" "$c" "$2" "$x" "$3"; }
step_sub()   { printf "          %s%s%s\n" "$d" "$1" "$x"; }

hdr "What this installer will do"

printf "%sTarget%s  %s · %s · %s\n" "$b" "$x" "$PROJECT" "$REGION" "$ACCOUNT"
printf "%sBilling%s %s\n" "$b" "$x" "$BILLING_OK"

printf "\n%sSteps%s\n" "$b" "$x"

#— 1: APIs
if [ ${#APIS_TO_ENABLE[@]} -eq 0 ]; then
  step_line 1 "skip" "Enable 8 GCP APIs  (all already enabled)"
else
  step_line 1 "enable" "Enable ${#APIS_TO_ENABLE[@]} of 8 GCP APIs:  $(IFS=, ; echo "${APIS_TO_ENABLE[*]}")"
fi

#— 2: Artifact Registry
if [ "$AR_ACTION" = "reuse" ]; then
  step_line 2 "reuse" "Artifact Registry repo '$AR_REPO'"
  step_sub  "https://console.cloud.google.com/artifacts/docker/$PROJECT/$REGION/$AR_REPO"
else
  step_line 2 "create" "Artifact Registry repo '$AR_REPO' in $REGION"
fi

#— 3: Docker image clone
step_line 3 "copy" "Clone Docker image $SOURCE_IMAGE → Artifact Registry"

#— 4: Cloud SQL
if [ "$SQL_ACTION" = "reuse" ]; then
  step_line 4 "reuse" "Cloud SQL Postgres '$DB_INSTANCE'"
  step_sub  "https://console.cloud.google.com/sql/instances/$DB_INSTANCE/overview?project=$PROJECT"
else
  step_line 4 "create" "Cloud SQL Postgres '$DB_INSTANCE'  ($DB_TIER · POSTGRES_15 · 10 GB SSD)"
fi

#— 5: Secrets
new_secrets=0; reused_secrets=0
for line in "${SECRET_ACTIONS[@]}"; do
  [ "${line##*=}" = "reuse" ] && reused_secrets=$((reused_secrets+1)) || new_secrets=$((new_secrets+1))
done
if [ "$new_secrets" -eq 0 ]; then
  step_line 5 "reuse" "4 Secret Manager entries  (db-password · encryption-key · scheduler-secret · database-url)"
  step_sub  "https://console.cloud.google.com/security/secret-manager?project=$PROJECT"
elif [ "$reused_secrets" -eq 0 ]; then
  step_line 5 "create" "4 Secret Manager entries  (db-password · encryption-key · scheduler-secret · database-url)"
else
  step_line 5 "mixed" "4 Secret Manager entries  ($reused_secrets existing · $new_secrets new)"
  step_sub  "https://console.cloud.google.com/security/secret-manager?project=$PROJECT"
fi

#— 6: DB user + database inside SQL
step_line 6 "set-up" "Database + user 'fleetlens' inside Cloud SQL"

#— 7: IAM
step_line 7 "grant" "IAM roles on $RUNTIME_SA"
step_sub  "roles/secretmanager.secretAccessor (3 secrets)  ·  roles/cloudsql.client (project scope)"
step_sub  "roles/run.developer (scoped to '$SERVICE' only — enables in-app self-update)"

#— 8: Cloud Run
if [ "$RUN_ACTION" = "reuse" ]; then
  step_line 8 "update" "Cloud Run service '$SERVICE'"
  step_sub  "env: NODE_ENV · FLEETLENS_EXTERNAL_SCHEDULER · GCP_PROJECT_ID · GCP_REGION"
  step_sub  "https://console.cloud.google.com/run/detail/$REGION/$SERVICE/metrics?project=$PROJECT"
else
  step_line 8 "create" "Cloud Run service '$SERVICE'  (1 vCPU · 512 MiB · min=0 max=3 · public HTTPS)"
  step_sub  "env: NODE_ENV · FLEETLENS_EXTERNAL_SCHEDULER · GCP_PROJECT_ID · GCP_REGION"
fi

#— 9: Scheduler
if [ "$SCH_ACTION" = "reuse" ]; then
  step_line 9 "update" "Cloud Scheduler job 'fleetlens-prune'"
  step_sub  "https://console.cloud.google.com/cloudscheduler?project=$PROJECT"
else
  step_line 9 "create" "Cloud Scheduler job 'fleetlens-prune'  (hourly → /api/admin/prune)"
fi

printf "\n%sCost%s  ~\$10/mo idle · ~\$25/mo active\n" "$b" "$x"
printf "%sTime%s  ~5–6 min fresh · ~1 min re-run\n" "$b" "$x"

# Hidden INSPECT_ONLY (also --inspect-only): run preflight + summary, stop
# here. Used when debugging preflight behavior from a non-TTY harness
# without risking any mutations.
if [ "$INSPECT_ONLY" = "1" ]; then
  printf "\n%sINSPECT_ONLY=1 — stopping here.%s No resources were created or modified.\n" "$y" "$x"
  exit 0
fi

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
  if ! docker pull --platform linux/amd64 "$SOURCE_IMAGE" --quiet 2>&1; then
    die "Could not pull $SOURCE_IMAGE. If the tag does not exist on GHCR yet (common right after a new release), pin a known-good sha:  SOURCE_IMAGE=ghcr.io/cowcow02/fleetlens-team-server:<sha> ./install.sh"
  fi
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
  --set-env-vars "NODE_ENV=production,FLEETLENS_EXTERNAL_SCHEDULER=1,GCP_PROJECT_ID=$PROJECT,GCP_REGION=$REGION" \
  --set-secrets "DATABASE_URL=fleetlens-database-url:latest,FLEETLENS_ENCRYPTION_KEY=fleetlens-encryption-key:latest,FLEETLENS_SCHEDULER_SECRET=fleetlens-scheduler-secret:latest" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
ok "Service live at $URL"

#—— 7b. Self-update IAM: resource-scoped run.developer ——————————————
# Lets the runtime SA call run.services.update on THIS service only (for the
# in-app "Apply update" button). Not project-wide. Idempotent: re-adding an
# existing binding is a no-op but gcloud exits non-zero on some edge cases,
# so guard with `|| true`.
step "Granting roles/run.developer on service (scoped, idempotent)"
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region "$REGION" \
  --member "serviceAccount:$RUNTIME_SA" \
  --role roles/run.developer \
  --project "$PROJECT" --quiet >/dev/null 2>&1 || true
ok "run.developer bound on $SERVICE"

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
