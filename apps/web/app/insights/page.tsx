import { readSettings, readWeekDigest } from "@claude-lens/entries/node";
import { lastCompletedWeekMonday } from "@/lib/entries";
import { shouldAutoFireWeek } from "@/lib/auto-week-fire";
import { WeekDigestView } from "@/components/week-digest-view";
import { InsightsHistory } from "@/components/insights-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InsightsPage() {
  const settings = readSettings();
  const aiOn = settings.ai_features.enabled;
  const lastWeek = lastCompletedWeekMonday();
  const cached = readWeekDigest(lastWeek);

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
        <WeekDigestView
          initial={cached}
          monday={lastWeek}
          aiEnabled={aiOn}
          autoFire={autoFire}
        />
      </section>

      <InsightsHistory />
    </div>
  );
}
