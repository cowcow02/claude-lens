import { spawn } from "node:child_process";
import { CURRENT_DAY_DIGEST_SCHEMA_VERSION, type DayDigest, type Entry } from "./types.js";
import {
  DIGEST_DAY_SYSTEM_PROMPT,
  DayDigestResponseSchema,
  buildDigestUserPrompt,
} from "./prompts/digest-day.js";
import type { CallLLM, EnrichUsage, LLMResponse } from "./enrich.js";

function prettyProjectName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function buildDeterministicDigest(
  date: string,
  entries: Entry[],
  opts: { concurrencyPeak?: number } = {},
): DayDigest {
  const agent_min = entries.reduce((sum, e) => sum + e.numbers.active_min, 0);

  const byProject = new Map<string, { minutes: number; entry_count: number }>();
  for (const e of entries) {
    const prev = byProject.get(e.project) ?? { minutes: 0, entry_count: 0 };
    prev.minutes += e.numbers.active_min;
    prev.entry_count += 1;
    byProject.set(e.project, prev);
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([name, v]) => ({
      name,
      display_name: prettyProjectName(name),
      share_pct: agent_min > 0 ? (v.minutes / agent_min) * 100 : 0,
      entry_count: v.entry_count,
    }));

  const shipped = entries.flatMap(e =>
    e.pr_titles.map(title => ({
      title,
      project: prettyProjectName(e.project),
      session_id: e.session_id,
    })),
  );

  const flagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.flags) {
      flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const e of entries) {
    if (e.enrichment.status !== "done") continue;
    for (const [g, min] of Object.entries(e.enrichment.goal_categories ?? {})) {
      goalMinutes.set(g, (goalMinutes.get(g) ?? 0) + (min ?? 0));
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  const window = {
    start: `${date}T00:00:00`,
    end: `${date}T23:59:59`,
  };

  return {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION,
    scope: "day",
    key: date,
    window,
    entry_refs: entries.map(e => `${e.session_id}__${e.local_day}`),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    projects,
    shipped,
    top_flags,
    top_goal_categories,
    concurrency_peak: opts.concurrencyPeak ?? 0,
    agent_min,
    headline: null,
    narrative: null,
    what_went_well: null,
    what_hit_friction: null,
    suggestion: null,
  };
}

// ─── Generator (LLM narrative layer) ──────────────────────────────────────

export type GenerateOptions = {
  model?: string;
  callLLM?: CallLLM;
  concurrencyPeak?: number;
};

export type GenerateResult = {
  digest: DayDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

async function defaultCallLLMDigest(args: {
  model: string;
  userPrompt: string;
  reminder?: string;
}): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    const claudeArgs = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--model", args.model, "--tools", "",
      "--disable-slash-commands", "--no-session-persistence",
      "--setting-sources", "",
      "--append-system-prompt", DIGEST_DAY_SYSTEM_PROMPT,
    ];
    const proc = spawn("claude", claudeArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const stdinPayload = args.reminder
      ? `${args.userPrompt}\n\n---\n\n${args.reminder}`
      : args.userPrompt;
    proc.stdin.write(stdinPayload);
    proc.stdin.end();

    let buffer = "", inputTokens = 0, outputTokens = 0, modelUsed = args.model, stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          if (obj.type === "assistant") {
            const msg = obj.message as Record<string, unknown> | undefined;
            const content = msg?.content as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && typeof block.text === "string") buffer += block.text;
              }
            }
            const mm = (msg as { model?: string } | undefined)?.model;
            if (mm) modelUsed = mm;
          }
          if (obj.type === "result") {
            const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
            }
          }
        } catch { /* skip non-JSON framing */ }
      }
    });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    proc.on("close", code => {
      if (code !== 0 && !buffer) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve({ content: buffer, input_tokens: inputTokens, output_tokens: outputTokens, model: modelUsed });
    });
    proc.on("error", err => reject(new Error(`Failed to spawn claude: ${err.message}`)));
  });
}

function parseAndValidate(content: string) {
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    const r = DayDigestResponseSchema.safeParse(parsed);
    if (r.success) return { ok: true as const, value: r.data };
    return { ok: false as const, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false as const, error: "json: " + (e as Error).message };
  }
}

export async function generateDayDigest(
  date: string,
  entries: Entry[],
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const base = buildDeterministicDigest(date, entries, { concurrencyPeak: opts.concurrencyPeak });
  const enriched = entries.filter(e => e.enrichment.status === "done");
  if (enriched.length === 0) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMDigest;
  const userPrompt = buildDigestUserPrompt(base, entries);
  let inT = 0, outT = 0, lastModel = model;

  try {
    const r1 = await callLLM({ model, userPrompt });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      return {
        digest: {
          ...base, model: lastModel, cost_usd: null,
          headline: v1.value.headline,
          narrative: v1.value.narrative,
          what_went_well: v1.value.what_went_well,
          what_hit_friction: v1.value.what_hit_friction,
          suggestion: v1.value.suggestion,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the five required fields — no prose, no code fence.",
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = parseAndValidate(r2.content);
    if (v2.ok) {
      return {
        digest: {
          ...base, model: lastModel, cost_usd: null,
          headline: v2.value.headline,
          narrative: v2.value.narrative,
          what_went_well: v2.value.what_went_well,
          what_hit_friction: v2.value.what_hit_friction,
          suggestion: v2.value.suggestion,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    console.warn(`[digest-day] ${date}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-day] ${date}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
