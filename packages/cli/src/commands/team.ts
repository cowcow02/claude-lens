export async function team(args: string[]) {
  const sub = args[0];
  switch (sub) {
    case "join": {
      const { joinTeam } = await import("../team/join.js");
      await joinTeam(args.slice(1));
      break;
    }
    case "status": {
      const { teamStatus } = await import("../team/status.js");
      await teamStatus();
      break;
    }
    case "leave": {
      const { teamLeave } = await import("../team/leave.js");
      await teamLeave();
      break;
    }
    case "logs": {
      const { teamLogs } = await import("../team/logs.js");
      await teamLogs();
      break;
    }
    case "sync": {
      const { runTeamSync } = await import("../team/sync.js");
      const outcome = await runTeamSync((level, msg) => console.log(`[${level}] ${msg}`));
      if (!outcome.paired) {
        console.error("Not paired. Run 'fleetlens team join <url> <device-token>' first.");
        process.exit(1);
      }
      if (outcome.error) process.exit(1);
      console.log(
        `✓ ${outcome.pushed} day${outcome.pushed === 1 ? "" : "s"} pushed` +
        (outcome.queuedDrained ? `, ${outcome.queuedDrained} queued retried` : "") +
        (outcome.queued ? `, ${outcome.queued} queued for retry (will fire next cycle)` : "")
      );
      break;
    }
    default:
      console.log(`Usage: fleetlens team <join|status|leave|logs|sync>

  join <url> <device-token>    Pair daemon with a team server
  status                       Show team pairing state and sync info
  leave                        Unpair from the team server
  logs                         Show recent team-related daemon log entries
  sync                         Push any un-synced days now (skip 5-min wait)`);
  }
}
