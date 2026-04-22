import { describe, it, expect } from "vitest";
import {
  EnrichmentResponseSchema,
  buildEnrichmentPrompt,
  type EnrichmentResponse,
} from "../../src/prompts/enrich.js";
import type { Entry } from "../../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    version: 2,
    session_id: "s1",
    local_day: "2026-04-20",
    project: "/Users/test/foo",
    start_iso: "2026-04-20T09:00:00.000Z",
    end_iso: "2026-04-20T10:30:00.000Z",
    numbers: {
      active_min: 45,
      turn_count: 12, tools_total: 35, subagent_calls: 0, skill_calls: 1,
      task_ops: 2, interrupts: 0, tool_errors: 1, consec_same_tool_max: 3,
      exit_plan_calls: 0, prs: 1, commits: 2, pushes: 1, tokens_total: 50000,
    },
    flags: ["fast_ship"],
    primary_model: "claude-sonnet-4-6",
    model_mix: { "claude-sonnet-4-6": 12 },
    first_user: "please fix the bug in the login flow",
    final_agent: "fixed and pushed",
    pr_titles: ["fix login redirect bug"],
    top_tools: ["Edit×5", "Bash×4 (git, pnpm)"],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 1, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 3, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null, error: null,
      brief_summary: null, underlying_goal: null, friction_detail: null,
      user_instructions: ["fix login redirect", "push once green"],
      outcome: null, claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: "2026-04-20T10:30:00.000Z",
    source_jsonl: "/fake/path.jsonl",
    source_checkpoint: { byte_offset: 1024, last_event_ts: "2026-04-20T10:30:00.000Z" },
    ...overrides,
  };
}

describe("EnrichmentResponseSchema", () => {
  const valid: EnrichmentResponse = {
    brief_summary: "You fixed the login redirect bug and shipped it.",
    underlying_goal: "Unblock users stuck on the login screen.",
    friction_detail: null,
    user_instructions: ["fix login redirect", "push once green"],
    goal_categories: { debug: 30, release: 15 },
    outcome: "shipped",
    claude_helpfulness: "helpful",
  };

  it("accepts a valid response", () => {
    expect(() => EnrichmentResponseSchema.parse(valid)).not.toThrow();
  });

  it("rejects an invalid outcome literal", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({ ...valid, outcome: "halfway" })
    ).toThrow();
  });

  it("rejects an unknown goal category key", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({
        ...valid,
        goal_categories: { build: 10, made_up_goal: 5 },
      })
    ).toThrow();
  });

  it("accepts null friction_detail", () => {
    expect(() => EnrichmentResponseSchema.parse({ ...valid, friction_detail: null })).not.toThrow();
  });

  it("requires user_instructions to be an array of strings", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({ ...valid, user_instructions: "one" })
    ).toThrow();
  });

  it("allows empty goal_categories object", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({ ...valid, goal_categories: {} })
    ).not.toThrow();
  });

  it("tolerates extraneous top-level keys via passthrough", () => {
    expect(() =>
      EnrichmentResponseSchema.parse({
        ...valid,
        confidence: 0.85,
        notes: "I considered this carefully",
      })
    ).not.toThrow();
  });
});

describe("buildEnrichmentPrompt", () => {
  it("includes active_min, turn_count, and first_user in the prompt", () => {
    const e = mkEntry();
    const prompt = buildEnrichmentPrompt(e, []);
    expect(prompt).toContain("45");             // active_min
    expect(prompt).toContain("12");             // turn_count
    expect(prompt).toContain("fix the bug");    // first_user excerpt
  });

  it("truncates human turns to 300 chars", () => {
    const longTurn = "x".repeat(500);
    const prompt = buildEnrichmentPrompt(mkEntry(), [longTurn]);
    expect(prompt).toContain("x".repeat(299));
    expect(prompt).not.toContain("x".repeat(301));
  });

  it("includes up to 8 human turns", () => {
    const turns = Array.from({ length: 20 }, (_, i) => `turn-${i}`);
    const prompt = buildEnrichmentPrompt(mkEntry(), turns);
    for (let i = 0; i < 8; i++) expect(prompt).toContain(`turn-${i}`);
    expect(prompt).not.toContain("turn-8");
  });
});
