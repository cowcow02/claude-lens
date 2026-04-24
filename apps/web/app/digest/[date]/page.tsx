import { readDayDigest, listEntriesForDay } from "@claude-lens/entries/fs";
import { readSettings, buildDeterministicDigest } from "@claude-lens/entries/node";
import type { DayDigest } from "@claude-lens/entries";
import { isValidDate, todayLocal } from "@/lib/entries";
import { DayDigestView } from "@/components/day-digest-view";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default async function DigestDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDate(date)) return notFound();

  const today = todayLocal();
  if (date > today) {
    return (
      <div style={{ padding: "40px" }}>
        <h1>Future date</h1>
        <p>Digests only exist for past and current days.</p>
        <Link href={`/digest/${today}`}>Go to today →</Link>
      </div>
    );
  }

  const settings = readSettings();
  const aiEnabled = settings.ai_features.enabled;

  let initial: DayDigest | null = null;
  if (date !== today) {
    initial = readDayDigest(date);
  }
  if (!initial) {
    const entries = listEntriesForDay(date);
    if (entries.length > 0) {
      initial = buildDeterministicDigest(date, entries);
    }
  }

  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <div>
      <nav style={{
        padding: "14px 40px", display: "flex", gap: 14, fontSize: 12,
        borderBottom: "1px solid var(--af-border-subtle)", alignItems: "center",
      }}>
        <Link href={`/digest/${prev}`} style={{ color: "var(--af-accent)" }}>← Prev day</Link>
        {next <= today && <Link href={`/digest/${next}`} style={{ color: "var(--af-accent)" }}>Next day →</Link>}
        {date !== today && (
          <Link href={`/digest/${today}`} style={{ marginLeft: "auto", color: "var(--af-accent)" }}>
            Today →
          </Link>
        )}
      </nav>
      <DayDigestView initial={initial} date={date} aiEnabled={aiEnabled} />
    </div>
  );
}
