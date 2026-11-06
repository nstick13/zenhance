/**
 * **Boundary segments, stitched back into the loops they describe.**
 *
 * `outline` in the hex engine hands back the edges of a set of cells in
 * whatever order it walked them, which is all a straight line needs: draw each
 * segment on its own and the boundary appears. A *rounded* corner is
 * different — it is a fact about two segments meeting, so the path has to know
 * which segment comes next.
 *
 * It is here rather than inside `HexLab.tsx` for the same reason `hand.ts` is:
 * it is the one part of the drawing with a walk in it that could go wrong
 * quietly, and a test can drive it where a canvas cannot.
 */
import type { Point } from "@/lib/map/layout/hex/coords";

export type Segment = { from: Point; to: Point };

/**
 * A run of boundary corners in the order the boundary visits them.
 *
 * `closed` is not decoration. A complete boundary comes back closed and wants
 * `closePath`; a *partial* one — a caller that filtered its segments, say —
 * comes back open, and closing it would draw a line straight across the gap
 * that nothing in the data asked for. Every caller today passes a complete
 * boundary, which is precisely why the open case needs saying out loud rather
 * than being left to come true quietly later.
 */
export type Loop = { points: Point[]; closed: boolean };

/**
 * **The same boundary, standing `d` further out.**
 *
 * Every vertex moves along the bisector of its two edges by the *miter*
 * distance — `d · (n₁ + n₂) / (1 + n₁·n₂)`, which is `d` for a straight run
 * and `1.155 d` at a 60° turn, so both offset edges land exactly `d` from the
 * originals and still meet.
 *
 * **Which way is out** is not a guess: `outline` emits each cell edge as
 * `corner[i] → corner[i+1]`, and the corners are generated at rising angles,
 * so the material always lies to the **left** of travel. Out is therefore the
 * right-hand normal, `(dy, −dx)`, for every loop — and because the convention
 * is the same on every loop, a hole's boundary travels the other way round and
 * the same sign shrinks it, which is what a hole does when a shape grows.
 *
 * A hex boundary only ever turns ±60°, so the denominator is 1.5 and nothing
 * can blow up; the guard is for a loop that doubles back, which `outline`
 * cannot produce but a future caller might.
 */
export function pushOut(loop: Loop, d: number): Loop {
  if (!loop.closed) return loop;
  const pts = loop.points;
  const n = pts.length;
  const normal = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dy / len, y: -dx / len };
  };
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const n1 = normal(pts[(i - 1 + n) % n], pts[i]);
    const n2 = normal(pts[i], pts[(i + 1) % n]);
    const k = 1 + n1.x * n2.x + n1.y * n2.y;
    if (k < 0.2) { points.push(pts[i]); continue; }
    points.push({ x: pts[i].x + (d * (n1.x + n2.x)) / k, y: pts[i].y + (d * (n1.y + n2.y)) / k });
  }
  return { points, closed: true };
}

/**
 * The loops a set of boundary segments describes, each a list of corner points
 * in the order the boundary visits them. Runs of fewer than three points are
 * dropped: there is no corner to round on one, and nothing to draw.
 *
 * Every segment is a whole cell edge, so two that meet share a corner point
 * exactly, give or take the floating-point error in a `cos`/`sin`. Quantising
 * to a ten-thousandth of a cell is far finer than any gap the lattice has and
 * far coarser than that error.
 *
 * A vertex normally has two boundary edges on it; where two parts of a region
 * touch at a single point it has four, and then either pairing draws the same
 * ink, so this takes whichever is unused and carries on.
 */
export function boundaryLoops(segments: readonly Segment[], size: number): Loop[] {
  if (!segments.length) return [];
  const eps = size * 1e-4;
  const key = (p: Point) => `${Math.round(p.x / eps)},${Math.round(p.y / eps)}`;
  const at = new Map<string, number[]>();
  segments.forEach((seg, i) => {
    for (const end of [seg.from, seg.to]) {
      const k = key(end);
      const list = at.get(k);
      if (list) list.push(i); else at.set(k, [i]);
    }
  });
  const used: boolean[] = new Array(segments.length).fill(false);
  const loops: Loop[] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const points: Point[] = [];
    let current = start;
    let here = segments[start].from;
    let closed = false;
    // Guarded against a malformed boundary rather than trusted: a walk that
    // cannot close would otherwise spin for as long as the hover lasts.
    for (let step = 0; step <= segments.length; step++) {
      used[current] = true;
      points.push(here);
      const seg = segments[current];
      const there = key(here) === key(seg.from) ? seg.to : seg.from;
      // Back where it started, with the ring complete.
      if (key(there) === key(points[0])) { closed = true; break; }
      const next = (at.get(key(there)) ?? []).find((i) => !used[i]);
      if (next === undefined) { points.push(there); break; }
      current = next;
      here = there;
    }
    if (points.length >= 3) loops.push({ points, closed });
  }
  return loops;
}
