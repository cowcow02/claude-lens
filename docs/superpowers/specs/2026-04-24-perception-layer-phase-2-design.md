# Fleetlens Perception Layer — Phase 2 Design

**Status:** Draft
**Date:** 2026-04-24
**Author:** Brainstormed with user 2026-04-24
**Ships:**
- `DayDigest` generator + `/api/digest/day/[date]` SSE route + `/digest/[date]` page
- Home-page Yesterday hero card + Recent days panel
- `fleetlens digest day` CLI
- Day-scoped enrichment trigger fused into the digest generation path
- Default `ai_features.enabled = true` and removal of the `allowed_projects` allow-list
- Phase 1b follow-ups bundle (form semantics, sidebar link, `/settings` smoke, Zod on PUT, unused import, `--since` doc)

**Depends on:** Phase 1a + 1b (branch `feat/v2-perception-insights`) — deterministic `Entry` layer, LLM enrichment, daemon perception worker, `~/.cclens/settings.json`, `~/.cclens/llm-spend.jsonl`.
**Coexists with:** V1 `/insights` stays untouched — regression-guarded by `scripts/v1-insights-regression.mjs`. Phase 4 eventually retires V1. Phase 2 adds surfaces; it does not modify V1 code paths.
**Release strategy:** Single V2 release to master. Phase 2 branches off `feat/v2-perception-insights` as `feat/v2-perception-phase-2`, PRs back into the integration branch when close to done. No intermediate master merges.

---

## Overview

Phase 1a + 1b ship the primitive: every `(session × local-day)` pair is an on-disk `Entry` with deterministic numbers + LLM-enriched facets. Phase 2 ships the **first consumer surface** of those Entries — the day digest — plus the user-facing path that synthesizes, displays, and invalidates them.

Concretely, Phase 2 answers the user question *"what did I do yesterday?"* with a single URL (`/digest/2026-04-23`) and a single CLI command (`fleetlens digest day --yesterday`). The digest page is a fused SSE pipeline: on first request for a day with un-enriched entries, it enriches them inline, then synthesizes the narrative, then streams the rendered digest back. No separate "prep" step.

The master spec (`docs/superpowers/specs/2026-04-22-perception-layer-design.md`) already locks:

- `DigestEnvelope` + `DayDigest` type shape
- Storage layout (`~/.cclens/digests/day/{YYYY-MM-DD}.json`, past-day immutable on disk, today's digest lives only in a 10-min in-memory TTL cache)
- CLI surface sketch
- LLM input shape (deterministic aggregates + up to 12 `brief_summary` + top 6 `friction_detail` + up to 10 aggregated `user_instructions`)
- Five LLM output fields: `headline`, `narrative`, `what_went_well`, `what_hit_friction`, `suggestion`
- AI-off deterministic-template headline fallback
- Daemon schedules digest synthesis when all non-trivial entries for a settled day reach `done`/`error`

This spec focuses on what master spec doesn't nail: the **SSE pipeline**, the **page layout**, the **home-view integration**, the **prompt text**, and the **settings-model flip to default-on**.

---

## Amendments to master spec

Four deliberate departures from `docs/superpowers/specs/2026-04-22-perception-layer-design.md`. Rationale documented here; master spec stays as the historical record.

### 1. `ai_features.enabled` defaults to `true`

Phase 1b shipped with `enabled: false` — users had to visit `/settings` and toggle AI on. Phase 2 flips this to **`true` out of the box**.

**Why:** The master spec's privacy posture ("LLM enrichment is opt-in per project") was calibrated for a world where enrichment would use an `ANTHROPIC_API_KEY` to send content off-machine. Phase 1b's `claude -p` subprocess architecture changes that math: the enrichment payload crosses the same trust boundary the user already crossed when they ran the session in Claude Code. Opt-in gating is theater under this architecture.

Default-on also makes Phase 2's home-page hero card immediately valuable. Gating the first narrative behind a settings trip kills the feature's discoverability for new installs.

### 2. `allowed_projects` allow-list removed

Phase 1b gated enrichment per canonical project. Phase 2 removes this gate. One master toggle (`enabled`) governs all enrichment.

**Why:** The allow-list's only legitimate purpose was project-level privacy opt-in under the API-key model (see above). Under subprocess mode it's redundant. Keeping it means ongoing UX maintenance (the per-project list, the "enable this project" nudge, the daemon filter) for zero privacy benefit.

Users who want to pause enrichment entirely flip the master toggle. If real-world usage later surfaces a need for per-project granularity (e.g. a shared client project with different rules), it can be added back as `excluded_projects: string[]` — additive, non-breaking.

### 3. `/api/digest/day/[date]` surface: GET read-only + POST SSE

Master spec specified a GET-only route with `?generate=1` for synchronous generation and a 202-queued response for the default case. Phase 2 moves to **GET read-only + POST streams SSE**.

**Why:** The fused enrichment+synth pipeline needs incremental progress events (one per entry) that don't fit a single HTTP response. SSE is already the idiomatic streaming pattern in this codebase (`/api/insights`), and forcing the client to poll a 202 introduces a state-machine on the client side that matches nothing else we ship. POST is the correct verb for "run a pipeline and produce a side-effect (cached digest file)."

Phase 2's CLI also gains a `--force` flag that was unmentioned in master spec — mirror of `POST ?force=1`.

### 4. `top_goal_categories` stores minutes, not counts

Master spec defined `DayDigest.top_goal_categories: Array<{ category: string; count: number }>`. Phase 1b flipped `Entry.enrichment.goal_categories` values from counts to **minutes** (master spec ships this change inline via the 1b follow-up). The day-digest aggregation must therefore sum minutes, not counts.

**New shape:** `top_goal_categories: Array<{ category: string; minutes: number }>` — top 5 by summed minutes. Field name explicitly carries the unit to prevent count-vs-minute confusion when the renderer reads it.

### 5. Concrete code impact

- `packages/entries/src/settings.ts`:
  - `AiFeaturesSettings.allowedProjects` field **removed**.
  - `DEFAULT_SETTINGS.ai_features.enabled` → `true`.
  - `toDisk()` / `fromDisk()` drop the `allowed_projects` key. Unknown keys on read are silently ignored (existing behavior), so upgrading a `~/.cclens/settings.json` that contains `allowed_projects` is lossless — the field just disappears on the next write.
  - `listKnownProjects()` in `fs.ts` → no longer consumed by settings UI. Remove to avoid dead code.
- `packages/entries/src/queue.ts`:
  - Delete the `allowed.has(entry.project)` filter and the `no_allowed_projects` branch of `EnrichmentResult`.
  - `EnrichmentResult` narrows to `{ skipped: "disabled" | "budget_cap_reached" } | { enriched; errors; skipped }`.
- `apps/web/app/settings/ai-features-form.tsx`:
  - Remove the project-list UI entirely. Retain master toggle + model selector + budget field.
- `apps/web/app/api/settings/route.ts`:
  - The Zod validator for PUT body drops `allowed_projects`. (Adding the Zod validator is itself one of the Phase 1b follow-ups — see §Phase 1b Follow-ups below.)

### 6. Dogfood upgrade path

The developer's live `~/.cclens/settings.json` contains `allowed_projects: ["/Users/cowcow02/Repo/claude-lens"]`. First `writeSettings()` after upgrade drops that key — no migration step needed. `enabled` stays whatever was already on disk (currently `true` from dogfood, which is the new default anyway).

---

## Surfaces

Phase 2 adds five surfaces. Each subsection below specifies one.

### S1. Day digest generator · `apps/web/lib/ai/digest-day-gen.ts`

Server-only module (`import "server-only"`) that takes the Entries for a local day and emits a `DayDigest`.

Entry points:

```ts
export async function generateDayDigest(
  date: string,                          // "YYYY-MM-DD" in server TZ
  entries: Entry[],                      // already loaded by caller
  opts?: { callLLM?: CallLLM; model?: string }
): Promise<{ digest: DayDigest; usage: EnrichUsage | null }>;

// Deterministic-only path (ai_features.enabled === false OR no non-trivial entries)
export function buildDeterministicDigest(
  date: string,
  entries: Entry[]
): DayDigest;
```

`buildDeterministicDigest` is a pure function — used when AI is off and by `generateDayDigest` as its first step before invoking the LLM. It populates everything in `DayDigest` except the five narrative fields.

`generateDayDigest` is a **pure generator** — it does not write to disk or append spend. Persistence + spend-append are the pipeline helper's job (§S6). Flow:

1. Call `buildDeterministicDigest(date, entries)` → base digest with narrative fields `null`.
2. If `entries.length === 0` or all entries are `skipped_trivial`: return `{ digest: baseDigest, usage: null }`.
3. Build the LLM prompt via `buildDigestUserPrompt(baseDigest, entries)`.
4. Spawn `claude -p` with `DIGEST_SYSTEM_PROMPT` — same pattern as `enrichEntry`. See §Prompt design.
5. Parse + validate via Zod.
6. On success: return `{ digest: baseDigestWithNarrative, usage }`. On parse failure: retry once with a "return valid JSON only" reminder. On second failure: return `{ digest: baseDigest, usage }` (narrative fields stay `null`) with `console.warn(...)` noting the failure. The returned `usage` reflects actual tokens consumed even on failure, so the pipeline can still spend-record them.

`callLLM` is injectable for tests (same DI pattern as `enrichEntry`). The caller (always `runDayDigestPipeline`) owns atomic file writes and `appendSpend(...)`.

### S2. `/api/digest/day/[date]` route — SSE streaming

**File:** `apps/web/app/api/digest/day/[date]/route.ts`

The route handles both GET (read cached digest) and POST (generate). It follows the same SSE pattern as `/api/insights` to support the fused enrichment-then-synthesis pipeline on a single connection.

#### GET behaviour

| State | Response |
|---|---|
| Future date | `400 {error: "future date"}` |
| Past day, cached on disk | `200 application/json` with the cached `DayDigest` |
| Past day, **not** cached, `?generate=0` (default) | `200` with a stub `DayDigest` — deterministic-only fields populated, narrative fields `null`, envelope flag `is_live: false`, `pending: true` so the client knows to prompt for POST |
| Today | `200` with the in-memory 10-min-TTL digest (regenerates on miss, blocks request) |

GET never triggers LLM work. It only reads what's already materialized.

#### POST behaviour — the fused SSE pipeline

POST with `{ date: "YYYY-MM-DD" }` streams `text/event-stream` events:

```
event: status
data: {"phase": "enrich", "text": "Enriching 4 entries for 2026-04-23"}

event: entry
data: {"session_id": "...", "index": 1, "total": 4, "status": "done", "cost_usd": 0.0011}

...

event: status
data: {"phase": "synth", "text": "Synthesizing day narrative"}

event: digest
data: {"digest": {... DayDigest ...}}

event: saved
data: {"path": "~/.cclens/digests/day/2026-04-23.json"}

event: done
data: {}
```

Pipeline stages, in order:

1. **Load entries.** Call `listEntriesForDay(date)` from `@claude-lens/entries/fs`. Zero entries → `event: error {message: "no entries for date"}` + close.
2. **Enrich stage** (skipped if `!ai_features.enabled`). For every entry with `enrichment.status ∈ {pending, error}` and `retry_count < 3`, run `enrichEntry` sequentially (not parallel — respects the existing budget-guard rhythm). Emit one `entry` SSE event per enriched entry. Write each enriched entry back via `writeEntry`. Append each spend record.
3. **Synth stage** (skipped if `!ai_features.enabled`). Re-read entries (now enriched), call `generateDayDigest`. Emit `status phase=synth`.
4. **Persist.** For past days: write `~/.cclens/digests/day/{date}.json` atomically. For today: store in in-memory 10-min TTL cache, skip disk. Emit `saved` (past day) or no `saved` event (today).
5. **Done.** Emit `digest` + `done`. Close stream.

**Concurrency guard.** If two clients POST the same `(date, force)` pair simultaneously, the second request sees the first's in-flight work. Implementation: a `Map<string, Promise<DayDigest>>` in the route module keyed by `${date}|${force ? 1 : 0}`. Second caller `await`s the first's promise and streams the result as a single `digest` event (no intermediate `entry` events — cheaper than re-streaming). A `force=1` POST arriving while a `force=0` request is in flight **does not coalesce** — the force request runs fresh under its own key. This is intentional: force is the user explicitly demanding a re-roll; coalescing would silently return the same content they're trying to replace.

**AI-disabled POST.** If `ai_features.enabled === false`, POST skips the enrich + synth stages entirely and emits only a single `digest` event carrying `buildDeterministicDigest(date, entries)` + a `saved` event (for past days). Useful so the "Regenerate" button still works (it rewrites the deterministic-only digest after e.g. a new entry landed).

#### Force regeneration

`POST /api/digest/day/[date]?force=1` rewrites an already-cached past-day digest. Without `force`, POSTing on a date that's already cached on disk streams the cached digest immediately (single `digest` event). With `force`, the pipeline runs fresh and overwrites.

### S3. `/digest/[date]` page

**Files:**
- `apps/web/app/digest/[date]/page.tsx` — server component, reads cache via `@claude-lens/entries/fs`
- `apps/web/app/digest/[date]/loading.tsx`
- `apps/web/components/day-digest.tsx` — presentational, pure function of `DayDigest`
- `apps/web/components/day-digest-view.tsx` — client wrapper that handles the SSE POST for regen / first-time-generate

Page flow:

1. Server component calls `GET /api/digest/day/[date]` (or the underlying lib function directly — no round-trip to its own API).
2. If cached digest exists: render `<DayDigest digest={digest} />` + nav chrome (prev/next day arrows, jump-to-today link, "Regenerate" button).
3. If stub digest (past day, uncached, AI on): render a skeleton + a "Generate digest" CTA. Click triggers the SSE POST via `<DayDigestView />`.
4. If AI-off: render the deterministic-only view unchanged, with a sidebar note "Enable AI features in Settings to see daily narratives."

Layout (following the existing `insight-report.tsx` visual idiom):

```
┌─ Mon · Apr 21, 2026 ──────────────────────────── [← prev] [next →]
│                                                  [🔄 Regenerate]
│
│  "You shipped the Team Edition timeline after two subagent retries."
│  ──────────────────────────────────────────────────────────────────
│
│  4h 12m agent time · 2 projects · 3 PRs shipped · peak concurrency ×2
│
│  ┌─ Narrative ─────────────────────────────────────────────────┐
│  │  <narrative paragraph, 3-5 sentences>                        │
│  └──────────────────────────────────────────────────────────────┘
│
│  ┌─ What went well ───────┐  ┌─ What hit friction ────────────┐
│  │  <one to two sentences>  │  │  <one to two sentences>        │
│  └──────────────────────────┘  └────────────────────────────────┘
│
│  ┌─ Suggestion ─────────────────────────────────────────────────┐
│  │  <headline bold>                                              │
│  │  <body paragraph>                                             │
│  └───────────────────────────────────────────────────────────────┘
│
│  ┌─ Projects ──────────────────────┐  ┌─ Shipped ─────────────┐
│  │  [bar chart of share_pct]        │  │  <pr titles >         │
│  └──────────────────────────────────┘  └───────────────────────┘
│
│  ┌─ Goal mix ──────────────────────────────────────────────────┐
│  │  [horizontal stacked bar by top_goal_categories]             │
│  └──────────────────────────────────────────────────────────────┘
│
│  ┌─ Entries ────────────────────────────────────────────────────┐
│  │  [per-Entry expandable rows — link to /sessions/{id}]         │
│  └──────────────────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────────────────
```

The **Entries** section at the bottom lists each `Entry` that fed the digest, with project badge, agent time, and `brief_summary`. Clicking a row jumps to `/sessions/{session_id}`. This is the transparency hook — users can verify the narrative against the underlying work.

**AI-off page:**
- Headline = deterministic template `"Worked 4h 12m across 2 projects; shipped 3 PR(s)."`
- Narrative, What-went-well, What-hit-friction, Suggestion sections **hidden entirely** (not rendered with empty prose)
- An inline panel replaces them: `"Enable AI features in Settings to see daily narratives."`
- Projects / Shipped / Goal mix / Entries sections stay as-is — they're all deterministic

### S4. Home-view hero card + Recent days panel

Two additions to `apps/web/app/page.tsx`, both rendered in server components reading from `@claude-lens/entries/fs`:

**A. Yesterday hero card** — placed between the page header and the existing `<DashboardView>`:

```
┌─ Yesterday · Mon Apr 21 ──────────────────────────────────────────┐
│  "You shipped the Team Edition timeline after two subagent        │
│   retries."                                                        │
│                                                                    │
│  4h 12m agent time · 2 projects · 3 PRs shipped                   │
│                                                                    │
│  ✓ Subagent loop settled once you split the spec review.          │
│  ⚠ First pass flagged missing budget-cap test.                    │
│                                                                    │
│  [ Open full digest → ]      [ Weekly insight report → ]          │
└────────────────────────────────────────────────────────────────────┘
```

Behaviour matrix:

| Condition | Hero renders |
|---|---|
| AI on, yesterday cached | Full card: headline + 1 line from `what_went_well` + 1 line from `what_hit_friction` + stats + CTAs |
| AI on, yesterday not yet generated | Deterministic-template headline + stats + "Narrative generating — check back shortly" + a `Regenerate now` button that POSTs to `/api/digest/day/{yesterday}` and reloads on `done` |
| AI off | Deterministic-template headline + stats + `"Enable AI features in Settings"` nudge link |
| Yesterday has no activity | "You were last active Fri Apr 18 — [open digest →]". Falls back to the most recent day with `entries.length > 0`. Pure UI fallback; no cache side-effects. |

The two strongest narrative lines are chosen by truncation — take the first sentence of `what_went_well` and the first sentence of `what_hit_friction`. Truncate each to ~120 chars. If `what_hit_friction === null` (smooth day), the ⚠ line is omitted and the ✓ line spans.

**B. Recent days panel** — added as a third column in the existing two-column bottom section. Grid becomes `repeat(auto-fit, minmax(260px, 1fr))` to stay responsive.

```
┌─ Recent days ────────────────────────────────────┐
│  Yesterday · Mon Apr 21   4h 12m   3 PR          │
│  Sun · Apr 20             2h 45m   1 PR          │
│  Sat · Apr 19             —                      │
│  Fri · Apr 18             5h 10m   2 PR          │
│  Thu · Apr 17             3h 05m   1 PR          │
└──────────────────────────────────────────────────┘
```

- Shows last 5 local days from today (regardless of activity). Days with zero entries render "—".
- Each row links to `/digest/{YYYY-MM-DD}`.
- No narrative text — just the compact stat strip. Narrative discovery happens by clicking through.
- For the current day (today), the row reads `"Today · Tue Apr 22   (live)"` and links to `/digest/{today}`.

Grid: the existing bottom section changes from `grid-template-columns: 1fr 1.4fr` (two panels) to `grid-template-columns: minmax(260px, 1fr) minmax(260px, 1.4fr) minmax(260px, 1fr)` (three panels). This preserves the existing 1-to-1.4 ratio between Top projects and Recent sessions while giving Recent days the same compact ratio as Top projects. Responsive behavior: the grid still wraps on narrow viewports via the per-column `min` constraint. Conscious tradeoff vs `auto-fit, minmax(260px, 1fr)`: we keep the intentional widths at the cost of less graceful reflow. If dogfood reveals narrow-viewport pain, revisit with `auto-fit` in a follow-up.

No "recent digest" cache or pre-fetching — the panel reads deterministic stats from Entries on disk (cheap — `listEntriesForDay` for each of 5 days ≈ 25 JSON reads).

### S5. `fleetlens digest day` CLI

**File:** `packages/cli/src/commands/digest.ts`

```
fleetlens digest day [--date YYYY-MM-DD | --yesterday | --today] [--json | --pretty] [--force]
```

Behaviour:

| Invocation | What happens |
|---|---|
| `fleetlens digest day --yesterday` (AI on, cached) | Reads `~/.cclens/digests/day/{yesterday}.json`. Prints `--pretty` default. |
| `fleetlens digest day --yesterday` (AI on, not cached) | Runs the full pipeline: enrich any pending entries → synthesize → write cache → print. No SSE streaming — progress prints to stderr line-by-line (`Enriching 3/4... ✓`, `Synthesizing... ✓`, `Wrote digest to ~/.cclens/digests/day/...`). |
| `fleetlens digest day --today` | Builds the deterministic-only digest fresh (no cache — today is never persisted). If AI on, calls the LLM synchronously. |
| `fleetlens digest day --yesterday --force` | Overwrites the cached digest. |
| `fleetlens digest day --date X --json` | JSON-only output (no stderr progress). |
| `fleetlens digest day` (no date flag) | Equivalent to `--yesterday`. |
| AI off | Prints deterministic-only digest. |

The CLI imports `generateDayDigest` + `buildDeterministicDigest` + `listEntriesForDay` from `@claude-lens/entries/node` and `@claude-lens/entries/fs`. Same dependency vector as the existing `fleetlens entries regenerate`.

Exit codes: `0` on success, `1` on invalid date or no entries for date, `2` on LLM failure (same as entries regenerate).

---

## Fused enrichment trigger (S6)

The day-scoped enrichment trigger deferred from Phase 1b is **not** a separate command or button — it's the first stage of every "generate a digest" pipeline (S2 POST + S5 `digest day`). No additional CLI surface, no "enrich this day" button.

Mental model: asking for a day's digest *is* asking to enrich its entries, in the same sense that asking for a rendered webpage is asking to run the SSR. Decoupling them would force users to model two operations when one is all they want.

Concretely, both the web POST pipeline and the CLI `digest day` command delegate to a shared helper:

```ts
// apps/web/lib/ai/digest-day-pipeline.ts (server-only)
export async function* runDayDigestPipeline(
  date: string,
  opts: {
    onEntry?: (e: {session_id: string; index: number; total: number; status: EntryEnrichmentStatus; cost_usd: number | null}) => void;
    onStatus?: (phase: "enrich" | "synth" | "persist", text: string) => void;
    force?: boolean;
  }
): AsyncGenerator<DigestEvent, DayDigest>;
```

The web SSE route converts each yielded event to a `text/event-stream` frame. The CLI prints each event to stderr. Tests drive the generator directly, asserting yielded events in order.

No new budget-guard: `runDayDigestPipeline` calls `monthToDateSpend()` the same way `runEnrichmentQueue` does, aborts mid-pipeline if the cap is breached.

**Race prevention between daemon and foreground.** Without a mitigation, daemon and foreground can both pick up the same Entry off-disk, both call `enrichEntry`, and both write the result — double work, double spend, potentially mismatched narratives. The fix is a **top-of-sweep lockout** in the daemon, not a per-entry lock:

`runDayDigestPipeline` writes `~/.cclens/llm-interactive.lock` with its PID on start, removes on finish (and on error). `runEnrichmentQueue` (the daemon's sweep) checks for this lock **at the top of the function**, before listing entries. If the lock is present and its mtime is within 60s, the entire sweep returns `{skipped: "interactive_in_progress"}` and the daemon goes back to sleep for its next interval. Stale locks (older than 60s, or PID not alive) are treated as absent.

This is a coarser guard than a per-entry lock but much simpler: the two worst-case outcomes it prevents (double-write of the same Entry; double-charged spend for the same work) are what matters. A sweep being skipped because the user is actively generating a digest is the correct tradeoff — the foreground request handles enrichment of that day's entries anyway, so the daemon has nothing urgent to do.

`EnrichmentResult` gains one variant: `{skipped: "disabled" | "budget_cap_reached" | "interactive_in_progress"}`.

---

## Staleness model

Phase 2 adopts the **explicit-regen-only** staleness model:

- Past-day digest on disk is immutable unless the user explicitly forces regen.
- No content-hash invalidation, no automatic regen-on-read.
- Two rewrite paths:
  - `fleetlens digest day --date X --force`
  - `POST /api/digest/day/[date]?force=1` (wired to the `🔄 Regenerate` button on the page + the `Regenerate now` button in the Yesterday hero)

Rationale: per the master spec, staleness is rare by design (daemon waits 30 min past local midnight before finalizing entries). The two cases where staleness happens in practice:

1. **User toggles AI on after a past day was cached in AI-off mode.** The user is already on `/digest/{that_date}` or `/` when they flip the toggle — they naturally click "Regenerate" and get the new narrative. Auto-detection is unnecessary.
2. **A session resumes days later with new events.** Master spec calls this "accepted tradeoff; rare in practice." Phase 2 inherits that — the old Entry stays frozen (master spec's immutability invariant) and the digest stays in sync with the frozen Entry, not the live JSONL. If the user notices, they click "Regenerate."

Hash-based staleness tracking and auto-regen-on-read are both **out of scope for Phase 2** and not planned for Phase 3/4. Revisit only if dogfood surfaces a real problem.

---

## Prompt design

Two new files in `packages/entries/src/prompts/`:

- `digest-day.ts` — system prompt + user-prompt builder + Zod schema
- (existing) `enrich.ts` stays unchanged

### System prompt

```ts
export const DIGEST_DAY_SYSTEM_PROMPT = `You are synthesizing a developer's Claude Code activity for a single local day into a short, honest narrative digest.

Input is:
- DAY FACTS: deterministic aggregates (agent_min, projects, shipped PRs, concurrency_peak, top_flags, top_goal_categories)
- ENTRY SUMMARIES: up to 12 per-session brief_summaries already generated by the enrichment pass
- FRICTION LINES: up to 6 entry-level friction_detail sentences (where present)
- USER INSTRUCTIONS: up to 10 load-bearing asks the user gave across the day

Output ONE JSON object with five fields:

1. headline (string, one sentence, ≤ 120 chars):
   Second-person. Concrete verb + concrete noun. Lead with the most characteristic work of the day.
   Good: "You shipped the Team Edition timeline after two subagent retries."
   Bad:  "You had a productive day."

2. narrative (string, 2-4 sentences, ≤ 600 chars):
   Second-person. Weave the top 3-5 entries into a coherent arc. Name projects. Name specific wins or blockers. Do NOT list every entry.

3. what_went_well (string, ONE sentence or null):
   The strongest positive signal from the day. Tie to a concrete cause ("Subagent loop settled after you split the spec review"). Null if the day was truly friction-dominated.

4. what_hit_friction (string, ONE sentence or null):
   The most load-bearing friction. Tie to a concrete cause. Null if the day was smooth.

5. suggestion (object { headline: string ≤ 60 chars, body: string ≤ 240 chars } or null):
   One actionable next step for tomorrow, grounded in today's pattern. Null if nothing obvious suggests itself; don't pad with truisms.

CRITICAL RULES:

- Second-person ("you ..."), not third-person.
- Copy the user's phrasings where useful; do not invent features or outcomes not in the input.
- Do not mention a project unless it's in DAY FACTS.projects.
- Do not fabricate PR counts, commits, or timestamps.
- If input is sparse (≤ 2 entries or ≤ 10 active_min), err shorter — a one-line headline + null narrative is fine.

RESPOND WITH ONLY VALID JSON (no prose, no code fence):

{
  "headline": "...",
  "narrative": "..." | null,
  "what_went_well": "..." | null,
  "what_hit_friction": "..." | null,
  "suggestion": { "headline": "...", "body": "..." } | null
}`;
```

### User-prompt builder

```ts
export function buildDigestUserPrompt(base: DayDigest, entries: Entry[]): string {
  const enriched = entries.filter(e => e.enrichment.status === "done");
  const summaries = enriched
    .slice(0, 12)
    .map(e => `- (${prettyProject(e.project)}, ${Math.round(e.numbers.active_min)}m) ${e.enrichment.brief_summary ?? ""}`)
    .join("\n");
  const frictions = enriched
    .map(e => e.enrichment.friction_detail)
    .filter((x): x is string => !!x)
    .slice(0, 6)
    .map((f, i) => `${i + 1}. ${f}`)
    .join("\n");
  const instructions = enriched
    .flatMap(e => e.enrichment.user_instructions)
    .slice(0, 10)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  const facts = {
    date: base.key,
    agent_min: base.agent_min,
    project_count: base.projects.length,
    projects: base.projects.map(p => ({ name: p.display_name, share_pct: p.share_pct })),
    shipped_count: base.shipped.length,
    shipped_titles: base.shipped.map(s => s.title),
    concurrency_peak: base.concurrency_peak,
    top_flags: base.top_flags,
    top_goal_categories: base.top_goal_categories,
  };

  return `DAY FACTS:
${JSON.stringify(facts, null, 2)}

ENTRY SUMMARIES (up to 12, most significant first):
${summaries || "(none — no enriched entries)"}

FRICTION LINES (up to 6):
${frictions || "(none — smooth day)"}

USER INSTRUCTIONS (up to 10 load-bearing asks):
${instructions || "(none)"}`;
}
```

### Zod schema

```ts
const SuggestionSchema = z.object({
  headline: z.string().min(1).max(80),
  body: z.string().min(1).max(300),
});

export const DayDigestResponseSchema = z.object({
  headline: z.string().min(1).max(160),
  narrative: z.string().max(1200).nullable(),
  what_went_well: z.string().max(400).nullable(),
  what_hit_friction: z.string().max(400).nullable(),
  suggestion: SuggestionSchema.nullable(),
}).passthrough();

export type DayDigestResponse = z.infer<typeof DayDigestResponseSchema>;
```

Max-lengths are generous-vs-the-prompt to absorb minor overruns without forcing a retry. The renderer truncates with "…" for display if the LLM exceeds the prompt's stated limits.

---

## Phase 1b follow-ups (bundled)

Five items deferred from Phase 1b code review. Land as part of Phase 2 so they're not lost.

1. **`<form onSubmit>` wrap for `ai-features-form.tsx`.** Enter-to-submit + keyboard accessibility. Form gets a single `onSubmit={handleSave}` handler; the Save button stays but loses the direct click-only pathway. No behavior change except Enter-to-submit.

2. **Sidebar link for `/settings`.** Add entry to `apps/web/components/sidebar.tsx`. Icon: `Settings` from `lucide-react`.

3. **`/settings` in `scripts/smoke.mjs`.** Add to the route list so `pnpm verify` catches regressions.

4. **Zod validation on `PUT /api/settings`.** The route currently `as`-casts the body. Add:

   ```ts
   const SettingsUpdateSchema = z.object({
     ai_features: z.object({
       enabled: z.boolean(),
       model: z.string().min(1),
       monthly_budget_usd: z.number().nonnegative().nullable(),
     }).partial(),
   });
   ```

   (Note: `allowed_projects` is not in the schema — dropped per §Amendments.)

5. **Remove unused `EntryEnrichmentStatus` import in `packages/entries/test/fs.test.ts`.** One-line change.

6. **Document `--since` behavior in `fleetlens entries regenerate --help`.** Currently `--since` only applies under `--force`; add a one-line note to the help string. Functional change is not in scope — user asked for doc clarity, not a behavior change.

These are bundled into Phase 2's implementation plan as individual small commits at the start (before the digest work), so they're not blocked on anything larger.

---

## Package structure

Phase 2 touches:

```
packages/entries/                             ← minor additions
  src/
    settings.ts                                EDIT: flip default, drop allowedProjects
    queue.ts                                   EDIT: drop allow-list filter
    fs.ts                                      EDIT: remove listKnownProjects (dead code)
    prompts/digest-day.ts                      NEW: system prompt + Zod schema + user-prompt builder
    digest-day.ts                              NEW: generateDayDigest + buildDeterministicDigest
  test/
    digest-day.test.ts                         NEW
    prompts-digest-day.test.ts                 NEW

packages/cli/                                  ← CLI command + help
  src/
    commands/digest.ts                         NEW
    commands/entries.ts                        EDIT: doc --since behavior
    index.ts                                   EDIT: route `digest day` subcommand

apps/web/                                      ← pages + API + home cards + settings form
  app/
    page.tsx                                   EDIT: add Yesterday hero + Recent days panel
    digest/[date]/page.tsx                     NEW
    digest/[date]/loading.tsx                  NEW
    api/digest/day/[date]/route.ts             NEW: GET + POST SSE
    api/settings/route.ts                      EDIT: add Zod validator
    settings/ai-features-form.tsx              EDIT: drop project-list UI
  components/
    day-digest.tsx                             NEW: presentational
    day-digest-view.tsx                        NEW: client SSE wrapper
    yesterday-hero.tsx                         NEW
    recent-days-panel.tsx                      NEW
    sidebar.tsx                                EDIT: /settings link
  lib/
    ai/digest-day-gen.ts                       NEW: generateDayDigest wrapper
    ai/digest-day-pipeline.ts                  NEW: runDayDigestPipeline generator
    entries.ts                                 NEW: server-only entry reader helper + date utils

scripts/
  smoke.mjs                                    EDIT: add /settings + /digest/yesterday
```

**No changes to:** `packages/parser/**` (V1 insights untouched), `apps/web/app/api/insights/**`, `apps/web/components/insight-report.tsx`, `apps/web/components/insights-view.tsx`, any saved V1 reports.

---

## Testing

### Unit tests

- `packages/entries/test/digest-day.test.ts`:
  - `buildDeterministicDigest` — fixture entries produce expected `agent_min`, `projects`, `shipped`, `concurrency_peak`, `top_flags`, `top_goal_categories`.
  - `generateDayDigest` happy path with injected mock `callLLM` returning valid JSON.
  - `generateDayDigest` parse failure → retry once → success.
  - `generateDayDigest` two parse failures → narrative fields `null`, stderr warning logged.
  - Empty entries → narrative fields `null`, no LLM call.
  - All-trivial entries → narrative fields `null`, no LLM call.
  - Spend-record appended with `kind: "day_digest"`, `ref: date`.

- `packages/entries/test/prompts-digest-day.test.ts`:
  - Zod schema accepts / rejects correct / incorrect fixtures.
  - User-prompt builder truncation (summaries cap at 12, frictions at 6, instructions at 10).

- `packages/cli/test/digest.test.ts`:
  - Flag parsing: `--yesterday`, `--today`, `--date`, `--force`, `--json`, `--pretty`.
  - Exit codes for invalid date, no entries.
  - Pretty renderer produces expected fixtures.

### Integration tests

- **CLI-vs-web parity:** `fleetlens digest day --date X --json` byte-equal to the JSON the web route serves for the same `X` (given the same on-disk state).
- **V1 insights regression:** `scripts/v1-insights-regression.mjs` unchanged output — Phase 2 must not mutate any V1 artifact.
- **Settings migration:** a `~/.cclens/settings.json` with `allowed_projects: ["/x"]` round-trips through `readSettings → writeSettings` and loses `allowed_projects` but retains `enabled` / `model` / `monthly_budget_usd`.
- **Default-on:** a missing `~/.cclens/settings.json` (fresh install) yields `readSettings().ai_features.enabled === true`.

### Pipeline / race tests

- **Concurrent POST coalescing** (§S2): two simultaneous `POST /api/digest/day/X` with `force=0` invoke `runDayDigestPipeline` exactly once. Mock `callLLM` counter asserts one call, both clients receive the same digest.
- **`force=1` bypass** (§S2): while a `force=0` POST is in flight, a `force=1` POST for the same date runs its own pipeline, invoking `callLLM` a second time.
- **Daemon-vs-foreground lockout** (§S6): `runEnrichmentQueue` with a fresh `llm-interactive.lock` present returns `{skipped: "interactive_in_progress"}` without loading entries. Stale lock (mtime >60s) treated as absent.
- **Yesterday hero "no activity" fallback** (§S4.A): with zero entries for yesterday but entries present for a prior day, the hero renders "You were last active …" pointing at the most recent active day's digest URL.

### Smoke (`scripts/smoke.mjs`)

Add routes:

- `/settings` → 200
- `/digest/yesterday` → redirect or 200 (TBD: prefer a real `/digest/[date]` URL computed at smoke time, to avoid flakiness around midnight)

### Manual dogfood

Before merging `feat/v2-perception-phase-2` → `feat/v2-perception-insights`:

1. Run `fleetlens start` on dogfood machine, visit `/` → verify Yesterday hero renders with real narrative.
2. Visit `/digest/yesterday` → verify layout, narrative, goal-mix bar, entries list.
3. Click "Regenerate" → verify SSE streams entries + synth + done; page re-renders.
4. Run `fleetlens digest day --today --pretty` → verify live deterministic-only works.
5. Toggle AI off in `/settings`, reload `/` → verify deterministic-template hero + "Enable AI features" nudge.
6. Toggle AI back on, visit a previously-AI-off-cached day, click Regenerate → verify new narrative overwrites.

---

## Out of scope

- **Week / month / project / session digests** — Phase 4 and Phase 3.
- **Per-project exclusion list** (`excluded_projects`) — additive, easy to add later if asked.
- **Live-Entry enrichment** (enriching today's in-flight entries) — master spec keeps enrichment on settled days only; Phase 2 doesn't change this.
- **Hash-based staleness detection / auto-regen-on-read** — per §Staleness model.
- **Streaming-progress CLI SSE** — the CLI uses stderr line prints instead. The web route uses SSE because that's the idiomatic streaming API in Next; the CLI already has a streaming channel (stderr).
- **Home-page restructure** (removing metric cards, re-ordering the metric-card row, collapsing the Top projects panel into the Projects section of the hero, or any layout changes beyond hero-above-`DashboardView`) — deferred, revisit after dogfood feedback.
- **Entry-aware surfaces on /timeline, /sessions, /calendar, /projects** — Phase 3.
- **Local-model / Ollama enrichment fallback** — still not planned.
- **Budget hard-enforce** (`enforce_hard_budget` flag) — still not planned.

---

## Rollout order

Implementation plan (finalized by `writing-plans`) orders steps as:

1. **Phase 1b follow-ups bundle** — 5 small commits, each atomic.
2. **Settings flip** — `enabled = true` default + drop `allowed_projects`. Immediately unblocks dogfood value for the hero card.
3. **Day-digest generator** (`packages/entries/src/digest-day.ts` + prompts + Zod). Pure, unit-testable.
4. **CLI command** `fleetlens digest day` — proves the generator works end-to-end before any web surface.
5. **Shared pipeline helper** `runDayDigestPipeline`. CLI + web route both call it.
6. **`/api/digest/day/[date]` route** with GET + POST SSE.
7. **`/digest/[date]` page** + `DayDigest` presentational component + `DayDigestView` client wrapper.
8. **Home-page additions**: Yesterday hero + Recent days panel.
9. **Smoke + V1 regression guards** — add routes to `scripts/smoke.mjs`.

Each step has its own commit + passes `pnpm verify` before moving on.

---

## Open questions (none blocking)

None. Decisions in this spec:

- Enrichment trigger fused into digest pipeline — **locked**.
- Staleness model is explicit-regen-only — **locked**.
- Home layout: hero above `<DashboardView>` + Recent days as third panel in bottom row — **locked**. `<DashboardView>` stays unchanged; further restructure deferred.
- `ai_features.enabled` default-true, `allowed_projects` removed — **locked**.
- Day digest prompt: five-field output, second-person voice, null-allowed for `narrative` / `what_went_well` / `what_hit_friction` / `suggestion` — **locked**.
- Daemon-vs-foreground race prevention via top-of-sweep `llm-interactive.lock` check — **locked**. No per-entry locks.
- Concurrent-POST coalescing keyed by `(date, force)` pair; `force=1` never coalesces with `force=0` — **locked**.

---

**Next steps:** user sign-off on this spec → invoke `writing-plans` skill to produce the Phase 2 implementation plan → begin implementation via `subagent-driven-development`.
