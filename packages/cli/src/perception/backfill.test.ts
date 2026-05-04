import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setSettingsPathForTest, writeSettings,
} from "@claude-lens/entries/node";
import { __setEntriesDirForTest, __setDigestsDirForTest } from "@claude-lens/entries/fs";
import { backfillLastWeekDigest, lastCompletedWeekMonday } from "./backfill.js";

// Pin clock to a known Sunday so lastCompletedWeekMonday is deterministic.
// Sunday 2026-04-26 12:00 local → last completed week starts Mon 2026-04-13.
const FROZEN_NOW = new Date("2026-04-26T12:00:00").getTime();
const EXPECTED_MONDAY = "2026-04-13";

function makeEntry(localDay: string, sessionId: string) {
  return {
    schema_version: 1,
    session_id: sessionId,
    local_day: localDay,
    project: "/Users/test/repo/foo",
    project_canonical: "/Users/test/repo/foo",
    project_dir: "-Users-test-repo-foo",
    start_iso: `${localDay}T10:00:00.000Z`,
    end_iso: `${localDay}T10:30:00.000Z`,
    numbers: {
      active_min: 30, turn_count: 5, tools_total: 10,
      subagent_calls: 0, skill_calls: 0, exit_plan_calls: 0,
      interrupts: 0, prs: 0, tokens_in: 100, tokens_out: 200,
    },
    tools_top: [],
    flags: [],
    pr_titles: [],
    enrichment: { status: "pending" as const },
    source_checkpoint: { byte_offset: 1024 },
  };
}

describe("backfillLastWeekDigest gates", () => {
  let tmp: string;
  let entriesDir: string;
  let digestsDir: string;
  let lockFile: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "backfill-"));
    entriesDir = join(tmp, "entries");
    digestsDir = join(tmp, "digests");
    lockFile = join(tmp, "auto-week-fired-at");
    mkdirSync(entriesDir, { recursive: true });
    mkdirSync(digestsDir, { recursive: true });
    __setSettingsPathForTest(join(tmp, "settings.json"));
    __setEntriesDirForTest(entriesDir);
    __setDigestsDirForTest(digestsDir);
    process.env.CCLENS_AUTO_WEEK_FILE = lockFile;

    // Default: AI on, autofill on. Override per test.
    writeSettings({
      ai_features: {
        enabled: true,
        model: "sonnet",
        monthlyBudgetUsd: null,
        autoBackfillLastWeek: true,
      },
    });
  });

  it("lastCompletedWeekMonday: Sunday → previous Monday", () => {
    expect(lastCompletedWeekMonday(FROZEN_NOW)).toBe(EXPECTED_MONDAY);
  });

  it("ai_disabled: skip when AI features off", async () => {
    writeSettings({
      ai_features: {
        enabled: false, model: "sonnet", monthlyBudgetUsd: null, autoBackfillLastWeek: true,
      },
    });
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "ai_disabled", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
    expect(existsSync(lockFile)).toBe(false);
  });

  it("autofill_disabled: skip when only the auto-backfill flag is off", async () => {
    writeSettings({
      ai_features: {
        enabled: true, model: "sonnet", monthlyBudgetUsd: null, autoBackfillLastWeek: false,
      },
    });
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "autofill_disabled", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("already_cached: skip when last week's digest exists on disk", async () => {
    const weekDir = join(digestsDir, "week");
    mkdirSync(weekDir, { recursive: true });
    writeFileSync(join(weekDir, `${EXPECTED_MONDAY}.json`), JSON.stringify({
      schema_version: 1, scope: "week", key: EXPECTED_MONDAY,
      window: { start_local_day: EXPECTED_MONDAY, end_local_day: "2026-04-19" },
      agent_min_total: 0, projects: [], shipped: [], outcome_mix: {},
      generated_iso: "2026-04-20T00:00:00.000Z", generation_ms: 1, model: null,
    }));
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "already_cached", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("no_entries: skip when no entries exist for any day in last week", async () => {
    // Entries dir is empty — `listEntriesForDay` returns [] for every date.
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "no_entries", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
    // The no_entries gate runs BEFORE the lock — so the lock file is still untouched.
    expect(existsSync(lockFile)).toBe(false);
  });

  it("already_fired_this_week: skip when lock file already records this Monday", async () => {
    // Pre-seed the lock with the same Monday — shouldAutoFireWeek will return false.
    writeFileSync(lockFile, EXPECTED_MONDAY + "\n");
    // Also need at least one entry so we get past the no_entries gate.
    const day = "2026-04-15";
    const e = makeEntry(day, "abc-123");
    const key = `${e.session_id}__${day}`;
    writeFileSync(join(entriesDir, `${key}.json`), JSON.stringify(e));
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "already_fired_this_week", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("ok: fires the pipeline when all gates open and consumes the week lock", async () => {
    const day = "2026-04-15";
    const e = makeEntry(day, "abc-123");
    const key = `${e.session_id}__${day}`;
    writeFileSync(join(entriesDir, `${key}.json`), JSON.stringify(e));

    const fakePipeline = vi.fn(async function* () {
      yield { type: "saved", path: "/fake/path/2026-04-13.json" };
      yield { type: "digest", digest: { scope: "week", key: EXPECTED_MONDAY } as never };
    });
    const logs: Array<[string, string]> = [];
    const r = await backfillLastWeekDigest({
      now: FROZEN_NOW,
      runPipeline: fakePipeline as never,
      log: (lvl, msg) => logs.push([lvl, msg]),
    });

    expect(r).toEqual({ fired: true, reason: "ok", key: EXPECTED_MONDAY });
    expect(fakePipeline).toHaveBeenCalledTimes(1);
    const call = fakePipeline.mock.calls[0] as unknown as [string, {
      caller: string; todayLocalDay: string; currentWeekMonday: string;
    }];
    expect(call[0]).toBe(EXPECTED_MONDAY);
    expect(call[1].caller).toBe("daemon");
    expect(call[1].todayLocalDay).toBe("2026-04-26");
    expect(call[1].currentWeekMonday).toBe("2026-04-20");

    // Lock was consumed and now records last week's Monday.
    expect(readFileSync(lockFile, "utf8").trim()).toBe(EXPECTED_MONDAY);
    expect(logs.some(([lvl, m]) => lvl === "info" && m.includes(`fired week-${EXPECTED_MONDAY}`))).toBe(true);
  });
});
