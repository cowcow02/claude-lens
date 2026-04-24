import { describe, expect, it } from "vitest";
import {
  DayDigestResponseSchema,
  buildDigestUserPrompt,
  DIGEST_DAY_SYSTEM_PROMPT,
} from "../src/prompts/digest-day.js";
import { CURRENT_DAY_DIGEST_SCHEMA_VERSION, type DayDigest, type Entry } from "../src/types.js";

function mkEntry(overrides: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2,
    session_id: "s1",
    local_day: "2026-04-23",
    project: "/Users/dev/repo",
    start_iso: "2026-04-23T10:00:00Z",
    end_iso: "2026-04-23T12:00:00Z",
    numbers: {
      active_min: 60, turn_count: 20, tools_total: 50, subagent_calls: 2,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 3, exit_plan_calls: 0, prs: 1, commits: 2,
      pushes: 1, tokens_total: 0,
    },
    flags: [], primary_model: "sonnet", model_mix: { sonnet: 20 },
    first_user: "", final_agent: "", pr_titles: ["feat: x"], top_tools: [],
    skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "done",
      generated_at: "2026-04-23T12:10:00Z",
      model: "claude-sonnet-4-6", cost_usd: 0.001, error: null,
      brief_summary: "You refactored the queue.", underlying_goal: "refactor",
      friction_detail: null, user_instructions: ["refactor queue"],
      outcome: "shipped", claude_helpfulness: "helpful",
      goal_categories: { refactor: 30, build: 30 }, retry_count: 0,
    },
    generated_at: "2026-04-23T12:10:00Z",
    source_jsonl: "/fake", source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...overrides };
}

function mkBase(): DayDigest {
  return {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION, scope: "day", key: "2026-04-23",
    window: { start: "2026-04-23T00:00:00Z", end: "2026-04-23T23:59:59Z" },
    entry_refs: [], generated_at: "2026-04-23T12:30:00Z", is_live: false,
    model: null, cost_usd: null,
    projects: [{ name: "/Users/dev/repo", display_name: "repo", share_pct: 100, entry_count: 1 }],
    shipped: [{ title: "feat: x", project: "repo", session_id: "s1" }],
    top_flags: [], top_goal_categories: [{ category: "build", minutes: 30 }],
    concurrency_peak: 1, agent_min: 60,
    headline: null, narrative: null, what_went_well: null,
    what_hit_friction: null, suggestion: null,
  };
}

describe("DayDigestResponseSchema", () => {
  it("accepts a well-formed response", () => {
    const ok = {
      headline: "You shipped the queue refactor.",
      narrative: "You refactored the enrichment queue across two commits.",
      what_went_well: "The split was clean.",
      what_hit_friction: null,
      suggestion: null,
    };
    expect(DayDigestResponseSchema.parse(ok)).toMatchObject(ok);
  });

  it("rejects a missing headline", () => {
    const bad = {
      narrative: "x", what_went_well: null, what_hit_friction: null, suggestion: null,
    };
    expect(DayDigestResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("enforces max lengths on headline", () => {
    const huge = { headline: "x".repeat(200), narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null };
    expect(DayDigestResponseSchema.safeParse(huge).success).toBe(false);
  });

  it("enforces max length on narrative", () => {
    const huge = { headline: "ok", narrative: "x".repeat(1300), what_went_well: null, what_hit_friction: null, suggestion: null };
    expect(DayDigestResponseSchema.safeParse(huge).success).toBe(false);
  });

  it("accepts passthrough extra keys", () => {
    const ok = {
      headline: "x", narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null,
      confidence: 0.9, notes: "extra",
    };
    expect(DayDigestResponseSchema.safeParse(ok).success).toBe(true);
  });
});

describe("buildDigestUserPrompt", () => {
  it("caps summaries at 12, frictions at 6, instructions at 10", () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(mkEntry({
        session_id: `s${i}`,
        enrichment: {
          ...mkEntry().enrichment,
          brief_summary: `summary ${i}`,
          friction_detail: `friction ${i}`,
          user_instructions: [`instr ${i}-a`, `instr ${i}-b`],
        },
      }));
    }
    const prompt = buildDigestUserPrompt(mkBase(), entries);
    const summaries = (prompt.match(/summary \d+/g) ?? []).length;
    const frictions = (prompt.match(/^\d+\. friction /gm) ?? []).length;
    const instructions = (prompt.match(/^\d+\. instr /gm) ?? []).length;
    expect(summaries).toBeLessThanOrEqual(12);
    expect(frictions).toBeLessThanOrEqual(6);
    expect(instructions).toBeLessThanOrEqual(10);
  });

  it("renders placeholders for empty inputs", () => {
    const prompt = buildDigestUserPrompt(mkBase(), []);
    expect(prompt).toContain("(none — no enriched entries)");
    expect(prompt).toContain("(none — smooth day)");
    expect(prompt).toContain("(none)");
  });

  it("includes DAY FACTS as JSON", () => {
    const base = mkBase();
    const prompt = buildDigestUserPrompt(base, []);
    expect(prompt).toContain(`"date": "${base.key}"`);
    expect(prompt).toContain(`"agent_min": ${base.agent_min}`);
  });
});

describe("DIGEST_DAY_SYSTEM_PROMPT", () => {
  it("is non-trivially long (prompt cache tuning sanity)", () => {
    expect(DIGEST_DAY_SYSTEM_PROMPT.length).toBeGreaterThan(500);
  });
});
