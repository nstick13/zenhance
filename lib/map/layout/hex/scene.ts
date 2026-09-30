/**
 * Turning an allocation into something the map can draw (2026-09-29).
 *
 * `allocate.ts` says which cell each unit gets. This puts that on the plane
 * and hangs each unit's people around it, then hands back an ordinary
 * `OrbitalScene` — the same shape the ring map and local geography already
 * produce.
 *
 * **That is the isolation strategy.** Camera, visibility, signal, work and
 * basket all consume `x`, `y`, `r`, `footprint` and ids; none of them knows
 * or cares how a position was arrived at. Emitting the existing scene type
 * means the hex study inherits fit, cull, wheel zoom, the mark budget, the
 * detail field and the health rings without touching any of them. Where that
 * did not quite hold, the seam is written down in `docs/HEX-LAYOUT.md`.
 *
 * People are placed by `placeUnitSeats` — the orbital engine's own function,
 * unchanged. Greg's model puts human nodes in orbit around a parent node
 * centred in the hexagon, which is exactly what that function already did
 * inside a circle. The hexagon is a fence around it, not a new idea about
 * where people go.
 */
import {
  MAX_SEAT_RINGS,
  placeUnitSeats,
  unitDiscRadius,
  widestGap,
  type Band,
  type Link,
  type OrbitalScene,
  type PlacedSeat,
  type PlacedUnit,
} from "@/lib/map/layout/layout";
import {
  SEAT_RADIUS,
  UNIT_RADIUS,
  seatFurnitureReach,
  seatRingRadius,
} from "@/lib/map/layout/geometry";
import type { OrbitalTree } from "@/lib/map/layout/model";
import { allocate, type Allocation } from "@/lib/map/layout/hex/allocate";
import {
  type Cell,
  cellKey,
  cellToWorld,
  inradius,
  worldAngle,
  worldToCell,
} from "@/lib/map/layout/hex/coords";

/**
 * How much room a hexagon reserves.
 *
 * This is the single most consequential number in the study, and it is the
 * argument Greg and I had about the old engine in miniature. The orbital
 * layout reserved room for a person's whole work board around **every** unit,
 * at **every** zoom — and work items do not appear until 1.75x. Fourteen
 * fifteenths of the company's area was held for detail that is invisible
 * almost everywhere you ever look, which is why it grew to 39,842 x 57,611
 * and why you can travel a hundred-fold of zoom without passing anything
 * named.
 *
 *   `roomy` — reserve for people *and* their work boards. Nothing can ever
 *             overlap, at any zoom, without any special handling.
 *   `tight` — reserve for people only. About 27% smaller across, so the whole
 *             company is that much less far to cross. Work boards can spill
 *             into a neighbour's cell at 1.75x and beyond.
 *
 * The lab shows both because this is precisely the sort of trade nobody can
 * settle in prose.
 */
export type HexDensity = "roomy" | "tight";

/** Work items assumed per person when sizing a cell. The map's own default. */
const SIZING_WORK_COUNT = 6;

/** The radius a unit's content actually occupies, at the layout's declared
 *  maximum of two seat rings. */
export function contentRadius(density: HexDensity): number {
  const people = seatRingRadius(UNIT_RADIUS, MAX_SEAT_RINGS - 1) + SEAT_RADIUS;
  if (density === "tight") return people;
  return (
    seatRingRadius(UNIT_RADIUS, MAX_SEAT_RINGS - 1) +
    Math.max(SEAT_RADIUS, seatFurnitureReach(SIZING_WORK_COUNT))
  );
}

/** A hexagon's circumradius, so its *inradius* — centre to edge, the tight
 *  direction — clears the content. Uniform for every unit in the company,
 *  which is what Greg asked for: importance is carried by zoom and treatment,
 *  never by size. */
export function hexSizeFor(density: HexDensity): number {
  return contentRadius(density) / (Math.sqrt(3) / 2);
}

export type HexScene = OrbitalScene & {
  hex: {
    size: number;
    density: HexDensity;
    /** unit id → its cell. */
    cells: Map<string, Cell>;
    /** unit id → steps from its parent. Above 1 the link is drawn as a curve
     *  back to the parent rather than a straight edge — Greg's jump. */
    steps: Map<string, number>;
    /** unit id → the top-level branch it belongs to, for territory colour. */
    branchOf: Map<string, string>;
    /** Units sitting apart from their family — rule 8's exclaves. */
    exclaves: Set<string>;
    stats: Allocation["stats"];
  };
};

export type HexLayoutOptions = {
  density?: HexDensity;
  /** Reuse an allocation instead of recomputing it — the lab does this when
   *  only the density changes, so cells stay put and only the scale moves. */
  allocation?: Allocation;
};

export function layoutHex(tree: OrbitalTree, options: HexLayoutOptions = {}): HexScene {
  const density = options.density ?? "roomy";
  const size = hexSizeFor(density);
  const allocation = options.allocation ?? allocate(tree);

  const units: PlacedUnit[] = [];
  const seats: PlacedSeat[] = [];
  const links: Link[] = [];

  const centreOf = (cell: Cell) => cellToWorld(cell, size);

  for (const [unitId, cell] of allocation.cells) {
    const unit = tree.units.get(unitId);
    if (!unit) continue;
    const centre = centreOf(cell);
    const seatCount = unit.seatIds.length;
    const unitR = unitDiscRadius(UNIT_RADIUS, seatCount);

    // Which directions are already spoken for: the line home to the parent,
    // and the line out to each child. People take whatever is left, so they
    // never sit on top of a connection.
    const occupied: number[] = [];
    const parentCell = unit.parentId ? allocation.cells.get(unit.parentId) : null;
    const homeAngle = parentCell ? worldAngle(cell, parentCell, size) : Math.PI;
    if (parentCell) occupied.push(homeAngle);
    for (const childId of unit.childIds) {
      const childCell = allocation.cells.get(childId);
      if (childCell) occupied.push(worldAngle(cell, childCell, size));
    }
    const fanAngle = occupied.length > 0 ? widestGap(occupied) : 0;

    const out = { seats, links };
    const seatSpan = placeUnitSeats(tree, unit, centre, unitR, fanAngle, homeAngle, out);

    units.push({
      id: unit.id,
      name: unit.name,
      parentId: unit.parentId,
      depth: unit.depth,
      x: centre.x,
      y: centre.y,
      r: unitR,
      angle: Math.atan2(centre.y, centre.x),
      // A hexagon owns no angular sector of the company — that is a ring-map
      // idea. The field is kept full-circle so nothing downstream divides by it.
      sector: { center: 0, halfSpan: Math.PI },
      seatFanAngle: fanAngle,
      seatFanSpan: seatSpan,
      seatRingRadius: seatRingRadius(unitR, 0),
      leadAngle: homeAngle,
      seatIds: [...unit.seatIds],
      childIds: [...unit.childIds],
      isExternal: unit.isExternal,
      vendorName: unit.vendorName,
      totalSeats: unit.totalSeats,
      // One size everywhere, so nothing inflates differently by rung.
      drawCeiling: unitR * 3,
      // The cell's inradius is what a dot may swell to at overview without
      // leaving its own hexagon — the lattice doing the neighbour-awareness
      // that `lod.neighbourAwareRadius` has to compute on the old map.
      dotPx: undefined,
      footprint: contentRadius(density),
    });
  }

  // Connections. A link between adjacent cells is a straight edge; anything
  // further is a jump and the renderer curves it.
  for (const unit of units) {
    if (!unit.parentId) continue;
    const parent = units.find((u) => u.id === unit.parentId);
    if (!parent) continue;
    links.push({
      id: `hexlink:${unit.id}`,
      kind: "unit",
      sourceId: parent.id,
      targetId: unit.id,
      from: { x: parent.x, y: parent.y },
      to: { x: unit.x, y: unit.y },
      depth: unit.depth,
    });
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const seatById = new Map(seats.map((s) => [s.id, s]));
  const seatsByUnit = new Map<string, PlacedSeat[]>();
  for (const seat of seats) {
    const list = seatsByUnit.get(seat.unitId);
    if (list) list.push(seat);
    else seatsByUnit.set(seat.unitId, [seat]);
  }

  const reach = contentRadius(density);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let extent = 0;
  for (const u of units) {
    minX = Math.min(minX, u.x - reach);
    minY = Math.min(minY, u.y - reach);
    maxX = Math.max(maxX, u.x + reach);
    maxY = Math.max(maxY, u.y + reach);
    extent = Math.max(extent, Math.hypot(u.x, u.y) + reach);
  }
  if (units.length === 0) {
    minX = minY = maxX = maxY = 0;
  }

  const bands: Band[] = [];
  const maxDepth = units.reduce((m, u) => Math.max(m, u.depth), 0);

  return {
    units,
    seats,
    bands,
    links,
    unitById,
    seatById,
    seatsByUnit,
    extent,
    maxDepth,
    bounds: { minX, minY, maxX, maxY },
    hex: {
      size,
      density,
      cells: allocation.cells,
      steps: allocation.steps,
      branchOf: allocation.branchOf,
      exclaves: allocation.exclaves,
      stats: allocation.stats,
    },
  };
}

/** Which unit, if any, sits in the cell under a world point.
 *
 *  The lattice makes this exact and constant-time. The orbital map has to walk
 *  every unit in the cull box for the same answer — `hitTest` in
 *  `OrbitalMap.tsx`. Worth noting as a thing the grid gives away free. */
export function unitAt(
  scene: HexScene,
  point: { x: number; y: number },
  allocation: Allocation,
): string | null {
  const cell = worldToCell(point, scene.hex.size);
  return allocation.occupants.get(cellKey(cell)) ?? null;
}

export { inradius };
