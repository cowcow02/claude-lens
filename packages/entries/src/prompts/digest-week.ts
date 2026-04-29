import { z } from "zod";
import type {
  DayDigest, DayOutcome, WeekDigest, WorkingShape,
} from "../types.js";
import { flagGlossaryForPrompt, FLAG_GLOSSARY } from "../flag-glossary.js";

const DateRegex = /^\d{4}-\d{2}-\d{2}$/;

const WORKING_SHAPES: NonNullable<WorkingShape>[] = [
  "spec-review-loop", "chunk-implementation", "research-then-build",
  "reviewer-triad", "background-coordinated", "solo-continuation",
  "solo-design", "solo-build",
];

const ProjectAreaResponseSchema = z.object({
  display_name: z.string().min(1),
  description: z.string().min(1).max(600),
});

const FindingSchema = z.object({
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(700),
  /** A WorkingShape value, or "interaction_grammar.<key>", or "plan-mode-gap". */
  anchor: z.string().min(1).max(80),
  evidence: z.object({
    date: z.string().regex(DateRegex),
    quote: z.string().min(1).max(400),
  }),
});

const SurpriseSchema = FindingSchema.extend({
  surprise_kind: z.enum(["outlier", "novel-use", "user-built-tool", "cross-week-contrast"]),
});

const LeanInSchema = FindingSchema.extend({
  lean_kind: z.enum(["claude-md", "skill", "hook", "harness", "decision"]),
  copyable: z.string().max(2000).nullable(),
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
  what_worked: z.array(FindingSchema).min(1).max(6),
  what_stalled: z.array(FindingSchema).max(5),
  what_surprised: z.array(SurpriseSchema).max(4),
  where_to_lean: z.array(LeanInSchema).min(1).max(7),
}).passthrough();

export type WeekDigestResponse = z.infer<typeof WeekDigestResponseSchema>;

const SYSTEM_PROMPT = `You are the weekly retrospective writer for Fleetlens, a dashboard for Claude Code sessions.

Your unique advantage: you receive both **already-synthesized day digests** AND a **per-week classification of how the user drove agents** — named orchestration shapes, the user's interaction grammar, and counts. Your job is to take that texture and tell a coherent story about WHO this user is as a Claude Code operator THIS WEEK and what they should do next.

The reader sees, before reading your prose:
  • A "Working shapes" section listing each named pattern (spec-review-loop, chunk-implementation, research-then-build, reviewer-triad, background-coordinated, solo-continuation, solo-design, solo-build) with usage count, occurrence dates, and one quoted subagent or first_user as evidence.
  • An "Interaction grammar" section showing brainstorming-warmup days, prompt-frames detected (teammate / handoff-prose / image-attached / local-command-caveat), user-authored skills used, multi-day threads, TodoWrite total, and Plan Mode usage.
  • A "By the numbers" fold-down with raw counts.

Do NOT redescribe what those sections already show. Build ON them. Every claim you write must cite either a working_shape, a grammar element, or "plan-mode-gap" by name.

INPUT shape (JSON payload):
- period: { start, end, label }
- totals: { agent_min_total, day_count_with_data }
- outcome_mix: { shipped, partial, blocked, exploratory, trivial, idle }
- helpfulness_sparkline: 7 entries Mon→Sun
- projects: per-project rollups
- shipped: PRs with date+project
- top_flags, top_goal_categories
- working_shapes: array of { shape, occurrence_count, days[], outcome_distribution, sample_evidence (one quoted subagent prompt or first_user with date) }
- interaction_grammar:
    - brainstorming_warmup_days[]
    - prompt_frames[]: { frame, origin: "claude-feature" | "personal-habit", count, days[] }
        — Claude features the user employs (teammate from agent teams, task-notification from Monitor tool, local-command-caveat, slash-command, image-attached) vs personal habits the user has adopted (handoff-prose for cross-session compaction). Don't mistake claude-feature framings for things the user invented.
    - user_authored_skills[]: { skill, count, days[] }
    - skill_families[]: { family, members[], total_count, days[] }
        — User-authored skills sharing a prefix-before-hyphen. Surfaces cohesive harness toolchains (e.g. "harness" family covering harness-build, harness-build-pickup, harness-orchestrate-analyze).
    - user_authored_subagents[]: { type, count, days[], sample_description, sample_prompt_preview }
        — Task-tool subagent types not in the stock set (general-purpose / Explore / Plan / claude-code-guide / superpowers:* / etc.). These are the user's own subagent definitions; surface them by name.
    - threads[]: { thread_id, entries[], total_active_min, outcome }
    - communication_style:
        - verbosity_distribution: { short (<100c), medium (100-500c), long (500-2000c), very_long (>2000c) }
            — Histogram of first_user lengths. High very_long count = user explains a lot per directive (high control); high short count = user gives terse imperatives or relies on external context (high delegation).
        - external_context_refs[]: { date, session_id, ref_kind: "linear-kip"|"github-issue-pr"|"branch-ref"|"url", preview }
            — Sessions that opened by referencing an external system (KIP-N, issue #N, branch refs, URLs) rather than spelling out the work. Indicator of "go look it up" delegation.
        - steering: { total_interrupts, total_frustrated, total_dissatisfied, sessions_with_mid_run_redirect, total_turns }
            — Corrections during execution. Normalize against total_turns to estimate steering intensity.
    - todo_ops_total
    - plan_mode: { exit_plan_calls, days_with_plan }
- day_summaries: per-day { date, day_name, headline, what_went_well, what_hit_friction, suggestion, agent_min, outcome_day, helpfulness_day, top_flags, day_signature (≤120 chars LLM-produced shape sentence — quotable verbatim), dominant_shape (named working shape OR "mixed" OR null), shape_distribution (per-shape session counts), day_signals_summary (compact: skills_loaded with origin, user_authored_subagents, prompt_frames with origin, verbosity histogram, external_refs_count, steering counts, brainstorm_warmup_session_count, plan_mode_used, todo_ops_total) }
- flag_glossary

OUTPUT: ONE JSON object. Strict JSON, no prose outside, no fence.

{
  "headline": "≤120 chars; second-person; names a working shape OR a grammar element by name. Bad: 'You shipped 22 PRs.' Good: 'You shipped 22 PRs through your spec-review-loop on the four design-anchored days, with zero plan gates.'",

  "key_pattern": "≤80 chars; ONE sentence subhead. Names the dominant working_shape + the grammar element that defined the week (skill ritual / harness frame / thread / plan-mode absence). Reference at least two anchors.",

  "trajectory": [
    { "date": "YYYY-MM-DD", "line": "≤30 words; describe that day's work AS AN INSTANCE of the shape it was classified into. When the day's day_signature is present, you MAY quote it verbatim (it is concise and already grounded) instead of re-deriving. E.g. 'Wed: spec-review-loop on Phase 1b — 3 reviewer dispatches before code, shipped clean.'" }
    // one per day_summary, chronological
  ],

  "standout_days": [
    { "date": "YYYY-MM-DD", "why": "1-2 sentences. The standout is always BECAUSE of the shape used — name it." }
    // 1-2 entries
  ],

  "project_areas": [
    { "display_name": "exact match", "description": "1-3 sentences: WHAT was built/shipped + which working_shape produced it." }
    // one per project with non-zero agent_min, top by share. Skip <5% share unless they shipped.
  ],

  "what_worked": [
    {
      "title": "≤120 chars; the good thing observed",
      "detail": "2-4 sentences. Cite the shape AND the evidence. E.g. 'The spec-review-loop shipped 3 of 3 designs cleanly. Phase 1b, V2 perception, and self-update all reached implementation with reviewer subagents having already surfaced gaps. The pattern caught issues at spec time.'",
      "anchor": "<one of: spec-review-loop|chunk-implementation|research-then-build|reviewer-triad|background-coordinated|solo-continuation|solo-design|solo-build|interaction_grammar.brainstorming_warmup_days|interaction_grammar.threads|interaction_grammar.user_authored_skills|interaction_grammar.prompt_frames>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "verbatim from a day_summary or working_shapes.sample_evidence — must be substring of the input data" }
    }
    // 3-6 items. SORT BY load-bearing-ness — most week-defining first.
  ],

  "what_stalled": [
    {
      "title": "≤120 chars; what didn't go well",
      "detail": "2-4 sentences. Cite the shape it stalled INSIDE. Friction is mode-shape-specific. E.g. 'API connectivity errors cut Mon + Tue. Both stalls happened at the END of unbroken solo-build runs in long-autonomous mode — the same shape that shipped clean elsewhere. The transport failure is shape-specific: long-autonomous runs have no checkpoint to recover to.'",
      "anchor": "<working_shape OR grammar key OR 'plan-mode-gap'>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "verbatim from day_summary.what_hit_friction or final_agent" }
    }
    // 0-5 items. Empty array if the week was smooth.
  ],

  "what_surprised": [
    {
      "title": "≤120 chars; the unexpected/novel observation",
      "detail": "2-4 sentences naming why this stood out — outlier shape usage, novel application, user-authored tooling, cross-week contrast.",
      "anchor": "<working_shape OR grammar key OR 'plan-mode-gap'>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "verbatim from input data" },
      "surprise_kind": "<one of: outlier|novel-use|user-built-tool|cross-week-contrast>"
    }
    // 0-4 items. Empty array if nothing surprising surfaced.
  ],

  "where_to_lean": [
    {
      "title": "≤120 chars; the recommendation, in active voice",
      "detail": "3-5 sentences. NAME the gap — what the user does well already, and the specific gap this addresses. Tie to anchor.",
      "anchor": "<working_shape OR grammar key OR 'plan-mode-gap'>",
      "evidence": { "date": "YYYY-MM-DD", "quote": "data quote that motivated this recommendation" },
      "lean_kind": "<one of: claude-md|skill|hook|harness|decision>",
      "copyable": "Markdown block / prompt / rule the user can paste somewhere — null if 'decision' kind"
    }
    // 3-6 items.
  ]
}

ANCHORING RULES (critical — every finding must pass these):

1. **Every what_worked / what_stalled / what_surprised / where_to_lean MUST set anchor** to a value that exists in the input:
   - A working_shapes[].shape value the user actually used this week, OR
   - "interaction_grammar.<key>" where key is one of: brainstorming_warmup_days, prompt_frames, user_authored_skills, skill_families, user_authored_subagents, threads, communication_style.verbosity, communication_style.external_refs, communication_style.steering, OR
   - "day_signals.<key>" where key is one of: dominant_shape, shape_distribution, comm_style, user_authored_skills_used, user_authored_subagents_used, prompt_frames, plan_mode_used, brainstorm_warmup_session_count — use these when the finding is grounded in a single day's classification rather than a week-level rollup, OR
   - "plan-mode-gap" (only valid when interaction_grammar.plan_mode.exit_plan_calls === 0)

2. **Every evidence.quote MUST appear verbatim** somewhere in the input — day_summary.headline / what_went_well / what_hit_friction, working_shapes[].occurrences[].evidence_subagent.prompt_preview, working_shapes[].occurrences[].evidence_first_user, or interaction_grammar fields. The harness will substring-check; ungrounded findings are dropped automatically.

3. **No floating prose.** "You had a productive week" is not a finding. "Your spec-review-loop shipped 3 of 3 with \`general-purpose\` reviewers" IS a finding.

4. **what_stalled MUST cite the working_shape it stalled inside.** Generic friction without shape-anchor is dropped. "ConnectionRefused interrupted Mon's solo-build push" is anchored. "Connection errors are bad" is not.

5. **where_to_lean[].lean_kind discipline:**
   - "claude-md" → copyable is a markdown block ready to paste into CLAUDE.md
   - "skill" → copyable is a skill file's YAML frontmatter + body, OR a description of what to write
   - "hook" → copyable is the .claude/hooks.json snippet
   - "harness" → copyable is the harness skill name + a brief description of how to use it
   - "decision" → copyable is null. The lean is a decision the user must make explicitly (e.g. "is Plan Mode a gap or are spec-review subagents your post-Plan-Mode workflow?")

6. **No archetype labels.** No "Orchestration Conductor" / "Solo Builder" / personality-quiz framing. Working shapes are observed patterns, not identity claims.

7. **Strict JSON.** No trailing commas, no prose outside, no fence.

USER-IDENTITY RULES (read carefully — these often go wrong):

- **Claude features the user employs ≠ tools the user built.** \`<teammate-message>\` is from Claude's agent-teams feature, not a user invention. \`<task-notification>\` is from the Monitor tool. \`<local-command-caveat>\` is a Claude convention. \`<command-message>\` / \`<command-name>\` is the slash-command framing. The \`origin\` field on each prompt_frame says which is which — respect it. "You used Claude's agent-teams feature on N days" is correct; "you designed the teammate-message format" is wrong.

- **What IS the user's own harness:** user_authored_skills (anything not matching stock prefixes), skill_families (the cohesive toolchains they roll up to — e.g. "harness-*"), user_authored_subagents (Task subagent types not in the stock set — e.g. \`implement-teammate\`), and any custom slash commands (visible via prompt_frames[frame=slash-command] and the \`<command-name>\` content). When you describe their harness, name THESE.

- **handoff-prose is a personal compaction habit, NOT a standard pattern.** Treat it as "a recent personal habit you've adopted to break a long-running thread into multiple sessions." Don't elevate it to the same level as named working shapes. Don't recommend others copy it.

COMMUNICATION-STYLE RULES:

- The verbosity distribution + external_context_refs together describe how the user delegates. Many short prompts + many external refs = high delegation ("go look it up yourself"). Many very_long prompts + few external refs = high control ("here's everything you need, follow it"). Mixed is mixed; say so.

- Steering intensity is interrupts + frustrated + dissatisfied normalized against total_turns. Low steering on a high-output week = trust paid off. High steering on a low-output week = friction. High steering on a high-output week = micro-managed but successful — the user paid for output with attention.

- These dimensions belong in what_worked / what_stalled / what_surprised when the data shows something specific. Anchor to "communication_style.verbosity" / "communication_style.external_refs" / "communication_style.steering" as appropriate.

VOCABULARY RULES:

- The reader is a developer, not a parser-internals reader. Write like a coworker recapping the week.
- Don't use "flagged" as a verb. Flags aren't actors.
- Internal flag tokens (loop_suspected, long_autonomous, orchestrated, fast_ship, plan_used, interrupt_heavy, high_errors) are forbidden as nouns or subjects. Tokens MAY appear inside evidence.quote when the verbatim text used them.
- Working-shape names (spec-review-loop, chunk-implementation, etc.) ARE allowed and ENCOURAGED in prose — they're the named patterns the reader sees in the report's first section.
- Prefer naming the actual subagent type ("\`general-purpose\` dispatches", "\`superpowers:code-reviewer\`") over abstract "subagents" when the type is load-bearing.
- "Plan Mode" specifically refers to the canonical /plan tool. "spec-review subagents" is the user's actual planning approach when that's what the data shows.
`;

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
      // Per-day pattern detection — already-classified signal that the LLM
      // anchors against and quotes verbatim instead of re-deriving.
      day_signature: d.day_signature ?? null,
      dominant_shape: d.day_signals?.dominant_shape ?? null,
      shape_distribution: d.day_signals?.shape_distribution ?? {},
      day_signals_summary: d.day_signals ? {
        skills_loaded: d.day_signals.skills_loaded.slice(0, 6).map(s => `${s.skill} (${s.origin})${s.count > 1 ? `×${s.count}` : ""}`),
        user_authored_subagents: d.day_signals.user_authored_subagents_used.slice(0, 4).map(sa =>
          `${sa.type}${sa.count > 1 ? `×${sa.count}` : ""}`,
        ),
        prompt_frames: d.day_signals.prompt_frames.map(f => `${f.frame}(${f.origin})${f.count > 1 ? `×${f.count}` : ""}`),
        verbosity: d.day_signals.comm_style.verbosity_distribution,
        external_refs_count: d.day_signals.comm_style.external_refs.length,
        steering: d.day_signals.comm_style.steering,
        brainstorm_warmup_session_count: d.day_signals.brainstorm_warmup_session_count,
        plan_mode_used: d.day_signals.plan_mode_used,
        todo_ops_total: d.day_signals.todo_ops_total,
      } : null,
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

  // Compact working_shapes payload for the prompt — one sample evidence per
  // shape rather than every occurrence.
  const working_shapes_view = (base.working_shapes ?? []).map(row => {
    const sample = row.occurrences.find(o => o.evidence_subagent !== null) ?? row.occurrences[0];
    return {
      shape: row.shape,
      occurrence_count: row.occurrences.length,
      days: [...new Set(row.occurrences.map(o => o.date))].sort(),
      outcome_distribution: row.outcome_distribution,
      sample_evidence: sample ? {
        date: sample.date,
        project_display: sample.project_display,
        subagent_type: sample.evidence_subagent?.type ?? null,
        subagent_description: sample.evidence_subagent?.description ?? null,
        prompt_preview: sample.evidence_subagent?.prompt_preview ?? null,
        first_user_preview: sample.evidence_first_user,
      } : null,
    };
  });

  const presentFlags = new Set<string>();
  for (const f of base.top_flags) presentFlags.add(f.flag);
  for (const dd of dayDigests) for (const f of dd.top_flags) presentFlags.add(f.flag);
  const glossary = flagGlossaryForPrompt().filter(g => presentFlags.has(g.token));
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
    working_shapes: working_shapes_view,
    interaction_grammar: base.interaction_grammar,
    day_summaries,
    flag_glossary: glossary,
    valid_anchors: {
      working_shapes: WORKING_SHAPES,
      grammar: [
        "interaction_grammar.brainstorming_warmup_days",
        "interaction_grammar.prompt_frames",
        "interaction_grammar.user_authored_skills",
        "interaction_grammar.skill_families",
        "interaction_grammar.user_authored_subagents",
        "interaction_grammar.threads",
        "interaction_grammar.communication_style.verbosity",
        "interaction_grammar.communication_style.external_refs",
        "interaction_grammar.communication_style.steering",
      ],
      day_level: [
        "day_signals.dominant_shape",
        "day_signals.shape_distribution",
        "day_signals.comm_style",
        "day_signals.user_authored_skills_used",
        "day_signals.user_authored_subagents_used",
        "day_signals.prompt_frames",
        "day_signals.plan_mode_used",
        "day_signals.brainstorm_warmup_session_count",
      ],
      decision: ["plan-mode-gap"],
    },
  };

  return JSON.stringify(payload, null, 2);
}

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
