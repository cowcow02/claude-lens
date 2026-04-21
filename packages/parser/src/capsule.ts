/**
 * Per-session capsule for the Insights agent.
 *
 * Distils a SessionDetail into the minimum narrative-useful JSON shape —
 * intent material (first user / final agent), behavioural numbers (NOT
 * volumetric tokens/cost), quality flags, skills invoked, and subagent
 * dispatches with descriptions.
 *
 * Two modes:
 *   compact: session-level only. ~1 KB each. Fits 60 sessions in < 60 KB.
 *   full   : adds top-N turns with per-turn detail. ~15 KB. Session deep-dive.
 */
import type { SessionDetail } from "./types.js";

const IDLE_GAP_MS = 3 * 60 * 1000;
const MAX_TURNS_IN_CAPSULE = 25;
const TURN_FLOOR_MS = 15 * 1000;
const INTERRUPT_RE = /\[request interrupted|interrupted by user/i;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z[`])/;
const IMAGE_BLOCK_RE = /\[Image:\s*source:\s*[^\]]+\]/g;
const PR_TITLE_RE = /--title\s+["']([^"']+)["']/;
const BASH_CHAIN_SPLIT_RE = /\|\||&&|;|\|/;
const SHELL_NOISE = new Set(["sudo", "time", "nohup", "nice", "env", "exec"]);

export type Subagent = {
  type: string;
  model?: string;
  description: string;
  prompt_preview: string;
  background: boolean;
};

export type TurnCapsule = {
  t_offset_min: number;
  active_min: number;
  wall_min: number;
  user_input: string;
  agent?: string;            // when first==final text
  first_agent?: string;      // when they diverge
  final_agent?: string;
  tools_total: number;
  top_tools: string[];
  tokens: number;
  errors: number;
  consec_same_tool_max: number;
  ended: "text" | "tool-in-flight" | "interrupt";
  model?: string;
  skills?: Record<string, number>;
  subagents?: Subagent[];
};

export type SessionCapsule = {
  session_id: string;
  project?: string;
  start_iso?: string;
  end_iso?: string;
  outcome: "shipped" | "shipped-no-pr" | "partial" | "trivial" | "exploratory";
  flags: string[];
  primary_model?: string;
  model_mix: Record<string, number>;
  numbers: {
    active_min: number;
    turn_count: number;
    turns_in_capsule?: number;
    trivial_turns_dropped?: number;
    longest_turn_min: number;
    median_turn_min: number;
    p90_turn_min: number;
    tools_total: number;
    tokens_total: number;
    subagent_turns: number;
    subagent_calls: number;
    skill_calls: number;
    task_ops: number;
    interrupts: number;
    tool_errors: number;
    consec_same_tool_max: number;
    exit_plan_calls: number;
    prs: number;
    commits: number;
    pushes: number;
  };
  pr_titles: string[];
  first_user: string;
  final_agent: string;
  skills?: Record<string, number>;
  subagents?: Subagent[];
  turns?: TurnCapsule[];
};

function trunc(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function minimizeImages(s: string): string {
  if (!s) return s;
  let counter = 0;
  return s.replace(IMAGE_BLOCK_RE, () => `[Image #${++counter}]`);
}

function firstNSentences(s: string, n = 3, hardCap = 500): string {
  if (!s) return "";
  const flat = s.replace(/\s+/g, " ").trim();
  const out = flat.split(SENTENCE_SPLIT_RE).slice(0, n).join(" ").trim();
  return out.length > hardCap ? out.slice(0, hardCap - 1) + "…" : out;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1]! : ((s[(n >> 1) - 1]! + s[n >> 1]!) / 2);
}

function p90(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(Math.floor(0.9 * s.length), s.length - 1)]!;
}

function bashVerb(cmd: string): string {
  if (!cmd) return "?";
  let firstSeg = cmd.split(BASH_CHAIN_SPLIT_RE, 1)[0]!.trim();
  if (firstSeg.startsWith("cd ") || firstSeg === "cd") {
    const parts = cmd.split(/&&|;/, 3);
    if (parts.length >= 2) firstSeg = parts[1]!.trim();
  }
  const tokens = firstSeg.split(/\s+/).filter(Boolean);
  while (tokens.length && SHELL_NOISE.has(tokens[0]!)) tokens.shift();
  if (!tokens.length) return "?";
  let first = tokens[0]!;
  if (first.includes("=") && !first.startsWith("/")) {
    tokens.shift();
    if (!tokens.length) return "?";
    first = tokens[0]!;
  }
  if (first.includes("/") && !first.startsWith("./")) {
    first = first.replace(/\/+$/, "").split("/").pop()!;
  }
  return first.replace(/^["']|["']$/g, "") || "?";
}

type TurnState = {
  startMs?: number;
  lastMs?: number;
  eventTs: number[];
  userInput: string;
  firstAgentText?: string;
  lastAgentText?: string;
  firstToolsIfNoText: string[];
  toolsTotal: number;
  toolMix: Map<string, number>;
  bashVerbs: Map<string, number>;
  skills: Map<string, number>;
  subagents: Subagent[];
  taskOps: number;
  toolErrors: number;
  consecSameToolMax: number;
  consec: number;
  lastTool?: string;
  endedInInterrupt: boolean;
  models: Map<string, number>;
  tokensIn: number;
  tokensOut: number;
  tokensCacheR: number;
  tokensCacheW: number;
  seenMsgIds: Set<string>;
};

function newTurn(startMs?: number, userInput = ""): TurnState {
  return {
    startMs, lastMs: startMs,
    eventTs: startMs !== undefined ? [startMs] : [],
    userInput,
    firstToolsIfNoText: [],
    toolsTotal: 0,
    toolMix: new Map(), bashVerbs: new Map(),
    skills: new Map(), subagents: [], taskOps: 0,
    toolErrors: 0, consecSameToolMax: 0, consec: 0,
    endedInInterrupt: false,
    models: new Map(),
    tokensIn: 0, tokensOut: 0, tokensCacheR: 0, tokensCacheW: 0,
    seenMsgIds: new Set(),
  };
}

function closeTurn(t: TurnState, closed: ClosedTurn[]): void {
  const ts = [...t.eventTs].sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i]! - ts[i - 1]!;
    if (dt < IDLE_GAP_MS) active += dt;
  }
  const wall = t.startMs !== undefined && t.lastMs !== undefined ? t.lastMs - t.startMs : 0;
  closed.push({
    startMs: t.startMs ?? 0,
    activeMs: active,
    wallMs: wall,
    userInput: t.userInput,
    firstAgentText: t.firstAgentText,
    lastAgentText: t.lastAgentText,
    firstToolsIfNoText: t.firstToolsIfNoText,
    toolsTotal: t.toolsTotal,
    toolMix: t.toolMix,
    bashVerbs: t.bashVerbs,
    skills: t.skills,
    subagents: t.subagents,
    taskOps: t.taskOps,
    toolErrors: t.toolErrors,
    consecSameToolMax: t.consecSameToolMax,
    endedInInterrupt: t.endedInInterrupt,
    models: t.models,
    totalTokens: t.tokensIn + t.tokensOut + t.tokensCacheR + t.tokensCacheW,
  });
}

type ClosedTurn = {
  startMs: number;
  activeMs: number;
  wallMs: number;
  userInput: string;
  firstAgentText?: string;
  lastAgentText?: string;
  firstToolsIfNoText: string[];
  toolsTotal: number;
  toolMix: Map<string, number>;
  bashVerbs: Map<string, number>;
  skills: Map<string, number>;
  subagents: Subagent[];
  taskOps: number;
  toolErrors: number;
  consecSameToolMax: number;
  endedInInterrupt: boolean;
  models: Map<string, number>;
  totalTokens: number;
};

function firstTextBlock(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  for (const b of blocks) {
    if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
      return String((b as { text?: string }).text ?? "");
    }
  }
  return "";
}

function parseMs(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export type CapsuleOpts = { compact?: boolean };

export function buildCapsule(session: SessionDetail, opts: CapsuleOpts = {}): SessionCapsule {
  const { compact = false } = opts;

  let firstUserSession: string | undefined;
  let finalAgentSession: string | undefined;
  const prTitles: string[] = [];
  let commits = 0;
  let pushes = 0;
  const modelTurnsGlobal = new Map<string, number>();
  let totalToolErrors = 0;
  let totalInterrupts = 0;
  let exitPlanCalls = 0;
  let taskOpsGlobal = 0;

  const closed: ClosedTurn[] = [];
  let cur: TurnState | undefined;
  let sessionFirstTs: number | undefined;
  let sessionLastTs: number | undefined;
  const allEventTs: number[] = [];

  for (const ev of session.events) {
    const tsMs = parseMs(ev.timestamp);
    if (tsMs !== undefined) {
      if (sessionFirstTs === undefined || tsMs < sessionFirstTs) sessionFirstTs = tsMs;
      if (sessionLastTs === undefined || tsMs > sessionLastTs) sessionLastTs = tsMs;
      allEventTs.push(tsMs);
    }

    const rawType = ev.rawType;
    const raw = ev.raw as { message?: { content?: unknown; id?: string; model?: string; usage?: Record<string, number> } } | undefined;
    const msg = raw?.message ?? {};
    const content = msg.content;

    if (rawType === "user") {
      // Real user = not only tool_result blocks
      const isToolResultOnly = Array.isArray(content) && content.length > 0
        && content.every((c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "tool_result");

      if (!isToolResultOnly) {
        // Real user input. Close previous turn, open new.
        const text = firstTextBlock(content) || (typeof content === "string" ? content : "");
        if (cur) {
          if (text && INTERRUPT_RE.test(text)) {
            cur.endedInInterrupt = true;
            totalInterrupts++;
          }
          closeTurn(cur, closed);
        }
        cur = newTurn(tsMs, text);
        if (!firstUserSession && text && !text.startsWith("<command-name>")) {
          firstUserSession = text;
        }
      } else {
        // tool_result — count errors
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c && typeof c === "object" && (c as { type?: string }).type === "tool_result"
                && (c as { is_error?: boolean }).is_error) {
              totalToolErrors++;
              if (cur) cur.toolErrors++;
            }
          }
        }
        if (cur && tsMs !== undefined) { cur.eventTs.push(tsMs); cur.lastMs = tsMs; }
      }
    } else if (rawType === "assistant") {
      if (cur && tsMs !== undefined) { cur.eventTs.push(tsMs); cur.lastMs = tsMs; }
      const model = msg.model;
      if (model) {
        modelTurnsGlobal.set(model, (modelTurnsGlobal.get(model) ?? 0) + 1);
        if (cur) cur.models.set(model, (cur.models.get(model) ?? 0) + 1);
      }
      const msgId = msg.id;
      const usage = msg.usage;
      if (cur && msgId && !cur.seenMsgIds.has(msgId) && usage) {
        cur.seenMsgIds.add(msgId);
        cur.tokensIn += usage.input_tokens ?? 0;
        cur.tokensOut += usage.output_tokens ?? 0;
        cur.tokensCacheR += usage.cache_read_input_tokens ?? 0;
        cur.tokensCacheW += usage.cache_creation_input_tokens ?? 0;
      }
      if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || typeof c !== "object") continue;
          const ct = c as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
          if (ct.type === "text" && ct.text) {
            finalAgentSession = ct.text;
            if (cur) {
              if (cur.firstAgentText === undefined) cur.firstAgentText = ct.text;
              cur.lastAgentText = ct.text;
            }
          } else if (ct.type === "tool_use") {
            const name = ct.name ?? "unknown";
            if (cur) {
              cur.toolsTotal++;
              cur.toolMix.set(name, (cur.toolMix.get(name) ?? 0) + 1);
              if (cur.firstAgentText === undefined && cur.firstToolsIfNoText.length < 3) {
                cur.firstToolsIfNoText.push(name);
              }
              if (name === cur.lastTool) cur.consec++;
              else { cur.lastTool = name; cur.consec = 1; }
              if (cur.consec > cur.consecSameToolMax) cur.consecSameToolMax = cur.consec;
              if (name === "Skill") {
                const sk = String((ct.input?.skill as string | undefined) ?? "unknown");
                cur.skills.set(sk, (cur.skills.get(sk) ?? 0) + 1);
              } else if (name === "ToolSearch") {
                const q = String((ct.input?.query as string | undefined) ?? "");
                const key = `(ToolSearch: ${trunc(q, 60)})`;
                cur.skills.set(key, (cur.skills.get(key) ?? 0) + 1);
              }
              if (name === "Agent") {
                const inp = ct.input ?? {};
                cur.subagents.push({
                  type: String(inp.subagent_type ?? "general-purpose"),
                  model: typeof inp.model === "string" ? inp.model : undefined,
                  description: trunc(String(inp.description ?? ""), 80),
                  prompt_preview: trunc(String(inp.prompt ?? ""), 240),
                  background: Boolean(inp.run_in_background),
                });
              }
              if (name === "ExitPlanMode") exitPlanCalls++;
              if (name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate") {
                cur.taskOps++;
                taskOpsGlobal++;
              }
            }
            if (name === "Bash") {
              const cmd = String((ct.input?.command as string | undefined) ?? "");
              if (cur) cur.bashVerbs.set(bashVerb(cmd), (cur.bashVerbs.get(bashVerb(cmd)) ?? 0) + 1);
              if (/\bgh\s+pr\s+create\b/.test(cmd)) {
                const m = cmd.match(PR_TITLE_RE);
                prTitles.push(m?.[1] ?? cmd.slice(0, 120));
              }
              if (/\bgit\s+commit\b/.test(cmd)) commits++;
              if (/\bgit\s+push\b/.test(cmd)) pushes++;
            }
          }
        }
      }
    }
  }
  if (cur) closeTurn(cur, closed);

  const tsSorted = [...allEventTs].sort((a, b) => a - b);
  let activeMsTotal = 0;
  for (let i = 1; i < tsSorted.length; i++) {
    const dt = tsSorted[i]! - tsSorted[i - 1]!;
    if (dt < IDLE_GAP_MS) activeMsTotal += dt;
  }

  const turnActives = closed.map((t) => t.activeMs);
  const turnTools = closed.map((t) => t.toolsTotal);
  const turnTokens = closed.map((t) => t.totalTokens);
  const subagentTurns = closed.filter((t) => t.subagents.length > 0).length;
  const primaryModel = [...modelTurnsGlobal.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const consecMax = Math.max(0, ...closed.map((t) => t.consecSameToolMax));
  const longestTurnActive = Math.max(0, ...turnActives);

  const sessionSkills = new Map<string, number>();
  const sessionSubagents: Subagent[] = [];
  for (const t of closed) {
    for (const [k, v] of t.skills) sessionSkills.set(k, (sessionSkills.get(k) ?? 0) + v);
    sessionSubagents.push(...t.subagents);
  }
  const skillCalls = [...sessionSkills.values()].reduce((a, b) => a + b, 0);

  const prs = prTitles.length;
  let outcome: SessionCapsule["outcome"];
  if (prs > 0) outcome = "shipped";
  else if (commits > 0 && pushes > 0) outcome = "shipped-no-pr";
  else if (commits > 0) outcome = "partial";
  else if (activeMsTotal < 2 * 60_000 && closed.length < 3) outcome = "trivial";
  else outcome = "exploratory";

  const flags: string[] = [];
  if (totalInterrupts >= 3) flags.push("interrupt_heavy");
  if (totalToolErrors >= 20) flags.push("high_errors");
  if (consecMax >= 8) flags.push("loop_suspected");
  if (activeMsTotal < 5 * 60_000 && prs >= 1) flags.push("fast_ship");
  if (exitPlanCalls > 0) flags.push("plan_used");
  if (subagentTurns >= 3) flags.push("orchestrated");
  if (longestTurnActive >= 20 * 60_000 && totalInterrupts === 0) flags.push("long_autonomous");

  // Hybrid ranking: 50% token share + 50% tool share (session-normalised)
  const maxTokens = Math.max(1, ...turnTokens);
  const maxTools = Math.max(1, ...turnTools);
  function significance(t: ClosedTurn): number {
    return 0.5 * (t.totalTokens / maxTokens) + 0.5 * (t.toolsTotal / maxTools);
  }

  let substantive = closed.filter((t) => t.activeMs >= TURN_FLOOR_MS || t.toolsTotal >= 1);
  const droppedTrivial = closed.length - substantive.length;
  if (substantive.length > MAX_TURNS_IN_CAPSULE) {
    substantive = [...substantive].sort((a, b) => significance(b) - significance(a)).slice(0, MAX_TURNS_IN_CAPSULE);
  }
  substantive.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

  function renderTurn(t: ClosedTurn): TurnCapsule {
    const tOffsetS = t.startMs && sessionFirstTs ? (t.startMs - sessionFirstTs) / 1000 : 0;
    const topToolsArr: string[] = [];
    const topTools = [...t.toolMix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [name, count] of topTools) {
      if (name === "Bash" && t.bashVerbs.size > 0) {
        const sub = [...t.bashVerbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([v, c]) => (c > 1 ? `${v}×${c}` : v)).join(", ");
        topToolsArr.push(`Bash×${count} (${sub})`);
      } else {
        topToolsArr.push(count > 1 ? `${name}×${count}` : name);
      }
    }
    const firstAgentRaw = t.firstAgentText ?? (t.firstToolsIfNoText.length > 0 ? `(tools only: ${t.firstToolsIfNoText.join(", ")})` : "");
    const firstTrunc = trunc(minimizeImages(firstAgentRaw), 260);
    const finalTrunc = firstNSentences(minimizeImages(t.lastAgentText ?? ""), 3, 500);
    const ended: TurnCapsule["ended"] = t.endedInInterrupt ? "interrupt" : t.lastAgentText ? "text" : "tool-in-flight";
    const model = [...t.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const turn: TurnCapsule = {
      t_offset_min: Math.round(tOffsetS / 6) / 10,
      active_min: Math.round(t.activeMs / 6000) / 10,
      wall_min: Math.round(t.wallMs / 6000) / 10,
      user_input: trunc(minimizeImages(t.userInput), 300),
      tools_total: t.toolsTotal,
      top_tools: topToolsArr,
      tokens: t.totalTokens,
      errors: t.toolErrors,
      consec_same_tool_max: t.consecSameToolMax,
      ended,
      model,
    };
    // Collapse when identical
    if (firstTrunc && finalTrunc && firstTrunc === finalTrunc) {
      turn.agent = firstTrunc;
    } else if (firstAgentRaw && t.lastAgentText && t.firstAgentText === t.lastAgentText) {
      turn.agent = finalTrunc;
    } else {
      turn.first_agent = firstTrunc;
      turn.final_agent = finalTrunc;
    }
    if (t.skills.size > 0) turn.skills = Object.fromEntries(t.skills);
    if (t.subagents.length > 0) turn.subagents = t.subagents;
    return turn;
  }

  const capsule: SessionCapsule = {
    session_id: session.id,
    project: session.projectName,
    start_iso: session.firstTimestamp,
    end_iso: session.lastTimestamp,
    outcome,
    flags,
    primary_model: primaryModel,
    model_mix: Object.fromEntries(modelTurnsGlobal),
    numbers: {
      active_min: Math.round(activeMsTotal / 6000) / 10,
      turn_count: closed.length,
      longest_turn_min: Math.round(longestTurnActive / 6000) / 10,
      median_turn_min: Math.round(median(turnActives) / 6000) / 10,
      p90_turn_min: Math.round(p90(turnActives) / 6000) / 10,
      tools_total: turnTools.reduce((a, b) => a + b, 0),
      tokens_total: turnTokens.reduce((a, b) => a + b, 0),
      subagent_turns: subagentTurns,
      subagent_calls: sessionSubagents.length,
      skill_calls: skillCalls,
      task_ops: taskOpsGlobal,
      interrupts: totalInterrupts,
      tool_errors: totalToolErrors,
      consec_same_tool_max: consecMax,
      exit_plan_calls: exitPlanCalls,
      prs,
      commits,
      pushes,
    },
    pr_titles: prTitles,
    first_user: trunc(minimizeImages(firstUserSession ?? ""), 400),
    final_agent: trunc(minimizeImages(finalAgentSession ?? ""), 400),
  };

  if (sessionSkills.size > 0) capsule.skills = Object.fromEntries(sessionSkills);
  if (sessionSubagents.length > 0) capsule.subagents = sessionSubagents;

  if (!compact) {
    capsule.numbers.turns_in_capsule = substantive.length;
    capsule.numbers.trivial_turns_dropped = droppedTrivial;
    capsule.turns = substantive.map(renderTurn);
  }

  return capsule;
}
