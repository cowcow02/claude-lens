# Fleetlens Perception Layer — Phase 3 Design

**Status:** Draft
**Date:** 2026-04-25
**Author:** Brainstormed with user 2026-04-25
**Ships:** Entry-aware existing surfaces — Timeline, Sessions list, Session detail, Projects, Calendar/heatmap, Live-sessions widget. Plus shared visual primitives (`<OutcomePill>`, `entries-index`) and one canonicalization fix.
**Depends on:** Phase 1a + 1b + 2 + 2.1 — `@claude-lens/entries` package fully shipped, `~/.cclens/entries/*.json` populated by deterministic build, `~/.cclens/digests/day/*.json` for past days when user-generated.
**Coexists with:** V1 `/insights` untouched. V2 `/digest` untouched.
**Release strategy:** Branches from `feat/v2-perception-insights` as `feat/v2-perception-phase-3`; PRs back to `feat/v2-perception-insights` (the V2 integration branch). No master merges.

---

## Overview

Phase 2 shipped the Entry primitive and the day digest surface. Phase 3 takes the qualitative layer that `/digest/[date]` exposes — outcome, brief_summary, friction_detail, helpfulness — and surfaces it on the existing pages that already exist around a session or a day. Sessions list rows learn to say "this session shipped"; the timeline learns to say "this run was blocked"; the heatmap tooltip learns to say "Mon Apr 21 was an exploratory day."

Phase 3 is **read-only**. It never auto-enriches, never spawns LLM calls, never writes to disk. It only consumes what `~/.cclens/entries/*.json` already contains. Un-enriched entries get a placeholder pill that links to `/digest/[that-date]` where the user can trigger generation if they want it.

Six surfaces, one shared component, one shared data-loader, one parser fix.

## Vocabulary

No new terms. Phase 3 reuses Phase 2's vocabulary: **Entry**, **Digest**, **outcome**, **helpfulness**, **brief_summary**, **friction_detail**, **enrichment status**.

The visual mark introduced in Phase 2 (the OUTCOME_STYLES const in `apps/web/components/day-digest.tsx`) is extracted into a shared component called `<OutcomePill>`.

---

## Decisions locked

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Session detail uses per-day strips, not aggregated.** A multi-day session shows one strip per local-day it touched. Single-day sessions trivially show one. | The perception layer's whole pivot is `(session × local-day)`. Aggregation would erase the day-by-day arc. |
| Q2 | **Outcome pills appear on every entry-bearing surface.** Sessions list row, timeline session-label row, timeline burst-detail card, session-detail per-day strip, projects-page recent-day mix, heatmap tooltip. Sized down where space is tight (single dot in tooltips; small label-only pill in dense rows). | Consistent visual language; the user can scan outcomes across the product. |
| Q3 | **Un-enriched entries show a `⋯ pending` placeholder pill** that hover-tooltips "Generate Apr 21 digest" and links to `/digest/[that-date]`. Phase 3 surfaces never trigger enrichment — they only point at where to trigger it. | Keeps the user-initiated rule from Phase 2.1 intact. Makes the absence legible and one-click-fixable. |
| Q4 | **Helpfulness is shown only on trend/aggregate surfaces.** Specifically: Projects page (`/projects/[slug]`) — 7-day mood sparkline; Heatmap tooltip — secondary line. NOT on per-session surfaces. | Helpfulness is interesting in aggregate; outcome is interesting per session. Different timescales. |
| Q5 | **`canonicalProjectName` collapses `//` → `/` before pattern-matching;** Warp-specific markers stay out of scope. One unit test fixture; ~3-line change in `analytics.ts`. | The double-slash case is a clear pre-existing bug; Warp may legitimately want separate rollups. |

---

## Shared primitives

### `<OutcomePill>` — `apps/web/components/outcome-pill.tsx`

Pure presentational React component. Owns the OUTCOME_STYLES table currently embedded in `day-digest.tsx`. The day-digest is migrated to import this component; no behavioral change to `/digest/[date]`.

```ts
type OutcomePillProps =
  | {
      // Enriched entry: one of the 6 outcome states.
      outcome: DayOutcome | EntryOutcome;
      size?: "sm" | "md" | "lg";       // default "md"
      label?: "icon" | "text" | "both"; // default "both"; "icon" hides text for tight cells
    }
  | {
      // Un-enriched entry: pending state, rendered as a clickable link.
      outcome: null;
      pending: true;
      sessionId: string;
      localDay: string;                 // YYYY-MM-DD; the link target
      size?: "sm" | "md" | "lg";
    };
```

Six outcome variants reuse the existing `OUTCOME_STYLES` palette. The `pending` variant uses a soft gray pill labeled `⋯` with a `title` of `"Generate {localDay} digest →"` and an `<a>` href of `/digest/{localDay}`.

Size scale:

| Size | Use | Visual |
|---|---|---|
| `lg` | Day-digest hero | 11pt, icon + text |
| `md` | Sessions list row, session-detail strip | 10pt, icon + text |
| `sm` | Timeline session-label, hover tooltip, project mix row | 9pt, icon-only or text-only |

A separate small `<OutcomeMixRow>` helper renders a horizontal sequence of `sm` pills (e.g., last 7 days outcome strip on the Projects page). Pure React, no logic; built on top of `<OutcomePill>`.

### `entries-index.ts` — `apps/web/lib/entries-index.ts`

Server-only. Builds three lookup maps from `~/.cclens/entries/*.json` once per request. Cached at the module level keyed on the entries directory's mtime — invalidated whenever any entry is written.

```ts
import "server-only";
import { listEntryKeys, readEntry, parseEntryKey } from "@claude-lens/entries/fs";
import type { Entry } from "@claude-lens/entries";
import { canonicalProjectName } from "@claude-lens/parser";

export type EntriesIndex = {
  bySession: Map<string, Entry[]>;   // session_id → entries sorted by local_day asc
  byDay: Map<string, Entry[]>;       // YYYY-MM-DD → entries
  byProject: Map<string, Entry[]>;   // canonical project path → entries
  // Convenience: outcome rollup per session (priority: shipped > partial > blocked > exploratory > trivial > idle)
  sessionOutcome: Map<string, DayOutcome | null>;
  // Convenience: outcome rollup per day (already on DayDigest, but we keep it here for cheap access)
  dayOutcome: Map<string, DayOutcome | null>;
};

export async function buildEntriesIndex(): Promise<EntriesIndex>;
```

Reads every entry file. For ~500 entries on disk this is roughly 50ms cold (directory scan + 500 JSON.parse calls). Subsequent requests within the same Node process hit the cache. Concurrent web + daemon writes don't corrupt the cache because the cache is keyed on the entries directory's mtime — any new write bumps the mtime and forces a rebuild.

The `sessionOutcome` and `dayOutcome` rollups follow the same priority rule used by `outcome_day` in `packages/entries/src/digest-day.ts` — extracted into a shared helper so the two rollups stay in sync.

### Canonicalization fix — `packages/parser/src/analytics.ts`

```diff
 export function canonicalProjectName(projectName: string): string {
+  // Normalize anomalous double-slash paths that some upstream sources
+  // produce (e.g., //claude/worktrees/...). Collapse before pattern-match.
+  const normalized = projectName.replace(/\/{2,}/g, "/");
-  const hit = findWorktreeMarker(projectName);
-  if (hit) return projectName.slice(0, hit.idx);
-  return projectName;
+  const hit = findWorktreeMarker(normalized);
+  if (hit) return normalized.slice(0, hit.idx);
+  return normalized;
 }
```

Plus a unit test fixture in `packages/parser/test/analytics.test.ts` covering both regression cases (the `//claude/worktrees/...` case + a plain double-slash that shouldn't be a worktree). Existing fixtures stay green.

---

## Surfaces

### S1. Sessions list (`/sessions`)

**Files:** `apps/web/app/sessions/page.tsx`, `apps/web/app/sessions/sessions-grid.tsx`

The page renders both a grid view (`<SessionCard>`) and a table view (`<DataTable>`). Both views update.

**Data flow:** Server component loads `await listSessions()` and `await buildEntriesIndex()` in parallel, then passes the index alongside sessions into `<SessionsGrid>`. The grid reads `index.sessionOutcome.get(s.id)` for each row.

**Grid view changes:**

```
┌─ ●  fleetlens                        TEAM         3h ago ─┐
│  [shipped]                                                │   ← new pill row
│  fix entry-render bug when fr…                            │   ← brief_summary if enriched, else firstUserPreview
│  ↳ Patched the render function and added a r…             │   ← lastAgentPreview unchanged
│                                                            │
│  9 turns · 30 tools · 5m · 12k                            │
└────────────────────────────────────────────────────────────┘
```

- New pill row sits between header and message body.
- Body line shows `brief_summary` when `enrichment.status === "done"` and a `brief_summary` exists; otherwise `firstUserPreview` (current behavior).
- Last-agent line unchanged.

**Table view changes:**

| col | change |
|---|---|
| Outcome | NEW. Renders `<OutcomePill size="sm" />` or pending placeholder. Sortable by outcome priority order. |
| First message | Renders `brief_summary` (when enriched) or `firstUserPreview` (fallback). Same column header label kept; tooltip on hover shows raw preview if substituted. |

Sortable by outcome — the priority rule `shipped > partial > blocked > exploratory > trivial > idle > pending`.

**Empty/error states.** Sessions with no Entry on disk (e.g., trivial sessions filtered out at build time, or sessions older than the entry layer) render with the pending pill omitted and the legacy `firstUserPreview` body. They're indistinguishable from un-enriched entries to the user — both fall back to deterministic data — but only the un-enriched-but-buildable ones get the click-to-generate placeholder.

The route stays under 100ms cold; table view doesn't paginate today, so the index does the heavy lifting once per request.

### S2. Timeline (`/parallelism`)

**Files:** `apps/web/app/parallelism/page.tsx`, `apps/web/app/parallelism/gantt-chart.tsx`

The page is day-scoped; it already shows sessions and concurrency bursts for one local day. Phase 3 layers entry-awareness in three places.

**1. Session-label column (left side, always visible).**

Each row currently shows a project-color dot + first user preview. Phase 3 adds a `<OutcomePill size="sm" label="icon" />` between the dot and the text, **only when the entry for that session × the page's date is enriched.** Un-enriched rows render no pill (not the pending placeholder — that surface is too cramped, the tooltip is where pending state lives).

```
●  🚀  fix entry-render bug when frontmatter is missing
●  🚧  flaky test investigation
●      <un-enriched session — no pill>
```

Sizing rule: just the icon glyph, no text. Project color dot stays.

**2. Hover tooltip on session bar.**

The existing tooltip lists `Active`, `Segments`, `Range`, `Tokens`. Phase 3 adds two new lines at the top when the entry is enriched:

```
[🚀 Shipped]                                       ← outcome pill
"Patched the render function; flaky test still flaky."  ← brief_summary
─────────────
Active: 24m   Segments: 3
Range: 09:14–11:58
Tokens: …
```

Un-enriched entries show a `[⋯ Generate {date} digest →]` pending pill instead.

**3. Burst detail modal session cards.**

Each session card currently shows project / firstUserPreview / lastAgentPreview / active-in-burst. Phase 3 adds the outcome pill on the right edge of the card header, next to the active-in-burst stat. Same sizing as session-list pills (`sm`).

The Concurrency burst-list panel above the Gantt is *not* changed — it's already dense with cross-project / peak / project-name; outcome at the burst level isn't well-defined (a burst could span 4 sessions with mixed outcomes, and presenting any single outcome would mislead).

**Data flow:** `parallelism/page.tsx` calls `buildEntriesIndex()` alongside its existing `listSessions()` / `getSession(...)` chain. The index is passed into `<GanttChart>` as a prop. The client component looks up `index.bySession.get(session.id)` filtered to the page's `date`.

### S3. Session detail (`/sessions/[id]`)

**Files:** `apps/web/app/sessions/[id]/page.tsx`, `apps/web/app/sessions/[id]/session-view.tsx`

Per-day strips, stacked vertically, between the existing header and the existing transcript. One strip per local-day this session touched.

**Strip layout (per day):**

```
┌─ 📅 Mon · Apr 21    [🚀 Shipped]    24m active        ─┐
│                                                          │
│  "Patched the entry render function and added a          │
│   regression test; flaky test investigation deferred."   │
│                                                          │
│  ✓ what went well: subagent loop settled after spec      │
│    split.                                                 │
│  ⚠ what hit friction: first pass missed budget-cap test. │
│                                                          │
│  Top user instructions:                                   │
│  • "fix the rate-limit retry loop"                       │
│  • "regenerate the affected entries"                      │
│                                                          │
│                              [open day digest →]          │
└──────────────────────────────────────────────────────────┘
```

Compact, single-column strip. Renders only when the session has at least one Entry on disk for that day. Multiple strips stack newest-first.

**Empty / pending strips.** A day this session touched but for which the entry is `pending` or `error` shows a slim strip:

```
┌─ 📅 Mon · Apr 21    [⋯ pending]    24m active           ─┐
│  Click to generate this day's digest →                   │
└──────────────────────────────────────────────────────────┘
```

Linking to `/digest/2026-04-21` (which itself has the user-initiated generate button).

**Trivial entries** (`enrichment.status === "skipped_trivial"`) show a slim strip labeled `[💤 Warmup]` with no body — the strip exists for transparency but doesn't pretend to have a narrative.

**Single-day sessions** (the majority) get one strip; the visual cost is identical to a single header bar.

**Data flow:** `session/[id]/page.tsx` fetches the session as today, *plus* `await listEntriesForSession(id)`. Entries pass to `<SessionView>` as a new `entries: Entry[]` prop. The view component renders the strips above the existing transcript.

### S4. Projects page (`/projects` and `/projects/[slug]`)

**Files:** `apps/web/app/projects/page.tsx`, `apps/web/app/projects/projects-view.tsx`, `apps/web/app/projects/[slug]/page.tsx`

**`/projects` index:** each project card gains a 7-day outcome mix row. The mix is computed from `index.byProject.get(canonicalName)` filtered to the last 7 local days (in the project's local TZ).

```
fleetlens                                       3 sessions today
recent: 🚀 🚀 🔨 🚀 🧭 🚀 💤              (last 7 days)
```

The 7-pill row reads oldest→newest, left-to-right. Days with no entries render an empty-grey placeholder dot. The mix row replaces nothing — it's added below the existing stat grid.

**`/projects/[slug]` detail:** two additions.

1. **Recent days strip** — a horizontal row of the last 7 day-cards. Each card shows the date, outcome pill, agent_min, PR count. Click → `/digest/{date}`.

```
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│ Mon  │ Sun  │ Sat  │ Fri  │ Thu  │ Wed  │ Tue  │
│ 🚀   │ 🚀   │ 🔨   │ 🚀   │ 🧭   │ 🚀   │ 💤   │
│ 4h   │ 2h   │ 3h   │ 5h   │ 1h   │ 4h   │ 12m  │
│ 2 PR │ 1 PR │ —    │ 2 PR │ —    │ 1 PR │ —    │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

2. **Helpfulness sparkline** — a single row below the recent-days strip showing `helpfulness_day` across the same 7 days. A small bar height encodes the level (essential = full, helpful = 80%, neutral = 50%, unhelpful = 25%). No labels per cell — a single legend row underneath. Hovering shows the day + level.

```
mood: ▌▌▍▍▍ ▎ ▌                  legend: essential · helpful · neutral · unhelpful
```

Helpfulness is read from the cached `~/.cclens/digests/day/*.json` for that day. If no digest is cached (user hasn't generated it), the cell is grey and the tooltip says "Generate Apr 21 digest →" with the same `/digest/[date]` link.

The existing "Pull requests shipped" + "Recent sessions" panels stay unchanged.

### S5. Calendar / heatmap (home dashboard)

**Files:** `apps/web/components/heatmap.tsx`, used by `apps/web/components/dashboard-view.tsx`

The heatmap currently renders cells colored by session-count. Phase 3 keeps the cell coloring (don't break the existing visual language) but enriches the **hover tooltip** and adds a **click handler**.

**Tooltip changes:**

```
2026-04-21    [🚀 Shipped]                       ← new pill
"Shipped Team Edition timeline after two retries." ← new line: digest headline (or fallback)
─────
4 sessions · 31 tool calls · peak ×2
Claude: helpful                                    ← new line: helpfulness (only if enriched)
```

The headline comes from `~/.cclens/digests/day/{date}.json` if cached. If not cached, it falls back to the deterministic template ("Worked 4h 12m across 2 projects; shipped 3 PRs."). If no entries at all, the existing tooltip rendering wins (no new lines).

**Click handler.** Cells with `bucket.sessions > 0` become clickable. Click navigates to `/digest/{date}`. Cells with zero sessions remain non-clickable (they already render with `cursor: default`).

**Data flow:** `dashboard-view.tsx` already loads sessions; it adds `await buildEntriesIndex()` and `await listCachedDayDigests()` (a new helper that just lists the keys + headlines from `~/.cclens/digests/day/`, no full parse). Both are passed to the heatmap as props.

### S6. Live-sessions widget

**Files:** `apps/web/components/live-sessions-widget.tsx`

The floating bottom-right widget renders one card per live session. Phase 3 adds a single visual element: the `[⋯ pending]` placeholder pill on each card, sized `sm`.

Why pending always? Today's entries are by-spec never enriched by the daemon (settled-day rule). The user can manually generate today's digest from `/digest/today`, which would enrich today's entries — but until then, every live session's entry is in `pending` status. The pill makes that legible and points to where it could be generated.

```
[⋯ pending]   what am I working on now…
              ↳ agent saying things…
              project-name
```

A live session whose entry IS enriched (rare — only after a manual generate-today) shows the proper outcome pill instead.

**Data flow:** The widget is a client component, so it can't call `buildEntriesIndex()`. The root layout (where the widget lives) gains a server-component shim that loads the index and passes a slimmed-down `Map<sessionId, EnrichmentStatus>` as a prop. The widget reads from that map.

### S7. Foundation cleanup

The `OUTCOME_STYLES` and `outcomeBadge` constants currently embedded in `apps/web/components/day-digest.tsx` migrate to `outcome-pill.tsx`. The day-digest imports `<OutcomePill>` from there. No other behavior change.

---

## Architecture diagram

```
~/.cclens/entries/*.json (already populated by Phase 2 daemon)
        │
        ▼
[entries-index.ts: buildEntriesIndex()] (new, server-only, mtime-cached)
        │
        ├─► EntriesIndex { bySession, byDay, byProject, sessionOutcome, dayOutcome }
        │
        ▼
┌───────────────────────────────────────────────────────────────────────┐
│ Phase 3 surfaces (read-only consumers)                                 │
│                                                                        │
│  /sessions          → grid+table show outcome pill, brief_summary      │
│  /sessions/[id]     → per-day strips above transcript                  │
│  /parallelism       → label icons + tooltip lines + burst-modal cards  │
│  /projects          → 7-day outcome mix row per card                   │
│  /projects/[slug]   → recent-days strip + helpfulness sparkline        │
│  / (heatmap)        → tooltip enrichment + click→/digest               │
│  Live widget        → pending pill on live session cards               │
│                                                                        │
│  Each surface uses <OutcomePill> for visual consistency.               │
│  Un-enriched data degrades to deterministic fallbacks; pending pill    │
│  links out to /digest/[date] where user-initiated enrichment happens.  │
└───────────────────────────────────────────────────────────────────────┘
```

No daemon changes. No LLM. No writes to disk. No new routes. No new API endpoints.

---

## Package structure

Phase 3 touches only `apps/web/` plus one parser file:

```
apps/web/
  components/
    outcome-pill.tsx            NEW: shared pill component
    outcome-mix-row.tsx         NEW: helper for horizontal pill strips
    day-digest.tsx              EDIT: import OutcomePill instead of inline OUTCOME_STYLES
    heatmap.tsx                 EDIT: tooltip pill + headline; click→/digest
    live-sessions-widget.tsx    EDIT: pending pill on cards
  lib/
    entries-index.ts            NEW: per-request EntriesIndex builder
  app/
    sessions/page.tsx                EDIT: load index, pass to grid
    sessions/sessions-grid.tsx       EDIT: pill column + brief_summary fallback
    sessions/[id]/page.tsx           EDIT: load entries
    sessions/[id]/session-view.tsx   EDIT: per-day strips above transcript
    parallelism/page.tsx             EDIT: load index, pass to chart
    parallelism/gantt-chart.tsx      EDIT: label icons + tooltip + burst modal pills
    projects/page.tsx                EDIT: load index, pass to view
    projects/projects-view.tsx       EDIT: 7-day outcome mix row
    projects/[slug]/page.tsx         EDIT: recent-days strip + helpfulness sparkline
    layout.tsx                       EDIT: load EnrichmentStatus map for live widget

packages/parser/
  src/analytics.ts              EDIT: canonicalProjectName double-slash normalize
  test/analytics.test.ts        EDIT: add 2 fixtures (//claude/worktrees/.., plain //)

scripts/
  smoke.mjs                     EDIT: nothing — existing routes already covered

docs/superpowers/specs/2026-04-25-perception-layer-phase-3-design.md  THIS FILE
docs/superpowers/plans/2026-04-25-perception-layer-phase-3.md         (next step)
```

**No changes to:**
- `packages/entries/**` — reuses existing fs.ts and types.ts as-is.
- `packages/cli/**` — no new commands.
- `apps/web/app/digest/**` — Phase 2 surface unchanged.
- `apps/web/app/api/**` — no new endpoints.
- V1 insights — completely untouched.

---

## Performance

| Surface | Cold cost | Warm cost |
|---|---|---|
| `/sessions` | listSessions ~5ms + buildEntriesIndex ~50ms = ~55ms | ~5ms (cache hit) |
| `/parallelism` | existing day-load ~80ms + ~50ms = ~130ms | ~85ms |
| `/sessions/[id]` | existing detail load ~30-200ms + listEntriesForSession ~10ms (small N) | unchanged |
| `/projects` | groupByProject ~5ms + ~50ms = ~55ms | ~10ms |
| `/projects/[slug]` | existing project load + ~50ms + listCachedDayDigests ~5ms = ~60-80ms | unchanged |
| Home (heatmap) | dashboard load ~30ms + ~50ms + ~5ms = ~85ms | ~35ms |

The `EntriesIndex` cache is a single module-level `let` keyed on the entries-directory mtime; no LRU, no eviction logic. For a heavy user with 1000 entries the cache is ~3 MB resident and rebuilds in ~100ms when invalidated. Acceptable.

If the live-widget shim creates contention (every page renders the layout, which now does an entries-index build), the layout-level shim caches a slim `Map<sessionId, EnrichmentStatus>` at the same TTL.

---

## Testing

### Unit

- `apps/web/components/outcome-pill.test.tsx` — renders correct icon+label per outcome variant; pending variant renders correct href.
- `apps/web/lib/entries-index.test.ts` — given a fixture entries dir, builds correct `bySession` / `byDay` / `byProject` / outcome rollups; cache invalidation on mtime bump.
- `packages/parser/test/analytics.test.ts` — adds 2 cases:
  - `canonicalProjectName("//claude/worktrees/foo/bar")` → strips correctly.
  - `canonicalProjectName("/Users//foo/Repo/bar")` → returns `/Users/foo/Repo/bar` (double-slash collapse without worktree marker).

### Integration / smoke (`scripts/smoke.mjs`)

All Phase 3 surfaces are pre-existing routes — they already return 200 under smoke. Phase 3 only changes their content. The existing smoke set is sufficient.

### Manual dogfood

Before merging `feat/v2-perception-phase-3` → `feat/v2-perception-insights`:

1. Visit `/sessions` — see outcome pills on rows that have enriched entries; see `⋯ pending` placeholders elsewhere; click a placeholder → land on `/digest/[that-date]`.
2. Visit `/sessions/[some-recent-id]` — see per-day strips above the transcript; multi-day session shows multiple strips.
3. Visit `/parallelism` for yesterday — see icon-only pills on session-label rows; hover a session bar → tooltip shows outcome pill + brief_summary.
4. Click a burst row → modal shows session cards with outcome pills.
5. Visit `/projects` — see 7-day mix row on each card.
6. Visit `/projects/[some-slug]` — see recent-days strip + helpfulness sparkline.
7. Hover a heatmap cell on home → tooltip shows outcome pill + headline; click → land on `/digest/[that-date]`.
8. Live widget on home (with a running session) — pending pill visible on the live card.

Verify the existing `/digest/[date]` page still renders correctly post-OutcomePill extraction (regression check).

---

## Risk + open questions

1. **Module-level cache and Next dev mode.** Next 16's hot-reload may keep stale module state across edits in dev. The mtime-keyed cache mitigates this for entry writes; but if `entries-index.ts` itself is edited the cache instance changes (new module, new cache). Acceptable.

2. **`buildEntriesIndex()` called from layout.tsx.** Means *every* page request pays the index cost (modulo cache). Mitigation: the layout shim only extracts the `EnrichmentStatus` map, and we can make that even cheaper if profiling shows it matters.

3. **Per-session outcome rollup on a session that spans multiple days.** Sessions list has one pill per session; if the session shipped Mon and was blocked Wed, what does the row show? Decision: priority rule from `outcome_day` (`shipped > partial > blocked > exploratory > trivial > idle`). The session-detail page is where the per-day breakdown lives — sessions list optimizes for scan-ability.

4. **Heatmap cell click navigation may surprise users** who expect the existing hover-only behavior. Mitigation: `cursor: pointer` on clickable cells, no other affordance change. Existing hover tooltip still fires.

5. **Phase 4 dependency.** Phase 3 reads `helpfulness_day` from cached digests on disk. Days the user hasn't generated have `null` helpfulness — the sparkline shows greyed cells. That's correct behavior, not a bug; it self-resolves as the user generates more days.

---

## Out of scope

- **Generation triggers.** Every Phase 3 surface that wants to show something un-enriched links out to `/digest/[date]`. Phase 3 has no buttons, no SSE pipelines, no settings touches.
- **Week / month / project digests.** Phase 4.
- **V2 insights report.** Phase 4.
- **New filters / search on outcome.** The sessions table is sortable by outcome, but there's no `?outcome=shipped` filter chip in the toolbar. Add later if asked.
- **Warp-specific worktree marker.** Q5 deferred.
- **CLI changes.** No `fleetlens entries` UX changes.
- **Live in-flight Entry enrichment.** Master spec keeps enrichment on settled days only.
- **Heatmap's helpfulness sparkline parallel.** Helpfulness lives only on Projects detail; heatmap stays simple.

---

## Rollout order

The implementation plan (next step, separate document) sequences as:

1. **Foundations** — `<OutcomePill>` component + tests, `entries-index.ts` + tests, canonicalProjectName fix + tests, day-digest migration to OutcomePill (regression check on `/digest/[date]`).
2. **Sessions list** — easiest-to-validate visual change; lots of rows to demonstrate the pill states.
3. **Session detail** — biggest single component change (per-day strips); benefits from foundations being done first.
4. **Timeline** — pill in label row + tooltip + burst modal cards.
5. **Projects** — both views, with helpfulness sparkline as the trickiest piece.
6. **Heatmap + click handler** — small change to heatmap.tsx.
7. **Live-sessions widget + layout shim** — last; touches the layout.tsx and is small.
8. **Smoke + dogfood verify** — confirm no regressions.

Steps 2–7 can run in parallel via subagent-driven-development once foundations land. Each step gets its own commit. PR opens at step 7 conclusion.

---

**Next steps:** Write implementation plan → execute via subagent-driven-development → verify build → present running surfaces.
