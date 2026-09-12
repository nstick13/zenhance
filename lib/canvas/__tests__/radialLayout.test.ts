import { describe, it, expect } from "vitest";
import { orbitPositions, angleBetween } from "../radialLayout";

describe("angleBetween", () => {
  it("points right for a purely horizontal offset", () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
  });

  it("points down for a purely vertical offset (screen y grows downward)", () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });
});

describe("orbitPositions — root level (rule 1: even, full circle)", () => {
  const center = { x: 100, y: 100 };

  it("places every child at exactly the given radius from centre", () => {
    const pts = orbitPositions(center, 5, 300, null);
    for (const p of pts) {
      expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(300);
    }
  });

  it("spaces children evenly around the full 360°", () => {
    const pts = orbitPositions(center, 4, 300, null);
    const angles = pts.map((p) => Math.atan2(p.y - center.y, p.x - center.x));
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo((2 * Math.PI) / 4, 1);
    }
  });

  it("is deterministic", () => {
    expect(orbitPositions(center, 6, 200, null)).toEqual(orbitPositions(center, 6, 200, null));
  });

  it("returns nothing for zero children", () => {
    expect(orbitPositions(center, 0, 200, null)).toEqual([]);
  });
});

describe("orbitPositions — deeper level (rule 2: biased away from grandparent)", () => {
  const center = { x: 0, y: 0 };

  it("a single child sits directly opposite the grandparent", () => {
    const grandparentDir = angleBetween(center, { x: -100, y: 0 }); // grandparent to the left
    const [p] = orbitPositions(center, 1, 50, grandparentDir);
    expect(p.x).toBeCloseTo(50); // opposite = to the right
    expect(p.y).toBeCloseTo(0);
  });

  it("stays within the requested arc — a 200° span overshoots a strict semicircle by 10° per edge, no more", () => {
    const grandparentDir = 0; // grandparent directly to the right
    const arcSpanDeg = 200;
    const pts = orbitPositions(center, 6, 100, grandparentDir, arcSpanDeg);
    // Outward = negative x here (opposite the grandparent's +x direction).
    // The 10°-per-edge overshoot past perpendicular caps how far an edge
    // point can lean back toward the grandparent's side.
    const maxOvershootX = 100 * Math.sin(((arcSpanDeg - 180) / 2) * (Math.PI / 180));
    for (const p of pts) {
      expect(p.x).toBeLessThanOrEqual(maxOvershootX + 1e-6);
    }
  });

  it("fans a six-person team across the arc rather than stacking them", () => {
    const pts = orbitPositions(center, 6, 100, 0);
    const unique = new Set(pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
    expect(unique.size).toBe(6);
  });
});
