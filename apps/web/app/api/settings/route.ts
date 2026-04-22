import { NextResponse } from "next/server";
import { readSettings, writeSettings, monthToDateSpend } from "@claude-lens/entries/node";

export const runtime = "nodejs";

export async function GET() {
  const s = readSettings();
  // Redact apiKey before responding — never send the key back to the client.
  const redacted = {
    ...s,
    ai_features: {
      ...s.ai_features,
      apiKey: s.ai_features.apiKey ? "********" : "",
      apiKeyIsSet: Boolean(s.ai_features.apiKey),
    },
  };
  return NextResponse.json({
    settings: redacted,
    month_to_date_spend_usd: monthToDateSpend(),
  });
}

export async function PUT(req: Request) {
  const body = await req.json() as {
    ai_features: {
      enabled: boolean;
      apiKey?: string;                // empty string = unset; "********" = keep existing
      model: string;
      allowedProjects: string[];
      monthlyBudgetUsd: number | null;
    };
  };
  const current = readSettings();
  const nextApiKey =
    body.ai_features.apiKey === undefined || body.ai_features.apiKey === "********"
      ? current.ai_features.apiKey
      : body.ai_features.apiKey;
  writeSettings({
    ai_features: {
      enabled: body.ai_features.enabled,
      apiKey: nextApiKey,
      model: body.ai_features.model,
      allowedProjects: body.ai_features.allowedProjects,
      monthlyBudgetUsd: body.ai_features.monthlyBudgetUsd,
    },
  });
  return NextResponse.json({ ok: true });
}
