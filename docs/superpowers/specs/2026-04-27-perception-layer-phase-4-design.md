# Fleetlens Perception Layer — Phase 4 Design

**Status:** Draft
**Date:** 2026-04-27
**Author:** Brainstormed with user 2026-04-27
**Ships:**
- `WeekDigest` + `MonthDigest` types and SSE-streamed generators built on top of day digests
- `/api/digest/week/[start-date]` + `/api/digest/month/[year-month]` routes
- V2 `/insights` page (lean trajectory-first synthesis) — **hard cutover replacing V1**
- `/insights/[key]` saved-view route renderer for V2 shape
- `fleetlens digest week` + `fleetlens digest month` CLI subcommands
- V1 deletion: `SessionCapsule`, `buildPeriodBundle`, V1 prompt + report + view, `fleetlens stats`, `fleetlens capsules`, regression script
- `JobKind` extension: `monthly.synth` (joins existing `weekly.synth`)

**Depends on:** Phase 1a + 1b + 2 + 2.1 + 3 (branch `feat/v2-perception-insights`).
**Coexists with:** Nothing — V1 dies in this phase.
**Release strategy:** PR back to `feat/v2-perception-insights`. After dogfood signs off, the integration branch merges to master as the single V2 release (~v0.5.0).

---

## Overview

Phases 1–3 shipped the perception layer's primitives: every `(session × local-day)` is an `Entry`, every settled local-day collapses to a `DayDigest`, and existing surfaces (timeline, sessions, projects, heatmap, live widget) consume those signals. V1 `/insights` has continued to ship its capsule-based weekly synthesis throughout, regression-guarded by `scripts/v1-insights-regression.mjs`.

Phase 4 is the cutover. It introduces `WeekDigest` (and `MonthDigest`) which consume **day digests as input** — never raw entries, never JSONL. The chain becomes:

```
JSONL → entries (Phase 1) → day digest (Phase 2) → week digest → month digest
```

V1 `/insights` and `SessionCapsule` are deleted in the same PR. After this phase merges to the integration branch, `feat/v2-perception-insights` ships to master as a single V2 release.

## Vocabulary (still locked)

Two terms only:
- **Entry** — atomic perception artifact at `(session_id, local_day)`.
- **Digest** — narrative synthesis. Scopes: `day` (Phase 2), `week` (Phase 4), `month` (Phase 4). `project` and `session` remain reserved.

The `DigestEnvelope` shape stays. The new types extend it with their own deterministic + narrative fields.

## Why a hard cutover

User decision (recorded in brainstorm): **Option A — hard cutover at `/insights`**.

The integration branch `feat/v2-perception-insights` already serves as the safety net that "build at `/insights2` first" would have provided. V1 stays alive throughout Phases 1–3 *because the integration branch hasn't shipped*. Phase 4 is the release-critical phase — keeping V1 around inside the same release would carry transitional debt to master with no upside.

If V2 weekly synth quality is inadequate during dogfood, the fix is to revise the V2 prompt before the integration branch merges to master, not to dual-route V1 alongside.

## Cost & cadence (recorded for budget reasoning)

- Week synth: ~$0.005/call (Sonnet, ~3 KB input, ~800 B output).
- Month synth: ~$0.012/call (~5 KB input, ~1.2 KB output).
- Auto-fire happens once per ISO week per browser-side guard (see §S3). A heavy user lands on `/insights` once a Monday and pays $0.005 idle. Manual generations on top.
- Realistic worst case across the entire perception layer (entries + day + week + month) on a heavy user: **< $5/month** — under the Claude Code Max plan's noise floor.

## Data model

### Schema versioning

Add to `packages/entries/src/types.ts`:

```ts
export const CURRENT_WEEK_DIGEST_SCHEMA_VERSION = 2 as const;
export const CURRENT_MONTH_DIGEST_SCHEMA_VERSION = 2 as const;
```

### `DigestEnvelope` refactor

`entry_refs` moves out of the envelope and onto each scope-specific type. The envelope becomes scope-agnostic:

```ts
// BEFORE (Phase 1+2)
type DigestEnvelope = { version, scope, key, window, entry_refs, generated_at, is_live, model, cost_usd };
type DayDigest = DigestEnvelope & { ...day-fields };  // entry_refs inherited from envelope

// AFTER (Phase 4)
type DigestEnvelope = { version, scope, key, window, generated_at, is_live, model, cost_usd };
type DayDigest   = DigestEnvelope & { entry_refs: string[]; ...day-fields };
type WeekDigest  = DigestEnvelope & { day_refs:   string[]; ...week-fields };
type MonthDigest = DigestEnvelope & { week_refs:  string[]; ...month-fields };
```

Each scope owns its leaf-reference array. The on-disk JSON shape of an existing `DayDigest` is structurally identical (it still serializes `entry_refs` at the top level) — this is a type-only refactor. No migration of cached digests needed. Renderers needing entry-level provenance for a week click through to the day digest at `/digest/[date]`.

### `WeekDigest`

```ts
export type WeekDigest = DigestEnvelope & {
  scope: "week";
  /** ISO Monday in local TZ, e.g. "2026-04-20" — same value as envelope.key */
  day_refs: string[];                                          // 7 day-digest keys (YYYY-MM-DD)

  // ── Deterministic aggregations ──────────────────────────────
  agent_min_total: number;
  projects: Array<{
    name: string;
    display_name: string;
    agent_min: number;
    share_pct: number;
    shipped_count: number;
  }>;
  shipped: Array<{ title: string; project: string; date: string; session_id: string }>;
  /** Counts of days bucketed by their day-level outcome. Days with no entries are absent. */
  outcome_mix: Partial<Record<DayOutcome, number>>;
  /** 7 entries Mon→Sun. null where no enriched data exists for that day. */
  helpfulness_sparkline: DayHelpfulness[];
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  /** The day during the week with the highest concurrency_peak. null if all days had peak 0. */
  concurrency_peak_day: { date: string; peak: number } | null;

  // ── LLM narrative (null when ai_features.enabled === false or synth failed) ──
  headline: string | null;
  /** One short line per day with data. Days with zero entries are omitted (not "idle"). */
  trajectory: Array<{ date: string; line: string }> | null;
  /** 1–2 days that defined the week. */
  standout_days: Array<{ date: string; why: string }> | null;
  /** 2–3 sentences clustering recurring friction across days. Empty string allowed if no friction. */
  friction_themes: string | null;
  suggestion: { headline: string; body: string } | null;
};
```

### `MonthDigest`

```ts
export type MonthDigest = DigestEnvelope & {
  scope: "month";
  /** "YYYY-MM" — same as envelope.key */
  week_refs: string[];                                         // week-digest keys (Mondays in this month)

  // ── Deterministic aggregations (computed from week digests) ──
  agent_min_total: number;
  projects: Array<{
    name: string;
    display_name: string;
    agent_min: number;
    share_pct: number;
    shipped_count: number;
  }>;
  shipped: Array<{ title: string; project: string; date: string; session_id: string }>;
  /** Outcome mix summed across all days in the month. */
  outcome_mix: Partial<Record<DayOutcome, number>>;
  /** One entry per ISO week-Monday in the month. May be 4 or 5 entries. */
  helpfulness_by_week: Array<{ week_start: string; helpfulness: DayHelpfulness }>;
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak_week: { week_start: string; peak: number } | null;

  // ── LLM narrative ──
  headline: string | null;
  /** One line per week (4 or 5 entries). */
  trajectory: Array<{ week_start: string; line: string }> | null;
  /** 1–2 weeks that defined the month. */
  standout_weeks: Array<{ week_start: string; why: string }> | null;
  friction_themes: string | null;
  suggestion: { headline: string; body: string } | null;
};
```

The deterministic aggregations for `MonthDigest` are summed/derived from constituent `WeekDigest` records, **not** by re-reading day digests directly. This keeps the chain strictly hierarchical and makes month synthesis cheap (the "data" part of the LLM payload is small because weeks have already done the per-day work).

### Storage layout

```
~/.cclens/digests/
  day/{YYYY-MM-DD}.json                      ← Phase 2, unchanged
  week/{YYYY-MM-DD}.json                     ← NEW, key = ISO Monday
  month/{YYYY-MM}.json                       ← NEW
```

Past-period digests immutable on disk. Current-period (this week / this month) lives in 10-min in-memory TTL only — same rule as today's day digest.

### Provenance chain for non-day scopes

Week and month digests do not list entry refs directly. Their provenance is one level deeper:
- `WeekDigest.day_refs[]` → date keys; click into `/digest/[date]` for entry-level detail.
- `MonthDigest.week_refs[]` → Monday keys; click into `/insights/week-YYYY-MM-DD`.

After the envelope refactor (above), there is no `entry_refs` field on `WeekDigest` or `MonthDigest` — each type carries the ref array natural to its scope.

## Generation pipeline

### Week pipeline

```
[get day digests for Mon-Sun window]
   │  for each missing past-day digest, run runDayDigestPipeline(date) inline
   │  (settled past days only — never auto-fires today's digest from a week-pipeline trigger)
   ▼
[buildDeterministicWeekDigest(weekStart, dayDigests)] → base WeekDigest
   │
   ▼
[if AI off OR fewer than 2 enriched-day-digests → return base, narrative null]
   │
   ▼
[generateWeekDigest → claude -p with DIGEST_WEEK_SYSTEM_PROMPT]
   │  ~3 KB payload; Zod-validated; 1 retry with reminder; on second failure, narrative = null
   ▼
[atomic write ~/.cclens/digests/week/{Monday}.json   OR   in-memory TTL for current week]
```

**Files:**
- `packages/entries/src/digest-week.ts` — `buildDeterministicWeekDigest`, `generateWeekDigest`
- `packages/entries/src/digest-week-pipeline.ts` — `runWeekDigestPipeline` async generator (mirror of `runDayDigestPipeline`)
- `packages/entries/src/digest-fs.ts` — extended with `readWeekDigest`, `writeWeekDigest`, `getCurrentWeekDigestFromCache`, `setCurrentWeekDigestInCache`, plus the month variants
- `packages/entries/src/prompts/digest-week.ts` — `DIGEST_WEEK_SYSTEM_PROMPT`, Zod `WeekDigestResponseSchema`, `buildWeekDigestUserPrompt`

### Month pipeline

Structurally identical to week:
1. Load week digests for the month's ISO Mondays.
2. For any missing past-week digest, run the week pipeline inline (which transitively fills missing day digests).
3. `buildDeterministicMonthDigest` → base.
4. If AI off OR fewer than 2 enriched weeks → return base.
5. Synth via `claude -p`, persist past months to disk, current month to in-memory TTL.

**Files:**
- `packages/entries/src/digest-month.ts`
- `packages/entries/src/digest-month-pipeline.ts`
- `packages/entries/src/prompts/digest-month.ts`

### Pipeline events

Both pipelines yield the same `PipelineEvent` union as `runDayDigestPipeline`, with one added phase value. Extend the type:

```ts
export type PipelineEvent =
  | { type: "status"; phase: "enrich" | "synth" | "persist" | "load_dependencies"; text: string }
  | { type: "entry"; ... }                                        // existing
  | { type: "dependency"; kind: "day" | "week"; key: string;
      status: "cached" | "generated" | "failed" }                 // NEW for week/month pipelines
  | { type: "progress"; phase: "enrich" | "synth"; bytes; elapsed_ms }
  | { type: "digest"; digest: DayDigest | WeekDigest | MonthDigest }
  | { type: "saved"; path: string }
  | { type: "error"; message: string };
```

The `dependency` event lets the SSE client show "Loading day-23… generated · day-24… generated · synth" before the synth phase fires. The day-scope pipeline (`runDayDigestPipeline`) does not emit `dependency` events — it has no sub-digest dependencies. The shared `PipelineEvent` type is a superset; week and month pipelines emit `dependency`, day does not.

### LLM call budgeting

Same `~/.cclens/llm-spend.jsonl` append. New `kind` values: `"week_digest"`, `"month_digest"`. `monthToDateSpend()` is a sum across all kinds — one cap covers the perception layer.

The interactive lock pattern (`writeInteractiveLock` / `removeInteractiveLock`) stays — week and month synth are user-initiated, so they hold the lock while running.

## Routes

### `/api/digest/week/[start-date]` and `/api/digest/month/[year-month]`

**Files:**
- `apps/web/app/api/digest/week/[startDate]/route.ts`
- `apps/web/app/api/digest/month/[yearMonth]/route.ts`

Same shape as `/api/digest/day/[date]`:
- `GET` — read-only. Cached → 200 with digest. Uncached past period → 200 with stub `{ pending: true }`. Future → 400. Current period → in-memory TTL.
- `POST` — SSE pipeline. `?force=1` re-runs.

**Validation:**
- Week route validates `startDate` is a Monday. Non-Monday → 400.
- Month route validates `yearMonth` matches `^\d{4}-\d{2}$` and is a valid month.

**Coalescer:** Mirror the digest-day in-flight coalescer (`apps/web/lib/inflight-coalesce.ts`). Each route owns its own `InflightCoalescer` instance, but keys are scope-prefixed defensively: `week|YYYY-MM-DD|<force>`, `month|YYYY-MM|<force>`, and the day route migrates to `day|YYYY-MM-DD|<force>` in the same PR. This rules out collisions if a future refactor consolidates instances.

**Job registration:** Each POST registers a `weekly.synth` or `monthly.synth` job in `lib/jobs.ts` (status `running`, label includes the period start). The `<JobQueueWidget>` from Phase 3 surfaces these automatically.

### `JobKind` extension

`apps/web/lib/jobs.ts`:

```ts
export type JobKind =
  | "digest.day"
  | "digest.day.backfill"
  | "weekly.synth"
  | "monthly.synth"        // NEW
  | "ask_claude";
```

(`weekly.synth` already exists from Phase 3 reservation; `monthly.synth` is the new addition.)

### V2 `/insights` page

**Files (replace V1):**
- `apps/web/app/insights/page.tsx` — server component
- `apps/web/app/insights/[key]/page.tsx` — saved-view (renders V2 `WeekDigest` or `MonthDigest`)
- `apps/web/components/insights-view.tsx` — **rewritten** for V2 (was 647 lines, V2 will be smaller — all narrative rendering moves into per-scope components)
- `apps/web/components/week-digest.tsx` — presentational, pure function of `WeekDigest`
- `apps/web/components/month-digest.tsx` — presentational, pure function of `MonthDigest`
- `apps/web/components/week-digest-view.tsx` — client wrapper that runs the SSE POST for force-regen / first-time-generate
- `apps/web/components/month-digest-view.tsx` — same shape for month

**Layout (`/insights`):**

```
┌─────────────────────────────────────────────┐
│  Header: Insights                           │
│                                             │
│  ┌───── Last week hero ────────────────┐   │
│  │ [auto-stream if not yet cached and   │   │
│  │  not auto-fired this calendar week]  │   │
│  │  → renders WeekDigest                │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  Tabs:  Weeks | Months                      │
│  ┌────────────────────────────────────┐     │
│  │ Week of Apr 13 · shipped, helpful  │     │
│  │   View report  →                    │     │
│  ├────────────────────────────────────┤     │
│  │ Week of Apr 6  · partial · neutral  │     │
│  │   View report  →                    │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

Hero auto-fire rule: on `/insights` server-render, the page checks three preconditions:

1. `ai_features.enabled === true` (no auto-fire when AI is off — same gate as Phase 2.1's yesterday hero);
2. The week digest for `last_completed_week` (Monday in **server local TZ**) is not yet cached on disk;
3. `~/.cclens/auto-week-fired-at` either does not exist, or its UTF-8 contents (a single `YYYY-MM-DD` line) differ from `last_completed_week`'s Monday.

If all three pass, the page atomically writes `last_completed_week`'s Monday into the file and passes `autoFire: true` to the client. The client triggers the SSE POST on mount. This guarantees one auto-fire per ISO week per host, regardless of browser refresh. The contents check is the only load-bearing one — no mtime comparison needed.

A corrupt or unparseable `auto-week-fired-at` file (anything that doesn't match `^\d{4}-\d{2}-\d{2}$`) is treated as "absent" — the page proceeds to auto-fire and overwrites the file with a clean Monday line. No error surfaced to the user.

The auto-fire guard is server-side per-host (one file, one process group) while Phase 2.1's yesterday-hero guard is browser-side (`localStorage[cclens:autogen-yesterday:{date}]`). This split is intentional: the daily hero auto-fires on every device the user opens because losing one yesterday's narrative is cheap; the weekly hero costs ~5x more per fire so it's gated globally per host.

**Empty week / month** (zero day digests, zero entries) renders a "no activity" card with no Generate CTA — matches the Phase 3 honesty pattern for empty days. The week pipeline does NOT persist a digest to disk for an empty past week; the file simply doesn't exist, and the index endpoint's "cached or fallback" check naturally treats it as un-cached. This avoids "cached but empty" sentinels that the picker would otherwise have to special-case.

**`/insights/[key]`:**
- `key = "week-YYYY-MM-DD"` → load from `~/.cclens/digests/week/<date>.json`, render `<WeekDigest>`.
- `key = "month-YYYY-MM"` → load month digest, render `<MonthDigest>`.
- Unknown key → 404.

### Index endpoints

Replace V1 endpoints:

| V1 | V2 | Source |
|---|---|---|
| `/api/insights/weeks-index` | `/api/digest/week-index` | scan `~/.cclens/digests/week/*.json` + listEntries fallback for un-cached weeks with data |
| `/api/insights/months-index` | `/api/digest/month-index` | scan `~/.cclens/digests/month/*.json` + listEntries fallback |
| `/api/insights/saved` and `/api/insights/saved/[key]` | **deleted** — `/api/digest/week/[start-date]` GET serves the same purpose | — |

The "fallback for un-cached weeks with data" lets the picker show a "Generate" CTA on weeks the user hasn't yet processed. Logic: pick the last 12 ISO weeks; for each, check if a week digest is cached; if not, count entries-with-data in that window from the entries-index.

## Page-level migration: `/insights/[key]/print` (V1 saved-report PDF flow)

V1 has a print-to-PDF route. Phase 4 deletes it along with the rest of V1. Re-implementation is **out of scope** for Phase 4 — the user can print from the browser if they want a PDF in the meantime. If demand surfaces, a follow-up adds it back targeting `<WeekDigest>`.

## Prompt design

### `prompts/digest-week.ts`

```ts
export const DIGEST_WEEK_SYSTEM_PROMPT = `You are the weekly digest writer for Fleetlens.

You receive a JSON payload describing one calendar week (Mon-Sun, local TZ).
Your job: produce a 5-field JSON object capturing the shape of the week.

You will be given:
  • period: { start, end, label }
  • totals: { agent_min_total, day_count_with_data }
  • outcome_mix: { shipped, partial, blocked, exploratory, trivial }  (counts of days; absent keys mean zero — the prompt builder pre-fills with 0)
  • helpfulness_sparkline: 7 entries Mon-Sun (essential|helpful|neutral|unhelpful|null)
  • projects: top 5 by minutes
  • shipped: all PRs shipped this week with date+project
  • top_flags, top_goal_categories
  • concurrency_peak_day
  • day_summaries: per-day { date, day_name, headline, what_went_well, what_hit_friction, suggestion, agent_min, outcome_day, helpfulness_day }

You return EXACTLY ONE JSON object inside a \`\`\`json fenced code block. Schema:

{
  "headline":           "≤70 chars; concrete claim grounded in data",
  "trajectory": [
    { "date": "YYYY-MM-DD", "line": "≤25 words; one sentence about that day grounded in its day_summary" }
    // one entry per day in day_summaries, in date order
  ],
  "standout_days": [
    { "date": "YYYY-MM-DD", "why": "1-2 sentences explaining why this day defined the week" }
    // 1 to 2 entries, never 0 if day_summaries is non-empty
  ],
  "friction_themes":   "2-3 sentences clustering recurring friction across days. Empty string if no friction.",
  "suggestion":        { "headline": "≤70 chars, imperative", "body": "2-3 sentences, actionable" }
}

Rules:
1. Ground every claim in the data. Never invent. Never quote totals as headlines (no vanity).
2. Use behavioural signals: outcome_mix, helpfulness sparkline shape, friction patterns.
3. No archetype labels. No personality framing.
4. Trajectory lines mention concrete work — what shipped, what stuck, where attention went — not vibes.
5. Strict JSON. No trailing commas. No prose outside the fence.`;
```

The user prompt is a single JSON object containing the inputs above.

### `prompts/digest-month.ts`

Mirrors digest-week with:
- `trajectory` keyed by `week_start` (4–5 entries)
- `standout_weeks` instead of `standout_days`
- input shape uses `week_summaries` (each carrying the week's `headline` + `trajectory` + `standout_days` + `friction_themes`)

### Zod schemas

Co-located with each prompt module:

```ts
export const WeekDigestResponseSchema = z.object({
  headline: z.string().min(1).max(120),
  trajectory: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    line: z.string().min(1).max(200),
  })).min(1),
  standout_days: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    why: z.string().min(1).max(400),
  })).min(1).max(2),
  friction_themes: z.string().max(800),
  suggestion: z.object({
    headline: z.string().min(1).max(120),
    body: z.string().min(1).max(800),
  }),
});
```

(Month version uses `week_start` and `standout_weeks`.)

## CLI command surface

Add:

```
fleetlens digest week  [--week YYYY-MM-DD | --last-week | --this-week] [--force] [--json|--pretty]
fleetlens digest month [--month YYYY-MM   | --last-month | --this-month] [--force] [--json|--pretty]
```

Default if no flag given:
- `fleetlens digest week` → `--last-week`
- `fleetlens digest month` → `--last-month`

Both register a job (`caller: "cli"`) so the dashboard's job widget reflects CLI work.

Remove:
- `fleetlens stats` (PeriodBundle dump — V1-only)
- `fleetlens capsules` (replaced by existing `fleetlens entries`)

`fleetlens version`, `fleetlens start/stop/status`, `fleetlens update`, `fleetlens daemon *`, `fleetlens entries *`, `fleetlens digest day *`, `fleetlens usage *`, `fleetlens web *` all stay unchanged.

## V1 deletion scope (same PR)

| Path | Action |
|---|---|
| `apps/web/lib/ai/insights-prompt.ts` | delete |
| `apps/web/lib/ai/saved-reports.ts` | delete |
| `apps/web/components/insight-report.tsx` | delete (~1031 lines) |
| `apps/web/components/insights-view.tsx` | rewrite for V2 (smaller — narrative renderers move to per-scope components) |
| `apps/web/app/api/insights/route.ts` | delete |
| `apps/web/app/api/insights/saved/route.ts` | delete |
| `apps/web/app/api/insights/saved/[key]/route.ts` | delete |
| `apps/web/app/api/insights/weeks-index/route.ts` | move + rewrite at `apps/web/app/api/digest/week-index/route.ts` |
| `apps/web/app/api/insights/months-index/route.ts` | move + rewrite at `apps/web/app/api/digest/month-index/route.ts` |
| `apps/web/app/insights/[key]/page.tsx` | rewrite for V2 saved-view |
| `apps/web/app/insights/print/[key]/page.tsx` | delete (PDF print page — out of scope; future follow-up) |
| `apps/web/app/api/insights/pdf/[key]/route.ts` | delete (V1 PDF render API; consumer of `InsightReport`/`ReportData`) |
| `packages/parser/src/capsule.ts` | delete (`SessionCapsule`, `buildCapsule`) |
| `packages/parser/src/aggregate.ts` | trim — keep `aggregateConcurrency`, `calendarWeek`, `priorCalendarWeek`, `last4CompletedWeeks`, `calendarMonth`, `priorCalendarMonth`, `computeBurstsFromSessions`. Delete `buildPeriodBundle`, `PeriodBundle` |
| `packages/parser/src/index.ts` | drop exports of removed symbols |
| `packages/parser/test/capsule.test.ts` | delete |
| `packages/parser/test/aggregate.test.ts` | trim to retained symbols |
| `packages/cli/src/commands/stats.ts` | delete |
| `packages/cli/src/commands/capsules.ts` | delete |
| `packages/cli/src/index.ts` | drop the removed subcommand wiring |
| `scripts/v1-insights-regression.mjs` | delete |
| `package.json` (root) | drop the regression script call from `pnpm verify` |
| `CLAUDE.md` (root) | rewrite the "Insights pipeline" section (lines 162–197 in current head) for the V2 chain (`Entry → DayDigest → WeekDigest → MonthDigest`); replace the `fleetlens stats` / `fleetlens capsules` lines in the CLI surface table; drop the "`fleetlens stats` is period aggregates" paragraph |

## Testing strategy

**Unit (`packages/entries/test/`):**
- `digest-week.test.ts`
  - `buildDeterministicWeekDigest` exact-match for a fixture week of 7 day digests.
  - `generateWeekDigest` happy path with mock LLM (Zod schema validates).
  - `generateWeekDigest` retry-once-on-bad-JSON, then narrative=null.
  - Fewer-than-2-enriched-days short-circuits to deterministic-only.
  - Helpfulness sparkline preserves nulls for days without enriched data.
- `digest-month.test.ts` — same shape over a fixture month of 4–5 weeks.
- `digest-week-pipeline.test.ts`
  - Missing past-day digest is auto-generated inline.
  - Today-mid-week never causes today's digest to be force-generated.
  - `force=1` rescue resets retry counts on stuck week digests (mirror of day pipeline rescue).
  - In-flight coalescer dedupes concurrent same-period requests.
- `digest-fs.test.ts` — atomicity tests extended for week + month paths.

**CLI parity:**
- `fleetlens digest week --last-week --json` byte-equal to `/api/digest/week/[Monday]` GET when both are reading the same cached digest.
- `fleetlens digest month --last-month --json` byte-equal to `/api/digest/month/[YYYY-MM]` GET. (Distinct test because the month prompt and aggregation paths differ from week.)

**Smoke (`scripts/smoke.mjs`):**
- `GET /insights` → 200
- `GET /insights/week-<lastMonday>` → 200 (after pre-generating the week digest)
- `GET /insights/month-<lastMonth>` → 200 (after pre-generating)
- `GET /api/digest/week-index` → 200, JSON
- `GET /api/digest/month-index` → 200, JSON

Pre-generation in smoke uses the deterministic-only path (mock LLM disabled) so smoke doesn't depend on a live `claude` subprocess.

**V1 regression script:** **deleted.** Once V1 is gone, the regression check has nothing to compare against. A residual `pnpm verify` step that points to a deleted script would itself break the verify run.

## Performance budget

| Operation | Cost | Latency |
|---|---|---|
| `buildDeterministicWeekDigest(day_digests[7])` | 0 | < 5 ms |
| `generateWeekDigest` LLM call | ~$0.005 | ~6–12 s |
| `runWeekDigestPipeline` cold (week with 7 missing day digests, ~5 entries each, sequential enrichment) | ~$0.005 + 7 × day pipeline cost ≈ $0.04–0.05 total | ~3–6 min (35 entries × ~5–8 s sequential + 7 × day synth + 1 week synth) |
| `runWeekDigestPipeline` warm (all day digests cached) | ~$0.005 | ~10 s |
| `buildDeterministicMonthDigest(week_digests[4-5])` | 0 | < 5 ms |
| `generateMonthDigest` LLM call | ~$0.012 | ~12–20 s |

Disk: each week digest ≈ 4 KB, each month digest ≈ 6 KB. 1 year = 52 weeks + 12 months ≈ 280 KB. Negligible.

## Rollout

1. Land schema additions + generators + prompts (no UI yet, gated only by AI on/off).
2. Land week + month routes + pipeline + JobKind extension.
3. Land V2 `/insights` page + `/insights/[key]` saved view + index endpoints. **Same commit deletes V1** — there is no period when both V1 and V2 coexist on disk.
4. Land CLI subcommands + remove `stats` / `capsules`.
5. Land smoke route additions + remove regression-script call from `pnpm verify`.
6. Dogfood end-to-end: open `/insights`, watch auto-fire, walk back through saved weeks, generate a month, run CLI.
7. PR `feat/v2-perception-phase-4` → `feat/v2-perception-insights`. **No version bump in this PR** — the package.json stays at the integration-branch version. The bump (~v0.5.0) happens in the merge-to-master PR after dogfood approval, run via `npm version minor` at the repo root so `version-sync.mjs` propagates.

## Out of scope in Phase 4

- ProjectDigest and SessionDigest — reserved scopes; not built.
- "Ask Claude" free-form query box — `ask_claude` JobKind reserved but not implemented.
- Year / quarter scopes.
- PDF print route for V2 (V1 had one; not re-implemented in Phase 4).
- Hard budget enforcement (`enforce_hard_budget`).
- Auto-firing the month digest. Monthly stays click-to-generate; auto-fire is week-only.
- Rich diff / "vs prior week" comparison — could be a follow-up that consumes 2 week digests.

## Open questions

None at draft time. Brainstorm answered:
- Cutover: A (hard cutover, same PR).
- Schema: A (trajectory-first, no archetype).
- Auto-fire: B (last completed week on first /insights visit per ISO week; monthly manual).

---

**Next steps:** spec-document-reviewer pass → user review → invoke `writing-plans` skill (or, per user instruction, proceed directly to implementation in `.worktrees/phase-4/` and surface the running result).
