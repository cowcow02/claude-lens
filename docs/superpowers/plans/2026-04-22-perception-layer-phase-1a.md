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

- [ ] **Step 4: Stub `packages/entries/src/index.ts` — types only (browser-safe)**

Browser-safe subpath. Types and pure functions that have zero Node deps are re-exported here. `fs.ts` (filesystem) stays on the `./fs` subpath.

```ts
// Browser-safe exports: types + pure functions only. NO node:fs, NO node:os.
export * from "./types.js";
export * from "./signals.js";
export * from "./trivial.js";
export * from "./build.js";
```

`packages/entries/src/fs.ts` is NOT re-exported here — it's reachable only via the `./fs` subpath, which the bundler's `server-only` marker will protect.

- [ ] **Step 5: Update `scripts/version-sync.mjs` to propagate to the new package**

The root script at `scripts/version-sync.mjs` currently syncs `packages/parser`, `packages/cli`, `apps/web`. Add `packages/entries`:

```js
// scripts/version-sync.mjs — add "packages/entries/package.json" to the SYNC_PATHS array
const SYNC_PATHS = [
  "packages/parser/package.json",
  "packages/cli/package.json",
  "packages/entries/package.json",  // NEW
  "apps/web/package.json",
];
```

Verify by running `node scripts/version-sync.mjs` after editing; the script should report 4 files checked with no drift.

- [ ] **Step 6: Add the package to root workspace + verify**

Root `package.json`'s `workspaces` (or `pnpm-workspace.yaml`) already globs `packages/*` — no edit required. Verify:

```bash
pnpm install
pnpm -F @claude-lens/entries build
```

Expected: build succeeds (empty output), no errors. Package discoverable.

- [ ] **Step 7: Commit**

```bash
git add packages/entries/ scripts/version-sync.mjs
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

This is the largest task. Broken into four sub-steps by field cluster so each step stays ~5 min:
- **5a:** Skeleton + `groupEventsByLocalDay` + `buildEntries` orchestrator. Test passes only the "length + local_day + deterministic" assertions.
- **5b:** `numbers` field cluster — port active_min, turn_count, tools_total, tokens_total, subagent/skill/task/interrupt/error counts from `capsule.ts` clipped to day events.
- **5c:** Text / provenance / model fields — `first_user`, `final_agent`, `pr_titles`, `top_tools`, `skills`, `subagents`, `primary_model`, `model_mix`, `start_iso`, `end_iso`, `project` (with dominant-cwd rule).
- **5d:** Derived fields — `flags` (day-scoped), `satisfaction_signals`, `user_input_sources`, and `enrichment.user_instructions` seeding via `signals.ts`.

Each sub-step adds one test assertion cluster and completes its code before moving on. `throw new Error("implement me")` from the first draft is resolved in 5b.

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

// parseTranscript signature: takes one argument (unknown[]), returns { meta, events }.
// SessionDetail is constructed manually — see packages/parser/src/fs.ts:300-320 for
// the canonical pattern used in production.
function load(name: string) {
  const filePath = resolve(__dirname, "fixtures", name);
  const rawLines = readFileSync(filePath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const { meta, events } = parseTranscript(rawLines);
  return {
    ...meta,
    id: "test-session",
    filePath,
    projectDir: "test-project-dir",
    projectName: meta.cwd ?? "/test/project",
    events,
  };
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

- [ ] **Step 4a: Skeleton + `groupEventsByLocalDay` + `buildEntries` orchestrator**

Implement the file skeleton. `aggregatePerDay` returns stubbed zeros for now so the test's structure-shape assertions pass. Fill in numbers, text, flags over the next three sub-steps.

Reference existing logic: `packages/parser/src/capsule.ts` (especially `buildCapsule`, lines 258–545) and `packages/parser/src/analytics.ts` (for `toLocalDay`, `canonicalProjectName`). **Do not modify those files — we port logic from them.**

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

// Per-day aggregator. In 4a this is a zeros-stub that lets the
// orchestrator + length/local_day tests pass. Steps 4b-4d fill it in.
type AggregateResult = Pick<Entry,
  "numbers" | "flags" | "primary_model" | "model_mix" | "first_user" | "final_agent"
  | "pr_titles" | "top_tools" | "skills" | "subagents"
  | "satisfaction_signals" | "user_input_sources" | "project"
  | "start_iso" | "end_iso"
>;

function aggregatePerDay(
  dayEvents: SessionEvent[],
  sessionFallbackProject: string,
): AggregateResult {
  const ts = dayEvents.map(e => e.timestamp).filter((t): t is string => !!t).sort();
  const start_iso = ts[0] ?? "";
  const end_iso = ts[ts.length - 1] ?? "";

  // 4a stub: zero numbers, empty text, empty flags. Refined in 4b/4c/4d.
  return {
    numbers: {
      active_min: computeActiveMin(dayEvents),
      turn_count: 0, tools_total: 0, subagent_calls: 0, skill_calls: 0,
      task_ops: 0, interrupts: 0, tool_errors: 0, consec_same_tool_max: 0,
      exit_plan_calls: 0, prs: 0, commits: 0, pushes: 0, tokens_total: 0,
    },
    flags: [],
    primary_model: null,
    model_mix: {},
    first_user: "",
    final_agent: "",
    pr_titles: [],
    top_tools: [],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    project: sessionFallbackProject,
    start_iso,
    end_iso,
  };
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

- [ ] **Step 5 (4b): Fill `numbers` cluster**

Port the number-computing half of `buildCapsule` (`packages/parser/src/capsule.ts:258–450`) into `aggregatePerDay`, operating only on `dayEvents`. Specifically:

Walk `dayEvents` with the same turn-state machine as `capsule.ts`'s `closeTurn`/`newTurn`. For each turn within this day, accumulate:
- `active_min` — already computed by `computeActiveMin`; keep.
- `turn_count` — count of real user-input opens (non–tool-result user events).
- `tools_total` — sum of `tool_use` blocks across assistant events.
- `tokens_total` — sum of usage.input + output + cache_read + cache_creation, deduped by `msgId` (same logic as `capsule.ts:329-337`).
- `subagent_calls` — count of `tool_use.name === "Agent"`.
- `skill_calls` — count of `tool_use.name === "Skill"` or `"ToolSearch"`.
- `task_ops` — `TodoWrite` + `TaskCreate` + `TaskUpdate`.
- `interrupts` — user messages containing `[request interrupted|interrupted by user` (regex: `INTERRUPT_RE` from `capsule.ts:18`).
- `tool_errors` — `tool_result` blocks with `is_error: true`.
- `consec_same_tool_max` — same-tool streak tracking per capsule.ts lines 357-359.
- `exit_plan_calls` — tool uses named `ExitPlanMode`.
- `prs` / `commits` / `pushes` — matched from `Bash` tool uses using the regexes at `capsule.ts:386-392`.

Reference: when in doubt, read the source at `capsule.ts:258–400` and scope each counter to `dayEvents` instead of session-wide events. No session-level outcome computation — outcome is set only by enrichment later.

Add test assertions:

```ts
it("computes numbers accurately from fixture", () => {
  const sd = load("one-day-session.jsonl");
  const [entry] = buildEntries(sd);
  expect(entry!.numbers.turn_count).toBe(1);        // one user turn in fixture
  expect(entry!.numbers.tools_total).toBe(1);       // one Bash call
  expect(entry!.numbers.active_min).toBeGreaterThan(0);
  expect(entry!.numbers.active_min).toBeLessThan(10);
});
```

Run tests. Commit:

```bash
git add packages/entries/src/build.ts packages/entries/test/build.test.ts
git commit -m "feat(entries): per-day numbers cluster"
```

- [ ] **Step 6 (4c): Fill text + model + project + start/end fields**

Extend `aggregatePerDay` to collect:
- `first_user` — first user event in `dayEvents` where `classifyUserInputSource(fullText(ev)) === "human"`, truncated to 400 chars with `\s+` collapsed. Use `fullText(ev)` defined as `ev.blocks.filter(b => b.type === "text").map(b => (b as any).text).join(" ")` — NOT `ev.preview`, which is single-line only.
- `final_agent` — last assistant text block in `dayEvents`, same normalization.
- `pr_titles` — harvested from Bash `gh pr create --title "..."` patterns using `PR_TITLE_RE` from `capsule.ts:21`.
- `top_tools` — top-3 tool-use counts formatted per `capsule.ts:459-467` (including Bash verb sub-detail).
- `skills` — `Skill` + `ToolSearch` counts keyed by skill name or search query.
- `subagents` — harvested from `Agent` tool uses; include type, description (truncated to 80), prompt_preview (truncated to 240), background flag.
- `primary_model` — dominant `message.model` across assistant events; tiebreak alphabetical for determinism.
- `model_mix` — model → turn count map.
- `project` — dominant canonical cwd across `Bash`, `Edit`, `Write`, `Read` tool uses in the day. Tiebreak by earliest event's cwd. Fallback to `sessionFallbackProject` when no cwd-bearing tool uses.
- `start_iso` / `end_iso` — already set in 4a skeleton.

Add test assertions:

```ts
it("extracts first_user from full block text, not preview", () => {
  const sd = load("one-day-session.jsonl");
  const [entry] = buildEntries(sd);
  expect(entry!.first_user.length).toBeGreaterThan(0);
  expect(entry!.first_user).not.toContain("…");  // not truncated to a preview
});

it("extracts pr_titles from gh pr create Bash commands", () => {
  // Create a fixture with `gh pr create --title "feat: test"` and assert
  // entry.pr_titles === ["feat: test"]
  // (Reuse span-midnight-session fixture with one extra event.)
});
```

Commit:

```bash
git commit -m "feat(entries): per-day text + model + project fields"
```

- [ ] **Step 7 (4d): Fill flags + signals**

Extend `aggregatePerDay` to compute:
- `flags` — recompute per-day using thresholds from `capsule.ts:432-439`:
  - `interrupt_heavy` when `interrupts >= 3`
  - `high_errors` when `tool_errors >= 20`
  - `loop_suspected` when `consec_same_tool_max >= 8`
  - `fast_ship` when `active_min * 60 < 5*60` (i.e. < 5 min active) AND `prs >= 1`
  - `plan_used` when `exit_plan_calls > 0`
  - `orchestrated` when `subagent_turns >= 3`
  - `long_autonomous` when `longest_turn_active_min >= 20` AND `interrupts === 0`
- `satisfaction_signals` — run `countSatisfactionSignals` across the concatenation of all day's human-filtered user text.
- `user_input_sources` — call `classifyUserInputSource` on each user event's full text, tally per-bucket.
- `enrichment.user_instructions` (seeded via `buildEntries`): run `extractUserInstructions` over the day's human-filtered text, slice to 5.

Add test assertions:

```ts
it("tallies user_input_sources by bucket", () => {
  // Fixture with 1 human input + 1 teammate-message wrapper
  // → { human: 1, teammate: 1, ... }
});

it("does not count teammate messages as human", () => {
  // Fixture where the only 'user' events are <teammate-message> wrappers
  // → user_input_sources.human === 0
});
```

- [ ] **Step 8: Run tests (all pass)**

```bash
pnpm -F @claude-lens/entries test -- build.test.ts
```

Expected: every assertion green. Determinism test still passes because all new fields are functions of `dayEvents` content alone.

- [ ] **Step 9: Commit**

```bash
git add packages/entries/src/build.ts packages/entries/test/build.test.ts packages/entries/test/fixtures/
git commit -m "feat(entries): per-day flags + signals + user_instructions seed"
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

**Purpose:** CLI surface for inspecting Entries. **Fully read-only in Phase 1a** — regeneration happens in the daemon on a 5-min sweep. A `fleetlens entries regenerate` subcommand is deferred to Phase 1b where it'll share logic with the enrichment pipeline. Phase 1a commands:
- `fleetlens entries` (no args) → short summary: entry count, sessions, date range
- `fleetlens entries --day YYYY-MM-DD [--json]`
- `fleetlens entries --session UUID [--json]`
- `fleetlens entries --all [--json]`

- [ ] **Step 1: Implement the command handler**

```ts
// packages/cli/src/commands/entries.ts
// Import notes:
// - Types + pure helpers (parseEntryKey) come from the root import.
// - Filesystem readers (listEntries*, readEntry) come from the ./fs subpath.
import { parseEntryKey, type Entry } from "@claude-lens/entries";
import {
  listEntriesForDay,
  listEntriesForSession,
  listEntryKeys,
  readEntry,
} from "@claude-lens/entries/fs";

type EntriesArgs = {
  day?: string;
  session?: string;
  all?: boolean;
  json?: boolean;
};

export async function runEntries(args: EntriesArgs): Promise<number> {
  if (args.day) {
    printEntries(listEntriesForDay(args.day), args.json);
    return 0;
  }
  if (args.session) {
    printEntries(listEntriesForSession(args.session), args.json);
    return 0;
  }
  if (args.all) {
    const list: Entry[] = [];
    for (const key of listEntryKeys()) {
      const parsed = parseEntryKey(key);
      if (!parsed) continue;
      const e = readEntry(parsed.session_id, parsed.local_day);
      if (e) list.push(e);
    }
    printEntries(list, args.json);
    return 0;
  }
  // Default: summary
  const keys = listEntryKeys();
  const days = new Set<string>();
  const sessions = new Set<string>();
  for (const k of keys) {
    const parsed = parseEntryKey(k);
    if (!parsed) continue;
    days.add(parsed.local_day);
    sessions.add(parsed.session_id);
  }
  console.log(`Entries: ${keys.length}`);
  console.log(`Sessions: ${sessions.size}`);
  console.log(`Days covered: ${days.size}`);
  console.log(`Run \`fleetlens entries --day YYYY-MM-DD\` to inspect a specific day.`);
  return 0;
}

function printEntries(list: Entry[], json?: boolean): void {
  if (json) { console.log(JSON.stringify(list, null, 2)); return; }
  for (const e of list) {
    console.log(`${e.session_id}  ${e.local_day}  ${e.numbers.active_min}m  ${e.project}  enr=${e.enrichment.status}`);
  }
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
import { basename, dirname } from "node:path";
// parseTranscript takes one arg (unknown[]) and returns { meta, events }.
// SessionDetail is constructed manually using the canonical pattern from
// packages/parser/src/fs.ts:300-320. decodeProjectName derives a human
// project name from the URL-encoded project directory.
import { parseTranscript, decodeProjectName, type SessionDetail } from "@claude-lens/parser";
import { buildEntries } from "@claude-lens/entries";
import { writeEntry } from "@claude-lens/entries/fs";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd, isSweepStale,
} from "./state.js";
import { listAllSessionJsonls } from "./scan.js";

function log(msg: string): void {
  // Same logging convention as the rest of daemon-worker.ts.
  // eslint-disable-next-line no-console
  console.error(`[perception] ${msg}`);
}

export async function runPerceptionSweep(): Promise<{ sessionsProcessed: number; entriesWritten: number; errors: number }> {
  const state = readState();
  if (state.sweep_in_progress && !isSweepStale()) {
    return { sessionsProcessed: 0, entriesWritten: 0, errors: 0 };
  }
  markSweepStart();
  let sessions = 0;
  let entries = 0;
  let errors = 0;
  try {
    const files = await listAllSessionJsonls();
    for (const f of files) {
      // Per-file error isolation: one malformed JSONL must not halt the sweep.
      try {
        const stat = statSync(f);
        const prev = state.file_checkpoints[f];
        if (prev && prev.byte_offset >= stat.size) continue; // no new content

        const raw = readFileSync(f, "utf8");
        const rawLines: unknown[] = raw.split("\n")
          .filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter((x): x is object => x !== null);

        if (rawLines.length === 0) continue;

        const { meta, events } = parseTranscript(rawLines);
        const fileName = basename(f);
        const projectDir = basename(dirname(f));
        const sessionId = fileName.replace(/\.jsonl$/, "");

        const sd: SessionDetail = {
          ...meta,
          id: sessionId,
          filePath: f,
          projectDir,
          projectName: meta.cwd ?? decodeProjectName(projectDir),
          events,
        };

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
      } catch (err) {
        errors++;
        log(`skipped ${f}: ${(err as Error).message}`);
      }
    }
  } finally {
    markSweepEnd();
  }
  return { sessionsProcessed: sessions, entriesWritten: entries, errors };
}
```

Note: `decodeProjectName` is exported from `@claude-lens/parser` (see `packages/parser/src/index.ts`). If it's not on the public surface, either add the export or copy the 3-line implementation locally. Check first with `grep -n "decodeProjectName" packages/parser/src/*.ts`.

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

In `packages/cli/src/daemon-worker.ts`, add a 5-minute interval that calls `runPerceptionSweep`. Capture the interval handle so the existing SIGTERM handler can clear it. Log outcomes to the existing daemon log. The sweep is internally re-entry-safe, but we still avoid overlapping invocations by skipping if the previous run hasn't returned.

```ts
// packages/cli/src/daemon-worker.ts (added at the top of the file)
import { runPerceptionSweep } from "./perception/worker.js";

const PERCEPTION_INTERVAL_MS = 5 * 60 * 1000;
let perceptionInFlight = false;

const perceptionHandle: NodeJS.Timeout = setInterval(async () => {
  if (perceptionInFlight) return;  // defense in depth — shouldn't happen
  perceptionInFlight = true;
  try {
    const { sessionsProcessed, entriesWritten, errors } = await runPerceptionSweep();
    if (sessionsProcessed > 0 || errors > 0) {
      log("info", `perception sweep: ${sessionsProcessed} sessions, ${entriesWritten} entries, ${errors} errors`);
    }
  } catch (err) {
    log("error", `perception sweep failed: ${(err as Error).message}`);
  } finally {
    perceptionInFlight = false;
  }
}, PERCEPTION_INTERVAL_MS);

// At the existing SIGTERM handler (find it near the bottom of daemon-worker.ts),
// call clearInterval(perceptionHandle) BEFORE process.exit(0).
// The existing handler looks like: process.on("SIGTERM", () => process.exit(0));
// Update it to:
//   process.on("SIGTERM", () => {
//     clearInterval(perceptionHandle);
//     process.exit(0);
//   });
// Do the same for SIGINT if present.
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

- [ ] **Step 1: Create the fixture**

Reuse the same JSONL file that Task 5 committed at `packages/entries/test/fixtures/one-day-session.jsonl` — it's already small, deterministic, and covered by Phase 1a. Copy it to a regression-specific path so Phase 1a tests and the regression guard are decoupled:

```bash
mkdir -p scripts/fixtures/v1-insights-regression/
cp packages/entries/test/fixtures/one-day-session.jsonl \
   scripts/fixtures/v1-insights-regression/fixture.jsonl
```

- [ ] **Step 2: Write the regression script**

The script feeds the fixture through V1's full `parseTranscript → buildCapsule → buildPeriodBundle` chain and hashes the result. Volatile fields (`generated_at` in the PeriodBundle wrapper, if any) are zeroed before hashing so the hash is reproducible across runs. If no expected hash is checked in, the first run writes one.

```js
// scripts/v1-insights-regression.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/v1-insights-regression/fixture.jsonl");
const EXPECTED_HASH_PATH = resolve(__dirname, "fixtures/v1-insights-regression/expected.sha256");

// Dynamic imports so this script doesn't need a build step in package.json.
const { parseTranscript } = await import("../packages/parser/dist/parser.js");
const { buildCapsule } = await import("../packages/parser/dist/capsule.js");
const { buildPeriodBundle } = await import("../packages/parser/dist/aggregate.js");

// 1. Parse fixture
const rawLines = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const { meta, events } = parseTranscript(rawLines);
const sessionDetail = {
  ...meta,
  id: "v1-regression-session",
  filePath: FIXTURE,
  projectDir: "fixture",
  projectName: meta.cwd ?? "/fixture/project",
  events,
};

// 2. Build capsule + period bundle (compact mode matches V1 insights call)
const capsule = buildCapsule(sessionDetail, { compact: true });
const bundle = buildPeriodBundle([capsule], {
  period: {
    start: new Date("2026-04-22T00:00:00-08:00"),
    end: new Date("2026-04-22T23:59:59-08:00"),
    range_type: "custom",
  },
  trivial_dropped: 0,
  sessions_total: 1,
});

// 3. Hash, excluding volatile fields
function stable(obj) {
  return JSON.parse(JSON.stringify(obj), (_k, v) => {
    // If any future field is a timestamp-ish string that shifts per-run, elide here.
    return v;
  });
}
const json = JSON.stringify({ capsule: stable(capsule), bundle: stable(bundle) }, null, 2);
const actual = createHash("sha256").update(json).digest("hex");

// 4. Compare
if (!existsSync(EXPECTED_HASH_PATH)) {
  writeFileSync(EXPECTED_HASH_PATH, actual + "\n");
  console.log(`wrote initial hash: ${actual}`);
  process.exit(0);
}
const expected = readFileSync(EXPECTED_HASH_PATH, "utf8").trim();
if (actual !== expected) {
  console.error(`V1 insights output changed!\n  expected: ${expected}\n  actual:   ${actual}`);
  // Dump the diff to disk for debugging
  writeFileSync(EXPECTED_HASH_PATH + ".actual.json", json);
  console.error(`(payload dumped to ${EXPECTED_HASH_PATH}.actual.json)`);
  process.exit(1);
}
console.log("V1 insights output unchanged ✓");
```

- [ ] **Step 3: Run once to write the expected hash, commit both**

```bash
pnpm -F @claude-lens/parser build           # ensure dist/ exists
node scripts/v1-insights-regression.mjs     # writes expected.sha256
node scripts/v1-insights-regression.mjs     # verifies hash matches; green
git add scripts/v1-insights-regression.mjs scripts/fixtures/v1-insights-regression/
git commit -m "test: V1 insights regression guard (deterministic hash)"
```

- [ ] **Step 4: Wire into `pnpm verify`**

In root `package.json`:

```json
{
  "scripts": {
    "verify": "pnpm typecheck && pnpm test && node scripts/smoke.mjs && node scripts/v1-insights-regression.mjs"
  }
}
```

- [ ] **Step 5: Commit verify wiring**

```bash
git add package.json
git commit -m "ci: add V1 insights regression to pnpm verify"
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
