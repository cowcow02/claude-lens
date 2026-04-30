import { z } from "zod";
import { GOAL_CATEGORIES } from "../types.js";
import type { Entry } from "../types.js";

const GoalCategoryEnum = z.enum(GOAL_CATEGORIES);

const OutcomeEnum = z.enum(["shipped", "partial", "exploratory", "blocked", "trivial"]);
const HelpfulnessEnum = z.enum(["essential", "helpful", "neutral", "unhelpful"]);

// `.passthrough()` on the outer object tolerates extra LLM-added keys
// ("confidence", "notes", etc.) without failing validation. The inner
// goal_categories record still uses GoalCategoryEnum keys — Zod 3.23.6+
// enforces the key schema at runtime, so unknown goal names ARE rejected
// (the aggregation pipeline requires the fixed taxonomy).
export const EnrichmentResponseSchema = z.object({
  brief_summary: z.string().min(1),
  underlying_goal: z.string().min(1),
  friction_detail: z.string().nullable(),
  user_instructions: z.array(z.string()),
  goal_categories: z.record(GoalCategoryEnum, z.number().nonnegative()),
  outcome: OutcomeEnum,
  claude_helpfulness: HelpfulnessEnum,
}).passthrough();

export type EnrichmentResponse = z.infer<typeof EnrichmentResponseSchema>;

const SYSTEM_PROMPT = `You are analyzing one (session × local-day) slice of a developer's Claude Code work.

Given deterministic facts + up to 8 human-filtered turns, extract structured facets.

CRITICAL RULES:

1. goal_categories.{goal}: MINUTES spent on this goal in this slice.
   - Sum across all goals MUST be ≤ active_min.
   - Unclassified time stays implicit — do not pad.
   - Fixed taxonomy: build, plan, debug, review, steer, meta, research,
     refactor, test, release, warmup_minimal.
   - Use WHOLE-MINUTE granularity (0.5-min values OK; finer is noise).

2. user_instructions: 2-5 load-bearing explicit asks. Short phrasings.
   Copy the user's words; do NOT paraphrase.

3. friction_detail: ONE sentence if the user pushed back, got a broken
   result, had to redirect, or expressed frustration. Null if smooth.

4. outcome: shipped | partial | exploratory | blocked | trivial.
   - shipped: PR merged or code committed-and-pushed
   - partial: real progress, not yet shipped
   - exploratory: research / design / no deliverable
   - blocked: hit a wall, work halted
   - trivial: < 1 min of real work

5. claude_helpfulness: essential | helpful | neutral | unhelpful.
   Base on observed user satisfaction signals and outcome.

6. brief_summary: ONE sentence, second-person, concrete.
   Good: "You shipped the Team Edition timeline after two subagent retries."
   Bad:  "This session involves work on the dashboard."

7. underlying_goal: what the user was TRYING to accomplish, not what they did.

RESPOND WITH ONLY VALID JSON (no prose, no code fence):

{
  "brief_summary": "...",
  "underlying_goal": "...",
  "friction_detail": "..." | null,
  "user_instructions": ["...", "..."],
  "goal_categories": {"build": N, "plan": N, ...},
  "outcome": "shipped" | "partial" | "exploratory" | "blocked" | "trivial",
  "claude_helpfulness": "essential" | "helpful" | "neutral" | "unhelpful"
}`;

function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/** Just the slice-facts + human-turns portion of the prompt. Use this as the
 *  user-message stdin payload when calling `claude -p` with
 *  `--append-system-prompt ENRICHMENT_SYSTEM_PROMPT`. */
export function buildEnrichmentUserPrompt(entry: Entry, humanTurns: string[]): string {
  const facts = {
    active_min: entry.numbers.active_min,
    turn_count: entry.numbers.turn_count,
    tools_total: entry.numbers.tools_total,
    subagent_calls: entry.numbers.subagent_calls,
    skill_calls: entry.numbers.skill_calls,
    flags: entry.flags,
    primary_model: entry.primary_model,
    pr_titles: entry.pr_titles,
    top_tools: entry.top_tools,
    first_user: entry.first_user,
    final_agent: entry.final_agent,
    satisfaction_signals: entry.satisfaction_signals,
    user_input_sources: entry.user_input_sources,
  };

  const turns = humanTurns
    .slice(0, 8)
    .map((t, i) => `${i + 1}. ${trunc(t, 300)}`)
    .join("\n");

  return `SLICE FACTS:
${JSON.stringify(facts, null, 2)}

HUMAN TURNS (up to 8, each truncated to 300 chars):
${turns || "(none — the user text was filtered out as non-human)"}`;
}

/** Combined system + user prompt. Kept for legibility; the subprocess path
 *  uses ENRICHMENT_SYSTEM_PROMPT + buildEnrichmentUserPrompt separately. */
export function buildEnrichmentPrompt(entry: Entry, humanTurns: string[]): string {
  return `${SYSTEM_PROMPT}\n\n${buildEnrichmentUserPrompt(entry, humanTurns)}`;
}

/** System-prompt-only export — tests may assert on its length for prompt-caching planning. */
export const ENRICHMENT_SYSTEM_PROMPT = SYSTEM_PROMPT;
