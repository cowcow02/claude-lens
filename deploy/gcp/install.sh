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
for arg in "$@"; do
  case "$arg" in
    --yes|-y)       ASSUME_YES=1 ;;
    --inspect-only) INSPECT_ONLY=1; ASSUME_YES=1 ;;
  esac
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

if [ "$ASSUME_YES" != "1" ] && [ -t 0 ] && [ -r /dev/tty ]; then
  hdr "Pick your install targets (press Enter to keep the default)"
  PROJECT="$(prompt_default "Project"        "$PROJECT"       "any GCP project ID with billing linked")"
  REGION="$(prompt_default  "Region"         "$REGION"        "us-central1 · europe-west1 · asia-southeast1 · asia-east1")"
  DB_TIER="$(prompt_default "Cloud SQL tier" "$DB_TIER"       "db-f1-micro · db-g1-small · db-custom-1-3840")"
fi

[ -n "$PROJECT" ] || die "No project set. Run: gcloud config set project <id> (or pass PROJECT=<id>)."

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
# Every line explains the installer's CHOICE — not what the GCP primitive
# is. Reader is assumed GCP-literate; they want to know "why this specific
# tier / scope / shape, and what can I override?".
why() { printf "                 %s↳ %s%s\n" "$d" "$1" "$x"; }

hdr "What this installer will do"

printf "%sEnvironment%s\n" "$b" "$x"
plan "Account"  "$ACCOUNT"
plan "Project"  "$PROJECT  (number $PROJECT_NUMBER)"
why  "override with PROJECT=<id> (defaults to gcloud config)"
plan "Region"   "$REGION"
why  "override with REGION=<region> (defaults to gcloud config run/region)"
plan "Billing"  "$BILLING_OK"
plan "Image"    "$SOURCE_IMAGE"
why  "public GHCR image built from this repo on every master push"
why  "override with SOURCE_IMAGE=<ref> to pin a specific sha"

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
why  "Cloud Run cannot pull from ghcr.io (only gcr.io / *.pkg.dev / docker.io);"
why  "this is where the GHCR image gets copied on first install"
plan "copy"         "Image $SOURCE_IMAGE → $IMAGE"
why  "one docker pull + tag + push on the machine running this script"
why  "subsequent installs with the same tag skip this step"
plan "$SQL_ACTION"  "Cloud SQL instance '$DB_INSTANCE' ($DB_TIER, POSTGRES_15, 10 GB SSD, no HA)"
why  "$DB_TIER is the cheapest tier (~\$7.50/mo) — fits a team of ~20; no HA keeps cost down"
why  "POSTGRES_15 chosen over 17 for gcloud SDK compatibility (15 is supported since 2023)"
why  "override tier with DB_TIER=db-custom-1-3840 for production scale"
plan "create/reuse" "4 Secret Manager entries: db-password, encryption-key, scheduler-secret, database-url"
why  "all generated via 'openssl rand -hex' on first install; reused on re-run"
why  "database-url is a composed secret containing db-password inline — single env injection"
plan "$RUN_ACTION"  "Cloud Run service '$SERVICE' — 1 vCPU / 512 MiB / min=0 max=3 / public HTTPS"
why  "min=0 means no idle cost; first request after sleep adds ~1–3s cold start"
why  "max=3 caps runaway scale; team workloads rarely exceed 1 instance in practice"
why  "512 MiB comfortably fits the Next.js standalone bundle (~250 MB resident)"
why  "public HTTPS is required — signup + CLI ingest need reachability"
plan "$SCH_ACTION"  "Cloud Scheduler job 'fleetlens-prune' — cron '0 * * * *' → POST /api/admin/prune"
why  "runs hourly because Cloud Run scales to zero and setInterval can't fire reliably"
why  "authenticated via x-scheduler-secret header (shared secret in Secret Manager)"

printf "\n%sIAM changes on the default Cloud Run runtime service account%s\n" "$b" "$x"
printf "  %s%s%s\n" "$d" "$RUNTIME_SA" "$x"
plan "grant"  "roles/secretmanager.secretAccessor — on 3 of the 4 secrets"
why  "URL, encryption-key, scheduler-secret are mounted as env vars at runtime"
why  "db-password isn't mounted directly (it's embedded in database-url)"
plan "grant"  "roles/cloudsql.client — at project scope"
why  "allows the Cloud Run socket mount at /cloudsql/<conn> to connect to the instance"
why  "could be narrowed to instance-scope; project-scope keeps config simple"

printf "\n%sCost + time estimate%s\n" "$b" "$x"
info "~\$10/mo idle (Cloud SQL db-f1-micro is the floor at \$7.50; everything else scales to zero)"
info "~\$25/mo under moderate usage (5–20 engineers pushing metrics every 5 min)"
info "~5–6 min wall time for a fresh install; ~1 min on re-run (Cloud SQL provisioning dominates)"

printf "\n%sAfter you confirm%s\n" "$b" "$x"
info "A public URL is printed. Open it in a browser and you'll land on /signup."
info "The first account to sign up becomes the admin of team #1."
info "Pair your local CLI with 'fleetlens team join <url> <device-token>'."

printf "\n%sTo undo everything later:%s see deploy/gcp/TUTORIAL.md 'Tearing it down'.\n" "$b" "$x"
printf "%sAll steps are idempotent — re-running resumes where it stopped.%s\n" "$d" "$x"

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
