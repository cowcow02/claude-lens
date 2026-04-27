"use client";

import Link from "next/link";
import type { WeekDigest as WeekDigestType, DayHelpfulness } from "@claude-lens/entries";
import { OutcomePill } from "./outcome-pill";
import type { ReactNode } from "react";

const HELP_COLORS: Record<NonNullable<DayHelpfulness>, string> = {
  essential: "#48bb78",
  helpful: "#4299e1",
  neutral: "#a0aec0",
  unhelpful: "#f56565",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
      <header style={{ marginBottom: 28 }}>
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
          Enable AI features in <Link href="/settings" style={{ color: "var(--af-accent)" }}>Settings</Link> to see weekly narratives.
        </div>
      )}

      <Sparkline sparkline={digest.helpfulness_sparkline} />

      {digest.standout_days && digest.standout_days.length > 0 && (
        <Section title="Standout days">
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
                <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text)" }}>{s.why}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {digest.trajectory && digest.trajectory.length > 0 && (
        <Section title="Trajectory">
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

      {digest.shipped.length > 0 && (
        <Section title={`Shipped (${digest.shipped.length})`}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {digest.shipped.map((s, i) => (
              <li key={i} style={{
                display: "flex", gap: 10, alignItems: "baseline",
                padding: "6px 10px", borderRadius: 6,
                fontSize: 12, color: "var(--af-text)",
              }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  color: "var(--af-text-tertiary)", flexShrink: 0, width: 56,
                }}>
                  {dayName(s.date)} {s.date.slice(5)}
                </span>
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

      <OutcomeMixRow outcome_mix={digest.outcome_mix} />
    </div>
  );
}

function Sparkline({ sparkline }: { sparkline: DayHelpfulness[] }) {
  const filled = sparkline.length > 0 && sparkline.some(h => h !== null);
  if (!filled) return null;
  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "stretch",
      padding: "12px 0", marginBottom: 24,
    }}>
      {sparkline.map((h, i) => (
        <div key={i} style={{
          flex: 1, padding: "10px 4px", borderRadius: 6,
          textAlign: "center",
          background: h ? `color-mix(in srgb, ${HELP_COLORS[h]} 14%, transparent)` : "var(--af-surface)",
          border: `1px solid ${h ? `color-mix(in srgb, ${HELP_COLORS[h]} 28%, transparent)` : "var(--af-border-subtle)"}`,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
            color: "var(--af-text-tertiary)", marginBottom: 4,
          }}>
            {DAY_LABELS[i]}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600,
            color: h ? HELP_COLORS[h] : "var(--af-text-tertiary)",
          }}>
            {h ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

function OutcomeMixRow({ outcome_mix }: { outcome_mix: WeekDigestType["outcome_mix"] }) {
  const total = Object.values(outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  if (total === 0) return null;
  const order: Array<keyof typeof outcome_mix> = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];
  return (
    <Section title="Outcome mix">
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
