import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
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
    session_id,
    local_day,
    project: "/repo/test",
    start_iso: "2026-04-22T00:00:00Z",
    end_iso: "2026-04-22T01:00:00Z",
    numbers: {
      active_min: 30, turn_count: 5, tools_total: 3, subagent_calls: 0, skill_calls: 0,
      task_ops: 0, interrupts: 0, tool_errors: 0, consec_same_tool_max: 1, exit_plan_calls: 0,
      prs: 0, commits: 0, pushes: 0, tokens_total: 1000,
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
    user_input_sources: { human: 1, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: pendingEnrichment(),
    generated_at: "2026-04-22T00:00:00Z",
    source_jsonl: "",
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
    writeFileSync(path, "{not json");
    expect(() => readEntry("bad", "2026-04-22")).toThrow();
  });
});
