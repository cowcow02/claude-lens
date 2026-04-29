import { writeTeamConfig } from "./config.js";
import { runTeamBackfill } from "./backfill.js";

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

  writeTeamConfig({
    serverUrl,
    memberId: data.membership.id,
    bearerToken,
    teamSlug: data.team.slug,
    pairedAt: new Date().toISOString(),
  });

  console.log(`Paired with "${data.team.name}" as ${data.user.displayName || data.user.email}`);
  console.log(`  role: ${data.membership.role}`);

  // Without this, the team dashboard sits at "insufficient_data" for a week
  // even though the local daemon already has weeks of history. Failures here
  // are non-fatal — the daily-rollup sync still runs at the next 5-min tick.
  const backfill = await runTeamBackfill();
  if (backfill.insertedSnapshots > 0) {
    console.log(
      `  Backfilled ${backfill.insertedSnapshots} usage snapshot${backfill.insertedSnapshots === 1 ? "" : "s"} from local history.`,
    );
  } else if (backfill.error) {
    console.log(`  Note: usage backfill skipped (${backfill.error}). Run 'fleetlens team backfill' to retry.`);
  }
  console.log("  Your daemon will push metrics on the next 5-minute cycle.");
}
