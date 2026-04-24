import Link from "next/link";
import { listEntriesForDay, readDayDigest } from "@claude-lens/entries/fs";
import { toLocalDay } from "@/lib/entries";

type Row = {
  date: string;
  label: string;
  agentMin: number;
  prs: number;
  status: "generated" | "pending" | "empty";
};

export function RecentDaysPanel() {
  const now = Date.now();
  const rows: Row[] = [];

  for (let i = 0; i < 5; i++) {
    const d = toLocalDay(now - i * 86_400_000);
    const entries = listEntriesForDay(d);
    const agentMin = entries.reduce((s, e) => s + e.numbers.active_min, 0);
    const prs = entries.reduce((s, e) => s + e.pr_titles.length, 0);
    const digest = readDayDigest(d);
    const status: Row["status"] = entries.length === 0 ? "empty"
      : digest && digest.headline ? "generated"
      : "pending";

    const label = i === 0 ? "Today"
      : i === 1 ? "Yesterday"
      : new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    rows.push({ date: d, label, agentMin, prs, status });
  }

  return (
    <div className="af-panel">
      <div className="af-panel-header">
        <span>Recent days</span>
        <Link href="/digest" style={{ fontSize: 11, color: "var(--af-accent)", marginLeft: "auto" }}>
          Backfill →
        </Link>
      </div>
      <div>
        {rows.map(r => (
          <Link key={r.date} href={`/digest/${r.date}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: 10,
              padding: "10px 18px",
              fontSize: 12,
              borderBottom: "1px solid var(--af-border-subtle)",
              alignItems: "center",
            }}>
            <span>{r.label}</span>
            <StatusPill status={r.status} />
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", fontSize: 11, minWidth: 36, textAlign: "right" }}>
              {r.agentMin > 0 ? `${Math.round(r.agentMin)}m` : "—"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", fontSize: 11, minWidth: 42, textAlign: "right" }}>
              {r.prs > 0 ? `${r.prs} PR${r.prs === 1 ? "" : "s"}` : ""}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Row["status"] }) {
  const style = {
    generated: { bg: "rgba(72,187,120,0.12)", fg: "#48bb78", text: "✓" },
    pending:   { bg: "rgba(237,137,54,0.12)", fg: "#ed8936", text: "•" },
    empty:     { bg: "transparent",           fg: "var(--af-text-tertiary)", text: "—" },
  }[status];
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 99,
      background: style.bg, color: style.fg, minWidth: 22, textAlign: "center",
    }}>
      {style.text}
    </span>
  );
}
