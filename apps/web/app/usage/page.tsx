/**
 * Claude Code usage page — historical utilization analytics.
 *
 * Current utilization lives in the sidebar (always visible). This page
 * is dedicated to historical views, trend analysis, and leadership
 * reporting metrics derived from the daemon's snapshot log.
 *
 * Reads from ~/.cclens/usage.jsonl — no API endpoint needed.
 */

import { Activity } from "lucide-react";
import {
  readUsageSnapshotsByAgent,
  latestUsageSnapshotByAgent,
  readCachedPlanTier,
  PLAN_TIER_LABELS,
} from "@/lib/usage-data";
import {
  readCalibrationDump,
  predictedSeriesFor,
  previousCyclesTrend,
} from "@/lib/calibration-data";
import { UsageChartsDashboard } from "@/components/usage-charts-dashboard";
import { PreviousCyclesTrend } from "@/components/previous-cycles-trend";
import { CodexUsageCard } from "@/components/codex-usage-card";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const snapshots = readUsageSnapshotsByAgent("claude-code");
  const latest = latestUsageSnapshotByAgent("claude-code");
  const codexLatest = latestUsageSnapshotByAgent("codex");
  const tier = readCachedPlanTier();
  const calibration = await readCalibrationDump();
  const predicted = predictedSeriesFor(calibration);
  const cycles7d = previousCyclesTrend(calibration, "7d");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 1400,
        padding: "20px 32px",
      }}
    >
      {/* Header */}
      <header
        style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Activity size={18} />
          Usage history
        </h1>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          historical plan utilization · current usage in sidebar
        </span>
        {tier && (
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              padding: "4px 10px",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
            }}
            title={tier.rateLimitTier ? `Anthropic rate_limit_tier: ${tier.rateLimitTier}` : undefined}
          >
            <span style={{ color: "var(--af-text-tertiary)" }}>plan</span>
            <span style={{ color: "var(--af-text)", fontWeight: 600 }}>
              {PLAN_TIER_LABELS[tier.planTier].label}
            </span>
            {PLAN_TIER_LABELS[tier.planTier].monthlyPriceUsd > 0 && (
              <span style={{ color: "var(--af-text-tertiary)" }}>
                · ${PLAN_TIER_LABELS[tier.planTier].monthlyPriceUsd}/mo
              </span>
            )}
          </span>
        )}
      </header>

      {!latest && !codexLatest ? (
        <EmptyState />
      ) : (
        <>
          <CodexUsageCard latest={codexLatest} />
          {latest && (
            <>
              <PreviousCyclesTrend windowLabel="7d" cycles={cycles7d} />
              <UsageChartsDashboard snapshots={snapshots} predicted={predicted} />
              <div
                style={{
                  fontSize: 11,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}
                suppressHydrationWarning
              >
                Last Claude poll: {new Date(latest.captured_at).toLocaleString()} ·{" "}
                {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} on disk
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="af-card"
      style={{
        padding: "48px 32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--af-text)",
        }}
      >
        No usage data yet
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--af-text-tertiary)",
          marginTop: 8,
        }}
      >
        Start the polling daemon to begin collecting metrics every 5 minutes:
      </p>
      <pre
        style={{
          display: "inline-block",
          marginTop: 14,
          background: "var(--background)",
          border: "1px solid var(--af-border-subtle)",
          padding: "8px 16px",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text)",
        }}
      >
        cclens daemon start
      </pre>
      <p
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          marginTop: 16,
        }}
      >
        For a one-shot snapshot without the daemon, run{" "}
        <code
          style={{
            background: "var(--background)",
            padding: "1px 6px",
            borderRadius: 4,
            fontFamily: "var(--font-mono)",
          }}
        >
          cclens usage
        </code>
        .
      </p>
    </div>
  );
}
