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

const SHIPPED_COLLAPSE_THRESHOLD = 10;
const PROJECT_MIN_SHARE = 5;

const SHAPE_LABELS: Record<string, string> = {
  "spec-review-loop": "Spec-review loop",
  "chunk-implementation": "Chunk implementation",
  "research-then-build": "Research-then-build",
  "reviewer-triad": "Reviewer triad",
  "background-coordinated": "Background-coordinated",
  "solo-continuation": "Solo continuation",
  "solo-design": "Solo design",
  "solo-build": "Solo build",
};

const SHAPE_DESCRIPTIONS: Record<string, string> = {
  "spec-review-loop": "Write a spec → dispatch reviewer subagents → revise → re-review → implement.",
  "chunk-implementation": "Numbered Chunk/Task subagent dispatches with paired reviewers per chunk.",
  "research-then-build": "Explore/researcher subagents map terrain upfront, then build with a clear picture.",
  "reviewer-triad": "Three reviewer dispatches with distinct lenses (reuse / quality / efficiency) on the same diff.",
  "background-coordinated": "A background subagent runs in parallel with the foreground session.",
  "solo-continuation": "No subagents; first input was \"continue\" picking up from a prior session.",
  "solo-design": "No subagents; loaded the brainstorming/writing-plans skill — design or planning session.",
  "solo-build": "No subagents; direct hands-on work.",
};

const SURPRISE_LABELS: Record<string, string> = {
  "outlier": "Outlier",
  "novel-use": "Novel use",
  "user-built-tool": "User-built tool",
  "cross-week-contrast": "Cross-week contrast",
};

const LEAN_KIND_LABELS: Record<string, string> = {
  "claude-md": "CLAUDE.md addition",
  "skill": "Skill to build",
  "hook": "Hook to wire",
  "harness": "Harness extension",
  "decision": "Decision to make",
};

const FRAME_LABELS: Record<string, string> = {
  "teammate": "<teammate-message>",
  "local-command-caveat": "<local-command-caveat>",
  "handoff-prose": "Handoff prose",
  "image-attached": "[Image #N]",
};

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

      {digest.working_shapes && digest.working_shapes.length > 0 && (
        <WorkingShapesSection shapes={digest.working_shapes} />
      )}

      {digest.interaction_grammar && (
        <InteractionGrammarSection grammar={digest.interaction_grammar} />
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

      <FindingsSection
        title="What worked"
        anchor="what-worked"
        items={digest.what_worked ?? []}
        tone="#48bb78"
        sectionFallbackProse={null}
      />

      <FindingsSection
        title="What stalled"
        anchor="what-stalled"
        items={digest.what_stalled ?? []}
        tone="#ed8936"
        sectionFallbackProse="No stalls stuck this week."
      />

      <SurprisesSection items={digest.what_surprised ?? []} />

      <ProjectAreas digest={digest} />

      <WhereToLeanSection items={digest.where_to_lean ?? []} />

      <ShippedList shipped={digest.shipped} />

      {digest.top_goal_categories.length > 0 && (
        <Section title="Goal mix" anchor="goals">
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min_total} />
        </Section>
      )}

      {digest.interaction_modes && (
        <ByTheNumbersFold modes={digest.interaction_modes} />
      )}

      {/* Legacy fallback: when reading a cached digest from before the
          working_shapes refactor, the new fields are absent but old narrative
          fields may be present. Render those so old digests aren't blank. */}
      {!digest.working_shapes && (
        <LegacyNarrativeFallback digest={digest} />
      )}
    </div>
  );
}

function LegacyNarrativeFallback({ digest }: { digest: WeekDigestType }) {
  const themes = digest.recurring_themes ?? [];
  const correlations = digest.outcome_correlations ?? [];
  const friction = digest.friction_categories ?? [];
  const suggestions = digest.suggestions;
  const horizon = digest.on_the_horizon;
  const fun = digest.fun_ending;
  const hasAny = themes.length > 0 || correlations.length > 0 || friction.length > 0
    || (suggestions?.claude_md_additions?.length ?? 0) > 0
    || horizon || fun;
  if (!hasAny) return null;
  return (
    <div style={{
      padding: "14px 16px", marginTop: 18, borderRadius: 8,
      background: "color-mix(in srgb, var(--af-text-tertiary) 5%, var(--af-surface))",
      border: "1px dashed var(--af-border-subtle)",
      fontSize: 12, color: "var(--af-text-secondary)", lineHeight: 1.55,
    }}>
      <strong style={{ color: "var(--af-text)" }}>Legacy digest:</strong> this week was generated under a previous prompt.
      Re-roll the digest to refresh it under the new working-shapes narrative.
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

function ByTheNumbersFold({ modes }: { modes: NonNullable<WeekDigestType["interaction_modes"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ marginBottom: 28 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", cursor: "pointer",
          padding: "6px 0", color: "var(--af-text-tertiary)",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {open ? "▾" : "▸"} By the numbers
      </button>
      {open && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 8, marginTop: 8,
        }}>
          <NumberCard label="Orchestration" lines={[
            `${modes.orchestration.subagent_calls} dispatches · ${modes.orchestration.days_with_subagents}/7 days`,
            modes.orchestration.top_types.slice(0, 3).map(t => `${t.type} ×${t.count}`).join(" · "),
            modes.orchestration.task_ops > 0 ? `${modes.orchestration.task_ops} TodoWrite ops` : "",
          ].filter(Boolean)} />
          <NumberCard label="Skill-driven" lines={[
            `${modes.skill_use.skill_calls} loads · ${modes.skill_use.days_with_skills}/7 days`,
            modes.skill_use.top_skills.slice(0, 3).map(s => `${s.skill} ×${s.count}`).join(" · "),
          ].filter(Boolean)} />
          <NumberCard label="Plan-gated" lines={[
            `${modes.plan_gating.exit_plan_calls} ExitPlan · ${modes.plan_gating.days_with_plan}/7 days`,
          ]} />
          <NumberCard label="Turn shape" lines={[
            `${modes.turn_shape.tools_per_turn.toFixed(1)} tools/turn · ${modes.turn_shape.label}`,
            `${modes.turn_shape.long_autonomous_days} long-autonomous days · ${modes.turn_shape.interrupts} interrupts`,
          ]} />
        </div>
      )}
    </section>
  );
}

function NumberCard({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "var(--af-surface)",
      border: "1px solid var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        marginBottom: 4,
      }}>{label}</div>
      {lines.map((ln, i) => (
        <div key={i} style={{
          fontSize: 11, color: i === 0 ? "var(--af-text)" : "var(--af-text-secondary)",
          fontFamily: "var(--font-mono)", lineHeight: 1.45,
        }}>{ln}</div>
      ))}
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

// ─── New shape-anchored sections ─────────────────────────────────────────

function WorkingShapesSection({
  shapes,
}: {
  shapes: NonNullable<WeekDigestType["working_shapes"]>;
}) {
  return (
    <Section title="How you worked" anchor="how-you-worked">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {shapes.map((row, i) => {
          const label = SHAPE_LABELS[row.shape] ?? row.shape;
          const description = SHAPE_DESCRIPTIONS[row.shape] ?? "";
          const dayCount = new Set(row.occurrences.map(o => o.date)).size;
          const outcomeStr = formatOutcomeMix(row.outcome_distribution);
          const sample = row.occurrences.find(o => o.evidence_subagent !== null) ?? row.occurrences[0]!;
          return (
            <li key={i} style={{
              padding: "14px 16px", borderRadius: 10,
              background: "var(--af-surface)",
              border: "1px solid var(--af-border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--af-text)",
                  letterSpacing: "-0.01em",
                }}>{label}</span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  color: "var(--af-text-tertiary)",
                }}>
                  {row.occurrences.length} session{row.occurrences.length === 1 ? "" : "s"} · {dayCount} day{dayCount === 1 ? "" : "s"}{outcomeStr ? ` · ${outcomeStr}` : ""}
                </span>
              </div>
              {description && (
                <p style={{
                  fontSize: 12, lineHeight: 1.55, margin: "0 0 8px",
                  color: "var(--af-text-secondary)",
                }}>{description}</p>
              )}
              {sample.evidence_subagent && (
                <div style={{
                  marginBottom: 8, padding: "8px 10px", borderRadius: 6,
                  background: "var(--af-surface-raised)",
                  borderLeft: "2px solid var(--af-accent)",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                    color: "var(--af-accent)", fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}>
                    {sample.evidence_subagent.type} · {dayName(sample.date)} {sample.date.slice(5)} · {sample.project_display}
                  </div>
                  <div style={{
                    fontSize: 11, lineHeight: 1.5,
                    color: "var(--af-text)", fontStyle: "italic",
                  }}>
                    <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                    {sample.evidence_subagent.prompt_preview}
                    <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                  </div>
                </div>
              )}
              {!sample.evidence_subagent && sample.evidence_first_user && (
                <div style={{
                  marginBottom: 8, padding: "8px 10px", borderRadius: 6,
                  background: "var(--af-surface-raised)",
                  borderLeft: "2px solid var(--af-border)",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                    color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}>
                    {dayName(sample.date)} {sample.date.slice(5)} · {sample.project_display}
                  </div>
                  <div style={{
                    fontSize: 11, lineHeight: 1.5,
                    color: "var(--af-text)", fontStyle: "italic",
                  }}>
                    <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                    {sample.evidence_first_user}
                    <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                  </div>
                </div>
              )}
              {row.occurrences.length > 1 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {row.occurrences.map((o, j) => (
                    <Link key={j} href={`/digest/${o.date}`} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 999,
                      background: "color-mix(in srgb, var(--af-accent) 8%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--af-accent) 22%, transparent)",
                      fontSize: 10, fontFamily: "var(--font-mono)",
                      color: "var(--af-accent)", textDecoration: "none", fontWeight: 600,
                    }}>
                      {dayName(o.date)} {o.date.slice(5)} · {o.project_display}
                      {o.outcome ? ` · ${o.outcome}` : ""}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function formatOutcomeMix(dist: Partial<Record<string, number>>): string {
  const order = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];
  const parts: string[] = [];
  for (const k of order) {
    const c = dist[k] ?? 0;
    if (c > 0) parts.push(`${c} ${k}`);
  }
  return parts.join(" · ");
}

function InteractionGrammarSection({
  grammar,
}: {
  grammar: NonNullable<WeekDigestType["interaction_grammar"]>;
}) {
  const lines: ReactNode[] = [];

  if (grammar.brainstorming_warmup_days.length > 0) {
    lines.push(
      <GrammarLine
        key="brainstorm"
        label="Brainstorming as warmup ritual"
        body={`Loaded a brainstorming/writing-plans skill before tool use on ${grammar.brainstorming_warmup_days.length} day${grammar.brainstorming_warmup_days.length === 1 ? "" : "s"}.`}
        days={grammar.brainstorming_warmup_days}
      />
    );
  }

  for (const f of grammar.prompt_frames) {
    const label = FRAME_LABELS[f.frame] ?? f.frame;
    lines.push(
      <GrammarLine
        key={`frame-${f.frame}`}
        label={`${label} frame`}
        body={`Used ${f.count} time${f.count === 1 ? "" : "s"} as the opening of a session.`}
        days={f.days}
      />
    );
  }

  if (grammar.user_authored_skills.length > 0) {
    const top = grammar.user_authored_skills.slice(0, 5);
    lines.push(
      <GrammarLine
        key="user-skills"
        label="User-authored skills"
        body={top.map(s => `${s.skill} ×${s.count}`).join(" · ")}
        days={grammar.user_authored_skills.flatMap(s => s.days).filter((v, i, a) => a.indexOf(v) === i).sort()}
      />
    );
  }

  if (grammar.threads.length > 0) {
    for (const t of grammar.threads.slice(0, 3)) {
      const dayList = t.entries.map(e => e.date).sort();
      const span = dayList.length;
      lines.push(
        <GrammarLine
          key={`thread-${t.thread_id}`}
          label={`Multi-day thread`}
          body={`Session ${t.thread_id.slice(0, 8)} ran across ${span} days, ${Math.round(t.total_active_min)}m total${t.outcome ? `, finishing ${t.outcome}` : ""}.`}
          days={dayList}
        />
      );
    }
  }

  if (grammar.todo_ops_total > 0) {
    lines.push(
      <GrammarLine
        key="todo"
        label="TodoWrite ops"
        body={`${grammar.todo_ops_total} TodoWrite operations across the week — task layer as orchestration substrate.`}
      />
    );
  }

  if (grammar.plan_mode.exit_plan_calls === 0 && grammar.plan_mode.days_with_plan === 0) {
    lines.push(
      <GrammarLine
        key="no-plan"
        label="Plan Mode unused"
        body="No ExitPlan calls or plan-gated sessions this week. Planning happened by other means (specs / review subagents) or not at all."
      />
    );
  } else {
    lines.push(
      <GrammarLine
        key="plan-mode"
        label="Plan Mode"
        body={`${grammar.plan_mode.exit_plan_calls} ExitPlan call${grammar.plan_mode.exit_plan_calls === 1 ? "" : "s"} on ${grammar.plan_mode.days_with_plan}/7 days.`}
      />
    );
  }

  if (lines.length === 0) return null;
  return (
    <Section title="Your interaction grammar" anchor="grammar">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines}
      </div>
    </Section>
  );
}

function GrammarLine({
  label, body, days,
}: { label: string; body: string; days?: string[] }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "var(--af-surface)",
      border: "1px solid var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--af-text)" }}>{body}</div>
      {days && days.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <DayChips dates={days} tone="var(--af-accent)" />
        </div>
      )}
    </div>
  );
}

function FindingsSection({
  title, anchor, items, tone, sectionFallbackProse,
}: {
  title: string;
  anchor: string;
  items: NonNullable<WeekDigestType["what_worked"]>;
  tone: string;
  sectionFallbackProse: string | null;
}) {
  if (!items || items.length === 0) {
    if (sectionFallbackProse === null) return null;
    return (
      <Section title={title} anchor={anchor}>
        <p style={{
          fontSize: 12, fontStyle: "italic",
          color: "var(--af-text-tertiary)",
          margin: 0, padding: "8px 0",
        }}>{sectionFallbackProse}</p>
      </Section>
    );
  }
  return (
    <Section title={title} anchor={anchor}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => (
          <FindingCard key={i} item={item} tone={tone} />
        ))}
      </ul>
    </Section>
  );
}

function FindingCard({
  item, tone,
}: {
  item: NonNullable<WeekDigestType["what_worked"]>[number];
  tone: string;
}) {
  const anchorLabel = renderAnchor(item.anchor);
  return (
    <li style={{
      padding: "12px 14px", borderRadius: 10,
      background: `color-mix(in srgb, ${tone} 6%, var(--af-surface))`,
      border: `1px solid color-mix(in srgb, ${tone} 22%, var(--af-border))`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: "var(--af-text)",
          letterSpacing: "-0.01em", flex: 1, minWidth: 0,
        }}>{item.title}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
          textTransform: "uppercase", color: tone,
          padding: "1px 7px", borderRadius: 999,
          background: `color-mix(in srgb, ${tone} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
          fontFamily: "var(--font-mono)",
        }} title={`Anchor: ${item.anchor}`}>{anchorLabel}</span>
      </div>
      <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 8px", color: "var(--af-text)" }}>
        {item.detail}
      </p>
      <div style={{
        padding: "6px 10px", borderRadius: 6,
        background: "var(--af-surface-raised)",
        borderLeft: `2px solid color-mix(in srgb, ${tone} 50%, transparent)`,
        display: "flex", gap: 8, alignItems: "flex-start",
      }}>
        <Link href={`/digest/${item.evidence.date}`} style={{
          fontSize: 10, fontWeight: 600, color: tone,
          fontFamily: "var(--font-mono)", flexShrink: 0,
          textDecoration: "none", paddingTop: 2,
        }}>
          {dayName(item.evidence.date)} {item.evidence.date.slice(5)}
        </Link>
        <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--af-text)", fontStyle: "italic" }}>
          <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
          {item.evidence.quote}
          <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
        </span>
      </div>
    </li>
  );
}

function renderAnchor(anchor: string): string {
  if (anchor === "plan-mode-gap") return "Plan-mode gap";
  if (anchor.startsWith("interaction_grammar.")) {
    const k = anchor.slice("interaction_grammar.".length);
    return k.replace(/_/g, " ");
  }
  return SHAPE_LABELS[anchor] ?? anchor;
}

function SurprisesSection({
  items,
}: {
  items: NonNullable<WeekDigestType["what_surprised"]>;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Section title="What surprised" anchor="what-surprised">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const tone = "#b794f4";
          return (
            <li key={i} style={{
              padding: "12px 14px", borderRadius: 10,
              background: `color-mix(in srgb, ${tone} 6%, var(--af-surface))`,
              border: `1px solid color-mix(in srgb, ${tone} 22%, var(--af-border))`,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--af-text)",
                  letterSpacing: "-0.01em", flex: 1, minWidth: 0,
                }}>{item.title}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: tone,
                  padding: "1px 7px", borderRadius: 999,
                  background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
                  fontFamily: "var(--font-mono)",
                }}>{SURPRISE_LABELS[item.surprise_kind] ?? item.surprise_kind}</span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 8px", color: "var(--af-text)" }}>
                {item.detail}
              </p>
              <div style={{
                padding: "6px 10px", borderRadius: 6,
                background: "var(--af-surface-raised)",
                borderLeft: `2px solid color-mix(in srgb, ${tone} 50%, transparent)`,
                display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <Link href={`/digest/${item.evidence.date}`} style={{
                  fontSize: 10, fontWeight: 600, color: tone,
                  fontFamily: "var(--font-mono)", flexShrink: 0,
                  textDecoration: "none", paddingTop: 2,
                }}>
                  {dayName(item.evidence.date)} {item.evidence.date.slice(5)}
                </Link>
                <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--af-text)", fontStyle: "italic" }}>
                  <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                  {item.evidence.quote}
                  <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function WhereToLeanSection({
  items,
}: {
  items: NonNullable<WeekDigestType["where_to_lean"]>;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Section title="Where to lean" anchor="where-to-lean">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => {
          const tone = "var(--af-accent)";
          const anchorLabel = renderAnchor(item.anchor);
          return (
            <li key={i} style={{
              padding: "14px 16px", borderRadius: 10,
              background: "var(--af-surface)",
              border: "1px solid var(--af-border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", color: tone,
                  padding: "1px 7px", borderRadius: 999,
                  background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
                  fontFamily: "var(--font-mono)",
                }}>{LEAN_KIND_LABELS[item.lean_kind] ?? item.lean_kind}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", flex: 1, minWidth: 0 }}>
                  {item.title}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }} title={`Anchor: ${item.anchor}`}>↳ {anchorLabel}</span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 10px", color: "var(--af-text)" }}>
                {item.detail}
              </p>
              {item.copyable && (
                <CopyBlock label={`Copy ${item.lean_kind === "claude-md" ? "block" : "snippet"}`} payload={item.copyable} />
              )}
              <div style={{
                marginTop: 8, fontSize: 10, color: "var(--af-text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}>
                Evidence · <Link href={`/digest/${item.evidence.date}`} style={{ color: "var(--af-text-tertiary)", textDecoration: "underline" }}>
                  {dayName(item.evidence.date)} {item.evidence.date.slice(5)}
                </Link> · “{item.evidence.quote.slice(0, 100)}{item.evidence.quote.length > 100 ? "…" : ""}”
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function Section({ title, anchor, children }: { title: string; anchor?: string; children: ReactNode }) {
  return (
    <section id={anchor} style={{ marginBottom: 28, scrollMarginTop: 24 }}>
      <h2 style={sectionTitleStyle()}>{title}</h2>
      {children}
    </section>
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
