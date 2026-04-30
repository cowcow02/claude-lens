import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeEntry,
  writeEntryPreservingEnrichment,
  readEntry,
  listEntriesForDay,
  listEntriesForSession,
  listEntriesWithStatus,
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

describe("writeEntryPreservingEnrichment", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "entries-merge-test-"));
    __setEntriesDirForTest(tmp);
  });

  it("preserves 'done' enrichment when deterministic input is unchanged", () => {
    // Existing entry on disk: deterministic facets + completed enrichment.
    const existing = makeEntry("sess-1", "2026-04-22");
    existing.enrichment = {
      status: "done",
      retry_count: 0,
      brief_summary: "shipped a thing",
      friction_detail: null,
      outcome: "shipped",
      goal_categories: { build: 30 },
      user_instructions: ["do the thing"],
      satisfaction_signal_breakdown: null,
      user_input_breakdown: null,
      cost_usd: 0.05,
      model: "sonnet",
      error: null,
      enriched_at: "2026-04-22T01:00:00Z",
    };
    writeEntry(existing);

    // Perception sweep rebuilds from JSONL — fresh entry has pending
    // enrichment but the SAME deterministic facets (no events appended,
    // counts identical, end_iso unchanged). This is the common case during
    // a state-reset re-sweep: same data on disk, just rebuilt.
    const fresh = makeEntry("sess-1", "2026-04-22");
    writeEntryPreservingEnrichment(fresh);

    const after = readEntry("sess-1", "2026-04-22")!;
    expect(after.enrichment.status).toBe("done");
    expect(after.enrichment.brief_summary).toBe("shipped a thing");
    expect(after.enrichment.cost_usd).toBe(0.05);
  });

  it("invalidates 'done' enrichment when entry has grown (more events)", () => {
    // Prior enrichment described a 30m / 5-turn snapshot. The session
    // continued — fresh entry has 45m / 7 turns + new PR shipped. The old
    // brief_summary is stale (described less work than now exists), so the
    // helper should drop the prior enrichment back to pending and let the
    // next pipeline run re-enrich against the current entry shape.
    const existing = makeEntry("sess-grow", "2026-04-22");
    existing.enrichment = {
      ...existing.enrichment,
      status: "done",
      brief_summary: "small partial",
      outcome: "partial",
      cost_usd: 0.02,
      enriched_at: "2026-04-22T01:00:00Z",
    };
    writeEntry(existing);

    const fresh = makeEntry("sess-grow", "2026-04-22");
    fresh.numbers.active_min = 45;
    fresh.numbers.turn_count = 7;
    fresh.pr_titles = ["feat: shipped the rest"];
    fresh.end_iso = "2026-04-22T02:30:00Z";
    writeEntryPreservingEnrichment(fresh);

    const after = readEntry("sess-grow", "2026-04-22")!;
    // Deterministic facets reflect the rebuild
    expect(after.numbers.active_min).toBe(45);
    expect(after.pr_titles).toEqual(["feat: shipped the rest"]);
    // Stale enrichment dropped — re-enrichable
    expect(after.enrichment.status).toBe("pending");
    expect(after.enrichment.brief_summary).toBeNull();
  });

  it("preserves 'skipped_trivial' enrichment", () => {
    const existing = makeEntry("sess-2", "2026-04-22");
    existing.enrichment = { ...existing.enrichment, status: "skipped_trivial" };
    writeEntry(existing);

    const fresh = makeEntry("sess-2", "2026-04-22");
    writeEntryPreservingEnrichment(fresh);

    expect(readEntry("sess-2", "2026-04-22")!.enrichment.status).toBe("skipped_trivial");
  });

  it("overwrites 'pending' enrichment with the fresh entry", () => {
    // Pending status means no LLM work has been committed yet — safe to replace.
    const existing = makeEntry("sess-3", "2026-04-22");
    existing.numbers.active_min = 10;
    writeEntry(existing); // status defaults to pending via pendingEnrichment()

    const fresh = makeEntry("sess-3", "2026-04-22");
    fresh.numbers.active_min = 20;
    writeEntryPreservingEnrichment(fresh);

    expect(readEntry("sess-3", "2026-04-22")!.numbers.active_min).toBe(20);
  });

  it("overwrites 'error' enrichment with the fresh entry", () => {
    // Error means a prior enrichment attempt failed — re-running is fine.
    const existing = makeEntry("sess-4", "2026-04-22");
    existing.enrichment = {
      ...existing.enrichment, status: "error", retry_count: 2, error: "boom",
    };
    writeEntry(existing);

    const fresh = makeEntry("sess-4", "2026-04-22");
    writeEntryPreservingEnrichment(fresh);

    const after = readEntry("sess-4", "2026-04-22")!;
    expect(after.enrichment.status).toBe("pending");
    expect(after.enrichment.retry_count).toBe(0);
    expect(after.enrichment.error).toBeNull();
  });

  it("writes fresh entry verbatim when no existing file", () => {
    const fresh = makeEntry("sess-5", "2026-04-22");
    writeEntryPreservingEnrichment(fresh);

    expect(readEntry("sess-5", "2026-04-22")?.session_id).toBe("sess-5");
  });
});

describe("listEntriesWithStatus", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "entries-status-"));
    __setEntriesDirForTest(tmp);
  });

  function mk(session_id: string, local_day: string, status: "pending" | "done" | "error" | "skipped_trivial"): Entry {
    const base = makeEntry(session_id, local_day);
    return { ...base, enrichment: { ...base.enrichment, status } };
  }

  it("returns only entries matching the requested status and orders oldest-first", () => {
    writeEntry(mk("sess-2026-04-01", "2026-04-01", "pending"));
    writeEntry(mk("sess-2026-04-15", "2026-04-15", "pending"));
    writeEntry(mk("sess-2026-04-20", "2026-04-20", "pending"));
    writeEntry(mk("sess-2026-04-05", "2026-04-05", "done"));
    writeEntry(mk("sess-2026-04-18", "2026-04-18", "done"));
    writeEntry(mk("sess-2026-04-10", "2026-04-10", "error"));

    const pending = listEntriesWithStatus(["pending"]);
    expect(pending).toHaveLength(3);
    expect(pending.map(e => e.local_day)).toEqual(["2026-04-01", "2026-04-15", "2026-04-20"]);

    const both = listEntriesWithStatus(["pending", "error"]);
    expect(both).toHaveLength(4);
    expect(both.map(e => e.local_day)).toEqual(["2026-04-01", "2026-04-10", "2026-04-15", "2026-04-20"]);
  });

  it("returns empty array when no entries match", () => {
    writeEntry(mk("sess-a", "2026-04-01", "done"));
    expect(listEntriesWithStatus(["error"])).toEqual([]);
  });
});

