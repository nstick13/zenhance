import { describe, expect, it } from "vitest";
import {
  FIELD_TIER_BOOST,
  LENS_REACH,
  TIER_ANCHORS,
  detailTier,
  effectiveReveal,
  effectiveScale,
  fieldInfluence,
  fieldRadiusPx,
  isInteractable,
  lensDisplace,
  lensInverse,
  scaleForTier,
  type DetailField,
} from "../detail";
import { revealAt } from "../lod";

const field = (over: Partial<DetailField> = {}): DetailField => ({
  x: 0, y: 0, strength: 1, radiusPx: 200, ...over,
});

describe("detail tiers", () => {
  it("is strictly increasing and invertible across and beyond the anchors", () => {
    let previous = -Infinity;
    for (let s = 0.005; s < 12; s *= 1.07) {
      const tier = detailTier(s);
      expect(tier).toBeGreaterThan(previous);
      previous = tier;
      expect(scaleForTier(tier)).toBeCloseTo(s, 6);
    }
  });

  it("lands each anchor on a whole tier", () => {
    TIER_ANCHORS.forEach((scale, i) => expect(detailTier(scale)).toBeCloseTo(i, 9));
  });
});

describe("the local detail field", () => {
  it("does nothing without a field, or with a field at zero strength", () => {
    expect(fieldInfluence(null, { x: 0, y: 0 }, 1)).toBe(0);
    expect(fieldInfluence(field({ strength: 0 }), { x: 0, y: 0 }, 1)).toBe(0);
    expect(effectiveScale(0.3, 0)).toBe(0.3);
  });

  it("holds full strength at its core and eases to nothing at its rim", () => {
    const f = field();
    expect(fieldInfluence(f, { x: 0, y: 0 }, 1)).toBe(1);
    expect(fieldInfluence(f, { x: 60, y: 0 }, 1)).toBe(1);
    const mid = fieldInfluence(f, { x: 150, y: 0 }, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(fieldInfluence(f, { x: 200, y: 0 }, 1)).toBe(0);
    expect(fieldInfluence(f, { x: 5000, y: 0 }, 1)).toBe(0);
  });

  it("is sized on screen, so it covers more of the world when zoomed out", () => {
    const f = field();
    // 400 world units is 40px at 0.1× — well inside a 200px field…
    expect(fieldInfluence(f, { x: 400, y: 0 }, 0.1)).toBe(1);
    // …and 400px at 1× — outside it.
    expect(fieldInfluence(f, { x: 400, y: 0 }, 1)).toBe(0);
  });

  it("lifts detail by at most one tier, and never lowers it", () => {
    for (const s of [0.01, 0.05, 0.2, 0.7, 2, 5]) {
      for (const w of [0, 0.3, 1, 7]) {
        const lifted = effectiveScale(s, w);
        expect(lifted).toBeGreaterThanOrEqual(s);
        expect(detailTier(lifted) - detailTier(s)).toBeLessThanOrEqual(FIELD_TIER_BOOST + 1e-9);
      }
    }
  });

  it("from the widest overview, reveals structure — never people or work", () => {
    const overview = 0.01;
    const reveal = effectiveReveal(overview, 1);
    expect(reveal.people).toBe(0);
    expect(reveal.workDots).toBe(0);
    expect(reveal.workCapsule).toBe(0);
    expect(revealAt(overview).deepUnits).toBe(0);
  });

  it("from the teams tier, lets people begin to arrive inside the field", () => {
    expect(revealAt(1).people).toBe(0);
    expect(effectiveReveal(1, 1).people).toBeGreaterThan(0.5);
  });

  it("stays a comfortable size on a phone and on a large monitor", () => {
    expect(fieldRadiusPx({ width: 390, height: 760 })).toBe(140);
    expect(fieldRadiusPx({ width: 1024, height: 768 })).toBeCloseTo(230.4);
    expect(fieldRadiusPx({ width: 2560, height: 1440 })).toBe(260);
  });
});

describe("lens displacement", () => {
  it("never moves anything when there is no field", () => {
    expect(lensDisplace(null, { x: 10, y: 20 }, 1)).toEqual({ x: 10, y: 20 });
  });

  it("leaves the centre and everything beyond its reach exactly where it was", () => {
    const f = field({ x: 100, y: -40 });
    expect(lensDisplace(f, { x: 100, y: -40 }, 1)).toEqual({ x: 100, y: -40 });
    const far = { x: 100 + 200 * LENS_REACH + 1, y: -40 };
    expect(lensDisplace(f, far, 1)).toEqual(far);
  });

  it("pushes nearby marks outward along their own bearing", () => {
    const moved = lensDisplace(field(), { x: 50, y: 0 }, 1);
    expect(moved.x).toBeGreaterThan(50);
    expect(moved.y).toBeCloseTo(0);
  });

  it("never lets one mark overtake another — distance order is preserved", () => {
    const f = field();
    let previous = -Infinity;
    for (let d = 0; d <= 200 * LENS_REACH + 50; d += 2) {
      const out = lensDisplace(f, { x: d, y: 0 }, 1).x;
      expect(out).toBeGreaterThan(previous);
      previous = out;
    }
  });
});

describe("lens inverse — a tap lands on the true point under the finger", () => {
  it("undoes the displacement everywhere it acts", () => {
    const f = field({ x: 30, y: -10, strength: 0.8 });
    for (const [x, y] of [[31, -10], [80, 40], [-120, 90], [200, -300], [30, 400]]) {
      const shown = lensDisplace(f, { x, y }, 0.5);
      const back = lensInverse(f, shown, 0.5);
      expect(back.x).toBeCloseTo(x, 4);
      expect(back.y).toBeCloseTo(y, 4);
    }
  });

  it("is the identity without a field", () => {
    expect(lensInverse(null, { x: 3, y: 4 }, 1)).toEqual({ x: 3, y: 4 });
  });
});

describe("hit targets follow what is visible", () => {
  it("refuses marks that are faded out or too small to catch", () => {
    expect(isInteractable(1, 10)).toBe(true);
    expect(isInteractable(0.2, 10)).toBe(false);
    expect(isInteractable(1, 1.5)).toBe(false);
  });
});
