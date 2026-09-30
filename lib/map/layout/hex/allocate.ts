/**
 * Giving every unit a cell — the hard half of the hex layout (2026-09-29).
 *
 * The lattice in `coords.ts` is arithmetic. This is the part with an opinion:
 * out of the infinite plane of cells, which one does each unit get?
 *
 * ## What it is trying to do
 *
 * 1. **A family is one connected patch.** Greg, 2026-09-30: *"child nodes do
 *    not have to directly snap to their parent nodes, they can snap to sibling
 *    nodes."* A child takes a free cell on the edge of its family — its parent
 *    or any sibling already seated — so a family of any size is a blob, which
 *    is always achievable.
 *
 *    That sentence removed a hard ceiling. Seating every child against its
 *    parent means at most five can touch (six neighbours, one is the way
 *    home), and on companies with realistic spans adjacency fell to **24%**.
 *    It matters more than it sounds, because there are no connection lines any
 *    more: adjacency and colour are the only things saying these units belong
 *    together.
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
 * A child whose family is completely walled in becomes an **exclave**: it
 * takes the nearest free cell it can reach and sits apart, joined to its
 * family by colour alone. That is not a failure state — it is the arrangement
 * Greg described in rule 8, where a tile dragged away from its family stays
 * structurally linked and the two are drawn inside one outline, the way an
 * atlas draws Kaliningrad. About one unit in ten lands this way on the
 * 2,562-person company.
 *
 * **Three rewrites were tried and abandoned before this one**, all aiming to
 * get exclaves to zero by reserving ground before placing anyone: growing
 * regions outward from each child at once, scoring cells by how much room a
 * subtree would need, and partitioning the parent's ground into angular
 * wedges. Each was worse than what it replaced — the best of them placed 201
 * of 395 units, because a branch handed a territory one cell per unit has
 * nothing left to subdivide and every rung below it starves. If you are about
 * to try reservation again, that is the wall you will hit, and it needs the
 * quota to carry slack at every level rather than only at the top.
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
  neighbours,
  ring as ringCells,
  spiral,
  worldAngle,
} from "@/lib/map/layout/hex/coords";

export type Allocation = {
  /** unit id → its cell. */
  cells: Map<string, Cell>;
  /** cell key → the unit sitting there. */
  occupants: Map<string, string>;
  /** unit id → how many steps from its parent. 1 means it touches the parent
   *  itself; more means it reached its family through a sibling. */
  steps: Map<string, number>;
  /** Units that could not touch their family and sit apart from it. */
  exclaves: Set<string>;
  /** unit id → the top-level branch it belongs to, for territory colouring. */
  branchOf: Map<string, string>;
  /** Furthest ring any unit reached, for a quick extent. */
  radius: number;
  stats: {
    placed: number;
    /** Touching the parent or a sibling — the promise this layout makes. */
    connected: number;
    /** Touching the parent itself. Cannot exceed five per parent, and since
     *  2026-09-30 does not need to. */
    touchingParent: number;
    exclaves: number;
    /** Families that are a single connected patch, out of all families. */
    wholeFamilies: number;
    families: number;
    worstReach: number;
  };
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

/** What a step away from the parent costs. Enough to keep a family bunched
 *  rather than strung out, not enough to beat open ground. */
const REACH_PENALTY = 200;

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
  const exclaves = new Set<string>();
  let connected = 0;
  let touchingParent = 0;
  let worstReach = 0;

  const root = tree.units.get(tree.rootId);
  if (!root) {
    return {
      cells, occupants, steps, branchOf, exclaves, radius,
      stats: {
        placed: 0, connected: 0, touchingParent: 0, exclaves: 0,
        wholeFamilies: 0, families: 0, worstReach: 0,
      },
    };
  }

  const SIZE = 1; // only angles are compared, and those are scale-free

  const take = (
    unit: UnitNode, cell: Cell, fromParent: number, branch: string, touches: boolean,
  ) => {
    cells.set(unit.id, cell);
    occupants.set(cellKey(cell), unit.id);
    steps.set(unit.id, fromParent);
    branchOf.set(unit.id, branch);
    const fromRoot = hexDistance(cell, { q: 0, r: 0 });
    if (fromRoot > radius) radius = fromRoot;
    if (fromParent === 0) return; // the root belongs to no family
    if (touches) connected++;
    else exclaves.add(unit.id);
    if (fromParent === 1) touchingParent++;
    if (fromParent > worstReach) worstReach = fromParent;
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

  /**
   * Where a child sits: on a **fan round its own parent**, not on the family's
   * outer edge.
   *
   * This replaced a search over every cell touching any already-seated sibling,
   * which produced tightly packed blobs. Blobs measured well on the thing being
   * counted — chain-on-chain clashes were 32 across the whole 2,562-person
   * company — and terribly on the thing that actually reads as a mess:
   * **54% of chains ran straight over somebody else's tile**, because a chain
   * from a parent to the far side of its own blob has to cross the siblings in
   * between. Greg saw it immediately and the metric did not.
   *
   * So: ring 1 first (six cells, five once the way home is taken), then ring 2
   * for the overflow — which is Greg's *"if a parent has more than six
   * children, then we can push a bunch of the child nodes out further so we can
   * see the connection line."*
   *
   * **Ring 2 has two kinds of cell and only one of them is any use.** Six sit
   * directly behind a ring-1 cell, two steps along the same axis, so a chain to
   * one of them runs straight through whoever is in front. The other six sit
   * between two ring-1 cells, and a chain threads the gap. Corners are
   * therefore heavily penalised, and taken only when nothing else is free.
   */
  const RING_COST = 1000;
  const BEHIND_A_SIBLING = 420;

  const findFanCell = (parentCell: Cell, desired: number): Cell | null => {
    let best: Cell | null = null;
    let bestScore = -Infinity;
    for (let ring = 1; ring <= 2; ring++) {
      for (const candidate of ringCells(parentCell, ring)) {
        if (occupants.has(cellKey(candidate))) continue;
        const deviation = (angleGap(worldAngle(parentCell, candidate, SIZE), desired) * 180) / Math.PI;
        // A ring-2 cell two steps along an axis has a ring-1 cell in front of
        // it; one between two axes has clear ground to the parent.
        const behind = ring === 2 && DIRECTIONS.some(
          (d) => candidate.q - parentCell.q === d.q * 2 && candidate.r - parentCell.r === d.r * 2,
        );
        const score =
          -ring * RING_COST
          - (behind ? BEHIND_A_SIBLING : 0)
          - deviation * DEGREE_PENALTY
          + elbowRoom(candidate) * SPACE_WEIGHT;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      if (best) return best; // never reach further out than we have to
    }
    return best;
  };

  /** Any free cell touching the family — the fallback when a parent's own fan
   *  is completely built over. Keeps a family connected when the fan cannot. */
  const findFamilyCell = (family: readonly Cell[], parentCell: Cell, desired: number): Cell | null => {
    const seen = new Set<string>();
    let best: Cell | null = null;
    let bestScore = -Infinity;
    for (const member of family) {
      for (const candidate of neighbours(member)) {
        const key = cellKey(candidate);
        if (seen.has(key) || occupants.has(key)) continue;
        seen.add(key);
        const deviation = (angleGap(worldAngle(parentCell, candidate, SIZE), desired) * 180) / Math.PI;
        const score =
          elbowRoom(candidate) * SPACE_WEIGHT
          - deviation * DEGREE_PENALTY
          - hexDistance(parentCell, candidate) * REACH_PENALTY;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
    return best;
  };

  /** Last resort, when a family is so boxed in that not one of its members has
   *  a free neighbour: the nearest free cell anywhere. Produces an exclave. */
  const findCell = (from: Cell, desired: number): { cell: Cell; steps: number } | null => {
    for (let k = 1; k <= MAX_SEARCH_RING; k++) {
      let best: Cell | null = null;
      let bestScore = -Infinity;
      for (const candidate of ringCells(from, k)) {
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

    // **Seat the whole family, then descend.** Placing a child and immediately
    // recursing into it lets that child's own descendants wall in the ground
    // its later siblings needed.
    const family: Cell[] = [parentCell];
    kids.forEach((kid, i) => {
      const branch = parent.id === root.id ? kid.id : branchOf.get(parent.id) ?? kid.id;
      const onFan = findFanCell(parentCell, wanted[i]);
      const onEdge = onFan ?? findFamilyCell(family, parentCell, wanted[i]);
      const cell = onEdge ?? findCell(parentCell, wanted[i])?.cell ?? null;
      if (!cell) return; // pathological only; MAX_SEARCH_RING is generous
      take(kid, cell, hexDistance(cell, parentCell), branch, onEdge !== null);
      family.push(cell);
    });

    for (const kid of kids) if (cells.has(kid.id)) place(kid);
  };

  take(root, { q: 0, r: 0 }, 0, root.id, true);
  place(root);

  // How many families ended up as one patch — the property the design rests
  // on now that nothing is joined by a line. Measured, not assumed.
  let families = 0;
  let wholeFamilies = 0;
  for (const unit of tree.units.values()) {
    if (unit.childIds.length === 0) continue;
    families++;
    const own = cells.get(unit.id);
    if (!own) continue;
    const patch = new Set([cellKey(own)]);
    for (const id of unit.childIds) {
      const c = cells.get(id);
      if (c) patch.add(cellKey(c));
    }
    const seen = new Set([cellKey(own)]);
    const queue: Cell[] = [own];
    while (queue.length) {
      const c = queue.pop()!;
      for (const nb of neighbours(c)) {
        const k = cellKey(nb);
        if (patch.has(k) && !seen.has(k)) { seen.add(k); queue.push(nb); }
      }
    }
    if (seen.size === patch.size) wholeFamilies++;
  }

  return {
    cells,
    occupants,
    steps,
    branchOf,
    exclaves,
    radius,
    stats: {
      placed: cells.size,
      connected,
      touchingParent,
      exclaves: exclaves.size,
      wholeFamilies,
      families,
      worstReach,
    },
  };
}

/** Every cell the allocation touched, for a territory outline. */
export const occupiedCells = (allocation: Allocation): Cell[] =>
  [...allocation.cells.values()];

/** The six directions, re-exported so a caller can reason about adjacency
 *  without importing the coordinate module twice. */
export { DIRECTIONS, add };
