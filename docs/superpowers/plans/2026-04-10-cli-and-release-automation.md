# Claude Lens CLI & Release Automation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a globally-installable `claude-lens` npm CLI that manages the dashboard server lifecycle, provides ccusage-style token stats, auto-updates on start, and is released via tag-driven GitHub Actions.

**Architecture:** pnpm monorepo gains `packages/cli/` — an esbuild-bundled CLI that embeds `@claude-lens/parser` and ships alongside a pre-built Next.js standalone app. The CLI is the only published package; the parser and web app remain workspace-internal.

**Tech Stack:** TypeScript, esbuild (CLI bundler), Next.js standalone output, GitHub Actions, npm registry.

**Spec:** `docs/superpowers/specs/2026-04-10-cli-and-release-automation-design.md`

---

## Chunk 1: Foundation — Package Scaffolding & PID Management

### File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `package.json` | Rename to `claude-lens-workspace`, add `version` lifecycle script |
| Modify | `pnpm-workspace.yaml` | Already includes `packages/*` — no change needed |
| Modify | `turbo.json` | Add CLI build/dev tasks |
| Create | `packages/cli/package.json` | npm package metadata, bin entry, esbuild scripts |
| Create | `packages/cli/tsconfig.json` | TypeScript config extending base |
| Create | `packages/cli/src/index.ts` | Entry point — hashbang, command router |
| Create | `packages/cli/src/pid.ts` | PID file read/write/check/cleanup |
| Create | `packages/cli/src/pid.test.ts` | PID tests |
| Create | `scripts/version-sync.mjs` | Version sync across all packages |

### Task 1: Rename root package + add version sync script

**Files:**
- Modify: `package.json`
- Create: `scripts/version-sync.mjs`

- [ ] **Step 1: Rename root package**

In `package.json`, change `"name": "claude-lens"` to `"name": "claude-lens-workspace"`. Add the `version` lifecycle script:

```json
"scripts": {
  "version": "node scripts/version-sync.mjs && git add packages/*/package.json apps/*/package.json",
  ...existing scripts...
}
```

- [ ] **Step 2: Create version-sync.mjs**

```js
// scripts/version-sync.mjs
// Reads version from root package.json, writes it to all sub-packages.
// Called by npm's `version` lifecycle hook (after bump, before commit).

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = rootPkg.version;

const targets = [
  "packages/cli/package.json",
  "packages/parser/package.json",
  "apps/web/package.json",
];

for (const rel of targets) {
  const abs = join(root, rel);
  try {
    const pkg = JSON.parse(readFileSync(abs, "utf8"));
    pkg.version = version;
    writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  synced ${rel} → ${version}`);
  } catch {
    // Package may not exist yet (e.g., cli not scaffolded yet)
  }
}
```

- [ ] **Step 3: Verify version sync works**

Run: `node scripts/version-sync.mjs`
Expected: prints synced messages for parser and web (cli may not exist yet)

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/version-sync.mjs
git commit -m "chore: rename root package + add version sync script"
```

### Task 2: Scaffold packages/cli

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Modify: `turbo.json`

- [ ] **Step 1: Create packages/cli/package.json**

```json
{
  "name": "claude-lens",
  "version": "0.1.0",
  "description": "CLI for Claude Lens — local dashboard for Claude Code sessions",
  "license": "MIT",
  "type": "module",
  "bin": {
    "claude-lens": "./dist/index.js"
  },
  "files": [
    "dist",
    "app"
  ],
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js --banner:js='#!/usr/bin/env node' --external:fsevents",
    "dev": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js --banner:js='#!/usr/bin/env node' --external:fsevents --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {},
  "devDependencies": {
    "@claude-lens/parser": "workspace:*",
    "@types/node": "^20.11.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create packages/cli/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Create packages/cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src"],
  "references": [
    { "path": "../parser" }
  ]
}
```

- [ ] **Step 3: Create minimal packages/cli/src/index.ts**

```ts
#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0] ?? "help";

switch (command) {
  case "version":
  case "--version":
  case "-v":
    // Will read from package.json at build time via esbuild define
    console.log("claude-lens 0.1.0");
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(`Usage: claude-lens <command>

Commands:
  start          Start the dashboard server
  stop           Stop the dashboard server
  update         Update to the latest version
  stats          Show token usage statistics
  version        Print version`);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
```

- [ ] **Step 4: Update turbo.json — no changes needed**

The existing `build`, `dev`, `typecheck`, `test`, and `clean` task definitions already apply to all workspace packages. No turbo.json changes required since `packages/cli` will pick up the existing task configs.

- [ ] **Step 5: Create .gitignore for CLI package**

Create `packages/cli/.gitignore`:
```
dist/
app/
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`
Expected: installs esbuild and vitest in packages/cli

- [ ] **Step 7: Build and test the CLI**

Run: `pnpm -F claude-lens build && node packages/cli/dist/index.js version`
Expected: prints `claude-lens 0.1.0`

Run: `node packages/cli/dist/index.js help`
Expected: prints usage info

- [ ] **Step 8: Commit**

```bash
git add packages/cli/ pnpm-lock.yaml
git commit -m "feat: scaffold packages/cli with esbuild build"
```

### Task 3: PID file management

**Files:**
- Create: `packages/cli/src/pid.ts`
- Create: `packages/cli/src/pid.test.ts`

- [ ] **Step 1: Write PID tests**

```ts
// packages/cli/src/pid.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePid, readPid, isProcessAlive, cleanStalePid } from "./pid.js";

describe("pid", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "claude-lens-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a PID file", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345, 3321);
    expect(readPid(pidFile)).toEqual({ pid: 12345, port: 3321 });
  });

  it("writes and reads a PID file without port", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345);
    expect(readPid(pidFile)).toEqual({ pid: 12345, port: undefined });
  });

  it("returns null for missing PID file", () => {
    expect(readPid(join(dir, "nope"))).toBeNull();
  });

  it("detects current process as alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("detects non-existent PID as dead", () => {
    expect(isProcessAlive(999999)).toBe(false);
  });

  it("cleans stale PID file when process is dead", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 999999, 3321);
    const result = cleanStalePid(pidFile);
    expect(result).toBe(true); // was stale, cleaned
    expect(readPid(pidFile)).toBeNull();
  });

  it("does not clean PID file when process is alive", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, process.pid, 3321);
    const result = cleanStalePid(pidFile);
    expect(result).toBe(false); // not stale
    expect(readPid(pidFile)).toEqual({ pid: process.pid, port: 3321 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F claude-lens test`
Expected: FAIL — module `./pid.js` not found

- [ ] **Step 3: Implement pid.ts**

```ts
// packages/cli/src/pid.ts
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export function writePid(filePath: string, pid: number, port?: number): void {
  mkdirSync(dirname(filePath), { recursive: true });
  // Format: "pid:port" (port optional for backwards compat)
  const content = port != null ? `${pid}:${port}` : String(pid);
  writeFileSync(filePath, content, "utf8");
}

export function readPid(filePath: string): { pid: number; port?: number } | null {
  try {
    const content = readFileSync(filePath, "utf8").trim();
    const [pidStr, portStr] = content.split(":");
    const pid = parseInt(pidStr, 10);
    if (Number.isNaN(pid)) return null;
    const port = portStr ? parseInt(portStr, 10) : undefined;
    return { pid, port: Number.isNaN(port!) ? undefined : port };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

/**
 * If the PID file exists but the process is dead, remove the PID file.
 * Returns true if stale PID was cleaned, false otherwise.
 */
export function cleanStalePid(filePath: string): boolean {
  const entry = readPid(filePath);
  if (entry === null) return false;
  if (isProcessAlive(entry.pid)) return false;
  try {
    unlinkSync(filePath);
  } catch {
    // Already gone
  }
  return true;
}

export function removePid(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Already gone
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F claude-lens test`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pid.ts packages/cli/src/pid.test.ts
git commit -m "feat(cli): add PID file management with tests"
```

---

## Chunk 2: Server Management — Start & Stop Commands

### File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `packages/cli/src/server.ts` | Spawn/stop Next.js standalone server |
| Create | `packages/cli/src/commands/start.ts` | `claude-lens start` command |
| Create | `packages/cli/src/commands/stop.ts` | `claude-lens stop` command |
| Modify | `packages/cli/src/index.ts` | Wire up start/stop commands |
| Modify | `apps/web/next.config.ts` | Add `output: 'standalone'` |
| Modify | `apps/web/lib/data.ts` | Read `CLAUDE_LENS_DATA_DIR` env var |

### Task 4: Enable Next.js standalone output + env var for data dir

**Files:**
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/lib/data.ts`

- [ ] **Step 1: Add output: 'standalone' to next.config.ts**

In `apps/web/next.config.ts`, add `output: "standalone"` to the config:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@claude-lens/parser"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};
```

- [ ] **Step 2: Update data.ts to use CLAUDE_LENS_DATA_DIR**

In `apps/web/lib/data.ts`, pass the env var to the parser:

```ts
import "server-only";
import { cache } from "react";
import { listSessions as rawListSessions, getSession as rawGetSession } from "@claude-lens/parser/fs";

const dataRoot = process.env.CLAUDE_LENS_DATA_DIR || undefined;

export const listSessions = cache(async () => {
  return rawListSessions({ limit: 1000, root: dataRoot });
});

export const getSession = cache(async (id: string) => {
  return rawGetSession(id, { root: dataRoot });
});
```

- [ ] **Step 3: Verify build still works**

Run: `pnpm build`
Expected: parser builds, then web builds with standalone output. Check that `apps/web/.next/standalone/` directory exists.

- [ ] **Step 4: Commit**

```bash
git add apps/web/next.config.ts apps/web/lib/data.ts
git commit -m "feat(web): enable standalone output + CLAUDE_LENS_DATA_DIR env"
```

### Task 5: Server management module

**Files:**
- Create: `packages/cli/src/server.ts`

- [ ] **Step 1: Implement server.ts**

```ts
// packages/cli/src/server.ts
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { writePid, readPid, isProcessAlive, cleanStalePid, removePid } from "./pid.js";
import { homedir } from "node:os";

const STATE_DIR = join(homedir(), ".claude-lens");
const PID_FILE = join(STATE_DIR, "pid");
const DEFAULT_PORT = 3321;

/** Resolve path to the bundled Next.js standalone server.js */
function appDir(): string {
  // In the published package: packages/cli/app/server.js
  // __dirname equivalent for ESM:
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "app");
}

export type ServerStatus =
  | { running: true; pid: number; port: number }
  | { running: false };

export function getServerStatus(): ServerStatus {
  cleanStalePid(PID_FILE);
  const entry = readPid(PID_FILE);
  if (entry !== null && isProcessAlive(entry.pid)) {
    return { running: true, pid: entry.pid, port: entry.port ?? DEFAULT_PORT };
  }
  return { running: false };
}

export async function startServer(opts: { port?: number } = {}): Promise<{ pid: number; port: number }> {
  const port = opts.port ?? parseInt(process.env.CLAUDE_LENS_PORT ?? "", 10) || DEFAULT_PORT;
  const serverJs = join(appDir(), "server.js");

  if (!existsSync(serverJs)) {
    throw new Error(`Server not found at ${serverJs}. Reinstall with: npm install -g claude-lens`);
  }

  // Check if port is in use
  const portInUse = await checkPort(port);
  if (portInUse) {
    throw new Error(`Port ${port} is in use. Use --port to specify a different port.`);
  }

  const dataDir = join(homedir(), ".claude", "projects");

  const child = spawn(process.execPath, [serverJs], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "localhost",
      CLAUDE_LENS_DATA_DIR: dataDir,
    },
    cwd: appDir(),
  });

  child.unref();
  const pid = child.pid!;
  writePid(PID_FILE, pid, port);

  // Wait for server to be healthy
  await waitForHealth(`http://localhost:${port}`, 10_000);

  return { pid, port };
}

export function stopServer(): { stopped: boolean; pid?: number } {
  cleanStalePid(PID_FILE);
  const entry = readPid(PID_FILE);
  if (entry === null) {
    return { stopped: false };
  }

  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    // Process already gone
  }
  removePid(PID_FILE);
  return { stopped: true, pid: entry.pid };
}

async function checkPort(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "localhost");
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs / 1000}s`);
}

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/server.ts
git commit -m "feat(cli): add server management module"
```

### Task 6: Start command

**Files:**
- Create: `packages/cli/src/commands/start.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Implement start.ts**

```ts
// packages/cli/src/commands/start.ts
import { getServerStatus, startServer, openBrowser } from "../server.js";
import { checkForUpdate } from "../updater.js";

export async function start(args: string[]): Promise<void> {
  const portFlag = args.indexOf("--port");
  const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : undefined;

  // Auto-update check (will be implemented in Task 8)
  try {
    await checkForUpdate();
  } catch {
    // Silently skip if updater not ready yet
  }

  // Check if already running
  const status = getServerStatus();
  if (status.running) {
    console.log(`Claude Lens is already running on http://localhost:${status.port} (PID ${status.pid})`);
    openBrowser(`http://localhost:${status.port}`);
    return;
  }

  console.log("Starting Claude Lens...");

  try {
    const result = await startServer({ port });
    console.log(`Claude Lens running on http://localhost:${result.port} (PID ${result.pid})`);
    openBrowser(`http://localhost:${result.port}`);
  } catch (err) {
    console.error(`Failed to start: ${(err as Error).message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Implement stop.ts**

```ts
// packages/cli/src/commands/stop.ts
import { stopServer, getServerStatus } from "../server.js";

export async function stop(): Promise<void> {
  const status = getServerStatus();
  if (!status.running) {
    console.log("Claude Lens is not running.");
    return;
  }

  const result = stopServer();
  if (result.stopped) {
    console.log(`Stopped Claude Lens (PID ${result.pid})`);
  }
}
```

- [ ] **Step 3: Update index.ts to wire up commands**

```ts
#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main() {
  switch (command) {
    case "start": {
      const { start } = await import("./commands/start.js");
      await start(args.slice(1));
      break;
    }
    case "stop": {
      const { stop } = await import("./commands/stop.js");
      await stop();
      break;
    }
    case "update": {
      const { update } = await import("./commands/update.js");
      await update();
      break;
    }
    case "stats": {
      const { stats } = await import("./commands/stats.js");
      await stats(args.slice(1));
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(`claude-lens 0.1.0`);
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`Usage: claude-lens <command>

Commands:
  start [--port N]            Start the dashboard server
  stop                        Stop the dashboard server
  update                      Update to the latest version
  stats [--live] [-s D] [--days N]  Show token usage statistics
  version                     Print version`);
      break;
    default:
      console.error(`Unknown command: ${command}\nRun 'claude-lens help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 4: Create stub files for update and stats commands**

Create `packages/cli/src/commands/update.ts`:
```ts
export async function update(): Promise<void> {
  console.log("Update command not yet implemented.");
}
```

Create `packages/cli/src/commands/stats.ts`:
```ts
export async function stats(_args: string[]): Promise<void> {
  console.log("Stats command not yet implemented.");
}
```

Create `packages/cli/src/updater.ts`:
```ts
export async function checkForUpdate(): Promise<void> {
  // Will be implemented in Task 8
}
```

- [ ] **Step 5: Build and test CLI locally**

Run: `pnpm -F claude-lens build && node packages/cli/dist/index.js help`
Expected: prints usage info with all commands listed

Run: `node packages/cli/dist/index.js stop`
Expected: prints "Claude Lens is not running."

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): add start/stop commands with server management"
```

---

## Chunk 3: Auto-Update & Version Command

### File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `packages/cli/src/updater.ts` | Full implementation |
| Create | `packages/cli/src/updater.test.ts` | Tests for version comparison |
| Modify | `packages/cli/src/commands/update.ts` | Full implementation |
| Modify | `packages/cli/src/index.ts` | Inject version from package.json at build time |
| Modify | `packages/cli/package.json` | Add esbuild --define for version |

### Task 7: Version injection via esbuild

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Update esbuild command to inject version**

In `packages/cli/package.json`, update the build script to read version and define it:

```json
"build": "node -e \"const v=require('./package.json').version; const args='src/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/index.js --external:fsevents'.split(' '); args.push('--define:CLI_VERSION=\\\"'+v+'\\\"', '--banner:js=#!/usr/bin/env node'); require('esbuild').buildSync({entryPoints:['src/index.ts'],bundle:true,platform:'node',target:'node20',format:'esm',outfile:'dist/index.js',external:['fsevents'],banner:{js:'#!/usr/bin/env node'},define:{CLI_VERSION:'\\\"'+v+'\\\"'}})\" ",
```

Actually, simpler approach — create a tiny build script:

Create `packages/cli/build.mjs`:
```js
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

buildSync({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  external: ["fsevents"],
  banner: { js: "#!/usr/bin/env node" },
  define: {
    CLI_VERSION: JSON.stringify(pkg.version),
  },
});
```

Update `packages/cli/package.json` scripts:
```json
"build": "node build.mjs",
"dev": "node build.mjs --watch",
```

Note: For `--watch` to work, `build.mjs` needs to check `process.argv` and use esbuild's `context` + `watch()` API instead of `buildSync`. Add this to the bottom of `build.mjs`:

```js
// build.mjs — replace buildSync with:
import { build, context } from "esbuild";

const opts = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  external: ["fsevents"],
  banner: { js: "#!/usr/bin/env node" },
  define: { CLI_VERSION: JSON.stringify(pkg.version) },
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await build(opts);
}
```

- [ ] **Step 2: Use CLI_VERSION in index.ts**

Replace the hardcoded version in `packages/cli/src/index.ts`:

```ts
declare const CLI_VERSION: string;
```

And in the version case:
```ts
case "version":
case "--version":
case "-v":
  console.log(`claude-lens ${CLI_VERSION}`);
  break;
```

- [ ] **Step 3: Build and test**

Run: `pnpm -F claude-lens build && node packages/cli/dist/index.js version`
Expected: `claude-lens 0.1.0`

- [ ] **Step 4: Commit**

```bash
git add packages/cli/build.mjs packages/cli/package.json packages/cli/src/index.ts
git commit -m "feat(cli): inject version via esbuild define"
```

### Task 8: Auto-updater

**Files:**
- Modify: `packages/cli/src/updater.ts`
- Create: `packages/cli/src/updater.test.ts`
- Modify: `packages/cli/src/commands/update.ts`

- [ ] **Step 1: Write updater tests**

```ts
// packages/cli/src/updater.test.ts
import { describe, it, expect } from "vitest";
import { shouldUpdate } from "./updater.js";

describe("shouldUpdate", () => {
  it("returns true when remote is newer", () => {
    expect(shouldUpdate("0.1.0", "0.2.0")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(shouldUpdate("0.2.0", "0.2.0")).toBe(false);
  });

  it("returns false when local is newer", () => {
    expect(shouldUpdate("0.3.0", "0.2.0")).toBe(false);
  });

  it("handles patch versions", () => {
    expect(shouldUpdate("0.1.0", "0.1.1")).toBe(true);
    expect(shouldUpdate("0.1.1", "0.1.0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F claude-lens test`
Expected: FAIL — `shouldUpdate` not exported from `./updater.js`

- [ ] **Step 3: Implement updater.ts**

```ts
// packages/cli/src/updater.ts
import { execSync, spawnSync } from "node:child_process";

declare const CLI_VERSION: string;

const PACKAGE_NAME = "claude-lens";
const CHECK_TIMEOUT_MS = 3_000;

/** Simple semver comparison. Returns true if remote > local. */
export function shouldUpdate(local: string, remote: string): boolean {
  const l = local.split(".").map(Number);
  const r = remote.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/** Fetch latest version from npm registry. Returns null on failure. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** Run npm install -g to update. Returns true on success. */
function runNpmInstall(): boolean {
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      stdio: "pipe",
      timeout: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Re-exec the CLI with the same arguments (after update). */
function reExec(): never {
  // process.argv[0] = node, process.argv[1] = script path, rest = args
  const result = spawnSync(process.argv[0], process.argv.slice(1), { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

/**
 * Check for updates and auto-apply if a newer version exists.
 * Called at the start of `claude-lens start`.
 */
export async function checkForUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (latest === null) return; // offline or error

  const current = CLI_VERSION;
  if (!shouldUpdate(current, latest)) return;

  console.log(`Updating claude-lens ${current} → ${latest}...`);
  const ok = runNpmInstall();
  if (ok) {
    console.log("Updated successfully. Restarting...");
    reExec();
  } else {
    console.warn("Update failed. Starting with current version.");
  }
}

/**
 * Force update — always attempts install regardless of version.
 */
export async function forceUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  const current = CLI_VERSION;

  if (latest === null) {
    console.error("Could not reach npm registry. Check your network.");
    process.exit(1);
  }

  if (shouldUpdate(current, latest)) {
    console.log(`Updating claude-lens ${current} → ${latest}...`);
  } else {
    console.log(`Already on latest (${current}). Reinstalling...`);
  }

  // Always attempt install (useful if installation is corrupted)
  const ok = runNpmInstall();
  if (ok) {
    console.log(shouldUpdate(current, latest) ? `Updated to ${latest}.` : "Reinstall complete.");
  } else {
    console.error("Update failed.");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Implement update command**

```ts
// packages/cli/src/commands/update.ts
import { forceUpdate } from "../updater.js";

export async function update(): Promise<void> {
  await forceUpdate();
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F claude-lens test`
Expected: all tests pass (pid tests + updater tests)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/updater.ts packages/cli/src/updater.test.ts packages/cli/src/commands/update.ts
git commit -m "feat(cli): add auto-update with version check on start"
```

---

## Chunk 4: Stats Command — Token Usage Table

### File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `packages/cli/src/pricing.ts` | Model pricing table |
| Create | `packages/cli/src/pricing.test.ts` | Pricing lookup tests |
| Create | `packages/cli/src/table.ts` | Terminal table formatter |
| Modify | `packages/cli/src/commands/stats.ts` | Full stats implementation |

### Task 9: Pricing table

**Files:**
- Create: `packages/cli/src/pricing.ts`
- Create: `packages/cli/src/pricing.test.ts`

- [ ] **Step 1: Write pricing tests**

```ts
// packages/cli/src/pricing.test.ts
import { describe, it, expect } from "vitest";
import { estimateCost } from "./pricing.js";
import type { Usage } from "@claude-lens/parser";

describe("estimateCost", () => {
  it("calculates cost for known model", () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 300 };
    const cost = estimateCost("claude-sonnet-4-20250514", usage);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("returns null for unknown model", () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    const cost = estimateCost("unknown-model-123", usage);
    expect(cost).toBeNull();
  });

  it("matches prefix for model variants", () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    // Both should resolve to the same pricing
    const a = estimateCost("claude-sonnet-4-20250514", usage);
    const b = estimateCost("claude-sonnet-4-6-20260101", usage);
    // Both should be non-null (known model family)
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F claude-lens test`
Expected: FAIL

- [ ] **Step 3: Implement pricing.ts**

```ts
// packages/cli/src/pricing.ts
// Per-million-token pricing. Source: https://docs.anthropic.com/en/docs/about-claude/models
// Updated: 2026-04-10

import type { Usage } from "@claude-lens/parser";

type ModelPricing = {
  input: number;    // $ per 1M tokens
  output: number;   // $ per 1M tokens
  cacheRead: number;
  cacheWrite: number;
};

// Prefix → pricing. Checked in order; first match wins.
const PRICING: [prefix: string, pricing: ModelPricing][] = [
  ["claude-opus-4", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["claude-sonnet-4", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["claude-haiku-4", { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  ["claude-3-5-sonnet", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["claude-3-5-haiku", { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }],
  ["claude-3-opus", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
];

function findPricing(model: string): ModelPricing | null {
  for (const [prefix, pricing] of PRICING) {
    if (model.startsWith(prefix)) return pricing;
  }
  return null;
}

/**
 * Estimate cost in USD for a given model + usage.
 * Returns null if model is unrecognized.
 */
export function estimateCost(model: string, usage: Usage): number | null {
  const p = findPricing(model);
  if (!p) return null;

  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F claude-lens test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/pricing.ts packages/cli/src/pricing.test.ts
git commit -m "feat(cli): add model pricing table for cost estimation"
```

### Task 10: Terminal table formatter

**Files:**
- Create: `packages/cli/src/table.ts`

- [ ] **Step 1: Implement table.ts**

```ts
// packages/cli/src/table.ts
// Renders a fixed-width terminal table for token usage stats.

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export type TableRow = {
  date: string;
  models: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  totalTokens: number;
  cost: number | null; // null = unknown model
};

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(cost: number | null): string {
  if (cost === null) return "—";
  return `$${cost.toFixed(2)}`;
}

function pad(s: string, width: number, align: "left" | "right" = "right"): string {
  if (align === "left") return s.padEnd(width);
  return s.padStart(width);
}

export function renderTable(rows: TableRow[], title: string): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(`${BOLD}${title}${RESET}`);
  lines.push("");

  // Header
  const header = [
    pad("Date", 12, "left"),
    pad("Models", 20, "left"),
    pad("Input", 12),
    pad("Output", 12),
    pad("Cache Create", 14),
    pad("Cache Read", 14),
    pad("Total", 14),
    pad("Cost (USD)", 12),
  ].join("  ");

  lines.push(`${DIM}${header}${RESET}`);
  lines.push(`${DIM}${"─".repeat(header.length)}${RESET}`);

  // Data rows
  let hasUnknownCost = false;
  for (const r of rows) {
    if (r.cost === null) hasUnknownCost = true;
    lines.push([
      pad(r.date, 12, "left"),
      pad(r.models, 20, "left"),
      pad(fmtNum(r.input), 12),
      pad(fmtNum(r.output), 12),
      pad(fmtNum(r.cacheCreate), 14),
      pad(fmtNum(r.cacheRead), 14),
      pad(fmtNum(r.totalTokens), 14),
      pad(fmtCost(r.cost), 12),
    ].join("  "));
  }

  // Total row
  const totals = rows.reduce(
    (acc, r) => ({
      input: acc.input + r.input,
      output: acc.output + r.output,
      cacheCreate: acc.cacheCreate + r.cacheCreate,
      cacheRead: acc.cacheRead + r.cacheRead,
      totalTokens: acc.totalTokens + r.totalTokens,
      cost: r.cost !== null && acc.cost !== null ? acc.cost + r.cost : acc.cost,
    }),
    { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, totalTokens: 0, cost: 0 as number | null },
  );

  lines.push(`${DIM}${"─".repeat(header.length)}${RESET}`);
  lines.push(
    `${BOLD}${[
      pad("Total", 12, "left"),
      pad("", 20, "left"),
      pad(fmtNum(totals.input), 12),
      pad(fmtNum(totals.output), 12),
      pad(fmtNum(totals.cacheCreate), 14),
      pad(fmtNum(totals.cacheRead), 14),
      pad(fmtNum(totals.totalTokens), 14),
      pad(fmtCost(totals.cost), 12),
    ].join("  ")}${RESET}`,
  );

  if (hasUnknownCost) {
    lines.push("");
    lines.push(`${DIM}  Note: some models had unknown pricing (shown as —)${RESET}`);
  }

  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/table.ts
git commit -m "feat(cli): add terminal table renderer for stats"
```

### Task 11: Stats command implementation

**Files:**
- Modify: `packages/cli/src/commands/stats.ts`

- [ ] **Step 1: Implement stats.ts**

```ts
// packages/cli/src/commands/stats.ts
import { listSessions } from "@claude-lens/parser/fs";
import type { SessionMeta, Usage } from "@claude-lens/parser";
import { estimateCost } from "../pricing.js";
import { renderTable, type TableRow } from "../table.js";
import { getServerStatus } from "../server.js";

declare const CLI_VERSION: string;

export async function stats(args: string[]): Promise<void> {
  const live = args.includes("--live");
  const sinceIdx = args.indexOf("-s");
  const daysIdx = args.indexOf("--days");

  let sinceDate: Date | null = null;
  if (sinceIdx !== -1 && args[sinceIdx + 1]) {
    const raw = args[sinceIdx + 1];
    sinceDate = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  } else if (daysIdx !== -1 && args[daysIdx + 1]) {
    const days = parseInt(args[daysIdx + 1], 10);
    sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    sinceDate.setHours(0, 0, 0, 0);
  }

  if (live) {
    await liveStats(sinceDate);
  } else {
    await printStats(sinceDate);
  }
}

async function printStats(sinceDate: Date | null): Promise<void> {
  const sessions = await listSessions({ limit: 10000 });

  const filtered = sinceDate
    ? sessions.filter((s) => s.firstTimestamp && new Date(s.firstTimestamp) >= sinceDate!)
    : sessions;

  const rows = aggregateByDay(filtered);
  const output = renderTable(rows, "Claude Code Token Usage Report — Daily");

  // Footer: session count + server status
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = filtered.filter((s) => s.firstTimestamp?.startsWith(today)).length;
  const status = getServerStatus();
  const serverLine = status.running
    ? `Server running on http://localhost:${status.port}`
    : "Server not running";

  console.log(output);
  console.log(`  ${todaySessions} sessions today · ${serverLine}`);
  console.log("");
}

function aggregateByDay(sessions: SessionMeta[]): TableRow[] {
  const byDay = new Map<string, { sessions: SessionMeta[]; models: Set<string> }>();

  for (const s of sessions) {
    const day = s.firstTimestamp?.slice(0, 10) ?? "unknown";
    if (!byDay.has(day)) byDay.set(day, { sessions: [], models: new Set() });
    const bucket = byDay.get(day)!;
    bucket.sessions.push(s);
    if (s.model) bucket.models.add(s.model.replace(/-\d{8}$/, ""));
  }

  // Sort by date descending
  const sorted = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return sorted.map(([date, { sessions, models }]) => {
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost: number | null = 0;

    for (const s of sessions) {
      usage.input += s.totalUsage.input;
      usage.output += s.totalUsage.output;
      usage.cacheRead += s.totalUsage.cacheRead;
      usage.cacheWrite += s.totalUsage.cacheWrite;

      if (s.model) {
        const c = estimateCost(s.model, s.totalUsage);
        if (c !== null && cost !== null) cost += c;
        else cost = null;
      }
    }

    // Shorten model names: "claude-opus-4-6" → "opus-4"
    const modelNames = [...models].map((m) => m.replace("claude-", "").replace(/-\d+$/, "")).join(", ");

    return {
      date,
      models: modelNames || "—",
      input: usage.input,
      output: usage.output,
      cacheCreate: usage.cacheWrite,
      cacheRead: usage.cacheRead,
      totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
      cost,
    };
  });
}

async function liveStats(sinceDate: Date | null): Promise<void> {
  // Enable raw mode to capture 'q' keypress
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (data) => {
      if (data.toString() === "q" || data.toString() === "\x03") {
        // Clear screen artifacts and exit
        process.stdout.write("\x1b[?25h"); // show cursor
        process.exit(0);
      }
    });
  }

  const refresh = async () => {
    const sessions = await listSessions({ limit: 10000 });
    const filtered = sinceDate
      ? sessions.filter((s) => s.firstTimestamp && new Date(s.firstTimestamp) >= sinceDate!)
      : sessions;

    const rows = aggregateByDay(filtered);
    const output = renderTable(rows, `Claude Code Token Usage Report — Live (q to quit)`);

    // Clear screen and render
    process.stdout.write("\x1b[2J\x1b[H"); // clear + home
    process.stdout.write("\x1b[?25l"); // hide cursor
    process.stdout.write(output);

    // Active sessions
    const running = filtered.filter((s) => s.status === "running");
    if (running.length > 0) {
      process.stdout.write("  Active Sessions\n");
      for (const s of running.slice(0, 5)) {
        const project = s.projectName.split("/").slice(-2).join("/");
        const tokens = s.totalUsage.input + s.totalUsage.output;
        process.stdout.write(`    ${project.padEnd(30)} ${tokens.toLocaleString()} tokens\n`);
      }
      process.stdout.write("\n");
    }
  };

  await refresh();
  setInterval(refresh, 2000);
}
```

- [ ] **Step 2: Build and test**

Run: `pnpm -F claude-lens build && node packages/cli/dist/index.js stats`
Expected: prints token usage table (may be empty if no sessions)

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/stats.ts packages/cli/src/table.ts
git commit -m "feat(cli): implement stats command with daily token table"
```

---

## Chunk 5: GitHub Actions & CLAUDE.md

### File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `.github/workflows/release.yml` | Tag-driven release automation |
| Create | `CLAUDE.md` | Project guide for agents + release process |
| Create | `scripts/prepare-cli.mjs` | CI script: copy standalone output into packages/cli/app/ |

### Task 12: CI release workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/prepare-cli.mjs`

- [ ] **Step 1: Create prepare-cli.mjs**

This script runs in CI after building. It copies the Next.js standalone output into the CLI package so npm publish includes it.

```js
// scripts/prepare-cli.mjs
// Copies Next.js standalone output + static assets into packages/cli/app/
// so that `npm publish` in packages/cli/ includes the full server.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, "apps", "web");
const cliApp = join(root, "packages", "cli", "app");

// Clean previous
rmSync(cliApp, { recursive: true, force: true });

// 1. Copy standalone output (includes server.js + minimal node_modules)
const standalone = join(webDir, ".next", "standalone");
cpSync(standalone, cliApp, { recursive: true });

// 2. Copy static assets (standalone omits these)
const staticSrc = join(webDir, ".next", "static");
const staticDest = join(cliApp, "apps", "web", ".next", "static");
mkdirSync(staticDest, { recursive: true });
cpSync(staticSrc, staticDest, { recursive: true });

// 3. Copy public/ if it exists
const publicSrc = join(webDir, "public");
const publicDest = join(cliApp, "apps", "web", "public");
try {
  cpSync(publicSrc, publicDest, { recursive: true });
} catch {
  // No public dir — that's fine
}

console.log("✓ Prepared packages/cli/app/ for publish");
```

Note: Next.js standalone output preserves the monorepo directory structure inside `.next/standalone/`. The server.js entry point will be at `app/apps/web/server.js` (reflecting the original `apps/web` location). The `server.ts` module in the CLI needs to account for this path. Update the `appDir()` function in `packages/cli/src/server.ts` accordingly:

```ts
function appDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "app", "apps", "web");
}
```

- [ ] **Step 2: Create release.yml**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org"

      - uses: pnpm/action-setup@v4

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Test
        run: pnpm test

      - name: Typecheck
        run: pnpm typecheck

      - name: Build parser + web
        run: pnpm build

      - name: Prepare CLI package
        run: node scripts/prepare-cli.mjs

      - name: Build CLI
        run: pnpm -F claude-lens build

      - name: Publish to npm
        run: npm publish packages/cli/ --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        run: gh release create ${{ github.ref_name }} --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml scripts/prepare-cli.mjs
git commit -m "ci: add tag-driven release workflow for npm + GitHub"
```

### Task 13: CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md**

```markdown
# Claude Lens

Local-only, privacy-first dashboard for Claude Code sessions. Reads JSONL transcripts from `~/.claude/projects/` and visualizes agent activity.

## Architecture

pnpm monorepo with Turborepo:

- `packages/parser` — `@claude-lens/parser`: JSONL parsing, analytics, filesystem scanning. Pure TypeScript, no framework deps.
- `packages/cli` — `claude-lens` (published to npm): CLI that manages the dashboard server, provides terminal stats, handles auto-updates.
- `apps/web` — `@claude-lens/web`: Next.js dashboard (standalone output bundled into the CLI package).

## Dev Commands

```bash
pnpm dev          # Start all packages in dev/watch mode
pnpm build        # Build all packages (parser → web → cli)
pnpm test         # Run vitest across all packages
pnpm typecheck    # TypeScript check across all packages
pnpm verify       # typecheck + smoke tests
pnpm clean        # Remove all build artifacts
```

## CLI Dev

```bash
pnpm -F claude-lens build    # Build CLI with esbuild
pnpm -F claude-lens test     # Run CLI tests
node packages/cli/dist/index.js stats   # Test stats locally
```

## Versioning

All packages share a single version. The root `package.json` is the source of truth.

**Never edit version numbers in sub-package `package.json` files manually.**

The `npm version` command at the monorepo root bumps the version and syncs it to all packages via the `version` lifecycle hook (`scripts/version-sync.mjs`).

## Release Process

**When to release:** After completing a user-facing change (feature, fix, improvement) on `master`.

**Version bump rules:**
- `patch`: bug fixes, small tweaks
- `minor`: new features, new commands, notable improvements
- `major`: breaking changes (not until v1)

**Commands:**
```bash
pnpm test && pnpm verify     # Must pass before release
npm version patch             # or minor/major — bumps all packages, commits, tags
git push --follow-tags        # Triggers CI → npm publish → GitHub Release
```

The agent does not need npm credentials. Pushing the tag triggers GitHub Actions which publishes to npm using a stored `NPM_TOKEN` secret.

## Port

Default: 3321. Override with `--port` flag or `CLAUDE_LENS_PORT` env var.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with project guide and release process"
```

---

## Chunk 6: Integration — Wire Everything Together & Final Verification

### Task 14: Fix server.ts paths for standalone layout

**Files:**
- Modify: `packages/cli/src/server.ts`

- [ ] **Step 1: Update appDir to match standalone directory structure**

The Next.js standalone output preserves the monorepo structure. Update `appDir()` in server.ts:

```ts
function appDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In published package: dist/ is here, app/ is sibling
  // Standalone preserves monorepo structure: app/apps/web/server.js
  return join(here, "..", "app", "apps", "web");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/server.ts
git commit -m "fix(cli): correct standalone server path for monorepo layout"
```

### Task 15: End-to-end local verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: parser, web, and CLI all build successfully. `apps/web/.next/standalone/` exists.

- [ ] **Step 2: Prepare CLI package locally**

Run: `node scripts/prepare-cli.mjs`
Expected: `packages/cli/app/` directory created with standalone output.

- [ ] **Step 3: Build CLI**

Run: `pnpm -F claude-lens build`
Expected: `packages/cli/dist/index.js` exists with hashbang.

- [ ] **Step 4: Test all commands**

Run: `node packages/cli/dist/index.js version`
Expected: `claude-lens 0.1.0`

Run: `node packages/cli/dist/index.js help`
Expected: shows all commands

Run: `node packages/cli/dist/index.js stats`
Expected: shows token usage table (may have real data from `~/.claude/projects/`)

Run: `node packages/cli/dist/index.js start`
Expected: starts server, prints URL, opens browser

Run: `node packages/cli/dist/index.js stop`
Expected: stops server

- [ ] **Step 5: Run full test suite**

Run: `pnpm test && pnpm verify`
Expected: all tests pass, typecheck clean

- [ ] **Step 6: Verify version sync**

Run: `node scripts/version-sync.mjs && cat packages/cli/package.json | grep version`
Expected: version matches root package.json

- [ ] **Step 7: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration fixes from end-to-end testing"
```

---

## Things the User Needs to Provide

Before the first actual npm publish can happen:

1. **npm account**: Need an npm account and the `claude-lens` package name must be available (or you already own it).
2. **NPM_TOKEN**: Generate with `npm token create` and add as a GitHub repository secret named `NPM_TOKEN`.
3. **That's it.** Everything else is automated.

These are only needed for the first real release. All local development and testing works without them.
