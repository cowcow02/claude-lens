import { z } from "zod";
import type { DayDigest, DayOutcome, WeekDigest } from "../types.js";
import { flagGlossaryForPrompt, FLAG_GLOSSARY } from "../flag-glossary.js";

const DateRegex = /^\d{4}-\d{2}-\d{2}$/;

const ProjectAreaResponseSchema = z.object({
  display_name: z.string().min(1),
  description: z.string().min(1).max(600),
});

const FrictionExampleSchema = z.object({
  date: z.string().regex(DateRegex),
  quote: z.string().min(1).max(280),
});

const FrictionCategorySchema = z.object({
  category: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  examples: z.array(FrictionExampleSchema).min(1).max(3),
});

const RecurringThemeSchema = z.object({
  theme: z.string().min(1).max(160),
  days: z.array(z.string().regex(DateRegex)).min(2),
  evidence: z.string().min(1).max(500),
  source: z.enum(["suggestion", "friction", "helpfulness_dip", "flag_pattern"]),
});

const OutcomeCorrelationSchema = z.object({
  claim: z.string().min(1).max(500),
  supporting_dates: z.array(z.string().regex(DateRegex)).min(2),
});

const ClaudeMdAdditionSchema = z.object({
  addition: z.string().min(1).max(1200),
  why: z.string().min(1).max(600),
  prompt_scaffold: z.string().min(1).max(400),
});

const FeatureToTrySchema = z.object({
  feature: z.string().min(1).max(120),
  one_liner: z.string().min(1).max(200),
  why_for_you: z.string().min(1).max(800),
  example_code: z.string().min(1).max(2000),
});

const UsagePatternSchema = z.object({
  title: z.string().min(1).max(160),
  suggestion: z.string().min(1).max(400),
  detail: z.string().min(1).max(800),
  copyable_prompt: z.string().min(1).max(2000),
});

const HorizonOpportunitySchema = z.object({
  title: z.string().min(1).max(160),
  whats_possible: z.string().min(1).max(1200),
  how_to_try: z.string().min(1).max(800),
  copyable_prompt: z.string().min(1).max(2000),
  friction_category_addressed: z.string().min(1).max(160),
});

export const WeekDigestResponseSchema = z.object({
  headline: z.string().min(1).max(180),
  key_pattern: z.string().min(1).max(280),
  trajectory: z.array(z.object({
    date: z.string().regex(DateRegex),
    line: z.string().min(1).max(280),
  })).min(1),
  standout_days: z.array(z.object({
    date: z.string().regex(DateRegex),
    why: z.string().min(1).max(500),
  })).min(1).max(2),
  project_areas: z.array(ProjectAreaResponseSchema).min(1),
  recurring_themes: z.array(RecurringThemeSchema).max(4),
  outcome_correlations: z.array(OutcomeCorrelationSchema).max(3),
  friction_categories: z.array(FrictionCategorySchema).max(4),
  suggestions: z.object({
    claude_md_additions: z.array(ClaudeMdAdditionSchema).min(1).max(3),
    features_to_try: z.array(FeatureToTrySchema).min(1).max(3),
    usage_patterns: z.array(UsagePatternSchema).min(1).max(3),
  }),
  on_the_horizon: HorizonOpportunitySchema.nullable(),
  fun_ending: z.object({
    headline: z.string().min(1).max(200),
    detail: z.string().min(1).max(600),
  }).nullable(),
}).passthrough();

export type WeekDigestResponse = z.infer<typeof WeekDigestResponseSchema>;

const SYSTEM_PROMPT = `You are the weekly retrospective writer for Fleetlens, a dashboard for Claude Code sessions.

Your unique advantage: you receive **already-synthesized day digests**, not raw events. Each day digest carries its own \`headline\`, \`what_went_well\`, \`what_hit_friction\`, \`suggestion\`, plus deterministic counts. The reader has likely already seen the day digests — your job at the week level is to:

  1. Find what was characteristic about this week as a whole (key_pattern + trajectory + standout_days).
  2. Surface signals that recurred across multiple days (recurring_themes) — the day-level digests can't see across days, but you can.
  3. Make claims that need both per-day rollups AND aggregate flags to support them (outcome_correlations).
  4. Quote the day-level data verbatim where it's load-bearing — never paraphrase friction.
  5. Propose one ambitious forward-looking workflow tied to the week's actual top friction.

Do NOT re-summarize what the day digests already said. Do NOT pad with prose that says the same thing as the headline + sparkline.

INPUT shape:
- period: { start, end, label }
- totals: { agent_min_total, day_count_with_data }
- outcome_mix: { shipped, partial, blocked, exploratory, trivial, idle } — counts of days. Absent values mean zero.
- helpfulness_sparkline: 7 entries Mon→Sun.
- projects: per-project rollups. Each: { display_name, agent_min, share_pct, shipped_count, shipped_titles[], top_flags[] }.
- shipped: all PRs shipped this week, each { title, project, date }.
- top_flags, top_goal_categories.
- concurrency_peak_day: { date, peak } or null.
- day_summaries: per-day { date, day_name, headline, what_went_well, what_hit_friction, suggestion, agent_min, outcome_day, helpfulness_day, top_flags }. Each entry's text fields are verbatim from that day's digest — quote them, don't paraphrase.

OUTPUT: ONE JSON object. Strict JSON, no prose outside, no fence. Schema:

{
  "headline":     "≤120 chars; concrete claim grounded in data; second-person",
  "key_pattern":  "≤80 chars; ONE sentence subhead under the headline that names this week's working mode",
  "trajectory": [
    { "date": "YYYY-MM-DD", "line": "≤30 words about that day's concrete work" }
    // one entry per day in day_summaries, chronological
  ],
  "standout_days": [
    { "date": "YYYY-MM-DD", "why": "1-2 sentences explaining why this day defined the week" }
    // 1 to 2 entries
  ],
  "project_areas": [
    { "display_name": "exact match from input", "description": "1-3 sentences naming WHAT was actually built/shipped, grounded in shipped_titles + day_summaries" }
    // one per project with non-zero agent_min, top 5 by share. Skip <5% share unless they shipped a PR.
  ],
  "recurring_themes": [
    {
      "theme": "≤80 chars; plain-English label. Never a raw flag token. E.g. 'checkpoint per chunk came up three times' or 'long autonomous runs on 4 of 6 days'.",
      "days": ["YYYY-MM-DD", "YYYY-MM-DD"],         // ≥ 2 dates required
      "evidence": "1-2 sentences explaining what these days share + why it deserves attention. Describe the work, not the tooling.",
      "source": "suggestion" | "friction" | "helpfulness_dip" | "flag_pattern"
    }
    // 0-4 entries. Sources:
    //   "suggestion"      — the same day-level \`suggestion\` text appeared on 2+ days.
    //   "friction"        — the same actual phrase from \`what_hit_friction\` recurred.
    //   "helpfulness_dip" — helpfulness regressed below the week's median on a specific day.
    //   "flag_pattern"    — a deterministic flag (long_autonomous / loop_suspected / orchestrated / …) fired on multiple days. Use this NOT \`friction\` for flag-shape observations. Frame as "the SHAPE of work this week", not as a problem.
    // Empty array if nothing recurred.
  ],
  "outcome_correlations": [
    {
      "claim": "1-2 sentences; pattern like 'loop_suspected fired on the 3 highest-shipping days'",
      "supporting_dates": ["YYYY-MM-DD", "YYYY-MM-DD"]   // ≥ 2 dates
    }
    // 0-3 entries. Tie a flag/outcome pattern to specific dates. Empty array if no
    // clear correlation. NEVER fabricate — if outcome_mix is uniform, leave empty.
  ],
  "friction_categories": [
    {
      "category": "≤80 chars; what actually went wrong, in plain English. Don't name flags here — flags are not friction.",
      "description": "2-3 sentences clustering this kind of friction across days. Describe what the user hit, not what the parser labelled.",
      "examples": [
        { "date": "YYYY-MM-DD", "quote": "verbatim from that day's what_hit_friction (or first_user / final_agent if friction was diagnostic)" }
        // 1-3 examples per category. EVERY quote MUST be a direct substring of the named day's text fields. If you can't find a quote describing real friction in any day's what_hit_friction, the category does not belong here — surface it via recurring_themes.flag_pattern instead.
      ]
    }
    // 0-4 categories total. Empty array if smooth. DO NOT invent friction. DO NOT put flag patterns here — flag patterns describe the SHAPE of work, not friction. The on_the_horizon opportunity may still address a flag pattern via friction_category_addressed → if so, name a real category that exists here, OR set on_the_horizon to null.
  ],
  "suggestions": {
    "claude_md_additions": [
      { "addition": "Markdown block with section heading, ready to paste",
        "why": "1-2 sentences citing the data (NAMED days + counts)",
        "prompt_scaffold": "Where in CLAUDE.md to put it" }
      // 1-3
    ],
    "features_to_try": [
      { "feature": "Custom Skills | Hooks | Headless Mode | Subagents | Plan Mode | …",
        "one_liner": "≤30 words",
        "why_for_you": "1-2 sentences citing this week's specific pattern (named days/flags)",
        "example_code": "Working code snippet, real paths from the input, ~10-30 lines" }
      // 1-3
    ],
    "usage_patterns": [
      { "title": "≤80 chars",
        "suggestion": "1-2 sentences",
        "detail": "2-4 sentences citing specific dates that motivated it",
        "copyable_prompt": "Self-contained prompt the user can paste into a new session, mentions their actual repos/tools" }
      // 1-3
    ]
  },
  "on_the_horizon": {
    "title": "≤80 chars; ONE ambitious workflow",
    "whats_possible": "2-4 sentences describing the future-state, citing specific friction this week it would eliminate",
    "how_to_try": "1-2 sentences naming the concrete tools/MCPs/skills that compose into this",
    "copyable_prompt": "Self-contained brief, ~5-12 lines, named requirements",
    "friction_category_addressed": "EXACT match of one of the friction_categories[].category strings — ties this opportunity to a real pattern from this week"
  } | null,  // null if friction_categories is empty
  "fun_ending": {
    "headline": "≤200 chars memorable moment, grounded in a specific day_summary or flag",
    "detail": "1-3 sentences of context"
  } | null   // null if nothing memorable surfaced
}

VOCABULARY RULES (strict):

The reader is a working developer, not someone who reads parser internals. Write like a coworker recapping the week, not like a monitoring system describing itself.

1. **Don't say "build" when you mean "session" or "run".** A "build" means CI build to a developer. Use "session", "long run", or "block of work".

2. **Don't use "flagged" as a verb.** Sentences like "X flagged Y" / "Y was flagged by X" / "X carried Y as a top flag" are parser-talk. Flags are *attributes* of work, not actors. Describe what the user *did* or what *happened*, not what the parser *labelled*.

3. **Never make a flag the subject of a user-facing sentence.** Wrong: "loop_suspected fired on Tue + Fri." Right: "Tuesday and Friday both ran long enough to trigger the consecutive-tool-run heuristic." Or just describe the actual work pattern: "Tuesday and Friday were the two days you let Claude run autonomously past an hour."

4. **Internal flag tokens (\`loop_suspected\`, \`long_autonomous\`, \`orchestrated\`, \`fast_ship\`, \`plan_used\`, \`interrupt_heavy\`, \`high_errors\`) are forbidden as nouns or subjects in user-facing prose.** The input payload provides a \`flag_glossary\`. If you need to reference a flag, paraphrase what it *observes* (e.g. "8+ consecutive same-tool calls"), not the token. Tokens MAY appear inside friction example \`quote\` fields if the verbatim day-text used them.

5. **Flag patterns are NOT friction.** Use \`recurring_themes\` with \`source: "flag_pattern"\` to surface flag shape (e.g. "long autonomous runs hit on 4 days"). Only put something in \`friction_categories\` if the day-level \`what_hit_friction\` text describes an actual problem the user hit.

6. **Headlines describe outcomes + concrete work.** A good headline names what shipped, what stalled, what surprised. A bad headline names a flag count.

CRITICAL RULES:

1. **Quote, don't paraphrase.** Every friction example MUST be a verbatim substring of the named day's \`what_hit_friction\` (or \`headline\` / \`first_user\` / \`final_agent\` if the friction was diagnostic). Do not summarize friction in your own words inside examples.
2. **Cite specific dates** in suggestions (\`why\`, \`why_for_you\`, \`detail\`). "This came up Tue and Fri" not "this often happens".
3. **Recurring_themes requires ≥ 2 days.** A single-day signal isn't recurring. Look for: same \`suggestion\` text repeating, same flag in \`top_flags\` for multiple days, helpfulness dipping below median.
4. **Outcome_correlations need data on both sides.** Don't assert "loop_suspected days shipped most PRs" unless you can cite the dates AND the data shows it. If the correlation is tenuous or coincidental at this small sample, leave the array empty.
5. **No archetype labels.** ("Orchestration Conductor", "Solo Builder", etc. — V1 vocabulary, forbidden.)
6. **on_the_horizon is ONE opportunity.** Tie it to a specific friction_category from this week. If friction_categories is empty, on_the_horizon = null.
7. **No padding.** If you have nothing to add at the week level beyond what the day digests already said, you're not earning the report. Leave a section empty rather than restating.
8. **Strict JSON.** No trailing commas. No prose outside. No code fence.`;

export const DIGEST_WEEK_SYSTEM_PROMPT = SYSTEM_PROMPT;

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const ALL_OUTCOMES: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];

export function buildWeekDigestUserPrompt(base: WeekDigest, dayDigests: DayDigest[]): string {
  const shippedByProject = new Map<string, Array<{ title: string; date: string }>>();
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      const arr = shippedByProject.get(s.project) ?? [];
      arr.push({ title: s.title, date: dd.key });
      shippedByProject.set(s.project, arr);
    }
  }

  const day_summaries = dayDigests
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(d => ({
      date: d.key,
      day_name: dayName(d.key),
      headline: d.headline,
      what_went_well: d.what_went_well,
      what_hit_friction: d.what_hit_friction,
      suggestion: d.suggestion,
      agent_min: Math.round(d.agent_min),
      outcome_day: d.outcome_day,
      helpfulness_day: d.helpfulness_day,
      top_flags: d.top_flags.slice(0, 5),
    }));

  const outcome_mix: Record<DayOutcome, number> = {
    shipped: 0, partial: 0, blocked: 0, exploratory: 0, trivial: 0, idle: 0,
  };
  for (const k of ALL_OUTCOMES) outcome_mix[k] = base.outcome_mix[k] ?? 0;

  const projectsView = base.projects.slice(0, 8).map(p => ({
    display_name: p.display_name ?? prettyProject(p.name),
    agent_min: Math.round(p.agent_min),
    share_pct: Math.round(p.share_pct * 10) / 10,
    shipped_count: p.shipped_count,
    shipped_titles: (shippedByProject.get(p.display_name) ?? []).slice(0, 8),
  }));

  // Restrict glossary to flags actually present this week so the LLM only
  // sees translations relevant to this report.
  const presentFlags = new Set<string>();
  for (const f of base.top_flags) presentFlags.add(f.flag);
  for (const dd of dayDigests) for (const f of dd.top_flags) presentFlags.add(f.flag);
  const glossary = flagGlossaryForPrompt().filter(g => presentFlags.has(g.token));
  // Always include the most common offenders so the LLM has a sane fallback:
  for (const token of ["loop_suspected", "long_autonomous", "orchestrated"]) {
    if (FLAG_GLOSSARY[token] && !glossary.some(g => g.token === token)) {
      glossary.push(FLAG_GLOSSARY[token]);
    }
  }

  const payload = {
    period: { start: base.window.start, end: base.window.end, label: base.key },
    totals: {
      agent_min_total: Math.round(base.agent_min_total),
      day_count_with_data: day_summaries.length,
    },
    outcome_mix,
    helpfulness_sparkline: base.helpfulness_sparkline,
    projects: projectsView,
    shipped: base.shipped.map(s => ({ title: s.title, project: s.project, date: s.date })),
    top_flags: base.top_flags,
    top_goal_categories: base.top_goal_categories,
    concurrency_peak_day: base.concurrency_peak_day,
    day_summaries,
    flag_glossary: glossary,
  };

  return JSON.stringify(payload, null, 2);
}

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
