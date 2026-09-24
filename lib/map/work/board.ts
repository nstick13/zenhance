/**
 * The work engine — how work reads at a human level (docs/ENGINES.md § Work).
 *
 * Greg's question for this engine is "how is work displayed at a human
 * level?", and the answer the map gives is: as a person's *board*. Not a
 * burndown, not a percentage — the actual items someone is carrying, in an
 * order a human would put them in, coloured by what state they are in.
 *
 * ## What this is not
 *
 * It is not the rings. A unit's delivery and sprint rings answer "what is
 * this node telling me", which is the **signal** engine's question, and
 * signal reads the same tasks for itself. The two are siblings and must not
 * import each other — so the tasks themselves live in `lib/mock/personTasks`,
 * below both.
 *
 * It is also not how much *room* work needs. `WORK_CAPSULE_*` and
 * `SEAT_RING_STEP` are in `lib/map/layout/geometry.ts` because the layout has
 * to reserve space for a person's furniture before anything is drawn; a ring
 * whose spacing ignored the capsules would overlap them. Those are layout's
 * numbers, and work reads them rather than owning them.
 *
 * ## Provenance
 *
 * Every task here is invented (`lib/mock/personTasks.ts`). There is no
 * tracker integration, the UI says so, and nothing in this file should ever
 * make a mock figure look measured.
 */
import {
  STATUS_ORDER,
  type MockTask,
  type TaskStatus,
} from "@/lib/mock/personTasks";

/** Which states count as "someone is actually on this right now". */
export const IN_FLIGHT: readonly TaskStatus[] = ["in_progress", "review"];

export const isInFlight = (status: TaskStatus): boolean => IN_FLIGHT.includes(status);
export const isDone = (status: TaskStatus): boolean => status === "done";

/** A person's board, summarised for the map rather than for a report. */
export type BoardSummary = {
  total: number;
  done: number;
  inFlight: number;
  backlog: number;
  /** Story points not yet finished — what is still owed. */
  pointsRemaining: number;
};

export function summarise(tasks: readonly MockTask[]): BoardSummary {
  let done = 0, inFlight = 0, backlog = 0, pointsRemaining = 0;
  for (const t of tasks) {
    if (isDone(t.status)) done += 1;
    else {
      pointsRemaining += t.points;
      if (isInFlight(t.status)) inFlight += 1;
      else backlog += 1;
    }
  }
  return { total: tasks.length, done, inFlight, backlog, pointsRemaining };
}

/**
 * The statuses of a person's items, in the order they are drawn around them.
 *
 * Board order, not status order: the dots ring a person in the sequence they
 * were given, so that watching one turn from indigo to cyan reads as *that
 * item* finishing rather than the whole ring reshuffling. Sorting here would
 * make every completion look like a change of everything.
 */
export const statusRing = (tasks: readonly MockTask[]): TaskStatus[] =>
  tasks.map((t) => t.status);

/** Group a board into columns, for the panel that shows the whole thing. */
export function columns(tasks: readonly MockTask[]): { status: TaskStatus; tasks: MockTask[] }[] {
  return STATUS_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((t) => t.status === status),
  }));
}

/**
 * The teams a person's board should be flavoured with.
 *
 * Only the units they actually sit on. Handing the board the whole org would
 * be a lie about who they work with, and "General" is the honest answer for
 * someone with no seat rather than an empty list that reads as an error.
 */
export function boardTeams(
  seats: readonly { personId: string | null; unitId: string }[],
  nameOf: (unitId: string) => string | undefined,
  personId: string,
): string[] {
  const names = seats
    .filter((s) => s.personId === personId)
    .map((s) => nameOf(s.unitId))
    .filter((n): n is string => !!n);
  return names.length > 0 ? [...new Set(names)] : ["General"];
}

/** Whole boards for everyone, or nothing at all.
 *
 *  Deliberately all-or-nothing on `enabled`: a real workspace shows no work
 *  rather than invented work, and a half-populated map would read as "these
 *  people have nothing on", which is worse than showing nothing. */
export function boardsFor<P extends { id: string }>(
  people: readonly P[],
  tagPool: readonly string[],
  make: (person: P, tags: string[]) => MockTask[],
  enabled: boolean,
): Map<string, MockTask[]> {
  const map = new Map<string, MockTask[]>();
  if (!enabled) return map;
  const tags = [...tagPool];
  for (const p of people) map.set(p.id, make(p, tags));
  return map;
}
