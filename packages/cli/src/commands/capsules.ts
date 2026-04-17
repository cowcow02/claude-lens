import { listSessions, getSession } from "@claude-lens/parser/fs";
import { buildCapsule, type SessionCapsule } from "@claude-lens/parser";

function parseDateArg(raw: string | undefined): Date | null {
  if (!raw) return null;
  // YYYYMMDD or YYYY-MM-DD
  const compact = raw.replace(/-/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  const d = new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export async function capsules(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const compact = args.includes("--compact");
  const pretty = args.includes("--pretty");
  const json = args.includes("--json") || !pretty; // default to json
  const daysArg = flag(args, "--days");

  let sinceDate = parseDateArg(flag(args, "--since"));
  let untilDate = parseDateArg(flag(args, "--until"));

  if (!sinceDate && daysArg) {
    const d = parseInt(daysArg, 10);
    if (Number.isFinite(d) && d > 0) {
      sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - d);
      sinceDate.setHours(0, 0, 0, 0);
    }
  }

  if (!sinceDate) {
    // Default: last 7 days
    sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 7);
    sinceDate.setHours(0, 0, 0, 0);
  }
  if (!untilDate) untilDate = new Date();

  const metas = await listSessions({ limit: 10000 });
  const inRange = metas.filter((m) => {
    if (!m.firstTimestamp) return false;
    const t = new Date(m.firstTimestamp).getTime();
    return t >= sinceDate!.getTime() && t <= untilDate!.getTime();
  });

  const out: SessionCapsule[] = [];
  for (const m of inRange) {
    try {
      const d = await getSession(m.id);
      if (!d) continue;
      const cap = buildCapsule(d, { compact });
      if (cap.outcome === "trivial") continue;
      out.push(cap);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => (a.start_iso ?? "").localeCompare(b.start_iso ?? ""));

  if (json) {
    process.stdout.write(JSON.stringify(out, null, pretty ? 2 : 0));
    if (pretty) process.stdout.write("\n");
  } else {
    printSummary(out, sinceDate, untilDate);
  }
}

function printSummary(caps: SessionCapsule[], since: Date, until: Date): void {
  const since_s = since.toISOString().slice(0, 10);
  const until_s = until.toISOString().slice(0, 10);
  console.log(`Capsules from ${since_s} to ${until_s} · ${caps.length} substantive sessions`);
  console.log("");
  for (const c of caps) {
    const tag = c.outcome.padEnd(14);
    const flags = c.flags.length > 0 ? `  [${c.flags.join(",")}]` : "";
    const ship = c.pr_titles.length > 0 ? `  PR: ${c.pr_titles[0]}` : "";
    const proj = (c.project ?? "").replace("/Users/", "~/").slice(0, 40);
    const min = c.numbers.active_min.toFixed(1);
    console.log(`  ${c.start_iso?.slice(0, 16)}  ${tag}  ${min.padStart(6)}m  ${proj.padEnd(42)}${flags}${ship}`);
  }
}

function printHelp(): void {
  console.log(`fleetlens capsules — per-session insight capsules

Usage:
  fleetlens capsules [--since DATE] [--until DATE] [--days N] [--compact] [--json|--pretty]

Options:
  --since DATE    inclusive start (YYYYMMDD or YYYY-MM-DD). Default: 7 days ago.
  --until DATE    inclusive end. Default: now.
  --days N        alternative to --since (last N days).
  --compact       session-level only, omit per-turn detail (default: full).
  --json          structured JSON (default when piping).
  --pretty        pretty-printed JSON (with --json) or human-readable table (without).

Examples:
  fleetlens capsules --days 7 --compact --json | jq '.[] | .outcome' | sort | uniq -c
  fleetlens capsules --since 2026-04-14 --until 2026-04-20 --pretty
  fleetlens capsules --days 30 --compact > /tmp/month.json`);
}
