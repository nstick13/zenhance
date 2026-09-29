/**
 * Giving every unit a cell — the hard half of the hex layout (2026-09-29).
 *
 * The lattice in `coords.ts` is arithmetic. This is the part with an opinion:
 * out of the infinite plane of cells, which one does each unit get?
 *
 * ## What it is trying to do
 *
 * 1. **A child sits next to its parent.** A parent has six neighbouring cells.
 *    Up to six children can be adjacent, and Greg's model says exactly that:
 *    *"If a node has six child nodes, great — it's a hexagon tessellation. If
 *    more, then we can move child nodes to 'jump' to the next one."*
 * 2. **A branch runs away from where it came from**, so direction carries
 *    meaning: if you are travelling east you are going deeper.
 * 3. **Branches do not interleave.** A big division's territory should read as
 *    one place, not as confetti mixed with its neighbour's.
 * 4. **The same company always gets the same cells.** No randomness, no
 *    settling pass, no dependence on the viewport — Law 1, unchanged from the
 *    orbital engine.
 *
 * ## How
 *
 * Breadth-first by depth, and within a depth, heavier branches choose first.
 * Breadth-first matters: depth-first lets the first branch eat the plane
 * around the root and pushes its siblings to the horizon. Heavier-first
 * matters for the same reason one rung down.
 *
 * Each child gets a *desired direction* fanned around its parent's outward
 * angle, and then takes the best free cell, scored by — in order — how many
 * rings out it is, whether taking it would wedge it among another branch's
 * cells, and how far off its desired direction it sits.
 *
 * A child that cannot get an adjacent cell **jumps**: it takes a cell further
 * out and the renderer draws a curve back to its parent rather than a
 * straight line. That is Greg's mechanism, and it is also this allocator's
 * failure mode — which is the happy accident that makes the whole design
 * work. When contention pushes a branch away, the drawing already has a way
 * to say so.
 *
 * ## What it does not do yet
 *
 * **Stability under edit.** Adding one unit re-runs the whole allocation, and
 * on a lattice there may be no free cell where you want one, so neighbours can
 * shuffle. In the orbital engine a new sibling nudged its neighbours along an
 * orbit; here it can displace a chain. This is the biggest open risk in the
 * design and it is deliberately not solved in the study — see
 * `docs/HEX-LAYOUT.md` § Open risks.
 */
import type { OrbitalTree, UnitNode } from "@/lib/map/layout/model";
import {
  type Cell,
  DIRECTIONS,
  add,
  cellKey,
  hexDistance,
  ring,
  spiral,
  worldAngle,
} from "@/lib/map/layout/hex/coords";

export type Allocation = {
  /** unit id → its cell. */
  cells: Map<string, Cell>;
  /** cell key → the unit sitting there. */
  occupants: Map<string, string>;
  /** unit id → how many steps from its parent. 1 is adjacent; more is a jump
   *  and the renderer curves the link. */
  steps: Map<string, number>;
  /** unit id → the top-level branch it belongs to, for territory colouring. */
  branchOf: Map<string, string>;
  /** Furthest ring any unit reached, for a quick extent. */
  radius: number;
  /** How many units had to jump, and the worst jump. Study telemetry — a
   *  layout where half the company jumps is a layout that did not work. */
  stats: { placed: number; adjacent: number; jumped: number; worstJump: number };
};

/** How far out to look before giving up on a child. A company would have to be
 *  pathologically contended to need this many rings; the cap exists so a bug
 *  cannot spin. */
const MAX_SEARCH_RING = 40;

/** How far beyond a candidate cell to look for elbow room. Two rings is 19
 *  cells — enough to tell "this opens onto the plain" from "this is a pocket"
 *  without turning the search into a flood fill. */
const LOOKAHEAD_RING = 2;

/** What open space beyond a cell is worth, against one degree off the
 *  direction the child wanted. Space wins ties; direction breaks them. */
const SPACE_WEIGHT = 9;
const DEGREE_PENALTY = 1.2;

const TAU = Math.PI * 2;

const angleGap = (a: number, b: number): number =>
  Math.abs((((a - b) % TAU) + TAU + Math.PI) % TAU - Math.PI);

/**
 * The directions a fan of `n` children should aim at, centred on `outward`.
 * One child goes straight out; more open symmetrically around it, a sixth of
 * a turn apart, because that is the angle the lattice actually offers.
 */
export function fanAngles(outward: number, n: number): number[] {
  if (n <= 0) return [];
  const step = TAU / 6;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
    out.push(outward + k * step);
  }
  return out;
}

export function allocate(tree: OrbitalTree): Allocation {
  const cells = new Map<string, Cell>();
  const occupants = new Map<string, string>();
  const steps = new Map<string, number>();
  const branchOf = new Map<string, string>();
  let radius = 0;
  let adjacent = 0;
  let jumped = 0;
  let worstJump = 0;

  const root = tree.units.get(tree.rootId);
  if (!root) {
    return {
      cells, occupants, steps, branchOf, radius,
      stats: { placed: 0, adjacent: 0, jumped: 0, worstJump: 0 },
    };
  }

  const SIZE = 1; // only angles are compared, and those are scale-free

  const take = (unit: UnitNode, cell: Cell, fromParent: number, branch: string) => {
    cells.set(unit.id, cell);
    occupants.set(cellKey(cell), unit.id);
    steps.set(unit.id, fromParent);
    branchOf.set(unit.id, branch);
    const fromRoot = hexDistance(cell, { q: 0, r: 0 });
    if (fromRoot > radius) radius = fromRoot;
    if (fromParent === 0) {
      // The root has no parent, so it is neither adjacent nor a jump.
    } else if (fromParent === 1) adjacent++;
    else {
      jumped++;
      if (fromParent > worstJump) worstJump = fromParent;
    }
  };

  /** Heavier branches choose first, then by id so the order never depends on
   *  the order the company arrived in. */
  const byWeight = (a: UnitNode, b: UnitNode) =>
    b.totalSeats - a.totalSeats || a.id.localeCompare(b.id);

  const childrenOf = (unit: UnitNode): UnitNode[] =>
    unit.childIds
      .map((id) => tree.units.get(id))
      .filter((u): u is UnitNode => !!u)
      .sort(byWeight);

  /** How much open ground a cell opens onto: free cells within two rings.
   *  This is the lookahead that stops a branch walking into a pocket and
   *  stranding its own descendants. */
  const elbowRoom = (cell: Cell): number => {
    let free = 0;
    for (const c of spiral(cell, LOOKAHEAD_RING)) {
      if (!occupants.has(cellKey(c))) free++;
    }
    return free;
  };

  /** The best free cell for a child of a unit at `from` heading `desired`.
   *  Adjacent cells are always preferred — a child next to its parent is the
   *  whole point — and only when every neighbour is taken does it ring
   *  outward, which is the jump Greg asked for. */
  const findCell = (from: Cell, desired: number): { cell: Cell; steps: number } | null => {
    for (let k = 1; k <= MAX_SEARCH_RING; k++) {
      let best: Cell | null = null;
      let bestScore = -Infinity;
      for (const candidate of ring(from, k)) {
        if (occupants.has(cellKey(candidate))) continue;
        const deviation = (angleGap(worldAngle(from, candidate, SIZE), desired) * 180) / Math.PI;
        const score = elbowRoom(candidate) * SPACE_WEIGHT - deviation * DEGREE_PENALTY;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (best) return { cell: best, steps: k };
    }
    return null;
  };

  /**
   * Depth-first, heaviest child first.
   *
   * Depth-first is the whole difference. Breadth-first packs every rung tight
   * around the last one, so by rung three the lattice has crystallised and
   * nothing has an adjacent cell left — measured at **7% adjacency** on the
   * 2,562-person shape, which is a layout where the exception is the rule.
   * Going depth-first lets the heaviest branch claim its corridor and walk
   * out into open ground before its siblings start filling in behind it.
   */
  const place = (parent: UnitNode) => {
    const parentCell = cells.get(parent.id);
    if (!parentCell) return;
    const kids = childrenOf(parent);
    if (kids.length === 0) return;

    // Which way is "onward"? Away from this unit's own parent, so a branch
    // keeps running in one direction instead of doubling back on itself.
    const grandparent = parent.parentId ? cells.get(parent.parentId) : null;
    const outward = grandparent ? worldAngle(grandparent, parentCell, SIZE) : 0;
    const wanted = fanAngles(outward, kids.length);

    kids.forEach((kid, i) => {
      const branch = parent.id === root.id ? kid.id : branchOf.get(parent.id) ?? kid.id;
      const found = findCell(parentCell, wanted[i]);
      if (!found) return; // pathological only; MAX_SEARCH_RING is generous
      take(kid, found.cell, found.steps, branch);
      place(kid);
    });
  };

  take(root, { q: 0, r: 0 }, 0, root.id);
  place(root);

  return {
    cells,
    occupants,
    steps,
    branchOf,
    radius,
    stats: { placed: cells.size, adjacent, jumped, worstJump },
  };
}

/** Every cell the allocation touched, for a territory outline. */
export const occupiedCells = (allocation: Allocation): Cell[] =>
  [...allocation.cells.values()];

/** The six directions, re-exported so a caller can reason about adjacency
 *  without importing the coordinate module twice. */
export { DIRECTIONS, add };
