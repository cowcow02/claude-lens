import type { UsageSnapshot } from "@/lib/usage-data";

const ACCENT = "rgb(16, 163, 127)";
const ACCENT_BG = "rgba(16, 163, 127, 0.10)";
const ACCENT_BORDER = "rgba(16, 163, 127, 0.28)";

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(1) + "%";
}

function formatResetIn(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Per-snapshot card for the Codex source — same conceptual content as the
 * Claude usage panel (5h primary + 7d secondary) but rendered as a compact
 * card since Codex doesn't emit per-model breakdowns.
 *
 * Returns null when no Codex snapshots have been captured yet so the page
 * stays clean for users who only run Claude Code.
 */
export function CodexUsageCard({ latest }: { latest: UsageSnapshot | null }) {
  if (!latest) return null;
  const fiveResetIn = formatResetIn(latest.five_hour.resets_at);
  const sevenResetIn = formatResetIn(latest.seven_day.resets_at);
  const planLabel = latest.plan_type ? `Codex ${latest.plan_type}` : "Codex";
  return (
    <div
      className="af-card"
      style={{
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderColor: ACCENT_BORDER,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            background: ACCENT_BG,
            color: ACCENT,
            border: `1px solid ${ACCENT_BORDER}`,
          }}
        >
          {planLabel}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)" }}>
          Plan utilization
        </span>
        <span
          suppressHydrationWarning
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          last poll {new Date(latest.captured_at).toLocaleTimeString()}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <UsageGauge
          label="5-hour window"
          pct={latest.five_hour.utilization}
          resetsIn={fiveResetIn}
        />
        <UsageGauge
          label="7-day window"
          pct={latest.seven_day.utilization}
          resetsIn={sevenResetIn}
        />
      </div>
    </div>
  );
}

function UsageGauge({
  label,
  pct,
  resetsIn,
}: {
  label: string;
  pct: number | null;
  resetsIn: string;
}) {
  const filled = pct !== null && Number.isFinite(pct) ? Math.min(100, pct) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
        }}
      >
        <span>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>resets in {resetsIn}</span>
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--af-text)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "-0.02em",
        }}
      >
        {formatPct(pct)}
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--af-border-subtle)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${filled}%`,
            height: "100%",
            background: ACCENT,
            transition: "width 240ms ease-out",
          }}
        />
      </div>
    </div>
  );
}
