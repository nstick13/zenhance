import type { Link, OrbitalScene, PlacedSeat, PlacedUnit } from "./layout";
import type { Point } from "./geometry";

export type PositionOffsets = ReadonlyMap<string, Point>;

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
  return { ...scene, units, seats, links, unitById, seatById, seatsByUnit, extent };
}
