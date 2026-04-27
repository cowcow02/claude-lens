import Link from "next/link";
import { readSettings, readWeekDigest } from "@claude-lens/entries/node";
import { lastCompletedWeekMonday, listEntriesForDay } from "@/lib/entries";
import { shouldAutoFireWeek } from "@/lib/auto-week-fire";
import { WeekDigestView } from "@/components/week-digest-view";
import { InsightsHistory } from "@/components/insights-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function priorMonday(monday: string): string {
  const d = new Date(`${monday}T00:00:00`);
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekDates(monday: string): string[] {
  const out: string[] = [];
  const start = new Date(`${monday}T00:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

function hasAnyEntries(monday: string): boolean {
  for (const d of weekDates(monday)) {
    if (listEntriesForDay(d).length > 0) return true;
  }
  return false;
}

export default async function InsightsPage() {
  const settings = readSettings();
  const aiOn = settings.ai_features.enabled;
  const lastWeek = lastCompletedWeekMonday();
  const cached = readWeekDigest(lastWeek);
  const prior = readWeekDigest(priorMonday(lastWeek));
  const hasData = !!cached || hasAnyEntries(lastWeek);

  const autoFire = aiOn && !cached && shouldAutoFireWeek(lastWeek);

  return (
    <div style={{ paddingBottom: 64 }}>
      <header style={{
        maxWidth: 980, margin: "0 auto", padding: "32px 40px 0",
      }}>
        <h1 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0,
        }}>Insights</h1>
        <p style={{
          fontSize: 13, color: "var(--af-text-secondary)",
          margin: "6px 0 0", lineHeight: 1.55, maxWidth: 640,
        }}>
          Weekly and monthly digests built from per-day perception entries. Past periods are cached locally and immutable; the current week and month live in a 10-min in-memory window.
        </p>
      </header>

      <section style={{ marginTop: 24, paddingBottom: 28, borderBottom: "1px solid var(--af-border-subtle)" }}>
        {hasData ? (
          <WeekDigestView
            initial={cached}
            monday={lastWeek}
            aiEnabled={aiOn}
            autoFire={autoFire}
            prior={prior}
          />
        ) : (
          <EmptyState aiOn={aiOn} />
        )}
      </section>

      <InsightsHistory />
    </div>
  );
}

function EmptyState({ aiOn }: { aiOn: boolean }) {
  return (
    <div style={{
      maxWidth: 720, margin: "16px auto 0", padding: "20px 40px",
    }}>
      <div style={{
        padding: "20px 22px", borderRadius: 12,
        background: "var(--af-surface)",
        border: "1px dashed var(--af-border)",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--af-text-tertiary)", marginBottom: 6,
        }}>No data yet</div>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: "0 0 12px", color: "var(--af-text)" }}>
          A week digest needs per-day perception entries first. Each session you run with Claude Code generates entries automatically; once a few days have passed, this page will start producing a weekly retrospective.
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 14px", color: "var(--af-text-secondary)" }}>
          {aiOn
            ? "AI features are on. Run any session, then revisit — or use the home page to backfill recent days from existing transcripts."
            : "AI narratives are off. Enable them in Settings to see headlines, friction patterns, and weekly suggestions."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/" style={ctaPrimary}>
            Home · backfill recent days
          </Link>
          {!aiOn && (
            <Link href="/settings" style={ctaSecondary}>
              Settings · enable AI features
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const ctaPrimary: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  background: "var(--af-accent)", color: "white",
  fontSize: 12, fontWeight: 600, textDecoration: "none",
};

const ctaSecondary: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  background: "transparent", border: "1px solid var(--af-border)",
  color: "var(--af-text)", fontSize: 12, fontWeight: 500, textDecoration: "none",
};
