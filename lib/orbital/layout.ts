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
  seatFurnitureReach,
  seatRingRadius,
  subdivideByWeight,
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
  /** How wide that fan is, and how far out it sits. The torus stands in for
   *  people while they're hidden; progress rings now remain close to the
   *  unit disc at every zoom (Greg, 2026-09-20). */
  seatFanSpan: number;
  seatRingRadius: number;
  /** Where the lead sits: facing this unit's own parent, at every zoom. */
  leadAngle: number;
  seatIds: string[];
  childIds: string[];
  isExternal: boolean;
  vendorName: string | null;
  totalSeats: number;
  /** The most this node may be inflated to when zoomed out far enough that its
   *  true size would be sub-pixel (see lod.drawnUnitRadius). Uniform across a
   *  rung, so size keeps carrying depth and nothing else. */
  drawCeiling: number;
  /** Local geography only: the on-screen radius the dot holds at overview,
   *  from the headcount size index (see size.ts). Absent on the ring map,
   *  which keeps its depth-based floors. */
  dotPx?: number;
  /** Local geography only: the radius of the orbit this unit's own children
   *  sit on, and the direction it faces away from its parent. */
  childOrbit?: number;
  outward?: number;
  /** Local geography only: how far this unit's own furniture — people, their
   *  boards — reaches from its centre. What neighbours must stay clear of. */
  footprint?: number;
  /** Local geography only: its nearest units and their distances — what its
   *  dot may swell against when zoomed out (lod.neighbourAwareRadius). */
  near?: { id: string; d: number }[];
};

export type Geography = "orbital" | "local";

export type PlacedSeat = {
  id: string;
  unitId: string;
  personId: string | null;
  photoUrl?: string | null;
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
  /** How big a node on this rung is — indexed to the rung, not a constant. */
  nodeRadius: number;
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
  /** Independent rooted families. The outer boundary is visual, not a parent. */
  families?: { rootId: string; centre: Point; boundary: number; bands: Band[] }[];
  /** Which drawing of the company this is. Absent means the ring map. */
  geography?: Geography;
  /** The settled structural geometry's bounding box — every unit and the
   *  room its people need, drawn or not. What Fit and minimum zoom use. */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
};

export type LayoutOptions = {
  /** Angle the company's own children start from. Default: due north. */
  startAngle?: number;
  /** Per-unit angular override from a drag, as an absolute angle. */
  angleOverrides?: Map<string, number>;
  /** Which drawing to lay out (forest only). Default: the ring map. */
  geography?: Geography;
  /** 0 keeps siblings on one regular orbit; 1 permits the local layout to
   * use all collision-safe radial variation justified by branch shape. */
  radialLooseness?: number;
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
/** Share of a node's sector handed to its children, leaving a margin so
 *  families still read as clusters with gaps rather than one unbroken ring.
 *  Generous at the top where there is room, tighter with depth so the margin
 *  doesn't compound away the whole circle — and exactly 1 at the centre,
 *  whose children wrap the full circle and so have no seam to leave a margin
 *  at. (A margin there is a dead zone a drag can fall into and be flung to
 *  the far side.) */
const fillAt = (depth: number) => (depth === 0 ? 1 : depth === 1 ? 0.86 : 0.96);

/** A sector a touch narrower, for clamping a child inside its own slice
 *  without landing it on the shared boundary. */
const shrink = (sector: Sector): Sector => ({
  center: sector.center,
  halfSpan: Math.max(sector.halfSpan * 0.98, 1e-5),
});

/**
 * Tile a sector between children when one of them is pinned to an exact
 * angle: that child's slice is centred on it, and everyone before and after
 * shares out the arc that remains on their side.
 */
function tileAround(
  parent: Sector,
  ids: string[],
  weightOf: (id: string) => number,
  fill: number,
  pinnedIndex: number,
  pinnedAngle: number,
): { sector: Sector; center: number }[] {
  const span = parent.halfSpan * 2 * fill;
  const start = parent.center - span / 2;
  const weights = ids.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const pinnedWidth = (weights[pinnedIndex] / total) * span;

  // How far into the span the pinned angle sits, measured *forward* from its
  // start — a shortest-path delta wraps negative on a near-full circle and
  // would throw the slice to the wrong end.
  const forward = (((pinnedAngle - start) % TAU) + TAU) % TAU;
  const offset = Math.min(Math.max(forward, pinnedWidth / 2), Math.max(span - pinnedWidth / 2, pinnedWidth / 2));
  const lowEdge = start + offset - pinnedWidth / 2;
  const highEdge = lowEdge + pinnedWidth;

  const fillRange = (from: number, to: number, slice: number[]) => {
    const sum = slice.reduce((a, b) => a + b, 0) || 1;
    let cursor = from;
    return slice.map((w) => {
      const width = ((to - from) * w) / sum;
      const sector = { center: normalizeAngle(cursor + width / 2), halfSpan: width / 2 };
      cursor += width;
      return { sector, center: sector.center };
    });
  };

  return [
    ...fillRange(start, lowEdge, weights.slice(0, pinnedIndex)),
    {
      sector: { center: normalizeAngle(lowEdge + pinnedWidth / 2), halfSpan: pinnedWidth / 2 },
      center: normalizeAngle(lowEdge + pinnedWidth / 2),
    },
    ...fillRange(highEdge, start + span, weights.slice(pinnedIndex + 1)),
  ];
}
/** The gap between rungs, in node radii, that a node grows toward. Small orgs
 *  already beat this with their base radii and are left alone. */
const TARGET_GAP_RATIO = 9;
/** However roomy the rung, a node never grows more than this much past its
 *  base size — the rungs are already telling you the hierarchy. */
const NODE_MAX_GROWTH = 3;
/** A node may never fill more than this share of its arc slot… */
const NODE_SLOT_FILL = 0.34;
/** …nor grow past this share of its parent rung's node, so the hierarchy
 *  always reads from the size alone.
 *
 *  The shrink eases off with depth. A flat 0.7 per rung is right at the top —
 *  a division should read as plainly smaller than the company — but compounded
 *  over Northwind's twelve rungs it reaches 0.7¹¹, which pinned every rung past
 *  CEO+6 to the minimum radius however much room it had. Easing toward 0.93
 *  keeps the hierarchy strictly decreasing while letting the deep rungs take
 *  the space they've actually got. */
const DEPTH_SHRINK_TOP = 0.7;
const DEPTH_SHRINK_DEEP = 0.93;
const DEPTH_SHRINK_EASE = 0.62;
const shrinkAt = (depth: number) =>
  DEPTH_SHRINK_DEEP - (DEPTH_SHRINK_DEEP - DEPTH_SHRINK_TOP) * DEPTH_SHRINK_EASE ** (depth - 1);

/** Zoomed right out, a node may be inflated to stay visible — but never past
 *  this share of the distance to the next rung, nor this share of its own arc
 *  slot. Whichever binds first is what keeps the rings readable as rings.
 *
 *  The centre gets a larger share because it has no inner neighbour to crowd:
 *  the only thing it can run into is the first rung coming the other way, and
 *  0.45 plus that rung's 0.3 still leaves a quarter of the gap clear. It needs
 *  the room — a pivot that draws the same size as its divisions doesn't read
 *  as the pivot. */
const DRAW_GAP_SHARE = 0.3;
const DRAW_GAP_SHARE_ROOT = 0.45;


/** How many seats fit on one ring before another is needed. */
function seatRingCapacity(unitR: number, ring: number): number {
  const step = angularStep(SEAT_RADIUS, SEAT_GAP, seatRingRadius(unitR, ring));
  return Math.max(1, Math.floor(SEAT_MAX_SPAN / step) + 1);
}

/** How many rings of people a unit may carry before its own disc has to grow.
 *  Two reads as "a team and its people"; more starts to read as a crowd with
 *  something small lost in the middle. */
export const MAX_SEAT_RINGS = 2;

/** Whether the ring map still shrinks a node with every rung, the way the
 *  original concept drawing did (company 165, then 72, 48, 36). Off since
 *  2026-09-24: a unit is one size everywhere, on both drawings, so the two
 *  maps agree about how big a team is. See `geometry.UNIT_RADIUS`. */
export const SIZE_BY_DEPTH = false;

/**
 * A unit's disc: the standard size, grown **only when it has to be** — when
 * its own people will not fit within `MAX_SEAT_RINGS` of it — and then only
 * by as much as the seating forces (Greg, 2026-09-24).
 *
 * In practice almost nothing grows: two rings round the standard dot seat
 * about thirty people. A ninety-person team does, and then it is the seating
 * that says how big, not the headcount.
 */
export function unitDiscRadius(base: number, seatCount: number): number {
  if (seatCount <= 0 || seatRingCount(base, seatCount) <= MAX_SEAT_RINGS) return base;
  let low = base;
  let high = base;
  for (let i = 0; i < 40 && seatRingCount(high, seatCount) > MAX_SEAT_RINGS; i++) {
    low = high;
    high *= 1.5;
  }
  for (let i = 0; i < 24 && high - low > 0.5; i++) {
    const mid = (low + high) / 2;
    if (seatRingCount(mid, seatCount) <= MAX_SEAT_RINGS) high = mid;
    else low = mid;
  }
  return high;
}

export function seatRingCount(unitR: number, seatCount: number): number {
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
export function widestGap(occupied: number[]): number {
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

/**
 * Hang a unit's people off it: the lead pinned facing `homeAngle` (toward the
 * unit's own parent), everyone else fanned across `fanAngle` in as many seat
 * rings as it takes. Shared by both geographies, so a person sits in the same
 * place relative to their team whichever way the company is drawn. Returns the
 * widest stretch of orbit the fan occupies — what the torus stands in for.
 */
export function placeUnitSeats(
  tree: OrbitalTree,
  unit: UnitNode,
  centre: Point,
  unitR: number,
  fanAngle: number,
  homeAngle: number,
  out: { seats: PlacedSeat[]; links: Link[] },
): number {
  const emitSeat = (seat: Seat, angle: number, ringR: number) => {
    const at = polar(angle, ringR);
    const pos = { x: centre.x + at.x, y: centre.y + at.y };
    out.seats.push({
      id: seat.id,
      unitId: unit.id,
      personId: seat.personId,
      photoUrl: seat.photoUrl ?? null,
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
    out.links.push({
      id: `link-${seat.id}`,
      kind: "seat",
      sourceId: unit.id,
      targetId: seat.id,
      from: centre,
      to: pos,
      depth: unit.depth + 1,
    });
  };

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
  leads.forEach((seat, i) => emitSeat(seat, leadAngles[i], seatRingRadius(unitR, 0)));

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
    slice.forEach((seat, i) => emitSeat(seat, angles[i], ringR));
    index += capacity;
    ring++;
  }
  return widestSpan;
}

export function layoutOrbital(tree: OrbitalTree, opts: LayoutOptions = {}): OrbitalScene {
  const startAngle = opts.startAngle ?? -Math.PI / 2;
  const overrides = opts.angleOverrides;

  // --- bands: one radius per rung ------------------------------------------
  // A rung only has to clear the rung inside it. Whether the whole org fits
  // *round* the map is settled separately, by measuring angular need and
  // scaling — which is what keeps the upper rungs tight on a big org instead
  // of inheriting the outermost rung's enormous radius.
  const countByDepth: number[] = [];
  for (const unit of tree.units.values()) {
    countByDepth[unit.depth] = (countByDepth[unit.depth] ?? 0) + 1;
  }

  const seatsByDepth = new Map<number, number[]>();
  /** The most work any one person on this rung carries — what their capsule
   *  needs room for, and the thing the halo used to ignore. */
  const workReachByDepth = new Map<number, number>();
  for (const unit of tree.units.values()) {
    seatsByDepth.set(unit.depth, [...(seatsByDepth.get(unit.depth) ?? []), unit.seatIds.length]);
    let busiest = 0;
    for (const id of unit.seatIds) busiest = Math.max(busiest, tree.seats.get(id)?.workCount ?? 0);
    workReachByDepth.set(
      unit.depth,
      Math.max(workReachByDepth.get(unit.depth) ?? 0, seatFurnitureReach(busiest)),
    );
  }

  /** Seat rings needed by the busiest unit on a rung, at a given node size. */
  const ringsAt = (depth: number, r: number) => {
    let rings = 0;
    for (const count of seatsByDepth.get(depth) ?? []) {
      rings = Math.max(rings, seatRingCount(r, count));
    }
    return rings;
  };

  /** Rung sizing: clear the rung inside, given a node radius per rung. */
  const sizeBands = (radiusAt: (depth: number) => number): number[] => {
    const haloByDepth: number[] = [];
    const ringsByDepth: number[] = [];
    for (const [depth, seatCounts] of seatsByDepth) {
      const r = radiusAt(depth);
      const reach = workReachByDepth.get(depth) ?? 0;
      for (const count of seatCounts) {
        const rings = seatRingCount(r, count);
        haloByDepth[depth] = Math.max(haloByDepth[depth] ?? 0, unitOuterExtent(r, rings, reach));
        ringsByDepth[depth] = Math.max(ringsByDepth[depth] ?? 0, rings);
      }
    }
    const bands: number[] = [0];
    for (let d = 1; d <= tree.maxDepth; d++) {
      bands[d] =
        bands[d - 1] + (haloByDepth[d - 1] ?? radiusAt(d - 1)) + radiusAt(d) + BAND_PAD;
    }
    return bands;
  };

  /**
   * How much *angle* each unit actually needs — the number the whole layout
   * turns on.
   *
   * Counting teams isn't enough. A team sitting at CEO+2 and one at CEO+10
   * each need a node's width of arc, but arc is radius times angle, so the
   * shallow one costs several times the angle of the deep one. Measuring need
   * in radians against the rung each unit stands on is what lets a ragged org
   * — Greg's "a delivery team at CEO+2 and another at CEO+10" — sit on a map
   * that isn't mostly empty.
   *
   * A branch needs whatever its children need; a leaf needs its own width.
   */
  const measureNeeds = (bands: number[], radiusAt: (d: number) => number, packRadius: (d: number) => number) => {
    const need = new Map<string, number>();
    const visit = (id: string): number => {
      const unit = tree.units.get(id);
      if (!unit) return 0;
      const kids = unit.childIds.filter((cid) => tree.units.has(cid));
      const below = kids.reduce((sum, cid) => sum + visit(cid), 0) / fillAt(unit.depth);
      // The centre stands at radius zero, so it has no arc of its own — its
      // need is simply whatever its children need, which is the whole circle.
      const band = bands[unit.depth] ?? 0;
      const own = band > 0 ? (2 * packRadius(unit.depth) + CHILD_GAP) / band : 0;
      const total = Math.max(own, below);
      need.set(id, total);
      return total;
    };
    visit(tree.rootId);
    return need;
  };

  // --- make it fit, all at once --------------------------------------------
  // Measure what the org needs in radians at these radii. If the centre needs
  // more than a full circle, the map is simply too small: scale it until it
  // fits. Need is inversely proportional to radius, so this converges in a
  // step or two — and scaling everything keeps the rungs' relative spacing,
  // rather than letting the outermost one run away from the rest.
  const fitBands = (start: number[], radiusAt: (d: number) => number) => {
    const packForNeeds = (d: number) => {
      const r = radiusAt(d);
      const fanOuter = unitOuterExtent(r, ringsAt(d, r), workReachByDepth.get(d) ?? 0);
      return r + (fanOuter - r) * SEAT_FAN_RESERVE;
    };
    let bands = start;
    let needs = measureNeeds(bands, radiusAt, packForNeeds);
    for (let pass = 0; pass < 4; pass++) {
      const overflow = (needs.get(tree.rootId) ?? 0) / TAU;
      if (overflow <= 1.001) break;
      bands = bands.map((b, d) => (d === 0 ? b : b * overflow));
      needs = measureNeeds(bands, radiusAt, packForNeeds);
    }
    return { bands, needs };
  };

  // --- node size is indexed to the rung it stands on ------------------------
  // A rung's radius scales with headcount, but a node's own radius used to be
  // a constant — so on a 2,400-person org a team was an r=36 dot adrift in a
  // 2,900-unit gap (Greg, 2026-09-14: "the gap is quite high, we might need to
  // index it somewhat"). A node now grows to fill a share of its *arc slot* —
  // the circumference each node on that rung gets to itself — which keeps the
  // picture proportionate at any size. It only ever grows: a crowded rung's
  // slot is already about one node wide, so small orgs are untouched.
  //
  // The gaps have to be the *fitted* ones. Indexing against the unfitted bands
  // measured a few hundred units where the map would really have thousands,
  // so nothing ever cleared the base radii and the whole pass was dead code.
  const firstPass = fitBands(sizeBands(unitRadius), unitRadius).bands;
  // The busiest unit on each rung decides whether that rung's nodes have to
  // grow at all, so a rung stays one size across the map.
  const maxSeatsByDepth: number[] = [];
  for (const unit of tree.units.values()) {
    const d = Math.max(0, unit.depth);
    maxSeatsByDepth[d] = Math.max(maxSeatsByDepth[d] ?? 0, unit.seatIds.length);
  }
  const radiusByDepth: number[] = [];
  for (let d = 0; d <= tree.maxDepth; d++) {
    const base = unitRadius(d);
    const gap = d === 0 ? (firstPass[1] ?? 0) : (firstPass[d] ?? 0) - (firstPass[d - 1] ?? 0);
    // Grow only toward a sane gap-to-node ratio. On a small org the base
    // radii already beat the target, so nothing moves at all — which is the
    // point: this exists for the big ones.
    const wanted = gap / TARGET_GAP_RATIO;
    const slot = d === 0 ? Infinity : (TAU * (firstPass[d] ?? 0)) / Math.max(1, countByDepth[d] ?? 1);
    // A node may never outgrow its parent's rung: the hierarchy has to stay
    // legible at a glance, whatever the arithmetic says.
    const ceiling = d === 0 ? Infinity : (radiusByDepth[d - 1] ?? base) * shrinkAt(d);
    const grown = Math.max(base, Math.min(wanted, slot * NODE_SLOT_FILL, ceiling, base * NODE_MAX_GROWTH));
    // Since 2026-09-24 every unit is one size (geometry.UNIT_RADIUS), so a
    // node grows for one reason only: its own people need the room. The rung
    // machinery above is left intact — it is what spaces the bands — but it
    // no longer decides how big a node is.
    radiusByDepth[d] = SIZE_BY_DEPTH
      ? grown
      : unitDiscRadius(base, maxSeatsByDepth[d] ?? 0);
  }
  const radiusAt = (depth: number) => radiusByDepth[Math.max(0, Math.min(depth, tree.maxDepth))] ?? unitRadius(depth);

  // Re-size the rungs for the bigger nodes. Bands only ever grow here, so the
  // slots the radii were derived from can only have got roomier — which makes
  // the sizes above conservative rather than stale, and stops the two from
  // chasing each other.
  const secondPass = sizeBands(radiusAt);
  const fitted = fitBands(
    secondPass.map((v, d) => Math.max(v, firstPass[d] ?? 0)),
    radiusAt,
  );
  const bandRadius = fitted.bands;
  const needs = fitted.needs;

  /** Each unit's share of its parent's sector, by the angle it actually needs. */
  const needOf = (id: string) => Math.max(needs.get(id) ?? 1e-6, 1e-6);

  const ringsByUnit = new Map<string, number>();
  const haloByDepth: number[] = [];
  for (const unit of tree.units.values()) {
    const r = radiusAt(unit.depth);
    const rings = seatRingCount(r, unit.seatIds.length);
    ringsByUnit.set(unit.id, rings);
    haloByDepth[unit.depth] = Math.max(
      haloByDepth[unit.depth] ?? 0,
      unitOuterExtent(r, rings, workReachByDepth.get(unit.depth) ?? 0),
    );
  }
  const ringsByDepth: number[] = [];
  for (const unit of tree.units.values()) {
    ringsByDepth[unit.depth] = Math.max(ringsByDepth[unit.depth] ?? 0, ringsByUnit.get(unit.id) ?? 0);
  }
  const packRadiusAt = (depth: number) => {
    const r = radiusAt(depth);
    const fanOuter = unitOuterExtent(r, ringsByDepth[depth] ?? 0, workReachByDepth.get(depth) ?? 0);
    return r + (fanOuter - r) * SEAT_FAN_RESERVE;
  };

  const units: PlacedUnit[] = [];
  const seats: PlacedSeat[] = [];
  const links: Link[] = [];
  const placeSeats = (unit: UnitNode, centre: Point, fanAngle: number, homeAngle: number): number =>
    placeUnitSeats(tree, unit, centre, radiusAt(unit.depth), fanAngle, homeAngle, { seats, links });

  const place = (unitId: string, centre: Point, angle: number, sector: Sector) => {
    const unit = tree.units.get(unitId);
    if (!unit) return;
    const depth = unit.depth;
    const r = radiusAt(depth);
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

      // Each child gets the slice of this node's sector its own subtree
      // needs. Slices tile the sector exactly, so two families can never
      // reach into each other however the weights fall.
      const parentSector = circular
        ? { center: startAngle + Math.PI, halfSpan: Math.PI }
        : sector;
      const weightOf = (id: string) => needOf(id);
      const tile = (ids: string[]) =>
        subdivideByWeight(
          parentSector,
          ids.map(weightOf),
          fillAt(depth),
          circular ? undefined : angle,
          circular,
        );

      // A child may be pulled toward its parent, but not so far that it
      // crowds the neighbour it shares a boundary with: it has to keep its
      // own half-width inside its slice. Clamping to the boundary itself is
      // what let two pulled siblings meet there and overlap.
      const ownHalfAngle = (2 * packR + CHILD_GAP) / Math.max(1, childBand) / 2;
      const room = (slice: Sector): Sector => ({
        center: slice.center,
        halfSpan: Math.max(slice.halfSpan - ownHalfAngle, 0),
      });

      // Pull each child back toward its parent's own angle — the family
      // bunches on the side facing away from the grandparent, which is the
      // arrangement in the concept drawing.
      const settle = (slices: ReturnType<typeof tile>) => slices.map((s) => s.center);

      const natural = settle(tile(rawChildIds));

      // A dragged node is pinned to the angle the pointer left it at; the
      // rest keep their places and shuffle only enough to make room.
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

      // Re-tile in the order the children actually ended up in, so the slices
      // still tile and each child still sits inside its own.
      const order = rawChildIds
        .map((id, i) => ({ id, angle: relaxed[i] }))
        .sort((a, b) => angleDelta(parentSector.center, a.angle) - angleDelta(parentSector.center, b.angle));
      // A node the pointer placed keeps exactly the angle it was dropped at:
      // its slice forms *around* it and the siblings tile what's left either
      // side. Without this the tiling would drag the node off the spot the
      // drop preview promised.
      const pinnedAt = order.findIndex((c) => overrides?.get(c.id) !== undefined);
      const finalSlices =
        pinnedAt >= 0
          ? tileAround(parentSector, order.map((c) => c.id), weightOf, fillAt(depth), pinnedAt, order[pinnedAt].angle)
          : tile(order.map((c) => c.id));
      const ordered = order.map((c, i) => ({
        id: c.id,
        // Inside its slice by its own half-width, so neighbours always keep a
        // full node's arc between them.
        angle: clampToSector(shrink(room(finalSlices[i].sector)), c.angle),
        sector: finalSlices[i].sector,
      }));

      childIds = ordered.map((c) => c.id);
      childAngles = ordered.map((c) => c.angle);
      childSectors = ordered.map((c) => c.sector);
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
      // Filled in once every unit is placed and its neighbours are known.
      drawCeiling: r,
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
    const halo = haloByDepth[d] ?? radiusAt(d);
    bands.push({
      depth: d,
      radius: inner,
      outer: next != null ? (inner + halo + next) / 2 : inner + halo,
      nodeRadius: radiusAt(d),
    });
  }

  // --- how far each node may be inflated when zoomed out -------------------
  // The limit is radial: how much room there is before the next rung. It is
  // deliberately *not* the distance to the nearest sibling. Siblings are
  // packed shoulder to shoulder — CHILD_GAP apart — so a sibling-based cap
  // forbids inflation entirely wherever a cluster exists, which is everywhere
  // that matters; and capping node by node made two divisions on the same rung
  // draw at different sizes, which reads as "this one is smaller" when size is
  // the thing carrying depth. So the ceiling is uniform per rung, and a tight
  // family zoomed right out is allowed to merge into one chain of circles —
  // which is what a tight family *is*.
  for (const u of units) {
    const d = u.depth;
    const gap =
      d === 0
        ? (bandRadius[1] ?? radiusAt(0))
        : (bandRadius[d] ?? 0) - (bandRadius[d - 1] ?? 0);
    u.drawCeiling = u.r + gap * (d === 0 ? DRAW_GAP_SHARE_ROOT : DRAW_GAP_SHARE);
  }

  let extent = bands.length > 0 ? bands[bands.length - 1].outer : radiusAt(0);
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
