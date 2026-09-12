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
 *
 * Projected value (Greg, 2026-09-12): each card carries an illustrative
 * dollar value — standing for a Jira ticket, a piece of client work, or an
 * actual produced unit (componentry, a manufactured part). Some cards are
 * deliberately valueless-but-necessary instead — a component that's never
 * sold on its own but the end product can't exist without (a screw, a
 * doll's hand) — carrying a note instead of a number. `producedValue` sums
 * only the priced cards, which is what lets a parent node's "value to
 * company" line mean something real relative to what's on screen.
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
  /** Illustrative dollar value of this piece of work, or null when it's
   *  necessary-but-not-directly-sold (see `essentialNote`). */
  value: number | null;
  /** Set only when `value` is null — why this exists despite carrying no
   *  price of its own. */
  essentialNote: string | null;
};

export const STATUS_ORDER: TaskStatus[] = ["backlog", "in_progress", "review", "done"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

/** How many "in orbit" work-item circles a person shows at the deepest
 *  zoom rung, at most — Greg's cap, so a busy person doesn't ring themself
 *  with fifty dots. */
export const MAX_ORBIT_CARDS = 10;

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

/** Flavour for the ~1-in-4 cards that carry no price of their own — the
 *  "barbie doll hand" case: a necessary part of something bigger. */
const ESSENTIAL_NOTES = [
  "A necessary part of the larger deliverable — not sold on its own.",
  "Internal groundwork the finished product depends on, but nothing a customer buys directly.",
  "Compulsory for the end result to work, even though it carries no price of its own.",
  "Supports what the team sells without being sellable itself.",
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

/** Roughly a quarter of cards are essential-but-valueless rather than priced. */
const ESSENTIAL_CHANCE = 0.25;
const VALUE_MIN = 400;
const VALUE_MAX = 6000;

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
    const essential = rand() < ESSENTIAL_CHANCE;
    tasks.push({
      id: `${person.id}-task-${i}`,
      title: `${verb} ${object}`,
      status: weightedPick(rand, STATUS_WEIGHTS),
      priority: weightedPick(rand, PRIORITY_WEIGHTS),
      points: POINTS[Math.floor(rand() * POINTS.length)],
      tag: pool[Math.floor(rand() * pool.length)],
      value: essential ? null : Math.round(VALUE_MIN + rand() * (VALUE_MAX - VALUE_MIN)),
      essentialNote: essential ? ESSENTIAL_NOTES[Math.floor(rand() * ESSENTIAL_NOTES.length)] : null,
    });
  }
  return tasks;
}

/** The cards a person's orbit actually shows: in-progress only, capped at
 *  MAX_ORBIT_CARDS — "what they produce right now," not their whole backlog. */
export function inProgressCards(tasks: MockTask[]): MockTask[] {
  return tasks.filter((t) => t.status === "in_progress").slice(0, MAX_ORBIT_CARDS);
}

/** Sum of priced (non-essential) in-progress cards — the figure a parent
 *  node's "value to company" rolls up from. Essential cards contribute 0
 *  deliberately: they're necessary, not a line of revenue. */
export function producedValue(tasks: MockTask[]): number {
  return inProgressCards(tasks).reduce((sum, t) => sum + (t.value ?? 0), 0);
}
