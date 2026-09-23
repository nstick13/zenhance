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

export type Relation = {
  /** The unit the dragged thing is over. */
  unitId: string;
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
): Relation | null {
  if (!over) return null;
  const since = previous && previous.unitId === over.unitId ? previous.since : now;
  const needed = over.depth >= PUSH_DEPTH ? DWELL_MS / (1 + PUSH_BOOST) : DWELL_MS;
  return { unitId: over.unitId, since, depth: over.depth, charge: Math.min(1, Math.max(0, now - since) / needed) };
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
