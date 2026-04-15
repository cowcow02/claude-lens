import type {
  TeamView,
  SessionDetail,
  SessionEvent,
} from "@claude-lens/parser";

export type TrackRow = {
  tsMs: number;
  kind: "human" | "agent" | "tool" | "inbound-message" | "idle";
  label: string;
  preview: string;
};

export type Track = {
  id: string;
  label: string;
  color: string;
  isLead: boolean;
  rows: TrackRow[];
  activeSegments: { startMs: number; endMs: number }[];
};

export type CrossTrackMessage = {
  tsMs: number;
  fromTrackId: string;
  toTrackId: string;
  label: string;
};

export type MultiTrackProps = {
  tracks: Track[];
  messages: CrossTrackMessage[];
  firstEventMs: number;
  lastEventMs: number;
};

const LEAD_COLOR = "var(--team-lead, #f0b429)";
const MEMBER_COLORS = [
  "var(--team-m1, #58a6ff)",
  "var(--team-m2, #b58cf0)",
  "var(--team-m3, #3fb950)",
  "var(--team-m4, #f85149)",
  "var(--team-m5, #db6d28)",
];

export function teamViewToMultiTrackProps(
  view: TeamView,
  details: Map<string, SessionDetail>,
): MultiTrackProps {
  const tracks: Track[] = [];

  const leadDetail = details.get(view.leadSessionId);
  if (leadDetail) {
    tracks.push(buildTrack(leadDetail, "LEAD", LEAD_COLOR, true));
  }

  view.memberSessionIds.forEach((id, i) => {
    const d = details.get(id);
    if (!d) return;
    const label = view.agentNameBySessionId.get(id) ?? id.slice(0, 8);
    tracks.push(
      buildTrack(d, label, MEMBER_COLORS[i % MEMBER_COLORS.length]!, false),
    );
  });

  const messages: CrossTrackMessage[] = view.messages.map((m) => ({
    tsMs: m.tsMs,
    fromTrackId: m.fromSessionId,
    toTrackId: m.toSessionId,
    label: m.body.slice(0, 80),
  }));

  return {
    tracks,
    messages,
    firstEventMs: view.firstEventMs,
    lastEventMs: view.lastEventMs,
  };
}

function buildTrack(
  d: SessionDetail,
  label: string,
  color: string,
  isLead: boolean,
): Track {
  const rows: TrackRow[] = [];
  for (const ev of d.events) {
    const row = toRow(ev, isLead);
    if (row) rows.push(row);
  }
  return {
    id: d.sessionId,
    label,
    color,
    isLead,
    rows,
    activeSegments: d.activeSegments ?? [],
  };
}

function toRow(ev: SessionEvent, isLead: boolean): TrackRow | null {
  if (!ev.timestamp) return null;
  const tsMs = Date.parse(ev.timestamp);

  // Lead track suppresses inbound teammate-messages (the sender's column
  // already renders them as "inbound-message" rows). Member tracks keep them.
  if (ev.teammateMessage && isLead) return null;

  if (ev.teammateMessage) {
    return {
      tsMs,
      kind: "inbound-message",
      label: `← from ${ev.teammateMessage.teammateId}`,
      preview: ev.teammateMessage.body.slice(0, 200),
    };
  }
  if (ev.role === "user") {
    return { tsMs, kind: "human", label: "HUMAN", preview: ev.preview };
  }
  if (ev.role === "agent" || ev.role === "agent-thinking") {
    return { tsMs, kind: "agent", label: "AGENT", preview: ev.preview };
  }
  if (ev.role === "tool-call") {
    return {
      tsMs,
      kind: "tool",
      label: ev.toolName ?? "tool",
      preview: ev.preview,
    };
  }
  return null;
}
