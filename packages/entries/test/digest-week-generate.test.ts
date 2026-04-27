import { describe, expect, it } from "vitest";
import { generateWeekDigest } from "../src/digest-week.js";
import type { DayDigest } from "../src/types.js";
import { CURRENT_DAY_DIGEST_SCHEMA_VERSION } from "../src/types.js";
import type { LLMResponse } from "../src/enrich.js";

function mkDay(overrides: Partial<DayDigest>): DayDigest {
  const base: DayDigest = {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION,
    scope: "day", key: "2026-04-20",
    window: { start: "2026-04-20T00:00:00", end: "2026-04-20T23:59:59" },
    entry_refs: [], generated_at: "2026-04-20T23:59:59Z",
    is_live: false, model: null, cost_usd: null,
    projects: [{ name: "/x", display_name: "x", share_pct: 100, entry_count: 1 }],
    shipped: [], top_flags: [], top_goal_categories: [],
    concurrency_peak: 0, agent_min: 90,
    outcome_day: "shipped", helpfulness_day: "helpful",
    headline: "shipped phase 4", narrative: "wrote phase 4 spec, opened PR",
    what_went_well: "tight design loop", what_hit_friction: null,
    suggestion: null,
  };
  return { ...base, ...overrides };
}

const VALID_RESPONSE = {
  headline: "Steady week — phase 4 landed and friction stayed low",
  trajectory: [
    { date: "2026-04-20", line: "Phase 4 spec written and reviewed." },
    { date: "2026-04-21", line: "Implementation started; deterministic week digest passing tests." },
  ],
  standout_days: [
    { date: "2026-04-20", why: "Spec converged in one brainstorm and the reviewer pass found only minor issues." },
  ],
  project_areas: [
    { display_name: "x", description: "Phase 4 spec + implementation landed under this project." },
  ],
  interaction_style: {
    narrative: "You ran the brainstorm to spec to implementation flow tightly across two days, with the reviewer pass folded inline rather than queued. Tool use was concentrated in Edit + Write rather than Read.",
    key_pattern: "Tight brainstorm-to-spec turnaround with reviewer pass inline.",
  },
  friction_categories: [],
  suggestions: {
    claude_md_additions: [
      { addition: "## Spec rituals\n- Always reviewer-pass before commit.", why: "Phase 4 spec needed two reviewer passes before approval.", prompt_scaffold: "Top of CLAUDE.md, near the existing Code style section." },
    ],
    features_to_try: [
      { feature: "Custom Skills", one_liner: "Reusable command modules.", why_for_you: "Your brainstorm + spec ritual is uniform; codify it.", example_code: "mkdir -p .claude/skills/spec-ritual && cat > .claude/skills/spec-ritual/SKILL.md <<'EOF'\n# Spec Ritual\nBrainstorm, write spec, reviewer pass, commit.\nEOF" },
    ],
    usage_patterns: [
      { title: "Hold the trajectory format", suggestion: "Use one-line-per-sub-period for month digests too.", detail: "It worked for day digests as input; the LLM ground each line concretely.", copyable_prompt: "Generate the month digest using one line per week_start, mirroring the day-level format." },
    ],
  },
  on_the_horizon: {
    intro: "Your week-level synthesis pattern scales naturally to month and quarter.",
    opportunities: [
      { title: "Month digest with the same trajectory shape", whats_possible: "One line per week, standout weeks, same friction-categories spine.", how_to_try: "Reuse the WeekDigest renderer with month-scope props.", copyable_prompt: "Build a month digest that mirrors the week digest exactly, scaled up." },
    ],
  },
  fun_ending: null,
  at_a_glance: {
    whats_working: "Tight spec-to-implementation loop with reviewer pass folded in.",
    whats_hindering: "Nothing material this week.",
    quick_wins: "Codify the spec-ritual as a Custom Skill.",
    ambitious_workflows: "Mirror this onto month and quarter scopes.",
  },
};

describe("generateWeekDigest", () => {
  it("returns base digest when fewer than 2 enriched days", async () => {
    const days = [mkDay({ key: "2026-04-20", outcome_day: "trivial" })];
    const mock = async (): Promise<LLMResponse> => { throw new Error("should not be called"); };
    const r = await generateWeekDigest("2026-04-20", days, { callLLM: mock });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toBeNull();
  });

  it("happy path: returns parsed narrative with usage", async () => {
    const days = [
      mkDay({ key: "2026-04-20", outcome_day: "shipped" }),
      mkDay({ key: "2026-04-21", outcome_day: "shipped" }),
    ];
    const mock = async (): Promise<LLMResponse> => ({
      content: "```json\n" + JSON.stringify(VALID_RESPONSE) + "\n```",
      input_tokens: 1000, output_tokens: 200, model: "claude-sonnet-4-6",
    });
    const r = await generateWeekDigest("2026-04-20", days, { callLLM: mock });
    expect(r.digest.headline).toBe(VALID_RESPONSE.headline);
    expect(r.digest.trajectory).toEqual(VALID_RESPONSE.trajectory);
    expect(r.digest.standout_days).toEqual(VALID_RESPONSE.standout_days);
    expect(r.digest.suggestion).toEqual(VALID_RESPONSE.suggestion);
    expect(r.usage).toEqual({ input_tokens: 1000, output_tokens: 200 });
  });

  it("retries once on bad JSON, then accepts on second try", async () => {
    const days = [
      mkDay({ key: "2026-04-20", outcome_day: "shipped" }),
      mkDay({ key: "2026-04-21", outcome_day: "partial" }),
    ];
    let callCount = 0;
    const mock = async (): Promise<LLMResponse> => {
      callCount++;
      if (callCount === 1) {
        return { content: "not JSON at all", input_tokens: 800, output_tokens: 50, model: "sonnet" };
      }
      return {
        content: JSON.stringify(VALID_RESPONSE),
        input_tokens: 800, output_tokens: 200, model: "sonnet",
      };
    };
    const r = await generateWeekDigest("2026-04-20", days, { callLLM: mock });
    expect(callCount).toBe(2);
    expect(r.digest.headline).toBe(VALID_RESPONSE.headline);
    expect(r.usage).toEqual({ input_tokens: 1600, output_tokens: 250 });
  });

  it("returns base digest when both attempts fail validation", async () => {
    const days = [
      mkDay({ key: "2026-04-20", outcome_day: "shipped" }),
      mkDay({ key: "2026-04-21", outcome_day: "partial" }),
    ];
    const mock = async (): Promise<LLMResponse> => ({
      content: "garbage",
      input_tokens: 500, output_tokens: 30, model: "sonnet",
    });
    const r = await generateWeekDigest("2026-04-20", days, { callLLM: mock });
    expect(r.digest.headline).toBeNull();
    expect(r.usage).toEqual({ input_tokens: 1000, output_tokens: 60 });
  });
});
