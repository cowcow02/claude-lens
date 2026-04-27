"use client";

import Link from "next/link";
import type { MonthDigest as MonthDigestType, DayHelpfulness } from "@claude-lens/entries";
import { OutcomePill } from "./outcome-pill";
import type { ReactNode } from "react";

const HELP_COLORS: Record<NonNullable<DayHelpfulness>, string> = {
  essential: "#48bb78",
  helpful: "#4299e1",
  neutral: "#a0aec0",
  unhelpful: "#f56565",
};

export function MonthDigest({
  digest, aiEnabled, actions,
}: {
  digest: MonthDigestType;
  aiEnabled: boolean;
  actions?: ReactNode;
}) {
  const totalDays = Object.values(digest.outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  const totalShipped = digest.shipped.length;
  const hrs = digest.agent_min_total / 60;
  const timeStr = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(digest.agent_min_total)}m`;
  const monthLabel = formatMonth(digest.key);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 40px" }}>
      <header style={{ marginBottom: 28 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
          fontSize: 12, color: "var(--af-text-tertiary)", fontWeight: 500,
          flexWrap: "wrap",
        }}>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{monthLabel}</span>
          <span style={{ color: "var(--af-text-tertiary)" }}>·</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-secondary)" }}>
            {timeStr} agent time · {totalDays} active day{totalDays === 1 ? "" : "s"} · {totalShipped} PR{totalShipped === 1 ? "" : "s"}
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
            margin: "0 0 14px", maxWidth: 820, color: "var(--af-text)",
          }}>
            {digest.headline}
          </h1>
        ) : (
          <h1 style={{ fontSize: 20, color: "var(--af-text-secondary)", margin: "0 0 14px" }}>
            {aiEnabled
              ? "No narrative yet."
              : `Worked ${timeStr} across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}.`}
          </h1>
        )}
      </header>

      {!aiEnabled && (
        <div style={{
          padding: 14, marginBottom: 24, background: "var(--af-accent-subtle)",
          borderRadius: 8, fontSize: 13, color: "var(--af-text)",
        }}>
          Enable AI features in <Link href="/settings" style={{ color: "var(--af-accent)" }}>Settings</Link> to see monthly narratives.
        </div>
      )}

      <HelpfulnessBars helpfulness_by_week={digest.helpfulness_by_week} />

      {digest.standout_weeks && digest.standout_weeks.length > 0 && (
        <Section title="Standout weeks">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {digest.standout_weeks.map(s => (
              <li key={s.week_start} style={{
                padding: "12px 14px", borderRadius: 8, background: "var(--af-surface)",
                border: "1px solid var(--af-border-subtle)",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <Link href={`/insights/week-${s.week_start}`} style={{
                  fontSize: 11, fontWeight: 600,
                  color: "var(--af-accent)", textDecoration: "none",
                  flexShrink: 0, paddingTop: 2,
                  fontFamily: "var(--font-mono)",
                }}>
                  Week {s.week_start.slice(5)}
                </Link>
                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text)" }}>{s.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {digest.trajectory && digest.trajectory.length > 0 && (
        <Section title="Trajectory">
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {digest.trajectory.map(t => (
              <li key={t.week_start} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Link href={`/insights/week-${t.week_start}`} style={{
                  fontSize: 10, fontWeight: 600, color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)", flexShrink: 0, width: 92, paddingTop: 3,
                  textDecoration: "none",
                }}>
                  Week {t.week_start.slice(5)}
                </Link>
                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text-secondary)" }}>{t.line}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {digest.friction_themes && digest.friction_themes.trim().length > 0 && (
        <Section title="Friction patterns">
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: "var(--af-text)" }}>
            {digest.friction_themes}
          </p>
        </Section>
      )}

      {digest.suggestion && (
        <Section title="Suggestion">
          <div style={{
            padding: "14px 16px", borderRadius: 8, background: "var(--af-accent-subtle)",
            border: "1px solid color-mix(in srgb, var(--af-accent) 18%, var(--af-border))",
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--af-text)", marginBottom: 6 }}>
              {digest.suggestion.headline}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text-secondary)" }}>
              {digest.suggestion.body}
            </div>
          </div>
        </Section>
      )}

      {digest.projects.length > 0 && (
        <Section title="Projects">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {digest.projects.map(p => (
              <li key={p.name} style={{
                display: "flex", gap: 10, alignItems: "baseline",
                padding: "6px 10px", borderRadius: 6,
                fontSize: 12, color: "var(--af-text)",
              }}>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{p.display_name}</span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  color: "var(--af-text-tertiary)",
                }}>
                  {Math.round(p.agent_min)}m · {p.share_pct.toFixed(0)}% · {p.shipped_count} PR
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function HelpfulnessBars({ helpfulness_by_week }: { helpfulness_by_week: MonthDigestType["helpfulness_by_week"] }) {
  const filled = helpfulness_by_week.some(h => h.helpfulness !== null);
  if (!filled) return null;
  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "stretch",
      padding: "12px 0", marginBottom: 24,
    }}>
      {helpfulness_by_week.map((h, i) => (
        <div key={i} style={{
          flex: 1, padding: "10px 4px", borderRadius: 6,
          textAlign: "center",
          background: h.helpfulness ? `color-mix(in srgb, ${HELP_COLORS[h.helpfulness]} 14%, transparent)` : "var(--af-surface)",
          border: `1px solid ${h.helpfulness ? `color-mix(in srgb, ${HELP_COLORS[h.helpfulness]} 28%, transparent)` : "var(--af-border-subtle)"}`,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
            color: "var(--af-text-tertiary)", marginBottom: 4,
            fontFamily: "var(--font-mono)",
          }}>
            {h.week_start.slice(5)}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: h.helpfulness ? HELP_COLORS[h.helpfulness] : "var(--af-text-tertiary)",
          }}>
            {h.helpfulness ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        margin: "0 0 12px",
      }}>{title}</h2>
      {children}
    </section>
  );
}

function formatMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
