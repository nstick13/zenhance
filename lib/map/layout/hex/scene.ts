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
 * People were placed by `placeUnitSeats` — the orbital engine's own function —
 * until 2026-10-02, on the reasoning that a hexagon was a fence around the same
 * idea. It is not: that function sits the first six people *inside* the unit
 * and the rest on circular rings, and Greg's rule is that people orbit the node
 * on hexagonal rings and never sit in it. They are placed by `people.ts` now,
 * which is a hex idea and belongs here. Everything else still comes from the
 * orbital engine unchanged.
 */
import {
  MAX_SEAT_RINGS,
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
  workGridPoints,
} from "@/lib/map/layout/geometry";
import type { OrbitalTree, Seat, SeatKind } from "@/lib/map/layout/model";
import { allocate, type Allocation } from "@/lib/map/layout/hex/allocate";
import {
  PERSON_SCALE,
  SEAT_RING_GAP,
  placePeople,
  ringsBetween,
  type SeatRequest,
} from "@/lib/map/layout/hex/people";
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

/**
 * How much of its cell a node fills, by how deep it sits (Greg, 2026-09-30).
 *
 * *"The master central node should occupy 100% of the hosting hexagonal
 * area… nodes that stratify between team and master central should occupy an
 * area that steps up, with each step calculated based on how many strata there
 * are."* The rungs step evenly, so the step size follows from how many rungs a
 * company has rather than being a number anyone tuned.
 *
 * **The ceiling came down to 85% on 2026-10-02** — Greg: *"let's put maximum
 * node sizes (even master/centre) as 85% of total cell area… the only change
 * here is a maximum size."* A node that filled its cell entirely left no ring
 * of its own to stand people on, and from 2026-10-02 people orbit the node
 * rather than sitting inside it. The floor is unchanged at a tenth.
 *
 * The point is that a node smaller than the cell it sits in leaves a gap, and
 * the gap is what tells two peers apart — what gives the chain lines somewhere
 * to run, and now what the company's people stand on.
 */
const NODE_MAX_SHARE = 0.85;
const NODE_MIN_SHARE = 0.1;

export function nodeAreaFraction(depth: number, maxDepth: number): number {
  if (maxDepth <= 0) return NODE_MAX_SHARE;
  const t = Math.min(1, Math.max(0, depth / maxDepth));
  return NODE_MAX_SHARE - (NODE_MAX_SHARE - NODE_MIN_SHARE) * t;
}

/** The same rule as a *linear* scale, which is what a radius wants. Area goes
 *  as the square, so half the area is 1/√2 of the size, not half of it. */
export const nodeScale = (depth: number, maxDepth: number): number =>
  Math.sqrt(nodeAreaFraction(depth, maxDepth));

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

/** The smallest arc covering a set of angles: a full turn when the widest gap
 *  between neighbours is nothing to speak of. */
function coveringArc(angles: readonly number[]): number {
  if (angles.length === 0) return 0;
  if (angles.length === 1) return 0;
  const TAU = Math.PI * 2;
  const sorted = [...angles].map((a) => ((a % TAU) + TAU) % TAU).sort((a, b) => a - b);
  let widest = sorted[0] + TAU - sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) widest = Math.max(widest, sorted[i] - sorted[i - 1]);
  return Math.max(0, TAU - widest);
}

/** Leads first, then members, then open roles — the order people are seated
 *  in, so the nearest ring fills with the people who are actually there. */
const SEAT_RANK: Record<SeatKind, number> = { lead: 0, member: 1, open: 2 };

export function layoutHex(tree: OrbitalTree, options: HexLayoutOptions = {}): HexScene {
  const density = options.density ?? "roomy";
  const size = hexSizeFor(density);
  const allocation = options.allocation ?? allocate(tree);
  // How deep the company goes, which is what grades every node's size.
  let deepest = 0;
  for (const id of allocation.cells.keys()) {
    const depth = tree.units.get(id)?.depth ?? 0;
    if (depth > deepest) deepest = depth;
  }

  const units: PlacedUnit[] = [];
  const seats: PlacedSeat[] = [];
  const links: Link[] = [];

  const centreOf = (cell: Cell) => cellToWorld(cell, size);

  for (const [unitId, cell] of allocation.cells) {
    const unit = tree.units.get(unitId);
    if (!unit) continue;
    const centre = centreOf(cell);
    // One size for every node's centre mark. It used to swell with headcount,
    // because the disc was the thing people orbited; since 2026-10-02 they
    // orbit the hexagon instead, and a disc that grew with a fifty-person team
    // drew a white blob over the tile. Importance is carried by the hexagon's
    // own size, which is graded by rung, and never by how many people a unit
    // happens to hold.
    const unitR = UNIT_RADIUS;

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

    // People orbit the *node hexagon*, on hexagonal rings inside the cell —
    // never inside the node, never over the boundary into the neighbour's
    // tile. The lead sits on the home side, where the chain arrives.
    const nodeR = size * nodeScale(unit.depth, deepest);
    const personR = SEAT_RADIUS * PERSON_SCALE;
    const rings = ringsBetween(nodeR, size, personR, SEAT_RING_GAP);
    const requests: SeatRequest[] = unit.seatIds
      .map((id) => tree.seats.get(id))
      .filter((seat): seat is Seat => !!seat)
      .sort((a, b) => SEAT_RANK[a.kind] - SEAT_RANK[b.kind] || a.name.localeCompare(b.name))
      .map((seat) => ({ id: seat.id, kind: seat.kind === "lead" ? "lead" : seat.kind === "open" ? "open" : "person" }));
    const placed = placePeople({
      centre, nodeR, cellR: size, seatR: personR, gap: SEAT_RING_GAP, homeAngle,
      seats: requests,
    });
    const spotAngles: number[] = [];
    for (const spot of placed) {
      const seat = tree.seats.get(spot.id);
      if (!seat) continue;
      const angle = Math.atan2(spot.y - centre.y, spot.x - centre.x);
      seats.push({
        id: seat.id,
        unitId: unit.id,
        personId: seat.personId,
        photoUrl: seat.photoUrl ?? null,
        name: seat.name,
        role: seat.role,
        kind: seat.kind,
        shared: seat.shared,
        allocationPct: seat.allocationPct,
        x: spot.x,
        y: spot.y,
        r: spot.r,
        angle,
        work: workGridPoints(seat.workCount, { x: spot.x, y: spot.y }, angle),
      });
      links.push({
        id: `link-${seat.id}`,
        kind: "seat",
        sourceId: unit.id,
        targetId: seat.id,
        from: centre,
        to: { x: spot.x, y: spot.y },
        depth: unit.depth + 1,
      });
      spotAngles.push(angle);
    }
    // The smallest arc that covers everyone — the whole circle once a big team
    // wraps. Only the orbital renderer reads this, but a field that lies is
    // worse than one nobody reads.
    const seatSpan = coveringArc(spotAngles);
    const firstRing = rings[0]?.r ?? nodeR;

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
      seatRingRadius: firstRing,
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
