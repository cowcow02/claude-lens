"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { WeekDigest as WeekDigestType, DayHelpfulness } from "@claude-lens/entries";
import { OutcomePill } from "./outcome-pill";
import { renderWithFlagChips } from "./flag-chip";
import { GoalBar } from "./goal-bar";

const HELP_COLORS: Record<NonNullable<DayHelpfulness>, string> = {
  essential: "#48bb78",
  helpful: "#4299e1",
  neutral: "#a0aec0",
  unhelpful: "#f56565",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const RECURRING_SOURCE_TONE: Record<NonNullable<WeekDigestType["recurring_themes"]>[number]["source"], { tag: string; label: string }> = {
  suggestion: { tag: "#4299e1", label: "Repeated suggestion" },
  friction: { tag: "#ed8936", label: "Recurring friction" },
  helpfulness_dip: { tag: "#f56565", label: "Helpfulness dip" },
};

export function WeekDigest({
  digest, aiEnabled, actions,
}: {
  digest: WeekDigestType;
  aiEnabled: boolean;
  actions?: ReactNode;
}) {
  const fmtRange = formatRange(digest.window.start, digest.window.end);
  const totalShipped = digest.shipped.length;
  const dayCount = Object.values(digest.outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  const hrs = digest.agent_min_total / 60;
  const timeStr = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(digest.agent_min_total)}m`;

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

      <HoursOfDayStrip hours={digest.hours_distribution} />

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

      <RecurringThemes themes={digest.recurring_themes} />

      <OutcomeCorrelations correlations={digest.outcome_correlations} />

      <ProjectAreas digest={digest} />

      <FrictionCategories categories={digest.friction_categories} />

      <Suggestions suggestions={digest.suggestions} />

      <OnTheHorizonOne opportunity={digest.on_the_horizon} />

      {digest.shipped.length > 0 && (
        <Section title={`Shipped (${digest.shipped.length})`} anchor="shipped">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {digest.shipped.map((s, i) => (
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
        </Section>
      )}

      <OutcomeMixRow outcome_mix={digest.outcome_mix} />

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

function HoursOfDayStrip({ hours }: { hours: number[] }) {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const maxBucket = Math.max(...hours);
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6,
      }}>
        <h2 style={{ ...sectionTitleStyle(), margin: 0 }}>Hours of day</h2>
        <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          local time · width = minutes worked
        </span>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(24, 1fr)",
        gap: 2,
        alignItems: "end",
        height: 56,
      }}>
        {hours.map((mins, h) => {
          const heightPct = maxBucket > 0 ? Math.max(mins > 0 ? 6 : 0, (mins / maxBucket) * 100) : 0;
          return (
            <div
              key={h}
              title={`${pad2(h)}:00 — ${pad2(h + 1)}:00 · ${Math.round(mins)}m (${total > 0 ? ((mins / total) * 100).toFixed(0) : 0}% of week)`}
              style={{
                position: "relative", height: "100%",
                background: "var(--af-surface)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              {mins > 0 && (
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  height: `${heightPct}%`,
                  background: "color-mix(in srgb, var(--af-accent) 36%, transparent)",
                }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(24, 1fr)",
        gap: 2, marginTop: 4,
        fontSize: 8, fontFamily: "var(--font-mono)",
        color: "var(--af-text-tertiary)", textAlign: "center",
      }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h}>{h % 6 === 0 ? `${pad2(h)}` : ""}</div>
        ))}
      </div>
    </section>
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

function peakHour(hours: number[]): { start: number; end: number; share_pct: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  // Find the longest contiguous window covering >= 60% of activity.
  // Use a simple sliding-window: for each window length 1..24, find the max-sum window;
  // pick the smallest length whose max-sum ≥ 60% of total.
  for (let len = 1; len <= 24; len++) {
    let bestSum = 0, bestStart = 0;
    for (let s = 0; s <= 24 - len; s++) {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += hours[s + i] ?? 0;
      if (sum > bestSum) { bestSum = sum; bestStart = s; }
    }
    if (bestSum / total >= 0.6) {
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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

function RecurringThemes({ themes }: { themes: WeekDigestType["recurring_themes"] }) {
  if (!themes || themes.length === 0) return null;
  return (
    <Section title="Recurred this week" anchor="recurring">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {themes.map((t, i) => {
          const tone = RECURRING_SOURCE_TONE[t.source];
          return (
            <li key={i} style={{
              padding: "12px 14px", borderRadius: 8,
              background: "var(--af-surface)",
              border: `1px solid color-mix(in srgb, ${tone.tag} 22%, var(--af-border-subtle))`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: tone.tag,
                }}>{tone.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>
                  {renderWithFlagChips(t.theme)}
                </span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.55, margin: "0 0 8px", color: "var(--af-text-secondary)" }}>
                {renderWithFlagChips(t.evidence)}
              </p>
              <DayChips dates={t.days} tone={tone.tag} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function OutcomeCorrelations({ correlations }: { correlations: WeekDigestType["outcome_correlations"] }) {
  if (!correlations || correlations.length === 0) return null;
  return (
    <Section title="Cross-day patterns" anchor="correlations">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {correlations.map((c, i) => (
          <li key={i} style={{
            padding: "12px 14px", borderRadius: 8,
            background: "color-mix(in srgb, #b794f4 5%, var(--af-surface))",
            border: "1px solid color-mix(in srgb, #b794f4 24%, var(--af-border-subtle))",
          }}>
            <p style={{ fontSize: 13, lineHeight: 1.55, margin: "0 0 8px", color: "var(--af-text)" }}>
              {renderWithFlagChips(c.claim)}
            </p>
            <DayChips dates={c.supporting_dates} tone="#b794f4" />
          </li>
        ))}
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
  if (digest.projects.length === 0) return null;
  return (
    <Section title="Project areas" anchor="projects">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {digest.projects.map(p => (
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
                // back-compat: legacy string-shaped examples render plain
                if (typeof ex === "string") {
                  return <li key={j} style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--af-text)" }}>{ex}</li>;
                }
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

function Suggestions({ suggestions }: { suggestions: WeekDigestType["suggestions"] }) {
  if (!suggestions) return null;
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

        <SubSection title="Features to try" subtitle="Claude Code primitives that fit this week's working pattern.">
          {suggestions.features_to_try.map((f, i) => (
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

function OutcomeMixRow({ outcome_mix }: { outcome_mix: WeekDigestType["outcome_mix"] }) {
  const total = Object.values(outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  if (total === 0) return null;
  const order: Array<keyof typeof outcome_mix> = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];
  return (
    <Section title="Outcome mix" anchor="outcome">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {order.map(k => {
          const c = outcome_mix[k] ?? 0;
          if (c === 0) return null;
          return (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <OutcomePill outcome={k} size="md" />
              <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                ×{c}
              </span>
            </span>
          );
        })}
      </div>
    </Section>
  );
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
