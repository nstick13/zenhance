/**
 * Drag snapping — "snapping is relative to parent orbits, rather than an
 * absolute grid" (Greg, 2026-09-13).
 *
 * Dropping a node reads two things off where the pointer is, and nothing
 * else:
 *
 *   radius → which rung, so the backdrop rings classify as well as decorate;
 *            dragging inward promotes a node, dragging outward demotes it
 *   angle  → which parent, because a parent owns a sector of the circle and
 *            anything left inside that sector belongs to it
 *
 * Nothing here mutates: it answers "where would this land", so the renderer
 * can show the landing spot under the cursor before the drop commits.
 */
import {
  SEAT_GAP,
  SEAT_RADIUS,
  angleDelta,
  angleOf,
  angularStep,
  clampToSector,
  normalizeAngle,
  polar,
  radiusOf,
  seatRingRadius,
  unitRadius,
  type Point,
} from "./geometry";
import { bandAtRadius, unitOwningAngle, type OrbitalScene, type PlacedUnit } from "./layout";

export type UnitSnap = {
  kind: "unit";
  unitId: string;
  /** Unit it would hang from — may be the one it already hangs from. */
  parentId: string;
  depth: number;
  angle: number;
  position: Point;
  /** The drop would change this node's parent. */
  reparents: boolean;
  /** The drop would change this node's rung. */
  rerungs: boolean;
};

export type SeatSnap = {
  kind: "seat";
  seatId: string;
  unitId: string;
  angle: number;
  position: Point;
  moves: boolean;
};

/** Every unit at or below `rootId` — a node can't be dropped into its own
 *  subtree, which would detach that subtree from the map entirely. */
export function descendantIds(scene: OrbitalScene, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const unit = scene.unitById.get(id);
    if (!unit) continue;
    for (const childId of unit.childIds) {
      if (out.has(childId)) continue;
      out.add(childId);
      stack.push(childId);
    }
  }
  return out;
}

/** Nudge off a sibling that is already sitting at this angle, so a drop never
 *  buries one node under another. */
function nearestFreeAngle(taken: number[], angle: number, minSeparation: number): number {
  if (taken.length === 0) return angle;
  let candidate = angle;
  for (let pass = 0; pass < 24; pass++) {
    const clash = taken.find((t) => Math.abs(angleDelta(t, candidate)) < minSeparation);
    if (clash === undefined) return normalizeAngle(candidate);
    const push = angleDelta(clash, candidate);
    candidate = clash + (push >= 0 ? minSeparation : -minSeparation);
  }
  return normalizeAngle(candidate);
}

export function snapUnit(scene: OrbitalScene, unitId: string, pointer: Point): UnitSnap | null {
  const dragged = scene.unitById.get(unitId);
  if (!dragged || dragged.parentId === null) return null; // the centre doesn't move

  const pointerAngle = angleOf(pointer);
  const blocked = descendantIds(scene, unitId);

  // Rung comes from how far out the pointer is, floored at 1 — nothing can
  // displace the company at the centre.
  const wanted = bandAtRadius(scene, radiusOf(pointer));
  let depth = Math.min(Math.max(wanted, 1), Math.max(1, scene.maxDepth));

  let parent = pickParent(scene, depth, pointerAngle, blocked);
  // Every candidate on that rung is inside the dragged node's own subtree —
  // stay on the rung it came from rather than refusing the drag outright.
  if (!parent && depth !== dragged.depth) {
    depth = dragged.depth;
    parent = pickParent(scene, depth, pointerAngle, blocked);
  }
  if (!parent) return null;

  const band = scene.bands.find((b) => b.depth === depth)?.radius ?? radiusOf(pointer);
  const clamped = clampToSector(parent.sector, pointerAngle);
  const siblings = parent.childIds
    .filter((id) => id !== unitId)
    .map((id) => scene.unitById.get(id))
    .filter((u): u is PlacedUnit => !!u)
    .map((u) => u.angle);
  const separation = angularStep(unitRadius(depth), 8, Math.max(1, band));
  const angle = clampToSector(parent.sector, nearestFreeAngle(siblings, clamped, separation));

  return {
    kind: "unit",
    unitId,
    parentId: parent.id,
    depth,
    angle,
    position: polar(angle, band),
    reparents: parent.id !== dragged.parentId,
    rerungs: depth !== dragged.depth,
  };
}

function pickParent(
  scene: OrbitalScene,
  depth: number,
  angle: number,
  blocked: Set<string>,
): PlacedUnit | null {
  const owner = unitOwningAngle(scene, depth - 1, angle);
  if (owner && !blocked.has(owner.id)) return owner;
  // Fall back to the nearest allowed unit on the rung inside this one.
  let best: PlacedUnit | null = null;
  let bestDist = Infinity;
  for (const unit of scene.units) {
    if (unit.depth !== depth - 1 || blocked.has(unit.id)) continue;
    const d = Math.abs(angleDelta(unit.angle, angle));
    if (d < bestDist) {
      bestDist = d;
      best = unit;
    }
  }
  return best;
}

/** A person follows the unit their cursor is nearest, landing on that unit's
 *  seat ring at the angle they were dropped from. */
export function snapSeat(scene: OrbitalScene, seatId: string, pointer: Point): SeatSnap | null {
  const seat = scene.seatById.get(seatId);
  if (!seat) return null;

  let target: PlacedUnit | null = null;
  let bestDist = Infinity;
  for (const unit of scene.units) {
    const d = Math.hypot(pointer.x - unit.x, pointer.y - unit.y) - unit.r;
    if (d < bestDist) {
      bestDist = d;
      target = unit;
    }
  }
  if (!target) return null;

  const angle = normalizeAngle(Math.atan2(pointer.y - target.y, pointer.x - target.x));
  const ringR = seatRingRadius(target.r, 0);
  const taken = (scene.seatsByUnit.get(target.id) ?? [])
    .filter((s) => s.id !== seatId)
    .map((s) => s.angle);
  const separation = angularStep(SEAT_RADIUS, SEAT_GAP, ringR);
  const free = nearestFreeAngle(taken, angle, separation);
  const at = polar(free, ringR);

  return {
    kind: "seat",
    seatId,
    unitId: target.id,
    angle: free,
    position: { x: target.x + at.x, y: target.y + at.y },
    moves: target.id !== seat.unitId,
  };
}
