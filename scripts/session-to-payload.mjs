#!/usr/bin/env node
/**
 * Transform a session JSONL into the per-turn payload structure used by the
 * "Top sessions" feature in the week digest. Optionally filter by time range.
 *
 * Each turn carries:
 *   - start_min / end_min / wall_min / active_min / idle_before_min  (relative
 *     to the slice start; active = gap-filtered with 3-min IDLE_GAP rule)
 *   - user / first_agent / last_agent  (head-tail truncated; agent collapses
 *     to single field when first == longest)
 *   - tools, skills_loaded, subagents_dispatched, exit_plan_calls, todo_ops,
 *     pr_created, long_autonomous_run flag
 *
 * Usage:
 *   node scripts/session-to-payload.mjs <jsonl> [--start ISO] [--end ISO] [--out PATH]
 *
 * Examples:
 *   node scripts/session-to-payload.mjs ~/.claude/projects/-foo/abc.jsonl
 *   node scripts/session-to-payload.mjs abc.jsonl --start 2026-04-20T00:00:00 --end 2026-04-26T23:59:59
 */
import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";

// ── Config ────────────────────────────────────────────────────────────────
const N_USER          = 150;
const N_FIRST_AGENT   = 150;
const N_LAST_AGENT    = 200;
const N_USER_TURN1    = 400;   // bonus head-tail for the steering turn
const N_SUBAGENT      = 240;
const IDLE_GAP_MS     = 3 * 60 * 1000;
const LONG_AUTONOMOUS_MS = 20 * 60 * 1000;

// ── Args ──────────────────────────────────────────────────────────────────
const [, , filePath, ...flags] = argv;
if (!filePath) {
  console.error("Usage: session-to-payload.mjs <jsonl> [--start ISO] [--end ISO] [--out PATH]");
  process.exit(2);
}
let startMs = -Infinity, endMs = Infinity, outPath = null;
for (let i = 0; i < flags.length; i += 2) {
  if (flags[i] === "--start") startMs = Date.parse(flags[i+1]);
  else if (flags[i] === "--end") endMs = Date.parse(flags[i+1]);
  else if (flags[i] === "--out") outPath = flags[i+1];
}

// ── Helpers ───────────────────────────────────────────────────────────────
function headTail(s, n) {
  if (s == null || s === "") return null;
  if (s.length <= 2 * n + 60) return { chars: s.length, preview: s };
  return {
    chars: s.length,
    preview: s.slice(0, n) + `\n[…truncated ${s.length - 2*n} chars…]\n` + s.slice(-n),
  };
}

function blockText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter(b => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
    .map(b => b.text)
    .join(" ");
}

function isToolResultOnly(content) {
  return Array.isArray(content) && content.length > 0
    && content.every(c => c && typeof c === "object" && c.type === "tool_result");
}

function bashVerb(cmd) {
  if (!cmd) return "?";
  let firstSeg = cmd.split(/\|\||&&|;|\|/, 1)[0].trim();
  if (firstSeg.startsWith("cd ")) {
    const parts = cmd.split(/&&|;/, 3);
    if (parts.length >= 2) firstSeg = parts[1].trim();
  }
  const tokens = firstSeg.split(/\s+/).filter(Boolean);
  while (tokens.length && ["sudo","time","nohup","nice","env","exec"].includes(tokens[0])) tokens.shift();
  if (!tokens.length) return "?";
  let first = tokens[0];
  if (first.includes("=") && !first.startsWith("/")) {
    tokens.shift();
    if (!tokens.length) return "?";
    first = tokens[0];
  }
  if (first.includes("/") && !first.startsWith("./")) {
    first = first.replace(/\/+$/, "").split("/").pop();
  }
  return first.replace(/^["']|["']$/g, "") || "?";
}

function activeMs(timestamps) {
  const ts = [...timestamps].sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i] - ts[i-1];
    if (dt < IDLE_GAP_MS) active += dt;
  }
  return active;
}

function fmtMin(ms) { return Math.round((ms / 1000 / 60) * 10) / 10; }

// ── Parse JSONL + filter by window ────────────────────────────────────────
const lines = readFileSync(filePath, "utf-8").split("\n").filter(l => l.trim());
const events = [];
for (const line of lines) {
  try {
    const ev = JSON.parse(line);
    const ts = Date.parse(ev.timestamp);
    if (Number.isNaN(ts)) continue;
    if (ts < startMs || ts > endMs) continue;
    events.push({ ...ev, _ts: ts });
  } catch {}
}
if (events.length === 0) {
  console.error("No events in window");
  process.exit(1);
}
events.sort((a, b) => a._ts - b._ts);
const sliceStartMs = events[0]._ts;
const sliceEndMs = events[events.length - 1]._ts;

// ── Group events into turns ───────────────────────────────────────────────
const turns = [];
let cur = null;
const INTERRUPT_RE = /\[request interrupted|interrupted by user/i;

for (const ev of events) {
  const content = ev.message?.content;
  const rawType = ev.type;

  if (rawType === "user") {
    const isToolOnly = isToolResultOnly(content);
    if (!isToolOnly) {
      const text = blockText(content) || (typeof content === "string" ? content : "");
      const interrupted = INTERRUPT_RE.test(text);
      if (cur && interrupted) cur.interrupts += 1;
      if (cur) turns.push(cur);
      cur = {
        events: [ev],
        user_text: text,
        agent_blocks: [],
        tools_count: new Map(),
        bash_verbs: new Map(),
        skills: new Map(),
        subagents: [],
        exit_plan_calls: 0,
        todo_ops: 0,
        interrupts: 0,
        has_pr_create: null,
        timestamps: [ev._ts],
      };
    } else if (cur) {
      cur.events.push(ev);
      cur.timestamps.push(ev._ts);
    }
  } else if (rawType === "assistant") {
    if (!cur) continue;
    cur.events.push(ev);
    cur.timestamps.push(ev._ts);
    if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "text" && c.text) {
          cur.agent_blocks.push(c.text);
        } else if (c.type === "tool_use") {
          const name = c.name ?? "unknown";
          cur.tools_count.set(name, (cur.tools_count.get(name) ?? 0) + 1);
          if (name === "Skill") {
            const sk = String(c.input?.skill ?? "unknown");
            cur.skills.set(sk, (cur.skills.get(sk) ?? 0) + 1);
          } else if (name === "Agent") {
            const inp = c.input ?? {};
            cur.subagents.push({
              type: String(inp.subagent_type ?? "general-purpose"),
              description: String(inp.description ?? "").slice(0, 80),
              prompt_preview: String(inp.prompt ?? "").slice(0, N_SUBAGENT),
              background: Boolean(inp.run_in_background),
            });
          } else if (name === "ExitPlanMode") {
            cur.exit_plan_calls += 1;
          } else if (name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate") {
            cur.todo_ops += 1;
          } else if (name === "Bash") {
            const cmd = String(c.input?.command ?? "");
            const v = bashVerb(cmd);
            cur.bash_verbs.set(v, (cur.bash_verbs.get(v) ?? 0) + 1);
            if (/\bgh\s+pr\s+create\b/.test(cmd)) {
              const m = cmd.match(/--title\s+["']([^"']+)["']/);
              cur.has_pr_create = m?.[1] ?? cmd.slice(0, 120);
            }
          }
        }
      }
    }
  }
}
if (cur) turns.push(cur);

// ── Compose per-turn payload ──────────────────────────────────────────────
const sessionWallMs = sliceEndMs - sliceStartMs;
const sessionActiveMs = activeMs(events.map(e => e._ts));

const turnsOut = [];
let prevEndMs = sliceStartMs;
turns.forEach((t, i) => {
  const turnStartMs = Math.min(...t.timestamps);
  const turnEndMs = Math.max(...t.timestamps);
  const turnWallMs = turnEndMs - turnStartMs;
  const turnActiveMs = activeMs(t.timestamps);
  const idleBeforeMs = i === 0 ? 0 : Math.max(0, turnStartMs - prevEndMs);
  prevEndMs = turnEndMs;

  let firstAgent = null, lastAgent = null;
  if (t.agent_blocks.length > 0) {
    firstAgent = t.agent_blocks[0];
    lastAgent = t.agent_blocks.reduce((a, b) => b.length > a.length ? b : a);
  }
  const agentCollapse = (firstAgent && firstAgent === lastAgent);

  const tools = [];
  const toolsArr = [...t.tools_count.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, n] of toolsArr) {
    if (name === "Bash" && t.bash_verbs.size > 0) {
      const top = [...t.bash_verbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([v, c]) => c > 1 ? `${v}×${c}` : v).join(", ");
      tools.push(`Bash×${n} (${top})`);
    } else {
      tools.push(n > 1 ? `${name}×${n}` : name);
    }
  }

  const N_USER_HERE = i === 0 ? N_USER_TURN1 : N_USER;

  const out = {
    turn: i + 1,
    start_min: fmtMin(turnStartMs - sliceStartMs),
    end_min:   fmtMin(turnEndMs - sliceStartMs),
    wall_min:  fmtMin(turnWallMs),
    active_min: fmtMin(turnActiveMs),
    idle_before_min: fmtMin(idleBeforeMs),
    start_iso: new Date(turnStartMs).toISOString(),
    user: t.user_text ? headTail(t.user_text, N_USER_HERE) : null,
  };
  if (agentCollapse) {
    out.agent = headTail(firstAgent, Math.max(N_FIRST_AGENT, N_LAST_AGENT));
  } else {
    out.first_agent = firstAgent ? headTail(firstAgent, N_FIRST_AGENT) : null;
    out.last_agent = lastAgent ? headTail(lastAgent, N_LAST_AGENT) : null;
  }
  out.tools = tools;
  if (t.skills.size > 0) {
    out.skills_loaded = [...t.skills.entries()].map(([k, v]) => v > 1 ? `${k}×${v}` : k);
  }
  if (t.subagents.length > 0) {
    out.subagents_dispatched = t.subagents.map(sa => ({
      type: sa.type,
      description: sa.description,
      prompt_preview: sa.prompt_preview,
      ...(sa.background ? { background: true } : {}),
    }));
  }
  if (t.exit_plan_calls > 0) out.exit_plan_calls = t.exit_plan_calls;
  if (t.todo_ops > 0)        out.todo_ops = t.todo_ops;
  if (t.interrupts > 0)      out.interrupts = t.interrupts;
  if (t.has_pr_create)       out.pr_created = t.has_pr_create;
  if (turnActiveMs >= LONG_AUTONOMOUS_MS && t.interrupts === 0) {
    out.long_autonomous_run = true;
  }
  turnsOut.push(out);
});

// ── Detect candidate pins ────────────────────────────────────────────────
const candidatePins = [];
for (const t of turnsOut) {
  if (t.user?.chars >= 800) {
    candidatePins.push({
      start_min: t.start_min,
      kind: "user-steering",
      context: { chars: t.user.chars, turn: t.turn, format: t.user.chars >= 5000 ? "long-paste" : "long-prose" },
    });
  }
  if (t.subagents_dispatched && t.subagents_dispatched.length >= 3) {
    candidatePins.push({
      start_min: t.start_min,
      kind: "subagent-burst",
      context: { count: t.subagents_dispatched.length, types: t.subagents_dispatched.map(s => s.type), turn: t.turn },
    });
  }
  if (t.long_autonomous_run) {
    candidatePins.push({
      start_min: t.start_min,
      end_min: t.end_min,
      kind: "long-autonomous",
      context: { duration_min: t.active_min, turn: t.turn },
    });
  }
  if (t.exit_plan_calls && t.exit_plan_calls > 0) {
    candidatePins.push({ start_min: t.start_min, kind: "plan-mode", context: { turn: t.turn } });
  }
  if (t.pr_created) {
    candidatePins.push({ start_min: t.start_min, kind: "pr-ship", context: { pr_title: t.pr_created, turn: t.turn } });
  }
  if (t.skills_loaded?.length >= 2) {
    candidatePins.push({
      start_min: t.start_min,
      kind: "harness-chain",
      context: { skills: t.skills_loaded, turn: t.turn },
    });
  }
  if (t.interrupts && t.interrupts > 0) {
    candidatePins.push({
      start_min: t.start_min,
      kind: "interrupt",
      context: { count: t.interrupts, turn: t.turn },
    });
  }
}

// ── Compose final payload ─────────────────────────────────────────────────
const payload = {
  source_jsonl: filePath,
  window: {
    start_iso: new Date(sliceStartMs).toISOString(),
    end_iso: new Date(sliceEndMs).toISOString(),
    filtered_start: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    filtered_end:   Number.isFinite(endMs)   ? new Date(endMs).toISOString()   : null,
  },
  wall_min: fmtMin(sessionWallMs),
  active_min: fmtMin(sessionActiveMs),
  idle_min: fmtMin(sessionWallMs - sessionActiveMs),
  turn_count: turnsOut.length,
  turns: turnsOut,
  candidate_pins: candidatePins,
};

const json = JSON.stringify(payload, null, 2);
if (outPath) {
  writeFileSync(outPath, json);
  console.error(`wrote ${outPath} (${json.length} chars, ${turnsOut.length} turns, ${candidatePins.length} pins)`);
} else {
  process.stdout.write(json);
}
