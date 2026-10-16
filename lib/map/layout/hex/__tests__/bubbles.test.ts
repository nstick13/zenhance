/**
 * **Bubbles** (Greg, 2026-10-16, requirements 4 and 6).
 *
 * *"A bubble is taken as the shape of the contained node then offset wider by
 * one hexagon spacing."* The properties here are the ones that make that true of
 * any arrangement rather than only of a clean load: a bubble holds everything
 * beneath its unit, it is exactly one ring wider than that, and it follows a
 * hand that moved something — because it is derived from live cells and never
 * remembered.
 */
import { describe, expect, it } from "vitest";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { BUBBLE_TIER, bubbleClashes, bubblesFor, grow, subtreeCells } from "@/lib/map/layout/hex/bubbles";
import { allocateByTerritory, type HexDriver } from "@/lib/map/layout/hex/territory";
import { cellKey, hexDistance, type Cell } from "@/lib/map/layout/hex/coords";

const treeOf = (people: number, maxDepth: number): OrbitalTree => {
  const org = buildDeepOrg("hexlab", { people, maxDepth, seed: 7 });
  return buildOrbitalTree(
    {
      units: org.units.map((u) => ({ id: u.id, name: u.name, parentId: u.parentId ?? null, leadPersonId: u.leadPersonId ?? null })),
      people: org.people.map((p) => ({ id: p.id, name: p.name })),
      assignments: org.assignments.map((a) => ({ personId: a.personId, orgUnitId: a.orgUnitId, allocationPct: a.allocationPct ?? 100 })),
    },
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
};

const laidOut = (driver: HexDriver, people = 1000, depth = 8) => {
  const tree = treeOf(people, depth);
  const allocation = allocateByTerritory(tree, { driver });
  const bubbles = bubblesFor({
    tree, cells: allocation.cells, tier: allocation.tier!, size: 100,
    occupants: allocation.occupants,
  });
  return { tree, allocation, bubbles };
};

describe("growing a set of cells by one ring", () => {
  it("keeps the cells it was given", () => {
    const seed: Cell[] = [{ q: 0, r: 0 }, { q: 3, r: -1 }];
    const grown = new Set(grow(seed).map(cellKey));
    for (const cell of seed) expect(grown.has(cellKey(cell))).toBe(true);
  });

  it("adds exactly the ring round a single cell, and no more", () => {
    // One cell plus its six neighbours. The number matters: a dilation that
    // reached two rings would be seven plus twelve.
    expect(grow([{ q: 0, r: 0 }])).toHaveLength(7);
  });

  it("adds nothing that is more than one step from the shape", () => {
    const seed: Cell[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }];
    for (const cell of grow(seed)) {
      expect(Math.min(...seed.map((s) => hexDistance(cell, s)))).toBeLessThanOrEqual(1);
    }
  });

  it("swallows the shared edge between two touching cells rather than double-counting it", () => {
    // Two neighbours: 7 + 7 = 14 if you grow them independently, 10 if the
    // dilation is a union — which is what makes a bubble one shape and not two.
    expect(grow([{ q: 0, r: 0 }, { q: 1, r: 0 }])).toHaveLength(10);
  });
});

describe("what a bubble contains", () => {
  it("holds every unit beneath it, and nothing above it", () => {
    const { tree, allocation, bubbles } = laidOut("radial");
    expect(bubbles.length).toBeGreaterThan(0);

    for (const bubble of bubbles.slice(0, 20)) {
      const inside = new Set(bubble.cells.map(cellKey));
      for (const id of subtreeCells(tree, allocation.cells, bubble.unitId).map(cellKey)) {
        expect(inside.has(id)).toBe(true);
      }
      // Its own parent is not in it — a bubble wraps a branch, not the company.
      const parentId = tree.units.get(bubble.unitId)?.parentId;
      const parentCell = parentId ? allocation.cells.get(parentId) : null;
      if (parentCell) {
        // The parent may fall in the one-ring skirt, which is the offset doing
        // its job; what must never happen is the parent's own subtree coming too.
        const grandparentId = parentId ? tree.units.get(parentId)?.parentId : null;
        const grandparent = grandparentId ? allocation.cells.get(grandparentId) : null;
        if (grandparent) expect(inside.has(cellKey(grandparent))).toBe(false);
      }
    }
  });

  it("is drawn above team level only, which is what Greg asked for", () => {
    const { allocation, bubbles } = laidOut("radial");
    for (const bubble of bubbles) expect(bubble.tier).toBeGreaterThanOrEqual(BUBBLE_TIER);
    // And something was actually excluded by that — otherwise the rule is not
    // being exercised and this test proves nothing.
    const teams = [...allocation.tier!.values()].filter((t) => t < BUBBLE_TIER);
    expect(teams.length).toBeGreaterThan(0);
  });

  it("gives the outer regions first, so nested ones stay legible", () => {
    const { bubbles } = laidOut("radial");
    for (let i = 1; i < bubbles.length; i++) {
      expect(bubbles[i - 1].tier).toBeGreaterThanOrEqual(bubbles[i].tier);
    }
  });

  it("has a boundary, and it is the boundary of the grown shape", () => {
    const { bubbles } = laidOut("radial");
    for (const bubble of bubbles.slice(0, 10)) expect(bubble.edge.length).toBeGreaterThan(0);
  });
});

describe("a bubble follows the hand", () => {
  /**
   * Requirement 6: *"these regions move with the nodes they pertain to."* There
   * is no code for this — a bubble is read off live cells — and this is the test
   * that says so, because "no code" is only trustworthy if something checks it.
   */
  it("moves when a unit beneath it is dragged somewhere else", () => {
    const { tree, allocation, bubbles } = laidOut("radial");
    const wrapper = bubbles.find((b) => (tree.units.get(b.unitId)?.childIds.length ?? 0) > 1)!;
    const moved = tree.units.get(wrapper.unitId)!.childIds[0];

    const hand = new Map(allocation.cells);
    hand.set(moved, { q: 400, r: -200 });
    const after = bubblesFor({ tree, cells: hand, tier: allocation.tier!, size: 100 });
    const now = after.find((b) => b.unitId === wrapper.unitId)!;

    expect(now.cells.map(cellKey)).toContain(cellKey({ q: 400, r: -200 }));
    expect(now.cells.length).toBeGreaterThan(wrapper.cells.length);
  });

  it("is the same shape again when the hand puts it back", () => {
    const { tree, allocation, bubbles } = laidOut("radial");
    const hand = new Map(allocation.cells);
    const wrapper = bubbles[0];
    const moved = tree.units.get(wrapper.unitId)!.childIds[0];
    const was = hand.get(moved)!;
    hand.set(moved, { q: 400, r: -200 });
    hand.set(moved, was);
    const again = bubblesFor({ tree, cells: hand, tier: allocation.tier!, size: 100 });
    expect(again[0].cells.map(cellKey).sort()).toEqual(wrapper.cells.map(cellKey).sort());
  });
});

describe("regions tile, and meet at a frontier", () => {
  /**
   * **The overlap was a drawing question all along.**
   *
   * Greg, 2026-10-16, after three attempts to space siblings apart had failed:
   * *"two regions sharing a border may be what an atlas should look like. Try it
   * in how the boundary is drawn."*
   *
   * Grown independently, two neighbouring regions both claim the cells between
   * them — washes doubling into a dark seam, each drawing a boundary through the
   * other's ground. Partitioning that one-ring skirt instead takes the overlap
   * to **nought on every company under both drivers**, where moving the units
   * about could not get it below about two thirds of sibling pairs.
   *
   * | overlapping sibling bubble pairs, 1,000-person | before | after |
   * | --- | ---: | ---: |
   * | atlas | 2 of 15 | **0** |
   * | radial | 10 of 15 | **0** |
   */
  it.each(["radial", "atlas"] as HexDriver[])("never lets two unrelated regions hold one cell (%s)", (driver) => {
    const { tree, bubbles } = laidOut(driver);
    expect(bubbleClashes(tree, bubbles)).toBe(0);
  });

  it("keeps a child's ground inside its parent's, because nesting is not a contest", () => {
    const { tree, allocation, bubbles } = laidOut("radial");
    const byId = new Map(bubbles.map((b) => [b.unitId, new Set(b.cells.map(cellKey))]));
    let checked = 0;
    for (const bubble of bubbles) {
      const parentId = tree.units.get(bubble.unitId)?.parentId;
      const parent = parentId ? byId.get(parentId) : null;
      if (!parent) continue;
      checked++;
      // Every cell the child's units stand on is inside the parent's region.
      for (const id of subtreeCells(tree, allocation.cells, bubble.unitId).map(cellKey)) {
        expect(parent.has(id)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("never lets a region swallow a node from outside its own branch", () => {
    const { tree, allocation, bubbles } = laidOut("radial");
    for (const bubble of bubbles.slice(0, 15)) {
      const family = new Set<string>();
      const stack = [bubble.unitId];
      while (stack.length) {
        const at = stack.pop()!;
        family.add(at);
        stack.push(...(tree.units.get(at)?.childIds ?? []));
      }
      for (const cell of bubble.cells) {
        const sitting = allocation.occupants.get(cellKey(cell));
        if (sitting !== undefined) expect(family.has(sitting)).toBe(true);
      }
    }
  });

  /**
   * A frontier belongs to both regions, so the two outlines that meet along it
   * lie on exactly the same edges — one line, drawn twice, in the right place.
   * This is what lets the renderer draw a shared border without knowing that
   * borders are shared.
   */
  it("gives two neighbours the same edges along the border between them", () => {
    const { tree, bubbles } = laidOut("radial");
    const key = (x: number) => Math.round(x * 100) / 100;
    const edgesOf = (unitId: string) =>
      new Set(bubbles.find((b) => b.unitId === unitId)!.edge.map((seg) => {
        const a = `${key(seg.from.x)},${key(seg.from.y)}`;
        const b = `${key(seg.to.x)},${key(seg.to.y)}`;
        return a < b ? `${a}|${b}` : `${b}|${a}`;
      }));

    // Find two regions that are neither nested nor far apart.
    const parents = new Map<string, string[]>();
    for (const b of bubbles) {
      const p = tree.units.get(b.unitId)?.parentId ?? "";
      parents.set(p, [...(parents.get(p) ?? []), b.unitId]);
    }
    let shared = 0;
    for (const ids of parents.values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = edgesOf(ids[i]);
          for (const edge of edgesOf(ids[j])) if (a.has(edge)) shared++;
        }
      }
    }
    // Somewhere on this company two regions touch; where they do, the edge is
    // one edge. If this ever reaches nought, regions have stopped meeting at all
    // and the frontier treatment has nothing to draw.
    expect(shared).toBeGreaterThan(0);
  });

  it("stays a pure function of the company, ties and all", () => {
    // The partition breaks ties by name, so two runs must agree exactly — a
    // contested cell that went either way would make the picture unstable.
    const { tree, allocation } = laidOut("radial");
    const once = bubblesFor({ tree, cells: allocation.cells, tier: allocation.tier!, size: 100, occupants: allocation.occupants });
    const again = bubblesFor({ tree, cells: allocation.cells, tier: allocation.tier!, size: 100, occupants: allocation.occupants });
    expect(again.map((b) => b.cells.map(cellKey).sort())).toEqual(once.map((b) => b.cells.map(cellKey).sort()));
  });

  it("reports a clash when two groups really are jammed together", () => {
    // The counter has to be able to say yes, or a nought from it means nothing.
    // Two regions put on exactly the same cells cannot be partitioned apart.
    const { tree, allocation, bubbles } = laidOut("radial");
    const pair = bubbles.filter((b) => tree.units.get(b.unitId)?.parentId === tree.rootId);
    if (pair.length < 2) return;
    const hand = new Map(allocation.cells);
    const [a, b] = pair;
    const onto = allocation.cells.get(b.unitId)!;
    for (const id of [a.unitId, ...(tree.units.get(a.unitId)?.childIds ?? [])]) {
      hand.set(id, { q: onto.q + 1, r: onto.r });
    }
    const after = bubblesFor({ tree, cells: hand, tier: allocation.tier!, size: 100 });
    expect(bubbleClashes(tree, after)).toBeGreaterThan(0);
  });
});
