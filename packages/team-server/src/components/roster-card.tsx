function formatAgentTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function timeAgo(date: string | null): string {
  if (!date) return "Never";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RosterCard({ member, teamSlug }: { member: any; teamSlug: string }) {
  return (
    <a href={`/team/${teamSlug}/members/${member.id}`}
       style={{
         display: "block",
         border: "1px solid #e5e7eb",
         borderRadius: 8,
         padding: 16,
         textDecoration: "none",
         color: "inherit",
       }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{member.display_name || member.email || "Anonymous"}</div>
          {member.email && member.display_name && (
            <div style={{ color: "#6b7280", fontSize: 13 }}>{member.email}</div>
          )}
        </div>
        <span style={{
          fontSize: 12,
          color: member.role === "admin" ? "#7c3aed" : "#6b7280",
          textTransform: "uppercase",
          fontWeight: 500,
        }}>
          {member.role}
        </span>
      </div>
      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
        Last seen: {timeAgo(member.last_seen_at)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 13 }}>
        <div>
          <div style={{ color: "#6b7280" }}>Agent time</div>
          <div style={{ fontWeight: 600 }}>{formatAgentTime(Number(member.week_agent_time_ms))}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280" }}>Sessions</div>
          <div style={{ fontWeight: 600 }}>{Number(member.week_sessions)}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280" }}>Tokens</div>
          <div style={{ fontWeight: 600 }}>{(Number(member.week_tokens) / 1000).toFixed(0)}k</div>
        </div>
      </div>
    </a>
  );
}
