/**
 * Claude Code usage page — 5h/7d utilization gauges + time series.
 *
 * Reads from ~/.cclens/usage.jsonl (written by the cclens daemon).
 * No API endpoint — direct file read on the server.
 */

import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";
import { readUsageSnapshots, latestUsageSnapshot } from "@/lib/usage-data";
import { UsageGauges } from "@/components/usage-gauges";
import { UsageChart } from "@/components/usage-chart";

export const dynamic = "force-dynamic";

export default function UsagePage() {
  const snapshots = readUsageSnapshots();
  const latest = latestUsageSnapshot();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-sm text-af-muted hover:text-af-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Activity className="h-6 w-6" /> Claude Code Usage
        </h1>
        <p className="mt-1 text-sm text-af-muted">
          Plan utilization over rolling 5-hour and 7-day windows. Same numbers Claude Code&apos;s{" "}
          <code className="rounded bg-af-surface px-1">/usage</code> slash command shows.
        </p>
      </div>

      {!latest ? (
        <EmptyState />
      ) : (
        <>
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-af-muted">
              Current
            </h2>
            <UsageGauges snapshot={latest} />
          </section>

          <section className="mb-6">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-af-muted">
              History ({snapshots.length} snapshots)
            </h2>
            <UsageChart snapshots={snapshots} />
          </section>

          <section className="text-xs text-af-muted">
            Last updated: {new Date(latest.captured_at).toLocaleString()}
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-8 text-center">
      <h2 className="text-lg font-medium">No usage data yet</h2>
      <p className="mt-2 text-sm text-af-muted">
        Start the polling daemon to begin collecting metrics every 5 minutes:
      </p>
      <pre className="mt-4 inline-block rounded bg-af-bg px-4 py-2 text-left text-sm">
        cclens daemon start
      </pre>
      <p className="mt-4 text-xs text-af-muted">
        For a one-shot snapshot without the daemon, run{" "}
        <code className="rounded bg-af-bg px-1">cclens usage</code>.
      </p>
    </div>
  );
}
