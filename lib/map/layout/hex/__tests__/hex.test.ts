/**
 * The hex lattice, and the promises it makes (2026-09-29).
 *
 * Three of the orbital engine's four laws carry over to the grid unchanged,
 * because they are properties rather than geometry. They are re-proved here
 * against the new layout rather than assumed:
 *
 *   Law 1 — the picture is a pure function of the company
 *   Law 3 — (not applicable yet: nothing authors a hex placement by hand)
 *   Law 4 — nothing is drawn on top of anything else
 *
 * Law 2 ("a node lands exactly where the hand let go") has no meaning until
 * the study can be dragged, and its meaning will change when it does: on a
 * lattice a node lands in the *cell* under the hand. That is deliberately not
 * tested here — see docs/HEX-LAYOUT.md § Open risks.
 */
import { describe, expect, it } from "vitest";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import {
  DIRECTIONS,
  cellKey,
  cellToWorld,
  corners,
  hexDistance,
  inradius,
  neighbours,
  ring,
  spiral,
  spiralSize,
  worldToCell,
} from "@/lib/map/layout/hex/coords";
import { allocate } from "@/lib/map/layout/hex/allocate";
import { contentRadius, hexSizeFor, layoutHex } from "@/lib/map/layout/hex/scene";

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

  it("draws six corners, each one circumradius from the centre", () => {
    const size = 60;
    const centre = cellToWorld({ q: 2, r: -1 }, size);
    const pts = corners({ q: 2, r: -1 }, size);
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(size, 6);
  });
});

describe("Law 1 — the picture is a pure function of the company", () => {
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

describe("Law 4 — nothing sits on top of anything else", () => {
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

  it.each(COMPANIES)("keeps every person inside their own unit's hexagon in %s", (_name, input) => {
    for (const density of ["roomy", "tight"] as const) {
      const scene = layoutHex(treeOf(input), { density });
      const room = inradius(hexSizeFor(density));
      for (const seat of scene.seats) {
        const unit = scene.unitById.get(seat.unitId);
        if (!unit) continue;
        // The seat's own body, not just its centre, has to be inside. The
        // epsilon is float noise at the boundary: a seat on the outermost ring
        // lands on the edge by construction, and lands there to within 1e-13.
        expect(Math.hypot(seat.x - unit.x, seat.y - unit.y) + seat.r).toBeLessThanOrEqual(room + 1e-6);
      }
    }
  });
});

describe("the cells a company gets", () => {
  it("joins most children to their family, and says so when it cannot", () => {
    const a = allocate(treeOf(deep(2400, 11)));
    const children = a.stats.placed - 1;
    // 88% measured on 2026-09-30. The rest are exclaves, which rule 8 treats as
    // a legitimate arrangement rather than a failure.
    expect(a.stats.connected / children).toBeGreaterThan(0.8);
    expect(a.stats.connected + a.stats.exclaves).toBe(children);
  });

  it("keeps most families in one patch, which is all that says they are a family", () => {
    const a = allocate(treeOf(deep(2400, 11)));
    expect(a.stats.wholeFamilies / a.stats.families).toBeGreaterThan(0.6);
  });

  it("gives a small company a perfect tessellation", () => {
    const a = allocate(treeOf(deep(45, 4)));
    expect(a.stats.exclaves).toBe(0);
    expect(a.stats.wholeFamilies).toBe(a.stats.families);
  });

  it("records a jump as a real distance, so the renderer can curve the link", () => {
    const tree = treeOf(deep(2400, 11));
    const a = allocate(tree);
    for (const [unitId, steps] of a.steps) {
      const unit = tree.units.get(unitId);
      if (!unit?.parentId) continue;
      const cell = a.cells.get(unitId)!;
      const parent = a.cells.get(unit.parentId)!;
      expect(steps).toBe(hexDistance(cell, parent));
    }
  });

  it("grows a chain by its length, not exponentially", () => {
    const short = allocate(treeOf(deep(400, 6)));
    const long = allocate(treeOf(deep(400, 16)));
    expect(long.radius).toBeLessThan(short.radius * 4);
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
      // Six neighbours, one of which is the way home. This is the geometry, and
      // it is the ceiling rule 1 exists to get around.
      expect(touching.length).toBeLessThanOrEqual(unit.parentId ? 5 : 6);
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

describe("how much room a cell reserves", () => {
  it("makes a tight cell meaningfully smaller than a roomy one", () => {
    expect(contentRadius("tight")).toBeLessThan(contentRadius("roomy"));
    expect(hexSizeFor("tight") / hexSizeFor("roomy")).toBeLessThan(0.8);
  });

  it("packs a company far tighter than the orbital layout does", () => {
    const scene = layoutHex(treeOf(deep(2400, 11)), { density: "tight" });
    const b = scene.bounds!;
    // The river layout measures 39,842 x 57,611 on this company.
    expect(b.maxX - b.minX).toBeLessThan(39842 / 3);
    expect(b.maxY - b.minY).toBeLessThan(57611 / 3);
  });
});
