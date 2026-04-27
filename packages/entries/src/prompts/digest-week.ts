import { z } from "zod";
import type { DayDigest, DayOutcome, WeekDigest } from "../types.js";

const DateRegex = /^\d{4}-\d{2}-\d{2}$/;

const SuggestionSchema = z.object({
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(800),
});

export const WeekDigestResponseSchema = z.object({
  headline: z.string().min(1).max(160),
  trajectory: z.array(z.object({
    date: z.string().regex(DateRegex),
    line: z.string().min(1).max(240),
  })).min(1),
  standout_days: z.array(z.object({
    date: z.string().regex(DateRegex),
    why: z.string().min(1).max(400),
  })).min(1).max(2),
  friction_themes: z.string().max(800),
  suggestion: SuggestionSchema,
}).passthrough();

export type WeekDigestResponse = z.infer<typeof WeekDigestResponseSchema>;

const SYSTEM_PROMPT = `You are the weekly digest writer for Fleetlens, a dashboard for Claude Code sessions.

You receive a JSON payload describing one calendar week (Mon-Sun, server local TZ).
Your job: produce a 5-field JSON object capturing the shape of the week.

INPUT shape:
- period: { start, end, label }
- totals: { agent_min_total, day_count_with_data }
- outcome_mix: { shipped, partial, blocked, exploratory, trivial } — counts of days. Absent values mean zero (the prompt builder pre-fills missing keys).
- helpfulness_sparkline: array of 7 entries Mon→Sun, each "essential" | "helpful" | "neutral" | "unhelpful" | null.
- projects: top 5 by minutes. Each: { display_name, agent_min, share_pct, shipped_count }.
- shipped: all PRs shipped this week, each { title, project, date }.
- top_flags, top_goal_categories.
- concurrency_peak_day: { date, peak } or null.
- day_summaries: per-day { date, day_name, headline, what_went_well, what_hit_friction, suggestion, agent_min, outcome_day, helpfulness_day }. Days with zero entries are omitted.

OUTPUT: ONE JSON object. No prose outside. No code fence. Schema:

{
  "headline":         "≤120 chars; concrete claim grounded in the data; second-person ('You shipped...')",
  "trajectory": [
    { "date": "YYYY-MM-DD", "line": "≤25 words; one sentence about that day grounded in its day_summary" }
    // one entry per day in day_summaries, in chronological order
  ],
  "standout_days": [
    { "date": "YYYY-MM-DD", "why": "1-2 sentences explaining why this day defined the week" }
    // 1 to 2 entries; never zero unless day_summaries is empty
  ],
  "friction_themes":  "2-3 sentences clustering recurring friction across days; empty string if no friction",
  "suggestion":       { "headline": "≤120 chars, imperative", "body": "2-3 sentences, actionable" }
}

CRITICAL RULES:

1. Ground every claim in the data. Never invent. Never quote totals (agent_min_total, total_sessions) as a headline — those are vanity. Use behavioural signals: outcome shape, helpfulness trajectory, friction patterns.
2. No archetype labels ("Orchestration Conductor", "Solo Builder" — these are V1 vocabulary; do NOT use them).
3. Trajectory lines mention concrete work — what shipped, what stuck, where attention went — not vibes. Reference projects by name.
4. Standout days are days where outcome_day or helpfulness_day deviates meaningfully from the rest of the week, OR a day that produced a disproportionate share of the week's shipped work.
5. Strict JSON. No trailing commas. No prose outside the object.`;

export const DIGEST_WEEK_SYSTEM_PROMPT = SYSTEM_PROMPT;

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const ALL_OUTCOMES: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];

export function buildWeekDigestUserPrompt(base: WeekDigest, dayDigests: DayDigest[]): string {
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

  const payload = {
    period: { start: base.window.start, end: base.window.end, label: base.key },
    totals: {
      agent_min_total: Math.round(base.agent_min_total),
      day_count_with_data: day_summaries.length,
    },
    outcome_mix,
    helpfulness_sparkline: base.helpfulness_sparkline,
    projects: base.projects.slice(0, 5).map(p => ({
      display_name: p.display_name ?? prettyProject(p.name),
      agent_min: Math.round(p.agent_min),
      share_pct: Math.round(p.share_pct * 10) / 10,
      shipped_count: p.shipped_count,
    })),
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
