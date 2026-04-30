# Fleetlens Perception Layer — Phase 1b Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM-enrich Phase 1a Entries — populate the six `enrichment.*` fields left `pending` by the deterministic layer, driven by the existing daemon perception worker. Plus settings wiring, budget tracker, regenerate CLI, and two Phase 1a follow-ups folded in.

**Architecture:** Extend the daemon perception worker with a second pass that runs Sonnet 4.6 enrichment against every Entry satisfying all gates (`ai_features.enabled`, apiKey present, project allowlist, monthly budget cap, not-today, 30-min settled, `retry_count < 3`). Entry writes use existing `writeEntry` atomic rename. Spend appended to `~/.cclens/llm-spend.jsonl` (re-read every loop iteration — no in-memory cache). Settings persisted at `~/.cclens/settings.json` with `chmod 600`. New `./node` subpath on `@claude-lens/entries` exports LLM code, gated by `server-only` to block accidental client-bundle inclusion.

**Tech Stack:**
- `@anthropic-ai/sdk` (Claude Sonnet 4.6 via `claude-sonnet-4-6` model id) — new dependency in `@claude-lens/entries`
- `zod` — new dependency in `@claude-lens/entries` for LLM response validation
- `server-only` — new dependency for the `./node` subpath guard
- existing: vitest, TypeScript 5.5, pnpm workspace, Next.js 16 App Router, esbuild CLI bundle

**Spec:** `docs/superpowers/specs/2026-04-22-perception-layer-phase-1b-design.md` (commit `070fd8f`).

**Branch:** `feat/v2-perception-phase-1b` off `feat/v2-perception-insights`. Close with PR to the feature branch, not master.

---

## File structure

**Modify:**

- `packages/entries/src/types.ts` — add `retry_count: number` to `EntryEnrichment`; update comment on `goal_categories` to document values-are-minutes; `pendingEnrichment()` and `skippedTrivialEnrichment()` return `retry_count: 0`.
- `packages/entries/src/build.ts` — replace `subagent_calls >= 3` predicate with `subagent_turns >= 3` (count turns dispatching agents, not total dispatches). Per-turn accumulation; discarded after aggregation — no Entry field added.
- `packages/entries/src/fs.ts` — new `listEntriesWithStatus(statuses: EntryEnrichmentStatus[]): Entry[]`, oldest-first by `local_day`; new `listKnownProjects(): string[]` sorted unique project values (used by Settings page to populate the allowlist multi-select without reading full Entries at render time for the UI-path that only needs project names).
- `packages/entries/src/index.ts` — unchanged. `listEntriesWithStatus` and `listKnownProjects` reach consumers via the `./fs` subpath only (Node-only; stays out of root bundle).
- `packages/entries/package.json` — add `./node` subpath export; add deps `@anthropic-ai/sdk`, `zod`, `server-only`.
- `packages/cli/src/perception/scan.ts` — `listAllSessionJsonls(root?: string)` — accept injectable projects root.
- `packages/cli/src/perception/worker.ts` — accept `opts.projectsRoot` threaded to `listAllSessionJsonls`; call `runEnrichmentQueue` (imported from `@claude-lens/entries/node`) after the deterministic sweep.
- `packages/cli/src/perception/worker.test.ts` — real directory-injection integration test replacing the current stub.
- `packages/cli/src/commands/entries.ts` — add `regenerate` subcommand.
- `apps/web/package.json` — add `@claude-lens/entries` workspace dep (not currently present).
- `apps/web/next.config.ts` — add `"@claude-lens/entries"` to the `transpilePackages` array.
- `apps/web/app/settings/page.tsx` — add "AI Features" section (new file if `/settings` doesn't exist; spec assumes it does — verify in Task 10).
- `apps/web/app/api/settings/route.ts` — GET/PUT settings (create if missing).

**Create:**

- `packages/entries/src/budget.ts` — `appendSpend`, `monthToDateSpend`, `__setSpendPathForTest`.
- `packages/entries/src/settings.ts` — read/write `~/.cclens/settings.json` with env-var fallback and atomic `chmod 600` write. Shared by CLI and web server.
- `packages/entries/src/prompts/enrich.ts` — prompt template + Zod schema + input formatter.
- `packages/entries/src/enrich.ts` — `enrichEntry(entry, opts)` returning `{ entry, usage }` so callers (queue, CLI) can record real token counts in spend logs.
- `packages/entries/src/queue.ts` — `runEnrichmentQueue(settings, opts?)` and its types. Lives in `@claude-lens/entries` (not in CLI) so both the daemon and the `entries regenerate` CLI can import the same implementation via `@claude-lens/entries/node`.
- `packages/entries/src/node.ts` — re-exports `enrich`, `budget`, `settings`, `queue`, and the prompts module, with `import "server-only"` at top.
- `packages/entries/test/budget.test.ts` — round-trip, month-sum, atomic write.
- `packages/entries/test/settings.test.ts` — round-trip, env-var fallback, file perms, atomic write.
- `packages/entries/test/prompts/enrich.test.ts` — Zod accept/reject cases.
- `packages/entries/test/enrich.test.ts` — mock-client happy path + one parse retry + three-failure → error.
- `packages/entries/test/queue.test.ts` — gate short-circuits, oldest-first order, today/settled/allowlist/budget skips, retry_count freeze.

## Chunk boundaries for review

- **Chunk 1: Schema + Phase 1a follow-ups** — Tasks 1–3
- **Chunk 2: Core enrichment libs** — Tasks 4–6
- **Chunk 3: Subpath export + daemon integration** — Tasks 7–8
- **Chunk 4: Settings + Web UI + CLI** — Tasks 9–11

Each task is one commit. Each step is 2–5 min of work.

---

## Chunk 1: Schema + Phase 1a follow-ups

### Task 1: `goal_categories` counts → minutes + `retry_count`

**Files:**
- Modify: `packages/entries/src/types.ts`
- Modify: `packages/entries/test/build.test.ts` (if any assertions touch goal_categories/retry_count shape)
- Modify: `packages/entries/test/fs.test.ts` (if it reads old-shape fixtures)

- [ ] **Step 1: Read the current type to confirm starting state**

Run: `sed -n '11,30p' packages/entries/src/types.ts`
Expected: the `EntryEnrichment` type as read during planning — `goal_categories: Partial<Record<GoalCategory, number>>` with no comment.

- [ ] **Step 2: Write a failing test asserting `retry_count` defaults to 0**

Add to `packages/entries/test/build.test.ts` (at top of the `describe("buildEntries (deterministic)")` block):

```typescript
it("initialises enrichment.retry_count to 0 on new Entries", () => {
  const sd = load("one-day-session.jsonl");
  const entries = buildEntries(sd);
  for (const e of entries) {
    expect(e.enrichment.retry_count).toBe(0);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @claude-lens/entries test -- build.test.ts`
Expected: FAIL — `e.enrichment.retry_count` is undefined.

- [ ] **Step 4: Add `retry_count` to the type**

Edit `packages/entries/src/types.ts`:

```typescript
export type EntryEnrichment = {
  status: EntryEnrichmentStatus;
  generated_at: string | null;
  model: string | null;
  cost_usd: number | null;
  error: string | null;
  brief_summary: string | null;
  underlying_goal: string | null;
  friction_detail: string | null;
  user_instructions: string[];
  outcome: "shipped" | "partial" | "exploratory" | "blocked" | "trivial" | null;
  claude_helpfulness: "essential" | "helpful" | "neutral" | "unhelpful" | null;
  /** VALUES ARE MINUTES spent on the goal within this (session × day) slice.
   *  Sum across goals MUST be ≤ numbers.active_min. Unclassified time stays implicit. */
  goal_categories: Partial<Record<GoalCategory, number>>;
  /** Bounded retry counter — prevents a permanently-failing Entry from looping
   *  forever across daemon restarts. Frozen at status="error" + retry_count>=3;
   *  only `fleetlens entries regenerate --force` resets it. Starts at 0. */
  retry_count: number;
};
```

Update both factory functions in the same file:

```typescript
export function pendingEnrichment(): EntryEnrichment {
  return {
    status: "pending",
    generated_at: null,
    model: null,
    cost_usd: null,
    error: null,
    brief_summary: null,
    underlying_goal: null,
    friction_detail: null,
    user_instructions: [],
    outcome: null,
    claude_helpfulness: null,
    goal_categories: {},
    retry_count: 0,
  };
}

export function skippedTrivialEnrichment(generatedAt: string): EntryEnrichment {
  return {
    status: "skipped_trivial",
    generated_at: generatedAt,
    model: null,
    cost_usd: null,
    error: null,
    brief_summary: null,
    underlying_goal: null,
    friction_detail: null,
    user_instructions: [],
    outcome: "trivial",
    claude_helpfulness: null,
    goal_categories: {},
    retry_count: 0,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @claude-lens/entries test -- build.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full entries test suite**

Run: `pnpm --filter @claude-lens/entries test`
Expected: all tests green (61+ tests).

- [ ] **Step 7: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: zero errors. Any consumer constructing `EntryEnrichment` by hand (not via `pendingEnrichment()` / `skippedTrivialEnrichment()`) surfaces here.

**Note:** No code reads `entry.enrichment.retry_count` yet — the reader sites (queue in Task 8, CLI `regenerate` in Task 11) apply the `?? 0` shim when they land. Chunk 1's only responsibility is writer-side: every newly-built Entry gets `retry_count: 0`.

- [ ] **Step 8: Confirm fs.test.ts needs no update**

Run: `grep -n "retry_count\|goal_categories" packages/entries/test/fs.test.ts || echo "no match — no edit needed"`
Expected: "no match" (the existing fs tests assert round-trip of entire Entry objects, not specific enrichment fields). If there is a match, apply the `retry_count: 0` default to any hand-built Entry fixture and include the file in the commit.

- [ ] **Step 9: Commit**

```bash
git add packages/entries/src/types.ts packages/entries/test/build.test.ts
git commit -m "$(cat <<'EOF'
feat(entries): goal_categories as minutes + retry_count field

goal_categories values are now minutes spent per goal (sum ≤ active_min)
rather than user-ask counts — enables correct time-proportional aggregation
across any window.

retry_count bounds per-Entry enrichment retries across daemon restarts.
Frozen at status="error" + retry_count>=3 until `entries regenerate --force`
resets it. Starts at 0 for pending/skipped_trivial.

No migration: no Phase 1a Entries have populated goal_categories. Readers
treat missing retry_count as 0 via `?? 0` shim at consumption sites
(added in Task 8 queue + Task 11 regenerate).
EOF
)"
```

---

### Task 2: `orchestrated` flag → `subagent_turns >= 3`

**Files:**
- Modify: `packages/entries/src/build.ts`
- Modify: `packages/entries/test/build.test.ts`

**Why:** V1 `capsule.ts` uses `subagent_turns >= 3` — counts turns that dispatched at least one agent, not total dispatches. Current Entry builder uses `subagent_calls >= 3` (total dispatches). One mega-orchestration turn with 5 parallel Agent calls trips ours but not V1's. Align to V1.

- [ ] **Step 1: Write the failing test**

Add to `packages/entries/test/build.test.ts` (in the `describe("buildEntries (deterministic)")` block) a single test using a synthetic fixture that dispatches 5 Agents from one turn. Under the current predicate (`subagent_calls >= 3`) this test FAILS (flag set). Under the new predicate (`subagent_turns >= 3`) it PASSES.

```typescript
it("does NOT set orchestrated when 5 agents dispatched from a single turn", () => {
  const sd = load("five-agents-one-turn.jsonl");
  const entries = buildEntries(sd);
  expect(entries).toHaveLength(1);
  const e = entries[0]!;
  expect(e.numbers.subagent_calls).toBe(5);
  expect(e.flags).not.toContain("orchestrated");
});
```

- [ ] **Step 2: Create the fixture**

File: `packages/entries/test/fixtures/five-agents-one-turn.jsonl`

Content: one user turn followed by a single assistant turn containing 5 `tool_use` blocks all named `"Agent"`. Model the JSONL on the Claude Code transcript format — see `packages/entries/test/fixtures/one-day-session.jsonl` for shape. Keep it minimal: one user message, one assistant message with 5 Agent tool_use blocks, five tool_result blocks, one trailing assistant text block. All timestamps within 2 minutes of 2026-04-22T14:00:00Z so it stays in one day.

A minimal skeleton (fill in realistic timestamps and uuids):

```
{"type":"user","timestamp":"2026-04-22T14:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"please run 5 things in parallel"}]}}
{"type":"assistant","timestamp":"2026-04-22T14:00:05.000Z","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"tool_use","id":"t1","name":"Agent","input":{"description":"a","prompt":"a","subagent_type":"general-purpose"}},{"type":"tool_use","id":"t2","name":"Agent","input":{"description":"b","prompt":"b","subagent_type":"general-purpose"}},{"type":"tool_use","id":"t3","name":"Agent","input":{"description":"c","prompt":"c","subagent_type":"general-purpose"}},{"type":"tool_use","id":"t4","name":"Agent","input":{"description":"d","prompt":"d","subagent_type":"general-purpose"}},{"type":"tool_use","id":"t5","name":"Agent","input":{"description":"e","prompt":"e","subagent_type":"general-purpose"}}]}}
{"type":"user","timestamp":"2026-04-22T14:00:45.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"},{"type":"tool_result","tool_use_id":"t2","content":"ok"},{"type":"tool_result","tool_use_id":"t3","content":"ok"},{"type":"tool_result","tool_use_id":"t4","content":"ok"},{"type":"tool_result","tool_use_id":"t5","content":"ok"}]}}
{"type":"assistant","timestamp":"2026-04-22T14:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"done"}]}}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @claude-lens/entries test -- build.test.ts`
Expected: `"does NOT set orchestrated when 5 agents dispatched from a single turn"` FAILS. The current predicate `subagent_calls >= 3` at `build.ts:472` trips with 5 calls.

- [ ] **Step 4: Change the predicate**

Edit `packages/entries/src/build.ts`:

At the end of `aggregateDay`, track per-turn subagent-dispatch count. In the outer `buildEntries` loop, compute `subagentTurns` as the number of closed turns where `t.subagents.length >= 1`:

```typescript
// Inside buildEntries, where flags are computed (after subagentCalls is computed):
const subagentTurns = closed.filter(t => t.subagents.length >= 1).length;
```

Then replace the flag predicate:

```typescript
// BEFORE:
if (subagentCalls >= 3) flags.push("orchestrated");
// AFTER:
if (subagentTurns >= 3) flags.push("orchestrated");
```

`subagentTurns` is compute-and-discard — do NOT add it to `Entry.numbers`. Keep the `subagent_calls` number as-is since it's still meaningful data.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @claude-lens/entries test -- build.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full entries suite + typecheck**

```bash
pnpm --filter @claude-lens/entries test
pnpm typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/entries/src/build.ts packages/entries/test/build.test.ts packages/entries/test/fixtures/five-agents-one-turn.jsonl
git commit -m "$(cat <<'EOF'
fix(entries): orchestrated flag uses subagent_turns >= 3

Aligns Entry builder with V1 capsule.ts semantics. Previous predicate
`subagent_calls >= 3` tripped on a single turn that dispatched 5 parallel
agents; new `subagent_turns >= 3` only trips when three separate turns
each dispatched at least one agent — the actual "orchestration" signal.

subagent_turns is computed-and-discarded during aggregation; no new field
is added to Entry.numbers.
EOF
)"
```

---

### Task 3: `listAllSessionJsonls` accepts injectable root + worker integration test

**Files:**
- Modify: `packages/cli/src/perception/scan.ts`
- Modify: `packages/cli/src/perception/worker.ts`
- Modify: `packages/cli/src/perception/worker.test.ts`
- Create: `packages/cli/test/fixtures/perception/projects/-Users-test-repo-foo/abc-123.jsonl` (or similar)

- [ ] **Step 1: Write a failing integration test**

Replace `packages/cli/src/perception/worker.test.ts` with (keeping the existing passing tests):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPerceptionSweep } from "./worker.js";
import { __setStatePathForTest } from "./state.js";
import { __setEntriesDirForTest } from "@claude-lens/entries/fs";

describe("runPerceptionSweep", () => {
  let tmp: string;
  let projectsRoot: string;
  let entriesDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "perc-sweep-"));
    projectsRoot = join(tmp, "projects");
    entriesDir = join(tmp, "entries");
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(entriesDir, { recursive: true });
    __setStatePathForTest(join(tmp, "perception-state.json"));
    __setEntriesDirForTest(entriesDir);
  });

  it("writes Entries from a fixture JSONL mounted in tmp projects dir", async () => {
    const projectDir = join(projectsRoot, "-Users-test-repo-foo");
    mkdirSync(projectDir, { recursive: true });
    const sessionId = "abc-123-def-456";
    // Two-event minimal session: one user turn, one assistant reply, 4 min apart.
    const jsonl = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-20T10:00:00.000Z",
        cwd: "/Users/test/repo/foo",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-20T10:00:30.000Z",
        cwd: "/Users/test/repo/foo",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "hello" }],
        },
      }),
    ].join("\n");
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonl);

    const result = await runPerceptionSweep({ projectsRoot });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.entriesWritten).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const written = readdirSync(entriesDir);
    expect(written.some(f => f.startsWith(sessionId))).toBe(true);
  });

  it("returns zero counts when projects dir is empty", async () => {
    const r = await runPerceptionSweep({ projectsRoot });
    expect(r).toEqual({ sessionsProcessed: 0, entriesWritten: 0, errors: 0 });
  });

  it("sets sweep_in_progress=false after completion", async () => {
    const { readState } = await import("./state.js");
    await runPerceptionSweep({ projectsRoot });
    expect(readState().sweep_in_progress).toBe(false);
    expect(readState().last_sweep_completed_at).toBeTruthy();
  });

  it("skips sweep when one is already in progress and not stale", async () => {
    const { markSweepStart, readState } = await import("./state.js");
    markSweepStart();
    const r = await runPerceptionSweep({ projectsRoot });
    expect(r).toEqual({ sessionsProcessed: 0, entriesWritten: 0, errors: 0 });
    expect(readState().sweep_in_progress).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify new one fails**

Run: `pnpm --filter fleetlens test -- worker.test.ts`
Expected: first test fails (`runPerceptionSweep({ projectsRoot })` doesn't accept options) — TypeScript error or Node runtime error depending on how signature is declared.

- [ ] **Step 3: Update `listAllSessionJsonls` signature**

Edit `packages/cli/src/perception/scan.ts`:

```typescript
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function listAllSessionJsonls(root?: string): Promise<string[]> {
  const projectsRoot = root ?? join(homedir(), ".claude", "projects");
  const out: string[] = [];
  try {
    for (const project of readdirSync(projectsRoot)) {
      const dir = join(projectsRoot, project);
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".jsonl")) out.push(join(dir, f));
        }
      } catch {
        // unreadable — skip
      }
    }
  } catch {
    // root missing — return empty
  }
  return out;
}
```

- [ ] **Step 4: Thread through `runPerceptionSweep`**

Edit `packages/cli/src/perception/worker.ts`. Two surgical changes:

1. Add the `SweepOptions` type and update the `runPerceptionSweep` signature at `worker.ts:35`:

```typescript
export type SweepOptions = {
  /** Override ~/.claude/projects for testing. */
  projectsRoot?: string;
};

export async function runPerceptionSweep(opts: SweepOptions = {}): Promise<SweepResult> {
```

2. Replace the single call site at `worker.ts:47`:

```typescript
// BEFORE
const files = await listAllSessionJsonls();
// AFTER
const files = await listAllSessionJsonls(opts.projectsRoot);
```

No other line in `runPerceptionSweep` changes in this task.

- [ ] **Step 5: Run tests — verify pass**

Run: `pnpm --filter fleetlens test -- worker.test.ts`
Expected: all four tests PASS.

- [ ] **Step 6: Verify caller — daemon-worker.ts**

Check `packages/cli/src/daemon-worker.ts` still compiles; it calls `runPerceptionSweep()` with no args, which is backwards-compatible (default empty options).

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/perception/scan.ts packages/cli/src/perception/worker.ts packages/cli/src/perception/worker.test.ts
git commit -m "$(cat <<'EOF'
fix(cli/perception): injectable projectsRoot for worker tests

listAllSessionJsonls accepts optional root; runPerceptionSweep accepts
SweepOptions { projectsRoot }. Enables real directory-injection integration
tests — previous worker.test.ts only asserted on empty-dir behavior.

Replaces the stubbed "richer tests deferred to Phase 1b" comment with a
fixture-backed test that writes a minimal JSONL into a tmp projects dir
and asserts Entry files land on disk.

Backwards-compat: daemon-worker.ts calls runPerceptionSweep() with no
args; default empty options use ~/.claude/projects/ as before.
EOF
)"
```

---

## Chunk 2: Core enrichment libs

### Task 4: Budget tracker (`budget.ts`)

**Files:**
- Create: `packages/entries/src/budget.ts`
- Create: `packages/entries/test/budget.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/entries/test/budget.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSpend,
  monthToDateSpend,
  __setSpendPathForTest,
  type SpendRecord,
} from "../src/budget.js";

function rec(partial: Partial<SpendRecord> = {}): SpendRecord {
  return {
    ts: "2026-04-22T10:00:00.000Z",
    caller: "daemon",
    model: "claude-sonnet-4-6",
    input_tokens: 1000,
    output_tokens: 200,
    cost_usd: 0.01,
    kind: "entry_enrich",
    ref: "test__2026-04-22",
    ...partial,
  };
}

describe("budget", () => {
  let spendPath: string;
  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "budget-"));
    spendPath = join(tmp, "llm-spend.jsonl");
    __setSpendPathForTest(spendPath);
  });

  it("appendSpend creates the file on first write", () => {
    expect(existsSync(spendPath)).toBe(false);
    appendSpend(rec());
    expect(existsSync(spendPath)).toBe(true);
    const lines = readFileSync(spendPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ cost_usd: 0.01 });
  });

  it("appendSpend appends JSONL — one line per call", () => {
    appendSpend(rec({ cost_usd: 0.01 }));
    appendSpend(rec({ cost_usd: 0.02 }));
    appendSpend(rec({ cost_usd: 0.03 }));
    const lines = readFileSync(spendPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map(l => JSON.parse(l).cost_usd)).toEqual([0.01, 0.02, 0.03]);
  });

  it("monthToDateSpend sums records in the current month", () => {
    const now = new Date("2026-04-22T12:00:00.000Z");
    appendSpend(rec({ ts: "2026-04-01T00:00:00.000Z", cost_usd: 0.10 }));
    appendSpend(rec({ ts: "2026-04-15T00:00:00.000Z", cost_usd: 0.20 }));
    appendSpend(rec({ ts: "2026-04-22T00:00:00.000Z", cost_usd: 0.05 }));
    expect(monthToDateSpend(now)).toBeCloseTo(0.35, 6);
  });

  it("monthToDateSpend excludes prior-month records", () => {
    const now = new Date("2026-04-22T12:00:00.000Z");
    appendSpend(rec({ ts: "2026-03-28T00:00:00.000Z", cost_usd: 100 }));
    appendSpend(rec({ ts: "2026-04-01T00:00:00.000Z", cost_usd: 0.10 }));
    expect(monthToDateSpend(now)).toBeCloseTo(0.10, 6);
  });

  it("monthToDateSpend returns 0 for a nonexistent spend file", () => {
    expect(monthToDateSpend(new Date())).toBe(0);
  });

  it("monthToDateSpend skips malformed lines silently", () => {
    appendSpend(rec({ cost_usd: 0.05 }));
    // Append malformed content
    const { appendFileSync } = require("node:fs");
    appendFileSync(spendPath, "not-json\n");
    appendSpend(rec({ cost_usd: 0.07 }));
    expect(monthToDateSpend(new Date("2026-04-22T12:00:00.000Z"))).toBeCloseTo(0.12, 6);
  });
});
```

- [ ] **Step 2: Run tests — verify all fail**

Run: `pnpm --filter @claude-lens/entries test -- budget.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `budget.ts`**

Create `packages/entries/src/budget.ts`:

```typescript
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type SpendRecord = {
  ts: string;
  caller: "daemon" | "cli" | "web";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  kind: "entry_enrich" | "day_digest";
  ref: string;
};

let spendPathCached: string | null = null;

function spendPath(): string {
  if (spendPathCached) return spendPathCached;
  spendPathCached = join(homedir(), ".cclens", "llm-spend.jsonl");
  return spendPathCached;
}

/** @internal Test-only. */
export function __setSpendPathForTest(path: string): void {
  spendPathCached = path;
}

export function appendSpend(record: SpendRecord): void {
  const p = spendPath();
  mkdirSync(dirname(p), { recursive: true });
  // Concurrent appenders (daemon + CLI + web-route) are safe: POSIX guarantees
  // atomic O_APPEND writes under PIPE_BUF (≥4 KB on macOS/Linux). Each
  // SpendRecord line is ~200 bytes — well below — so interleaved writes land
  // as complete lines, never torn.
  appendFileSync(p, JSON.stringify(record) + "\n", { encoding: "utf8" });
}

export function monthToDateSpend(now: Date = new Date()): number {
  const p = spendPath();
  if (!existsSync(p)) return 0;
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let total = 0;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let rec: SpendRecord;
    try {
      rec = JSON.parse(line) as SpendRecord;
    } catch {
      continue;
    }
    const ts = new Date(rec.ts);
    if (Number.isNaN(ts.getTime())) continue;
    if (ts.getUTCFullYear() !== year || ts.getUTCMonth() !== month) continue;
    total += rec.cost_usd;
  }
  return total;
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm --filter @claude-lens/entries test -- budget.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @claude-lens/entries typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/entries/src/budget.ts packages/entries/test/budget.test.ts
git commit -m "$(cat <<'EOF'
feat(entries): LLM spend tracker (append-only ~/.cclens/llm-spend.jsonl)

appendSpend writes one JSON-per-line record; monthToDateSpend scans and
sums current-month records. Used by the daemon enrichment queue to honor
the `ai_features.monthly_budget_usd` soft cap — re-read every iteration
so long backfills that cross the cap mid-run halt on the right Entry.

Malformed lines and missing files are silently skipped.
EOF
)"
```

---

### Task 5: Prompt template + Zod schema (`prompts/enrich.ts`)

**Files:**
- Create: `packages/entries/src/prompts/enrich.ts`
- Create: `packages/entries/test/prompts/enrich.test.ts`
- Modify: `packages/entries/package.json` — add `zod` dep

- [ ] **Step 1: Add `zod` dependency**

From repo root:

```bash
pnpm --filter @claude-lens/entries add zod@^3.23.8
```

Verify: `packages/entries/package.json` now lists `"zod": "^3.23.8"` under `dependencies`.

**Why this exact minor version:** `z.record(keySchema, valueSchema)` with runtime key validation for enum schemas was added in Zod 3.23.6. Earlier 3.x versions silently ignore the key schema and accept any string key. The Task 5 test `"rejects an unknown goal category key"` depends on this behavior.

- [ ] **Step 2: Write failing tests**

Create `packages/entries/test/prompts/enrich.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  EnrichmentResponseSchema,
  buildEnrichmentPrompt,
  type EnrichmentResponse,
} from "../../src/prompts/enrich.js";
import type { Entry } from "../../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    version: 2,
    session_id: "s1",
    local_day: "2026-04-20",
    project: "/Users/test/foo",
    start_iso: "2026-04-20T09:00:00.000Z",
    end_iso: "2026-04-20T10:30:00.000Z",
    numbers: {
      active_min: 45,
      turn_count: 12, tools_total: 35, subagent_calls: 0, skill_calls: 1,
      task_ops: 2, interrupts: 0, tool_errors: 1, consec_same_tool_max: 3,
      exit_plan_calls: 0, prs: 1, commits: 2, pushes: 1, tokens_total: 50000,
    },
    flags: ["fast_ship"],
    primary_model: "claude-sonnet-4-6",
    model_mix: { "claude-sonnet-4-6": 12 },
    first_user: "please fix the bug in the login flow",
    final_agent: "fixed and pushed",
    pr_titles: ["fix login redirect bug"],
    top_tools: ["Edit×5", "Bash×4 (git, pnpm)"],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 1, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 3, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null, error: null,
      brief_summary: null, underlying_goal: null, friction_detail: null,
      user_instructions: ["fix login redirect", "push once green"],
      outcome: null, claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: "2026-04-20T10:30:00.000Z",
    source_jsonl: "/fake/path.jsonl",
    source_checkpoint: { byte_offset: 1024, last_event_ts: "2026-04-20T10:30:00.000Z" },
    ...overrides,
  };
}

describe("EnrichmentResponseSchema", () => {
  const valid: EnrichmentResponse = {
    brief_summary: "You fixed the login redirect bug and shipped it.",
    underlying_goal: "Unblock users stuck on the login screen.",
    friction_detail: null,
    user_instructions: ["fix login redirect", "push once green"],
    goal_categories: { debug: 30, release: 15 },
    outcome: "shipped",
    claude_helpfulness: "helpful",
  };

  it("accepts a valid response", () => {
    expect(() => EnrichmentResponseSchema.parse(valid)).not.toThrow();
  });

  it("rejects an invalid outcome literal", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({ ...valid, outcome: "halfway" })
    ).toThrow();
  });

  it("rejects an unknown goal category key", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({
        ...valid,
        goal_categories: { build: 10, made_up_goal: 5 },
      })
    ).toThrow();
  });

  it("accepts null friction_detail", () => {
    expect(() => EnrichmentResponseSchema.parse({ ...valid, friction_detail: null })).not.toThrow();
  });

  it("requires user_instructions to be an array of strings", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({ ...valid, user_instructions: "one" })
    ).toThrow();
  });

  it("allows empty goal_categories object", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({ ...valid, goal_categories: {} })
    ).not.toThrow();
  });

  it("tolerates extraneous top-level keys via passthrough", () => {
    // LLMs sometimes add fields like "confidence" or "notes" despite being
    // told not to. .passthrough() must accept the response without failing.
    expect(() =>
      EnrichmentResponseSchema.parse({
        ...valid,
        confidence: 0.85,
        notes: "I considered this carefully",
      })
    ).not.toThrow();
  });
});

describe("buildEnrichmentPrompt", () => {
  it("includes active_min, turn_count, and first_user in the prompt", () => {
    const e = mkEntry();
    const prompt = buildEnrichmentPrompt(e, []);
    expect(prompt).toContain("45");             // active_min
    expect(prompt).toContain("12");             // turn_count
    expect(prompt).toContain("fix the bug");    // first_user excerpt
  });

  it("truncates human turns to 300 chars", () => {
    const longTurn = "x".repeat(500);
    const prompt = buildEnrichmentPrompt(mkEntry(), [longTurn]);
    // The truncated piece appears once with an ellipsis marker.
    expect(prompt).toContain("x".repeat(299));
    expect(prompt).not.toContain("x".repeat(301));
  });

  it("includes up to 8 human turns", () => {
    const turns = Array.from({ length: 20 }, (_, i) => `turn-${i}`);
    const prompt = buildEnrichmentPrompt(mkEntry(), turns);
    for (let i = 0; i < 8; i++) expect(prompt).toContain(`turn-${i}`);
    expect(prompt).not.toContain("turn-8");
  });
});
```

- [ ] **Step 3: Run tests — verify fail**

Run: `pnpm --filter @claude-lens/entries test -- prompts/enrich.test.ts`
Expected: module not found.

- [ ] **Step 4: Implement `prompts/enrich.ts`**

Create `packages/entries/src/prompts/enrich.ts`:

```typescript
import { z } from "zod";
import { GOAL_CATEGORIES } from "../types.js";
import type { Entry } from "../types.js";

const GoalCategoryEnum = z.enum(GOAL_CATEGORIES);

const OutcomeEnum = z.enum(["shipped", "partial", "exploratory", "blocked", "trivial"]);
const HelpfulnessEnum = z.enum(["essential", "helpful", "neutral", "unhelpful"]);

// `.passthrough()` on the outer object tolerates extra LLM-added keys
// ("confidence", "notes", etc.) without failing validation. The inner
// goal_categories record still uses GoalCategoryEnum keys — Zod 3.23.6+
// enforces the key schema at runtime, so unknown goal names ARE rejected
// (the aggregation pipeline requires the fixed taxonomy).
export const EnrichmentResponseSchema = z.object({
  brief_summary: z.string().min(1),
  underlying_goal: z.string().min(1),
  friction_detail: z.string().nullable(),
  user_instructions: z.array(z.string()),
  goal_categories: z.record(GoalCategoryEnum, z.number().nonnegative()),
  outcome: OutcomeEnum,
  claude_helpfulness: HelpfulnessEnum,
}).passthrough();

export type EnrichmentResponse = z.infer<typeof EnrichmentResponseSchema>;

const SYSTEM_PROMPT = `You are analyzing one (session × local-day) slice of a developer's Claude Code work.

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
}`;

function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function buildEnrichmentPrompt(entry: Entry, humanTurns: string[]): string {
  const facts = {
    active_min: entry.numbers.active_min,
    turn_count: entry.numbers.turn_count,
    tools_total: entry.numbers.tools_total,
    subagent_calls: entry.numbers.subagent_calls,
    skill_calls: entry.numbers.skill_calls,
    flags: entry.flags,
    primary_model: entry.primary_model,
    pr_titles: entry.pr_titles,
    top_tools: entry.top_tools,
    first_user: entry.first_user,
    final_agent: entry.final_agent,
    satisfaction_signals: entry.satisfaction_signals,
    user_input_sources: entry.user_input_sources,
  };

  const turns = humanTurns
    .slice(0, 8)
    .map((t, i) => `${i + 1}. ${trunc(t, 300)}`)
    .join("\n");

  return `${SYSTEM_PROMPT}

SLICE FACTS:
${JSON.stringify(facts, null, 2)}

HUMAN TURNS (up to 8, each truncated to 300 chars):
${turns || "(none — the user text was filtered out as non-human)"}`;
}

/** System-prompt-only export — tests may assert on its length for prompt-caching planning. */
export const ENRICHMENT_SYSTEM_PROMPT = SYSTEM_PROMPT;
```

- [ ] **Step 5: Register the test dir**

Check `packages/entries/vitest.config.ts` if it exists; ensure `test/**/*.test.ts` is included so `test/prompts/enrich.test.ts` runs. If there's no config, vitest's default glob picks it up.

Run: `pnpm --filter @claude-lens/entries test -- prompts/enrich.test.ts`
Expected: all 9 tests PASS.

- [ ] **Step 6: Run full entries suite + typecheck**

```bash
pnpm --filter @claude-lens/entries test
pnpm typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/entries/src/prompts packages/entries/test/prompts packages/entries/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(entries): enrichment prompt + Zod response schema

Locks the LLM contract for per-Entry enrichment: strict Zod schema over
the 7 output fields (brief_summary, underlying_goal, friction_detail,
user_instructions, goal_categories [minutes, fixed taxonomy], outcome,
claude_helpfulness). Prompt builder truncates up to 8 human turns at
300 chars each and serializes the slice facts as JSON.

Pure functions — no I/O, no network. Tested in isolation.
EOF
)"
```

---

### Task 6: Enricher (`enrich.ts`)

**Files:**
- Create: `packages/entries/src/enrich.ts`
- Create: `packages/entries/test/enrich.test.ts`
- Modify: `packages/entries/package.json` — add `@anthropic-ai/sdk` dep

**Design note — dependency injection over module mocking:** `enrichEntry` takes an optional `callLLM` function parameter. Default uses the real Anthropic SDK. Tests inject a stub. Avoids vitest module mocking and keeps the Anthropic SDK out of the test harness entirely.

**Return shape:** `enrichEntry` returns `{ entry, usage }` where `usage = { input_tokens, output_tokens } | null`. Callers (the queue in Task 8, the regenerate CLI in Task 11) consume `usage` to write real token counts into `llm-spend.jsonl` rather than zeros.

- [ ] **Step 1: Add Anthropic SDK dependency**

```bash
pnpm --filter @claude-lens/entries add @anthropic-ai/sdk@^0.60.0
```

(If a specific newer version is dictated by an existing dep elsewhere in the workspace, match it.)

- [ ] **Step 2: Write failing tests**

Create `packages/entries/test/enrich.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { enrichEntry, type CallLLM } from "../src/enrich.js";
import type { Entry } from "../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    version: 2,
    session_id: "s1",
    local_day: "2026-04-20",
    project: "/Users/test/foo",
    start_iso: "2026-04-20T09:00:00.000Z",
    end_iso: "2026-04-20T10:30:00.000Z",
    numbers: {
      active_min: 45, turn_count: 12, tools_total: 35, subagent_calls: 0,
      skill_calls: 1, task_ops: 2, interrupts: 0, tool_errors: 1,
      consec_same_tool_max: 3, exit_plan_calls: 0, prs: 1, commits: 2,
      pushes: 1, tokens_total: 50000,
    },
    flags: ["fast_ship"],
    primary_model: "claude-sonnet-4-6",
    model_mix: { "claude-sonnet-4-6": 12 },
    first_user: "please fix the bug",
    final_agent: "done",
    pr_titles: ["fix bug"],
    top_tools: ["Edit×5"],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 1, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 3, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null,
      error: null, brief_summary: null, underlying_goal: null,
      friction_detail: null, user_instructions: [], outcome: null,
      claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: "2026-04-20T10:30:00.000Z",
    source_jsonl: "/fake/path.jsonl",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
    ...overrides,
  };
}

const validResponse = {
  brief_summary: "You fixed the bug.",
  underlying_goal: "Unblock login flow.",
  friction_detail: null,
  user_instructions: ["fix login"],
  goal_categories: { debug: 30, release: 15 },
  outcome: "shipped" as const,
  claude_helpfulness: "helpful" as const,
};

describe("enrichEntry", () => {
  it("populates fields and sets status=done on happy path; returns usage totals", async () => {
    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify(validResponse),
      input_tokens: 800,
      output_tokens: 150,
      model: "claude-sonnet-4-6",
    });

    const { entry: out, usage } = await enrichEntry(mkEntry(), {
      apiKey: "sk-fake",
      callLLM,
    });

    expect(out.enrichment.status).toBe("done");
    expect(out.enrichment.brief_summary).toBe("You fixed the bug.");
    expect(out.enrichment.goal_categories).toEqual({ debug: 30, release: 15 });
    expect(out.enrichment.outcome).toBe("shipped");
    expect(out.enrichment.model).toBe("claude-sonnet-4-6");
    expect(out.enrichment.cost_usd).toBeGreaterThan(0);
    expect(out.enrichment.generated_at).toBeTruthy();
    expect(out.enrichment.retry_count).toBe(0); // success does NOT bump retry_count
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(usage).toEqual({ input_tokens: 800, output_tokens: 150 });
  });

  it("retries once on JSON parse failure before giving up; accumulates usage across both calls", async () => {
    const callLLM: CallLLM = vi.fn()
      .mockResolvedValueOnce({
        content: "Here you go: not-valid-json",
        input_tokens: 800, output_tokens: 20, model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify(validResponse),
        input_tokens: 850, output_tokens: 150, model: "claude-sonnet-4-6",
      });

    const { entry: out, usage } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("done");
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(usage).toEqual({ input_tokens: 1650, output_tokens: 170 });
  });

  it("sets status=error and bumps retry_count when parse fails twice", async () => {
    const callLLM: CallLLM = vi.fn()
      .mockResolvedValue({
        content: "never valid",
        input_tokens: 800, output_tokens: 5, model: "claude-sonnet-4-6",
      });

    const { entry: out, usage } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("error");
    expect(out.enrichment.retry_count).toBe(1);
    expect(out.enrichment.error).toMatch(/parse|schema/);
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(usage).toEqual({ input_tokens: 1600, output_tokens: 10 });
  });

  it("sets status=error and bumps retry_count on API exception; usage is null", async () => {
    const callLLM: CallLLM = vi.fn().mockRejectedValue(new Error("network down"));

    const { entry: out, usage } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("error");
    expect(out.enrichment.retry_count).toBe(1);
    expect(out.enrichment.error).toContain("network down");
    expect(usage).toBeNull();
  });

  it("respects incoming retry_count (increments from previous value)", async () => {
    const callLLM: CallLLM = vi.fn().mockRejectedValue(new Error("boom"));
    const entry = mkEntry();
    entry.enrichment.retry_count = 2;

    const { entry: out } = await enrichEntry(entry, { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.retry_count).toBe(3);
    expect(out.enrichment.status).toBe("error");
  });

  it("rejects a response that parses as JSON but fails Zod validation", async () => {
    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({ ...validResponse, outcome: "halfway" }),
      input_tokens: 800, output_tokens: 150, model: "claude-sonnet-4-6",
    });
    const { entry: out } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    // One retry attempted. Still invalid on second try too (same stub) → error.
    expect(out.enrichment.status).toBe("error");
    expect(callLLM).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run tests — verify fail**

Run: `pnpm --filter @claude-lens/entries test -- enrich.test.ts`
Expected: module not found.

- [ ] **Step 4: Implement `enrich.ts`**

Create `packages/entries/src/enrich.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { classifyUserInputSource } from "./signals.js";
import { buildEnrichmentPrompt, EnrichmentResponseSchema } from "./prompts/enrich.js";
import type { Entry, EntryEnrichment } from "./types.js";

export type LLMResponse = {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
};

export type CallLLM = (args: {
  apiKey: string;
  model: string;
  systemAndUserPrompt: string;
  reminder?: string;
}) => Promise<LLMResponse>;

export type EnrichOptions = {
  apiKey: string;
  model?: string;
  /** Test-only injection point. Default uses @anthropic-ai/sdk. */
  callLLM?: CallLLM;
};

export type EnrichUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type EnrichResult = {
  entry: Entry;
  /** Aggregated token usage across all LLM attempts for this Entry.
   *  Null only when every attempt threw before returning a response (e.g., network failure). */
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

// claude-sonnet-4-6 pricing (USD per 1M tokens). Update if Anthropic changes prices.
// Kept in-module rather than pulled from @claude-lens/parser to avoid CLI↔entries
// dep inversion. Small price table; easy to bump.
const PRICE_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-7": { input: 15, output: 75 },
};

function computeCostUsd(model: string, inTokens: number, outTokens: number): number {
  const p = PRICE_USD_PER_1M[model];
  if (!p) return 0;
  return (inTokens * p.input + outTokens * p.output) / 1_000_000;
}

async function defaultCallLLM(args: {
  apiKey: string;
  model: string;
  systemAndUserPrompt: string;
  reminder?: string;
}): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const messages: Array<{ role: "user"; content: string }> = [
    { role: "user", content: args.systemAndUserPrompt },
  ];
  if (args.reminder) messages.push({ role: "user", content: args.reminder });

  const resp = await client.messages.create({
    model: args.model,
    max_tokens: 2048,
    messages,
  });
  const textBlock = resp.content.find(b => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";
  return {
    content,
    input_tokens: resp.usage.input_tokens,
    output_tokens: resp.usage.output_tokens,
    model: resp.model ?? args.model,
  };
}

function selectHumanTurns(entry: Entry): string[] {
  // Phase 1b uses entry.first_user as the sole seed turn. Full per-turn
  // reconstruction from raw JSONL is deferred to Phase 2 where the digest
  // pipeline has direct transcript access.
  // Also include user_instructions as proxy asks if present.
  const turns: string[] = [];
  if (entry.first_user) turns.push(entry.first_user);
  for (const instr of entry.enrichment.user_instructions) turns.push(instr);
  return turns.filter(t => classifyUserInputSource(t) === "human");
}

function parseAndValidate(content: string): { ok: true; value: ReturnType<typeof EnrichmentResponseSchema.parse> } | { ok: false; error: string } {
  // Strip code fences if the model added them despite being told not to.
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` };
  }
  const result = EnrichmentResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `schema validation failed: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

export async function enrichEntry(entry: Entry, opts: EnrichOptions): Promise<EnrichResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLM;
  const humanTurns = selectHumanTurns(entry);
  const prompt = buildEnrichmentPrompt(entry, humanTurns);
  const generatedAt = new Date().toISOString();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCallReturned = false;
  let lastModelId = model;
  let lastError = "";

  try {
    // Attempt 1
    const r1 = await callLLM({ apiKey: opts.apiKey, model, systemAndUserPrompt: prompt });
    anyCallReturned = true;
    totalInputTokens += r1.input_tokens;
    totalOutputTokens += r1.output_tokens;
    lastModelId = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
      return {
        entry: applyEnrichmentSuccess(entry, v1.value, lastModelId, cost, generatedAt),
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }
    lastError = v1.error;

    // Attempt 2 — one retry with explicit reminder
    const r2 = await callLLM({
      apiKey: opts.apiKey,
      model,
      systemAndUserPrompt: prompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the seven required fields — no prose, no code fence.",
    });
    totalInputTokens += r2.input_tokens;
    totalOutputTokens += r2.output_tokens;
    lastModelId = r2.model;
    const v2 = parseAndValidate(r2.content);
    if (v2.ok) {
      const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
      return {
        entry: applyEnrichmentSuccess(entry, v2.value, lastModelId, cost, generatedAt),
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }
    lastError = v2.error;
  } catch (err) {
    lastError = (err as Error).message || "unknown LLM error";
  }

  // Failure — bump retry_count, set error
  const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
  return {
    entry: applyEnrichmentError(entry, lastError, lastModelId, cost, generatedAt),
    usage: anyCallReturned
      ? { input_tokens: totalInputTokens, output_tokens: totalOutputTokens }
      : null,
  };
}

function applyEnrichmentSuccess(
  entry: Entry,
  resp: ReturnType<typeof EnrichmentResponseSchema.parse>,
  model: string,
  costUsd: number,
  generatedAt: string,
): Entry {
  const enrichment: EntryEnrichment = {
    ...entry.enrichment,
    status: "done",
    generated_at: generatedAt,
    model,
    cost_usd: costUsd,
    error: null,
    brief_summary: resp.brief_summary,
    underlying_goal: resp.underlying_goal,
    friction_detail: resp.friction_detail,
    user_instructions: resp.user_instructions,
    goal_categories: resp.goal_categories,
    outcome: resp.outcome,
    claude_helpfulness: resp.claude_helpfulness,
    // retry_count unchanged on success
  };
  return { ...entry, enrichment };
}

function applyEnrichmentError(
  entry: Entry,
  errorMessage: string,
  model: string,
  costUsd: number,
  generatedAt: string,
): Entry {
  const enrichment: EntryEnrichment = {
    ...entry.enrichment,
    status: "error",
    generated_at: generatedAt,
    model,
    cost_usd: costUsd,
    error: errorMessage,
    retry_count: (entry.enrichment.retry_count ?? 0) + 1,
  };
  return { ...entry, enrichment };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @claude-lens/entries test -- enrich.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 6: Run full entries test suite + typecheck**

```bash
pnpm --filter @claude-lens/entries test
pnpm typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/entries/src/enrich.ts packages/entries/test/enrich.test.ts packages/entries/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(entries): per-Entry LLM enricher with Zod-validated response

enrichEntry(entry, opts) calls the Anthropic SDK once, validates the
response against the locked schema, and returns the Entry with all six
enrichment.* fields populated. On parse/schema failure, retries once with
a "return valid JSON only" reminder. On exception or second failure,
returns the Entry with status="error" and retry_count incremented.

Cost computed inline from token usage + Sonnet 4.6 price table (no CLI
dep inversion). callLLM is injectable for tests.
EOF
)"
```

---

## Chunk 3: Subpath export + daemon integration

### Task 7: `./node` subpath export with `server-only` guard + `listEntriesWithStatus`

**Files:**
- Create: `packages/entries/src/node.ts`
- Modify: `packages/entries/src/fs.ts` — add `listEntriesWithStatus`
- Modify: `packages/entries/package.json` — add `./node` export + `server-only` dep
- Modify: `packages/entries/tsconfig.json` — ensure `node.ts` is part of the build (should be automatic if it includes `src/**`)
- Create: `packages/entries/test/fs.list-with-status.test.ts` (or extend `fs.test.ts`)

- [ ] **Step 1: Add `server-only` dependency**

```bash
pnpm --filter @claude-lens/entries add server-only@^0.0.1
```

- [ ] **Step 2: Write failing test for `listEntriesWithStatus`**

Extend `packages/entries/test/fs.test.ts` (or create a sibling file). Add:

```typescript
describe("listEntriesWithStatus", () => {
  beforeEach(() => {
    __setEntriesDirForTest(mkdtempSync(join(tmpdir(), "entries-status-")));
  });

  it("returns only entries matching the requested status and orders oldest-first", () => {
    const mk = (day: string, status: "pending" | "done" | "error"): Entry => ({
      // ... reuse the Entry factory helper from existing fs.test.ts patterns ...
      // Ensure unique session_id per entry (use `sess-${day}`).
    });
    // write 3 pending (days 2026-04-01, 2026-04-15, 2026-04-20)
    // write 2 done (days 2026-04-05, 2026-04-18)
    // write 1 error (day 2026-04-10)

    const pending = listEntriesWithStatus(["pending"]);
    expect(pending).toHaveLength(3);
    expect(pending.map(e => e.local_day)).toEqual(["2026-04-01", "2026-04-15", "2026-04-20"]);

    const both = listEntriesWithStatus(["pending", "error"]);
    expect(both).toHaveLength(4);
    expect(both.map(e => e.local_day)).toEqual(["2026-04-01", "2026-04-10", "2026-04-15", "2026-04-20"]);
  });
});
```

Use the existing `Entry` construction helper from `fs.test.ts` if present; otherwise copy the pattern.

- [ ] **Step 3: Run test — verify fails**

Run: `pnpm --filter @claude-lens/entries test -- fs.test.ts`
Expected: `listEntriesWithStatus` not exported.

- [ ] **Step 4: Implement `listEntriesWithStatus` and `listKnownProjects` in `fs.ts`**

Add to `packages/entries/src/fs.ts`:

```typescript
import { type EntryEnrichmentStatus } from "./types.js";

export function listEntriesWithStatus(statuses: EntryEnrichmentStatus[]): Entry[] {
  const set = new Set(statuses);
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (!e) continue;
    if (set.has(e.enrichment.status)) out.push(e);
  }
  out.sort((a, b) => a.local_day.localeCompare(b.local_day)
    || a.session_id.localeCompare(b.session_id));
  return out;
}

/** Unique project values across all Entries on disk, sorted.
 *  Used by the Settings "AI Features" page to populate the allowlist.
 *  O(n) JSON parse over every Entry — acceptable at ≲1000 entries;
 *  revisit with a sidecar index if scale exceeds 10k. */
export function listKnownProjects(): string[] {
  const seen = new Set<string>();
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (e) seen.add(e.project);
  }
  return [...seen].sort();
}
```

Also add a quick test for `listKnownProjects` next to the existing `listEntriesWithStatus` test:

```typescript
it("listKnownProjects returns sorted unique project values", () => {
  // Reuse the Entry factory to write 3 entries across 2 projects.
  // Assert the result equals the two distinct project strings, sorted.
});
```

- [ ] **Step 5: Create `src/node.ts`**

Create `packages/entries/src/node.ts`:

```typescript
import "server-only";

export * from "./enrich.js";
export * from "./budget.js";
export * from "./prompts/enrich.js";
```

Note: `./queue.js` re-export is added by Task 8 Step 4; `./settings.js` re-export is added by Task 9 Step 4.

- [ ] **Step 6: Update `package.json` exports**

Edit `packages/entries/package.json`, replace the `exports` block:

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
},
```

- [ ] **Step 7: Run tests + typecheck + build**

```bash
pnpm --filter @claude-lens/entries test
pnpm --filter @claude-lens/entries build
pnpm typecheck
```

Expected: green. Verify `packages/entries/dist/node.js` and `dist/node.d.ts` exist after the build.

- [ ] **Step 8: Commit**

```bash
git add packages/entries/src/node.ts packages/entries/src/fs.ts packages/entries/package.json packages/entries/test pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(entries): ./node subpath with server-only guard + fs helpers

New ./node subpath re-exports enrich, budget, and prompts — Node-only
LLM code. `import "server-only"` at the top of node.ts triggers Next.js
to throw at build time if the module leaks into a client bundle.

Also adds two helpers on the existing ./fs subpath:
- listEntriesWithStatus(statuses): entries filtered by enrichment.status,
  sorted oldest-first by local_day. Used by the daemon enrichment queue
  + regenerate CLI.
- listKnownProjects(): unique project values, sorted. Used by the
  Settings page to populate the AI Features project allowlist.
EOF
)"
```

---

### Task 8: Daemon enrichment queue (`queue.ts` in `@claude-lens/entries`)

**Files:**
- Create: `packages/entries/src/queue.ts`
- Create: `packages/entries/test/queue.test.ts`
- Modify: `packages/entries/src/node.ts` — re-export `./queue`

**Design note:** The queue is a free function `runEnrichmentQueue(settings, opts?)` in `@claude-lens/entries/node`. The daemon (worker.ts) imports and calls it after the deterministic sweep (wired in Task 9 once `readSettings` is available). The regenerate CLI (Task 11) calls it directly. Living in `@claude-lens/entries` rather than the CLI package means both consumers share one implementation without a CLI-from-CLI internal deep import.

**Where it lives:** Keeping the queue in `packages/entries/src/` (not `packages/cli/`) eliminates the mid-plan refactor originally proposed in Task 11 and avoids a CLI↔web dep inversion. It's still Node-only (imports `fs`), so it sits alongside `enrich.ts`, `budget.ts`, and `settings.ts` behind the `./node` subpath.

- [ ] **Step 1: Write failing tests**

Create `packages/entries/test/queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEnrichmentQueue } from "../src/queue.js";
import { writeEntry, readEntry, __setEntriesDirForTest } from "../src/fs.js";
import { __setSpendPathForTest } from "../src/budget.js";
import type { CallLLM } from "../src/enrich.js";
import type { Entry } from "../src/types.js";
import { pendingEnrichment } from "../src/types.js";

// AiFeaturesSettings is defined in settings.ts (Task 9); inline an equivalent
// local shape here so this test file compiles without depending on Task 9.
// The queue implementation only reads the five fields below.
type QueueSettings = {
  enabled: boolean;
  apiKey: string;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    version: 2,
    session_id: `s-${Math.random().toString(36).slice(2, 10)}`,
    local_day: "2026-04-20",
    project: "/Users/test/foo",
    start_iso: "2026-04-20T09:00:00.000Z",
    end_iso: "2026-04-19T10:30:00.000Z",
    numbers: {
      active_min: 10, turn_count: 5, tools_total: 10, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0,
      pushes: 0, tokens_total: 1000,
    },
    flags: [],
    primary_model: "claude-sonnet-4-6",
    model_mix: {},
    first_user: "do a thing",
    final_agent: "done",
    pr_titles: [],
    top_tools: [],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 1, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: pendingEnrichment(),
    generated_at: "2026-04-20T10:30:00.000Z",
    source_jsonl: "/fake/path.jsonl",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
    ...overrides,
  };
}

describe("runEnrichmentQueue", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "enrich-queue-"));
    mkdirSync(join(tmp, "entries"), { recursive: true });
    __setEntriesDirForTest(join(tmp, "entries"));
    __setSpendPathForTest(join(tmp, "spend.jsonl"));
  });

  const baseSettings: QueueSettings = {
    enabled: true,
    apiKey: "sk-fake",
    model: "claude-sonnet-4-6",
    allowedProjects: ["/Users/test/foo"],
    monthlyBudgetUsd: null,
  };

  it("returns skipped:disabled when ai_features.enabled is false", async () => {
    const r = await runEnrichmentQueue({ ...baseSettings, enabled: false });
    expect(r).toEqual({ skipped: "disabled" });
  });

  it("returns skipped:no_api_key when apiKey is blank", async () => {
    const r = await runEnrichmentQueue({ ...baseSettings, apiKey: "" });
    expect(r).toEqual({ skipped: "no_api_key" });
  });

  it("returns skipped:no_allowed_projects when allowedProjects is empty", async () => {
    const r = await runEnrichmentQueue({ ...baseSettings, allowedProjects: [] });
    expect(r).toEqual({ skipped: "no_allowed_projects" });
  });

  it("enriches a pending Entry and writes the result + a spend record with real token counts", async () => {
    const entry = mkEntry({
      session_id: "s-enrich-1",
      local_day: "2026-04-20",
      project: "/Users/test/foo",
      end_iso: "2026-04-19T10:30:00.000Z",  // >30 min ago
    });
    writeEntry(entry);

    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        brief_summary: "You did the thing.",
        underlying_goal: "ship",
        friction_detail: null,
        user_instructions: [],
        goal_categories: { build: 10 },
        outcome: "shipped",
        claude_helpfulness: "helpful",
      }),
      input_tokens: 500, output_tokens: 100, model: "claude-sonnet-4-6",
    });

    const result = await runEnrichmentQueue(baseSettings, { callLLM });
    expect(result).toMatchObject({ enriched: 1, errors: 0 });

    const updated = readEntry("s-enrich-1", "2026-04-20")!;
    expect(updated.enrichment.status).toBe("done");
    expect(updated.enrichment.brief_summary).toBe("You did the thing.");

    const spend = readFileSync(join(tmp, "spend.jsonl"), "utf8").trim().split("\n");
    expect(spend).toHaveLength(1);
    const rec = JSON.parse(spend[0]!);
    expect(rec.input_tokens).toBe(500);
    expect(rec.output_tokens).toBe(100);
    expect(rec.kind).toBe("entry_enrich");
    expect(rec.caller).toBe("daemon");
  });

  it("skips today's Entries", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entry = mkEntry({ local_day: today, project: "/Users/test/foo" });
    writeEntry(entry);

    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect("enriched" in r ? r.enriched : 0).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("skips Entries whose end_iso is within the last 30 min", async () => {
    const now = Date.now();
    const entry = mkEntry({
      local_day: "2026-04-20",
      project: "/Users/test/foo",
      end_iso: new Date(now - 15 * 60 * 1000).toISOString(),
    });
    writeEntry(entry);
    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect("enriched" in r ? r.enriched : 0).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("skips Entries whose project is not in allowedProjects", async () => {
    const entry = mkEntry({ local_day: "2026-04-20", project: "/Users/other/bar" });
    writeEntry(entry);
    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect("enriched" in r ? r.enriched : 0).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("halts on budget cap mid-run; second Entry stays pending", async () => {
    // Two entries; first succeeds, pushes cost over cap; second never fires.
    // Budget math: Sonnet 4.6 at $3/1M input + $15/1M output.
    // 100_000 in + 10_000 out = $0.30 + $0.15 = $0.45.
    // Cap = $0.001. Iteration 1 pre-check passes (spend=0); iteration 2
    // pre-check re-reads spend=$0.45 ≥ $0.001, break.
    for (let i = 0; i < 2; i++) {
      writeEntry(mkEntry({
        session_id: `budget-${i}`,
        local_day: "2026-04-20",
        project: "/Users/test/foo",
        end_iso: "2026-04-19T10:30:00.000Z",
      }));
    }
    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        brief_summary: "ok", underlying_goal: "ok", friction_detail: null,
        user_instructions: [], goal_categories: {}, outcome: "shipped",
        claude_helpfulness: "helpful",
      }),
      input_tokens: 100_000, output_tokens: 10_000, model: "claude-sonnet-4-6",
    });
    const r = await runEnrichmentQueue(
      { ...baseSettings, monthlyBudgetUsd: 0.001 },
      { callLLM },
    );
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect("enriched" in r ? r.enriched : 0).toBe(1);

    // One of the two entries should still be pending (the one that didn't run).
    const e0 = readEntry("budget-0", "2026-04-20")!;
    const e1 = readEntry("budget-1", "2026-04-20")!;
    const remaining = [e0, e1].filter(e => e.enrichment.status === "pending");
    expect(remaining).toHaveLength(1);
  });

  it("skips Entries with retry_count >= 3 (frozen)", async () => {
    const entry = mkEntry({
      session_id: "frozen-1",
      local_day: "2026-04-20",
      project: "/Users/test/foo",
    });
    entry.enrichment.status = "error";
    entry.enrichment.retry_count = 3;
    writeEntry(entry);

    const callLLM: CallLLM = vi.fn();
    const r = await runEnrichmentQueue(baseSettings, { callLLM });
    expect(callLLM).not.toHaveBeenCalled();
    expect("enriched" in r ? r.enriched : 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `pnpm --filter @claude-lens/entries test -- queue.test.ts`
Expected: module not found (`../src/queue.js`).

- [ ] **Step 3: Implement `runEnrichmentQueue` in `packages/entries/src/queue.ts`**

Create `packages/entries/src/queue.ts`:

```typescript
import { listEntriesWithStatus, writeEntry } from "./fs.js";
import { enrichEntry, type CallLLM } from "./enrich.js";
import { appendSpend, monthToDateSpend } from "./budget.js";
import type { AiFeaturesSettings } from "./settings.js";
import type { Entry } from "./types.js";

export type EnrichmentResult =
  | { skipped: "disabled" | "no_api_key" | "no_allowed_projects" | "budget_cap_reached" }
  | { enriched: number; errors: number; skipped: number };

export type EnrichmentQueueOptions = {
  callLLM?: CallLLM;
  /** Override the "now" reference for the today-skip and 30-min-settled checks (tests). */
  now?: () => number;
};

const THIRTY_MIN_MS = 30 * 60 * 1000;
const MAX_RETRY_COUNT = 3;

function toLocalDay(ms: number): string {
  // Local-day in the reader's timezone, matching how buildEntries slices days.
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runEnrichmentQueue(
  settings: AiFeaturesSettings,
  opts: EnrichmentQueueOptions = {},
): Promise<EnrichmentResult> {
  if (!settings.enabled) return { skipped: "disabled" };
  if (!settings.apiKey) return { skipped: "no_api_key" };
  if (settings.allowedProjects.length === 0) return { skipped: "no_allowed_projects" };

  const budget = settings.monthlyBudgetUsd ?? Infinity;
  if (monthToDateSpend() >= budget) return { skipped: "budget_cap_reached" };

  const now = opts.now ?? (() => Date.now());

  const queue = listEntriesWithStatus(["pending", "error"])
    .filter(e => (e.enrichment.retry_count ?? 0) < MAX_RETRY_COUNT);

  const allowed = new Set(settings.allowedProjects);
  const todayLocal = toLocalDay(now());
  let enriched = 0, errors = 0, skipped = 0;

  for (const entry of queue) {
    if (entry.local_day === todayLocal) { skipped++; continue; }
    const endMs = Date.parse(entry.end_iso);
    if (!Number.isNaN(endMs) && now() - endMs < THIRTY_MIN_MS) { skipped++; continue; }
    if (!allowed.has(entry.project)) { skipped++; continue; }

    // Re-read spend each iteration — no in-memory cache. A long backfill that
    // crosses the cap mid-run halts on the right Entry.
    if (monthToDateSpend() >= budget) break;

    try {
      const { entry: result, usage } = await enrichEntry(entry, {
        apiKey: settings.apiKey,
        model: settings.model,
        callLLM: opts.callLLM,
      });
      writeEntry(result);
      if (result.enrichment.status === "done") {
        enriched++;
        appendSpend({
          ts: new Date().toISOString(),
          caller: "daemon",
          model: result.enrichment.model ?? settings.model,
          input_tokens: usage?.input_tokens ?? 0,
          output_tokens: usage?.output_tokens ?? 0,
          cost_usd: result.enrichment.cost_usd ?? 0,
          kind: "entry_enrich",
          ref: `${result.session_id}__${result.local_day}`,
        });
      } else {
        errors++;
      }
    } catch (err) {
      // enrichEntry catches internally and returns status="error"; this branch
      // only fires for unexpected framework-level failures (disk write, etc.).
      errors++;
      const failed: Entry = {
        ...entry,
        enrichment: {
          ...entry.enrichment,
          status: "error",
          retry_count: (entry.enrichment.retry_count ?? 0) + 1,
          error: (err as Error).message,
          generated_at: new Date().toISOString(),
        },
      };
      writeEntry(failed);
    }
  }

  return { enriched, errors, skipped };
}
```

- [ ] **Step 4: Re-export from `./node`**

Edit `packages/entries/src/node.ts`:

```typescript
import "server-only";

export * from "./enrich.js";
export * from "./budget.js";
export * from "./prompts/enrich.js";
export * from "./queue.js";
```

**Note:** The `runPerceptionSweep` → `runEnrichmentQueue` wiring is deferred to Task 9 Step 5, once `readSettings` exists. Task 8 does not touch `worker.ts` at all.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @claude-lens/entries test -- queue.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Full test + typecheck**

```bash
pnpm test
pnpm typecheck
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/entries/src/queue.ts packages/entries/src/node.ts packages/entries/test/queue.test.ts
git commit -m "$(cat <<'EOF'
feat(entries): enrichment queue

runEnrichmentQueue iterates pending/error Entries (retry_count<3), applies
the five gates (enabled, apiKey, allowedProjects, not-today, 30-min
settled), and calls enrichEntry for each. Budget cap is re-read every
iteration so long backfills halt mid-run on the right Entry.

Lives in @claude-lens/entries/queue so both the daemon sweep (wired in
Task 9) and `entries regenerate` CLI (Task 11) import one implementation
via @claude-lens/entries/node.

Token counts in spend records come straight from enrichEntry's usage
return — no zero placeholder.

callLLM is injectable for tests; default uses the Anthropic SDK.
EOF
)"
```

---

## Chunk 4: Settings + Web UI + CLI

### Task 9: Settings module (`settings.ts`) + daemon-sweep integration

**Files:**
- Create: `packages/entries/src/settings.ts`
- Modify: `packages/entries/src/node.ts` — re-export settings
- Create: `packages/entries/test/settings.test.ts`
- Modify: `packages/cli/src/perception/worker.ts` — finally hook `runEnrichmentQueue` into the sweep

**Design deviation from spec:** Spec places the settings helper at `packages/cli/src/settings.ts`. I'm putting it at `packages/entries/src/settings.ts` instead, exported via `./node`. Rationale: both the CLI (daemon + `entries regenerate`) and the web server routes need the same reader/writer. Living in `@claude-lens/entries/node` keeps one implementation; web can't import from `@claude-lens/cli` without a dep inversion. Spec's end state is unaffected (same JSON file, same atomic-write + chmod behavior).

- [ ] **Step 1: Write failing tests**

Create `packages/entries/test/settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSettings,
  writeSettings,
  __setSettingsPathForTest,
  type Settings,
  type AiFeaturesSettings,
} from "../src/settings.js";

describe("settings", () => {
  let path: string;
  const origKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "settings-"));
    path = join(tmp, "settings.json");
    __setSettingsPathForTest(path);
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  it("readSettings returns defaults when file does not exist", () => {
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(false);
    expect(s.ai_features.apiKey).toBe("");
    expect(s.ai_features.allowedProjects).toEqual([]);
    expect(s.ai_features.monthlyBudgetUsd).toBeNull();
  });

  it("falls back to ANTHROPIC_API_KEY env var when settings apiKey is blank", () => {
    process.env.ANTHROPIC_API_KEY = "sk-env-fallback";
    const s = readSettings();
    expect(s.ai_features.apiKey).toBe("sk-env-fallback");
  });

  it("prefers settings-file apiKey over env var when both set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-env";
    writeSettings({
      ai_features: {
        enabled: true,
        apiKey: "sk-file",
        model: "claude-sonnet-4-6",
        allowedProjects: [],
        monthlyBudgetUsd: null,
      },
    });
    const s = readSettings();
    expect(s.ai_features.apiKey).toBe("sk-file");
  });

  it("writeSettings persists JSON atomically and sets chmod 600", () => {
    const s: Settings = {
      ai_features: {
        enabled: true,
        apiKey: "sk-test",
        model: "claude-sonnet-4-6",
        allowedProjects: ["/Users/test/foo"],
        monthlyBudgetUsd: 5,
      },
    };
    writeSettings(s);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(JSON.parse(raw)).toEqual(s);
    // On POSIX, chmod 600 = 0o600 = 0o100600 via statSync#mode
    if (process.platform !== "win32") {
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("round-trips: writeSettings then readSettings returns the same shape", () => {
    const original: Settings = {
      ai_features: {
        enabled: true,
        apiKey: "sk-x",
        model: "claude-sonnet-4-6",
        allowedProjects: ["/a", "/b"],
        monthlyBudgetUsd: 10.5,
      },
    };
    writeSettings(original);
    expect(readSettings()).toEqual(original);
  });

  it("tolerates malformed JSON by returning defaults", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path, "{not json");
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `pnpm --filter @claude-lens/entries test -- settings.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement `settings.ts`**

Create `packages/entries/src/settings.ts`:

```typescript
import {
  readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type AiFeaturesSettings = {
  enabled: boolean;
  apiKey: string;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

export type Settings = {
  ai_features: AiFeaturesSettings;
};

const DEFAULT_SETTINGS: Settings = {
  ai_features: {
    enabled: false,
    apiKey: "",
    model: "claude-sonnet-4-6",
    allowedProjects: [],
    monthlyBudgetUsd: null,
  },
};

let settingsPathCached: string | null = null;

function settingsPath(): string {
  if (settingsPathCached) return settingsPathCached;
  settingsPathCached = join(homedir(), ".cclens", "settings.json");
  return settingsPathCached;
}

/** @internal Test-only. */
export function __setSettingsPathForTest(path: string): void {
  settingsPathCached = path;
}

/** Shape on disk uses snake_case (to match the spec's JSON example);
 *  in-memory shape uses camelCase. */
type SettingsOnDisk = {
  ai_features: {
    enabled: boolean;
    anthropic_api_key: string;
    model: string;
    allowed_projects: string[];
    monthly_budget_usd: number | null;
  };
};

function toDisk(s: Settings): SettingsOnDisk {
  return {
    ai_features: {
      enabled: s.ai_features.enabled,
      anthropic_api_key: s.ai_features.apiKey,
      model: s.ai_features.model,
      allowed_projects: s.ai_features.allowedProjects,
      monthly_budget_usd: s.ai_features.monthlyBudgetUsd,
    },
  };
}

function fromDisk(d: Partial<SettingsOnDisk>): Settings {
  const af = d.ai_features ?? {};
  return {
    ai_features: {
      enabled: af.enabled ?? DEFAULT_SETTINGS.ai_features.enabled,
      apiKey: af.anthropic_api_key ?? DEFAULT_SETTINGS.ai_features.apiKey,
      model: af.model ?? DEFAULT_SETTINGS.ai_features.model,
      allowedProjects: af.allowed_projects ?? [],
      monthlyBudgetUsd: af.monthly_budget_usd ?? null,
    },
  };
}

export function readSettings(): Settings {
  const p = settingsPath();
  let fromFile: Settings = DEFAULT_SETTINGS;
  if (existsSync(p)) {
    try {
      const raw = readFileSync(p, "utf8");
      fromFile = fromDisk(JSON.parse(raw) as Partial<SettingsOnDisk>);
    } catch {
      fromFile = DEFAULT_SETTINGS;
    }
  }
  // Env-var fallback for apiKey
  if (!fromFile.ai_features.apiKey && process.env.ANTHROPIC_API_KEY) {
    fromFile = {
      ...fromFile,
      ai_features: {
        ...fromFile.ai_features,
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    };
  }
  return fromFile;
}

export function writeSettings(s: Settings): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(toDisk(s), null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") {
    chmodSync(tmp, 0o600);
  }
  renameSync(tmp, p);
}
```

- [ ] **Step 4: Re-export from `./node`**

Edit `packages/entries/src/node.ts`:

```typescript
import "server-only";

export * from "./enrich.js";
export * from "./budget.js";
export * from "./prompts/enrich.js";
export * from "./settings.js";
```

- [ ] **Step 5: Wire the sweep to settings + queue**

Edit `packages/cli/src/perception/worker.ts`:

1. Add imports at the top (alongside existing imports):

```typescript
import { readSettings, runEnrichmentQueue } from "@claude-lens/entries/node";
```

2. Inside `runPerceptionSweep`'s `try { ... }`, immediately AFTER the `for (const f of files)` loop and BEFORE the `finally`/`markSweepEnd`, add the enrichment phase:

```typescript
    // Phase 1b enrichment — guarded by settings. Failure here is logged
    // but not fatal to the deterministic sweep result.
    try {
      const settings = readSettings();
      const r = await runEnrichmentQueue(settings.ai_features);
      if ("skipped" in r && typeof r.skipped === "string") {
        log(`enrichment: skipped (${r.skipped})`);
      } else if ("enriched" in r) {
        log(`enrichment: enriched=${r.enriched} errors=${r.errors} skipped=${r.skipped}`);
      }
    } catch (err) {
      log(`enrichment failed: ${(err as Error).message}`);
    }
```

- [ ] **Step 6: Run tests + typecheck + build**

```bash
pnpm test
pnpm typecheck
pnpm --filter @claude-lens/entries build
pnpm --filter fleetlens build
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/entries/src/settings.ts packages/entries/src/node.ts packages/entries/test/settings.test.ts packages/cli/src/perception/worker.ts
git commit -m "$(cat <<'EOF'
feat(entries,cli): settings module + daemon-sweep enrichment wiring

~/.cclens/settings.json reader/writer with:
- atomic write-tmp + rename
- chmod 600 on POSIX
- ANTHROPIC_API_KEY env-var fallback for blank apiKey
- snake_case on disk, camelCase in memory
- malformed JSON → defaults

Lives in @claude-lens/entries/node so both CLI and web-server routes
share one implementation (slight spec deviation — justified by DRY
across the two consumers).

runPerceptionSweep now reads settings at the end of each sweep and
invokes runEnrichmentQueue. Failures are logged, never fatal to the
deterministic layer.
EOF
)"
```

---

### Task 10: Web `/settings` "AI Features" section

**Files:**
- Modify: `apps/web/package.json` — add `@claude-lens/entries` dep (not currently present)
- Modify: `apps/web/next.config.ts` — add `@claude-lens/entries` to `transpilePackages`
- Modify or Create: `apps/web/app/settings/page.tsx`
- Create: `apps/web/app/settings/ai-features-form.tsx` (client component)
- Create: `apps/web/app/api/settings/route.ts`

- [ ] **Step 1: Inspect current web settings surface**

```bash
ls apps/web/app/settings/ 2>/dev/null
ls apps/web/app/api/ 2>/dev/null
```

If `apps/web/app/settings/` does not exist, create it. If it already has `page.tsx`, add the "AI Features" section rather than replacing.

- [ ] **Step 2: Add the entries dependency to the web package**

```bash
pnpm --filter @claude-lens/web add @claude-lens/entries@workspace:*
```

Verify: `apps/web/package.json` now lists `"@claude-lens/entries": "workspace:*"` under dependencies.

- [ ] **Step 3: Add entries to `transpilePackages`**

Edit `apps/web/next.config.ts`. If there's an existing `transpilePackages: ["@claude-lens/parser"]`, extend to `["@claude-lens/parser", "@claude-lens/entries"]`. If no `transpilePackages` key exists, add one. This is required because `@claude-lens/entries` ships TypeScript source via workspace resolution and Next.js's default loader won't compile it otherwise.

- [ ] **Step 4: Create the API route**

Create `apps/web/app/api/settings/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { readSettings, writeSettings, monthToDateSpend } from "@claude-lens/entries/node";

export const runtime = "nodejs";

export async function GET() {
  const s = readSettings();
  // Redact apiKey before responding — never send the key back to the client.
  const redacted = {
    ...s,
    ai_features: {
      ...s.ai_features,
      apiKey: s.ai_features.apiKey ? "********" : "",
      apiKeyIsSet: Boolean(s.ai_features.apiKey),
    },
  };
  return NextResponse.json({
    settings: redacted,
    month_to_date_spend_usd: monthToDateSpend(),
  });
}

export async function PUT(req: Request) {
  const body = await req.json() as {
    ai_features: {
      enabled: boolean;
      apiKey?: string;                // empty string = unset; "********" = keep existing
      model: string;
      allowedProjects: string[];
      monthlyBudgetUsd: number | null;
    };
  };
  const current = readSettings();
  const nextApiKey =
    body.ai_features.apiKey === undefined || body.ai_features.apiKey === "********"
      ? current.ai_features.apiKey
      : body.ai_features.apiKey;
  writeSettings({
    ai_features: {
      enabled: body.ai_features.enabled,
      apiKey: nextApiKey,
      model: body.ai_features.model,
      allowedProjects: body.ai_features.allowedProjects,
      monthlyBudgetUsd: body.ai_features.monthlyBudgetUsd,
    },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Create or extend the settings page**

Create `apps/web/app/settings/page.tsx` (or add a section to the existing one):

```tsx
import { readSettings, monthToDateSpend } from "@claude-lens/entries/node";
import { listKnownProjects } from "@claude-lens/entries/fs";
import { AiFeaturesForm } from "./ai-features-form";

export default function SettingsPage() {
  const s = readSettings();
  const spend = monthToDateSpend();
  // One pass over all Entries — O(n) at ~1000 entries is ~100ms.
  // Acceptable for V2 feature branch; revisit with a sidecar index if scale grows.
  const projects = listKnownProjects();
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Fleetlens Settings</h1>
      <section>
        <h2 className="text-lg font-medium mb-2">AI Features</h2>
        <p className="text-sm text-gray-500 mb-4">
          When enabled, the daemon enriches each (session × day) Entry via Claude Sonnet 4.6.
          Your API key is stored locally at <code>~/.cclens/settings.json</code> (chmod 600) and never transmitted anywhere except to the Anthropic API.
        </p>
        <AiFeaturesForm
          initial={{
            enabled: s.ai_features.enabled,
            apiKeyIsSet: Boolean(s.ai_features.apiKey),
            model: s.ai_features.model,
            allowedProjects: s.ai_features.allowedProjects,
            monthlyBudgetUsd: s.ai_features.monthlyBudgetUsd,
          }}
          projectCandidates={projects}
          monthToDateSpend={spend}
        />
      </section>
    </main>
  );
}
```

Create `apps/web/app/settings/ai-features-form.tsx`:

```tsx
"use client";
import { useState } from "react";

type Initial = {
  enabled: boolean;
  apiKeyIsSet: boolean;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

export function AiFeaturesForm({
  initial, projectCandidates, monthToDateSpend,
}: {
  initial: Initial;
  projectCandidates: string[];
  monthToDateSpend: number;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [apiKey, setApiKey] = useState(initial.apiKeyIsSet ? "********" : "");
  const [model, setModel] = useState(initial.model);
  const [allowedProjects, setAllowedProjects] = useState<string[]>(initial.allowedProjects);
  const [budget, setBudget] = useState<string>(
    initial.monthlyBudgetUsd === null ? "" : String(initial.monthlyBudgetUsd),
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ai_features: {
          enabled,
          apiKey: apiKey === "********" ? "********" : apiKey,
          model,
          allowedProjects,
          monthlyBudgetUsd: budget === "" ? null : Number(budget),
        },
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved." : `Error: ${res.status}`);
  }

  function toggleProject(p: string) {
    setAllowedProjects(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p],
    );
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>Enable Entry enrichment</span>
      </label>

      <label className="block">
        <span className="text-sm text-gray-600">Anthropic API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-ant-…"
          className="mt-1 block w-full border rounded px-2 py-1"
        />
        <span className="text-xs text-gray-500">
          Leave blank to use the <code>ANTHROPIC_API_KEY</code> env var. Shown as ******** if already set.
        </span>
      </label>

      <label className="block">
        <span className="text-sm text-gray-600">Model</span>
        <input
          type="text"
          value={model}
          onChange={e => setModel(e.target.value)}
          className="mt-1 block w-full border rounded px-2 py-1"
        />
      </label>

      <fieldset>
        <legend className="text-sm text-gray-600">Projects to enrich</legend>
        <div className="mt-1 space-y-1 max-h-48 overflow-auto border rounded p-2">
          {projectCandidates.length === 0 ? (
            <p className="text-xs text-gray-500">No projects detected yet — run the daemon at least once.</p>
          ) : projectCandidates.map(p => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowedProjects.includes(p)}
                onChange={() => toggleProject(p)}
              />
              <code className="text-xs">{p}</code>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm text-gray-600">Monthly budget cap (USD) — blank = no cap</span>
        <input
          type="number"
          value={budget}
          onChange={e => setBudget(e.target.value)}
          step="0.01"
          className="mt-1 block w-full border rounded px-2 py-1"
        />
      </label>

      <p className="text-xs text-gray-500">
        Month-to-date spend: ${monthToDateSpend.toFixed(2)}
      </p>

      <button
        onClick={save}
        disabled={saving}
        className="px-3 py-1 border rounded bg-black text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {savedMsg && <p className="text-sm">{savedMsg}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Verify the entries package builds before the web build**

Run: `pnpm -F @claude-lens/entries build && ls packages/entries/dist/node.js packages/entries/dist/node.d.ts`
Expected: both files exist. Turborepo's `turbo.json` should already declare `web` as depending on `entries`'s build — verify with:
```bash
grep -A5 '"build"' turbo.json 2>/dev/null
```

- [ ] **Step 7: Run the dev server and smoke-test the page**

Per CLAUDE.md's dev-server flow:

```bash
rm -rf apps/web/.next packages/cli/app
NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build
node scripts/prepare-cli.mjs
lsof -ti:3321 | xargs kill -9 2>&1
node packages/cli/dist/index.js stop || true
node packages/cli/dist/index.js web usage --no-open
```

Then `curl -s http://localhost:3321/settings -o /dev/null -w '%{http_code}\n'` — expect `200`.

- [ ] **Step 8: Run the smoke script**

```bash
pnpm verify
```

Expected: all routes 200, typecheck clean, V1 insights regression hash unchanged.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/settings apps/web/app/api/settings apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): /settings page with AI Features section

Surfaces ai_features.* for user configuration:
- toggle Enable
- Anthropic API key (masked as ******** once set)
- project allowlist (multi-select populated from Entries on disk)
- monthly budget cap
- month-to-date spend indicator

API route at /api/settings handles GET (redacts apiKey) and PUT
(preserves the existing key when the client sends the "********" sentinel).

Minimal styling; polish waits until V2 ships.
EOF
)"
```

---

### Task 11: `fleetlens entries regenerate` CLI

**Files:**
- Modify: `packages/cli/src/commands/entries.ts`

**Why the override:** Phase 1a spec declared Entries immutable once `enrichment.status ∈ {done, error, skipped_trivial}`. `regenerate --force` is an explicit operator escape hatch — it resets matched Entries to `status=pending, retry_count=0` and re-enqueues them. Without `--force`, `regenerate` only picks up `pending` + `error<3retries` — same set the daemon processes.

**`--force` does NOT reset `skipped_trivial` Entries.** Triviality is deterministic — a trivial Entry has `<1 min` of real work by definition; re-enriching it is pointless and wasteful. A future `--include-trivial` flag can override this if a specific need arises.

- [ ] **Step 1: Read the current entries.ts dispatcher**

Run: `cat packages/cli/src/commands/entries.ts`
Note: top-level `entries(args)` currently dispatches on flags. Add a subcommand switch: if `args[0] === "regenerate"`, route to a new handler.

- [ ] **Step 2: Implement the subcommand**

Edit `packages/cli/src/commands/entries.ts`. At the top of `export async function entries(args)`, add:

```typescript
  if (args[0] === "regenerate") {
    await regenerate(args.slice(1));
    return;
  }
```

Then add at the bottom of the file:

```typescript
async function regenerate(args: string[]): Promise<void> {
  const since = flag(args, "--since");
  const force = args.includes("--force");
  const json = args.includes("--json");

  const { readSettings, runEnrichmentQueue, monthToDateSpend } = await import("@claude-lens/entries/node");
  const { writeEntry, listEntriesWithStatus } = await import("@claude-lens/entries/fs");

  const settings = readSettings();
  if (!settings.ai_features.enabled) {
    console.error("ai_features.enabled is false — nothing to do. Toggle it in Settings or settings.json.");
    process.exit(2);
  }

  // --force: reset matched Entries to pending + retry_count=0 before running the queue.
  // Explicitly excludes skipped_trivial — triviality is deterministic, re-enriching is wasteful.
  if (force) {
    const candidates = listEntriesWithStatus(["done", "error", "pending"])
      .filter(e => !since || e.local_day >= since);
    for (const e of candidates) {
      writeEntry({
        ...e,
        enrichment: {
          ...e.enrichment,
          status: "pending",
          retry_count: 0,
          error: null,
          generated_at: null,
        },
      });
    }
    if (!json) console.log(`Reset ${candidates.length} Entries to pending.`);
  }

  const budgetBefore = monthToDateSpend();
  const result = await runEnrichmentQueue(settings.ai_features);
  const budgetAfter = monthToDateSpend();

  if ("skipped" in result && typeof result.skipped === "string") {
    if (json) console.log(JSON.stringify(result));
    else console.log(`skipped: ${result.skipped}`);
    // Exit codes: budget_cap_reached pre-run → 3; otherwise 0.
    const exit = result.skipped === "disabled" ? 2
      : result.skipped === "budget_cap_reached" ? 3
      : 0;
    process.exit(exit);
  }
  const r = result as { enriched: number; errors: number; skipped: number };
  if (json) console.log(JSON.stringify(r));
  else console.log(`enriched=${r.enriched} errors=${r.errors} skipped=${r.skipped}`);

  // Detect budget exceeded mid-run: spend advanced AND is now ≥ cap → exit 3.
  const cap = settings.ai_features.monthlyBudgetUsd;
  if (cap !== null && budgetAfter > budgetBefore && budgetAfter >= cap) {
    process.exit(3);
  }
  process.exit(0);
}
```

- [ ] **Step 3: Add help text**

Edit the `printHelp` function at the bottom of `entries.ts`:

```typescript
function printHelp(): void {
  console.log(`fleetlens entries — inspect and regenerate perception-layer Entries

Usage:
  fleetlens entries                            Summary: count of entries, sessions, days
  fleetlens entries --day YYYY-MM-DD           All entries for a given local day
  fleetlens entries --session UUID             All entries for a given session
  fleetlens entries --all                      All entries in the store
  fleetlens entries regenerate [--since D] [--force] [--json]
                                               Re-run enrichment. --force resets
                                               status+retry_count on matched non-trivial
                                               Entries (skipped_trivial NOT reset).

Exit codes:
  0 — success (or no-op)
  2 — ai_features.enabled is false
  3 — monthly budget cap reached (pre-run or mid-run)
`);
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm test
pnpm typecheck
```

Expected: green. No test changes should be required — the queue was authored in Task 8 already exporting from `@claude-lens/entries/node`.

- [ ] **Step 5: Smoke the CLI**

```bash
pnpm -F fleetlens build
node packages/cli/dist/index.js entries --help
node packages/cli/dist/index.js entries regenerate --json
```

Expected on a default install (ai_features disabled): exit code 2 and a "disabled" message.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/entries.ts
git commit -m "$(cat <<'EOF'
feat(cli): fleetlens entries regenerate

Shares runEnrichmentQueue with the daemon via @claude-lens/entries/node
(queue lives in the entries package — see Task 8). Flags:

- --since YYYY-MM-DD : only re-enrich Entries at or after that local day
- --force            : reset matched non-trivial Entries to status=pending +
                       retry_count=0 (explicit override of Phase 1a
                       immutability). skipped_trivial entries are NOT reset.
- --json             : machine-readable progress

Exit codes: 0 success, 2 ai_features disabled, 3 monthly budget cap
reached (either pre-run skip or detected by comparing month-to-date
spend before vs. after the queue run).
EOF
)"
```

---

## Final verification (not a commit, run after Task 11)

- [ ] **Step 1: Full verify**

```bash
pnpm test
pnpm typecheck
pnpm verify
```

All three must pass. The V1 insights regression hash (`scripts/v1-insights-regression.mjs`) must continue to match.

- [ ] **Step 2: Dogfood sanity check**

With the feature enabled on one real project:

```bash
# Enable via /settings page or edit settings.json directly:
# ai_features.enabled: true, apiKey: sk-ant-..., allowedProjects: [one known cwd], monthlyBudgetUsd: 5
node packages/cli/dist/index.js entries regenerate --since 2026-04-22 --json
```

Expect: one or more Entries enriched, spend record appended to `~/.cclens/llm-spend.jsonl`, `fleetlens entries --all | head` shows `enr=done` for enriched Entries.

- [ ] **Step 3: V2 branch state**

```bash
git log --oneline feat/v2-perception-insights..HEAD
```

Expect: 11 commits on top of `feat/v2-perception-insights`. Task 1 lands as a single commit despite having an extra confirmation step (Step 8 verifies fs.test.ts needs no changes — no separate commit).

- [ ] **Step 4: Push phase-1b branch, open PR to feature branch**

```bash
git push -u origin feat/v2-perception-phase-1b
gh pr create --base feat/v2-perception-insights --head feat/v2-perception-phase-1b \
  --title "Phase 1b: LLM enrichment for Entries" \
  --body "$(cat <<'EOF'
## Summary
- LLM enriches Phase 1a Entries via Sonnet 4.6 daemon-run
- Settings at ~/.cclens/settings.json (chmod 600) + /settings UI
- Budget tracker at ~/.cclens/llm-spend.jsonl with monthly soft cap
- fleetlens entries regenerate CLI (with --force override)
- Folds in Phase 1a follow-ups: orchestrated → subagent_turns >= 3; injectable projectsRoot
- Schema: goal_categories now minutes (not counts); retry_count field bounds error loops at 3

## Test plan
- [x] pnpm test (all packages)
- [x] pnpm typecheck
- [x] pnpm verify (smoke + V1 regression hash)
- [ ] Dogfood: enrich a real session on a personal project and inspect the resulting Entry
- [ ] Settings page loads, saves, reloads with masked apiKey

Spec: docs/superpowers/specs/2026-04-22-perception-layer-phase-1b-design.md
EOF
)"
```

---

## Notes for the executing agent

- **Never skip the TDD step.** Each task's test must fail first, then pass after implementation. If a test passes before implementation, the test is wrong (too weak) — fix it.
- **Check the V1 regression hash at the end of every chunk.** If it moves, something in the pipeline accidentally touched `packages/parser/src/capsule.ts`, `aggregate.ts`, or `insights-prompt.ts`. Revert and investigate.
- **Do not merge to master.** All work stays on `feat/v2-perception-phase-1b`. The final PR targets `feat/v2-perception-insights`.
- **If any task grows beyond its scope** (e.g., you find `runEnrichmentQueue` needs a bigger refactor than Task 8 expected), stop and flag it. Do not silently expand scope — it breaks the commit-per-task invariant.
- **For Next.js 16 RSC imports:** `@claude-lens/entries/node` must only be imported from server components or route handlers. The `import "server-only"` marker enforces this at build time.
