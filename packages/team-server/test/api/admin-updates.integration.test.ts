import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";

vi.mock("../../src/lib/self-update/version-detector.js", () => ({
  getLatestVersion: vi.fn(),
}));
vi.mock("../../src/lib/self-update/changelog-fetcher.js", () => ({
  getChangelog: vi.fn(),
  getMigrationsManifest: vi.fn(),
}));
vi.mock("../../src/lib/self-update/platform.js", () => ({
  getPlatformAdapter: vi.fn(),
}));

const { getLatestVersion } = await import("../../src/lib/self-update/version-detector.js");
const { getChangelog, getMigrationsManifest } = await import(
  "../../src/lib/self-update/changelog-fetcher.js"
);
const { getPlatformAdapter } = await import("../../src/lib/self-update/platform.js");

const { GET: statusGET } = await import("../../src/app/api/admin/updates/route.js");
const { POST: checkPOST } = await import("../../src/app/api/admin/updates/check/route.js");
const { GET: reviewGET } = await import("../../src/app/api/admin/updates/review/route.js");
const { POST: applyPOST } = await import("../../src/app/api/admin/updates/apply/route.js");

const { createUserAccount, createSession } = await import("../../src/lib/auth.js");

let pool: ReturnType<typeof getPool>;
let staffCookie: string;
let staffId: string;
let nonStaffCookie: string;

function makeReq(url: string, opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {}): NextRequest {
  return new NextRequest(url, opts);
}

function makeAuthedReq(
  url: string,
  cookie: string,
  opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {},
): NextRequest {
  const headers = new Headers(opts.headers as HeadersInit | undefined);
  headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, { ...opts, headers });
}

const originalAppVersion = process.env.APP_VERSION;

beforeAll(async () => {
  pool = await resetDb();
  const staff = await createUserAccount("updates-staff@example.com", "pass1234", "Staff", {}, pool);
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [staff.id]);
  staffId = staff.id;
  const staffSession = await createSession(staff.id, pool);
  staffCookie = staffSession.cookieToken;

  const nonStaff = await createUserAccount("updates-member@example.com", "pass1234", "M", {}, pool);
  const ns = await createSession(nonStaff.id, pool);
  nonStaffCookie = ns.cookieToken;
});

afterAll(async () => {
  await pool.end();
  if (originalAppVersion === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = originalAppVersion;
});

beforeEach(() => {
  vi.mocked(getLatestVersion).mockReset();
  vi.mocked(getChangelog).mockReset();
  vi.mocked(getMigrationsManifest).mockReset();
  vi.mocked(getPlatformAdapter).mockReset();
  process.env.APP_VERSION = "0.4.2";
});

describe("GET /api/admin/updates", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/updates");
    const res = await statusGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when session is valid but user is not staff", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates", nonStaffCookie);
    const res = await statusGET(req);
    expect(res.status).toBe(403);
  });

  it("returns 200 + status JSON for a staff session", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates", staffCookie);
    const res = await statusGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("currentVersion");
    expect(data).toHaveProperty("latestVersion");
    expect(data).toHaveProperty("updateAvailable");
    expect(data).toHaveProperty("lastCheckedAt");
  });
});

describe("POST /api/admin/updates/check", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/updates/check", { method: "POST" });
    const res = await checkPOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates/check", nonStaffCookie, {
      method: "POST",
    });
    const res = await checkPOST(req);
    expect(res.status).toBe(403);
  });

  it("refreshes the cache and returns fresh status for staff", async () => {
    vi.mocked(getLatestVersion).mockResolvedValue("0.5.0");
    const req = makeAuthedReq("http://localhost/api/admin/updates/check", staffCookie, {
      method: "POST",
    });
    const res = await checkPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.latestVersion).toBe("0.5.0");
    expect(data.updateAvailable).toBe(true);
  });
});

describe("GET /api/admin/updates/review", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/updates/review?version=0.5.0");
    const res = await reviewGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    const req = makeAuthedReq(
      "http://localhost/api/admin/updates/review?version=0.5.0",
      nonStaffCookie,
    );
    const res = await reviewGET(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when version is missing", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates/review", staffCookie);
    const res = await reviewGET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a bad-shaped version string", async () => {
    const req = makeAuthedReq(
      "http://localhost/api/admin/updates/review?version=bogus",
      staffCookie,
    );
    const res = await reviewGET(req);
    expect(res.status).toBe(400);
  });

  it("returns changelog + migrations from the (mocked) fetchers for staff", async () => {
    vi.mocked(getChangelog).mockResolvedValue("## v0.5.0\n- Added feature");
    vi.mocked(getMigrationsManifest).mockResolvedValue({
      version: "0.5.0",
      migrations: [{ filename: "0002.sql", description: "add col", sql: "ALTER TABLE t ADD c int" }],
    });
    const req = makeAuthedReq(
      "http://localhost/api/admin/updates/review?version=0.5.0",
      staffCookie,
    );
    const res = await reviewGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.changelog).toContain("v0.5.0");
    expect(data.migrations).toHaveLength(1);
    expect(data.migrations[0].filename).toBe("0002.sql");
  });
});

describe("POST /api/admin/updates/apply", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/updates/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "0.5.0" }),
    });
    const res = await applyPOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates/apply", nonStaffCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "0.5.0" }),
    });
    const res = await applyPOST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 for a missing version field", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates/apply", staffCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await applyPOST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a bad-shaped version string", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates/apply", staffCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "bogus" }),
    });
    const res = await applyPOST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-JSON body", async () => {
    const req = makeAuthedReq("http://localhost/api/admin/updates/apply", staffCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await applyPOST(req);
    expect(res.status).toBe(400);
  });

  it("calls the mock adapter's redeploy when all checks pass", async () => {
    const redeploy = vi.fn().mockResolvedValue({ revisionId: "rev-555" });
    vi.mocked(getPlatformAdapter).mockReturnValue({
      name: "railway",
      getCurrentImage: vi.fn(),
      redeploy,
    });
    vi.mocked(getLatestVersion).mockResolvedValue("0.5.0");

    // Seed the cache row so applyUpdate's UPDATE has something to write to.
    await pool.query(
      `INSERT INTO update_check_cache (key, update_available) VALUES ('global', true)
       ON CONFLICT (key) DO NOTHING`,
    );

    const req = makeAuthedReq("http://localhost/api/admin/updates/apply", staffCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "0.5.0" }),
    });
    const res = await applyPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.revisionId).toBe("rev-555");
    expect(redeploy).toHaveBeenCalledWith("0.5.0");

    const { rows } = await pool.query(
      "SELECT actor_id FROM events WHERE action = 'self_update.apply_requested' ORDER BY created_at DESC LIMIT 1",
    );
    expect(rows[0].actor_id).toBe(staffId);
  });
});
