/**
 * Orbital geometry — the pure maths behind the orbital map (Greg,
 * 2026-09-13). No React, no Konva, no data model: just the two rules the
 * whole feel rests on.
 *
 *   1. **Radius is a function of depth.** Concentric bands centred on the
 *      company, one per rung — "more like the CEO+(x) hierarchy". Every
 *      node on a band is the same distance from the centre, whoever its
 *      parent is.
 *   2. **Angle is a function of parent.** A node owns an angular sector;
 *      its children pack tightly around the node's *own* angle inside that
 *      sector. Because a child shares its parent's angle at a bigger
 *      radius, it lands outboard of the parent on the side away from the
 *      grandparent — which is the arrangement in the concept drawing,
 *      falling out of the rule rather than being special-cased.
 *
 * Together they make snapping parent-relative rather than grid-relative:
 * angle says who you belong to, radius says which rung you're on.
 *
 * Sectors are carried as `{ center, halfSpan }` rather than `{ start, end }`
 * so containment is a single wrapped-delta comparison and never needs a
 * branch for the sector that straddles ±π.
 */

export type Point = { x: number; y: number };

/** A slice of angle around the origin: everything within `halfSpan` of `center`. */
export type Sector = { center: number; halfSpan: number };

export const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const polar = (angle: number, radius: number): Point => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius,
});

export const angleOf = (p: Point): number => Math.atan2(p.y, p.x);
export const radiusOf = (p: Point): number => Math.hypot(p.x, p.y);

/** Wrap any angle into (-π, π]. */
export function normalizeAngle(a: number): number {
  const x = (a + Math.PI) % TAU;
  return (x <= 0 ? x + TAU : x) - Math.PI;
}

/** Shortest signed rotation from `a` to `b`, in (-π, π]. */
export const angleDelta = (a: number, b: number): number => normalizeAngle(b - a);

export const fullSector = (): Sector => ({ center: 0, halfSpan: Math.PI });

export const sectorContains = (s: Sector, angle: number): boolean =>
  Math.abs(angleDelta(s.center, angle)) <= s.halfSpan + 1e-9;

/** Pull `angle` into the sector, returning the nearest angle it allows. */
export function clampToSector(s: Sector, angle: number): number {
  const d = angleDelta(s.center, angle);
  if (Math.abs(d) <= s.halfSpan) return normalizeAngle(angle);
  return normalizeAngle(s.center + Math.sign(d) * s.halfSpan);
}

// --- sizes -----------------------------------------------------------------
// Read off the concept drawing: company 165, first rung 72, second 48. Each
// rung keeps shrinking so a deep org still reads as a hierarchy rather than a
// field of equal dots, with a floor so it never becomes a speck.

export const ROOT_RADIUS = 165;
const DEPTH_RADII = [ROOT_RADIUS, 72, 48, 36];
const DEEP_SHRINK = 0.82;
const MIN_UNIT_RADIUS = 20;

export function unitRadius(depth: number): number {
  const d = Math.max(0, Math.round(depth));
  if (d < DEPTH_RADII.length) return DEPTH_RADII[d];
  const beyond = d - (DEPTH_RADII.length - 1);
  const last = DEPTH_RADII[DEPTH_RADII.length - 1];
  return Math.max(MIN_UNIT_RADIUS, Math.round(last * DEEP_SHRINK ** beyond));
}

/** A person orbiting the unit they belong to. */
export const SEAT_RADIUS = 9.5;
export const SEAT_GAP = 10;
/** Clear space between the unit's edge and the seat ring. Generous, because
 *  at close zoom the people carry capsules and labels that need air (Greg,
 *  2026-09-14: "the spacings... needs to be increased"). */
export const SEAT_ORBIT_GAP = 38;
/** Seats fan across the outward side only — never a full collar. */
export const SEAT_MAX_SPAN = 200 * DEG;
/** A second seat ring has to clear the *furniture* of the first, not just its
 *  circles: a person's work capsule reaches a long way outward, and a ring
 *  spaced only by seat width lands its people straight through it (Greg,
 *  2026-09-14 — the crowding at detail zoom). Defined below, once the capsule
 *  constants exist. */

/** A work item orbiting a person, as a dot in the far view. */
export const WORK_RADIUS = 3;
export const WORK_COL_GAP = 8.5;
export const WORK_ROW_GAP = 7.5;
export const WORK_START_GAP = 9;

/** The capsule that holds a person's whole board between 1.75x and 3.5x —
 *  one semitransparent object lying along their radial axis, which resolves
 *  into the dots above (Greg, 2026-09-14). */
export const WORK_CAPSULE_W = 15;
export const WORK_CAPSULE_GAP = 11;
export const WORK_CAPSULE_PER_ITEM = 9;
export const WORK_CAPSULE_MIN = 22;

export const workCapsuleLength = (count: number): number =>
  count <= 0 ? 0 : WORK_CAPSULE_MIN + count * WORK_CAPSULE_PER_ITEM;

/** Clear space between one band's outermost content and the next band's nodes. */
export const BAND_PAD = 78;

/** How far a person's own furniture reaches beyond them: the capsule holding
 *  their board, which is the longest thing they carry. */
export const seatFurnitureReach = (workCount: number): number =>
  workCount > 0 ? SEAT_RADIUS + WORK_CAPSULE_GAP + workCapsuleLength(workCount) : SEAT_RADIUS;

/** Gap between one seat ring and the next — wide enough that the inner ring's
 *  work never reaches the outer ring's people. */
export const SEAT_RING_STEP = 2 * SEAT_RADIUS + WORK_CAPSULE_GAP + workCapsuleLength(8) + 12;

export const seatRingRadius = (unitR: number, ring = 0): number =>
  unitR + SEAT_ORBIT_GAP + SEAT_RADIUS + ring * SEAT_RING_STEP;

/** How far a unit's own furniture — its seat rings, and the work those people
 *  carry — reaches past its centre. The work matters: leaving it out is what
 *  left the detail rungs too tight while the upper ones sprawled. */
export const unitOuterExtent = (unitR: number, seatRings: number, workReach = 0): number =>
  seatRings > 0 ? seatRingRadius(unitR, seatRings - 1) + Math.max(SEAT_RADIUS, workReach) : unitR;

/** How far a seat's work grid reaches past the seat's centre. */
export const workOuterExtent = (workCount: number): number =>
  workCount > 0
    ? SEAT_RADIUS + WORK_START_GAP + (Math.ceil(workCount / 2) - 1) * WORK_ROW_GAP + WORK_RADIUS
    : SEAT_RADIUS;

// --- ring packing ----------------------------------------------------------

/** The angular step that puts circles of `itemRadius` side by side with `gap`
 *  of clear space between their edges, on a ring of `ringRadius`. */
export const angularStep = (itemRadius: number, gap: number, ringRadius: number): number =>
  (2 * itemRadius + gap) / Math.max(1, ringRadius);

/**
 * Angles for `count` items packed shoulder to shoulder and centred on
 * `center`. They compress to fit `maxSpan` rather than overflowing it, so a
 * cluster never bleeds into its neighbour's sector — the tight-clusters-with-
 * gaps look in the concept drawing comes from packing by arc length and
 * leaving the rest of the sector empty, not from spreading to fill it.
 */
export function packRing(
  count: number,
  itemRadius: number,
  gap: number,
  ringRadius: number,
  center: number,
  maxSpan: number,
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [normalizeAngle(center)];
  const natural = angularStep(itemRadius, gap, ringRadius);
  // Shoulder to shoulder is right when the sector is snug. But a deep org has
  // rungs whose sectors are enormous compared to what a handful of siblings
  // need, and packing them at the minimum there funnels the whole company
  // into a couple of thin radial spikes. So a cluster may open out — never
  // past half its sector, and never more than a few times its natural
  // spacing, which leaves a snug cluster (and the small-org look) untouched.
  const roomy = Math.min(natural * SPREAD_LIMIT, (maxSpan * SPREAD_SECTOR_CAP) / (count - 1));
  const step = Math.min(Math.max(natural, roomy), maxSpan / (count - 1));
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => normalizeAngle(center + (i - half) * step));
}

/** How far past shoulder-to-shoulder a cluster may open when it has room, and
 *  the most of its sector it may ever occupy — together these keep "tight
 *  clusters, wide gaps" true while letting a sparse deep org breathe. */
const SPREAD_LIMIT = 2.5;
const SPREAD_SECTOR_CAP = 0.35;

/** Evenly spread `count` items around a whole circle — what the company's own
 *  children get, since the centre has no "outward" direction to cluster on. */
export function spreadRing(count: number, startAngle = -Math.PI / 2): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => normalizeAngle(startAngle + (i * TAU) / count));
}

/**
 * Push siblings apart until none is closer than `minSeparation` to its
 * neighbour. Needed because a dragged node is pinned to the angle it was
 * dropped at while its siblings are still laid out by the packer — and the
 * arrival of a new sibling can move the others onto the very spot the drop
 * chose. Pinned angles resist being moved but will still give way rather
 * than let two nodes occupy one place.
 *
 * `circular` closes the loop, for a ring whose children wrap the full
 * circle (the company's own); otherwise the ends are left free.
 */
export function relaxAngles(
  angles: number[],
  minSeparation: number,
  pinned: boolean[] = [],
  circular = false,
  iterations = 48,
): number[] {
  const n = angles.length;
  if (n < 2) return [...angles];
  // Nothing can be spread wider than the circle itself.
  const sep = circular ? Math.min(minSeparation, TAU / n) : minSeparation;
  const out = angles.map(normalizeAngle);
  // A pinned angle is the user's own placement: it doesn't give ground. The
  // free siblings absorb the whole shift instead.
  const weight = (i: number) => (pinned[i] ? 0 : 1);
  // Gaps must be measured the long way round when that is the way round they
  // actually go: the last node's gap back to the first spans most of the
  // circle, and normalizing it into (-π, π] would read as "overlapping" and
  // crush the ring together.
  const forwardGap = (from: number, to: number) => {
    const g = (to - from) % TAU;
    return g < 0 ? g + TAU : g;
  };

  for (let pass = 0; pass < iterations; pass++) {
    const anchor = out[0];
    const order = out
      .map((a, i) => ({ i, key: forwardGap(anchor, a) }))
      .sort((p, q) => p.key - q.key)
      .map((p) => p.i);

    let settled = true;
    const pairs = circular ? order.length : order.length - 1;
    for (let k = 0; k < pairs; k++) {
      const a = order[k];
      const b = order[(k + 1) % order.length];
      if (a === b) continue;
      const shortfall = sep - forwardGap(out[a], out[b]);
      if (shortfall <= 1e-6) continue;
      settled = false;
      let wa = weight(a);
      let wb = weight(b);
      // Two pinned neighbours have to share the move, or neither ever yields.
      if (wa + wb === 0) {
        wa = 1;
        wb = 1;
      }
      const total = wa + wb;
      out[a] = normalizeAngle(out[a] - (shortfall * wa) / total);
      out[b] = normalizeAngle(out[b] + (shortfall * wb) / total);
    }
    if (settled) break;
  }
  return out;
}

/**
 * Guard for a weight, nothing more. Weights arrive as angular need in radians
 * — fractions well below 1 — so this must not round them up to a floor of 1,
 * which would hand every sibling an identical slice and throw away the
 * proportionality the whole layout depends on.
 */
export const weightShare = (weight: number): number => Math.max(weight, 1e-9);

/**
 * Divide a sector between children in proportion to how much of the org sits
 * under each — the rule that makes a deep company tractable (Greg,
 * 2026-09-14: "size the concentric circles according to... the number of teams
 * they contain").
 *
 * The alternative — giving every child the same slice, or slicing at the
 * midpoints between wherever they happen to sit — makes a node's share shrink
 * geometrically with depth, so an eleven-rung org needs an exponentially
 * growing radius to fit anything. Proportional shares shrink only as fast as
 * the org actually branches, which is linear in the number of teams.
 *
 * `fill` leaves a margin at each end, so families still read as clusters with
 * gaps between them rather than one unbroken ring.
 */
export function subdivideByWeight(
  parent: Sector,
  weights: number[],
  fill = 1,
  focus?: number,
  /** Fill the sector whatever the need — what the company's own ring does,
   *  since its children wrap the circle rather than cluster on one side. */
  stretch = false,
): { sector: Sector; center: number }[] {
  const n = weights.length;
  if (n === 0) return [];
  const shaped = weights.map(weightShare);
  const total = shaped.reduce((sum, w) => sum + w, 0);
  const available = parent.halfSpan * 2 * fill;

  // Slices are the width each child actually needs. When the sector is roomier
  // than the family — a small org, where a stream's three teams need a sliver
  // of the ninety degrees it owns — the surplus is simply left empty, which is
  // what makes families read as clusters with gaps between them. Only when the
  // need exceeds the room does everything compress to fit.
  const scale = stretch || total > available ? available / total : 1;
  const blockSpan = total * scale;

  // Centre the block on the parent itself, so its children sit outboard of it
  // rather than spread across a sector it happens to own.
  const slack = Math.max(available - blockSpan, 0) / 2;
  const offset = focus === undefined ? 0 : Math.max(-slack, Math.min(slack, angleDelta(parent.center, focus)));
  let cursor = parent.center + offset - blockSpan / 2;

  return shaped.map((w) => {
    const slice = w * scale;
    const center = normalizeAngle(cursor + slice / 2);
    cursor += slice;
    return { sector: { center, halfSpan: slice / 2 }, center };
  });
}

/**
 * Sectors for children that wrap the whole circle — each one owns the angle
 * from the midpoint behind it to the midpoint ahead, so uneven spacing still
 * divides cleanly and there is no seam at ±π. Children must be in circular
 * ascending order.
 */
export function subdivideCircle(childAngles: number[]): Sector[] {
  const n = childAngles.length;
  if (n === 0) return [];
  if (n === 1) return [{ center: normalizeAngle(childAngles[0]), halfSpan: Math.PI }];
  return childAngles.map((a, i) => {
    const behind = normalizeAngle(a - childAngles[(i - 1 + n) % n]);
    const ahead = normalizeAngle(childAngles[(i + 1) % n] - a);
    const lo = -Math.abs(behind) / 2;
    const hi = Math.abs(ahead) / 2;
    return { center: normalizeAngle(a + (lo + hi) / 2), halfSpan: (hi - lo) / 2 };
  });
}

/**
 * Split `parent` into one sector per child, cutting at the midpoint between
 * adjacent children so each child's descendants get the empty angle beside it
 * without ever reaching into a sibling's. Children must be given in ascending
 * angular order around the parent's centre.
 */
export function subdivideSector(parent: Sector, childAngles: number[]): Sector[] {
  const n = childAngles.length;
  if (n === 0) return [];
  if (n === 1) return [{ center: childAngles[0], halfSpan: parent.halfSpan }];
  // Work in offsets from the parent's centre so the ±π seam can't split a run.
  const offsets = childAngles.map((a) => angleDelta(parent.center, a));
  return offsets.map((off, i) => {
    const lowEdge = i === 0 ? -parent.halfSpan : (offsets[i - 1] + off) / 2;
    const highEdge = i === n - 1 ? parent.halfSpan : (off + offsets[i + 1]) / 2;
    return {
      center: normalizeAngle(parent.center + (lowEdge + highEdge) / 2),
      halfSpan: Math.max(0, (highEdge - lowEdge) / 2),
    };
  });
}

/**
 * A person's work items: two abreast, rows marching straight out along the
 * line that joins them to their unit (Greg, 2026-09-13 — "the axis of the
 * grid on the same axis defining the connection line between human and
 * parent"). An odd last item rides the axis itself.
 */
function gridPoints(
  count: number,
  seat: Point,
  axis: number,
  startGap: number,
  colGap: number,
  rowGap: number,
): Point[] {
  if (count <= 0) return [];
  const ux = Math.cos(axis);
  const uy = Math.sin(axis);
  const odd = count % 2 === 1;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 2);
    const lone = odd && i === count - 1;
    const lateral = lone ? 0 : (i % 2 === 0 ? -0.5 : 0.5) * colGap;
    const along = SEAT_RADIUS + startGap + row * rowGap;
    return {
      x: seat.x + ux * along - uy * lateral,
      y: seat.y + uy * along + ux * lateral,
    };
  });
}

/** The tight dot grid, for when work is a texture rather than a list. */
export function workGridPoints(count: number, seat: Point, axis: number): Point[] {
  return gridPoints(count, seat, axis, WORK_START_GAP, WORK_COL_GAP, WORK_ROW_GAP);
}

