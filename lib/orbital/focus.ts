import { layoutOrbital, type LayoutOptions, type Link, type OrbitalScene, type PlacedSeat, type PlacedUnit } from "./layout";
import type { OrbitalTree, Seat, UnitNode } from "./model";

export type FocusedOrbital = {
  /** Full scene projected around the local centre. Kept full so existing
   * spring states survive focus and unfocus instead of popping in and out. */
  scene: OrbitalScene;
  /** Branch-only scene used for snapping and hit decisions while focused. */
  interactionScene: OrbitalScene;
  branchIds: ReadonlySet<string>;
  breadcrumb: UnitNode[];
};

export function pathToUnit(tree: OrbitalTree, unitId: string): UnitNode[] {
  const path: UnitNode[] = [];
  const seen = new Set<string>();
  let unit = tree.units.get(unitId);
  while (unit && !seen.has(unit.id)) {
    path.unshift(unit);
    seen.add(unit.id);
    unit = unit.parentId ? tree.units.get(unit.parentId) : undefined;
  }
  return path;
}

/** A focused unit temporarily behaves as the company without changing the
 * company. IDs, seats and real child relationships remain intact; only depth
 * and the focused root's local parent are rebased for layout. */
export function treeForFocus(tree: OrbitalTree, focusId: string): OrbitalTree | null {
  const focus = tree.units.get(focusId);
  if (!focus) return null;

  const branchIds = new Set<string>();
  const stack = [focusId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (branchIds.has(id)) continue;
    const unit = tree.units.get(id);
    if (!unit) continue;
    branchIds.add(id);
    stack.push(...unit.childIds);
  }

  const units = new Map<string, UnitNode>();
  const seats = new Map<string, Seat>();
  let maxDepth = 0;
  for (const id of branchIds) {
    const unit = tree.units.get(id)!;
    const depth = unit.depth - focus.depth;
    maxDepth = Math.max(maxDepth, depth);
    const childIds = unit.childIds.filter((childId) => branchIds.has(childId));
    const seatIds = unit.seatIds.filter((seatId) => tree.seats.has(seatId));
    units.set(id, {
      ...unit,
      parentId: id === focusId ? null : unit.parentId,
      depth,
      childIds,
      seatIds,
    });
    for (const seatId of seatIds) {
      const seat = tree.seats.get(seatId);
      if (seat) seats.set(seatId, { ...seat });
    }
  }

  return { rootId: focusId, units, seats, maxDepth };
}

const remapLink = (
  link: Link,
  unitById: Map<string, PlacedUnit>,
  seatById: Map<string, PlacedSeat>,
): Link | null => {
  const from = unitById.get(link.sourceId);
  const target = link.kind === "unit" ? unitById.get(link.targetId) : seatById.get(link.targetId);
  if (!from || !target) return null;
  return { ...link, from: { x: from.x, y: from.y }, to: { x: target.x, y: target.y } };
};

/** Project a local layout without deleting the rest of the company from the
 * motion graph. The selected branch adopts local coordinates; everything
 * else moves away relative to the selected unit. This lets springs carry the
 * same nodes between states and leaves a real parent connection running out
 * of the focal zone. */
export function focusOrbital(
  tree: OrbitalTree,
  master: OrbitalScene,
  focusId: string,
  options: LayoutOptions = {},
): FocusedOrbital | null {
  const focusedTree = treeForFocus(tree, focusId);
  const masterFocus = master.unitById.get(focusId);
  const sourceFocus = tree.units.get(focusId);
  if (!focusedTree || !masterFocus || !sourceFocus) return null;

  // Local branch geography already draws every branch round its own root, so
  // focus re-lays nothing: the geography users have learnt stays exactly where
  // it is, and focus is the camera plus emphasis on the branch.
  if (master.geography === "local") {
    return {
      scene: master,
      interactionScene: master,
      branchIds: new Set(focusedTree.units.keys()),
      breadcrumb: pathToUnit(tree, focusId),
    };
  }

  const local = layoutOrbital(focusedTree, options);
  const branchIds = new Set(focusedTree.units.keys());
  const pushed = (point: { x: number; y: number }) => ({
    x: (point.x - masterFocus.x) * 1.12,
    y: (point.y - masterFocus.y) * 1.12,
  });

  const units = master.units.map((unit): PlacedUnit => {
    const localUnit = local.unitById.get(unit.id);
    if (localUnit) {
      return unit.id === focusId ? { ...localUnit, parentId: sourceFocus.parentId } : localUnit;
    }
    return { ...unit, ...pushed(unit) };
  });
  const seats = master.seats.map((seat): PlacedSeat => {
    const localSeat = local.seatById.get(seat.id);
    return localSeat ?? { ...seat, ...pushed(seat), work: seat.work.map(pushed) };
  });
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const seatsByUnit = new Map<string, PlacedSeat[]>();
  for (const seat of seats) seatsByUnit.set(seat.unitId, [...(seatsByUnit.get(seat.unitId) ?? []), seat]);

  const localLinks = local.links
    .map((link) => remapLink(link, unitById, seatById))
    .filter((link): link is Link => !!link);
  const contextLinks = master.links
    .filter((link) => {
      if (link.kind === "seat") return !branchIds.has(link.sourceId);
      const sourceIn = branchIds.has(link.sourceId);
      const targetIn = branchIds.has(link.targetId);
      return (!sourceIn && !targetIn) || link.targetId === focusId;
    })
    .map((link) => remapLink(link, unitById, seatById))
    .filter((link): link is Link => !!link);

  return {
    scene: {
      ...local,
      units,
      seats,
      links: [...contextLinks, ...localLinks],
      unitById,
      seatById,
      seatsByUnit,
    },
    interactionScene: local,
    branchIds,
    breadcrumb: pathToUnit(tree, focusId),
  };
}
