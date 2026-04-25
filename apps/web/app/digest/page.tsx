import { listEntriesForDay, readDayDigest } from "@claude-lens/entries/fs";
import { readSettings } from "@claude-lens/entries/node";
import { toLocalDay } from "@/lib/entries";
import { BackfillList } from "@/components/backfill-list";

export const dynamic = "force-dynamic";

export type BackfillRow = {
  date: string;
  day_label: string;
  entry_count: number;
  agent_min: number;
  pr_count: number;
  status: "generated" | "pending" | "empty";
};

const DAYS_BACK = 30;

export default function DigestIndexPage() {
  const aiEnabled = readSettings().ai_features.enabled;
  const now = Date.now();

  const rows: BackfillRow[] = [];
  for (let i = 0; i < DAYS_BACK; i++) {
    const d = toLocalDay(now - i * 86_400_000);
    const entries = listEntriesForDay(d);
    const digest = readDayDigest(d);
    const agentMin = entries.reduce((s, e) => s + e.numbers.active_min, 0);
    const prCount = entries.reduce((s, e) => s + e.pr_titles.length, 0);
    const status: BackfillRow["status"] = entries.length === 0 ? "empty"
      : digest && digest.headline ? "generated"
      : "pending";

    const label = i === 0 ? "Today"
      : i === 1 ? "Yesterday"
      : new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    rows.push({
      date: d, day_label: label,
      entry_count: entries.length, agent_min: agentMin, pr_count: prCount,
      status,
    });
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 40px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Digest backfill</h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          Last {DAYS_BACK} days · Select days to generate or regenerate. Days marked <span style={{ color: "#48bb78" }}>✓</span> are already generated; <span style={{ color: "#ed8936" }}>•</span> have entries but no narrative.
        </p>
      </header>
      <BackfillList rows={rows} aiEnabled={aiEnabled} />
    </div>
  );
}
