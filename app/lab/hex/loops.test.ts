/**
 * The stitcher that lets the hover outline have rounded corners.
 *
 * Driven against the engine's own `outline`, not against hand-written
 * segments, because the thing worth knowing is that it can put back together
 * what that function takes apart — on one cell, on cells that touch, and on
 * cells that do not.
 */
import { describe, expect, it } from "vitest";
import { outline } from "@/lib/map/layout/hex/arrange";
import { cellKey, neighbours, type Cell } from "@/lib/map/layout/hex/coords";
import { boundaryLoops, pushOut } from "./loops";

const SIZE = 40;
const origin: Cell = { q: 0, r: 0 };

/** Each loop's points, rounded so two that should be equal compare equal. */
const keyed = (loops: { points: { x: number; y: number }[] }[]) =>
  loops.map((loop) => loop.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));

describe("boundaryLoops", () => {
  it("gives nothing back for no segments", () => {
    expect(boundaryLoops([], SIZE)).toEqual([]);
  });

  it("turns one cell into one six-cornered loop", () => {
    const loops = boundaryLoops(outline([origin], SIZE), SIZE);
    expect(loops).toHaveLength(1);
    expect(loops[0].points).toHaveLength(6);
    expect(loops[0].closed).toBe(true);
  });

  it("wraps two touching cells in a single loop, shared edge left out", () => {
    const cells = [origin, neighbours(origin)[0]];
    const segments = outline(cells, SIZE);
    const loops = boundaryLoops(segments, SIZE);
    expect(loops).toHaveLength(1);
    // Twelve edges less the two that face each other.
    expect(segments).toHaveLength(10);
    expect(loops[0].points).toHaveLength(10);
    expect(loops[0].closed).toBe(true);
  });

  it("keeps cells that do not touch in loops of their own", () => {
    const far: Cell = { q: 5, r: -2 };
    const loops = boundaryLoops(outline([origin, far], SIZE), SIZE);
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => l.points.length)).toEqual([6, 6]);
    expect(loops.every((l) => l.closed)).toBe(true);
  });

  it("uses every segment exactly once", () => {
    const cells = [origin, ...neighbours(origin)];
    const segments = outline(cells, SIZE);
    const loops = boundaryLoops(segments, SIZE);
    const points = loops.flatMap((l) => l.points);
    expect(points).toHaveLength(segments.length);
    // A boundary visits each of its corners once, so no point repeats.
    expect(new Set(keyed(loops).flat()).size).toBe(points.length);
  });

  it("closes the ring a hole leaves, as well as the outside of it", () => {
    // A flower with its middle missing: two boundaries, one inside the other.
    const ring = neighbours(origin);
    const loops = boundaryLoops(outline(ring, SIZE), SIZE);
    const inside = new Set(ring.map(cellKey));
    expect(inside.has(cellKey(origin))).toBe(false);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    // Both the coastline and the shore of the hole are rings in their own
    // right, which is what lets an `evenodd` fill punch the middle out.
    expect(loops.every((l) => l.closed)).toBe(true);
  });

  it("does not hang on a boundary that cannot close", () => {
    const [a, b] = outline([origin], SIZE);
    // One edge of one cell, going nowhere — a shape no `outline` would hand
    // back, which is the point: the walk has to give up rather than spin.
    const loops = boundaryLoops([a, { from: b.from, to: { x: 9e9, y: 9e9 } }], SIZE);
    expect(Array.isArray(loops)).toBe(true);
    // And says so, so nothing draws a line across the gap to close it.
    expect(loops.every((l) => l.closed)).toBe(false);
  });
});

describe("pushOut", () => {
  const d = SIZE / 2;
  /** A regular hexagon's apothem grows by exactly `d`, so its circumradius
   *  grows by `2d / √3` — the one number that pins the whole offset. */
  const grown = SIZE + (2 * d) / Math.sqrt(3);

  it("grows one cell into a bigger hexagon, concentric with it", () => {
    const [loop] = boundaryLoops(outline([origin], SIZE), SIZE);
    const out = pushOut(loop, d);
    expect(out.points).toHaveLength(6);
    for (const p of out.points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(grown, 6);
  });

  it("moves every edge exactly d along its own outward normal", () => {
    // A domino, so the walk meets reflex corners as well as convex ones: at a
    // notch the edge still moves d outward, it is the corners that travel
    // further to keep the two offset edges meeting.
    const [loop] = boundaryLoops(outline([origin, neighbours(origin)[0]], SIZE), SIZE);
    const out = pushOut(loop, d);
    expect(out.points).toHaveLength(loop.points.length);
    for (let i = 0; i < loop.points.length; i++) {
      const a = loop.points[i], b = loop.points[(i + 1) % loop.points.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // `outline` walks each cell's corners in rising angle, which puts the
      // material on the left of travel — so out is the right-hand normal.
      const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;
      // Both ends of the offset edge sit `d` off the original's line, which
      // says the edge is parallel to it and exactly that far out. Where along
      // the line they land is not fixed and should not be: an edge grows at a
      // convex end and is eaten at a reflex one, so it slides as well as moves.
      const off = (p: { x: number; y: number }) => (p.x - a.x) * nx + (p.y - a.y) * ny;
      expect(off(out.points[i])).toBeCloseTo(d, 6);
      expect(off(out.points[(i + 1) % out.points.length])).toBeCloseTo(d, 6);
    }
  });

  it("shrinks a hole, because that is what a hole does when a shape grows", () => {
    const ring = neighbours(origin);
    const loops = boundaryLoops(outline(ring, SIZE), SIZE);
    // The hole is the loop that stays near the middle.
    const inner = loops.reduce((best, loop) => {
      const near = (l: typeof loop) =>
        Math.min(...l.points.map((p) => Math.hypot(p.x, p.y)));
      return near(loop) < near(best) ? loop : best;
    });
    const before = Math.max(...inner.points.map((p) => Math.hypot(p.x, p.y)));
    const after = Math.max(...pushOut(inner, d).points.map((p) => Math.hypot(p.x, p.y)));
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(SIZE - (2 * d) / Math.sqrt(3), 6);
  });

  it("leaves an open run alone, having no second side to offset toward", () => {
    const open = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false };
    expect(pushOut(open, d)).toBe(open);
  });
});
