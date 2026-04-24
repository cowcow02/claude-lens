import Link from "next/link";
import { readDayDigest, listEntriesForDay } from "@claude-lens/entries/fs";
import { buildDeterministicDigest, readSettings } from "@claude-lens/entries/node";
import type { DayDigest } from "@claude-lens/entries";
import { yesterdayLocal, toLocalDay } from "@/lib/entries";

function fmtDateShort(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = /^[^.!?]+[.!?]/.exec(s);
  return m ? m[0] : s;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Returns the most recent local day (< today) that has any entries. */
function mostRecentActiveDay(): string | null {
  for (let i = 1; i <= 30; i++) {
    const d = toLocalDay(Date.now() - i * 86_400_000);
    if (listEntriesForDay(d).length > 0) return d;
  }
  return null;
}

export function YesterdayHero() {
  const aiEnabled = readSettings().ai_features.enabled;
  const yesterday = yesterdayLocal();
  let date = yesterday;
  let entries = listEntriesForDay(yesterday);
  let fallback = false;

  if (entries.length === 0) {
    const recent = mostRecentActiveDay();
    if (recent) {
      date = recent;
      entries = listEntriesForDay(recent);
      fallback = true;
    }
  }

  if (entries.length === 0) {
    return (
      <div className="af-panel" style={{ padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--af-text-secondary)" }}>
          No recent activity yet. Once you run some Claude Code sessions, your daily digest will appear here.
        </p>
      </div>
    );
  }

  let digest: DayDigest | null = readDayDigest(date);
  if (!digest) digest = buildDeterministicDigest(date, entries);

  const headline = digest.headline
    ?? `Worked ${Math.round(digest.agent_min)}m across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}${digest.shipped.length > 0 ? `; shipped ${digest.shipped.length} PR${digest.shipped.length === 1 ? "" : "s"}` : ""}.`;

  const wentWell = firstSentence(digest.what_went_well);
  const friction = firstSentence(digest.what_hit_friction);

  return (
    <div className="af-panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{
          fontSize: 11, color: "var(--af-text-tertiary)",
          textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
        }}>
          {fallback ? "Last active" : "Yesterday"} · {fmtDateShort(date)}
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 600, margin: "8px 0 0", lineHeight: 1.35 }}>
          {truncate(headline, 180)}
        </h2>
      </div>
      <div style={{ fontSize: 12, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)" }}>
        {Math.round(digest.agent_min)}m agent time · {digest.projects.length} project{digest.projects.length === 1 ? "" : "s"} · {digest.shipped.length} PR{digest.shipped.length === 1 ? "" : "s"} shipped
      </div>
      {(wentWell || friction) && (
        <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          {wentWell && <div><span style={{ color: "#48bb78" }}>✓</span> {truncate(wentWell, 160)}</div>}
          {friction && <div><span style={{ color: "#ed8936" }}>⚠</span> {truncate(friction, 160)}</div>}
        </div>
      )}
      {!aiEnabled && (
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          <Link href="/settings" style={{ color: "var(--af-accent)" }}>Enable AI features</Link> to see daily narratives.
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <Link href={`/digest/${date}`} style={{ fontSize: 12, color: "var(--af-accent)" }}>
          Open full digest →
        </Link>
        <Link href="/insights" style={{ fontSize: 12, color: "var(--af-accent)" }}>
          Weekly insight report →
        </Link>
      </div>
    </div>
  );
}
