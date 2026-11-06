/**
 * The zoom ladder's promises (2026-11-06).
 *
 * The reasoning is `docs/HEX-ZOOM.md`; these are the properties the drawing
 * leans on. The two that matter most are that **nothing pops** — every figure
 * is continuous, so a frame can never show a jump — and that **exactly one
 * rung is the place at any zoom**, which is what makes a conglomerate the same
 * mechanism as a team rather than a sixth special case.
 */
import { describe, expect, it } from "vitest";
import {
  HEX_LADDER,
  PEOPLE_AT_CELL_PX,
  cellPxOf,
  hexRevealAt,
  levelAt,
  placePresence,
  scaleForLevel,
  stepLevel,
  type HexLevel,
} from "@/lib/map/camera/hexLod";

const sweep = (from: number, to: number, steps = 400) =>
  Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);

/**
 * **A camera moves geometrically, so a sweep of one should too.** A wheel
 * notch multiplies the scale; stepping linearly from 0.01 to 10 spends almost
 * every sample at the zoomed-in end and crosses the outermost rung's whole
 * transition in a handful of them, which reads as a jump that is an artefact
 * of the sampling rather than of the ladder.
 */
const logSweep = (from: number, to: number, steps = 2000) =>
  Array.from({ length: steps + 1 }, (_, i) =>
    from * (to / from) ** (i / steps));

describe("one input: cell-pixels", () => {
  it("is the cell's circumradius on the glass", () => {
    expect(cellPxOf(100, 2.3)).toBeCloseTo(230);
    expect(cellPxOf(100, 0.04)).toBeCloseTo(4);
  });

  it("does not care how big the window is — that is the point", () => {
    // The same company at the same zoom reads the same on any screen; what
    // changes is how much of it you can see, which is handled by the window
    // being bigger, not by the threshold moving.
    expect(cellPxOf(50, 1)).toBe(cellPxOf(50, 1));
  });
});

describe("nothing pops", () => {
  it("every reveal runs 0 → 1 without a step in it", () => {
    const keys = ["people", "tiles", "names", "work"] as const;
    // Finely enough that the narrowest band — tiles, 11px wide — gets a
    // couple of hundred samples of its own.
    const xs = sweep(0, 700, 20_000);
    for (const key of keys) {
      let previous = hexRevealAt(xs[0])[key];
      for (const x of xs.slice(1)) {
        const now = hexRevealAt(x)[key];
        expect(now).toBeGreaterThanOrEqual(0);
        expect(now).toBeLessThanOrEqual(1);
        // Monotone, and no single step bigger than a twentieth.
        expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(now - previous).toBeLessThan(0.05);
        previous = now;
      }
    }
  });

  it("holds Greg's band for people: nothing at 140, everything at 230", () => {
    const [start, full] = PEOPLE_AT_CELL_PX;
    expect(hexRevealAt(start).people).toBe(0);
    expect(hexRevealAt(full).people).toBe(1);
    expect(hexRevealAt((start + full) / 2).people).toBeCloseTo(0.5, 5);
  });

  it("shows a tile before it shows its name, and a name before its work", () => {
    // Reading order on the way in. At any zoom you cannot have the later
    // thing without the earlier one.
    for (const x of sweep(0, 700)) {
      const r = hexRevealAt(x);
      expect(r.tiles).toBeGreaterThanOrEqual(r.names - 1e-9);
      expect(r.names).toBeGreaterThanOrEqual(r.work - 1e-9);
    }
  });
});

describe("exactly one rung is the place", () => {
  /** A company whose regions get three times wider at every rung out. */
  const nested = new Map([
    [0, 40],
    [1, 120],
    [2, 360],
    [3, 1080],
  ]);

  it("gives the innermost rung the place when you are close in", () => {
    // Zoomed right in, a team is 40 × 8 = 320px across: plainly a place, and
    // everything outside it is far too big to read as one.
    const p = placePresence(nested, 8);
    expect(p.get(0)).toBeCloseTo(1);
    expect(p.get(1)).toBeCloseTo(0);
    expect(p.get(2)).toBeCloseTo(0);
    expect(p.get(3)).toBeCloseTo(0);
  });

  it("hands the place outward as you pull back, one rung at a time", () => {
    const strongest = (scale: number) => {
      const p = placePresence(nested, scale);
      const [tier, strength] = [...p.entries()].sort((a, b) => b[1] - a[1])[0];
      return strength > 0.01 ? tier : null;
    };
    // Pulling back, the rung that holds the place only ever moves outward, and
    // never skips one. Where exactly each handover falls is a matter for the
    // threshold and for Greg's eye; that it happens in order is the design.
    const order: number[] = [];
    for (const scale of logSweep(10, 0.01)) {
      const tier = strongest(scale);
      if (tier !== null && tier !== order[order.length - 1]) order.push(tier);
    }
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("never lets two rungs both be fully the place", () => {
    for (const scale of sweep(0.001, 12, 600)) {
      const p = placePresence(nested, scale);
      const full = [...p.values()].filter((v) => v > 0.75);
      expect(full.length).toBeLessThanOrEqual(1);
    }
  });

  it("crossfades rather than swapping", () => {
    // Somewhere in the handover between rung 0 and rung 1 both are partly
    // present — that is the morph, and it is what stops the pop.
    const shared = sweep(0.05, 8, 400).some((scale) => {
      const p = placePresence(nested, scale);
      return (p.get(0) ?? 0) > 0.2 && (p.get(1) ?? 0) > 0.2;
    });
    expect(shared).toBe(true);
  });

  it("moves continuously with the camera", () => {
    const xs = logSweep(0.001, 20, 4000);
    for (const tier of [0, 1, 2, 3]) {
      let previous = placePresence(nested, xs[0]).get(tier) ?? 0;
      for (const scale of xs.slice(1)) {
        const now = placePresence(nested, scale).get(tier) ?? 0;
        // A wheel notch is about 1.1×, some 240 of these steps. Nothing the
        // eye could call a jump.
        expect(Math.abs(now - previous)).toBeLessThan(0.01);
        previous = now;
      }
    }
  });

  it("works on a company with only one rung of places", () => {
    // Sparrow Jam has no team of teams, and should never be given one.
    const flat = new Map([[0, 60]]);
    expect(placePresence(flat, 4).get(0)).toBeCloseTo(1);
    expect(placePresence(flat, 0.01).get(0)).toBeCloseTo(0);
    expect(placePresence(flat, 4).size).toBe(1);
  });

  it("works on eleven rungs, which is the whole point of deriving it", () => {
    const deep = new Map(Array.from({ length: 11 }, (_, i) => [i, 30 * 1.8 ** i]));
    // Every rung gets its turn as the place, somewhere in the range.
    const winners = new Set(
      sweep(0.002, 10, 1500).map((scale) => {
        const p = placePresence(deep, scale);
        const [tier, strength] = [...p.entries()].sort((a, b) => b[1] - a[1])[0];
        return strength > 0.5 ? tier : -1;
      }),
    );
    for (let tier = 0; tier < 11; tier++) expect(winners.has(tier)).toBe(true);
  });

  it("says nothing is a place when the whole company is a speck", () => {
    const p = placePresence(nested, 0.0001);
    for (const v of p.values()) expect(v).toBeCloseTo(0);
  });

  it("does not mind tiers that are missing or do not start at nought", () => {
    // Tier 2 is the innermost one this company has, so it is the one that
    // swells first; 2 × 100 = 200px is past the top of the band.
    const gappy = new Map([[2, 100], [5, 900]]);
    const p = placePresence(gappy, 2);
    expect([...p.keys()].sort()).toEqual([2, 5]);
    expect(p.get(2)).toBeCloseTo(1);
    expect(p.get(5)).toBeCloseTo(0);
    // And far enough out that only the outer one can be read, it takes over.
    const out = placePresence(gappy, 0.12);
    expect(out.get(2)).toBeCloseTo(0);
    expect(out.get(5)).toBeGreaterThan(0.5);
  });
});

describe("naming the rung you are on", () => {
  it("names each rung at its own cell-pixels", () => {
    for (const rung of HEX_LADDER) expect(levelAt(rung.cellPx)).toBe(rung.name);
  });

  it("picks the nearest rung in log space, because the ladder is geometric", () => {
    // Halfway between team (52) and person (230) is 110, not 141.
    expect(levelAt(109)).toBe("team");
    expect(levelAt(111)).toBe("person");
  });

  it("holds at both ends", () => {
    expect(levelAt(0.0001)).toBe("whole");
    expect(levelAt(100_000)).toBe("work");
  });

  it("round-trips through the scale that reaches it", () => {
    for (const hexSize of [12, 100, 7.5]) {
      for (const rung of HEX_LADDER) {
        const scale = scaleForLevel(rung.name, hexSize);
        expect(levelAt(cellPxOf(hexSize, scale))).toBe(rung.name);
      }
    }
  });
});

describe("stepping in and out", () => {
  it("steps to the next rung that is genuinely further than you are", () => {
    // Standing at 150px reads as `person`, but person is 230 — further in.
    // Stepping out must not land on 230, and stepping in must not skip it.
    expect(levelAt(150)).toBe("person");
    expect(stepLevel(150, "in")).toBe("person");
    expect(stepLevel(150, "out")).toBe("team");
  });

  it("walks the whole ladder from either end without sticking", () => {
    const seen: HexLevel[] = [];
    let cellPx = HEX_LADDER[HEX_LADDER.length - 1].cellPx;
    for (let i = 0; i < 10; i++) {
      const next = stepLevel(cellPx, "in");
      if (!next) break;
      seen.push(next);
      cellPx = HEX_LADDER.find((r) => r.name === next)!.cellPx;
    }
    expect(seen).toEqual(["function", "team", "person", "work"]);
  });

  it("runs out at both ends", () => {
    expect(stepLevel(HEX_LADDER[0].cellPx, "in")).toBeNull();
    expect(stepLevel(HEX_LADDER[HEX_LADDER.length - 1].cellPx, "out")).toBeNull();
  });
});
