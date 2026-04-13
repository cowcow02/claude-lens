import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Read the Claude Code OAuth access token from the local credential store.
 * Returns null if the token cannot be found — caller should tell the user
 * to run `claude` to log in.
 *
 * macOS: reads from the login Keychain under service "Claude Code-credentials".
 * Linux/Windows: falls back to `~/.claude/.credentials.json` if it exists.
 *
 * The JSON shape (on both platforms) is:
 *   { "claudeAiOauth": { "accessToken": "...", ... } }
 */
export function readOAuthToken(): string | null {
  if (platform() === "darwin") {
    return readFromMacKeychain() ?? readFromCredentialsFile();
  }
  return readFromCredentialsFile();
}

function readFromMacKeychain(): string | null {
  try {
    const blob = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
    );
    return extractToken(blob);
  } catch {
    return null;
  }
}

function readFromCredentialsFile(): string | null {
  const candidates = [
    join(homedir(), ".claude", ".credentials.json"),
    join(homedir(), ".config", "claude", "credentials.json"),
  ];
  for (const path of candidates) {
    try {
      const blob = readFileSync(path, "utf8");
      const token = extractToken(blob);
      if (token) return token;
    } catch {
      // Try the next candidate
    }
  }
  return null;
}

function extractToken(blob: string): string | null {
  try {
    const parsed = JSON.parse(blob) as { claudeAiOauth?: { accessToken?: string } };
    return parsed.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
