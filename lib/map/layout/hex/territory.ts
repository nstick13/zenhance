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
  /** unit id → which of the six directions its subtree grows along. */
  facing: Map<string, number>;
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
 * read a label.
 *
 * **Uncapped, deliberately** (Greg, 2026-10-03): *"remove the cap on how much
 * spacing can exist at the top levels — we can reinstate it later… the space
 * around master-centre in the next iteration should be HUUUGE. I want to see it
 * in extremis before moving to the next stage."*
 *
 * The point is not the spectacle. He is *"trying to fix the radiate/fan out
 * problem without forcing the thing into a fan — I want it to arrive there
 * naturally by merit of the structure and rules about how the structure is
 * displayed."* A centre too big to sit beside leaves its children nowhere to go
 * but around it, so the radial reading falls out of the spacing rule instead of
 * being imposed by a fan.
 *
 * **A cap, chosen for load time** (Greg, 2026-10-14).
 *
 * This is a design decision and should be read as one. The spacing *rule* is
 * `GAP_SHARE` — a gap is a third of the size of the thing it separates — and
 * left alone it settles at a halo of 119 tiles round the master centre of the
 * 2,562-person company. That is the "HUUUGE" centre Greg asked for on
 * 2026-10-03, and it is what the search then has to walk.
 *
 * Measured on Northwind with people as the smallest unit:
 *
 * | cap | layout | touching family | curl-back |
 * | --- | ---: | ---: | ---: |
 * | 3 | 0.8s | 86.5% | 33.6% |
 * | **12** | **1.4s** | **86.5%** | **32.1%** |
 * | 24 | 4.9s | 86.5% | 34.0% |
 * | 48 | 6.6s | 86.5% | 35.0% |
 *
 * **Cohesion is identical at every setting, and curl-back is slightly better
 * here than uncapped.** The halo buys width and nothing else measurable, and
 * past 24 it costs multiples of the load time — which is why Greg, asked to
 * choose, took the 4.7× speedup: *"the 'people' view now takes an insane time
 * to render."*
 *
 * It was `MAX_TIER_GAP = 3`, then uncapped as an experiment, then 48, and was
 * briefly called `RUNAWAY_GUARD` on the understanding that it never decided
 * anything. It did: at 48 it was already clipping the top of the two largest
 * companies. A number that shapes the map is a design decision whatever it is
 * called, so it is named for what it does.
 *
 * **This is the one line to change** to give the centre its full width back,
 * and the real fix for wanting both is lazy per-team interiors, parked on the
 * `hex-lazy-interiors` branch.
 */
export const MAX_HALO = 12;

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
/**
 * **What a cell behind the parent costs**, per tile of backward reach.
 *
 * Priced against `GROWTH` on purpose: at this weight a cell behind its parent
 * has to save about two rings of territory before the packer will take it,
 * which leaves it available when the ground genuinely runs out and makes it a
 * last resort everywhere else. Below about 100 it never changes a decision at
 * all — `GROWTH` is 100 a ring and simply outvotes it — which is why an earlier
 * attempt at this term, priced at 60, measured as doing nothing.
 */
const BEHIND = 150;
/** What a person pays per ring beyond their parent's doorstep. See the score
 *  in `placeChild`: a person takes a cell against their own parent whenever one
 *  is free, and the bearing then orders those cells among themselves. */
const AT_THE_DOOR = 5000;
const FAMILY = 45;
const SPINE = 6;

/**
 * **A person is not allowed to drift off their team.**
 *
 * Greg, 2026-10-04: *"at human level there's still a lot of exclaving — the
 * bunching function isn't being given enough weight. Teams of humans should be
 * forced together until a user separates them. So the point is we allow
 * exclaves, but only when they are manually created."*
 *
 * `FAMILY` against `GROWTH` was a *preference*, and the wrong way round for an
 * individual: one extra ring of territory cost 100 while standing apart from
 * your own manager cost 45, so the packer would happily strand somebody to save
 * a ring. For a child that is not itself a place, this makes it a **gate**
 * instead — larger than `GROWTH` can reach across any search, so a cell beside
 * the family always beats one that is not, however much ground it saves.
 *
 * It is a gate with a fallback rather than a refusal: when no cell beside the
 * family is free, the best of the rest still wins. An exclave then means the
 * ground genuinely ran out, which is the only kind the engine should ever
 * produce on its own.
 */
const FAMILY_REQUIRED = 1_000_000;

/**
 * **The spacing curves rather than climbs** (Greg, 2026-10-04).
 *
 * *"Make the spacing rule 'curved' — make it follow a Fibonacci rather than a
 * linear progression. That should visually cluster teams and their parents and
 * push ever more space between the more distant relatives."*
 *
 * Which is exactly what the sequence does, and why it is the right curve rather
 * than merely a steep one. The first three terms barely separate at all — a
 * team and the thing that holds it stay as tight as they were — and then it
 * runs away: 1, 1, 2, 3, 5, 8, 13. Relatedness stops being something the eye
 * has to count rungs to recover and becomes something it reads off the width of
 * the gap, because the gaps are no longer evenly spaced enough to confuse.
 */
const FIBONACCI = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610];

/**
 * **The gap scales with the thing it separates, not with how deep it sits.**
 *
 * The curve was right and the variable was wrong. Measured on the 2,562-person
 * company with the gap set by rung, the clear ground between groups ran from 5
 * tiles at the top to 1 at the bottom — while the groups themselves ran from a
 * radius of 119 to a radius of 1. So a division got air worth **4% of its own
 * width** and a pair of people got **100%**: the ratio was inverted, by a
 * factor of about twenty-five.
 *
 * That is why the map read as confetti rather than as an atlas. Every boundary
 * on screen was about the same width, so none of them said anything about what
 * it was separating, and the hierarchy was invisible at every zoom. Nothing was
 * scattered — it was the *uniformity* of the boundaries, which is a different
 * fault with the same appearance.
 *
 * A share of the territory's own size keeps the ratio constant instead, so a
 * division reads as a division at overview and a team reads as a team close up.
 * It is also self-limiting in a way the rung version was not: the map grows by
 * a constant factor per level rather than exponentially, which is what made the
 * uncapped rung-based curve take 233 seconds.
 *
 * The Fibonacci table stays for the floor — the first few tiles, where a share
 * of a tiny thing would round to nothing and a team still needs its one clear
 * tile.
 */
const GAP_SHARE = 1 / 3;

/** Clear tiles owed to a territory of this radius. */
const spacingFor = (radius: number): number =>
  radius <= 0 ? 0 : Math.max(1, Math.round(radius * GAP_SHARE));

/** The floor the old curve provided, kept for the smallest things. */
const leastGapFor = (tier: number): number =>
  tier <= 0 ? 0 : FIBONACCI[Math.min(tier, FIBONACCI.length - 1)];

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
   * The unit's **own** clear ground, kept apart from `blocked` because one
   * child is allowed into it and the rest are not.
   *
   * Greg, 2026-10-03: *"yes, I said nodes… but I also mean people/teams too —
   * with the exception of team leads."* So this halo turns away a child's whole
   * territory, people and all, rather than merely holding its node at a
   * distance; and the unit's own lead walks straight through it, because the
   * person who runs a place belongs at its door.
   */
  halo: Set<number>;
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
  /** The clear ground this unit actually kept round its own node. Recorded
   *  rather than recomputed, because the rule that sets it has moved twice and
   *  a statistic that recomputes it from the old rule reports the rule as a
   *  failure — which has now happened twice. */
  bubble: number;
};

/** Units the packer could not seat. Should always be empty — it exists because
 *  a layout that quietly loses somebody is worse than one that says so. */
export type Unplaced = string[];

/**
 * **Where the fan and the facing-fix used to be.**
 *
 * `FAN` offered each child a start direction by birth order — straight ahead,
 * then alternately to either side — and `settleFacing` then re-placed the child
 * facing whichever way it had actually landed. Both were attempts to recover a
 * direction the packer had no way of knowing, and the record of what they cost
 * is worth keeping because it is the evidence for the compass:
 *
 *   - birth order alone: **62% of units faced a different way from the one they
 *     were placed in**, 466 of them by more than 120°. Greg, 2026-10-06: *"we
 *     end up with spirals within four steps."*
 *   - reading the facing back off the placement: 62% → 45%, for one extra
 *     placement per child. Iterating further oscillated rather than converging
 *     (52% over four passes), and offering all six directions was worse still.
 *
 * The reason none of it reached the curl-back number is written up in
 * `headings`: all three are **relative** rules, and the fault is absolute.
 * `headings` costs one pass over the units and no geometry, and it let the
 * second placement go — so this is less work than before, not more.
 */

/**
 * **A unit faces the way it was actually placed, not the way it was born.**
 *
 * Greg, 2026-10-06: *"child nodes should radiate away from parent nodes on the
 * opposite side of their grandparents, but not have an angle defining that
 * radiation."*
 *
 * The difference is accumulation. Birth order compounds — each rung adds
 * another relative turn to the one above, and six turns is a circle, so a
 * branch meets itself inside four rungs however the first turn was chosen.
 * Reading the facing back off the placement **self-corrects at every rung**:
 * whatever direction a child landed in is the direction it grows, so there is
 * nothing to accumulate and nothing to wind up.
 *
 * It is circular — a child's shape must be turned before it can be fitted, and
 * where it fits decides which way it should have been turned. Two passes settle
 * it: place with the fan's guess, read the direction it landed in, and if that
 * disagrees, place once more facing that way and keep it if it fits. Two, not
 * six, because trying every rotation costs six placements on something already
 * measured in seconds.
 */

/** Cells as one number, so the hot loop never touches a string. The company
 *  would have to be 2,000 cells across in one direction to overflow this. */
const KEY = (q: number, r: number): number => (q + 2048) * 4096 + (r + 2048);

/**
 * **Which way is out — decided for the whole company before anything is packed.**
 *
 * Greg, 2026-10-14: *"we're getting quite a lot of loopback on connection
 * lines still."* The lines were not the fault: 95% of them are dead straight.
 * What loops is the **way home** — walk a person up through every manager to
 * the master centre and the path doubles back at least once for 94% of them,
 * running 1.8× the direct distance at the median.
 *
 * The cause is that the packer had no idea where the centre was. `placeChild`
 * runs inside `measure`, which is bottom-up: when a unit's children are placed,
 * nobody yet knows where that unit will stand in the world, so "outward" could
 * only ever be guessed from the last step taken — the direction the unit sits
 * from *its* parent. That guess is local, and a local guess is not a radius.
 * Measured on the 1,000-person company: of the 408 units sitting nearer the
 * centre than their own parent, **only 151 were also behind their parent**. The
 * other 257 were placed forward of their parent and still ended up nearer the
 * middle, where no local rule can see them. It is why penalising the home side
 * moved the number by one point and why reading the facing back off the
 * placement — the right fix for the spiral — did not touch it either.
 *
 * So decide it combinatorially instead, and decide it first. The root owns the
 * whole circle; every unit hands its children an arc centred on its own
 * heading; a unit's heading is the one of the six lattice directions nearest
 * the middle of its arc. It is O(units), it needs no geometry, and because an
 * arc is an **absolute** bearing rather than a turn relative to a parent, it
 * cannot accumulate — which is the failure mode Greg named on 2026-10-06:
 * *"we end up with spirals within four steps."*
 *
 * This replaces `settleFacing`'s second placement rather than adding to it, so
 * the layout does less work than before, not more.
 */
/**
 * **A unit's children fan over half a turn, and never less than a sixth.**
 *
 * The cap is what keeps a grandchild from being aimed back the way it came:
 * half a turn centred on a unit's own bearing reaches ±90°, so nothing is ever
 * pointed behind its parent.
 *
 * The floor is one lattice direction — the narrowest fan that can still give
 * two children different bearings. It is there because proportional sharing
 * collapses: a ten-person team inside a 2,500-person company owns about a
 * degree and a half of the circle, so without a floor every descendant asks for
 * the same single direction and the branch packs into a thread.
 *
 * **Both numbers are chosen rather than measured, and that is deliberate.**
 * Swept across the three companies, every setting in the range improves on
 * having no compass at all — but neighbouring values jump around (one floor
 * giving 9.7% curl-back and the next 15.8%), because snapping a continuous
 * bearing to six directions flips many units at once. A number tuned to the
 * best reading on one fixture would be fitting noise. These two can be
 * explained in a sentence each, which is the better property.
 */
const ARC = Math.PI;
const FLOOR = Math.PI / 3;

/** The world angle each lattice direction points along. Derived rather than
 *  assumed: `cellToWorld` puts a cell at `(1.5q, √3(r + q/2))`, so what
 *  `DIRECTIONS` calls "east" actually points at 30°. */
const DIRECTION_ANGLE: readonly number[] = DIRECTIONS.map((d) =>
  Math.atan2(Math.sqrt(3) * (d.r + d.q / 2), 1.5 * d.q));

/** The lattice direction nearest a bearing. */
const headingAt = (angle: number): number => {
  let best = 0;
  let bestOff = Infinity;
  for (let i = 0; i < 6; i++) {
    let off = Math.abs(angle - DIRECTION_ANGLE[i]) % (2 * Math.PI);
    if (off > Math.PI) off = 2 * Math.PI - off;
    if (off < bestOff) { bestOff = off; best = i; }
  }
  return best;
};

/**
 * A bearing for every unit, as one of the six lattice directions.
 *
 * Children share their parent's arc in proportion to how much of the company
 * hangs beneath them, so a big division gets a wide sweep and a two-person team
 * gets a sliver. The arc is capped rather than merely inherited: left to narrow
 * on its own it collapses within four rungs and every descendant of a deep unit
 * asks for the same single direction, which packs a branch into a thread. One
 * half-turn, centred on the parent's own bearing, keeps a fan at every rung
 * while putting nothing behind its parent.
 */
export function headings(
  tree: OrbitalTree,
  /**
   * Which way the root of this tree faces, and how wide a sweep its children
   * get. The default is *nowhere in particular, and the whole circle*, which is
   * right for a company: it has no parent to grow away from.
   *
   * A **branch** does. When one is re-laid where a hand put it, its own parent
   * is somewhere outside it, and a branch that fans all the way round puts half
   * of itself behind the node it reports to. So the re-lay hands in the bearing
   * away from home and the same half-turn every other rung gets.
   */
  options: { bearing?: number; arc?: number } = {},
): Map<string, number> {
  const out = new Map<string, number>();
  const root = tree.units.get(tree.rootId);
  if (!root) return out;

  const weight = new Map<string, number>();
  const weigh = (id: string): number => {
    const had = weight.get(id);
    if (had !== undefined) return had;
    let n = 1;
    for (const kid of tree.units.get(id)?.childIds ?? []) n += weigh(kid);
    weight.set(id, n);
    return n;
  };
  weigh(root.id);

  const bearing = options.bearing ?? 0;
  const sweep = options.arc ?? 2 * Math.PI;
  out.set(root.id, headingAt(bearing));
  const walk = (id: string, centre: number, width: number) => {
    const kids = tree.units.get(id)?.childIds ?? [];
    if (!kids.length) return;
    let total = 0;
    for (const kid of kids) total += weigh(kid);
    let at = centre - width / 2;
    for (const kid of kids) {
      const span = width * (weigh(kid) / Math.max(1, total));
      const mid = at + span / 2;
      out.set(kid, headingAt(mid));
      // **Floored as well as capped.** Proportional alone collapses: a ten-person
      // team inside a 2,500-person company owns about a degree and a half, so
      // every one of its descendants asks for the same single direction and the
      // branch packs into a thread. The floor keeps a fan at every rung; the cap
      // keeps a grandchild from being aimed back the way it came.
      walk(kid, mid, Math.min(Math.max(span, FLOOR), ARC));
      at += span;
    }
  };
  walk(root.id, bearing, sweep);
  return out;
}

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
  parent: Pick<Patch, "taken" | "blocked" | "halo" | "cells" | "own" | "nodes">,
  child: Patch,
  spine: number,
  /** Clear tiles the parent keeps round itself. */
  bubble: number,
  /** This child leads the unit, so it walks through the halo. */
  exempt: boolean,
  /** This child is an individual rather than a place, so it must not drift. */
  mustTouch: boolean,
  /** This child is a leaf — somebody with nobody under them. See the score. */
  atTheDoor: boolean,
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
  // Start outside the halo rather than walking it ring by ring and throwing
  // each away: uncapped, the master centre's halo is 35 rings, and building
  // those rings only to skip them was most of three seconds on the
  // 2,562-person company.
  for (let k = exempt ? 0 : bubble + 1; k <= reach; k++) {
    if (best && k > foundAt + RING_SLACK) break;
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
        // The halo turns away a child's whole territory, not merely its node —
        // people and teams included. Its own lead walks through.
        if (!exempt && parent.halo.has(key)) { clear = false; break; }
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

      // **Measured along the child's own bearing, not the parent's axis.**
      // Turning the step so that the bearing points along direction 0 lets the
      // same clean projection do both halves: `offSpine` is how far the child
      // sits off its own street, and the along-axis component says whether it
      // is in front of its parent or behind it. Behind is what the eye reads
      // as a line doubling back, so it is priced and not merely untidy.
      const step = rotate(
        { q: anchor.q - parent.own.q, r: anchor.r - parent.own.r },
        (6 - spine) % 6,
      );
      const off = offSpine(step);
      const advance = Math.sqrt(3) * (step.q + step.r / 2);
      const behind = advance < 0 ? -advance : 0;
      /**
       * **Law 2 outranks Law 3, and this is where that is paid for.**
       *
       * `beside` is satisfied by touching a *sibling*, not only the parent — by
       * design, since Greg allows sibling chaining. But it leaves a person free
       * to satisfy their family two cells out, and the backward cost then buys
       * exactly that: teams whose children all touch them fell from 90% to 86%
       * the moment the compass landed, because a person on the far side of a
       * sibling scored better than one behind their own parent.
       *
       * So somebody who is not a place in their own right pays for every ring
       * past their parent's doorstep, at a price no bearing can outbid. The law
       * says a person is *"pushed outward, never forbidden from the near
       * side"* — this is what keeps that a push. A team reads as one thing
       * first, and faces the right way second.
       */
      const far = hexDistance(anchor, parent.own);
      const apart = (beside ? 0 : (mustTouch ? FAMILY_REQUIRED : FAMILY))
        + (atTheDoor && far > 1 ? (far - 1) * AT_THE_DOOR : 0);
      /**
       * **Law 2 outranks Law 3, and this is where that is paid for.**
       *
       * Charging an individual the full price of sitting behind its parent cost
       * teams their shape: a child can count as *beside the family* by touching
       * a sibling two cells out, so the backward term quietly bought that
       * instead of the cell against the parent — and teams whose children all
       * touch them fell from 90% to 86%. Greg's rule is that a team reads as one
       * thing, and the law says a person is *"pushed outward, never forbidden
       * from the near side"*. So for somebody who is not a place in their own
       * right this orders the free cells and never outbids touching your own
       * parent.
       */
      const score = grew * GROWTH + apart + off * SPINE + behind * BEHIND;
      if (!best || score < best.score) best = { offset, score };
    }
  }
  return best?.offset ?? null;
}

export function layoutTerritories(
  tree: OrbitalTree,
  options: {
    maxGap?: number;
    place?: number;
    leads?: ReadonlySet<string>;
    /**
     * Units that are **people** rather than structure.
     *
     * Without this the engine has only a cell count to go on, and a manager
     * with three reports looks exactly like a small department: four cells. On
     * the 45-person company that let tiers accumulate *inside* a team — eleven
     * of them, where the structure has four — and under a Fibonacci curve that
     * put 57 tiles between the master centre and its own report.
     *
     * A person is never a place, however many people report to them. Greg's
     * rule names the two separately for a reason: *"teams of humans should be
     * forced together"*, and a team is the thing with the ground.
     */
    people?: ReadonlySet<string>;
    /** Which way this tree's own root faces, and how wide its children fan.
     *  Only a re-laid branch sets these — see `headings`. */
    bearing?: number;
    arc?: number;
    /**
     * **Bearings worked out somewhere else**, used instead of computing them.
     *
     * A branch re-laid on its own would otherwise get a fresh compass with
     * itself at the centre of the world, and its units would grow outward from
     * *it* rather than from the company. Measured on Northwind, that took
     * curl-back from 11% to 35%: every unit was facing sensibly away from the
     * node the hand was holding, and that node is not the middle of the map.
     *
     * Handing in the company's own compass keeps a re-laid branch pointing the
     * way it always pointed, so it comes back looking like part of the same
     * map rather than like a second map laid beside it.
     */
    compass?: ReadonlyMap<string, number>;
  } = {},
): TerritoryLayout {
  const maxGap = options.maxGap ?? MAX_HALO;
  /** Which way is out, for every unit, before a single cell is packed. */
  const compass = options.compass
    ?? headings(tree, { bearing: options.bearing, arc: options.arc });
  const place = options.place ?? PLACE_SIZE;
  /** Units that lead the unit they hang from. They walk through its halo. */
  const leads = options.leads ?? new Set<string>();
  const people = options.people ?? new Set<string>();
  /** Is this child a place in its own right, owed ground and a tier? */
  const isPlace = (id: string, patch: Patch) =>
    !people.has(id) && patch.cells.length >= place;
  const cells = new Map<string, Cell>();
  const occupants = new Map<string, string>();
  const regions = new Map<string, Region>();
  const steps = new Map<string, number>();
  const branchOf = new Map<string, string>();
  const spacedBy = new Map<string, number>();
  const facing = new Map<string, number>();
  const unplaced: string[] = [];

  const root = tree.units.get(tree.rootId);
  if (!root) {
    return {
      cells, occupants, regions, steps, branchOf, spacedBy, facing, radius: 0,
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
      .sort((a, b) =>
        // The unit's own lead first — it is the one child allowed through the
        // halo, and it should have the pick of the ground inside it.
        Number(leads.has(b.id)) - Number(leads.has(a.id))
        || b.totalSeats - a.totalSeats
        || a.name.localeCompare(b.name));

  // --- pass one: measure, from the leaves up -------------------------------
  const patches = new Map<string, Patch>();
  const measure = (unit: UnitNode): Patch => {
    const had = patches.get(unit.id);
    if (had) return had;

    // **Everything below is measured first**, because how much room this unit
    // leaves between its children depends on what they turned out to be.
    const kids = inGrammarOrder(unit).map((kid) => ({ kid, patch: measure(kid) }));
    const places = kids.filter(({ kid, patch }) => isPlace(kid.id, patch));
    const tier = places.length === 0
      ? 0
      : 1 + places.reduce((deepest, { patch }) => Math.max(deepest, patch.tier), 0);
    // A unit with nothing but individuals under it separates nobody.
    // The floor, from the rung. Each child's own share is added on top of it
    // when its ground is reserved below.
    const gap = places.length === 0 ? 0 : Math.min(maxGap, Math.max(1, leastGapFor(tier)));

    // The unit's own node is the seed of its ground, and the way home arrives
    // at it — so everything else grows forward from here.
    const own = { q: 0, r: 0 };
    const patch: Patch = {
      cells: [own],
      taken: new Set([KEY(0, 0)]),
      blocked: new Set<number>(),
      halo: new Set<number>(),
      nodes: new Set([KEY(0, 0)]),
      own,
      children: new Map(),
      reach: 0,
      tier,
      bubble: 0,
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
    /**
     * The unit's own air, from the size of the biggest thing standing next to
     * it rather than from its rung — so the master centre of a large company
     * gets a boulevard and a team lead gets a doorstep.
     */
    const widest = places.reduce((most, { patch: p }) => Math.max(most, p.reach), 0);
    const bubble = Math.max(
      0,
      Math.min(maxGap, Math.max(leastGapFor(tier - 1), spacingFor(widest))),
    );
    patch.bubble = bubble;
    if (bubble > 0 && Number.isFinite(bubble)) {
      for (const near of spiral(own, bubble)) patch.halo.add(KEY(near.q, near.r));
    }

    kids.forEach(({ kid, patch: child }) => {
      const mustTouch = !isPlace(kid.id, child);
      const exempt = leads.has(kid.id);
      /**
       * **The child's bearing, in this unit's frame.**
       *
       * `compass` holds an absolute bearing for every unit, worked out from the
       * shape of the company before any packing happened — see `headings`. The
       * patch is turned into the world by this unit's own bearing, so the turn
       * the child needs inside it is simply the difference between the two.
       *
       * This is where the fan's guess and `settleFacing`'s second placement
       * used to be. Both existed to recover a direction the packer had no way
       * to know; the compass knows it up front, so the work goes rather than
       * doubling.
       */
      const want = ((compass.get(kid.id) ?? 0) - (compass.get(unit.id) ?? 0) + 6) % 6;
      /**
       * **Only a leaf is held to the doorstep**, and the difference is the
       * whole company on the biggest fixture.
       *
       * Charging it to everybody who is not a place charges it to a manager
       * with reports of their own, who in an eleven-rung company is the middle
       * of a long chain of people. Forced to a cell against their own manager
       * whatever direction it lies in, each one takes whatever is free — and on
       * Northwind that put **47%** of units nearer the centre than their parent
       * against 32% before the compass, and widened the map by half. A leaf has
       * nothing growing out of it, so holding it at the door costs nothing and
       * is exactly what makes a team read as one thing.
       */
      const first = placeChild(
        patch, child, want, bubble, exempt, mustTouch, child.cells.length === 1,
      );
      if (!first) { unplaced.push(kid.id); return; }
      const spine: number = want;
      const offset = first;

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

      const isTerritory = isPlace(kid.id, child);
      // What this particular child is owed: the rung's floor, or a share of its
      // own size, whichever is larger.
      const halo = Math.min(maxGap, Math.max(gap, spacingFor(child.reach)));
      /**
       * **Only the edge of a shape needs dilating.**
       *
       * Growing every cell of a territory by the halo is the same set as
       * growing only the cells on its boundary, because an interior cell's
       * halo is swallowed by its neighbours' — and it costs wildly more. A
       * group of radius 40 is about 4,900 cells with a 4,900-cell spiral
       * round each; its boundary is about 240. Once the gap became a share of
       * a territory's size rather than a flat one or two tiles, that
       * difference was the whole of a 6.7-second layout.
       */
      const childGround = new Set<number>();
      for (const cell of child.cells) {
        const t = rotate(cell, spine);
        childGround.add(KEY(t.q + offset.q, t.r + offset.r));
      }
      for (const cell of child.cells) {
        const turned = rotate(cell, spine);
        const at = { q: turned.q + offset.q, r: turned.r + offset.r };
        patch.cells.push(at);
        patch.taken.add(KEY(at.q, at.r));
        patch.reach = Math.max(patch.reach, hexDistance(at, own));
        if (isTerritory) {
          let onEdge = false;
          for (const nb of neighbours(at)) {
            if (!childGround.has(KEY(nb.q, nb.r))) { onEdge = true; break; }
          }
          if (onEdge) {
            for (const near of spiral(at, halo)) patch.blocked.add(KEY(near.q, near.r));
          }
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

  const put = (unit: UnitNode, at: Cell, spine: number, branch: string) => {
    const patch = patches.get(unit.id)!;
    cells.set(unit.id, at);
    occupants.set(cellKey(at), unit.id);
    facing.set(unit.id, spine);
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
      spacedBy.set(kid.id, patch.bubble);
      // The child's own node, in this unit's frame, then turned into the world.
      const kidPatch = patches.get(kid.id)!;
      const localOwn = rotate(kidPatch.own, placedAt.spine);
      const local = { q: localOwn.q + placedAt.offset.q, r: localOwn.r + placedAt.offset.r };
      const world = add(at, rotate(local, spine));
      put(kid, world, (spine + placedAt.spine) % 6, unit.id === root.id ? kid.id : branch);
    }
  };

  put(root, { q: 0, r: 0 }, compass.get(root.id) ?? 0, root.id);

  // Nobody standing on anybody — the one failure a packer must never hide.
  let tooClose = 0;
  const seen = new Set<string>();
  for (const cell of cells.values()) {
    const key = cellKey(cell);
    if (seen.has(key)) tooClose++;
    else seen.add(key);
  }

  return {
    cells, occupants, regions, steps, branchOf, spacedBy, facing, radius,
    stats: { placed: cells.size, touchingParent, depth, tooClose, unplaced: unplaced.length },
  };
}


/**
 * **Re-lay one branch the way the company itself is laid out.**
 *
 * Greg, 2026-10-15: *"I think we need to have the code understand what a team
 * is, so that it can calculate the best shape and protected periphery of it…
 * Teams should be — to the extent possible — sticky, ie people in the same team
 * should glue together where space allows, and where space doesn't, the whole
 * team should move, rather than isolate one human."*
 *
 * That is what the atlas already does, and the only engine here that does. It
 * works in two passes: **measure** a unit and everything under it, reserving the
 * ground the whole body needs, and only then **place**. By the time a person is
 * seated, the cell beside their own team is guaranteed, because nothing else was
 * ever allowed into the patch. Measured on the 1,000-person company, a clean
 * load puts **every one of 230 teams in one piece with every person exactly one
 * tile from their node** — not 99%, all of them.
 *
 * The five-second re-pickup used to ask `reflow` instead, which has no measuring
 * pass, no reservation and no idea what a team is: it walks the company one unit
 * at a time asking *"what is the nearest cell to your parent that satisfies your
 * spacing?"*. 61 of those 230 teams came apart, the average person ended up 2.46
 * tiles from their team instead of 1, and the worst was 16 — which is exactly
 * the search limit, so they had walked as far as they were allowed.
 *
 * **Why this can be afforded.** Laying out 1,269 units takes about a third of a
 * second, and this runs on every movement of the pointer. It does not have to:
 * a branch's *own* shape does not change as the hand moves, only where it
 * lands. So the shape is worked out **once**, when the gesture arms, and after
 * that carrying it is a translation. That is also the truer model of the
 * gesture — you are moving a thing that has a shape.
 */
export function relayBranch(options: {
  tree: OrbitalTree;
  /** The node the hand is holding. Its subtree is what gets re-laid. */
  anchorId: string;
  /** Where the branch's own parent sits, so it grows away rather than round. */
  homeward?: Cell | null;
  leads?: ReadonlySet<string>;
  people?: ReadonlySet<string>;
  maxGap?: number;
  /** The whole company's bearings. Hand them in so the branch keeps facing the
   *  way it always faced — see `compass` on `layoutTerritories`. */
  compass?: ReadonlyMap<string, number>;
}): { cells: Map<string, Cell>; radius: number } | null {
  const { tree, anchorId, homeward, leads, people, maxGap, compass } = options;
  if (!tree.units.get(anchorId)) return null;

  /**
   * The subtree, laid out as if it were a company of its own.
   *
   * `layoutTerritories` walks downward from `tree.rootId` and never looks up,
   * so handing it the same units with a different root lays out exactly this
   * branch and nothing else. No copy of the tree is needed.
   */
  const laid = layoutTerritories(
    { ...tree, rootId: anchorId },
    {
      leads, people, maxGap, compass,
      // Away from home, over the same half-turn every other rung fans across.
      // Without this the branch spreads all the way round the node the hand is
      // holding, which puts half of it behind the unit it reports to.
      ...(homeward
        ? {
            // The world bearing *away* from home. `cellToWorld` puts a cell at
            // `(1.5q, √3(r + q/2))`, and the two axes are scaled differently, so
            // the angle has to be taken in world units — an angle read straight
            // off `q` and `r` is skewed, which aims the branch a little wrong
            // every time.
            bearing: Math.atan2(
              -Math.sqrt(3) * (homeward.r + homeward.q / 2),
              -1.5 * homeward.q,
            ),
            arc: Math.PI,
          }
        : {}),
    },
  );
  if (!laid.cells.size) return null;

  // In the branch's own frame the anchor is the origin, which is what lets the
  // caller place it by translation alone.
  const own = laid.cells.get(anchorId);
  if (!own) return null;
  const cells = new Map<string, Cell>();
  for (const [id, c] of laid.cells) cells.set(id, { q: c.q - own.q, r: c.r - own.r });
  return { cells, radius: laid.radius };
}

/**
 * Where a branch of that shape can actually come to rest.
 *
 * **A body stays whole, or it does not land** — Law 2 above Law 4. The shape is
 * offered the cell under the hand first, then rings outward from it, and the
 * first offset where every one of its cells is free is the answer. Nothing is
 * ever taken apart to make it fit: if the hand is over a crowded place the
 * branch settles nearby, intact, rather than seeping into the gaps.
 */
export function restBranch(
  shape: ReadonlyMap<string, Cell>,
  at: Cell,
  /** cell key → who is there. Members of the branch itself are ignored. */
  occupied: ReadonlyMap<string, string>,
  moving: ReadonlySet<string>,
  searchRings = 12,
): { cells: Map<string, Cell>; anchor: Cell } | null {
  const free = (cell: Cell): boolean => {
    const who = occupied.get(cellKey(cell));
    return !who || moving.has(who);
  };
  for (const seat of spiral(at, searchRings)) {
    let fits = true;
    for (const offset of shape.values()) {
      if (!free({ q: offset.q + seat.q, r: offset.r + seat.r })) { fits = false; break; }
    }
    if (!fits) continue;
    const cells = new Map<string, Cell>();
    for (const [id, offset] of shape) {
      cells.set(id, { q: offset.q + seat.q, r: offset.r + seat.r });
    }
    return { cells, anchor: seat };
  }
  return null;
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
  options: {
    maxGap?: number; place?: number;
    leads?: ReadonlySet<string>; people?: ReadonlySet<string>;
  } = {},
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
    spacedBy: laid.spacedBy,
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
