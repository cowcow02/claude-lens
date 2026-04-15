"use client";

import { useState } from "react";
import type { MultiTrackProps } from "./adapter";
import { SwimLaneHeader } from "./swim-lane-header";
import { MultiTrack } from "./multi-track";

export function TeamTabClient({
  initial,
  teamName,
}: {
  initial: MultiTrackProps;
  teamName: string;
}) {
  const [zoom, setZoom] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Team: {teamName}</h2>
        <label style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 11, color: "var(--af-text-tertiary, #888)",
        }}>
          <span>Event-anchored</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <span>Strict time</span>
        </label>
      </div>
      <SwimLaneHeader {...initial} />
      <MultiTrack {...initial} zoom={zoom} />
    </div>
  );
}
