"use client";

import dynamic from "next/dynamic";

/**
 * v2 canvas map lab — see CanvasMap.tsx for what this is proving.
 *
 * Konva touches `window` at module scope, so the map is loaded with
 * `ssr: false`. Next requires that dynamic import to sit in a Client Component
 * (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md), which is why
 * this lab is two files instead of the single self-contained page docs/LAB.md
 * normally asks for.
 */
const CanvasMap = dynamic(() => import("./CanvasMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
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

export default function CanvasLabPage() {
  return <CanvasMap />;
}
