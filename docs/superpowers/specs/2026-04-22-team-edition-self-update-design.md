# Fleetlens Team Edition — Self-Update Design

**Status:** Draft
**Date:** 2026-04-22
**Author:** brainstorming session (cowcow02 + Claude)
**Ships:** Site-admin-triggered version updates for GCP Cloud Run + Railway deployments, with Drizzle-managed DB migrations and safe rollback
**Depends on:** Plan 1 (Foundation) — complete on master
**Enables:** Plans 2, 3, 4 can now evolve schema without manual customer intervention

## Overview

Once a Fleetlens Team Edition instance is deployed (to GCP Cloud Run or Railway), the site administrator — the person with the `admin` membership role on the team server web UI — can update the server to a new version by clicking a button in the UI. No shell access, no `gcloud` or `railway` CLI, no involvement from whoever originally owned the cloud account at install time.

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
│ Admin's browser     │                │ Fleetlens team server       │
│                     │                │  (running on Cloud Run /    │
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

Add `--build-arg APP_VERSION=$VERSION` to the `docker/build-push-action` invocation. `$VERSION` comes from the release tag (already extracted). On master-push builds (which don't have a release tag), pass the short SHA as the version — these images are explicitly labeled bleeding-edge and never show up in the admin's update candidate list.

**GHCR tags after this change** (existing convention preserved):

| Event | Tags pushed |
|---|---|
| Master push | `:latest`, `:<sha7>` |
| Release tag `v0.5.0` push | `:latest`, `:0.5.0`, `:<sha7>` |

Note the release tag strips the leading `v` — this matches what's already in the workflow (`${VERSION#v}`).

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

**Migration runner** (`migrate.ts`) changes:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getPool } from "./pool";

const MIGRATION_LOCK_ID = 0x_FLEETLENS_MIGRATE; // fixed 64-bit int

export async function runMigrations(): Promise<void> {
  const db = drizzle(getPool());
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(db, { migrationsFolder: "src/db/migrations" });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }
}
```

The advisory lock serializes concurrent boot-time migrations if Cloud Run scales the revision to >1 instance. Drizzle's migrator already skips already-applied migrations via its `__drizzle_migrations` metadata table, so a second instance arriving after the first finishes is a no-op.

**Expand/contract discipline** (enforced by convention, not tooling, in v1):

- Migrations MUST be additive: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX CONCURRENTLY`.
- Migrations MUST NOT be: `DROP COLUMN`, `RENAME COLUMN`, `ADD COLUMN ... NOT NULL` without a default, `ALTER COLUMN TYPE` (beyond compatible widening).
- Removing a column takes two releases: release N stops reading/writing the column; release N+1 drops it. Document this in `packages/team-server/src/db/MIGRATIONS.md` with the allow-list and the rationale.

**Initial migration (`0000_initial.sql`)** ports the existing `SCHEMA_SQL` verbatim. The first time an *existing* deployment boots a Drizzle-enabled image, the migrator finds tables already present, but its `__drizzle_migrations` table is empty. We handle this with a **baseline check** in `migrate.ts`: before running migrations, if `__drizzle_migrations` is empty AND `user_accounts` exists, insert a row marking `0000_initial` as applied. From that point on, Drizzle's journal is authoritative.

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

Uses `@google-cloud/run` SDK. `redeploy(tag)` calls `ServicesClient.updateService` on the service identified by `process.env.K_SERVICE` (Cloud Run injects this), updating `template.containers[0].image`. Credentials from Application Default Credentials (the service's SA).

**`RailwayAdapter`** (`railway.ts`):

Uses plain `fetch` against `https://backboard.railway.app/graphql/v2`. `redeploy(tag)` runs two mutations:

1. `serviceInstanceUpdate` — set `source.image = "ghcr.io/...:"+tag`
2. `serviceInstanceRedeploy` — trigger the redeploy

Token from `RAILWAY_TOKEN` env var, project + service + environment IDs from `RAILWAY_PROJECT_ID` / `RAILWAY_SERVICE_ID` / `RAILWAY_ENVIRONMENT_ID` (all provided by Railway's template).

**Selection logic**:

```ts
// packages/team-server/src/lib/self-update/index.ts
export function getPlatformAdapter(): PlatformAdapter | null {
  if (process.env.K_SERVICE) return new GcpCloudRunAdapter();
  if (process.env.RAILWAY_TOKEN) return new RailwayAdapter();
  return null; // compose / unknown — UI shows "manual update" card
}
```

### 4. Update service

Server-side service module (`packages/team-server/src/lib/self-update/service.ts`) exposes:

- `getStatus()` → `{ currentVersion, latestVersion, updateAvailable, lastCheckedAt, lastUpdateAttempt }`. Cached for 60 seconds.
- `checkNow()` → forces a fresh GHCR + GitHub releases query; writes to `update_check_cache` table; emits SSE event.
- `getReview(targetVersion)` → returns `{ changelog: string (markdown), migrations: string[] }`. Changelog from GitHub Releases API. Migrations list from the target image's `_journal.json` — this is the one hard bit; see "Open question: migration preview" below.
- `applyUpdate(targetVersion, actorId)` → audits the action in the `events` table, calls `platformAdapter.redeploy(tag)`, returns `{ accepted: true, revisionId }`.

**Scheduler integration**: `packages/team-server/src/lib/scheduler.ts` already runs periodic tasks. Add a `checkForUpdates` job running every 1 hour. Cached results power the UI banner without making a live GHCR call on every page load.

**Rate limiting**: `applyUpdate` is gated to once per 5 minutes per team server (global, not per-admin) via the existing rate-limiter. Prevents accidental double-clicks from triggering two redeploys.

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

**RBAC**: All `/admin/updates*` routes and `/api/admin/updates*` endpoints require `role = 'admin'` on the caller's membership. Existing auth middleware handles this — add the admin-check guard.

**Global banner**: When `updateAvailable === true`, render a thin banner at the top of *every* admin page ("v0.5.0 available — [Review]"). Only visible to admins. Dismissable for the current browser session via localStorage; reappears after next login.

### 6. Install-time provisioning changes

#### GCP (`deploy/gcp/install.sh`)

Current installer creates the Cloud Run service with default compute SA. Change:

1. Create a dedicated service account `fleetlens-team-server-sa@$PROJECT.iam.gserviceaccount.com`.
2. Bind `roles/run.developer` **scoped to the service resource** (not project-wide). Use `gcloud run services add-iam-policy-binding` on the service itself.
3. Bind `roles/iam.serviceAccountUser` on the SA to itself (required for UpdateService).
4. Deploy the Cloud Run service with `--service-account fleetlens-team-server-sa@...`.
5. Set env var `GCP_PROJECT_ID=$PROJECT` on the service (Cloud Run already injects `K_SERVICE` and `K_REVISION`).

Idempotency: re-running the installer detects the SA and existing bindings, skips creation, ensures all bindings present. Existing deployments re-run `install.sh` once to pick up the new permissions.

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
| GCP `fleetlens-team-server-sa` | `run.developer` on one Cloud Run service only | Attacker can change the image of that one service to anything on any registry. Cannot create other services, cannot access other projects, cannot read Cloud SQL directly. |
| Railway `RAILWAY_TOKEN` | Project-scoped | Attacker can redeploy any service in the project. Team-server deployments should live in a dedicated Railway project (already the case with the one-click template). |

**Threat model**: the primary threat is a compromised admin account triggering a malicious update. Mitigations:

- Only `admin` role can trigger updates.
- All update actions are audited to the `events` table with actor, target version, timestamp.
- The target image must match the repo-owned GHCR path (`ghcr.io/cowcow02/fleetlens-team-server`). Image ref is constructed server-side from `ghcr.io/cowcow02/fleetlens-team-server:${targetVersion}`; the admin does not supply an arbitrary image.
- The target version must be a tag present in GHCR (validated via tags/list query before redeploy).

### 8. Testing strategy

**Unit tests** (new, under `packages/team-server/test/lib/self-update/`):

- `version-detector.test.ts` — mocked GHCR tags response, asserts correct semver comparison and filtering of non-semver tags.
- `changelog-fetcher.test.ts` — mocked GitHub Releases API, asserts markdown extraction and caching.
- `gcp-cloud-run-adapter.test.ts` — mocked `@google-cloud/run` client, asserts correct `updateService` payload shape.
- `railway-adapter.test.ts` — mocked `fetch`, asserts correct GraphQL mutations.

**Integration tests** (extend existing `test/api/` suite):

- `test/api/admin-updates.integration.test.ts` — full HTTP flow: admin GETs `/api/admin/updates`, non-admin gets 403, admin POSTs apply with invalid version gets 400, admin POSTs apply with valid version calls mocked adapter's `redeploy`.
- `test/db/migrate.drizzle.test.ts` — migrations run against a fresh Postgres produce the expected schema; migrations run against an existing "pre-Drizzle" schema trigger the baseline insert and skip `0000_initial`.

**Manual smoke tests** (release checklist):

- Deploy v0.4.1 to a throwaway GCP project, then publish v0.4.2 as a test release, verify the banner appears within the hour, click through, apply, confirm new revision rolls out.
- Same against a throwaway Railway instance.
- Simulate failed migration: temporarily publish a v0.4.3 image with an intentionally broken migration, verify Cloud Run keeps v0.4.2 serving and admin sees error.

## Phased rollout

The self-update feature ships as v0.5.0 of team-server. Existing v0.4.x deployments cannot self-update to v0.5.0 (they have no button yet). They must re-run the installer once — this is the last time they do so.

**v0.5.0 release notes will say:**

> **One-time action required:** Re-run your installer (`./install.sh` for GCP, or re-import the Railway template) to pick up new permissions. This is the last time you'll need to do this — future updates happen entirely through the web UI.

## Open questions / future work

### Migration preview before applying

The review page claims to show "pending migrations." For that to work, the *running* server (v0.4.1) needs to know what migrations the target image (v0.5.0) contains *before* starting the new container.

**Option 1 (v1 choice):** Publish a `migrations-manifest.json` alongside the image to a known URL (e.g., `https://github.com/cowcow02/fleetlens/releases/download/v0.5.0/migrations-manifest.json`) as part of the release workflow. Contains the filenames + SQL bodies of migrations added in that version. Server fetches this on the review page.

**Option 2 (deferred):** Embed the migrations manifest in OCI artifact annotations on the image itself. More "correct" but requires buildx annotations + a registry call to fetch. Not worth the complexity in v1.

**Option 3 (deferred):** Pull the new image into a temporary container, exec a dry-run against a clone of the current DB. Robust but slow and requires Docker-in-Docker or equivalent. Definitely post-v1.

Going with Option 1. One extra file in the release workflow, trivial to implement, transparent to the admin.

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

---

## Summary

Self-update ships as v0.5.0 of team-server. Core pieces:

1. **Drizzle** replaces the `CREATE TABLE IF NOT EXISTS` schema string. Migrations live in `packages/team-server/src/db/migrations/`, generated via `drizzle-kit`, run on boot under a Postgres advisory lock. Expand/contract discipline enforced by reviewer convention + `MIGRATIONS.md` allow-list.
2. **Versioned GHCR tags** — each release publishes `:latest` + `:X.Y.Z`. `APP_VERSION` baked into the image via Dockerfile `ARG`. GHCR's public tags-list API powers discovery.
3. **Platform adapters** — thin `PlatformAdapter` interface with `GcpCloudRunAdapter` (uses `@google-cloud/run` SDK + ADC) and `RailwayAdapter` (uses GraphQL + project token).
4. **Admin UI** — `/admin/updates` list + `/admin/updates/[version]` review, gated to admin role, with a global banner across admin pages. Changelog from GitHub Releases; migration list from a per-release `migrations-manifest.json` artifact.
5. **One-time install bump** — `install.sh` + Railway template each grow one new IAM binding / env var. Existing deploys re-run the installer once to pick up the v0.5.0 baseline; every future update is button-click only.
6. **Rollback** — automatic via Cloud Run / Railway health-check-gated revision promotion. No manual rollback UI in v1.

Total new LoC estimate: ~600 for team-server code + ~150 for deploy-script changes + ~200 for tests. Most of the complexity is in the review-page migration preview and the platform adapters; everything else is plumbing.
