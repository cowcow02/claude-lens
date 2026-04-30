"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ActiveRun = { pid: number; kind: string; model: string; elapsed_s: number; cpu_time: string };

type TraceSummary = {
  run_id: string;
  kind: string;
  model: string;
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  elapsed_ms: number | null;
  exit_code: number | null;
  status: "running" | "ok" | "error" | "unknown";
  content_chars: number | null;
  output_tokens: number | null;
};

type RunsResponse = {
  generated_at: string;
  active: ActiveRun[];
  totals: { ops: number; input_tokens: number; output_tokens: number; cost_usd: number };
  by_kind: Record<string, { ops: number; input_tokens: number; output_tokens: number; cost_usd: number }>;
  traces: TraceSummary[];
};

type StreamEvent =
  | { sseType: "connected"; data: { run_id: string; path: string } }
  | { sseType: "meta"; data: { _meta: { type: string; [k: string]: unknown } } }
  | { sseType: "event"; data: Record<string, unknown> }
  | { sseType: "done"; data: { reason: string } }
  | { sseType: "raw"; data: { line: string } }
  | { sseType: "stream_error"; data: { message: string } };

function fmtElapsed(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(0);
  return `${m}m${r.padStart(2, "0")}s`;
}

function fmtAge(iso: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_BADGE: Record<TraceSummary["status"], { bg: string; fg: string; label: string }> = {
  running: { bg: "rgba(59, 130, 246, 0.15)", fg: "#3b82f6", label: "running" },
  ok: { bg: "rgba(34, 197, 94, 0.15)", fg: "#16a34a", label: "ok" },
  error: { bg: "rgba(239, 68, 68, 0.15)", fg: "#dc2626", label: "error" },
  unknown: { bg: "rgba(148, 163, 184, 0.15)", fg: "#64748b", label: "?" },
};

const KIND_COLOR: Record<string, string> = {
  week_digest: "#a855f7",
  month_digest: "#ec4899",
  day_digest: "#06b6d4",
  top_session: "#f59e0b",
  entry_enrich: "#10b981",
  unknown: "#94a3b8",
};

export function RunsLiveBoard() {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the snapshot every 3s while the page is open.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/runs?since=24h&trace_limit=40", { cache: "no-store" });
        if (!r.ok) throw new Error(`/api/runs ${r.status}`);
        const j = (await r.json()) as RunsResponse;
        if (!cancelled) {
          setData(j);
          setError(null);
          // Auto-select latest if nothing selected yet.
          if (!cancelled && !selected && j.traces.length > 0) {
            setSelected(j.traces[0]!.run_id);
          }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selected]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 1fr) minmax(0, 2.4fr)", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SnapshotPanel data={data} error={error} />
        <RunsList traces={data?.traces ?? []} active={data?.active ?? []} selected={selected} onSelect={setSelected} />
      </div>
      <div>
        {selected ? <RunDetail runId={selected} /> : <Placeholder text="Select a run to see its prompt + live events." />}
      </div>
    </div>
  );
}

function Card({ children, padding = 14 }: { children: React.ReactNode; padding?: number }) {
  return (
    <div
      style={{
        background: "var(--af-card)",
        border: "1px solid var(--af-border)",
        borderRadius: 10,
        padding,
      }}
    >
      {children}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <Card>
      <div style={{ color: "var(--af-text-tertiary)", fontSize: 13, textAlign: "center", padding: "60px 0" }}>{text}</div>
    </Card>
  );
}

function SnapshotPanel({ data, error }: { data: RunsResponse | null; error: string | null }) {
  if (error) {
    return <Card><div style={{ color: "#dc2626", fontSize: 12 }}>error: {error}</div></Card>;
  }
  if (!data) return <Card><div style={{ color: "var(--af-text-tertiary)", fontSize: 12 }}>loading…</div></Card>;
  const { active, totals, by_kind } = data;
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{active.length === 0 ? "no active runs" : `${active.length} running`}</strong>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{totals.ops} completed · last 24h</span>
      </div>
      {active.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px 0", display: "flex", flexDirection: "column", gap: 4 }}>
          {active.map(r => (
            <li key={r.pid} style={{ fontSize: 12, fontFamily: "var(--font-mono, ui-monospace)" }}>
              <KindDot kind={r.kind} /> pid {r.pid} · {r.kind} · {r.model} · {r.elapsed_s}s
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(by_kind).map(([k, v]) => (
          <span key={k} style={{ fontSize: 11, padding: "2px 8px", background: "var(--af-bg-soft, rgba(0,0,0,0.04))", borderRadius: 6, color: "var(--af-text-secondary)" }}>
            <KindDot kind={k} /> {k}: {v.ops}
          </span>
        ))}
      </div>
    </Card>
  );
}

function KindDot({ kind }: { kind: string }) {
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: KIND_COLOR[kind] ?? KIND_COLOR.unknown, marginRight: 6, verticalAlign: "middle" }} />;
}

function RunsList({
  traces, active, selected, onSelect,
}: {
  traces: TraceSummary[];
  active: ActiveRun[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const activePids = useMemo(() => new Set(active.map(a => a.pid)), [active]);
  return (
    <Card padding={0}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--af-border)" }}>
        <strong style={{ fontSize: 13 }}>Recent runs</strong>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginLeft: 8 }}>{traces.length}</span>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 600, overflow: "auto" }}>
        {traces.map(t => {
          const isActive = t.pid != null && activePids.has(t.pid);
          const status: TraceSummary["status"] = isActive ? "running" : t.status;
          const badge = STATUS_BADGE[status];
          const isSelected = selected === t.run_id;
          return (
            <li
              key={t.run_id}
              onClick={() => onSelect(t.run_id)}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                borderBottom: "1px solid var(--af-border)",
                background: isSelected ? "var(--af-bg-soft, rgba(59,130,246,0.08))" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                    <KindDot kind={t.kind} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.kind} · {t.model}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--af-text-tertiary)", marginTop: 2, fontFamily: "var(--font-mono, ui-monospace)" }}>
                    {t.run_id.slice(0, 19)}…{t.run_id.slice(-8)}
                  </div>
                </div>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: badge.bg, color: badge.fg, fontWeight: 600 }}>
                  {badge.label}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--af-text-tertiary)" }}>
                <span>{t.started_at ? fmtAge(t.started_at) : "—"}</span>
                <span>
                  {t.elapsed_ms != null ? fmtElapsed(t.elapsed_ms) : "…"}
                  {t.output_tokens != null ? ` · ${t.output_tokens.toLocaleString()} out` : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);
  const eventsBoxRef = useRef<HTMLDivElement>(null);
  const [showPrompts, setShowPrompts] = useState(false);

  // Reset + reconnect when the user picks a different run.
  useEffect(() => {
    setEvents([]);
    setOpen(false);
    setClosed(null);
    setShowPrompts(false);
    const es = new EventSource(`/api/runs/${runId}/stream`);
    // EventSource has built-in `open` and `error` DOM events that fire with no
    // `data`. Server-side we deliberately use `connected` / `stream_error` for
    // our payloads to avoid collision; this listener handles the DOM open.
    es.onopen = () => setOpen(true);
    const safeParse = (raw: unknown): unknown => {
      if (typeof raw !== "string" || raw === "") return null;
      try { return JSON.parse(raw); } catch { return null; }
    };
    es.addEventListener("connected", e => {
      const d = safeParse((e as MessageEvent).data) as { run_id: string; path: string } | null;
      if (d) setEvents(prev => [...prev, { sseType: "connected", data: d }]);
    });
    es.addEventListener("meta", e => {
      const d = safeParse((e as MessageEvent).data) as { _meta: { type: string; [k: string]: unknown } } | null;
      if (d) setEvents(prev => [...prev, { sseType: "meta", data: d }]);
    });
    es.addEventListener("event", e => {
      const d = safeParse((e as MessageEvent).data) as Record<string, unknown> | null;
      if (d) setEvents(prev => [...prev, { sseType: "event", data: d }]);
    });
    es.addEventListener("done", e => {
      const d = safeParse((e as MessageEvent).data) as { reason: string } | null;
      if (d) {
        setEvents(prev => [...prev, { sseType: "done", data: d }]);
        setClosed(d.reason);
      }
      es.close();
    });
    es.addEventListener("stream_error", e => {
      const d = safeParse((e as MessageEvent).data) as { message: string } | null;
      if (d) setEvents(prev => [...prev, { sseType: "stream_error", data: d }]);
    });
    es.onerror = () => {
      // EventSource auto-retries on transport errors; mark as closed only if
      // we never managed to open the connection in the first place.
      setOpen(currentOpen => {
        if (!currentOpen) setClosed("connect-error");
        return currentOpen;
      });
    };
    return () => { es.close(); };
  }, [runId]);

  // Auto-scroll to bottom when new events arrive.
  useEffect(() => {
    if (eventsBoxRef.current) eventsBoxRef.current.scrollTop = eventsBoxRef.current.scrollHeight;
  }, [events.length]);

  // Pull out the payload meta for the prompt panel.
  const payloadEvent = events.find(e => e.sseType === "meta" && (e.data as { _meta: { type: string } })._meta.type === "payload");
  const startEvent = events.find(e => e.sseType === "meta" && (e.data as { _meta: { type: string } })._meta.type === "start");
  const endEvent = events.find(e => e.sseType === "meta" && (e.data as { _meta: { type: string } })._meta.type === "end");
  const payload = payloadEvent ? (payloadEvent.data as { _meta: { system_prompt: string; user_prompt: string; reminder: string | null } })._meta : null;
  const startMeta = startEvent ? (startEvent.data as { _meta: { kind: string; model: string; ts: string } })._meta : null;
  const endMeta = endEvent ? (endEvent.data as { _meta: { elapsed_ms: number; exit_code: number; content_chars: number; output_tokens: number; input_tokens: number; stderr_tail: string | null } })._meta : null;

  // Compute live token counts from streamed assistant events.
  const liveTokens = useMemo(() => {
    let inT = 0, outT = 0, cacheCreate = 0, cacheRead = 0, contentChars = 0;
    for (const ev of events) {
      if (ev.sseType !== "event") continue;
      const obj = ev.data as { type?: string; message?: { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } } };
      if (obj.type === "assistant" && obj.message) {
        const u = obj.message.usage;
        if (u) {
          inT = u.input_tokens ?? inT;
          outT = u.output_tokens ?? outT;
          cacheCreate = u.cache_creation_input_tokens ?? cacheCreate;
          cacheRead = u.cache_read_input_tokens ?? cacheRead;
        }
        const content = obj.message.content;
        if (Array.isArray(content)) {
          for (const blk of content) {
            if (blk.type === "text" && typeof blk.text === "string") contentChars += blk.text.length;
          }
        }
      }
    }
    return { inT, outT, cacheCreate, cacheRead, contentChars };
  }, [events]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {startMeta ? (
                <>
                  <KindDot kind={startMeta.kind} /> {startMeta.kind} · <span style={{ color: "var(--af-text-secondary)" }}>{startMeta.model}</span>
                </>
              ) : (
                "loading…"
              )}
            </div>
            <div style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono, ui-monospace)", marginTop: 3 }}>
              {runId}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textAlign: "right" }}>
            {open && !closed && <span style={{ color: "#3b82f6" }}>● live</span>}
            {closed && <span style={{ color: closed === "end" ? "#16a34a" : "#dc2626" }}>● {closed}</span>}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, display: "flex", gap: 14, flexWrap: "wrap", color: "var(--af-text-secondary)" }}>
          <span>in: <strong>{liveTokens.inT.toLocaleString()}</strong></span>
          <span>out: <strong>{liveTokens.outT.toLocaleString()}</strong></span>
          <span>cache_create: <strong>{liveTokens.cacheCreate.toLocaleString()}</strong></span>
          <span>cache_read: <strong>{liveTokens.cacheRead.toLocaleString()}</strong></span>
          <span>chars: <strong>{liveTokens.contentChars.toLocaleString()}</strong></span>
          {endMeta && <span>elapsed: <strong>{fmtElapsed(endMeta.elapsed_ms)}</strong></span>}
          {endMeta && endMeta.exit_code !== 0 && <span style={{ color: "#dc2626" }}>exit: {endMeta.exit_code}</span>}
        </div>
        {endMeta && endMeta.stderr_tail && (
          <pre style={{ marginTop: 8, padding: 8, background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, fontSize: 11, whiteSpace: "pre-wrap", color: "#dc2626", maxHeight: 120, overflow: "auto" }}>
            {endMeta.stderr_tail}
          </pre>
        )}
      </Card>

      {/* Prompt panel — collapsed by default, this is what was actually sent */}
      <Card>
        <button
          onClick={() => setShowPrompts(s => !s)}
          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--af-text-secondary)", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
        >
          {showPrompts ? "▾" : "▸"} Prompts ({payload ? `${payload.system_prompt.length + payload.user_prompt.length + (payload.reminder?.length ?? 0)} chars` : "—"})
        </button>
        {showPrompts && payload && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <PromptBlock label="System prompt" content={payload.system_prompt} />
            <PromptBlock label="User prompt" content={payload.user_prompt} />
            {payload.reminder && <PromptBlock label="Reminder (retry)" content={payload.reminder} />}
          </div>
        )}
      </Card>

      {/* Streamed events */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Stream events</strong>
          <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{events.length} msgs</span>
        </div>
        <div
          ref={eventsBoxRef}
          style={{
            maxHeight: 480,
            overflow: "auto",
            background: "var(--af-bg-soft, rgba(0,0,0,0.04))",
            borderRadius: 6,
            padding: 8,
            fontSize: 11,
            fontFamily: "var(--font-mono, ui-monospace)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {events.map((ev, i) => <EventRow key={i} ev={ev} />)}
        </div>
      </Card>
    </div>
  );
}

function PromptBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginBottom: 4 }}>
        {label} · {content.length.toLocaleString()} chars
      </div>
      <pre style={{ margin: 0, padding: 8, background: "var(--af-bg-soft, rgba(0,0,0,0.04))", borderRadius: 6, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto" }}>
        {content}
      </pre>
    </div>
  );
}

function EventRow({ ev }: { ev: StreamEvent }) {
  if (ev.sseType === "connected") {
    const d = ev.data;
    return <Row tone="info"><b>connected</b> {d.run_id} ({d.path})</Row>;
  }
  if (ev.sseType === "done") {
    return <Row tone="info"><b>done</b> reason={ev.data.reason}</Row>;
  }
  if (ev.sseType === "raw") {
    return <Row tone="warn"><b>raw</b> {ev.data.line.slice(0, 200)}</Row>;
  }
  if (ev.sseType === "stream_error") {
    return <Row tone="error"><b>stream_error</b> {ev.data.message}</Row>;
  }
  if (ev.sseType === "meta") {
    const meta = ev.data._meta;
    return <Row tone="meta"><b>{meta.type}</b> {summarizeMeta(meta)}</Row>;
  }
  // event from claude stream-json
  const obj = ev.data as { type?: string; message?: { content?: Array<{ type?: string; text?: string; thinking?: string }>; model?: string }; rate_limit_info?: { status?: string; rateLimitType?: string; resetsAt?: number } };
  if (obj.type === "system") {
    return <Row tone="info"><b>system.init</b> tools={(obj as unknown as { tools?: unknown[] }).tools?.length ?? 0} mcp={(obj as unknown as { mcp_servers?: unknown[] }).mcp_servers?.length ?? 0}</Row>;
  }
  if (obj.type === "assistant" && obj.message?.content) {
    const blocks = obj.message.content;
    const summary = blocks.map(b => b.type === "text" ? `text(${(b.text ?? "").length})` : b.type === "thinking" ? `thinking(${(b.thinking ?? "").length})` : b.type ?? "?").join("+");
    return <Row tone="ok"><b>assistant</b> {summary}</Row>;
  }
  if (obj.type === "rate_limit_event") {
    const r = obj.rate_limit_info;
    return <Row tone="warn"><b>rate_limit</b> status={r?.status} type={r?.rateLimitType} {r?.resetsAt ? `resets=${new Date(r.resetsAt * 1000).toLocaleTimeString()}` : ""}</Row>;
  }
  if (obj.type === "result") {
    return <Row tone="ok"><b>result</b> {summarizeResult(obj as unknown as Record<string, unknown>)}</Row>;
  }
  return <Row tone="default"><b>{obj.type ?? "?"}</b> {JSON.stringify(obj).slice(0, 160)}</Row>;
}

function Row({ children, tone }: { children: React.ReactNode; tone: "info" | "ok" | "warn" | "error" | "meta" | "default" }) {
  const colors: Record<typeof tone, string> = {
    info: "var(--af-text-secondary)",
    ok: "#16a34a",
    warn: "#d97706",
    error: "#dc2626",
    meta: "#a855f7",
    default: "var(--af-text-secondary)",
  };
  return <div style={{ color: colors[tone], lineHeight: 1.5 }}>{children}</div>;
}

function summarizeMeta(meta: { type: string; [k: string]: unknown }): string {
  const { type, ...rest } = meta;
  if (type === "payload") {
    const m = rest as { system_prompt?: string; user_prompt?: string; reminder?: string | null };
    return `system=${m.system_prompt?.length ?? 0}c user=${m.user_prompt?.length ?? 0}c reminder=${m.reminder?.length ?? 0}c`;
  }
  if (type === "spawned") return `pid=${(rest as { pid?: number }).pid}`;
  if (type === "start") {
    const m = rest as { kind?: string; model?: string; user_prompt_chars?: number };
    return `${m.kind} ${m.model} user=${m.user_prompt_chars}c`;
  }
  if (type === "end") {
    const m = rest as { elapsed_ms?: number; exit_code?: number; output_tokens?: number; content_chars?: number };
    return `elapsed=${m.elapsed_ms}ms exit=${m.exit_code} out=${m.output_tokens}t chars=${m.content_chars}`;
  }
  return JSON.stringify(rest).slice(0, 200);
}

function summarizeResult(r: Record<string, unknown>): string {
  const usage = r.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | undefined;
  const cost = r.total_cost_usd as number | undefined;
  const dur = r.duration_ms as number | undefined;
  const parts: string[] = [];
  if (dur != null) parts.push(`${dur}ms`);
  if (usage?.input_tokens != null) parts.push(`in=${usage.input_tokens}`);
  if (usage?.output_tokens != null) parts.push(`out=${usage.output_tokens}`);
  if (usage?.cache_creation_input_tokens) parts.push(`cache_create=${usage.cache_creation_input_tokens.toLocaleString()}`);
  if (usage?.cache_read_input_tokens) parts.push(`cache_read=${usage.cache_read_input_tokens.toLocaleString()}`);
  if (cost != null) parts.push(`cost=$${cost.toFixed(4)}`);
  return parts.join(" ");
}
