/**
 * The hex lattice, and the promises it makes (2026-09-29, renumbered
 * 2026-10-15).
 *
 * **The hex map answers to one law set, and it is `docs/MAP-LAWS.md`.** The
 * orbital engine's own four laws do not apply here and are not cited here.
 *
 * That is not pedantry, and this file is the reason it had to be written down.
 * The two sets share the word "law" and their numbers *collide*: the orbital
 * set's Law 4 is "never overlap two bodies", while the map's Law 4 is "one
 * measure of distance". This file carried the orbital numbering from the day
 * the study began, so a test here called *"Law 4 — nothing sits on top of
 * anything else"* was proving what the map calls **Law 1**. Greg, 2026-10-15:
 * *"on Hex we should not be observing old laws or codes — almost at all. Hex
 * should almost be a completely clean build inspired by, but not copying, the
 * earlier orbital model."*
 *
 * What this file holds:
 *
 *   Map Law 1 — one cell, one unit
 *   The standing requirement that the picture is a pure function of the company
 *
 * Purity is **not** a numbered map law. It was the orbital engine's Law 1, it
 * is still true and still worth proving, and it now lives in `MAP-LAWS.md` as a
 * standing requirement instead of borrowing a number that means something else.
 */
import { describe, expect, it } from "vitest";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import {
  DIRECTIONS,
  cellKey,
  cellToWorld,
  corners,
  cornersAt,
  hexDistance,
  inradius,
  neighbours,
  ring,
  ringArc,
  ringCell,
  spiral,
  spiralSize,
  worldToCell,
  worldAngle,
  axialRoute,
  type Cell,
} from "@/lib/map/layout/hex/coords";
import { allocateByTerritory as allocate } from "@/lib/map/layout/hex/territory";
import {
  contentRadius, hexSizeFor, layoutHex, nodeAreaFraction, nodeScale,
} from "@/lib/map/layout/hex/scene";

const deep = (
  people: number,
  maxDepth: number,
  span?: [number, number],
  seed = 7,
): OrgInput => {
  const org = buildDeepOrg("hex-test", { people, maxDepth, seed, span });
  return { units: org.units, people: org.people, assignments: org.assignments };
};
const treeOf = (input: OrgInput) =>
  buildOrbitalTree(input, { mergePassThroughRoot: false, workCountFor: () => 6 });

const COMPANIES: [string, OrgInput][] = [
  ["a ten-person company", deep(10, 2)],
  ["a forty-five-person company", deep(45, 4)],
  ["a thousand-person company", deep(1000, 8)],
  ["the 2,562-person company", deep(2400, 11)],
];

describe("the lattice", () => {
  it("puts a cell's six neighbours all one step away", () => {
    for (const n of neighbours({ q: 3, r: -2 })) {
      expect(hexDistance({ q: 3, r: -2 }, n)).toBe(1);
    }
  });

  it("gives ring n exactly 6n cells, every one n steps out", () => {
    for (let k = 1; k <= 6; k++) {
      const cells = ring({ q: 0, r: 0 }, k);
      expect(cells).toHaveLength(6 * k);
      for (const c of cells) expect(hexDistance({ q: 0, r: 0 }, c)).toBe(k);
      // and no cell appears twice
      expect(new Set(cells.map(cellKey)).size).toBe(6 * k);
    }
  });

  it("counts a spiral as 1, 7, 19, 37", () => {
    expect([0, 1, 2, 3].map(spiralSize)).toEqual([1, 7, 19, 37]);
    for (let k = 0; k <= 5; k++) expect(spiral({ q: 0, r: 0 }, k)).toHaveLength(spiralSize(k));
  });

  it("round-trips a cell through world space and back", () => {
    for (let q = -14; q <= 14; q++) {
      for (let r = -14; r <= 14; r++) {
        const back = worldToCell(cellToWorld({ q, r }, 137), 137);
        expect(back).toEqual({ q, r });
      }
    }
  });

  it("puts neighbouring cell centres exactly two inradii apart", () => {
    const size = 91;
    for (const d of DIRECTIONS) {
      const a = cellToWorld({ q: 0, r: 0 }, size);
      const b = cellToWorld(d, size);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(inradius(size) * 2, 6);
    }
  });

  it("keeps an inset hexagon concentric with its cell", () => {
    // The bug of 2026-09-30: drawing a smaller hexagon by calling
    // `corners(cell, size * 0.9)` moved its centre a tenth of the way toward
    // the origin, so the parent tile wore a visibly displaced dark band.
    const size = 80;
    const cell = { q: 5, r: -3 };
    const centre = cellToWorld(cell, size);
    const inset = cornersAt(centre, size * 0.86);
    const mid = {
      x: inset.reduce((t, p) => t + p.x, 0) / 6,
      y: inset.reduce((t, p) => t + p.y, 0) / 6,
    };
    expect(mid.x).toBeCloseTo(centre.x, 6);
    expect(mid.y).toBeCloseTo(centre.y, 6);
    for (const p of inset) {
      expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(size * 0.86, 6);
    }
  });

  it("draws six corners, each one circumradius from the centre", () => {
    const size = 60;
    const centre = cellToWorld({ q: 2, r: -1 }, size);
    const pts = corners({ q: 2, r: -1 }, size);
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(size, 6);
  });
});

/**
 * **Finding a way into a ring instead of sweeping it.**
 *
 * `ringArc` is what makes the radial driver's absolute placement affordable: a
 * ring 120 out holds 720 cells, every spacer question is a spiral of its own,
 * and the placer only ever wants the handful of cells lying in one direction.
 *
 * These are not tidiness tests. **A narrowing that quietly changes which cells
 * are eligible is what defeated the first attempt at absolute arcs**
 * (HEX-LAYOUT.md, 2026-10-17): it bought a twentyfold speedup and put 1,249
 * spacer breaches back, and it took a day to connect the two. So the fast answer
 * is held to the slow one here, exhaustively, rather than spot-checked.
 */
describe("the cells of a ring that lie in one direction", () => {
  const ORIGIN: Cell = { q: 0, r: 0 };
  const TURN = 2 * Math.PI;
  const off = (a: number, b: number) => {
    const d = Math.abs(a - b) % TURN;
    return d > Math.PI ? TURN - d : d;
  };

  it("hands back the same cells as walking the ring, one at a time", () => {
    for (let radius = 0; radius <= 40; radius++) {
      const walked = ring(ORIGIN, radius);
      for (let i = 0; i < walked.length; i++) {
        expect(ringCell(ORIGIN, radius, i)).toEqual(walked[i]);
      }
    }
  });

  it("is monotone round the ring, which is the fact the bisection rests on", () => {
    // Measured as how far round from the first cell, not as the bearing itself:
    // the last cell of every ring is due west, which `atan2` reports as +π
    // rather than −π, so the raw bearing has exactly one seam and the turn from
    // the first cell has none.
    for (let radius = 1; radius <= 120; radius++) {
      const first = worldAngle(ORIGIN, ringCell(ORIGIN, radius, 0), 1);
      const round = (i: number) => {
        const a = worldAngle(ORIGIN, ringCell(ORIGIN, radius, i), 1);
        return (((first - a) % TURN) + TURN) % TURN;
      };
      for (let i = 1; i < 6 * radius; i++) expect(round(i)).toBeGreaterThan(round(i - 1));
    }
  });

  it("returns exactly the cells the brute-force filter would, over 11,520 arcs", () => {
    let checks = 0;
    for (let radius = 1; radius <= 60; radius++) {
      for (let b = 0; b < 24; b++) {
        // Offset off the lattice's own angles on purpose: a bearing that lands
        // exactly on a cell is the easy case.
        const bearing = -Math.PI + (b / 24) * TURN + 0.013;
        for (const half of [0.001, 0.02, 0.1, 0.4, 1, 2, 3, Math.PI]) {
          checks++;
          const want = ring(ORIGIN, radius)
            .filter((c) => off(worldAngle(ORIGIN, c, 1), bearing) <= half)
            .map(cellKey)
            .sort();
          const got = ringArc(ORIGIN, radius, bearing, half)
            .filter((g) => g.inside)
            .map((g) => cellKey(g.cell))
            .sort();
          expect(got).toEqual(want);
        }
      }
    }
    expect(checks).toBe(11520);
  });

  it("gives them nearest the centre line first, so a caller can stop early", () => {
    for (let radius = 1; radius <= 30; radius += 3) {
      const got = ringArc(ORIGIN, radius, 0.37, 1.1);
      for (let i = 1; i < got.length; i++) {
        expect(got[i].off).toBeGreaterThanOrEqual(got[i - 1].off);
      }
    }
  });

  it("hands back the single nearest cell, flagged, when the arc holds none", () => {
    // An arc narrower than the gap between two cells contains neither of them.
    // The caller has to be able to tell that from an arc that is simply empty,
    // because a unit with a sliver of arc still has to be seated somewhere.
    for (let radius = 1; radius <= 30; radius++) {
      const got = ringArc(ORIGIN, radius, 0.37, 1e-6);
      expect(got).toHaveLength(1);
      expect(got[0].inside).toBe(false);
      expect(hexDistance(ORIGIN, got[0].cell)).toBe(radius);
      const best = Math.min(...ring(ORIGIN, radius).map((c) => off(worldAngle(ORIGIN, c, 1), 0.37)));
      expect(got[0].off).toBeCloseTo(best, 9);
    }
  });
});

describe("connection lines run along the lattice's own angles", () => {
  const SIZE = 40;
  /** The six directions a flat-top lattice offers, in degrees. */
  const AXES = [30, 90, 150, 210, 270, 330];
  const headings = (points: { x: number; y: number }[]): number[] =>
    points.slice(1).map((p, i) => {
      const a = points[i];
      const deg = (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
      return ((deg % 360) + 360) % 360;
    });

  it("draws a single straight run between neighbours", () => {
    for (const d of DIRECTIONS) {
      const route = axialRoute({ q: 0, r: 0 }, d, SIZE);
      expect(route).toHaveLength(2);
    }
  });

  it("never runs along anything but the six axes", () => {
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        for (const h of headings(axialRoute({ q: 0, r: 0 }, { q, r }, SIZE))) {
          expect(AXES.some((axis) => Math.abs(h - axis) < 1e-6)).toBe(true);
        }
      }
    }
  });

  it("bends at most once", () => {
    for (let q = -8; q <= 8; q++) {
      for (let r = -8; r <= 8; r++) {
        expect(axialRoute({ q: 0, r: 0 }, { q, r }, SIZE).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("starts and ends exactly on the two cell centres", () => {
    const route = axialRoute({ q: 2, r: -5 }, { q: -3, r: 4 }, SIZE);
    expect(route[0]).toEqual(cellToWorld({ q: 2, r: -5 }, SIZE));
    expect(route.at(-1)).toEqual(cellToWorld({ q: -3, r: 4 }, SIZE));
  });

  it("leaves along the direction it is mostly heading", () => {
    // Four steps east-ish, one step south-east: the first run is the long one.
    const route = axialRoute({ q: 0, r: 0 }, { q: 4, r: 1 }, SIZE);
    expect(route).toHaveLength(3);
    const first = Math.hypot(route[1].x - route[0].x, route[1].y - route[0].y);
    const second = Math.hypot(route[2].x - route[1].x, route[2].y - route[1].y);
    expect(first).toBeGreaterThanOrEqual(second);
  });
});

describe("the picture is a pure function of the company", () => {
  it("gives identical cells for the same company, every time", () => {
    const tree = treeOf(deep(1000, 8));
    const a = allocate(tree);
    const b = allocate(tree);
    for (const [id, cell] of a.cells) expect(b.cells.get(id)).toEqual(cell);
    expect(b.cells.size).toBe(a.cells.size);
  });

  it("does not depend on the order the company arrived in", () => {
    const input = deep(1000, 8);
    const forwards = allocate(treeOf(input));
    const backwards = allocate(
      treeOf({ ...input, units: [...input.units].reverse(), people: [...input.people].reverse() }),
    );
    for (const [id, cell] of forwards.cells) expect(backwards.cells.get(id)).toEqual(cell);
  });
});

describe("Law 1 — one cell, one unit, and nothing drawn on top of anything", () => {
  it.each(COMPANIES)("gives every unit in %s its own cell", (_name, input) => {
    const tree = treeOf(input);
    const a = allocate(tree);
    expect(a.cells.size).toBe(tree.units.size);
    expect(a.occupants.size).toBe(tree.units.size);
  });

  it.each(COMPANIES)("draws %s with no unit disc touching another", (_name, input) => {
    const scene = layoutHex(treeOf(input));
    for (let i = 0; i < scene.units.length; i++) {
      for (let j = i + 1; j < scene.units.length; j++) {
        const a = scene.units[i];
        const b = scene.units[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  /**
   * Measured against the *hexagon*, not a circle inside it.
   *
   * Until 2026-10-02 this used the cell's inradius, which is the largest
   * circle that fits — a safe bound while people sat on circular rings, and
   * far too tight once they sit on hexagonal ones: a person near a corner of
   * the cell is legitimately further from the centre than the inradius and
   * still well inside their own tile. The honest test is the one the rule
   * actually makes, so the containment is computed here from the six edge
   * normals rather than borrowed from the layout.
   */
  it.each(COMPANIES)("keeps every person inside their own unit's cell in %s", (_name, input) => {
    for (const density of ["roomy", "tight"] as const) {
      const scene = layoutHex(treeOf(input), { density });
      const edge = inradius(hexSizeFor(density));
      for (const seat of scene.seats) {
        const unit = scene.unitById.get(seat.unitId);
        if (!unit) continue;
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const reach =
            (seat.x - unit.x) * Math.cos(a) + (seat.y - unit.y) * Math.sin(a) + seat.r;
          expect(reach).toBeLessThanOrEqual(edge + 1e-6);
        }
      }
    }
  });

  /** Greg, 2026-10-02: *"They do not sit 'inside' the team node."* */
  it.each(COMPANIES)("keeps every person outside their own unit's node in %s", (_name, input) => {
    for (const density of ["roomy", "tight"] as const) {
      const tree = treeOf(input);
      const scene = layoutHex(tree, { density });
      const deepest = Math.max(...scene.units.map((u) => u.depth));
      for (const seat of scene.seats) {
        const unit = scene.unitById.get(seat.unitId);
        if (!unit) continue;
        const nodeEdge = inradius(hexSizeFor(density) * nodeScale(unit.depth, deepest));
        let clear = false;
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const reach =
            (seat.x - unit.x) * Math.cos(a) + (seat.y - unit.y) * Math.sin(a) - seat.r;
          if (reach >= nodeEdge - 1e-6) clear = true;
        }
        expect(clear).toBe(true);
      }
    }
  });
});

/**
 * Greg, 2026-10-06: *"does a human node touch its sibling in space — are any of
 * the vertexes of the human node hexagon touching a sibling? The grid is
 * non-Euclidean, it's hexagonal, so measuring spacing on one axis, when there
 * are three, will give room for error."*
 *
 * The worry is exactly right for a square grid, where two cells can share a
 * corner without sharing a side and "next to" means two different things. On a
 * honeycomb it cannot happen: **three** hexagons meet at every vertex, and all
 * three pairs among them share an edge. So touching at a corner and touching
 * along a side are the same relation, and `neighbours()` is the whole of it.
 *
 * It is the reason the lattice was chosen (see `coords.ts`), and it is worth a
 * test rather than an assurance, because every spacing rule in the engine
 * counts rings and would be quietly wrong if it were not true.
 */
describe("touching means one thing on this lattice", () => {
  /** The six corners of a cell's hexagon, rounded so they can be compared. */
  const cornersOf = (cell: { q: number; r: number }): string[] => {
    const c = cellToWorld(cell, 100);
    return Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i;
      return `${Math.round(c.x + 100 * Math.cos(a))},${Math.round(c.y + 100 * Math.sin(a))}`;
    });
  };

  it("gives a neighbour exactly two shared corners, and nobody else any", () => {
    const home = { q: 3, r: -2 };
    const mine = new Set(cornersOf(home));
    const touching = new Set(neighbours(home).map(cellKey));
    for (const other of spiral(home, 4)) {
      if (cellKey(other) === cellKey(home)) continue;
      const shared = cornersOf(other).filter((c) => mine.has(c)).length;
      if (touching.has(cellKey(other))) {
        // A side is two corners. Never one — that would be a corner-only touch.
        expect(shared).toBe(2);
      } else {
        // Everything else is genuinely clear of it, corners included.
        expect(shared).toBe(0);
      }
    }
  });

  it("has no diagonal: one clear ring really is clear", () => {
    // The property every spacing rule in the engine leans on. A cell two rings
    // out shares no corner with home, so "one clear tile between them" means
    // the hexagons do not meet at any point whatsoever.
    const home = { q: 0, r: 0 };
    const mine = new Set(cornersOf(home));
    for (const other of ring(home, 2)) {
      expect(cornersOf(other).some((c) => mine.has(c))).toBe(false);
    }
  });
});

/**
 * **Re-based on the atlas, 2026-10-15**, when the archipelago allocator was
 * deleted. Greg: *"remove the 'archipelago' view — let's use everything via
 * Atlas. One view mechanic for now."*
 *
 * Every number in this block used to be the archipelago's, and the two engines
 * are not alike: the archipelago packed cells tight, and the atlas reserves
 * ground for a family before it places anybody. So most of what was here was
 * deleted rather than loosened — a test whose bar is lowered until it passes
 * has stopped saying anything — and what remains is what still holds a promise
 * somebody cares about.
 *
 * The cohesion numbers the atlas owes are in `territory.test.ts`, which has
 * always measured the engine we actually ship.
 */
describe("the cells a company gets", () => {
  it("gives every unit its own cell, and nobody is lost", () => {
    const tree = treeOf(deep(2400, 11));
    const a = allocate(tree);
    expect(a.cells.size).toBe(tree.units.size);
    expect(a.occupants.size).toBe(tree.units.size);
  });

  it("seats no more children against a parent than a hexagon has sides", () => {
    // Not a rule anybody chose — a cell has six neighbours, so the seventh
    // child of any unit has to reach its parent past a sibling. It is the limit
    // the whole study exists to find out about.
    const tree = treeOf(deep(2400, 11));
    const a = allocate(tree);
    for (const unit of tree.units.values()) {
      const own = a.cells.get(unit.id);
      if (!own) continue;
      let touching = 0;
      for (const kid of unit.childIds) {
        const c = a.cells.get(kid);
        if (c && hexDistance(c, own) === 1) touching++;
      }
      expect(touching, unit.name).toBeLessThanOrEqual(6);
    }
  });

  /**
   * **The study's headline claim, corrected.**
   *
   * `HEX-LAYOUT.md` opened by saying the same company fits in 8,500 x 8,900
   * against the orbital layout's 39,842 x 57,611. That was the **archipelago**,
   * which packed cells tight, and it is no longer what runs. Measured on the
   * 2,562-person company with the atlas:
   *
   *   tight   41,397 x 25,939   1.04x as wide as the orbital layout, 0.45x as tall
   *   roomy   69,419 x 43,498   1.74x as wide, 0.76x as tall
   *
   * So at the density the lab actually opens on, **the atlas covers about a
   * third more ground than the layout it replaced.** It buys that back in
   * legibility — reserved ground is what keeps a team in one piece — but the
   * compactness win belonged to the engine that was deleted, and a test that
   * went on asserting it would be asserting something false.
   *
   * This is held as a ceiling with room under it, so that a change which makes
   * the map dramatically bigger still has to answer for itself.
   */
  it("stays within a known extent, which is bigger than it used to be", () => {
    const scene = layoutHex(treeOf(deep(2400, 11)), { density: "tight" });
    const b = scene.bounds!;
    expect(b.maxX - b.minX).toBeLessThan(50_000);
    expect(b.maxY - b.minY).toBeLessThan(35_000);
  });
});

describe("a company that branches wider than a hexagon has sides", () => {
  /**
   * The case Greg's model is actually about: *"If a node has six child nodes,
   * great — it's a hexagon tessellation. If more, then we can move child nodes
   * to 'jump' to the next one."*
   *
   * Until 2026-09-29 no fixture could reach it. Every company we owned —
   * Northwind, Digital Tailoring, Sparrow Jam — was capped at four children
   * anywhere, so the jump was untested and unseen. This one branches 8 to 16,
   * which is the shape a real org has.
   */
  const wide = deep(1200, 6, [8, 16]);

  it("actually contains parents with more than six children", () => {
    const tree = treeOf(wide);
    const over = [...tree.units.values()].filter((u) => u.childIds.length > 6);
    expect(over.length).toBeGreaterThan(5);
  });

  it("still gives every unit its own cell", () => {
    const tree = treeOf(wide);
    const a = allocate(tree);
    expect(a.cells.size).toBe(tree.units.size);
    expect(a.occupants.size).toBe(tree.units.size);
  });

  it("cannot seat more than six children against the parent itself", () => {
    const tree = treeOf(wide);
    const a = allocate(tree);
    for (const unit of tree.units.values()) {
      const touching = unit.childIds.filter((id) => (a.steps.get(id) ?? 99) === 1);
      /**
       * Six neighbours, and that is the whole ceiling. It used to be five for
       * any unit with a parent, because the archipelago kept one neighbour
       * clear as the way home. The atlas will use all six, and since 2026-10-15
       * a chain may pass behind a tile rather than needing open ground to leave
       * by — so the sixth seat costs a faded stretch of line instead of an
       * exclave. This is the geometry, and it is the limit the study exists to
       * find out about.
       */
      expect(touching.length).toBeLessThanOrEqual(6);
    }
  });

  it("still joins the overwhelming majority of a wide company to its family", () => {
    const a = allocate(treeOf(wide));
    // The number that used to collapse. Seating against siblings holds it at
    // 92% where seating against the parent alone managed 32%.
    expect(a.stats.connected / (a.stats.placed - 1)).toBeGreaterThan(0.85);
  });

  it("draws it with nothing on top of anything else", () => {
    const scene = layoutHex(treeOf(wide));
    for (let i = 0; i < scene.units.length; i++) {
      for (let j = i + 1; j < scene.units.length; j++) {
        const a = scene.units[i];
        const b = scene.units[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
      }
    }
  });
});

describe("how much of its cell a node fills", () => {
  /** Greg capped the top at 85% on 2026-10-02 so that even the company has a
   *  ring of its own cell left to stand people on. The floor is unchanged. */
  it("gives the company 85% of its cell and the deepest rung a tenth, by area", () => {
    expect(nodeAreaFraction(0, 12)).toBe(0.85);
    expect(nodeAreaFraction(12, 12)).toBeCloseTo(0.1, 12);
  });

  it("steps a three-rung company 85 / 47.5 / 10", () => {
    const [a, b, c] = [0, 1, 2].map((d) => nodeAreaFraction(d, 2));
    expect(a).toBe(0.85);
    expect(b).toBeCloseTo(0.475, 12);
    expect(c).toBeCloseTo(0.1, 12);
  });

  it("steps evenly however many rungs there are", () => {
    for (const max of [1, 2, 5, 12, 30]) {
      const steps = Array.from({ length: max }, (_, i) =>
        nodeAreaFraction(i, max) - nodeAreaFraction(i + 1, max));
      for (const step of steps) expect(step).toBeCloseTo(steps[0], 12);
    }
  });

  it("never grows with depth, and never leaves the cell", () => {
    for (const max of [1, 3, 12]) {
      for (let d = 0; d <= max; d++) {
        expect(nodeAreaFraction(d, max)).toBeLessThanOrEqual(1);
        expect(nodeAreaFraction(d, max)).toBeGreaterThanOrEqual(0.1 - 1e-12);
        if (d > 0) expect(nodeAreaFraction(d, max)).toBeLessThan(nodeAreaFraction(d - 1, max));
      }
    }
  });

  it("converts area to size through the square root, not by scaling the radius", () => {
    // A tenth of the area is 32% of the width. Using the area figure as a
    // radius scale would draw a team at one percent of what was asked for,
    // which is the whole reason this is two functions rather than one.
    expect(nodeScale(12, 12)).toBeCloseTo(Math.sqrt(0.1), 12);
    expect(nodeScale(0, 12)).toBeCloseTo(Math.sqrt(0.85), 12);
  });

  it("copes with a company of one rung", () => {
    expect(nodeAreaFraction(0, 0)).toBe(0.85);
    expect(nodeScale(0, 0)).toBeCloseTo(Math.sqrt(0.85), 12);
  });
});

describe("how much room a cell reserves", () => {
  it("makes a tight cell meaningfully smaller than a roomy one", () => {
    expect(contentRadius("tight")).toBeLessThan(contentRadius("roomy"));
    expect(hexSizeFor("tight") / hexSizeFor("roomy")).toBeLessThan(0.8);
  });

});
