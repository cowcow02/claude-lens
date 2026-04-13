import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type Row = { label: string; window: UsageWindow | null };

export function UsageGauges({ snapshot }: { snapshot: UsageSnapshot }) {
  const rows: Row[] = [
    { label: "5 hour", window: snapshot.five_hour },
    { label: "7 day (all)", window: snapshot.seven_day },
    { label: "7 day Opus", window: snapshot.seven_day_opus },
    { label: "7 day Sonnet", window: snapshot.seven_day_sonnet },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <Gauge key={row.label} {...row} />
      ))}
    </div>
  );
}

function Gauge({ label, window }: Row) {
  const pct = window?.utilization ?? null;
  const hasData = pct !== null;
  const clamped = hasData ? Math.max(0, Math.min(100, pct!)) : 0;
  const tone = clamped >= 90 ? "bg-red-500" : clamped >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm text-af-muted">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">
          {hasData ? `${clamped.toFixed(1)}%` : "—"}
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-af-border/40">
        <div
          className={`h-full ${tone} transition-all`}
          style={{ width: hasData ? `${clamped}%` : "0%" }}
        />
      </div>
      {window?.resets_at && (
        <div className="mt-2 text-xs text-af-muted">
          Resets {formatRelative(window.resets_at)}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const label = diffSec < 0 ? "ago" : "in";

  if (abs < 60) return `${label === "ago" ? `${abs}s ago` : `in ${abs}s`}`;
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return diffSec < 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return diffSec < 0 ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / 86400);
  return diffSec < 0 ? `${d}d ago` : `in ${d}d`;
}
