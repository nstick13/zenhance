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
 * ## Two things that did not work, 2026-10-02
 *
 * Greg saw long straight lines running through the map and read them as the
 * chains refusing to fan out. Measured, they were two different things, and
 * only one of them had a fix here.
 *
 * - **A straight line is usually a lineage, not a chain.** 31% of chains
 *   continued their parent's chain along the same axis, in unbroken runs of up
 *   to seven nodes, because `fanAngles` aims the heaviest child straight along
 *   `outward` at every rung. Leaning the fan a lattice step, alternating by
 *   depth, broke runs to four — and cost adjacency (54% → 49%), exclaves
 *   (9 → 10) and chains under strangers (26 → 47). A lineage running straight
 *   is what rule 2 asks for; it is not worth buying a kink with a worse map.
 * - **Fanning in the router is not free.** See `SIDE_ALREADY_USED` in
 *   `route.ts`: every price that moves the fan also makes chains walk further
 *   to find a face, and prices small enough not to move the chains do not move
 *   the fan either.
 *
 * What did work was `DOORSTEP` below — giving a child a cell next to its own
 * parent gets it a face of its own for nothing.
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
  ring,
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
    /** Placed apart on purpose, under the archipelago rule. Not a failure. */
    islands: number;
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
 *  rather than strung out, not enough to beat open ground.
 *
 *  Unchanged at 200. Greg's priority inversion on 2026-10-03 — *"prioritise
 *  keeping teams as contiguous, rather than reduction in parent-node
 *  connection back to master"* — is carried entirely by `KEEP_TOGETHER`, which
 *  outranks this when it applies. Lowering this instead was tried and made the
 *  unit-only layout worse at everything (adjacency 49% → 37%, whole families
 *  81% → 73%, chains under a stranger 26 → 73), because without a group the
 *  cohesion term is zero and all that is left is a weaker rule. */
const REACH_PENALTY = 200;

/**
 * What it is worth to sit next to your own group — a team, usually.
 *
 * Six neighbours, so a cell wholly surrounded by its own group is worth
 * `6 * KEEP_TOGETHER` — four and a half steps of `REACH_PENALTY`, which is
 * what lets a team take ground further from its parent to stay in one piece. This is the whole of Greg's
 * priority inversion: a team that has to sit three cells further out to stay
 * in one piece should do so, and pay for it with a longer chain.
 *
 * Without a `groupOf`, every unit is its own group and this term is zero — so
 * the allocator behaves exactly as it did before.
 */
const KEEP_TOGETHER = 150;

/**
 * How much clear ground to leave between one group and the next — an
 * archipelago rather than a continent.
 *
 * Greg, 2026-10-03: *"the default should be that nodes and teams are spaced
 * apart. Think archipelago rather than continent. The connection lines do the
 * work to indicate the relationships… So let's set a rule of requiring a
 * spacing of at least three tiles between teams. Parental nodes can sit on the
 * path that connects the team with master. This three-tile rule is not binding
 * — a user can override it. It just governs the default view."*
 *
 * Measured in **empty cells**, so a candidate must be at least `gap + 1` away
 * from anything belonging to another group. Only the default placement obeys
 * it; a hand can put a tile wherever it likes, which is why this lives in the
 * allocator and not in the drop rules.
 *
 * **How far apart depends on how closely related** (Greg, 2026-10-03):
 * *"sibling teams by default have one tile separating them… Cousin teams have
 * two. Anything above a cousin has three. The idea here is to use separation
 * metrics as a way to naturally sort archipelagos into territorial regions."*
 *
 * So the gap is read off the tree, through `gapBetween`: one rung up to the
 * common ancestor is a sibling and gets one tile, two rungs is a cousin and
 * gets two, and anything further gets `TEAM_GAP`. The effect is that distance
 * on the map *means* distance in the company — you can read how related two
 * islands are without following a single line.
 *
 * It is a price rather than a wall. A company dense enough that nowhere clears
 * the gap still gets placed — it just pays, and the cheapest crowded cell wins.
 */
export const TEAM_GAP = 3;
const TOO_CLOSE = 4000;

/** How far off the outward direction a new island may still sit. Ninety
 *  degrees is "the correct side of the parent" and nothing more — Greg's first
 *  rule of precedence, which is a gate rather than a preference. */
const WRONG_SIDE = 90;

/** How many rings past the first qualifying cell to keep looking, so direction
 *  can outrank distance without the search becoming a flood fill. */
const DIRECTION_SLACK = 3;

/**
 * A group takes its ground **before** anybody stands on it.
 *
 * Greg, 2026-10-03: *"I think your fix — that human nodes occupy calculated
 * space — is the fix, so we need to give precedence to contiguous teams."*
 *
 * Spacing used to be checked against the cells that happened to exist at the
 * moment of placing. A team's node was seated with its clearance, and then its
 * people were added one at a time on the family edge — by which point the
 * neighbouring team was already there, so the team grew straight into the gap
 * it had been given. Eighty per cent compliance was the ceiling, and no amount
 * of tuning reached past it, because the footprint was not known at placement.
 *
 * So a team now reserves a hexagonal region big enough for everybody in it, at
 * the moment its node lands. Other groups keep clear of the whole **region**,
 * not of the cells drawn so far, and the team's own people fill it from inside.
 * Reserved ground is marked but not occupied: it belongs to the group, and
 * stays available to that group alone.
 *
 * `REGION_SLACK` is the room left for growth — a team of seven gets a region
 * that would hold ten, so adding somebody does not force a re-plan.
 */
const REGION_SLACK = 1.35;

/** The ring radius whose hexagon holds at least `n` cells: 3r² + 3r + 1 ≥ n. */
export function regionRadius(n: number): number {
  let r = 0;
  while (3 * r * r + 3 * r + 1 < n) r++;
  return r;
}

/** What it costs to take a cell somebody else's unseated children were going
 *  to need — their doorstep.
 *
 *  A unit has six neighbours and one of them is the way home, so five of its
 *  children can touch it; beyond that they reach it through a sibling and the
 *  chain home has to walk. Nothing used to stop a cousin's subtree, seated
 *  first, parking on those five. Measured on the 1,000-person company, only
 *  46% of children ended up next to their parent — and a chain that cannot go
 *  straight home is the whole of what Greg saw on 2026-10-02: lines leaving by
 *  whatever face was left, three and four cells long, crossing strangers.
 *
 *  So a cell next to a unit that still has children to seat is charged for,
 *  and the charge rises as that unit runs out of room. It is a price, not a
 *  reservation: a child with nowhere else to go still takes the cell. That
 *  distinction is why this is not the fourth of the abandoned rewrites in the
 *  header — those partitioned the plane before anyone sat down, and starved. */
const DOORSTEP = 150;

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

export function allocate(
  tree: OrbitalTree,
  options: {
    /** Which group a unit belongs to — a team id, typically. Units in the same
     *  group are pulled together, ahead of staying near their parent. */
    groupOf?: (unitId: string) => string | null;
    /** Clear tiles wanted between two groups, by how closely related they are.
     *  Defaults to `TEAM_GAP` for every pair. */
    gapBetween?: (a: string, b: string) => number;
  } = {},
): Allocation {
  const cells = new Map<string, Cell>();
  const occupants = new Map<string, string>();
  const steps = new Map<string, number>();
  const branchOf = new Map<string, string>();
  let radius = 0;
  const exclaves = new Set<string>();
  let connected = 0;
  let islands = 0;
  let touchingParent = 0;
  let worstReach = 0;

  const root = tree.units.get(tree.rootId);
  if (!root) {
    return {
      cells, occupants, steps, branchOf, exclaves, radius,
      stats: {
        placed: 0, connected: 0, islands: 0, touchingParent: 0, exclaves: 0,
        wholeFamilies: 0, families: 0, worstReach: 0,
      },
    };
  }

  const SIZE = 1; // only angles are compared, and those are scale-free

  /** cell key → the group that owns it. Set when a unit lands *and* when a
   *  group reserves its region, which is what makes spacing hold. */
  const groupAt = new Map<string, string>();

  /** origin+size → the ring a region of that size last fitted at, so the next
   *  one does not re-scan ground already known to be full. */
  const searchedTo = new Map<string, number>();

  /** How many units each group will need room for, known before any of them
   *  are placed — the whole point of reserving. */
  const groupSize = new Map<string, number>();
  if (options.groupOf) {
    for (const unit of tree.units.values()) {
      const g = options.groupOf(unit.id);
      if (g === null) continue;
      groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
    }
  }

  const take = (
    unit: UnitNode, cell: Cell, fromParent: number, branch: string, touches: boolean,
    /** Placed apart on purpose — the archipelago rule, not a failure to fit. */
    island = false,
  ) => {
    cells.set(unit.id, cell);
    occupants.set(cellKey(cell), unit.id);
    const group = options.groupOf?.(unit.id) ?? null;
    if (group !== null) groupAt.set(cellKey(cell), group);
    steps.set(unit.id, fromParent);
    branchOf.set(unit.id, branch);
    const fromRoot = hexDistance(cell, { q: 0, r: 0 });
    if (fromRoot > radius) radius = fromRoot;
    if (fromParent === 0) return; // the root belongs to no family
    if (island) islands++;
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

  /** How many cells next to it a unit still needs for its own children. Five
   *  at most — the sixth neighbour is the way home — and zero once the unit
   *  has been through `place`, because by then its children are seated. */
  const needs = new Map<string, number>();
  for (const unit of tree.units.values()) {
    const kids = unit.childIds.length;
    if (kids > 0) needs.set(unit.id, Math.min(kids, unit.parentId ? 5 : 6));
  }

  const freeNeighbours = (cell: Cell): number => {
    let free = 0;
    for (const n of neighbours(cell)) if (!occupants.has(cellKey(n))) free++;
    return free;
  };

  /** What taking `candidate` would cost the units around it that have not
   *  seated their children yet. Nothing at all while they have room to spare. */
  const doorstepCost = (candidate: Cell): number => {
    let cost = 0;
    for (const n of neighbours(candidate)) {
      const who = occupants.get(cellKey(n));
      if (!who) continue;
      const need = needs.get(who) ?? 0;
      if (need <= 0) continue;
      const free = freeNeighbours(n);
      if (free <= need) cost += DOORSTEP * (need - free + 1);
    }
    return cost;
  };

  /** How much open ground a cell opens onto: free cells within two rings.
   *  This is the lookahead that stops a branch walking into a pocket and
   *  stranding its own descendants. */
  /**
   * What it costs to sit this close to somebody else's group. Zero once the
   * clear ground Greg asked for is there; it rises steeply as the gap closes,
   * so a unit will travel a long way rather than crowd its neighbour.
   */
  const wanted = options.gapBetween
    ? (a: string, b: string) => Math.max(0, Math.min(TEAM_GAP, options.gapBetween!(a, b)))
    : () => TEAM_GAP;

  const crowding = (cell: Cell, group: string | null): number => {
    if (group === null) return 0;
    let worst = 0;
    for (const near of spiral(cell, TEAM_GAP)) {
      const other = groupAt.get(cellKey(near));
      if (other === undefined || other === group) continue;
      const need = wanted(group, other);
      const slack = hexDistance(cell, near);
      worst = Math.max(worst, need + 1 - slack);
    }
    return worst * TOO_CLOSE;
  };

  /** How many of a cell's six neighbours already hold this unit's own group. */
  const kinship = (cell: Cell, group: string | null): number => {
    if (group === null) return 0;
    let n = 0;
    for (const side of neighbours(cell)) if (groupAt.get(cellKey(side)) === group) n++;
    return n;
  };

  const elbowRoom = (cell: Cell): number => {
    let free = 0;
    for (const c of spiral(cell, LOOKAHEAD_RING)) {
      if (!occupants.has(cellKey(c))) free++;
    }
    return free;
  };

  /**
   * The best free cell on the edge of a family — the parent plus every sibling
   * already seated — for a child heading `desired` from its parent.
   *
   * This is rule 1. Everything else in this file was already here; letting the
   * search consider a sibling's edge as well as the parent's is the whole
   * change, and it is what makes a span of twenty cost nothing.
   */
  const findFamilyCell = (
    family: readonly Cell[], parentCell: Cell, desired: number, group: string | null,
  ): Cell | null => {
    const seen = new Set<string>();
    let best: Cell | null = null;
    let bestScore = -Infinity;
    for (const member of family) {
      for (const candidate of neighbours(member)) {
        const key = cellKey(candidate);
        if (seen.has(key) || occupants.has(key)) continue;
        seen.add(key);
        const deviation = (angleGap(worldAngle(parentCell, candidate, SIZE), desired) * 180) / Math.PI;
        // Close to the parent keeps a family compact rather than snaking, and
        // compactness is now the only thing saying "these belong together".
        const score =
          elbowRoom(candidate) * SPACE_WEIGHT
          + kinship(candidate, group) * KEEP_TOGETHER
          - crowding(candidate, group)
          - deviation * DEGREE_PENALTY
          - hexDistance(parentCell, candidate) * REACH_PENALTY
          - doorstepCost(candidate);
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
    return best;
  };

  /** Last resort, when a family is so boxed in that not one of its members has
   *  a free neighbour: the nearest free cell anywhere. Produces an exclave. */
  const findCell = (
    from: Cell, desired: number, group: string | null = null,
  ): { cell: Cell; steps: number } | null => {
    /**
     * **Distance comes last.** Greg, 2026-10-03: *"there is no limit on
     * connection line length — it should take the shortest path BUT it should
     * defer to spacing… the order of precedence for layout-on-move is: exist on
     * the other side of parent to grandparent — spacing — tree away from
     * parent."*
     *
     * So the two hard things are checked first and the search is not allowed to
     * stop at the nearest ring that happens to have a free cell — which is what
     * it used to do, and why siblings ended up touching and a branch's own
     * parent ended up buried inside it:
     *
     *   1. **The right side of the parent.** A child belongs in the hemisphere
     *      pointing away from its grandparent, so the way home is the near edge
     *      of the island rather than somewhere in its middle.
     *   2. **The spacing.** One clear tile from a sibling, two from a cousin,
     *      three from anyone further off.
     *   3. **Treeing away**, which is what the remaining score ranks.
     *
     * Only then does distance break the tie. The search keeps looking for a few
     * rings past the first qualifying cell (`DIRECTION_SLACK`) so a slightly
     * further cell in a much better direction can win — a bounded stand-in for
     * "no limit", because scanning forty rings per unit is not affordable.
     */
    let fallback: { cell: Cell; steps: number; score: number } | null = null;
    let best: { cell: Cell; steps: number; score: number } | null = null;
    let foundAt = Infinity;
    for (let k = 1; k <= MAX_SEARCH_RING; k++) {
      if (k > foundAt + DIRECTION_SLACK) break;
      for (const candidate of ring(from, k)) {
        if (occupants.has(cellKey(candidate))) continue;
        const deviation = (angleGap(worldAngle(from, candidate, SIZE), desired) * 180) / Math.PI;
        const crowded = crowding(candidate, group);
        const score =
          elbowRoom(candidate) * SPACE_WEIGHT
          - crowded
          - deviation * DEGREE_PENALTY
          - doorstepCost(candidate)
          - k * REACH_PENALTY / 8;
        // Rule 1 and rule 2 are gates, not scores. A cell that fails either is
        // only ever a fallback, however close it is.
        if (crowded > 0 || deviation > WRONG_SIDE) {
          if (!fallback || score > fallback.score) fallback = { cell: candidate, steps: k, score };
          continue;
        }
        if (!best || score > best.score) {
          best = { cell: candidate, steps: k, score };
          foundAt = Math.min(foundAt, k);
        }
      }
    }
    if (best) return { cell: best.cell, steps: best.steps };
    return fallback ? { cell: fallback.cell, steps: fallback.steps } : null;
  };

  /**
   * Take a whole region for a group, and seat its first unit on the near edge.
   *
   * The region is a hexagon big enough for everybody in the group plus a little
   * slack, placed so that every cell of it clears the spacing every *other*
   * group is owed. Reserving it is what makes the gap survive the group filling
   * up — see `REGION_SLACK`.
   *
   * The seat is the cell of the region **closest to the parent**, which is
   * Greg's rotation rule: the way home lands on the near edge of the island
   * rather than somewhere in its middle.
   */
  const claimRegion = (
    from: Cell, desired: number, group: string,
  ): { seat: Cell; centre: Cell; radius: number } | null => {
    const size = groupSize.get(group) ?? 1;
    if (size <= 1) return null; // a lone node needs no territory
    const radius = regionRadius(Math.ceil(size * REGION_SLACK));

    /**
     * Could this whole hexagon be ours? Free ground, and clear of everybody we
     * are not related to.
     *
     * **One pass, not a nested one.** Asking `crowding` about every cell of the
     * region meant 61 cells × 37 neighbours at every candidate centre, and the
     * allocation went from 50ms to three seconds. The same answer falls out of
     * a single sweep: anything inside the region must be free and unowned, and
     * anything outside is only a problem if it is closer to the region's edge
     * than the gap that group is owed — which is `d − radius`, straight from
     * the centre distance.
     */
    const available = (centre: Cell): boolean => {
      for (const cell of spiral(centre, radius + TEAM_GAP)) {
        const key = cellKey(cell);
        const owner = groupAt.get(key);
        const d = hexDistance(cell, centre);
        if (d <= radius) {
          if (occupants.has(key)) return false;
          if (owner !== undefined && owner !== group) return false;
          continue;
        }
        if (owner === undefined || owner === group) continue;
        if (d - radius <= wanted(group, owner)) return false;
      }
      return true;
    };

    let best: { centre: Cell; score: number } | null = null;
    let foundAt = Infinity;
    /**
     * Where to start looking. A division's teams are placed one after another
     * from the same cell, and each was re-scanning the rings the one before had
     * already found full — which is most of the 1.4s this used to cost.
     *
     * Ground is only ever taken during an allocation, never released, so a ring
     * that had no room stays that way. Starting a few rings back from where the
     * last one succeeded is therefore safe as well as much cheaper.
     */
    const memo = `${cellKey(from)}|${radius}`;
    const from0 = Math.max(radius + 1, (searchedTo.get(memo) ?? 0) - 2);
    // Centres sit at least a radius out, or the region would swallow the parent.
    for (let k = from0; k <= MAX_SEARCH_RING; k++) {
      if (best && k > foundAt + 1) break;
      for (const centre of ring(from, k)) {
        if (!available(centre)) continue;
        const deviation = (angleGap(worldAngle(from, centre, SIZE), desired) * 180) / Math.PI;
        if (deviation > WRONG_SIDE) continue;
        const score = -deviation * DEGREE_PENALTY - k * REACH_PENALTY / 8;
        if (!best || score > best.score) { best = { centre, score }; foundAt = Math.min(foundAt, k); }
      }
    }
    if (!best) return null;
    searchedTo.set(memo, foundAt);

    for (const cell of spiral(best.centre, radius)) groupAt.set(cellKey(cell), group);

    // The near edge: whichever cell of the region the chain home reaches first.
    let seat = best.centre;
    let nearest = Infinity;
    for (const cell of spiral(best.centre, radius)) {
      const d = hexDistance(cell, from);
      if (d < nearest) { nearest = d; seat = cell; }
    }
    return { seat, centre: best.centre, radius };
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
    needs.set(parent.id, 0); // we are seating them now; no need to hold ground from ourselves
    if (kids.length === 0) return;

    // Which way is "onward"? Away from this unit's own parent, so a branch
    // keeps running in one direction instead of doubling back on itself.
    const grandparent = parent.parentId ? cells.get(parent.parentId) : null;
    const outward = grandparent ? worldAngle(grandparent, parentCell, SIZE) : 0;
    const wanted = fanAngles(outward, kids.length);

    // **Seat the whole family, then descend.** Placing a child and immediately
    // recursing into it lets that child's own descendants wall in the ground
    // its later siblings needed.
    const parentGroup = options.groupOf?.(parent.id) ?? null;
    const family: Cell[] = [parentCell];
    kids.forEach((kid, i) => {
      const branch = parent.id === root.id ? kid.id : branchOf.get(parent.id) ?? kid.id;
      const group = options.groupOf?.(kid.id) ?? null;

      // **A new island starts offshore.** When a child belongs to a different
      // group from its parent it is the first cell of a new team, and the
      // archipelago rule says it wants clear water round it. The family edge
      // is the one place that water cannot be — the edge is, by definition,
      // against somebody. So the search space changes: ring outward from the
      // parent for the nearest cell with the full gap, and let the chain do
      // the work of saying who it belongs to.
      const newIsland = group !== null && group !== parentGroup;
      if (newIsland) {
        const claimed = claimRegion(parentCell, wanted[i], group!);
        if (claimed) {
          take(kid, claimed.seat, hexDistance(claimed.seat, parentCell), branch, true, true);
          family.push(claimed.seat);
          return;
        }
        const offshore = findCell(parentCell, wanted[i], group);
        if (offshore) {
          take(kid, offshore.cell, offshore.steps, branch, true, true);
          family.push(offshore.cell);
          return;
        }
      }

      const onEdge = findFamilyCell(family, parentCell, wanted[i], group);
      const cell = onEdge ?? findCell(parentCell, wanted[i], group)?.cell ?? null;
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
      islands,
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
