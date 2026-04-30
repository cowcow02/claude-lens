# Fleetlens Perception Layer — Phase 1b Design

**Status:** Draft
**Date:** 2026-04-22
**Author:** Brainstormed with user 2026-04-22
**Ships:** LLM enrichment of Entry perception artifacts. Populates the six `enrichment.*` fields that Phase 1a left as `pending`. Rolls in Phase 1a's two follow-ups.
**Depends on:** Phase 1a (branch `feat/v2-perception-insights`), specifically `packages/entries/` deterministic layer + daemon perception worker.
**Coexists with:** V1 `/insights` remains untouched — regression-guarded by `scripts/v1-insights-regression.mjs`. Phase 4 (separate spec) eventually retires V1.
**Release strategy:** Bundled into a single V2 release alongside Phase 1a, Phase 2 (digest page), and Phase 4 (V2 insights). No intermediate master merges; all work continues on `feat/v2-perception-insights`.

---

## Overview

Phase 1a shipped deterministic Entries — every `(session × local-day)` pair becomes a structured artifact on disk at `~/.cclens/entries/{session_id}__{YYYY-MM-DD}.json`. Six fields inside the Entry's `enrichment` object stay `null` / `pending`:

- `brief_summary` (one-sentence characterization)
- `underlying_goal` (what the user was trying to do)
- `friction_detail` (one sentence if friction occurred, else null)
- `outcome` (`shipped` | `partial` | `exploratory` | `blocked` | `trivial`)
- `claude_helpfulness` (`essential` | `helpful` | `neutral` | `unhelpful`)
- `goal_categories` (**schema change: now minutes, not counts**)

Phase 1b fills those in via a per-Entry Sonnet 4.6 call run by the daemon in the background. Adds settings + budget tracking + a regenerate CLI command. Folds in two follow-ups from Phase 1a.

## Schema change: `goal_categories` counts → minutes

### Why

`Partial<Record<GoalCategory, number>>` was specified as "count of user asks per goal" mirroring Anthropic's `/insights`. That's wrong for the product. A single 60-minute plan ask outweighs ten 3-minute build asks, but count-based aggregation reports the opposite. The user explicitly requested proportional-time distribution across goals for window-level aggregation.

### What changes

`packages/entries/src/types.ts`:

```ts
export type EntryEnrichment = {
  // ... other fields unchanged ...
  goal_categories: Partial<Record<GoalCategory, number>>;  // VALUES ARE MINUTES
                                                           // sum MUST be ≤ active_min
                                                           // unclassified time stays implicit

  // NEW in 1b: bounded retry counter so a permanently-failing Entry doesn't
  // loop forever across daemon restarts. Incremented on each error write.
  // An Entry with retry_count >= 3 AND status === "error" is frozen —
  // the queue never retries it unless --force is passed.
  retry_count: number;                                     // starts at 0
};
```

`pendingEnrichment()` and `skippedTrivialEnrichment()` both return `retry_count: 0` on construction. For the 429 existing Phase 1a Entries on disk, `retry_count` will be missing (undefined) — treat undefined as 0 at read time in a one-line shim (`entry.enrichment.retry_count ?? 0`). This is the only pseudo-migration required.

Fixed 11-category taxonomy unchanged: `build | plan | debug | review | steer | meta | research | refactor | test | release | warmup_minimal`.

### Migration

None needed — no Phase 1a Entries have populated `goal_categories` (all still `{}`). We're pre-release, existing Entries on disk are deterministic-only. Enrichment is the first thing to write meaningful values.

### Aggregation pattern

For any window of Entries:

```ts
const goalMinutes: Record<GoalCategory, number> = {};
for (const e of entriesInWindow) {
  for (const [goal, min] of Object.entries(e.enrichment.goal_categories ?? {})) {
    goalMinutes[goal] = (goalMinutes[goal] ?? 0) + min;
  }
}
// Derive percentages by dividing by sum. Trivial.
```

## Pipeline architecture

```
┌─ Phase 1a (shipped): deterministic Entry with enrichment.status = "pending" ─┐
└─────────────────────────┬─────────────────────────────────────────────────────┘
                          ▼
┌─ Daemon perception worker (extended) ────────────────────────────────────────┐
│                                                                               │
│  existing deterministic sweep (unchanged)                                     │
│  ↓                                                                            │
│  enrichment queue phase (NEW):                                                │
│    for each Entry on disk where:                                              │
│        status === "pending" OR (status === "error" AND retry_count < 3)       │
│      if local_day IS today → skip                                             │
│      if last_event_ts within 30 min of now → skip                             │
│      if entry.project NOT in settings.allowed_projects → skip                 │
│      if month_to_date_spend ≥ monthly_budget_usd → break (pause queue)        │
│      result = await enrichEntry(entry, apiKey, model)                         │
│      writeEntry(result)                             // atomic replace         │
│      appendSpend(result.cost_usd, ...)              // ~/.cclens/llm-spend.jsonl │
│  ↓                                                                            │
│  retry-on-error:                                                              │
│    On enrich failure: increment retry_count, set status="error",              │
│    write back atomically.                                                     │
│    Next sweep eligibility: status="error" AND retry_count < 3 re-eligible.    │
│    After 3 failures, Entry stays permanently "error" — only the CLI           │
│    `fleetlens entries regenerate --force` can reset and retry it.             │
│    Re-read month_to_date_spend each iteration (no in-memory cache).           │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Components

### `packages/entries/src/enrich.ts` (NEW, Node-only)

```ts
export type EnrichOptions = {
  apiKey: string;
  model?: string;  // default "claude-sonnet-4-6"
};

/** Enrich a pending Entry in place. Returns the finalized Entry with
 *  enrichment.status in {"done", "error"}. Does NOT persist — caller calls writeEntry. */
export async function enrichEntry(entry: Entry, opts: EnrichOptions): Promise<Entry>;
```

Internally: builds the prompt input from `entry`, calls Anthropic API via `@anthropic-ai/sdk`, validates output with Zod, merges into `entry.enrichment`, sets `status`, `generated_at`, `model`, `cost_usd`, `error`. Handles parse failures by retrying the API call once with a "return valid JSON only" reminder before marking `error`.

### `packages/entries/src/prompts/enrich.ts` (NEW)

Houses the prompt template (shape locked; exact copy in the Prompt section below) and the Zod schema for response validation.

### `packages/entries/src/fs.ts` — one new helper

Add a `listEntriesWithStatus` helper that the enrichment queue and CLI share:

```ts
/** Read every Entry whose enrichment.status is one of the listed values.
 *  Order by local_day ascending (oldest first — backfill-friendly). */
export function listEntriesWithStatus(
  statuses: EntryEnrichmentStatus[],
): Entry[];
```

Implementation: iterate `listEntryKeys()` → `readEntry()` → filter in-memory by `status`. At ~1000 Entries total for a heavy user, the O(n) scan is fine; no index required. If scale exceeds 10k Entries (hypothetical), revisit with an index file.

### `packages/entries/src/budget.ts` (NEW, Node-only)

```ts
export type SpendRecord = {
  ts: string;
  caller: "daemon" | "cli" | "web";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  kind: "entry_enrich" | "day_digest";  // day_digest reserved for Phase 2
  ref: string;                            // entry key or digest key
};

export function appendSpend(record: SpendRecord): void;   // append-only to ~/.cclens/llm-spend.jsonl
export function monthToDateSpend(now?: Date): number;      // sum since month start
export function __setSpendPathForTest(path: string): void;
```

Month-to-date is a scan — ~1000 records/month heaviest case, trivially cheap.

### `packages/entries/package.json` — new `./node` subpath

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./fs": {
    "types": "./dist/fs.d.ts",
    "import": "./dist/fs.js"
  },
  "./node": {
    "types": "./dist/node.d.ts",
    "import": "./dist/node.js"
  }
}
```

`dist/node.js` re-exports `enrich.ts` + `budget.ts`. At the top of `src/node.ts` add `import "server-only";` which Next.js intercepts to throw at build time if this module is imported from a client component.

Scope of protection: `server-only` guards the Next.js client bundle only. It does NOT prevent server-to-server imports (RSC → daemon worker is fine; web server route handler → `./node` is fine). Importing from a `"use client"` component would throw. `./fs` is not given this marker because `node:fs` already breaks in a browser naturally — redundant.

Root `./` subpath index stays unchanged (types + pure functions only, browser-safe). `./fs` unchanged (Node-only storage). `./node` is new (Node-only LLM code, explicitly client-guarded).

### `packages/cli/src/perception/worker.ts` — enrichment queue phase

Adds a second pass after the existing deterministic sweep:

```ts
async function runEnrichmentQueue(settings: AiFeaturesSettings): Promise<EnrichmentResult> {
  if (!settings.enabled) return { skipped: "disabled" };
  if (!settings.apiKey) return { skipped: "no_api_key" };
  if (settings.allowedProjects.length === 0) return { skipped: "no_allowed_projects" };
  if (monthToDateSpend() >= (settings.monthlyBudgetUsd ?? Infinity)) return { skipped: "budget_cap" };

  // Oldest-first so backfill fills in history chronologically.
  const queue = listEntriesWithStatus(["pending", "error"])
    .filter(e => (e.enrichment.retry_count ?? 0) < 3);

  let enriched = 0, errors = 0, skipped = 0;
  const todayLocal = toLocalDay(Date.now());

  for (const entry of queue) {
    if (entry.local_day === todayLocal) { skipped++; continue; }
    if (Date.now() - Date.parse(entry.end_iso) < 30 * 60 * 1000) { skipped++; continue; }
    if (!settings.allowedProjects.includes(entry.project)) { skipped++; continue; }
    // Re-read spend each iteration — no in-memory cache — so long backfills
    // that cross the budget mid-run correctly halt on the right Entry.
    if (monthToDateSpend() >= (settings.monthlyBudgetUsd ?? Infinity)) break;

    try {
      const result = await enrichEntry(entry, { apiKey: settings.apiKey, model: settings.model });
      writeEntry(result);                              // atomic replace
      if (result.enrichment.status === "done") {
        enriched++;
        appendSpend({
          ts: new Date().toISOString(),
          caller: "daemon",
          model: result.enrichment.model!,
          input_tokens: /* from SDK response */,
          output_tokens: /* from SDK response */,
          cost_usd: result.enrichment.cost_usd ?? 0,
          kind: "entry_enrich",
          ref: `${result.session_id}__${result.local_day}`,
        });
      } else {
        errors++;  // retry_count already incremented inside enrichEntry
      }
    } catch (err) {
      // Thrown errors (network, unexpected SDK) — increment retry_count and write status=error.
      const failed = { ...entry, enrichment: { ...entry.enrichment,
        status: "error" as const,
        retry_count: (entry.enrichment.retry_count ?? 0) + 1,
        error: (err as Error).message,
        generated_at: new Date().toISOString(),
      }};
      writeEntry(failed);
      errors++;
    }
  }

  return { enriched, errors, skipped };
}
```

Called inside `runPerceptionSweep` after the deterministic phase. Uses the same sweep-in-progress guard and SIGTERM cleanup already in place.

### Settings shape

`~/.cclens/settings.json`:

```json
{
  "ai_features": {
    "enabled": false,
    "anthropic_api_key": "",
    "model": "claude-sonnet-4-6",
    "allowed_projects": [],
    "monthly_budget_usd": null
  }
}
```

Readers: `packages/cli/src/settings.ts` (NEW tiny helper) + web route for the settings page. `ANTHROPIC_API_KEY` env var is the fallback when the field is empty.

**Concurrency posture.** Two processes can read/write `settings.json`: the web server (on settings-form submit) and the daemon (periodic read at sweep start). Writes use the atomic write-tmp + rename pattern already established for Entry files. If a submit-from-web and a daemon-read-at-sweep race, the daemon either reads the old value (next sweep picks up the new one) or the new value — never a partial write. There's no lock; last-writer-wins is acceptable because the only concurrent writer is the web form, one user at a time. Document at the top of `settings.ts`.

### Web settings surface

`/settings` gets an "AI Features" section with four controls:

- Toggle: `Enable Entry enrichment`
- Text input: `Anthropic API key` (paste or leave blank to use env var)
- Multi-select: `Projects to enrich` (populated from the Projects page data; stores canonical paths)
- Number input: `Monthly budget cap (USD)` — optional; empty = no cap

Below: a small "month-to-date spend" indicator computed from `~/.cclens/llm-spend.jsonl`.

Minimal styling — this is still on the feature branch, polish waits until V2 ships.

### CLI: `fleetlens entries regenerate`

```
fleetlens entries regenerate [--since YYYY-MM-DD] [--force] [--json]
```

- `--since D` → only re-enrich Entries with `local_day >= D`
- `--force` → re-enrich targeted Entries regardless of current status. **This is an explicit operator override of the Entry immutability invariant** (Phase 1a spec: "immutable once `enrichment.status ∈ {done, error, skipped_trivial}`"). Semantically: `--force` resets matched Entries to `enrichment.status = "pending"` AND `retry_count = 0` before running the queue. Without `--force`, the regenerate command only picks up queueable Entries (status=pending, or status=error with retry_count<3) — same set the daemon processes.
- `--json` → machine-readable progress report

Shares the `runEnrichmentQueue` function with the daemon. Honors all gates (enabled, allowlist, budget). Exits with `0` on success, `2` if `ai_features.enabled` is false, `3` if budget exceeded mid-run.

## Folded-in Phase 1a follow-ups

### Fix 1: `orchestrated` flag aligned to V1 parity

Currently in `packages/entries/src/build.ts`, the `orchestrated` flag fires when `subagent_calls >= 3` (total dispatches). V1's `buildCapsule` uses `subagent_turns >= 3` (turns that dispatched at least one agent). These diverge: one mega-orchestration turn with 5 parallel agents triggers our current implementation but not V1's.

**Fix:** Track a per-Entry `subagent_turns` counter during the day-scoped aggregation. Change the flag predicate to `subagent_turns >= 3`. Update the relevant build test.

Also update the `Entry` type? **No** — `subagent_turns` is only used for the flag; we don't need to store it on the Entry. Compute-and-discard inside `aggregateDay` (the actual function name in the current codebase at `packages/entries/src/build.ts`; the early spec drafts called it `aggregatePerDay`).

### Fix 2: Injectable projects root for worker tests

Currently `listAllSessionJsonls()` in `packages/cli/src/perception/scan.ts` hard-codes `~/.claude/projects/`. Tests can't inject a fixture directory.

**Fix:** Signature change:

```ts
export async function listAllSessionJsonls(root?: string): Promise<string[]> {
  const projectsRoot = root ?? join(homedir(), ".claude", "projects");
  // ... existing logic ...
}
```

`worker.ts` caller: add an optional `opts.projectsRoot` param to `runPerceptionSweep()` that threads through.

Add a worker integration test that mounts a fixture JSONL in a tmp dir and asserts the sweep produces the expected Entry file.

## Prompt

Lean, single JSON output, Zod-validated:

```
You are analyzing one (session × local-day) slice of a developer's Claude Code work.

Given deterministic facts + up to 8 human-filtered turns, extract structured facets.

CRITICAL RULES:

1. goal_categories.{goal}: MINUTES spent on this goal in this slice.
   - Sum across all goals MUST be ≤ active_min.
   - Unclassified time stays implicit — do not pad.
   - Fixed taxonomy: build, plan, debug, review, steer, meta, research,
     refactor, test, release, warmup_minimal.
   - Use WHOLE-MINUTE granularity (0.5-min values OK; finer is noise).

2. user_instructions: 2-5 load-bearing explicit asks. Short phrasings.
   Copy the user's words; do NOT paraphrase.

3. friction_detail: ONE sentence if the user pushed back, got a broken
   result, had to redirect, or expressed frustration. Null if smooth.

4. outcome: shipped | partial | exploratory | blocked | trivial.
   - shipped: PR merged or code committed-and-pushed
   - partial: real progress, not yet shipped
   - exploratory: research / design / no deliverable
   - blocked: hit a wall, work halted
   - trivial: < 1 min of real work

5. claude_helpfulness: essential | helpful | neutral | unhelpful.
   Base on observed user satisfaction signals and outcome.

6. brief_summary: ONE sentence, second-person, concrete.
   Good: "You shipped the Team Edition timeline after two subagent retries."
   Bad:  "This session involves work on the dashboard."

7. underlying_goal: what the user was TRYING to accomplish, not what they did.

RESPOND WITH ONLY VALID JSON (no prose, no code fence):

{
  "brief_summary": "...",
  "underlying_goal": "...",
  "friction_detail": "..." | null,
  "user_instructions": ["...", "..."],
  "goal_categories": {"build": N, "plan": N, ...},
  "outcome": "shipped" | "partial" | "exploratory" | "blocked" | "trivial",
  "claude_helpfulness": "essential" | "helpful" | "neutral" | "unhelpful"
}

SLICE FACTS:
{active_min, turn_count, tools_total, subagent_calls, skill_calls,
 flags, primary_model, pr_titles, top_tools, first_user, final_agent,
 satisfaction_signals, user_input_sources}

HUMAN TURNS (up to 8, each truncated to 300 chars):
1. ...
2. ...
```

Prompt input composed from Entry fields + filtered human-only user events (via `classifyUserInputSource` === "human"), each truncated to 300 chars, first 8 turns by order.

## Cost targets (per spec)

- **Backfill (one-time):** 431 existing Entries × ~$0.001 each = **~$0.43**. Runs once when the daemon first sees `ai_features.enabled = true`.
- **Steady-state:** ~15 new settled Entries/day × $0.001 = **~$0.45/month** per user.
- **Heavy-user ceiling:** fleet-orchestration user with 75 Entries/day = **~$2.25/month**.

Anthropic SDK defaults with no custom caching yet. Prompt caching for the system prompt can be added as follow-up but isn't load-bearing.

## Testing strategy

### Unit tests

- `prompts/enrich.test.ts` — Zod schema accepts valid LLM outputs; rejects malformed.
- `budget.test.ts` — append round-trips; month-to-date correctly sums only current-month records; atomic-write tmp file cleanup.
- `enrich.test.ts` (mock Anthropic client) — happy path produces finalized Entry; invalid JSON retries once; 3 failures → `status: "error"`.

### Integration tests

- Worker integration test (requires Fix 2 above): mount a tmp `projects` dir with one fixture JSONL → call `runPerceptionSweep({projectsRoot, apiKey: mockKey})` → assert Entry file exists with `status: "done"` and expected fields.
- Settings round-trip: write `ai_features.enabled=true` + apiKey → worker reads and uses.

### End-to-end smoke

- `fleetlens entries regenerate --since yesterday --json` with mock API = at least one Entry goes from `pending` to `done`.

### Regression

- V1 insights regression guard (`scripts/v1-insights-regression.mjs`) continues to pass unchanged.

## Security posture

- API key stored in plaintext at `~/.cclens/settings.json`. File permissions `chmod 600` on write. Documented in settings UI ("stored locally, never transmitted").
- Enrichment sends to Anthropic: Entry's deterministic facts + up to 8 filtered human turns (≤ 300 chars each). Never sends: raw full transcripts, file contents, tool result payloads, PII-flagged tool outputs.
- Projects are opt-in. Empty `allowed_projects` = never fire enrichment, even with `enabled=true`.

## Out of scope in Phase 1b

- `/digest/[date]` page and day-digest synthesis — Phase 2.
- Hard budget cutoff (non-soft-cap behavior). Soft cap pauses only.
- Local-model fallback (Ollama etc.) — may be revisited; not in V2.
- Prompt caching optimization.
- Retroactive schema-bump regeneration UI.
- Team Edition multi-user enrichment — separate spec.
- Per-turn enrichment (only per-Entry in Phase 1b).

## Rollout within the V2 bundled release

All work continues on `feat/v2-perception-insights`. No PRs, no master merges until V2 ships as a single coherent release that includes Phase 1a + 1b + 2 + 4.

Order of commits on the branch during 1b:

1. Schema: `goal_categories` counts → minutes
2. Fix: `orchestrated` → `subagent_turns >= 3`
3. Fix: `listAllSessionJsonls` injectable root + worker integration test
4. `budget.ts` + tests
5. `prompts/enrich.ts` + Zod schema
6. `enrich.ts` enricher + mock-LLM tests
7. `./node` subpath export + server-only marker
8. Daemon enrichment queue in `worker.ts`
9. Settings JSON schema + CLI helper
10. Web `/settings` "AI Features" section
11. `fleetlens entries regenerate` CLI subcommand

Each a separate commit. Plan document enumerates these as tasks.

## Success criteria

- All existing Phase 1a Entries can be enriched end-to-end using the developer's Anthropic API key (dogfood: the 431 Entries on disk right now).
- Enrichment cost for a 431-Entry backfill < $1 actual spend.
- `pnpm verify` continues to pass with zero V1 regression.
- Settings page loads, accepts an API key, toggles enabled, and persists across server restarts.
- `fleetlens entries regenerate --since 2026-04-15 --json` produces a progress report and writes enriched Entries.
- A single enriched Entry's `goal_categories` summed in minutes ≤ its `active_min`.
- Aggregating goal_categories across a week's Entries produces sensible per-goal totals (verified manually against one week of real data).

## Open questions

1. **Prompt caching:** Anthropic supports prompt caching with ≥ 1024-token cache hits. Our enrichment prompt system+shared-preamble is ~600 tokens — not enough alone. Adding "here are the day's other Entries' brief_summaries as context" would push over threshold and also improve quality. Not in 1b but worth flagging for Phase 4 (V2 insights) where multi-Entry context is load-bearing.

2. **Enrichment ordering:** Should the queue process oldest-first, newest-first, or by project priority? Default to oldest-first (fills in history, user sees more of their past enriched as they scroll). Document.

3. **Today's digest timing:** Phase 2's `/digest/today` wants live data, but today's Entries stay `pending`. Option: let Phase 2 live-enrich today's Entries on the `/digest/today` page visit (ephemeral, 10-min in-memory cache). Deferred to Phase 2 spec.

---

**Next step after spec review:** user sign-off → invoke `writing-plans` skill to produce the Phase 1b implementation plan on `feat/v2-perception-insights`.
