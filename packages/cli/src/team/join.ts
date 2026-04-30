import { writeTeamConfig, type TeamConfig } from "./config.js";
import { runTeamBackfill } from "./backfill.js";
import { runTeamSync } from "./sync.js";

export async function joinTeam(args: string[]) {
  const [serverUrl, bearerToken] = args;
  if (!serverUrl || !bearerToken) {
    console.error("Usage: fleetlens team join <server-url> <device-token>");
    console.error("");
    console.error("Get the device token from the dashboard after signup,");
    console.error("or from Settings → My device token.");
    process.exit(1);
  }

  const res = await fetch(`${serverUrl}/api/team/whoami`, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!res.ok) {
    console.error(`Pairing failed: ${res.status} ${res.statusText}`);
    console.error("The device token may be revoked or the server URL wrong.");
    process.exit(1);
  }

  const data = (await res.json()) as {
    membership: { id: string; role: string };
    team: { id: string; slug: string; name: string };
    user: { email: string; displayName: string | null };
  };

  const config: TeamConfig = {
    serverUrl,
    memberId: data.membership.id,
    bearerToken,
    teamSlug: data.team.slug,
    pairedAt: new Date().toISOString(),
  };
  writeTeamConfig(config);

  console.log(`Paired with "${data.team.name}" as ${data.user.displayName || data.user.email}`);
  console.log(`  role: ${data.membership.role}`);

  // Two backfills run here so the team dashboard is fully populated on
  // first visit: the snapshot backfill rescues the plan-utilization
  // sparkline + optimizer (which would otherwise sit at "insufficient_data"
  // for a week), and the daily-rollup sync fills the activity charts that
  // would otherwise show "No activity" until the daemon's next 5-min tick.
  // Both are non-fatal — failures fall back to the daemon's normal cycle.
  // Threading `config` directly avoids a stale-disk-read race during the
  // first paired moment.
  // ALWAYS print outcome — even on zero. A silent run-and-no-message
  // is the worst UX: the user can't tell whether backfill ran, partially
  // ran, or didn't fire at all. Each branch prints exactly one line.
  console.log("  Pushing local history…");
  const backfill = await runTeamBackfill(undefined, undefined, config);
  if (backfill.error) {
    console.log(`  ⚠ Backfill failed: ${backfill.error} — run 'fleetlens team backfill' to retry.`);
  } else if (backfill.insertedSnapshots > 0) {
    console.log(
      `  ✓ Backfilled ${backfill.insertedSnapshots} usage snapshot${backfill.insertedSnapshots === 1 ? "" : "s"} from local history.`,
    );
  } else if (backfill.sentSnapshots > 0) {
    console.log(`  ✓ ${backfill.sentSnapshots} snapshots already on server (deduped on capture time).`);
  } else {
    console.log("  · No local usage snapshots yet — daemon will start collecting.");
  }

  const sync = await runTeamSync(undefined, config);
  if (sync.error) {
    console.log(`  ⚠ Activity sync failed: ${sync.error} — will retry on next daemon cycle.`);
  } else if (sync.pushed > 0) {
    console.log(`  ✓ Synced ${sync.pushed} day${sync.pushed === 1 ? "" : "s"} of session activity.`);
  } else {
    console.log("  · No new session activity to push.");
  }
  console.log("  Daemon polls every 5 minutes — next push happens automatically.");
}
