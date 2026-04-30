import { Activity } from "lucide-react";
import { RunsLiveBoard } from "@/components/runs-live-board";

export const dynamic = "force-dynamic";

export default function RunsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1600, padding: "20px 32px" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={18} />
          LLM runs
        </h1>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          live trace of every claude -p subprocess · click a run to stream its events + see exact prompts
        </span>
      </header>
      <RunsLiveBoard />
    </div>
  );
}
