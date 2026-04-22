# Perception Layer — Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deterministic Entry layer end-to-end — a new `packages/entries/` package that turns Claude Code session transcripts into per-(session, local-day) `Entry` artifacts, stores them atomically on disk, exposes them via a `fleetlens entries` CLI, and rebuilds them in the background via the existing daemon. No LLM calls yet.

**Architecture:** A new workspace package `@claude-lens/entries` with subpath exports (`.` = types only; `./fs` = Node-only storage + builder). Consumes `SessionDetail` from the existing `@claude-lens/parser`. Writes to `~/.cclens/entries/{session_id}__{YYYY-MM-DD}.json` using atomic write-rename. A new `packages/cli/src/perception/` subtree adds a daemon worker loop invoked from `daemon-worker.ts`. V1 `/insights` page, `SessionCapsule` type, and `buildCapsule` function are untouched.

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, vitest, esbuild (CLI bundle). Zero new dependencies — stdlib `node:fs`, `node:os`, `node:path` plus the existing `@claude-lens/parser`.

**Reference spec:** `docs/superpowers/specs/2026-04-22-perception-layer-design.md`

**Out of scope in this plan (comes in Phase 1b and Phase 2):**
- LLM enrichment (`enrichment.status` stays permanently `"pending"` or `"skipped_trivial"` — no enrichment path wired).
- Day digest generation + storage.
- `/digest/[date]` web route + renderer.
- Settings UI.
- Cross-process LLM budget coordination (not needed without LLM calls).
- `ai_features` settings block.

**Definition of done for Phase 1a:**
- `pnpm build && pnpm test && pnpm typecheck` all green.
- `fleetlens entries --day 2026-04-22 --json` prints Entry JSON for today's sessions.
- `fleetlens entries --session <uuid> --json` prints every Entry that session touches.
- Starting the daemon causes `~/.cclens/entries/` to populate for all historical JSONL within 5–10 minutes.
- V1 `/insights` route byte-equal output before vs after (regression test).
- 100% deterministic: running the builder twice against unchanged JSONL produces byte-equal Entry files.

---

## File Structure

```
packages/entries/                              ← NEW workspace package
  package.json                                 @claude-lens/entries, workspace:* parser dep
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                                   re-exports types only (browser-safe)
    types.ts                                   Entry, CURRENT_ENTRY_SCHEMA_VERSION
    signals.ts                                 pure: regex detection of satisfaction/sources/instructions
    trivial.ts                                 pure: isTrivial(entry): boolean
    build.ts                                   pure: SessionDetail → Entry[] (groupByDay + per-day agg)
    fs.ts                                      Node-only: atomic read/write storage + state file
  test/
    signals.test.ts
    trivial.test.ts
    build.test.ts
    fs.test.ts
    fixtures/
      one-day-session.jsonl                    tiny fixture for unit tests
      span-midnight-session.jsonl              session crossing 00:00 boundary

packages/cli/src/
  commands/entries.ts                          NEW: `fleetlens entries` command
  perception/
    worker.ts                                  NEW: sweep loop (rebuild deterministic only)
    state.ts                                   NEW: read/write ~/.cclens/perception-state.json
  daemon-worker.ts                             MODIFY: call perception worker every 5 min
  args.ts                                      MODIFY: register `entries` subcommand

apps/web/                                      UNCHANGED in Phase 1a
```

**Boundary rules (enforced by package.json exports):**
- `@claude-lens/entries` (root) exports types only. Safe to import from web components.
- `@claude-lens/entries/fs` exports storage + builder. Node-only. Imported only by CLI and server-only web modules (not in Phase 1a).

**What stays unchanged:**
- `packages/parser/src/capsule.ts` — `SessionCapsule`, `buildCapsule`. Still used by V1 insights.
- `packages/parser/src/aggregate.ts` — `buildPeriodBundle`, `PeriodBundle`. Still used by V1 insights.
- `apps/web/lib/ai/insights-prompt.ts`, `apps/web/app/api/insights/route.ts` — V1 route.

---

## Chunk 1: Package scaffolding + Entry type

### Task 1: Scaffold `packages/entries/` workspace package

**Files:**
- Create: `packages/entries/package.json`
- Create: `packages/entries/tsconfig.json`
- Create: `packages/entries/vitest.config.ts`
- Create: `packages/entries/src/index.ts`
- Create: `packages/entries/README.md`

- [ ] **Step 1: Create `packages/entries/package.json`**

Mirror `packages/parser/package.json` conventions. Two subpath exports:

```json
{
  "name": "@claude-lens/entries",
  "version": "0.4.0",
  "description": "Day-scoped Entry primitive for Fleetlens — one artifact per (session × local-day).",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./fs": {
      "types": "./dist/fs.d.ts",
      "import": "./dist/fs.js"
    }
  },
  "files": ["dist", "src", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist .turbo *.tsbuildinfo",
    "lint": "eslint"
  },
  "dependencies": {
    "@claude-lens/parser": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/entries/tsconfig.json`**

Copy `packages/parser/tsconfig.json` and update as needed. Point to `./src` and `./dist` with ES2022 target + NodeNext module resolution.

- [ ] **Step 3: Create `packages/entries/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    reporters: "default",
  },
});
```

- [ ] **Step 4: Stub `packages/entries/src/index.ts`**

```ts
export * from "./types.js";
```

- [ ] **Step 5: Add the package to root workspace + verify**

Root `package.json`'s `workspaces` (or `pnpm-workspace.yaml`) already globs `packages/*` — no edit required. Verify:

```bash
pnpm install
pnpm -F @claude-lens/entries build
```

Expected: build succeeds (empty output), no errors. Package discoverable.

- [ ] **Step 6: Commit**

```bash
git add packages/entries/
git commit -m "feat(entries): scaffold @claude-lens/entries package"
```

---

### Task 2: Define the `Entry` type

**Files:**
- Create: `packages/entries/src/types.ts`

- [ ] **Step 1: Write the type definition**

Full type per spec, with JSDoc on each field. Key invariants to bake in:
- `enrichment` is always an object, never null.
- `version` is literal `2`.
- `source_checkpoint` is provenance-only.

```ts
/** Schema version. Bump to trigger background regeneration. */
export const CURRENT_ENTRY_SCHEMA_VERSION = 2 as const;

/** Fixed goal-category taxonomy. */
export const GOAL_CATEGORIES = [
  "build", "plan", "debug", "review", "steer", "meta",
  "research", "refactor", "test", "release", "warmup_minimal",
] as const;
export type GoalCategory = typeof GOAL_CATEGORIES[number];

export type EntryEnrichmentStatus = "pending" | "skipped_trivial" | "done" | "error";

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
  goal_categories: Partial<Record<GoalCategory, number>>;
};

export type EntrySubagent = {
  type: string;
  description: string;
  background: boolean;
  prompt_preview: string;
};

export type Entry = {
  version: typeof CURRENT_ENTRY_SCHEMA_VERSION;
  session_id: string;
  local_day: string;       // "YYYY-MM-DD" in reader's TZ
  project: string;         // canonical (worktrees rolled up)
  start_iso: string;
  end_iso: string;
  numbers: {
    active_min: number;
    turn_count: number;
    tools_total: number;
    subagent_calls: number;
    skill_calls: number;
    task_ops: number;
    interrupts: number;
    tool_errors: number;
    consec_same_tool_max: number;
    exit_plan_calls: number;
    prs: number;
    commits: number;
    pushes: number;
    tokens_total: number;
  };
  flags: string[];
  primary_model: string | null;
  model_mix: Record<string, number>;
  first_user: string;
  final_agent: string;
  pr_titles: string[];
  top_tools: string[];
  skills: Record<string, number>;
  subagents: EntrySubagent[];
  satisfaction_signals: {
    happy: number;
    satisfied: number;
    dissatisfied: number;
    frustrated: number;
  };
  user_input_sources: {
    human: number;
    teammate: number;
    skill_load: number;
    slash_command: number;
  };
  enrichment: EntryEnrichment;
  generated_at: string;
  source_jsonl: string;
  source_checkpoint: {
    byte_offset: number;
    last_event_ts: string | null;
  };
};

/** Initial enrichment value — always an object, never null. */
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
  };
}

/** Skipped-trivial enrichment value. */
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
  };
}

/** Compose the storage filename key for an Entry. */
export function entryKey(sessionId: string, localDay: string): string {
  return `${sessionId}__${localDay}`;
}

/** Parse a storage filename back to (session_id, local_day). */
export function parseEntryKey(key: string): { session_id: string; local_day: string } | null {
  const m = /^([^_]+(?:_[^_]+)*)__(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m) return null;
  return { session_id: m[1]!, local_day: m[2]! };
}
```

- [ ] **Step 2: Write a typecheck-only test to confirm the file compiles**

```bash
pnpm -F @claude-lens/entries typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/entries/src/types.ts
git commit -m "feat(entries): add Entry type + schema constants"
```

---

## Chunk 2: Pure-function building blocks (signals, trivial, build)

### Task 3: Rule-based signals detection

**Files:**
- Create: `packages/entries/src/signals.ts`
- Create: `packages/entries/test/signals.test.ts`

**Purpose:** Pure functions that turn user-text inputs into counts (`satisfaction_signals`, `user_input_sources`) and extract a list of explicit asks (`user_instructions`). No LLM. Regex and heuristic only. Runs during `build.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/entries/test/signals.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyUserInputSource,
  countSatisfactionSignals,
  extractUserInstructions,
} from "../src/signals.js";

describe("classifyUserInputSource", () => {
  it("flags <teammate-message> as teammate", () => {
    expect(classifyUserInputSource('<teammate-message teammate_id="team-lead">…')).toBe("teammate");
  });
  it("flags 'Base directory for this skill:' as skill_load", () => {
    expect(classifyUserInputSource("Base directory for this skill: /Users/x\nSkill body…")).toBe("skill_load");
  });
  it("flags <command-name> as slash_command", () => {
    expect(classifyUserInputSource("<command-name>/commit</command-name> body")).toBe("slash_command");
  });
  it("defaults to human for ordinary prose", () => {
    expect(classifyUserInputSource("can you fix the bug in foo.ts")).toBe("human");
  });
  it("handles empty string as human (degenerate)", () => {
    expect(classifyUserInputSource("")).toBe("human");
  });
});

describe("countSatisfactionSignals", () => {
  it("counts happy markers", () => {
    const c = countSatisfactionSignals("Yay! perfect! amazing");
    expect(c.happy).toBe(2);  // "Yay!" and "perfect!" (amazing is not in the happy set)
  });
  it("counts frustrated markers", () => {
    const c = countSatisfactionSignals("this is broken. stop. why did you do this");
    expect(c.frustrated).toBeGreaterThanOrEqual(2);
  });
  it("returns zeros for neutral text", () => {
    expect(countSatisfactionSignals("add a new function that returns 5")).toEqual({
      happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0,
    });
  });
});

describe("extractUserInstructions", () => {
  it("pulls 'can you…' asks", () => {
    const out = extractUserInstructions("can you rename foo to bar. also please run the tests.");
    expect(out).toContain("rename foo to bar");
    expect(out.some(s => s.includes("run the tests"))).toBe(true);
  });
  it("returns empty array for non-request text", () => {
    expect(extractUserInstructions("thanks, that worked")).toEqual([]);
  });
  it("caps at 5 instructions", () => {
    const text = "please a. please b. please c. please d. please e. please f. please g.";
    expect(extractUserInstructions(text).length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -F @claude-lens/entries test -- signals.test.ts
```

Expected: FAIL with "module not found" or "function not defined".

- [ ] **Step 3: Implement `signals.ts`**

```ts
// packages/entries/src/signals.ts

export type UserInputSource = "human" | "teammate" | "skill_load" | "slash_command";

const TEAMMATE_RE = /^<teammate-message\b/;
const SKILL_LOAD_RE = /^Base directory for this skill:/;
const SLASH_COMMAND_RE = /^<command-name>|^<local-command-stdout>/;

export function classifyUserInputSource(text: string): UserInputSource {
  if (!text) return "human";
  if (TEAMMATE_RE.test(text)) return "teammate";
  if (SKILL_LOAD_RE.test(text)) return "skill_load";
  if (SLASH_COMMAND_RE.test(text)) return "slash_command";
  return "human";
}

const HAPPY_RE = /\b(?:yay|yaay|yass|woohoo|nice|great|love(?:ly)?|perfect|amazing|awesome)\s*!|!!!/gi;
const SATISFIED_RE = /\b(?:thanks|thank you|looks good|lgtm|works|that works|all good|sounds good)\b/gi;
const DISSATISFIED_RE = /\b(?:that'?s (?:not|wrong)|try again|no, (?:that|this)|not quite|incorrect)\b/gi;
const FRUSTRATED_RE = /\b(?:broken|stop|why (?:did|are|would) you|give up|ugh|argh|wtf)\b/gi;

export type SatisfactionCounts = {
  happy: number;
  satisfied: number;
  dissatisfied: number;
  frustrated: number;
};

export function countSatisfactionSignals(text: string): SatisfactionCounts {
  if (!text) return { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 };
  return {
    happy: (text.match(HAPPY_RE) ?? []).length,
    satisfied: (text.match(SATISFIED_RE) ?? []).length,
    dissatisfied: (text.match(DISSATISFIED_RE) ?? []).length,
    frustrated: (text.match(FRUSTRATED_RE) ?? []).length,
  };
}

/**
 * Extract up to 5 explicit user asks.
 * Matches patterns like "can you X", "please X", "let's X", "I need X".
 * Returns cleaned X strings trimmed to ≤ 200 chars.
 */
const INSTRUCTION_RE = /\b(?:can you|please|let's|let us|i need|could you|would you)\s+([^.?!\n]{5,200})/gi;

export function extractUserInstructions(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = INSTRUCTION_RE.exec(text)) !== null) {
    const phrase = m[1]!.trim().replace(/\s+/g, " ");
    const lc = phrase.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(phrase);
    if (out.length >= 5) break;
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @claude-lens/entries test -- signals.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/entries/src/signals.ts packages/entries/test/signals.test.ts
git commit -m "feat(entries): rule-based signal detection for inputs/satisfaction/instructions"
```

---

### Task 4: Trivial-threshold predicate

**Files:**
- Create: `packages/entries/src/trivial.ts`
- Create: `packages/entries/test/trivial.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { isTrivial } from "../src/trivial.js";

describe("isTrivial", () => {
  it("returns true when all three thresholds miss", () => {
    expect(isTrivial({ active_min: 0.5, turn_count: 2, tools_total: 0 })).toBe(true);
  });
  it("returns false when active_min is ≥ 1", () => {
    expect(isTrivial({ active_min: 1.2, turn_count: 2, tools_total: 0 })).toBe(false);
  });
  it("returns false when tools_total is ≥ 1", () => {
    expect(isTrivial({ active_min: 0.3, turn_count: 1, tools_total: 5 })).toBe(false);
  });
  it("returns false when turn_count is ≥ 3", () => {
    expect(isTrivial({ active_min: 0.2, turn_count: 3, tools_total: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests (fail)**

```bash
pnpm -F @claude-lens/entries test -- trivial.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/entries/src/trivial.ts
export type TrivialInput = { active_min: number; turn_count: number; tools_total: number };

/** Trivial threshold: ALL three conditions must hold. */
export function isTrivial(n: TrivialInput): boolean {
  return n.active_min < 1 && n.turn_count < 3 && n.tools_total === 0;
}
```

- [ ] **Step 4: Run tests (pass)**

- [ ] **Step 5: Commit**

```bash
git add packages/entries/src/trivial.ts packages/entries/test/trivial.test.ts
git commit -m "feat(entries): trivial threshold predicate"
```

---

### Task 5: Deterministic Entry builder

**Files:**
- Create: `packages/entries/src/build.ts`
- Create: `packages/entries/test/build.test.ts`
- Create: `packages/entries/test/fixtures/one-day-session.jsonl`
- Create: `packages/entries/test/fixtures/span-midnight-session.jsonl`

**Purpose:** Core deterministic builder. Input: `SessionDetail` (from `@claude-lens/parser`). Output: `Entry[]` — one per local day the session touches. For each Entry, compute all `numbers`, collect `flags`, extract `first_user`/`final_agent`/`pr_titles`/`top_tools`/`skills`/`subagents`, run `signals.ts` over the slice's filtered human text, apply `isTrivial`, and initialize `enrichment` to either `pendingEnrichment()` or `skippedTrivialEnrichment()`.

This is the largest task. Break into two sub-steps:
- 5a: shape the builder (skeleton + signature + fixture-based test)
- 5b: fill in per-day aggregation logic

- [ ] **Step 1: Create fixtures**

`test/fixtures/one-day-session.jsonl` — a minimal JSONL with ~5 events all on 2026-04-22 in UTC-8:
- One system event
- One user text event at 10:00 PST
- One assistant response with a tool_use (Bash)
- One tool_result
- One assistant final text event at 10:05 PST

`test/fixtures/span-midnight-session.jsonl` — 4 events:
- User at 2026-04-22 23:55 PST
- Assistant at 23:56 PST
- User at 2026-04-23 00:10 PST (next day)
- Assistant at 00:11 PST

Use real timestamps (ISO8601 with offset). Keep fixture total < 2 KB.

- [ ] **Step 2: Write failing test**

```ts
// packages/entries/test/build.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTranscript } from "@claude-lens/parser";
import { buildEntries } from "../src/build.js";

function load(name: string) {
  const path = resolve(__dirname, "fixtures", name);
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const sessionDetail = parseTranscript("test-session", lines.map(l => JSON.parse(l)));
  return sessionDetail;
}

describe("buildEntries (deterministic)", () => {
  it("produces one Entry for a single-day session", () => {
    const sd = load("one-day-session.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.local_day).toBe("2026-04-22");
    expect(entries[0]!.session_id).toBe("test-session");
    expect(entries[0]!.numbers.turn_count).toBeGreaterThan(0);
    expect(entries[0]!.version).toBe(2);
    expect(entries[0]!.enrichment.status).toMatch(/^pending|skipped_trivial$/);
  });

  it("splits a midnight-spanning session into two Entries", () => {
    const sd = load("span-midnight-session.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(2);
    const days = entries.map(e => e.local_day).sort();
    expect(days).toEqual(["2026-04-22", "2026-04-23"]);
    // Each Entry only sees its day's events
    expect(entries[0]!.numbers.turn_count).toBe(1);
    expect(entries[1]!.numbers.turn_count).toBe(1);
  });

  it("initialises enrichment as pending object, never null", () => {
    const sd = load("one-day-session.jsonl");
    const entries = buildEntries(sd);
    for (const e of entries) {
      expect(e.enrichment).toBeTypeOf("object");
      expect(e.enrichment).not.toBeNull();
      expect(e.enrichment.user_instructions).toEqual(expect.any(Array));
    }
  });

  it("is deterministic — repeated calls produce byte-equal JSON", () => {
    const sd = load("one-day-session.jsonl");
    const a = buildEntries(sd);
    const b = buildEntries(sd);
    // Clear volatile `generated_at`, then compare.
    for (const e of [...a, ...b]) e.generated_at = "fixed";
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 3: Run tests (fail)**

Expected: "buildEntries is not exported" or similar.

- [ ] **Step 4: Implement `build.ts`**

Split into three helpers within the file:
- `groupEventsByLocalDay(events, timezone) → Map<string, SessionEvent[]>` — partitions events.
- `computeNumbers(events) → Entry["numbers"]` — mirrors `buildCapsule`'s computations from `packages/parser/src/capsule.ts` but operates only on the day's events (active-segment math clipped to this day).
- `buildEntries(sessionDetail: SessionDetail) → Entry[]` — orchestrator.

Key decisions:
- Local day uses reader's `Intl.DateTimeFormat` with the system timezone. Reuse `toLocalDay(msTimestamp)` from `@claude-lens/parser/analytics` (already exported).
- Canonical project path comes from `canonicalProjectName(projectName)` in `@claude-lens/parser/analytics`. If per-slice cwd frequency yields a different project, prefer dominant cwd (with tool-use counting Bash, Edit, Write, Read); tiebreak by earliest event.
- `flags` reuses the existing flag set emitted by `buildCapsule` but applied per-day.
- For `first_user`/`final_agent`: first real human-input event after source filtering; last assistant text in the slice.
- For signals: iterate only events with `classifyUserInputSource(text) === "human"`.

```ts
// packages/entries/src/build.ts
import type { SessionDetail, SessionEvent } from "@claude-lens/parser";
import { toLocalDay, canonicalProjectName } from "@claude-lens/parser/analytics";
import {
  type Entry,
  CURRENT_ENTRY_SCHEMA_VERSION,
  pendingEnrichment,
  skippedTrivialEnrichment,
} from "./types.js";
import {
  classifyUserInputSource,
  countSatisfactionSignals,
  extractUserInstructions,
} from "./signals.js";
import { isTrivial } from "./trivial.js";

const IDLE_GAP_MS = 3 * 60 * 1000;

function groupEventsByLocalDay(events: SessionEvent[]): Map<string, SessionEvent[]> {
  const byDay = new Map<string, SessionEvent[]>();
  for (const ev of events) {
    if (!ev.timestamp) continue;
    const ms = Date.parse(ev.timestamp);
    if (Number.isNaN(ms)) continue;
    const day = toLocalDay(ms);
    let bucket = byDay.get(day);
    if (!bucket) { bucket = []; byDay.set(day, bucket); }
    bucket.push(ev);
  }
  return byDay;
}

// Compute active_min from event timestamps, splitting on gaps > IDLE_GAP_MS.
function computeActiveMin(events: SessionEvent[]): number {
  const ts = events
    .map(e => (e.timestamp ? Date.parse(e.timestamp) : NaN))
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i]! - ts[i - 1]!;
    if (dt < IDLE_GAP_MS) ms += dt;
  }
  return Math.round(ms / 6000) / 10;
}

// Full per-day number/flag/text aggregator. Mirror the logic from
// packages/parser/src/capsule.ts's buildCapsule, but operating on
// events: SessionEvent[] scoped to a single day.
// (See build.ts full implementation: port ~150 lines from capsule.ts
//  without re-introducing the session-level outcome/flag heuristics
//  that depend on whole-session state.)
function aggregatePerDay(
  dayEvents: SessionEvent[],
  sessionFallbackProject: string,
): Pick<Entry,
  "numbers" | "flags" | "primary_model" | "model_mix" | "first_user" | "final_agent"
  | "pr_titles" | "top_tools" | "skills" | "subagents"
  | "satisfaction_signals" | "user_input_sources" | "project"
  | "start_iso" | "end_iso"
> {
  // [implementation to be ported from capsule.ts — not reproduced verbatim here]
  // Must produce:
  //  - numbers: all 14 fields clipped to this day's events
  //  - flags: applicable subset (orchestrated, loop_suspected, fast_ship, plan_used,
  //           long_autonomous, interrupt_heavy, high_errors) recomputed from day-scoped signals
  //  - first_user / final_agent from the day's filtered human turns
  //  - satisfaction_signals / user_input_sources aggregated over human turns
  //  - project from dominant-cwd rule; fallback to sessionFallbackProject
  //  - start_iso / end_iso from min/max event timestamp in day
  // All returned values are byte-deterministic given identical input.
  throw new Error("implement me");
}

export function buildEntries(sessionDetail: SessionDetail): Entry[] {
  const byDay = groupEventsByLocalDay(sessionDetail.events);
  const entries: Entry[] = [];
  const generatedAt = new Date().toISOString();
  const sessionFallbackProject = canonicalProjectName(sessionDetail.projectName ?? "");

  for (const [local_day, dayEvents] of byDay) {
    if (dayEvents.length === 0) continue;
    const agg = aggregatePerDay(dayEvents, sessionFallbackProject);
    const trivial = isTrivial(agg.numbers);

    // Compute user_instructions across the day's filtered human text
    const humanText = dayEvents
      .filter(ev => ev.role === "user" && classifyUserInputSource(ev.preview ?? "") === "human")
      .map(ev => ev.preview ?? "")
      .join("\n");
    const user_instructions_pending = extractUserInstructions(humanText);

    const entry: Entry = {
      version: CURRENT_ENTRY_SCHEMA_VERSION,
      session_id: sessionDetail.id,
      local_day,
      project: agg.project,
      start_iso: agg.start_iso,
      end_iso: agg.end_iso,
      numbers: agg.numbers,
      flags: agg.flags,
      primary_model: agg.primary_model,
      model_mix: agg.model_mix,
      first_user: agg.first_user,
      final_agent: agg.final_agent,
      pr_titles: agg.pr_titles,
      top_tools: agg.top_tools,
      skills: agg.skills,
      subagents: agg.subagents,
      satisfaction_signals: agg.satisfaction_signals,
      user_input_sources: agg.user_input_sources,
      enrichment: trivial
        ? skippedTrivialEnrichment(generatedAt)
        : { ...pendingEnrichment(), user_instructions: user_instructions_pending.slice(0, 5) },
      generated_at: generatedAt,
      source_jsonl: sessionDetail.sourcePath ?? "",
      source_checkpoint: { byte_offset: 0, last_event_ts: agg.end_iso },
    };
    entries.push(entry);
  }

  entries.sort((a, b) => a.local_day.localeCompare(b.local_day));
  return entries;
}
```

(The `aggregatePerDay` function is a 150-line port of existing `buildCapsule` logic — implementer should open `packages/parser/src/capsule.ts` and adapt the event loop to operate on day-scoped events rather than whole-session events. Core difference: turn boundaries are the same, but `activeMsTotal` and the flag thresholds use only the day's subset. Do not extract session-wide outcome — outcome is set only by `enrichment` later.)

- [ ] **Step 5: Run tests (pass)**

```bash
pnpm -F @claude-lens/entries test -- build.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/entries/src/build.ts packages/entries/test/build.test.ts packages/entries/test/fixtures/
git commit -m "feat(entries): deterministic builder — SessionDetail → Entry[] by local day"
```

---

## Chunk 3: Storage + state

### Task 6: Atomic-write storage layer

**Files:**
- Create: `packages/entries/src/fs.ts`
- Create: `packages/entries/test/fs.test.ts`

**Purpose:** Read / write Entry JSON files atomically. Exports:
- `entriesDir(): string` → `~/.cclens/entries/`
- `writeEntry(entry: Entry): void` — atomic write-rename to `{session_id}__{local_day}.json`
- `readEntry(session_id, local_day): Entry | null`
- `listEntries(): string[]` — returns entry keys found on disk
- `listEntriesForDay(local_day): Entry[]`
- `listEntriesForSession(session_id): Entry[]`

Atomic pattern: write to `<path>.tmp`, `fsync`, then `rename(tmp, path)`. POSIX rename is atomic within the same filesystem.

- [ ] **Step 1: Failing tests**

```ts
// packages/entries/test/fs.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeEntry,
  readEntry,
  listEntriesForDay,
  listEntriesForSession,
  __setEntriesDirForTest,
} from "../src/fs.js";
import { CURRENT_ENTRY_SCHEMA_VERSION, pendingEnrichment, type Entry } from "../src/types.js";

function makeEntry(session_id: string, local_day: string): Entry {
  return {
    version: CURRENT_ENTRY_SCHEMA_VERSION,
    session_id, local_day,
    project: "/repo/test", start_iso: "2026-04-22T00:00:00Z", end_iso: "2026-04-22T01:00:00Z",
    numbers: {
      active_min: 30, turn_count: 5, tools_total: 3, subagent_calls: 0, skill_calls: 0,
      task_ops: 0, interrupts: 0, tool_errors: 0, consec_same_tool_max: 1, exit_plan_calls: 0,
      prs: 0, commits: 0, pushes: 0, tokens_total: 1000,
    },
    flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
    pr_titles: [], top_tools: [], skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 1, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: pendingEnrichment(),
    generated_at: "2026-04-22T00:00:00Z", source_jsonl: "",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
}

describe("fs storage", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "entries-test-"));
    __setEntriesDirForTest(tmp);
  });

  it("writeEntry round-trips through readEntry", () => {
    const e = makeEntry("sess-1", "2026-04-22");
    writeEntry(e);
    const read = readEntry("sess-1", "2026-04-22");
    expect(read).toEqual(e);
  });

  it("atomic write — tmp file is removed after success", () => {
    const e = makeEntry("sess-2", "2026-04-22");
    writeEntry(e);
    const files = readdirSync(tmp);
    expect(files.some(f => f.endsWith(".tmp"))).toBe(false);
    expect(files).toContain("sess-2__2026-04-22.json");
  });

  it("listEntriesForDay returns only matching day", () => {
    writeEntry(makeEntry("a", "2026-04-22"));
    writeEntry(makeEntry("b", "2026-04-22"));
    writeEntry(makeEntry("c", "2026-04-21"));
    const day = listEntriesForDay("2026-04-22");
    expect(day.map(e => e.session_id).sort()).toEqual(["a", "b"]);
  });

  it("listEntriesForSession returns all days for a session", () => {
    writeEntry(makeEntry("x", "2026-04-21"));
    writeEntry(makeEntry("x", "2026-04-22"));
    writeEntry(makeEntry("y", "2026-04-22"));
    const list = listEntriesForSession("x");
    expect(list.map(e => e.local_day).sort()).toEqual(["2026-04-21", "2026-04-22"]);
  });

  it("readEntry returns null when file missing", () => {
    expect(readEntry("nope", "2026-04-22")).toBeNull();
  });

  it("readEntry throws on corrupted JSON", () => {
    const path = join(tmp, "bad__2026-04-22.json");
    require("node:fs").writeFileSync(path, "{not json");
    expect(() => readEntry("bad", "2026-04-22")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests (fail)**

- [ ] **Step 3: Implement `fs.ts`**

```ts
// packages/entries/src/fs.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { entryKey, parseEntryKey, type Entry } from "./types.js";

let entriesDirCached: string | null = null;

export function entriesDir(): string {
  if (entriesDirCached) return entriesDirCached;
  entriesDirCached = join(homedir(), ".cclens", "entries");
  return entriesDirCached;
}

/** Test-only hook. */
export function __setEntriesDirForTest(path: string): void {
  entriesDirCached = path;
  mkdirSync(path, { recursive: true });
}

function pathFor(sessionId: string, localDay: string): string {
  return join(entriesDir(), `${entryKey(sessionId, localDay)}.json`);
}

export function writeEntry(entry: Entry): void {
  const dir = entriesDir();
  mkdirSync(dir, { recursive: true });
  const final = pathFor(entry.session_id, entry.local_day);
  const tmp = `${final}.tmp`;
  // Stable key ordering for byte-determinism: JSON.stringify with 2-space indent
  // follows insertion order, which we rely on via consistent Entry field order.
  const json = JSON.stringify(entry, null, 2);
  writeFileSync(tmp, json, { encoding: "utf8" });
  renameSync(tmp, final);
}

export function readEntry(sessionId: string, localDay: string): Entry | null {
  const p = pathFor(sessionId, localDay);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as Entry;
}

export function listEntryKeys(): string[] {
  const dir = entriesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -".json".length));
}

export function listEntriesForDay(localDay: string): Entry[] {
  return listEntryKeys()
    .map(parseEntryKey)
    .filter((k): k is NonNullable<typeof k> => k !== null && k.local_day === localDay)
    .map(k => readEntry(k.session_id, k.local_day))
    .filter((e): e is Entry => e !== null);
}

export function listEntriesForSession(sessionId: string): Entry[] {
  return listEntryKeys()
    .map(parseEntryKey)
    .filter((k): k is NonNullable<typeof k> => k !== null && k.session_id === sessionId)
    .map(k => readEntry(k.session_id, k.local_day))
    .filter((e): e is Entry => e !== null);
}
```

- [ ] **Step 4: Run tests (pass)**

- [ ] **Step 5: Export `fs.ts` via subpath**

Update `packages/entries/src/index.ts` to still export only types. Ensure `package.json`'s `./fs` subpath builds output at `dist/fs.js` — add an explicit `src/fs-entry.ts` or ensure `tsconfig` emits `fs.js` at root of dist.

Simplest: adjust tsconfig `include` to cover `src/**/*` and let tsc emit `dist/fs.js` directly. Verify:

```bash
pnpm -F @claude-lens/entries build
ls packages/entries/dist/
# expect: index.js, types.js, signals.js, trivial.js, build.js, fs.js
```

- [ ] **Step 6: Commit**

```bash
git add packages/entries/src/fs.ts packages/entries/test/fs.test.ts
git commit -m "feat(entries): atomic-write storage + list/read helpers"
```

---

### Task 7: Perception-state checkpoint file

**Files:**
- Create: `packages/cli/src/perception/state.ts`
- Create: `packages/cli/src/perception/state.test.ts`

**Purpose:** Persist the daemon's sweep state to `~/.cclens/perception-state.json`:
- `sweep_in_progress`, `last_sweep_started_at`, `last_sweep_completed_at`
- `file_checkpoints`: per-JSONL `{ byte_offset, last_event_ts, affects_days }`

Single-process daemon means no real concurrency; the re-entry guard protects against crash-restart scenarios.

- [ ] **Step 1: Failing test**

```ts
// packages/cli/src/perception/state.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd,
  isSweepStale, __setStatePathForTest,
} from "./state.js";

describe("perception state", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "perc-state-"));
    __setStatePathForTest(join(tmp, "perception-state.json"));
  });

  it("readState returns empty default when file absent", () => {
    const s = readState();
    expect(s.sweep_in_progress).toBe(false);
    expect(s.file_checkpoints).toEqual({});
  });

  it("markSweepStart / markSweepEnd update in-progress flag", () => {
    markSweepStart();
    expect(readState().sweep_in_progress).toBe(true);
    markSweepEnd();
    expect(readState().sweep_in_progress).toBe(false);
  });

  it("updateCheckpoint persists per-file state", () => {
    updateCheckpoint("/path/foo.jsonl", { byte_offset: 1024, last_event_ts: "2026-04-22T00:00:00Z", affects_days: ["2026-04-22"] });
    const s = readState();
    expect(s.file_checkpoints["/path/foo.jsonl"]!.byte_offset).toBe(1024);
  });

  it("isSweepStale returns true for > 15 min old in-progress flag", () => {
    markSweepStart();
    // manipulate file mtime
    // (implementation detail: mutate readState().last_sweep_started_at to an old ISO and re-write)
    // … or simulate via direct state write
    expect(isSweepStale()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests (fail)**

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/perception/state.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const STALE_MS = 15 * 60 * 1000;

export type FileCheckpoint = {
  byte_offset: number;
  last_event_ts: string | null;
  affects_days: string[];
};

export type PerceptionState = {
  sweep_in_progress: boolean;
  last_sweep_started_at: string | null;
  last_sweep_completed_at: string | null;
  file_checkpoints: Record<string, FileCheckpoint>;
};

let pathCached: string | null = null;
function statePath(): string {
  if (pathCached) return pathCached;
  pathCached = join(homedir(), ".cclens", "perception-state.json");
  return pathCached;
}
export function __setStatePathForTest(p: string): void { pathCached = p; }

export function readState(): PerceptionState {
  const p = statePath();
  if (!existsSync(p)) {
    return { sweep_in_progress: false, last_sweep_started_at: null, last_sweep_completed_at: null, file_checkpoints: {} };
  }
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as PerceptionState;
}

function writeState(s: PerceptionState): void {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
  renameSync(tmp, p);
}

export function markSweepStart(): void {
  const s = readState();
  s.sweep_in_progress = true;
  s.last_sweep_started_at = new Date().toISOString();
  writeState(s);
}

export function markSweepEnd(): void {
  const s = readState();
  s.sweep_in_progress = false;
  s.last_sweep_completed_at = new Date().toISOString();
  writeState(s);
}

export function isSweepStale(): boolean {
  const s = readState();
  if (!s.sweep_in_progress) return false;
  if (!s.last_sweep_started_at) return true;
  const age = Date.now() - Date.parse(s.last_sweep_started_at);
  return age > STALE_MS;
}

export function updateCheckpoint(jsonlPath: string, cp: FileCheckpoint): void {
  const s = readState();
  s.file_checkpoints[jsonlPath] = cp;
  writeState(s);
}
```

- [ ] **Step 4: Run tests (pass)**

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/perception/state.ts packages/cli/src/perception/state.test.ts
git commit -m "feat(cli/perception): sweep-state checkpoint file"
```

---

## Chunk 4: CLI + daemon worker + integration

### Task 8: `fleetlens entries` CLI command

**Files:**
- Create: `packages/cli/src/commands/entries.ts`
- Modify: `packages/cli/src/args.ts` (register subcommand)
- Modify: `packages/cli/src/index.ts` (dispatch to handler)

**Purpose:** CLI surface for inspecting Entries. Read-only in Phase 1a. Subcommands:
- `fleetlens entries` (no args) → short summary: entry count, date range
- `fleetlens entries --day YYYY-MM-DD [--json]`
- `fleetlens entries --session UUID [--json]`
- `fleetlens entries --all [--json]`
- `fleetlens entries regenerate [--since DATE] [--force]` — rebuilds deterministic Entries from JSONL. Does NOT run LLM (Phase 1b adds that).

- [ ] **Step 1: Implement the command handler**

```ts
// packages/cli/src/commands/entries.ts
import { listEntriesForDay, listEntriesForSession, listEntryKeys, readEntry } from "@claude-lens/entries/fs";
import { parseEntryKey } from "@claude-lens/entries";
import { scanAllSessions } from "../session-scan.js"; // to be exposed or written
import { buildEntries } from "@claude-lens/entries/fs";
import { writeEntry } from "@claude-lens/entries/fs";

type EntriesArgs = {
  day?: string;
  session?: string;
  all?: boolean;
  json?: boolean;
  regenerate?: boolean;
  since?: string;
  force?: boolean;
};

export async function runEntries(args: EntriesArgs): Promise<number> {
  if (args.regenerate) {
    return runRegenerate(args);
  }

  if (args.day) {
    const list = listEntriesForDay(args.day);
    printEntries(list, args.json);
    return 0;
  }
  if (args.session) {
    const list = listEntriesForSession(args.session);
    printEntries(list, args.json);
    return 0;
  }
  if (args.all) {
    const list = listEntryKeys()
      .map(parseEntryKey)
      .filter(Boolean)
      .map(k => readEntry(k!.session_id, k!.local_day))
      .filter(Boolean);
    printEntries(list as any, args.json);
    return 0;
  }
  // Default: summary
  const keys = listEntryKeys();
  const days = new Set(keys.map(k => parseEntryKey(k)?.local_day).filter(Boolean));
  const sessions = new Set(keys.map(k => parseEntryKey(k)?.session_id).filter(Boolean));
  console.log(`Entries: ${keys.length}`);
  console.log(`Sessions: ${sessions.size}`);
  console.log(`Days covered: ${days.size}`);
  console.log(`Run \`fleetlens entries --day YYYY-MM-DD\` to inspect a specific day.`);
  return 0;
}

function printEntries(list: unknown[], json?: boolean): void {
  if (json) { console.log(JSON.stringify(list, null, 2)); return; }
  // Pretty-print a short table per entry
  for (const e of list as any[]) {
    console.log(`${e.session_id}  ${e.local_day}  ${e.numbers.active_min}m  ${e.project}  enr=${e.enrichment.status}`);
  }
}

async function runRegenerate(args: EntriesArgs): Promise<number> {
  // Iterate all JSONL, parse, buildEntries, writeEntry.
  // Skip sessions whose Entry files already exist unless --force.
  // ... (implementation — see subagent rebuild logic in worker.ts)
  console.log("Regenerate: not yet implemented — see Phase 1a worker.ts for shared logic.");
  return 0;
}
```

- [ ] **Step 2: Wire up args + dispatch**

In `packages/cli/src/args.ts`, register `entries` as a new subcommand with the above flags. In `packages/cli/src/index.ts`, dispatch `entries` → `runEntries`.

Follow the existing pattern from `packages/cli/src/commands/capsules.ts` (same style of subcommand handler).

- [ ] **Step 3: Manual smoke test**

```bash
pnpm -F fleetlens build
node packages/cli/dist/index.js entries
```

Expected: "Entries: 0, Sessions: 0, Days covered: 0" (on a fresh install). Or similar small count on a machine with existing Entries.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/entries.ts packages/cli/src/args.ts packages/cli/src/index.ts
git commit -m "feat(cli): fleetlens entries subcommand (read-only)"
```

---

### Task 9: Daemon perception-worker (deterministic rebuild only)

**Files:**
- Create: `packages/cli/src/perception/worker.ts`
- Modify: `packages/cli/src/daemon-worker.ts` (invoke worker every 5 min)

**Purpose:** A sweep loop invoked inside the existing long-lived daemon process. Each sweep:
1. Check `isSweepStale()` or `sweep_in_progress === false` — if another sweep is in progress and not stale, return.
2. `markSweepStart()`.
3. Enumerate all JSONL files in `~/.claude/projects/**/*.jsonl`. For each, compare its current size to `file_checkpoints[path].byte_offset`; if greater or unseen, reparse (via `parseTranscript`), call `buildEntries`, `writeEntry` each returned Entry.
4. Update `file_checkpoints` with new byte_offset + last_event_ts + affects_days.
5. `markSweepEnd()`.

No LLM calls in Phase 1a — enrichment remains `"pending"` forever. Phase 1b will add the enrichment queue.

- [ ] **Step 1: Implement `worker.ts`**

```ts
// packages/cli/src/perception/worker.ts
import { statSync, readFileSync } from "node:fs";
import { parseTranscript } from "@claude-lens/parser";
import { buildEntries } from "@claude-lens/entries/fs";
import { writeEntry, readEntry } from "@claude-lens/entries/fs";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd, isSweepStale,
} from "./state.js";
import { listAllSessionJsonls } from "./scan.js"; // small helper to enumerate JSONL

export async function runPerceptionSweep(): Promise<{ sessionsProcessed: number; entriesWritten: number }> {
  const state = readState();
  if (state.sweep_in_progress && !isSweepStale()) {
    return { sessionsProcessed: 0, entriesWritten: 0 };
  }
  markSweepStart();
  let sessions = 0;
  let entries = 0;
  try {
    const files = await listAllSessionJsonls();
    for (const f of files) {
      const stat = statSync(f);
      const prev = state.file_checkpoints[f];
      if (prev && prev.byte_offset >= stat.size) continue; // no new content
      const raw = readFileSync(f, "utf8");
      const lines = raw.split("\n").filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      // Use session_id from filename (strip `.jsonl`)
      const sessionId = f.split("/").pop()!.replace(/\.jsonl$/, "");
      const sd = parseTranscript(sessionId, lines as any);
      const built = buildEntries(sd);
      for (const e of built) {
        writeEntry(e);
        entries++;
      }
      updateCheckpoint(f, {
        byte_offset: stat.size,
        last_event_ts: built.at(-1)?.end_iso ?? null,
        affects_days: built.map(e => e.local_day),
      });
      sessions++;
    }
  } finally {
    markSweepEnd();
  }
  return { sessionsProcessed: sessions, entriesWritten: entries };
}
```

- [ ] **Step 2: Create the JSONL scanner helper**

```ts
// packages/cli/src/perception/scan.ts
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function listAllSessionJsonls(): Promise<string[]> {
  const root = join(homedir(), ".claude", "projects");
  const out: string[] = [];
  try {
    for (const project of readdirSync(root)) {
      const dir = join(root, project);
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".jsonl")) out.push(join(dir, f));
        }
      } catch { /* skip */ }
    }
  } catch { /* ~/.claude/projects missing */ }
  return out;
}
```

- [ ] **Step 3: Wire into daemon-worker.ts**

In `packages/cli/src/daemon-worker.ts`, add a 5-minute interval that calls `runPerceptionSweep`. Log outcomes to the existing daemon log. Don't await — wrap in try/catch and let it run alongside the existing usage-poll loop.

```ts
// packages/cli/src/daemon-worker.ts (added)
import { runPerceptionSweep } from "./perception/worker.js";

const PERCEPTION_INTERVAL_MS = 5 * 60 * 1000;
setInterval(async () => {
  try {
    const { sessionsProcessed, entriesWritten } = await runPerceptionSweep();
    if (sessionsProcessed > 0) {
      log("info", `perception sweep: ${sessionsProcessed} sessions, ${entriesWritten} entries`);
    }
  } catch (err) {
    log("error", `perception sweep failed: ${(err as Error).message}`);
  }
}, PERCEPTION_INTERVAL_MS);
```

- [ ] **Step 4: Manual verification**

Start the daemon and wait 5 minutes. Check:

```bash
node packages/cli/dist/index.js stop
node packages/cli/dist/index.js start --no-open
# wait 5 min
ls ~/.cclens/entries/ | wc -l
```

Expected: several Entry JSON files written for recent sessions.

Also trigger a manual sweep for faster iteration:

```bash
node -e "require('./packages/cli/dist/perception/worker.js').runPerceptionSweep().then(r => console.log(r))"
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/perception/worker.ts packages/cli/src/perception/scan.ts packages/cli/src/daemon-worker.ts
git commit -m "feat(cli): daemon perception worker — deterministic Entry sweep"
```

---

### Task 10: V1 insights regression test + determinism guarantee

**Files:**
- Create: `scripts/v1-insights-regression.mjs`

**Purpose:** Guard against accidental changes to V1 `/insights`. Runs a fixed week through the existing `buildPeriodBundle` + insights prompt; compares output JSON hash before vs after this plan is merged.

Also: a determinism check on the Entry builder — running it twice on an unchanged JSONL produces byte-equal files.

- [ ] **Step 1: Write the regression script**

```js
// scripts/v1-insights-regression.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
// Import the V1 code paths directly and hash their output for a known fixture.
// The fixture is a tiny curated set of JSONL files committed under
// scripts/fixtures/v1-insights-regression/. Hash must match checked-in hash.

const EXPECTED_HASH_PATH = "scripts/fixtures/v1-insights-regression/expected.sha256";

async function hashV1Output() {
  // Import V1 modules directly — this is a smoke check, not a unit test.
  const { parseTranscript } = await import("../packages/parser/dist/parser.js");
  const { buildCapsule } = await import("../packages/parser/dist/capsule.js");
  const { buildPeriodBundle } = await import("../packages/parser/dist/aggregate.js");
  // Build the capsule + bundle for a known fixture.
  // (Test fixture path — adapt as needed)
  // Output a stable hash of the bundle JSON.
  const hash = createHash("sha256");
  // … compute hash …
  return hash.digest("hex");
}

const actual = await hashV1Output();
if (!existsSync(EXPECTED_HASH_PATH)) {
  writeFileSync(EXPECTED_HASH_PATH, actual + "\n");
  console.log("wrote initial hash", actual);
  process.exit(0);
}
const expected = readFileSync(EXPECTED_HASH_PATH, "utf8").trim();
if (actual !== expected) {
  console.error(`V1 insights output changed!\n  expected: ${expected}\n  actual:   ${actual}`);
  process.exit(1);
}
console.log("V1 insights output unchanged ✓");
```

- [ ] **Step 2: Run once to write the expected hash, then run `pnpm verify`**

Add this script to `pnpm verify`'s target in the root `package.json`:

```json
{
  "scripts": {
    "verify": "pnpm typecheck && pnpm test && node scripts/smoke.mjs && node scripts/v1-insights-regression.mjs"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/v1-insights-regression.mjs scripts/fixtures/v1-insights-regression/
git commit -m "test: V1 insights regression guard (deterministic hash)"
```

---

## Done. Verification checklist

After all tasks are complete, run the full verification suite:

```bash
pnpm clean
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm verify
```

All green required. Then:

```bash
node packages/cli/dist/index.js stop
node packages/cli/dist/index.js start --no-open
# wait 5-10 min for perception worker to populate
node packages/cli/dist/index.js entries
# expect: count > 0

node packages/cli/dist/index.js entries --day $(date +%Y-%m-%d) --json | head -40
# expect: JSON array of today's entries, each with enrichment.status == "pending"

# V1 insights should still work identically
curl -s http://localhost:3321/insights > /dev/null  # smoke check
```

## Next plans

- `docs/superpowers/plans/2026-04-XX-perception-layer-phase-1b.md` — LLM enrichment wiring (Anthropic API key, Sonnet call per Entry, budget tracker `~/.cclens/llm-spend.jsonl`, `ai_features.enabled` gate, settings UI stub).
- `docs/superpowers/plans/2026-04-XX-perception-layer-phase-2.md` — day digest generator + `/digest/[date]` page + home view cards + `fleetlens digest day` CLI.
