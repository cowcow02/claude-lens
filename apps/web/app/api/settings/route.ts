import { NextResponse } from "next/server";
import { readSettings, writeSettings, monthToDateSpend } from "@claude-lens/entries/node";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    settings: readSettings(),
    month_to_date_spend_usd: monthToDateSpend(),
  });
}

export async function PUT(req: Request) {
  const body = await req.json() as {
    ai_features: {
      enabled: boolean;
      model: string;
      allowedProjects: string[];
      monthlyBudgetUsd: number | null;
    };
  };
  writeSettings({
    ai_features: {
      enabled: body.ai_features.enabled,
      model: body.ai_features.model,
      allowedProjects: body.ai_features.allowedProjects,
      monthlyBudgetUsd: body.ai_features.monthlyBudgetUsd,
    },
  });
  return NextResponse.json({ ok: true });
}
