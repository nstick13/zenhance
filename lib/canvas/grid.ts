/**
 * The canvas's alignment grid. Pure — no Konva, no React. Shared by the
 * visible grid backdrop (components/viz/MoneyFlow.tsx) and drag-end
 * snapping in OrgCanvas.tsx, so both agree on the same cell size by
 * construction.
 */
export const GRID_SIZE = 100;

export const snap = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;

export const snapPoint = (p: { x: number; y: number }) => ({ x: snap(p.x), y: snap(p.y) });
