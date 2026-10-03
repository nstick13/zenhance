/**
 * Greg's arrangement rules, held as tests (2026-09-30).
 *
 * Each `it` here is one sentence from the rules he wrote. If a rule changes,
 * this is the file that should fail.
 */
import { describe, expect, it } from "vitest";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import {
  branchOf,
  dropOutcome,
  hoverGroup,
  isOnePatch,
  metaConnected,
  nearestFreeCell,
  outline,
  partedLanding,
  placeIsland,
  wouldCycle,
} from "@/lib/map/layout/hex/arrange";
import {
  cellKey, cellToWorld, hexDistance, neighbours, spiral, type Cell,
} from "@/lib/map/layout/hex/coords";

/**
 *            company
 *           /       \
 *      sales         eng
 *      /   \        /   \
 *  north  south   web   api
 */
const org: OrgInput = {
  units: [
    { id: "company", name: "Company", parentId: null },
    { id: "sales", name: "Sales", parentId: "company" },
    { id: "eng", name: "Engineering", parentId: "company" },
    { id: "north", name: "North", parentId: "sales" },
    { id: "south", name: "South", parentId: "sales" },
    { id: "web", name: "Web", parentId: "eng" },
    { id: "api", name: "API", parentId: "eng" },
  ],
  people: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
  assignments: [
    { personId: "p1", orgUnitId: "north" },
    { personId: "p2", orgUnitId: "web" },
  ],
};
const tree = buildOrbitalTree(org, { mergePassThroughRoot: false });

/** A hand-built arrangement, so the rules are tested against a known picture
 *  rather than whatever the allocator happened to produce. */
const at = (q: number, r: number): Cell => ({ q, r });
const layout = new Map<string, Cell>([
  ["company", at(0, 0)],
  ["sales", at(1, 0)],
  ["eng", at(0, 1)],
  ["north", at(2, 0)],
  ["south", at(2, -1)],
  ["web", at(-1, 2)],
  ["api", at(0, 2)],
]);
const occupancy = new Map([...layout].map(([id, c]) => [cellKey(c), id]));

describe("a branch travels as one object", () => {
  it("carries every unit below it", () => {
    expect(branchOf(tree, "sales")).toEqual(new Set(["sales", "north", "south"]));
    expect(branchOf(tree, "north")).toEqual(new Set(["north"]));
  });
});

describe("a tile cannot be dropped on another tile", () => {
  it("reports what is in the way and where it could go instead", () => {
    const out = dropOutcome(tree, occupancy, "north", at(0, 1)); // on top of eng
    expect(out.kind).toBe("blocked");
    if (out.kind !== "blocked") return;
    expect(out.occupiedBy).toBe("eng");
    expect(out.nearestFree).not.toBeNull();
    expect(occupancy.has(cellKey(out.nearestFree!))).toBe(false);
  });

  it("offers a cell one step away, not across the map", () => {
    const out = dropOutcome(tree, occupancy, "north", at(0, 1));
    if (out.kind !== "blocked") throw new Error("expected blocked");
    expect(hexDistance(at(0, 1), out.nearestFree!)).toBeLessThanOrEqual(2);
  });

  it("lets a branch land on ground it is itself vacating", () => {
    // south moving onto north's cell is fine only if north is coming too; it is
    // not, so this is blocked — but sales moving over north is not.
    const out = dropOutcome(tree, occupancy, "sales", at(2, 0)); // north's cell
    expect(out.kind).not.toBe("blocked");
  });
});

describe("coming to rest against another family offers a reparent", () => {
  it("offers it, and names who would become the parent", () => {
    // (-1,1) touches eng (0,1), web (-1,2) and the company (0,0).
    const out = dropOutcome(tree, occupancy, "north", at(-1, 1));
    expect(out.kind).toBe("offer-reparent");
    if (out.kind !== "offer-reparent") return;
    expect(out.touching.sort()).toEqual(["company", "eng", "web"]);
    // The deepest of them — the one the hand actually nestled against. Picking
    // the biggest instead proposed "company", which is never what was meant.
    expect(out.newParentId).toBe("web");
  });

  it("does not offer anything for touching the parent it already has", () => {
    // (1,1) touches sales (1,0), which is north's parent already.
    const out = dropOutcome(tree, occupancy, "north", at(1, 1));
    if (out.kind === "offer-reparent") {
      expect(out.newParentId).not.toBe("sales");
    }
  });

  it("never offers a parent that would make a loop", () => {
    // sales dropped against its own child north must not adopt it.
    const out = dropOutcome(tree, occupancy, "sales", at(3, 0));
    if (out.kind === "offer-reparent") {
      expect(wouldCycle(tree, "sales", out.newParentId)).toBe(false);
    }
  });

  it("is plain movement out in open ground", () => {
    const out = dropOutcome(tree, occupancy, "north", at(8, -4));
    expect(out.kind).toBe("move");
  });
});

describe("a hold over another unit offers a merge instead", () => {
  it("offers the merge, not the reparent", () => {
    const out = dropOutcome(tree, occupancy, "north", at(-1, 1), { heldOver: "eng" });
    expect(out.kind).toBe("offer-merge");
    if (out.kind !== "offer-merge") return;
    expect(out.withUnitId).toBe("eng");
  });

  it("ignores a hold over the tile's own branch", () => {
    const out = dropOutcome(tree, occupancy, "sales", at(-1, 1), { heldOver: "north" });
    expect(out.kind).not.toBe("offer-merge");
  });
});

describe("the nearest free cell", () => {
  it("can be required to touch the family it is joining", () => {
    const cell = nearestFreeCell(occupancy, at(6, 0), { mustTouch: [at(0, 1)] });
    expect(cell).not.toBeNull();
    expect(hexDistance(cell!, at(0, 1))).toBe(1);
  });

  it("treats the moving branch's own cells as free", () => {
    const cell = nearestFreeCell(occupancy, at(2, 0), { ignore: new Set(["north"]) });
    expect(cell).toEqual(at(2, 0));
  });
});

describe("the outline round meta-connected tiles", () => {
  it("draws six edges round one hexagon, and they close into a loop", () => {
    const segs = outline([at(0, 0)], 10);
    expect(segs).toHaveLength(6);
    const perimeter = segs.reduce((t, s) => t + Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), 0);
    expect(perimeter).toBeCloseTo(60, 6); // six sides, each one circumradius long
  });

  /**
   * Derive the answer a second way and compare. An edge is on the boundary
   * exactly when the cell across it is outside the set, and that edge's
   * midpoint is halfway between the two cell centres — which needs no
   * knowledge of corner ordering at all.
   *
   * Counting segments was the old test, and it is worthless here: the bug of
   * 2026-09-30 mapped every edge to the wrong neighbour, which still drops the
   * right *number* of edges. It has to check *which*.
   */
  // Rounded, and `+ 0` to collapse the -0 that rounding a tiny negative
  // produces. A corner is `centre + radius × cos(90°)`, and `cos(90°)` is
  // 6.1e-17 rather than zero, so the same point reached from two directions
  // differs in the last bits and formats as "0.000000" one way and
  // "-0.000000" the other.
  const key = (x: number, y: number) =>
    `${Math.round(x * 1000) / 1000 + 0},${Math.round(y * 1000) / 1000 + 0}`;

  const expectedMidpoints = (cells: Cell[], size: number) => {
    const set = new Set(cells.map(cellKey));
    const out: string[] = [];
    for (const cell of cells) {
      const a = cellToWorld(cell, size);
      for (const n of neighbours(cell)) {
        if (set.has(cellKey(n))) continue;
        const b = cellToWorld(n, size);
        out.push(key((a.x + b.x) / 2, (a.y + b.y) / 2));
      }
    }
    return new Set(out);
  };
  const actualMidpoints = (cells: Cell[], size: number) =>
    new Set(outline(cells, size).map((s) =>
      key((s.from.x + s.to.x) / 2, (s.from.y + s.to.y) / 2)));

  it("draws every boundary edge and no internal one", () => {
    const shapes: Cell[][] = [
      [at(0, 0), at(1, 0)],                                   // a pair
      [at(0, 0), at(1, 0), at(2, 0), at(3, 0)],               // a line
      [at(0, 0), ...neighbours(at(0, 0))],                    // a full flower
      [at(0, 0), at(1, 0), at(1, 1), at(0, 2), at(-1, 2)],    // a ragged blob
      [at(0, 0), at(5, 0)],                                   // two islands
      [at(0, 0), at(1, -1), at(2, -1), at(2, 0), at(1, 1)],   // a ring with a hole
    ];
    for (const shape of shapes) {
      expect(actualMidpoints(shape, 30)).toEqual(expectedMidpoints(shape, 30));
    }
  });

  it("leaves a fully surrounded cell with no outline of its own", () => {
    // A flower: the middle cell touches only family, so none of its six edges
    // may appear. The old mapping drew some of them, which is what made the
    // outline snake through the shape instead of round it.
    const flower = [at(0, 0), ...neighbours(at(0, 0))];
    const segs = outline(flower, 30);
    const centre = cellToWorld(at(0, 0), 30);
    for (const s of segs) {
      const mid = { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 };
      // Every boundary midpoint of a flower is two inradii from the middle.
      expect(Math.hypot(mid.x - centre.x, mid.y - centre.y)).toBeGreaterThan(30);
    }
    expect(segs).toHaveLength(18); // seven cells, six edges each, twelve shared
  });

  it("keeps both outlines when the tiles do not touch", () => {
    expect(outline([at(0, 0), at(5, 0)], 10)).toHaveLength(12);
  });

  it("goes round a family including a tile sitting apart from it", () => {
    const family = metaConnected(tree, "north");
    expect(family).toEqual(new Set(["sales", "north", "south"]));
  });

  it("wraps the whole branch when the tile runs something", () => {
    expect(hoverGroup(tree, "sales")).toEqual(new Set(["sales", "north", "south"]));
    expect(hoverGroup(tree, "company"))
      .toEqual(new Set(["company", "sales", "eng", "north", "south", "web", "api"]));
  });

  it("wraps the immediate family when the tile runs nothing", () => {
    // north has no children, so the question becomes "who are you with".
    expect(hoverGroup(tree, "north")).toEqual(new Set(["sales", "north", "south"]));
    expect(hoverGroup(tree, "web")).toEqual(new Set(["eng", "web", "api"]));
  });

  it("does not reach sideways out of a branch it wraps", () => {
    // Pointing at Sales must never pull Engineering in, however they sit.
    const group = hoverGroup(tree, "sales");
    expect(group.has("eng")).toBe(false);
    expect(group.has("company")).toBe(false);
  });
});

describe("moving a whole island", () => {
  const island = new Map([
    ["sales", at(1, 0)],
    ["north", at(2, 0)],
    ["south", at(2, -1)],
  ]);

  it("keeps its shape when the ground will take it", () => {
    const landing = placeIsland(occupancy, island, "sales", at(6, 0));
    expect(landing.kind).toBe("fits");
    if (landing.kind === "no-room") return;
    // Same silhouette: every pairwise distance preserved.
    expect(hexDistance(landing.cells.get("sales")!, landing.cells.get("north")!)).toBe(1);
    expect(hexDistance(landing.cells.get("north")!, landing.cells.get("south")!)).toBe(1);
  });

  it("nudges aside rather than reshaping, when a cell or two is enough", () => {
    // One obstacle clipping the silhouette. Losing the shape over that is the
    // bug Greg reported on 2026-09-30: a branch rearranging itself in open
    // ground because one of its far cells caught something.
    const landing = placeIsland(new Map([[cellKey(at(7, 0)), "stranger"]]), island, "sales", at(6, 0));
    expect(landing.kind).toBe("nudged");
    if (landing.kind === "no-room") return;
    expect(hexDistance(landing.cells.get("sales")!, landing.cells.get("north")!)).toBe(1);
    expect(hexDistance(landing.cells.get("sales")!, at(6, 0))).toBeLessThanOrEqual(2);
  });

  it("says so when it has to change shape, and still places everyone", () => {
    // Genuinely boxed in: everything within four rings is taken but the cell
    // the hand is over, and the only other free ground is two isolated cells
    // no offset of the silhouette can reach together. The shape has to give.
    const boxed = new Map<string, string>();
    for (const c of spiral(at(20, 0), 4)) boxed.set(cellKey(c), "stranger");
    for (const c of [at(20, 0), at(20, -3), at(20, 3)]) boxed.delete(cellKey(c));
    const landing = placeIsland(boxed, island, "sales", at(20, 0));
    expect(landing.kind).toBe("reshaped");
    if (landing.kind === "no-room") return;
    expect(landing.cells.size).toBe(3);
    expect(new Set([...landing.cells.values()].map(cellKey)).size).toBe(3);
    expect(landing.cells.get("sales")).toEqual(at(20, 0));
  });

  it("always shows a landing when the hand is over somebody", () => {
    // The bug of 2026-10-01: this returned "no-room" the moment the cell under
    // the cursor was occupied, so there was no preview at all — and the drop
    // then committed a landing from somewhere nobody had been shown.
    const landing = placeIsland(occupancy, island, "sales", at(0, 1)); // on top of eng
    expect(landing.kind).not.toBe("no-room");
    if (landing.kind === "no-room") return;
    expect(landing.cells.size).toBe(3);
    // It says where it seated the anchor, so the preview and the commit are
    // the same thing.
    expect(landing.cells.get("sales")).toEqual(landing.anchor);
    expect(occupancy.has(cellKey(landing.anchor))).toBe(false);
  });

  /**
   * **Carried as it is, even scattered** (changed 2026-10-03).
   *
   * This used to assert the opposite — that a scattered family was gathered
   * into one patch on the way. That contradicted Greg's rule from 2026-10-02:
   * *"if a user picks up a family node and moves it, the thing should be moved
   * as-is, including any archipelagos."* It went unnoticed while every branch
   * worth dragging happened to be one patch; under nested territories, whose
   * clear ground is the whole point, almost none are — and the rule was off for
   * anything above about ten units.
   *
   * Gathering is what the **second pick-up** is for, and that still gathers.
   */
  it("carries a scattered family as it is, rather than gathering it", () => {
    const scattered = new Map([
      ["sales", at(30, 0)], ["north", at(38, -4)], ["south", at(30, 6)],
    ]);
    expect(isOnePatch(scattered.values())).toBe(false);
    const landing = placeIsland(new Map(), scattered, "sales", at(50, 0));
    expect(landing.kind).toBe("fits");
    if (landing.kind === "no-room") return;
    // Every offset from the anchor preserved — the silhouette somebody built.
    const anchor = landing.cells.get("sales")!;
    expect(anchor).toEqual(at(50, 0));
    for (const [id, was] of scattered) {
      const now = landing.cells.get(id)!;
      expect(now.q - anchor.q).toBe(was.q - 30);
      expect(now.r - anchor.r).toBe(was.r - 0);
    }
  });

  /** The gesture that *does* gather is the second pick-up, and it still does. */
  it("gathers a scattered family when the tidy-up gesture asks", () => {
    const scattered = new Map([
      ["sales", at(30, 0)], ["north", at(38, -4)], ["south", at(30, 6)],
    ]);
    const landing = placeIsland(
      new Map(), scattered, "sales", at(50, 0),
      (id) => (id === "sales" ? ["north", "south"] : []),
      at(45, 0),
    );
    expect(landing.kind).toBe("radiated");
    if (landing.kind === "no-room") return;
    expect(isOnePatch(landing.cells.values())).toBe(true);
  });

  it("seats a reflowed branch against its own parents, not in a crab", () => {
    // Greg, 2026-10-01: "it drew crab-like shapes as I moved it." A member used
    // to attach to whatever was already placed, however distant a relation.
    const boxed = new Map<string, string>();
    for (const c of spiral(at(40, 0), 3)) boxed.set(cellKey(c), "stranger");
    for (const c of spiral(at(40, 0), 1)) boxed.delete(cellKey(c));
    const landing = placeIsland(
      boxed, island, "sales", at(40, 0),
      (id) => tree.units.get(id)?.childIds ?? [],
    );
    if (landing.kind === "no-room") throw new Error("expected a landing");
    expect(hexDistance(landing.cells.get("north")!, landing.cells.get("sales")!)).toBe(1);
    expect(hexDistance(landing.cells.get("south")!, landing.cells.get("sales")!)).toBe(1);
  });

  it("never drops a member onto a unit that is staying put", () => {
    const landing = placeIsland(occupancy, island, "sales", at(0, 1));
    if (landing.kind === "no-room") return;
    const staying = new Set(["company", "eng", "web", "api"]);
    for (const cell of landing.cells.values()) {
      const who = occupancy.get(cellKey(cell));
      expect(who === undefined || !staying.has(who)).toBe(true);
    }
  });
});

/**
 * Greg's "radiating" rule, 2026-10-02.
 *
 * *"if I drag a family group away from a shared parent, the highest-ranking
 * node in the dragged group should position itself closest to its parent,
 * regardless of how far that is. This should mean the connection line flows
 * freely from that node to the parent uninterrupted — like a leaf on a
 * branch."*
 *
 * The gesture that asks for it lives in the lab, because it is a clock and a
 * short hop and this file has neither. What is testable here is the shape the
 * request produces.
 */
describe("treeing a branch away from its parent", () => {
  const island = new Map([
    ["sales", at(1, 0)],
    ["north", at(2, 0)],
    ["south", at(2, -1)],
  ]);
  const kids = (id: string) => tree.units.get(id)?.childIds ?? [];
  /** The branch dropped far to the east; home is the company at the origin. */
  const treed = placeIsland(new Map(), island, "sales", at(9, 0), kids, at(0, 0));

  it("is a landing of its own, not a reshape, because the hand asked for it", () => {
    expect(treed.kind).toBe("radiated");
  });

  it("puts the governing node nearest its parent, and nobody in front of it", () => {
    if (treed.kind === "no-room") throw new Error("no landing");
    const home = at(0, 0);
    const anchor = treed.cells.get("sales")!;
    const reach = hexDistance(anchor, home);
    for (const [id, cell] of treed.cells) {
      if (id === "sales") continue;
      expect(hexDistance(cell, home)).toBeGreaterThan(reach);
    }
  });

  it("leaves the way home open, so the chain can run straight", () => {
    if (treed.kind === "no-room") throw new Error("no landing");
    // Every cell on the straight line from the anchor back to the parent is
    // free of the branch itself — which is the whole point of the rule.
    const anchor = treed.cells.get("sales")!;
    const occupied = new Set([...treed.cells.values()].map(cellKey));
    const steps = hexDistance(anchor, at(0, 0));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const q = Math.round(anchor.q + (0 - anchor.q) * t);
      const r = Math.round(anchor.r + (0 - anchor.r) * t);
      expect(occupied.has(cellKey({ q, r }))).toBe(false);
    }
  });

  it("still seats everyone, and still seats them against their own parent", () => {
    if (treed.kind === "no-room") throw new Error("no landing");
    expect(treed.cells.size).toBe(3);
    expect(hexDistance(treed.cells.get("north")!, treed.cells.get("sales")!)).toBe(1);
    expect(hexDistance(treed.cells.get("south")!, treed.cells.get("sales")!)).toBe(1);
  });

  it("does nothing of the sort unless asked — a plain drop keeps its shape", () => {
    const plain = placeIsland(new Map(), island, "sales", at(9, 0), kids);
    expect(plain.kind).toBe("fits");
  });
});

/**
 * Greg's rearrange rules, 2026-10-03.
 *
 * *"If a user picks up a family node and moves it, the thing should be moved
 * as-is, including any archipelagos… if the user drops the family and there is
 * a clash, then only the groups that clash (even by one cell) should be
 * repositioned — they should reposition to the nearest-to-proposed space that
 * can host that group without a clash."*
 */
describe("moving a branch that is already an archipelago", () => {
  /** Two islands: sales sits with north, south is a separate group two cells on. */
  const island = new Map([
    ["sales", at(0, 0)],
    ["north", at(1, 0)],
    ["south", at(4, 0)],
  ]);
  const groupOf = (id: string) => (id === "south" ? "b" : "a");
  const shape = (cells: Map<string, Cell>) => ({
    withinA: hexDistance(cells.get("sales")!, cells.get("north")!),
    aToB: hexDistance(cells.get("sales")!, cells.get("south")!),
  });

  it("translates everything cell for cell when nothing is in the way", () => {
    const landed = partedLanding(new Map(), island, "sales", at(10, 0), groupOf);
    expect(landed).not.toBeNull();
    expect(landed!.moved).toBe(0);
    expect(landed!.cells.get("sales")).toEqual(at(10, 0));
    expect(shape(landed!.cells)).toEqual({ withinA: 1, aToB: 4 });
  });

  it("moves aside only the group that clashes, and keeps its shape", () => {
    // Somebody is standing exactly where `south` would land.
    const occupied = new Map([[cellKey(at(14, 0)), "stranger"]]);
    const landed = partedLanding(occupied, island, "sales", at(10, 0), groupOf);
    expect(landed).not.toBeNull();
    expect(landed!.moved).toBe(1);
    // The group that did not clash is untouched, exactly where it was sent.
    expect(landed!.cells.get("sales")).toEqual(at(10, 0));
    expect(landed!.cells.get("north")).toEqual(at(11, 0));
    // The one that did moved, and only as far as it had to.
    expect(landed!.cells.get("south")).not.toEqual(at(14, 0));
    expect(hexDistance(landed!.cells.get("south")!, at(14, 0))).toBeLessThanOrEqual(2);
  });

  it("refuses rather than displacing the cell the hand let go of", () => {
    const occupied = new Map([[cellKey(at(10, 0)), "stranger"]]);
    expect(partedLanding(occupied, island, "sales", at(10, 0), groupOf)).toBeNull();
  });

  /**
   * A clash parts the branch rather than reflowing it — but only once nudging
   * has failed. A nudge of a cell or two keeps **every** group's shape and
   * moves nobody else, so it is always the better answer when there is room
   * for it; this blocks the whole neighbourhood so that there is not.
   */
  it("is what a clash produces now, instead of reflowing the whole branch", () => {
    const occupied = new Map<string, string>();
    // Two rings is what `placeIsland` will nudge through, plus one so the
    // nudged silhouette has nowhere clear either.
    for (const cell of spiral(at(14, 0), 3)) occupied.set(cellKey(cell), "stranger");
    occupied.delete(cellKey(at(10, 0)));
    occupied.delete(cellKey(at(11, 0)));
    const landing = placeIsland(
      occupied, island, "sales", at(10, 0), () => [], null, groupOf,
    );
    expect(landing.kind).toBe("parted");
    if (landing.kind !== "parted") return;
    expect(landing.moved).toBe(1);
    // The shape within the untouched group survives, which is the whole point.
    expect(hexDistance(landing.cells.get("sales")!, landing.cells.get("north")!)).toBe(1);
  });
});

/**
 * The rule the rearrange path never learned (Greg, 2026-10-03).
 *
 * *"I'm still seeing touching people who are of differing teams
 * post-auto-rearrange… my hunch is we have a clash from some deeper legacy
 * behaviour in the layout engine."*
 *
 * He was right, and it was two places: `partedLanding` asked only whether a
 * cell was **occupied**, and `reflow` seated against the nearest free cell with
 * no idea whose island it was next to. Both predate the archipelago spacing, so
 * a carefully spaced company came apart the first time anybody moved anything.
 */
describe("a drop obeys the spacing, not only the occupancy", () => {
  /** Two groups travelling together: the anchor's team, and a second team. */
  const island = new Map([
    ["sales", at(0, 0)],
    ["north", at(1, 0)],
    ["south", at(4, 0)],
  ]);
  const groups = (id: string) =>
    id === "south" ? "b" : id === "them" ? "c" : "a";
  const oneClearTile = () => 1;

  /** A stranger parked exactly where `south` would otherwise come to rest. */
  const stranger = new Map([[cellKey(at(15, 0)), "them"]]);

  it("will not land a travelling group tight against another group", () => {
    const landed = partedLanding(stranger, island, "sales", at(10, 0), groups, oneClearTile);
    expect(landed).not.toBeNull();
    // `south` would have translated to 14,0 — one cell from the stranger.
    expect(hexDistance(landed!.cells.get("south")!, at(15, 0))).toBeGreaterThan(1);
  });

  it("still lands the anchor exactly where the hand let go", () => {
    const landed = partedLanding(stranger, island, "sales", at(10, 0), groups, oneClearTile);
    expect(landed!.cells.get("sales")).toEqual(at(10, 0));
    // And the anchor's own team keeps its shape beside it.
    expect(landed!.cells.get("north")).toEqual(at(11, 0));
  });

  it("without a gap rule it only avoids overlapping, as it always did", () => {
    const landed = partedLanding(stranger, island, "sales", at(10, 0), groups);
    expect(landed!.cells.get("south")).toEqual(at(14, 0));
  });
});
