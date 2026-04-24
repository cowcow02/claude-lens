import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEnrichmentQueue } from "../src/queue.js";
import {
  __setInteractiveLockPathForTest, writeInteractiveLock, removeInteractiveLock,
} from "../src/pipeline-lock.js";
import { __setEntriesDirForTest } from "../src/fs.js";
import type { AiFeaturesSettings } from "../src/settings.js";

const SETTINGS: AiFeaturesSettings = {
  enabled: true, model: "sonnet", monthlyBudgetUsd: null,
};

describe("runEnrichmentQueue lockout", () => {
  let lockDir: string, entriesDir: string, lockPath: string;
  beforeEach(() => {
    lockDir = mkdtempSync(join(tmpdir(), "lock-"));
    entriesDir = mkdtempSync(join(tmpdir(), "entries-"));
    lockPath = join(lockDir, "llm-interactive.lock");
    __setInteractiveLockPathForTest(lockPath);
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
    expect(r).toMatchObject({ enriched: 0, errors: 0, skipped: 0 });
  });

  it("proceeds when lock is stale (simulated 90s clock skew)", async () => {
    writeFileSync(lockPath, String(process.pid));
    const r = await runEnrichmentQueue(SETTINGS, { now: () => Date.now() + 90_000 });
    expect(r).toMatchObject({ enriched: 0, errors: 0, skipped: 0 });
  });
});
