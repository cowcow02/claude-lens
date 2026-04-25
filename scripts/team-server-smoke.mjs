#!/usr/bin/env node
/**
 * Smoke-test for the team-server. Hits each public route plus the new
 * Doc 2 Plan/Settings/Profile surfaces. The team-server requires auth
 * for most pages, so we sign up a throwaway admin against a freshly-
 * created database, capture the session cookie, then walk the routes.
 *
 * Designed to fail fast on the "I broke a server-component import" /
 * "next build mismatch with tsc --noEmit" class of bugs that unit tests
 * never catch.
 *
 * Usage:
 *   1. Create a fresh DB:    createdb fleetlens_smoke
 *   2. Start the dev server: DATABASE_URL=postgres://localhost:5432/fleetlens_smoke pnpm -F @claude-lens/team-server dev
 *   3. Run this:             node scripts/team-server-smoke.mjs
 *
 * Env vars:
 *   TEAM_SMOKE_BASE   default http://localhost:3322
 *   TEAM_SMOKE_EMAIL  default smoke-${pid}@example.com
 *
 * Exit code: 0 if all routes succeed, 1 otherwise.
 */

import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.TEAM_SMOKE_BASE ?? "http://localhost:3322";
const EMAIL = process.env.TEAM_SMOKE_EMAIL ?? `smoke-${process.pid}@example.com`;
const PASSWORD = "smokepass";
const TEAM_NAME = "Smoke Team";
const TIMEOUT_MS = 30_000;

const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function fmtMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    try {
      const r = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status === 500) return true;
    } catch {
      // not ready
    }
    await sleep(300);
  }
  return false;
}

function extractCookie(setCookieHeaders, name) {
  // Node fetch on 18+ exposes set-cookie as a single comma-joined header by
  // default; using getSetCookie() splits per-cookie so we can grab the value.
  const all = typeof setCookieHeaders.getSetCookie === "function"
    ? setCookieHeaders.getSetCookie()
    : [setCookieHeaders.get?.("set-cookie") ?? ""];
  for (const raw of all) {
    const m = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(raw);
    if (m) return m[1];
  }
  return null;
}

async function signupAdmin() {
  const r = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      displayName: "Smoke Admin",
      teamName: TEAM_NAME,
    }),
  });
  const body = await r.json();
  if (!r.ok) {
    if (body.error?.includes("already exists")) {
      console.log(
        `${RED}✗ smoke-test email ${EMAIL} already exists in this DB. Use a fresh DB or set TEAM_SMOKE_EMAIL.${RESET}`,
      );
      process.exit(1);
    }
    throw new Error(`signup failed: ${r.status} ${JSON.stringify(body)}`);
  }
  const cookie = extractCookie(r.headers, "fleetlens_session");
  if (!cookie) throw new Error("signup did not set fleetlens_session cookie");
  return { cookie, slug: body.landingSlug, userId: body.user.id };
}

async function getMembershipId(cookie, slug) {
  const r = await fetch(`${BASE}/api/team/roster?team=${slug}`, {
    headers: { cookie: `fleetlens_session=${cookie}` },
  });
  if (!r.ok) throw new Error(`roster fetch failed: ${r.status}`);
  const rows = await r.json();
  if (!rows.length) throw new Error("roster returned no rows after signup");
  return rows[0].id;
}

async function hit(path, label, cookie) {
  const url = `${BASE}${path}`;
  const start = Date.now();
  const headers = cookie ? { cookie: `fleetlens_session=${cookie}` } : {};
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const dur = Date.now() - start;
    const body = await r.text();
    const hasErrorBoundary = /__next_error|Runtime Error|Application error/i.test(body);
    const ok = r.ok && !hasErrorBoundary;

    if (ok) {
      console.log(`${GREEN}✓${RESET} ${label.padEnd(30)} ${DIM}${fmtMs(dur)} ${url}${RESET}`);
      return { ok: true, body };
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

async function main() {
  console.log(`${CYAN}→${RESET} team-server smoke testing ${BASE}\n`);

  const up = await waitForServer();
  if (!up) {
    console.log(`${RED}✗ dev server not reachable at ${BASE}${RESET}`);
    console.log(`  start it with:  DATABASE_URL=postgres://localhost:5432/fleetlens_smoke pnpm -F @claude-lens/team-server dev`);
    process.exit(1);
  }

  // Public surfaces — no auth.
  const results = [];
  results.push(await hit("/login", "Login page"));
  results.push(await hit("/signup", "Signup page"));

  // Sign up an admin, capture the session cookie + the team slug it bootstrapped.
  console.log(`${DIM}— signing up smoke admin (${EMAIL})${RESET}`);
  const { cookie, slug } = await signupAdmin();
  const membershipId = await getMembershipId(cookie, slug);
  console.log(`${DIM}  team=${slug} membership=${membershipId}${RESET}`);

  // Authenticated app surfaces.
  results.push(await hit(`/team/${slug}`, "Team roster", cookie));
  results.push(await hit(`/team/${slug}/plan`, "Plan view (Doc 2)", cookie));
  results.push(await hit(`/team/${slug}/settings`, "Settings", cookie));
  results.push(await hit(`/team/${slug}/members/${membershipId}`, "Member profile", cookie));

  // Authenticated APIs we rely on for the page renders.
  results.push(await hit(`/api/team/roster?team=${slug}`, "API: roster", cookie));
  results.push(await hit(`/api/team/plan-optimizer?team=${slug}`, "API: plan-optimizer (Doc 2)", cookie));
  results.push(await hit(`/api/team/capacity-warnings?team=${slug}`, "API: capacity-warnings (Doc 2)", cookie));
  results.push(await hit(`/api/team/settings?team=${slug}`, "API: settings", cookie));

  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  console.log();
  if (failed > 0) {
    console.log(`${RED}✗ ${failed}/${total} routes failed${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}✓ all ${total} routes ok${RESET}`);
}

main().catch((e) => {
  console.error(`${RED}team-server smoke runner crashed:${RESET}`, e);
  process.exit(1);
});
