"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { WeekDigest as WeekDigestType, DayHelpfulness } from "@claude-lens/entries";
import { renderWithFlagChips } from "./flag-chip";
import { GoalBar } from "./goal-bar";

const HELP_COLORS: Record<NonNullable<DayHelpfulness>, string> = {
  essential: "#48bb78",
  helpful: "#4299e1",
  neutral: "#a0aec0",
  unhelpful: "#f56565",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type RecurringSource = NonNullable<WeekDigestType["recurring_themes"]>[number]["source"] | "correlation";

type RecurringRow = {
  theme: string;
  days: string[];
  evidence: string;
  source: RecurringSource;
};

const RECURRING_SOURCE_TONE: Record<RecurringSource, { tag: string; label: string }> = {
  suggestion: { tag: "#4299e1", label: "Repeated suggestion" },
  friction: { tag: "#ed8936", label: "Recurring friction" },
  helpfulness_dip: { tag: "#f56565", label: "Helpfulness dip" },
  flag_pattern: { tag: "#a0aec0", label: "Shape of work" },
  correlation: { tag: "#b794f4", label: "Cross-day pattern" },
};

const SHIPPED_COLLAPSE_THRESHOLD = 10;
const PROJECT_MIN_SHARE = 5;

export function WeekDigest({
  digest, aiEnabled, actions, priorDigest,
}: {
  digest: WeekDigestType;
  aiEnabled: boolean;
  actions?: ReactNode;
  priorDigest?: WeekDigestType | null;
}) {
  const fmtRange = formatRange(digest.window.start, digest.window.end);
  const totalShipped = digest.shipped.length;
  const dayCount = Object.values(digest.outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  const hrs = digest.agent_min_total / 60;
  const timeStr = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(digest.agent_min_total)}m`;
  const delta = priorDigest ? buildDelta(digest, priorDigest) : null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 40px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
          fontSize: 12, color: "var(--af-text-tertiary)", fontWeight: 500,
          flexWrap: "wrap",
        }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Week of {digest.key}</span>
          <span style={{ color: "var(--af-text-tertiary)" }}>·</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-secondary)" }}>
            {fmtRange} · {timeStr} agent time · {dayCount} active day{dayCount === 1 ? "" : "s"} · {totalShipped} PR{totalShipped === 1 ? "" : "s"}
          </span>
          {delta && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--af-text-tertiary)",
              padding: "1px 7px", borderRadius: 999,
              border: "1px solid var(--af-border-subtle)",
            }} title="vs the prior calendar week">
              vs last week: {delta}
            </span>
          )}
          {actions && (
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {actions}
            </div>
          )}
        </div>
        {digest.headline ? (
          <h1 style={{
            fontSize: 26, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.02em",
            margin: "0 0 6px", maxWidth: 820, color: "var(--af-text)",
          }}>
            {renderWithFlagChips(digest.headline)}
          </h1>
        ) : (
          <h1 style={{ fontSize: 20, color: "var(--af-text-secondary)", margin: "0 0 14px" }}>
            {aiEnabled
              ? "No narrative yet."
              : `Worked ${timeStr} across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}.`}
          </h1>
        )}
        {digest.key_pattern && (
          <p style={{
            fontSize: 13, fontStyle: "italic", margin: 0, lineHeight: 1.5,
            color: "var(--af-text-secondary)", maxWidth: 820,
          }}>
            {renderWithFlagChips(digest.key_pattern)}
          </p>
        )}
      </header>

      {!aiEnabled && (
        <div style={{
          padding: 14, marginBottom: 24, background: "var(--af-accent-subtle)",
          borderRadius: 8, fontSize: 13, color: "var(--af-text)",
        }}>
          Enable AI features in <Link href="/settings" style={{ color: "var(--af-accent)" }}>Settings</Link> to see weekly narratives.
        </div>
      )}

      <WeekStatsStrip digest={digest} />

      <DaysActiveBars digest={digest} />

      {digest.interaction_modes && (
        <InteractionModesSection modes={digest.interaction_modes} />
      )}

      {digest.top_goal_categories.length > 0 && (
        <Section title="Goal mix" anchor="goals">
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min_total} />
        </Section>
      )}

      {digest.standout_days && digest.standout_days.length > 0 && (
        <Section title="Standout days" anchor="standout">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {digest.standout_days.map(s => (
              <li key={s.date} style={{
                padding: "12px 14px", borderRadius: 8, background: "var(--af-surface)",
                border: "1px solid var(--af-border-subtle)",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <Link
                  href={`/digest/${s.date}`}
                  style={{
                    fontSize: 11, fontWeight: 600,
                    color: "var(--af-accent)", textDecoration: "none",
                    flexShrink: 0, paddingTop: 2,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {dayName(s.date)} {s.date.slice(5)}
                </Link>
                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text)" }}>{renderWithFlagChips(s.why)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {digest.trajectory && digest.trajectory.length > 0 && (
        <Section title="Trajectory" anchor="trajectory">
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {digest.trajectory.map(t => (
              <li key={t.date} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Link href={`/digest/${t.date}`} style={{
                  fontSize: 10, fontWeight: 600, color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)", flexShrink: 0, width: 64, paddingTop: 3,
                  textDecoration: "none",
                }}>
                  {dayName(t.date)} {t.date.slice(5)}
                </Link>
                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text-secondary)" }}>{renderWithFlagChips(t.line)}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <RecurringThemes
        themes={digest.recurring_themes}
        correlations={digest.outcome_correlations}
      />

      <ProjectAreas digest={digest} />

      <FrictionCategories categories={digest.friction_categories} />

      <Suggestions suggestions={digest.suggestions} digest={digest} />

      <OnTheHorizonOne opportunity={digest.on_the_horizon} />

      <ShippedList shipped={digest.shipped} />

      <FunEnding ending={digest.fun_ending} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function WeekStatsStrip({ digest }: { digest: WeekDigestType }) {
  const totalHrs = digest.agent_min_total / 60;
  const totalStr = totalHrs >= 1 ? `${totalHrs.toFixed(1)}h` : `${Math.round(digest.agent_min_total)}m`;
  const peakHourBucket = peakHour(digest.hours_distribution);
  const stats: Array<{ label: string; value: ReactNode; href?: string; title?: string }> = [
    {
      label: "Agent time",
      value: `${totalStr} across ${digest.days_active.length} day${digest.days_active.length === 1 ? "" : "s"}`,
    },
  ];
  if (digest.busiest_day) {
    stats.push({
      label: "Busiest day",
      href: `/digest/${digest.busiest_day.date}`,
      value: `${dayName(digest.busiest_day.date)} ${digest.busiest_day.date.slice(5)} · ${Math.round(digest.busiest_day.agent_min)}m · ${digest.busiest_day.shipped_count} PR`,
    });
  }
  if (digest.longest_run) {
    stats.push({
      label: "Longest single run",
      href: `/sessions/${digest.longest_run.session_id}`,
      title: `Session ${digest.longest_run.session_id.slice(0, 8)}`,
      value: `${Math.round(digest.longest_run.active_min)}m · ${digest.longest_run.project_display} · ${dayName(digest.longest_run.date)} ${digest.longest_run.date.slice(5)}`,
    });
  }
  if (peakHourBucket) {
    stats.push({
      label: "Peak hours",
      title: `${formatHourRange(peakHourBucket.start, peakHourBucket.end)} carried ${peakHourBucket.share_pct.toFixed(0)}% of the week's agent time`,
      value: `${formatHourRange(peakHourBucket.start, peakHourBucket.end)} · ${peakHourBucket.share_pct.toFixed(0)}%`,
    });
  }

  return (
    <section style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 8,
      marginBottom: 20,
    }}>
      {stats.map((s, i) => {
        const inner = (
          <div style={{
            padding: "10px 12px", borderRadius: 8,
            background: "var(--af-surface)",
            border: "1px solid var(--af-border-subtle)",
            height: "100%",
          }} title={s.title}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "var(--af-text-tertiary)",
              marginBottom: 4,
            }}>{s.label}</div>
            <div style={{
              fontSize: 12, color: "var(--af-text)", lineHeight: 1.45,
              fontFamily: "var(--font-mono)",
            }}>{s.value}</div>
          </div>
        );
        return s.href ? (
          <Link key={i} href={s.href} style={{ textDecoration: "none" }}>{inner}</Link>
        ) : (
          <div key={i}>{inner}</div>
        );
      })}
    </section>
  );
}

function DaysActiveBars({ digest }: { digest: WeekDigestType }) {
  if (digest.days_active.length === 0) return null;
  const maxMin = Math.max(...digest.days_active.map(d => d.agent_min));
  const dayMap = new Map(digest.days_active.map(d => [d.date, d]));
  const dates = weekDateLabels(digest.window.start);
  return (
    <section style={{
      display: "flex", gap: 6, alignItems: "stretch",
      padding: "12px 0", marginBottom: 24,
    }}>
      {dates.map((date, i) => {
        const d = dayMap.get(date);
        const mins = d?.agent_min ?? 0;
        const heightPct = maxMin > 0 && mins > 0 ? Math.max(8, (mins / maxMin) * 100) : 0;
        const tone = d ? OUTCOME_TONE[d.outcome_day] : "var(--af-text-tertiary)";
        const helpTone = d?.helpfulness_day ? HELP_COLORS[d.helpfulness_day] : null;
        return (
          <Link
            key={i}
            href={d ? `/digest/${date}` : "#"}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2,
              textDecoration: "none",
              pointerEvents: d ? "auto" : "none",
            }}
            title={d
              ? `${date} · ${Math.round(mins)}m · ${d.outcome_day}${d.shipped_count > 0 ? ` · ${d.shipped_count} PR` : ""}${d.helpfulness_day ? ` · helpfulness ${d.helpfulness_day}` : ""}`
              : "no activity"
            }
          >
            <div style={{
              height: 56, borderRadius: 4, position: "relative",
              background: "var(--af-surface)",
              border: `1px solid ${d ? `color-mix(in srgb, ${tone} 28%, var(--af-border-subtle))` : "var(--af-border-subtle)"}`,
              overflow: "hidden",
            }}>
              {d && (
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  height: `${heightPct}%`,
                  background: `color-mix(in srgb, ${tone} 28%, transparent)`,
                }} />
              )}
              {helpTone && (
                <div style={{
                  position: "absolute", top: 4, right: 4,
                  width: 6, height: 6, borderRadius: 999,
                  background: helpTone,
                }} title={d?.helpfulness_day ?? ""} />
              )}
            </div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              color: "var(--af-text-tertiary)", textAlign: "center",
            }}>
              {DAY_LABELS[i]}
            </div>
            <div style={{
              fontSize: 9, fontFamily: "var(--font-mono)",
              color: d ? "var(--af-text-secondary)" : "var(--af-text-tertiary)",
              textAlign: "center",
            }}>
              {d ? `${Math.round(mins)}m` : "—"}
            </div>
          </Link>
        );
      })}
    </section>
  );
}

function InteractionModesSection({ modes }: { modes: NonNullable<WeekDigestType["interaction_modes"]> }) {
  const orchestrationLevel = bandFromDays(modes.orchestration.days_with_subagents);
  const skillLevel = bandFromDays(modes.skill_use.days_with_skills);
  const planLevel = bandFromDays(modes.plan_gating.days_with_plan);
  const lt = modes.turn_shape.longest_turn ?? null;

  return (
    <Section title="How you worked" anchor="interaction">
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 10,
      }}>
        <ModeCard
          label="Orchestration"
          level={orchestrationLevel}
          headline={
            modes.orchestration.subagent_calls === 0
              ? "Solo · no subagents"
              : `${modes.orchestration.subagent_calls} dispatch${modes.orchestration.subagent_calls === 1 ? "" : "es"} · ${modes.orchestration.days_with_subagents}/7 days`
          }
          detail={
            modes.orchestration.top_types.length > 0
              ? modes.orchestration.top_types.slice(0, 3).map(t => `${t.type} ×${t.count}`).join(" · ")
              : null
          }
          extra={modes.orchestration.task_ops > 0 ? `${modes.orchestration.task_ops} TodoWrite ops` : null}
          evidence={(modes.orchestration.examples ?? []).length > 0 ? {
            tag: `${modes.orchestration.examples[0]!.type} · ${dayName(modes.orchestration.examples[0]!.date)} ${modes.orchestration.examples[0]!.date.slice(5)}`,
            quote: modes.orchestration.examples[0]!.prompt_preview,
          } : null}
        />
        <ModeCard
          label="Skill-driven"
          level={skillLevel}
          headline={
            modes.skill_use.skill_calls === 0
              ? "No slash commands / skills loaded"
              : `${modes.skill_use.skill_calls} skill load${modes.skill_use.skill_calls === 1 ? "" : "s"} · ${modes.skill_use.days_with_skills}/7 days`
          }
          detail={
            modes.skill_use.top_skills.length > 0
              ? modes.skill_use.top_skills.slice(0, 3).map(s => `${s.skill} ×${s.count}`).join(" · ")
              : null
          }
          evidence={(modes.skill_use.examples ?? []).length > 0 ? {
            tag: `${modes.skill_use.examples[0]!.skill} · ${dayName(modes.skill_use.examples[0]!.date)} ${modes.skill_use.examples[0]!.date.slice(5)}`,
            quote: modes.skill_use.examples[0]!.first_user_preview,
          } : null}
        />
        <ModeCard
          label="Plan-gated"
          level={planLevel}
          headline={
            modes.plan_gating.exit_plan_calls === 0 && modes.plan_gating.days_with_plan === 0
              ? "Plan Mode unused"
              : `${modes.plan_gating.exit_plan_calls} ExitPlan · ${modes.plan_gating.days_with_plan}/7 days`
          }
          detail={null}
          absenceProse={modes.plan_gating.exit_plan_calls === 0 && modes.plan_gating.days_with_plan === 0
            ? "Work proceeded without an explicit plan-approval gate on any day this week."
            : null}
        />
        <ModeCard
          label="Turn shape"
          level={modes.turn_shape.label}
          headline={`${modes.turn_shape.tools_per_turn.toFixed(1)} tools/turn · ${modes.turn_shape.label}`}
          detail={
            modes.turn_shape.long_autonomous_days > 0
              ? `${modes.turn_shape.long_autonomous_days} long-autonomous day${modes.turn_shape.long_autonomous_days === 1 ? "" : "s"}`
              : null
          }
          extra={modes.turn_shape.interrupts > 0 ? `${modes.turn_shape.interrupts} user interrupt${modes.turn_shape.interrupts === 1 ? "" : "s"}` : null}
          evidence={lt ? {
            tag: `Longest push · ${dayName(lt.date)} ${lt.date.slice(5)} · ${lt.project_display} · ${Math.round(lt.active_min)}m`,
            quote: lt.first_user_preview || (lt.top_tools.length > 0 ? `Top tools: ${lt.top_tools.join(", ")}` : ""),
            secondary: lt.first_user_preview && lt.top_tools.length > 0 ? `Top tools: ${lt.top_tools.join(", ")}` : null,
          } : null}
        />
      </div>
    </Section>
  );
}

type ModeLevel = "none" | "light" | "moderate" | "high" | "rapid" | "mixed" | "batch";

const MODE_TONE: Record<ModeLevel, string> = {
  none: "#a0aec0",
  light: "#4299e1",
  moderate: "#48bb78",
  high: "#b794f4",
  rapid: "#4299e1",
  mixed: "#48bb78",
  batch: "#b794f4",
};

function bandFromDays(days: number): "none" | "light" | "moderate" | "high" {
  if (days === 0) return "none";
  if (days <= 2) return "light";
  if (days <= 4) return "moderate";
  return "high";
}

function ModeCard({
  label, level, headline, detail, extra, evidence, absenceProse,
}: {
  label: string;
  level: ModeLevel;
  headline: string;
  detail: string | null;
  extra?: string | null;
  evidence?: { tag: string; quote: string; secondary?: string | null } | null;
  absenceProse?: string | null;
}) {
  const tone = MODE_TONE[level];
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 8,
      background: "var(--af-surface)",
      border: `1px solid color-mix(in srgb, ${tone} 22%, var(--af-border-subtle))`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--af-text-tertiary)",
        }}>{label}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: tone,
          padding: "1px 7px", borderRadius: 999,
          background: `color-mix(in srgb, ${tone} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
        }}>{level}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--af-text)", lineHeight: 1.4 }}>
        {headline}
      </div>
      {detail && (
        <div style={{
          fontSize: 10.5, color: "var(--af-text-secondary)",
          fontFamily: "var(--font-mono)", lineHeight: 1.5,
        }}>
          {detail}
        </div>
      )}
      {extra && (
        <div style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {extra}
        </div>
      )}
      {evidence && (
        <div style={{
          marginTop: 4, padding: "8px 10px", borderRadius: 6,
          background: `color-mix(in srgb, ${tone} 6%, var(--af-surface-raised))`,
          borderLeft: `2px solid color-mix(in srgb, ${tone} 50%, transparent)`,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
            color: tone, fontFamily: "var(--font-mono)",
          }}>{evidence.tag}</div>
          {evidence.quote && (
            <div style={{
              fontSize: 11, lineHeight: 1.5, color: "var(--af-text)", fontStyle: "italic",
            }}>
              <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
              {evidence.quote}
              <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
            </div>
          )}
          {evidence.secondary && (
            <div style={{
              fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)",
            }}>{evidence.secondary}</div>
          )}
        </div>
      )}
      {absenceProse && (
        <div style={{
          marginTop: 4, padding: "8px 10px", borderRadius: 6,
          background: "var(--af-surface-raised)",
          borderLeft: "2px solid var(--af-border)",
          fontSize: 11, lineHeight: 1.5, color: "var(--af-text-secondary)", fontStyle: "italic",
        }}>
          {absenceProse}
        </div>
      )}
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  shipped: "#48bb78",
  partial: "#4299e1",
  blocked: "#f56565",
  exploratory: "#a0aec0",
  trivial: "#cbd5e0",
  idle: "#cbd5e0",
};

/** Smallest window length we accept as a "peak"; below this and the window
 *  isn't carrying enough of the week's activity to be characteristic. */
const PEAK_HOUR_COVERAGE_THRESHOLD = 0.6;

function peakHour(hours: number[]): { start: number; end: number; share_pct: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  for (let len = 1; len <= 24; len++) {
    let bestSum = 0, bestStart = 0;
    for (let s = 0; s <= 24 - len; s++) {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += hours[s + i] ?? 0;
      if (sum > bestSum) { bestSum = sum; bestStart = s; }
    }
    if (bestSum / total >= PEAK_HOUR_COVERAGE_THRESHOLD) {
      return { start: bestStart, end: bestStart + len, share_pct: (bestSum / total) * 100 };
    }
  }
  return null;
}

function formatHourRange(start: number, end: number): string {
  const fmt = (h: number) => {
    const period = h < 12 || h === 24 ? "am" : "pm";
    const mod = ((h % 12) || 12);
    return `${mod}${period}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

function weekDateLabels(startIso: string): string[] {
  const out: string[] = [];
  const start = new Date(startIso);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function RecurringThemes({
  themes, correlations,
}: {
  themes: WeekDigestType["recurring_themes"];
  correlations: WeekDigestType["outcome_correlations"];
}) {
  const rows: RecurringRow[] = [];
  for (const t of themes ?? []) rows.push({ ...t });
  for (const c of correlations ?? []) {
    rows.push({
      theme: c.claim,
      days: c.supporting_dates,
      evidence: "",
      source: "correlation",
    });
  }
  if (rows.length === 0) return null;
  return (
    <Section title="Patterns across days" anchor="patterns">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r, i) => {
          const tone = RECURRING_SOURCE_TONE[r.source];
          return (
            <li key={i} style={{
              padding: "12px 14px", borderRadius: 8,
              background: r.source === "correlation"
                ? `color-mix(in srgb, ${tone.tag} 5%, var(--af-surface))`
                : "var(--af-surface)",
              border: `1px solid color-mix(in srgb, ${tone.tag} 22%, var(--af-border-subtle))`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: r.evidence ? 6 : 8, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: tone.tag,
                }}>{tone.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>
                  {renderWithFlagChips(r.theme)}
                </span>
              </div>
              {r.evidence && (
                <p style={{ fontSize: 12, lineHeight: 1.55, margin: "0 0 8px", color: "var(--af-text-secondary)" }}>
                  {renderWithFlagChips(r.evidence)}
                </p>
              )}
              <DayChips dates={r.days} tone={tone.tag} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function DayChips({ dates, tone }: { dates: string[]; tone: string }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {dates.map(d => (
        <Link key={d} href={`/digest/${d}`} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 999,
          background: `color-mix(in srgb, ${tone} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
          fontSize: 10, fontFamily: "var(--font-mono)",
          color: tone, textDecoration: "none", fontWeight: 600,
        }}>
          {dayName(d)} {d.slice(5)}
        </Link>
      ))}
    </div>
  );
}

function ProjectAreas({ digest }: { digest: WeekDigestType }) {
  const visible = digest.projects.filter(p => p.share_pct >= PROJECT_MIN_SHARE || p.shipped_count > 0);
  if (visible.length === 0) return null;
  return (
    <Section title="Project areas" anchor="projects">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.map(p => (
          <li key={p.name} style={{
            padding: "12px 14px", borderRadius: 8,
            background: "var(--af-surface)",
            border: "1px solid var(--af-border-subtle)",
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: p.description ? 8 : 0 }}>
              <Link
                href={`/projects/${encodeURIComponent(p.name)}`}
                style={{ fontSize: 14, fontWeight: 600, color: "var(--af-text)", textDecoration: "none", flex: 1, minWidth: 0, letterSpacing: "-0.01em" }}
              >
                {p.display_name}
              </Link>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--af-text-tertiary)",
              }}>
                {Math.round(p.agent_min)}m · {p.share_pct.toFixed(0)}% · {p.shipped_count} PR
              </span>
            </div>
            {p.description && (
              <p style={{ fontSize: 12, lineHeight: 1.55, margin: 0, color: "var(--af-text-secondary)" }}>
                {p.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FrictionCategories({ categories }: { categories: WeekDigestType["friction_categories"] }) {
  if (!categories) return null;
  if (categories.length === 0) {
    return (
      <Section title="Friction patterns" anchor="friction">
        <p style={{
          fontSize: 12, fontStyle: "italic",
          color: "var(--af-text-tertiary)",
          margin: 0, padding: "8px 0",
        }}>No friction stuck this week.</p>
      </Section>
    );
  }
  return (
    <Section title="Friction patterns" anchor="friction">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {categories.map((cat, i) => (
          <li key={i} style={{
            padding: "14px 16px", borderRadius: 10,
            background: "color-mix(in srgb, #ed8936 6%, var(--af-surface))",
            border: "1px solid color-mix(in srgb, #ed8936 22%, var(--af-border))",
          }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: "var(--af-text)",
              marginBottom: 6, letterSpacing: "-0.01em",
            }}>
              {renderWithFlagChips(cat.category)}
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.55, margin: "0 0 10px", color: "var(--af-text-secondary)" }}>
              {renderWithFlagChips(cat.description)}
            </p>
            <ul style={{
              listStyle: "none", padding: 0, margin: 0,
              display: "flex", flexDirection: "column", gap: 6,
              borderLeft: "2px solid color-mix(in srgb, #ed8936 32%, var(--af-border))",
              paddingLeft: 12,
            }}>
              {cat.examples.map((ex, j) => {
                return (
                  <li key={j} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <Link href={`/digest/${ex.date}`} style={{
                      fontSize: 10, fontWeight: 600, color: "#ed8936",
                      fontFamily: "var(--font-mono)", flexShrink: 0, width: 56, paddingTop: 2,
                      textDecoration: "none",
                    }}>
                      {dayName(ex.date)} {ex.date.slice(5)}
                    </Link>
                    <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--af-text)" }}>
                      <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                      {ex.quote}
                      <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Suggestions({
  suggestions, digest,
}: {
  suggestions: WeekDigestType["suggestions"];
  digest: WeekDigestType;
}) {
  if (!suggestions) return null;
  const featuresFiltered = filterFeatures(suggestions.features_to_try, digest);
  return (
    <section id="suggestions" style={{ marginBottom: 28 }}>
      <h2 style={sectionTitleStyle()}>Suggestions</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <SubSection title="CLAUDE.md additions" subtitle="Paste these blocks into your CLAUDE.md to encode this week's lessons.">
          {suggestions.claude_md_additions.map((c, i) => (
            <div key={i} style={cardStyle()}>
              <CopyBlock label="Copy CLAUDE.md block" payload={c.addition} />
              <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--af-text-secondary)", marginTop: 8 }}>
                <strong style={{ color: "var(--af-text)" }}>Why:</strong> {renderWithFlagChips(c.why)}
              </div>
              <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginTop: 4, fontStyle: "italic" }}>
                {c.prompt_scaffold}
              </div>
            </div>
          ))}
        </SubSection>

        {featuresFiltered.length > 0 && (
        <SubSection title="Features to try" subtitle="Claude Code primitives that fit this week's working pattern.">
          {featuresFiltered.map((f, i) => (
            <div key={i} style={cardStyle()}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)" }}>{f.feature}</span>
                <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>·</span>
                <span style={{ fontSize: 12, color: "var(--af-text-secondary)" }}>{f.one_liner}</span>
              </div>
              <p style={{ fontSize: 11.5, lineHeight: 1.55, margin: "0 0 10px", color: "var(--af-text-secondary)" }}>
                {renderWithFlagChips(f.why_for_you)}
              </p>
              <CopyBlock label="Copy example" payload={f.example_code} />
            </div>
          ))}
        </SubSection>
        )}

        <SubSection title="Usage patterns" subtitle="Process changes you can apply in your next session.">
          {suggestions.usage_patterns.map((u, i) => (
            <div key={i} style={cardStyle()}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", marginBottom: 4 }}>
                {u.title}
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.55, margin: "0 0 6px", color: "var(--af-text)" }}>
                {renderWithFlagChips(u.suggestion)}
              </p>
              <p style={{ fontSize: 11.5, lineHeight: 1.55, margin: "0 0 10px", color: "var(--af-text-secondary)" }}>
                {renderWithFlagChips(u.detail)}
              </p>
              <CopyBlock label="Copy prompt" payload={u.copyable_prompt} />
            </div>
          ))}
        </SubSection>
      </div>
    </section>
  );
}

function OnTheHorizonOne({ opportunity }: { opportunity: WeekDigestType["on_the_horizon"] }) {
  if (!opportunity) return null;
  return (
    <section id="horizon" style={{ marginBottom: 28 }}>
      <h2 style={sectionTitleStyle()}>On the horizon</h2>
      <div style={{
        padding: "14px 16px", borderRadius: 10,
        background: "color-mix(in srgb, #b794f4 6%, var(--af-surface))",
        border: "1px solid color-mix(in srgb, #b794f4 22%, var(--af-border))",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em", flex: 1, minWidth: 0 }}>
            {renderWithFlagChips(opportunity.title)}
          </span>
          <a href="#friction" style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 8px", borderRadius: 999,
            background: "color-mix(in srgb, #ed8936 14%, transparent)",
            border: "1px solid color-mix(in srgb, #ed8936 30%, transparent)",
            fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
            textTransform: "uppercase", color: "#ed8936",
            textDecoration: "none",
          }} title="Jump to friction category this addresses">
            Addresses: {renderWithFlagChips(opportunity.friction_category_addressed)}
          </a>
        </div>
        <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 8px", color: "var(--af-text)" }}>
          {renderWithFlagChips(opportunity.whats_possible)}
        </p>
        <p style={{ fontSize: 11.5, lineHeight: 1.55, margin: "0 0 10px", color: "var(--af-text-secondary)" }}>
          <strong style={{ color: "var(--af-text)" }}>How to try:</strong> {renderWithFlagChips(opportunity.how_to_try)}
        </p>
        <CopyBlock label="Copy starter prompt" payload={opportunity.copyable_prompt} />
      </div>
    </section>
  );
}

function FunEnding({ ending }: { ending: WeekDigestType["fun_ending"] }) {
  if (!ending) return null;
  return (
    <section style={{ marginTop: 18, padding: "16px 18px", borderRadius: 10,
      background: "color-mix(in srgb, var(--af-accent) 4%, var(--af-surface))",
      border: "1px dashed var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        marginBottom: 6,
      }}>Moment of the week</div>
      <p style={{ fontSize: 13, fontStyle: "italic", lineHeight: 1.55, margin: "0 0 6px", color: "var(--af-text)" }}>
        {ending.headline}
      </p>
      <p style={{ fontSize: 11.5, lineHeight: 1.55, margin: 0, color: "var(--af-text-secondary)" }}>
        {ending.detail}
      </p>
    </section>
  );
}

function CopyBlock({ label, payload }: { label: string; payload: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre style={{
        margin: 0,
        padding: "10px 12px",
        paddingRight: 96,
        borderRadius: 6,
        background: "var(--af-surface-raised)",
        border: "1px solid var(--af-border-subtle)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.55,
        overflowX: "auto",
        maxHeight: 280,
        overflowY: "auto",
      }}>{payload}</pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(payload);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // best-effort
          }
        }}
        style={{
          position: "absolute", top: 8, right: 8,
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "4px 8px", borderRadius: 5,
          background: copied ? "color-mix(in srgb, #48bb78 18%, var(--af-surface))" : "var(--af-surface)",
          border: `1px solid ${copied ? "#48bb78" : "var(--af-border-subtle)"}`,
          color: copied ? "#48bb78" : "var(--af-text-secondary)",
          fontSize: 10, fontWeight: 600, cursor: "pointer",
        }}
      >
        {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> {label}</>}
      </button>
    </div>
  );
}

function ShippedList({ shipped }: { shipped: WeekDigestType["shipped"] }) {
  const [expanded, setExpanded] = useState(false);
  if (shipped.length === 0) return null;
  const collapsible = shipped.length >= SHIPPED_COLLAPSE_THRESHOLD;
  const visible = collapsible && !expanded ? shipped.slice(0, 5) : shipped;
  const hidden = shipped.length - visible.length;
  return (
    <Section title={`Shipped (${shipped.length})`} anchor="shipped">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {visible.map((s, i) => (
          <li key={i} style={{
            display: "flex", gap: 10, alignItems: "baseline",
            padding: "6px 10px", borderRadius: 6,
            fontSize: 12, color: "var(--af-text)",
          }}>
            <Link href={`/digest/${s.date}`} style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--af-text-tertiary)", flexShrink: 0, width: 56,
              textDecoration: "none",
            }}>
              {dayName(s.date)} {s.date.slice(5)}
            </Link>
            <span style={{ flex: 1, minWidth: 0 }}>{s.title}</span>
            <span style={{
              fontSize: 10, color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}>
              {s.project}
            </span>
          </li>
        ))}
      </ul>
      {collapsible && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 6, padding: "4px 10px", borderRadius: 5,
            background: "transparent", border: "1px solid var(--af-border-subtle)",
            fontSize: 10, color: "var(--af-text-secondary)", cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          +{hidden} more
        </button>
      )}
      {collapsible && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 6, padding: "4px 10px", borderRadius: 5,
            background: "transparent", border: "1px solid var(--af-border-subtle)",
            fontSize: 10, color: "var(--af-text-secondary)", cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          show less
        </button>
      )}
    </Section>
  );
}

function buildDelta(curr: WeekDigestType, prior: WeekDigestType): string {
  const prDelta = curr.shipped.length - prior.shipped.length;
  const minDelta = curr.agent_min_total - prior.agent_min_total;
  const hrDelta = minDelta / 60;
  const prStr = `${prDelta > 0 ? "+" : ""}${prDelta} PR${Math.abs(prDelta) === 1 ? "" : "s"}`;
  const timeStr = Math.abs(hrDelta) >= 1
    ? `${hrDelta > 0 ? "+" : ""}${hrDelta.toFixed(1)}h`
    : `${minDelta > 0 ? "+" : ""}${Math.round(minDelta)}m`;
  return `${prStr} · ${timeStr}`;
}

const ALREADY_USES_PATTERNS: Array<{ flag: string; minCount: number; matches: RegExp }> = [
  { flag: "orchestrated", minCount: 2, matches: /\b(sub-?agents?|orchestrat\w*)\b/i },
  { flag: "plan_used", minCount: 2, matches: /\bplan mode\b/i },
];

type WeekSuggestions = NonNullable<WeekDigestType["suggestions"]>;

function filterFeatures(
  features: WeekSuggestions["features_to_try"],
  digest: WeekDigestType,
): WeekSuggestions["features_to_try"] {
  const flagCounts = new Map<string, number>();
  for (const f of digest.top_flags) flagCounts.set(f.flag, f.count);
  return features.filter(f => {
    for (const rule of ALREADY_USES_PATTERNS) {
      if ((flagCounts.get(rule.flag) ?? 0) >= rule.minCount && rule.matches.test(f.feature)) {
        return false;
      }
    }
    return true;
  });
}

function Section({ title, anchor, children }: { title: string; anchor?: string; children: ReactNode }) {
  return (
    <section id={anchor} style={{ marginBottom: 28, scrollMarginTop: 24 }}>
      <h2 style={sectionTitleStyle()}>{title}</h2>
      {children}
    </section>
  );
}

function SubSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", lineHeight: 1.5, marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: "var(--af-text-tertiary)",
    margin: "0 0 12px",
  };
}

function cardStyle(): React.CSSProperties {
  return {
    padding: "12px 14px", borderRadius: 8,
    background: "var(--af-surface)",
    border: "1px solid var(--af-border-subtle)",
  };
}

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}
