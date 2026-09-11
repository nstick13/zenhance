/**
 * Octilinear line routing — Mini Metro / tube-map style (Greg, 2026-09-07).
 * Segments run horizontal, vertical, or at 45°, never an arbitrary angle,
 * and a bend gets a real rounded arc (drawn by the renderer via `arcTo`)
 * rather than a sharp mitre. Pure geometry, no Konva/React.
 */
export type Point = { x: number; y: number };

/** The minimum gap (edge to edge, not centreline to centreline) between two
 *  adjacent parallel lines — the "magnet toward each other" spacing (Greg,
 *  2026-09-11). Shared so every line system's fan-out math derives its
 *  centreline spacing from its own stroke width the same way. */
export const LINE_GAP = 2;

/** Diagonal (45°) until one axis aligns with the target, then straight the
 *  rest of the way — the standard two-segment transit-map dog-leg. Returns
 *  the straight-through 2-point path when already axis-aligned or already
 *  exactly 45°, so an already-orthogonal line (most of the money-flow
 *  lines) passes through unchanged. */
export function octilinearPath(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 || dy === 0 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.5) {
    return [a, b];
  }
  const bend =
    Math.abs(dx) > Math.abs(dy)
      ? { x: a.x + Math.sign(dx) * Math.abs(dy), y: b.y }
      : { x: b.x, y: a.y + Math.sign(dy) * Math.abs(dx) };
  return [a, bend, b];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Point at fraction `t` (0..1) along a multi-segment path, for animating a
 *  packet smoothly through a bend, or centring a label on the true path,
 *  instead of lerping straight from start to end. */
export function pointAlongPath(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total === 0) return points[0];
  let target = clamp01(t) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const segT = lengths[i] === 0 ? 0 : target / lengths[i];
      const a = points[i], b = points[i + 1];
      return { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT };
    }
    target -= lengths[i];
  }
  return points[points.length - 1];
}

/** Perpendicular offsets, evenly spread and centred on zero, for fanning a
 *  hub's outgoing lines apart near their shared origin — the "uniform
 *  offset" a tube map gives lines leaving the same station side by side,
 *  instead of stacking them on one pixel. */
export function fanOffsets(count: number, spacing: number): number[] {
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => (i - mid) * spacing);
}

/** Nudges `from` sideways, perpendicular to the from→to direction, by
 *  `amount` — pairs with fanOffsets so sibling lines leave a hub in a neat
 *  spread rather than from one exact point. */
export function fanPoint(from: Point, to: Point, amount: number): Point {
  if (amount === 0) return from;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (-dy / len) * amount, y: from.y + (dx / len) * amount };
}
