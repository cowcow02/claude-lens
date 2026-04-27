import { z } from "zod";
import type { DayOutcome, MonthDigest, WeekDigest } from "../types.js";

const DateRegex = /^\d{4}-\d{2}-\d{2}$/;

const SuggestionSchema = z.object({
  headline: z.string().min(1).max(120),
  body: z.string().min(1).max(800),
});

export const MonthDigestResponseSchema = z.object({
  headline: z.string().min(1).max(160),
  trajectory: z.array(z.object({
    week_start: z.string().regex(DateRegex),
    line: z.string().min(1).max(280),
  })).min(1),
  standout_weeks: z.array(z.object({
    week_start: z.string().regex(DateRegex),
    why: z.string().min(1).max(400),
  })).min(1).max(2),
  friction_themes: z.string().max(800),
  suggestion: SuggestionSchema,
}).passthrough();

export type MonthDigestResponse = z.infer<typeof MonthDigestResponseSchema>;

const SYSTEM_PROMPT = `You are the monthly digest writer for Fleetlens.

You receive a JSON payload describing one calendar month, summarised through its 4–5 weekly digests.
Your job: produce a 5-field JSON object capturing the shape of the month.

INPUT shape:
- period: { start, end, label } — label is the month name e.g. "April 2026"
- totals: { agent_min_total, week_count_with_data }
- outcome_mix: { shipped, partial, blocked, exploratory, trivial, idle } — counts of DAYS in the month bucketed by their day-level outcome. Absent values are zero.
- helpfulness_by_week: array of { week_start, helpfulness } where helpfulness is "essential" | "helpful" | "neutral" | "unhelpful" | null.
- projects: top 5 by minutes.
- shipped: all PRs shipped this month, each { title, project, date }.
- top_flags, top_goal_categories.
- concurrency_peak_week: { week_start, peak } or null.
- week_summaries: per-week { week_start, headline, trajectory (array of day-line objects), standout_days, friction_themes, suggestion, agent_min, helpfulness_week }.

OUTPUT: ONE JSON object. No prose outside. Schema:

{
  "headline":         "≤120 chars; concrete claim grounded in the data; second-person",
  "trajectory": [
    { "week_start": "YYYY-MM-DD", "line": "≤30 words; one sentence about that week grounded in its week_summary" }
    // one entry per week_summary in chronological order
  ],
  "standout_weeks": [
    { "week_start": "YYYY-MM-DD", "why": "1-2 sentences explaining why this week defined the month" }
    // 1 to 2 entries
  ],
  "friction_themes":  "2-3 sentences clustering recurring friction patterns across weeks; empty string if no friction stuck",
  "suggestion":       { "headline": "≤120 chars, imperative", "body": "2-3 sentences, actionable for next month" }
}

RULES:

1. Ground every claim in the data. No archetype labels.
2. Trajectory lines name the dominant work of each week — projects shipped, themes that ran across multiple days, blockers that persisted.
3. Standout weeks are weeks that shipped disproportionately, were unusually blocked, or shifted the trajectory of the month.
4. Friction themes look at recurrence — friction that appeared in 2+ weeks deserves naming; one-week friction usually doesn't.
5. Strict JSON.`;

export const DIGEST_MONTH_SYSTEM_PROMPT = SYSTEM_PROMPT;

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const ALL_OUTCOMES: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];

export function buildMonthDigestUserPrompt(base: MonthDigest, weekDigests: WeekDigest[]): string {
  const week_summaries = weekDigests
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(w => {
      const helpfulness_week = w.helpfulness_sparkline.find(h => h !== null) ?? null;
      return {
        week_start: w.key,
        headline: w.headline,
        trajectory: w.trajectory,
        standout_days: w.standout_days,
        friction_themes: w.friction_themes,
        suggestion: w.suggestion,
        agent_min: Math.round(w.agent_min_total),
        helpfulness_week,
      };
    });

  const outcome_mix: Record<DayOutcome, number> = {
    shipped: 0, partial: 0, blocked: 0, exploratory: 0, trivial: 0, idle: 0,
  };
  for (const k of ALL_OUTCOMES) outcome_mix[k] = base.outcome_mix[k] ?? 0;

  const payload = {
    period: { start: base.window.start, end: base.window.end, label: monthLabel(base.key) },
    totals: {
      agent_min_total: Math.round(base.agent_min_total),
      week_count_with_data: week_summaries.length,
    },
    outcome_mix,
    helpfulness_by_week: base.helpfulness_by_week,
    projects: base.projects.slice(0, 5).map(p => ({
      display_name: p.display_name ?? prettyProject(p.name),
      agent_min: Math.round(p.agent_min),
      share_pct: Math.round(p.share_pct * 10) / 10,
      shipped_count: p.shipped_count,
    })),
    shipped: base.shipped.map(s => ({ title: s.title, project: s.project, date: s.date })),
    top_flags: base.top_flags,
    top_goal_categories: base.top_goal_categories,
    concurrency_peak_week: base.concurrency_peak_week,
    week_summaries,
  };

  return JSON.stringify(payload, null, 2);
}

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!y || !m) return yearMonth;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
