import { describe, expect, it } from "vitest";
import { buildDeterministicWeekDigest, weekDates } from "../src/digest-week.js";
import type { DayDigest, Entry } from "../src/types.js";
import { CURRENT_DAY_DIGEST_SCHEMA_VERSION } from "../src/types.js";

function mkDay(overrides: Partial<DayDigest>): DayDigest {
  const base: DayDigest = {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION,
    scope: "day", key: "2026-04-20",
    window: { start: "2026-04-20T00:00:00", end: "2026-04-20T23:59:59" },
    entry_refs: [], generated_at: "2026-04-20T23:59:59Z",
    is_live: false, model: null, cost_usd: null,
    projects: [], shipped: [], top_flags: [], top_goal_categories: [],
    concurrency_peak: 0, agent_min: 0,
    outcome_day: "idle", helpfulness_day: null,
    headline: null, narrative: null,
    what_went_well: null, what_hit_friction: null, suggestion: null,
  };
  return { ...base, ...overrides };
}

describe("weekDates", () => {
  it("returns 7 consecutive dates Mon→Sun", () => {
    const dates = weekDates("2026-04-20"); // a Monday
    expect(dates).toEqual([
      "2026-04-20", "2026-04-21", "2026-04-22",
      "2026-04-23", "2026-04-24", "2026-04-25", "2026-04-26",
    ]);
  });
});

describe("buildDeterministicWeekDigest", () => {
  it("empty week yields zeroed digest", () => {
    const w = buildDeterministicWeekDigest("2026-04-20", []);
    expect(w.scope).toBe("week");
    expect(w.key).toBe("2026-04-20");
    expect(w.agent_min_total).toBe(0);
    expect(w.projects).toEqual([]);
    expect(w.shipped).toEqual([]);
    expect(w.outcome_mix).toEqual({});
    expect(w.helpfulness_sparkline).toEqual([null, null, null, null, null, null, null]);
    expect(w.headline).toBeNull();
  });

  it("sums agent_min across days", () => {
    const days = [
      mkDay({ key: "2026-04-20", agent_min: 60, outcome_day: "shipped" }),
      mkDay({ key: "2026-04-22", agent_min: 30, outcome_day: "partial" }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.agent_min_total).toBe(90);
  });

  it("aggregates outcome_mix across days", () => {
    const days = [
      mkDay({ key: "2026-04-20", outcome_day: "shipped" }),
      mkDay({ key: "2026-04-21", outcome_day: "shipped" }),
      mkDay({ key: "2026-04-22", outcome_day: "blocked" }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.outcome_mix).toEqual({ shipped: 2, blocked: 1 });
  });

  it("places helpfulness_day signals into Mon-Sun sparkline slots", () => {
    const days = [
      mkDay({ key: "2026-04-20", helpfulness_day: "essential" }),
      mkDay({ key: "2026-04-23", helpfulness_day: "neutral" }),
      mkDay({ key: "2026-04-26", helpfulness_day: "unhelpful" }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.helpfulness_sparkline).toEqual([
      "essential", null, null, "neutral", null, null, "unhelpful",
    ]);
  });

  it("aggregates shipped PRs with date attribution", () => {
    const days = [
      mkDay({
        key: "2026-04-21",
        shipped: [{ title: "ship phase 4", project: "fleetlens", session_id: "s1" }],
      }),
      mkDay({
        key: "2026-04-23",
        shipped: [{ title: "ship phase 5", project: "fleetlens", session_id: "s2" }],
      }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.shipped).toHaveLength(2);
    expect(w.shipped[0]).toMatchObject({ title: "ship phase 4", date: "2026-04-21" });
    expect(w.shipped[1]).toMatchObject({ title: "ship phase 5", date: "2026-04-23" });
  });

  it("picks the day with highest concurrency_peak", () => {
    const days = [
      mkDay({ key: "2026-04-20", concurrency_peak: 2 }),
      mkDay({ key: "2026-04-22", concurrency_peak: 5 }),
      mkDay({ key: "2026-04-24", concurrency_peak: 3 }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.concurrency_peak_day).toEqual({ date: "2026-04-22", peak: 5 });
  });

  it("returns null concurrency_peak_day when all days had peak 0", () => {
    const days = [
      mkDay({ key: "2026-04-20", concurrency_peak: 0 }),
      mkDay({ key: "2026-04-21", concurrency_peak: 0 }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.concurrency_peak_day).toBeNull();
  });

  it("aggregates top_flags by sum across days, top 5", () => {
    const days = [
      mkDay({ key: "2026-04-20", top_flags: [{ flag: "loop", count: 2 }, { flag: "fast_ship", count: 1 }] }),
      mkDay({ key: "2026-04-22", top_flags: [{ flag: "loop", count: 3 }, { flag: "warmup", count: 1 }] }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.top_flags[0]).toEqual({ flag: "loop", count: 5 });
    expect(w.top_flags).toHaveLength(3);
  });

  it("day_refs are sorted dates", () => {
    const days = [
      mkDay({ key: "2026-04-25" }),
      mkDay({ key: "2026-04-20" }),
      mkDay({ key: "2026-04-22" }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.day_refs).toEqual(["2026-04-20", "2026-04-22", "2026-04-25"]);
  });

  it("propagates dominant_shape from day_signals into days_active", () => {
    const days = [
      mkDay({
        key: "2026-04-20", agent_min: 60, outcome_day: "shipped",
        day_signals: {
          dominant_shape: "spec-review-loop", shape_distribution: { "spec-review-loop": 2 },
          skills_loaded: [], user_authored_skills_used: [], user_authored_subagents_used: [],
          prompt_frames: [],
          comm_style: {
            verbosity_distribution: { short: 0, medium: 0, long: 0, very_long: 0 },
            external_refs: [],
            steering: { interrupts: 0, frustrated: 0, dissatisfied: 0, sessions_with_mid_run_redirect: 0 },
          },
          brainstorm_warmup_session_count: 0, todo_ops_total: 0, plan_mode_used: false,
        },
      }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.days_active[0]?.dominant_shape).toBe("spec-review-loop");
  });

  it("computes working_shapes from day_signals (no entries needed)", () => {
    const days = [
      mkDay({
        key: "2026-04-20", agent_min: 60, outcome_day: "shipped",
        day_signature: "spec-review-loop on x: shipped clean",
        day_signals: {
          dominant_shape: "spec-review-loop",
          shape_distribution: { "spec-review-loop": 1 },
          skills_loaded: [], user_authored_skills_used: [], user_authored_subagents_used: [],
          prompt_frames: [],
          comm_style: {
            verbosity_distribution: { short: 0, medium: 0, long: 0, very_long: 0 },
            external_refs: [],
            steering: { interrupts: 0, frustrated: 0, dissatisfied: 0, sessions_with_mid_run_redirect: 0 },
          },
          brainstorm_warmup_session_count: 0, todo_ops_total: 0, plan_mode_used: false,
        },
      }),
    ];
    const w = buildDeterministicWeekDigest("2026-04-20", days);
    expect(w.working_shapes).not.toBeNull();
    const row = w.working_shapes!.find(r => r.shape === "spec-review-loop");
    expect(row).toBeDefined();
    expect(row!.occurrences[0]?.day_signature).toBe("spec-review-loop on x: shipped clean");
  });

  it("falls back to on-the-fly day_signals when DayDigest lacks them (cached pre-refactor digest)", () => {
    // DayDigest with no day_signals; entries provided through entriesByDay map.
    const day = mkDay({ key: "2026-04-20", agent_min: 60, outcome_day: "shipped" });
    const entry: Entry = {
      version: 2, session_id: "s1", local_day: "2026-04-20",
      project: "/x", start_iso: "2026-04-20T10:00:00Z", end_iso: "2026-04-20T11:00:00Z",
      numbers: {
        active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 2,
        skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
        consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0,
        pushes: 0, tokens_total: 0,
      },
      flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
      pr_titles: [], top_tools: [], skills: {},
      subagents: [
        { type: "general-purpose", description: "review the spec", background: false, prompt_preview: "review pass" },
        { type: "general-purpose", description: "re-review the spec", background: false, prompt_preview: "second review" },
      ],
      satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
      user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
      enrichment: {
        status: "pending", generated_at: null, model: null, cost_usd: null,
        error: null, brief_summary: null, underlying_goal: null,
        friction_detail: null, user_instructions: [], outcome: null,
        claude_helpfulness: null, goal_categories: {}, retry_count: 0,
      },
      generated_at: "2026-04-20T11:00:00Z", source_jsonl: "/",
      source_checkpoint: { byte_offset: 0, last_event_ts: null },
    };
    const entriesByDay = new Map<string, Entry[]>([["2026-04-20", [entry]]]);
    const w = buildDeterministicWeekDigest("2026-04-20", [day], { entriesByDay });
    // Falls back to inferWorkingShape via computeDaySignals; the entry's two
    // reviewer dispatches yield spec-review-loop.
    expect(w.working_shapes).not.toBeNull();
    expect(w.working_shapes!.find(r => r.shape === "spec-review-loop")).toBeDefined();
    // days_active uses the same fallback so the per-day shape stripe renders
    // for cached pre-refactor day digests once entries are passed in.
    expect(w.days_active[0]?.dominant_shape).toBe("spec-review-loop");
  });
});
