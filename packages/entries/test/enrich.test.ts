import { describe, it, expect, vi } from "vitest";
import { enrichEntry, type CallLLM } from "../src/enrich.js";
import type { Entry } from "../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    version: 2,
    session_id: "s1",
    local_day: "2026-04-20",
    project: "/Users/test/foo",
    start_iso: "2026-04-20T09:00:00.000Z",
    end_iso: "2026-04-20T10:30:00.000Z",
    numbers: {
      active_min: 45, turn_count: 12, tools_total: 35, subagent_calls: 0,
      skill_calls: 1, task_ops: 2, interrupts: 0, tool_errors: 1,
      consec_same_tool_max: 3, exit_plan_calls: 0, prs: 1, commits: 2,
      pushes: 1, tokens_total: 50000,
    },
    flags: ["fast_ship"],
    primary_model: "claude-sonnet-4-6",
    model_mix: { "claude-sonnet-4-6": 12 },
    first_user: "please fix the bug",
    final_agent: "done",
    pr_titles: ["fix bug"],
    top_tools: ["Edit×5"],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 1, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 3, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null,
      error: null, brief_summary: null, underlying_goal: null,
      friction_detail: null, user_instructions: [], outcome: null,
      claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: "2026-04-20T10:30:00.000Z",
    source_jsonl: "/fake/path.jsonl",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
    ...overrides,
  };
}

const validResponse = {
  brief_summary: "You fixed the bug.",
  underlying_goal: "Unblock login flow.",
  friction_detail: null,
  user_instructions: ["fix login"],
  goal_categories: { debug: 30, release: 15 },
  outcome: "shipped" as const,
  claude_helpfulness: "helpful" as const,
};

describe("enrichEntry", () => {
  it("populates fields and sets status=done on happy path; returns usage totals", async () => {
    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify(validResponse),
      input_tokens: 800,
      output_tokens: 150,
      model: "claude-sonnet-4-6",
    });

    const { entry: out, usage } = await enrichEntry(mkEntry(), {
      apiKey: "sk-fake",
      callLLM,
    });

    expect(out.enrichment.status).toBe("done");
    expect(out.enrichment.brief_summary).toBe("You fixed the bug.");
    expect(out.enrichment.goal_categories).toEqual({ debug: 30, release: 15 });
    expect(out.enrichment.outcome).toBe("shipped");
    expect(out.enrichment.model).toBe("claude-sonnet-4-6");
    expect(out.enrichment.cost_usd).toBeGreaterThan(0);
    expect(out.enrichment.generated_at).toBeTruthy();
    expect(out.enrichment.retry_count).toBe(0);
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(usage).toEqual({ input_tokens: 800, output_tokens: 150 });
  });

  it("retries once on JSON parse failure before giving up; accumulates usage across both calls", async () => {
    const callLLM: CallLLM = vi.fn()
      .mockResolvedValueOnce({
        content: "Here you go: not-valid-json",
        input_tokens: 800, output_tokens: 20, model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify(validResponse),
        input_tokens: 850, output_tokens: 150, model: "claude-sonnet-4-6",
      });

    const { entry: out, usage } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("done");
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(usage).toEqual({ input_tokens: 1650, output_tokens: 170 });
  });

  it("sets status=error and bumps retry_count when parse fails twice", async () => {
    const callLLM: CallLLM = vi.fn()
      .mockResolvedValue({
        content: "never valid",
        input_tokens: 800, output_tokens: 5, model: "claude-sonnet-4-6",
      });

    const { entry: out, usage } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("error");
    expect(out.enrichment.retry_count).toBe(1);
    expect(out.enrichment.error).toMatch(/parse|schema/);
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(usage).toEqual({ input_tokens: 1600, output_tokens: 10 });
  });

  it("sets status=error and bumps retry_count on API exception; usage is null", async () => {
    const callLLM: CallLLM = vi.fn().mockRejectedValue(new Error("network down"));

    const { entry: out, usage } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("error");
    expect(out.enrichment.retry_count).toBe(1);
    expect(out.enrichment.error).toContain("network down");
    expect(usage).toBeNull();
  });

  it("respects incoming retry_count (increments from previous value)", async () => {
    const callLLM: CallLLM = vi.fn().mockRejectedValue(new Error("boom"));
    const entry = mkEntry();
    entry.enrichment.retry_count = 2;

    const { entry: out } = await enrichEntry(entry, { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.retry_count).toBe(3);
    expect(out.enrichment.status).toBe("error");
  });

  it("rejects a response that parses as JSON but fails Zod validation", async () => {
    const callLLM: CallLLM = vi.fn().mockResolvedValue({
      content: JSON.stringify({ ...validResponse, outcome: "halfway" }),
      input_tokens: 800, output_tokens: 150, model: "claude-sonnet-4-6",
    });
    const { entry: out } = await enrichEntry(mkEntry(), { apiKey: "sk-fake", callLLM });
    expect(out.enrichment.status).toBe("error");
    expect(callLLM).toHaveBeenCalledTimes(2);
  });
});
