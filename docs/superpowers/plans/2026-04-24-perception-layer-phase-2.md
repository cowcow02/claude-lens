# Fleetlens Perception Layer — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 2 perception layer — day digest generator, `/digest/[date]` page with fused enrichment+synth SSE pipeline, home-page Yesterday hero + Recent days panel, `fleetlens digest day` CLI — plus the settings flip to default-on (drop per-project allow-list) and the Phase 1b follow-ups bundle.

**Architecture:** Day digests layer on top of Phase 1b Entries. `buildDeterministicDigest` (pure) computes aggregations from a day's Entries; `generateDayDigest` (Node-only, subprocess) layers LLM narrative on top. A shared `runDayDigestPipeline` async generator drives both the CLI and the `/api/digest/day/[date]` SSE route — identical behavior, one source of truth. A top-of-sweep `llm-interactive.lock` check in the daemon's `runEnrichmentQueue` prevents daemon-vs-foreground double-enrichment. Default settings flip: `ai_features.enabled = true` + `allowed_projects` removed entirely; settings UI collapses to master toggle + model + budget.

**Tech Stack:**
- Existing: vitest, TypeScript 5.5, pnpm workspace, Next.js 16 App Router, esbuild CLI bundle, `server-only` guard, Zod validation, `claude -p` subprocess
- No new dependencies

**Spec:** `docs/superpowers/specs/2026-04-24-perception-layer-phase-2-design.md`.

**Branch:** `feat/v2-perception-phase-2` off `feat/v2-perception-insights`. Close with PR to the feature branch, not master.

**Relevant skills for executors:** @superpowers:test-driven-development · @superpowers:systematic-debugging · @superpowers:verification-before-completion

---

## File structure

**Modify:**

- `packages/entries/src/types.ts` — add `DigestEnvelope`, `DayDigest`, `CURRENT_DAY_DIGEST_SCHEMA_VERSION`.
- `packages/entries/src/settings.ts` — flip `enabled` default to `true`; delete `allowedProjects` from `AiFeaturesSettings`; drop `allowed_projects` key from `toDisk` / `fromDisk`.
- `packages/entries/src/queue.ts` — drop `allowed.has(entry.project)` filter + `no_allowed_projects` skip case; add top-of-function `llm-interactive.lock` check returning `{skipped: "interactive_in_progress"}`.
- `packages/entries/src/fs.ts` — remove `listKnownProjects` (dead code post-flip); add digest read/write helpers.
- `packages/entries/src/index.ts` — export new digest types (types only).
- `packages/entries/src/node.ts` — export new `enrich` / `digest-day` / `pipeline-lock` surfaces.
- `packages/cli/src/commands/entries.ts` — document `--since` behavior in `--help`.
- `packages/cli/src/index.ts` — route `digest` subcommand.
- `apps/web/app/page.tsx` — add Yesterday hero + Recent days panel.
- `apps/web/app/settings/ai-features-form.tsx` — wrap in `<form onSubmit>`; delete project-list UI.
- `apps/web/app/api/settings/route.ts` — add Zod validator on PUT; drop `allowedProjects` from types.
- `apps/web/components/sidebar.tsx` — add `/settings` nav link.
- `scripts/smoke.mjs` — add `/settings` and a dynamically-computed `/digest/[yesterday]`.
- `packages/entries/test/fs.test.ts` — remove unused `EntryEnrichmentStatus` import.

**Create:**

- `packages/entries/src/digest-day.ts` — `buildDeterministicDigest`, `generateDayDigest`.
- `packages/entries/src/digest-fs.ts` — atomic read/write for `~/.cclens/digests/day/*.json`; TTL-cached today digest.
- `packages/entries/src/pipeline-lock.ts` — `writeInteractiveLock`, `removeInteractiveLock`, `interactiveLockFresh` (60s, PID-alive).
- `packages/entries/src/prompts/digest-day.ts` — system prompt + Zod schema + user-prompt builder.
- `packages/entries/test/digest-day.test.ts` — deterministic aggregations, LLM happy path, retry, no-entries, all-trivial, spend usage.
- `packages/entries/test/prompts-digest-day.test.ts` — Zod accept/reject, prompt builder truncation.
- `packages/entries/test/digest-fs.test.ts` — atomic write, read-missing, TTL cache invalidation.
- `packages/entries/test/pipeline-lock.test.ts` — write/remove round-trip, 60s staleness, PID-dead staleness.
- `packages/entries/test/queue-lockout.test.ts` — daemon sweep skips when lock is fresh, proceeds when stale.
- `packages/entries/test/settings-default-on.test.ts` — fresh install yields `enabled: true`; existing `allowed_projects` drops on round-trip.
- `packages/cli/src/commands/digest.ts` — `fleetlens digest day` subcommand.
- `packages/cli/test/digest.test.ts` — flag parsing, deterministic output, exit codes.
- `apps/web/lib/entries.ts` — server-only entry reader + date utils (`yesterdayLocal`, `toLocalDay`).
- `apps/web/lib/ai/digest-day-gen.ts` — thin web wrapper around `generateDayDigest`.
- `apps/web/lib/ai/digest-day-pipeline.ts` — `runDayDigestPipeline` async generator (shared by route + CLI).
- `apps/web/app/api/digest/day/[date]/route.ts` — GET (read cache) + POST (SSE stream).
- `apps/web/app/digest/[date]/page.tsx` — server component renderer.
- `apps/web/app/digest/[date]/loading.tsx` — skeleton.
- `apps/web/components/day-digest.tsx` — pure presentational.
- `apps/web/components/day-digest-view.tsx` — client SSE wrapper + Regenerate button.
- `apps/web/components/yesterday-hero.tsx` — home hero card.
- `apps/web/components/recent-days-panel.tsx` — home bottom-row panel.

## Chunk boundaries for review

- **Chunk 1: Phase 1b follow-ups + settings flip** — Tasks 1–7
- **Chunk 2: Day digest generator + CLI** — Tasks 8–13
- **Chunk 3: Pipeline + API route + race prevention** — Tasks 14–17
- **Chunk 4: Page + home additions + smoke** — Tasks 18–24

Each task = one commit. Each step = 2–5 minutes of work.

---

## Chunk 1: Phase 1b follow-ups + settings flip

### Task 1: Add `/settings` to the sidebar nav

**Files:**
- Modify: `apps/web/components/sidebar.tsx`

Adds a `Settings` icon + `/settings` link alongside the other nav entries so users can reach the AI Features toggle without typing the URL.

- [ ] **Step 1: Add import for `Settings` icon from lucide-react**

Edit the import block at the top of `apps/web/components/sidebar.tsx`:

```tsx
import {
  LayoutDashboard,
  ListTree,
  FolderOpen,
  GitBranch,
  Pin,
  PinOff,
  Search,
  Activity,
  Gauge,
  Lightbulb,
  Settings,   // NEW
} from "lucide-react";
```

- [ ] **Step 2: Add `NavLink` entry for `/settings`**

Inside the `<nav>` block (after the `/insights` `NavLink`), add:

```tsx
<NavLink
  href="/settings"
  active={pathname === "/settings"}
  icon={<Settings size={15} />}
>
  Settings
</NavLink>
```

- [ ] **Step 3: Dev-server spot-check**

Run: `pnpm -F @claude-lens/web dev` (or reuse the currently-running server)
Visit http://localhost:3000 and verify:
- A gear-icon "Settings" link appears in the sidebar below "Insights"
- Clicking it lands on `/settings`
- The link styles as "active" when on `/settings`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/sidebar.tsx
git commit -m "feat(web/sidebar): add /settings nav link

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add `/settings` to `scripts/smoke.mjs`

**Files:**
- Modify: `scripts/smoke.mjs`

Adds `/settings` to the smoke-route list so `pnpm verify` catches server-component breakage on that page.

- [ ] **Step 1: Add the smoke hit**

In `scripts/smoke.mjs`, inside `main()` after the `results.push(await hit("/projects", "Projects grid"));` line, add:

```js
results.push(await hit("/settings", "Settings"));
```

- [ ] **Step 2: Verify it passes against a running server**

Run: `node scripts/smoke.mjs`
Expected: line `✓ Settings` appears in the output. Total route count goes up by one.

If the server isn't running, bring it up first per CLAUDE.md's "Running the local dev server" section.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test(smoke): cover /settings route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Zod validator on `PUT /api/settings`

**Files:**
- Modify: `apps/web/app/api/settings/route.ts`
- Test: `apps/web/test/api-settings.test.ts` (NEW)

Replace the `as`-cast body-parse with Zod validation. Rejects malformed PUTs with a 400 + concrete error message.

**Note on scope:** This task assumes `allowedProjects` is still in the settings type. Task 7 is the one that removes `allowedProjects`. Land tasks in order.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/api-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PUT } from "../app/api/settings/route";

describe("PUT /api/settings", () => {
  it("rejects malformed body with 400", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ai_features: { enabled: "yes-please" } }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("accepts a well-formed body", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ai_features: { enabled: true, model: "sonnet", monthlyBudgetUsd: null, allowedProjects: [] },
      }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
  });
});
```

Add `apps/web/test/` to vitest's include if not already covered. Check `apps/web/vitest.config.ts` — if missing, create with:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: false,   // change from true once this test lands
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/web test`
Expected: both tests fail — the first because the route returns 200 for garbage input, or throws.

- [ ] **Step 3: Write the validator**

Edit `apps/web/app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { readSettings, writeSettings, monthToDateSpend } from "@claude-lens/entries/node";

export const runtime = "nodejs";

const SettingsUpdateSchema = z.object({
  ai_features: z.object({
    enabled: z.boolean(),
    model: z.string().min(1),
    allowedProjects: z.array(z.string()),
    monthlyBudgetUsd: z.number().nonnegative().nullable(),
  }),
});

export async function GET() {
  return NextResponse.json({
    settings: readSettings(),
    month_to_date_spend_usd: monthToDateSpend(),
  });
}

export async function PUT(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = SettingsUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  writeSettings({ ai_features: parsed.data.ai_features });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @claude-lens/web test`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/settings/route.ts apps/web/test/api-settings.test.ts apps/web/vitest.config.ts
git commit -m "feat(web/api): Zod-validate PUT /api/settings body

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wrap `ai-features-form.tsx` in `<form onSubmit>`

**Files:**
- Modify: `apps/web/app/settings/ai-features-form.tsx`

Enter-to-submit support + keyboard accessibility. No behavior change beyond that.

- [ ] **Step 1: Rewrite the form wrapper**

In `apps/web/app/settings/ai-features-form.tsx`:

1. Change the outer `<div className="space-y-4">` to `<form onSubmit={handleSubmit} className="space-y-4">`.
2. Extract the existing click handler into `handleSubmit`:

```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  await save();
}
```

3. Change the Save `<button>` to `type="submit"` and drop the inline `onClick={save}` — the form's submit handler covers it.

- [ ] **Step 2: Manual verification**

Visit `/settings`. Focus any input (e.g., budget). Press Enter.
Expected: "Saved." appears below the button. No full-page reload (Default form submission is prevented by `e.preventDefault()`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/settings/ai-features-form.tsx
git commit -m "fix(web/settings): wrap AI features in <form onSubmit> for Enter-to-save

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Remove unused `EntryEnrichmentStatus` import in `fs.test.ts`

**Files:**
- Modify: `packages/entries/test/fs.test.ts:96`

Dead import flagged by Phase 1b reviewers. Lint-level cleanup.

- [ ] **Step 1: Delete the line**

In `packages/entries/test/fs.test.ts`, remove line 96:

```ts
import { type EntryEnrichmentStatus } from "../src/types.js";
```

Verify the file still type-checks — `EntryEnrichmentStatus` is not referenced anywhere after line 96 in this file (the `mk` helper uses an inline string-literal union).

- [ ] **Step 2: Run tests**

Run: `pnpm -F @claude-lens/parser typecheck && pnpm -F @claude-lens/parser test` (or the `@claude-lens/entries` equivalent).

Actually the package is `@claude-lens/entries`:

Run: `pnpm -F @claude-lens/entries typecheck && pnpm -F @claude-lens/entries test`
Expected: 0 errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/entries/test/fs.test.ts
git commit -m "chore(entries/test): drop unused EntryEnrichmentStatus import

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Document `--since` behavior in `fleetlens entries regenerate --help`

**Files:**
- Modify: `packages/cli/src/commands/entries.ts:136-154` (the `printHelp` function)

Clarify in the help text that `--since` only applies under `--force` — the filter is on the *reset-to-pending* step, not on the queue run.

- [ ] **Step 1: Update the help text**

In `printHelp()`:

```
  fleetlens entries regenerate [--since D] [--force] [--json]
                                               Re-run enrichment. Without --force,
                                               only processes Entries whose current
                                               status is pending/error and whose
                                               retry_count < 3.
                                               --force resets status+retry_count on
                                               matched done/error/pending Entries
                                               (skipped_trivial NOT reset).
                                               --since YYYY-MM-DD filters the
                                               --force reset set; it has NO effect
                                               without --force.
```

- [ ] **Step 2: Verify the help prints**

Run: `pnpm -F fleetlens build && node packages/cli/dist/index.js entries regenerate --help`
Expected: updated help text appears.

Alternative (faster): run the TS source directly if the CLI has a dev mode: `node --import tsx packages/cli/src/index.ts entries regenerate --help`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/entries.ts
git commit -m "docs(cli): clarify --since only applies under --force

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Settings flip — default `enabled: true`, drop `allowedProjects`

**Files:**
- Modify: `packages/entries/src/settings.ts`
- Modify: `packages/entries/src/queue.ts`
- Modify: `packages/entries/src/fs.ts` (drop `listKnownProjects`)
- Modify: `apps/web/app/settings/ai-features-form.tsx` (drop project-list UI)
- Modify: `apps/web/app/api/settings/route.ts` (drop `allowedProjects` from Zod)
- Modify: `apps/web/app/settings/page.tsx` (drop `projectCandidates` prop)
- Create test: `packages/entries/test/settings-default-on.test.ts`

This is the biggest single-commit change in chunk 1. Do it in ONE commit — splitting leaves the system in an inconsistent state (types mismatch, tests fail on intermediate states).

- [ ] **Step 1: Write the failing test for default-on**

Create `packages/entries/test/settings-default-on.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings, __setSettingsPathForTest } from "../src/settings.js";

describe("settings defaults (Phase 2 flip)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "settings-"));
    __setSettingsPathForTest(join(tmp, "settings.json"));
  });

  it("fresh install returns enabled:true", () => {
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(true);
    expect(s.ai_features.model).toBe("sonnet");
    expect(s.ai_features.monthlyBudgetUsd).toBeNull();
  });

  it("has no allowedProjects field on the returned shape", () => {
    const s = readSettings();
    expect("allowedProjects" in s.ai_features).toBe(false);
  });

  it("drops allowed_projects on round-trip", async () => {
    const { writeFileSync, readFileSync } = await import("node:fs");
    const p = join(tmp, "settings.json");
    writeFileSync(p, JSON.stringify({
      ai_features: { enabled: false, model: "opus", allowed_projects: ["/foo"], monthly_budget_usd: 10 },
    }));
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(false);        // preserved
    expect(s.ai_features.model).toBe("opus");          // preserved
    expect(s.ai_features.monthlyBudgetUsd).toBe(10);   // preserved
    expect("allowedProjects" in s.ai_features).toBe(false);

    writeSettings(s);
    const roundtripped = JSON.parse(readFileSync(p, "utf8"));
    expect("allowed_projects" in roundtripped.ai_features).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test settings-default-on`
Expected: fails on the first assertion — `readSettings()` returns `enabled: false`.

- [ ] **Step 3: Edit `packages/entries/src/settings.ts`**

Replace the file content with:

```ts
import {
  readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type AiFeaturesSettings = {
  enabled: boolean;
  model: string;
  monthlyBudgetUsd: number | null;
};

export type Settings = {
  ai_features: AiFeaturesSettings;
};

const DEFAULT_SETTINGS: Settings = {
  ai_features: {
    enabled: true,
    model: "sonnet",
    monthlyBudgetUsd: null,
  },
};

let settingsPathCached: string | null = null;

function settingsPath(): string {
  if (settingsPathCached) return settingsPathCached;
  settingsPathCached = join(homedir(), ".cclens", "settings.json");
  return settingsPathCached;
}

export function __setSettingsPathForTest(path: string): void {
  settingsPathCached = path;
}

type SettingsOnDisk = {
  ai_features: {
    enabled: boolean;
    model: string;
    monthly_budget_usd: number | null;
    // allowed_projects may exist on legacy disks — silently ignored
  };
};

function toDisk(s: Settings): SettingsOnDisk {
  return {
    ai_features: {
      enabled: s.ai_features.enabled,
      model: s.ai_features.model,
      monthly_budget_usd: s.ai_features.monthlyBudgetUsd,
    },
  };
}

function fromDisk(d: Partial<SettingsOnDisk>): Settings {
  const af: Partial<SettingsOnDisk["ai_features"]> = d.ai_features ?? {};
  return {
    ai_features: {
      enabled: af.enabled ?? DEFAULT_SETTINGS.ai_features.enabled,
      model: af.model ?? DEFAULT_SETTINGS.ai_features.model,
      monthlyBudgetUsd: af.monthly_budget_usd ?? null,
    },
  };
}

export function readSettings(): Settings {
  const p = settingsPath();
  if (!existsSync(p)) return DEFAULT_SETTINGS;
  try {
    const raw = readFileSync(p, "utf8");
    return fromDisk(JSON.parse(raw) as Partial<SettingsOnDisk>);
  } catch {
    return DEFAULT_SETTINGS;
  }
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

- [ ] **Step 4: Edit `packages/entries/src/queue.ts` — drop the allow-list filter**

In `packages/entries/src/queue.ts`:

1. Change the `EnrichmentResult` type:

```ts
export type EnrichmentResult =
  | { skipped: "disabled" | "budget_cap_reached" }
  | { enriched: number; errors: number; skipped: number };
```

(Removes `"no_allowed_projects"`; the `"interactive_in_progress"` variant lands in Task 15.)

2. Remove the allowedProjects guard and the `allowed.has(entry.project)` filter. The function body becomes:

```ts
export async function runEnrichmentQueue(
  settings: AiFeaturesSettings,
  opts: EnrichmentQueueOptions = {},
): Promise<EnrichmentResult> {
  if (!settings.enabled) return { skipped: "disabled" };

  const budget = settings.monthlyBudgetUsd ?? Infinity;
  if (monthToDateSpend() >= budget) return { skipped: "budget_cap_reached" };

  const now = opts.now ?? (() => Date.now());

  const queue = listEntriesWithStatus(["pending", "error"])
    .filter(e => (e.enrichment.retry_count ?? 0) < MAX_RETRY_COUNT);

  const todayLocal = toLocalDay(now());
  let enriched = 0, errors = 0, skipped = 0;

  for (const entry of queue) {
    if (entry.local_day === todayLocal) { skipped++; continue; }
    const endMs = Date.parse(entry.end_iso);
    if (!Number.isNaN(endMs) && now() - endMs < THIRTY_MIN_MS) { skipped++; continue; }

    if (monthToDateSpend() >= budget) break;

    try {
      const { entry: result, usage } = await enrichEntry(entry, {
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

(The `allowed` local, the `allowedProjects.length === 0` early return, and the `allowed.has` filter are all removed.)

- [ ] **Step 5: Edit `packages/entries/src/fs.ts` — drop `listKnownProjects`**

Delete the `listKnownProjects` function (lines 86-99 in the current file). No callers remain after the UI change in step 7.

Run `grep -r listKnownProjects packages/ apps/` to confirm no consumers.

- [ ] **Step 6: Edit `apps/web/app/api/settings/route.ts` — drop `allowedProjects` from Zod**

In the `SettingsUpdateSchema` from Task 3, remove `allowedProjects` from the inner object:

```ts
const SettingsUpdateSchema = z.object({
  ai_features: z.object({
    enabled: z.boolean(),
    model: z.string().min(1),
    monthlyBudgetUsd: z.number().nonnegative().nullable(),
  }),
});
```

- [ ] **Step 7: Edit `apps/web/app/settings/ai-features-form.tsx` — drop project-list UI**

Replace the file content with:

```tsx
"use client";
import { useState } from "react";

type Initial = {
  enabled: boolean;
  model: string;
  monthlyBudgetUsd: number | null;
};

export function AiFeaturesForm({
  initial, monthToDateSpend,
}: {
  initial: Initial;
  monthToDateSpend: number;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [model, setModel] = useState(initial.model);
  const [budget, setBudget] = useState<string>(
    initial.monthlyBudgetUsd === null ? "" : String(initial.monthlyBudgetUsd),
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ai_features: {
          enabled,
          model,
          monthlyBudgetUsd: budget === "" ? null : Number(budget),
        },
      }),
    });
    setSaving(false);
    setSavedMsg(res.ok ? "Saved." : `Error: ${res.status}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        <span>Enable AI digests and enrichment</span>
      </label>

      <label className="block">
        <span className="text-sm text-gray-600">Model</span>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="mt-1 block w-full border rounded px-2 py-1"
        >
          <option value="sonnet">sonnet (default)</option>
          <option value="opus">opus</option>
          <option value="haiku">haiku</option>
        </select>
        <span className="text-xs text-gray-500">
          Passed to <code>claude -p --model</code>; uses your existing Claude Code auth.
        </span>
      </label>

      <label className="block">
        <span className="text-sm text-gray-600">Monthly usage cap (USD reference) — blank = no cap</span>
        <input
          type="number"
          value={budget}
          onChange={e => setBudget(e.target.value)}
          step="0.01"
          className="mt-1 block w-full border rounded px-2 py-1"
        />
        <span className="text-xs text-gray-500">
          Reference-priced rate limit (you&apos;re billed via your Claude Code subscription, not per-token).
        </span>
      </label>

      <p className="text-xs text-gray-500">
        Month-to-date usage (reference): ${monthToDateSpend.toFixed(2)}
      </p>

      <button
        type="submit"
        disabled={saving}
        className="px-3 py-1 border rounded bg-black text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {savedMsg && <p className="text-sm">{savedMsg}</p>}
    </form>
  );
}
```

- [ ] **Step 8: Edit `apps/web/app/settings/page.tsx` — drop `projectCandidates` prop**

Open `apps/web/app/settings/page.tsx`. Remove any reference to `listKnownProjects` and the `projectCandidates` prop passed to `AiFeaturesForm`. The page server component should now pass `initial` (derived from `readSettings()`) and `monthToDateSpend`, nothing else.

- [ ] **Step 9: Run tests & typecheck**

```bash
pnpm -F @claude-lens/entries typecheck && pnpm -F @claude-lens/entries test
pnpm -F @claude-lens/web typecheck && pnpm -F @claude-lens/web test
```

Expected: all pass. The new `settings-default-on.test.ts` passes. The Phase 1b `queue.test.ts` may need updating — the `"no_allowed_projects"` expectation should be removed. Update that test inline if it fails.

- [ ] **Step 10: Commit**

```bash
git add packages/entries/src/settings.ts packages/entries/src/queue.ts packages/entries/src/fs.ts \
        packages/entries/test/settings-default-on.test.ts packages/entries/test/queue.test.ts \
        apps/web/app/api/settings/route.ts apps/web/app/settings/ai-features-form.tsx apps/web/app/settings/page.tsx
git commit -m "feat(entries): default AI on + drop per-project allow-list

- ai_features.enabled defaults to true
- allowed_projects removed; queue.ts no longer filters by project
- Settings UI collapses to master toggle + model + budget
- Legacy allowed_projects keys silently dropped on settings round-trip

The Phase 1b allow-list was defensive against an API-key model where
content would leave the user's Claude Code trust boundary. Under the
claude -p subprocess architecture the content crosses the same boundary
it already crossed when the user ran Claude Code, so the gate was
redundant. One master toggle is enough.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of Chunk 1.** All Phase 1b follow-ups + the settings flip are now in. Smoke, typecheck, tests all green.

---

## Chunk 2: Day digest generator + CLI

### Task 8: Digest types — `DigestEnvelope`, `DayDigest`

**Files:**
- Modify: `packages/entries/src/types.ts`
- Modify: `packages/entries/src/index.ts` (re-export)

- [ ] **Step 1: Add the types**

Append to `packages/entries/src/types.ts`:

```ts
/** Schema version for day digests. */
export const CURRENT_DAY_DIGEST_SCHEMA_VERSION = 2 as const;

export type DigestEnvelope = {
  version: typeof CURRENT_DAY_DIGEST_SCHEMA_VERSION;
  scope: "day" | "week" | "month" | "project" | "session";
  key: string;                                 // scope-specific: "2026-04-23" for day
  window: { start: string; end: string };
  entry_refs: string[];                        // "{session_id}__{local_day}"
  generated_at: string;
  is_live: boolean;
  model: string | null;
  cost_usd: number | null;
};

export type DayDigest = DigestEnvelope & {
  scope: "day";

  // Deterministic aggregations
  projects: Array<{ name: string; display_name: string; share_pct: number; entry_count: number }>;
  shipped: Array<{ title: string; project: string; session_id: string }>;
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak: number;
  agent_min: number;

  // LLM narrative (nullable when ai_features.enabled === false)
  headline: string | null;
  narrative: string | null;
  what_went_well: string | null;
  what_hit_friction: string | null;
  suggestion: { headline: string; body: string } | null;
};
```

- [ ] **Step 2: Re-export from index**

In `packages/entries/src/index.ts`, add:

```ts
export { CURRENT_DAY_DIGEST_SCHEMA_VERSION } from "./types.js";
export type { DigestEnvelope, DayDigest } from "./types.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @claude-lens/entries typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/entries/src/types.ts packages/entries/src/index.ts
git commit -m "feat(entries): DigestEnvelope + DayDigest types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Day-digest prompt + Zod schema

**Files:**
- Create: `packages/entries/src/prompts/digest-day.ts`
- Create test: `packages/entries/test/prompts-digest-day.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/entries/test/prompts-digest-day.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DayDigestResponseSchema,
  buildDigestUserPrompt,
  DIGEST_DAY_SYSTEM_PROMPT,
} from "../src/prompts/digest-day.js";
import type { DayDigest, Entry } from "../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2,
    session_id: "s1",
    local_day: "2026-04-23",
    project: "/Users/dev/repo",
    start_iso: "2026-04-23T10:00:00Z",
    end_iso: "2026-04-23T12:00:00Z",
    numbers: {
      active_min: 60, turn_count: 20, tools_total: 50, subagent_calls: 2,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 3, exit_plan_calls: 0, prs: 1, commits: 2,
      pushes: 1, tokens_total: 0,
    },
    flags: [], primary_model: "sonnet", model_mix: { sonnet: 20 },
    first_user: "", final_agent: "", pr_titles: ["feat: x"], top_tools: [],
    skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "done",
      generated_at: "2026-04-23T12:10:00Z",
      model: "claude-sonnet-4-6", cost_usd: 0.001, error: null,
      brief_summary: "You refactored the queue.", underlying_goal: "refactor",
      friction_detail: null, user_instructions: ["refactor queue"],
      outcome: "shipped", claude_helpfulness: "helpful",
      goal_categories: { refactor: 30, build: 30 }, retry_count: 0,
    },
    generated_at: "2026-04-23T12:10:00Z",
    source_jsonl: "/fake", source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...overrides };
}

function mkBase(): DayDigest {
  return {
    version: 2, scope: "day", key: "2026-04-23",
    window: { start: "2026-04-23T00:00:00Z", end: "2026-04-23T23:59:59Z" },
    entry_refs: [], generated_at: "2026-04-23T12:30:00Z", is_live: false,
    model: null, cost_usd: null,
    projects: [{ name: "/Users/dev/repo", display_name: "repo", share_pct: 100, entry_count: 1 }],
    shipped: [{ title: "feat: x", project: "repo", session_id: "s1" }],
    top_flags: [], top_goal_categories: [{ category: "build", minutes: 30 }],
    concurrency_peak: 1, agent_min: 60,
    headline: null, narrative: null, what_went_well: null,
    what_hit_friction: null, suggestion: null,
  };
}

describe("DayDigestResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const ok = {
      headline: "You shipped the queue refactor.",
      narrative: "You refactored the enrichment queue across two commits.",
      what_went_well: "The split was clean.",
      what_hit_friction: null,
      suggestion: null,
    };
    expect(DayDigestResponseSchema.parse(ok)).toMatchObject(ok);
  });

  it("rejects a missing headline", () => {
    const bad = {
      narrative: "x", what_went_well: null, what_hit_friction: null, suggestion: null,
    };
    expect(DayDigestResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("enforces max lengths", () => {
    const huge = { headline: "x".repeat(200), narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null };
    expect(DayDigestResponseSchema.safeParse(huge).success).toBe(false);
  });

  it("accepts passthrough extra keys", () => {
    const ok = {
      headline: "x", narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null,
      confidence: 0.9, notes: "extra",
    };
    expect(DayDigestResponseSchema.safeParse(ok).success).toBe(true);
  });
});

describe("buildDigestUserPrompt", () => {
  it("caps summaries at 12, frictions at 6, instructions at 10", () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(mkEntry({
        session_id: `s${i}`,
        enrichment: {
          ...mkEntry().enrichment,
          brief_summary: `summary ${i}`,
          friction_detail: `friction ${i}`,
          user_instructions: [`instr ${i}-a`, `instr ${i}-b`],
        },
      }));
    }
    const prompt = buildDigestUserPrompt(mkBase(), entries);
    const summaries = (prompt.match(/summary \d+/g) ?? []).length;
    const frictions = (prompt.match(/^\d+\. friction /gm) ?? []).length;
    const instructions = (prompt.match(/^\d+\. instr /gm) ?? []).length;
    expect(summaries).toBeLessThanOrEqual(12);
    expect(frictions).toBeLessThanOrEqual(6);
    expect(instructions).toBeLessThanOrEqual(10);
  });

  it("renders placeholders for empty inputs", () => {
    const prompt = buildDigestUserPrompt(mkBase(), []);
    expect(prompt).toContain("(none — no enriched entries)");
    expect(prompt).toContain("(none — smooth day)");
    expect(prompt).toContain("(none)");
  });

  it("includes DAY FACTS as JSON", () => {
    const base = mkBase();
    const prompt = buildDigestUserPrompt(base, []);
    expect(prompt).toContain(`"date": "${base.key}"`);
    expect(prompt).toContain(`"agent_min": ${base.agent_min}`);
  });
});

describe("DIGEST_DAY_SYSTEM_PROMPT", () => {
  it("is non-trivially long (prompt cache tuning sanity)", () => {
    expect(DIGEST_DAY_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test prompts-digest-day`
Expected: `Cannot find module`.

- [ ] **Step 3: Write the prompt module**

Create `packages/entries/src/prompts/digest-day.ts`:

```ts
import { z } from "zod";
import type { DayDigest, Entry } from "../types.js";

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

const SYSTEM_PROMPT = `You are synthesizing a developer's Claude Code activity for a single local day into a short, honest narrative digest.

Input is:
- DAY FACTS: deterministic aggregates (agent_min, projects, shipped PRs, concurrency_peak, top_flags, top_goal_categories)
- ENTRY SUMMARIES: up to 12 per-session brief_summaries already generated by the enrichment pass
- FRICTION LINES: up to 6 entry-level friction_detail sentences (where present)
- USER INSTRUCTIONS: up to 10 load-bearing asks the user gave across the day

Output ONE JSON object with five fields:

1. headline (string, one sentence, <= 120 chars):
   Second-person. Concrete verb + concrete noun. Lead with the most characteristic work of the day.
   Good: "You shipped the Team Edition timeline after two subagent retries."
   Bad:  "You had a productive day."

2. narrative (string, 2-4 sentences, <= 600 chars, or null):
   Second-person. Weave the top 3-5 entries into a coherent arc. Name projects. Name specific wins or blockers. Do NOT list every entry.

3. what_went_well (string, ONE sentence or null):
   The strongest positive signal from the day. Tie to a concrete cause ("Subagent loop settled after you split the spec review"). Null if the day was truly friction-dominated.

4. what_hit_friction (string, ONE sentence or null):
   The most load-bearing friction. Tie to a concrete cause. Null if the day was smooth.

5. suggestion (object { headline: string <= 60 chars, body: string <= 240 chars } or null):
   One actionable next step for tomorrow, grounded in today's pattern. Null if nothing obvious suggests itself; don't pad with truisms.

CRITICAL RULES:

- Second-person ("you ..."), not third-person.
- Copy the user's phrasings where useful; do not invent features or outcomes not in the input.
- Do not mention a project unless it's in DAY FACTS.projects.
- Do not fabricate PR counts, commits, or timestamps.
- If input is sparse (<= 2 entries or <= 10 active_min), err shorter — a one-line headline + null narrative is fine.

RESPOND WITH ONLY VALID JSON (no prose, no code fence):

{
  "headline": "...",
  "narrative": "..." | null,
  "what_went_well": "..." | null,
  "what_hit_friction": "..." | null,
  "suggestion": { "headline": "...", "body": "..." } | null
}`;

export const DIGEST_DAY_SYSTEM_PROMPT = SYSTEM_PROMPT;

function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function buildDigestUserPrompt(base: DayDigest, entries: Entry[]): string {
  const enriched = entries.filter(e => e.enrichment.status === "done");

  const summaries = enriched
    .slice(0, 12)
    .map(e => `- (${prettyProject(e.project)}, ${Math.round(e.numbers.active_min)}m) ${trunc(e.enrichment.brief_summary ?? "", 240)}`)
    .join("\n");

  const frictions = enriched
    .map(e => e.enrichment.friction_detail)
    .filter((x): x is string => !!x)
    .slice(0, 6)
    .map((f, i) => `${i + 1}. ${trunc(f, 240)}`)
    .join("\n");

  const instructions = enriched
    .flatMap(e => e.enrichment.user_instructions)
    .slice(0, 10)
    .map((s, i) => `${i + 1}. ${trunc(s, 240)}`)
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @claude-lens/entries test prompts-digest-day`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/entries/src/prompts/digest-day.ts packages/entries/test/prompts-digest-day.test.ts
git commit -m "feat(entries): day-digest system prompt + Zod schema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `buildDeterministicDigest` — pure aggregation

**Files:**
- Create: `packages/entries/src/digest-day.ts` (with `buildDeterministicDigest` only; `generateDayDigest` lands in Task 11)
- Create test: `packages/entries/test/digest-day-deterministic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/entries/test/digest-day-deterministic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDeterministicDigest } from "../src/digest-day.js";
import type { Entry } from "../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2, session_id: "s1", local_day: "2026-04-23",
    project: "/Users/dev/repo-a", start_iso: "2026-04-23T10:00:00Z",
    end_iso: "2026-04-23T11:00:00Z",
    numbers: {
      active_min: 60, turn_count: 10, tools_total: 25, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0,
      pushes: 0, tokens_total: 0,
    },
    flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
    pr_titles: [], top_tools: [], skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null,
      error: null, brief_summary: null, underlying_goal: null,
      friction_detail: null, user_instructions: [], outcome: null,
      claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: "2026-04-23T11:00:00Z", source_jsonl: "/fake",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...overrides };
}

describe("buildDeterministicDigest", () => {
  it("empty entries yields zeroed base digest", () => {
    const d = buildDeterministicDigest("2026-04-23", []);
    expect(d.scope).toBe("day");
    expect(d.key).toBe("2026-04-23");
    expect(d.agent_min).toBe(0);
    expect(d.projects).toEqual([]);
    expect(d.shipped).toEqual([]);
    expect(d.entry_refs).toEqual([]);
    expect(d.headline).toBeNull();
  });

  it("sums agent_min across entries", () => {
    const entries = [
      mkEntry({ numbers: { ...mkEntry().numbers, active_min: 60 } }),
      mkEntry({ session_id: "s2", numbers: { ...mkEntry().numbers, active_min: 30 } }),
    ];
    const d = buildDeterministicDigest("2026-04-23", entries);
    expect(d.agent_min).toBe(90);
  });

  it("groups projects by canonical name, computes share_pct", () => {
    const entries = [
      mkEntry({ project: "/Users/dev/repo-a", numbers: { ...mkEntry().numbers, active_min: 60 } }),
      mkEntry({ session_id: "s2", project: "/Users/dev/repo-b", numbers: { ...mkEntry().numbers, active_min: 30 } }),
      mkEntry({ session_id: "s3", project: "/Users/dev/repo-a", numbers: { ...mkEntry().numbers, active_min: 10 } }),
    ];
    const d = buildDeterministicDigest("2026-04-23", entries);
    expect(d.projects).toHaveLength(2);
    const a = d.projects.find(p => p.name === "/Users/dev/repo-a")!;
    expect(a.entry_count).toBe(2);
    expect(a.share_pct).toBeCloseTo(70, 0);
  });

  it("populates shipped from pr_titles", () => {
    const entries = [
      mkEntry({ pr_titles: ["feat: a", "feat: b"] }),
      mkEntry({ session_id: "s2", project: "/x", pr_titles: ["feat: c"] }),
    ];
    const d = buildDeterministicDigest("2026-04-23", entries);
    expect(d.shipped).toHaveLength(3);
    expect(d.shipped[0]).toMatchObject({ title: "feat: a", session_id: "s1" });
  });

  it("top_flags counts occurrences across entries, top 5", () => {
    const entries = [
      mkEntry({ flags: ["orchestrated", "fast_ship"] }),
      mkEntry({ session_id: "s2", flags: ["orchestrated"] }),
      mkEntry({ session_id: "s3", flags: ["loop_suspected"] }),
    ];
    const d = buildDeterministicDigest("2026-04-23", entries);
    expect(d.top_flags[0]).toEqual({ flag: "orchestrated", count: 2 });
  });

  it("top_goal_categories sums MINUTES (not counts), top 5", () => {
    const entries = [
      mkEntry({
        enrichment: {
          ...mkEntry().enrichment,
          status: "done",
          goal_categories: { build: 30, debug: 10 },
        },
      }),
      mkEntry({
        session_id: "s2",
        enrichment: {
          ...mkEntry().enrichment,
          status: "done",
          goal_categories: { build: 20, plan: 5 },
        },
      }),
    ];
    const d = buildDeterministicDigest("2026-04-23", entries);
    expect(d.top_goal_categories[0]).toEqual({ category: "build", minutes: 50 });
    expect(d.top_goal_categories.find(g => g.category === "plan")?.minutes).toBe(5);
  });

  it("entry_refs uses {session_id}__{local_day} format", () => {
    const entries = [mkEntry({ session_id: "abc", local_day: "2026-04-23" })];
    const d = buildDeterministicDigest("2026-04-23", entries);
    expect(d.entry_refs).toEqual(["abc__2026-04-23"]);
  });

  it("narrative fields are null", () => {
    const d = buildDeterministicDigest("2026-04-23", [mkEntry()]);
    expect(d.headline).toBeNull();
    expect(d.narrative).toBeNull();
    expect(d.what_went_well).toBeNull();
    expect(d.what_hit_friction).toBeNull();
    expect(d.suggestion).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test digest-day-deterministic`
Expected: `Cannot find module '../src/digest-day.js'`.

- [ ] **Step 3: Implement `buildDeterministicDigest`**

Create `packages/entries/src/digest-day.ts`:

```ts
import { CURRENT_DAY_DIGEST_SCHEMA_VERSION, type DayDigest, type Entry } from "./types.js";

function prettyProjectName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function buildDeterministicDigest(date: string, entries: Entry[]): DayDigest {
  const agent_min = entries.reduce((sum, e) => sum + e.numbers.active_min, 0);

  // Project aggregation
  const byProject = new Map<string, { minutes: number; entry_count: number }>();
  for (const e of entries) {
    const prev = byProject.get(e.project) ?? { minutes: 0, entry_count: 0 };
    prev.minutes += e.numbers.active_min;
    prev.entry_count += 1;
    byProject.set(e.project, prev);
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([name, v]) => ({
      name,
      display_name: prettyProjectName(name),
      share_pct: agent_min > 0 ? (v.minutes / agent_min) * 100 : 0,
      entry_count: v.entry_count,
    }));

  // Shipped PRs
  const shipped = entries.flatMap(e =>
    e.pr_titles.map(title => ({
      title,
      project: prettyProjectName(e.project),
      session_id: e.session_id,
    })),
  );

  // Top flags
  const flagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.flags) {
      flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  // Top goal categories — SUM OF MINUTES
  const goalMinutes = new Map<string, number>();
  for (const e of entries) {
    if (e.enrichment.status !== "done") continue;
    for (const [g, min] of Object.entries(e.enrichment.goal_categories ?? {})) {
      goalMinutes.set(g, (goalMinutes.get(g) ?? 0) + (min ?? 0));
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  // Window: local-day boundaries as ISO strings (for provenance only; no consumer parses this strictly)
  const window = {
    start: `${date}T00:00:00`,
    end: `${date}T23:59:59`,
  };

  return {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION,
    scope: "day",
    key: date,
    window,
    entry_refs: entries.map(e => `${e.session_id}__${e.local_day}`),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    projects,
    shipped,
    top_flags,
    top_goal_categories,
    concurrency_peak: 0,  // populated later by the pipeline (see Task 16 — requires computeBurstsFromSessions from parser)
    agent_min,
    headline: null,
    narrative: null,
    what_went_well: null,
    what_hit_friction: null,
    suggestion: null,
  };
}
```

**Note on `concurrency_peak`:** left at 0 here because it requires `SessionMeta` from `@claude-lens/parser`, which `packages/entries` does not depend on. The pipeline helper in Task 16 populates it via `aggregateConcurrency(computeBurstsFromSessions(sessionsForDay))` before writing. The deterministic digest served by CLI/route correctly shows `concurrency_peak: 0` until the pipeline fills it in — this is an acceptable tradeoff; the unit is "peak concurrent sessions for this day" which a single-package test fixture can't meaningfully construct anyway.

Actually revise: add `concurrency_peak` as a caller-passed parameter so the pipeline can supply it and the CLI can compute it separately. Change the signature:

```ts
export function buildDeterministicDigest(
  date: string,
  entries: Entry[],
  opts: { concurrencyPeak?: number } = {},
): DayDigest {
  // ... same body ...
  return {
    // ...
    concurrency_peak: opts.concurrencyPeak ?? 0,
    // ...
  };
}
```

Update the call in the test to ignore the opts param (default 0 matches).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @claude-lens/entries test digest-day-deterministic`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/entries/src/digest-day.ts packages/entries/test/digest-day-deterministic.test.ts
git commit -m "feat(entries): buildDeterministicDigest aggregates day Entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `generateDayDigest` — LLM narrative layer

**Files:**
- Modify: `packages/entries/src/digest-day.ts` (add `generateDayDigest`)
- Create test: `packages/entries/test/digest-day-generate.test.ts`

Pure generator — caller owns persistence + spend-append (see §S1 of spec).

- [ ] **Step 1: Write the failing test**

Create `packages/entries/test/digest-day-generate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateDayDigest, buildDeterministicDigest } from "../src/digest-day.js";
import type { Entry } from "../src/types.js";
import type { LLMResponse } from "../src/enrich.js";

function mkEntry(over: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2, session_id: "s1", local_day: "2026-04-23",
    project: "/x", start_iso: "2026-04-23T10:00:00Z", end_iso: "2026-04-23T11:00:00Z",
    numbers: {
      active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 1, commits: 1,
      pushes: 0, tokens_total: 0,
    },
    flags: [], primary_model: null, model_mix: {},
    first_user: "", final_agent: "", pr_titles: ["feat: x"], top_tools: [],
    skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "done", generated_at: "2026-04-23T11:00:00Z",
      model: "sonnet", cost_usd: 0.001, error: null,
      brief_summary: "shipped x", underlying_goal: "x",
      friction_detail: null, user_instructions: [],
      outcome: "shipped", claude_helpfulness: "helpful",
      goal_categories: { build: 60 }, retry_count: 0,
    },
    generated_at: "2026-04-23T11:00:00Z", source_jsonl: "/", source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...over };
}

describe("generateDayDigest", () => {
  it("returns base digest unchanged when entries is empty", async () => {
    const mockLLM = async () => { throw new Error("should not be called"); };
    const r = await generateDayDigest("2026-04-23", [], { callLLM: mockLLM });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("returns base digest unchanged when all entries are skipped_trivial", async () => {
    const e = mkEntry({ enrichment: { ...mkEntry().enrichment, status: "skipped_trivial" } });
    const mockLLM = async () => { throw new Error("should not be called"); };
    const r = await generateDayDigest("2026-04-23", [e], { callLLM: mockLLM });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("populates narrative fields on LLM success", async () => {
    const entries = [mkEntry()];
    const mockLLM = async (): Promise<LLMResponse> => ({
      content: JSON.stringify({
        headline: "You shipped x.",
        narrative: "You refactored.",
        what_went_well: "Clean diff.",
        what_hit_friction: null,
        suggestion: null,
      }),
      input_tokens: 500, output_tokens: 200, model: "claude-sonnet-4-6",
    });
    const r = await generateDayDigest("2026-04-23", entries, { callLLM: mockLLM });
    expect(r.digest.headline).toBe("You shipped x.");
    expect(r.digest.narrative).toBe("You refactored.");
    expect(r.digest.what_went_well).toBe("Clean diff.");
    expect(r.usage).toEqual({ input_tokens: 500, output_tokens: 200 });
  });

  it("retries once on parse failure then succeeds", async () => {
    const entries = [mkEntry()];
    let calls = 0;
    const mockLLM = async (): Promise<LLMResponse> => {
      calls++;
      if (calls === 1) return { content: "not json", input_tokens: 100, output_tokens: 50, model: "sonnet" };
      return {
        content: JSON.stringify({
          headline: "Ok.", narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null,
        }),
        input_tokens: 120, output_tokens: 60, model: "sonnet",
      };
    };
    const r = await generateDayDigest("2026-04-23", entries, { callLLM: mockLLM });
    expect(calls).toBe(2);
    expect(r.digest.headline).toBe("Ok.");
    expect(r.usage).toEqual({ input_tokens: 220, output_tokens: 110 });
  });

  it("returns base digest + null narrative after two parse failures", async () => {
    const entries = [mkEntry()];
    const mockLLM = async (): Promise<LLMResponse> => ({
      content: "still not json",
      input_tokens: 100, output_tokens: 50, model: "sonnet",
    });
    const r = await generateDayDigest("2026-04-23", entries, { callLLM: mockLLM });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toEqual({ input_tokens: 200, output_tokens: 100 });
  });

  it("caller can pre-compute deterministic + pass concurrencyPeak", async () => {
    const e = mkEntry();
    const base = buildDeterministicDigest("2026-04-23", [e], { concurrencyPeak: 3 });
    expect(base.concurrency_peak).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test digest-day-generate`
Expected: `generateDayDigest is not a function`.

- [ ] **Step 3: Implement `generateDayDigest`**

Append to `packages/entries/src/digest-day.ts`:

```ts
import { DIGEST_DAY_SYSTEM_PROMPT, DayDigestResponseSchema, buildDigestUserPrompt } from "./prompts/digest-day.js";
import type { CallLLM, LLMResponse, EnrichUsage } from "./enrich.js";
import { spawn } from "node:child_process";

export type GenerateOptions = {
  model?: string;
  callLLM?: CallLLM;
  concurrencyPeak?: number;
};

export type GenerateResult = {
  digest: DayDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

async function defaultCallLLMDigest(args: { model: string; userPrompt: string; reminder?: string }): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    const claudeArgs = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--model", args.model, "--tools", "",
      "--disable-slash-commands", "--no-session-persistence",
      "--setting-sources", "",
      "--append-system-prompt", DIGEST_DAY_SYSTEM_PROMPT,
    ];
    const proc = spawn("claude", claudeArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const stdinPayload = args.reminder ? `${args.userPrompt}\n\n---\n\n${args.reminder}` : args.userPrompt;
    proc.stdin.write(stdinPayload);
    proc.stdin.end();

    let buffer = "", inputTokens = 0, outputTokens = 0, modelUsed = args.model, stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          if (obj.type === "assistant") {
            const msg = obj.message as Record<string, unknown> | undefined;
            const content = msg?.content as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && typeof block.text === "string") buffer += block.text;
              }
            }
            const mm = (msg as { model?: string } | undefined)?.model;
            if (mm) modelUsed = mm;
          }
          if (obj.type === "result") {
            const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) { inputTokens = usage.input_tokens ?? 0; outputTokens = usage.output_tokens ?? 0; }
          }
        } catch { /* skip framing */ }
      }
    });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    proc.on("close", code => {
      if (code !== 0 && !buffer) { reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`)); return; }
      resolve({ content: buffer, input_tokens: inputTokens, output_tokens: outputTokens, model: modelUsed });
    });
    proc.on("error", err => reject(new Error(`Failed to spawn claude: ${err.message}`)));
  });
}

function parseAndValidate(content: string) {
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    const r = DayDigestResponseSchema.safeParse(parsed);
    if (r.success) return { ok: true as const, value: r.data };
    return { ok: false as const, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false as const, error: "json: " + (e as Error).message };
  }
}

export async function generateDayDigest(
  date: string,
  entries: Entry[],
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const base = buildDeterministicDigest(date, entries, { concurrencyPeak: opts.concurrencyPeak });
  const enriched = entries.filter(e => e.enrichment.status === "done");
  if (enriched.length === 0) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMDigest;
  const userPrompt = buildDigestUserPrompt(base, entries);
  let inT = 0, outT = 0, lastModel = model;

  try {
    const r1 = await callLLM({ model, userPrompt });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      return {
        digest: { ...base, model: lastModel, cost_usd: null, headline: v1.value.headline,
          narrative: v1.value.narrative, what_went_well: v1.value.what_went_well,
          what_hit_friction: v1.value.what_hit_friction, suggestion: v1.value.suggestion },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the five required fields — no prose, no code fence.",
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = parseAndValidate(r2.content);
    if (v2.ok) {
      return {
        digest: { ...base, model: lastModel, cost_usd: null, headline: v2.value.headline,
          narrative: v2.value.narrative, what_went_well: v2.value.what_went_well,
          what_hit_friction: v2.value.what_hit_friction, suggestion: v2.value.suggestion },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    console.warn(`[digest-day] ${date}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-day] ${date}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
```

- [ ] **Step 4: Re-export from `index.ts` and `node.ts`**

In `packages/entries/src/index.ts`, add types only:

```ts
// (already exported via task 8)
```

In `packages/entries/src/node.ts`, add:

```ts
export { generateDayDigest, buildDeterministicDigest } from "./digest-day.js";
export type { GenerateOptions, GenerateResult } from "./digest-day.js";
export { DayDigestResponseSchema, buildDigestUserPrompt, DIGEST_DAY_SYSTEM_PROMPT } from "./prompts/digest-day.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @claude-lens/entries test digest-day-generate`
Expected: all tests pass.

Run full package tests: `pnpm -F @claude-lens/entries test`
Expected: all tests pass, no regressions in Phase 1b enrich / queue / prompts tests.

- [ ] **Step 6: Commit**

```bash
git add packages/entries/src/digest-day.ts packages/entries/src/node.ts \
        packages/entries/test/digest-day-generate.test.ts
git commit -m "feat(entries): generateDayDigest (LLM narrative layer)

Pure generator: caller owns persistence + spend-append.
Same subprocess pattern as enrichEntry.
One retry on parse failure; double-failure returns base digest with
null narrative fields (usage still reflects consumed tokens).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Digest storage — atomic write + TTL cache for today

**Files:**
- Create: `packages/entries/src/digest-fs.ts`
- Create test: `packages/entries/test/digest-fs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/entries/test/digest-fs.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeDayDigest, readDayDigest, getTodayDigestFromCache, setTodayDigestInCache,
  __setDigestsDirForTest, __clearTodayCacheForTest,
} from "../src/digest-fs.js";
import type { DayDigest } from "../src/types.js";

function mkDigest(date: string): DayDigest {
  return {
    version: 2, scope: "day", key: date,
    window: { start: `${date}T00:00:00`, end: `${date}T23:59:59` },
    entry_refs: [], generated_at: new Date().toISOString(), is_live: false,
    model: null, cost_usd: null, projects: [], shipped: [], top_flags: [],
    top_goal_categories: [], concurrency_peak: 0, agent_min: 0,
    headline: "h", narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null,
  };
}

describe("digest-fs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "digests-"));
    __setDigestsDirForTest(tmp);
    __clearTodayCacheForTest();
  });

  it("write + read round-trip", () => {
    const d = mkDigest("2026-04-23");
    writeDayDigest(d);
    const back = readDayDigest("2026-04-23");
    expect(back).toEqual(d);
  });

  it("readDayDigest returns null for missing file", () => {
    expect(readDayDigest("2026-01-01")).toBeNull();
  });

  it("atomic write via rename (temp file removed)", () => {
    const d = mkDigest("2026-04-23");
    writeDayDigest(d);
    const final = join(tmp, "day", "2026-04-23.json");
    expect(existsSync(final)).toBe(true);
    expect(existsSync(`${final}.tmp`)).toBe(false);
    const raw = readFileSync(final, "utf8");
    expect(JSON.parse(raw)).toEqual(d);
  });

  it("today cache round-trip + TTL invalidation", () => {
    const d = mkDigest("2026-04-24");
    setTodayDigestInCache("2026-04-24", d, Date.now());
    expect(getTodayDigestFromCache("2026-04-24", Date.now())).toEqual(d);
    // Simulate 11 minutes elapsed
    expect(getTodayDigestFromCache("2026-04-24", Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it("today cache key mismatch returns null", () => {
    const d = mkDigest("2026-04-24");
    setTodayDigestInCache("2026-04-24", d, Date.now());
    expect(getTodayDigestFromCache("2026-04-25", Date.now())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test digest-fs`
Expected: module not found.

- [ ] **Step 3: Implement `digest-fs.ts`**

Create `packages/entries/src/digest-fs.ts`:

```ts
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DayDigest } from "./types.js";

let digestsDirCached: string | null = null;

function digestsDir(): string {
  if (digestsDirCached) return digestsDirCached;
  digestsDirCached = join(homedir(), ".cclens", "digests");
  return digestsDirCached;
}

/** @internal Test-only. */
export function __setDigestsDirForTest(path: string): void {
  digestsDirCached = path;
  mkdirSync(join(path, "day"), { recursive: true });
}

function dayDigestPath(date: string): string {
  return join(digestsDir(), "day", `${date}.json`);
}

export function writeDayDigest(digest: DayDigest): void {
  const final = dayDigestPath(digest.key);
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(digest, null, 2), "utf8");
  renameSync(tmp, final);
}

export function readDayDigest(date: string): DayDigest | null {
  const p = dayDigestPath(date);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DayDigest;
  } catch {
    return null;
  }
}

// ───── Today's digest: in-memory TTL cache (10 minutes) ─────
// Never persisted to disk. Key is the local-day string; if the server process
// lives across midnight, a stale "today" cache is invalidated on key mismatch.

type TodayCacheEntry = { date: string; digest: DayDigest; writtenAtMs: number };
const TODAY_TTL_MS = 10 * 60 * 1000;
let todayCache: TodayCacheEntry | null = null;

export function getTodayDigestFromCache(date: string, nowMs: number): DayDigest | null {
  if (!todayCache) return null;
  if (todayCache.date !== date) return null;
  if (nowMs - todayCache.writtenAtMs > TODAY_TTL_MS) return null;
  return todayCache.digest;
}

export function setTodayDigestInCache(date: string, digest: DayDigest, nowMs: number): void {
  todayCache = { date, digest, writtenAtMs: nowMs };
}

/** @internal Test-only. */
export function __clearTodayCacheForTest(): void {
  todayCache = null;
}
```

- [ ] **Step 4: Export from `fs.ts` subpath (public node-safe)**

These helpers are pure fs operations — export them via the `./fs` subpath (same as entry-storage). In `packages/entries/src/fs.ts`, append at the bottom:

```ts
export {
  writeDayDigest, readDayDigest,
  getTodayDigestFromCache, setTodayDigestInCache,
  __setDigestsDirForTest, __clearTodayCacheForTest,
} from "./digest-fs.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @claude-lens/entries test digest-fs`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/entries/src/digest-fs.ts packages/entries/src/fs.ts packages/entries/test/digest-fs.test.ts
git commit -m "feat(entries): digest storage (atomic write + 10min today TTL)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `fleetlens digest day` CLI

**Files:**
- Create: `packages/cli/src/commands/digest.ts`
- Modify: `packages/cli/src/index.ts` (route `digest` subcommand)
- Create test: `packages/cli/test/digest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/digest.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Integration test: invoke the built CLI against a scratch entry store.
// Relies on `pnpm -F fleetlens build` having been run before this test.

describe("fleetlens digest day", () => {
  let entriesDir: string;
  beforeEach(() => {
    entriesDir = mkdtempSync(join(tmpdir(), "digest-cli-"));
    // Write one fixture Entry so deterministic digest has something to aggregate.
    const entry = {
      version: 2, session_id: "s1", local_day: "2026-04-23",
      project: "/x", start_iso: "2026-04-23T10:00:00Z", end_iso: "2026-04-23T11:00:00Z",
      numbers: {
        active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 0,
        skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
        consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0, pushes: 0, tokens_total: 0,
      },
      flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
      pr_titles: [], top_tools: [], skills: {}, subagents: [],
      satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
      user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
      enrichment: { status: "pending", generated_at: null, model: null, cost_usd: null, error: null,
        brief_summary: null, underlying_goal: null, friction_detail: null, user_instructions: [],
        outcome: null, claude_helpfulness: null, goal_categories: {}, retry_count: 0 },
      generated_at: "2026-04-23T11:00:00Z", source_jsonl: "/", source_checkpoint: { byte_offset: 0, last_event_ts: null },
    };
    writeFileSync(join(entriesDir, "s1__2026-04-23.json"), JSON.stringify(entry));
  });

  it("--date X --json prints a valid DayDigest JSON", () => {
    const env = { ...process.env, CCLENS_ENTRIES_DIR: entriesDir, CCLENS_AI_DISABLED: "1" };
    const out = execSync(`node ./packages/cli/dist/index.js digest day --date 2026-04-23 --json`, {
      env, encoding: "utf8",
    });
    const parsed = JSON.parse(out);
    expect(parsed.scope).toBe("day");
    expect(parsed.key).toBe("2026-04-23");
    expect(parsed.agent_min).toBe(60);
  });

  it("exits non-zero on invalid date", () => {
    const env = { ...process.env, CCLENS_ENTRIES_DIR: entriesDir, CCLENS_AI_DISABLED: "1" };
    expect(() =>
      execSync(`node ./packages/cli/dist/index.js digest day --date notadate --json`, { env, encoding: "utf8" })
    ).toThrow();
  });

  it("prints pretty-format by default", () => {
    const env = { ...process.env, CCLENS_ENTRIES_DIR: entriesDir, CCLENS_AI_DISABLED: "1" };
    const out = execSync(`node ./packages/cli/dist/index.js digest day --date 2026-04-23`, {
      env, encoding: "utf8",
    });
    expect(out).toContain("2026-04-23");
    expect(out).toContain("60m");
  });
});
```

Two env-var hooks introduced here:
- `CCLENS_ENTRIES_DIR` — overrides the entries dir (the test uses a scratch dir). Wire this into `entriesDir()` in `packages/entries/src/fs.ts` by returning `process.env.CCLENS_ENTRIES_DIR` if set, else the default. Lightweight — no test-only function needed.
- `CCLENS_AI_DISABLED` — when `"1"`, the CLI skips the LLM call regardless of settings. Keeps the test hermetic.

- [ ] **Step 2: Add the env hooks**

In `packages/entries/src/fs.ts`, modify `entriesDir()`:

```ts
export function entriesDir(): string {
  if (entriesDirCached) return entriesDirCached;
  const envOverride = process.env.CCLENS_ENTRIES_DIR;
  if (envOverride) {
    entriesDirCached = envOverride;
    return entriesDirCached;
  }
  entriesDirCached = join(homedir(), ".cclens", "entries");
  return entriesDirCached;
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F fleetlens test digest`
Expected: `Cannot find module './commands/digest.js'` or similar.

- [ ] **Step 4: Implement the command**

Create `packages/cli/src/commands/digest.ts`:

```ts
import { flag } from "../args.js";
import { listEntriesForDay, readDayDigest, writeDayDigest } from "@claude-lens/entries/fs";
import { buildDeterministicDigest, generateDayDigest, readSettings, appendSpend, monthToDateSpend } from "@claude-lens/entries/node";
import type { DayDigest, Entry } from "@claude-lens/entries";

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function digest(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) { printHelp(); return; }

  if (args[0] === "day") {
    await day(args.slice(1));
    return;
  }

  console.error(`unknown digest subcommand: ${args[0] ?? "(none)"}`);
  printHelp();
  process.exit(1);
}

async function day(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const pretty = args.includes("--pretty") || !json;
  const force = args.includes("--force");
  const isToday = args.includes("--today");
  const isYesterday = args.includes("--yesterday") || (!args.includes("--date") && !isToday);
  const dateFlag = flag(args, "--date");

  const now = Date.now();
  const date = dateFlag
    ?? (isToday ? toLocalDay(now) : toLocalDay(now - 86_400_000));

  if (!DATE_RE.test(date)) {
    console.error(`invalid date: "${date}" (expected YYYY-MM-DD)`);
    process.exit(1);
  }

  const entries = listEntriesForDay(date) as Entry[];
  if (entries.length === 0) {
    if (json) { console.log(JSON.stringify({ error: "no entries for date", date })); }
    else { console.error(`no entries found for ${date}`); }
    process.exit(1);
  }

  const settings = readSettings();
  const aiOn = settings.ai_features.enabled && process.env.CCLENS_AI_DISABLED !== "1";

  let result: DayDigest;

  // Today: never persisted; always built fresh in-memory for the CLI path
  if (date === toLocalDay(now)) {
    if (aiOn) {
      const r = await generateDayDigest(date, entries, { model: settings.ai_features.model });
      result = r.digest;
      if (r.usage) appendSpend({
        ts: new Date().toISOString(), caller: "cli", model: result.model ?? settings.ai_features.model,
        input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens,
        cost_usd: result.cost_usd ?? 0, kind: "day_digest", ref: date,
      });
    } else {
      result = buildDeterministicDigest(date, entries);
    }
  } else {
    // Past day: read cache unless --force
    if (!force) {
      const cached = readDayDigest(date);
      if (cached) { result = cached; }
      else { result = await generateOrDeterministic(date, entries, aiOn, settings); writeDayDigest(result); }
    } else {
      result = await generateOrDeterministic(date, entries, aiOn, settings);
      writeDayDigest(result);
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    prettyPrint(result, pretty);
  }
}

async function generateOrDeterministic(
  date: string, entries: Entry[], aiOn: boolean, settings: ReturnType<typeof readSettings>,
): Promise<DayDigest> {
  if (!aiOn) return buildDeterministicDigest(date, entries);
  const budget = settings.ai_features.monthlyBudgetUsd ?? Infinity;
  if (monthToDateSpend() >= budget) {
    console.error(`budget cap reached — falling back to deterministic digest`);
    return buildDeterministicDigest(date, entries);
  }
  const r = await generateDayDigest(date, entries, { model: settings.ai_features.model });
  if (r.usage) appendSpend({
    ts: new Date().toISOString(), caller: "cli", model: r.digest.model ?? settings.ai_features.model,
    input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens,
    cost_usd: r.digest.cost_usd ?? 0, kind: "day_digest", ref: date,
  });
  return r.digest;
}

function prettyPrint(d: DayDigest, _pretty: boolean): void {
  console.log(`\n${d.key}  ${Math.round(d.agent_min)}m  ${d.projects.length} projects  ${d.shipped.length} PRs`);
  if (d.headline) console.log(`\n  ${d.headline}\n`);
  if (d.narrative) console.log(`  ${d.narrative}\n`);
  if (d.what_went_well) console.log(`  ✓ ${d.what_went_well}`);
  if (d.what_hit_friction) console.log(`  ⚠ ${d.what_hit_friction}`);
  if (d.suggestion) console.log(`\n  → ${d.suggestion.headline}\n    ${d.suggestion.body}`);
  console.log("");
}

function printHelp(): void {
  console.log(`fleetlens digest — day-level perception digests

Usage:
  fleetlens digest day                        Yesterday (alias for --yesterday)
  fleetlens digest day --yesterday            Yesterday
  fleetlens digest day --today                Today (in-memory only, not cached)
  fleetlens digest day --date YYYY-MM-DD      Specific date
  fleetlens digest day --date X --force       Re-generate, overwrite cache
  fleetlens digest day --date X --json        JSON output for scripting
  fleetlens digest day --date X --pretty      Readable output (default)

Exit codes:
  0 — success
  1 — invalid date, or no entries for date
`);
}
```

- [ ] **Step 5: Route the `digest` subcommand in the CLI entry**

Open `packages/cli/src/index.ts`. Find the subcommand dispatch block. Add:

```ts
} else if (cmd === "digest") {
  const { digest } = await import("./commands/digest.js");
  await digest(argv);
```

(pattern-match the existing `entries`, `stats`, `usage` handlers).

- [ ] **Step 6: Rebuild the CLI + run test**

Run: `pnpm -F fleetlens build`
Run: `pnpm -F fleetlens test`
Expected: `digest.test.ts` passes.

- [ ] **Step 7: Dogfood — manual smoke**

Run: `node packages/cli/dist/index.js digest day --yesterday --json | head -40`
Expected: a valid DayDigest JSON for yesterday, `"agent_min"` > 0 if you had activity.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/digest.ts packages/cli/src/index.ts \
        packages/cli/test/digest.test.ts packages/entries/src/fs.ts
git commit -m "feat(cli): fleetlens digest day

- --yesterday (default) / --today / --date X / --force / --json / --pretty
- Past days: reads cache, or generates + writes; --force overwrites
- Today: always builds fresh, never persists (matches spec TTL rule)
- AI-off or CCLENS_AI_DISABLED=1: skips LLM, returns deterministic digest
- Test fixture hermetic via CCLENS_ENTRIES_DIR env override

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of Chunk 2.** CLI proves the generator works end-to-end before any web surface. `pnpm verify` should pass.

---

## Chunk 3: Pipeline + API route + race prevention

### Task 14: `pipeline-lock.ts` — interactive-lock helpers

**Files:**
- Create: `packages/entries/src/pipeline-lock.ts`
- Create test: `packages/entries/test/pipeline-lock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/entries/test/pipeline-lock.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeInteractiveLock, removeInteractiveLock, interactiveLockFresh,
  __setInteractiveLockPathForTest,
} from "../src/pipeline-lock.js";

describe("pipeline-lock", () => {
  let p: string;
  beforeEach(() => {
    const d = mkdtempSync(join(tmpdir(), "lock-"));
    p = join(d, "lock");
    __setInteractiveLockPathForTest(p);
  });

  it("write creates the file with current PID", () => {
    writeInteractiveLock();
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8").trim()).toBe(String(process.pid));
  });

  it("remove deletes the file", () => {
    writeInteractiveLock();
    removeInteractiveLock();
    expect(existsSync(p)).toBe(false);
  });

  it("remove is a no-op when file absent", () => {
    expect(() => removeInteractiveLock()).not.toThrow();
  });

  it("interactiveLockFresh returns true for fresh lock of current pid", () => {
    writeInteractiveLock();
    expect(interactiveLockFresh(Date.now())).toBe(true);
  });

  it("interactiveLockFresh returns false for stale lock (mtime > 60s)", () => {
    writeInteractiveLock();
    // Simulate 90 seconds in the future
    expect(interactiveLockFresh(Date.now() + 90_000)).toBe(false);
  });

  it("interactiveLockFresh returns false when PID not alive", () => {
    // Write a lock with a PID that definitely doesn't exist
    writeFileSync(p, "99999999");
    expect(interactiveLockFresh(Date.now())).toBe(false);
  });

  it("interactiveLockFresh returns false when file missing", () => {
    expect(interactiveLockFresh(Date.now())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test pipeline-lock`
Expected: module not found.

- [ ] **Step 3: Implement `pipeline-lock.ts`**

Create `packages/entries/src/pipeline-lock.ts`:

```ts
import { writeFileSync, unlinkSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STALE_MS = 60 * 1000;

let lockPathCached: string | null = null;

function lockPath(): string {
  if (lockPathCached) return lockPathCached;
  lockPathCached = join(homedir(), ".cclens", "llm-interactive.lock");
  return lockPathCached;
}

/** @internal Test-only. */
export function __setInteractiveLockPathForTest(path: string): void {
  lockPathCached = path;
}

export function writeInteractiveLock(): void {
  writeFileSync(lockPath(), String(process.pid), "utf8");
}

export function removeInteractiveLock(): void {
  try { unlinkSync(lockPath()); } catch { /* already gone */ }
}

function pidAlive(pid: number): boolean {
  try {
    // Signal 0 throws if the process doesn't exist. Does not actually signal.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function interactiveLockFresh(nowMs: number): boolean {
  const p = lockPath();
  if (!existsSync(p)) return false;
  try {
    const mtime = statSync(p).mtimeMs;
    if (nowMs - mtime > STALE_MS) return false;
    const pid = Number(readFileSync(p, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return false;
    if (!pidAlive(pid)) return false;
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Re-export from `node.ts`**

In `packages/entries/src/node.ts`, add:

```ts
export {
  writeInteractiveLock, removeInteractiveLock, interactiveLockFresh,
} from "./pipeline-lock.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @claude-lens/entries test pipeline-lock`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/entries/src/pipeline-lock.ts packages/entries/src/node.ts \
        packages/entries/test/pipeline-lock.test.ts
git commit -m "feat(entries): interactive-lock helpers (PID + 60s mtime)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Daemon sweep top-of-loop lockout

**Files:**
- Modify: `packages/entries/src/queue.ts`
- Create test: `packages/entries/test/queue-lockout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/entries/test/queue-lockout.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEnrichmentQueue } from "../src/queue.js";
import { __setInteractiveLockPathForTest, writeInteractiveLock, removeInteractiveLock } from "../src/pipeline-lock.js";
import { __setEntriesDirForTest } from "../src/fs.js";
import type { AiFeaturesSettings } from "../src/settings.js";

const SETTINGS: AiFeaturesSettings = {
  enabled: true, model: "sonnet", monthlyBudgetUsd: null,
};

describe("runEnrichmentQueue lockout", () => {
  let lockDir: string, entriesDir: string;
  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "lock-"));
    entriesDir = mkdtempSync(join(tmpdir(), "entries-"));
    __setInteractiveLockPathForTest(join(lockDir, "llm-interactive.lock"));
    __setEntriesDirForTest(entriesDir);
  });
  afterEach(() => { removeInteractiveLock(); });

  it("skips with interactive_in_progress when lock is fresh", async () => {
    writeInteractiveLock();
    const r = await runEnrichmentQueue(SETTINGS);
    expect(r).toEqual({ skipped: "interactive_in_progress" });
  });

  it("proceeds when lock is missing", async () => {
    const r = await runEnrichmentQueue(SETTINGS);
    // No entries in the dir → enriched=0, errors=0, skipped=0
    expect(r).toMatchObject({ enriched: 0, errors: 0, skipped: 0 });
  });

  it("proceeds when lock is stale (old mtime)", async () => {
    const lockPath = join(lockDir, "llm-interactive.lock");
    writeFileSync(lockPath, String(process.pid));
    // Simulate the lock being 90s old by providing a time 90s in the future to lock-check
    // But runEnrichmentQueue uses real Date.now(); fake it via opts.now.
    const r = await runEnrichmentQueue(SETTINGS, { now: () => Date.now() + 90_000 });
    expect(r).toMatchObject({ enriched: 0, errors: 0, skipped: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @claude-lens/entries test queue-lockout`
Expected: `interactive_in_progress` is not a valid variant, OR the queue proceeds instead of skipping.

- [ ] **Step 3: Modify `queue.ts` — top-of-function lock check**

In `packages/entries/src/queue.ts`:

1. Update `EnrichmentResult`:

```ts
export type EnrichmentResult =
  | { skipped: "disabled" | "budget_cap_reached" | "interactive_in_progress" }
  | { enriched: number; errors: number; skipped: number };
```

2. Add import:

```ts
import { interactiveLockFresh } from "./pipeline-lock.js";
```

3. In `runEnrichmentQueue`, insert the check immediately after the `enabled` guard:

```ts
export async function runEnrichmentQueue(
  settings: AiFeaturesSettings,
  opts: EnrichmentQueueOptions = {},
): Promise<EnrichmentResult> {
  if (!settings.enabled) return { skipped: "disabled" };

  const now = opts.now ?? (() => Date.now());
  if (interactiveLockFresh(now())) return { skipped: "interactive_in_progress" };

  const budget = settings.monthlyBudgetUsd ?? Infinity;
  if (monthToDateSpend() >= budget) return { skipped: "budget_cap_reached" };

  // ... rest unchanged ...
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F @claude-lens/entries test queue`
Expected: `queue-lockout` passes; existing `queue.test.ts` still passes (update it if it asserts on the EnrichmentResult shape explicitly).

- [ ] **Step 5: Commit**

```bash
git add packages/entries/src/queue.ts packages/entries/test/queue-lockout.test.ts
git commit -m "feat(entries): daemon sweep skips when interactive lock fresh

Top-of-function gate: if ~/.cclens/llm-interactive.lock is fresh
(mtime < 60s, PID alive), daemon sweep returns interactive_in_progress
and does not enter the queue loop. Prevents daemon+foreground double-
enrich of the same Entry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `runDayDigestPipeline` shared generator

**Files:**
- Create: `apps/web/lib/ai/digest-day-pipeline.ts` (actually lives inside the CLI-reachable boundary — see architecture note below)
- Create test: integrated into Task 17 via the route test

**Architecture note:** the spec lists this file under `apps/web/lib/ai/digest-day-pipeline.ts`, but both the web route and the CLI need it. Co-locate as **`packages/entries/src/digest-day-pipeline.ts`** and export via `@claude-lens/entries/node`. Web still imports `import { runDayDigestPipeline } from "@claude-lens/entries/node"`. Keeps one source of truth. The spec's file location was suggestive not prescriptive.

- [ ] **Step 1: Create the pipeline generator**

Create `packages/entries/src/digest-day-pipeline.ts`:

```ts
import { listEntriesForDay, writeEntry } from "./fs.js";
import { readDayDigest, writeDayDigest, getTodayDigestFromCache, setTodayDigestInCache } from "./digest-fs.js";
import { enrichEntry, type CallLLM } from "./enrich.js";
import { generateDayDigest, buildDeterministicDigest } from "./digest-day.js";
import { appendSpend, monthToDateSpend } from "./budget.js";
import { writeInteractiveLock, removeInteractiveLock } from "./pipeline-lock.js";
import type { AiFeaturesSettings } from "./settings.js";
import type { DayDigest, Entry, EntryEnrichmentStatus } from "./types.js";

export type PipelineEvent =
  | { type: "status"; phase: "enrich" | "synth" | "persist"; text: string }
  | { type: "entry"; session_id: string; index: number; total: number; status: EntryEnrichmentStatus; cost_usd: number | null }
  | { type: "digest"; digest: DayDigest }
  | { type: "saved"; path: string }
  | { type: "error"; message: string };

export type PipelineOptions = {
  settings: AiFeaturesSettings;
  force?: boolean;
  /** Override for tests. */
  callLLM?: CallLLM;
  /** Override for tests. */
  now?: () => number;
  /** The current local day in server TZ. If date === today, skip disk persistence. */
  todayLocalDay: string;
};

const THIRTY_MIN_MS = 30 * 60 * 1000;
const MAX_RETRY_COUNT = 3;

export async function* runDayDigestPipeline(
  date: string,
  opts: PipelineOptions,
): AsyncGenerator<PipelineEvent, void, void> {
  const now = opts.now ?? (() => Date.now());
  const isToday = date === opts.todayLocalDay;
  const aiOn = opts.settings.enabled;

  // Short-circuit: past day, cached, !force → single digest event
  if (!isToday && !opts.force) {
    const cached = readDayDigest(date);
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  // Short-circuit: today, cached in-memory TTL, !force → single digest event
  if (isToday && !opts.force) {
    const cached = getTodayDigestFromCache(date, now());
    if (cached) { yield { type: "digest", digest: cached }; return; }
  }

  const entries = listEntriesForDay(date) as Entry[];
  if (entries.length === 0) {
    yield { type: "error", message: `no entries for date ${date}` };
    return;
  }

  // ── Acquire interactive lock for the duration of the pipeline ──
  if (aiOn) writeInteractiveLock();
  try {
    // Stage 1: enrich
    if (aiOn) {
      const pending = entries.filter(e =>
        (e.enrichment.status === "pending" || e.enrichment.status === "error")
        && (e.enrichment.retry_count ?? 0) < MAX_RETRY_COUNT
        && e.local_day !== opts.todayLocalDay                 // settled-day guard
        && (() => {
          const endMs = Date.parse(e.end_iso);
          return Number.isNaN(endMs) || now() - endMs >= THIRTY_MIN_MS;
        })()
      );
      if (pending.length > 0) {
        yield { type: "status", phase: "enrich", text: `Enriching ${pending.length} entries for ${date}` };
        const budget = opts.settings.monthlyBudgetUsd ?? Infinity;
        let idx = 0;
        for (const entry of pending) {
          idx++;
          if (monthToDateSpend() >= budget) {
            yield { type: "status", phase: "enrich", text: `budget cap reached — stopping enrichment` };
            break;
          }
          const { entry: result, usage } = await enrichEntry(entry, {
            model: opts.settings.model, callLLM: opts.callLLM,
          });
          writeEntry(result);
          if (result.enrichment.status === "done") {
            appendSpend({
              ts: new Date().toISOString(), caller: "web", model: result.enrichment.model ?? opts.settings.model,
              input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0,
              cost_usd: result.enrichment.cost_usd ?? 0, kind: "entry_enrich",
              ref: `${result.session_id}__${result.local_day}`,
            });
          }
          yield {
            type: "entry", session_id: result.session_id,
            index: idx, total: pending.length,
            status: result.enrichment.status, cost_usd: result.enrichment.cost_usd,
          };
        }
      }
    }

    // Reload entries (they may now have enriched narrative)
    const fresh = listEntriesForDay(date) as Entry[];

    // Stage 2: synthesize
    let digest: DayDigest;
    if (aiOn) {
      yield { type: "status", phase: "synth", text: "Synthesizing day narrative" };
      const r = await generateDayDigest(date, fresh, {
        model: opts.settings.model, callLLM: opts.callLLM,
      });
      digest = r.digest;
      if (r.usage) {
        appendSpend({
          ts: new Date().toISOString(), caller: "web",
          model: digest.model ?? opts.settings.model,
          input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens,
          cost_usd: digest.cost_usd ?? 0, kind: "day_digest", ref: date,
        });
      }
    } else {
      digest = buildDeterministicDigest(date, fresh);
    }

    // Stage 3: persist
    if (!isToday) {
      writeDayDigest(digest);
      yield { type: "saved", path: `~/.cclens/digests/day/${date}.json` };
    } else {
      setTodayDigestInCache(date, digest, now());
    }

    yield { type: "digest", digest };
  } finally {
    if (aiOn) removeInteractiveLock();
  }
}
```

- [ ] **Step 2: Re-export from `node.ts`**

In `packages/entries/src/node.ts`, add:

```ts
export { runDayDigestPipeline } from "./digest-day-pipeline.js";
export type { PipelineEvent, PipelineOptions } from "./digest-day-pipeline.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @claude-lens/entries typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/entries/src/digest-day-pipeline.ts packages/entries/src/node.ts
git commit -m "feat(entries): runDayDigestPipeline async generator

Shared by web route + CLI. Yields per-entry + status + digest + saved
events. Writes llm-interactive.lock on entry, removes on finally.
Honors force/today/past-cached short-circuits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `/api/digest/day/[date]` route — GET + POST SSE

**Files:**
- Create: `apps/web/app/api/digest/day/[date]/route.ts`
- Create: `apps/web/lib/entries.ts` (server-only reader + date utils)
- Create test: `apps/web/test/api-digest-day.test.ts`

- [ ] **Step 1: Create `apps/web/lib/entries.ts`**

```ts
import "server-only";
export { listEntriesForDay, readDayDigest, writeDayDigest } from "@claude-lens/entries/fs";

export function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function yesterdayLocal(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs - 86_400_000);
}

export function todayLocal(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(s: string): boolean {
  return DATE_RE.test(s);
}
```

- [ ] **Step 2: Write the failing route test**

Create `apps/web/test/api-digest-day.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { GET, POST } from "../app/api/digest/day/[date]/route";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("GET /api/digest/day/[date]", () => {
  beforeEach(() => {
    const d = mkdtempSync(join(tmpdir(), "dig-route-"));
    process.env.CCLENS_ENTRIES_DIR = d;
    process.env.CCLENS_AI_DISABLED = "1";
  });

  it("returns 400 for future date", async () => {
    const far = "2999-01-01";
    const req = new Request(`http://localhost/api/digest/day/${far}`);
    const res = await GET(req, { params: Promise.resolve({ date: far }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed date", async () => {
    const req = new Request("http://localhost/api/digest/day/not-a-date");
    const res = await GET(req, { params: Promise.resolve({ date: "not-a-date" }) });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/digest/day/[date]", () => {
  it("streams SSE events for a deterministic past-day digest (AI off)", async () => {
    // Fixture: one entry on 2026-01-02
    const dir = mkdtempSync(join(tmpdir(), "dig-route-post-"));
    process.env.CCLENS_ENTRIES_DIR = dir;
    process.env.CCLENS_AI_DISABLED = "1";

    const entry = {
      version: 2, session_id: "s1", local_day: "2026-01-02",
      project: "/x", start_iso: "2026-01-02T10:00:00Z", end_iso: "2026-01-02T11:00:00Z",
      numbers: {
        active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 0,
        skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
        consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0, pushes: 0, tokens_total: 0,
      },
      flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
      pr_titles: [], top_tools: [], skills: {}, subagents: [],
      satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
      user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
      enrichment: { status: "pending", generated_at: null, model: null, cost_usd: null, error: null,
        brief_summary: null, underlying_goal: null, friction_detail: null, user_instructions: [],
        outcome: null, claude_helpfulness: null, goal_categories: {}, retry_count: 0 },
      generated_at: "2026-01-02T11:00:00Z", source_jsonl: "/", source_checkpoint: { byte_offset: 0, last_event_ts: null },
    };
    writeFileSync(join(dir, "s1__2026-01-02.json"), JSON.stringify(entry));

    const req = new Request("http://localhost/api/digest/day/2026-01-02", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ date: "2026-01-02" }) });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"type":"digest"');
    expect(text).toContain('"2026-01-02"');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @claude-lens/web test api-digest-day`
Expected: module not found.

- [ ] **Step 4: Write the route**

Create `apps/web/app/api/digest/day/[date]/route.ts`:

```ts
import { runDayDigestPipeline, readSettings } from "@claude-lens/entries/node";
import type { PipelineEvent } from "@claude-lens/entries/node";
import { readDayDigest } from "@claude-lens/entries/fs";
import { isValidDate, todayLocal } from "@/lib/entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ date: string }> };

// Concurrency coalescing: second caller for same (date, force) awaits the
// first and receives the final digest as a single event.
const inflight = new Map<string, Promise<void>>();

export async function GET(_req: Request, ctx: Params) {
  const { date } = await ctx.params;
  if (!isValidDate(date)) return new Response(JSON.stringify({ error: "invalid date" }), { status: 400, headers: { "content-type": "application/json" } });
  if (date > todayLocal()) return new Response(JSON.stringify({ error: "future date" }), { status: 400, headers: { "content-type": "application/json" } });

  if (date === todayLocal()) {
    // TODO Phase 2.x — if in-memory cache has it, serve. Otherwise 204 + hint to POST.
    return new Response(JSON.stringify({ pending: true, today: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const cached = readDayDigest(date);
  if (cached) return new Response(JSON.stringify(cached), { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ pending: true }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request, ctx: Params) {
  const { date } = await ctx.params;
  if (!isValidDate(date)) return new Response(JSON.stringify({ error: "invalid date" }), { status: 400 });
  if (date > todayLocal()) return new Response(JSON.stringify({ error: "future date" }), { status: 400 });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const key = `${date}|${force ? 1 : 0}`;

  const encoder = new TextEncoder();
  const settings = readSettings();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: PipelineEvent) {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); }
        catch { closed = true; }
      }
      function finish() {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      }

      // Coalescing: a second caller for the same (date, force) pair waits
      // on the in-flight promise and emits only the final digest event.
      const existing = inflight.get(key);
      if (existing) {
        try {
          await existing;
          const d = readDayDigest(date);
          if (d) send({ type: "digest", digest: d });
        } catch (err) {
          send({ type: "error", message: (err as Error).message });
        }
        send({ type: "status", phase: "persist", text: "coalesced with in-flight request" });
        try { controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); } catch {}
        finish();
        return;
      }

      const runPromise = (async () => {
        try {
          for await (const ev of runDayDigestPipeline(date, {
            settings: settings.ai_features,
            force,
            todayLocalDay: todayLocal(),
          })) {
            send(ev);
          }
        } catch (err) {
          send({ type: "error", message: (err as Error).message });
        }
      })();
      inflight.set(key, runPromise);

      try {
        await runPromise;
      } finally {
        inflight.delete(key);
        try { controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); } catch {}
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @claude-lens/web test api-digest-day`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/digest/day/[date]/route.ts apps/web/lib/entries.ts \
        apps/web/test/api-digest-day.test.ts
git commit -m "feat(web/api): /api/digest/day/[date] GET + POST SSE

- GET: read-only (cache or 'pending')
- POST: streams pipeline events (status/entry/digest/saved/done)
- Coalesces concurrent POSTs by (date, force); force=1 never coalesces
- Delegates to runDayDigestPipeline from @claude-lens/entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of Chunk 3.** Pipeline + API + race prevention land together. End-to-end enrichment+digest works from both CLI and web.

---

## Chunk 4: Page + home additions + smoke

### Task 18: `<DayDigest>` presentational component

**Files:**
- Create: `apps/web/components/day-digest.tsx`

Pure function of `DayDigest`. No state, no hooks. Simple structural rendering; styling matches the existing insight-report idiom (af-panel, af-border-subtle, var(--af-accent), etc.).

- [ ] **Step 1: Implement the component**

Create `apps/web/components/day-digest.tsx`:

```tsx
import type { DayDigest as DayDigestType } from "@claude-lens/entries";

export function DayDigest({ digest, aiEnabled }: { digest: DayDigestType; aiEnabled: boolean }) {
  const fmtDate = new Date(`${digest.key}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "28px 40px", maxWidth: 1080 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{fmtDate}</h1>
        {digest.headline && (
          <p style={{ fontSize: 18, marginTop: 8, color: "var(--af-text)", maxWidth: 820 }}>
            {digest.headline}
          </p>
        )}
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {Math.round(digest.agent_min)}m agent time · {digest.projects.length} project{digest.projects.length === 1 ? "" : "s"} · {digest.shipped.length} PR{digest.shipped.length === 1 ? "" : "s"} shipped · peak concurrency ×{digest.concurrency_peak}
        </p>
      </header>

      {!aiEnabled && (
        <div className="af-panel" style={{ padding: 18, borderLeft: "3px solid var(--af-accent)" }}>
          Enable AI features in <a href="/settings">Settings</a> to see daily narratives.
        </div>
      )}

      {digest.narrative && <Block label="Narrative">{digest.narrative}</Block>}

      {(digest.what_went_well || digest.what_hit_friction) && (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {digest.what_went_well && <Block label="What went well">{digest.what_went_well}</Block>}
          {digest.what_hit_friction && <Block label="What hit friction">{digest.what_hit_friction}</Block>}
        </section>
      )}

      {digest.suggestion && (
        <Block label="Suggestion">
          <p style={{ fontWeight: 600, marginBottom: 6 }}>{digest.suggestion.headline}</p>
          <p>{digest.suggestion.body}</p>
        </Block>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {digest.projects.length > 0 && (
          <Block label="Projects">
            {digest.projects.map(p => (
              <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, fontSize: 13 }}>
                <span>{p.display_name}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)" }}>
                  {Math.round(p.share_pct)}%
                </span>
              </div>
            ))}
          </Block>
        )}
        {digest.shipped.length > 0 && (
          <Block label="Shipped">
            {digest.shipped.map((s, i) => (
              <div key={i} style={{ fontSize: 13, padding: "2px 0" }}>
                <span style={{ color: "var(--af-text-tertiary)", fontSize: 11 }}>{s.project}</span>
                {" · "}{s.title}
              </div>
            ))}
          </Block>
        )}
      </section>

      {digest.top_goal_categories.length > 0 && (
        <Block label="Goal mix">
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min} />
        </Block>
      )}

      {digest.entry_refs.length > 0 && (
        <Block label={`Entries · ${digest.entry_refs.length}`}>
          {digest.entry_refs.map(ref => {
            const [sessionId, day] = ref.split("__");
            return (
              <a key={ref} href={`/sessions/${sessionId}`}
                 style={{ display: "block", fontSize: 12, fontFamily: "var(--font-mono)", padding: "2px 0", color: "var(--af-text-secondary)" }}>
                {sessionId} <span style={{ color: "var(--af-text-tertiary)" }}>· {day}</span>
              </a>
            );
          })}
        </Block>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="af-panel" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </div>
      <div>{children}</div>
    </section>
  );
}

const GOAL_COLORS: Record<string, string> = {
  build: "var(--af-accent)", plan: "#9f7aea", debug: "#ed8936",
  review: "#4299e1", refactor: "#38b2ac", test: "#48bb78",
  release: "#ed64a6", research: "#a0aec0", steer: "#f6ad55",
  meta: "#718096", warmup_minimal: "#cbd5e0",
};

function GoalBar({ goals, total }: { goals: { category: string; minutes: number }[]; total: number }) {
  if (total === 0) return <p style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>No goal data.</p>;
  return (
    <div style={{ display: "flex", gap: 2, height: 18, borderRadius: 4, overflow: "hidden" }}>
      {goals.map(g => {
        const pct = (g.minutes / total) * 100;
        return (
          <div key={g.category}
            style={{ width: `${pct}%`, background: GOAL_COLORS[g.category] ?? "#888", fontSize: 10, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            title={`${g.category}: ${Math.round(g.minutes)}m (${pct.toFixed(0)}%)`}>
            {pct > 10 ? g.category : ""}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @claude-lens/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/day-digest.tsx
git commit -m "feat(web): DayDigest presentational component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `<DayDigestView>` client wrapper with Regenerate button + SSE handling

**Files:**
- Create: `apps/web/components/day-digest-view.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/components/day-digest-view.tsx`:

```tsx
"use client";
import { useState, useCallback } from "react";
import { DayDigest as DayDigestRender } from "./day-digest";
import type { DayDigest as DayDigestType } from "@claude-lens/entries";

type Status = "idle" | "streaming" | "done" | "error";

export function DayDigestView({
  initial, date, aiEnabled,
}: {
  initial: DayDigestType | null;
  date: string;
  aiEnabled: boolean;
}) {
  const [digest, setDigest] = useState<DayDigestType | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string>("");

  const regenerate = useCallback(async (force = false) => {
    setStatus("streaming");
    setProgress("Starting...");
    const url = `/api/digest/day/${date}${force ? "?force=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok || !res.body) { setStatus("error"); setProgress(`Error ${res.status}`); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() ?? "";
      for (const frame of lines) {
        const dataLine = frame.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "status") setProgress(ev.text);
          else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}...`);
          else if (ev.type === "digest") { setDigest(ev.digest); setProgress("Rendering..."); }
          else if (ev.type === "saved") setProgress(`Saved.`);
          else if (ev.type === "error") { setStatus("error"); setProgress(ev.message); return; }
        } catch { /* skip */ }
      }
    }
    setStatus("done");
    setProgress("");
  }, [date]);

  const isStreaming = status === "streaming";

  return (
    <>
      <div style={{ display: "flex", gap: 10, padding: "14px 40px 0", alignItems: "center" }}>
        <button
          onClick={() => regenerate(true)}
          disabled={isStreaming}
          style={{ padding: "6px 12px", border: "1px solid var(--af-border-subtle)", borderRadius: 6, background: "transparent", cursor: "pointer", fontSize: 12 }}>
          🔄 {isStreaming ? "Regenerating..." : "Regenerate"}
        </button>
        {progress && <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{progress}</span>}
      </div>

      {digest ? (
        <DayDigestRender digest={digest} aiEnabled={aiEnabled} />
      ) : (
        <div style={{ padding: 40, textAlign: "center", color: "var(--af-text-secondary)" }}>
          <p>No digest generated yet.</p>
          <button onClick={() => regenerate(false)} disabled={isStreaming}
            style={{ padding: "8px 16px", marginTop: 10, background: "var(--af-accent)", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>
            {isStreaming ? "Generating..." : "Generate digest"}
          </button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @claude-lens/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/day-digest-view.tsx
git commit -m "feat(web): DayDigestView client wrapper (SSE + Regenerate)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: `/digest/[date]` page + loading skeleton

**Files:**
- Create: `apps/web/app/digest/[date]/page.tsx`
- Create: `apps/web/app/digest/[date]/loading.tsx`

- [ ] **Step 1: Write the page**

Create `apps/web/app/digest/[date]/page.tsx`:

```tsx
import { readDayDigest, listEntriesForDay } from "@claude-lens/entries/fs";
import { readSettings, buildDeterministicDigest } from "@claude-lens/entries/node";
import { isValidDate, todayLocal } from "@/lib/entries";
import { DayDigestView } from "@/components/day-digest-view";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DigestDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDate(date)) return notFound();

  const today = todayLocal();
  if (date > today) {
    return (
      <div style={{ padding: "40px" }}>
        <h1>Future date</h1>
        <p>Digests only exist for past and current days.</p>
        <Link href={`/digest/${today}`}>Go to today →</Link>
      </div>
    );
  }

  const settings = readSettings();
  const aiEnabled = settings.ai_features.enabled;

  // For past days, try cache first; fall back to deterministic build from entries.
  // For today, always build fresh deterministic (AI path is regenerate-click-triggered).
  let initial = null as Awaited<ReturnType<typeof readDayDigest>>;
  if (date !== today) {
    initial = readDayDigest(date);
  }
  if (!initial) {
    const entries = listEntriesForDay(date);
    if (entries.length > 0) {
      initial = buildDeterministicDigest(date, entries);
    }
  }

  return (
    <div>
      <nav style={{ padding: "14px 40px", display: "flex", gap: 14, fontSize: 12, borderBottom: "1px solid var(--af-border-subtle)" }}>
        <PrevNextDay date={date} today={today} />
      </nav>
      <DayDigestView initial={initial} date={date} aiEnabled={aiEnabled} />
    </div>
  );
}

function PrevNextDay({ date, today }: { date: string; today: string }) {
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  return (
    <>
      <Link href={`/digest/${prev}`}>← Prev day</Link>
      {next <= today && <Link href={`/digest/${next}`}>Next day →</Link>}
      {date !== today && <Link href={`/digest/${today}`} style={{ marginLeft: "auto" }}>Today →</Link>}
    </>
  );
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Write the loading skeleton**

Create `apps/web/app/digest/[date]/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div style={{ padding: "40px", color: "var(--af-text-secondary)" }}>
      Loading digest…
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke**

Run the dev server; visit `/digest/yesterday` (use an actual YYYY-MM-DD for yesterday).
Expected: page renders deterministic digest if AI is off; shows regenerate button.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/digest/[date]/page.tsx apps/web/app/digest/[date]/loading.tsx
git commit -m "feat(web): /digest/[date] page + loading skeleton

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: `<YesterdayHero>` home card

**Files:**
- Create: `apps/web/components/yesterday-hero.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/components/yesterday-hero.tsx`:

```tsx
import Link from "next/link";
import { readDayDigest, listEntriesForDay } from "@claude-lens/entries/fs";
import { buildDeterministicDigest, readSettings } from "@claude-lens/entries/node";
import type { DayDigest } from "@claude-lens/entries";
import { yesterdayLocal, toLocalDay } from "@/lib/entries";

function fmtDateShort(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = /^[^.!?]+[.!?]/.exec(s);
  return m ? m[0] : s;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Returns the most recent local day (<= today) that has any entries.
 * Walks back up to 30 days before giving up.
 */
function mostRecentActiveDay(): string | null {
  for (let i = 1; i <= 30; i++) {
    const d = toLocalDay(Date.now() - i * 86_400_000);
    if (listEntriesForDay(d).length > 0) return d;
  }
  return null;
}

export function YesterdayHero() {
  const aiEnabled = readSettings().ai_features.enabled;
  const yesterday = yesterdayLocal();
  let date = yesterday;
  let entries = listEntriesForDay(yesterday);
  let fallback = false;

  if (entries.length === 0) {
    const recent = mostRecentActiveDay();
    if (recent) {
      date = recent;
      entries = listEntriesForDay(recent);
      fallback = true;
    }
  }

  if (entries.length === 0) {
    return (
      <div className="af-panel" style={{ padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--af-text-secondary)" }}>
          No recent activity yet. Once you run some Claude Code sessions, your daily digest will appear here.
        </p>
      </div>
    );
  }

  let digest: DayDigest | null = readDayDigest(date);
  if (!digest) digest = buildDeterministicDigest(date, entries);

  const headline = digest.headline
    ?? `Worked ${Math.round(digest.agent_min)}m across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}${digest.shipped.length > 0 ? `; shipped ${digest.shipped.length} PR${digest.shipped.length === 1 ? "" : "s"}` : ""}.`;

  const wentWell = firstSentence(digest.what_went_well);
  const friction = firstSentence(digest.what_hit_friction);

  return (
    <div className="af-panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          {fallback ? "Last active" : "Yesterday"} · {fmtDateShort(date)}
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: "8px 0 0", lineHeight: 1.35 }}>
          {truncate(headline, 180)}
        </h2>
      </div>
      <div style={{ fontSize: 12, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)" }}>
        {Math.round(digest.agent_min)}m agent time · {digest.projects.length} projects · {digest.shipped.length} PRs shipped
      </div>
      {(wentWell || friction) && (
        <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          {wentWell && <div><span style={{ color: "#48bb78" }}>✓</span> {truncate(wentWell, 160)}</div>}
          {friction && <div><span style={{ color: "#ed8936" }}>⚠</span> {truncate(friction, 160)}</div>}
        </div>
      )}
      {!aiEnabled && (
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          <Link href="/settings" style={{ color: "var(--af-accent)" }}>Enable AI features</Link> to see daily narratives.
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <Link href={`/digest/${date}`} style={{ fontSize: 12, color: "var(--af-accent)" }}>
          Open full digest →
        </Link>
        <Link href="/insights" style={{ fontSize: 12, color: "var(--af-accent)" }}>
          Weekly insight report →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/yesterday-hero.tsx
git commit -m "feat(web): YesterdayHero home card (narrative + stats + CTAs)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: `<RecentDaysPanel>` home bottom-row panel

**Files:**
- Create: `apps/web/components/recent-days-panel.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/components/recent-days-panel.tsx`:

```tsx
import Link from "next/link";
import { listEntriesForDay } from "@claude-lens/entries/fs";
import { toLocalDay } from "@/lib/entries";

type Row = { date: string; label: string; agentMin: number; prs: number };

export function RecentDaysPanel() {
  const now = Date.now();
  const rows: Row[] = [];

  for (let i = 0; i < 5; i++) {
    const d = toLocalDay(now - i * 86_400_000);
    const entries = listEntriesForDay(d);
    const agentMin = entries.reduce((s, e) => s + e.numbers.active_min, 0);
    const prs = entries.reduce((s, e) => s + e.pr_titles.length, 0);

    const label = i === 0 ? "Today"
      : i === 1 ? "Yesterday"
      : new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    rows.push({ date: d, label, agentMin, prs });
  }

  return (
    <div className="af-panel">
      <div className="af-panel-header">
        <span>Recent days</span>
      </div>
      <div>
        {rows.map(r => (
          <Link key={r.date} href={`/digest/${r.date}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 12,
              padding: "10px 18px",
              fontSize: 12,
              borderBottom: "1px solid var(--af-border-subtle)",
              alignItems: "center",
            }}>
            <span>{r.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", fontSize: 11 }}>
              {r.agentMin > 0 ? `${Math.round(r.agentMin)}m` : "—"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", fontSize: 11, minWidth: 42, textAlign: "right" }}>
              {r.prs > 0 ? `${r.prs} PR${r.prs === 1 ? "" : "s"}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/recent-days-panel.tsx
git commit -m "feat(web): RecentDaysPanel home component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Wire Yesterday hero + Recent days into home page

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Add the hero**

In `apps/web/app/page.tsx`:

1. Add imports at the top:

```tsx
import { YesterdayHero } from "@/components/yesterday-hero";
import { RecentDaysPanel } from "@/components/recent-days-panel";
```

2. Insert `<YesterdayHero />` between the `<header>` block and the `<DashboardView sessions={sessions} />` line.

3. In the bottom-row section, change:

```tsx
<section
  style={{
    display: "grid",
    gridTemplateColumns: "1fr 1.4fr",
    gap: 16,
  }}
>
```

to:

```tsx
<section
  style={{
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, 1.4fr) minmax(260px, 1fr)",
    gap: 16,
  }}
>
```

4. Add `<RecentDaysPanel />` as the third child of that section (after the existing Top projects and Recent sessions panels).

- [ ] **Step 2: Spot check**

Run the dev server. Visit `/`.
Verify:
- Yesterday hero card appears above the metric cards.
- Bottom row has three panels; Recent days is rightmost.
- Hero headline + stats render even if AI features are off (deterministic template).
- Clicking "Open full digest →" navigates to `/digest/<yesterday>`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(web/home): YesterdayHero + RecentDaysPanel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Smoke — add `/digest/[yesterday]`

**Files:**
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Add the route**

In `scripts/smoke.mjs`, inside `main()` right after the existing `/settings` push (from Task 2):

```js
// Compute yesterday in the runner's local TZ so the route isn't flaky around midnight.
const y = new Date(Date.now() - 86_400_000);
const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
results.push(await hit(`/digest/${yesterday}`, "Digest (yesterday)"));
```

- [ ] **Step 2: Verify**

Run: `node scripts/smoke.mjs`
Expected: `✓ Digest (yesterday)` in the output.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test(smoke): cover /digest/[yesterday]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**End of Chunk 4. Phase 2 complete.**

---

## Final verification (not a commit)

Run the full suite before opening the PR:

```bash
pnpm -F @claude-lens/entries typecheck && pnpm -F @claude-lens/entries test
pnpm -F @claude-lens/web typecheck && pnpm -F @claude-lens/web test
pnpm -F fleetlens typecheck && pnpm -F fleetlens test
pnpm verify       # runs smoke against the dev server
```

All expected to pass. V1 insights regression guard (`scripts/v1-insights-regression.mjs`) should still show byte-equal output.

### Manual dogfood before merging

1. `node packages/cli/dist/index.js stop; rm -rf apps/web/.next packages/cli/app && NEXT_OUTPUT=standalone pnpm -F @claude-lens/web build && node scripts/prepare-cli.mjs && node packages/cli/dist/index.js web usage --no-open`
2. Open `/` — verify Yesterday hero renders with real narrative.
3. Open `/digest/<yesterday>` — verify full layout, narrative, goal-mix bar, entries list. Click Regenerate — SSE streams properly.
4. Run `node packages/cli/dist/index.js digest day --today --pretty` — verify live deterministic output.
5. Toggle AI off in `/settings`, reload `/` — verify deterministic-template hero + "Enable AI features" nudge.
6. Toggle AI back on, visit a previously-AI-off-cached past day, click Regenerate — new narrative overwrites cached.

## Summary

24 tasks across 4 chunks. Each task is one commit; each step inside a task is 2–5 minutes.

## Test plan

- Unit: `@claude-lens/entries` — settings defaults, digest deterministic, digest generate (mock LLM), digest-fs, pipeline-lock, queue-lockout.
- Unit: `@claude-lens/web` — api-settings Zod, api-digest-day GET/POST.
- Integration: `fleetlens digest day` fixture-driven CLI.
- Smoke: `/settings` + `/digest/<yesterday>`.
- Manual: dogfood steps 1–6 above.

## Notes for the executing agent

- **Follow tasks in order.** Chunk 1 lands foundations; Chunk 2 is TDD-heavy; Chunk 3 adds concurrency-critical surfaces; Chunk 4 is mostly UI.
- **Each task is one commit.** Do not batch.
- **Use @superpowers:test-driven-development.** Tests first; verify fail before implementing; verify pass after.
- **Use @superpowers:verification-before-completion.** Run the stated command and confirm expected output before marking a step done.
- **Master spec:** `docs/superpowers/specs/2026-04-22-perception-layer-design.md` (Phase 1+2 design).
- **Phase 2 spec:** `docs/superpowers/specs/2026-04-24-perception-layer-phase-2-design.md` (this plan implements it).
- **If a test is hard to write, re-read the spec section it tests** — the spec is the source of truth; the plan is a decomposition.
- **If a task feels underspecified, stop and check in with the user rather than guessing.**
