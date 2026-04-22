# Fleetlens Team Edition — Self-Update Design

**Status:** Draft
**Date:** 2026-04-22
**Author:** brainstorming session (cowcow02 + Claude)
**Ships:** Site-admin-triggered version updates for GCP Cloud Run + Railway deployments, with Drizzle-managed DB migrations and safe rollback
**Depends on:** Plan 1 (Foundation) — complete on master
**Enables:** Plans 2, 3, 4 can now evolve schema without manual customer intervention

## Overview

Once a Fleetlens Team Edition instance is deployed (to GCP Cloud Run or Railway), a platform staff user (`user_accounts.is_staff = true` — see Section 5a for why this is distinct from per-team admin) can update the server to a new version by clicking a button in the UI. No shell access, no `gcloud` or `railway` CLI, no involvement from whoever originally owned the cloud account at install time.

The update flow:

1. Running server polls GHCR on a schedule, detects a newer published version.
2. Admin sees **"v0.5.0 available"** banner in the web UI.
3. Admin clicks through to a Review page showing the changelog (from GitHub release notes) and the pending DB migrations (from the new image's Drizzle journal).
4. Admin clicks **Apply update**. Server calls its platform's API (Cloud Run Admin API / Railway GraphQL) to redeploy with the new image tag.
5. New container boots, acquires a Postgres advisory lock, runs pending migrations, becomes healthy.
6. Platform routes traffic to the new revision; old revision drains. If the new revision's health check fails, the platform keeps the old revision serving and the admin sees a post-hoc error in the UI.

## Why ship this now

Every schema change after Plan 1 becomes a support burden without it. Plans 2, 3, and 4 each add 2–5 new tables; without a real migration framework and an in-product upgrade path, every existing customer deployment either manually SSHes into a container to run DDL, re-runs the one-click installer hoping it's idempotent enough, or falls behind and forks off. The promise of Team Edition is that a non-engineer sysadmin installs it once and never looks at cloud consoles again. Self-update is what makes that promise real past v1.

## Non-goals

- **No automatic updates.** The admin always clicks. No "auto-apply on Sundays 3 AM" in v1.
- **No cross-version skipping beyond what the migrations allow.** If migrations require a linear path (v1 → v2 → v3) and the admin is on v1 with v3 available, we apply v2's migrations first, then v3's, in the new container. We do *not* re-deploy intermediate versions.
- **No rollback button.** If an update fails, the platform's automatic revision rollback is the recovery path. Manual rollback to an older version is a post-v1 feature.
- **No compose / self-hosted docker-compose support in v1.** GCP Cloud Run + Railway only. Compose users see a "copy this command" fallback card with no button.
- **No channel selection** (`stable` / `beta`) in v1. The admin sees the highest published semver; that's the target.
- **No cross-account update.** The update flow redeploys the *same* Cloud Run service / Railway service. It does not migrate between accounts or platforms.

## Core architecture

```
┌─────────────────────┐                ┌────────────────────────────┐
│ Staff user's browser│                │ Fleetlens team server       │
│ (is_staff = true)   │                │  (running on Cloud Run /    │
│  /admin/updates     │◀─HTML/SSE──────│   Railway — version X.Y.Z)  │
│  /admin/updates/v   │                │                             │
│                     │                │  /api/admin/updates         │
│  [Apply update] ────┼─POST──────────▶│    check / review / apply   │
└─────────────────────┘                │                             │
                                       │  UpdateService              │
                                       │    - version-detector       │
                                       │    - changelog-fetcher      │
                                       │    - platform-adapter       │
                                       └───┬───────────────────────┬─┘
                                           │                       │
                                           │ GHCR tags+manifests   │ Cloud Run / Railway
                                           │ GitHub releases       │ platform API
                                           ▼                       ▼
                                  ┌──────────────────┐    ┌──────────────────┐
                                  │ ghcr.io (public) │    │ Platform control │
                                  │ api.github.com   │    │  plane           │
                                  └──────────────────┘    └────────┬─────────┘
                                                                   │ "deploy :v0.5.0"
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │ New revision     │
                                                          │ boots, pg locks, │
                                                          │ runs migrations  │
                                                          └──────────────────┘
```

Trust boundary: **the running server holds credentials to redeploy itself.** On Cloud Run, those credentials are the instance's service account (granted `roles/run.developer` scoped to its own service). On Railway, they're a project-scoped API token stored as an env var. Both are provisioned once at install time, never rotated by the running server, never surfaced in the UI.

## Components

### 1. Image + version scheme

**Dockerfile change** (`packages/team-server/Dockerfile`):

```dockerfile
FROM node:22-alpine AS builder
# ...existing builder stage unchanged...

FROM node:22-alpine AS runner
WORKDIR /app

ARG APP_VERSION=0.0.0-dev
ENV APP_VERSION=$APP_VERSION

# ...existing copies unchanged...
CMD ["node", "packages/team-server/server.js"]
```

**Publish workflow change** (`.github/workflows/publish-team-server-image.yml`):

Today the workflow has no `build-args:` key on `docker/build-push-action@v6`. Two concrete changes:

1. Add a new step (or extend the existing "Compute tags" step) that computes `APP_VERSION`:
   - On release event: `APP_VERSION=${VERSION#v}` (strip leading `v`).
   - On master push / workflow_dispatch: `APP_VERSION=0.0.0-dev+${GITHUB_SHA::7}` (so master-push images carry a clearly-non-release identifier and never semver-sort above real releases).
   - Expose via `echo "app_version=$APP_VERSION" >> "$GITHUB_OUTPUT"`.
2. Add `build-args:` block to the `docker/build-push-action@v6` invocation:
   ```yaml
   build-args: |
     APP_VERSION=${{ steps.tags.outputs.app_version }}
   ```

**GHCR tags produced by the existing workflow** (preserved, documented here so the implementer doesn't regress):

| Event | Tags pushed |
|---|---|
| Master push | `:<sha7>`, `:latest` |
| Release `v0.5.0` | `:<sha7>`, `:0.5.0`, `:latest` |

Release tags strip the leading `v` — this matches the existing `${VERSION#v}` expansion in the workflow. Version discovery must match this convention (filter to semver tags *without* a `v` prefix).

**Version discovery query**: `GET https://ghcr.io/v2/cowcow02/fleetlens-team-server/tags/list`. For public GHCR images, no auth token is needed. Filter to tags matching `^\d+\.\d+\.\d+$`, semver-sort, take the highest. That's the latest available version.

### 2. Migration framework — Drizzle

Replaces the current `SCHEMA_SQL` string in `packages/team-server/src/db/schema.ts` with Drizzle table declarations, plus a generated migrations folder.

**New structure:**

```
packages/team-server/
  drizzle.config.ts                    # Drizzle Kit config (schema + out dir)
  src/db/
    schema.ts                          # Drizzle pgTable declarations (source of truth)
    migrate.ts                         # Boot-time runner using drizzle-orm migrator
    pool.ts                            # Unchanged
    migrations/                        # Generated — checked into git
      0000_initial.sql                 # Hand-migrated from current SCHEMA_SQL
      0001_<next>.sql                  # Created via `drizzle-kit generate`
      meta/
        _journal.json                  # Drizzle's migration index
        0000_snapshot.json             # Schema snapshot per migration
```

**Migration runner** (`migrate.ts`) changes — uses a single dedicated `pg.Client` for the entire migration transaction so the advisory lock and all DDL travel over the same connection:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { applyPreDrizzleBaselineIfNeeded } from "./baseline";

// Fixed lock key — any 64-bit integer unique across the database works.
// Must stay constant across releases so concurrent boots of different
// versions still serialize.
const MIGRATION_LOCK_ID = 7326544091n; // arbitrary fixed bigint

export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Dedicated one-shot client, NOT the shared app pool. pg_advisory_lock
  // (session-scoped) is held only on its acquiring connection, so the
  // drizzle migrator must run every statement on this same client.
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID.toString()]);
    await applyPreDrizzleBaselineIfNeeded(client);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "src/db/migrations" });
  } finally {
    // Advisory lock is released automatically on disconnect, but release
    // explicitly so multiple migrate() calls in tests behave predictably.
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID.toString()]).catch(() => {});
    await client.end();
  }
}
```

Key correctness points (all learned during spec review):

- **`drizzle(client)` accepts a single `pg.Client`, not only a Pool.** This is the supported pattern for one-shot migrations and is what guarantees the lock + every migrator query share a connection.
- **`pg_advisory_lock` is session-scoped.** A pool-based wiring would check out a different connection for DDL and race.
- **The lock ID is passed as a string** to avoid node-postgres silently truncating a JS `number` above 2^31. The BIGINT lock ID arrives in Postgres as bigint either way.
- **Drizzle's migrator handles already-applied migrations** via the `__drizzle_migrations` journal table (inside schema `drizzle`); a second instance arriving after the first finishes the full set is a no-op.
- **The main app `Pool`** (used by queries) stays untouched in `pool.ts`. Migrations never use it.

**Expand/contract discipline** (enforced by convention, not tooling, in v1):

- Migrations MUST be additive: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX CONCURRENTLY`.
- Migrations MUST NOT be: `DROP COLUMN`, `RENAME COLUMN`, `ADD COLUMN ... NOT NULL` without a default, `ALTER COLUMN TYPE` (beyond compatible widening).
- Removing a column takes two releases: release N stops reading/writing the column; release N+1 drops it. Document this in `packages/team-server/src/db/MIGRATIONS.md` with the allow-list and the rationale.

**Initial migration (`0000_initial.sql`)** ports the existing `SCHEMA_SQL` verbatim. The first time an *existing* deployment boots a Drizzle-enabled image, the migrator would otherwise try to re-run `CREATE TABLE IF NOT EXISTS ...` — safe — but Drizzle expects no pre-existing schema and tracks each applied migration by SQL-content hash. We handle this with a **pre-run baseline step** (`packages/team-server/src/db/baseline.ts`):

```ts
// packages/team-server/src/db/baseline.ts
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export async function applyPreDrizzleBaselineIfNeeded(client: Client): Promise<void> {
  // 1) Is this a fresh DB? If `user_accounts` doesn't exist, there's nothing
  //    to baseline — let the normal migrator run everything.
  const { rowCount } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_accounts'",
  );
  if (rowCount === 0) return;

  // 2) Create drizzle's bookkeeping schema/table ourselves so we can insert
  //    the baseline row before the migrator runs. The migrator is idempotent
  //    on this DDL — if it exists, migrator uses it; if it doesn't, migrator
  //    creates it. We create it to write to it.
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  // 3) Short-circuit if already baselined (covers re-boot of an already
  //    migrated deployment).
  const journal = await client.query("SELECT COUNT(*) AS n FROM drizzle.__drizzle_migrations");
  if (Number(journal.rows[0].n) > 0) return;

  // 4) Compute the hash Drizzle would compute for 0000_initial.sql.
  //    Drizzle's migrator (as of drizzle-orm >=0.30) hashes the SQL file
  //    contents via sha256, hex-encoded. Verified against drizzle-orm source
  //    at plan time. If this hashing changes in a future Drizzle, re-pin
  //    drizzle-orm to a tested version — the contract test below catches it.
  const sqlPath = join(process.cwd(), "src/db/migrations/0000_initial.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");

  await client.query(
    "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
    [hash, Date.now()],
  );
}
```

**Contract test** (`test/db/baseline.test.ts` — required, not optional): given a fresh Postgres with `SCHEMA_SQL` applied manually, run `applyPreDrizzleBaselineIfNeeded` then `migrate()`. Assert (a) no migration runs, (b) `__drizzle_migrations` has exactly one row, (c) its hash matches what Drizzle would compute on a truly fresh DB that just ran `0000_initial.sql`. This test is what locks the hashing contract in place — if a future Drizzle version changes its hashing, this test fails loudly instead of silently corrupting customer DBs.

**Pinning note**: `drizzle-orm` and `drizzle-kit` versions are pinned exact (not `^`) in `packages/team-server/package.json`. Upgrading Drizzle is a deliberate cross-cut, not a dependabot change.

### 3. Platform adapter interface

```ts
// packages/team-server/src/lib/self-update/platform.ts
export interface PlatformAdapter {
  readonly name: "gcp-cloud-run" | "railway";

  // Fetches current runtime image ref. Read-only, used for audit.
  getCurrentImage(): Promise<{ digest: string; tag: string | null }>;

  // Instructs platform to redeploy with a new image tag.
  // Returns when the platform has accepted the request, NOT when
  // the new revision is healthy (that's async).
  redeploy(imageTag: string): Promise<{ revisionId: string }>;
}
```

**`GcpCloudRunAdapter`** (`gcp-cloud-run.ts`):

Uses `@google-cloud/run` SDK. `redeploy(tag)` is a read-modify-write on the full Service spec (Cloud Run's `UpdateService` RPC is not a field-level patch):

1. `ServicesClient.getService({ name })` — fetch current spec. `name` is built from `process.env.K_SERVICE` + `process.env.K_CONFIGURATION` + Cloud Run's project/region (all injected).
2. Mutate `service.template.containers[0].image = "ghcr.io/cowcow02/fleetlens-team-server:" + tag` — leave all other fields (env vars, secrets, SA, traffic splits) untouched.
3. `ServicesClient.updateService({ service })` — submit the updated spec. Cloud Run creates a new revision; traffic migrates after the new revision passes healthchecks.

Credentials from Application Default Credentials (the service's runtime SA).

**`RailwayAdapter`** (`railway.ts`):

Uses plain `fetch` against `https://backboard.railway.app/graphql/v2`. The Railway public GraphQL schema evolves; verify exact mutation names against Railway's docs (https://docs.railway.com/reference/public-api) at implementation time. The shape of the work:

1. Update the service instance's source image to `ghcr.io/cowcow02/fleetlens-team-server:<tag>` (today: `serviceInstanceUpdate` or equivalent; Railway's schema names have moved around).
2. Trigger a redeploy (today: `serviceInstanceDeploy` or `deploymentRedeploy` depending on schema version).

Token from `RAILWAY_TOKEN` env var, project + service + environment IDs from `RAILWAY_PROJECT_ID` / `RAILWAY_SERVICE_ID` / `RAILWAY_ENVIRONMENT_ID` (all provided by Railway's template variable system). The plan implementer must verify mutation names and argument shapes against Railway's current schema — this spec intentionally does not pin them because they've changed in the past year.

**Selection logic**:

```ts
// packages/team-server/src/lib/self-update/index.ts
export function getPlatformAdapter(): PlatformAdapter | null {
  if (process.env.K_SERVICE) return new GcpCloudRunAdapter();
  if (process.env.RAILWAY_TOKEN) return new RailwayAdapter();
  return null; // compose / unknown — UI shows "manual update" card
}
```

**Behavior when adapter is null**: `checkForUpdates` still runs on schedule, so the banner can tell the admin a new version is available even on an unsupported platform. The Review page also still fetches and renders changelog + migrations manifest. Only the `[Apply update]` button is disabled; a "manual update" card shows the equivalent shell commands (see Section 7).

### 4. Update service

Server-side service module (`packages/team-server/src/lib/self-update/service.ts`) exposes:

- `getStatus()` → `{ currentVersion, latestVersion, updateAvailable, lastCheckedAt, lastUpdateAttempt }`. Cached for 60 seconds.
- `checkNow()` → forces a fresh GHCR + GitHub releases query; writes to `update_check_cache` table; emits SSE event.
- `getReview(targetVersion)` → returns `{ changelog: string (markdown), migrations: MigrationInfo[] }`. Changelog from GitHub Releases API. Migrations manifest: see "Release-artifact manifest" below.
- `applyUpdate(targetVersion, actorId)` → audits the action in the `events` table, calls `platformAdapter.redeploy(tag)`, returns `{ accepted: true, revisionId }`.

**HTTP routes** (all under `/api/admin/updates`, all gated by `requireStaff` — `user_accounts.is_staff = true`):

| Method + path | Handler | Body / params |
|---|---|---|
| `GET /api/admin/updates` | `getStatus()` | — |
| `POST /api/admin/updates/check` | `checkNow()` | — |
| `GET /api/admin/updates/review?version=X.Y.Z` | `getReview()` | query `version` |
| `POST /api/admin/updates/apply` | `applyUpdate()` | body `{ version: "X.Y.Z" }` |

Staff-management routes (also staff-gated) are:

| Method + path | Handler | Body / params |
|---|---|---|
| `GET /api/admin/staff` | List all user accounts with `is_staff` status | — |
| `POST /api/admin/staff/grant` | Promote a user to staff | body `{ userId }` |
| `POST /api/admin/staff/revoke` | Revoke staff (refuses on last staff) | body `{ userId }` |

**Event audit strings** (written to the existing `events` table by `applyUpdate` and the scheduler):

| `action` | `payload` |
|---|---|
| `self_update.check` | `{ currentVersion, latestVersion }` |
| `self_update.apply_requested` | `{ fromVersion, toVersion, revisionId }` |
| `self_update.applied` | `{ fromVersion, toVersion }` (written by the *new* container's startup after successful migration) |
| `self_update.failed` | `{ fromVersion, toVersion, error }` (written by the *new* container if migrations fail before it crashes; best-effort) |

**Release-artifact migrations manifest** (required for `getReview`):

The release workflow (`.github/workflows/release.yml`) must publish a `migrations-manifest.json` as a GitHub Release asset, containing the filenames + SQL bodies of every Drizzle migration in that release. Shape:

```json
{
  "version": "0.5.0",
  "migrations": [
    {
      "filename": "0001_add_plan_utilization.sql",
      "description": "Add plan_utilization table for Plan 2 finance view",
      "sql": "CREATE TABLE ..."
    }
  ]
}
```

`description` comes from a leading `-- description: ...` SQL comment on each migration file, enforced by a tiny check in the release workflow.

`getReview` fetches `https://github.com/cowcow02/fleetlens/releases/download/v<version>/migrations-manifest.json`. The SQL bodies are rendered to the admin page as `<pre>` text (escaped, no execution, no parsing) — the review page is display-only. 15-second timeout; if the fetch fails, the review page shows "Changelog loaded; migration preview unavailable (network error)" with the Apply button still enabled.

**Scheduler integration**: `packages/team-server/src/lib/scheduler.ts` already runs periodic tasks. Add a `checkForUpdates` job running every 1 hour. Cached results power the UI banner without making a live GHCR call on every page load.

**Rate limiting**: `applyUpdate` is gated to once per 5 minutes per team server (global across all admins). If the existing rate-limiter (`packages/team-server/src/lib/rate-limit.ts`) doesn't already support a global key, add a simple single-key variant — the rate-limit surface is small. Prevents accidental double-clicks from triggering two concurrent redeploys.

### 5. Admin UI

New pages under the existing admin section:

```
/admin/updates              # List page: current version, latest version, banner, history
/admin/updates/[version]    # Review page: changelog + pending migrations + [Apply]
```

**`/admin/updates`** (list page):

- Hero: "You are on **v0.4.1**. **v0.5.0** is available — [Review update]."
- History table: previous update attempts (from `events` table filtered by `action = "self_update.*"`) with timestamp, target version, outcome (accepted / failed health / succeeded), actor.
- "Check for updates now" button — calls `checkNow()`.

**`/admin/updates/[version]`** (review page):

- **What's new** — markdown from GitHub Releases API, rendered with existing markdown renderer (same one used by insights).
- **Database changes** — bulleted list of pending migration filenames with their descriptions.
- **Safety summary** — static prose: "If the update fails, the previous version keeps serving traffic. You won't lose data."
- **[Apply update]** button — primary action. Confirmation modal required ("Apply v0.5.0 now? The server will restart within ~60 seconds.").

**RBAC**: All `/admin/updates*` routes and `/api/admin/updates*` endpoints require **platform staff** (`user_accounts.is_staff = true`), not per-team admin role. Self-update is a server-wide action that affects every team hosted on the deployment, so gating by per-team membership is the wrong scope. See Section 5a for the staff model and the `requireStaff` helper.

**Global banner**: When `updateAvailable === true`, render a thin banner at the top of *every* admin page ("v0.5.0 available — [Review]"). Only visible to `is_staff` users (never to team admins without staff). Dismissable for the current browser session via localStorage; reappears after next login.

### 5a. Staff management (platform-level administration)

Self-update is a server-wide capability, not a per-team one, so it requires a distinct privilege tier above team-level admin:

| Role | Scope | Can trigger self-update? |
|---|---|---|
| `memberships.role = 'member'` | One team's data | No |
| `memberships.role = 'admin'` | One team's management (invites, roster, team settings) | No |
| `user_accounts.is_staff = true` | Platform-level (the server deployment itself) | **Yes** |

The `is_staff` column already exists in the Plan 1 schema. What this section adds is the UX and safeguards around setting it.

**First-signup auto-promotion.** On a fresh install, when the first user completes signup, if `SELECT count(*) FROM user_accounts WHERE is_staff = true` is zero, their account is automatically promoted to `is_staff = true`. This bootstraps the system — the person who installs Team Edition becomes platform staff without any out-of-band configuration. Implement as a check at the end of the signup handler inside the same DB transaction that creates the `user_accounts` row, so the promotion is atomic with account creation.

**Promote existing users** (`/admin/staff` page):

- Accessible only to `is_staff = true` users.
- Lists every user account on the server with columns: email, display name, current staff status, last login.
- Toggle button on each row: "Grant staff" / "Revoke staff". One-click, with a confirmation modal for revocations.
- Audited to `events` table (`action = "staff.granted"` / `"staff.revoked"`, payload: `{ targetUserId, targetEmail }`).
- Rate-limited: 10 grant/revoke actions per hour per actor via the existing `rate-limit.ts`. Prevents compromised-staff script abuse.

**Prevent last-staff lockout.** `toggleStaff(targetUserId, is_staff: false)` refuses with HTTP 400 `"Cannot revoke staff from the last remaining staff user"` if the target is currently the only `is_staff = true` account. This prevents the server from becoming un-updatable. A corresponding UI warning surfaces at the top of `/admin/staff` when only one staff user exists: *"Only one staff user — consider promoting a second person so this server isn't lockable if you lose account access."*

**Staff-granting invites** (deferred to v1.1). The existing `invites` table gains a `grants_staff boolean DEFAULT false` column in a later release. A staff-generated invite with `grants_staff = true` promotes the recipient to `is_staff` on acceptance. Not in v0.5.0 scope — the promote-existing-users flow above covers the "sign up normally, then get promoted" path for onboarding a CTO/CEO as staff.

**Recovery path if all staff are lost.** If the only staff account is locked out (person leaves company, forgotten password with no email recovery, etc.), the deployment becomes un-upgradable via the UI. The fallback is `./install.sh --grant-staff <email>` — a new installer flag that runs a single SQL statement (`UPDATE user_accounts SET is_staff = true WHERE email = $1`) against the database. Requires shell access to the install environment (GCP project / Railway project), which is exactly the scenario where re-running the installer is already the accepted answer. Document this in the release notes, not in the web UI.

**Audit note for the recovery path:** `--grant-staff` grants are intentionally **not** written to the `events` table. The installer is out-of-band; detection of recovery-path use happens via cloud-provider audit logs (Cloud SQL query logs / Railway project activity log) and the installer's own run output, not in-app. Anyone with cloud-account access is by definition outside the in-app threat model.

**`requireStaff` helper** (`packages/team-server/src/lib/route-helpers.ts`, add alongside existing `requireAdmin`):

```ts
export async function requireStaff(
  req: NextRequest,
): Promise<(SessionContext & { pool: pg.Pool }) | NextResponse> {
  const base = await requireSession(req);
  if (base instanceof NextResponse) return base;
  if (!base.user.is_staff) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  return base;
}
```

The existing `SessionContext` already carries user fields (see `packages/team-server/src/lib/auth.ts`) — surface `is_staff` on it if not already exposed.

**Tests** (add to Section 8):

- `test/api/staff.integration.test.ts` — covers all three staff routes: `GET /api/admin/staff` returns the list for staff and 403 for non-staff; `POST /grant` promotes a user; `POST /revoke` demotes a user; `POST /revoke` on the last remaining staff returns 400; team-admin (not staff) gets 403 from every route.
- `test/lib/auth.test.ts` — extend existing coverage: `requireStaff` returns 401 for no session, 403 for non-staff, success for staff.
- `test/api/signup.integration.test.ts` — extend with: (a) first signup on fresh DB auto-promotes to `is_staff = true`; (b) second signup does not auto-promote; (c) two concurrent first-signups end with exactly one `is_staff = true` user — locks down the atomicity claim from Section 5a.

### 6. Install-time provisioning changes

#### GCP (`deploy/gcp/install.sh`)

Current installer deploys the Cloud Run service under the default Compute Engine SA (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`). We keep that SA — it's already the runtime principal with the existing secret and Cloud SQL bindings; switching SAs would force re-binding everything with no real security gain. The one addition:

1. Bind `roles/run.developer` to the existing runtime SA **scoped to the one Cloud Run service** (not project-wide). Using the resource-scoped form:

   ```bash
   gcloud run services add-iam-policy-binding "$SERVICE" \
     --region "$REGION" \
     --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
     --role roles/run.developer
   ```

2. Set env var `GCP_PROJECT_ID=$PROJECT` on the service (Cloud Run already injects `K_SERVICE`, `K_REVISION`, `K_CONFIGURATION`).

Notes the reviewer surfaced that are worth keeping here:

- **No `roles/iam.serviceAccountUser` binding is needed.** That role is only required when changing *which* SA a service runs as. Self-update only changes `template.containers[0].image`, keeping the runtime SA constant, so the `actAs` check doesn't apply.
- **Resource-scoped `run.developer` is the key safety property.** It permits `run.services.update` only on this one service. The SA cannot create, delete, or modify other Cloud Run services in the project.

Idempotency: re-running the installer detects the existing binding and skips the add. Existing deployments re-run `install.sh` once to pick up the permission; every future update is then UI-driven.

#### Railway (template update)

1. Provision a project-scoped API token during template install. Store as `RAILWAY_TOKEN` env var on the service. (Railway templates support this via template variables.)
2. Set `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID` env vars via Railway's built-in variable references.

Existing deployments: re-import the template (or manually set `RAILWAY_TOKEN`) per release notes.

#### Both platforms

The running server checks for the required env vars at boot. If missing, the `/admin/updates` page shows **"Self-update is not configured — your installer needs to be re-run. [See docs]"** instead of the update banner. Non-fatal.

### 7. Security model

**Blast radius per platform:**

| Credential | Scope | Blast radius if leaked |
|---|---|---|
| GCP default Compute SA with the added resource-scoped `roles/run.developer` | That role grants `run.services.update` on this one Cloud Run service only | Attacker with the SA's token can change the image of that one service to anything on any registry. Cannot create other services, cannot access other projects, cannot read Cloud SQL directly beyond what this SA already could pre-self-update. |
| Railway `RAILWAY_TOKEN` | Project-scoped | Attacker can redeploy any service in the project. Team-server deployments should live in a dedicated Railway project (already the case with the one-click template). |

**Threat model**: the primary threat is a compromised staff account triggering a malicious update. Mitigations:

- Only `is_staff = true` users can trigger updates (strictly narrower than per-team admin — see Section 5a).
- Only existing staff can promote other users to staff. A compromised team-admin account cannot escalate to staff on its own.
- All update actions AND all staff grants/revocations are audited to the `events` table with actor, target, timestamp.
- The target image must match the repo-owned GHCR path (`ghcr.io/cowcow02/fleetlens-team-server`). Image ref is constructed server-side from `ghcr.io/cowcow02/fleetlens-team-server:${targetVersion}`; the staff user does not supply an arbitrary image.
- The target version must be a tag present in GHCR (validated via tags/list query before redeploy).
- Rate limits: 1 update apply per 5 min (global); 10 staff grants/revocations per hour per actor. Bounds the blast radius of a compromised staff account's script.

### 8. Testing strategy

**Unit tests** (new, under `packages/team-server/test/lib/self-update/`):

- `version-detector.test.ts` — mocked GHCR tags response, asserts correct semver comparison and filtering of non-semver tags.
- `changelog-fetcher.test.ts` — mocked GitHub Releases API, asserts markdown extraction and caching.
- `gcp-cloud-run-adapter.test.ts` — mocked `@google-cloud/run` client, asserts correct `updateService` payload shape.
- `railway-adapter.test.ts` — mocked `fetch`, asserts correct GraphQL mutations.

**Integration tests** (extend existing `test/api/` suite):

- `test/api/admin-updates.integration.test.ts` — full HTTP flow: staff GETs `/api/admin/updates` succeeds, non-staff (team-admin but `is_staff=false`) gets 403, staff POSTs apply with invalid version gets 400, staff POSTs apply with valid version calls mocked adapter's `redeploy`.
- `test/db/migrate.drizzle.test.ts` — migrations run against a fresh Postgres produce the expected schema; migrations run against an existing "pre-Drizzle" schema trigger the baseline insert and skip `0000_initial`.

**Manual smoke tests** (release checklist):

- Deploy v0.4.1 to a throwaway GCP project, then publish v0.4.2 as a test release, verify the banner appears within the hour, click through, apply, confirm new revision rolls out.
- Same against a throwaway Railway instance.
- Simulate failed migration: temporarily publish a v0.4.3 image with an intentionally broken migration, verify Cloud Run keeps v0.4.2 serving and admin sees error.

## Phased rollout

The self-update feature ships as v0.5.0 of team-server. Existing v0.4.x deployments cannot self-update to v0.5.0 (they have no button yet). They must re-run the installer once — this is the last time they do so.

**v0.5.0 release notes will say:**

> **One-time action required:** Re-run your installer (`./install.sh` for GCP, or re-import the Railway template) to pick up new permissions. This is the last time you'll need to do this — future updates happen entirely through the web UI.
>
> **Check your staff list:** The person who first signed up on your server is now your platform staff and can trigger updates. Visit **Settings → Staff** to grant that role to any additional decision-makers (CTO, CEO, etc.) before they need to upgrade the server themselves. Having at least two staff users is strongly recommended — if you lose access to the sole staff account, you'll need shell access to the database to recover via `./install.sh --grant-staff <email>`.

## Open questions / future work

### Migration preview: alternative sourcing strategies (deferred)

Section 4's "Release-artifact migrations manifest" is the v1 choice. Two alternatives considered and rejected for v1:

- **Embed manifest in OCI artifact annotations on the image itself.** More "correct" but requires buildx annotations + a GHCR registry API call to fetch before pull. Deferred.
- **Pull the new image into a sidecar, run `drizzle-kit migrate --dry-run` against a clone of the current DB.** Robust but requires Docker-in-Docker (not available on Cloud Run) or an equivalent off-platform worker. Definitely post-v1.

### What to show if no platform adapter is detected

If running on plain docker-compose or a bare VM (not GCP, not Railway), `getPlatformAdapter()` returns `null`. The `/admin/updates` page detects this and shows:

> **Automatic updates are not available for this deployment.**
>
> Your server is running on an unsupported platform (self-hosted Docker / VM). To update to v0.5.0, run:
>
> ```
> docker pull ghcr.io/cowcow02/fleetlens-team-server:0.5.0
> docker-compose up -d
> ```

Changelog and migration preview still display. Only the button is disabled.

### Solo-CLI symmetry

Solo CLI's existing auto-update (`checkForUpdate` in `packages/cli/src/updater.ts`) uses npm. That flow is unaffected by this work but shares architecture: poll registry → compare semver → user confirms → re-exec with new binary. No direct code reuse in v1, but in a future refactor, a shared `VersionCheck` helper across solo and team-server is plausible.

### Version pinning

v1 always targets the highest available GHCR semver tag. If an admin wants to pin to a specific version (e.g., skip v0.5.0, jump to v0.5.1), they cannot do this from the UI. Deferred — easy to add as a "target a specific version" dropdown on the review page when the need arises.

### Downtime characterization

Cloud Run revision swap is nominally zero-downtime (new revision healthy before old drains). In practice, startup time + migration time for a typical Plan 2–4 migration is ~15–30 seconds. Document "expect 30 seconds of slowness during an update" on the review page so admins don't panic when the server feels sluggish.

**In-flight requests at swap time:** Cloud Run sends SIGTERM to the old revision and gives it a configurable drain window (default 10 seconds). Short HTTP requests complete. Long-lived SSE connections (`/api/events` stream) will be cut — the browser reconnects automatically via the existing `LiveRefresher` retry logic. Flag this in the Apply-confirmation modal so admins with the dashboard open in another tab understand the momentary interruption.

### Network dependency on github.com / ghcr.io

The self-update flow requires outbound HTTPS from the deployed server to `ghcr.io` (tags list, image pulls) and `api.github.com` + `github.com` release-asset CDN (changelog + manifest). Most GCP and Railway deployments have no egress restrictions, but corporate VPC installations may block these. Document the required egress endpoints in the `/admin/updates` page error state when fetches fail ("Check that your deployment can reach ghcr.io and github.com").

---

## Summary

Self-update ships as v0.5.0 of team-server. Core pieces:

1. **Drizzle** replaces the `CREATE TABLE IF NOT EXISTS` schema string. Migrations live in `packages/team-server/src/db/migrations/`, generated via `drizzle-kit`, run on boot under a Postgres advisory lock held on a dedicated `pg.Client` (not the app pool). Existing v0.4.x DBs are baselined via a pre-run hash-matched insert into `drizzle.__drizzle_migrations`. Expand/contract discipline enforced by reviewer convention + `MIGRATIONS.md` allow-list.
2. **Versioned GHCR tags** — each release publishes `:latest` + `:X.Y.Z`. `APP_VERSION` baked into the image via Dockerfile `ARG`, wired through the publish workflow's `build-args:` block. GHCR's public tags-list API powers discovery.
3. **Platform adapters** — thin `PlatformAdapter` interface with `GcpCloudRunAdapter` (uses `@google-cloud/run` SDK + ADC; read-modify-write on the Service spec) and `RailwayAdapter` (uses GraphQL + project token; mutation names to be verified against current schema at implementation time).
4. **Admin UI** — `/admin/updates` list + `/admin/updates/[version]` review, gated to `is_staff = true` (platform staff, not per-team admin), with a global banner across admin pages. Changelog from GitHub Releases; migration preview from a per-release `migrations-manifest.json` asset.
5. **Staff management** — new `/admin/staff` page for promote/revoke; first-signup auto-promotion; refusal to revoke the last staff; `--grant-staff <email>` installer flag as the lockout recovery path. Keeps the feature usable for multi-person orgs (CEO/CTO can be granted staff by the IT installer) without risking an un-upgradable server.
6. **One-time install bump** — `deploy/gcp/install.sh` adds `roles/run.developer` scoped to the one Cloud Run service on the existing default Compute SA, plus the new `--grant-staff` flag. Railway template adds a `RAILWAY_TOKEN` env var. Existing deploys re-run the installer / re-import the template once; every future update is button-click only.
7. **Rollback** — automatic via Cloud Run / Railway health-check-gated revision promotion. No manual rollback UI in v1.

Total new LoC estimate: ~700 for team-server code (including staff management) + ~150 for deploy-script changes + ~250 for tests. Most of the complexity is in the Drizzle baseline, platform adapters, and the migrations-manifest plumbing in the release workflow.

### Suggested plan split (implementer's discretion)

The spec is right at the edge of single-plan scope. If phase discipline looks risky, split along this line:

- **Plan 1a — Migration framework foundation.** Drizzle conversion, baseline insert, `migrations-manifest.json` workflow asset, advisory-lock runner. Ships as v0.4.2 (patch; no user-visible change). Unlocks safe schema evolution for Plans 2/3/4 even if self-update UI isn't ready.
- **Plan 1b — Self-update mechanism + staff management.** Platform adapters, admin UI pages (updates + staff), `requireStaff` helper, first-signup auto-promotion, installer IAM + `--grant-staff` flag + token updates, end-to-end smoke tests against real Cloud Run + Railway projects. Ships as v0.5.0.

The split is low-cost — 1a's migration framework is the foundation 1b builds on, and 1a is independently valuable even if 1b slips. A single-plan implementation is still feasible for an author with tight scope discipline.
