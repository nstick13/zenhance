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

/**
 * What the outline goes round when you point at a tile (Greg, 2026-09-30).
 *
 * *"The black outline should run around a node and all its children,
 * grandchildren, and so on — it should wrap the whole branch the hovered tile
 * births **unless** it's a child node with no children, in which case the
 * outline should outline the immediate family group: siblings and parent."*
 *
 * So the question the outline answers depends on what you pointed at. Point at
 * a manager and it asks *what do you run?* — the whole branch. Point at a team
 * that runs nothing and that question has no answer, so it asks the only other
 * one worth asking: *who are you with?* — your parent and your siblings.
 */
export function hoverGroup(tree: OrbitalTree, unitId: string): Set<string> {
  const unit = tree.units.get(unitId);
  if (!unit) return new Set();
  return unit.childIds.length > 0 ? branchOf(tree, unitId) : metaConnected(tree, unitId);
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
/**
 * Which neighbour each edge faces.
 *
 * Corner `i` sits at `i × 60°`, so the edge between corners `i` and `i+1` faces
 * outward at `i × 60 + 30°`. The six neighbour directions, converted to world
 * space, lie at 30°, 330°, 270°, 210°, 150° and 90° — **descending**, because
 * screen y grows downward while the corners are generated counter-clockwise in
 * maths. Matching the two lists gives edge `i` → direction `(6 - i) % 6`.
 *
 * It was `(i + 1) % 6` until 2026-09-30, which is wrong for all six. Because
 * that mapping is still a bijection, the outline dropped exactly as many edges
 * as it should have — just never the right ones. So a family's shared edges
 * stayed drawn and some of its real boundary went missing, and the outline came
 * out as what Greg called *"a snaking millipede"*. The test that should have
 * caught it only counted segments, which is precisely the thing a wrong
 * bijection preserves.
 */
const EDGE_FACES: readonly number[] = [0, 5, 4, 3, 2, 1];

export function outline(cells: readonly Cell[], size: number): Segment[] {
  const set = new Set(cells.map(cellKey));
  const segments: Segment[] = [];
  for (const cell of cells) {
    const pts = corners(cell, size);
    const around = neighbours(cell);
    for (let i = 0; i < 6; i++) {
      if (set.has(cellKey(around[EDGE_FACES[i]]))) continue;
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
  /** The shape, exactly where the hand is. */
  | { kind: "fits"; cells: Map<string, Cell>; anchor: Cell }
  /** The shape, seated a cell or two aside because something clipped it. */
  | { kind: "nudged"; cells: Map<string, Cell>; anchor: Cell }
  /** It was already in pieces, so it has been gathered. No dialog — there is
   *  no shape to mourn. Greg, 2026-09-30. */
  | { kind: "gathered"; cells: Map<string, Cell>; anchor: Cell }
  /** It was whole and would not go in, so it has been reflowed. Ask first. */
  | { kind: "reshaped"; cells: Map<string, Cell>; anchor: Cell }
  /** The second pick-up: the branch has been treed outward from its way home.
   *  Asked for by the gesture, so no dialog. */
  /** Translated as-is, except for the groups that would have landed on
   *  somebody; those moved aside, each to the nearest space that fits it
   *  whole. No dialog — nothing anyone built was lost. */
  | { kind: "parted"; cells: Map<string, Cell>; anchor: Cell; moved: number }
  | { kind: "no-room" };

/**
 * Translate a branch as-is, and move aside only what actually clashes.
 *
 * Greg, 2026-10-03: *"if a user picks up a family node and moves it, the thing
 * should be moved as-is, including any archipelagos… if the user drops the
 * family and there is a clash, then only the groups that clash (even by one
 * cell) should be repositioned — they should reposition to the nearest-to-
 * proposed space that can host that group without a clash."*
 *
 * The old behaviour reflowed the **whole** branch the moment one cell of it
 * caught something, which gathered a spread-out archipelago into a single
 * continent and destroyed the arrangement somebody had built. This keeps the
 * translation, keeps every group's own shape, and relocates nothing that was
 * not actually in the way.
 *
 * `groupOf` decides what "a group" is — a team, normally. Without it the whole
 * branch is one group, and this degrades to all-or-nothing.
 */
export function partedLanding(
  occupancy: Occupancy,
  members: ReadonlyMap<string, Cell>,
  anchorId: string,
  target: Cell,
  groupOf: (unitId: string) => string,
  /**
   * Clear tiles wanted between two groups. Without it this checks only whether
   * a cell is *occupied*, which is how a drop could leave two teams touching
   * however carefully the allocator had spaced them — the rearrange path
   * predates the spacing rules and never learned them.
   *
   * The anchor's own group is exempt: that is where the hand let go, and Greg's
   * first law is that a branch lands there. Everything the layout moves *for*
   * you obeys the gap.
   */
): { cells: Map<string, Cell>; moved: number } | null {
  const anchor = members.get(anchorId);
  if (!anchor) return null;
  const moving = new Set(members.keys());
  const taken = new Map<string, string>();
  for (const [key, id] of occupancy) if (!moving.has(id)) taken.set(key, id);

  const dq = target.q - anchor.q;
  const dr = target.r - anchor.r;
  const shifted = new Map<string, Cell>();
  for (const [id, cell] of members) shifted.set(id, { q: cell.q + dq, r: cell.r + dr });

  // Who travels with whom. A group moves as one body or not at all.
  const byGroup = new Map<string, string[]>();
  for (const id of members.keys()) {
    const g = groupOf(id);
    const list = byGroup.get(g) ?? [];
    list.push(id);
    byGroup.set(g, list);
  }

  // The anchor's own group is settled first and never moves: it is where the
  // hand let go, and Greg's first law is that a branch lands there.
  const anchorGroup = groupOf(anchorId);
  const order = [anchorGroup, ...[...byGroup.keys()].filter((g) => g !== anchorGroup)];

  const out = new Map<string, Cell>();
  const claim = (ids: readonly string[], offset: { q: number; r: number }) => {
    for (const id of ids) {
      const at = shifted.get(id)!;
      const cell = { q: at.q + offset.q, r: at.r + offset.r };
      out.set(id, cell);
      taken.set(cellKey(cell), id);
    }
  };
  /** Far enough from everybody this group is not related to. */

  /**
   * Free ground, and nothing else to satisfy.
   *
   * It used to take an `obeySpacing` flag and consult the archipelago's
   * `gapBetween`. That rule went with the archipelago on 2026-10-15, and it had
   * already stopped reaching this path on 2026-10-14 — Law 4, the layout owns
   * spacing and the drop path holds no rule of its own.
   */
  const clear = (ids: readonly string[], offset: { q: number; r: number }) =>
    ids.every((id) => {
      const at = shifted.get(id)!;
      return !taken.has(cellKey({ q: at.q + offset.q, r: at.r + offset.r }));
    });

  let moved = 0;
  for (const group of order) {
    const ids = byGroup.get(group)!;
    if (clear(ids, { q: 0, r: 0 })) { claim(ids, { q: 0, r: 0 }); continue; }
    if (group === anchorGroup) return null; // the hand's own landing is taken
    /**
     * The nearest offset from where it would have gone that takes the whole
     * group.
     *
     * One pass, not two. There used to be a spaced search followed by a merely
     * non-overlapping one, because the archipelago's `gapBetween` could refuse
     * ground that occupancy allowed. That rule went with the archipelago on
     * 2026-10-15 and the two passes became the same pass.
     */
    let placed = false;
    for (const near of spiral({ q: 0, r: 0 }, PART_SEARCH_RINGS)) {
      if (near.q === 0 && near.r === 0) continue;
      if (!clear(ids, near)) continue;
      claim(ids, near);
      moved++;
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  return { cells: out, moved };
}

/** How far a clashing group may be shifted to find room of its own. Generous:
 *  the alternative is reflowing the branch, which costs its shape. */
const PART_SEARCH_RINGS = 14;

/** Is this set of cells one connected patch? */
export function isOnePatch(cells: Iterable<Cell>): boolean {
  // Materialise once. `Map.values()` is an iterator, and spreading it twice
  // leaves the second spread empty — which quietly reported every scattered
  // family as whole.
  const list = [...cells];
  const keys = new Set(list.map(cellKey));
  const first = list[0];
  if (!first) return true;
  const seen = new Set([cellKey(first)]);
  const queue = [first];
  while (queue.length) {
    const c = queue.pop()!;
    for (const n of neighbours(c)) {
      const k = cellKey(n);
      if (keys.has(k) && !seen.has(k)) { seen.add(k); queue.push(n); }
    }
  }
  return seen.size === keys.size;
}

/** How far a landing may be nudged to keep a branch's shape. Two rings is
 *  eighteen cells — enough to slip past a stray neighbour, small enough that
 *  the branch still lands where the hand meant. */
const NUDGE_RINGS = 2;

/**
 * **How much further than its own clear ground a unit may sit from its family
 * before it counts as lost.**
 *
 * The slack in the repair at the end of `reflow`. One tile, because the point
 * is to catch the outlier the eye finds — the node adrift dragging a long chain
 * behind it — and not to re-decide placements that are merely a little loose.
 */
const LOST = 1;


/**
 * **The layout's own spacing, handed to the paths that re-lay a branch.**
 *
 * Law 4: one measure of distance. `clearFor` is `spacedBy` straight off
 * `layoutTerritories` — the clear ground it kept round a unit, a share of the
 * size of the thing it separates. `isKin` says who that clear ground does *not*
 * apply to: a unit's own line of ancestors and its own descendants, because a
 * body sits inside its parent's ground (Law 2). Everybody else is a stranger.
 *
 * This is **not** passed on a plain hand drop. Law 0: where a hand puts
 * something is not the engine's business to improve, and a drop that silently
 * spaced itself out would be the engine arguing with the hand. It is passed
 * when the gesture asks for a tidy — which is what picking the same node up
 * again within five seconds means.
 */
export type TidySpacing = {
  clearFor: (unitId: string) => number;
  isKin: (a: string, b: string) => boolean;
};

/**
 * Clear water for a new island in a tidy up — on the right side of its parent.
 *
 * Greg, 2026-10-03: *"I want the tree orientation to rotate so that it's always
 * away from the parent… the highest-ranked parent in this group [should not be]
 * buried deep on the other side of the newly-created archipelago. It should be
 * on the side of the inbound principal connection line back to whatever its
 * parent is."*
 *
 * So this takes the nearest *qualifying* ring and then picks the cell on it
 * pointing furthest from `home` — rather than simply the first clear cell the
 * spiral happens to reach, which is what buried the parent.
 */
function firstClearCell(
  occupancy: ReadonlyMap<string, string>,
  from: Cell,
  ok: (cell: Cell) => boolean,
  home: Cell | null,
  maxRings = 16,
): Cell | null {
  const awayness = (cell: Cell): number => {
    if (!home) return 0;
    // 1 when the cell is directly away from home, −1 when straight toward it.
    const ax = cell.q - from.q, az = cell.r - from.r;
    const bx = from.q - home.q, bz = from.r - home.r;
    const ux = 1.5 * ax, uy = Math.sqrt(3) * (az + ax / 2);
    const vx = 1.5 * bx, vy = Math.sqrt(3) * (bz + bx / 2);
    const na = Math.hypot(ux, uy), nb = Math.hypot(vx, vy);
    return na === 0 || nb === 0 ? 0 : (ux * vx + uy * vy) / (na * nb);
  };
  let fallback: Cell | null = null;
  let best: { cell: Cell; score: number } | null = null;
  let foundAt = Infinity;
  for (const cell of spiral(from, maxRings)) {
    if (cellKey(cell) === cellKey(from) || occupancy.has(cellKey(cell))) continue;
    const ring = hexDistance(cell, from);
    if (best && ring > foundAt) break; // the nearest qualifying ring wins
    if (!ok(cell)) { fallback ??= cell; continue; }
    const score = awayness(cell);
    if (!best || score > best.score) { best = { cell, score }; foundAt = ring; }
  }
  return best?.cell ?? fallback;
}

/**
 * Where a whole island lands when it is dragged.
 *
 * **This always answers**, short of there being nowhere at all, and the answer
 * is the one that commits. Greg, 2026-10-01: *"when it dropped it landed as
 * something unlike what it was suggesting."*
 *
 * It did, and the reason was two mechanisms disagreeing. This returned
 * `no-room` the moment the cell under the cursor was occupied — so there was no
 * preview while the hand was over anybody — and the drop then asked
 * `dropOutcome` instead, which found a free cell somewhere else and committed a
 * landing nobody had been shown. **The preview is now the only thing that
 * decides where a branch goes**; `dropOutcome` is left to answer the question
 * it is actually for, which is whether a drop changes who reports to whom.
 *
 * In order: the shape where the hand is; the shape a cell or two aside; and
 * only then a reflow. A branch already in pieces skips straight to the reflow,
 * because its silhouette is not a shape anybody chose.
 *
 * **The five-second tidy no longer comes through here** (2026-10-17). It used to
 * have a `radiateFrom` path that re-flowed the branch outward from its parent,
 * and that path had already been unreachable for a day — the lab re-lays an
 * armed branch and returns before it reaches this function. It is now
 * `deferBranch`, which lays the branch in the map's own frame and defers to the
 * master centre by distance. So this answers the plain drop and nothing else:
 * carry a body, keep its shape, step the clashes aside.
 */
export function placeIsland(
  occupancy: Occupancy,
  members: ReadonlyMap<string, Cell>,
  anchorId: string,
  target: Cell,
  /** Who reports to whom inside the branch. A reflow needs it to seat a unit
   *  against its own parent; without it the layout can only guess from the
   *  shape, and guessing is what grew the crab arms. */
  childrenOf?: (unitId: string) => readonly string[],
  /** What travels as one body when something has to move aside. A team,
   *  normally. Without it a clash is all-or-nothing, as it used to be. */
  groupOf?: (unitId: string) => string,
): IslandLanding {
  const anchor = members.get(anchorId);
  if (!anchor) return { kind: "no-room" };
  const moving = new Set(members.keys());
  const free = (cell: Cell) => {
    const who = occupancy.get(cellKey(cell));
    return !who || moving.has(who);
  };

  /** The silhouette people have learnt, offset to a candidate anchor. */
  const shapeAt = (at: Cell) => {
    const out = new Map<string, Cell>();
    let fits = true;
    for (const [id, cell] of members) {
      const moved = { q: cell.q - anchor.q + at.q, r: cell.r - anchor.r + at.r };
      if (!free(moved)) fits = false;
      out.set(id, moved);
    }
    return { fits, cells: out };
  };

  const wasWhole = isOnePatch(members.values());

  /**
   * **Always try to move it as it is, whatever shape it is in.**
   *
   * Greg, 2026-10-02: *"if a user picks up a family node and moves it, the
   * thing should be moved as-is, including any archipelagos."*
   *
   * This used to be gated on `wasWhole`, and under the atlas that quietly
   * turned the rule off for anything of any size. A nested territory has clear
   * ground inside it **by design** — that is the spacing rule — so a branch of
   * fourteen units is not one connected patch and never was going to be. It
   * skipped straight past this to a full re-layout and came back with 7% of its
   * shape: Greg, 2026-10-03, *"the auto-rearrange struggles and then blasts
   * teams into confetti."* The same branch on the archipelago was one patch,
   * translated exactly, and looked perfect — which is why it read as a
   * big-branch problem rather than as a gate in the wrong place.
   *
   * Whether a branch is one patch is a fact about **what is worth warning
   * about** if the shape is lost, and it is still used for that below. It was
   * never a reason not to try.
   *
   * The nudge stays bounded for the reason it was written: a branch with
   * outposts spans everything between its mainland and its furthest one, so
   * almost anywhere it lands something in that span touches something. Two
   * rings is eighteen tries, imperceptible where the hand let go, and cheap
   * enough to attempt for any branch at all.
   */
  const exact = shapeAt(target);
  if (exact.fits) return { kind: "fits", cells: exact.cells, anchor: target };

  for (const nearby of spiral(target, NUDGE_RINGS)) {
    if (cellKey(nearby) === cellKey(target)) continue;
    const nudged = shapeAt(nearby);
    if (nudged.fits) return { kind: "nudged", cells: nudged.cells, anchor: nearby };
  }

  // **Part, rather than reflow.** One cell catching something used to cost the
  // whole branch its shape. Move aside only what is actually in the way.
  if (groupOf) {
    const parted = partedLanding(occupancy, members, anchorId, target, groupOf);
    if (parted) {
      return { kind: "parted", cells: parted.cells, anchor: target, moved: parted.moved };
    }
  }

  // The anchor needs somewhere of its own before anything can be laid out
  // round it. If the hand is over somebody, take the nearest free ground —
  // and show that, rather than refusing and springing a different answer at
  // the moment of release.
  const seat = free(target)
    ? target
    : nearestFreeCell(occupancy, target, { ignore: moving });
  if (!seat) return { kind: "no-room" };

  const laid = reflow(occupancy, members, anchorId, seat, moving, childrenOf);
  if (!laid) return { kind: "no-room" };
  return { kind: wasWhole ? "reshaped" : "gathered", cells: laid, anchor: seat };
}

/**
 * How much a cell on the wrong side of a unit costs, measured in rings.
 *
 * Greg, 2026-10-02: *"the highest-ranking node in the dragged group should
 * position itself closest to its parent… so the connection line flows freely
 * from that node to the parent uninterrupted — like a leaf on a branch."*
 *
 * A leaf gets that for free because nothing of its own grows back down the
 * stem. On the lattice the equivalent is: **a unit's children go on the far
 * side of it from its own way home.** Applied at every rung it trees the whole
 * branch outward, and the way home stays open ground all the way to the top —
 * which is what lets the router draw the straight line Greg is asking for,
 * without changing a single routing rule.
 *
 * Three rings is the price of a face pointing the wrong way. Enough that a
 * child will take a cell two rings out on the right side rather than touch its
 * parent on the wrong one; not enough to send it to the horizon when the right
 * side is genuinely full.
 */
const RADIATE_BIAS = 3;

/**
 * The free cell a child should take next to `parent`, given where `parent`'s
 * own chain comes in from. Without a `back`, this is just the nearest cell.
 */
export function radiatingCell(
  occupancy: Occupancy,
  parent: Cell,
  back: Cell | null,
  options: { ignore?: ReadonlySet<string>; maxRings?: number } = {},
): Cell | null {
  const { ignore, maxRings = 14 } = options;
  if (!back) return nearestFreeCell(occupancy, parent, { ignore, maxRings });
  const free = (cell: Cell) => {
    const who = occupancy.get(cellKey(cell));
    return !who || (ignore?.has(who) ?? false);
  };
  // Away from home is the direction the branch should grow. A cell is scored by
  // how far out it sits plus how far round it leans back toward home, so the
  // search is still a ring walk — just one that reads the compass.
  const ax = back.q - parent.q;
  const az = back.r - parent.r;
  let best: Cell | null = null;
  let bestCost = Infinity;
  for (const cell of spiral(parent, maxRings)) {
    if (cellKey(cell) === cellKey(parent) || !free(cell)) continue;
    const out = hexDistance(cell, parent);
    if (out - RADIATE_BIAS >= bestCost) break; // no further ring can win
    // 0 when the cell is directly away from home, 1 when it is directly toward.
    const leaning = (cosineBetween(cell.q - parent.q, cell.r - parent.r, ax, az) + 1) / 2;
    const cost = out + RADIATE_BIAS * leaning;
    if (cost < bestCost) { bestCost = cost; best = cell; }
  }
  return best;
}

/** Cosine of the angle between two axial vectors, in world space. Flat-top
 *  axial is a sheared basis, so comparing q,r directly would make the three
 *  axes unequal; this converts to world x,y first. */
function cosineBetween(aq: number, ar: number, bq: number, br: number): number {
  const ax = 1.5 * aq;
  const ay = Math.sqrt(3) * (ar + aq / 2);
  const bx = 1.5 * bq;
  const by = Math.sqrt(3) * (br + bq / 2);
  const na = Math.hypot(ax, ay);
  const nb = Math.hypot(bx, by);
  if (na === 0 || nb === 0) return 0;
  return (ax * bx + ay * by) / (na * nb);
}

/**
 * Lay a branch out afresh around a seat, following the tree.
 *
 * The version before this placed each member on the nearest free cell touching
 * *anything already placed*, in order of how far it had been from the anchor.
 * That grows arms — Greg, 2026-10-01: *"it drew crab-like shapes as I moved
 * it"* — because a unit would happily attach to a great-nephew rather than its
 * own parent.
 *
 * This walks the tree instead, breadth-first from the seat, and seats each unit
 * against **its own parent** wherever it can. The result is families in blobs
 * and chains one step long, which is the shortest connection chain across the
 * branch — which is what Greg asked for in rule 7.
 *
 * With `homeward`, it radiates — see `RADIATE_BIAS`.
 */
function reflow(
  occupancy: Occupancy,
  members: ReadonlyMap<string, Cell>,
  anchorId: string,
  seat: Cell,
  moving: ReadonlySet<string>,
  childrenOf?: (unitId: string) => readonly string[],
  /** Where the branch's own parent is, when it is outside the branch. Given it,
   *  the layout grows away from it instead of in all directions. */
  homeward?: Cell | null,
  /** The layout's own spacing. Takes precedence over `spacing`, which is the
   *  archipelago's and is kept only for that shape. */
  clearance?: TidySpacing,
): Map<string, Cell> | null {
  const taken = new Map<string, string>();
  for (const [key, id] of occupancy) if (!moving.has(id)) taken.set(key, id);
  if (taken.has(cellKey(seat))) return null;

  const out = new Map<string, Cell>([[anchorId, seat]]);
  taken.set(cellKey(seat), anchorId);

  // Who is whose. With the tree, a unit seats against its own parent; without
  // it, everything hangs off the anchor, which is a flat but honest fallback.
  const kidsOf = new Map<string, string[]>();
  if (childrenOf) {
    for (const id of members.keys()) {
      const kids = childrenOf(id).filter((k) => members.has(k));
      if (kids.length) kidsOf.set(id, [...kids]);
    }
  } else {
    kidsOf.set(anchorId, [...members.keys()].filter((id) => id !== anchorId));
  }

  // Where each unit's own way home points, so its children can be seated on
  // the other side of it. The anchor's is the branch's parent; everyone else's
  // is the unit they hang from.
  const cameFrom = new Map<string, Cell>();
  if (homeward) cameFrom.set(anchorId, homeward);

  /**
   * **Clear ground somebody else is already owed** — cell key → who owes it.
   *
   * Greg, 2026-10-14: *"the 5s placement feature bunches peer groups together —
   * it does not observe any spacing rules."* It was observing one half of them.
   * The check below asked *"is my own owed gap clear?"* and never *"am I
   * standing in somebody else's?"*, so a person owed nothing walked straight up
   * to a division owed twelve. The gap is one measure between two bodies (Law
   * 4), and a rule applied from one side only is not that measure.
   *
   * The atlas cannot make this mistake, because it reserves the gap as
   * **ground** — `blocked` and `halo` in `territory.ts` — so whoever arrives
   * second is simply kept out. This is the same idea: stamp the owed ground
   * once as each unit is seated, then a candidate cell is a single lookup
   * rather than a fresh search. Measured on the 1,000-person company it is
   * also what pays for the second half of the rule — see `latency` in
   * `docs/HEX-LAYOUT.md`.
   *
   * A cell can be owed to several units at once: sibling halos are all the same
   * width and the siblings sit about that far apart, so they overlap by design.
   * Keeping only one claimant would let a unit through whenever the one we kept
   * happened to be its own kin.
   */
  const owedTo = new Map<string, string[]>();
  const reserve = (cell: Cell, unitId: string) => {
    if (!clearance) return;
    const owed = clearance.clearFor(unitId);
    if (owed <= 0) return;
    for (const near of spiral(cell, owed)) {
      const key = cellKey(near);
      const had = owedTo.get(key);
      if (had) had.push(unitId);
      else owedTo.set(key, [unitId]);
    }
  };
  if (clearance) {
    // Seeded from the **whole map**, for the reason `groupAt` is: a branch that
    // spaces itself perfectly internally still lands in the clear ground of the
    // neighbours it cannot see.
    for (const [key, id] of taken) reserve(cellFromKey(key), id);
  }

  /**
   * The same question the atlas asks: does this unit get the clear ground the
   * **layout** left it, and does it leave everybody else theirs?
   *
   * Greg, 2026-10-14, on the five-second re-pickup: *"that pushes everything
   * together so the gap between anything is zero, which means it's not applying
   * the same rules as the auto-tidy. To me that feels inconsistent."* He was
   * right, and it was a hole rather than a decision: this path took its spacing
   * from `gapBetween`, which the drop path stopped passing on 2026-10-14
   * because it was the old model's second rule. Nothing replaced it here.
   */
  const roomEnough = (cell: Cell, unitId: string): boolean => {
    if (!clearance) return true;
    // Ground already owed to somebody who is not family. One lookup, whatever
    // the gap is — which is what makes asking at all affordable here.
    const theirs = owedTo.get(cellKey(cell));
    if (theirs) {
      for (const who of theirs) {
        if (who === unitId) continue;
        if (!clearance.isKin(unitId, who)) return false;
      }
    }
    const owed = clearance.clearFor(unitId);
    if (owed <= 0) return true;
    for (const near of spiral(cell, owed)) {
      const who = taken.get(cellKey(near));
      if (!who || who === unitId) continue;
      if (clearance.isKin(unitId, who)) continue;
      return false;
    }
    return true;
  };

  const queue: string[] = [anchorId];
  while (queue.length) {
    const parentId = queue.shift()!;
    const parentCell = out.get(parentId);
    if (!parentCell) continue;
    const back = cameFrom.get(parentId);
    for (const childId of [...(kidsOf.get(parentId) ?? [])].sort()) {
      const owed = clearance ? clearance.clearFor(childId) : 0;
      const cell = clearance
        // The atlas: a child takes the nearest cell that still keeps the room
        // the layout left it. `maxRings` has to clear the gap itself, or a unit
        // owed wide ground would never find anywhere that satisfies it and
        // would fall back to the first free cell — which is the bunching.
        ? firstClearCell(
            taken, parentCell, (c) => roomEnough(c, childId),
            back ?? homeward ?? null, Math.max(16, owed + 4),
          )
        : homeward
            ? radiatingCell(taken, parentCell, back ?? null)
            : nearestFreeCell(taken, parentCell, { maxRings: 14 });
      if (!cell) return null;
      out.set(childId, cell);
      taken.set(cellKey(cell), childId);
      // Its own clear ground, so the next unit along has to respect it.
      reserve(cell, childId);
      cameFrom.set(childId, parentCell);
      queue.push(childId);
    }
  }

  // Anyone the walk never reached — a member whose stand-in parent was itself
  // unreachable — still has to go somewhere.
  for (const id of members.keys()) {
    if (out.has(id)) continue;
    const cell = nearestFreeCell(taken, seat, { maxRings: 20 });
    if (!cell) return null;
    out.set(id, cell);
    taken.set(cellKey(cell), id);
  }

  /**
   * **Last: fetch home anybody who ended up touching nobody they belong to.**
   *
   * Greg, 2026-10-14: *"occasionally one node will get flung out, or we'll end
   * up with something that looks like digital spaghetti in the connection
   * lines."* He is describing an **outlier**, and that is the reason this is a
   * repair rather than a change to the search above.
   *
   * Tuning the search was tried first, about a dozen ways across four
   * mechanisms — clamping how far a unit may travel, grading how badly a cell
   * breaches the gap rather than merely whether, pricing the two laws against
   * each other, and gating on family outright. Every one of them slid along the
   * same line: cohesion bought bunching and spacing bought flinging, with
   * nothing in between. The reason is structural and is written up in
   * `docs/HEX-LAYOUT.md` — `reflow` has to fit a branch into the hole that is
   * already there, while the atlas grows the ground to make room, so for
   * `reflow` the two laws genuinely compete for the same cells.
   *
   * What does not compete is the tail. A unit touching **no** relative at all
   * has already lost Law 2 outright, so moving it beside its family cannot cost
   * anything that law ranks higher — and it is the one the eye finds, because a
   * node adrift drags a long chain behind it. So the policy is left exactly as
   * it was and only the casualties are collected: measured on the 1,000-person
   * company this is about one unit in fifty, and it touches nothing else.
   */
  {
    // Who each unit hangs from, inverted from the tree the walk already built.
    const upOf = new Map<string, string>();
    for (const [parent, kids] of kidsOf) for (const kid of kids) upOf.set(kid, parent);

    for (const [id, at] of [...out]) {
      // Not the anchor: that is where the hand let go, and Law 0 outranks all
      // of this.
      if (id === anchorId) continue;
      const up = upOf.get(id);
      if (!up) continue;
      const kin = new Set<string>();
      const parentCell = out.get(up);
      if (parentCell) kin.add(cellKey(parentCell));
      for (const sib of kidsOf.get(up) ?? []) {
        if (sib === id) continue;
        const c = out.get(sib);
        if (c) kin.add(cellKey(c));
      }
      if (!kin.size) continue;

      /**
       * **Lost is not the same as not touching, and the difference is the whole
       * of this.**
       *
       * A unit owed four tiles of clear ground is *meant* to sit four tiles
       * from its family: touching and well-spaced are opposites, so a repair
       * that fetches home everybody not touching their family fetches home
       * everybody who is correctly spaced. Measured, that is 196 units where 52
       * are actually lost, and parking all of them against their relatives
       * flattened every gap on the branch — which is the bunching Greg reported
       * the same morning.
       *
       * So: lost means further out than this unit's **own** clear ground
       * explains, and the cell it is fetched back to is one at about that
       * distance — where the layout wanted it — rather than against the family.
       */
      const owedHere = clearance?.clearFor(id) ?? 0;
      const want = owedHere + 1;
      const nearestKin = (c: Cell): number => {
        let d = Infinity;
        for (const key of kin) d = Math.min(d, hexDistance(c, cellFromKey(key)));
        return d;
      };
      if (nearestKin(at) <= want + LOST) continue;

      // Back to where its own spacing says it belongs, as near as it can be
      // got to where the layout put it.
      let home: Cell | null = null;
      let best = Infinity;
      let bestClear = false;
      for (const key of kin) {
        for (const c of spiral(cellFromKey(key), want)) {
          const k = cellKey(c);
          if (taken.has(k)) continue;
          if (nearestKin(c) > want) continue;
          // **Fetching somebody home is no reason to drop them on a stranger.**
          // Law 4 still applies to the cell this lands on, so a clear one wins
          // over a tighter one however much nearer the tighter one is.
          // Distance first: it is arithmetic, and `roomEnough` is a search.
          // A cell that cannot win on distance is never worth measuring.
          const d = hexDistance(c, at);
          if (bestClear && d >= best) continue;
          const clear = roomEnough(c, id);
          if ((clear && !bestClear) || (clear === bestClear && d < best)) {
            best = d; home = c; bestClear = clear;
          }
        }
      }
      if (!home) continue;
      taken.delete(cellKey(at));
      out.set(id, home);
      taken.set(cellKey(home), id);
    }
  }
  return out;
}

export { cellFromKey, cellKey };
