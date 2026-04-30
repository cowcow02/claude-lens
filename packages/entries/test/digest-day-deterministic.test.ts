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

  it("respects concurrencyPeak from opts", () => {
    const d = buildDeterministicDigest("2026-04-23", [mkEntry()], { concurrencyPeak: 5 });
    expect(d.concurrency_peak).toBe(5);
  });

  it("outcome_day prioritizes shipped over everything else", () => {
    const entries = [
      mkEntry({ enrichment: { ...mkEntry().enrichment, status: "done", outcome: "trivial" } }),
      mkEntry({ session_id: "s2", enrichment: { ...mkEntry().enrichment, status: "done", outcome: "shipped" } }),
      mkEntry({ session_id: "s3", enrichment: { ...mkEntry().enrichment, status: "done", outcome: "blocked" } }),
    ];
    expect(buildDeterministicDigest("2026-04-23", entries).outcome_day).toBe("shipped");
  });

  it("outcome_day falls back to trivial when no substantive work", () => {
    const entries = [
      mkEntry({ enrichment: { ...mkEntry().enrichment, status: "done", outcome: "trivial" } }),
      mkEntry({ session_id: "s2", enrichment: { ...mkEntry().enrichment, status: "done", outcome: "trivial" } }),
    ];
    expect(buildDeterministicDigest("2026-04-23", entries).outcome_day).toBe("trivial");
  });

  it("outcome_day is idle when entries list is empty", () => {
    expect(buildDeterministicDigest("2026-04-23", []).outcome_day).toBe("idle");
  });

  it("helpfulness_day is null when no entries are enriched", () => {
    const d = buildDeterministicDigest("2026-04-23", [mkEntry()]);
    expect(d.helpfulness_day).toBeNull();
  });

  it("helpfulness_day returns the mode, tiebreaking toward worse signal", () => {
    const entries = [
      mkEntry({ enrichment: { ...mkEntry().enrichment, status: "done", claude_helpfulness: "helpful" } }),
      mkEntry({ session_id: "s2", enrichment: { ...mkEntry().enrichment, status: "done", claude_helpfulness: "unhelpful" } }),
    ];
    // 1 vs 1: tie, tiebreak → "unhelpful" (worse signal).
    expect(buildDeterministicDigest("2026-04-23", entries).helpfulness_day).toBe("unhelpful");
  });

  it("helpfulness_day picks majority when not tied", () => {
    const entries = [
      mkEntry({ enrichment: { ...mkEntry().enrichment, status: "done", claude_helpfulness: "helpful" } }),
      mkEntry({ session_id: "s2", enrichment: { ...mkEntry().enrichment, status: "done", claude_helpfulness: "helpful" } }),
      mkEntry({ session_id: "s3", enrichment: { ...mkEntry().enrichment, status: "done", claude_helpfulness: "unhelpful" } }),
    ];
    expect(buildDeterministicDigest("2026-04-23", entries).helpfulness_day).toBe("helpful");
  });
});
