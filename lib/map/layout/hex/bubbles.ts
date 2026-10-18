/**
 * **Bubbles — the shaded regions a group of teams sits inside.**
 *
 * Greg, 2026-10-16, requirements 4 and 6:
 *
 * > *"We need to have concentric toruses comprised of shaded hexagon zones
 * > offset from master-center. The contents of these zones are the nodes and
 * > teams."*
 * >
 * > *"These regions move with the nodes they pertain to — they form a 'bubble'
 * > around a group of teams that presents as concentric rings (or as near as
 * > dammit) on load, and if/when the user pushes the tidy-up button. So a user
 * > can break away from the radial model and rearrange the map to their liking.
 * > A bubble is taken as the shape of the contained node then offset wider by
 * > one hexagon spacing."*
 *
 * ## The two requirements are one object
 *
 * They read as two features and they are not. A zone is *"the ground one branch
 * holds"*; a bubble is *"the shape of the contained node offset wider by one"*.
 * Those are the same set of cells, and the difference between them is only where
 * the cells happen to be:
 *
 *  - **On a radial load** a branch's cells lie inside a band crossed with an
 *    arc, so its bubble is an annular sector — and the bubbles of one rung,
 *    side by side, are the torus. The concentric reading is not drawn, it
 *    *emerges*, which is why requirement 5's *"shouldn't force the thing"* costs
 *    nothing: where a branch has too few units to reach round, its bubble simply
 *    stops, and the torus has a gap in it.
 *  - **After somebody rearranges the map** the same rule gives the same answer
 *    about wherever the cells now are. Requirement 6's *"these regions move with
 *    the nodes they pertain to"* needs no code at all: a bubble is derived from
 *    live cells every time, so it cannot be stale and cannot be dragged out of
 *    step with what it contains.
 *
 * So there is one mechanism here, not two, and it is deliberately the dumbest
 * one that satisfies both: **take the cells, grow them by a ring, draw the
 * edge.** Nothing is remembered between loads and nothing has to be kept in sync.
 *
 * ## Above team level only, for now
 *
 * Greg, 2026-10-16: *"assume bubbles only above team level for now so the
 * spacing rule doesn't move."*
 *
 * A bubble drawn one cell out needs **two** clear cells between neighbouring
 * groups, or the two bubbles land on the same cell; three if there is to be
 * visible air between them. Two sibling teams get exactly one. Moving that is a
 * change to Law 4's one dial on one rule, which moves every boundary on the map,
 * so it waits for a decision — see [TASKS.md](../../../../docs/TASKS.md).
 *
 * `tier` is what "above team level" means in code: nought for a team, whose
 * children are people rather than regions, one for whatever holds teams. Both
 * drivers compute it, and both publish it since 2026-10-16.
 *
 * ## What this file does not do
 *
 * It does not draw. It returns cells and edges; the renderer decides colour,
 * weight and what to show at which zoom. And it holds no spacing rule — Law 4 —
 * because the one tile it grows by is the *drawn* offset Greg specified, not a
 * gap between anything.
 */
import type { OrbitalTree } from "@/lib/map/layout/model";
import { type Cell, cellKey, neighbours } from "@/lib/map/layout/hex/coords";
import { outline, type Segment } from "@/lib/map/layout/hex/arrange";
import { spacerRule } from "@/lib/map/layout/hex/spacing";

/** Tier at or above which a unit is drawn a bubble. Nought is a team. */
export const BUBBLE_TIER = 1;

export type Bubble = {
  unitId: string;
  /** How deep the unit sits, for colour and for drawing order. */
  depth: number;
  /** Rungs of places beneath it. Outer bubbles have the larger number. */
  tier: number;
  /** The unit's own cells plus its descendants', grown by one ring. */
  cells: Cell[];
  /** The boundary of those cells, as edges to stroke. */
  edge: Segment[];
};

/**
 * **Grow a set of cells by one ring.**
 *
 * *"Offset wider by one hexagon spacing."* On a lattice that is a dilation: the
 * cells themselves, plus every cell touching one of them. It is exact — there is
 * no curve to approximate and no smoothing to tune, which is the third thing the
 * lattice has given this study for free after territory and hit testing.
 *
 * Every cell is grown rather than only the boundary ones. The atlas grows only
 * its boundary, because its halo can be dozens of rings deep and the interior
 * work is thrown away; one ring is cheap enough that finding the boundary first
 * would cost more than it saves.
 */
export function grow(cells: Iterable<Cell>, keep?: (cell: Cell) => boolean): Cell[] {
  const out = new Map<string, Cell>();
  for (const cell of cells) out.set(cellKey(cell), cell);
  for (const cell of cells) {
    for (const near of neighbours(cell)) {
      const key = cellKey(near);
      if (out.has(key)) continue;
      if (keep && !keep(near)) continue;
      out.set(key, near);
    }
  }
  return [...out.values()];
}

/**
 * Every cell a unit's subtree stands on, including its own.
 *
 * Walked rather than cached. A bubble has to follow a hand that moved half a
 * division across the map, and the only reliable way to be in step with that is
 * to read where things actually are.
 */
export function subtreeCells(
  tree: OrbitalTree,
  cells: ReadonlyMap<string, Cell>,
  unitId: string,
): Cell[] {
  const out: Cell[] = [];
  const stack = [unitId];
  while (stack.length) {
    const at = stack.pop()!;
    const cell = cells.get(at);
    if (cell) out.push(cell);
    const kids = tree.units.get(at)?.childIds;
    if (kids) stack.push(...kids);
  }
  return out;
}

/** Every unit id at or below this one. */
function subtreeIds(tree: OrbitalTree, unitId: string): string[] {
  const out: string[] = [];
  const stack = [unitId];
  while (stack.length) {
    const at = stack.pop()!;
    out.push(at);
    const kids = tree.units.get(at)?.childIds;
    if (kids) stack.push(...kids);
  }
  return out;
}

/**
 * **Every bubble on the map, outermost first.**
 *
 * Ordered by tier descending so a renderer painting in sequence lays the big
 * regions down before the small ones nested inside them, and the small ones
 * stay legible. That ordering is the only opinion this function holds about
 * drawing.
 */
export function bubblesFor(options: {
  tree: OrbitalTree;
  /** Where every unit *actually* is, hand placements included. */
  cells: ReadonlyMap<string, Cell>;
  /** unit id → rungs of places beneath it, from the layout. */
  tier: ReadonlyMap<string, number>;
  size: number;
  /**
   * cell key → the unit standing there. When given, a bubble's skirt is trimmed
   * where it would otherwise swallow somebody else's node.
   *
   * **Why a bubble is clipped rather than the map being spaced.** Measured
   * 2026-10-16 on the 1,000-person company, 14 of 15 sibling bubble pairs
   * overlapped under the radial driver against 2 under the atlas: radial
   * reserves air between a parent and its children and none between siblings,
   * because the arcs that keep siblings apart are a *direction* and not a
   * distance. Applying the shared spacing rule node-to-node was tried and
   * reverted — it halved the sibling nodes sitting within two cells and barely
   * touched the overlap, because a bubble covers a whole subtree rather than a
   * node, and it cost twenty whole families, which Law 2 does not allow a Law 4
   * preference to do.
   *
   * Clipping is the honest half-measure until that is fixed properly: the skirt
   * hugs tight where there is no room and bulges where there is, which is
   * requirement 5 — *"they shouldn't force the thing"* — applied to the offset
   * rather than to the ring. It does not make two regions separate; it stops a
   * region claiming a cell that visibly belongs to another.
   */
  occupants?: ReadonlyMap<string, string>;
  /** Tier at or above which a unit gets one. Defaults to above team level. */
  minTier?: number;
}): Bubble[] {
  const { tree, cells, tier, size, occupants } = options;
  const minTier = options.minTier ?? BUBBLE_TIER;

  /**
   * **Where two regions meet they share one frontier, not two skirts.**
   *
   * Greg, 2026-10-16, after three attempts to space siblings apart failed:
   * *"two regions sharing a border may be what an atlas should look like. Try it
   * in how the boundary is drawn."*
   *
   * That is the right reading, and it makes the whole problem go away rather
   * than shrinking it. Grown independently, two neighbouring regions both claim
   * the cells between them: their washes double into a dark seam and each draws
   * a boundary *through* the other's ground, which is the smudge. Countries do
   * not do this. They meet at a line that belongs to both and is drawn once.
   *
   * So the one-ring skirt is **partitioned** rather than duplicated: a contested
   * cell goes to whichever region already surrounds it more, ties broken by name
   * so the picture is still a pure function of the company. The regions then
   * tile, their fills never stack, and the two outlines that meet along a shared
   * frontier lie exactly on top of each other — which is one line, drawn twice,
   * in the right place.
   *
   * **Nesting is not a contest.** A child's ground is inside its parent's by
   * construction and must stay there, so an ancestor of the winner keeps the
   * cell too. Only unrelated regions — siblings, cousins — actually compete.
   */
  type Draft = { unitId: string; depth: number; tier: number; own: Set<string>; skirt: Set<string> };
  const drafts: Draft[] = [];
  const cellOf = new Map<string, Cell>();

  for (const unit of tree.units.values()) {
    const own = tier.get(unit.id);
    if (own === undefined || own < minTier) continue;
    const mine = subtreeCells(tree, cells, unit.id);
    if (!mine.length) continue;

    const family = occupants ? new Set(subtreeIds(tree, unit.id)) : null;
    const ownKeys = new Set<string>();
    for (const cell of mine) {
      const key = cellKey(cell);
      ownKeys.add(key);
      cellOf.set(key, cell);
    }

    const skirt = new Set<string>();
    for (const cell of mine) {
      for (const near of neighbours(cell)) {
        const key = cellKey(near);
        if (ownKeys.has(key)) continue;
        // A region never swallows a node from outside its own branch.
        if (family && occupants) {
          const sitting = occupants.get(key);
          if (sitting !== undefined && !family.has(sitting)) continue;
        }
        skirt.add(key);
        cellOf.set(key, near);
      }
    }
    drafts.push({ unitId: unit.id, depth: unit.depth, tier: own, own: ownKeys, skirt });
  }

  /** Is `a` an ancestor of `b`? Nesting, which never competes. */
  const ancestorOf = (a: string, b: string): boolean => {
    let at = tree.units.get(b)?.parentId ?? null;
    while (at) {
      if (at === a) return true;
      at = tree.units.get(at)?.parentId ?? null;
    }
    return false;
  };

  /** Who wants each contested cell. */
  const wanted = new Map<string, number[]>();
  drafts.forEach((draft, i) => {
    for (const key of draft.skirt) {
      const list = wanted.get(key);
      if (list) list.push(i);
      else wanted.set(key, [i]);
    }
  });

  for (const [key, claimants] of wanted) {
    if (claimants.length < 2) continue;
    const cell = cellOf.get(key)!;
    /** How much of this cell's ring a region already holds — how far *inside*
     *  that region the contested cell sits. The eye reads a frontier as being
     *  where one region stops surrounding you, so that is what decides it. */
    const surround = (i: number) =>
      neighbours(cell).filter((near) => drafts[i].own.has(cellKey(near))).length;

    let winner = claimants[0];
    for (const i of claimants.slice(1)) {
      const better = surround(i) - surround(winner)
        // A smaller region loses its frontier to a bigger one only on a tie of
        // surround; otherwise the near thing wins, which is what keeps a team's
        // own boundary visible inside its division.
        || drafts[winner].tier - drafts[i].tier
        || drafts[i].unitId.localeCompare(drafts[winner].unitId) * -1;
      if (better > 0) winner = i;
    }

    for (const i of claimants) {
      if (i === winner) continue;
      if (ancestorOf(drafts[i].unitId, drafts[winner].unitId)) continue;
      drafts[i].skirt.delete(key);
    }
  }

  /**
   * **The borders were drawn and then taken away** (Greg, 2026-10-16: *"there
   * are borders around the bubbles — they don't need to be there"*), so the
   * frontier-versus-coastline split that lived here is gone with them. The
   * finding it produced is in HEX-LAYOUT.md and is worth more than the code was:
   * the atlas driver's regions are 0.3% frontier and radial's are 22%, which is
   * the difference between islands with sea between them and a continent of
   * countries that meet.
   *
   * **The partition itself stays**, because it is what stops two regions washing
   * the same cells twice and is nothing to do with drawing a line.
   */
  const out: Bubble[] = drafts.map((draft) => {
    const mine = new Set([...draft.own, ...draft.skirt]);
    const all: Cell[] = [];
    for (const key of mine) all.push(cellOf.get(key)!);

    const edge = outline(all, size);

    return {
      unitId: draft.unitId,
      depth: draft.depth,
      tier: draft.tier,
      cells: all,
      edge,
    };
  });

  out.sort((a, b) => b.tier - a.tier || a.depth - b.depth || a.unitId.localeCompare(b.unitId));
  return out;
}

/**
 * **How many pairs of sibling bubbles touch or overlap.**
 *
 * Not a guard — a number for the panel, because whether *"only above team
 * level"* is enough clearance is a question about the spacing rule that nobody
 * has answered yet, and the honest way to answer it is to count rather than to
 * reason about tiers. Law 4's own table asks every law for a number counted from
 * what is drawn; this is the equivalent for a rule still being decided.
 *
 * Only siblings are counted. A child's bubble sits *inside* its parent's by
 * construction, and that overlap is the nesting rather than a collision.
 */
export function bubbleClashes(tree: OrbitalTree, bubbles: readonly Bubble[]): number {
  const at = new Map<string, Bubble[]>();
  for (const bubble of bubbles) {
    const parent = tree.units.get(bubble.unitId)?.parentId ?? "";
    const list = at.get(parent) ?? [];
    list.push(bubble);
    at.set(parent, list);
  }

  let clashes = 0;
  for (const siblings of at.values()) {
    for (let i = 0; i < siblings.length; i++) {
      const mine = new Set(siblings[i].cells.map(cellKey));
      for (let j = i + 1; j < siblings.length; j++) {
        if (siblings[j].cells.some((cell) => mine.has(cellKey(cell)))) clashes++;
      }
    }
  }
  return clashes;
}

/**
 * **The ground a group of teams keeps — one zone, with no seams inside it.**
 *
 * Greg, 2026-10-18: *"where two large zones touch, there should not be an
 * outline"*, and the zone itself *"shaded slightly greyer, to be a grey between
 * the team-zone and the background."*
 *
 * A group's zone is its own ground grown by **two** hexagons — its teams' own
 * spacers, then the group's. Two groups sit three cells apart, so each one's
 * second ring reaches across the gap to the other's doorstep, and drawn
 * separately each would put a boundary through the other's ground.
 *
 * The first attempt at this shared the contested ground out and drew the
 * boundary between the two **once** instead of twice, on the reasoning that two
 * countries meet at one frontier. That is not what Greg asked for: where two
 * zones touch there should be *no* line at all, and they should read as one
 * body. So the zones are **unioned** rather than partitioned, and the only
 * thing drawn is the silhouette of the whole — a seam between two touching
 * groups is not a quieter line, it is no line.
 *
 * Which also makes the partition unnecessary: nothing is drawn twice because
 * nothing is drawn per group. What a group still gets to itself is its
 * *distance* — two hexagons of clear ground, which `spacerRule`'s `apart`
 * enforces whatever the drawing does.
 */
export function groupZones(options: {
  tree: OrbitalTree;
  /** Live cells, so the zone follows a hand that moved something. */
  cells: ReadonlyMap<string, Cell>;
  /** Who is a person. The leaves stand in for teams when there are none, which
   *  is the teams view, and the grouping reads the same there. */
  people: ReadonlySet<string>;
  size: number;
  /** How many hexagons of room a group keeps: the teams' spacer, then its own. */
  rings?: number;
}): { cells: Cell[]; walls: Segment[] } {
  const { tree, cells, people, size } = options;
  const rings = options.rings ?? 2;
  const { groupFor } = spacerRule(tree, people);

  /** Who is standing where, so a zone never swallows somebody else's node. */
  const standing = new Map<string, string>();
  for (const [id, cell] of cells) standing.set(cellKey(cell), id);

  const zone = new Map<string, Cell>();
  let frontier: Cell[] = [];
  for (const [id, cell] of cells) {
    if (!groupFor(id)) continue;
    zone.set(cellKey(cell), cell);
    frontier.push(cell);
  }
  if (zone.size === 0) return { cells: [], walls: [] };

  for (let ring = 1; ring <= rings; ring++) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const near of neighbours(cell)) {
        const key = cellKey(near);
        if (zone.has(key)) continue;
        // A node that belongs to nobody's group — a division, a portfolio —
        // keeps its own cell. A zone is room, not ground to annex.
        const sitting = standing.get(key);
        if (sitting !== undefined && !groupFor(sitting)) continue;
        zone.set(key, near);
        next.push(near);
      }
    }
    frontier = next;
  }

  const all = [...zone.values()];
  return { cells: all, walls: outline(all, size) };
}
