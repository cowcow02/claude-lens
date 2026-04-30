import { describe, expect, it } from "vitest";
import { computeDaySignals } from "../src/digest-day.js";
import type { Entry } from "../src/types.js";

function mkEntry(over: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2, session_id: "s1", local_day: "2026-04-23",
    project: "/x", start_iso: "2026-04-23T10:00:00Z", end_iso: "2026-04-23T11:00:00Z",
    numbers: {
      active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 0,
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
    generated_at: "2026-04-23T11:00:00Z", source_jsonl: "/",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...over };
}

describe("computeDaySignals", () => {
  it("dominant_shape is null for trivial day", () => {
    const e = mkEntry({ numbers: { ...mkEntry().numbers, turn_count: 1 } });
    expect(computeDaySignals([e]).dominant_shape).toBeNull();
  });

  it("dominant_shape picks the >= 60% active_min winner", () => {
    const a = mkEntry({
      session_id: "a",
      numbers: { ...mkEntry().numbers, active_min: 80 },
      subagents: [
        { type: "general-purpose", description: "review pass", background: false, prompt_preview: "x" },
        { type: "general-purpose", description: "second review", background: false, prompt_preview: "y" },
      ],
    });
    const b = mkEntry({
      session_id: "b",
      numbers: { ...mkEntry().numbers, active_min: 20 },
      first_user: "fix bug",
    });
    expect(computeDaySignals([a, b]).dominant_shape).toBe("spec-review-loop");
  });

  it("dominant_shape is 'mixed' when no shape exceeds 60%", () => {
    const a = mkEntry({
      session_id: "a",
      numbers: { ...mkEntry().numbers, active_min: 50 },
      subagents: [
        { type: "general-purpose", description: "review pass", background: false, prompt_preview: "x" },
        { type: "general-purpose", description: "second review", background: false, prompt_preview: "y" },
      ],
    });
    const b = mkEntry({
      session_id: "b",
      numbers: { ...mkEntry().numbers, active_min: 50 },
      first_user: "fix bug",
    });
    expect(computeDaySignals([a, b]).dominant_shape).toBe("mixed");
  });

  it("aggregates skills with origin classification", () => {
    const e = mkEntry({
      skills: { "superpowers:brainstorming": 2, "my-custom-skill": 1 },
    });
    const s = computeDaySignals([e]);
    expect(s.skills_loaded).toContainEqual({ skill: "superpowers:brainstorming", origin: "stock", count: 2 });
    expect(s.skills_loaded).toContainEqual({ skill: "my-custom-skill", origin: "user", count: 1 });
    expect(s.user_authored_skills_used).toEqual(["my-custom-skill"]);
  });

  it("captures user-authored subagents with sample prompts", () => {
    const e = mkEntry({
      subagents: [
        { type: "implement-teammate", description: "build chunk 3", background: false, prompt_preview: "Implement the queue handler with retries" },
        { type: "general-purpose", description: "audit", background: false, prompt_preview: "stock dispatch" },
      ],
    });
    const s = computeDaySignals([e]);
    expect(s.user_authored_subagents_used).toHaveLength(1);
    expect(s.user_authored_subagents_used[0]).toMatchObject({ type: "implement-teammate", count: 1 });
  });

  it("counts prompt frames with origin", () => {
    const a = mkEntry({ first_user: "<teammate-message>do this</teammate-message>" });
    const b = mkEntry({ session_id: "b", first_user: "Here's the handoff prompt for ..." });
    const s = computeDaySignals([a, b]);
    const teammate = s.prompt_frames.find(f => f.frame === "teammate");
    expect(teammate?.origin).toBe("claude-feature");
    const handoff = s.prompt_frames.find(f => f.frame === "handoff-prose");
    expect(handoff?.origin).toBe("personal-habit");
  });

  it("captures comm_style verbosity + steering counts", () => {
    const a = mkEntry({
      first_user: "x".repeat(50),
      numbers: { ...mkEntry().numbers, interrupts: 3 },
      satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 1, frustrated: 1 },
    });
    const s = computeDaySignals([a]);
    expect(s.comm_style.verbosity_distribution.short).toBe(1);
    expect(s.comm_style.steering.interrupts).toBe(3);
    expect(s.comm_style.steering.frustrated).toBe(1);
    expect(s.comm_style.steering.dissatisfied).toBe(1);
    expect(s.comm_style.steering.sessions_with_mid_run_redirect).toBe(1);
  });

  it("plan_mode_used true when any entry has exit_plan_calls or plan_used flag", () => {
    const e1 = mkEntry({ flags: ["plan_used"] });
    expect(computeDaySignals([e1]).plan_mode_used).toBe(true);
    const e2 = mkEntry({ numbers: { ...mkEntry().numbers, exit_plan_calls: 1 } });
    expect(computeDaySignals([e2]).plan_mode_used).toBe(true);
  });

  it("brainstorm_warmup_session_count counts entries that opened with brainstorming skill", () => {
    const a = mkEntry({ session_id: "a", skills: { "superpowers:brainstorming": 1 } });
    const b = mkEntry({ session_id: "b", skills: { "writing-plans": 1 } });
    const c = mkEntry({ session_id: "c" });
    expect(computeDaySignals([a, b, c]).brainstorm_warmup_session_count).toBe(2);
  });

  it("falls back to on-the-fly signal computation when entry.signals is absent", () => {
    // Entry without `signals` field — should still produce signals via fallback.
    const e = mkEntry({
      first_user: "fix it",
      subagents: [
        { type: "general-purpose", description: "review pass", background: false, prompt_preview: "x" },
        { type: "general-purpose", description: "second review", background: false, prompt_preview: "y" },
      ],
    });
    const s = computeDaySignals([e]);
    expect(s.dominant_shape).toBe("spec-review-loop");
  });
});
