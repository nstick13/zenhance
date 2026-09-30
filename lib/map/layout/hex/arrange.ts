/**
 * What moving a tile means (Greg's rules, 2026-09-30).
 *
 * The allocator decides where a company starts. This decides what happens when
 * somebody picks a tile up and puts it down somewhere else — and it is pure, so
 * every one of these rules is a unit test rather than a thing you have to drag
 * a mouse to find out about.
 *
 * Greg's rules, in his words, and where each one lives:
 *
 * - *"when a user moves a tile, they can move it anywhere until they drop it,
 *   at which point it snaps to the hexagon grid"* — `cellUnderPointer`, and
 *   the lab paints that cell while the hand is still moving.
 * - *"do not allow users to place nodes atop other nodes unless they are
 *   merging or reparenting"* — `dropOutcome` returns `blocked`, with the
 *   nearest free cell to offer instead.
 * - *"they can snap together and change colour to reparent… the user should be
 *   given the option to reparent, else the node just remains adjacent and of a
 *   different colour"* — `dropOutcome` returns `offer-reparent` and names the
 *   family it would join. Declining leaves the tile exactly where it landed.
 * - *"draw a nice chunky outline around the edge of all meta-connected nodes"*
 *   — `outline`, which is exact on a lattice: an edge is on the boundary when
 *   the cell across it is not in the set. No marching squares, no smoothing.
 *
 * Nothing here mutates anything. It answers questions.
 */
import type { OrbitalTree } from "@/lib/map/layout/model";
import {
  type Cell,
  type Point,
  cellFromKey,
  cellKey,
  corners,
  hexDistance,
  neighbours,
  spiral,
  worldToCell,
} from "@/lib/map/layout/hex/coords";

/** Where the cells currently are: cell key → unit id. */
export type Occupancy = ReadonlyMap<string, string>;

export type DropOutcome =
  /** Free ground, touching nothing that belongs to anyone else. Just a move. */
  | { kind: "move"; cell: Cell }
  /** Free ground, but touching another family. Ask before changing anything. */
  | { kind: "offer-reparent"; cell: Cell; newParentId: string; touching: string[] }
  /** Somebody is already there. Offer the nearest free cell instead. */
  | { kind: "blocked"; occupiedBy: string; nearestFree: Cell | null }
  /** Held over another unit long enough to mean it. */
  | { kind: "offer-merge"; cell: Cell; withUnitId: string };

/** The cell under a world point — what a tile would snap to if dropped now. */
export const cellUnderPointer = (point: Point, size: number): Cell => worldToCell(point, size);

/** Every unit at or below this one. A tile never travels without its branch. */
export function branchOf(tree: OrbitalTree, unitId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const unit = tree.units.get(id);
    if (!unit) return;
    for (const childId of unit.childIds) walk(childId);
  };
  walk(unitId);
  return out;
}

/**
 * The nearest free cell to `from`, ignoring cells the moving branch itself
 * occupies — it is about to vacate them.
 *
 * `mustTouch` restricts the answer to cells adjacent to that set, which is how
 * a reparented tile lands *"at the nearest free hexagonal grid space that is
 * connected to the existing chain of nodes"*.
 */
export function nearestFreeCell(
  occupancy: Occupancy,
  from: Cell,
  options: { ignore?: ReadonlySet<string>; mustTouch?: readonly Cell[]; maxRings?: number } = {},
): Cell | null {
  const { ignore, mustTouch, maxRings = 12 } = options;
  const touchable = mustTouch ? new Set(mustTouch.map(cellKey)) : null;
  const free = (cell: Cell) => {
    const who = occupancy.get(cellKey(cell));
    return !who || (ignore?.has(who) ?? false);
  };
  for (const cell of spiral(from, maxRings)) {
    if (!free(cell)) continue;
    if (touchable && !neighbours(cell).some((n) => touchable.has(cellKey(n)))) continue;
    return cell;
  }
  return null;
}

/**
 * What dropping `movingId` on `cell` would mean.
 *
 * `heldOver` is the unit the hand has been resting on long enough to arm a
 * merge — the lab measures the hold, because a dwell clock is a timing
 * question and this file has no clock.
 */
export function dropOutcome(
  tree: OrbitalTree,
  occupancy: Occupancy,
  movingId: string,
  cell: Cell,
  options: { heldOver?: string | null } = {},
): DropOutcome {
  const moving = branchOf(tree, movingId);
  const held = options.heldOver;

  if (held && held !== movingId && !moving.has(held)) {
    return { kind: "offer-merge", cell, withUnitId: held };
  }

  const sitting = occupancy.get(cellKey(cell));
  if (sitting && !moving.has(sitting)) {
    return {
      kind: "blocked",
      occupiedBy: sitting,
      nearestFree: nearestFreeCell(occupancy, cell, { ignore: moving }),
    };
  }

  // Who is this tile now touching that is not its own branch?
  const unit = tree.units.get(movingId);
  const currentParent = unit?.parentId ?? null;
  const touching: string[] = [];
  for (const n of neighbours(cell)) {
    const who = occupancy.get(cellKey(n));
    if (who && !moving.has(who)) touching.push(who);
  }

  // A tile that has come to rest against somebody else's family is the gesture
  // that offers a reparent. Touching the parent it already has is not a change,
  // and neither is touching one of its own siblings.
  const siblings = new Set(
    currentParent ? tree.units.get(currentParent)?.childIds ?? [] : [],
  );
  const candidates = touching.filter(
    (id) => id !== currentParent && !siblings.has(id) && !wouldCycle(tree, movingId, id),
  );

  if (candidates.length > 0) {
    // **The deepest one.** A tile nestled into a corner touches its new
    // neighbour, that neighbour's division, and often the company as well, and
    // "the biggest" then proposes the company almost every time — which is
    // never what the hand meant. The most specific unit you came to rest
    // against is the one you were aiming at. Headcount only breaks ties.
    const newParentId = [...candidates].sort(
      (a, b) =>
        (tree.units.get(b)?.depth ?? 0) - (tree.units.get(a)?.depth ?? 0) ||
        (tree.units.get(b)?.totalSeats ?? 0) - (tree.units.get(a)?.totalSeats ?? 0) ||
        a.localeCompare(b),
    )[0];
    return { kind: "offer-reparent", cell, newParentId, touching };
  }

  return { kind: "move", cell };
}

/** Would making `childId` report to `parentId` create a loop? */
export function wouldCycle(tree: OrbitalTree, childId: string, parentId: string): boolean {
  if (childId === parentId) return true;
  let walk: string | null | undefined = tree.units.get(parentId)?.parentId;
  while (walk) {
    if (walk === childId) return true;
    walk = tree.units.get(walk)?.parentId;
  }
  return false;
}

/**
 * Everything structurally tied to this unit's family, whether it is touching or
 * not — the set the chunky outline goes round.
 *
 * Greg, rule 8: *"if a node is dragged away from a parental group… the node
 * remains linked to the parent in the background"*, and rather than a tether,
 * *"draw a nice chunky outline around the edge of all meta-connected nodes"*.
 * So this is the parent, its children and the parent itself — the family, not
 * the whole branch, because a family is the thing adjacency was standing for.
 */
export function metaConnected(tree: OrbitalTree, unitId: string): Set<string> {
  const unit = tree.units.get(unitId);
  if (!unit) return new Set();
  const anchor = unit.parentId ? tree.units.get(unit.parentId) : unit;
  if (!anchor) return new Set([unitId]);
  return new Set([anchor.id, ...anchor.childIds]);
}

export type Segment = { from: Point; to: Point };

/**
 * The boundary of a set of cells, as line segments in world space.
 *
 * Exact, and one pass: a hexagon's edge is on the boundary exactly when the
 * cell across it is not in the set. The orbital map needed a smooth union, a
 * marching-squares grid and a Chaikin pass for the same picture, cost 25–35ms
 * per data change, and could still miss a corridor thinner than its sampler.
 * This cannot be wrong and is too cheap to measure.
 */
export function outline(cells: readonly Cell[], size: number): Segment[] {
  const set = new Set(cells.map(cellKey));
  const segments: Segment[] = [];
  for (const cell of cells) {
    const pts = corners(cell, size);
    const around = neighbours(cell);
    for (let i = 0; i < 6; i++) {
      // Corner i and corner i+1 span the edge facing neighbour i+... — the
      // corner list starts due east and the direction list starts due east, so
      // edge i sits between directions i and i-1. Walking both in the same
      // order keeps them in step.
      if (set.has(cellKey(around[(i + 1) % 6]))) continue;
      segments.push({ from: pts[i], to: pts[(i + 1) % 6] });
    }
  }
  return segments;
}

/**
 * Where a whole island lands when it is dragged: the same shape if the ground
 * will take it, and a warning if it will not.
 *
 * Greg, on rule 7: *"if there's enough space, there's enough space. If there
 * isn't, the user should be told 'your shape might change to fit into where you
 * want to put it, proceed?'"* So this reports which of the two happened and
 * lets the caller ask before anything moves.
 */
export type IslandLanding =
  | { kind: "fits"; cells: Map<string, Cell> }
  | { kind: "reshaped"; cells: Map<string, Cell> }
  | { kind: "no-room" };

export function placeIsland(
  occupancy: Occupancy,
  members: ReadonlyMap<string, Cell>,
  anchorId: string,
  target: Cell,
): IslandLanding {
  const anchor = members.get(anchorId);
  if (!anchor) return { kind: "no-room" };
  const moving = new Set(members.keys());
  const free = (cell: Cell) => {
    const who = occupancy.get(cellKey(cell));
    return !who || moving.has(who);
  };

  // The silhouette people have learnt, offset to the new anchor.
  const shifted = new Map<string, Cell>();
  let fits = true;
  for (const [id, cell] of members) {
    const moved = {
      q: cell.q - anchor.q + target.q,
      r: cell.r - anchor.r + target.r,
    };
    if (!free(moved)) fits = false;
    shifted.set(id, moved);
  }
  if (fits) return { kind: "fits", cells: shifted };

  // It will not go. Reflow, keeping the anchor where the hand put it and
  // seating the rest in the nearest free ground that touches what is placed.
  const taken = new Map<string, string>();
  for (const [key, id] of occupancy) if (!moving.has(id)) taken.set(key, id);
  if (!free(target)) return { kind: "no-room" };

  const out = new Map<string, Cell>([[anchorId, target]]);
  taken.set(cellKey(target), anchorId);
  const placed: Cell[] = [target];
  const order = [...members.keys()]
    .filter((id) => id !== anchorId)
    .sort((a, b) => hexDistance(anchor, members.get(a)!) - hexDistance(anchor, members.get(b)!)
      || a.localeCompare(b));

  for (const id of order) {
    const want = {
      q: members.get(id)!.q - anchor.q + target.q,
      r: members.get(id)!.r - anchor.r + target.r,
    };
    const cell = nearestFreeCell(taken, want, { mustTouch: placed });
    if (!cell) return { kind: "no-room" };
    out.set(id, cell);
    taken.set(cellKey(cell), id);
    placed.push(cell);
  }
  return { kind: "reshaped", cells: out };
}

export { cellFromKey, cellKey };
