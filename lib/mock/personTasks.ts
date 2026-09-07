/**
 * Mock delivery-task data for the "zoom to tasks" prototype.
 *
 * There is no real work/task entity in the schema yet — see docs/ROADMAP.md
 * "The modeling gap this exposes — a missing work axis". This generator is
 * deliberately placeholder: deterministic (seeded from the person's id) so a
 * demo looks the same every time you open the same person, but entirely
 * client-side and not persisted anywhere. It exists to let customer research
 * react to the *feel* of zooming into a person's work before we commit to a
 * real work entity + join table.
 */
import type { CanvasPerson } from "@/lib/canvas/buildCanvasMap";

export type TaskStatus = "backlog" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high";

export type MockTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  points: number;
  tag: string;
};

export const STATUS_ORDER: TaskStatus[] = ["backlog", "in_progress", "review", "done"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG from a numeric seed. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERBS = [
  "Draft",
  "Review",
  "Fix",
  "Ship",
  "Investigate",
  "Automate",
  "Document",
  "Migrate",
  "Refactor",
  "Test",
  "Unblock",
  "Audit",
  "Pair on",
  "Scope",
  "Follow up on",
];

const OBJECTS = [
  "the onboarding flow",
  "the billing pipeline",
  "the vendor contract",
  "the Q3 roadmap",
  "a security review",
  "a customer escalation",
  "the sprint retro notes",
  "a compliance checklist",
  "the dashboard redesign",
  "API rate limits",
  "the hiring pipeline",
  "the release notes",
  "a flaky integration test",
  "the access-request backlog",
  "the on-call runbook",
  "a stakeholder deck",
];

const PRIORITY_WEIGHTS: [TaskPriority, number][] = [
  ["low", 0.3],
  ["medium", 0.5],
  ["high", 0.2],
];

const STATUS_WEIGHTS: [TaskStatus, number][] = [
  ["backlog", 0.32],
  ["in_progress", 0.3],
  ["review", 0.14],
  ["done", 0.24],
];

const POINTS = [1, 2, 3, 5, 8];

function weightedPick<T>(rand: () => number, weights: [T, number][]): T {
  const r = rand();
  let acc = 0;
  for (const [value, w] of weights) {
    acc += w;
    if (r <= acc) return value;
  }
  return weights[weights.length - 1][0];
}

/**
 * Deterministic mock task board for a person. `tagPool` is a list of
 * team/stream names the caller has already resolved from the real snapshot
 * (this module stays pure and knows nothing about the org graph), used to
 * flavour each card so it reads as "their work," not generic filler.
 */
export function tasksForPerson(person: CanvasPerson, tagPool: string[]): MockTask[] {
  const rand = mulberry32(hashSeed(person.id));
  const count = 4 + Math.floor(rand() * 6); // 4–9 cards
  const pool = tagPool.length > 0 ? tagPool : ["General"];
  const tasks: MockTask[] = [];
  for (let i = 0; i < count; i++) {
    const verb = VERBS[Math.floor(rand() * VERBS.length)];
    const object = OBJECTS[Math.floor(rand() * OBJECTS.length)];
    tasks.push({
      id: `${person.id}-task-${i}`,
      title: `${verb} ${object}`,
      status: weightedPick(rand, STATUS_WEIGHTS),
      priority: weightedPick(rand, PRIORITY_WEIGHTS),
      points: POINTS[Math.floor(rand() * POINTS.length)],
      tag: pool[Math.floor(rand() * pool.length)],
    });
  }
  return tasks;
}
