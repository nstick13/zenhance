"use client";

import dynamic from "next/dynamic";
import type { Assignment, OrbitalNodeRow, OrgUnit, Person } from "@/lib/db/schema";
import type { Vocabulary } from "@/lib/vocabulary";

/**
 * Konva touches `window` at module scope, so the map must load with
 * `ssr: false` — which Next requires to sit in a Client Component, hence
 * this thin wrapper around the async server page (same arrangement as
 * OrgCanvasLoader).
 */
const OrbitalMap = dynamic(() => import("./OrbitalMap").then((m) => m.OrbitalMap), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "#f6f4ee",
        color: "#5c6570",
        font: "500 14px -apple-system, BlinkMacSystemFont, Inter, sans-serif",
      }}
    >
      Plotting orbits…
    </div>
  ),
});

export function OrbitalMapLoader(props: {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  vocabulary: Vocabulary;
  savedNodes: OrbitalNodeRow[];
  sampleWork: boolean;
  previewGeography?: "local";
}) {
  return <OrbitalMap {...props} />;
}
