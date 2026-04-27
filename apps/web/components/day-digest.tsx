"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DayDigest as DayDigestType, Entry } from "@claude-lens/entries";
import { OutcomePill } from "./outcome-pill";

export function DayDigest({
  digest, entries, aiEnabled,
}: {
  digest: DayDigestType;
  entries: Entry[];
  aiEnabled: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const fmtDate = new Date(`${digest.key}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
  const hrs = digest.agent_min / 60;
  const timeStr = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(digest.agent_min)}m`;

  // Sort entries chronologically (most recent first)
  const sortedEntries = [...entries].sort(
    (a, b) => Date.parse(b.start_iso) - Date.parse(a.start_iso),
  );

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 40px" }}>
      {/* Hero: date + outcome pill + headline + stats */}
      <header style={{ marginBottom: 28 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 4,
          fontSize: 12, color: "var(--af-text-tertiary)", fontWeight: 500,
        }}>
          <span>{fmtDate}</span>
          <OutcomePill outcome={digest.outcome_day} size="lg" />
        </div>
        {digest.headline ? (
          <h1 style={{
            fontSize: 26, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.02em",
            margin: "8px 0 14px", maxWidth: 820, color: "var(--af-text)",
          }}>
            {digest.headline}
          </h1>
        ) : (
          <h1 style={{ fontSize: 20, color: "var(--af-text-secondary)", margin: "8px 0 14px" }}>
            {aiEnabled ? "No narrative yet — click Regenerate." : `Worked ${timeStr} across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}.`}
          </h1>
        )}
        <div style={{ fontSize: 13, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)" }}>
          {timeStr} agent time · {digest.projects.length} project{digest.projects.length === 1 ? "" : "s"} · {digest.shipped.length} PR{digest.shipped.length === 1 ? "" : "s"} shipped
          {digest.concurrency_peak > 1 && ` · peak concurrency ×${digest.concurrency_peak}`}
        </div>
      </header>

      {/* AI-off nudge */}
      {!aiEnabled && (
        <div style={{
          padding: 14, marginBottom: 24, background: "var(--af-accent-subtle)",
          borderRadius: 8, fontSize: 13, color: "var(--af-text)",
        }}>
          Enable AI features in <a href="/settings" style={{ color: "var(--af-accent)" }}>Settings</a> to see daily narratives.
        </div>
      )}

      {/* Went-well / Friction bands (no panel chrome) */}
      {(digest.what_went_well || digest.what_hit_friction) && (
        <section style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28,
        }}>
          <Band glyph="✓" color="#48bb78" text={digest.what_went_well} emptyLabel="(smooth)" />
          <Band glyph="⚠" color="#ed8936" text={digest.what_hit_friction} emptyLabel="(no friction)" />
        </section>
      )}

      {/* Narrative */}
      {digest.narrative && (
        <section style={{
          marginBottom: 28, padding: "4px 0",
          fontSize: 15, lineHeight: 1.6, color: "var(--af-text)",
          maxWidth: 760,
        }}>
          {digest.narrative}
        </section>
      )}

      {/* Show-more toggle: by default we keep the page short — only headline,
          bands, narrative are visible. Suggestion + work breakdown + shipped +
          sessions + goal-mix collapse behind this button so the timeline section
          below stays close to the fold. */}
      <div style={{ marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            background: "transparent",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
            cursor: "pointer",
          }}
        >
          {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showDetails ? "Hide details" : "Show more details"}
        </button>
      </div>

      {showDetails && (<>

      {/* Suggestion */}
      {digest.suggestion && (
        <section style={{
          borderLeft: "3px solid var(--af-accent)", paddingLeft: 16, marginBottom: 32,
        }}>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 6 }}>
            Tomorrow
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "var(--af-text)" }}>
            {digest.suggestion.headline}
          </div>
          <div style={{ fontSize: 13, color: "var(--af-text-secondary)", lineHeight: 1.5, maxWidth: 760 }}>
            {digest.suggestion.body}
          </div>
        </section>
      )}

      {/* Work breakdown */}
      {digest.projects.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Work breakdown</SectionLabel>
          <div style={{ display: "grid", gap: 6 }}>
            {digest.projects.map(p => {
              const shippedForProj = digest.shipped.filter(s => s.project === p.display_name);
              return (
                <div key={p.name} style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 56px 72px",
                  gap: 12, alignItems: "center", padding: "6px 0",
                  borderBottom: "1px solid var(--af-border-subtle)",
                  fontSize: 13,
                }}>
                  <span title={p.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.display_name}
                  </span>
                  <ShareBar pct={p.share_pct} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--af-text-tertiary)", textAlign: "right" }}>
                    {p.share_pct.toFixed(0)}%
                  </span>
                  <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", textAlign: "right" }}>
                    {shippedForProj.length > 0 ? `${shippedForProj.length} PR${shippedForProj.length === 1 ? "" : "s"}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Shipped PRs list */}
      {digest.shipped.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Shipped</SectionLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {digest.shipped.map((s, i) => (
              <li key={i} style={{
                padding: "6px 0", fontSize: 13, borderBottom: "1px solid var(--af-border-subtle)",
                display: "flex", gap: 10, alignItems: "baseline",
              }}>
                <span style={{ color: "#48bb78", fontSize: 12 }}>✓</span>
                <span style={{ flex: 1 }}>{s.title}</span>
                <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{s.project}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sessions — brief_summary as primary, session UUID hidden */}
      {sortedEntries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Sessions · {sortedEntries.length}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sortedEntries.map(e => <SessionRow key={e.session_id} entry={e} />)}
          </div>
        </section>
      )}

      {/* Goal mix (footer) */}
      {digest.top_goal_categories.length > 0 && (
        <section style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--af-border-subtle)" }}>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginBottom: 6 }}>
            Goal mix
          </div>
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min} />
        </section>
      )}

      </>)}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: "var(--af-text-tertiary)", textTransform: "uppercase",
      letterSpacing: "0.08em", fontWeight: 600, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function Band({ glyph, color, text, emptyLabel }: { glyph: string; color: string; text: string | null; emptyLabel: string }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.55 }}>
      <div style={{ fontSize: 18, color, marginBottom: 4 }}>{glyph}</div>
      {text ? (
        <div style={{ color: "var(--af-text)" }}>{text}</div>
      ) : (
        <div style={{ color: "var(--af-text-tertiary)", fontStyle: "italic" }}>{emptyLabel}</div>
      )}
    </div>
  );
}

function ShareBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 6, background: "var(--af-border-subtle)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%",
        background: "var(--af-accent)", transition: "width 0.2s",
      }} />
    </div>
  );
}

function SessionRow({ entry }: { entry: Entry }) {
  const startTime = new Date(entry.start_iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const durMin = Math.round(entry.numbers.active_min);
  const projectLabel = entry.project.split("/").filter(Boolean).slice(-1)[0] ?? entry.project;
  const outcome = entry.enrichment.outcome;
  const summary = entry.enrichment.brief_summary;

  return (
    <a href={`/sessions/${entry.session_id}`} style={{
      display: "block", padding: "8px 0", borderBottom: "1px solid var(--af-border-subtle)",
      fontSize: 13, color: "var(--af-text)", textDecoration: "none",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--af-text-tertiary)", width: 48 }}>
          {startTime}
        </span>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", minWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {projectLabel}
        </span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", width: 40, textAlign: "right" }}>
          {durMin}m
        </span>
        {outcome && <OutcomePill outcome={outcome} size="sm" label="text" />}
      </div>
      {summary && (
        <div style={{
          marginTop: 3, marginLeft: 58, fontSize: 13, color: "var(--af-text-secondary)",
          lineHeight: 1.45, maxWidth: 820,
        }}>
          {summary}
        </div>
      )}
    </a>
  );
}

const GOAL_COLORS: Record<string, string> = {
  build: "var(--af-accent)", plan: "#9f7aea", debug: "#ed8936",
  review: "#4299e1", refactor: "#38b2ac", test: "#48bb78",
  release: "#ed64a6", research: "#a0aec0", steer: "#f6ad55",
  meta: "#718096", warmup_minimal: "#cbd5e0",
};

function GoalBar({ goals, total }: { goals: { category: string; minutes: number }[]; total: number }) {
  if (total === 0) return <p style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>No goal data.</p>;
  return (
    <div>
      <div style={{ display: "flex", gap: 2, height: 12, borderRadius: 3, overflow: "hidden" }}>
        {goals.map(g => {
          const pct = (g.minutes / total) * 100;
          return (
            <div key={g.category}
              style={{
                width: `${pct}%`, background: GOAL_COLORS[g.category] ?? "#888",
              }}
              title={`${g.category}: ${Math.round(g.minutes)}m (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap", fontSize: 11, color: "var(--af-text-tertiary)" }}>
        {goals.map(g => (
          <span key={g.category} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: GOAL_COLORS[g.category] ?? "#888" }} />
            {g.category}  {Math.round(g.minutes)}m
          </span>
        ))}
      </div>
    </div>
  );
}
