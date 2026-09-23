import type { Link, OrbitalScene, PlacedSeat, PlacedUnit } from "./layout";
import { polar, type Point } from "./geometry";

export type PositionOffsets = ReadonlyMap<string, Point>;

/**
 * What a saved angle means (Greg, 2026-09-21: saved geography must carry into
 * the new drawing, never be silently dropped).
 *
 * `orbital_nodes.angle` holds one number per unit. On the ring map it is the
 * unit's direction from the centre of the map, on its own rung. In local
 * branch geography a unit lives on an orbit round its own parent, so the same
 * number is read as the unit's direction *from its parent*, at its own orbit
 * distance. On the ring map a child sits outboard of its parent, roughly along
 * the same line from the centre: measured on the demo and 2,562-person shapes
 * the two directions differ by a median of 7–14°, rarely past 30° and never
 * near a right angle. So an arrangement saved on rings lands each unit on the
 * same side of its parent when a company moves to local geography — not
 * exactly where it was, which the two drawings could not allow anyway. For a
 * company's own children, whose parent is the centre, the readings are
 * identical. A drop in local geography saves the direction from the parent,
 * so it reloads exactly.
 */
export function savedAnglePoint(parent: Point, orbit: number, angle: number): Point {
  return { x: parent.x + orbit * Math.cos(angle), y: parent.y + orbit * Math.sin(angle) };
}

/**
 * A placement the user made: a direction, and — in local geography — how far
 * out they let go (Greg, 2026-09-23: "a node lands exactly where the hand let
 * go", and comes back there).
 *
 * `distance` is absent for a placement made before the column existed, and on
 * the ring map, where the radius is the reporting level rather than anybody's
 * choice. Absent means "wherever the calculated layout puts it", which is the
 * behaviour every saved arrangement had until now — so old rows keep meaning
 * exactly what they used to mean.
 */
export type Placement = { angle: number; distance?: number | null };

/** Reconstruct saved same-rung placements as branch offsets, not as input to
 * the packer. Re-packing around one changed angle moves unrelated siblings
 * and often their whole subtrees. An offset keeps the calculated map stable;
 * only the chosen branch moves. The angle remains the persisted compact form.
 */
export function anglePlacementOffsets(
  scene: OrbitalScene,
  angles: ReadonlyMap<string, number | Placement>,
): Map<string, Point> {
  const own = new Map<string, Point>();
  const cumulative = new Map<string, Point>();
  const roots = new Map(scene.families?.map((family) => [family.rootId, family.centre]) ?? []);
  const centreOf = (unit: PlacedUnit): Point => {
    let root = unit;
    while (root.parentId && scene.unitById.has(root.parentId)) root = scene.unitById.get(root.parentId)!;
    return roots.get(root.id) ?? { x: 0, y: 0 };
  };
  for (const unit of [...scene.units].sort((a, b) => a.depth - b.depth)) {
    const inherited = unit.parentId ? cumulative.get(unit.parentId) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const saved = angles.get(unit.id);
    const placement: Placement | undefined = typeof saved === "number" ? { angle: saved } : saved;
    const angle = placement?.angle;
    if (angle === undefined || !Number.isFinite(angle)) {
      cumulative.set(unit.id, inherited);
      continue;
    }
    const centre = centreOf(unit);
    let target: Point;
    if (scene.geography === "local") {
      // On its own orbit round its (possibly moved) parent — see
      // savedAnglePoint. The company itself has no orbit and stays.
      const parent = unit.parentId ? scene.unitById.get(unit.parentId) : undefined;
      if (!parent) {
        cumulative.set(unit.id, inherited);
        continue;
      }
      // The distance the user released at, when they chose one; otherwise the
      // orbit the calculated layout gives this unit.
      const saved = placement?.distance;
      const orbit = saved != null && Number.isFinite(saved) && saved >= 0
        ? saved
        : Math.hypot(unit.x - parent.x, unit.y - parent.y);
      target = savedAnglePoint({ x: parent.x + inherited.x, y: parent.y + inherited.y }, orbit, angle);
    } else {
      const at = polar(angle, Math.hypot(unit.x - centre.x, unit.y - centre.y));
      target = { x: centre.x + at.x, y: centre.y + at.y };
    }
    const delta = { x: target.x - unit.x - inherited.x, y: target.y - unit.y - inherited.y };
    own.set(unit.id, delta);
    cumulative.set(unit.id, { x: inherited.x + delta.x, y: inherited.y + delta.y });
  }
  return own;
}

/** Free-placement offsets add to any saved orbital placement. */
export function combinePositionOffsets(
  orbital: PositionOffsets,
  free: PositionOffsets,
): Map<string, Point> {
  const combined = new Map(orbital);
  for (const [id, delta] of free) {
    const previous = combined.get(id) ?? { x: 0, y: 0 };
    combined.set(id, { x: previous.x + delta.x, y: previous.y + delta.y });
  }
  return combined;
}

/** Apply meaning-free, snap-off placement without altering hierarchy. Offsets
 * are relative rather than absolute so the same user move survives a local
 * focus projection and the return to the company view. */
export function applyPositionOffsets(
  scene: OrbitalScene,
  unitOffsets: PositionOffsets,
  seatOffsets: PositionOffsets,
): OrbitalScene {
  if (unitOffsets.size === 0 && seatOffsets.size === 0) return scene;
  // A unit offset belongs to the branch root. Descendants inherit it so a
  // branch moves as one object, while a later move of a child can add its own
  // local offset without flattening the hierarchy into absolute coordinates.
  const cumulative = new Map<string, Point>();
  const unitOffsetFor = (unit: PlacedUnit, visiting = new Set<string>()): Point => {
    const known = cumulative.get(unit.id);
    if (known) return known;
    if (visiting.has(unit.id)) return { x: 0, y: 0 };
    visiting.add(unit.id);
    const parent = unit.parentId ? scene.unitById.get(unit.parentId) : undefined;
    const inherited = parent && unit.depth > 0 ? unitOffsetFor(parent, visiting) : { x: 0, y: 0 };
    const own = unitOffsets.get(unit.id) ?? { x: 0, y: 0 };
    const result = { x: inherited.x + own.x, y: inherited.y + own.y };
    cumulative.set(unit.id, result);
    return result;
  };
  const units = scene.units.map((unit): PlacedUnit => {
    const by = unitOffsetFor(unit);
    return by.x === 0 && by.y === 0 ? unit : { ...unit, x: unit.x + by.x, y: unit.y + by.y };
  });
  const seats = scene.seats.map((seat): PlacedSeat => {
    const host = scene.unitById.get(seat.unitId);
    const unitOffset = host ? unitOffsetFor(host) : undefined;
    const ownOffset = seatOffsets.get(seat.id);
    const combined = {
      x: (unitOffset?.x ?? 0) + (ownOffset?.x ?? 0),
      y: (unitOffset?.y ?? 0) + (ownOffset?.y ?? 0),
    };
    if (combined.x === 0 && combined.y === 0) return seat;
    return {
      ...seat,
      x: seat.x + combined.x,
      y: seat.y + combined.y,
      work: seat.work.map((work) => ({ x: work.x + combined.x, y: work.y + combined.y })),
    };
  });
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const seatsByUnit = new Map<string, PlacedSeat[]>();
  for (const seat of seats) seatsByUnit.set(seat.unitId, [...(seatsByUnit.get(seat.unitId) ?? []), seat]);
  const links = scene.links.map((link): Link => {
    const from = unitById.get(link.sourceId) ?? link.from;
    const to = link.kind === "unit" ? unitById.get(link.targetId) ?? link.to : seatById.get(link.targetId) ?? link.to;
    return { ...link, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
  });
  const extent = Math.max(
    scene.extent,
    ...units.map((unit) => Math.hypot(unit.x, unit.y) + unit.r),
    ...seats.map((seat) => Math.hypot(seat.x, seat.y) + 18),
  );
  // Settled bounds follow the settled placements, so Fit and minimum zoom
  // always frame where the company actually is.
  const bounds = scene.bounds
    ? units.reduce((b, unit) => {
      const reach = unit.footprint ?? unit.r;
      return {
        minX: Math.min(b.minX, unit.x - reach),
        minY: Math.min(b.minY, unit.y - reach),
        maxX: Math.max(b.maxX, unit.x + reach),
        maxY: Math.max(b.maxY, unit.y + reach),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    : undefined;
  return { ...scene, units, seats, links, unitById, seatById, seatsByUnit, extent, ...(bounds ? { bounds } : {}) };
}
