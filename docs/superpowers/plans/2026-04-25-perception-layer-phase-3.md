# Phase 3 implementation plan — entry-aware existing surfaces

**Spec:** `docs/superpowers/specs/2026-04-25-perception-layer-phase-3-design.md`
**Branch:** `feat/v2-perception-phase-3` (worktree at `.worktrees/phase-3`)
**Base:** `feat/v2-perception-insights`

Steps numbered as commits. Each commit must pass `pnpm typecheck` and any added unit tests. The dev-server smoke happens once after step 9.

---

## 0. Pre-flight (no commit)

```bash
cd /Users/cowcow02/Repo/claude-lens/.worktrees/phase-3
pnpm install        # if pnpm-lock changed; usually a no-op
```

Verify `~/.cclens/entries/` has at least a few enriched entries on the dev machine so each surface has something real to render. If empty, generate `/digest/yesterday` once via the existing UI to seed data.

---

## 1. Foundation — `<OutcomePill>` component + day-digest migration

**Files:**
- `apps/web/components/outcome-pill.tsx` — NEW
- `apps/web/components/outcome-mix-row.tsx` — NEW
- `apps/web/components/day-digest.tsx` — EDIT (replace inline `OUTCOME_STYLES` + `outcomeBadge` with imports)

**OutcomePill API:**
```ts
type Size = "sm" | "md" | "lg";
type Label = "icon" | "text" | "both";

type OutcomePillProps =
  | { outcome: DayOutcome | EntryOutcome; size?: Size; label?: Label }
  | { outcome: null; pending: true; sessionId: string; localDay: string; size?: Size };
```

`DayOutcome` is the existing type from `@claude-lens/entries`. `EntryOutcome` is the per-entry outcome (`"shipped" | "partial" | "blocked" | "exploratory" | "trivial"`). Inline define a small union type if the entries package doesn't export one.

**OutcomeMixRow:** renders `Entry[]` (or null placeholders) as a horizontal row of `sm` icon-only pills, oldest→newest. Used by `/projects` cards.

**Verify:** `/digest/[date]` looks identical pre/post-migration. Eyeball one cached digest in the dev server. Run `pnpm -F @claude-lens/web typecheck`.

**Commit:** `feat(web): extract <OutcomePill> + <OutcomeMixRow> shared components`

---

## 2. Foundation — `entries-index.ts`

**Files:**
- `apps/web/lib/entries-index.ts` — NEW
- (no test for now; integration check in step 3)

**Exports:**
```ts
import "server-only";
export type EntriesIndex = { ... };
export async function buildEntriesIndex(): Promise<EntriesIndex>;
export function rollupOutcome(entries: Entry[]): DayOutcome | null;  // priority rule
```

Cache key: `statSync(entriesDir()).mtimeMs`. Cache value: `EntriesIndex`. Module-level `let cache: { mtime: number; index: EntriesIndex } | null = null`.

`rollupOutcome` follows `shipped > partial > blocked > exploratory > trivial > idle`. Used both by the `EntriesIndex` itself and externally where a Phase 3 surface needs to fold a list of entries.

**Commit:** `feat(web): add lib/entries-index.ts with mtime-cached entries map`

---

## 3. Foundation — `canonicalProjectName` double-slash fix

**Files:**
- `packages/parser/src/analytics.ts` — EDIT (3-line change at top of `canonicalProjectName`)
- `packages/parser/test/analytics.test.ts` — EDIT (add 2 fixtures)

Run `pnpm -F @claude-lens/parser test`. Existing tests must stay green.

**Commit:** `fix(parser): canonicalProjectName collapses double-slash paths`

---

## 4. Sessions list surface

**Files:**
- `apps/web/app/sessions/page.tsx` — EDIT: load `buildEntriesIndex()` in parallel with `listSessions()`; pass index as prop.
- `apps/web/app/sessions/sessions-grid.tsx` — EDIT:
  - Grid `<SessionCard>`: add pill row above body; substitute `brief_summary` for `firstUserPreview` when enriched.
  - Table column set: replace `preview` column's render to substitute brief_summary; add new `outcome` column (sortable, priority-based).

**Visual sanity:** Run dev server, visit `/sessions`. Look for: pill on enriched rows, pending placeholder elsewhere, brief_summary substitution.

**Commit:** `feat(web/sessions): outcome pills + brief_summary on session list`

---

## 5. Session detail per-day strips

**Files:**
- `apps/web/app/sessions/[id]/page.tsx` — EDIT: `await listEntriesForSession(id)` in parallel with `getSession(id)`; pass `entries` prop.
- `apps/web/app/sessions/[id]/session-view.tsx` — EDIT: render `<EntryDayStrip>` stack between header and transcript. New presentational component (inline in session-view, not extracted unless > ~80 lines).

**Strip variants:**
- enriched: outcome pill + brief_summary + what_went_well + what_hit_friction + top user_instructions + open-day-digest link.
- pending: outcome pill placeholder + click-to-generate hint.
- skipped_trivial: warmup pill, no body.

**Verify:** Visit a single-day session and a multi-day session (resumed). Check both render correctly.

**Commit:** `feat(web/sessions): per-day Entry strips on session detail`

---

## 6. Timeline pills

**Files:**
- `apps/web/app/parallelism/page.tsx` — EDIT: load index, pass to chart.
- `apps/web/app/parallelism/gantt-chart.tsx` — EDIT (3 places):
  1. Session-label column: render `<OutcomePill size="sm" label="icon" />` only when entry is enriched. Look up via `index.bySession.get(s.id)?.find(e => e.local_day === gantt.date)`.
  2. Hover tooltip: prepend outcome pill + brief_summary lines (or pending placeholder line).
  3. `<BurstDetailModal>` session cards: outcome pill on right edge of card header.

**Verify:** Visit `/parallelism`, hover a few sessions, click a burst row, inspect modal cards.

**Commit:** `feat(web/timeline): outcome pills on labels, tooltip, burst modal`

---

## 7. Projects pages

**Files:**
- `apps/web/app/projects/page.tsx` — EDIT: load index, pass to view.
- `apps/web/app/projects/projects-view.tsx` — EDIT (`<ProjectCard>`): add 7-day `<OutcomeMixRow>` row.
- `apps/web/app/projects/[slug]/page.tsx` — EDIT: load entries scoped to project; render recent-days strip + helpfulness sparkline component.
- `apps/web/components/helpfulness-sparkline.tsx` — NEW (small, presentational): renders 7 bars + tooltip + legend.

**Helpfulness data:** read from `~/.cclens/digests/day/*.json` for the relevant 7 days (use `readDayDigest(date)` from `@claude-lens/entries/fs`). Days without a digest render greyed cells.

**Verify:** Visit `/projects`, see mix rows. Click into a project, see recent-days strip + sparkline.

**Commit:** `feat(web/projects): 7-day outcome mix + helpfulness sparkline`

---

## 8. Heatmap enrichment + click

**Files:**
- `apps/web/components/heatmap.tsx` — EDIT (already client component):
  - Add new optional props: `dayOutcomes: Map<string, DayOutcome | null>`, `dayHeadlines: Map<string, string | null>`, `dayHelpfulness: Map<string, DayHelpfulness | null>`.
  - Tooltip: prepend pill + headline lines when present; append `Claude: <helpfulness>` when present.
  - Click handler on cells with `bucket.sessions > 0`: `<a href={`/digest/${bucket.date}`}>` wrapping the `<rect>`. Cursor: pointer.

- `apps/web/components/dashboard-view.tsx` — EDIT: load the index + cached digest map (a small new helper `listCachedDayDigests(): Promise<Map<date, {headline, helpfulness}>>`); pass props to `<Heatmap>`.

**`listCachedDayDigests` helper** lives in `apps/web/lib/entries-index.ts` since it's the same caching tier (mtime-keyed off `~/.cclens/digests/day/`).

**Verify:** Visit `/`, hover heatmap cells, click a cell with activity → digest page opens.

**Commit:** `feat(web/heatmap): outcome pill + headline tooltip; click→/digest`

---

## 9. Live-sessions widget pending pill + layout shim

**Files:**
- `apps/web/app/layout.tsx` — EDIT: load a slim `Map<sessionId, EnrichmentStatus | null>` (helper in `entries-index.ts`); pass to `<LiveSessionsWidget>`.
- `apps/web/components/live-sessions-widget.tsx` — EDIT: accept new optional `entriesByLiveSession` prop; render `<OutcomePill>` (pending or actual) on each card.

**Verify:** With a live session running, see pending pill on the live-widget card.

**Commit:** `feat(web/live): pending pill on live-sessions widget cards`

---

## 10. Smoke + verify

```bash
cd /Users/cowcow02/Repo/claude-lens/.worktrees/phase-3
pnpm install --frozen-lockfile
pnpm typecheck
pnpm -F @claude-lens/parser test
pnpm -F @claude-lens/entries test
pnpm verify   # runs smoke against dev server
```

If smoke fails on a route, the dev-server logs show the rendering error — fix in place, re-run.

Visit each surface manually per the spec's manual dogfood section §S5.

---

## 11. PR

```bash
gh pr create \
  --base feat/v2-perception-insights \
  --head feat/v2-perception-phase-3 \
  --title "Phase 3: entry-aware existing surfaces" \
  --body "$(cat <<'EOF'
## Summary

- Sessions list, Session detail, Timeline, Projects, Heatmap, Live widget all surface the perception layer's qualitative output.
- New shared <OutcomePill> + <OutcomeMixRow> + lib/entries-index.ts.
- canonicalProjectName collapses `//` → `/` to fix anomalous worktree paths.
- Read-only: no enrichment triggers, no API endpoints, no daemon changes.

Spec: docs/superpowers/specs/2026-04-25-perception-layer-phase-3-design.md
Plan: docs/superpowers/plans/2026-04-25-perception-layer-phase-3.md

## Test plan

- [x] /digest/[date] visually unchanged (regression)
- [x] /sessions: outcome pills, brief_summary fallback, sortable
- [x] /sessions/[id]: per-day strips on multi-day session
- [x] /parallelism: pill icons, tooltip, burst modal cards
- [x] /projects: 7-day outcome mix; /projects/[slug]: recent days + sparkline
- [x] /: heatmap tooltip pill + headline; click→/digest
- [x] live widget: pending pill on live cards
- [x] parser tests pass; double-slash fixtures cover regression

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Do not** push to master. PR target is `feat/v2-perception-insights`. Hold the merge until the user reviews the running surfaces in their browser.

---

## Parallelism notes for subagent dispatch

Steps 1, 2, 3 are sequential (foundations land first; step 1 before 2 because day-digest migration verifies pill rendering before downstream surfaces depend on it).

Steps 4, 5, 6, 7, 8, 9 are independent — each touches different files and consumes the foundations as dependencies. Can dispatch all six in parallel after step 3 lands. Each subagent works on its own commit, base = step 3's commit.

Step 10 (smoke) gates step 11 (PR).

Each subagent is given:
- This plan section for its step
- The spec file for full context
- The base commit to branch from
- Strict TDD: add a unit test where the change has logic (entries-index, outcome rollup); skip TDD for purely presentational changes (most of Phase 3).

---

## Rollback / pause points

After each commit the worktree is in a known-good state — you can stop, leave the work where it is, and pick up later. The branch is isolated in `.worktrees/phase-3` so the primary tree's dogfood install stays intact.

If a step lands a regression, revert the offending commit (`git revert <sha>`) and re-attempt. Don't amend; we want clean history for the eventual PR review.
