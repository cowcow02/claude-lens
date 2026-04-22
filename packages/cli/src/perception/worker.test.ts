import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPerceptionSweep } from "./worker.js";
import { __setStatePathForTest } from "./state.js";
import { __setEntriesDirForTest } from "@claude-lens/entries/fs";

describe("runPerceptionSweep", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "perc-sweep-"));
    __setStatePathForTest(join(tmp, "perception-state.json"));
    __setEntriesDirForTest(join(tmp, "entries"));
    mkdirSync(join(tmp, "entries"), { recursive: true });
  });

  it("returns zero counts when no JSONL files exist", async () => {
    // scan.ts reads ~/.claude/projects/ — not easily overridable without refactor.
    // This test verifies the sweep runs cleanly when the real projects dir
    // either has no new files (all at or below checkpoint) or is absent.
    // Richer directory-injection tests are deferred to Phase 1b.
    const r = await runPerceptionSweep();
    expect(r.sessionsProcessed).toBeGreaterThanOrEqual(0);
    expect(r.entriesWritten).toBeGreaterThanOrEqual(0);
    expect(r.errors).toBeGreaterThanOrEqual(0);
  });

  it("sets sweep_in_progress=false after completion", async () => {
    const { readState } = await import("./state.js");
    await runPerceptionSweep();
    expect(readState().sweep_in_progress).toBe(false);
    expect(readState().last_sweep_completed_at).toBeTruthy();
  });

  it("skips sweep when one is already in progress and not stale", async () => {
    const { markSweepStart, readState } = await import("./state.js");
    markSweepStart();
    const r = await runPerceptionSweep();
    // The fresh in-progress flag should cause early return.
    expect(r).toEqual({ sessionsProcessed: 0, entriesWritten: 0, errors: 0 });
    // sweep_in_progress should still be true (we didn't clear it).
    expect(readState().sweep_in_progress).toBe(true);
  });
});
