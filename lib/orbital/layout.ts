/**
 * The orbital layout pass: an OrbitalTree in, absolute positions out. Pure,
 * deterministic, and the single place that decides where anything sits — the
 * renderer only draws what comes out of here.
 *
 * The walk is one recursive descent:
 *
 *   band(depth)      every node on a rung shares one radius from the centre
 *   pack(children)   siblings shoulder to shoulder, centred on their parent's
 *                    own angle, so a cluster sits outboard of its parent and
 *                    away from the grandparent
 *   subdivide        each child inherits the slice of angle nearest to it, so
 *                    its own descendants can spread without ever reaching
 *                    into a sibling's territory
 *   seats            people fan into the widest gap of angle the unit has
 *                    left — outward for a leaf, off to one side for a node
 *                    whose children already own the outward direction
 *
 * That last rule is why a stream's lead sits beside the stream while a team's
 * members sit outboard of the team, without either being special-cased.
 */
import {
  BAND_PAD,
  SEAT_GAP,
  SEAT_MAX_SPAN,
  SEAT_RADIUS,
  TAU,
  WORK_RADIUS,
  angularStep,
  angleDelta,
  clampToSector,
  fullSector,
  normalizeAngle,
  packRing,
  polar,
  relaxAngles,
  seatRingRadius,
  spreadRing,
  subdivideCircle,
  subdivideSector,
  unitOuterExtent,
  unitRadius,
  workGridPoints,
  workOuterExtent,
  type Point,
  type Sector,
} from "./geometry";
import type { OrbitalTree, Seat, SeatKind, UnitNode } from "./model";

export type PlacedUnit = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  r: number;
  /** Absolute angle from the centre of the map. */
  angle: number;
  sector: Sector;
  /** Where this unit's people fan out — also where a "+ person" lands. */
  seatFanAngle: number;
  /** How wide that fan is, and how far out it sits. When people are hidden
   *  at distance, the unit's progress arcs stand in for them by occupying
   *  exactly this stretch of orbit, then shrink onto the circle as the
   *  people grow out of it (Greg, 2026-09-13). */
  seatFanSpan: number;
  seatRingRadius: number;
  /** Where the lead sits: facing this unit's own parent, at every zoom. */
  leadAngle: number;
  seatIds: string[];
  childIds: string[];
  isExternal: boolean;
  vendorName: string | null;
  totalSeats: number;
};

export type PlacedSeat = {
  id: string;
  unitId: string;
  personId: string | null;
  name: string;
  role: string | null;
  kind: SeatKind;
  shared: boolean;
  allocationPct: number;
  x: number;
  y: number;
  r: number;
  /** Angle from the unit's centre — the axis the work grid marches along. */
  angle: number;
  /** Work items as a 2×N grid of dots, marching out along `angle`. Between
   *  1.75x and 3.5x these are covered by one capsule; above that they are
   *  the individual, pointable items. */
  work: Point[];
};

export type Band = {
  depth: number;
  /** Where nodes on this rung sit. */
  radius: number;
  /** Outer edge of the rung's territory, used for the backdrop rings. */
  outer: number;
};

export type Link = {
  id: string;
  kind: "unit" | "seat";
  /** The unit this leaves from. */
  sourceId: string;
  /** The unit or seat it arrives at — carried as an id, not just a point, so
   *  the renderer can re-read both ends' live positions while they animate. */
  targetId: string;
  from: Point;
  to: Point;
  depth: number;
};

export type OrbitalScene = {
  units: PlacedUnit[];
  seats: PlacedSeat[];
  bands: Band[];
  links: Link[];
  unitById: Map<string, PlacedUnit>;
  seatById: Map<string, PlacedSeat>;
  seatsByUnit: Map<string, PlacedSeat[]>;
  /** Radius that contains everything drawn, work items included. */
  extent: number;
  maxDepth: number;
};

export type LayoutOptions = {
  /** Angle the company's own children start from. Default: due north. */
  startAngle?: number;
  /** Per-unit angular override from a drag, as an absolute angle. */
  angleOverrides?: Map<string, number>;
};

/**
 * Arc room a child needs beyond its own circle. Reserving a child's whole
 * seat fan would push siblings absurdly far apart (a fan is ~200° wide at a
 * small radius); reserving none lets neighbouring fans collide. Half the fan
 * is the setting that matches the concept drawing's spacing.
 */
const SEAT_FAN_RESERVE = 0.5;
const CHILD_GAP = 34;
/** Fraction of a sector a cluster is allowed to fill, so a cluster never runs
 *  right up to the boundary it shares with its neighbour. */
const SECTOR_USE = 0.92;

/** How many seats fit on one ring before another is needed. */
function seatRingCapacity(unitR: number, ring: number): number {
  const step = angularStep(SEAT_RADIUS, SEAT_GAP, seatRingRadius(unitR, ring));
  return Math.max(1, Math.floor(SEAT_MAX_SPAN / step) + 1);
}

function seatRingCount(unitR: number, seatCount: number): number {
  let remaining = seatCount;
  let rings = 0;
  while (remaining > 0 && rings < 6) {
    remaining -= seatRingCapacity(unitR, rings);
    rings++;
  }
  return rings;
}

/**
 * Reorder so the first item lands in the middle of the fan — a unit's lead
 * reads as the centre of their people rather than an edge case at one end.
 */
function centreOut<T>(items: T[]): T[] {
  const out: (T | undefined)[] = new Array(items.length);
  const mid = Math.floor((items.length - 1) / 2);
  let lo = mid;
  let hi = mid;
  items.forEach((item, i) => {
    if (i === 0) {
      out[mid] = item;
      return;
    }
    if (i % 2 === 1) {
      hi += 1;
      out[hi] = item;
    } else {
      lo -= 1;
      out[lo] = item;
    }
  });
  return out.filter((v): v is T => v !== undefined);
}

const SEAT_ORDER: Record<SeatKind, number> = { lead: 0, member: 1, open: 2 };

/**
 * The widest stretch of angle around `centre` that nothing already occupies.
 * Occupied directions are the parent (the line home) and each child cluster,
 * so seats end up wherever the unit still has room.
 */
function widestGap(occupied: number[]): number {
  if (occupied.length === 0) return 0;
  if (occupied.length === 1) return normalizeAngle(occupied[0] + Math.PI);
  const sorted = [...occupied].map(normalizeAngle).sort((a, b) => a - b);
  let bestMid = 0;
  let bestSpan = -1;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i === sorted.length - 1 ? sorted[0] + TAU : sorted[i + 1];
    const span = b - a;
    if (span > bestSpan) {
      bestSpan = span;
      bestMid = normalizeAngle(a + span / 2);
    }
  }
  return bestMid;
}

export function layoutOrbital(tree: OrbitalTree, opts: LayoutOptions = {}): OrbitalScene {
  const startAngle = opts.startAngle ?? -Math.PI / 2;
  const overrides = opts.angleOverrides;

  // --- bands: one radius per rung ------------------------------------------
  // A rung's radius is the larger of two demands. Geometrically it has to
  // clear the rung inside it. But it must *also* be long enough round that
  // everything standing on it fits shoulder to shoulder: a rung holding
  // eighty teams needs far more circumference than one holding eight, and
  // sizing only by node radius silently compressed the packer until siblings
  // overlapped — invisible on the demo org, ruinous on a real one.
  const ringsByUnit = new Map<string, number>();
  const haloByDepth: number[] = [];
  const countByDepth: number[] = [];
  const widestParentByDepth: number[] = [];
  const ringsByDepth: number[] = [];
  for (const unit of tree.units.values()) {
    const r = unitRadius(unit.depth);
    const rings = seatRingCount(r, unit.seatIds.length);
    ringsByUnit.set(unit.id, rings);
    haloByDepth[unit.depth] = Math.max(haloByDepth[unit.depth] ?? 0, unitOuterExtent(r, rings));
    ringsByDepth[unit.depth] = Math.max(ringsByDepth[unit.depth] ?? 0, rings);
    countByDepth[unit.depth] = (countByDepth[unit.depth] ?? 0) + 1;
    const kids = unit.childIds.filter((id) => tree.units.has(id)).length;
    widestParentByDepth[unit.depth] = Math.max(widestParentByDepth[unit.depth] ?? 0, kids);
  }

  /** Arc a node on this rung occupies, including the share of its own seat
   *  fan we reserve so neighbouring fans don't interleave. */
  const packRadiusAt = (depth: number) => {
    const r = unitRadius(depth);
    const fanOuter = unitOuterExtent(r, ringsByDepth[depth] ?? 0);
    return r + (fanOuter - r) * SEAT_FAN_RESERVE;
  };

  const bandRadius: number[] = [0];
  // How much angle one node on a rung has to give its own children. The
  // company spreads its children over the whole circle; deeper rungs pack
  // tight, so a node inherits roughly one packing step.
  let parentSpan = TAU;
  for (let d = 1; d <= tree.maxDepth; d++) {
    const arcWidth = 2 * packRadiusAt(d) + CHILD_GAP;
    const geometric =
      bandRadius[d - 1] + (haloByDepth[d - 1] ?? unitRadius(d - 1)) + unitRadius(d) + BAND_PAD;
    // Everything on the rung has to fit round it…
    const circumference = ((countByDepth[d] ?? 0) * arcWidth) / TAU;
    // …and the busiest single parent's cluster has to fit in its own share.
    const widest = widestParentByDepth[d - 1] ?? 0;
    const cluster =
      d === 1 || widest < 2 ? 0 : ((widest - 1) * arcWidth) / (SECTOR_USE * parentSpan);
    bandRadius[d] = Math.max(geometric, circumference, cluster);
    parentSpan =
      d === 1 ? TAU / Math.max(1, countByDepth[1] ?? 1) : arcWidth / Math.max(1, bandRadius[d]);
  }

  const units: PlacedUnit[] = [];
  const seats: PlacedSeat[] = [];
  const links: Link[] = [];

  const emitSeat = (
    unit: UnitNode,
    centre: Point,
    seat: Seat,
    angle: number,
    ringR: number,
  ) => {
    const at = polar(angle, ringR);
    const pos = { x: centre.x + at.x, y: centre.y + at.y };
    seats.push({
      id: seat.id,
      unitId: unit.id,
      personId: seat.personId,
      name: seat.name,
      role: seat.role,
      kind: seat.kind,
      shared: seat.shared,
      allocationPct: seat.allocationPct,
      x: pos.x,
      y: pos.y,
      r: SEAT_RADIUS,
      angle,
      work: workGridPoints(seat.workCount, pos, angle),
    });
    links.push({
      id: `link-${seat.id}`,
      kind: "seat",
      sourceId: unit.id,
      targetId: seat.id,
      from: centre,
      to: pos,
      depth: unit.depth + 1,
    });
  };

  /** Filled in as seats are placed, so the unit can report the stretch of
   *  orbit its people occupy. */
  const placeSeats = (
    unit: UnitNode,
    centre: Point,
    fanAngle: number,
    homeAngle: number,
  ): number => {
    const unitR = unitRadius(unit.depth);
    let widestSpan = 0;
    const all = unit.seatIds
      .map((id) => tree.seats.get(id))
      .filter((s): s is Seat => !!s)
      .sort((a, b) => SEAT_ORDER[a.kind] - SEAT_ORDER[b.kind] || a.name.localeCompare(b.name));

    // The lead is pinned on the side facing this unit's own parent, at every
    // zoom (Greg, 2026-09-14). It's the answer to "who do I talk to about
    // this node", so it never moves and it points up the chain it reports
    // to — which is also why it's the last dot left when everything else has
    // faded out at distance.
    const leads = all.filter((s) => s.kind === "lead");
    const ordered = centreOut(all.filter((s) => s.kind !== "lead"));

    const leadAngles = packRing(
      leads.length,
      SEAT_RADIUS,
      SEAT_GAP,
      seatRingRadius(unitR, 0),
      homeAngle,
      SEAT_MAX_SPAN / 3,
    );
    leads.forEach((seat, i) => emitSeat(unit, centre, seat, leadAngles[i], seatRingRadius(unitR, 0)));

    let index = 0;
    let ring = 0;
    while (index < ordered.length && ring < 6) {
      const capacity = seatRingCapacity(unitR, ring);
      const slice = ordered.slice(index, index + capacity);
      const ringR = seatRingRadius(unitR, ring);
      const angles = packRing(slice.length, SEAT_RADIUS, SEAT_GAP, ringR, fanAngle, SEAT_MAX_SPAN);
      if (angles.length > 0) {
        const span =
          angles.length === 1
            ? angularStep(SEAT_RADIUS, SEAT_GAP, ringR)
            : Math.abs(angles[angles.length - 1] - angles[0]) +
              angularStep(SEAT_RADIUS, SEAT_GAP, ringR);
        widestSpan = Math.max(widestSpan, span);
      }
      slice.forEach((seat, i) => emitSeat(unit, centre, seat, angles[i], ringR));
      index += capacity;
      ring++;
    }
    return widestSpan;
  };

  const place = (unitId: string, centre: Point, angle: number, sector: Sector) => {
    const unit = tree.units.get(unitId);
    if (!unit) return;
    const depth = unit.depth;
    const r = unitRadius(depth);
    const childDepth = depth + 1;
    const childBand = bandRadius[childDepth] ?? 0;

    // Children first, so their directions are known before seats pick a gap.
    const rawChildIds = unit.childIds.filter((id) => tree.units.has(id));
    let childIds: string[] = [];
    let childAngles: number[] = [];
    let childSectors: Sector[] = [];

    if (rawChildIds.length > 0) {
      // The same figure the band was sized against, so the packer can never
      // ask for more room than the rung was built to give.
      const packR = packRadiusAt(childDepth);
      const circular = depth === 0;

      const natural = circular
        ? spreadRing(rawChildIds.length, startAngle)
        : packRing(
            rawChildIds.length,
            packR,
            CHILD_GAP,
            childBand,
            angle,
            Math.max(sector.halfSpan * 2 * SECTOR_USE, 1e-3),
          );

      // A dragged node is pinned to the angle the pointer left it at; the
      // rest keep their packed places and shuffle only enough to make room.
      const pinned = rawChildIds.map((id) => overrides?.get(id) !== undefined);
      const wanted = rawChildIds.map((id, i) => {
        const forced = overrides?.get(id);
        return forced !== undefined ? normalizeAngle(forced) : natural[i];
      });
      const relaxed = relaxAngles(
        wanted,
        angularStep(packR, CHILD_GAP, Math.max(1, childBand)),
        pinned,
        circular,
      );

      // Re-sort into angular order: an override can carry a node clean past a
      // sibling, and the sector split below assumes they arrive in order.
      const ordered = rawChildIds
        .map((id, i) => ({ id, angle: circular ? relaxed[i] : clampToSector(sector, relaxed[i]) }))
        .sort((a, b) => angleDelta(sector.center, a.angle) - angleDelta(sector.center, b.angle));

      childIds = ordered.map((c) => c.id);
      childAngles = ordered.map((c) => c.angle);
      childSectors = circular
        ? subdivideCircle(childAngles)
        : subdivideSector(sector, childAngles);
    }

    const occupied = [
      ...childAngles,
      ...(unit.parentId !== null ? [normalizeAngle(angle + Math.PI)] : []),
    ];
    const fanAngle = occupied.length > 0 ? widestGap(occupied) : startAngle;

    // Toward this unit's own parent — where the lead is pinned. The centre
    // has no parent, so its lead faces the way its children start from.
    const homeAngle = unit.parentId === null ? startAngle : normalizeAngle(angle + Math.PI);
    const fanSpan = placeSeats(unit, centre, fanAngle, homeAngle);

    units.push({
      id: unit.id,
      name: unit.name,
      parentId: unit.parentId,
      depth,
      x: centre.x,
      y: centre.y,
      r,
      angle,
      sector,
      seatFanAngle: fanAngle,
      seatFanSpan: fanSpan,
      seatRingRadius: seatRingRadius(r, 0),
      leadAngle: homeAngle,
      seatIds: unit.seatIds,
      childIds,
      isExternal: unit.isExternal,
      vendorName: unit.vendorName,
      totalSeats: unit.totalSeats,
    });

    childIds.forEach((id, i) => {
      const childAngle = childAngles[i];
      const childCentre = polar(childAngle, childBand);
      links.push({
        id: `link-${id}`,
        kind: "unit",
        sourceId: unit.id,
        targetId: id,
        from: centre,
        to: childCentre,
        depth: childDepth,
      });
      place(id, childCentre, childAngle, childSectors[i] ?? sector);
    });
  };

  place(tree.rootId, { x: 0, y: 0 }, startAngle, fullSector());

  // --- backdrop bands + overall extent -------------------------------------
  const bands: Band[] = [];
  for (let d = 0; d <= tree.maxDepth; d++) {
    const inner = bandRadius[d] ?? 0;
    const next = bandRadius[d + 1];
    const halo = haloByDepth[d] ?? unitRadius(d);
    bands.push({ depth: d, radius: inner, outer: next != null ? (inner + halo + next) / 2 : inner + halo });
  }

  let extent = bands.length > 0 ? bands[bands.length - 1].outer : unitRadius(0);
  for (const seat of seats) {
    const reach = Math.hypot(seat.x, seat.y) + workOuterExtent(seat.work.length) + WORK_RADIUS;
    if (reach > extent) extent = reach;
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const seatById = new Map(seats.map((s) => [s.id, s]));
  const seatsByUnit = new Map<string, PlacedSeat[]>();
  for (const s of seats) {
    const list = seatsByUnit.get(s.unitId) ?? [];
    list.push(s);
    seatsByUnit.set(s.unitId, list);
  }

  return { units, seats, bands, links, unitById, seatById, seatsByUnit, extent, maxDepth: tree.maxDepth };
}

/** Which rung a radius falls on — the backdrop doubling as a classifier. */
export function bandAtRadius(scene: OrbitalScene, radius: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const band of scene.bands) {
    const d = Math.abs(band.radius - radius);
    if (d < bestDist) {
      bestDist = d;
      best = band.depth;
    }
  }
  return best;
}

/** The unit on `depth` whose sector owns `angle` — "angle says who you
 *  belong to", the rule behind dragging something into a new parent. */
export function unitOwningAngle(
  scene: OrbitalScene,
  depth: number,
  angle: number,
): PlacedUnit | null {
  let best: PlacedUnit | null = null;
  let bestDist = Infinity;
  for (const unit of scene.units) {
    if (unit.depth !== depth) continue;
    const d = Math.abs(angleDelta(unit.sector.center, angle));
    if (d <= unit.sector.halfSpan + 1e-9) return unit;
    if (d < bestDist) {
      bestDist = d;
      best = unit;
    }
  }
  return best;
}
