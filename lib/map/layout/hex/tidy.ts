/**
 * Neatening an arrangement without undoing it (Greg, 2026-09-30).
 *
 * *"Make it so the 'clean up' function actually just neatens up islands rather
 * than dragging everything back to the centre… one press of clean up makes the
 * islands neat — connection lines legible, only sibling chains clash, cousin
 * chains should not clash where possible — and de-clashes the central
 * spaghetti, potentially by rotating tiles by 60º or as needed. A connection
 * line should not emerge in one direction only to loop back on itself. An
 * additional press would pull the whole picture back to the compressed view."*
 *
 * So tidying has two stages, and only the second is the old behaviour of
 * throwing an arrangement away.
 *
 * ## What "neaten" is allowed to touch
 *
 * **Anything a person placed by hand stays exactly where they put it.** That is
 * the whole difference between this and the reset — and it is Law 3 of the
 * orbital engine, which said the same thing about authored placements. Every
 * other unit is the layout's to move.
 *
 * ## How
 *
 * On a hex lattice the natural move is a **rotation by a sixth of a turn about
 * a cell**. It keeps every unit on the grid, keeps a branch's internal shape
 * exactly as it was, and is the only transform that can change which way a
 * branch faces without changing what it looks like.
 *
 * So, top-down: for each unit, try its subtree in all six orientations about
 * that unit, throw away any that would land on somebody else, and keep the one
 * that points the branch furthest **away from where its own chain arrives**.
 * That is what stops a line leaving a parent and looping back on itself, which
 * is the thing that reads as spaghetti — and because the anchor never moves,
 * an island stays where it was put.
 *
 * Crossings are then counted before and after, so the caller can say whether it
 * actually helped rather than assuming it did.
 */
import type { OrbitalTree } from "@/lib/map/layout/model";
import {
  type Cell,
  type Point,
  axialRoute,
  cellKey,
  cellToWorld,
  hexDistance,
  neighbours,
} from "@/lib/map/layout/hex/coords";

/** Rotate a cell `steps` sixths of a turn about `centre`.
 *
 *  In cube coordinates a sixth of a turn is a rotation of the three axes onto
 *  each other, which in axial is `(q, r) → (-r, q + r)`. Doing it `steps` times
 *  covers the whole hexagonal symmetry group, and every result is a real cell —
 *  no rounding, no drift. */
export function rotateCell(cell: Cell, centre: Cell, steps: number): Cell {
  let q = cell.q - centre.q;
  let r = cell.r - centre.r;
  const turns = ((steps % 6) + 6) % 6;
  for (let i = 0; i < turns; i++) {
    const nq = -r;
    const nr = q + r;
    q = nq;
    r = nr;
  }
  return { q: q + centre.q, r: r + centre.r };
}

const EPS = 1e-9;
const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do two segments properly cross? Segments that merely meet at an endpoint do
 *  not count — every child's chain meets its parent's, and that is the drawing
 *  working, not a clash. */
export function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  if (near(a1, b1) || near(a1, b2) || near(a2, b1) || near(a2, b2)) return false;
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  return (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  );
}

export type Chain = { unitId: string; parentId: string; points: Point[] };

/** Every chain in the picture, as the renderer draws it. */
export function chainsOf(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  size: number,
): Chain[] {
  const out: Chain[] = [];
  for (const unit of tree.units.values()) {
    if (!unit.parentId) continue;
    const here = cells.get(unit.id);
    const there = cells.get(unit.parentId);
    if (!here || !there) continue;
    out.push({ unitId: unit.id, parentId: unit.parentId, points: axialRoute(here, there, size) });
  }
  return out;
}

/**
 * How many pairs of chains cross, split by how closely related they are.
 *
 * Greg's bar: *"only sibling chains should clash; cousin chains should not
 * clash, where possible."* Two chains are siblings when they run to the same
 * parent — they are bound to converge, so a crossing there is the cost of a
 * family sitting together. Anything else is a cousin crossing, and those are
 * the ones that make a picture unreadable.
 */
export function countCrossings(chains: readonly Chain[]): { siblings: number; cousins: number } {
  let siblings = 0;
  let cousins = 0;
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const a = chains[i];
      const b = chains[j];
      let hit = false;
      for (let p = 0; p + 1 < a.points.length && !hit; p++) {
        for (let q = 0; q + 1 < b.points.length && !hit; q++) {
          if (segmentsCross(a.points[p], a.points[p + 1], b.points[q], b.points[q + 1])) hit = true;
        }
      }
      if (!hit) continue;
      if (a.parentId === b.parentId) siblings++;
      else cousins++;
    }
  }
  return { siblings, cousins };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

const boundsOf = (chain: Chain): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of chain.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

const overlaps = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

const chainsCross = (a: Chain, b: Chain): boolean => {
  for (let p = 0; p + 1 < a.points.length; p++) {
    for (let q = 0; q + 1 < b.points.length; q++) {
      if (segmentsCross(a.points[p], a.points[p + 1], b.points[q], b.points[q + 1])) return true;
    }
  }
  return false;
};

/**
 * How close a chain passes to a tile it does not belong to.
 *
 * **This is the measure that matters, and it took a while to find.** Chain-on-
 * chain clashes were 32 across the whole 2,562-person company while
 * *"connection lines now seem to cross a lot more"* was the complaint — because
 * 54% of chains were running through the middle of somebody's tile, which the
 * chain-on-chain count cannot see at all. An X between two lines reads as a
 * junction; a line through a tile reads as a mistake.
 *
 * A run along a corner direction is tangent to the cells it passes — exactly
 * one inradius from each centre — so the threshold sits well inside that.
 */
const THROUGH_SHARE = 0.55;

const distanceToSegment = (p: Point, q: Point, c: Point): number => {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((c.x - p.x) * dx + (c.y - p.y) * dy) / len2)) : 0;
  return Math.hypot(c.x - (p.x + dx * t), c.y - (p.y + dy * t));
};

/** How many (chain, tile) pairs have the chain running through the tile. */
export function countTilesCrossed(
  chains: readonly Chain[],
  cells: ReadonlyMap<string, Cell>,
  size: number,
): number {
  const room = (size * Math.sqrt(3)) / 2;
  const world: [string, Point][] = [...cells].map(([id, c]) => [id, cellToWorld(c, size)]);
  let total = 0;
  for (const chain of chains) {
    for (const [id, centre] of world) {
      if (id === chain.unitId || id === chain.parentId) continue;
      for (let i = 0; i + 1 < chain.points.length; i++) {
        if (distanceToSegment(chain.points[i], chain.points[i + 1], centre) < room * THROUGH_SHARE) {
          total++;
          break;
        }
      }
    }
  }
  return total;
}

export type NeatenResult = {
  cells: Map<string, Cell>;
  /** How many branches travelled back to their family, and how many were
   *  turned to face the right way — with what it did to the crossings. */
  gathered: number;
  turned: number;
  /** (chain, tile) pairs where the chain runs through the tile. */
  tilesBefore: number;
  tilesAfter: number;
  before: { siblings: number; cousins: number };
  after: { siblings: number; cousins: number };
};

/** Every unit at or below this one. */
function subtree(tree: OrbitalTree, id: string, out = new Set<string>()): Set<string> {
  if (out.has(id)) return out;
  out.add(id);
  for (const childId of tree.units.get(id)?.childIds ?? []) subtree(tree, childId, out);
  return out;
}

/**
 * Turn each branch to face away from where its own chain arrives, without
 * moving anything a person placed.
 *
 * `pinned` is the set of units somebody dragged. A branch is only turned when
 * the only pinned unit inside it is its own anchor — otherwise turning it would
 * move a placement that was chosen deliberately.
 */
export function neaten(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  pinned: ReadonlySet<string>,
  size: number,
): NeatenResult {
  const placed = new Map(cells);
  let gathered = 0;
  let allChains = chainsOf(tree, placed, size);
  const before = countCrossings(allChains);
  const tilesBefore = countTilesCrossed(allChains, placed, size);
  let turned = 0;

  // --- phase one: gather the stragglers ------------------------------------
  //
  // Turning a branch can only change which way it faces, never how far away it
  // is, and a chain that runs half the company is unreadable whichever way it
  // points. So first: any branch that has drifted off its family — and that
  // nobody placed there on purpose — travels back to its family's own edge,
  // carrying its shape with it.
  //
  // This is the allocator's rule applied locally, and it is what "makes the
  // islands neat" actually means: a division's teams gather round the division
  // rather than trailing across the map to it.
  {
    const order = [...tree.units.values()]
      .filter((u) => u.parentId)
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

    for (const unit of order) {
      if (pinned.has(unit.id)) continue;
      const here = placed.get(unit.id);
      const home = unit.parentId ? placed.get(unit.parentId) : null;
      if (!here || !home) continue;
      if (hexDistance(here, home) <= 1) continue; // already against its family

      const mine = subtree(tree, unit.id);
      if ([...mine].some((id) => pinned.has(id))) continue; // a hand is in there

      const taken = new Map<string, string>();
      for (const [id, cell] of placed) if (!mine.has(id)) taken.set(cellKey(cell), id);

      // The family's ground: the parent and whichever siblings are already
      // sitting against it.
      const family: Cell[] = [home];
      for (const siblingId of tree.units.get(unit.parentId!)?.childIds ?? []) {
        if (siblingId === unit.id) continue;
        const cell = placed.get(siblingId);
        if (cell && hexDistance(cell, home) <= 1) family.push(cell);
      }

      let target: Cell | null = null;
      let bestD = Infinity;
      const seen = new Set<string>();
      for (const member of family) {
        for (const candidate of neighbours(member)) {
          const key = cellKey(candidate);
          if (seen.has(key) || taken.has(key)) continue;
          seen.add(key);
          // Every cell the branch would need has to be free as well.
          let fits = true;
          for (const id of mine) {
            const from = placed.get(id);
            if (!from) continue;
            const to = {
              q: from.q - here.q + candidate.q,
              r: from.r - here.r + candidate.r,
            };
            if (taken.has(cellKey(to))) { fits = false; break; }
          }
          if (!fits) continue;
          const d = hexDistance(home, candidate);
          if (d < bestD) { bestD = d; target = candidate; }
        }
      }
      if (!target) continue;

      for (const id of mine) {
        const from = placed.get(id);
        if (from) placed.set(id, { q: from.q - here.q + target.q, r: from.r - here.r + target.r });
      }
      gathered++;
    }
    allChains = chainsOf(tree, placed, size);
  }

  // --- phase two: turn each branch to face the right way --------------------
  //
  // Top-down: a parent settles which way it faces before its children do, so a
  // child is turning against ground that has stopped moving.
  const order = [...tree.units.values()]
    .filter((u) => u.childIds.length > 0 && u.parentId)
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  for (const unit of order) {
    const anchor = placed.get(unit.id);
    const home = unit.parentId ? placed.get(unit.parentId) : null;
    if (!anchor || !home) continue;

    const members = [...subtree(tree, unit.id)].filter((id) => id !== unit.id);
    if (members.length === 0) continue;
    if (members.some((id) => pinned.has(id))) continue; // a hand is in there

    // Where everyone else is, so a turn cannot land on them.
    const mine = new Set([unit.id, ...members]);
    const taken = new Map<string, string>();
    for (const [id, cell] of placed) if (!mine.has(id)) taken.set(cellKey(cell), id);

    const homeWorld = cellToWorld(home, size);
    const anchorWorld = cellToWorld(anchor, size);
    // The direction the chain arrives from, normalised.
    const inX = anchorWorld.x - homeWorld.x;
    const inY = anchorWorld.y - homeWorld.y;
    const inLen = Math.hypot(inX, inY) || 1;

    // The chains this turn cannot affect: everything with neither end inside
    // the branch. They are the wall the branch is being fitted against, and a
    // bounding box keeps the comparison to the ones actually nearby.
    const outside = allChains.filter((c) => !mine.has(c.unitId) && !mine.has(c.parentId));

    let bestSteps = 0;
    let bestScore = -Infinity;
    for (let steps = 0; steps < 6; steps++) {
      let blocked = false;
      let outward = 0;
      const seen = new Set<string>();
      for (const id of members) {
        const from = placed.get(id);
        if (!from) continue;
        const to = rotateCell(from, anchor, steps);
        const key = cellKey(to);
        if (taken.has(key) || seen.has(key)) { blocked = true; break; }
        seen.add(key);
        const w = cellToWorld(to, size);
        const dx = w.x - anchorWorld.x;
        const dy = w.y - anchorWorld.y;
        const len = Math.hypot(dx, dy) || 1;
        // How far this member lies in the direction the branch was already
        // heading. Weighted toward the near members, which are the ones whose
        // chains would visibly double back.
        outward += ((dx * inX + dy * inY) / (len * inLen)) / Math.max(1, hexDistance(anchor, to));
      }
      if (blocked) continue;

      // What this turn would actually cost in clashes. Only the branch's own
      // chains are recounted — the ones between two units outside it cannot
      // move — and its internal chains keep their shape under a rotation, so
      // the only pairs that change are branch-against-world.
      const turnedCells = new Map(placed);
      for (const id of members) {
        const from = placed.get(id);
        if (from) turnedCells.set(id, rotateCell(from, anchor, steps));
      }
      const branchChains = chainsOf(tree, turnedCells, size)
        .filter((c) => mine.has(c.unitId) || mine.has(c.parentId));
      let siblingHits = 0;
      let cousinHits = 0;
      for (const a of branchChains) {
        const ab = boundsOf(a);
        for (const b of outside) {
          if (!overlaps(ab, boundsOf(b))) continue;
          if (!chainsCross(a, b)) continue;
          if (a.parentId === b.parentId) siblingHits++;
          else cousinHits++;
        }
      }
      // And the one that actually reads as a mess: a chain through a tile.
      const throughTiles = countTilesCrossed(branchChains, turnedCells, size);

      // Cousins are what Greg asked to clear; siblings are allowed to converge
      // on their shared parent and cost a tenth as much. Facing the right way
      // is the tie-break, and a tie goes to leaving the branch alone — turning
      // one that gains nothing is churn, and churn in a hand-made arrangement
      // is its own cost.
      // A chain through a tile is worth more than a chain across a chain: one
      // looks like a mistake, the other looks like a junction. Cousins then
      // count ten times siblings, because siblings are bound to converge on
      // their shared parent. Facing the right way is the tie-break.
      const score =
        -(throughTiles * 30 + cousinHits * 10 + siblingHits)
        + outward * 0.5
        + (steps === 0 ? 1e-6 : 0);
      if (score > bestScore) { bestScore = score; bestSteps = steps; }
    }

    if (bestSteps === 0) continue;
    for (const id of members) {
      const from = placed.get(id);
      if (from) placed.set(id, rotateCell(from, anchor, bestSteps));
    }
    allChains = chainsOf(tree, placed, size);
    turned++;
  }

  const finalChains = chainsOf(tree, placed, size);
  return {
    cells: placed,
    turned,
    gathered,
    before,
    after: countCrossings(finalChains),
    tilesBefore,
    tilesAfter: countTilesCrossed(finalChains, placed, size),
  };
}
