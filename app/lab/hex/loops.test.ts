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
import { boundaryLoops } from "./loops";

const SIZE = 40;
const origin: Cell = { q: 0, r: 0 };

/** Each loop's points, rounded so two that should be equal compare equal. */
const keyed = (loops: { x: number; y: number }[][]) =>
  loops.map((loop) => loop.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));

describe("boundaryLoops", () => {
  it("gives nothing back for no segments", () => {
    expect(boundaryLoops([], SIZE)).toEqual([]);
  });

  it("turns one cell into one six-cornered loop", () => {
    const loops = boundaryLoops(outline([origin], SIZE), SIZE);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });

  it("wraps two touching cells in a single loop, shared edge left out", () => {
    const cells = [origin, neighbours(origin)[0]];
    const segments = outline(cells, SIZE);
    const loops = boundaryLoops(segments, SIZE);
    expect(loops).toHaveLength(1);
    // Twelve edges less the two that face each other.
    expect(segments).toHaveLength(10);
    expect(loops[0]).toHaveLength(10);
  });

  it("keeps cells that do not touch in loops of their own", () => {
    const far: Cell = { q: 5, r: -2 };
    const loops = boundaryLoops(outline([origin, far], SIZE), SIZE);
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => l.length)).toEqual([6, 6]);
  });

  it("uses every segment exactly once", () => {
    const cells = [origin, ...neighbours(origin)];
    const segments = outline(cells, SIZE);
    const loops = boundaryLoops(segments, SIZE);
    const points = loops.flat();
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
  });

  it("does not hang on a boundary that cannot close", () => {
    const [a, b] = outline([origin], SIZE);
    // One edge of one cell, going nowhere — a shape no `outline` would hand
    // back, which is the point: the walk has to give up rather than spin.
    const loops = boundaryLoops([a, { from: b.from, to: { x: 9e9, y: 9e9 } }], SIZE);
    expect(Array.isArray(loops)).toBe(true);
  });
});
