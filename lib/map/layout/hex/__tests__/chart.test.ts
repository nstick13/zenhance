/**
 * **The orderly end of the dial** — what a dragged branch turns into when the
 * hand has taken it far enough from the master centre for the master centre to
 * stop mattering.
 *
 * Greg, 2026-10-17: *"the more orderly the child tree becomes. Orderly here is
 * 'it starts to look like a normal org chart'."* So the properties here are the
 * ones that make it a chart rather than merely a layout: rows by rung, every
 * parent centred over its own children, and nobody on top of anybody.
 *
 * The two axes get a test of their own, because the whole file rests on them: a
 * hexagonal lattice has no two directions at right angles, but it has two
 * *steps* that are — and if that is wrong the chart is sheared and nobody would
 * notice from the code.
 */
import { describe, expect, it } from "vitest";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { ACROSS, ALONG, chartShape } from "@/lib/map/layout/hex/chart";
import { cellKey, cellToWorld, hexDistance, rotateCell, type Cell } from "@/lib/map/layout/hex/coords";

const ORIGIN: Cell = { q: 0, r: 0 };

/** Cells within `r` rings, inclusive, and the radius a body of `n` needs — the
 *  same two the layout uses, recomputed here so the test does not borrow the
 *  thing it is checking. */
const disc = (r: number): number => 3 * r * r + 3 * r + 1;
const ringsFor = (units: number): number => {
  let r = 0;
  while (disc(r) < Math.max(1, units)) r++;
  return r;
};

const treeOf = (people: number, maxDepth: number): OrbitalTree => {
  const org = buildDeepOrg("hexlab", { people, maxDepth, seed: 7 });
  return buildOrbitalTree(
    {
      units: org.units.map((u) => ({
        id: u.id, name: u.name, parentId: u.parentId ?? null,
        leadPersonId: u.leadPersonId ?? null,
      })),
      people: org.people.map((p) => ({ id: p.id, name: p.name })),
      assignments: org.assignments.map((a) => ({
        personId: a.personId, orgUnitId: a.orgUnitId, allocationPct: a.allocationPct ?? 100,
      })),
    },
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
};

/** A branch worth charting: the biggest thing with structure under it. */
const anchorIn = (tree: OrbitalTree) =>
  [...tree.units.values()]
    .filter((u) => u.parentId && u.childIds.length > 1)
    .sort((a, b) => b.totalSeats - a.totalSeats)[0];

describe("the two axes the chart is built on", () => {
  /**
   * `cellToWorld` puts a cell at `(1.5q, √3(r + q/2))`. So a step of `(+2, −1)`
   * changes world x and leaves world y exactly where it was, and `(0, +1)` does
   * the opposite. They are two cells and one cell of lattice distance
   * respectively, and they are at right angles — which is the only reason an
   * org chart on a honeycomb can be square rather than sheared.
   */
  it("moves purely sideways along ACROSS, and purely up and down along ALONG", () => {
    for (const from of [ORIGIN, { q: 3, r: -5 }, { q: -7, r: 2 }]) {
      const here = cellToWorld(from, 1);
      const across = cellToWorld({ q: from.q + ACROSS.q, r: from.r + ACROSS.r }, 1);
      const along = cellToWorld({ q: from.q + ALONG.q, r: from.r + ALONG.r }, 1);
      expect(across.y).toBeCloseTo(here.y, 9);
      expect(across.x).toBeGreaterThan(here.x);
      expect(along.x).toBeCloseTo(here.x, 9);
      expect(along.y).toBeGreaterThan(here.y);
    }
  });

  it("keeps them at right angles however many sixths the chart is turned", () => {
    for (let turns = 0; turns < 6; turns++) {
      const a = cellToWorld(rotateCell(ACROSS, ORIGIN, turns), 1);
      const b = cellToWorld(rotateCell(ALONG, ORIGIN, turns), 1);
      // Scaled by their own lengths, the dot product of two right angles is
      // nought: a turn is a rotation, so this holds or `rotateCell` is wrong.
      const dot = (a.x * b.x + a.y * b.y)
        / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      expect(Math.abs(dot)).toBeLessThan(1e-9);
    }
  });
});

describe("it reads as a chart", () => {
  const tree = treeOf(1000, 8);
  const people = new Set(
    [...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id),
  );
  const anchor = anchorIn(tree);
  const chart = chartShape({ tree, anchorId: anchor.id, people });

  it("puts the node you grabbed at the origin of its own chart", () => {
    expect(chart.offsets.get(anchor.id)).toEqual(ORIGIN);
  });

  it("gives every rung its own row, each one further out than the last", () => {
    /** How far along the row axis a cell sits. `ACROSS` is two cells of q per
     *  step, so this is just q halved — read off the offset rather than
     *  recomputed, so a change to the axis fails this test. */
    const row = (cell: Cell) => cell.q / ACROSS.q;
    const deepest = new Map<number, number>();
    for (const [id, offset] of chart.offsets) {
      const depth = (tree.units.get(id)?.depth ?? 0) - anchor.depth;
      const was = deepest.get(depth);
      if (was === undefined) deepest.set(depth, row(offset));
      else expect(row(offset)).toBeCloseTo(was, 9);
    }
    const rungs = [...deepest.keys()].sort((a, b) => a - b);
    expect(rungs.length).toBeGreaterThan(2);
    for (let i = 1; i < rungs.length; i++) {
      expect(deepest.get(rungs[i])!).toBeGreaterThan(deepest.get(rungs[i - 1])!);
    }
  });

  it("centres every parent over its own children", () => {
    /** Position along the lane axis. */
    const lane = (cell: Cell) => cell.r + cell.q / 2;
    let checked = 0;
    for (const [id, offset] of chart.offsets) {
      const kids = (tree.units.get(id)?.childIds ?? [])
        .filter((kid) => chart.offsets.has(kid))
        .map((kid) => lane(chart.offsets.get(kid)!));
      if (kids.length < 2) continue;
      checked++;
      const middle = (Math.min(...kids) + Math.max(...kids)) / 2;
      // Within half a cell: lanes are whole cells and a parent over an even
      // number of children falls between two of them.
      expect(Math.abs(lane(offset) - middle)).toBeLessThanOrEqual(0.5);
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("puts nobody on top of anybody", () => {
    const seen = new Set<string>();
    for (const offset of chart.offsets.values()) {
      expect(seen.has(cellKey(offset))).toBe(false);
      seen.add(cellKey(offset));
    }
  });

  it("charts the structure and not the people", () => {
    for (const id of chart.offsets.keys()) expect(people.has(id)).toBe(false);
    // And it charted something: a branch of one node would prove nothing.
    expect(chart.offsets.size).toBeGreaterThan(5);
  });

  it("says how big it is, because that is the honest objection to it", () => {
    // A tidy tree's width grows with its leaves, so a chart of a large branch
    // is wide — much wider than the radial picture it replaces. The number is
    // reported rather than hidden so the lab can show it and a reader can
    // decide whether charting that branch was a good idea.
    expect(chart.width).toBeGreaterThan(0);
    expect(chart.rows).toBeGreaterThan(1);
  });

  it("is the same chart every time, and does not care about input order", () => {
    const again = chartShape({ tree, anchorId: anchor.id, people });
    for (const [id, offset] of chart.offsets) expect(again.offsets.get(id)).toEqual(offset);
    const reversed: OrbitalTree = {
      ...tree,
      units: new Map([...tree.units.entries()].reverse()),
    };
    const other = chartShape({ tree: reversed, anchorId: anchor.id, people });
    for (const [id, offset] of chart.offsets) expect(other.offsets.get(id)).toEqual(offset);
  });
});

describe("room for the crowd", () => {
  /**
   * A node's lane is as wide as its own body, which is itself plus the people
   * who hang off it. Otherwise a fifty-person team and a lone node would be
   * given the same single lane and the crowd would have to spill into the next
   * branch along — the fault that cost 260 of 395 teams when the radial driver
   * got the equivalent wrong.
   */
  it("leaves room beside a node for the crowd that hangs off it", () => {
    const tree = treeOf(1000, 8);
    const people = new Set(
      [...tree.units.values()].filter((u) => !u.childIds.length).map((u) => u.id),
    );
    const anchor = anchorIn(tree);
    const chart = chartShape({ tree, anchorId: anchor.id, people });

    /**
     * **Asserted as clear ground beside the node, not as a wider lane.**
     *
     * Two earlier versions of this test compared mean gaps between siblings and
     * both measured backwards — 6.7 lanes against 45, then 6 against 10 — for
     * two different honest reasons: a lane is the width of a node's whole
     * subtree, and a gap between two siblings is paid for by both of them, so
     * neither number is about crowds at all. What the chart actually owes a
     * fifty-person team is **somewhere for fifty people to stand**, so that is
     * what is measured: how far the nearest other node is.
     */
    let checked = 0;
    for (const [id, offset] of chart.offsets) {
      const crowd = (tree.units.get(id)?.childIds ?? []).filter((k) => people.has(k)).length;
      if (crowd < 2) continue;
      checked++;
      let nearest = Infinity;
      for (const [other, there] of chart.offsets) {
        if (other === id) continue;
        nearest = Math.min(nearest, hexDistance(offset, there));
      }
      // The crowd packs into a disc of this radius round its node, and needs
      // its own clear hexagon beyond that — the spacer, from `spacing.ts`.
      const needs = ringsFor(1 + crowd) + 1;
      expect(nearest).toBeGreaterThanOrEqual(needs);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("holds the rows apart by the clear ring the nodes keep", () => {
    const tree = treeOf(45, 4);
    const chart = chartShape({ tree, anchorId: tree.rootId });
    for (const [id, offset] of chart.offsets) {
      for (const [other, there] of chart.offsets) {
        if (id === other) continue;
        // Two structural nodes may never touch — Law 4's spacer, which the
        // chart has to honour like everything else.
        expect(hexDistance(offset, there)).toBeGreaterThan(1);
      }
    }
  });
});
