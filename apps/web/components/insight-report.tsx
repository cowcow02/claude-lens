"use client";

import {
  ArrowRight,
  BrainCircuit,
  ClipboardList,
  Compass,
  Download,
  FileText,
  GitCommit,
  Layers3,
  Lightbulb,
  Network,
  Repeat,
  Rocket,
  Share2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

const ICON_MAP = {
  BrainCircuit, ClipboardList, Compass, GitCommit, Layers3, Network, Repeat,
  Rocket, Sparkles, TrendingDown, TrendingUp, Users, Zap,
} as const;
export type IconKey = keyof typeof ICON_MAP;

// ──────────────────────────────────────────────────────────────────
//                              Types
// ──────────────────────────────────────────────────────────────────

export type ReportData = {
  period_label: string;              // "Week of Apr 14 — Apr 20"
  period_sublabel: string;           // "Calendar week · in progress"
  range_type: "week" | "4weeks" | "custom";

  archetype: {
    label: string;                   // "Orchestration conductor"
    icon: IconKey;
    tagline: string;                 // "deep-dive + heavy subagent usage"
    why: string;                     // 1 supporting sentence
    vs_usual?: string;               // "More orchestrated than your usual baseline"
  };

  top_skills: { name: string; count: number; vs_prior?: number }[];

  // Daily day-by-day strip (Mon → Sun when range=week)
  days: {
    day_name: string;                // "Mon"
    date_label: string;              // "Apr 14"
    agent_minutes: number;
    sessions: number;
    concurrency_peak: number;        // ×N parallel
    has_cross_project: boolean;
    plan_util_pct: number;           // 0..100
    is_partial?: boolean;            // future / in-progress day
  }[];

  theme_headline: string;            // "Fleetlens Team Edition sprint"

  projects: {
    name: string;
    display_name: string;
    agent_minutes: number;
    share_pct: number;
    prs: number;
    commits: number;
  }[];

  shipped: {
    title: string;
    project: string;
    duration_label: string;
    commits: number;
    subagents: number;
    flags: string[];
    summary: string;
  }[];

  patterns: {
    icon: IconKey;
    title: string;
    stat: string;
    note: string;
  }[];

  concurrency: {
    multi_agent_days: number;
    peak: number;
    peak_day: string;
    cross_project_days: number;
    insight: string;
    suggestion: string;
  };

  outliers: { label: string; detail: string; note: string }[];

  suggestion_headline: string;
  suggestion_body: string;

  prior_weeks: {
    period_label: string;
    archetype: string;
    sessions: number;
    prs: number;
    subagents: number;
    agent_minutes: number;
  }[];

  saved_reports: { id: string; period_label: string; note?: string; current?: boolean }[];

  meta: {
    generated_at: string;
    sessions_total: number;
    sessions_used: number;
    trivial_dropped: number;
    model: string;
    pipeline_ms: number;
    context_kb: number;
  };
};

const FLAG_TONE: Record<string, { label: string; tone: "good" | "warn" | "danger" | "neutral" }> = {
  fast_ship: { label: "fast ship", tone: "good" },
  plan_used: { label: "plan used", tone: "good" },
  orchestrated: { label: "orchestrated", tone: "good" },
  long_autonomous: { label: "long autonomous", tone: "neutral" },
  loop_suspected: { label: "loop suspected", tone: "warn" },
  high_errors: { label: "high errors", tone: "warn" },
  interrupt_heavy: { label: "interrupt-heavy", tone: "danger" },
};

// ──────────────────────────────────────────────────────────────────
//                        Top-level component
// ──────────────────────────────────────────────────────────────────

export function InsightReport({ data }: { data: ReportData }) {
  return (
    <>
      <PrintStyles />
      <div className="report-root" style={rootStyle}>
        <Toolbar data={data} />

        {/* Section 1 · ARCHETYPE */}
        <Section index={1} title="Who you were" kicker="Your working style, distilled" anchor="archetype">
          <ArchetypeHero data={data} />
          <SkillsStrip skills={data.top_skills} />
        </Section>

        {/* Section 2 · THE WEEK AT A GLANCE */}
        <Section index={2} title="The week at a glance" kicker={`${data.period_label} · ${data.theme_headline}`} anchor="glance">
          <DayStrip days={data.days} />
          <PlanUtilRow days={data.days} />
        </Section>

        {/* Section 3 · WHERE YOUR TIME WENT */}
        <Section index={3} title="Where your time went" kicker="Projects and shipped work" anchor="time">
          <ProjectBars projects={data.projects} />
          <ShippedList items={data.shipped} />
        </Section>

        {/* Section 4 · HOW YOU WORKED */}
        <Section index={4} title="How you worked" kicker="Patterns, concurrency, outliers" anchor="how">
          <PatternsGrid patterns={data.patterns} />
          <ConcurrencyBlock c={data.concurrency} />
          <OutliersRow outliers={data.outliers} />
        </Section>

        {/* Section 5 · WHAT TO TRY */}
        <Section index={5} title="What to try next" kicker="One experiment, grounded in what we saw" anchor="next">
          <SuggestionBlock headline={data.suggestion_headline} body={data.suggestion_body} />
          <PriorWeeksStrip weeks={data.prior_weeks} />
        </Section>

        <MetaFooter meta={data.meta} />
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
//                           Sub-components
// ──────────────────────────────────────────────────────────────────

function Toolbar({ data }: { data: ReportData }) {
  const onPrint = () => { if (typeof window !== "undefined") window.print(); };
  return (
    <div className="no-print" style={toolbarStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginRight: "auto" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--af-text-tertiary)", fontWeight: 600 }}>
          Insight report
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--af-text)" }}>
          {data.period_label}
        </div>
        <div style={{ fontSize: 12, color: "var(--af-text-secondary)" }}>{data.period_sublabel}</div>
      </div>
      <select style={toolbarSelect} defaultValue={data.saved_reports.find((r) => r.current)?.id}>
        {data.saved_reports.map((r) => (
          <option key={r.id} value={r.id}>
            {r.period_label}{r.current ? "  (current)" : r.note ? `  — ${r.note}` : ""}
          </option>
        ))}
      </select>
      <button type="button" style={secondaryBtn}><Zap size={12} /> Regenerate</button>
      <button type="button" style={secondaryBtn}><Share2 size={12} /> Copy MD</button>
      <button type="button" style={primaryBtn} onClick={onPrint}><Download size={12} /> Save as PDF</button>
    </div>
  );
}

function Section({
  index, title, kicker, anchor, children,
}: { index: number; title: string; kicker: string; anchor: string; children: React.ReactNode }) {
  return (
    <section id={anchor} style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <div style={sectionIndex}>{String(index).padStart(2, "0")}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={sectionTitle}>{title}</div>
          <div style={sectionKicker}>{kicker}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {children}
      </div>
    </section>
  );
}

function ArchetypeHero({ data }: { data: ReportData }) {
  const Icon = ICON_MAP[data.archetype.icon] ?? Sparkles;
  return (
    <div style={archetypeHeroStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={archetypeIconWrap}><Icon size={22} color="var(--af-accent)" /></div>
        <div>
          <div style={archetypeEyebrow}>You were a</div>
          <h2 style={archetypeLabel}>{data.archetype.label}</h2>
          <div style={archetypeTagline}>{data.archetype.tagline}</div>
        </div>
      </div>
      <p style={archetypeWhy}>{data.archetype.why}</p>
      {data.archetype.vs_usual && (
        <div style={archetypeVsUsual}>
          <Compass size={12} style={{ verticalAlign: -2 }} /> <span style={{ opacity: 0.75, marginLeft: 2 }}>vs your usual:</span>{" "}
          <strong style={{ color: "var(--af-text)" }}>{data.archetype.vs_usual}</strong>
        </div>
      )}
    </div>
  );
}

function SkillsStrip({ skills }: { skills: ReportData["top_skills"] }) {
  const max = Math.max(1, ...skills.map((s) => s.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}><Sparkles size={12} color="var(--af-accent)" style={{ marginRight: 6, verticalAlign: -1 }} />Skills you leaned on</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {skills.map((s) => (
          <div key={s.name} style={skillRow}>
            <div style={skillName}>{s.name}</div>
            <div style={skillBarWrap}>
              <div style={{ ...skillBar, width: `${(s.count / max) * 100}%` }} />
            </div>
            <div style={skillCount}>
              {s.count}×
              {typeof s.vs_prior === "number" && s.vs_prior !== 0 && (
                <span style={{ color: s.vs_prior > 0 ? "var(--af-accent)" : "var(--af-text-tertiary)", marginLeft: 6, fontSize: 10 }}>
                  {s.vs_prior > 0 ? "+" : ""}{s.vs_prior}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayStrip({ days }: { days: ReportData["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.agent_minutes));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}><Layers3 size={12} color="var(--af-accent)" style={{ marginRight: 6, verticalAlign: -1 }} />Daily activity</div>
      <div style={dayStripStyle}>
        {days.map((d) => {
          const heightPct = max === 0 ? 0 : (d.agent_minutes / max) * 100;
          const empty = d.agent_minutes === 0;
          return (
            <div key={d.day_name} style={dayCol}>
              <div style={dayBarWrap}>
                <div
                  style={{
                    ...dayBar,
                    height: `${heightPct}%`,
                    opacity: empty ? 0 : 1,
                    background: d.has_cross_project
                      ? "linear-gradient(180deg, #a78bfa 0%, var(--af-accent) 100%)"
                      : "var(--af-accent)",
                  }}
                />
              </div>
              <div style={dayConcurrency}>
                {empty ? (
                  <span style={{ opacity: 0.3 }}>—</span>
                ) : d.concurrency_peak > 1 ? (
                  <span style={{ color: d.has_cross_project ? "#a78bfa" : "var(--af-accent)", fontWeight: 600 }}>
                    ×{d.concurrency_peak}
                  </span>
                ) : (
                  <span style={{ opacity: 0.45 }}>×1</span>
                )}
              </div>
              <div style={dayMinutes}>{empty ? "—" : `${d.agent_minutes}m`}</div>
              <div style={dayName}>{d.day_name}</div>
              <div style={dayDate}>{d.date_label}</div>
            </div>
          );
        })}
      </div>
      <div style={dayLegend}>
        <span><span style={{ ...legendDot, background: "var(--af-accent)" }} /> same-project</span>
        <span><span style={{ ...legendDot, background: "#a78bfa" }} /> cross-project</span>
        <span style={{ opacity: 0.6 }}>× = concurrency peak</span>
      </div>
    </div>
  );
}

function PlanUtilRow({ days }: { days: ReportData["days"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={miniSectionTitle}>License utilization (by day)</div>
      <div style={planRow}>
        {days.map((d) => {
          const empty = d.plan_util_pct === 0;
          const tone = d.plan_util_pct >= 80 ? "#c08a1f" : d.plan_util_pct >= 50 ? "var(--af-accent)" : "var(--af-text-tertiary)";
          return (
            <div key={d.day_name} style={planCell}>
              <div style={{ ...planBar, background: "var(--af-border-subtle)" }}>
                <div style={{ width: `${d.plan_util_pct}%`, height: "100%", background: tone, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: empty ? "var(--af-text-tertiary)" : tone, fontWeight: empty ? 400 : 600, fontFamily: "var(--font-mono)" }}>
                {empty ? "—" : `${d.plan_util_pct}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectBars({ projects }: { projects: ReportData["projects"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}><Users size={12} color="var(--af-accent)" style={{ marginRight: 6, verticalAlign: -1 }} />Project time share</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {projects.map((p) => (
          <div key={p.name} style={projectRow}>
            <div style={projectName}>{p.display_name}</div>
            <div style={projectBarWrap}>
              <div style={{ ...projectBar, width: `${p.share_pct}%` }} />
            </div>
            <div style={projectMeta}>
              <span style={{ color: "var(--af-text)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{p.share_pct}%</span>
              <span style={{ opacity: 0.6, marginLeft: 8 }}>
                {Math.round(p.agent_minutes / 60 * 10) / 10}h · {p.prs} PR · {p.commits} commits
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShippedList({ items }: { items: ReportData["shipped"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}><Rocket size={12} color="var(--af-accent)" style={{ marginRight: 6, verticalAlign: -1 }} />What shipped ({items.length})</div>
      <div style={shippedList}>
        {items.map((s) => (
          <div key={s.title} style={shippedRow}>
            <div style={shippedLeft}>
              <div style={shippedTitleStyle}>{s.title}</div>
              <div style={shippedSummary}>{s.summary}</div>
            </div>
            <div style={shippedRight}>
              <div style={shippedMetaLine}>
                <span style={metaChip}>{s.project}</span>
                <span style={metaChip}>{s.duration_label}</span>
                <span style={metaChip}>{s.commits} commits</span>
                {s.subagents > 0 && <span style={metaChip}>{s.subagents} subagents</span>}
              </div>
              <div style={shippedFlags}>
                {s.flags.map((f) => <FlagPill key={f} flag={f} />)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PatternsGrid({ patterns }: { patterns: ReportData["patterns"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}><BrainCircuit size={12} color="var(--af-accent)" style={{ marginRight: 6, verticalAlign: -1 }} />Patterns worth naming</div>
      <div style={patternsGridStyle}>
        {patterns.map((p) => {
          const Icon = ICON_MAP[p.icon] ?? Zap;
          return (
            <div key={p.title} style={patternCardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={patternIconWrap}><Icon size={14} color="var(--af-accent)" /></div>
                <div style={patternTitle}>{p.title}</div>
              </div>
              <div style={patternStat}>{p.stat}</div>
              <div style={patternNote}>{p.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConcurrencyBlock({ c }: { c: ReportData["concurrency"] }) {
  return (
    <div style={concurrencyCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ ...patternIconWrap, background: "color-mix(in srgb, #a78bfa 18%, transparent)" }}>
          <Network size={14} color="#a78bfa" />
        </div>
        <div style={{ ...miniSectionTitle, margin: 0, color: "#a78bfa" }}>Concurrency</div>
      </div>
      <div style={concurrencyStatRow}>
        <div style={concurrencyStat}><span style={concurrencyStatValue}>{c.peak}</span><span style={concurrencyStatLabel}>peak agents · {c.peak_day}</span></div>
        <div style={concurrencyStat}><span style={concurrencyStatValue}>{c.multi_agent_days}</span><span style={concurrencyStatLabel}>days ≥3 parallel</span></div>
        <div style={concurrencyStat}><span style={concurrencyStatValue}>{c.cross_project_days}</span><span style={concurrencyStatLabel}>cross-project days</span></div>
      </div>
      <p style={{ ...patternNote, margin: "12px 0 0", fontSize: 13 }}>{c.insight}</p>
      <div style={concurrencySuggestion}>
        <ArrowRight size={13} color="var(--af-accent)" style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{c.suggestion}</span>
      </div>
    </div>
  );
}

function OutliersRow({ outliers }: { outliers: ReportData["outliers"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}>Outliers</div>
      <div style={outliersGridStyle}>
        {outliers.map((o) => (
          <div key={o.label} style={outlierCard}>
            <div style={outlierLabel}>{o.label}</div>
            <div style={outlierDetail}>{o.detail}</div>
            <div style={outlierNote}>{o.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionBlock({ headline, body }: { headline: string; body: string }) {
  return (
    <div style={suggestionCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Lightbulb size={16} color="var(--af-accent)" />
        <div style={suggestionEyebrow}>Next experiment</div>
      </div>
      <div style={suggestionHeadline}>{headline}</div>
      <p style={suggestionBody}>{body}</p>
    </div>
  );
}

function PriorWeeksStrip({ weeks }: { weeks: ReportData["prior_weeks"] }) {
  if (!weeks.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={miniSectionTitle}>You, the last 4 weeks</div>
      <div style={priorWeeksGrid}>
        {weeks.map((w) => (
          <div key={w.period_label} style={priorWeekCard}>
            <div style={priorWeekPeriod}>{w.period_label}</div>
            <div style={priorWeekArchetype}>{w.archetype}</div>
            <div style={priorWeekStats}>
              <span>{w.sessions} sess</span>
              <span>{w.prs} PR</span>
              <span>{w.subagents} sub</span>
              <span>{(w.agent_minutes / 60).toFixed(1)}h</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaFooter({ meta }: { meta: ReportData["meta"] }) {
  return (
    <footer style={footerStyle}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <span>
          <FileText size={11} style={inlineIcon} /> {meta.sessions_used} substantive
          <span style={{ opacity: 0.6 }}> · {meta.trivial_dropped} trivial dropped from {meta.sessions_total} total</span>
        </span>
        <span>Model: {meta.model}</span>
        <span>Context: {meta.context_kb} KB</span>
        <span>Pipeline: {(meta.pipeline_ms / 1000).toFixed(1)}s</span>
      </div>
      <div style={{ opacity: 0.7 }}>{meta.generated_at}</div>
    </footer>
  );
}

function FlagPill({ flag }: { flag: string }) {
  const meta = FLAG_TONE[flag] ?? { label: flag, tone: "neutral" as const };
  const colors = {
    good: { bg: "color-mix(in srgb, var(--af-accent) 14%, transparent)", fg: "var(--af-accent)" },
    warn: { bg: "color-mix(in srgb, #f5b445 18%, transparent)", fg: "#c08a1f" },
    danger: { bg: "color-mix(in srgb, #ef6a5e 18%, transparent)", fg: "#c13f33" },
    neutral: { bg: "var(--af-surface-raised)", fg: "var(--af-text-secondary)" },
  }[meta.tone];
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 500, padding: "3px 8px", borderRadius: 999,
      background: colors.bg, color: colors.fg, letterSpacing: "0.01em", whiteSpace: "nowrap",
    }}>
      {meta.label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
//                              Styles
// ──────────────────────────────────────────────────────────────────

const rootStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 24,
  maxWidth: 980, padding: "28px 44px 64px", margin: "0 auto",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex", alignItems: "flex-end", justifyContent: "space-between",
  flexWrap: "wrap", gap: 12, paddingBottom: 14,
  borderBottom: "1px solid var(--af-border-subtle)",
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px",
  border: "1px solid var(--af-accent)", borderRadius: 8,
  background: "var(--af-accent)", color: "white",
  fontSize: 11.5, fontWeight: 600, cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px",
  border: "1px solid var(--af-border)", borderRadius: 8,
  background: "var(--af-surface)", color: "var(--af-text)",
  fontSize: 11.5, fontWeight: 500, cursor: "pointer",
};

const toolbarSelect: React.CSSProperties = {
  padding: "7px 10px", border: "1px solid var(--af-border)", borderRadius: 8,
  background: "var(--af-surface)", color: "var(--af-text)", fontSize: 12, cursor: "pointer",
};

const sectionStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 18,
  scrollMarginTop: 20,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 14,
  paddingBottom: 4,
};

const sectionIndex: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
  color: "var(--af-accent)", fontFamily: "var(--font-mono)",
  padding: "2px 9px", borderRadius: 6,
  background: "color-mix(in srgb, var(--af-accent) 14%, transparent)",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--af-text)",
};

const sectionKicker: React.CSSProperties = {
  fontSize: 12, color: "var(--af-text-secondary)", marginTop: 1,
};

const miniSectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
  textTransform: "uppercase", color: "var(--af-text-tertiary)",
};

// Archetype hero
const archetypeHeroStyle: React.CSSProperties = {
  padding: "26px 28px", borderRadius: 16,
  background: "linear-gradient(135deg, color-mix(in srgb, var(--af-accent) 10%, var(--af-surface)) 0%, var(--af-surface) 70%)",
  border: "1px solid color-mix(in srgb, var(--af-accent) 20%, var(--af-border))",
  display: "flex", flexDirection: "column", gap: 10,
};

const archetypeIconWrap: React.CSSProperties = {
  width: 48, height: 48, borderRadius: 12,
  background: "color-mix(in srgb, var(--af-accent) 16%, transparent)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};

const archetypeEyebrow: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600,
};

const archetypeLabel: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--af-text)", margin: "2px 0", lineHeight: 1.15,
};

const archetypeTagline: React.CSSProperties = {
  fontSize: 13, color: "var(--af-text-secondary)",
};

const archetypeWhy: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.55, color: "var(--af-text)", margin: 0, maxWidth: 720,
};

const archetypeVsUsual: React.CSSProperties = {
  fontSize: 12, color: "var(--af-text-secondary)",
};

// Skills strip
const skillRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "minmax(200px, 40%) 1fr 80px",
  alignItems: "center", gap: 14,
};

const skillName: React.CSSProperties = {
  fontSize: 12.5, color: "var(--af-text)", fontFamily: "var(--font-mono)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const skillBarWrap: React.CSSProperties = {
  height: 6, background: "var(--af-border-subtle)", borderRadius: 3,
};

const skillBar: React.CSSProperties = {
  height: "100%", background: "var(--af-accent)", borderRadius: 3,
};

const skillCount: React.CSSProperties = {
  fontSize: 12, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums", textAlign: "right",
};

// Day strip
const dayStripStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6,
  padding: "14px 10px 10px",
  border: "1px solid var(--af-border-subtle)", borderRadius: 12,
  background: "var(--af-surface)",
};

const dayCol: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
};

const dayBarWrap: React.CSSProperties = {
  width: "100%", height: 70, display: "flex", alignItems: "flex-end", justifyContent: "center",
};

const dayBar: React.CSSProperties = {
  width: "60%", borderRadius: 4, minHeight: 3,
};

const dayConcurrency: React.CSSProperties = {
  fontSize: 11, fontFamily: "var(--font-mono)",
};

const dayMinutes: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text)", fontFamily: "var(--font-mono)",
};

const dayName: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--af-text)", marginTop: 2,
};

const dayDate: React.CSSProperties = {
  fontSize: 10, color: "var(--af-text-tertiary)",
};

const dayLegend: React.CSSProperties = {
  display: "flex", gap: 18, fontSize: 10.5, color: "var(--af-text-secondary)",
  paddingLeft: 4,
};

const legendDot: React.CSSProperties = {
  display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, verticalAlign: 0,
};

// Plan utilization
const planRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6,
};

const planCell: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px 0",
};

const planBar: React.CSSProperties = {
  width: "70%", height: 6, borderRadius: 3, overflow: "hidden",
};

// Projects
const projectRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "minmax(180px, 30%) 1fr minmax(170px, auto)",
  alignItems: "center", gap: 14,
};

const projectName: React.CSSProperties = {
  fontSize: 13, color: "var(--af-text)", fontFamily: "var(--font-mono)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const projectBarWrap: React.CSSProperties = {
  height: 14, background: "var(--af-border-subtle)", borderRadius: 4,
};

const projectBar: React.CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg, var(--af-accent) 0%, color-mix(in srgb, var(--af-accent) 65%, transparent) 100%)",
  borderRadius: 4,
};

const projectMeta: React.CSSProperties = {
  fontSize: 12, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)", textAlign: "right",
};

// Shipped list
const shippedList: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8,
};

const shippedRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "1fr auto", gap: 20,
  padding: "14px 16px",
  border: "1px solid var(--af-border-subtle)", borderRadius: 10,
  background: "var(--af-surface)",
};

const shippedLeft: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, minWidth: 0,
};

const shippedTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em",
};

const shippedSummary: React.CSSProperties = {
  fontSize: 12.5, color: "var(--af-text-secondary)", lineHeight: 1.5,
};

const shippedRight: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5,
  minWidth: 0,
};

const shippedMetaLine: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "flex-end",
};

const metaChip: React.CSSProperties = {
  fontSize: 10.5, padding: "2px 7px", background: "var(--af-surface-raised)",
  borderRadius: 5, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)",
};

const shippedFlags: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "flex-end",
};

// Patterns
const patternsGridStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10,
};

const patternCardStyle: React.CSSProperties = {
  padding: "14px 16px", background: "var(--af-surface)",
  border: "1px solid var(--af-border-subtle)", borderRadius: 10,
  display: "flex", flexDirection: "column", gap: 4,
};

const patternIconWrap: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6,
  background: "color-mix(in srgb, var(--af-accent) 14%, transparent)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const patternTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--af-text)" };
const patternStat: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: "var(--af-accent)",
  fontFamily: "var(--font-mono)", marginBottom: 2,
};
const patternNote: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: "var(--af-text-secondary)",
};

// Concurrency block
const concurrencyCard: React.CSSProperties = {
  padding: "18px 22px", borderRadius: 12,
  background: "color-mix(in srgb, #a78bfa 6%, var(--af-surface))",
  border: "1px solid color-mix(in srgb, #a78bfa 28%, var(--af-border))",
  display: "flex", flexDirection: "column", gap: 4,
};

const concurrencyStatRow: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 8,
};

const concurrencyStat: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2,
};

const concurrencyStatValue: React.CSSProperties = {
  fontSize: 24, fontWeight: 700, color: "#a78bfa",
  fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
};

const concurrencyStatLabel: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text-secondary)",
};

const concurrencySuggestion: React.CSSProperties = {
  display: "flex", gap: 8, alignItems: "flex-start",
  padding: "10px 12px", marginTop: 10,
  background: "var(--af-surface-raised)", borderRadius: 8,
  fontSize: 12.5, lineHeight: 1.5, color: "var(--af-text)",
};

// Outliers
const outliersGridStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8,
};

const outlierCard: React.CSSProperties = {
  padding: "10px 12px", background: "var(--af-surface)",
  border: "1px solid var(--af-border-subtle)", borderRadius: 8,
  display: "flex", flexDirection: "column", gap: 1,
};

const outlierLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
  color: "var(--af-text-tertiary)",
};

const outlierDetail: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, color: "var(--af-text)",
  fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
};

const outlierNote: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text-secondary)", lineHeight: 1.35,
};

// Suggestion
const suggestionCard: React.CSSProperties = {
  padding: "22px 26px", borderRadius: 14,
  background: "color-mix(in srgb, var(--af-accent) 10%, var(--af-surface))",
  border: "1px solid color-mix(in srgb, var(--af-accent) 30%, transparent)",
};

const suggestionEyebrow: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.09em",
  textTransform: "uppercase", color: "var(--af-accent)",
};

const suggestionHeadline: React.CSSProperties = {
  fontSize: 18, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em",
  marginBottom: 6, lineHeight: 1.3,
};

const suggestionBody: React.CSSProperties = {
  fontSize: 13.5, lineHeight: 1.55, color: "var(--af-text-secondary)", margin: 0, maxWidth: 720,
};

// Prior weeks
const priorWeeksGrid: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8,
};

const priorWeekCard: React.CSSProperties = {
  padding: "12px 14px", background: "var(--af-surface)",
  border: "1px solid var(--af-border-subtle)", borderRadius: 10,
  display: "flex", flexDirection: "column", gap: 4,
};

const priorWeekPeriod: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)",
};

const priorWeekArchetype: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "var(--af-text)",
};

const priorWeekStats: React.CSSProperties = {
  display: "flex", gap: 10, fontSize: 11, color: "var(--af-text-secondary)",
  fontFamily: "var(--font-mono)", marginTop: 2,
};

// Footer
const footerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  flexWrap: "wrap", gap: 10, fontSize: 11, color: "var(--af-text-tertiary)",
  fontFamily: "var(--font-mono)", paddingTop: 18, marginTop: 8,
  borderTop: "1px solid var(--af-border-subtle)",
};

const inlineIcon: React.CSSProperties = { display: "inline", verticalAlign: -1, marginRight: 4 };

function PrintStyles() {
  return (
    <style>{`
      @media print {
        body, html { background: white !important; }
        aside, .af-sidebar, nav[data-sidebar], header[data-app-header] { display: none !important; }
        .no-print { display: none !important; }
        .report-root { max-width: none !important; padding: 24px !important; margin: 0 !important; color: #111 !important; }
        .report-root section { page-break-inside: avoid; }
      }
    `}</style>
  );
}
