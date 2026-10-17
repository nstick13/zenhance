/**
 * **The orderly end — an org chart on the lattice.**
 *
 * Greg, 2026-10-17: *"The further the user drags that node away from
 * master-centre, the more orderly the child tree becomes. Orderly here is 'it
 * starts to look like a normal org chart'. The orientation of that chart,
 * though, does pay reference to where master-centre is — the orientation should
 * always be on the side of the dragged node opposite master-centre."*
 *
 * So this is one of the two things a dragged branch can be. The other is the
 * picture the master centre drew, which needs no code at all because it is the
 * calculated layout. `deferBranch` blends between them; this file only has to
 * answer *what would an orderly chart of this branch look like*.
 *
 * ## It is square, and on a hexagonal lattice that is not obvious
 *
 * The six lattice directions are 60° apart, so the first draft of this was
 * going to be sheared — rows running 60° off the growth axis, which reads as a
 * honeycomb family tree rather than as a chart. It does not have to be. On
 * flat-top hexes a step of `(+2, −1)` moves **purely sideways** in world space
 * and a step of `(0, +1)` moves **purely up and down**, because `cellToWorld`
 * puts a cell at `(1.5q, √3(r + q/2))`. Those two are at right angles, so the
 * chart is a proper right-angled chart: one row per rung, siblings stacked
 * along the row, every parent centred over its own children.
 *
 * Turning it is exact too. `rotateCell` is a sixth of a turn about a centre, so
 * the whole chart rotates onto real cells with no rounding — which is what lets
 * the orientation follow the master centre without the shape drifting.
 *
 * ## The chart charts the structure; people stay at their team's door
 *
 * A chart of every *person* in a large branch is not a chart anybody can read:
 * a tidy tree's width grows with its leaves, and Northwind's biggest branch
 * holds 1,100 people, which would be some 2,000 cells across — twenty times the
 * width of the whole company. So the chart places **places**, and a team's
 * people stay the crowd around their own node, which is Law 3's own clause
 * (*"a team lead belongs at their team's door"*) and the thing that keeps a
 * team reading as one crowd. `deferBranch` aims a person at their team and lets
 * the doorstep seater spread them, exactly as a clean load does.
 *
 * A node's lane is therefore as wide as its own body — itself plus its crowd —
 * so a fifty-person team takes the room a fifty-person team needs and a lone
 * node takes one cell.
 */
import type { OrbitalTree, UnitNode } from "@/lib/map/layout/model";
import { DIRECTIONS, add, scale, type Cell } from "@/lib/map/layout/hex/coords";
import { RUNGS_PER_HEX, gapFor } from "@/lib/map/layout/hex/spacing";

/**
 * **A pure sideways step in world space**, which is two cells of lattice
 * distance: from `(q, r)` to `(q + 2, r − 1)` the world y is unchanged, because
 * `√3((r − 1) + (q + 2)/2) = √3(r + q/2)`. This is the chart's row axis.
 */
export const ACROSS: Cell = { q: 2, r: -1 };

/** **A pure up-and-down step**, one cell of lattice distance: `(0, +1)` moves
 *  world y by `√3` and world x not at all. This is the chart's lane axis. */
export const ALONG: Cell = DIRECTIONS[5];

export type ChartShape = {
  /** unit id → where it sits relative to the anchor, in the canonical
   *  orientation (rows growing along `ACROSS`). Places only. */
  offsets: Map<string, Cell>;
  /** How many cells the chart spans along its lanes, and how many rows deep it
   *  runs. Reported because the honest objection to charting a large branch is
   *  its size, and a number settles it. */
  width: number;
  rows: number;
};

/**
 * Lay the branch under `anchorId` as an orderly chart, anchor at the origin.
 *
 * Two passes, which is Reingold and Tilford's tidy tree and the same shape as
 * every other layout in this engine: measure each subtree's width from the
 * leaves up, then hand out positions from the root down, each parent centred
 * over the span its children occupy.
 */
export function chartShape(args: {
  tree: OrbitalTree;
  anchorId: string;
  /** Who is a person. A person is never a row of the chart. */
  people?: ReadonlySet<string>;
  /** Rungs per extra hexagon of clearance, as `RUNGS_PER_HEX`. */
  rungs?: number;
}): ChartShape {
  const { tree, anchorId } = args;
  const people = args.people ?? new Set<string>();
  const rungs = args.rungs ?? RUNGS_PER_HEX;
  const offsets = new Map<string, Cell>();
  const anchor = tree.units.get(anchorId);
  if (!anchor) return { offsets, width: 0, rows: 0 };

  /** The structure under a unit: its children that are not people. */
  const kidsOf = (unit: UnitNode): UnitNode[] =>
    unit.childIds
      .map((id) => tree.units.get(id))
      .filter((u): u is UnitNode => !!u && !people.has(u.id))
      // The same grammar as every other placer here: headcount descending,
      // ties by name, so a chart of the same company is the same chart.
      .sort((a, b) => b.totalSeats - a.totalSeats || a.name.localeCompare(b.name));

  /** How many people hang off this node without any structure between. */
  const crowdOf = (unit: UnitNode): number => {
    let n = 0;
    const stack = [...unit.childIds];
    while (stack.length) {
      const id = stack.pop()!;
      if (!people.has(id)) continue;
      n++;
      // A person's own reports are in the same crowd — the team is whoever's
      // nearest structural ancestor this is.
      for (const kid of tree.units.get(id)?.childIds ?? []) stack.push(kid);
    }
    return n;
  };

  /** How far a node's own body reaches: itself plus its crowd, as rings. */
  const bodyOf = (unit: UnitNode): number => ringsFor(1 + crowdOf(unit));
  /** The clear ring this node keeps, from `spacing.ts` and nowhere else. */
  const ringOf = (unit: UnitNode): number => gapFor(depthBelow(unit), rungs);
  /** Rungs of structure beneath a unit — its tier, counted here rather than
   *  borrowed, because this file is handed a branch rather than a company. */
  const tiers = new Map<string, number>();
  function depthBelow(unit: UnitNode): number {
    const had = tiers.get(unit.id);
    if (had !== undefined) return had;
    tiers.set(unit.id, 0);
    const kids = kidsOf(unit);
    const tier = kids.length === 0
      ? 0
      : 1 + kids.reduce((deepest, kid) => Math.max(deepest, depthBelow(kid)), 0);
    tiers.set(unit.id, tier);
    return tier;
  }

  // --- pass one: how wide is each subtree, in lanes ------------------------

  const lanes = new Map<string, number>();
  const measure = (unit: UnitNode): number => {
    const had = lanes.get(unit.id);
    if (had !== undefined) return had;
    lanes.set(unit.id, 1);
    const kids = kidsOf(unit);
    /** Its own body across the lane axis, plus the clear ring it keeps. */
    const own = 2 * (bodyOf(unit) + ringOf(unit)) + 1;
    let beneath = 0;
    kids.forEach((kid, i) => {
      beneath += measure(kid) + (i > 0 ? 1 : 0);
    });
    const width = Math.max(own, beneath);
    lanes.set(unit.id, width);
    return width;
  };
  measure(anchor);

  // --- pass two: hand out rows and lanes, from the anchor down -------------

  /**
   * **How far one row sits from the next.**
   *
   * Each row has to clear the one before it by both bodies and the wider of the
   * two clear rings, which is `leastApart`'s arithmetic applied down the chart
   * instead of around the map. Rounded up to whole `ACROSS` steps, since one of
   * those is two cells of lattice distance.
   */
  const rowReach = new Map<number, number>();
  const noteRow = (row: number, unit: UnitNode) => {
    rowReach.set(row, Math.max(rowReach.get(row) ?? 0, bodyOf(unit) + ringOf(unit)));
  };
  const rowsOf = new Map<string, number>();
  const laneOf = new Map<string, number>();
  const walk = (unit: UnitNode, row: number, lane: number) => {
    rowsOf.set(unit.id, row);
    noteRow(row, unit);
    const kids = kidsOf(unit);
    if (!kids.length) { laneOf.set(unit.id, lane + (lanes.get(unit.id)! - 1) / 2); return; }
    let at = lane;
    const middles: number[] = [];
    for (const [i, kid] of kids.entries()) {
      if (i > 0) at += 1;
      walk(kid, row + 1, at);
      middles.push(laneOf.get(kid.id)!);
      at += lanes.get(kid.id)!;
    }
    // Centred over its own children, which is the whole look of a chart.
    laneOf.set(unit.id, (middles[0] + middles[middles.length - 1]) / 2);
  };
  walk(anchor, 0, 0);

  const deepest = Math.max(...rowsOf.values());
  /** Where each row sits along `ACROSS`, in whole steps. */
  const rowAt: number[] = [0];
  for (let row = 1; row <= deepest; row++) {
    const clear = (rowReach.get(row - 1) ?? 0) + (rowReach.get(row) ?? 0) + 1;
    rowAt.push(rowAt[row - 1] + Math.max(1, Math.ceil(clear / 2)));
  }

  const anchorLane = laneOf.get(anchorId) ?? 0;
  let lowest = Infinity;
  let highest = -Infinity;
  for (const [id, row] of rowsOf) {
    const lane = Math.round((laneOf.get(id) ?? 0) - anchorLane);
    lowest = Math.min(lowest, lane);
    highest = Math.max(highest, lane);
    offsets.set(id, add(scale(ACROSS, rowAt[row]), scale(ALONG, lane)));
  }
  return {
    offsets,
    width: Number.isFinite(lowest) ? highest - lowest + 1 : 0,
    rows: deepest + 1,
  };
}

/** Cells within `r` rings of a centre, inclusive — the lattice's own disc. */
const disc = (r: number): number => 3 * r * r + 3 * r + 1;

/** How big a body of `n` units is, in rings. The same measure the radial driver
 *  uses, for the same reason: a count of units cannot compound. */
const ringsFor = (units: number): number => {
  let r = 0;
  while (disc(r) < Math.max(1, units)) r++;
  return r;
};
