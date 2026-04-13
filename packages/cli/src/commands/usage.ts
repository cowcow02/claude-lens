import { fetchUsage, UsageApiError } from "../usage/api.js";
import { formatUsage } from "../usage/format.js";
import { appendSnapshot } from "../usage/storage.js";
import { join } from "node:path";
import { homedir } from "node:os";

const USAGE_LOG = join(homedir(), ".cclens", "usage.jsonl");

export async function usage(args: string[]): Promise<void> {
  const save = args.includes("--save");

  try {
    const snapshot = await fetchUsage();
    if (save) appendSnapshot(USAGE_LOG, snapshot);
    process.stdout.write(formatUsage(snapshot));
  } catch (err) {
    if (err instanceof UsageApiError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
