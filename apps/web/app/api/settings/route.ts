import { NextResponse } from "next/server";
import { readSettings, writeSettings, monthToDateSpend } from "@claude-lens/entries/node";
import { SettingsUpdateSchema } from "@/lib/validate-settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    settings: readSettings(),
    month_to_date_spend_usd: monthToDateSpend(),
  });
}

export async function PUT(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = SettingsUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "schema validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  writeSettings({ ai_features: parsed.data.ai_features });
  return NextResponse.json({ ok: true });
}
