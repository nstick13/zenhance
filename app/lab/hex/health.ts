/**
 * **The health rings, on the hex map.**
 *
 * Greg, 2026-11-08: *"Note how we've made the nodes very rounded? That's
 * because now we can port the circular human health rings onto hex … Ideally
 * we want health rings for all nodes, human and non-human included."* Then,
 * after seeing one ring: *"there should be three concentric health rings, not
 * just the one … As with orbital, fake the data if you have to."*
 *
 * The *arithmetic* is not ported, because it already exists and is already
 * tested: `lib/map/signal/progress.ts` owns what wellbeing means, where the
 * risk thresholds sit, and how a branch's delivery and sprint figures are
 * rolled up. This file calls it. What is here is the three things the orbital
 * renderer could take for granted and this map cannot:
 *
 * 1. **Where the numbers come from.** `/lab/hex` has no database — its company
 *    comes out of `buildDeepOrg`, people are promoted to units, and there is
 *    no `lastVacationAt` to read and no assignment to total. The figures are
 *    therefore **invented**, per the house rule that demo mode uses invented
 *    data only, and invented the same two ways the orbital map's demo does:
 *    work comes from `lib/mock/personTasks`, the same generator, and wellbeing
 *    comes from seeded pressures run through the engine's own `wellbeing`. So
 *    the spread of green, amber and red is the spread real data would produce,
 *    and the day there is a real source the only things that change are
 *    `boardOf` and `scoreOf`.
 *
 * 2. **How a branch is rolled up in a people-as-units model.** `rings.ts` next
 *    door reads `seatsOf`; here a person *is* a node. See `signalRollup`.
 *
 * 3. **Where a ring sits on a lattice.** On the orbital map a unit is a small
 *    disc with a wide empty orbit around it, so rings simply step outward from
 *    it. Here a team *is* its cell and a place *overflows* it. See `ringBand`.
 *
 * Nothing here is React and nothing here touches the canvas, so the rule that
 * decides whether somebody shows as at risk can be argued with in a test.
 */
import type { MockTask } from "@/lib/mock/personTasks";
import {
  strainOf,
  unitProgress,
  wellbeing,
  type Strain,
  type UnitProgress,
} from "@/lib/map/signal/progress";

// --- the three rings -------------------------------------------------------

/**
 * **The ring stack, hugging the node first.**
 *
 * The same three figures the orbital map wears, and they mean exactly the same
 * things, because they are the same `UnitProgress`: how much of the work is
 * finished, how far the points have moved, and how the people are.
 *
 * **The order is the orbital map's, reversed.** There it is delivery, sprint,
 * health outward; here health hugs the node and the work rings sit beyond it.
 * Deliberate, and for two reasons. Health is a fact about the *node* while
 * delivery and sprint are facts about what the node is *carrying*, so the one
 * nearest the mark is the one about the mark. And health is the figure that
 * will survive the arrival of a real work integration unchanged, so it is the
 * one that should never have to move: whatever happens to the outer two, the
 * ring against the node stays where it is.
 *
 * This is also what makes Greg's *"reserve a health ring for task progress"*
 * (2026-11-08, earlier the same day) still true now that all three draw — the
 * reserved slot is `delivery`, and what changed is only that it is filled with
 * invented work rather than left blank.
 */
export const HEX_RING_SLOTS = ["health", "sprint", "delivery"] as const;
export type HexRingSlot = (typeof HEX_RING_SLOTS)[number];

export const HEX_RING_LABELS: Record<HexRingSlot, string> = {
  health: "health",
  sprint: "sprint progress",
  delivery: "delivery progress",
};

/** What a ring speaks for, in the words the panel uses when you point at it. */
export const HEX_RING_MEANS: Record<HexRingSlot, string> = {
  health: "how the people are",
  sprint: "how far the points have moved",
  delivery: "work items finished",
};

/**
 * **The verdict colours.** The *thresholds* stay in the signal engine —
 * `strainOf` is the one definition of where watch becomes risk, and this map
 * must not grow a second one. The hues are the hex page's own, because its
 * palette is not the orbital map's: amber and teal are already what this page
 * says "careful" and "fine" in.
 */
export const STRAIN_COLOUR: Record<Strain, string> = {
  ok: "#0d9488",
  watch: "#f59e0b",
  risk: "#e11d48",
};

/**
 * The two work rings keep the orbital map's own blue and violet. They are not
 * verdicts — there is no good or bad amount of sprint — so they are a fixed
 * hue, and one far enough from the teal/amber/rose of a verdict that the eye
 * does not try to read a judgement into them.
 */
export const WORK_RING_COLOUR: Record<Exclude<HexRingSlot, "health">, string> = {
  sprint: "#925cf2",
  delivery: "#5767e8",
};

export const healthColour = (value: number): string => STRAIN_COLOUR[strainOf(value)];

export const ringColour = (slot: HexRingSlot, value: number): string =>
  slot === "health" ? healthColour(value) : WORK_RING_COLOUR[slot];

// --- invented, and invented honestly ---------------------------------------

/** FNV-1a. Local and tiny on purpose: the point is that the same person gets
 *  the same figure every time the page is opened, so what Greg looked at
 *  yesterday is what he is looking at today. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — the same small deterministic PRNG `lib/mock/personTasks` uses. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Months without a break, and total commitment across every team: the two
 *  pressures `wellbeing` weighs, and both real columns on a seeded company.
 *  The ranges straddle the engine's grace period and its 100% ceiling, so a
 *  fixture company lands a realistic mix rather than all-green or all-red. */
const INVENTED_VACATION_MONTHS = 26;
const INVENTED_ALLOCATION: readonly [number, number] = [60, 145];

/**
 * **An invented wellbeing score for one invented person.**
 *
 * Deterministic from their id, and routed through the engine's own thresholds
 * rather than made up directly — so when `VACATION_GRACE_MONTHS` is argued
 * about and moved, this map moves with it.
 */
export function illustrativeWellbeing(personId: string): number {
  const rnd = mulberry32(hashOf(personId));
  const months = rnd() * INVENTED_VACATION_MONTHS;
  const allocation =
    INVENTED_ALLOCATION[0] + rnd() * (INVENTED_ALLOCATION[1] - INVENTED_ALLOCATION[0]);
  return wellbeing(months, allocation);
}

// --- whose numbers a node wears --------------------------------------------

/** What one node's rings say. The signal engine's own shape, so the three
 *  figures mean on this map exactly what they mean on the orbital one. */
export type NodeSignal = UnitProgress;

/** The running totals a branch carries up the tree. Private to the roll-up;
 *  `asSignal` turns them back into the engine's three ratios. */
type Totals = {
  people: number;
  done: number;
  total: number;
  pointsMoved: number;
  pointsTotal: number;
  healthSum: number;
  healthCount: number;
};

const empty = (): Totals => ({
  people: 0, done: 0, total: 0, pointsMoved: 0, pointsTotal: 0, healthSum: 0, healthCount: 0,
});

/** One person's contribution, by the engine's own counting rules — a finished
 *  item moves all of its points, one in flight moves half of them. */
function take(into: Totals, tasks: readonly MockTask[], health: number | null) {
  into.people += 1;
  for (const t of tasks) {
    into.total += 1;
    into.pointsTotal += t.points;
    if (t.status === "done") {
      into.done += 1;
      into.pointsMoved += t.points;
    } else if (t.status === "in_progress" || t.status === "review") {
      into.pointsMoved += t.points * 0.5;
    }
  }
  if (health !== null && Number.isFinite(health)) {
    into.healthSum += health;
    into.healthCount += 1;
  }
}

/**
 * The three ratios, derived exactly as `unitProgress` derives them — **null is
 * "no measurement", never a measured zero**, which is the rule that keeps a
 * node with nobody beneath it from wearing a red ring.
 *
 * This duplicates the engine's last four lines rather than calling it, because
 * the engine takes a list of members and a roll-up that built one list per
 * node would be quadratic — 1,108 people on the large fixture. A test asserts
 * the two agree on the same data, so the duplication is checked rather than
 * trusted.
 */
function asSignal(t: Totals): NodeSignal {
  return {
    delivery: t.total === 0 ? null : t.done / t.total,
    sprint: t.pointsTotal === 0 ? null : t.pointsMoved / t.pointsTotal,
    health: t.healthCount === 0 ? null : t.healthSum / t.healthCount,
    people: t.people,
    done: t.done,
    total: t.total,
  };
}

/**
 * **Whose numbers a node wears.**
 *
 * The orbital map's rule, unchanged in meaning: *"overall work item
 * completedness for an entire team"* (Greg, 2026-09-14) — a place speaks for
 * everybody beneath it, not just whoever sits directly on it. A lead's ring
 * that ignored their teams would be the most misleading number on the map.
 *
 * Two differences from `lib/map/signal/rings.ts`, both because of this map's
 * people-as-units model:
 *
 * - **People are nodes, not seats**, so the walk gathers person *units* rather
 *   than reading `seatsOf`.
 * - **A person's own rings are their own, and only theirs.** In this model a
 *   manager's reports hang off the manager, so rolling the branch into every
 *   node would make a team lead wear their team's average and hide whether
 *   *they* are the one going under. The team above them still rolls up, and
 *   the roll-up still passes *through* them, so nobody is dropped.
 *
 * Iterative and cycle-guarded. `relationship.ts` refuses a reparent that would
 * make a cycle, but a walk with no guard turns one bad row into a hung render
 * thread, and a hang is not a bug you can see in a screenshot.
 */
export function signalRollup(
  ids: readonly string[],
  childrenOf: (id: string) => readonly string[],
  isPerson: (id: string) => boolean,
  boardOf: (personId: string) => readonly MockTask[],
  scoreOf: (personId: string) => number | null,
): Map<string, NodeSignal> {
  const branch = new Map<string, Totals>();
  /** undefined = untouched · "open" = on the stack · "done" = folded. */
  const state = new Map<string, "open" | "done">();

  for (const root of ids) {
    if (state.has(root)) continue;
    const stack: string[] = [root];
    while (stack.length > 0) {
      const id = stack[stack.length - 1];
      const seen = state.get(id);
      if (seen === "done") { stack.pop(); continue; }
      if (seen === "open") {
        // Every child is folded (or is an ancestor, and contributes nothing).
        stack.pop();
        const mine = empty();
        if (isPerson(id)) take(mine, boardOf(id), scoreOf(id));
        for (const child of childrenOf(id)) {
          const below = branch.get(child);
          if (!below) continue;
          mine.people += below.people;
          mine.done += below.done;
          mine.total += below.total;
          mine.pointsMoved += below.pointsMoved;
          mine.pointsTotal += below.pointsTotal;
          mine.healthSum += below.healthSum;
          mine.healthCount += below.healthCount;
        }
        branch.set(id, mine);
        state.set(id, "done");
        continue;
      }
      state.set(id, "open");
      for (const child of childrenOf(id)) if (!state.has(child)) stack.push(child);
    }
  }

  const out = new Map<string, NodeSignal>();
  for (const id of branch.keys()) {
    if (isPerson(id)) {
      const own = empty();
      take(own, boardOf(id), scoreOf(id));
      out.set(id, asSignal(own));
      continue;
    }
    out.set(id, asSignal(branch.get(id)!));
  }
  return out;
}

// --- where a ring sits on a lattice ----------------------------------------

/**
 * **Where a ring sits: the orbital map's rule, brought over whole.**
 *
 * Greg, 2026-11-10: *"refer back to /org — the health rings and their mapping
 * to the zoom level, and how they appear to change size as we zoom in is the
 * model we're after … the health rings should also hug the relevant node more
 * tightly … and overall, make them 2x thicker."*
 *
 * **What was wrong.** Until today a structural node's stack was anchored at a
 * third of its *white tile*, which is a distance in **world** units. A world
 * distance grows on the glass as you zoom in, while the ring's weight was
 * pinned in screen pixels and capped — so the master centre's gauges became a
 * circle a third of a cell wide drawn with an eight-pixel line, and the
 * further in you went the thinner they read. Greg: *"there's a point where
 * the radius about the central node becomes fixed and then the rings
 * themselves become very skinny."*
 *
 * **What `/org` does instead** (`ringGeometry` in `components/viz/orbital/render.ts`)
 * is to make *everything but the node's own radius* a screen-pixel quantity:
 *
 * ```
 * widthPx = clamp(nodeRadiusOnScreen × share, min, max)
 * gapPx   = max(gapFloor, widthPx × ratio)
 * radius  = nodeRadius + (inset + widthPx / 2 + slot × (widthPx + gapPx)) / scale
 * ```
 *
 * So the stack *hugs the node* and keeps hugging it at every zoom: the ring
 * and the gap are the same number of pixels whatever the camera is doing, the
 * weight follows how big the node reads, and nothing can drift away from what
 * it is a gauge for. That is the whole of the model, and it is now this map's
 * too — against the **mark**, the coloured dot, because that is the node.
 *
 * The numbers are `/org`'s with the two Greg asked for changed:
 *
 * - **Twice the weight.** `/org` runs 4.5–7.5 screen pixels at `0.13` of the
 *   node; this map ran 2.2–8. Both doubled here, and the gap follows by the
 *   same ratio wherever the ratio is binding, which is Greg's *"adjust spacing
 *   accordingly"*.
 * - **One empty slot of stand-off.** *"Let's have the offset equal to one
 *   ring-width plus whatever spacing exists between the rings already (as if
 *   there is a missing ring)."* So `RING_INSET` is a whole slot rather than
 *   `/org`'s smaller `max(3.5, width × 0.7)`: the innermost ring sits where a
 *   second ring would sit if one were drawn against the node's edge.
 */

/** A ring's weight, as a share of how big the node reads on the glass. */
export const RING_WIDTH_SHARE = 0.26;
/** Ring weight on the glass. A pixel range, not a share of the node, so a
 *  gauge reads at a weight the eye can judge at every zoom. */
export const RING_WIDTH_MIN_PX = 4.4;
export const RING_WIDTH_MAX_PX = 16;
/** The air between two rings, as a share of a ring, and its floor. */
export const RING_GAP_RATIO = 0.46;
export const RING_GAP_MIN_PX = 2.4;

/**
 * **How far from a person's own stack the next person's may not come.**
 *
 * The one guard left, and it is the crowd batch's: `paintCrowdRings` merges a
 * thousand people's rings into nine strokes, which is only safe while no two
 * stacks overlap. Two neighbouring cells are `√3 · size` apart centre to
 * centre, so half of that — `0.866 · size` — is all the room a person has.
 * Their tile is `PERSON_TILE` (0.8) of the cell less the active gap, so that
 * room is a little over `1.08` of the host handed in here; 1.05 keeps a
 * margin for the gap this does not measure.
 *
 * **Structural nodes have no such guard**, and deliberately. A place's tile
 * already overflows its cell by half a radius and the master centre's by
 * three, they are drawn largest-first with the people over them, and at the
 * outermost zoom the company's dial *should* be the biggest thing on the
 * glass — it is the only reading left there. A ceiling measured off the tile
 * is what used to drop the master's outermost ring at that zoom.
 */
export const PERSON_RING_ROOM = 1.05;

/** How far from a ring's centreline still counts as pointing at it. Generous
 *  on purpose: a 2px arc is not a 2px target, and touch is a first-class input
 *  here. */
export const RING_HIT_SLOP_PX = 5;

export type RingBand = { radius: number; width: number };

/**
 * **Where ring `slot` sits, in world units.** See above for the rule and
 * whose it is.
 *
 * Returns null when a person's stack would reach into the next cell — the
 * only case that is refused, because a person's gauges are drawn as one
 * batch with everybody else's and two stacks crossing would make nonsense of
 * both. A ring that does not fit is not drawn thin, it is not drawn.
 */
export function ringBand(
  /** The node's own drawn radius — the coloured dot — in world units. */
  mark: number,
  /** The radius of the white tile the node stands on, in world units. Used
   *  only to measure the room a person has before the next cell. */
  host: number,
  /** True for a human node, which is the one kind that has a neighbour close
   *  enough to collide with. */
  person: boolean,
  /** 0 is the innermost ring; each step is one ring further out. */
  slot: number,
  /** The camera scale, so weights and spacing can be held in screen pixels. */
  scale: number,
): RingBand | null {
  const live = Math.max(scale, 1e-6);
  if (!(mark > 0) || !(host > 0) || slot < 0) return null;

  const widthPx = Math.min(
    RING_WIDTH_MAX_PX,
    Math.max(RING_WIDTH_MIN_PX, mark * live * RING_WIDTH_SHARE),
  );
  const gapPx = Math.max(RING_GAP_MIN_PX, widthPx * RING_GAP_RATIO);
  const stepPx = widthPx + gapPx;

  // One empty slot of stand-off, then the stack: Greg's "as if there is a
  // missing ring".
  const radius = mark + (stepPx + widthPx / 2 + slot * stepPx) / live;
  const width = widthPx / live;
  if (person && radius + width / 2 > host * PERSON_RING_ROOM) return null;
  return { radius, width };
}

export function ringAtDistance(
  mark: number,
  host: number,
  person: boolean,
  scale: number,
  /** Distance from the node's centre to the pointer, in world units. */
  distance: number,
): number | null {
  const live = Math.max(scale, 1e-6);
  const slop = RING_HIT_SLOP_PX / live;
  let best: number | null = null;
  let bestOff = Infinity;
  for (let slot = 0; slot < HEX_RING_SLOTS.length; slot++) {
    const band = ringBand(mark, host, person, slot, scale);
    if (!band) continue;
    const off = Math.abs(distance - band.radius);
    if (off <= band.width / 2 + slop && off < bestOff) { bestOff = off; best = slot; }
  }
  return best;
}

/** How far out the whole stack reaches, so a hit test can skip a node the hand
 *  is nowhere near without measuring each of its rings. */
export function ringReach(mark: number, host: number, person: boolean, scale: number): number {
  for (let slot = HEX_RING_SLOTS.length - 1; slot >= 0; slot--) {
    const band = ringBand(mark, host, person, slot, scale);
    if (band) return band.radius + band.width / 2 + RING_HIT_SLOP_PX / Math.max(scale, 1e-6);
  }
  return 0;
}

export { unitProgress };
