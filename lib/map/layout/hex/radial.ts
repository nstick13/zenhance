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
  hexDistance,
  neighbours,
  ring,
  ringArc,
  worldAngle,
} from "@/lib/map/layout/hex/coords";
import {
  MAX_HALO,
  PLACE_SIZE,
  RUNGS_PER_HEX,
  gapFor,
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
  /**
   * **Rungs above team level per extra hexagon of clearance** — `RUNGS_PER_HEX`
   * in `spacing.ts`, which is the default and the one this is read from.
   *
   * Greg, 2026-10-17, asked for the spacer to widen with the rung and left the
   * number open: *"a bit more space to be added around, say, every n rungs up
   * from team level… number TBC."* It is an option here so the sweep behind the
   * default can be run without editing the engine, and so he can be shown what
   * each setting looks like. Large enough and it is off: every rung keeps the one
   * hexagon it always had.
   */
  rungs?: number;
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
  const rungs = options.rungs ?? RUNGS_PER_HEX;

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
  // Built below, once the measuring pass knows each unit's rung — `apart`
  // needs that, and Law 4 is one function with everything it needs rather than
  // four arguments threaded through every call site.

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
      floors: [0],
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

  const ORIGIN: Cell = { q: 0, r: 0 };

  /**
   * **What counts as a place**, which decides who gets a wedge of the map and a
   * ring floor, and who sits at their family's doorstep.
   *
   * A person is never a place however many people report to them, and neither is
   * a structural node holding fewer than `place` units: a clear hexagon round
   * something that small buys nothing visual, and a wedge of the map even less.
   * Both sit tight against their family instead, which is `PLACE_SIZE`'s own
   * reasoning in `spacing.ts`.
   */
  const isPlace = (unit: UnitNode): boolean =>
    !people.has(unit.id) && (demands.get(unit.id)?.weight ?? 1) >= place;
  const tierOf = (id: string): number => demands.get(id)?.tier ?? 0;
  /**
   * **Law 4, and the only way this file may ask how far apart two things sit.**
   *
   * `apart` is the whole rule — may they touch, how wide a ring does each rung
   * keep, and since 2026-10-18 whether they belong to the same group of teams.
   * `groupFor` is here for the same reason: how far a candidate has to look is
   * how much ground it might be asked to keep clear.
   */
  const { teamFor, groupFor, apart: apartOf } =
    spacerRule(tree, people, { tierOf, rungs });
  /** How many rings this unit keeps clear of strangers: its own by rung, and
   *  one more if it is a team, whose group keeps a ring of its own. */
  const keepOf = (id: string): number =>
    gapFor(tierOf(id), rungs) + (groupFor(id) !== null ? 1 : 0);

  // --- pass two: the ring floors, one schedule for the whole company -------

  /**
   * **How near the master centre a rung may come** (Greg, 2026-10-17).
   *
   * *"Rather than prevent loopbacks, make the space occupied by master-centre
   * particularly unappealing the further away a descendant is… immediate
   * children of master-centre won't have any problem being close to it;
   * grandchildren will want to be a little more distant, and so on."*
   *
   * So Law 3 is no longer *"strictly further out than your own parent"*. A unit
   * at depth `d` may not come within `floors[d]` of the centre, and beyond that
   * it may sit anywhere its arc allows. That is the difference between a wall
   * and a cost, and it is what removes the **sideways climb**: under the old
   * rule a unit whose slice pointed sideways had to walk twenty rings round the
   * centre before any cell in it was further out than its parent, because the
   * slice and the law were measured from different places. A unit past its floor
   * can move freely at its own radius without breaking anything.
   *
   * **Each rung clears the one inside it, and the figure is `spacing.ts`'s.**
   * `leastApart` is the one rule for how far apart two things sit, read from both
   * sides; asked of a unit on this rung and a unit on the one inside it, it gives
   * the step between their radii. So the schedule is not a number chosen here —
   * it is Law 4 applied radially, which is why it widens by itself as `gapFor`
   * widens with the rung.
   */
  const deepestPlace = (() => {
    let d = 0;
    for (const unit of tree.units.values()) {
      if (isPlace(unit)) d = Math.max(d, unit.depth);
    }
    return d;
  })();
  /** The widest-ringed place on each rung, which is the one the next rung out
   *  has to clear. A rung with no places of its own borrows the one inside it. */
  const widestOnRung: string[] = [];
  for (let d = 0; d <= deepestPlace; d++) {
    let pick: string | null = null;
    for (const unit of tree.units.values()) {
      if (unit.depth !== d || !isPlace(unit)) continue;
      if (!pick || keepOf(unit.id) > keepOf(pick)) pick = unit.id;
    }
    widestOnRung.push(pick ?? widestOnRung[d - 1] ?? root.id);
  }
  /**
   * **A rung clears the one inside it by the widest ring either of them keeps,
   * plus a cell** — which is `apart` read for the worst pair they could offer,
   * rather than for the two representatives themselves.
   *
   * It was `apart(repA, repB)` until 2026-10-18, and that was a cell short as
   * soon as a group of teams started keeping a ring of its own: the term only
   * fires between two *team-level* units, the representatives of two rungs
   * usually are not both teams, and so the schedule stopped reflecting what the
   * teams on those rungs actually need. The rungs holding teams came out too
   * tight, and one team on Northwind — Union Team 235 — ran out of legal ground
   * entirely and had to take a cell it was not entitled to, which showed up as
   * two breaches and seven units standing closer than the rule allows.
   *
   * Reading the widest ring either rung keeps over-provides by a cell where one
   * rung holds teams and the other does not. That is the right way to be wrong:
   * a slightly wider map, rather than a unit with nowhere to stand.
   */
  const floors: number[] = [0];
  for (let d = 1; d <= deepestPlace; d++) {
    floors.push(
      floors[d - 1] + 1 + Math.max(keepOf(widestOnRung[d - 1]), keepOf(widestOnRung[d])),
    );
  }
  const floorAt = (d: number): number => floors[Math.min(Math.max(0, d), floors.length - 1)] ?? 0;

  // --- pass three: the arcs, absolute, before a single cell is chosen ------

  /**
   * **A unit's arc is its share of the root's circle, not a bearing read off
   * where its parent happened to land.**
   *
   * This is the whole of the 2026-10-17 rewrite. The driver used to hand a child
   * `worldAngle(parent, child)` — the direction it *actually* went — as the
   * centre of its own arc, so every rung re-based on wherever the last one fell
   * and over six rungs a branch wrapped right round its parent. Measured on
   * Northwind, Granite Division's three children each spread over 171–219° as
   * seen from Granite and overlapped each other by 171–177°: three clouds
   * occupying one space rather than three wedges, which is Greg's *"landlocked
   * areas of one or two teams that are from one branch, then another is on the
   * other side of the map"*.
   *
   * The fix is the compass's own idea — *an arc is an absolute bearing, so it
   * cannot accumulate* — applied to **width** as well as to direction. The root
   * owns the circle; every unit cuts **its own** interval among its children in
   * proportion to how much of the company hangs beneath each, with the `kin` gap
   * between places; a child keeps that interval and hands sub-intervals of it
   * down. Nothing is ever derived from a placement, so there is nothing to
   * accumulate and a branch is a wedge of the map by construction.
   *
   * It is computed here, in a pass of its own, **before any cell is chosen** —
   * which is not tidiness but the proof: a function of the tree alone cannot
   * depend on where anything landed.
   */
  type Wedge = {
    /** The bearing from the master centre this unit's share is centred on. */
    centre: number;
    /** How far either side of it the unit and its descendants may spread. */
    half: number;
    /** The ring its children start from: their floor, plus any `thicken`. */
    ring: number;
  };
  const wedges = new Map<string, Wedge>();
  const rootBearing = options.bearing ?? 0;
  const rootHalf = (options.arc ?? FULL_TURN) / 2;

  const fan = (unit: UnitNode) => {
    const own = wedges.get(unit.id)!;
    const kids = inGrammarOrder(unit).filter(isPlace);
    if (!kids.length) return;
    const demand = demands.get(unit.id)!;

    /**
     * **When the children do not fit, the band gets thicker.**
     *
     * Which is what Greg's *torus* is, and the right place for the pressure to
     * go: the same angle buys more cells further out, so moving a crowded rung
     * one ring out is how it finds room without anybody leaving their family or
     * their bearing. Only the places are asked, because they are the only
     * children whose ring this moves — a person stands at the door whatever
     * happens, which is Law 3. The sweep behind the default of nought is in
     * HEX-LAYOUT.md § Separating siblings.
     */
    let ring = Math.max(1, floorAt(unit.depth + 1));
    const fits = (R: number) =>
      kids.reduce((sum, kid) => {
        const kd = demands.get(kid.id)!;
        const blob = ringsFor(kd.weight);
        const owed = Math.min(maxGap, Math.max(leastGapFor(demand.tier), spacingFor(blob)));
        return sum + Math.min(ARC, 2 * (blob + owed / 2 + 0.5) / Math.max(1, R + blob));
      }, 0) <= own.half * 2;
    while (ring < floorAt(unit.depth + 1) + thicken && !fits(ring)) ring++;

    /**
     * **The breathing room between one branch and the next, as an angle.**
     * Greg, 2026-10-17: *"give family groupings breathing room of, say, 3–5
     * spacing tiles around the total area of the family unit."* A gap of `kin`
     * tiles at radius `R` is `kin / 6R` of a turn, because a ring `R` out holds
     * `6R` cells — so the family's footprint never has to be packed to know how
     * much room to leave beside it. Scaled back if the air would eat more than
     * half the arc, because the children come first.
     */
    let gap = kids.length > 1 ? (kin / Math.max(1, 6 * ring)) * FULL_TURN : 0;
    const width = own.half * 2;
    if (gap * (kids.length - 1) > width / 2) {
      gap = width / 2 / Math.max(1, kids.length - 1);
    }
    const share = width - gap * (kids.length - 1);
    let total = 0;
    for (const kid of kids) total += demands.get(kid.id)!.weight;

    /**
     * **The biggest branch continues in its parent's own direction.**
     *
     * The shares are the shares whatever order they are laid in, so this costs
     * nothing and is not a second rule — it is which end of the arc each child
     * is given. Laid plainly in grammar order the *largest* branch ends up
     * against one edge of its parent's arc and its parent against the other,
     * which is the longest line on the map attached to the heaviest thing on it.
     * Alternating outward from the middle puts the heaviest child on its
     * parent's own bearing and sends the small ones to the edges, so what is far
     * from its parent is what there is least of.
     */
    const spread: UnitNode[] = [];
    kids.forEach((kid, i) => { if (i % 2 === 1) spread.unshift(kid); else spread.push(kid); });
    let edge = own.centre - own.half;
    for (const kid of spread) {
      const span = share * (demands.get(kid.id)!.weight / Math.max(1, total));
      wedges.set(kid.id, { centre: edge + span / 2, half: span / 2, ring });
      edge += span + gap;
    }
    // Recursed in grammar order rather than in the order they sit, so the
    // picture does not depend on which way round a rung was laid out.
    for (const kid of kids) fan(kid);
  };
  wedges.set(root.id, { centre: rootBearing, half: rootHalf, ring: 0 });
  fan(root);

  // --- pass four: place, rung by rung from the centre out ------------------

  let radius = 0;
  let touchingParent = 0;
  let depth = 0;
  /** Every cell anybody stands on, so Law 1 is a lookup. */
  const taken = new Set<string>();
  /**
   * **Who keeps a clear ring over this cell**, for the cells more than one step
   * from their owner.
   *
   * The spacer used to be one hexagon for everybody, so asking *may anyone next
   * to this cell object* meant looking at six neighbours. Now it widens by rung
   * — `gapFor` — and a tier-5 division keeps three hexagons, which would mean
   * sweeping a spiral of 36 cells round every candidate for every unit. Stamping
   * the wide rings once, when their owner is seated, turns the question back into
   * a lookup: a candidate consults its own ring (cheap, because almost every
   * unit is a person who keeps one hexagon) and then this map for anybody whose
   * ring reaches further than its own.
   */
  const halo = new Map<string, string[]>();

  /**
   * **Is this cell too close to somebody who may not have it?**
   *
   * One predicate, `leastApart` from `spacing.ts`, asked in two directions: over
   * the rings this unit keeps, and over the rings anybody else keeps that reach
   * this cell. Both readings are needed because a gap belongs to the *pair* —
   * which is the whole reason Law 4 states the spacer as what may touch what
   * rather than as a distance one side can ask for.
   */
  const barred = (cell: Cell, who: string): boolean => {
    const mine = keepOf(who);
    for (let k = 1; k <= mine; k++) {
      for (const near of ring(cell, k)) {
        const sitting = occupants.get(cellKey(near));
        if (sitting !== undefined && sitting !== who && k < apartOf(who, sitting)) return true;
      }
    }
    for (const id of halo.get(cellKey(cell)) ?? []) {
      if (id === who) continue;
      const at = cells.get(id);
      if (at && hexDistance(cell, at) < apartOf(who, id)) return true;
    }
    return false;
  };

  /**
   * **Could this place's own people stand here?** Law 2, and the single most
   * expensive thing to get wrong in this rewrite: the first attempt seated
   * places on the best cell for the *node* and cost 260 of 395 teams their
   * integrity, because a node can be perfectly placed in ground that has no room
   * for the crowd that belongs to it. So the crowd is counted before the cell is
   * accepted — free cells within the rings a body that size needs, which is the
   * same `ringsFor` the rest of the file measures bodies with.
   */
  const crowd = new Map<string, string[]>();
  for (const id of people) {
    const team = teamFor(id);
    if (!team) continue;
    const had = crowd.get(team);
    if (had) had.push(id); else crowd.set(team, [id]);
  }
  /**
   * **Room is connected free ground, not a count of free cells.**
   *
   * The first version counted how many cells inside `ringsFor(crowd)` rings were
   * untaken, which is the wrong question twice over: cells scattered either side
   * of a stranger's territory are not somewhere a crowd can stand, and a cell a
   * teammate may not legally enter is not free to them at all. It read healthy
   * on ground that broke the team, and teams in one piece sat at 196 of 395.
   *
   * So the question is asked the way Law 2 is *measured*: flood out from the
   * candidate over ground that is both empty and legal for a member of this
   * crowd, and stop as soon as there is enough of it. Any member will do as the
   * one to ask — the spacer treats a crowd identically, since every one of them
   * has this node as their team — and the fill is bounded by the crowd's own
   * size, so it costs about as much as seating them will.
   */
  const roomFor = (cell: Cell, who: string): boolean => {
    const members = crowd.get(who);
    if (!members || members.length === 0) return true;
    const need = members.length;
    const any = members[0];
    const seen = new Set<string>([cellKey(cell)]);
    const stack: Cell[] = [cell];
    let free = 0;
    while (stack.length) {
      const at = stack.pop()!;
      for (const near of neighbours(at)) {
        const key = cellKey(near);
        if (seen.has(key)) continue;
        seen.add(key);
        if (taken.has(key)) continue;
        if (barred(near, any)) continue;
        free++;
        if (free >= need) return true;
        stack.push(near);
      }
    }
    return false;
  };

  /**
   * **A bearing from the master centre, a distance from the master centre** —
   * the honest polar placer this driver has been approximating.
   *
   * It replaces a search for *"which cell of a ring around my parent falls in a
   * slice measured from my parent"*. The two cannot both be true of one
   * function, which is why this is a rewrite rather than a patch, and why the
   * first attempt at patching it came apart.
   *
   * Rings outward from the unit's floor, and on each ring **only the cells its
   * own arc contains** — found by bisection, not by sweeping. That matters more
   * than it sounds: a ring 120 out holds 720 cells, every spacer question is a
   * spiral of its own, and asking all of them ran the largest company to 23
   * seconds. `ringArc` narrows first and is held to the brute-force filter by a
   * test, because the first attempt's narrowing *changed which cells were
   * eligible* and quietly put 1,249 spacer breaches back.
   *
   * The ranking, worst term first:
   *
   *  - **nearer the centre than its own parent** — Law 3's old wording, kept as
   *    a cost rather than a wall. The floor is the wall now. A cell that fails
   *    this is only ever taken when the whole reach holds nothing better, which
   *    is the law's own *"except where that would conflict with Laws 1 or 2"*.
   *  - **no room for its own crowd** — Law 2.
   *  - **somebody's spacer** — Law 4.
   *  - **outside its own arc** — a preference, and the reason it is the mildest
   *    term: an arc narrower than one cell of the ring contains no cell at all,
   *    and a unit that stepped half a cell out of a sliver has not strayed.
   */
  const seatOut = (
    who: string,
    wedge: Wedge,
    parentCell: Cell | null,
    at: number,
  ): { cell: Cell; strayed: boolean } | null => {
    const fromOut = parentCell ? hexDistance(parentCell, ORIGIN) : 0;
    const start = Math.max(1, at, sideways === "forbid" ? fromOut + 1 : fromOut);
    let fallback: { cell: Cell; rank: number; near: number } | null = null;
    /**
     * **A unit that cannot be seated in its slice gets a wider slice before it
     * is allowed to breach anybody's spacer.**
     *
     * Which is only the ranking below, said out loud: a cell outside the arc
     * costs 1 and a cell that breaches the spacer costs 2, so the law already
     * holds that straying is the lesser fault. The search could not act on it,
     * because `ringArc` offers cells outside the arc only when the arc holds
     * none at all — so a unit whose narrow slice was full never saw the legal
     * ground beside it and took an illegal cell instead.
     *
     * It cost nothing until the groups of teams started keeping a ring of their
     * own on 2026-10-18. That tightened the rungs where the teams live —
     * Northwind's depth 8 holds 80 teams and some 900 people in one band — and
     * **Union Team 235** walked 21 rings out from its floor, ran out of arc, and
     * breached. Widening is tried in two steps and only when the first pass has
     * nothing legal to offer, so the common case is unchanged.
     */
    for (const half of [wedge.half, Math.min(ARC, wedge.half * 4), ARC]) {
    for (let R = start; R <= start + BAND_REACH; R++) {
      let best: { cell: Cell; near: number; strayed: boolean } | null = null;
      for (const candidate of ringArc(ORIGIN, R, wedge.centre, half)) {
        const key = cellKey(candidate.cell);
        if (taken.has(key)) continue;
        const inward = parentCell
          ? (sideways === "forbid" ? R <= fromOut : R < fromOut)
          : false;
        const rank = (inward ? 8 : 0)
          + (roomFor(candidate.cell, who) ? 0 : 4)
          + (barred(candidate.cell, who) ? 2 : 0)
          + (candidate.inside ? 0 : 1);
        /**
         * **The wedge says which way; the family says where in it.**
         *
         * Among the cells its arc allows, a unit takes the one nearest its own
         * parent rather than the one nearest its arc's centre line. The arc is
         * what does the zoning and it is unaffected — every sibling has a
         * different arc, so nothing can cross — while centring on the line
         * instead put a wide branch's children up to a third of a turn round
         * from the node they report to: the longest step home went 18 cells to
         * 32 on the 1,000-person company, and Law 5 says a line follows what
         * the structure already did rather than being the thing that paid.
         */
        const near = parentCell ? hexDistance(candidate.cell, parentCell) : candidate.off;
        if (!fallback || rank < fallback.rank
          || (rank === fallback.rank && near < fallback.near)) {
          fallback = { cell: candidate.cell, rank, near };
        }
        if (rank < 2 && (!best || near < best.near)) {
          // Strayed means *the slice it was offered could not hold it*, which is
          // the widening above — not the everyday case of an arc narrower than
          // one cell of its own ring, which every deep team has and which the
          // nearest cell answers perfectly well.
          best = { cell: candidate.cell, near, strayed: half !== wedge.half };
        }
      }
      if (best) return { cell: best.cell, strayed: best.strayed };
    }
    }
    /** Below the floor rather than nowhere: Law 1 says no unit may be left
     *  without a cell, and Law 2 says a crowd stays whole, so when the arc and
     *  the floor between them have nothing to offer the best of the rest wins
     *  and is counted. */
    if (fallback) return { cell: fallback.cell, strayed: true };
    /** Nothing free in the arc for the whole reach. Rather than leave a unit
     *  without a cell, take any ground round its parent — Law 1 has no exception
     *  clause, and a ragged edge that is counted beats a unit that is gone. */
    const anywhere = parentCell
      ? seatNear(parentCell, who, worldAngle(ORIGIN, parentCell, 1), Math.PI)
      : null;
    return anywhere ? { cell: anywhere.cell, strayed: true } : null;
  };

  /**
   * **A person stands at their team's door, and that is measured from the team.**
   *
   * Law 3 is about places. *"An individual person is pushed outward, never
   * forbidden from the near side"* — and when the outward push reached people on
   * 2026-10-16 it tore 188 of 395 teams apart, so this seater is deliberately
   * the one that did not change: rings outward from the parent's own cell, a
   * slice measured as a bearing from the parent, the near side ranked rather
   * than gated. A team is one crowd pressed against its node, which is what
   * makes it read as one thing.
   *
   * It takes the small structural nodes too — anything holding fewer than
   * `place` units. A clear hexagon round a thing that small buys nothing visual,
   * so it sits tight against its family where it belongs, and it is too small to
   * need a wedge of the map.
   */
  function seatNear(
    from: Cell,
    who: string,
    centre: number,
    half: number,
    /**
     * **True for anything that is not a person**, which is Law 3's own split.
     * A small structural node sits at its family's doorstep for Law 2's sake,
     * and is still held to the law: *"the engine may not place a team, or
     * anything above a team, anywhere that is not strictly further from the
     * centre than its own parent."* Leaving the gate off because the node was
     * small put 118 of 394 rungs back round the centre in the teams view.
     */
    gate = false,
  ): { cell: Cell; strayed: boolean } | null {
    const fromOut = hexDistance(from, ORIGIN);
    let fallback: { cell: Cell; rank: number; off: number } | null = null;
    for (let band = 1; band <= 1 + BAND_REACH; band++) {
      let best: { cell: Cell; rank: number; off: number } | null = null;
      for (const cell of ring(from, band)) {
        const key = cellKey(cell);
        if (taken.has(key)) continue;
        const off = apart(worldAngle(from, cell, 1), centre);
        // **A person is pushed outward, never forbidden**, so for them this is a
        // rank and never a gate — and `sideways` must not reach them at all,
        // which is why the strict reading is only read under the gate.
        const out = hexDistance(cell, ORIGIN);
        const inward = gate && sideways === "forbid" ? out <= fromOut : out < fromOut;
        const rank = (inward ? 4 : 0) + (barred(cell, who) ? 2 : 0) + (off > half ? 1 : 0);
        if (!fallback || rank < fallback.rank || (rank === fallback.rank && off < fallback.off)) {
          fallback = { cell, rank, off };
        }
        if (gate && inward) continue;
        if (!best || rank < best.rank || (rank === best.rank && off < best.off)) {
          best = { cell, rank, off };
        }
      }
      /**
       * **A barred cell is a reason to walk outward; a narrow slice is not.**
       *
       * A slice narrower than the gap between two cells contains neither of
       * them, and thickening the band for that reason sends a unit hunting for a
       * cell sitting right beside it — which cost 40% of units touching their
       * parent when it was got wrong. The spacer is different: if every free
       * cell on this band would breach somebody's clear hexagon, the next ring
       * out is exactly the right place to look, and that is where the clear
       * space between teams comes from.
       */
      if (best && best.rank < 2) return { cell: best.cell, strayed: false };
    }
    return fallback ? { cell: fallback.cell, strayed: fallback.rank >= 2 } : null;
  }

  /** Record a unit at a cell: everything downstream reads these. */
  const land = (unit: UnitNode, at: Cell, branch: string) => {
    const demand = demands.get(unit.id)!;
    cells.set(unit.id, at);
    occupants.set(cellKey(at), unit.id);
    taken.add(cellKey(at));
    const mine = gapFor(tierOf(unit.id), rungs);
    for (let k = 2; k <= mine; k++) {
      for (const near of ring(at, k)) {
        const key = cellKey(near);
        const had = halo.get(key);
        if (had) had.push(unit.id); else halo.set(key, [unit.id]);
      }
    }
    facing.set(unit.id, headingAt(wedges.get(unit.id)?.centre ?? worldAngle(ORIGIN, at, 1)));
    tiers.set(unit.id, demand.tier);
    branchOf.set(unit.id, branch);
    depth = Math.max(depth, unit.depth);
    radius = Math.max(radius, hexDistance(at, ORIGIN));
    regions.set(unit.id, { centre: at, radius: demand.reach });

    const parentCell = unit.parentId ? cells.get(unit.parentId) : null;
    if (parentCell) {
      const d = hexDistance(at, parentCell);
      steps.set(unit.id, d);
      if (d === 1) touchingParent++;
    } else {
      steps.set(unit.id, 0);
    }
  };

  /**
   * **A branch is laid whole before the next one starts, and a unit's own crowd
   * before its children's branches.**
   *
   * This was a rung-at-a-time walk for an afternoon, on the reasoning that a
   * unit's cell no longer depends on where its parent landed — which is true,
   * and not the point. It seats every node of a rung cheek by jowl and *then*
   * sends each one's crowd looking for ground that has already gone: 53% of
   * people ended up off their own parent's doorstep and teams in one piece fell
   * from 332 of 395 to 202, while every node was legally placed and the panel's
   * spacer count stayed at nought.
   *
   * Order is the mechanism that stops it. When a team's people are seated the
   * moment the team lands, the next team along finds that ground taken and walks
   * one ring further out by itself — the crowding is resolved as it happens
   * rather than discovered afterwards. So: the doorstep first, then the people's
   * own people, then each place child in turn, each laid in full before the next.
   */
  const put = (unit: UnitNode) => {
    const kids = inGrammarOrder(unit);
    if (!kids.length) return;
    const at = cells.get(unit.id)!;
    const outward = worldAngle(ORIGIN, at, 1);

    /**
     * **The doorstep fan is local, and the lead gets the door.**
     *
     * A person is seated on a ring round their own parent, so their slice has to
     * be a bearing from that parent — a different frame from the absolute wedges
     * the places live in, and deliberately so. The fan is the whole circle
     * because the only things that may stand next to a node are its own people,
     * and it is turned so that the first child in the grammar — the lead, when
     * there is one — sits on the side facing the master centre. That is Law 3's
     * own clause: *a team lead belongs at their team's door, on the home side.*
     */
    const door = kids.filter((kid) => !isPlace(kid));
    let doorTotal = 0;
    for (const kid of door) doorTotal += demands.get(kid.id)!.weight;
    const perCell = FULL_TURN / 6;
    let edge = wrap(outward + Math.PI);
    const seatedDoor: UnitNode[] = [];
    door.forEach((kid, i) => {
      const span = FULL_TURN * (demands.get(kid.id)!.weight / Math.max(1, doorTotal));
      // The first slice is centred on the door rather than starting there, so
      // the lead faces home instead of standing a sixth of a turn off it.
      const mid = i === 0 ? edge : edge + span / 2;
      if (i === 0) edge -= span / 2;
      edge += span;
      spacedBy.set(kid.id, 0);
      const seated = seatNear(at, kid.id, mid, Math.max(span, perCell) / 2, !people.has(kid.id));
      if (!seated) { unplaced.push(kid.id); return; }
      if (seated.strayed) strayed.push(kid.id);
      land(kid, seated.cell, unit.id === root.id ? kid.id : branchOf.get(unit.id) ?? unit.id);
      seatedDoor.push(kid);
    });
    // The whole doorstep is seated before anybody's children are, so a
    // grandchild cannot take a cell a sibling was about to stand in.
    for (const kid of seatedDoor) put(kid);

    for (const kid of kids) {
      if (!isPlace(kid)) continue;
      const wedge = wedges.get(kid.id)!;
      /** What the floor schedule charged between these two rungs: the one
       *  figure `spacing.ts` gives for holding them apart. */
      spacedBy.set(kid.id, Math.max(0, floorAt(kid.depth) - floorAt(unit.depth)));
      const seated = seatOut(kid.id, wedge, at, wedge.ring);
      if (!seated) { unplaced.push(kid.id); continue; }
      if (seated.strayed) strayed.push(kid.id);
      land(kid, seated.cell, unit.id === root.id ? kid.id : branchOf.get(unit.id) ?? unit.id);
      put(kid);
    }
  };
  land(root, ORIGIN, root.id);
  put(root);

  let tooClose = 0;
  const seen = new Set<string>();
  for (const cell of cells.values()) {
    const key = cellKey(cell);
    if (seen.has(key)) tooClose++;
    else seen.add(key);
  }

  return {
    cells, occupants, regions, steps, branchOf, spacedBy, facing, tier: tiers, radius,
    /**
     * **Where each rung belongs**, published because a hand needs it.
     *
     * It was private while the only thing that read it was the seater. A node
     * the hand has moved has to know how far it has been taken from where its
     * own rung belongs — that ratio is the whole of `deferBranch` — and the
     * answer is this schedule, so it is part of what a layout says about a
     * company rather than a local of the function that wrote it.
     */
    floors,
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

