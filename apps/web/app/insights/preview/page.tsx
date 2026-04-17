import { InsightReport, type ReportData } from "@/components/insight-report";

export const dynamic = "force-static";

const MOCK: ReportData = {
  period_label: "Week of Apr 14 — Apr 20",
  period_sublabel: "Calendar week · Mon–Sun · in progress",
  range_type: "week",

  archetype: {
    label: "Orchestration Conductor",
    icon: "Network",
    tagline: "deep-dive on Opus · parallelises via subagents · plans unfold in-session",
    why: "You ran long unsupervised sessions on Opus and used subagent-driven-development to parallelise work. Most of your hours landed in 2 dominant turns rather than spread across many small ones.",
    vs_usual: "more orchestrated than last month (usual: solo-builder)",
  },

  top_skills: [
    { name: "superpowers:subagent-driven-development", count: 4, vs_prior: 3 },
    { name: "superpowers:using-git-worktrees", count: 3, vs_prior: 1 },
    { name: "frontend-design:frontend-design", count: 2, vs_prior: 2 },
    { name: "superpowers:finishing-a-development-branch", count: 1, vs_prior: 0 },
    { name: "superpowers:writing-skills", count: 1, vs_prior: 1 },
  ],

  days: [
    { day_name: "Mon", date_label: "Apr 14", agent_minutes: 5,   sessions: 1,  concurrency_peak: 1, has_cross_project: false, plan_util_pct: 7 },
    { day_name: "Tue", date_label: "Apr 15", agent_minutes: 485, sessions: 3,  concurrency_peak: 3, has_cross_project: false, plan_util_pct: 82 },
    { day_name: "Wed", date_label: "Apr 16", agent_minutes: 223, sessions: 9,  concurrency_peak: 6, has_cross_project: true,  plan_util_pct: 73 },
    { day_name: "Thu", date_label: "Apr 17", agent_minutes: 86,  sessions: 5,  concurrency_peak: 2, has_cross_project: false, plan_util_pct: 48 },
    { day_name: "Fri", date_label: "Apr 18", agent_minutes: 0,   sessions: 0,  concurrency_peak: 0, has_cross_project: false, plan_util_pct: 0, is_partial: true },
    { day_name: "Sat", date_label: "Apr 19", agent_minutes: 0,   sessions: 0,  concurrency_peak: 0, has_cross_project: false, plan_util_pct: 0, is_partial: true },
    { day_name: "Sun", date_label: "Apr 20", agent_minutes: 0,   sessions: 0,  concurrency_peak: 0, has_cross_project: false, plan_util_pct: 0, is_partial: true },
  ],

  theme_headline: "Fleetlens Team Edition sprint",

  projects: [
    { name: "claude-lens", display_name: "Repo/claude-lens",                agent_minutes: 720, share_pct: 82, prs: 4, commits: 68 },
    { name: "kipwise-ans", display_name: "kipwise/agentic-knowledge-system", agent_minutes: 72,  share_pct: 8,  prs: 0, commits: 5 },
    { name: "agentfleet",  display_name: "Repo/agentfleet",                  agent_minutes: 36,  share_pct: 4,  prs: 0, commits: 2 },
    { name: "other",       display_name: "3 other projects (aggregated)",    agent_minutes: 42,  share_pct: 5,  prs: 0, commits: 3 },
  ],

  shipped: [
    {
      title: "feat: Team Orchestration View",
      project: "claude-lens",
      duration_label: "5h 45m",
      commits: 30,
      subagents: 13,
      flags: ["long_autonomous", "high_errors", "loop_suspected"],
      summary: "Ambitious UI landed after three rewrites — row-grid → Gantt → multi-lane minimap. Design settled during implementation, not before.",
    },
    {
      title: "feat: Team Edition Foundation",
      project: "claude-lens",
      duration_label: "1h 41m",
      commits: 12,
      subagents: 21,
      flags: ["orchestrated", "high_errors"],
      summary: "Server, CLI, schema, deployment — 21 Sonnet subagents in one turn. 158 tool errors, still landed clean.",
    },
    {
      title: "fix(parser): roll up worktree sessions",
      project: "claude-lens",
      duration_label: "4m 36s",
      commits: 1,
      subagents: 0,
      flags: ["fast_ship"],
      summary: "Desktop-app test surfaced the bug, round-tripped to merge in under 5 minutes. Two PRs on the same fix, deliberate.",
    },
  ],

  patterns: [
    {
      icon: "Repeat",
      title: "Loop flags correlate with shipping",
      stat: "9/16 sessions flagged · 4/4 shipped",
      note: "Bash retry chains show up in every session that ultimately landed. Persistence signal, not stuck signal.",
    },
    {
      icon: "ClipboardList",
      title: "Plan-mode blindspot",
      stat: "0 of 16 sessions",
      note: "Including 5h 45m Team Orchestration build. Three UI rewrites in that session suggest plan would have shortened the cycle.",
    },
    {
      icon: "GitCommit",
      title: "claude-lens is commit-heavy",
      stat: "68 commits · 4 PRs",
      note: "Commit-dumping pattern holds on this repo. On kipwise you're ~1 PR per agent-hour; here it's 1 per 17 commits.",
    },
  ],

  concurrency: {
    multi_agent_days: 2,
    peak: 6,
    peak_day: "Wed Apr 16",
    cross_project_days: 1,
    insight:
      "Wed hit ×6 agents spanning claude-lens and kipwise — a cross-project burst. Tuesday hit ×3 within one project. Monday and Thursday stayed single-threaded.",
    suggestion:
      "The Wed ×6 peak was manually coordinated across two repos. An Agent Team with pre-declared roles could have owned the cross-project hop automatically. Try it on your next multi-repo day.",
  },

  outliers: [
    { label: "Longest run",  detail: "5h 45m", note: "Team Orchestration View · 0 interrupts" },
    { label: "Fastest ship", detail: "4m 36s", note: "Worktree rollup fix · 2 PRs" },
    { label: "Most errors",  detail: "158",    note: "Foundation session · still shipped" },
    { label: "Wandered",     detail: "71m",    note: "Vinobuzz clone demo · 0 git output" },
  ],

  suggestion_headline: "Settle the layout before the subagents fire.",
  suggestion_body:
    "Write a one-screen layout description in prose before dispatching subagents on UI-heavy features. The three-rewrite cycle on the team timeline cost more time than the remaining five implementation chunks combined.",

  prior_weeks: [
    { period_label: "Apr 7 — Apr 13",  archetype: "Deep-dive conversationalist", sessions: 11, prs: 1, subagents: 4,  agent_minutes: 342 },
    { period_label: "Mar 31 — Apr 6",  archetype: "Solo builder",                sessions: 8,  prs: 2, subagents: 0,  agent_minutes: 195 },
    { period_label: "Mar 24 — Mar 30", archetype: "Deep-dive conversationalist", sessions: 14, prs: 2, subagents: 2,  agent_minutes: 421 },
  ],

  saved_reports: [
    { id: "cur", period_label: "Week of Apr 14 — Apr 20", note: "current", current: true },
    { id: "w2",  period_label: "Week of Apr 7 — Apr 13" },
    { id: "w3",  period_label: "Week of Mar 31 — Apr 6" },
    { id: "w4",  period_label: "Week of Mar 24 — Mar 30" },
    { id: "m1",  period_label: "Last 4 weeks rollup" },
  ],

  meta: {
    generated_at: "2026-04-17 15:45",
    sessions_total: 16,
    sessions_used: 14,
    trivial_dropped: 2,
    model: "claude-sonnet-4-6",
    pipeline_ms: 27_450,
    context_kb: 48,
  },
};

export default function InsightReportPreview() {
  return <InsightReport data={MOCK} />;
}
