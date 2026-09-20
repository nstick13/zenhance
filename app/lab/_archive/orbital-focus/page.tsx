"use client";

// Archived reference: the production orbital map now owns this interaction.

import dynamic from "next/dynamic";

const OrbitalFocusMap = dynamic(() => import("./OrbitalFocusMap"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 28, fontFamily: "system-ui", color: "#5c6570" }}>
      Building the fixed-band company…
    </div>
  ),
});

export default function Page() {
  return <OrbitalFocusMap />;
}
