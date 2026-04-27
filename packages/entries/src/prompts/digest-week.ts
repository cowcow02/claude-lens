import { z } from "zod";
import type { DayDigest, DayOutcome, WeekDigest } from "../types.js";

const DateRegex = /^\d{4}-\d{2}-\d{2}$/;

const SuggestionShortSchema = z.object({
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(800),
});

const ProjectAreaResponseSchema = z.object({
  display_name: z.string().min(1),
  description: z.string().min(1).max(600),
});

const FrictionCategorySchema = z.object({
  category: z.string().min(1).max(120),
  description: z.string().min(1).max(800),
  examples: z.array(z.string().min(1).max(400)).min(1).max(3),
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
});

export const WeekDigestResponseSchema = z.object({
  headline: z.string().min(1).max(180),
  trajectory: z.array(z.object({
    date: z.string().regex(DateRegex),
    line: z.string().min(1).max(280),
  })).min(1),
  standout_days: z.array(z.object({
    date: z.string().regex(DateRegex),
    why: z.string().min(1).max(500),
  })).min(1).max(2),
  project_areas: z.array(ProjectAreaResponseSchema).min(1),
  interaction_style: z.object({
    narrative: z.string().min(1).max(2400),
    key_pattern: z.string().min(1).max(280),
  }),
  friction_categories: z.array(FrictionCategorySchema).max(4),
  suggestions: z.object({
    claude_md_additions: z.array(ClaudeMdAdditionSchema).min(1).max(3),
    features_to_try: z.array(FeatureToTrySchema).min(1).max(3),
    usage_patterns: z.array(UsagePatternSchema).min(1).max(3),
  }),
  on_the_horizon: z.object({
    intro: z.string().min(1).max(600),
    opportunities: z.array(HorizonOpportunitySchema).min(1).max(3),
  }),
  fun_ending: z.object({
    headline: z.string().min(1).max(200),
    detail: z.string().min(1).max(600),
  }).nullable(),
  at_a_glance: z.object({
    whats_working: z.string().min(1).max(800),
    whats_hindering: z.string().min(1).max(800),
    quick_wins: z.string().min(1).max(800),
    ambitious_workflows: z.string().min(1).max(800),
  }),
  /** Optional richer suggestion for the legacy renderer; ignored if absent. */
  suggestion: SuggestionShortSchema.optional(),
}).passthrough();

export type WeekDigestResponse = z.infer<typeof WeekDigestResponseSchema>;

const SYSTEM_PROMPT = `You are the weekly retrospective writer for Fleetlens, a dashboard for Claude Code sessions.

You receive a JSON payload describing one calendar week (Mon-Sun, server local TZ) of Claude Code work — already pre-aggregated into per-day digests. Your job: produce a single JSON object that becomes the user's weekly insights report. The report aims to be **actionable, grounded in the data, and structurally richer than a generic summary** so the user can paste suggestions directly into their workflow.

INPUT shape:
- period: { start, end, label }
- totals: { agent_min_total, day_count_with_data }
- outcome_mix: { shipped, partial, blocked, exploratory, trivial, idle } — counts of days. The prompt builder pre-fills missing keys with 0.
- helpfulness_sparkline: array of 7 entries Mon→Sun, each "essential" | "helpful" | "neutral" | "unhelpful" | null.
- projects: per-project rollups. Each: { name, display_name, agent_min, share_pct, shipped_count, shipped_titles[], top_flags[] }.
- shipped: all PRs shipped this week, each { title, project, date }.
- top_flags, top_goal_categories.
- concurrency_peak_day: { date, peak } or null.
- day_summaries: per-day { date, day_name, headline, what_went_well, what_hit_friction, suggestion, agent_min, outcome_day, helpfulness_day }. Days with zero entries are omitted.

OUTPUT: ONE JSON object. No prose outside. No markdown fence required (return the raw JSON). Schema:

{
  "headline":               "≤120 chars; concrete claim grounded in data; second-person ('You shipped...')",
  "trajectory": [
    { "date": "YYYY-MM-DD", "line": "≤30 words; one sentence about that day's concrete work" }
    // one entry per day in day_summaries, chronological
  ],
  "standout_days": [
    { "date": "YYYY-MM-DD", "why": "1-2 sentences explaining why this day defined the week" }
    // 1 to 2 entries
  ],
  "project_areas": [
    {
      "display_name": "exact name from input projects[].display_name",
      "description": "1-3 sentences naming WHAT was actually built/shipped in this project this week, grounded in shipped_titles + day_summaries. Reference real PR titles and concrete outcomes."
    }
    // one entry per project that had non-zero agent_min, top 5 by share. SKIP projects with <5% share unless they shipped a PR.
  ],
  "interaction_style": {
    "narrative": "2-3 paragraphs in second-person describing HOW the user worked this week — delegation patterns, interruption habits, where they course-corrected, what tools dominated. Ground every claim in counts/outcomes from the data. No archetype labels.",
    "key_pattern": "≤30 words; the single most characteristic working pattern of the week"
  },
  "friction_categories": [
    {
      "category": "≤80 chars; name of the friction theme",
      "description": "2-3 sentences clustering this kind of friction across days; explain root cause if visible.",
      "examples": [
        "1-2 sentences; concrete incident grounded in a day_summary's what_hit_friction or a flag pattern"
        // 1-3 examples per category
      ]
    }
    // 0-4 categories total. Empty array if the week was smooth — DO NOT invent friction.
  ],
  "suggestions": {
    "claude_md_additions": [
      {
        "addition": "Markdown-formatted block to paste into CLAUDE.md. Must include the section heading.",
        "why": "1-2 sentences citing the data that motivates this rule (point at days, flag counts, friction patterns).",
        "prompt_scaffold": "Where in CLAUDE.md to put it (e.g. 'Add as a new top-level ## Verification Workflow section near the top')."
      }
      // 1-3 entries
    ],
    "features_to_try": [
      {
        "feature": "Claude Code feature name (e.g. Custom Skills, Hooks, Headless Mode, Subagents, Plan Mode)",
        "one_liner": "≤30 words explaining what the feature does",
        "why_for_you": "1-2 sentences tying the feature to a concrete pattern this week (what flags / friction / repetition justifies it)",
        "example_code": "Working code snippet — bash, JSON, or markdown — that the user could paste verbatim. Use real file paths and tool names from the input. ~10-30 lines max."
      }
      // 1-3 entries
    ],
    "usage_patterns": [
      {
        "title": "≤80 chars; short title",
        "suggestion": "1-2 sentences; the change in process",
        "detail": "2-4 sentences explaining when/how to apply it, grounded in this week's data.",
        "copyable_prompt": "A multi-line prompt the user can paste into a fresh Claude Code session to apply this pattern. Should be self-contained (mention the relevant files / repo paths from this week's input)."
      }
      // 1-3 entries
    ]
  },
  "on_the_horizon": {
    "intro": "1-2 sentences framing where the user's workflow is heading based on this week's pattern.",
    "opportunities": [
      {
        "title": "≤80 chars; ambitious capability",
        "whats_possible": "2-4 sentences describing the future-state workflow vividly. Reference this week's specific friction patterns it would eliminate.",
        "how_to_try": "1-2 sentences naming the concrete tools/MCPs/skills that would compose into this.",
        "copyable_prompt": "A self-contained brief the user could paste into a fresh session to start building this. ~5-12 lines, named requirements."
      }
      // 1-3 entries
    ]
  },
  "fun_ending": {
    "headline": "≤200 chars; a single memorable moment from the week — quirky, funny, or telling. Ground in a real day_summary or flag.",
    "detail": "1-3 sentences of context."
  } | null,  // null if nothing memorable surfaced
  "at_a_glance": {
    "whats_working": "2-3 sentences summarizing the week's strongest pattern. Reference 1-2 concrete shipped PRs.",
    "whats_hindering": "2-3 sentences naming what slowed work, ON CLAUDE'S SIDE and ON YOUR SIDE.",
    "quick_wins": "2-3 sentences proposing 1-2 changes that would eliminate next week's repeat friction. Cross-link to suggestions.",
    "ambitious_workflows": "2-3 sentences pointing forward to on_the_horizon."
  }
}

CRITICAL RULES:

1. **Ground every claim** in the input data. Never invent. Never quote vanity totals (agent_min_total, total sessions) as a headline.
2. **No archetype labels.** The V1 vocabulary ("Orchestration Conductor", "Solo Builder", "Deep-dive Conversationalist", "Fire-and-go Operator") is forbidden.
3. **Use behavioural signals**: outcome_mix shape, helpfulness sparkline shifts, friction patterns clustering across days, recurring flags.
4. **Trajectory + project_areas mention concrete work** — what shipped, what stuck, where attention went. Reference projects + PR titles by name from the input.
5. **Suggestions must be copy-pasteable**: claude_md_additions are ready-to-paste blocks; features_to_try.example_code is real code; usage_patterns.copyable_prompt and on_the_horizon.opportunities[].copyable_prompt are self-contained briefs that mention this user's actual repos / tools.
6. **Cross-section coherence**: at_a_glance.whats_hindering should mirror the friction_categories themes; quick_wins should mirror the easiest of suggestions.*; ambitious_workflows should mirror on_the_horizon.opportunities.
7. **Strict JSON.** No trailing commas. No prose outside the object. No code fence.
8. **Empty-week honesty**: if the week was smooth, friction_categories MAY be []; fun_ending MAY be null. Do not pad.`;

export const DIGEST_WEEK_SYSTEM_PROMPT = SYSTEM_PROMPT;

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const ALL_OUTCOMES: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];

export function buildWeekDigestUserPrompt(base: WeekDigest, dayDigests: DayDigest[]): string {
  // Build a per-project view that includes the shipped titles for that project,
  // so the LLM can write grounded project_areas descriptions without re-searching.
  const shippedByProject = new Map<string, Array<{ title: string; date: string }>>();
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      const arr = shippedByProject.get(s.project) ?? [];
      arr.push({ title: s.title, date: dd.key });
      shippedByProject.set(s.project, arr);
    }
  }
  const flagsByProject = new Map<string, string[]>();
  for (const dd of dayDigests) {
    for (const p of dd.projects) {
      const flags = dd.top_flags.map(f => f.flag);
      const cur = flagsByProject.get(p.display_name) ?? [];
      flagsByProject.set(p.display_name, [...new Set([...cur, ...flags])]);
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
    top_flags: (flagsByProject.get(p.display_name) ?? []).slice(0, 5),
  }));

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
  };

  return JSON.stringify(payload, null, 2);
}

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
