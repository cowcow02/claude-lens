import { describe, expect, it } from "vitest";
import { generateDayDigest, buildDeterministicDigest } from "../src/digest-day.js";
import type { Entry } from "../src/types.js";
import type { LLMResponse } from "../src/enrich.js";

function mkEntry(over: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2, session_id: "s1", local_day: "2026-04-23",
    project: "/x", start_iso: "2026-04-23T10:00:00Z", end_iso: "2026-04-23T11:00:00Z",
    numbers: {
      active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 1, commits: 1,
      pushes: 0, tokens_total: 0,
    },
    flags: [], primary_model: null, model_mix: {},
    first_user: "", final_agent: "", pr_titles: ["feat: x"], top_tools: [],
    skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "done", generated_at: "2026-04-23T11:00:00Z",
      model: "sonnet", cost_usd: 0.001, error: null,
      brief_summary: "shipped x", underlying_goal: "x",
      friction_detail: null, user_instructions: [],
      outcome: "shipped", claude_helpfulness: "helpful",
      goal_categories: { build: 60 }, retry_count: 0,
    },
    generated_at: "2026-04-23T11:00:00Z", source_jsonl: "/",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...over };
}

describe("generateDayDigest", () => {
  it("returns base digest unchanged when entries is empty", async () => {
    const mockLLM = async (): Promise<LLMResponse> => { throw new Error("should not be called"); };
    const r = await generateDayDigest("2026-04-23", [], { callLLM: mockLLM });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("returns base digest unchanged when all entries are skipped_trivial", async () => {
    const e = mkEntry({ enrichment: { ...mkEntry().enrichment, status: "skipped_trivial" } });
    const mockLLM = async (): Promise<LLMResponse> => { throw new Error("should not be called"); };
    const r = await generateDayDigest("2026-04-23", [e], { callLLM: mockLLM });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("populates narrative fields on LLM success", async () => {
    const entries = [mkEntry()];
    const mockLLM = async (): Promise<LLMResponse> => ({
      content: JSON.stringify({
        headline: "You shipped x.",
        narrative: "You refactored.",
        what_went_well: "Clean diff.",
        what_hit_friction: null,
        suggestion: null,
      }),
      input_tokens: 500, output_tokens: 200, model: "claude-sonnet-4-6",
    });
    const r = await generateDayDigest("2026-04-23", entries, { callLLM: mockLLM });
    expect(r.digest.headline).toBe("You shipped x.");
    expect(r.digest.narrative).toBe("You refactored.");
    expect(r.digest.what_went_well).toBe("Clean diff.");
    expect(r.usage).toEqual({ input_tokens: 500, output_tokens: 200 });
  });

  it("retries once on parse failure then succeeds", async () => {
    const entries = [mkEntry()];
    let calls = 0;
    const mockLLM = async (): Promise<LLMResponse> => {
      calls++;
      if (calls === 1) return { content: "not json", input_tokens: 100, output_tokens: 50, model: "sonnet" };
      return {
        content: JSON.stringify({
          headline: "Ok.", narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null,
        }),
        input_tokens: 120, output_tokens: 60, model: "sonnet",
      };
    };
    const r = await generateDayDigest("2026-04-23", entries, { callLLM: mockLLM });
    expect(calls).toBe(2);
    expect(r.digest.headline).toBe("Ok.");
    expect(r.usage).toEqual({ input_tokens: 220, output_tokens: 110 });
  });

  it("returns base digest + null narrative after two parse failures", async () => {
    const entries = [mkEntry()];
    const mockLLM = async (): Promise<LLMResponse> => ({
      content: "still not json",
      input_tokens: 100, output_tokens: 50, model: "sonnet",
    });
    const r = await generateDayDigest("2026-04-23", entries, { callLLM: mockLLM });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toEqual({ input_tokens: 200, output_tokens: 100 });
  });

  it("caller can pre-compute deterministic + pass concurrencyPeak", async () => {
    const e = mkEntry();
    const base = buildDeterministicDigest("2026-04-23", [e], { concurrencyPeak: 3 });
    expect(base.concurrency_peak).toBe(3);
  });
});
