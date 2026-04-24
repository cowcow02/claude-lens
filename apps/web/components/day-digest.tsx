import type { DayDigest as DayDigestType } from "@claude-lens/entries";

export function DayDigest({ digest, aiEnabled }: { digest: DayDigestType; aiEnabled: boolean }) {
  const fmtDate = new Date(`${digest.key}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "28px 40px", maxWidth: 1080 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{fmtDate}</h1>
        {digest.headline && (
          <p style={{ fontSize: 18, marginTop: 8, color: "var(--af-text)", maxWidth: 820 }}>
            {digest.headline}
          </p>
        )}
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {Math.round(digest.agent_min)}m agent time · {digest.projects.length} project{digest.projects.length === 1 ? "" : "s"} · {digest.shipped.length} PR{digest.shipped.length === 1 ? "" : "s"} shipped · peak concurrency ×{digest.concurrency_peak}
        </p>
      </header>

      {!aiEnabled && (
        <div className="af-panel" style={{ padding: 18, borderLeft: "3px solid var(--af-accent)" }}>
          Enable AI features in <a href="/settings">Settings</a> to see daily narratives.
        </div>
      )}

      {digest.narrative && <Block label="Narrative">{digest.narrative}</Block>}

      {(digest.what_went_well || digest.what_hit_friction) && (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {digest.what_went_well && <Block label="What went well">{digest.what_went_well}</Block>}
          {digest.what_hit_friction && <Block label="What hit friction">{digest.what_hit_friction}</Block>}
        </section>
      )}

      {digest.suggestion && (
        <Block label="Suggestion">
          <p style={{ fontWeight: 600, marginBottom: 6 }}>{digest.suggestion.headline}</p>
          <p>{digest.suggestion.body}</p>
        </Block>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {digest.projects.length > 0 && (
          <Block label="Projects">
            {digest.projects.map(p => (
              <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, fontSize: 13, padding: "2px 0" }}>
                <span>{p.display_name}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)" }}>
                  {Math.round(p.share_pct)}%
                </span>
              </div>
            ))}
          </Block>
        )}
        {digest.shipped.length > 0 && (
          <Block label="Shipped">
            {digest.shipped.map((s, i) => (
              <div key={i} style={{ fontSize: 13, padding: "2px 0" }}>
                <span style={{ color: "var(--af-text-tertiary)", fontSize: 11 }}>{s.project}</span>
                {" · "}{s.title}
              </div>
            ))}
          </Block>
        )}
      </section>

      {digest.top_goal_categories.length > 0 && (
        <Block label="Goal mix">
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min} />
        </Block>
      )}

      {digest.entry_refs.length > 0 && (
        <Block label={`Entries · ${digest.entry_refs.length}`}>
          {digest.entry_refs.map(ref => {
            const [sessionId, day] = ref.split("__");
            return (
              <a key={ref} href={`/sessions/${sessionId}`}
                 style={{ display: "block", fontSize: 12, fontFamily: "var(--font-mono)", padding: "2px 0", color: "var(--af-text-secondary)" }}>
                {sessionId} <span style={{ color: "var(--af-text-tertiary)" }}>· {day}</span>
              </a>
            );
          })}
        </Block>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="af-panel" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </div>
      <div>{children}</div>
    </section>
  );
}

const GOAL_COLORS: Record<string, string> = {
  build: "var(--af-accent)", plan: "#9f7aea", debug: "#ed8936",
  review: "#4299e1", refactor: "#38b2ac", test: "#48bb78",
  release: "#ed64a6", research: "#a0aec0", steer: "#f6ad55",
  meta: "#718096", warmup_minimal: "#cbd5e0",
};

function GoalBar({ goals, total }: { goals: { category: string; minutes: number }[]; total: number }) {
  if (total === 0) return <p style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>No goal data.</p>;
  return (
    <div style={{ display: "flex", gap: 2, height: 18, borderRadius: 4, overflow: "hidden" }}>
      {goals.map(g => {
        const pct = (g.minutes / total) * 100;
        return (
          <div key={g.category}
            style={{ width: `${pct}%`, background: GOAL_COLORS[g.category] ?? "#888", fontSize: 10, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            title={`${g.category}: ${Math.round(g.minutes)}m (${pct.toFixed(0)}%)`}>
            {pct > 10 ? g.category : ""}
          </div>
        );
      })}
    </div>
  );
}
