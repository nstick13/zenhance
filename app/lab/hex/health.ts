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
 * **A circle inside a hexagon.** A regular hexagon's inscribed circle is
 * `√3/2` of its circumradius — it touches the middle of every edge. Every
 * *active* hexagon on this map is already rounded by `NODE_CORNER`, which cuts
 * the corners the circle was never going to reach, which is exactly why Greg's
 * *"now we can port the circular health rings"* holds: at that rounding a
 * circle just inside the shape no longer looks like a circle that missed.
 */
export const INSCRIBED = Math.sqrt(3) / 2;

/** Ring weight on the glass. A pixel range, not a share of the node, so one
 *  ring reads the same on a person and on a company — the same reason every
 *  connection line on this map has a pixel floor. */
export const RING_WIDTH_MIN_PX = 2.2;
export const RING_WIDTH_MAX_PX = 8;
/** How far the innermost ring stands off a person's mark, on the glass. */
export const RING_CLEAR_PX = 3;

/**
 * **A person's rings sit fifteen per cent further out than the mark alone
 * would put them** — Greg, 2026-11-08: *"the sizing on the human health rings
 * can be a bit bigger — make the radius +15%."* A person's mark is a small
 * circle in a tile that is five times its radius, so the air is there to
 * spend, and the stack reads as a gauge around somebody rather than as a
 * thick edge on them.
 */
export const PERSON_RING_SPREAD = 1.15;

/**
 * **A structural node's rings sit at a third of its own radius** — Greg,
 * 2026-11-08: *"the sizing on the non-human nodes seems to be driven by the
 * radius of the entire area it occupies. Let's make the health ring on the
 * non-human nodes radius as 33% the node radius."*
 *
 * He is describing the rule this replaces. Until now a structural node's rings
 * were read *inward* from its inscribed circle, which made them a rim: on a
 * team that is the edge of its cell, and on the master centre a circle nearly
 * three cells wide thrown across everything standing on it. A third of the
 * radius puts the stack near the middle of the node instead, where it reads as
 * a gauge belonging to that node — and it makes the rule the same shape as the
 * person rule, since both now anchor somewhere and step outward.
 */
export const NODE_RING_SHARE = 1 / 3;

/** How far from a ring's centreline still counts as pointing at it. Generous
 *  on purpose: a 2px arc is not a 2px target, and touch is a first-class input
 *  here. */
export const RING_HIT_SLOP_PX = 5;

export type RingBand = { radius: number; width: number };

/**
 * **Where ring `slot` sits, in world units.**
 *
 * One rule — *every ring steps outward from an anchor, and what the node is
 * decides the anchor*:
 *
 * - A **person** anchors just outside their own mark, plus `PERSON_RING_SPREAD`.
 *   They fill about a fifth of their host tile, so the room is there, and the
 *   rest of the white glass stays free — which is where work will want to go.
 * - **Everything else** anchors at `NODE_RING_SHARE` of its own radius. A team
 *   *is* its cell and a place overflows it, so there is no room outside; a
 *   third of the way out is inside every one of them by construction, whatever
 *   size rule they are drawn by.
 *
 * Returns null when the stack cannot be paid for — a ring that would reach
 * past the shape holding it. A ring that does not fit is not drawn thin, it is
 * not drawn.
 */
export function ringBand(
  /** The node's own drawn radius, in world units. */
  mark: number,
  /**
   * The radius of the ground the node stands in, in world units: a person's
   * host tile, and otherwise the node's own cell less the clear gap every
   * active hexagon keeps. It is what weights the ring, so that every ring on
   * the lattice reads at the same weight at a given zoom whatever it is drawn
   * around.
   */
  host: number,
  /** True for a human node, which anchors outside its mark rather than inside. */
  person: boolean,
  /** 0 is the innermost ring; each step is one ring further out. */
  slot: number,
  /** The camera scale, so weights can be held in screen pixels. */
  scale: number,
): RingBand | null {
  const live = Math.max(scale, 1e-6);
  if (!(mark > 0) || !(host > 0) || slot < 0) return null;
  // Weighted by the ground, not by the mark: every cell on a lattice is the
  // same size, so this is the one input that makes a person's gauge and a
  // division's read as the same instrument.
  const widthPx = Math.min(
    RING_WIDTH_MAX_PX,
    Math.max(RING_WIDTH_MIN_PX, host * live * 0.05),
  );
  const gapPx = Math.max(1.6, widthPx * 0.5);
  const width = widthPx / live;

  const anchor = person
    ? (mark + (RING_CLEAR_PX + widthPx / 2) / live) * PERSON_RING_SPREAD
    : mark * NODE_RING_SHARE;
  const radius = anchor + (slot * (widthPx + gapPx)) / live;

  // A person's stack lives in the tile; everything else's lives on its face.
  const ceiling = (person ? host : mark) * INSCRIBED;
  if (radius + width / 2 > ceiling) return null;
  if (radius - width / 2 <= 0) return null;
  return { radius, width };
}

/**
 * **Which ring the hand is on**, given how far the pointer is from the node's
 * centre. The hit test and the painter read the same `ringBand`, deliberately:
 * what you can point at is exactly what you can see, which is the one number
 * both sides have to agree on (the orbital map's own rule, `hitTest` there).
 *
 * Returns the slot index, or null when the hand is between rings or past them.
 */
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
