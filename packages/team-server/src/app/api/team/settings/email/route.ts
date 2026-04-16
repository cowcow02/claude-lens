import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../db/pool.js";
import { validateAdminSession } from "../../../../../lib/auth.js";
import { encryptAesGcm } from "../../../../../lib/crypto.js";

export async function PUT(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberRes = await pool.query("SELECT team_id, role, email FROM members WHERE id = $1", [session.memberId]);
  if (memberRes.rows[0]?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { apiKey } = await req.json();
  if (!apiKey) return NextResponse.json({ error: "API key required" }, { status: 400 });

  // Validate by checking domains (lightweight validation)
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return NextResponse.json({ error: "Invalid Resend API key" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Could not validate key" }, { status: 500 });
  }

  // Encrypt and store
  const encKey = process.env.FLEETLENS_ENCRYPTION_KEY ||
    (await getOrCreateEncryptionKey(pool, memberRes.rows[0].team_id));
  const encrypted = encryptAesGcm(apiKey, encKey);
  await pool.query("UPDATE teams SET resend_api_key_enc = $1 WHERE id = $2", [encrypted, memberRes.rows[0].team_id]);

  return NextResponse.json({ saved: true });
}

async function getOrCreateEncryptionKey(pool: any, teamId: string): Promise<string> {
  const team = await pool.query("SELECT settings FROM teams WHERE id = $1", [teamId]);
  const settings = team.rows[0].settings || {};
  if (settings.encryptionKey) return settings.encryptionKey;

  const { generateToken } = await import("../../../../../lib/crypto.js");
  const key = generateToken(32);
  settings.encryptionKey = key;
  await pool.query("UPDATE teams SET settings = $1 WHERE id = $2", [JSON.stringify(settings), teamId]);
  return key;
}
