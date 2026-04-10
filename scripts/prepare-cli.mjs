// scripts/prepare-cli.mjs
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
