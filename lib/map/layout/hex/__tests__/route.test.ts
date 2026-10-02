/**
 * Chains that walk round the tiles instead of across them (2026-10-01).
 *
 * The governing constraint, Greg's: a chain only ever runs from a hexagon's
 * centre to the middle of one of its sides. Those are the six directions to a
 * neighbour, so a chain is a walk from cell to cell. An attempt to relax that —
 * adding the centre-to-vertex directions so a two-step hop could go straight —
 * measured well and looked wrong, and was reverted. These tests hold the
 * constraint as much as the behaviour.
 */
import { describe, expect, it } from "vitest";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { allocate } from "@/lib/map/layout/hex/allocate";
import { Router, corners, routeAll, straightWalk } from "@/lib/map/layout/hex/route";
import {
  DIRECTIONS, cellKey, cellToWorld, hexDistance, neighbours, type Cell,
} from "@/lib/map/layout/hex/coords";

const at = (q: number, r: number): Cell => ({ q, r });
const SIZE = 60;

/** Every step of a walk must be onto a neighbour — never a leap. */
const isAWalk = (cells: readonly Cell[]) =>
  cells.every((c, i) => i === 0 || hexDistance(c, cells[i - 1]) === 1);

describe("a chain is a walk, not a line", () => {
  it("steps only onto neighbours", () => {
    const router = new Router(new Map(), SIZE);
    for (const to of [at(5, 0), at(-3, 4), at(2, -7), at(0, 6)]) {
      expect(isAWalk(router.route(at(0, 0), to, new Set()))).toBe(true);
    }
  });

  it("runs only along the six side-midpoint directions", () => {
    // 30°, 90°, 150° and their opposites — never 0° or 60°, which are the
    // corner directions and are what the reverted attempt used.
    const SIDES = [30, 90, 150, 210, 270, 330];
    const router = new Router(new Map(), SIZE);
    for (const to of [at(4, -2), at(-5, 3), at(1, 5)]) {
      const points = corners(router.route(at(0, 0), to, new Set()), SIZE);
      for (let i = 1; i < points.length; i++) {
        const deg = ((Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x)
          * 180) / Math.PI + 360) % 360;
        expect(SIDES.some((s) => Math.abs(deg - s) < 1e-6)).toBe(true);
      }
    }
  });

  it("takes the direct walk when the ground is clear", () => {
    const router = new Router(new Map(), SIZE);
    const walk = router.route(at(0, 0), at(4, 0), new Set());
    expect(walk).toHaveLength(5);
    expect(corners(walk, SIZE)).toHaveLength(2); // one straight run, no bends
  });

  it("always arrives, whatever is in the way", () => {
    // Walled in on every side but one, at both ends.
    const blocked = new Map<string, string>();
    for (const n of neighbours(at(0, 0))) blocked.set(cellKey(n), "stranger");
    blocked.delete(cellKey(at(1, 0)));
    const router = new Router(blocked, SIZE);
    const walk = router.route(at(0, 0), at(6, 0), new Set());
    expect(walk.at(-1)).toEqual(at(6, 0));
    expect(isAWalk(walk)).toBe(true);
  });
});

describe("walking round what it can", () => {
  it("goes round a stranger rather than under one", () => {
    const blocked = new Map([[cellKey(at(1, 0)), "stranger"]]);
    const walk = new Router(blocked, SIZE).route(at(0, 0), at(2, 0), new Set());
    expect(walk.some((c) => cellKey(c) === cellKey(at(1, 0)))).toBe(false);
    expect(walk.at(-1)).toEqual(at(2, 0));
  });

  it("goes under a sibling rather than the long way round", () => {
    // Greg's exemption: past five children somebody has to reach the parent
    // through somebody. A short line through family beats a wandering detour.
    const occupied = new Map([[cellKey(at(1, 0)), "sister"]]);
    const walk = new Router(occupied, SIZE).route(at(0, 0), at(2, 0), new Set(["sister"]));
    expect(walk).toHaveLength(3);
    expect(walk[1]).toEqual(at(1, 0));
  });

  it("counts the strangers it could not avoid, and no siblings", () => {
    const occupied = new Map([
      [cellKey(at(1, 0)), "sister"],
      [cellKey(at(2, 0)), "stranger"],
    ]);
    const router = new Router(occupied, SIZE);
    const walk = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];
    expect(router.strangersUnder(walk, new Set(["sister"]))).toBe(1);
  });

  it("keeps a second chain off the ground the first took", () => {
    const router = new Router(new Map(), SIZE);
    const first = router.route(at(0, 0), at(4, 0), new Set());
    router.claim(first);
    const second = router.route(at(0, 1), at(4, 1), new Set());
    const taken = new Set(first.slice(1, -1).map(cellKey));
    // It may touch, but it must not simply lie along the same cells.
    const shared = second.slice(1, -1).filter((c) => taken.has(cellKey(c))).length;
    expect(shared).toBeLessThan(second.length - 2);
  });
});

describe("collapsing a walk into runs", () => {
  it("draws a straight walk as one segment", () => {
    expect(corners([at(0, 0), at(1, 0), at(2, 0), at(3, 0)], SIZE)).toHaveLength(2);
  });

  it("keeps a corner where the walk turns", () => {
    expect(corners([at(0, 0), at(1, 0), at(1, 1)], SIZE)).toHaveLength(3);
  });

  it("starts and ends exactly on the two cell centres", () => {
    const walk = [at(2, -1), at(3, -1), at(3, 0)];
    const points = corners(walk, SIZE);
    expect(points[0]).toEqual(cellToWorld(at(2, -1), SIZE));
    expect(points.at(-1)).toEqual(cellToWorld(at(3, 0), SIZE));
  });
});

describe("the fallback walk", () => {
  it("arrives, and every step is onto a neighbour", () => {
    for (const to of [at(7, -3), at(-4, 9), at(0, 0)]) {
      const walk = straightWalk(at(0, 0), to);
      expect(walk.at(-1)).toEqual(to);
      expect(isAWalk(walk)).toBe(true);
    }
  });
});

describe("a whole company", () => {
  const org = buildDeepOrg("route", { people: 1000, maxDepth: 8, seed: 7 });
  const tree = buildOrbitalTree(
    { units: org.units, people: org.people, assignments: org.assignments } as OrgInput,
    { mergePassThroughRoot: false, workCountFor: () => 6 },
  );
  const cells = allocate(tree).cells;
  const routed = routeAll(tree, cells, 318);

  it("gives every child exactly one chain, ending on its parent", () => {
    const withParents = [...tree.units.values()].filter((u) => u.parentId);
    expect(routed).toHaveLength(withParents.length);
    for (const chain of routed) {
      expect(chain.cells[0]).toEqual(cells.get(chain.unitId));
      expect(chain.cells.at(-1)).toEqual(cells.get(chain.parentId));
      expect(isAWalk(chain.cells)).toBe(true);
    }
  });

  it("never walks under a stranger when a child touches its parent", () => {
    for (const chain of routed) {
      if (hexDistance(cells.get(chain.unitId)!, cells.get(chain.parentId)!) !== 1) continue;
      expect(chain.through).toBe(0);
      expect(chain.cells).toHaveLength(2);
    }
  });

  it("is a pure function — the same company routes the same way twice", () => {
    const again = routeAll(tree, cells, 318);
    for (let i = 0; i < routed.length; i++) {
      expect(again[i].cells.map(cellKey)).toEqual(routed[i].cells.map(cellKey));
    }
  });

  /**
   * The thing Greg is actually looking at. A chain that has to walk is a chain
   * that walks under somebody, and a map full of those is the tangle he
   * described on 2026-10-02. The number is governed from the allocator, not
   * from here: 80 passages before the doorstep price, 26 after.
   */
  it("hardly ever walks under somebody who is not family", () => {
    const strangers = routed.reduce((n, c) => n + c.through, 0);
    expect(strangers).toBeLessThan(45);
  });

  it("does not wander: most chains are still a single straight run", () => {
    const straight = routed.filter((c) => c.points.length === 2).length;
    expect(straight / routed.length).toBeGreaterThan(0.6);
  });

  it("only ever uses the six side-midpoint directions, across the whole company", () => {
    const steps = new Set<string>();
    for (const chain of routed) {
      for (let i = 1; i < chain.cells.length; i++) {
        steps.add(`${chain.cells[i].q - chain.cells[i - 1].q},${chain.cells[i].r - chain.cells[i - 1].r}`);
      }
    }
    for (const step of steps) {
      expect(DIRECTIONS.some((d) => `${d.q},${d.r}` === step)).toBe(true);
    }
  });
});
