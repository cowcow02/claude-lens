"use client";

import { useState } from "react";
import type { TimelineData, TeamTurn } from "./adapter";
import type { SeekTarget } from "./team-table";
import { TeamMinimap } from "./team-minimap";
import { TeamTable } from "./team-table";
import { TurnDrawer } from "./turn-drawer";

export function TeamTabClient({
  initial,
  teamName,
}: {
  initial: TimelineData;
  teamName: string;
}) {
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const [seekTarget, setSeekTarget] = useState<SeekTarget | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<TeamTurn | null>(null);

  const selectedTrack = selectedTurn
    ? initial.tracks.find((t) => t.id === selectedTurn.trackId)
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        height: "calc(100vh - 200px)",
        minHeight: 600,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          Team: {teamName}
        </h2>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          {initial.tracks.length} agent{initial.tracks.length === 1 ? "" : "s"}
        </div>
      </div>
      <TeamMinimap
        data={initial}
        playheadMs={playheadMs}
        onSeek={(tsMs, trackId) => setSeekTarget({ tsMs, trackId })}
      />
      <TeamTable
        data={initial}
        onPlayheadChange={setPlayheadMs}
        scrollTarget={seekTarget}
        onTurnClick={setSelectedTurn}
      />
      <TurnDrawer
        turn={selectedTurn}
        trackLabel={
          selectedTrack
            ? selectedTrack.isLead
              ? "LEAD"
              : selectedTrack.label
            : ""
        }
        trackColor={selectedTrack?.color ?? "#888"}
        onClose={() => setSelectedTurn(null)}
      />
    </div>
  );
}
