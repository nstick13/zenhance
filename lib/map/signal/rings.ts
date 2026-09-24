/**
 * Gathering what a node is telling you (docs/ENGINES.md § Signal).
 *
 * `progress.ts` next door holds the arithmetic — what a ratio means, where
 * the wellbeing thresholds sit. This file holds the *gathering*: which
 * people a unit's rings speak for, and which numbers are allowed to exist.
 *
 * Greg's question for this engine is "what information should a node show?".
 * A unit's rings answer it for the whole branch beneath that unit, not just
 * the people sitting directly on it — "overall work item completedness for an
 * entire team" (2026-09-14). A team lead's ring that ignored their teams
 * would be the most misleading number on the map.
 *
 * Signal reads work but is not the work engine: capsules, dots and the board
 * are how work reads at a human level, and they are a sibling. Both take
 * their tasks from `lib/mock/personTasks`, below them both, so neither has to
 * know about the other.
 */
import type { MockTask } from "@/lib/mock/personTasks";
import {
  personVitals,
  seatProgress,
  unitProgress,
  type PersonVitals,
  type SeatProgress,
  type UnitProgress,
} from "./progress";

/** What a unit's rings need from one person in its branch. */
export type Member = { tasks: MockTask[]; health: number | null };

/** The shape signal needs from a tree. Structural on purpose: the rings can
 *  be tested without building a scene. */
export type BranchSource = {
  childrenOf: (unitId: string) => readonly string[];
  seatsOf: (unitId: string) => readonly { personId: string | null }[];
};

/**
 * Everyone whose work a unit's rings speak for: its own seated people, plus
 * everyone below it.
 *
 * Cycle-guarded. The tree should never contain one — `relationship.ts`
 * refuses a reparent that would — but this walk used to recurse with no
 * guard at all, so a single bad row would have hung the render thread rather
 * than drawing a wrong number. A hang is not a bug you can see in a
 * screenshot.
 */
export function branchMembers(
  unitId: string,
  source: BranchSource,
  boards: ReadonlyMap<string, MockTask[]>,
  healthOf: (personId: string) => number | null,
): Member[] {
  const out: Member[] = [];
  const seen = new Set<string>();
  const stack = [unitId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const seat of source.seatsOf(id)) {
      if (!seat.personId) continue;
      out.push({ tasks: boards.get(seat.personId) ?? [], health: healthOf(seat.personId) });
    }
    stack.push(...source.childrenOf(id));
  }
  return out;
}

/**
 * Health has no column yet.
 *
 * The schema records no explicit health observation, so there is nothing
 * honest to show on a real workspace. Demo fixtures may illustrate what the
 * ring would say, using wellbeing as a stand-in; a real org gets null, and
 * `unitProgress` renders null as "no measurement" rather than as zero.
 *
 * This is the rule that keeps an invented number from ever reading as a
 * measured one — see AGENTS.md, and the provenance note in progress.ts.
 */
export const healthSource = (
  illustrative: boolean,
  vitals: ReadonlyMap<string, PersonVitals>,
) => (personId: string): number | null =>
  illustrative ? (vitals.get(personId)?.wellbeing ?? null) : null;

/** The person fields vitals are read from — the real columns on `people`,
 *  not the whole row, so this stays testable without the schema. */
export type VitalPerson = {
  id: string;
  startDate?: string | Date | null;
  lastVacationAt?: string | Date | null;
  costPerMonth?: string | number | null;
};

export function vitalsFor<P extends VitalPerson>(
  people: readonly P[],
  allocationPct: ReadonlyMap<string, number>,
  now: Date,
  fallbackAllocation = 100,
): Map<string, PersonVitals> {
  const map = new Map<string, PersonVitals>();
  for (const p of people) {
    map.set(p.id, personVitals(p, allocationPct.get(p.id) ?? fallbackAllocation, now));
  }
  return map;
}

/** The arc around each person: their own board, and nobody else's. */
export function seatRingsFor(
  seats: readonly { id: string; personId: string | null }[],
  boards: ReadonlyMap<string, MockTask[]>,
): Map<string, SeatProgress> {
  const map = new Map<string, SeatProgress>();
  for (const seat of seats) {
    map.set(seat.id, seatProgress(seat.personId ? (boards.get(seat.personId) ?? []) : []));
  }
  return map;
}

/** The three rings each unit wears, covering its whole branch. */
export function unitRingsFor(
  unitIds: readonly string[],
  source: BranchSource,
  boards: ReadonlyMap<string, MockTask[]>,
  healthOf: (personId: string) => number | null,
): Map<string, UnitProgress> {
  const map = new Map<string, UnitProgress>();
  for (const id of unitIds) {
    map.set(id, unitProgress(branchMembers(id, source, boards, healthOf)));
  }
  return map;
}
