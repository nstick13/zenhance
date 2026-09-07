import { describe, it, expect } from "vitest";
import { octilinearPath, pointAlongPath, fanOffsets, fanPoint } from "../lineRouting";

describe("octilinearPath", () => {
  it("passes an already-horizontal line through unchanged", () => {
    expect(octilinearPath({ x: 0, y: 50 }, { x: 200, y: 50 })).toEqual([
      { x: 0, y: 50 },
      { x: 200, y: 50 },
    ]);
  });

  it("passes an already-vertical line through unchanged", () => {
    expect(octilinearPath({ x: 30, y: 0 }, { x: 30, y: 400 })).toEqual([
      { x: 30, y: 0 },
      { x: 30, y: 400 },
    ]);
  });

  it("passes an already-45° line through unchanged", () => {
    expect(octilinearPath({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("bends a shallow line: diagonal until the short axis aligns, then straight", () => {
    const path = octilinearPath({ x: 0, y: 0 }, { x: 300, y: 100 });
    expect(path).toHaveLength(3);
    const [a, bend, b] = path;
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b).toEqual({ x: 300, y: 100 });
    // The bend is a true 45° step off `a` (equal x/y movement)...
    expect(Math.abs(bend.x - a.x)).toBeCloseTo(Math.abs(bend.y - a.y));
    // ...and from there to `b` is a pure horizontal run (short axis already closed).
    expect(bend.y).toBe(b.y);
  });

  it("bends a steep line the same way, on the other axis", () => {
    const path = octilinearPath({ x: 0, y: 0 }, { x: 100, y: 300 });
    expect(path).toHaveLength(3);
    const [a, bend, b] = path;
    expect(Math.abs(bend.x - a.x)).toBeCloseTo(Math.abs(bend.y - a.y));
    expect(bend.x).toBe(b.x);
  });
});

describe("pointAlongPath", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("returns the start at t=0 and the end at t=1", () => {
    expect(pointAlongPath(path, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlongPath(path, 1)).toEqual({ x: 100, y: 100 });
  });

  it("stays on the first segment while t is within its share of the length", () => {
    // Both segments are length 100, so t=0.25 (of 200 total) is halfway along the first.
    expect(pointAlongPath(path, 0.25)).toEqual({ x: 50, y: 0 });
  });

  it("crosses into the second segment past the midpoint", () => {
    expect(pointAlongPath(path, 0.75)).toEqual({ x: 100, y: 50 });
  });
});

describe("fanOffsets", () => {
  it("centres offsets on zero", () => {
    expect(fanOffsets(3, 10)).toEqual([-10, 0, 10]);
    expect(fanOffsets(4, 10)).toEqual([-15, -5, 5, 15]);
  });

  it("gives a single line no offset", () => {
    expect(fanOffsets(1, 10)).toEqual([0]);
  });
});

describe("fanPoint", () => {
  it("nudges perpendicular to the from→to direction", () => {
    const p = fanPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    // Direction is +x, so perpendicular offset moves along y.
    expect(p.x).toBeCloseTo(0);
    expect(Math.abs(p.y)).toBeCloseTo(10);
  });

  it("is a no-op at zero offset", () => {
    expect(fanPoint({ x: 5, y: 5 }, { x: 50, y: 5 }, 0)).toEqual({ x: 5, y: 5 });
  });
});
