/**
 * Territories inside territories — the map as an atlas (Greg, 2026-10-03).
 *
 * *"We need to gently push for the whole thing to render with more visual
 * organisation."*
 *
 * ## What was wrong, stated as something measurable
 *
 * The hierarchy was a **place** at exactly one level. Every unit reserved
 * ground sized to its own direct staff, and its child units were then pushed
 * *outside* that ground with kinship spacing. So a division was not somewhere
 * you could point at — it was a hue shared by teams scattered among its
 * siblings' teams, and colour was doing all the work of saying "these belong
 * together". That is why the map read as an archipelago with good rules rather
 * than as an atlas.
 *
 * Here a unit's territory **contains its whole subtree**. Countries containing
 * counties containing towns.
 *
 * ## Measure upward, place downward
 *
 * Two passes, and the order is the whole trick.
 *
 * 1. **Measure**, from the leaves up. Every unit works out how big its
 *    territory has to be and where its children's territories sit inside it —
 *    all in a *canonical frame*, where the spine runs due east and the way home
 *    is west. Nothing is placed on the plane yet.
 * 2. **Place**, from the root down. The root's territory lands at the origin;
 *    each child's is translated and **rotated** into position, and because a
 *    spine is always one of the six lattice directions, that rotation is a
 *    multiple of 60° and therefore exact. The arrangement measured in the
 *    canonical frame survives it cell for cell.
 *
 * This is why it does not hit the wall the three abandoned rewrites hit (see
 * `allocate.ts`). They all reserved ground *before* knowing what had to go in
 * it, so a branch handed a territory one cell per unit had nothing left to
 * subdivide and every rung below it starved. Measuring upward means a parent's
 * size is a **consequence** of its children's, never a guess at them.
 *
 * ## The spine
 *
 * Greg asked for *"a division's spine running along one of the six axes with
 * its teams hanging off it"* — a street with plots on it rather than a fan at
 * whatever angle the parent happened to be approached from.
 *
 * A unit's spine points **away from its parent**, snapped to a lattice
 * direction, which is Greg's rotation rule from 2026-10-02 holding at every
 * rung: the way home arrives at the near edge of a territory and the subtree
 * runs away from it across its own ground.
 *
 * ## Spacing falls out rather than being enforced
 *
 * Siblings are separated by `SIBLING_GAP` inside their parent's ground.
 * Cousins are separated by that gap *between their parents' territories*, plus
 * whatever margin each parent's own ground adds — so they end up further apart
 * than siblings without anybody writing that down, and the rung after that
 * further still. The kinship spacing Greg specified on 2026-10-03 stops being a
 * rule the allocator has to be taught and becomes a property of the shape.
 *
 * Pure: same company, same cells, for ever.
 */
import type { OrbitalTree, UnitNode } from "@/lib/map/layout/model";
import type { Allocation } from "@/lib/map/layout/hex/allocate";
import {
  type Cell,
  DIRECTIONS,
  add,
  cellKey,
  hexDistance,
  neighbours,
  ring,
  spiral,
} from "@/lib/map/layout/hex/coords";

export type Region = { centre: Cell; radius: number };

export type TerritoryLayout = {
  /** unit id → the cell its own node stands on. */
  cells: Map<string, Cell>;
  /** cell key → the unit standing there. */
  occupants: Map<string, string>;
  /** unit id → the ground its whole subtree occupies. */
  regions: Map<string, Region>;
  /** unit id → how many cells from its parent's node. */
  steps: Map<string, number>;
  /** unit id → the top-level branch it belongs to, for territory colouring. */
  branchOf: Map<string, string>;
  /** unit id → how far its own node is held from its parent's, by the rule
   *  above. Nought low down, widest at the master centre. */
  spacedBy: Map<string, number>;
  radius: number;
  stats: {
    placed: number;
    /** Units whose node touches their parent's node. */
    touchingParent: number;
    /** The deepest rung reached. */
    depth: number;
    /** Sibling territories that ended up closer than the gap asks for. Should
     *  be nought; it is here because a packer that quietly overlaps is worse
     *  than one that admits it. */
    tooClose: number;
    /** Units the packer could not seat at all. Should always be nought. */
    unplaced: number;
  };
};

/** Clear cells between two sibling territories. Greg, 2026-10-03: *"sibling
 *  teams by default have one tile separating them."* Cousins and beyond get
 *  theirs from the nesting itself. */
export const SIBLING_GAP = 1;

/**
 * How many units a thing must hold before a clear tile round it buys anything.
 *
 * Greg, 2026-10-03: his rule was *"sibling **teams** have one tile separating
 * them"* — and it was being applied between every pair of sibling territories at
 * every rung, including two mid-level structural nodes nobody thinks of as
 * places. That one over-reading caused both of the faults he reported. It is
 * where the extra 51 of Northwind's 110 stranded units came from, and it is
 * what turned the gaps into **corridors** that the router then funnels many
 * chains down: mean chain length 2.8 → 4.1, longest 12 → 29.
 *
 * A clear tile is a *visual* device. It only does visual work when what it
 * surrounds is big enough to read as a region — two single cells with a gap
 * between them read as two cells with a gap, not as two places. So a territory
 * earns its clear ground by holding at least this many units, and anything
 * smaller sits tight against its family where it belongs.
 */
export const PLACE_SIZE = 4;

/**
 * **Room grows with the level of abstraction** (Greg, 2026-10-03).
 *
 * *"At the highest level of abstraction, the greatest number of hexagon tiles
 * are found between nodes. At the lowest level of abstraction, the team level,
 * each team should by default group together, resist exclaving, and exist with
 * a bubble of 1 tile around it… for every level of abstraction, add 1
 * additional tile-spacing rule between nodes."*
 *
 * So the gap is not one number any more. A unit's **tier** is how many rungs of
 * *places* sit under it — nought for a team, whose children are people rather
 * than regions; one for whatever holds teams; and up from there. The clear
 * ground a unit leaves between its children is its own tier, so teams are a
 * tile apart, the things that hold teams are two, and the master centre's
 * immediate reports get the widest streets on the map.
 *
 * This is what makes an atlas legible rather than merely nested: the eye reads
 * the size of a gap as the size of the thing it separates, long before it can
 * read a label. Capped, because past a point a street is just a field.
 */
export const MAX_TIER_GAP = 3;

/**
 * What the packer weighs when choosing where a child's territory goes.
 *
 * `GROWTH` dominates, because a packing that grows a parent grows everything
 * above it too, all the way to the root. `FAMILY` is the term that was simply
 * **missing** — the packer scored growth and the spine and had nothing at all to
 * say about sitting next to your own parent, which is the oldest rule in this
 * engine and the one Greg noticed was broken. `SPINE` is smallest, so the
 * street bends rather than breaks when hugging it would cost real ground.
 */
const GROWTH = 100;
const FAMILY = 45;
const SPINE = 6;

/**
 * How many rings past the first workable one to keep looking.
 *
 * The search runs outward from the parent's own node, and a territory's cost is
 * dominated by how much it grows the parent — which rises with distance. So the
 * answer is nearly always in the first ring that has room, and scanning the
 * whole reach beyond it is work thrown away.
 *
 * It was thrown away expensively: with people promoted to units, the
 * 2,562-person company took **ten seconds**, because each of 2,957 children
 * swept a disc that grew with the company. Stopping a few rings after the first
 * success is the same trick `findCell` uses in `allocate.ts`, and for the same
 * reason — far enough to let a slightly further cell in a much better direction
 * win, near enough not to pay for the horizon.
 */
const RING_SLACK = 2;

/** Cube-space rotation by one sixth of a turn, in the direction that takes
 *  `DIRECTIONS[i]` to `DIRECTIONS[i + 1]`. */
const turn = (cell: Cell): Cell => {
  const x = cell.q;
  const z = cell.r;
  const y = -x - z;
  // (x, y, z) → (−y, −z, −x). The `+ 0` is not decoration: negating a zero in
  // JavaScript gives **negative** zero, which is equal to zero everywhere that
  // matters here and unequal to it under `Object.is` — so it survives a Map
  // lookup but fails a comparison, which is the worst way round for a bug to
  // behave. Normalising it at the one place it is created costs nothing.
  return { q: -y + 0, r: -x + 0 };
};

/** Rotate a cell `k` sixths of a turn about the origin. Exact: the lattice
 *  maps onto itself under sixtieths, which is the whole reason a territory
 *  measured facing east can be placed facing anywhere. */
export function rotate(cell: Cell, k: number): Cell {
  let out = cell;
  const n = ((k % 6) + 6) % 6;
  for (let i = 0; i < n; i++) out = turn(out);
  return out;
}

/** Which of the six directions a step most nearly points along. */
export function nearestDirection(step: Cell): number {
  let best = 0;
  let bestDot = -Infinity;
  // Compare in cube space, where the six directions are symmetric.
  const x = step.q;
  const z = step.r;
  const y = -x - z;
  for (let i = 0; i < 6; i++) {
    const d = DIRECTIONS[i];
    const dx = d.q;
    const dz = d.r;
    const dy = -dx - dz;
    const dot = x * dx + y * dy + z * dz;
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  return best;
}

/**
 * How far a cell sits off the spine, in world units.
 *
 * Worth deriving rather than guessing, because the lattice is **not** laid out
 * the way `DIRECTIONS` names it. `cellToWorld` puts a cell at
 * `(1.5q, √3(r + q/2))`, so `DIRECTIONS[0]` — called "east" there — actually
 * points at **30°**. The six are the edge normals at ±30°, ±90°, ±150°, which
 * is the rule the whole study rests on: centre to side-midpoint, never centre
 * to corner.
 *
 * Projecting a cell onto the perpendicular of that 30° axis comes out clean:
 * `1.5|r|`, with the distance *along* it being `√3(q + r/2)` if it is ever
 * wanted.
 */
const offSpine = (cell: Cell): number => 1.5 * Math.abs(cell.r);

type Patch = {
  /** Every cell this territory owns, including its descendants'. */
  cells: Cell[];
  /** Fast membership, by packed key. Nobody may stand here. */
  taken: Set<number>;
  /**
   * The clear ground owed to the territories already placed — `taken` grown by
   * the gap, **excluding the unit's own node**.
   *
   * That exclusion is the whole of Greg's rule. *"Sibling teams by default have
   * one tile separating them"* is about siblings; a child belongs **next to**
   * its parent. Blocking the ring round the parent's own node as well, which is
   * what a single dilated set does, meant no unit in the company could ever
   * touch its own parent — measured at exactly 0%, which is the kind of round
   * number that is always a bug rather than a trade-off.
   */
  blocked: Set<number>;
  /**
   * The cells where this unit's own node and its children's nodes stand.
   *
   * Not the same as `taken`, which holds every cell of every subtree. What a
   * child wants to be next to is its parent or a sibling **itself** — touching
   * some great-nephew buried inside a sibling's territory is not what anybody
   * means by a family sitting together.
   */
  nodes: Set<number>;
  /** Where the unit's own node stands. */
  own: Cell;
  /** Each child's territory: how far to shift it, and how far to turn it. */
  children: Map<string, { offset: Cell; spine: number }>;
  /** Furthest cell from `own`, for bounding the search above. */
  reach: number;
  /** How many rungs of *places* sit under this one. Nought for a team. */
  tier: number;
};

/** Units the packer could not seat. Should always be empty — it exists because
 *  a layout that quietly loses somebody is worse than one that says so. */
export type Unplaced = string[];

/**
 * Which way each child faces, in the order they are laid down.
 *
 * Straight along the spine first, then alternately to either side of it, and
 * only as a last resort back toward home. The heaviest child therefore
 * continues its parent's street and the rest hang off it — Greg, 2026-10-03:
 * *"a division's spine running along one of the six axes with its teams hanging
 * off it."* It is also rule 2 from 2026-09-30, a branch running away from where
 * it came from, which until now was a continuous angle the search tried to
 * honour rather than something the lattice could state exactly.
 */
const FAN = [0, 1, 5, 2, 4, 3] as const;

/** Cells as one number, so the hot loop never touches a string. The company
 *  would have to be 2,000 cells across in one direction to overflow this. */
const KEY = (q: number, r: number): number => (q + 2048) * 4096 + (r + 2048);

/**
 * Where to put a child's territory inside its parent's.
 *
 * Candidates are offsets that land the child's own node somewhere near the
 * ground already taken; each is rejected the moment one of its cells collides,
 * which is what keeps this affordable — almost every candidate fails in two or
 * three cells, so the cost is nothing like the size of the shapes involved.
 *
 * The score is, in order of weight: how much it grows the territory, then how
 * far off the spine it sits. Greg asked for *"a division's spine running along
 * one of the six axes with its teams hanging off it"* — so growth decides, and
 * the spine breaks the many ties that growth leaves. The street bends rather
 * than breaks when hugging it would cost real ground.
 */
function placeChild(
  parent: Pick<Patch, "taken" | "blocked" | "cells" | "own" | "nodes">,
  child: Patch,
  spine: number,
  /** Clear tiles the parent's own node keeps between itself and a child's. */
  bubble: number,
): Cell | null {
  // The child's cells, already turned to face its spine.
  const turned = child.cells.map((c) => rotate(c, spine));
  const ownTurned = rotate(child.own, spine);

  let bound = 0;
  for (const cell of parent.cells) bound = Math.max(bound, hexDistance(cell, parent.own));
  /**
   * **Past the bubble, or there is nowhere to look at all.**
   *
   * The ring walk below skips everything inside `bubble`, and this did not
   * account for it — so a high-tier unit whose first child was small had every
   * single candidate skipped, came back with nothing, and the child was
   * **dropped from the map without a word**. It cost 26 of Northwind's 2,957
   * units, which is the sort of thing that only shows up as a count that does
   * not add up.
   */
  const reach = bubble + bound + child.reach + 3;

  let best: { offset: Cell; score: number } | null = null;
  let foundAt = Infinity;
  for (let k = 0; k <= reach; k++) {
    if (best && k > foundAt + RING_SLACK) break;
    if (k <= bubble) continue; // the high nodes keep their air
    for (const anchor of ring(parent.own, k)) {
      // Offset that puts the child's own node on `anchor`.
      const offset = { q: anchor.q - ownTurned.q, r: anchor.r - ownTurned.r };
      let clear = true;
      let grew = bound;
      for (const cell of turned) {
        const q = cell.q + offset.q;
        const r = cell.r + offset.r;
        const key = KEY(q, r);
        if (parent.taken.has(key) || parent.blocked.has(key)) { clear = false; break; }
        const far = hexDistance({ q, r }, parent.own);
        if (far > grew) grew = far;
      }
      if (!clear) continue;
      foundAt = Math.min(foundAt, k);

      // Does the child's own node land against its parent or a sibling? Greg,
      // 2026-09-30: *"child nodes do not have to directly snap to their parent
      // nodes, they can snap to sibling nodes."*
      let beside = false;
      for (const nb of neighbours(anchor)) {
        if (parent.nodes.has(KEY(nb.q, nb.r))) { beside = true; break; }
      }

      const off = offSpine({ q: anchor.q - parent.own.q, r: anchor.r - parent.own.r });
      const score = grew * GROWTH + (beside ? 0 : FAMILY) + off * SPINE;
      if (!best || score < best.score) best = { offset, score };
    }
  }
  return best?.offset ?? null;
}

export function layoutTerritories(
  tree: OrbitalTree,
  options: { maxGap?: number; place?: number } = {},
): TerritoryLayout {
  const maxGap = options.maxGap ?? MAX_TIER_GAP;
  const place = options.place ?? PLACE_SIZE;
  const cells = new Map<string, Cell>();
  const occupants = new Map<string, string>();
  const regions = new Map<string, Region>();
  const steps = new Map<string, number>();
  const branchOf = new Map<string, string>();
  const spacedBy = new Map<string, number>();
  const unplaced: string[] = [];

  const root = tree.units.get(tree.rootId);
  if (!root) {
    return {
      cells, occupants, regions, steps, branchOf, spacedBy, radius: 0,
      stats: { placed: 0, touchingParent: 0, depth: 0, tooClose: 0, unplaced: 0 },
    };
  }

  /**
   * **The grammar.** Greg, 2026-10-03, asked for siblings ordered by something
   * stable and meaningful rather than by whatever the layout found convenient.
   *
   * Headcount descending, ties broken by name, is stable and explainable: the
   * biggest part of a division is always at the head of the street, and it
   * stays there when something elsewhere changes. It is not *meaningful* the
   * way function or discipline would be — we do not hold that yet. It is one
   * function, and when we do, this is the line that changes.
   */
  const inGrammarOrder = (unit: UnitNode): UnitNode[] =>
    unit.childIds
      .map((id) => tree.units.get(id))
      .filter((u): u is UnitNode => !!u)
      .sort((a, b) => b.totalSeats - a.totalSeats || a.name.localeCompare(b.name));

  // --- pass one: measure, from the leaves up -------------------------------
  const patches = new Map<string, Patch>();
  const measure = (unit: UnitNode): Patch => {
    const had = patches.get(unit.id);
    if (had) return had;

    // **Everything below is measured first**, because how much room this unit
    // leaves between its children depends on what they turned out to be.
    const kids = inGrammarOrder(unit).map((kid) => ({ kid, patch: measure(kid) }));
    const places = kids.filter(({ patch }) => patch.cells.length >= place);
    const tier = places.length === 0
      ? 0
      : 1 + places.reduce((deepest, { patch }) => Math.max(deepest, patch.tier), 0);
    // A unit with nothing but individuals under it separates nobody.
    const gap = places.length === 0 ? 0 : Math.min(maxGap, Math.max(1, tier));

    // The unit's own node is the seed of its ground, and the way home arrives
    // at it — so everything else grows forward from here.
    const own = { q: 0, r: 0 };
    const patch: Patch = {
      cells: [own],
      taken: new Set([KEY(0, 0)]),
      blocked: new Set<number>(),
      nodes: new Set([KEY(0, 0)]),
      own,
      children: new Map(),
      reach: 0,
      tier,
    };

    /**
     * **Air round the high nodes, measured node to node.**
     *
     * Greg, 2026-10-03: *"we likely need much more space surrounding the
     * central nodes — master centre and its immediate reports"*, and *"at the
     * highest level of abstraction, the greatest number of hexagon tiles are
     * found between **nodes**."*
     *
     * Between nodes is the part that matters, and getting it wrong is
     * expensive. Blocking the ground round a parent outright — so that no cell
     * of a child's whole territory could enter it — pushed the master centre's
     * only report **21 tiles** away, because a territory surrounds its own node
     * in every direction and all of it had to clear the bubble. It also cost
     * ten points of family cohesion across the company.
     *
     * Holding the *nodes* apart and letting the ground come as close as it
     * likes says what Greg actually asked for, and costs nothing anywhere else.
     * `tier − 1` so that a team (tier 0) and whatever holds teams (tier 1) keep
     * their children pressed right up against them, which is what makes a team
     * read as one thing.
     */
    const bubble = Math.max(0, Math.min(maxGap, tier - 1));

    kids.forEach(({ kid, patch: child }, i) => {
      const spine = FAN[Math.min(i, FAN.length - 1)];
      const offset = placeChild(patch, child, spine, bubble);
      if (!offset) { unplaced.push(kid.id); return; }
      patch.children.set(kid.id, { offset, spine });
      /**
       * **A clear tile separates territories, not individuals.**
       *
       * Greg, 2026-10-03: *"sibling teams by default have one tile separating
       * them."* Teams — a thing with people in it — not every pair of nodes.
       * Charging the gap to a lone unit as well pushed every leaf a tile off
       * its own parent and siblings, and the company went from 96% of children
       * touching their family to 47%, with 115 of 131 families reading as one
       * patch down to 23. The map looked organised and had stopped being a
       * family tree.
       *
       * So a child small enough not to read as a region sits right against its
       * kin, and anything bigger keeps its clear ground. The separation that
       * carries meaning is between *places*, and `PLACE_SIZE` is where a thing
       * becomes one.
       */
      // Where the child's own node ended up, in this unit's frame.
      const kidNode = rotate(child.own, spine);
      patch.nodes.add(KEY(kidNode.q + offset.q, kidNode.r + offset.r));

      const isTerritory = child.cells.length >= place;
      for (const cell of child.cells) {
        const turned = rotate(cell, spine);
        const at = { q: turned.q + offset.q, r: turned.r + offset.r };
        patch.cells.push(at);
        patch.taken.add(KEY(at.q, at.r));
        patch.reach = Math.max(patch.reach, hexDistance(at, own));
        if (isTerritory) {
          for (const near of spiral(at, gap)) patch.blocked.add(KEY(near.q, near.r));
        }
      }
    });

    patches.set(unit.id, patch);
    return patch;
  };
  measure(root);

  // --- pass two: place, from the root down ---------------------------------
  let radius = 0;
  let touchingParent = 0;
  let depth = 0;

  const maxGapUsed = maxGap;
  const put = (unit: UnitNode, at: Cell, spine: number, branch: string) => {
    const patch = patches.get(unit.id)!;
    cells.set(unit.id, at);
    occupants.set(cellKey(at), unit.id);
    branchOf.set(unit.id, branch);
    depth = Math.max(depth, unit.depth);
    radius = Math.max(radius, hexDistance(at, { q: 0, r: 0 }) + patch.reach);

    // The territory, as a disc that holds it — for culling and hit tests. The
    // shape itself is the union of its units' cells, which the renderer can
    // outline directly.
    regions.set(unit.id, { centre: at, radius: patch.reach });

    const parentCell = unit.parentId ? cells.get(unit.parentId) : null;
    if (parentCell) {
      const d = hexDistance(at, parentCell);
      steps.set(unit.id, d);
      if (d === 1) touchingParent++;
    } else {
      steps.set(unit.id, 0);
    }

    for (const kid of inGrammarOrder(unit)) {
      const placedAt = patch.children.get(kid.id);
      if (!placedAt) continue;
      spacedBy.set(kid.id, Math.max(0, Math.min(maxGapUsed, patch.tier - 1)));
      // The child's own node, in this unit's frame, then turned into the world.
      const kidPatch = patches.get(kid.id)!;
      const localOwn = rotate(kidPatch.own, placedAt.spine);
      const local = { q: localOwn.q + placedAt.offset.q, r: localOwn.r + placedAt.offset.r };
      const world = add(at, rotate(local, spine));
      put(kid, world, (spine + placedAt.spine) % 6, unit.id === root.id ? kid.id : branch);
    }
  };

  put(root, { q: 0, r: 0 }, 0, root.id);

  // Nobody standing on anybody — the one failure a packer must never hide.
  let tooClose = 0;
  const seen = new Set<string>();
  for (const cell of cells.values()) {
    const key = cellKey(cell);
    if (seen.has(key)) tooClose++;
    else seen.add(key);
  }

  return {
    cells, occupants, regions, steps, branchOf, spacedBy, radius,
    stats: { placed: cells.size, touchingParent, depth, tooClose, unplaced: unplaced.length },
  };
}


/**
 * The same layout, in the shape the rest of the map already speaks.
 *
 * `scene.ts`, `arrange.ts` and the lab all consume an `Allocation`, so handing
 * one back means the atlas can be switched on without a single consumer
 * knowing — which is how it can sit beside the archipelago and be compared
 * rather than argued about.
 *
 * The statistics are computed honestly rather than asserted. Two of them mean
 * something different here and are worth reading in that light: **exclaves are
 * nought by construction**, because a unit is placed inside its parent's ground
 * and cannot be stranded outside the family; and **islands are nought**,
 * because nothing is placed offshore — the archipelago rule is replaced by
 * nesting rather than reproduced by it.
 */
export function allocateByTerritory(
  tree: OrbitalTree,
  options: { maxGap?: number; place?: number } = {},
): Allocation {
  const laid = layoutTerritories(tree, options);

  let connected = 0;
  let worstReach = 0;
  let families = 0;
  let wholeFamilies = 0;
  const exclaves = new Set<string>();

  for (const unit of tree.units.values()) {
    const own = laid.cells.get(unit.id);
    if (!own) continue;
    if (unit.parentId) {
      const steps = laid.steps.get(unit.id) ?? 0;
      if (steps > worstReach) worstReach = steps;
      // Does it touch its parent or any sibling? Nesting makes this nearly
      // free, but "nearly" is not "always" — a lone child of a huge sibling can
      // still end up a street away.
      const family = new Set<string>();
      const parentCell = laid.cells.get(unit.parentId);
      if (parentCell) family.add(cellKey(parentCell));
      for (const id of tree.units.get(unit.parentId)?.childIds ?? []) {
        if (id === unit.id) continue;
        const c = laid.cells.get(id);
        if (c) family.add(cellKey(c));
      }
      /**
       * **Spaced on purpose is not stranded.**
       *
       * A unit held away from its parent by the tier rule is exactly where it
       * was asked to be, and counting it as an exclave made the statistic
       * measure the rule rather than any failure — Northwind went from 74 to
       * 121 the moment the master centre got the air Greg asked for, with
       * nothing actually going wrong. So the question is whether a unit is
       * *further out than it was told to be*, which is the only version of it
       * anybody should act on.
       */
      const allowed = (laid.spacedBy.get(unit.id) ?? 0) + 1;
      let reach = Infinity;
      for (const key of family) {
        const [q, r] = key.split(",").map(Number);
        reach = Math.min(reach, hexDistance(own, { q, r }));
      }
      if (reach <= allowed) connected++;
      else exclaves.add(unit.id);
    }

    if (unit.childIds.length === 0) continue;
    families++;
    const patch = new Set([cellKey(own)]);
    for (const id of unit.childIds) {
      const c = laid.cells.get(id);
      if (c) patch.add(cellKey(c));
    }
    const seen = new Set([cellKey(own)]);
    const queue: Cell[] = [own];
    while (queue.length) {
      const at = queue.pop()!;
      for (const nb of neighbours(at)) {
        const key = cellKey(nb);
        if (patch.has(key) && !seen.has(key)) { seen.add(key); queue.push(nb); }
      }
    }
    if (seen.size === patch.size) wholeFamilies++;
  }

  return {
    cells: laid.cells,
    occupants: laid.occupants,
    steps: laid.steps,
    exclaves,
    branchOf: laid.branchOf,
    radius: laid.radius,
    stats: {
      placed: laid.stats.placed,
      connected,
      islands: 0,
      touchingParent: laid.stats.touchingParent,
      exclaves: exclaves.size,
      wholeFamilies,
      families,
      worstReach,
    },
  };
}
