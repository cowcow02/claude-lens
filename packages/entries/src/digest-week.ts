import {
  CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
  PROMPT_FRAME_ORIGIN,
  type DayDigest, type DayHelpfulness, type DayOutcome, type Entry, type EntrySubagent,
  type WeekDigest, type WeekInteractionModes, type WeekWorkingShapeRow,
  type WeekInteractionGrammar, type WorkingShape, type SubagentRole,
  type PromptFrame, type SkillOrigin,
} from "./types.js";
import {
  DIGEST_WEEK_SYSTEM_PROMPT,
  WeekDigestResponseSchema,
  buildWeekDigestUserPrompt,
} from "./prompts/digest-week.js";
import type { CallLLM, EnrichUsage } from "./enrich.js";
import { computeCostUsd } from "./enrich.js";
import { runClaudeSubprocess, parseAndValidate } from "./llm-runner.js";

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Mon-Sun array of dates from a Monday key. Mutates nothing. */
export function weekDates(monday: string): string[] {
  const start = new Date(`${monday}T00:00:00`);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(toLocalDateString(d));
  }
  return out;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aggregate per-Entry interaction signals into a week-level snapshot.
 *  Treats `subagents`, `skills`, `numbers.subagent_calls/skill_calls/task_ops/
 *  exit_plan_calls/interrupts/turn_count/tools_total`, and the `long_autonomous`
 *  flag as the load-bearing inputs. Day-bucketing uses `local_day` for the
 *  "days_with_*" denominators. Also surfaces qualitative examples — actual
 *  subagent prompts, skill+first_user pairings, longest-turn detail — so
 *  downstream prose has texture to quote rather than just counts to recite. */
export function computeInteractionModes(entries: Entry[]): WeekInteractionModes {
  const subagentCallsByDay = new Map<string, number>();
  const skillCallsByDay = new Map<string, number>();
  const planCallsByDay = new Map<string, number>();
  const longAutonomousDays = new Set<string>();

  let subagent_calls = 0, task_ops = 0, skill_calls = 0;
  let exit_plan_calls = 0, interrupts = 0;
  let tools_total = 0, turn_count = 0;

  const subagentTypes = new Map<string, number>();
  const skillNames = new Map<string, number>();

  for (const e of entries) {
    const day = e.local_day;
    subagent_calls += e.numbers.subagent_calls;
    skill_calls += e.numbers.skill_calls;
    task_ops += e.numbers.task_ops;
    exit_plan_calls += e.numbers.exit_plan_calls;
    interrupts += e.numbers.interrupts;
    tools_total += e.numbers.tools_total;
    turn_count += e.numbers.turn_count;

    if (e.numbers.subagent_calls > 0) {
      subagentCallsByDay.set(day, (subagentCallsByDay.get(day) ?? 0) + e.numbers.subagent_calls);
    }
    if (e.numbers.skill_calls > 0) {
      skillCallsByDay.set(day, (skillCallsByDay.get(day) ?? 0) + e.numbers.skill_calls);
    }
    if (e.numbers.exit_plan_calls > 0 || e.flags.includes("plan_used")) {
      planCallsByDay.set(day, (planCallsByDay.get(day) ?? 0) + e.numbers.exit_plan_calls);
    }
    if (e.flags.includes("long_autonomous")) longAutonomousDays.add(day);

    for (const sa of e.subagents) {
      subagentTypes.set(sa.type, (subagentTypes.get(sa.type) ?? 0) + 1);
    }
    for (const [skill, count] of Object.entries(e.skills)) {
      skillNames.set(skill, (skillNames.get(skill) ?? 0) + count);
    }
  }

  const top_types = [...subagentTypes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
  const top_skills = [...skillNames.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill, count]) => ({ skill, count }));

  // ── Qualitative examples ────────────────────────────────────────────────
  // Pick up to 3 distinctive subagent dispatches: prefer one per top_type
  // (prevents one busy day from monopolizing the examples), pulling the
  // longest prompt_preview within each type since longer = more texture.
  const subagentExamples: WeekInteractionModes["orchestration"]["examples"] = [];
  const seenTypes = new Set<string>();
  const allDispatches: Array<{ entry: Entry; sa: typeof entries[0]["subagents"][0] }> = [];
  for (const e of entries) for (const sa of e.subagents) allDispatches.push({ entry: e, sa });
  // Sort by prompt_preview length desc; pick first match per type.
  allDispatches.sort((a, b) => b.sa.prompt_preview.length - a.sa.prompt_preview.length);
  for (const { entry, sa } of allDispatches) {
    if (subagentExamples.length >= 3) break;
    if (seenTypes.has(sa.type)) continue;
    seenTypes.add(sa.type);
    subagentExamples.push({
      date: entry.local_day,
      project_display: prettyProject(entry.project),
      type: sa.type,
      prompt_preview: truncate(sa.prompt_preview, 200),
    });
  }

  // Pick up to 3 distinct skills with the first_user from an entry that loaded
  // them — gives the reader a sense of *why* the skill was reached for.
  const skillExamples: WeekInteractionModes["skill_use"]["examples"] = [];
  const seenSkills = new Set<string>();
  for (const e of entries) {
    for (const skill of Object.keys(e.skills)) {
      if (skillExamples.length >= 3) break;
      if (seenSkills.has(skill)) continue;
      if (!e.first_user || e.first_user.length < 8) continue;
      seenSkills.add(skill);
      skillExamples.push({
        date: e.local_day,
        skill,
        first_user_preview: truncate(e.first_user, 200),
      });
    }
  }

  // The long-autonomous entry with the highest active_min — captures the
  // most-illustrative single push.
  let longestTurnEntry: Entry | null = null;
  for (const e of entries) {
    if (!e.flags.includes("long_autonomous")) continue;
    if (!longestTurnEntry || e.numbers.active_min > longestTurnEntry.numbers.active_min) {
      longestTurnEntry = e;
    }
  }
  const longest_turn = longestTurnEntry ? {
    date: longestTurnEntry.local_day,
    project_display: prettyProject(longestTurnEntry.project),
    active_min: longestTurnEntry.numbers.active_min,
    top_tools: longestTurnEntry.top_tools.slice(0, 5),
    first_user_preview: truncate(longestTurnEntry.first_user, 200),
  } : null;

  const tools_per_turn = turn_count > 0 ? tools_total / turn_count : 0;
  // 5 / 15 thresholds calibrated to feel right on observed dogfood weeks: a
  // 5-tool turn is a focused single task, 15+ is a clearly batched run.
  const label: WeekInteractionModes["turn_shape"]["label"] =
    tools_per_turn < 5 ? "rapid" : tools_per_turn < 15 ? "mixed" : "batch";

  return {
    orchestration: {
      subagent_calls,
      task_ops,
      days_with_subagents: subagentCallsByDay.size,
      top_types,
      examples: subagentExamples,
    },
    skill_use: {
      skill_calls,
      days_with_skills: skillCallsByDay.size,
      top_skills,
      examples: skillExamples,
    },
    plan_gating: {
      exit_plan_calls,
      days_with_plan: planCallsByDay.size,
    },
    turn_shape: {
      tools_per_turn: Math.round(tools_per_turn * 10) / 10,
      interrupts,
      long_autonomous_days: longAutonomousDays.size,
      label,
      longest_turn,
    },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// ─── Subagent role classification ────────────────────────────────────────

/** Map a subagent's description + prompt_preview to a role label. Order
 *  matters: more specific verbs win. */
export function classifySubagentRole(sa: EntrySubagent): SubagentRole {
  const text = `${sa.description} ${sa.prompt_preview}`.toLowerCase();
  if (/\b(re-?review|review[s]?|verify|audit|spec[- ]review|code[- ]quality|code[- ]reuse|efficiency review|sanity check|quick test)\b/.test(text)) {
    return "reviewer";
  }
  if (/\b(implement|build chunk|build task|initialize|create the|add the)\b/.test(text)) {
    return "implementer";
  }
  if (/\bexplore\b|\binventory\b|\bmap\b.*\b(codebase|repo|branch)\b|\baudit\b.*coverage/.test(text)) {
    return "explorer";
  }
  if (/\b(investigate|research|reverse[- ]engineer|study|analy[sz]e|look up|tell me|brief me on|find out)\b/.test(text)) {
    return "researcher";
  }
  if (/\b(env(?:ironment)? setup|configure|setup|bootstrap)\b/.test(text)) {
    return "env-setup";
  }
  if (/\b(polish|cleanup|fix|refactor)\b/.test(text)) {
    return "polish";
  }
  return "other";
}

/** Subagent types shipped with Claude Code or the public superpowers / mcp /
 *  codex / frontend-design / code-review / claude-code-guide / playwright-qa-verifier
 *  / statusline-setup / Plan / Explore / general-purpose set. Anything else is
 *  treated as user-authored. */
const STOCK_SUBAGENT_PREFIXES = /^(general-purpose|Explore|Plan|claude-code-guide|playwright-qa-verifier|statusline-setup|frontend-design:|code-review:|code-simplifier:|codex:|superpowers:)/;

export function isStockSubagentType(type: string): boolean {
  return STOCK_SUBAGENT_PREFIXES.test(type);
}

// ─── Working-shape inference ─────────────────────────────────────────────

/** Map a single Entry's session-shape from its subagent dispatches + first_user
 *  + skills. Returns null when the entry is too small to characterize (trivial
 *  outcomes, < 1 turn). */
export function inferWorkingShape(entry: Entry): WorkingShape {
  if (entry.numbers.turn_count < 2) return null;

  const subagents = entry.subagents ?? [];
  const roles = subagents.map(classifySubagentRole);
  const reviewerCount = roles.filter(r => r === "reviewer").length;
  const implementerCount = roles.filter(r => r === "implementer").length;
  const explorerOrResearcher = roles.filter(r => r === "explorer" || r === "researcher").length;
  const hasBackground = subagents.some(sa => sa.background);

  // 1. Chunk implementation — 2+ implementer dispatches against numbered
  //    chunks/tasks. Checked first because chunk-implementation sessions
  //    often ALSO carry per-chunk reviewer dispatches; we don't want those
  //    to trip reviewer-triad detection.
  if (implementerCount >= 2) {
    const chunkRefs = subagents.filter(sa => /\b(chunk|task)\s*\d+/i.test(`${sa.description} ${sa.prompt_preview}`));
    if (chunkRefs.length >= 2) return "chunk-implementation";
  }

  // 2. Reviewer triad — 3+ reviewers with distinct lens descriptions, AND
  //    no implementer dispatches in the same session (pure review mode on
  //    a single diff, not chunked work). The defining shape is: same diff
  //    going through 3 different review lenses.
  if (reviewerCount >= 3 && implementerCount === 0) {
    const lensSigs = new Set<string>();
    for (let i = 0; i < subagents.length; i++) {
      if (roles[i] !== "reviewer") continue;
      // Lens signature = first 3 distinctive words from description.
      const sig = subagents[i]!.description.toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 3)
        .join("|");
      lensSigs.add(sig);
    }
    if (lensSigs.size >= 3) return "reviewer-triad";
  }

  // 3. Spec-review loop — 2+ reviewer dispatches (against the same target,
  //    or with re-review markers).
  if (reviewerCount >= 2) return "spec-review-loop";

  // 4. Research-then-build — explorer/researcher dispatches present AND
  //    implementer dispatches OR substantial post-research work.
  if (explorerOrResearcher >= 2 || (explorerOrResearcher >= 1 && implementerCount >= 1)) {
    return "research-then-build";
  }

  // 5. Background-coordinated — any background:true subagent + foreground work.
  if (hasBackground && subagents.length >= 1) return "background-coordinated";

  // 6. Solo shapes (no subagents).
  if (subagents.length === 0) {
    const first = (entry.first_user || "").trim().toLowerCase();
    if (/^continue\b/.test(first) || first === "continue.") return "solo-continuation";
    const skills = Object.keys(entry.skills ?? {});
    if (skills.some(s => /brainstorm|writing-plans|brainstorming/i.test(s))) return "solo-design";
    return "solo-build";
  }

  // Mixed but doesn't match a named pattern — fall through to solo-build.
  return "solo-build";
}

// ─── Prompt-frame detection ──────────────────────────────────────────────

export function detectPromptFrames(text: string | null | undefined): PromptFrame[] {
  if (!text) return [];
  const out: PromptFrame[] = [];
  if (/<teammate-message\b/i.test(text)) out.push("teammate");
  if (/<task-notification\b/i.test(text)) out.push("task-notification");
  if (/<local-command-caveat\b/i.test(text)) out.push("local-command-caveat");
  if (/<command-(message|name)\b/i.test(text)) out.push("slash-command");
  if (/\[Image #\d+\]/.test(text)) out.push("image-attached");
  // Broadened handoff-prose: cross-session compaction patterns the user
  // adopted as a personal habit. Catches "Here's the handoff prompt",
  // "Here's the handover prompt", "session-close summary", "wrap-up summary",
  // "all wrapped up", "all captured." in addition to the original markdown
  // headers.
  if (
    /\b(here'?s the (handoff|handover) prompt|session-close summary|wrap-up summary|all wrapped up|all captured\.)\b/i.test(text)
    || /^##? (Wrap-up|Session conclusion|Handoff)\b/m.test(text)
    || /^# Handoff:/m.test(text)
  ) {
    out.push("handoff-prose");
  }
  return out;
}

// ─── Skill origin classification ─────────────────────────────────────────

const STOCK_PREFIXES = /^(superpowers|mcp__|frontend-design|code-review|codex|claude-code-guide|claude-api):/i;

export function classifySkill(name: string): SkillOrigin {
  if (name.startsWith("(ToolSearch:")) return "infra";
  if (STOCK_PREFIXES.test(name)) return "stock";
  if (name === "using-superpowers") return "stock";
  return "user";
}

// ─── Working-shapes week aggregator ──────────────────────────────────────

export function computeWorkingShapes(
  entries: Entry[],
  dayDigests: DayDigest[],
): WeekWorkingShapeRow[] {
  const dayOutcome = new Map<string, DayOutcome>();
  const dayHelp = new Map<string, DayHelpfulness>();
  for (const dd of dayDigests) {
    dayOutcome.set(dd.key, dd.outcome_day);
    dayHelp.set(dd.key, dd.helpfulness_day);
  }

  // Group entries by inferred shape.
  const byShape = new Map<NonNullable<WorkingShape>, Entry[]>();
  for (const e of entries) {
    const shape = inferWorkingShape(e);
    if (!shape) continue;
    const arr = byShape.get(shape) ?? [];
    arr.push(e);
    byShape.set(shape, arr);
  }

  // Order shapes by frequency (ties broken by load-bearing-ness — orchestrated
  // shapes first because they describe the dominant orchestration mode).
  const shapeOrder: Array<NonNullable<WorkingShape>> = [
    "spec-review-loop", "chunk-implementation", "reviewer-triad",
    "research-then-build", "background-coordinated",
    "solo-continuation", "solo-design", "solo-build",
  ];
  const ordered: WeekWorkingShapeRow[] = [];

  for (const shape of shapeOrder) {
    const shapeEntries = byShape.get(shape);
    if (!shapeEntries || shapeEntries.length === 0) continue;

    const occurrences = shapeEntries
      .sort((a, b) => a.local_day.localeCompare(b.local_day))
      .map(e => {
        // Pick a representative subagent — for orchestrated shapes prefer the
        // longest prompt_preview that matches a relevant role; for solo shapes
        // there's no subagent.
        let evidence_subagent: WeekWorkingShapeRow["occurrences"][0]["evidence_subagent"] = null;
        if (e.subagents && e.subagents.length > 0) {
          const sorted = [...e.subagents].sort((a, b) => b.prompt_preview.length - a.prompt_preview.length);
          const sa = sorted[0]!;
          evidence_subagent = {
            type: sa.type,
            description: sa.description,
            prompt_preview: truncate(sa.prompt_preview, 200),
          };
        }
        return {
          date: e.local_day,
          session_id: e.session_id,
          project_display: prettyProject(e.project),
          outcome: dayOutcome.get(e.local_day) ?? null,
          helpfulness: dayHelp.get(e.local_day) ?? null,
          evidence_subagent,
          evidence_first_user: e.first_user ? truncate(e.first_user, 200) : null,
        };
      });

    const outcome_distribution: Partial<Record<DayOutcome, number>> = {};
    for (const o of occurrences) {
      if (!o.outcome) continue;
      outcome_distribution[o.outcome] = (outcome_distribution[o.outcome] ?? 0) + 1;
    }

    ordered.push({ shape, occurrences, outcome_distribution });
  }

  return ordered;
}

// ─── Interaction grammar aggregator ──────────────────────────────────────

const BRAINSTORM_PATTERN = /brainstorm|writing-plans/i;

const EXTERNAL_REF_PATTERNS: Array<{
  kind: "linear-kip" | "github-issue-pr" | "branch-ref" | "url";
  re: RegExp;
}> = [
  { kind: "linear-kip", re: /\bKIP-\d+\b/i },
  { kind: "github-issue-pr", re: /\b(issue|pr|pull request)\s*#\d+\b|github\.com\/[^\s]+\/(issues|pull)\/\d+/i },
  { kind: "branch-ref", re: /\b(branch|feat|fix|chore|refactor)[\/:]\s*[\w./-]+|on `[\w./-]+`/i },
  { kind: "url", re: /https?:\/\/\S+/ },
];

function detectExternalRef(text: string | null | undefined): { kind: "linear-kip" | "github-issue-pr" | "branch-ref" | "url"; preview: string } | null {
  if (!text) return null;
  // Skip cases where the text is JUST a Claude-feature framing — those aren't
  // user delegating to external context, they're harness handoffs.
  if (/<teammate-message|<task-notification|<local-command-caveat/i.test(text.slice(0, 400))) return null;
  for (const { kind, re } of EXTERNAL_REF_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind, preview: text.slice(0, 160) };
  }
  return null;
}

function bucketLength(n: number): "short" | "medium" | "long" | "very_long" {
  if (n < 100) return "short";
  if (n < 500) return "medium";
  if (n < 2000) return "long";
  return "very_long";
}

export function computeInteractionGrammar(entries: Entry[]): WeekInteractionGrammar {
  const brainstormDays = new Set<string>();
  const frameMap = new Map<PromptFrame, { count: number; days: Set<string> }>();
  const userSkillMap = new Map<string, { count: number; days: Set<string> }>();
  const userSubagentMap = new Map<string, { count: number; days: Set<string>; sample_description: string; sample_prompt_preview: string }>();

  // Communication style accumulators.
  const verbosity = { short: 0, medium: 0, long: 0, very_long: 0 };
  const externalRefs: WeekInteractionGrammar["communication_style"]["external_context_refs"] = [];
  let total_interrupts = 0;
  let total_frustrated = 0;
  let total_dissatisfied = 0;
  let total_turns = 0;
  let sessions_with_mid_run_redirect = 0;

  let todo_ops_total = 0;
  let exit_plan_calls = 0;
  const planDays = new Set<string>();

  // Group entries by session for thread detection.
  const bySession = new Map<string, Entry[]>();

  for (const e of entries) {
    const day = e.local_day;
    todo_ops_total += e.numbers.task_ops;
    exit_plan_calls += e.numbers.exit_plan_calls;
    if (e.numbers.exit_plan_calls > 0 || (e.flags ?? []).includes("plan_used")) planDays.add(day);

    // Skills.
    for (const skill of Object.keys(e.skills ?? {})) {
      if (BRAINSTORM_PATTERN.test(skill)) brainstormDays.add(day);
      if (classifySkill(skill) === "user") {
        const cur = userSkillMap.get(skill) ?? { count: 0, days: new Set<string>() };
        cur.count += e.skills[skill] ?? 1;
        cur.days.add(day);
        userSkillMap.set(skill, cur);
      }
    }

    // Subagents — surface user-authored types separately.
    for (const sa of e.subagents ?? []) {
      if (isStockSubagentType(sa.type)) continue;
      const cur = userSubagentMap.get(sa.type) ?? {
        count: 0, days: new Set<string>(),
        sample_description: sa.description, sample_prompt_preview: sa.prompt_preview,
      };
      cur.count += 1;
      cur.days.add(day);
      // Keep the longest prompt_preview as sample.
      if (sa.prompt_preview.length > cur.sample_prompt_preview.length) {
        cur.sample_description = sa.description;
        cur.sample_prompt_preview = sa.prompt_preview;
      }
      userSubagentMap.set(sa.type, cur);
    }

    // Prompt frames.
    for (const frame of detectPromptFrames(e.first_user)) {
      const cur = frameMap.get(frame) ?? { count: 0, days: new Set<string>() };
      cur.count += 1;
      cur.days.add(day);
      frameMap.set(frame, cur);
    }

    // Communication style — verbosity.
    const fuLen = (e.first_user || "").length;
    if (fuLen > 0) verbosity[bucketLength(fuLen)] += 1;

    // External context refs in first_user.
    const ext = detectExternalRef(e.first_user);
    if (ext) externalRefs.push({ date: day, session_id: e.session_id, ref_kind: ext.kind, preview: truncate(ext.preview, 200) });

    // Steering — interrupts + frustrated/dissatisfied.
    const ints = e.numbers.interrupts ?? 0;
    total_interrupts += ints;
    total_turns += e.numbers.turn_count ?? 0;
    total_frustrated += e.satisfaction_signals?.frustrated ?? 0;
    total_dissatisfied += e.satisfaction_signals?.dissatisfied ?? 0;
    if (ints >= 2) sessions_with_mid_run_redirect += 1;

    const arr = bySession.get(e.session_id) ?? [];
    arr.push(e);
    bySession.set(e.session_id, arr);
  }

  // Threads: sessions whose entries span 2+ days.
  const threads: WeekInteractionGrammar["threads"] = [];
  for (const [sid, arr] of bySession.entries()) {
    const distinctDays = new Set(arr.map(e => e.local_day));
    if (distinctDays.size < 2) continue;
    arr.sort((a, b) => a.local_day.localeCompare(b.local_day));
    const total_active_min = arr.reduce((s, e) => s + e.numbers.active_min, 0);
    const lastEntry = arr[arr.length - 1]!;
    threads.push({
      thread_id: sid,
      entries: arr.map(e => ({
        date: e.local_day,
        session_id: e.session_id,
        project_display: prettyProject(e.project),
        has_handoff_frame: detectPromptFrames(e.first_user).includes("handoff-prose"),
      })),
      total_active_min,
      outcome: (lastEntry.enrichment?.outcome ?? null) as DayOutcome | null,
    });
  }
  threads.sort((a, b) => b.total_active_min - a.total_active_min);

  // Skill-family rollup: split user-authored skills on "-", group by prefix.
  const familyMap = new Map<string, { members: Set<string>; total_count: number; days: Set<string> }>();
  for (const [skill, v] of userSkillMap.entries()) {
    const family = skill.includes("-") ? skill.split("-")[0]! : skill;
    const cur = familyMap.get(family) ?? { members: new Set<string>(), total_count: 0, days: new Set<string>() };
    cur.members.add(skill);
    cur.total_count += v.count;
    for (const d of v.days) cur.days.add(d);
    familyMap.set(family, cur);
  }
  const skill_families = [...familyMap.entries()]
    .filter(([, v]) => v.members.size >= 2 || v.total_count >= 3)
    .sort((a, b) => b[1].total_count - a[1].total_count)
    .map(([family, v]) => ({
      family,
      members: [...v.members].sort(),
      total_count: v.total_count,
      days: [...v.days].sort(),
    }));

  return {
    brainstorming_warmup_days: [...brainstormDays].sort(),
    prompt_frames: [...frameMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([frame, v]) => ({
        frame,
        origin: PROMPT_FRAME_ORIGIN[frame],
        count: v.count,
        days: [...v.days].sort(),
      })),
    user_authored_skills: [...userSkillMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([skill, v]) => ({ skill, count: v.count, days: [...v.days].sort() })),
    skill_families,
    user_authored_subagents: [...userSubagentMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, v]) => ({
        type,
        count: v.count,
        days: [...v.days].sort(),
        sample_description: v.sample_description,
        sample_prompt_preview: truncate(v.sample_prompt_preview, 200),
      })),
    threads,
    communication_style: {
      verbosity_distribution: verbosity,
      external_context_refs: externalRefs,
      steering: {
        total_interrupts,
        total_frustrated,
        total_dissatisfied,
        sessions_with_mid_run_redirect,
        total_turns,
      },
    },
    todo_ops_total,
    plan_mode: { exit_plan_calls, days_with_plan: planDays.size },
  };
}

export type BuildDeterministicWeekOptions = {
  /** Optional entries — needed for longest_run + hours_distribution.
   *  When omitted both fields are null/empty and the renderer hides those slices. */
  entries?: Entry[];
};

export function buildDeterministicWeekDigest(
  monday: string,
  dayDigests: DayDigest[],
  opts: BuildDeterministicWeekOptions = {},
): WeekDigest {
  const dates = weekDates(monday);
  const byDate = new Map<string, DayDigest>();
  for (const d of dayDigests) byDate.set(d.key, d);

  const agent_min_total = dayDigests.reduce((sum, d) => sum + d.agent_min, 0);

  // Aggregate per-project across all day digests.
  const byProject = new Map<string, { agent_min: number; shipped_count: number }>();
  for (const dd of dayDigests) {
    for (const p of dd.projects) {
      const cur = byProject.get(p.name) ?? { agent_min: 0, shipped_count: 0 };
      cur.agent_min += (p.share_pct / 100) * dd.agent_min;
      byProject.set(p.name, cur);
    }
  }
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      // s.project is already display_name; map back to canonical via lookup
      // by matching display_name in dd.projects. If not found, count under the
      // display_name as a synthetic key (rare — only when shipping outside
      // any tracked project).
      const match = dd.projects.find(p => p.display_name === s.project);
      const key = match ? match.name : s.project;
      const cur = byProject.get(key) ?? { agent_min: 0, shipped_count: 0 };
      cur.shipped_count += 1;
      byProject.set(key, cur);
    }
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].agent_min - a[1].agent_min)
    .map(([name, v]) => ({
      name,
      display_name: prettyProject(name),
      agent_min: v.agent_min,
      share_pct: agent_min_total > 0 ? (v.agent_min / agent_min_total) * 100 : 0,
      shipped_count: v.shipped_count,
      description: null as string | null,
    }));

  const shipped: WeekDigest["shipped"] = [];
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      shipped.push({ title: s.title, project: s.project, date: dd.key, session_id: s.session_id });
    }
  }

  const outcome_mix: Partial<Record<DayOutcome, number>> = {};
  for (const dd of dayDigests) {
    outcome_mix[dd.outcome_day] = (outcome_mix[dd.outcome_day] ?? 0) + 1;
  }

  const helpfulness_sparkline: DayHelpfulness[] = dates.map(date => {
    const dd = byDate.get(date);
    return dd ? dd.helpfulness_day : null;
  });

  const flagCounts = new Map<string, number>();
  for (const dd of dayDigests) {
    for (const f of dd.top_flags) {
      flagCounts.set(f.flag, (flagCounts.get(f.flag) ?? 0) + f.count);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const dd of dayDigests) {
    for (const g of dd.top_goal_categories) {
      goalMinutes.set(g.category, (goalMinutes.get(g.category) ?? 0) + g.minutes);
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  let concurrency_peak_day: WeekDigest["concurrency_peak_day"] = null;
  for (const dd of dayDigests) {
    if (dd.concurrency_peak > 0) {
      if (!concurrency_peak_day || dd.concurrency_peak > concurrency_peak_day.peak) {
        concurrency_peak_day = { date: dd.key, peak: dd.concurrency_peak };
      }
    }
  }

  // ── days_active strip + busiest_day ──
  const days_active: WeekDigest["days_active"] = dayDigests
    .filter(d => d.agent_min > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(d => ({
      date: d.key,
      agent_min: d.agent_min,
      shipped_count: d.shipped.length,
      outcome_day: d.outcome_day,
      helpfulness_day: d.helpfulness_day,
    }));

  let busiest_day: WeekDigest["busiest_day"] = null;
  for (const d of days_active) {
    if (!busiest_day || d.agent_min > busiest_day.agent_min) {
      busiest_day = { date: d.date, agent_min: d.agent_min, shipped_count: d.shipped_count };
    }
  }

  // ── longest_run + hours_distribution from entries ──
  let longest_run: WeekDigest["longest_run"] = null;
  const hours_distribution = new Array<number>(24).fill(0);
  const entries = opts.entries ?? [];
  for (const e of entries) {
    if (!longest_run || e.numbers.active_min > longest_run.active_min) {
      longest_run = {
        session_id: e.session_id,
        date: e.local_day,
        project_display: prettyProject(e.project),
        active_min: e.numbers.active_min,
      };
    }
    const startMs = Date.parse(e.start_iso);
    if (!Number.isNaN(startMs)) {
      const hour = new Date(startMs).getHours();
      hours_distribution[hour] = (hours_distribution[hour] ?? 0) + e.numbers.active_min;
    }
  }

  const interaction_modes = entries.length > 0 ? computeInteractionModes(entries) : null;
  const working_shapes = entries.length > 0 ? computeWorkingShapes(entries, dayDigests) : null;
  const interaction_grammar = entries.length > 0 ? computeInteractionGrammar(entries) : null;

  const sunday = dates[6]!;
  const window = { start: `${monday}T00:00:00`, end: `${sunday}T23:59:59` };

  return {
    version: CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
    scope: "week",
    key: monday,
    window,
    day_refs: dayDigests.map(d => d.key).sort(),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    agent_min_total,
    projects,
    shipped,
    outcome_mix,
    helpfulness_sparkline,
    top_flags,
    top_goal_categories,
    concurrency_peak_day,
    days_active,
    busiest_day,
    longest_run,
    hours_distribution,
    interaction_modes,
    working_shapes,
    interaction_grammar,
    headline: null,
    key_pattern: null,
    trajectory: null,
    standout_days: null,
    what_worked: null,
    what_stalled: null,
    what_surprised: null,
    where_to_lean: null,
    // Legacy fields stay null on the new code path; cached pre-refactor digests
    // may carry populated values which the renderer will hide when working_shapes
    // is present.
    recurring_themes: null,
    outcome_correlations: null,
    friction_categories: null,
    suggestions: null,
    on_the_horizon: null,
    fun_ending: null,
  };
}

// ─── Generator (LLM narrative) ───────────────────────────────────────────

export type GenerateWeekOptions = {
  model?: string;
  callLLM?: CallLLM;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
  /** Entries for the week — used to compute longest_run + hours_distribution. */
  entries?: Entry[];
};

export type GenerateWeekResult = {
  digest: WeekDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

const defaultCallLLMWeek: CallLLM = (args) =>
  runClaudeSubprocess({ ...args, systemPrompt: DIGEST_WEEK_SYSTEM_PROMPT });

const validateWeek = (content: string) => parseAndValidate(content, WeekDigestResponseSchema);

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Strip findings whose evidence quote isn't a substring of the named day's
 *  text fields. The prompt asks for grounded quotes; this enforces it across
 *  what_worked / what_stalled / what_surprised. Findings with ungrounded
 *  evidence are dropped. */
function pruneUngroundedFindings(
  value: import("./prompts/digest-week.js").WeekDigestResponse,
  dayDigests: DayDigest[],
  entries: Entry[],
): import("./prompts/digest-week.js").WeekDigestResponse {
  const dayCorpus = new Map<string, string>();
  for (const d of dayDigests) {
    const parts = [d.headline, d.what_went_well, d.what_hit_friction]
      .filter((s): s is string => !!s);
    dayCorpus.set(d.key, normalizeForMatch(parts.join(" \n ")));
  }
  // Augment corpus with first_user + final_agent + subagent prompt previews
  // from entries — broader pool because what_worked/what_surprised may quote
  // user input or subagent prompts, not just day-digest prose.
  for (const e of entries) {
    const day = e.local_day;
    const prior = dayCorpus.get(day) ?? "";
    const extra = [e.first_user, e.final_agent, ...(e.subagents ?? []).flatMap(sa => [sa.description, sa.prompt_preview])]
      .filter((s): s is string => !!s)
      .join(" \n ");
    dayCorpus.set(day, normalizeForMatch(prior + " \n " + extra));
  }

  const groundedFinding = (f: import("./prompts/digest-week.js").WeekDigestResponse["what_worked"][number]) => {
    const corpus = dayCorpus.get(f.evidence.date);
    if (!corpus) return false;
    return corpus.includes(normalizeForMatch(f.evidence.quote));
  };

  return {
    ...value,
    what_worked: (value.what_worked ?? []).filter(groundedFinding),
    what_stalled: (value.what_stalled ?? []).filter(groundedFinding),
    what_surprised: (value.what_surprised ?? []).filter(groundedFinding),
    // where_to_lean evidence is a quote the user can act on, not always
    // substring-grounded — keep all.
  };
}

export async function generateWeekDigest(
  monday: string,
  dayDigests: DayDigest[],
  opts: GenerateWeekOptions = {},
): Promise<GenerateWeekResult> {
  const base = buildDeterministicWeekDigest(monday, dayDigests, { entries: opts.entries });
  // Need at least 2 LLM-enriched day digests (headline populated) to produce a
  // grounded weekly narrative. A deterministic-only day digest has null prose
  // fields, so synth would run on empty `day_summaries` and hallucinate.
  const enrichedDays = dayDigests.filter(d => d.headline !== null);
  if (enrichedDays.length < 2) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMWeek;
  const userPrompt = buildWeekDigestUserPrompt(base, dayDigests);
  let inT = 0, outT = 0;
  let lastModel = model;

  const entriesArr = opts.entries ?? [];

  function mergeNarrative(value: import("./prompts/digest-week.js").WeekDigestResponse): WeekDigest {
    const enrichedProjects = base.projects.map(p => {
      const match = value.project_areas.find(pa => pa.display_name === p.display_name);
      return match ? { ...p, description: match.description } : p;
    });
    return {
      ...base,
      projects: enrichedProjects,
      model: lastModel,
      cost_usd: computeCostUsd(lastModel, inT, outT),
      headline: value.headline,
      key_pattern: value.key_pattern,
      trajectory: value.trajectory,
      standout_days: value.standout_days,
      what_worked: value.what_worked,
      what_stalled: value.what_stalled,
      what_surprised: value.what_surprised,
      where_to_lean: value.where_to_lean,
      // Legacy fields stay null on the new path; renderer prefers new fields.
      recurring_themes: null,
      outcome_correlations: null,
      friction_categories: null,
      suggestions: null,
      on_the_horizon: null,
      fun_ending: null,
    };
  }

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = validateWeek(r1.content);
    if (v1.ok) {
      return { digest: mergeNarrative(pruneUngroundedFindings(v1.value, dayDigests, entriesArr)), usage: { input_tokens: inT, output_tokens: outT } };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with all required fields — no prose, no code fence.",
      onProgress: opts.onProgress,
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = validateWeek(r2.content);
    if (v2.ok) {
      return { digest: mergeNarrative(pruneUngroundedFindings(v2.value, dayDigests, entriesArr)), usage: { input_tokens: inT, output_tokens: outT } };
    }

    console.warn(`[digest-week] ${monday}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-week] ${monday}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
