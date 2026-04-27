"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type WeekRow = {
  iso_week: number;
  start: string;
  end: string;
  label: string;
  sessions: number;
  in_progress: boolean;
  saved_key: string | null;
  headline: string | null;
  shipped_count: number;
  agent_min: number;
};

type MonthRow = {
  year: number;
  month: number;
  start: string;
  end: string;
  label: string;
  sessions: number;
  in_progress: boolean;
  saved_key: string | null;
  headline: string | null;
  shipped_count: number;
  agent_min: number;
};

type Tab = "weeks" | "months";

export function InsightsHistory() {
  const [tab, setTab] = useState<Tab>("weeks");
  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [months, setMonths] = useState<MonthRow[] | null>(null);

  useEffect(() => {
    void fetch("/api/digest/week-index?count=12")
      .then(r => r.json())
      .then((j: { weeks: WeekRow[] }) => setWeeks(j.weeks))
      .catch(() => setWeeks([]));
    void fetch("/api/digest/month-index?count=6")
      .then(r => r.json())
      .then((j: { months: MonthRow[] }) => setMonths(j.months))
      .catch(() => setMonths([]));
  }, []);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 40px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <h2 style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--af-text-tertiary)",
          margin: 0, marginRight: 4,
        }}>History</h2>
        <div style={tabGroup}>
          {(["weeks", "months"] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)} style={{
              ...tabBtn,
              background: tab === t ? "var(--af-accent)" : "transparent",
              color: tab === t ? "white" : "var(--af-text-secondary)",
            }}>
              {t === "weeks" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
      </div>

      {tab === "weeks" ? (
        weeks === null ? <Empty>Loading weeks…</Empty>
        : weeks.length === 0 ? <Empty>No history yet.</Empty>
        : (
          <ul style={listStyle}>
            {weeks.map(w => <WeekItem key={w.start} w={w} />)}
          </ul>
        )
      ) : (
        months === null ? <Empty>Loading months…</Empty>
        : months.length === 0 ? <Empty>No history yet.</Empty>
        : (
          <ul style={listStyle}>
            {months.map(m => <MonthItem key={m.start} m={m} />)}
          </ul>
        )
      )}
    </div>
  );
}

function WeekItem({ w }: { w: WeekRow }) {
  const empty = w.sessions === 0 && !w.in_progress && !w.saved_key;
  const isThisWeek = w.in_progress;
  const target = w.saved_key
    ? `/insights/${w.saved_key}`
    : isThisWeek
      ? `/insights/week-${w.start}`
      : `/insights/week-${w.start}`;
  const subline = w.saved_key && w.headline
    ? w.headline
    : empty ? "no data"
    : isThisWeek ? "in progress · click to view"
    : `${w.sessions} session${w.sessions === 1 ? "" : "s"} · click to generate`;

  return (
    <li style={pickerRow(!!w.saved_key)}>
      <Link href={target} style={{
        display: "flex", flexDirection: "column", gap: 4, textDecoration: "none",
        flex: 1, minWidth: 0,
      }}>
        <div style={rowHeader}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>
            W{String(w.iso_week).padStart(2, "0")} · {w.label}
          </span>
          {w.in_progress && <span style={inProgressTag}>in progress</span>}
          {w.saved_key && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: "var(--af-accent)", marginLeft: "auto",
            }}>
              {w.shipped_count} PR · {w.agent_min}m
            </span>
          )}
        </div>
        <span style={subStyle}>{subline}</span>
      </Link>
    </li>
  );
}

function MonthItem({ m }: { m: MonthRow }) {
  const empty = m.sessions === 0 && !m.in_progress && !m.saved_key;
  const target = m.saved_key
    ? `/insights/${m.saved_key}`
    : `/insights/month-${m.start.slice(0, 7)}`;
  const subline = m.saved_key && m.headline
    ? m.headline
    : empty ? "no data"
    : m.in_progress ? "in progress · click to view"
    : `${m.sessions} session${m.sessions === 1 ? "" : "s"} · click to generate`;

  return (
    <li style={pickerRow(!!m.saved_key)}>
      <Link href={target} style={{
        display: "flex", flexDirection: "column", gap: 4, textDecoration: "none",
        flex: 1, minWidth: 0,
      }}>
        <div style={rowHeader}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>
            {m.label}
          </span>
          {m.in_progress && <span style={inProgressTag}>in progress</span>}
          {m.saved_key && (
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: "var(--af-accent)", marginLeft: "auto",
            }}>
              {m.shipped_count} PR · {m.agent_min}m
            </span>
          )}
        </div>
        <span style={subStyle}>{subline}</span>
      </Link>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "20px 18px", borderRadius: 10,
      border: "1px dashed var(--af-border)", background: "var(--af-surface)",
      fontSize: 13, color: "var(--af-text-tertiary)", lineHeight: 1.55,
    }}>{children}</div>
  );
}

const tabGroup: React.CSSProperties = {
  display: "inline-flex", gap: 3, border: "1px solid var(--af-border)", borderRadius: 8, padding: 2,
};
const tabBtn: React.CSSProperties = {
  padding: "5px 14px", fontSize: 12, fontWeight: 600,
  border: "none", borderRadius: 6, cursor: "pointer",
};
const listStyle: React.CSSProperties = {
  listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4,
};
function pickerRow(saved: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "stretch", gap: 14,
    padding: "10px 14px", borderRadius: 10,
    border: `1px solid ${saved ? "color-mix(in srgb, var(--af-accent) 24%, var(--af-border))" : "var(--af-border-subtle)"}`,
    background: saved ? "color-mix(in srgb, var(--af-accent) 6%, var(--af-surface))" : "var(--af-surface)",
    transition: "border-color 0.15s",
  };
}
const rowHeader: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, minWidth: 0,
};
const subStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text-tertiary)", lineHeight: 1.5,
  fontFamily: "var(--font-mono)",
};
const inProgressTag: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, padding: "2px 6px", borderRadius: 4,
  background: "color-mix(in srgb, #f5b445 18%, transparent)", color: "#c08a1f",
  letterSpacing: "0.02em",
};
