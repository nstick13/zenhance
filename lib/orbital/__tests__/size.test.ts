import { describe, expect, it } from "vitest";
import {
  DOT_MAX_PX,
  DOT_MIN_PX,
  MASTER_DOT_FLOOR_PX,
  SIZE_INDEX_CURVE,
  compressedHeadcount,
  dotScreenRadius,
  headcountDotPx,
  interpolateCurve,
  sizeIndex,
} from "../size";

describe("dot size index — a broad-brush sense of headcount", () => {
  it("ships a curve that is non-decreasing and inside 0..1 on both axes", () => {
    for (let i = 0; i < SIZE_INDEX_CURVE.length; i++) {
      const [x, y] = SIZE_INDEX_CURVE[i];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      if (i > 0) {
        expect(x).toBeGreaterThanOrEqual(SIZE_INDEX_CURVE[i - 1][0]);
        expect(y).toBeGreaterThanOrEqual(SIZE_INDEX_CURVE[i - 1][1]);
      }
    }
    expect(SIZE_INDEX_CURVE[0]).toEqual([0, 0]);
    expect(SIZE_INDEX_CURVE[SIZE_INDEX_CURVE.length - 1]).toEqual([1, 1]);
  });

  it("never shrinks a dot as the headcount below it grows", () => {
    for (const company of [10, 45, 400, 2562]) {
      let previous = -Infinity;
      for (let count = 0; count <= company; count += Math.max(1, Math.floor(company / 200))) {
        const px = headcountDotPx(count, company);
        expect(px).toBeGreaterThanOrEqual(previous);
        previous = px;
      }
    }
  });

  it("keeps every dot between the hard screen limits", () => {
    for (const company of [1, 10, 45, 2562, 100000]) {
      for (const count of [0, 1, 2, 7, 45, 300, company, company * 3, -5]) {
        const px = headcountDotPx(count, company);
        expect(px).toBeGreaterThanOrEqual(DOT_MIN_PX - 1e-9);
        expect(px).toBeLessThanOrEqual(DOT_MAX_PX + 1e-9);
      }
    }
  });

  it("gives the company dot a prominence floor it can't fall below", () => {
    expect(headcountDotPx(3, 2562, { master: true })).toBeGreaterThanOrEqual(MASTER_DOT_FLOOR_PX);
    expect(dotScreenRadius(0, { master: true })).toBe(MASTER_DOT_FLOOR_PX);
  });

  it("interpolates area, then derives the radius", () => {
    const minArea = Math.PI * DOT_MIN_PX ** 2;
    const maxArea = Math.PI * DOT_MAX_PX ** 2;
    const halfway = dotScreenRadius(0.5);
    expect(Math.PI * halfway ** 2).toBeCloseTo((minArea + maxArea) / 2, 6);
    // A radius interpolation would have landed at the arithmetic midpoint.
    expect(halfway).toBeGreaterThan((DOT_MIN_PX + DOT_MAX_PX) / 2);
  });

  it("reads each unit against its own company, compressed so small teams stay visible", () => {
    expect(compressedHeadcount(0, 100)).toBe(0);
    expect(compressedHeadcount(100, 100)).toBe(1);
    // A twelve-person team in a 2,500-person company is small but not nothing.
    const team = compressedHeadcount(12, 2500);
    expect(team).toBeGreaterThan(0.25);
    expect(team).toBeLessThan(0.45);
    // The same team is a larger share of a 45-person company.
    expect(compressedHeadcount(12, 45)).toBeGreaterThan(team);
  });

  it("treats similar sizes as the same order of magnitude, not an exact ratio", () => {
    // 40 and 60 people under a 2,500-person company are close in size…
    const a = headcountDotPx(40, 2500);
    const b = headcountDotPx(60, 2500);
    expect(b / a).toBeLessThan(1.35);
    // …while a division of 800 is plainly bigger than a team of 8.
    expect(headcountDotPx(800, 2500) / headcountDotPx(8, 2500)).toBeGreaterThan(3);
  });

  it("looks up a curve piecewise-linearly and clamps outside it", () => {
    const curve = [[0, 0], [0.5, 0.2], [1, 1]] as const;
    expect(interpolateCurve(curve, -1)).toBe(0);
    expect(interpolateCurve(curve, 0.25)).toBeCloseTo(0.1);
    expect(interpolateCurve(curve, 0.75)).toBeCloseTo(0.6);
    expect(interpolateCurve(curve, 2)).toBe(1);
    expect(sizeIndex(5, 0)).toBeGreaterThanOrEqual(0);
  });
});
