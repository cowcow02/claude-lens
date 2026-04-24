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
// Day digest types (Phase 2)
// ─────────────────────────────────────────────────────────────────────────

/** Schema version for day digests. */
export const CURRENT_DAY_DIGEST_SCHEMA_VERSION = 2 as const;

export type DigestEnvelope = {
  version: typeof CURRENT_DAY_DIGEST_SCHEMA_VERSION;
  scope: "day" | "week" | "month" | "project" | "session";
  /** Scope-specific identifier. For `day`, the local YYYY-MM-DD. */
  key: string;
  window: { start: string; end: string };
  entry_refs: string[];
  generated_at: string;
  is_live: boolean;
  model: string | null;
  cost_usd: number | null;
};

export type DayDigest = DigestEnvelope & {
  scope: "day";

  // Deterministic aggregations (computed from Entries, not LLM output)
  projects: Array<{ name: string; display_name: string; share_pct: number; entry_count: number }>;
  shipped: Array<{ title: string; project: string; session_id: string }>;
  top_flags: Array<{ flag: string; count: number }>;
  /** Top 5 goal categories, values in MINUTES (matches Entry enrichment.goal_categories). */
  top_goal_categories: Array<{ category: string; minutes: number }>;
  concurrency_peak: number;
  agent_min: number;

  // LLM narrative (null when ai_features.enabled === false or synth failed)
  headline: string | null;
  narrative: string | null;
  what_went_well: string | null;
  what_hit_friction: string | null;
  suggestion: { headline: string; body: string } | null;
};
