/**
 * The "solar system" seed layout (Greg, 2026-09-12): every level is a
 * circle orbiting its parent's centre, connected by a line hidden behind
 * the circle. Pure geometry, no Konva/React — this only computes *seed*
 * positions (the fallback used when a node has no persisted x/y yet, or
 * after "Tidy up"); dragging and persistence are unaffected by how a
 * position was originally seeded.
 *
 * Two rules from Greg:
 * 1. A parent's *direct* children (no grandparent to speak of — the root
 *    case) spread evenly around the full circle, all the same radius out.
 * 2. Deeper levels bias their children toward the side of the parent
 *    furthest from the grandparent, so a branch fans outward from the
 *    centre instead of wrapping all the way around and colliding with
 *    its own grandparent or sibling branches.
 */
export type Point = { x: number; y: number };

/** The angle (radians) from `from` to `to` — used to find "the direction
 *  back toward my own parent," which the next level down biases away from. */
export function angleBetween(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** How wide the outward-facing arc is for a non-root level's children. */
export const DEFAULT_ARC_SPAN_DEG = 200;

/**
 * Positions for `count` children orbiting `center` at `radius`.
 * `parentDirection` is the angle from `center` back toward its own parent —
 * pass `null` for a root-level distribution (full circle, evenly spaced,
 * rule 1). For any other level, children spread across an arc centred on
 * the direction *away* from that angle (rule 2).
 */
export function orbitPositions(
  center: Point,
  count: number,
  radius: number,
  parentDirection: number | null,
  arcSpanDeg: number = DEFAULT_ARC_SPAN_DEG,
): Point[] {
  if (count <= 0) return [];
  const at = (angle: number): Point => ({
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  });

  if (parentDirection === null) {
    // Root level: full circle, evenly spaced, starting at "12 o'clock".
    return Array.from({ length: count }, (_, i) => at((2 * Math.PI * i) / count - Math.PI / 2));
  }

  const outward = parentDirection + Math.PI;
  if (count === 1) return [at(outward)];

  const span = (arcSpanDeg * Math.PI) / 180;
  const start = outward - span / 2;
  return Array.from({ length: count }, (_, i) => at(start + (i * span) / (count - 1)));
}
