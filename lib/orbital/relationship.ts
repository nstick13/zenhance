/**
 * Telling a harmless geographic move from a relationship change (Greg,
 * 2026-09-21).
 *
 * Dropping something *near* things is geography. Dropping it deliberately
 * *onto* something proposes a relationship — a unit merged into another, a
 * person moved to another team — and that always asks first. The gesture has
 * four stages, and only the last one arms anything:
 *
 *   approach        nothing happens yet
 *   insertion range a gap opens between neighbours (insertion.ts)
 *   direct overlap  the dragged thing's centre is inside one target's disc:
 *                   that target holds still and begins to charge
 *   dwell or push   holding there (about a second) or pushing deep into the
 *                   target completes the charge; release now asks
 *
 * Releasing before the charge completes changes nothing. Passing over a node
 * on the way somewhere else never gets near arming it.
 */
import type { OrbitalTree } from "./model";

/** Hold over a target this long to arm the proposal… */
export const DWELL_MS = 900;
/** …or push this far into it (0 at the rim, 1 at the centre) to arm it in
 *  well under half the time. */
export const PUSH_DEPTH = 0.65;
const PUSH_BOOST = 2.5;
/** A unit starts to feel another unit before their outlines overlap. Kept in
 * screen pixels by the caller so the gesture feels the same at every zoom.
 * Widened by half on 2026-09-23 — Greg had to bring the units almost into
 * contact before anything happened. */
export const MERGE_MAGNET_PX = 45;
/** Once engaged, the pull holds until this much further out. Without the
 *  hysteresis a pointer resting on the boundary flickers in and out of
 *  contact, which is the jitter Greg saw on approach. */
export const MAGNET_RELEASE = 1.35;
/**
 * A semantic parent orbit is structural, not a measurement of where its
 * current children happened to settle.
 *
 * The gap is measured from the node's **drawn edge** and is the same number of
 * screen pixels for every unit, so a big unit and a small one offer the same
 * visible ring. Halved twice: 72 → 36 on 2026-09-23, and 36 → 18 on
 * 2026-09-24, when Greg still found it "too easy to inadvertently re-parent"
 * and asked for a ring that hugs its node.
 */
export const INTERACTION_ORBIT_MIN_PX = 18;
export const INTERACTION_ORBIT_BAND_PX = 44;

/** How far the hand may wander and still count as holding still, in world
 *  units at the scale the caller works in. Roughly a fingertip. */
export const STILL_ENOUGH = 6;

export type Relation = {
  /** The unit the dragged thing is over. */
  unitId: string;
  /** Where the hand was when this was last sampled — see trackRelation. */
  at?: { x: number; y: number };
  /** When the overlap on this unit began — the dwell is measured from here,
   *  never summed from frames. On a slow device one long frame must not be
   *  able to turn a pass into a proposal. */
  since: number;
  /** How deep the push is: 0 at the rim, 1 at the centre. */
  depth: number;
  /** 0..1 — 1 is armed: release asks. */
  charge: number;
};

export type OverlapUnit = { id: string; x: number; y: number };

export type InteractionOrbitUnit = OverlapUnit & {
  r: number;
  footprint?: number;
};

export type ReparentOrbit = {
  parentId: string;
  centre: { x: number; y: number };
  radius: number;
  width: number;
  strength: number;
  point: { x: number; y: number };
};

/** Shared client/server guard for a reporting-line move. Missing units are
 * rejected as a tenancy boundary as well as a stale-data boundary. */
export function validateReparent(
  parentById: ReadonlyMap<string, string | null>,
  unitId: string,
  parentId: string | null,
): string | null {
  if (!parentById.has(unitId)) return "Unit not found in this company";
  if (parentId === unitId) return "A unit cannot be its own parent";
  if (parentId !== null && !parentById.has(parentId)) return "Parent unit not found in this company";
  const seen = new Set<string>();
  let cursor = parentId;
  while (cursor !== null) {
    if (cursor === unitId) return "A unit cannot move beneath its own branch";
    if (seen.has(cursor)) return "The reporting structure contains a cycle";
    seen.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return null;
}

/** The orbit a parent offers to the hand. It deliberately ignores childOrbit
 * and every parent→child distance: recalculation may settle a child elsewhere. */
export function interactionOrbit(
  unit: InteractionOrbitUnit,
  scale: number,
  /** What the unit actually draws as this frame. The ring hugs what the eye
   *  sees, not the space the unit's people and work reserve underneath. */
  drawnRadius = unit.r,
): { centre: { x: number; y: number }; radius: number; width: number } {
  const inv = 1 / Math.max(scale, 1e-6);
  const body = Math.max(drawnRadius, 1);
  return {
    centre: { x: unit.x, y: unit.y },
    radius: body + INTERACTION_ORBIT_MIN_PX * inv,
    width: Math.max(INTERACTION_ORBIT_BAND_PX * inv, body * 0.3),
  };
}

/** Strongest eligible semantic parent orbit under the pointer. The current
 * parent is ordinary geography, and the carried branch is never eligible. */
export function reparentOrbitTarget(
  units: readonly InteractionOrbitUnit[],
  point: { x: number; y: number },
  scale: number,
  exclude: ReadonlySet<string>,
  currentParentId: string | null,
  /** What each unit draws as this frame, so the ring matches what is seen. */
  drawnRadius: (unitId: string) => number = () => 0,
): ReparentOrbit | null {
  let best: ReparentOrbit | null = null;
  for (const unit of units) {
    if (exclude.has(unit.id) || unit.id === currentParentId) continue;
    const orbit = interactionOrbit(unit, scale, Math.max(drawnRadius(unit.id), unit.r));
    const dx = point.x - unit.x;
    const dy = point.y - unit.y;
    const d = Math.hypot(dx, dy);
    const half = orbit.width / 2;
    const off = Math.abs(d - orbit.radius);
    if (off > half) continue;
    const strength = 1 - off / Math.max(half, 1e-6);
    const angle = d > 1e-6 ? Math.atan2(dy, dx) : 0;
    const candidate: ReparentOrbit = {
      parentId: unit.id,
      ...orbit,
      strength,
      point: {
        x: unit.x + Math.cos(angle) * orbit.radius,
        y: unit.y + Math.sin(angle) * orbit.radius,
      },
    };
    if (!best || candidate.strength > best.strength ||
      (candidate.strength === best.strength && candidate.parentId < best.parentId)) best = candidate;
  }
  return best;
}

/** Unit-on-unit magnetism begins while the outlines are still visibly apart.
 * `depth` retains the old dwell/push safety semantics: approach shows the
 * bridge, but only a deep push accelerates arming. */
export function magneticMergeTarget(
  units: readonly OverlapUnit[],
  point: { x: number; y: number },
  draggedRadius: number,
  drawnRadius: (unitId: string) => number,
  exclude: ReadonlySet<string>,
  scale: number,
  /** The unit already engaged, which keeps its hold a little longer. */
  engagedWith: string | null = null,
): ({ unitId: string; depth: number; strength: number; centre: { x: number; y: number }; radius: number } | null) {
  const reach = MERGE_MAGNET_PX / Math.max(scale, 1e-6);
  let best: { unitId: string; depth: number; strength: number; centre: { x: number; y: number }; radius: number; d: number } | null = null;
  for (const unit of units) {
    if (exclude.has(unit.id)) continue;
    const r = drawnRadius(unit.id);
    if (r <= 0) continue;
    const d = Math.hypot(point.x - unit.x, point.y - unit.y);
    const touching = draggedRadius + r;
    const hold = unit.id === engagedWith ? reach * MAGNET_RELEASE : reach;
    if (d > touching + hold) continue;
    const strength = 1 - Math.max(0, d - touching) / Math.max(reach, 1e-6);
    const depth = Math.max(0, Math.min(1, (touching - d) / Math.max(touching, 1e-6)));
    const candidate = { unitId: unit.id, depth, strength, centre: { x: unit.x, y: unit.y }, radius: r, d };
    if (!best || candidate.strength > best.strength ||
      (candidate.strength === best.strength && candidate.d < best.d)) best = candidate;
  }
  if (!best) return null;
  const { d: _d, ...result } = best;
  return result;
}

/** Pull a held unit to the point where the two surfaces kiss. Under reduced
 * motion it arrives immediately; otherwise proximity controls the pull and
 * the carried descendants visibly spring after it. */
export function magneticPosition(
  point: { x: number; y: number },
  target: { centre: { x: number; y: number }; radius: number; strength: number },
  draggedRadius: number,
  reducedMotion: boolean,
): { x: number; y: number } {
  const dx = point.x - target.centre.x;
  const dy = point.y - target.centre.y;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return point;
  const kiss = target.radius + draggedRadius;
  const desired = {
    x: target.centre.x + dx / d * kiss,
    y: target.centre.y + dy / d * kiss,
  };
  // Continuous from nothing at the edge of reach. A pull that started at some
  // fixed fraction made the unit jump the instant it engaged, and flicker
  // whenever the hand hovered on the boundary.
  const eased = target.strength * target.strength * (3 - 2 * target.strength);
  const pull = reducedMotion ? 1 : 0.85 * eased;
  return { x: point.x + (desired.x - point.x) * pull, y: point.y + (desired.y - point.y) * pull };
}

export type MetaballBridge = {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
  p4: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  c3: { x: number; y: number };
  c4: { x: number; y: number };
};

/** The kissing bridge from the earlier grow study, expressed as canvas-ready
 * points so the Konva renderer and pure tests share the exact geometry. */
export function metaballBridge(
  a: { x: number; y: number; r: number },
  b: { x: number; y: number; r: number },
  maxGap = Math.max(a.r, b.r),
): MetaballBridge | null {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const d = Math.hypot(vx, vy);
  if (d === 0 || d <= Math.abs(a.r - b.r) || d > a.r + b.r + maxGap) return null;
  const v = 0.5;
  const handle = 2.4;
  let u1 = 0;
  let u2 = 0;
  if (d < a.r + b.r) {
    u1 = Math.acos(Math.min(1, Math.max(-1, (a.r * a.r + d * d - b.r * b.r) / (2 * a.r * d))));
    u2 = Math.acos(Math.min(1, Math.max(-1, (b.r * b.r + d * d - a.r * a.r) / (2 * b.r * d))));
  }
  const between = Math.atan2(vy, vx);
  const maxSpread = Math.acos(Math.min(1, Math.max(-1, (a.r - b.r) / d)));
  const a1 = between + u1 + (maxSpread - u1) * v;
  const a2 = between - u1 - (maxSpread - u1) * v;
  const a3 = between + Math.PI - u2 - (Math.PI - u2 - maxSpread) * v;
  const a4 = between - Math.PI + u2 + (Math.PI - u2 - maxSpread) * v;
  const pt = (c: { x: number; y: number }, angle: number, radius: number) => ({
    x: c.x + Math.cos(angle) * radius,
    y: c.y + Math.sin(angle) * radius,
  });
  const p1 = pt(a, a1, a.r);
  const p2 = pt(a, a2, a.r);
  const p3 = pt(b, a3, b.r);
  const p4 = pt(b, a4, b.r);
  const total = a.r + b.r;
  const base = Math.min(v * handle, Math.hypot(p3.x - p1.x, p3.y - p1.y) / total);
  const f = base * Math.min(1, d * 2 / total);
  const h1 = a.r * f;
  const h2 = b.r * f;
  return {
    p1, p2, p3, p4,
    c1: pt(p1, a1 - Math.PI / 2, h1),
    c2: pt(p3, a3 + Math.PI / 2, h2),
    c3: pt(p4, a4 - Math.PI / 2, h2),
    c4: pt(p2, a2 + Math.PI / 2, h1),
  };
}

/** The unit whose drawn disc the point sits inside, nearest centre first.
 *  Only a real overlap counts — brushing a rim is not deliberate. */
export function overlapTarget(
  units: readonly OverlapUnit[],
  point: { x: number; y: number },
  drawnRadius: (unitId: string) => number,
  exclude: ReadonlySet<string>,
): { unitId: string; depth: number } | null {
  let best: { unitId: string; depth: number; d: number } | null = null;
  for (const u of units) {
    if (exclude.has(u.id)) continue;
    const r = drawnRadius(u.id);
    if (r <= 0) continue;
    const d = Math.hypot(point.x - u.x, point.y - u.y);
    if (d >= r) continue;
    if (!best || d < best.d) best = { unitId: u.id, depth: 1 - d / r, d };
  }
  return best ? { unitId: best.unitId, depth: best.depth } : null;
}

/** Where the gesture stands at `now`. A new target starts the clock again;
 *  no target means nothing is building. Called on every pointer event and
 *  every frame, but it only ever reads the clock — so how often it is called
 *  cannot change the answer. */
export function trackRelation(
  previous: Relation | null,
  over: { unitId: string; depth: number } | null,
  now: number,
  /** Where the hand is. A dwell is a *hold*: while the hand is still
   *  travelling the clock keeps restarting, so passing across a unit on the
   *  way somewhere else can never arm a proposal however long the journey
   *  takes. Omit it and only the target's identity restarts the clock. */
  at?: { x: number; y: number },
): Relation | null {
  if (!over) return null;
  const sameTarget = previous?.unitId === over.unitId;
  const travelled = at && previous?.at
    ? Math.hypot(at.x - previous.at.x, at.y - previous.at.y) > STILL_ENOUGH
    : false;
  const since = sameTarget && !travelled ? previous!.since : now;
  const needed = over.depth >= PUSH_DEPTH ? DWELL_MS / (1 + PUSH_BOOST) : DWELL_MS;
  return {
    unitId: over.unitId,
    since,
    at,
    depth: over.depth,
    charge: Math.min(1, Math.max(0, now - since) / needed),
  };
}

/** The same relation, its charge read again at `now` (the pointer hasn't
 *  moved, but time has). */
export const chargeAt = (relation: Relation | null, now: number): Relation | null =>
  relation ? trackRelation(relation, relation, now) : null;

export const isArmed = (relation: Relation | null): boolean => !!relation && relation.charge >= 1;

export type BranchImpact = {
  /** Units below it that are not teams. */
  childUnits: number;
  /** Teams below it (not counting itself). */
  teams: number;
  /** Everyone in the branch, each person once however many seats they hold. */
  people: number;
};

/** What travels with a unit in a merge: its whole branch. */
export function branchImpact(
  tree: OrbitalTree,
  unitId: string,
  kindOf: (unitId: string) => "group" | "team" | undefined,
): BranchImpact {
  let childUnits = 0;
  let teams = 0;
  const people = new Set<string>();
  const stack = [unitId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const unit = tree.units.get(id);
    if (!unit) continue;
    if (id !== unitId) {
      if (kindOf(id) === "team") teams++;
      else childUnits++;
    }
    for (const seatId of unit.seatIds) {
      const personId = tree.seats.get(seatId)?.personId;
      if (personId) people.add(personId);
    }
    stack.push(...unit.childIds);
  }
  return { childUnits, teams, people: people.size };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The confirmation's words, in plain language (Greg, 2026-09-21). */
export function mergeCopy(from: string, into: string, impact: BranchImpact): { title: string; body: string } {
  const parts = [
    impact.childUnits > 0 ? plural(impact.childUnits, "child unit", "child units") : null,
    impact.teams > 0 ? plural(impact.teams, "team", "teams") : null,
    plural(impact.people, "person", "people"),
  ].filter((p): p is string => !!p);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const hasBranch = impact.childUnits + impact.teams > 0;
  return {
    title: `Merge "${from}" into "${into}"?`,
    body: hasBranch
      ? `${from} carries its entire branch: ${list}. They will all remain together beneath the merged unit. ` +
        `To merge only ${from}, cancel and reassign its child units first.`
      : `${from} has no units below it. It holds ${list}.`,
  };
}
