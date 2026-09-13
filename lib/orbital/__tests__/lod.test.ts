import { describe, it, expect } from "vitest";
import { REVEAL_BANDS, lerp, revealAt, smoothstep, tierAt } from "../lod";

describe("smoothstep", () => {
  it("is flat at both ends, so a morph never snaps at the boundary", () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });

  it("eases in and out rather than running straight", () => {
    expect(smoothstep(0, 1, 0.1)).toBeLessThan(0.1);
    expect(smoothstep(0, 1, 0.9)).toBeGreaterThan(0.9);
  });

  it("clamps outside the band", () => {
    expect(smoothstep(2, 4, -10)).toBe(0);
    expect(smoothstep(2, 4, 99)).toBe(1);
  });

  it("does not divide by zero on a degenerate band", () => {
    expect(smoothstep(3, 3, 5)).toBe(1);
    expect(smoothstep(3, 3, 1)).toBe(0);
  });
});

describe("revealAt — the ladder Greg specified", () => {
  it("shows nothing but the company far out", () => {
    const r = revealAt(0.05);
    expect(r.deepUnits).toBe(0);
    expect(r.lead).toBe(0);
    expect(r.torus).toBe(0);
    expect(r.people).toBe(0);
    expect(r.workDots).toBe(0);
  });

  it("leaves only the lead below 1x — the node's point of contact", () => {
    const r = revealAt(0.85);
    expect(r.lead).toBe(1);
    expect(r.torus).toBeLessThan(0.05);
    expect(r.people).toBe(0);
  });

  it("stands a torus in for the people between 1x and 1.75x", () => {
    const r = revealAt(1.4);
    expect(r.torus).toBeGreaterThan(0.5);
    expect(r.people).toBe(0);
    expect(r.workDots).toBe(0);
  });

  it("hides work entirely below 1.75x", () => {
    for (const scale of [0.2, 0.8, 1.2, 1.7]) {
      const r = revealAt(scale);
      expect(r.workCapsule).toBeLessThan(0.05);
      expect(r.workDots).toBe(0);
    }
  });

  it("resolves the torus into people, which then carry capsules", () => {
    const r = revealAt(2.4);
    expect(r.people).toBe(1);
    expect(r.torus).toBe(0); // the stand-in has handed over
    expect(r.workCapsule).toBe(1);
    expect(r.workDots).toBe(0);
  });

  it("resolves the capsule into individual items above 3.5x", () => {
    const r = revealAt(4.5);
    expect(r.workDots).toBe(1);
    expect(r.workCapsule).toBe(0); // likewise
  });

  it("keeps names off the map until 5.5x", () => {
    expect(revealAt(4).labels).toBe(0);
    expect(revealAt(6.5).labels).toBe(1);
  });

  it("settles the rings onto their circles before the torus needs the orbit", () => {
    expect(revealAt(REVEAL_BANDS.torus[0]).ringSettle).toBeGreaterThan(0.95);
  });

  it("never runs outside 0..1 at any zoom", () => {
    for (const scale of [0.01, 0.1, 0.5, 1, 1.8, 3, 5, 12, 100]) {
      for (const v of Object.values(revealAt(scale))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rises monotonically for everything that isn't a stand-in", () => {
    let previous = revealAt(0.01);
    for (let scale = 0.02; scale < 8; scale += 0.02) {
      const next = revealAt(scale);
      expect(next.people).toBeGreaterThanOrEqual(previous.people - 1e-9);
      expect(next.workDots).toBeGreaterThanOrEqual(previous.workDots - 1e-9);
      expect(next.labels).toBeGreaterThanOrEqual(previous.labels - 1e-9);
      previous = next;
    }
  });

  it("hands over cleanly: a stand-in is gone once the real thing is out", () => {
    // Whatever the zoom, you never see both the torus and the people, nor
    // both the capsule and the items inside it.
    for (let scale = 0.5; scale < 6; scale += 0.05) {
      const r = revealAt(scale);
      expect(r.torus + r.people).toBeLessThanOrEqual(1.0001);
      expect(r.workCapsule + r.workDots).toBeLessThanOrEqual(1.0001);
    }
  });

  it("orders the bands the way the ladder is described", () => {
    expect(REVEAL_BANDS.lead[0]).toBeLessThan(REVEAL_BANDS.torus[0]);
    expect(REVEAL_BANDS.torus[1]).toBeLessThanOrEqual(REVEAL_BANDS.people[0]);
    expect(REVEAL_BANDS.people[1]).toBeLessThanOrEqual(REVEAL_BANDS.workDots[0]);
    expect(REVEAL_BANDS.workDots[1]).toBeLessThanOrEqual(REVEAL_BANDS.labels[0]);
  });
});

describe("tierAt", () => {
  it("names the rung for the HUD", () => {
    expect(tierAt(revealAt(0.05))).toBe("company");
    expect(tierAt(revealAt(0.25))).toBe("structure");
    expect(tierAt(revealAt(1.3))).toBe("teams");
    expect(tierAt(revealAt(2.4))).toBe("people");
    expect(tierAt(revealAt(5))).toBe("work");
  });
});

describe("lerp", () => {
  it("travels between the ends", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});
