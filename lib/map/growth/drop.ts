/**
 * What it means when you let go (docs/ENGINES.md § Growth).
 *
 * This is the most consequential decision the map makes. The same gesture —
 * drag a node, release — can mean five different things, and telling them
 * apart is what stops the map either refusing to do anything useful or
 * quietly restructuring a company by accident.
 *
 * It lived in two places before this file existed: `onUnitDragEnd` for a node
 * dragged off the map, and the basket's drag-out handler for one carried back
 * onto it. The two had drifted — the basket's copy had no "snaps off" branch
 * and worded its failure differently — so the same release could mean
 * different things depending on where the node had come from. Neither copy
 * had a test.
 *
 * ## The order matters, and it is not arbitrary
 *
 * 1. **Over the tray** wins over everything. Someone holding a node above the
 *    basket has said where it is going.
 * 2. **An armed merge** next. "Armed" means held still against another node
 *    long enough to be deliberate — a node passing across another on its way
 *    somewhere is not a merge.
 * 3. **An armed reparent** next, for the same reason. A drop made in passing
 *    over a parent's orbit just lands; only a held one asks the question.
 * 4. **Snaps off** is free placement and means nothing structural.
 * 5. Otherwise the insertion plan decides, and no plan means it goes home.
 *
 * Both structural outcomes are **questions, not actions**. Nothing about the
 * company changes until a human answers the proposal — see AGENTS.md,
 * "nothing irreversible without a human's yes".
 */
import type { InsertionPlan } from "./insertion";
import { chargeAt, isArmed, type Relation } from "./relationship";

export type Point = { x: number; y: number };

/** The parts of a drag this decision reads. Structural, so the rule can be
 *  tested without a scene, a stage or a pointer. */
export type DropContext = {
  unitId: string;
  origin: Point;
  current: Point;
  /** The pointer is over the basket tray. */
  overTray: boolean;
  /** Body contact with another unit, and how long it has been held. */
  relation: Relation | null;
  /** A parent's orbit the node is sitting on, if any. */
  reparent: { parentId: string } | null;
  /** How long that orbit has been held. */
  reparentHold: Relation | null;
  /** Where the insertion pass says it would land. */
  plan: InsertionPlan | null;
};

export type DropOutcome =
  /** Into the basket. The node stays where it lives, marked as carried. */
  | { kind: "carry"; unitId: string }
  /** Ask whether to merge. Nothing changes yet. */
  | { kind: "merge"; fromId: string; intoId: string }
  /** Ask whether to change who it reports to. Nothing changes yet. */
  | { kind: "reparent"; fromId: string; parentId: string }
  /** Snaps off: move it by this much and save nothing. */
  | { kind: "free"; unitId: string; delta: Point }
  /** It lands. Commit exactly what the preview showed. */
  | { kind: "place"; unitId: string; plan: InsertionPlan }
  /** Nowhere to go. `offRing` is the one case worth explaining out loud. */
  | { kind: "return"; unitId: string; offRing: boolean };

/** Below this, a release is a click that wobbled, not a placement. */
export const FREE_MOVE_MIN = 1;

export type DropOptions = {
  now: number;
  /** Snapping on: the map arranges. Off ("Break orbits"): free placement. */
  snapping: boolean;
  /** A cancelled gesture never proposes anything and never lands. */
  cancelled?: boolean;
};

export function decideDrop(drag: DropContext, opts: DropOptions): DropOutcome {
  const { unitId } = drag;

  // A cancelled drag is not an answer to anything. It goes home, quietly —
  // no proposal, no notice, no placement.
  if (opts.cancelled) return { kind: "return", unitId, offRing: false };

  if (drag.overTray) return { kind: "carry", unitId };

  if (isArmed(chargeAt(drag.relation, opts.now)) && drag.relation) {
    return { kind: "merge", fromId: unitId, intoId: drag.relation.unitId };
  }

  if (drag.reparent && isArmed(chargeAt(drag.reparentHold, opts.now))) {
    return { kind: "reparent", fromId: unitId, parentId: drag.reparent.parentId };
  }

  if (!opts.snapping) {
    // ⚠️ Two routes reach here and they do not behave identically — this
    // preserves both rather than quietly picking one.
    //
    // A node dragged **out of the basket** arrives with a free *plan* from
    // the insertion pass, and commits through the planner, which ripples and
    // counts the placement. The same node dragged **on the map** arrives
    // with no plan, and its delta is applied raw with no ripple.
    //
    // The difference is an accident of the two paths having been written
    // separately, not a decision. Unifying it changes how Break orbits
    // *feels*, which is Greg's call, not a refactor's — see ENGINES.md
    // § Growth. Until then, both are faithful and both are tested.
    if (drag.plan?.kind === "free") return { kind: "place", unitId, plan: drag.plan };
    const delta = { x: drag.current.x - drag.origin.x, y: drag.current.y - drag.origin.y };
    return Math.hypot(delta.x, delta.y) > FREE_MOVE_MIN
      ? { kind: "free", unitId, delta }
      : { kind: "return", unitId, offRing: false };
  }

  if (drag.plan && drag.plan.kind !== "none") {
    return { kind: "place", unitId, plan: drag.plan };
  }

  // "Off-orbit" is the only refusal worth a sentence: the viewer aimed
  // somewhere reasonable and the rings said no, so the map should say why
  // and point at Break orbits.
  const offRing = drag.plan?.kind === "none" && drag.plan.reason === "off-orbit";
  return { kind: "return", unitId, offRing };
}

/**
 * Which units a drag may aim at.
 *
 * Three exclusions, each for its own reason:
 *
 * - **Waiting in the basket.** A carried branch is drawn as a placeholder; it
 *   is not somewhere you can drop something.
 * - **Too faint to touch.** At a distance the map thins itself out, and a
 *   mark you can barely see must not be a target you can hit — otherwise a
 *   drop lands on something the viewer never knew was there.
 * - **Part of the drag, or its own parent.** A node travels with its branch,
 *   and moving round your own parent is geography: it is the one node you are
 *   bound to pass close to, so it can never be a merge target.
 */
export function eligibleTargets<U extends { id: string }>(
  units: readonly U[],
  opts: {
    carried: ReadonlySet<string> | null | undefined;
    presenceOf: (unitId: string) => number;
    minPresence: number;
    moving: ReadonlySet<string>;
    parentId?: string | null;
  },
): U[] {
  return units.filter((u) =>
    !opts.carried?.has(u.id) &&
    !opts.moving.has(u.id) &&
    u.id !== opts.parentId &&
    opts.presenceOf(u.id) >= opts.minPresence);
}

/**
 * Is a reporting change even offerable at this zoom?
 *
 * Only when the camera has reached the scale where unit names read — you have
 * to be able to see what you are aiming at (Greg, 2026-09-24). The local
 * magnifier deliberately does not count: it lifts detail in one place, and
 * switching a reporting-change gesture on underneath it would be a trap.
 *
 * Zoomed further out, dragging is pure geography, and a reporting change is
 * still reachable by dropping one node onto another and choosing it.
 */
export const canReparentAt = (cameraScale: number, readableScale: number): boolean =>
  cameraScale >= readableScale;
