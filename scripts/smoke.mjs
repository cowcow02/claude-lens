#!/usr/bin/env node
/**
 * Smoke-test verification: hits each route on the local dev server
 * and fails if any returns a non-2xx. Intended to be run after code
 * changes to catch server-component errors that typecheck can't find
 * (e.g. importing a client module from a server component, runtime
 * errors in RSC loaders).
 *
 * Prereqs: dev server must already be running on http://localhost:3321.
 * Run from the repo root: `node scripts/smoke.mjs`
 *
 * Exit code: 0 if all routes succeed, 1 otherwise.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3321";
const TIMEOUT_MS = 30_000;

const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status === 500) return true; // 500 is fine, we'll catch it in the actual test
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  return false;
}

async function hit(path, label) {
  const url = `${BASE}${path}`;
  const start = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const dur = Date.now() - start;
    const body = await r.text();

    // Next.js error pages are HTML 500s; grep the body for obvious markers.
    const hasErrorBoundary = /__next_error|Runtime Error|Application error/i.test(body);
    const ok = r.ok && !hasErrorBoundary;

    if (ok) {
      console.log(`${GREEN}✓${RESET} ${label.padEnd(30)} ${DIM}${fmtMs(dur)}${RESET} ${DIM}${url}${RESET}`);
      return { ok: true };
    } else {
      const snippet = body.slice(0, 400).replace(/\s+/g, " ");
      console.log(
        `${RED}✗${RESET} ${label.padEnd(30)} ${DIM}${fmtMs(dur)}${RESET} ${RED}${r.status}${RESET} ${url}\n   ${DIM}${snippet}${RESET}`,
      );
      return { ok: false, status: r.status, snippet };
    }
  } catch (e) {
    console.log(
      `${RED}✗${RESET} ${label.padEnd(30)} ${RED}${e instanceof Error ? e.message : String(e)}${RESET} ${url}`,
    );
    return { ok: false, error: String(e) };
  }
}

async function pickFirstSessionId() {
  try {
    const root = join(homedir(), ".claude", "projects");
    const projects = await readdir(root);
    for (const p of projects) {
      try {
        const files = await readdir(join(root, p));
        const jsonl = files.find((f) => f.endsWith(".jsonl"));
        if (jsonl) return jsonl.replace(/\.jsonl$/, "");
      } catch {
        // skip
      }
    }
  } catch {
    // no .claude/projects — fall through
  }
  return null;
}

async function pickFirstProjectDir() {
  try {
    const root = join(homedir(), ".claude", "projects");
    const projects = await readdir(root, { withFileTypes: true });
    for (const p of projects) {
      if (p.isDirectory()) return p.name;
    }
  } catch {
    // none
  }
  return null;
}

async function main() {
  console.log(`${CYAN}→${RESET} smoke testing ${BASE}\n`);

  const up = await waitForServer();
  if (!up) {
    console.log(`${RED}✗ dev server not reachable at ${BASE}${RESET}`);
    console.log(`  start it with:  pnpm -F @claude-lens/web dev`);
    process.exit(1);
  }

  const [sessionId, projectDir] = await Promise.all([
    pickFirstSessionId(),
    pickFirstProjectDir(),
  ]);

  const results = [];
  results.push(await hit("/", "Dashboard (all)"));
  results.push(await hit("/?range=7d", "Dashboard (7D)"));
  results.push(await hit("/?range=30d", "Dashboard (30D)"));
  results.push(await hit("/sessions", "Sessions list"));
  results.push(await hit("/projects", "Projects grid"));
  if (sessionId) {
    results.push(await hit(`/sessions/${sessionId}`, "Session detail"));
  } else {
    console.log(`${DIM}— skipping session detail (no .claude/projects data)${RESET}`);
  }
  if (projectDir) {
    results.push(
      await hit(`/projects/${encodeURIComponent(projectDir)}`, "Project detail"),
    );
  } else {
    console.log(`${DIM}— skipping project detail (no .claude/projects data)${RESET}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  console.log();
  if (failed > 0) {
    console.log(`${RED}✗ ${failed}/${total} routes failed${RESET}`);
    process.exit(1);
  } else {
    console.log(`${GREEN}✓ all ${total} routes ok${RESET}`);
  }
}

main().catch((e) => {
  console.error(`${RED}smoke runner crashed:${RESET}`, e);
  process.exit(1);
});
