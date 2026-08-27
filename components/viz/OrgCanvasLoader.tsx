"use client";

import dynamic from "next/dynamic";
import type { OrgUnit, Person, Assignment, MapNodeRow, Discipline } from "@/lib/db/schema";
import type { Lens } from "@/lib/canvas/lens";
import type { Vocabulary } from "@/lib/vocabulary";

/**
 * Konva touches `window` at module scope, so OrgCanvas must load with
 * `ssr: false` — which Next requires to sit in a Client Component
 * (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md), hence this
 * thin wrapper around the async server page in app/(app)/org/page.tsx.
 */
const OrgCanvas = dynamic(() => import("./OrgCanvas").then((m) => m.OrgCanvas), {
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
      Loading map…
    </div>
  ),
});

export function OrgCanvasLoader(props: {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  mapNodeRows: MapNodeRow[];
  disciplines: Discipline[];
  lens: Lens;
  vocabulary: Vocabulary;
}) {
  return <OrgCanvas {...props} />;
}
