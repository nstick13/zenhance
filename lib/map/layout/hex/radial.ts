/**
 * **The radial driver — ragged rings.**
 *
 * Greg, 2026-10-16: *"We need to have concentric toruses comprised of shaded
 * hexagon zones offset from master-center… The concentric circles do not need to
 * be uniform or complete circles/toruses — rather they are regions that should
 * tend toward toruses but if there aren't enough component nodes to make a torus
 * once all spacings are considered, they shouldn't force the thing."*
 *
 * Asked to choose between one global set of ring radii and each branch stacking
 * its own bands outward from its parent, he took the second: **ragged rings.**
 * Concentric where the company is balanced, ragged where it is not.
 *
 * ## What this replaces, and what it keeps
 *
 * It replaces exactly one thing: `placeChild` in `territory.ts`, the scored
 * search over candidate offsets. That search is 66–68% of layout time and,
 * per [MAP-REVIEW-2026-10-15.md](../../../../docs/MAP-REVIEW-2026-10-15.md), the
 * common factor behind nearly every fault reported since 3 October — a packer
 * hunting for a cell that satisfies competing rules, and travelling when it
 * cannot find one.
 *
 * It keeps everything else, deliberately. The two passes (measure upward, place
 * downward) are the atlas's own shape and the reason it succeeded where three
 * rewrites failed: a parent's size is a *consequence* of its children's rather
 * than a guess at them. The compass is kept whole. The spacing rule is read from
 * `spacing.ts`, so Law 4 holds by construction — there is no second rule here to
 * disagree with the first.
 *
 * ## How a cell is chosen
 *
 * Two numbers decide a unit's position and neither is searched for:
 *
 *  - **the band** — how many rings out from its parent's own node. That is the
 *    parent's owed clearance plus one, from `spacing.ts`.
 *  - **the arc** — a slice of its parent's arc, shared among siblings in
 *    proportion to how much of the company hangs beneath each.
 *
 * The only thing left to decide is *which cell of that band falls in that
 * slice*, which is a handful of candidates rather than a sweep of the horizon.
 *
 * **The compass is not called here, and that is not an oversight.** `headings`
 * exists to hand the atlas's packer one of six lattice directions to turn a
 * territory by. This driver turns nothing: it needs a bearing at full precision,
 * because a band sixty cells round is divided far more finely than six ways. So
 * it subdivides arcs itself — absolutely, from the root's own circle, in the same
 * manner and with the same cap and floor, which it reads from `compass.ts` so
 * there is one fan rule rather than two. Calling `headings` as well would compute
 * the same bearings twice and then throw the better copy away. What it does take
 * from that file is `headingAt`, for the six-way `facing` the scene wants:
 * deriving that here instead was wrong by 30°, because `cellToWorld` puts
 * direction 0 at 30° and not at 0°.
 *
 * **Why proportional arcs are the right rule, measured.** On a fixture with
 * 80–100-wide spans, the hardest parent has 86 children, owns 65% of the circle,
 * and its band offers 85.7 cells. Sharing arc by subtree weight hands a parent
 * cells in proportion to what it has to hold, so it self-balances at the wide
 * end — which is where the honeycomb's five-children ceiling used to bite
 * (adjacency fell to 24% at span 20). Children no longer need to be *next to*
 * their parent, only on the next band at its bearing, so the ceiling is gone.
 *
 * The failure is at the narrow end instead: a four-child team owning 2.7% of the
 * circle gets one cell of arc. So the floor on an arc is stated **in cells** —
 * one cell of the ring the unit is actually standing on, `1/6R` of a turn — and
 * never in degrees. A flat 60° floor was what this file used until 2026-10-16,
 * and it is one cell on ring 1 and *ten* on ring 10, which is why subtrees spilled
 * across their neighbours' ground at every rung but the first.
 *
 * ## A rung is a band, not a ring
 *
 * Counted on the real fixtures before any of this was written:
 *
 * | | units | rungs | one ring per rung holds |
 * | --- | ---: | ---: | ---: |
 * | Northwind, teams | 394 | 11 | 397 |
 * | Northwind, people | 2,957 | 20 | **1,261** |
 * | 1,000-person, people | 1,273 | 16 | **817** |
 *
 * The teams view fits a strict dartboard by luck and with nothing left over for
 * spacing; the people view misses by more than half. So a rung has to be a band
 * with thickness, which is why Greg's word was *torus*. A band grows outward
 * until it has the cells, and the growth is a cell count — never a circumference.
 *
 * ## The geometry is the lattice's
 *
 * Greg, 2026-10-15: *"if we use a 'radial' layout driver, this will be within the
 * parameters of a hexagonal grid, not based on a true circle or, as such, radius.
 * Therefore calculations relating to the radial geometry should not use things
 * like π but instead the lattice/beehive layout geometry, edge-touch calculations
 * and the like."*
 *
 * So: a ring is a ring of cells, its capacity is how many cells are on it, and
 * every distance here is a count of lattice steps. Bearings are still angles,
 * because six of them are real on a lattice and `headings` already works in
 * them — what is forbidden is deriving a distance or a capacity from a circle,
 * and nothing here does. There is no `2πr` and no π in this file.
 */
import type { OrbitalTree, UnitNode } from "@/lib/map/layout/model";
import {
  type Cell,
  cellKey,
  neighbours,
  hexDistance,
  ring,
  spiral,
  worldAngle,
} from "@/lib/map/layout/hex/coords";
import {
  MAX_HALO,
  PLACE_SIZE,
  leastGapFor,
  spacerRule,
  spacingFor,
} from "@/lib/map/layout/hex/spacing";
import { ARC, headingAt } from "@/lib/map/layout/hex/compass";
import type { Region, TerritoryLayout } from "@/lib/map/layout/hex/territory";

/**
 * How many rings past its starting band a unit may be pushed before the driver
 * stops looking.
 *
 * It is a guard, not a design decision — unlike `MAX_HALO`, which shapes the
 * map. The atlas needs a `RING_SLACK` to go with its equivalent, because its
 * score is dominated by how much a placement grows the parent and a slightly
 * further cell in a much better direction can win. Here the direction is already
 * settled by the arc, so the nearest band with room is simply the answer.
 *
 * **It is counted from the starting band and not from the parent**, which it was
 * until 2026-10-16 and which broke Law 1 outright: a unit whose band already
 * began past the limit searched *no rings at all* and was reported unplaced. It
 * never fired at the settings the map ships with, and at a high `thicken` it
 * dropped 2,936 of 2,957 units while every ratio on the panel went on looking
 * healthy, because a ratio of what is left says nothing about what is gone.
 */
const BAND_REACH = 64;

/** Clear tiles between one branch and the next. See `kin` in `RadialOptions`. */
const DEFAULT_KIN = 3;

/**
 * **Every rung climbs.** See `sideways` in `RadialOptions` for the measurements
 * and for what the older setting was.
 */
const DEFAULT_SIDEWAYS: "allow" | "forbid" = "forbid";

/**
 * **Default rings of thickening: none.**
 *
 * Measured rather than chosen. The sweep is in HEX-LAYOUT.md § Separating
 * siblings, and it says the thing nobody expected: pushing a crowded rung
 * outward makes sibling bodies overlap **more**, not less — 27 overlapping
 * bubble pairs at nought, 56 at sixteen — because the room it buys is room for
 * each subtree to sprawl sideways into its neighbour. What it does buy is
 * cohesion and width together, 76.0% of units touching their parent at a radius
 * of 97 against 82.5% at 255.
 *
 * So it is kept as a dial because that trade is a real one somebody may want,
 * and it is set to nought because separating siblings — the thing it was built
 * for — is not what it does.
 */
const DEFAULT_THICKEN = 0;

/** A full turn, in the only unit a bearing has. Bearings are angles because six
 *  of them are real on a lattice; no distance or capacity in this file comes
 *  from one. */
const FULL_TURN = 2 * Math.PI;

/** Normalise a bearing to (−turn/2, turn/2]. */
const wrap = (a: number): number => {
  let x = a;
  while (x <= -FULL_TURN / 2) x += FULL_TURN;
  while (x > FULL_TURN / 2) x -= FULL_TURN;
  return x;
};

/** How far `a` is from `b`, the short way round. */
const apart = (a: number, b: number): number => Math.abs(wrap(a - b));

/**
 * What a unit's subtree needs, worked out from the leaves up.
 *
 * This is the atlas's measuring pass asking a different question. The atlas asks
 * *how big a shape must my ground be*; radially the question is *how much band
 * do I need, and how far out do I reach* — which is the same two-pass structure
 * and the same reason for it.
 */
type Demand = {
  /** Units at or below this one, including itself. What arc share is based on. */
  weight: number;
  /** The widest a single rung beneath this unit gets, in units. The arc has to
   *  be able to seat this many side by side somewhere. */
  widest: number;
  /** How many rings this body takes, from its weight. Not accumulated — see
   *  `ringsFor` for what accumulating it cost. */
  reach: number;
  /** Rungs of *places* beneath this one. Nought for a team. */
  tier: number;
  /** Clear rings this unit keeps between its own node and its children's. */
  clearance: number;
};

export type RadialOptions = {
  /** The cap on clear ground, as `MAX_HALO`. */
  maxGap?: number;
  /** How many cells a thing must hold to count as a place. */
  place?: number;
  /** Units that lead the unit they hang from — they take the pick of the arc. */
  leads?: ReadonlySet<string>;
  /** Units that are people rather than structure. A person is never a place. */
  people?: ReadonlySet<string>;
  /**
   * **Whether a rung may step sideways.**
   *
   * **`"forbid"` since 2026-10-17, and it is now what Law 3 says.** Greg, having
   * seen both: *"make strictly-out the default and update Law 3 to say sideways
   * is forbidden for places."*
   *
   * Law 3 used to read *"equal distance is allowed; nearer is not"*, and
   * `"allow"` is that older rule, kept so the two can still be put side by side.
   * It is where the loopbacks came from: on a clean load 21–28% of the rungs on
   * a leaf's way home took you no closer to the master centre — they went round
   * it — and sideways compounds, six steps being a circle. That is Greg's *"we
   * end up with spirals within four steps"* reached by a different route, and
   * the panel never showed it, because curl-back counts only a rung that goes
   * *inward* and that was honestly nought.
   *
   * `"forbid"` takes those rungs to **nought** and chains doubling back from 6%
   * to 2%. It costs cohesion, because a cell that is both free and strictly
   * further out is a rarer thing than one that is merely not nearer: on
   * Northwind with people as units, units touching their parent fall from 75% to
   * 53% and the mean chain grows from 1.7 cells to 3.2. Greg took that trade
   * with both in front of him.
   *
   * **A person is unaffected either way.** Law 3 makes the near side a cost for
   * an individual rather than a wall — *"pushed outward, never forbidden"* — and
   * that gate is applied only to places, so a lead still stands at their team's
   * door whatever this is set to.
   */
  sideways?: "allow" | "forbid";
  /**
   * **Clear tiles between one branch and the next** — Greg, 2026-10-17: *"give
   * family groupings breathing room of, say, 3–5 spacing tiles around the total
   * area of the family unit, much in the same way we have with teams."*
   *
   * It is kept as an angle rather than a distance, which is what makes it
   * affordable: a gap of `n` tiles at a radius of `R` is `n / 6R` of a turn,
   * because a ring `R` out holds `6R` cells. So the whole family's footprint
   * never has to be packed to know how much room to leave beside it — the two
   * cell counts give it directly, and the branch that grows into that arc
   * inherits the room without anybody measuring it again.
   *
   * It pairs with leaving the slack **unspread**. Children used to share out
   * whatever arc their parent had going spare, in proportion to weight, which
   * fanned a parent's branches across its entire sweep: two sibling branches are
   * the closest thing there is on the tree and they ended up a third of a turn
   * apart. Now each takes the arc it needs, they sit side by side centred on
   * their parent's bearing, and this is the air between them.
   */
  kin?: number;
  /** Which way this tree's root faces, and how wide its children fan. */
  bearing?: number;
  arc?: number;
  /**
   * **How many rings a crowded rung may push its regions outward** to stop their
   * bodies overlapping. Nought packs them tight and lets them interpenetrate;
   * larger separates them and widens the map, very nearly in proportion.
   *
   * It is a dial on one rule and not a second rule — Law 4 — because it only
   * decides *which band* the one spacing figure is applied on. The sweep behind
   * the default is in HEX-LAYOUT.md § Separating siblings.
   */
  thicken?: number;
};

/**
 * **Lay a company out as ragged concentric bands.**
 *
 * Produces an ordinary `TerritoryLayout`, so `allocateByTerritory` wraps it and
 * everything downstream — the scene, tidy, the drag path, the router — consumes
 * it without knowing which driver ran.
 */
export function layoutRadial(tree: OrbitalTree, options: RadialOptions = {}): TerritoryLayout {
  const maxGap = options.maxGap ?? MAX_HALO;
  const place = options.place ?? PLACE_SIZE;
  const leads = options.leads ?? new Set<string>();
  const people = options.people ?? new Set<string>();
  const thicken = options.thicken ?? DEFAULT_THICKEN;
  const sideways = options.sideways ?? DEFAULT_SIDEWAYS;
  const kin = options.kin ?? DEFAULT_KIN;

  /**
   * **The spacer rule** (Greg, 2026-10-16).
   *
   * *"All nodes — human and structural — have a one hexagon space around them.
   * That is to say, each side of the hexagon representing that human or node
   * gains a connecting hexagon that forms its spacer. On load, or using the
   * auto-tidy function, the only things that can enter that node or human's
   * spacer hexagons are humans in the same team or humans that are direct
   * children of a structural node."*
   *
   * This replaces every previous attempt at separating regions, and it is a
   * better rule than any of them because it is stated as **what may touch what**
   * rather than as a distance. A distance has to be measured between two things
   * and both of them have an opinion; a touching rule is decided by the pair.
   *
   * What falls out of it:
   *
   *  - **Two structural nodes can never be adjacent.** Neither is a human, so
   *    neither may enter the other's spacer. Divisions, portfolios and teams all
   *    get their clear hexagon without anybody asking for one.
   *  - **Two humans may touch only if they share a team.** So a team is a single
   *    connected crowd with a clear ring round it — *"teams should have one
   *    hexagon of clear space between them"*.
   *  - **A human may touch a structural node only if it is theirs** — their own
   *    team, or the node they report to directly. A team lead stands at the
   *    door, which is Law 3's own clause, and nobody else's people do.
   *
   * A human's team is their nearest structural ancestor, which needs no new data:
   * the `people` set already says who is a human, and the tree says the rest.
   */
  const { mayTouch } = spacerRule(tree, people);

  const cells = new Map<string, Cell>();
  const occupants = new Map<string, string>();
  const regions = new Map<string, Region>();
  const steps = new Map<string, number>();
  const branchOf = new Map<string, string>();
  const spacedBy = new Map<string, number>();
  const facing = new Map<string, number>();
  const tiers = new Map<string, number>();
  const unplaced: string[] = [];
  /** Units seated outside the slice their family set aside for them. */
  const strayed: string[] = [];

  const root = tree.units.get(tree.rootId);
  if (!root) {
    return {
      cells, occupants, regions, steps, branchOf, spacedBy, facing, tier: tiers, radius: 0,
      stats: { placed: 0, touchingParent: 0, depth: 0, tooClose: 0, unplaced: 0, strayed: 0 },
    };
  }

  /**
   * **The grammar**, unchanged from the atlas: the unit's own lead first, then
   * headcount descending, ties by name. Stable and explainable, and the one
   * function that changes when we hold something meaningful to sort by.
   */
  const inGrammarOrder = (unit: UnitNode): UnitNode[] =>
    unit.childIds
      .map((id) => tree.units.get(id))
      .filter((u): u is UnitNode => !!u)
      .sort((a, b) =>
        Number(leads.has(b.id)) - Number(leads.has(a.id))
        || b.totalSeats - a.totalSeats
        || a.name.localeCompare(b.name));

  // --- pass one: measure, from the leaves up -------------------------------

  const demands = new Map<string, Demand>();
  const measure = (unit: UnitNode): Demand => {
    const had = demands.get(unit.id);
    if (had) return had;

    const kids = inGrammarOrder(unit).map((kid) => ({ kid, demand: measure(kid) }));
    /**
     * **A person is never a place, however many people report to them.**
     *
     * The atlas reads this off a cell count, which it has because it packs a
     * shape. Nothing is packed here, so the count is the subtree's weight —
     * which is the same quantity, since one unit occupies one cell.
     */
    const places = kids.filter(({ kid, demand }) => !people.has(kid.id) && demand.weight >= place);
    const tier = places.length === 0
      ? 0
      : 1 + places.reduce((deepest, { demand }) => Math.max(deepest, demand.tier), 0);

    let weight = 1;
    let widest = kids.length;
    for (const { demand } of kids) {
      weight += demand.weight;
      widest = Math.max(widest, demand.widest);
    }

    /**
     * **The unit's own air**, read from `spacing.ts` and from nowhere else.
     *
     * Same rule as the atlas: the floor from the rung, or a share of the size of
     * the biggest thing standing next to it, whichever is larger. `tier − 1` so
     * that a team and the thing that holds teams keep their children pressed
     * against them, which is what makes a team read as one thing — the lesson
     * the atlas learnt twice and this driver does not get to learn again.
     */
    const widestPlace = places.reduce((most, { demand }) => Math.max(most, ringsFor(demand.weight)), 0);
    const clearance = Math.max(
      0,
      Math.min(maxGap, Math.max(leastGapFor(tier - 1), spacingFor(widestPlace))),
    );

    const demand: Demand = { weight, widest, reach: ringsFor(weight), tier, clearance };
    demands.set(unit.id, demand);
    return demand;
  };
  measure(root);

  // --- pass two: place, from the root down ---------------------------------

  let radius = 0;
  let touchingParent = 0;
  let depth = 0;
  /** Every cell anybody stands on or has had reserved, so Law 1 is a lookup. */
  const taken = new Set<string>();

  /**
   * **Which cell of this band falls in this slice.**
   *
   * Walk the band's rings outward from the parent's node. On each ring keep the
   * free cells whose bearing from the parent lies inside the slice, and take the
   * one nearest the slice's centre line. Nothing on this ring in this slice means
   * the band thickens by one and the question is asked again — which is the whole
   * of "a rung is a band, not a ring", and the only search in the file.
   *
   * **Why a free-cell check and not disjoint slices alone.** Sibling slices do
   * not overlap, so siblings cannot collide. Cousins can: a slice is measured
   * from its own parent's node, and a wedge grown from a child's centre can lean
   * outside the slice its parent was given. Enforcing Law 1 with one occupancy
   * set costs a hash lookup and makes the law impossible to break, which is what
   * "no exception clause" has to mean in code. Whether bodies stay whole (Law 2)
   * is then *measured* rather than asserted — the house rule, after a statistic
   * that measured the rule rather than the map.
   */
  const ORIGIN: Cell = { q: 0, r: 0 };

  const seat = (
    from: Cell,
    firstBand: number,
    centre: number,
    half: number,
    /** The unit being seated, for the spacer rule. */
    who: string,
    /** True for a place, which Law 3 forbids the near side to outright. */
    gateInward: boolean,
    /**
     * Cells this seating may use although they are reserved.
     *
     * The parent's clear ground exists to keep *other* territories out, not to
     * push a unit's own people away from it. Reserving it against everybody put
     * a team's people outside their own team's air and sent them walking: 71% of
     * units touching their parent, 1,369 of 1,686 families whole. Law 3's own
     * clause is the authority — *"an individual person is pushed outward, never
     * forbidden from the near side"* — and the atlas reads it the same way, with
     * its halo turning away a child's whole territory while a lead walks
     * straight through.
     */
    allow?: ReadonlySet<string>,
  ): { cell: Cell; strayed: boolean } | null => {
    const fromOut = hexDistance(from, ORIGIN);
    /** The best cell anywhere, kept only as a last resort. Law 1 says no unit
     *  may be left without a cell, so a unit leaves its slice — and, if it must,
     *  its bearing — before it goes unplaced. The ragged edge that causes is
     *  reported in the stats, not hidden. */
    let fallback: { cell: Cell; rank: number; off: number } | null = null;

    const start = Math.max(1, firstBand);
    for (let band = start; band <= start + BAND_REACH; band++) {
      let best: { cell: Cell; rank: number; off: number } | null = null;
      for (const cell of ring(from, band)) {
        const key = cellKey(cell);
        if (taken.has(key) && !allow?.has(key)) continue;
        const off = apart(worldAngle(from, cell, 1), centre);
        const out = hexDistance(cell, ORIGIN);
        // Strictly-outward is Law 3's wording for a place. A person is "pushed
        // outward, never forbidden", and pushing them this hard breaks teams.
        const inward = sideways === "forbid" && gateInward ? out <= fromOut : out < fromOut;
        /**
         * **The spacer, read from both sides.** A cell is barred if anybody
         * already standing next to it may not share a boundary with this unit —
         * which is the same question whichever of the two asks it, because
         * `mayTouch` is about the pair rather than about either one's claim.
         * That is the whole reason this rule can be stated once and obeyed
         * everywhere, where a distance had to be read from both sides by hand
         * and was not.
         */
        let barred = false;
        for (const near of neighbours(cell)) {
          const sitting = occupants.get(cellKey(near));
          if (sitting !== undefined && !mayTouch(who, sitting)) { barred = true; break; }
        }
        /**
         * **Law 3, ranked rather than scored.**
         *
         * *"The engine may not place a team, or anything above a team, nearer
         * the centre than its own parent… an individual person is pushed
         * outward, never forbidden from the near side."* Two different things,
         * and the law says so in one sentence, so they are one rank with a gate
         * over it rather than two weights to balance.
         *
         * Ranking rather than weighting is deliberate. Every previous attempt in
         * this engine priced the home side against something else and measured
         * as doing nothing or as doing too much — 35.5% → 33.4% at one price,
         * and a team stopping reading as one thing at another. A rank cannot be
         * outbid, and nothing here has a price to tune.
         */
        /**
         * The spacer outranks direction, and is outranked by Law 3's gate. It is
         * a gate with a fallback rather than a refusal: when no cell in the whole
         * reach respects it, the best of the rest still wins, because Law 1 says
         * no unit may be left without a cell. A spacer breached that way means
         * the ground genuinely ran out, which is the only kind this engine should
         * ever produce on its own — and it is counted, not hidden.
         */
        const rank = (inward ? 4 : 0) + (barred ? 2 : 0) + (off > half ? 1 : 0);
        if (!fallback || rank < fallback.rank || (rank === fallback.rank && off < fallback.off)) {
          fallback = { cell, rank, off };
        }
        if (gateInward && inward) continue;
        if (!best || rank < best.rank || (rank === best.rank && off < best.off)) {
          best = { cell, rank, off };
        }
      }
      /**
       * **A barred cell is a reason to walk outward; a narrow slice is not.**
       *
       * A slice narrower than the gap between two cells contains neither of
       * them, and thickening the band for that reason sends a unit hunting for a
       * cell that is sitting right beside it — which cost 40% of units touching
       * their parent when it was got wrong. So anything that merely misses its
       * slice ends the search.
       *
       * The spacer does not. If every free cell on this band would breach
       * somebody's clear hexagon, the next ring out is exactly the right place
       * to look, and that is where the clear space between teams comes from —
       * not from a number, but from there being nowhere nearer that is allowed.
       */
      // `fallback` already holds the best cell seen on any band, ranked, so
      // there is nothing to carry forward here — only a reason to stop.
      if (best && best.rank < 2) return { cell: best.cell, strayed: false };
    }
    return fallback ? { cell: fallback.cell, strayed: fallback.rank >= 2 } : null;
  };

  /**
   * Place `unit` at `at`, then every child outward from it.
   *
   * `centre` and `half` are the arc this unit owns: a bearing and how far either
   * side of it the unit's descendants may spread.
   */
  const put = (
    unit: UnitNode,
    at: Cell,
    centre: number,
    half: number,
    branch: string,
  ) => {
    const demand = demands.get(unit.id)!;
    cells.set(unit.id, at);
    occupants.set(cellKey(at), unit.id);
    taken.add(cellKey(at));
    facing.set(unit.id, headingAt(centre));
    tiers.set(unit.id, demand.tier);
    branchOf.set(unit.id, branch);
    depth = Math.max(depth, unit.depth);
    radius = Math.max(radius, hexDistance(at, { q: 0, r: 0 }));
    regions.set(unit.id, { centre: at, radius: demand.reach });

    const parentCell = unit.parentId ? cells.get(unit.parentId) : null;
    if (parentCell) {
      const d = hexDistance(at, parentCell);
      steps.set(unit.id, d);
      if (d === 1) touchingParent++;
    } else {
      steps.set(unit.id, 0);
    }

    const kids = inGrammarOrder(unit);
    if (!kids.length) return;

    /**
     * **The unit's own clear ground is reserved before any child is seated.**
     *
     * Otherwise a grandchild leaning in from a neighbouring slice can take a
     * cell inside the halo, which is the fault that cost the atlas ten points of
     * cohesion when it blocked the ground rather than the nodes. Reserved as a
     * spiral round the node and released to this unit's own lead, because the
     * person who runs a place belongs at its door.
     */
    const reserved = new Set<string>();
    if (demand.clearance > 0) {
      for (const near of spiral(at, demand.clearance)) {
        const key = cellKey(near);
        if (taken.has(key)) continue;
        taken.add(key);
        reserved.add(key);
      }
    }

    /**
     * **Arc shared in proportion to what hangs beneath each child**, with a
     * floor in cells rather than in degrees.
     *
     * Proportional alone starves a small team inside a big company — measured at
     * one cell of arc for a four-child team owning 2.7% of the circle. The floor
     * is the share of the band a child needs to seat its own widest rung side by
     * side; when the floors oversubscribe the arc they are scaled back together,
     * and the band then thickens to find the room instead. Thickening is the
     * right place for the pressure to go, because it is what Greg's *torus* is.
     */
    /**
     * **A place clears the parent's air. A person stands at its door.**
     *
     * Law 3: *"an individual person is pushed outward, never forbidden from the
     * near side."* The first cut of this driver sent every child out past the
     * clearance, people included, which is the law read backwards — and it
     * measured like it: 27% of units touching their parent against the atlas's
     * 84%, and 380 of 1,686 families in one piece against 1,530.
     *
     * The clearance is air between *places*. A team's own people belong against
     * it, which is what makes a team read as one thing — the same lesson the
     * atlas learnt twice and this driver does not get to learn again.
     */
    /**
     * **Every child's whole footprint is reserved before any of them is placed,
     * and it is reserved as an arc.**
     *
     * The driver used to seat a child as a *point* and let its subtree grow
     * afterwards. That is why it is fast, and it is why sibling regions
     * interpenetrated: nothing had asked how wide the thing being placed was
     * going to turn out. Measured on the 1,000-person company before this,
     * 14 of 15 sibling bubble pairs overlapped against the atlas's 2.
     *
     * Reserving ground the atlas's way — packing an exact shape — would cost the
     * search this driver exists to delete. The cheap equivalent in polar terms is
     * to reserve the **angle** the footprint will occupy, which needs only its
     * size and never its shape.
     *
     * **The arithmetic is the lattice's, and it is two cell counts over each
     * other.** A ring `R` out holds `6R` cells, so one cell of that ring is
     * `1/6R` of a turn and a body `w` cells wide subtends `w/6R`. A child whose
     * subtree packs into a blob of radius `b`, sitting with its node on band `R`,
     * is about `2b + 1` cells across with its middle about `R + b` out — so it
     * claims roughly `(b + ½) / (R + b)` either side of its bearing, plus half
     * the clear ground it is owed. No circumference, no π, no radius: a ratio of
     * two counts of cells, which is what the standing requirement in MAP-LAWS.md
     * asks for.
     */
    const footprint = kids.map((kid) => {
      const kd = demands.get(kid.id)!;
      const isPlace = !people.has(kid.id) && kd.weight >= place;
      const blob = ringsFor(kd.weight);
      /** `spacing.ts`'s rule, unchanged and asked in the only currency that can
       *  hold two sibling *bodies* apart rather than two sibling nodes. */
      const owed = isPlace
        ? Math.min(maxGap, Math.max(leastGapFor(demand.tier), spacingFor(blob)))
        : 0;
      return { kid, kd, isPlace, isPerson: people.has(kid.id), blob, owed };
    });

    /** How much of a turn this child claims, with its node on band `R`. */
    const claim = (k: (typeof footprint)[number], R: number): number => {
      const out = Math.max(1, R + k.blob);
      return Math.min(ARC, 2 * (k.blob + k.owed / 2 + 0.5) / out);
    };

    /**
     * **When the children do not fit, the band gets thicker.**
     *
     * Which is exactly what Greg's *torus* is, and the right place for the
     * pressure to go: the same angle buys more cells further out, so moving
     * everybody one ring out is how a crowded rung finds room without anybody
     * leaving their family or their bearing. It is bounded, and when even
     * `BAND_REACH` will not do it the claims are scaled back together — a map
     * that admits it is crowded beats one that walks to the horizon.
     */
    /**
     * **Only the places are asked**, because they are the only children whose
     * band this moves. A person stands at the door whatever happens — Law 3 —
     * so counting their claim here asks the band to solve something it cannot:
     * the first cut did, and since a person's claim never shrinks as the band
     * grows, every crowded parent walked its children to the guard. Measured
     * on Northwind with people as units, chains averaged 9.4 cells against 1.7
     * and the map was eight times wider.
     *
     * Where a parent's own people genuinely do not fit on ring 1, `seat` puts the
     * overflow on ring 2 by itself. That is the right mechanism for it, because
     * it moves the one person who did not fit rather than the whole family.
     */
    const doorstep = footprint
      .filter((k) => !k.isPlace)
      .reduce((sum, k) => sum + claim(k, 1), 0);
    const room = Math.max(0, half * 2 - doorstep);

    /**
     * **When the regions do not fit, the band gets thicker** — which is what
     * Greg's *torus* is, and the right place for the pressure to go: the same
     * angle buys more cells further out, so moving everybody a ring out is how a
     * crowded rung finds room without anybody leaving their family or their
     * bearing.
     *
     * **Only the places are asked**, because they are the only children whose
     * band this moves. A person stands at the door whatever happens — Law 3 — and
     * their claim never shrinks as the band grows, so counting it asks the band
     * to solve something it cannot: the first cut did, and walked every crowded
     * parent to the guard. Where a parent's own people genuinely do not fit on
     * ring 1, `seat` puts the overflow on ring 2 by itself, which moves the one
     * person who did not fit rather than the whole family.
     *
     * **`thicken` is a dial and the trade is a straight line** — see the sweep in
     * [HEX-LAYOUT.md](../../../../docs/HEX-LAYOUT.md) § Separating siblings.
     * Separation costs width, about proportionally, and no formulation tried
     * avoids it. Two others were measured and rejected: thickening until each
     * slice was at least one cell of its ring, and holding sibling *nodes* apart
     * by the spacing rule. Both moved the overlap by less than the noise, because
     * what overlaps is bodies rather than nodes or tolerances.
     */
    let placeBand = demand.clearance + 1;
    const placesFit = (R: number) =>
      footprint.reduce((sum, k) => sum + (k.isPlace ? claim(k, R) : 0), 0) <= room;
    while (placeBand < demand.clearance + 1 + thicken && !placesFit(placeBand)) placeBand++;

    const want = footprint.map((k) => claim(k, k.isPlace ? placeBand : 1));
    /**
     * **The breathing room, as an angle.** A gap of `kin` tiles at radius `R` is
     * `kin / 6R` of a turn. Only between *places*: a team's own people belong
     * pressed against it, and charging this between two of them would be the
     * 0%-touching bug of 2026-10-03 all over again.
     */
    const places = footprint.filter((k) => k.isPlace).length;
    const gapAngle = places > 1
      ? (kin / Math.max(1, 6 * placeBand)) * FULL_TURN
      : 0;
    const gaps = Math.max(0, places - 1) * gapAngle;
    const asked = want.reduce((a, b) => a + b, 0) + gaps;
    /**
     * Slack is shared out in proportion to what hangs beneath each child, so a
     * rung with room to spare spreads rather than huddling on one side — which
     * is what keeps the ring reading as a ring.
     */
    const squeeze = asked > half * 2 && asked > 0 ? (half * 2) / asked : 1;

    /**
     * **The slack is left empty, and the family is centred in what it needs.**
     *
     * Spreading it fanned sibling branches across the parent's whole sweep,
     * which is the measured cause of Greg's *"landlocked areas of one or two
     * teams that are from one branch, then another is on the other side of the
     * map"*: the closest pair on the tree put as far apart as the arc allowed.
     */
    const used = asked * squeeze;
    let edge = centre - used / 2;
    let seen = 0;
    footprint.forEach((k, i) => {
      // The air sits between places, so it is added before every place but the
      // first rather than after each one, which would push the family off centre.
      if (k.isPlace && seen > 0) edge += gapAngle * squeeze;
      if (k.isPlace) seen++;
      const span = want[i] * squeeze;
      const mid = edge + span / 2;
      edge += span;

      const band = k.isPlace ? placeBand : 1;
      spacedBy.set(k.kid.id, k.isPlace ? demand.clearance : 0);

      /**
       * **The seating slice is floored at one cell of its own ring**, which is
       * the lattice's version of a floor and replaces a flat 60°.
       *
       * The reason for a floor has not changed: ring 1 has six cells 60° apart,
       * so a slice narrower than the gap between two cells contains neither of
       * them, and the band then thickens looking for one that is sitting right
       * beside it. That cost 40% of units touching their parent when it was
       * missing. But a flat floor is wrong at every other radius — 60° is one
       * cell on ring 1 and *ten* on ring 10 — and that over-wide floor is what
       * let subtrees spill across their neighbours. One cell of the ring you are
       * actually standing on is the same idea measured properly.
       */
      const perCell = FULL_TURN / Math.max(1, ring(at, band).length);
      const seatHalf = Math.max(span, perCell) / 2;
      const seated = seat(at, band, mid, seatHalf, k.kid.id, !k.isPerson, reserved);
      if (!seated) { unplaced.push(k.kid.id); return; }
      const cell = seated.cell;
      /**
       * **A unit that could not be seated anywhere its laws and its slice
       * allowed**, and took the least-bad cell instead.
       *
       * This is the number that explains a scattered branch. Everything else on
       * the panel is an average, and an average cannot show you the one team
       * that was flung to the far side of the map — which is exactly what Greg
       * was pointing at and no figure here could account for.
       */
      if (seated.strayed) strayed.push(k.kid.id);
      // Taken for good now, so the rest of the family cannot have it, and no
      // longer merely reserved — a cell somebody stands on is not clear ground.
      reserved.delete(cellKey(cell));
      /**
       * A child's own arc is centred on where it actually landed rather than on
       * the slice it was offered, and the width is **the slice it was given**
       * rather than a floored version of it — handing a subtree more arc than
       * its parent set aside is how siblings came to overlap.
       *
       * **The centring is relative, and this comment used to claim the
       * opposite.** A direction read back off a placement is exactly the rule
       * `headings` was built to replace, and it accumulates in principle. Tested
       * on 2026-10-17 against handing down the offered slice instead: rungs
       * going round the centre 21% → 22%, chains turning more than 90° 6.0% →
       * 4.2%. A wash, so it is left alone — but it is a wart, not a virtue, and
       * the loopbacks come from Law 3 allowing a sideways step rather than from
       * here. See HEX-LAYOUT.md § Why chains still looped.
       */
      put(
        k.kid, cell, worldAngle(at, cell, 1), Math.min(ARC, Math.max(span, perCell)) / 2,
        unit.id === root.id ? k.kid.id : branch,
      );
    });

    for (const key of reserved) taken.delete(key);
  };

  /**
   * The root owns the circle. A re-laid branch does not — it has a parent
   * somewhere outside itself, so it is handed a bearing and a sweep.
   */
  const rootBearing = options.bearing ?? 0;
  const rootHalf = (options.arc ?? FULL_TURN) / 2;
  put(root, { q: 0, r: 0 }, rootBearing, rootHalf, root.id);

  let tooClose = 0;
  const seen = new Set<string>();
  for (const cell of cells.values()) {
    const key = cellKey(cell);
    if (seen.has(key)) tooClose++;
    else seen.add(key);
  }

  return {
    cells, occupants, regions, steps, branchOf, spacedBy, facing, tier: tiers, radius,
    stats: {
      placed: cells.size, touchingParent, depth, tooClose,
      unplaced: unplaced.length, strayed: strayed.length,
    },
  };
}

/** Cells within `r` rings of a centre, inclusive: the lattice's own disc. */
const disc = (r: number): number => 3 * r * r + 3 * r + 1;

/**
 * **How big a body of `n` units is, in rings.**
 *
 * The smallest radius whose disc holds them — the lattice's answer to "how much
 * room does this take", and the reason it is here rather than summed up the tree.
 *
 * The first cut of this driver measured reach by accumulation: a unit's reach was
 * its clearance plus one plus its widest child's reach. That compounds at every
 * rung, exactly as the orbital engine's descendant envelope did in September
 * (*"roughly a trillion units at 30 levels"*), and it compounded straight into
 * the spacing rule, because a gap is a share of the size of the thing it
 * separates. Measured on Northwind with people as units: every clearance pinned
 * to the `MAX_HALO` cap of 12, children 13 rings from their parents, chains
 * averaging 15 cells against the atlas's 2.1, and the map 3 times wider.
 *
 * A count of units cannot compound, because a subtree's weight is a fact about
 * the company rather than about the layout. 
 */
const ringsFor = (units: number): number => {
  let r = 0;
  while (disc(r) < Math.max(1, units)) r++;
  return r;
};

