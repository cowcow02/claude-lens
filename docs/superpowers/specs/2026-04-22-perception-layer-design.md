# Fleetlens Perception Layer — Phase 1+2 Design

**Status:** Draft (rev 2, post-review)
**Date:** 2026-04-22
**Author:** Brainstormed with user 2026-04-22
**Ships:** Day-scoped `Capsule` primitive; deterministic + LLM enrichment; background daemon worker; daily digest page + `/digest/[date]` route; `fleetlens capsules` / `fleetlens digest day` CLI
**Depends on:** Existing parser (`packages/parser`), daemon (`packages/cli/src/daemon*`), insights pipeline (`apps/web/lib/ai/`)
**Coexists with:** The existing session-scoped `SessionCapsule` in `packages/parser/src/capsule.ts` stays unchanged. V1 `/insights` continues to work off `SessionCapsule` until Phase 4 cuts it over.
**Phases in this doc:** Phase 1 (capsule layer) + Phase 2 (day digest). Phase 3 (capsule-aware surfaces) and Phase 4 (V2 insights report) specified separately.

---

## Overview

Fleetlens gets a new, persistent **perception layer**. The primitive is a **Capsule** — a structured summary of one session's work on one local day. Capsules are generated deterministically from JSONL plus an optional LLM enrichment pass, stored on disk, and consumed by every surface in the product. The first consumer is a new **daily digest** page that answers "what did I do yesterday, what went well, what hit friction."

The architectural pivot: Anthropic's `/insights` uses sessions as the unit of perception. Fleetlens uses **(session × local-day)**. A session that spans Mon→Wed becomes three distinct Capsules. A day with four sessions aggregates into one day digest over four Capsules. Sessions are identity; days are meaning.

## Vocabulary (locked)

Exactly two terms across the codebase and UI:

- **Capsule** — atomic perception artifact scoped to `(session_id, local_day)`. Always exists once events occur. Carries deterministic fields (numbers, flags, first_user, top_tools) plus LLM-enriched fields (brief_summary, friction_detail, goal, outcome, satisfaction_signals). Stored at `~/.cclens/capsules/{session_id}__{YYYY-MM-DD}.json`. **TypeScript type name: `Capsule`.**
- **Digest** — narrative synthesis over a set of Capsules. Scopes: `day`, `week`, `month`, `project`, `session`. Stored at `~/.cclens/digests/{scope}/{key}.json`. Each digest schema differs by scope but shares a common envelope (`window`, `narrative`, `headline`, `generated_at`, `capsule_refs`).

"Slice" is not used. "Facet" is not used externally. The existing **`SessionCapsule`** in `packages/parser/src/capsule.ts` is a distinct type for the legacy per-session shape used by V1 insights. `Capsule` and `SessionCapsule` coexist in the codebase until Phase 4, when V2 insights retires `SessionCapsule`.

## Why (session × local-day)

Three reasons.

1. **Humans live in days, not sessions.** The answer to "what did I do yesterday?" spans whatever sessions happened to touch yesterday. A session-scoped summary blurs this — a resumed session running across three days reports as one event.
2. **Timeline already treats day as primary.** The timeline page lists sessions by day and always has. Capsule scope matches what the UI already assumes.
3. **Anthropic structurally can't copy this.** Their `/insights` filters sessions into a window. To do day-scoped capsules they'd have to rewrite the facet layer. Shipping this first establishes a moat on the qualitative-analysis axis.

## Interaction with V1 insights (explicit non-change)

Phase 1+2 is **purely additive**. It does NOT modify:
- `packages/parser/src/capsule.ts` (`SessionCapsule` type and `buildCapsule` function)
- `packages/parser/src/aggregate.ts` (`buildPeriodBundle` / `PeriodBundle`)
- `apps/web/lib/ai/insights-prompt.ts` (V1 prompt)
- `apps/web/app/api/insights/route.ts` (V1 route)
- `apps/web/components/insight-report.tsx` (V1 renderer)
- `apps/web/components/insights-view.tsx` (V1 picker state machine)
- Any saved V1 reports (`~/.cclens/insights/week-*.json`, `~/.cclens/insights/4weeks-*.json`)

The new `Capsule` and V1 `SessionCapsule` share no type. `/insights` page behavior is byte-for-byte unchanged after Phase 1+2 ships. Phase 4 replaces V1 with V2 and only then deprecates `SessionCapsule`.

This guarantees Phase 1+2 cannot break the `/insights` page on day one — a blocking concern the first spec revision glossed over.

## Data model

### Capsule

```ts
type Capsule = {
  version: 2                                   // schema version
  session_id: string
  local_day: string                            // "2026-04-22" in the reader's local TZ
  project: string                              // canonical project path (worktrees rolled up)
  start_iso: string                            // first event in this (session, day)
  end_iso: string

  // Deterministic fields (computed from JSONL alone, always present)
  numbers: {
    active_min: number                         // from active-segment splits, day-clipped
    turn_count: number
    tools_total: number
    subagent_calls: number
    skill_calls: number
    task_ops: number
    interrupts: number
    tool_errors: number
    consec_same_tool_max: number
    exit_plan_calls: number
    prs: number
    commits: number
    pushes: number
    tokens_total: number
  }
  flags: string[]                              // existing flag set: orchestrated, loop_suspected, fast_ship, …
  primary_model: string | null
  model_mix: Record<string, number>
  first_user: string                           // first non-command human input in slice, truncated
  final_agent: string                          // last agent text in slice, truncated
  pr_titles: string[]                          // shipped PR titles within this slice
  top_tools: string[]
  skills: Record<string, number>
  subagents: Array<{ type: string; description: string; background: boolean; prompt_preview: string }>

  // Rule-based signals (deterministic, cheap)
  satisfaction_signals: {
    happy: number                              // "Yay!", "perfect!", "!!!"
    satisfied: number                          // "thanks", "looks good", "nice"
    dissatisfied: number                       // "that's not right", "try again"
    frustrated: number                         // "this is broken", "stop", "why"
  }
  user_input_sources: {
    human: number                              // real direct input
    teammate: number                           // <teammate-message> dispatch from coordinator
    skill_load: number                         // "Base directory for this skill:"
    slash_command: number                      // "<command-name>"
  }

  // LLM enrichment — ALWAYS an object, never null. Starts at { status: "pending", ... }.
  enrichment: {
    status: "pending" | "skipped_trivial" | "done" | "error"
    generated_at: string | null
    model: string | null
    cost_usd: number | null
    error: string | null

    // Populated when status === "done"; null otherwise
    brief_summary: string | null
    underlying_goal: string | null
    friction_detail: string | null              // null even on "done" if no friction
    user_instructions: string[]                 // may be [] on "done"
    outcome: "shipped" | "partial" | "exploratory" | "blocked" | "trivial" | null
    claude_helpfulness: "essential" | "helpful" | "neutral" | "unhelpful" | null
    goal_categories: Record<string, number>     // {} on pending/error, populated on done
  }

  // Provenance
  generated_at: string                         // when deterministic fields were computed
  source_jsonl: string                         // path to source file
  source_checkpoint: {                         // provenance only — daemon uses perception-state.json instead
    byte_offset: number                        // last offset parsed when this Capsule was built
    last_event_ts: string | null               // last event timestamp seen when this Capsule was built
  }
}
```

**Fixed goal-category taxonomy** (used in `enrichment.goal_categories`):

```
build · plan · debug · review · steer · meta · research · refactor · test · release · warmup_minimal
```

**Project determination for a Capsule.** Computed deterministically at build time:

1. Compute the cwd-frequency map across all `tool_use` events in the slice that carry cwd metadata (Bash/Edit/Write/Read).
2. Canonicalize each cwd (strip `/.worktrees/<name>` suffix per existing `canonicalProjectName`).
3. The dominant canonicalized cwd is the Capsule's project. Tiebreak by earliest event.
4. If no events carry cwd metadata (rare — conversation-only slice), inherit from `SessionDetail.projectName` canonicalized.

Capsules NEVER split by project within a single (session, day). A session that legitimately spans projects produces one Capsule per day attributed to the dominant project; cross-project detail stays in the raw JSONL.

### Day Digest

```ts
type DigestEnvelope = {
  version: 2
  scope: "day" | "week" | "month" | "project" | "session"
  key: string
  window: { start: string; end: string }
  capsule_refs: string[]                       // "{session_id}__{local_day}"
  generated_at: string
  is_live: boolean                             // true if window is not yet closed
  model: string | null
  cost_usd: number | null
}

type DayDigest = DigestEnvelope & {
  scope: "day"

  // Deterministic aggregations (computed from Capsules, not LLM output)
  projects: Array<{ name: string; display_name: string; share_pct: number; capsule_count: number }>
  shipped: Array<{ title: string; project: string; session_id: string }>
  top_flags: Array<{ flag: string; count: number }>
  top_goal_categories: Array<{ category: string; count: number }>
  concurrency_peak: number                     // aggregateConcurrency(bursts, {start: day, end: day}).peak
  agent_min: number                            // sum of capsule.numbers.active_min

  // LLM-generated narrative (may be null when ai_features.enabled === false)
  headline: string | null
  narrative: string | null
  what_went_well: string | null
  what_hit_friction: string | null
  suggestion: { headline: string; body: string } | null
}
```

`shipped`, `top_flags`, `top_goal_categories`, `concurrency_peak`, `agent_min`, `projects` are **deterministic aggregations** of the day's Capsules, built before any LLM call. Only the five narrative fields come from the LLM. When `ai_features.enabled === false`, the narrative fields are `null` and the digest renders a deterministic-only view (headline synthesized from a static template: *"Worked {agent_min}m across {project_count} projects; shipped {N} PR(s)."*).

Phase 1+2 ships only `DayDigest`. `WeekDigest`, `MonthDigest`, `ProjectDigest`, `SessionDigest` are sketched only for orientation in Phase 3/4 specs.

Note: a `session` digest is a different *view* of the same Capsules — aggregating all Capsules sharing a `session_id`. It is not a fifth Capsule type.

### Storage layout

```
~/.cclens/
  capsules/
    {session_id}__{YYYY-MM-DD}.json          ← one per (session, day)
  digests/
    day/{YYYY-MM-DD}.json                    ← cached for past days only
    (week/month/project/session reserved; not written in Phase 1+2)
  perception-state.json                       ← daemon checkpoint
  llm-spend.jsonl                             ← append-only per-call spend record
```

### Storage invariants (stated once)

- **Atomic writes.** All writes to files under `~/.cclens/capsules/` and `~/.cclens/digests/` use the pattern *write-to-temp + fsync + rename*. Readers never observe half-written JSON.
- **Capsule file lifecycle.** A Capsule file is written at most **twice**:
  1. **Initial write** — deterministic fields populated, `enrichment.status = "pending"` (or `"skipped_trivial"` for trivials, in which case there is no second write).
  2. **Finalization write** — enrichment completes with status `"done"` or `"error"`.
  After the finalization write, the file is **immutable** as long as `version === CURRENT_SCHEMA_VERSION`. A schema version bump is the sole permitted regeneration trigger; regeneration produces a full replacement via the atomic write-rename pattern.
- **Day digest cache.** Past-day digests (whose `local_day` is strictly before today in the reader's TZ) are cached on disk and immutable once written. Today's digest is never persisted — it lives in an in-memory TTL cache (10 minutes) in the web server process and is recomputed on expiry.
- **Missing capsule references.** When a DayDigest's `capsule_refs` includes a Capsule file that cannot be read (deleted, corrupted), the digest builder filters the reference out, logs a warning, and proceeds. If zero Capsules remain, the digest is not generated and the route returns 404 with a message.

## Capsule-per-day case handling

| Case | Resolution |
|---|---|
| Single session, single day | One Capsule. Enrichment characterizes the whole session. |
| Multiple sessions, single day | N Capsules, same `local_day`. Day digest aggregates. |
| Single session, multiple days | N Capsules with shared `session_id`, different `local_day`. A session-digest view (Phase 3) stitches them. |
| Multiple sessions, multiple days | M×N Capsules. Each day digest reads that day's Capsules independently. |
| Session spans midnight | Events before midnight go to that day's Capsule; events at/after to the next. Each Capsule's `active_min` reflects only its day's events. Trivial Capsules dropped. |
| Trivial slice | `numbers.active_min < 1` AND `numbers.turn_count < 3` AND `numbers.tools_total === 0` → Capsule stored with `enrichment.status = "skipped_trivial"`, no LLM call, immutable from first write. |
| Resumed session with old context | Only events on target day enter that day's Capsule. Old history invisible — correct, because the user isn't doing that work today. |
| In-flight day (today, before midnight) | Today's Capsules have `enrichment.status = "pending"` until daemon finalizes them AFTER the day closes. Today's digest (in-memory TTL) uses whatever enrichment state exists at request time; may show partial narrative. |
| In-flight session on a completed day | Yesterday's Capsule for that session is finalizable once yesterday closes (boundary passed). Today's Capsule for the same session is independent and stays pending until today closes. |
| Concurrency on a day | Per-session Capsules are independent. `DayDigest.concurrency_peak = aggregateConcurrency(bursts, {start: startOfLocalDay(date), end: endOfLocalDay(date)}).peak`. |
| Session spans weeks | Capsules split cleanly by `local_day`. Week boundary is a grouping concern, not a storage concern. |
| Session touches multiple projects (rare) | Capsule records dominant project (see Project determination above). |
| Failed/incomplete LLM enrichment | Capsule finalized with `enrichment.status = "error"` and `error` message set. Day digest uses deterministic aggregates and marks the slice in `narrative` as "couldn't summarize" only if the LLM is asked to produce narrative; otherwise silent. Retried on next daemon sweep up to 3 times with exponential backoff, then left permanently in `error`. |
| Deleted/corrupted JSONL | Capsule already on disk continues to be used. If never generated, cannot be rebuilt — system skips. |
| Late-flush events past midnight | Daemon waits 30 minutes after local midnight before finalizing a day's Capsules, guarding against late appends. If a late append arrives after finalization, the Capsule is permanently stale — accepted tradeoff; rare in practice. |
| Schema version bump | Daemon detects `version !== CURRENT_SCHEMA_VERSION` on read, queues regeneration, atomically overwrites via write-rename. Documented as the ONLY permitted rewrite. Changes to the trivial threshold or goal-category taxonomy require a schema bump to take effect (they alone do not trigger regeneration of already-written `skipped_trivial` or `done` Capsules). |

## Generation pipeline

```
~/.claude/projects/**/*.jsonl (source of truth, never modified by Fleetlens)
        │
        ▼
[parser.ts parseTranscript → SessionDetail]                 (existing)
        │
        ▼
[capsuleBuilder.groupByDay(sessionDetail) → Capsule[]]      (NEW, deterministic)
        │   Initial write: enrichment.status = "pending" or "skipped_trivial"
        ▼
~/.cclens/capsules/{session_id}__{day}.json
        │
        ▼   (daemon sweep; only for non-trivial, settled-day Capsules)
[capsuleEnricher.enrich(capsule) → enriched Capsule]        (NEW, LLM, one call)
        │   Finalization write: enrichment.status = "done" or "error"
        ▼
~/.cclens/capsules/{...}.json (replaced atomically)
        │
        ▼   (on digest request for past day, or daemon schedules after all day's capsules finalized)
[dayDigestBuilder.build(capsules_for_day) → DayDigest]      (NEW)
        │   Deterministic aggregations first, then ONE LLM call for narrative
        ▼
~/.cclens/digests/day/{day}.json   (or in-memory TTL for today)
```

### Deterministic capsule build

Rebuilds when the underlying JSONL has grown past `source_checkpoint.byte_offset`. Uses the existing `parseTranscript` + a new `groupByDay` that partitions events by local-day, then runs per-day aggregations mirroring the existing `SessionCapsule` number computations but clipped to that day's active segments. Output: a Capsule per day that the session touches, with `source_checkpoint` updated to the file's current size.

### LLM enrichment (per Capsule)

Input to LLM:
- The Capsule's deterministic fields (numbers, flags, top_tools, first_user, final_agent)
- Up to 8 filtered human-only turns from the slice (per `user_input_sources.human`), each truncated to 300 chars
- `pr_titles`, `skills`, `subagents`

Output: the 7 LLM-generated fields in `enrichment`, validated against a Zod schema. On parse failure, retry once with a "return valid JSON only" reminder, then fail with `status = "error"`.

Cost target: ~$0.001 per Capsule with Sonnet 4.6.

### Day digest synthesis

Deterministic aggregations computed from Capsules (no LLM):
- `projects` — sum active_min by canonical project, compute share_pct
- `shipped` — `capsules.flatMap(c => c.pr_titles.map(t => ({title: t, project: c.project, session_id: c.session_id})))`
- `top_flags` — count flag occurrences across Capsules, top 5
- `top_goal_categories` — sum enrichment.goal_categories across non-pending Capsules, top 5
- `concurrency_peak` — `aggregateConcurrency(bursts, {start: startOfLocalDay(date), end: endOfLocalDay(date)}).peak` (start/end are `Date` objects at local-midnight boundaries; `aggregateConcurrency` is declared in `packages/parser/src/aggregate.ts`)
- `agent_min` — `sum(capsules.map(c => c.numbers.active_min))`

Single LLM call for narrative fields: input is deterministic aggregations + up to 12 Capsule brief_summaries + top 6 friction_details + up to 10 aggregated user_instructions. Output: `headline`, `narrative`, `what_went_well`, `what_hit_friction`, `suggestion`.

When `ai_features.enabled === false`, skip the LLM call and set all 5 narrative fields to `null`. The page renderer shows the deterministic-template headline (see below) and hides the `narrative`, `what_went_well`, `what_hit_friction`, `suggestion` sections entirely — replaced by a single inline prompt card: *"Enable AI features in Settings to see daily narratives."* No empty headers, no placeholder prose.

## Daemon integration

**Where the worker runs.** Inside the existing long-lived daemon process (`packages/cli/src/daemon-worker.ts` equivalent). A single sequential loop, not parallel processes. This removes the need for cross-process file locks.

**Sweep cadence.** Every 5 minutes:

1. **Rebuild deterministic Capsules.** For each Claude Code JSONL file whose current size > last `perception-state.json` checkpoint for that file, tail-parse new events, recompute affected Capsules (the current-day Capsule for that session, plus the previous-day Capsule if today is within 30 min of midnight). Write initial Capsule files atomically.
2. **Queue enrichment candidates.** Any Capsule with `enrichment.status ∈ {"pending", "error"}` (retry count < 3) AND whose `local_day` is settled (strictly before today in local TZ, with ≥ 30 min of no activity) AND not `"skipped_trivial"`.
3. **Consume queue sequentially** at up to 3 concurrent LLM calls. Each call respects the budget guard (see below). On success, finalize the Capsule via atomic write-rename. On failure, increment retry count and leave for next sweep.
4. **Day digest scheduling.** When all non-trivial Capsules for a day reach `enrichment.status ∈ {"done", "error"}`, queue a single LLM call to synthesize the DayDigest; write atomically to `digests/day/{YYYY-MM-DD}.json`.

**Re-entry guard.** A sweep records its start time to `perception-state.json`. If a sweep discovers the previous sweep's start time is less than 5 minutes ago and `perception-state.json.sweep_in_progress === true`, it returns immediately. On graceful shutdown, the daemon resets the flag; on crash, a stale flag is detected by a 15-minute wall-clock timeout.

**Checkpoint file.** `~/.cclens/perception-state.json`:

```json
{
  "sweep_in_progress": false,
  "last_sweep_started_at": "2026-04-22T14:00:00Z",
  "last_sweep_completed_at": "2026-04-22T14:00:23Z",
  "file_checkpoints": {
    "/Users/cowcow02/.claude/projects/abc/{session_id}.jsonl": {
      "byte_offset": 123456,
      "last_event_ts": "2026-04-22T13:58:42Z",
      "affects_days": ["2026-04-21", "2026-04-22"]
    }
  }
}
```

## LLM budget coordination across processes

The web server and the daemon are separate Node processes. Both issue LLM calls (web for today's digest generation + V1 insights; daemon for Capsule enrichment and past-day digest synthesis).

**Budget file.** `~/.cclens/llm-spend.jsonl` — append-only, one JSON record per LLM call:

```json
{"ts":"2026-04-22T14:00:01Z","caller":"daemon","model":"claude-sonnet-4-6","input_tokens":1200,"output_tokens":480,"cost_usd":0.0108,"kind":"capsule_enrich","ref":"{sid}__2026-04-21"}
```

**Spend read.** Any process computing "month-to-date" scans records since the month start (cheap — JSONL with one record per call, ~1000 records/month for a heavy user). The `current_month_spend_usd_cache` field in settings.json is a projection updated whenever settings are read; `current_month_spend_usd_as_of` timestamps the projection so stale caches are detectable.

**Interactive priority.** When the web server begins a user-initiated LLM request (today's digest or insights page), it writes a presence file `~/.cclens/llm-interactive.lock` with its PID. The daemon, before issuing a new LLM call, checks for this file; if present and fresh (mtime within 60s), daemon pauses for 30s. The web server removes the file when its request completes. Stale locks (PID not alive or mtime >60s old) are ignored.

**Budget cap.** If `ai_features.monthly_budget_usd` is set and the computed month-to-date spend exceeds it, the daemon pauses all LLM calls and the web server surfaces a "budget reached" indicator. User-initiated requests still fire unless `enforce_hard_budget` is set (not in Phase 1+2).

## Package structure

```
packages/capsules/                             ← NEW, Node-only
  src/
    index.ts                                   types only, safe for browser via subpath
    types.ts                                   Capsule, DigestEnvelope, DayDigest
    build.ts                                   SessionDetail → Capsule[] (deterministic, pure)
    signals.ts                                 satisfaction/source/instruction regex (pure)
    trivial.ts                                 trivial threshold checks (pure)
    storage.ts                                 ~/.cclens/* reads + atomic writes (Node-only)
    enrich.ts                                  capsule → LLM → enriched Capsule (Node-only)
    digest-day.ts                              Capsules → DayDigest (Node-only, calls LLM)
    prompts/
      enrich.ts                                enrichment prompt template
      digest-day.ts                            day-digest prompt template
  package.json                                 declares "exports" with subpaths:
                                                 "." → types only
                                                 "./fs" → storage
                                                 "./node" → enrich + digest-day
```

**Import rules (documented at top of each module):**

- `packages/capsules` (the root index) exports types only. Safe to import from anywhere, including browser components.
- `packages/capsules/fs` exports `storage.ts`. Node-only. Imported by `packages/cli/**` and `apps/web/lib/capsules.ts` (server-only module).
- `packages/capsules/node` exports `enrich.ts` and `digest-day.ts`. Node-only. Imported ONLY by `packages/cli/**` and `apps/web/lib/ai/digest-day-gen.ts` (server-only, used by the `/api/digest` route).
- Next.js is configured to treat `packages/capsules/fs` and `packages/capsules/node` as server-only via the `server-only` marker package imported at the top of each.

```
packages/parser/                               ← UNCHANGED in Phase 1+2
  src/capsule.ts                               SessionCapsule — stays, used by V1 insights
  src/aggregate.ts                             PeriodBundle — stays, used by V1 insights

packages/cli/                                  ← Phase 1+2 additions
  src/
    commands/capsules.ts                       fleetlens capsules
    commands/digest.ts                         fleetlens digest day
    daemon/perception-worker.ts                loop inside existing daemon process
    daemon/budget.ts                           llm-spend.jsonl read/append

apps/web/                                      ← Phase 2 additions
  app/digest/[date]/page.tsx                   new route
  app/digest/[date]/loading.tsx
  components/day-digest.tsx                    presentational
  lib/capsules.ts                              server-only: reads storage via packages/capsules/fs
  lib/ai/digest-day-gen.ts                     server-only: calls packages/capsules/node for today's digest
  app/api/digest/day/[date]/route.ts           GET: today → regen; past day → read cache or 404
  app/settings/page.tsx                        (existing or new) adds AI Features section
```

## Route behavior (`/api/digest/day/[date]`)

- **Today (date === today in server's local TZ):** compute deterministic aggregations from current Capsules; if `ai_features.enabled`, call LLM for narrative (or serve from in-memory 10-min TTL cache); return 200.
- **Past day with cached digest:** read `~/.cclens/digests/day/{date}.json`; return 200.
- **Past day without cached digest:** two-mode behavior:
  - Default (GET): return 202 with a JSON body `{status: "queued", eta_seconds: null}` and enqueue a daemon job to backfill. A hint in the response tells the UI to poll.
  - With query param `?generate=1`: synchronously generate, write cache, return 200. Used by a "Generate" button in the UI.
- **Future day:** return 400 Bad Request.

This resolves the earlier contradiction (past days with no cache returning 404 while some past days had cached immutable digests). The new behavior: 404 is never returned for a valid past date; it's 200 (cached), 202 (queued), or 200 with synchronous generation.

## CLI command surface

```
fleetlens capsules [--day YYYY-MM-DD | --session UUID | --all] [--json]
fleetlens capsules regenerate [--since YYYY-MM-DD] [--force]
fleetlens digest day [--date YYYY-MM-DD | --yesterday | --today] [--json | --pretty]
```

By default reads-only. The `capsules regenerate` subcommand and synchronous digest generation for today/uncached past days trigger LLM work. Respects the same budget guard as the daemon.

## Settings surface

New section in `/settings` (and `~/.cclens/settings.json`):

```json
{
  "ai_features": {
    "enabled": false,
    "anthropic_api_key": "…",
    "model": "claude-sonnet-4-6",
    "allowed_projects": ["/Users/cowcow02/Repo/claude-lens"],
    "monthly_budget_usd": null,
    "current_month_spend_usd_cache": 0.0,
    "current_month_spend_usd_as_of": "2026-04-22T14:00:00Z"
  }
}
```

- Default: `enabled: false`. First visit to `/digest/*` prompts the user to enable.
- `allowed_projects`: explicit allow-list of **canonical** project paths (matching `canonicalProjectName`). Enrichment never fires for Capsules whose `project` is not in this list. Empty list = no enrichment. The Settings UI lists canonical projects (matching the Projects page rollup with a worktree-count badge); enabling one canonicalizes the selected path before writing to storage. Worktrees roll up to their canonical; users enabling a project implicitly enable all its worktrees.
- Budget: soft cap in Phase 1+2; breach pauses daemon and surfaces a UI warning.
- `anthropic_api_key`: stored in plaintext in `~/.cclens/settings.json` (chmod 600). Env var `ANTHROPIC_API_KEY` is fallback when the settings field is empty.

## Privacy posture

- **Local-first remains true for the deterministic layer.** All existing Fleetlens behavior works with no API key configured.
- **LLM enrichment is opt-in per project** and requires account-level enable.
- The README updates to "local-only dashboard with opt-in AI enrichment." The `/settings` page includes a transparency block listing exactly what's sent when enrichment is on (capsule facts, up to 8 human turns per Capsule, up to 12 summaries + 6 friction lines per day-digest call — never raw full transcripts, file contents, or tool result payloads).

## Schema versioning

- `CURRENT_CAPSULE_SCHEMA_VERSION = 2` on first ship (bumped from the legacy SessionCapsule's conceptual v1 so they're distinguishable).
- `CURRENT_DAY_DIGEST_SCHEMA_VERSION = 2` on first ship.
- Schema bumps queue regeneration via the same daemon mechanism. Regeneration is the only permitted modification of a finalized Capsule file. UI can safely render v2-only; no multi-version rendering needed.

## Testing strategy

**Unit (`packages/capsules/test/`):**
- `build.test.ts` — fixture SessionDetail spanning midnight produces expected Capsules keyed by (session, day) with correct `active_min` clipping; projection through canonicalProjectName; trivial-threshold behavior.
- `signals.test.ts` — regex detection of satisfaction / source / instructions against text fixtures.
- `trivial.test.ts` — threshold edge cases around 0/1/2 events.
- `storage.test.ts` — write-to-temp + rename atomicity (simulate crash between temp-write and rename); version mismatch detection; corrupted-file parse error yields documented behavior.
- `enrich.test.ts` — happy path with mock LLM; retry-once on bad JSON; three-failure-then-error state; cost tracking write to llm-spend.jsonl.
- `digest-day.test.ts` — deterministic aggregations exact-match for a fixture day; LLM-null-path renders placeholder fields; shipped list derivation matches capsule.pr_titles.

**Integration:**
- CLI-vs-web parity: `fleetlens capsules --day X --json | jq '.[0]'` byte-equal to the Capsule loaded by `/api/digest/day/X` server code for the first Capsule of the day.
- Smoke (`scripts/smoke.mjs`): `/digest/yesterday` returns 200 and contains the deterministic-template headline even when `ai_features.enabled === false`.
- V1 insights regression: `/api/insights/week` output for a fixture week is byte-equal before and after Phase 1+2 lands. Guards against accidental modification of V1 code path.

## Performance

- Deterministic Capsule build: O(events), unchanged asymptotic from existing `buildCapsule`. A 1M-line JSONL ~1s.
- Capsule files: 3–8 KB each. 1000 Capsules ≈ 5 MB disk.
- Enrichment: Sonnet input ~2 KB, output ~500 B; ~$0.001/call. 50 Capsules/day ≈ $0.05/day ≈ $1.50/month for a heavy user. A fleet-orchestration user with 5 concurrent agents × 3 days × 5 sessions = 75 Capsules/day ≈ $2.25/month.
- Day digest: Sonnet input ~5 KB, output ~800 B; ~$0.002/call. 30 days ≈ $0.06/month.
- **Scales linearly in Capsule count; heaviest realistic monthly cost ~$5** — well under the Claude Code Max plan's noise floor.

## Rollout

1. Land `packages/capsules/` types + build + signals + trivial + storage. Ship with enrichment/digest code present but gated by `ai_features.enabled`. No UI changes.
2. Land daemon perception worker (dry-run mode: logs what it would enrich, doesn't call LLM unless enabled).
3. Land settings UI + `/digest/[date]` page + CLI commands.
4. Announce in release notes. Users enable per-project in settings.
5. Phase 3 (separate spec): integrate Capsules into Timeline, Session Detail, Calendar, Projects pages.
6. Phase 4 (separate spec): V2 weekly/monthly insights report reading Capsules. Only at this point do we retire `SessionCapsule` from `packages/parser/src/capsule.ts` (replaced by a Capsule-based aggregator).

## Out of scope in Phase 1+2

- Timeline / session-detail / calendar / projects integration — Phase 3.
- Week / month / project / session digests — Phase 4 and Phase 3.
- V2 weekly insights report — Phase 4.
- Team Edition multi-user digests — separate spec, builds on this one.
- Local-model enrichment fallback (Ollama etc.) — not shipped; may be revisited.
- Search / semantic retrieval over Capsules — future.
- Trend detection / anomaly alerts — future.
- Hard budget enforcement (`enforce_hard_budget` flag) — future.
- Live (in-flight) Capsule enrichment — enrichment only runs on settled days.

## Open questions (resolved after review)

All four open questions from the first revision are now resolved in-spec:

1. Trivial threshold → `active_min < 1` AND `turn_count < 3` AND `tools_total === 0`. Keep.
2. Enrichment in separate file → NO; one file, overwritten atomically at most twice.
3. Today's digest TTL → 10 minutes in-memory, never persisted.
4. `user_input_sources.human` field name → keep as-is; it's a filter category.

---

**Next steps:** user sign-off on this spec → invoke `writing-plans` skill to produce an implementation plan → begin Phase 1 implementation.
