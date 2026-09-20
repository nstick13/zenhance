/**
 * What the circles are *saying* (Greg, 2026-09-13: "the circles are
 * themselves data and progress visualisations").
 *
 * Every ring on the orbital map is one of these numbers. Pure arithmetic —
 * no React, no DB — so the thresholds that decide "risk of burnout" are
 * visible, arguable and testable rather than buried in a renderer.
 *
 * Provenance is deliberately mixed and deliberately labelled: tenure, last
 * vacation, cost and allocation are **real** columns on `people` /
 * `assignments`, while story counts come from the mock board in
 * lib/mock/personTasks.ts until there's a real work integration. The two are
 * kept apart in the types so nothing reads as real data when it isn't.
 */
import type { MockTask } from "@/lib/mock/personTasks";

export type SeatProgress = {
  /** Work items finished, of those the person is carrying. */
  done: number;
  total: number;
  /** Currently being worked, not yet finished. */
  inFlight: number;
  /** 0..1 — drives the arc drawn around a person. */
  ratio: number;
};

export type Strain = "ok" | "watch" | "risk";

export type PersonVitals = {
  tenureMonths: number | null;
  monthsSinceVacation: number | null;
  costPerMonth: number | null;
  /** Total commitment across every team, so >100 means over-allocated. */
  allocationPct: number;
  /** 0..1, where 1 is untroubled — the inverse of accumulated strain. */
  wellbeing: number;
  strain: Strain;
};

export type UnitProgress = {
  /** Share of the branch's work items that are finished. */
  delivery: number | null;
  /** Share of story points past the "still not started" line. */
  sprint: number | null;
  /** Average explicit health score. Null means no health measurement exists. */
  health: number | null;
  people: number;
  done: number;
  total: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

export function monthsBetween(from: Date | string | null, to: Date): number | null {
  if (!from) return null;
  const start = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, (to.getTime() - start.getTime()) / MS_PER_MONTH);
}

export function seatProgress(tasks: MockTask[]): SeatProgress {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const inFlight = tasks.filter((t) => t.status === "in_progress" || t.status === "review").length;
  return { done, total, inFlight, ratio: total === 0 ? 0 : done / total };
}

// --- wellbeing -------------------------------------------------------------
// Two pressures the schema actually records. Both are gentle below the
// threshold and bite after it, because the point is to surface the person
// who has been going too long without a break, not to rank everyone.

/** Months without a break before it starts counting against wellbeing. */
export const VACATION_GRACE_MONTHS = 6;
/** Months without a break at which it costs the full penalty. */
export const VACATION_LIMIT_MONTHS = 18;
const VACATION_WEIGHT = 0.65;
/** Allocation above this is over-commitment. */
export const ALLOCATION_CEILING = 100;
const ALLOCATION_WEIGHT = 0.35;
/** Over-allocated by this much costs the full allocation penalty. */
const ALLOCATION_SPAN = 60;

export function wellbeing(monthsSinceVacation: number | null, allocationPct: number): number {
  const vacationStrain =
    monthsSinceVacation === null
      ? 0.25 // never recorded — mildly unknown, not maximally bad
      : clamp01(
          (monthsSinceVacation - VACATION_GRACE_MONTHS) /
            (VACATION_LIMIT_MONTHS - VACATION_GRACE_MONTHS),
        );
  const allocationStrain = clamp01((allocationPct - ALLOCATION_CEILING) / ALLOCATION_SPAN);
  return clamp01(1 - (vacationStrain * VACATION_WEIGHT + allocationStrain * ALLOCATION_WEIGHT));
}

export function strainOf(score: number): Strain {
  if (score < 0.45) return "risk";
  if (score < 0.72) return "watch";
  return "ok";
}

export function personVitals(
  person: { startDate?: string | Date | null; lastVacationAt?: string | Date | null; costPerMonth?: string | number | null },
  allocationPct: number,
  now: Date,
): PersonVitals {
  const tenureMonths = monthsBetween(person.startDate ?? null, now);
  const monthsSinceVacation = monthsBetween(person.lastVacationAt ?? null, now);
  const cost =
    person.costPerMonth == null
      ? null
      : typeof person.costPerMonth === "number"
        ? person.costPerMonth
        : Number(person.costPerMonth);
  const score = wellbeing(monthsSinceVacation, allocationPct);
  return {
    tenureMonths,
    monthsSinceVacation,
    costPerMonth: cost != null && Number.isFinite(cost) ? cost : null,
    allocationPct,
    wellbeing: score,
    strain: strainOf(score),
  };
}

/**
 * Roll a branch's measured work and health into the three figures a unit's
 * rings show. Null means the metric has no source data, not a measured zero.
 */
export function unitProgress(
  members: { tasks: MockTask[]; health: number | null }[],
): UnitProgress {
  let done = 0;
  let total = 0;
  let pointsMoved = 0;
  let pointsTotal = 0;
  let health = 0;
  let healthCount = 0;
  for (const m of members) {
    for (const t of m.tasks) {
      total += 1;
      pointsTotal += t.points;
      if (t.status === "done") {
        done += 1;
        pointsMoved += t.points;
      } else if (t.status === "in_progress" || t.status === "review") {
        pointsMoved += t.points * 0.5;
      }
    }
    if (m.health !== null && Number.isFinite(m.health)) {
      health += m.health;
      healthCount += 1;
    }
  }
  return {
    delivery: total === 0 ? null : done / total,
    sprint: pointsTotal === 0 ? null : pointsMoved / pointsTotal,
    health: healthCount === 0 ? null : health / healthCount,
    people: members.length,
    done,
    total,
  };
}

/** The rings a unit wears, outermost last — the order they're drawn in. */
export const UNIT_RING_KEYS = ["delivery", "sprint", "health"] as const;
export type UnitRingKey = (typeof UNIT_RING_KEYS)[number];

export const UNIT_RING_LABELS: Record<UnitRingKey, string> = {
  delivery: "delivery progress",
  sprint: "sprint progress",
  health: "team health",
};
