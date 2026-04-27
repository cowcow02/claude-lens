/** Schema version. Bump to trigger background regeneration. */
export const CURRENT_ENTRY_SCHEMA_VERSION = 2 as const;

/** Fixed goal-category taxonomy. */
export const GOAL_CATEGORIES = [
  "build", "plan", "debug", "review", "steer", "meta",
  "research", "refactor", "test", "release", "warmup_minimal",
] as const;
export type GoalCategory = typeof GOAL_CATEGORIES[number];

export type EntryEnrichmentStatus = "pending" | "skipped_trivial" | "done" | "error";

export type EntryEnrichment = {
  status: EntryEnrichmentStatus;
  generated_at: string | null;
  model: string | null;
  cost_usd: number | null;
  error: string | null;
  brief_summary: string | null;
  underlying_goal: string | null;
  friction_detail: string | null;
  user_instructions: string[];
  outcome: "shipped" | "partial" | "exploratory" | "blocked" | "trivial" | null;
  claude_helpfulness: "essential" | "helpful" | "neutral" | "unhelpful" | null;
  /** VALUES ARE MINUTES spent on the goal within this (session × day) slice.
   *  Sum across goals MUST be ≤ numbers.active_min. Unclassified time stays implicit. */
  goal_categories: Partial<Record<GoalCategory, number>>;
  /** Bounded retry counter — prevents a permanently-failing Entry from looping
   *  forever across daemon restarts. Frozen at status="error" + retry_count>=3;
   *  only `fleetlens entries regenerate --force` resets it. Starts at 0. */
  retry_count: number;
};

export type EntrySubagent = {
  type: string;
  description: string;
  background: boolean;
  prompt_preview: string;
};

export type Entry = {
  version: typeof CURRENT_ENTRY_SCHEMA_VERSION;
  session_id: string;
  /** "YYYY-MM-DD" in reader's TZ */
  local_day: string;
  /** canonical (worktrees rolled up) */
  project: string;
  start_iso: string;
  end_iso: string;
  numbers: {
    active_min: number;
    turn_count: number;
    tools_total: number;
    subagent_calls: number;
    skill_calls: number;
    task_ops: number;
    interrupts: number;
    tool_errors: number;
    consec_same_tool_max: number;
    exit_plan_calls: number;
    prs: number;
    commits: number;
    pushes: number;
    tokens_total: number;
  };
  flags: string[];
  primary_model: string | null;
  model_mix: Record<string, number>;
  first_user: string;
  final_agent: string;
  pr_titles: string[];
  top_tools: string[];
  skills: Record<string, number>;
  subagents: EntrySubagent[];
  satisfaction_signals: {
    happy: number;
    satisfied: number;
    dissatisfied: number;
    frustrated: number;
  };
  user_input_sources: {
    human: number;
    teammate: number;
    skill_load: number;
    slash_command: number;
  };
  /** Always an object, never null. */
  enrichment: EntryEnrichment;
  generated_at: string;
  source_jsonl: string;
  /** Provenance-only — not used for rendering. */
  source_checkpoint: {
    byte_offset: number;
    last_event_ts: string | null;
  };
};

/** Initial enrichment value — always an object, never null. */
export function pendingEnrichment(): EntryEnrichment {
  return {
    status: "pending",
    generated_at: null,
    model: null,
    cost_usd: null,
    error: null,
    brief_summary: null,
    underlying_goal: null,
    friction_detail: null,
    user_instructions: [],
    outcome: null,
    claude_helpfulness: null,
    goal_categories: {},
    retry_count: 0,
  };
}

/** Skipped-trivial enrichment value. */
export function skippedTrivialEnrichment(generatedAt: string): EntryEnrichment {
  return {
    status: "skipped_trivial",
    generated_at: generatedAt,
    model: null,
    cost_usd: null,
    error: null,
    brief_summary: null,
    underlying_goal: null,
    friction_detail: null,
    user_instructions: [],
    outcome: "trivial",
    claude_helpfulness: null,
    goal_categories: {},
    retry_count: 0,
  };
}

/** Compose the storage filename key for an Entry. */
export function entryKey(sessionId: string, localDay: string): string {
  return `${sessionId}__${localDay}`;
}

/** Parse a storage filename back to (session_id, local_day). */
export function parseEntryKey(key: string): { session_id: string; local_day: string } | null {
  const m = /^([^_]+(?:_[^_]+)*)__(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m) return null;
  return { session_id: m[1]!, local_day: m[2]! };
}

// ─────────────────────────────────────────────────────────────────────────
// Digest types (Phase 2: day; Phase 4: week + month)
// ─────────────────────────────────────────────────────────────────────────

/** Schema version for day digests. */
export const CURRENT_DAY_DIGEST_SCHEMA_VERSION = 2 as const;
/** Schema version for week digests (Phase 4). */
export const CURRENT_WEEK_DIGEST_SCHEMA_VERSION = 2 as const;
/** Schema version for month digests (Phase 4). */
export const CURRENT_MONTH_DIGEST_SCHEMA_VERSION = 2 as const;

/** Scope-agnostic envelope. Each scope-specific type owns its leaf-reference array
 *  (DayDigest.entry_refs, WeekDigest.day_refs, MonthDigest.week_refs). */
export type DigestEnvelope = {
  version: 2;
  scope: "day" | "week" | "month" | "project" | "session";
  /** Scope-specific identifier. day: YYYY-MM-DD; week: ISO Monday YYYY-MM-DD; month: YYYY-MM. */
  key: string;
  window: { start: string; end: string };
  generated_at: string;
  is_live: boolean;
  model: string | null;
  cost_usd: number | null;
};

/** Day-level outcome rollup (derived deterministically from per-entry outcomes).
 *  Priority order: shipped > partial > blocked > exploratory > trivial > idle.
 *  `idle` only if zero entries (shouldn't happen in a rendered digest). */
export type DayOutcome = "shipped" | "partial" | "blocked" | "exploratory" | "trivial" | "idle";

/** Day-level helpfulness rollup (mode of entry claude_helpfulness).
 *  Tie-broken toward the worse signal (unhelpful beats neutral beats helpful beats essential)
 *  so a weekly digest can spot regressions early. `null` if no entries are enriched. */
export type DayHelpfulness = "essential" | "helpful" | "neutral" | "unhelpful" | null;

export type DayDigest = DigestEnvelope & {
  scope: "day";
  /** "{session_id}__{YYYY-MM-DD}" keys of contributing entries. */
  entry_refs: string[];

  // Deterministic aggregations (computed from Entries, not LLM output)
  projects: Array<{ name: string; display_name: string; share_pct: number; entry_count: number }>;
  shipped: Array<{ title: string; project: string; session_id: string }>;
  top_flags: Array<{ flag: string; count: number }>;
  /** Top 5 goal categories, values in MINUTES (matches Entry enrichment.goal_categories). */
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak: number;
  agent_min: number;
  /** Day-level outcome derived from per-entry outcomes. Phase 2.1 — feeds weekly aggregation. */
  outcome_day: DayOutcome;
  /** Day-level helpfulness signal — mode across enriched entries. Phase 2.1 — feeds weekly trajectory. */
  helpfulness_day: DayHelpfulness;

  // LLM narrative (null when ai_features.enabled === false or synth failed)
  headline: string | null;
  narrative: string | null;
  what_went_well: string | null;
  what_hit_friction: string | null;
  suggestion: { headline: string; body: string } | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Week digest (Phase 4) — synthesizes 7 day digests into a weekly story.
// ─────────────────────────────────────────────────────────────────────────

export type WeekDigest = DigestEnvelope & {
  scope: "week";
  /** ISO Monday in server local TZ, e.g. "2026-04-20" — same value as envelope.key. */
  day_refs: string[];

  // ── Deterministic aggregations (computed from day digests) ──
  agent_min_total: number;
  projects: Array<{
    name: string;
    display_name: string;
    agent_min: number;
    share_pct: number;
    shipped_count: number;
  }>;
  shipped: Array<{ title: string; project: string; date: string; session_id: string }>;
  /** Counts of days bucketed by their day-level outcome. Days with no entries are absent. */
  outcome_mix: Partial<Record<DayOutcome, number>>;
  /** 7 entries Mon→Sun. null where no enriched data exists for that day. */
  helpfulness_sparkline: DayHelpfulness[];
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  /** The day during the week with the highest concurrency_peak. null if all days had peak 0. */
  concurrency_peak_day: { date: string; peak: number } | null;

  // ── LLM narrative (null when ai_features.enabled === false or synth failed) ──
  headline: string | null;
  /** One short line per day with data. Days with zero entries are omitted (not "idle"). */
  trajectory: Array<{ date: string; line: string }> | null;
  /** 1–2 days that defined the week. */
  standout_days: Array<{ date: string; why: string }> | null;
  /** 2–3 sentences clustering recurring friction across days. Empty string allowed if no friction. */
  friction_themes: string | null;
  suggestion: { headline: string; body: string } | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Month digest (Phase 4) — synthesizes 4–5 week digests into a monthly story.
// ─────────────────────────────────────────────────────────────────────────

export type MonthDigest = DigestEnvelope & {
  scope: "month";
  /** "YYYY-MM" — same as envelope.key. */
  week_refs: string[];

  // ── Deterministic aggregations (computed from week digests) ──
  agent_min_total: number;
  projects: Array<{
    name: string;
    display_name: string;
    agent_min: number;
    share_pct: number;
    shipped_count: number;
  }>;
  shipped: Array<{ title: string; project: string; date: string; session_id: string }>;
  outcome_mix: Partial<Record<DayOutcome, number>>;
  /** One entry per ISO week-Monday in the month. May be 4 or 5 entries. */
  helpfulness_by_week: Array<{ week_start: string; helpfulness: DayHelpfulness }>;
  top_flags: Array<{ flag: string; count: number }>;
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak_week: { week_start: string; peak: number } | null;

  // ── LLM narrative ──
  headline: string | null;
  /** One line per week (4 or 5 entries). */
  trajectory: Array<{ week_start: string; line: string }> | null;
  /** 1–2 weeks that defined the month. */
  standout_weeks: Array<{ week_start: string; why: string }> | null;
  friction_themes: string | null;
  suggestion: { headline: string; body: string } | null;
};
