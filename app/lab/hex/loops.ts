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
 * Closed loops, each a list of corner points in the order the boundary visits
 * them. Loops of fewer than three points are dropped: there is no corner to
 * round on one, and nothing to draw.
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
export function boundaryLoops(segments: readonly Segment[], size: number): Point[][] {
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
  const loops: Point[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const loop: Point[] = [];
    let current = start;
    let here = segments[start].from;
    // Guarded against a malformed boundary rather than trusted: a walk that
    // cannot close would otherwise spin for as long as the hover lasts.
    for (let step = 0; step <= segments.length; step++) {
      used[current] = true;
      loop.push(here);
      const seg = segments[current];
      const there = key(here) === key(seg.from) ? seg.to : seg.from;
      const next = (at.get(key(there)) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      current = next;
      here = there;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
