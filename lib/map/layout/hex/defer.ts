/**
 * **Deference — how much a moved node still answers to the master centre.**
 *
 * Greg, 2026-10-17: *"master-centre should be the only node that drives the
 * radial distance behaviour. Once a node is picked up and moved, it should not
 * become its own master-centre in the same way. But there should be a
 * relationship of sorts: the further away from master-centre the user moves it,
 * the less it observes the layout behaviour defined by master-centre… the closer
 * a user puts a node to master-centre, the more that node should observe the
 * spacing rule defined by master-centre."*
 *
 * Until this file, a picked-up branch was laid out as **a company of its own** —
 * `relayBranch` handed the radial driver the branch with the anchor as its root,
 * so the thing in your hand became a second master centre with its own arcs and
 * its own ring floors, and the finished shape was then translated under the
 * hand. Measured on Northwind, picking up Everest Region re-laid its three
 * business units overlapping each other by 152°, where the same branch laid in
 * the map's own frame overlaps by nought. That model is what this replaces.
 *
 * ## One dial
 *
 * **Deference** is where a node's rung belongs over where the hand put it:
 *
 * ```
 * δ = floors[depth] / distance(hand, master centre)      capped at 1
 * ```
 *
 * `floors` is Law 3's own schedule — the master centre's statement about how far
 * out each rung belongs — so this needs no new number and no tuning. Drop a node
 * at or inside its rung's floor and it defers completely; at twice its floor it
 * defers by half; take it far away and the master centre stops being relevant to
 * it, which is exactly what Greg asked for. It scales from a ten-person company
 * to a two-and-a-half-thousand-person one untouched, because both sides of the
 * ratio are in the same units.
 *
 * ## The taper
 *
 * Deference arrives **going down the branch**, not all at once:
 *
 * ```
 * t(k) = δ · min(1, k / taper)        k = rungs below the node in the hand
 * ```
 *
 * `t(0) = 0`, so the node you dragged is exactly where you let go: Law 0, and
 * the one thing here that is not negotiable. Below that the branch settles at
 * **δ**, reached over `taper` rungs. That is Greg's *"the most senior nodes
 * observe the 0th law of the hand, but each subsequent child node redraws in
 * deference to the master-centre layout rules… resembling a pointy tapering
 * triangle/wedge that would tend toward what it looked like on-load"* — the tip
 * is the hand, and the body widens back into the map.
 *
 * **It settles at δ rather than climbing to 1, and that distinction is the
 * whole of the third case.** The first version read `min(1, k · δ)`, so
 * deference accumulated with depth: however far a branch was dragged, anything
 * eight rungs down was fully back under the master centre, and a test asking
 * whether a branch dragged far out had become a chart found **2.5%** of it on
 * the far side of the hand. Greg's three cases vary with *distance*, not with
 * depth — *"the further the user drags that node away from master-centre, the
 * more orderly the child tree becomes"* — so distance sets the level and the
 * taper only sets how quickly that level is reached.
 *
 * ## The two things it blends between, both of them already the engine's
 *
 *  - **The master centre's picture** is the *calculated* layout, handed in. No
 *    recomputation and, more to the point, no second opinion: at full deference
 *    a descendant goes back to the cell master-centre gave it.
 *  - **The branch's own picture** is the same radial driver that drew the map,
 *    run on the branch alone with the node in your hand at its centre, turned to
 *    grow away from the master centre. `branchShape`, below.
 *
 * ### The far end was an org chart for a day, and that was wrong at scale
 *
 * Greg asked for *"a normal org chart"* far from the centre and it was built as
 * one: a tidy tree, square on the lattice, charting places and leaving people at
 * their team's door. It is legible and it is the wrong shape, because **a tidy
 * tree's width grows with its leaves while the map grows with the square root of
 * its units**, so the two scale apart:
 *
 * | branch | units | across, on the map | as a chart |
 * | --- | ---: | ---: | ---: |
 * | Granite Division | 2,811 | 217 | 1,933 × 11 |
 * | Orchid Business Unit | 707 | 157 | 483 × 9 |
 * | Iris Chapter | 266 | 115 | 177 × 8 |
 * | Ridge Domain | 113 | 93 | 75 × 5 |
 * | Beacon Cluster | 24 | 25 | 9 × 2 |
 *
 * Below about 150 units a chart is *narrower* than the branch already was, and
 * above it the chart runs away — nine times too wide by a division, which on
 * screen is a thin ribbon across the whole map. Greg, having looked: *"math and
 * reality collide to produce elongated less legible results… I think we need to
 * preserve the spacing around master-centre, but reinstate the way the leaf
 * clustering happened the further away it gets… a tendency toward a circular
 * arrangement rather than a linear one."*
 *
 * **So the far end is radial again — but it is not the behaviour that was
 * retired.** That one laid every picked-up branch as its own company *whatever
 * the distance*, and it did it through the relative-arc driver, which fanned a
 * branch's children right round it: Everest Region's three business units
 * overlapped one another by **152°**. Through today's driver the same branch
 * comes out as clean wedges — **0° overlap**, spans of 74°, 63° and 46° — and at
 * **101 rings for 1,258 units against the 93 it occupies on the map**, where the
 * chart wanted 863. The local arrangement was never the fault. Applying it
 * unconditionally was, and that is what the dial fixes.
 *
 * A unit's target is the two lerped by `t(k)` and rounded to a cell; it is then
 * seated at the nearest cell that is free and breaches nobody's spacer. Greg's
 * choice of 2026-10-17 for the case where a chart will not fit under the hand:
 * *keep the hand's cell and let the branch adapt*, rather than the whole body
 * settling aside intact as `restBranch` used to do.
 *
 * ## What it is not
 *
 * It holds **no spacing rule of its own** — `spacerRule`'s `apart`, as
 * everywhere else, which is Law 4 — and **no idea of its own about which way is
 * out**: the chart's orientation is the bearing from the master centre to the
 * hand, and the deference is a ratio of two radii from the master centre. There
 * is one centre on this map and it is the company's.
 */
import type { OrbitalTree, UnitNode } from "@/lib/map/layout/model";
import {
  DIRECTIONS,
  type Cell,
  cellFromKey,
  hexDistance,
  ring,
  rotateCell,
  roundCell,
  worldAngle,
} from "@/lib/map/layout/hex/coords";
import { RUNGS_PER_HEX, gapFor, spacerRule } from "@/lib/map/layout/hex/spacing";
import { relayBranch } from "@/lib/map/layout/hex/territory";

const ORIGIN: Cell = { q: 0, r: 0 };
const SIXTH = Math.PI / 3;

/** The occupancy map the other way round, which is how this file wants it. */
function* cellsOf(occupants: ReadonlyMap<string, string>): Generator<[string, Cell]> {
  for (const [key, id] of occupants) yield [id, cellFromKey(key)];
}

/**
 * **How many rungs the taper takes at full deference.**
 *
 * One: a node put back inside its own rung's floor hands its children straight
 * back to the master centre, and the wedge is as pointy as it can be. Larger
 * spreads the hand's influence further down the branch. It is a dial in the lab
 * rather than a constant to argue about, because the only way to settle how
 * abrupt it should look is to look at it.
 */
export const TAPER_RUNGS = 1;

/** How far to search for a cell when a unit's blended target is occupied. The
 *  branch adapts around what is there, so this is the width of that adapting;
 *  it is a guard rather than a design decision, like the driver's `BAND_REACH`. */
const SNAP_REACH = 24;

export type BranchShape = {
  /** unit id → where it sits relative to the node in the hand, laid about that
   *  node and growing along +x. Turned onto its real bearing by `deferBranch`. */
  offsets: Map<string, Cell>;
  /** How many rings the branch reaches from its own node. */
  radius: number;
};

/**
 * **The branch as a company of its own**, anchor at the origin, growing along
 * +x — which `deferBranch` then turns to face away from the master centre.
 *
 * It is the same radial driver that drew the map, which is the point: a branch
 * far from the centre arranges itself the way the company does, circular and
 * clustered, rather than in some second idea of a layout. `relayBranch` has done
 * exactly this since 2026-10-16 and it is unchanged — what changed is that it is
 * now **one end of a dial** rather than what happens to every picked-up branch.
 *
 * **Worked out once, when the gesture arms.** A branch's own shape does not
 * depend on where you drop it, only on which way it is turned, and turning a
 * lattice shape by sixths is exact. So the costly half (26ms for the largest
 * branch on Northwind) is computed once and carried, and the half that *does*
 * depend on the hand — the deference blend — is a lerp and a snap. Hand it in
 * through `afar` to get that; leave it out and it is computed on the spot.
 */
export function branchShape(args: {
  tree: OrbitalTree;
  anchorId: string;
  people?: ReadonlySet<string>;
  leads?: ReadonlySet<string>;
  maxGap?: number;
  sideways?: "allow" | "forbid";
}): BranchShape {
  const laid = relayBranch({
    tree: args.tree,
    anchorId: args.anchorId,
    // Pointing the branch along +x in its own frame: `relayBranch` grows a
    // branch *away* from home, and a home due west is a branch due east.
    homeward: { q: -2, r: 1 },
    leads: args.leads,
    people: args.people,
    maxGap: args.maxGap,
    driver: "radial",
    sideways: args.sideways ?? "forbid",
  });
  return { offsets: laid?.cells ?? new Map(), radius: laid?.radius ?? 0 };
}

export type DeferResult = {
  /** unit id → the cell it should stand on, in the map's own frame. */
  cells: Map<string, Cell>;
  /** How much this placement answered to the master centre: 1 is "as the master
   *  centre would have it", 0 is "laid about itself". On the panel. */
  deference: number;
  /** Whether the node is on the very cell the hand let go of. False only when
   *  somebody who is not moving was already standing there — Law 1. */
  held: boolean;
  /** The branch's own shape and which sixth of a turn it was put on. */
  afar: BranchShape & { turns: number };
};

/**
 * Lay the branch under `anchorId` with its anchor held at `hand`.
 *
 * Everything outside the branch stays exactly where it is; the branch is seated
 * around it. The result is absolute cells, so the caller commits or previews it
 * without doing any arithmetic of its own.
 */
export function deferBranch(args: {
  tree: OrbitalTree;
  anchorId: string;
  /** Where the hand is holding the anchor. Law 0: this cell is kept. */
  hand: Cell;
  /** The master centre's own answer — the *calculated* layout, before any hand
   *  placement was pasted over it. */
  calculated: ReadonlyMap<string, Cell>;
  /** cell key → who is standing there now. Members of the branch are ignored,
   *  because they are the thing being moved. */
  occupants: ReadonlyMap<string, string>;
  /** Law 3's floor schedule, from the layout that drew the map. */
  floors: readonly number[];
  /** unit id → rungs of places beneath it, from the same layout. */
  tier?: ReadonlyMap<string, number>;
  people?: ReadonlySet<string>;
  leads?: ReadonlySet<string>;
  taper?: number;
  rungs?: number;
  /** The branch's own shape, from `branchShape`, worked out once when the
   *  gesture armed. Computed here when it is not handed in. */
  afar?: BranchShape;
}): DeferResult {
  const { tree, anchorId, hand, calculated, occupants, floors } = args;
  const people = args.people ?? new Set<string>();
  const rungs = args.rungs ?? RUNGS_PER_HEX;
  const taper = Math.max(1, args.taper ?? TAPER_RUNGS);
  const anchor = tree.units.get(anchorId);
  const cells = new Map<string, Cell>();
  const afar = args.afar
    ?? branchShape({ tree, anchorId, people, leads: args.leads });
  if (!anchor) return { cells, deference: 1, held: false, afar: { ...afar, turns: 0 } };

  // --- the dial ------------------------------------------------------------

  /**
   * Where this node's rung belongs. The schedule is published by the driver
   * that drew the map; a map drawn by the atlas has none, and a branch on such
   * a map defers completely, which is the conservative reading — the atlas's
   * own re-lay is unchanged and does not come through here.
   */
  const belongs = floors.length
    ? floors[Math.min(anchor.depth, floors.length - 1)]
    : Infinity;
  const away = Math.max(1, hexDistance(hand, ORIGIN));
  const deference = Math.max(0, Math.min(1, belongs / away));

  // --- the chart, turned to face away from the master centre ---------------

  /**
   * **Away from the master centre, snapped to the chart's own axis.**
   *
   * Not `headingAt`: that snaps to the six directions a cell's *edges* face,
   * and the chart's rows run along `ACROSS`, which is 30° off those — the
   * corners rather than the edges. Rotating by a sixth of a turn is exact on
   * this lattice, so the chart turns onto real cells with no rounding and no
   * drift, however many times it is turned.
   */
  const turns = Math.round(worldAngle(ORIGIN, hand, 1) / SIXTH);
  const afarAt = (id: string): Cell | null => {
    const offset = afar.offsets.get(id);
    if (!offset) return null;
    const turned = rotateCell(offset, ORIGIN, turns);
    return { q: hand.q + turned.q, r: hand.r + turned.r };
  };

  // --- the spacer, which is the same rule it is everywhere -----------------

  const tierOf = (id: string): number => args.tier?.get(id) ?? 0;
  const { mayTouch, teamFor, groupFor, apart: apartOf } =
    spacerRule(tree, people, { tierOf, rungs });
  /** How many rings this unit keeps clear of strangers: its own by rung, and
   *  one more if it is a team, whose group keeps a ring of its own. */
  const keepOf = (id: string): number =>
    gapFor(tierOf(id), rungs) + (groupFor(id) !== null ? 1 : 0);

  /** Everything in the branch moves, so none of it counts as in the way. */
  const moving = new Set<string>();
  const collect = (unit: UnitNode) => {
    moving.add(unit.id);
    for (const id of unit.childIds) {
      const kid = tree.units.get(id);
      if (kid) collect(kid);
    }
  };
  collect(anchor);

  /**
   * **Who is standing where, once the branch has been lifted off the map** —
   * keyed by a number rather than by `"q,r"`.
   *
   * The seating loop asks *is this cell free* of every cell it walks past, and
   * the honest history of this line is that I guessed wrong about it first. The
   * largest branch took **56ms**; I assumed the string keys and changed them,
   * and it measured **59ms** — nothing. The cost was `spiral` building all 1,801
   * cells for every one of 1,258 placements (see `snap`), and fixing that took
   * it to **6.7ms**. The integer key is worth a further 1.1ms, measured against
   * `cellKey` on the same branch, so it stays — but it was not the fault, and a
   * comment claiming it was is worse than no comment. The public result is still
   * ordinary cells; this is local to the loop.
   */
  const at = (cell: Cell): number => (cell.q + 4096) * 8192 + (cell.r + 4096);
  const standing = new Map<number, string>();
  for (const [key, id] of occupants) {
    if (moving.has(id)) continue;
    const [q, r] = key.split(",").map(Number);
    standing.set(at({ q, r }), id);
  }
  /**
   * The wide clear rings of everybody who is **not** moving, stamped once.
   * Almost every unit is a person keeping one hexagon, which the candidate's own
   * neighbour check already covers; this is for the handful of senior nodes
   * whose ring reaches further than anybody else's.
   */
  const halo = new Map<number, string[]>();
  const stamp = (cell: Cell, id: string) => {
    const keep = gapFor(tierOf(id), rungs);
    for (let k = 2; k <= keep; k++) {
      for (const near of ring(cell, k)) {
        const key = at(near);
        const had = halo.get(key);
        if (had) had.push(id); else halo.set(key, [id]);
      }
    }
  };
  for (const [id, cell] of occupants.size ? cellsOf(occupants) : []) {
    if (!moving.has(id)) stamp(cell, id);
  }

  const barred = (cell: Cell, who: string): boolean => {
    // The six neighbours inline, because this is the question that gets asked
    // most and `ring` would allocate an array of cells to answer it.
    for (const d of DIRECTIONS) {
      const sitting = standing.get(at({ q: cell.q + d.q, r: cell.r + d.r }));
      if (sitting !== undefined && sitting !== who && !mayTouch(who, sitting)) return true;
    }
    const keep = keepOf(who);
    for (let k = 2; k <= keep; k++) {
      for (const near of ring(cell, k)) {
        const sitting = standing.get(at(near));
        if (sitting !== undefined && sitting !== who && k < apartOf(who, sitting)) return true;
      }
    }
    for (const id of halo.get(at(cell)) ?? []) {
      // Being inside somebody's clear ring at all is a breach when the two may
      // not touch: the ring is `gapFor(tier)` wide and `leastApart` is one more
      // than that, so every stamped cell is nearer than the pair is allowed.
      if (id !== who && apartOf(who, id) > 1) return true;
    }
    return false;
  };

  // --- placing --------------------------------------------------------------

  const take = (id: string, cell: Cell) => {
    cells.set(id, cell);
    standing.set(at(cell), id);
    stamp(cell, id);
  };

  /**
   * **How many people stand with each node**, so a team is never seated
   * somewhere its own crowd cannot follow.
   *
   * Law 2, and the same mechanism the radial driver needs for the same reason:
   * seating a node on the best cell for the *node* and discovering afterwards
   * that there is nowhere for its eleven people took the driver to 196 of 395
   * teams in one piece. Here it bit hardest in the **middle** of the dial —
   * every body aiming halfway between its chart place and its home one, so
   * bodies from opposite ends of the branch meet in the same ground — where
   * teams in one piece read **75%**.
   */
  const crowd = new Map<string, string[]>();
  for (const id of people) {
    if (!moving.has(id)) continue;
    const team = teamFor(id);
    if (!team) continue;
    const had = crowd.get(team);
    if (had) had.push(id); else crowd.set(team, [id]);
  }
  /** Is there connected, legal ground for this node's crowd beside this cell?
   *  Flooded rather than counted, because cells either side of a stranger are
   *  not somewhere a crowd can stand. */
  const roomFor = (cell: Cell, who: string): boolean => {
    const members = crowd.get(who);
    if (!members || !members.length) return true;
    const need = members.length;
    const any = members[0];
    const seen = new Set<number>([at(cell)]);
    const stack: Cell[] = [cell];
    let free = 0;
    while (stack.length) {
      const here = stack.pop()!;
      for (const d of DIRECTIONS) {
        const near = { q: here.q + d.q, r: here.r + d.r };
        const key = at(near);
        if (seen.has(key)) continue;
        seen.add(key);
        if (standing.has(key)) continue;
        if (barred(near, any)) continue;
        free++;
        if (free >= need) return true;
        stack.push(near);
      }
    }
    return false;
  };

  /**
   * **The nearest cell to a target that is free, breaches nobody's spacer, and
   * has room for whoever stands with this node**, walked ring by ring rather
   * than as a spiral.
   *
   * `spiral(target, 24)` builds all 1,801 cells before the first one is looked
   * at, and almost every unit wants the cell it was aiming at or one beside it:
   * on the largest branch that was **2.3 million cell objects allocated** for
   * 1,258 placements, and it was the whole of a 56ms re-lay. Ring by ring with
   * an early return allocates the six neighbours and stops.
   */
  const snap = (target: Cell, who: string): Cell => {
    let fallback: Cell | null = null;
    let legal: Cell | null = null;
    for (let k = 0; k <= SNAP_REACH; k++) {
      for (const cell of ring(target, k)) {
        if (standing.has(at(cell))) continue;
        fallback ??= cell;
        if (barred(cell, who)) continue;
        // A cell that is legal but has no room for the crowd is the second
        // best answer there is, and better than walking to the guard.
        legal ??= cell;
        if (roomFor(cell, who)) return cell;
      }
    }
    if (legal) return legal;
    // Law 1 has no exception clause: a free cell that breaches a spacer beats
    // no cell at all, and the breach is the ground genuinely running out.
    return fallback ?? target;
  };

  /**
   * **The blend.** A fractional cell is a real thing on this lattice —
   * `roundCell` is the same rounding the pointer uses to decide which cell it is
   * over — so the two targets can simply be mixed and landed.
   */
  const blend = (from: Cell, to: Cell, t: number): Cell =>
    roundCell(from.q + (to.q - from.q) * t, from.r + (to.r - from.r) * t);

  /**
   * **A team and its own people blend as one body**, which is the fix for the
   * first thing this got wrong.
   *
   * The taper was read off each unit's own depth, so a team five rungs below the
   * hand blended at 0.65 while its own people — a rung deeper — blended at 0.78,
   * and the crowd pulled off its node: teams in one piece fell to 222 of 395 at
   * the chart end. A person's place on this map is their team's doorstep (Law 3's
   * own clause), so the body that moves is the team **with** its crowd: the
   * weight is the team's, and a person keeps the offset from their team that the
   * master centre gave them. Both ends of the blend are then whole bodies — the
   * crowd rides into the chart in the shape it already had, and comes back to
   * the exact cells it came from.
   *
   * It is also why the node in your hand keeps its own people: its body is
   * itself, nought rungs below itself, so its weight is nought and its crowd
   * travels with it.
   */
  const bodyOf = (id: string): string => (people.has(id) ? teamFor(id) ?? anchorId : id);

  const targetFor = (unit: UnitNode): Cell => {
    const body = bodyOf(unit.id);
    const master = calculated.get(unit.id);
    const bodyMaster = calculated.get(body);
    /**
     * **A person aims at where their team actually landed**, not at where it was
     * aiming.
     *
     * The team is seated first and may have been moved a few cells to find legal
     * ground; its crowd was still aiming at the untouched target, so the node
     * walked and the crowd stayed behind. In the middle of the dial — every body
     * halfway between its chart place and its home one, which is where the
     * ground is most contested — that left teams in one piece at **75%**.
     * Taking the offset off the seated cell makes the crowd inherit its team's
     * blend *and* its team's displacement, which is what "one body" has to mean.
     */
    if (body !== unit.id) {
      const seated = cells.get(body);
      if (seated && master && bodyMaster) {
        return { q: seated.q + master.q - bodyMaster.q, r: seated.r + master.r - bodyMaster.r };
      }
    }
    const below = Math.max(0, (tree.units.get(body)?.depth ?? anchor.depth) - anchor.depth);
    const t = deference * Math.min(1, below / taper);
    const bodyAfar = afarAt(body) ?? hand;
    if (!master || !bodyMaster) return bodyAfar;
    return blend(
      { q: bodyAfar.q + master.q - bodyMaster.q, r: bodyAfar.r + master.r - bodyMaster.r },
      master,
      t,
    );
  };

  /**
   * Seated in the driver's own order: a unit, then its people, then its people's
   * people, then each place child's branch in full. Order is a placement rule
   * here as much as there — seating a whole rung before any of its crowds sent
   * 53% of people off their own parent's doorstep when the driver did it.
   */
  const inGrammarOrder = (unit: UnitNode): UnitNode[] =>
    unit.childIds
      .map((id) => tree.units.get(id))
      .filter((u): u is UnitNode => !!u)
      .sort((a, b) => b.totalSeats - a.totalSeats || a.name.localeCompare(b.name));

  const put = (unit: UnitNode) => {
    const kids = inGrammarOrder(unit);
    const crowd = kids.filter((kid) => people.has(kid.id));
    const structure = kids.filter((kid) => !people.has(kid.id));
    for (const kid of crowd) take(kid.id, snap(targetFor(kid), kid.id));
    for (const kid of crowd) put(kid);
    for (const kid of structure) {
      take(kid.id, snap(targetFor(kid), kid.id));
      put(kid);
    }
  };

  /**
   * **The hand's cell, and the one thing that may override it.**
   *
   * Law 0 is above Law 4, so a node the hand put down next to a stranger keeps
   * its cell and the breach is counted rather than corrected — the hand is
   * allowed to make a mess. Law **1** is above Law 0's own wording, and the law
   * says so itself: *"a hand placement only becomes a placement if it satisfied
   * Law 1 at the moment it was made."* So the single reason the hand's cell is
   * not honoured is that somebody who is not moving is already standing on it,
   * and then the nearest free cell is used and the caller is told.
   */
  const occupied = standing.has(at(hand));
  let landing = hand;
  for (let k = 1; occupied && k <= SNAP_REACH; k++) {
    const free = ring(hand, k).find((cell) => !standing.has(at(cell)));
    if (free) { landing = free; break; }
  }
  take(anchorId, landing);
  put(anchor);

  return {
    cells, deference, held: !occupied, afar: { ...afar, turns },
  };
}
