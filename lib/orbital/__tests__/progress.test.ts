import { describe, it, expect } from "vitest";
import type { MockTask } from "@/lib/mock/personTasks";
import {
  ALLOCATION_CEILING,
  VACATION_GRACE_MONTHS,
  VACATION_LIMIT_MONTHS,
  monthsBetween,
  personVitals,
  seatProgress,
  strainOf,
  unitProgress,
  wellbeing,
} from "../progress";

const task = (status: MockTask["status"], points = 3): MockTask => ({
  id: `t-${status}-${Math.random()}`,
  title: "Do the thing",
  status,
  priority: "medium",
  points,
  tag: "General",
  value: 1000,
  essentialNote: null,
});

const NOW = new Date("2026-09-13T00:00:00Z");

describe("monthsBetween", () => {
  it("measures backwards from now", () => {
    expect(monthsBetween("2025-09-13", NOW)).toBeCloseTo(12, 0);
  });

  it("is null when the date was never recorded", () => {
    expect(monthsBetween(null, NOW)).toBeNull();
  });

  it("is null rather than NaN for an unparseable date", () => {
    expect(monthsBetween("not a date", NOW)).toBeNull();
  });

  it("never goes negative for a date in the future", () => {
    expect(monthsBetween("2027-01-01", NOW)).toBe(0);
  });
});

describe("seatProgress", () => {
  it("counts what is finished against what is carried", () => {
    const p = seatProgress([task("done"), task("done"), task("in_progress"), task("backlog")]);
    expect(p).toMatchObject({ done: 2, total: 4, inFlight: 1 });
    expect(p.ratio).toBeCloseTo(0.5);
  });

  it("counts review as still in flight, not finished", () => {
    const p = seatProgress([task("review"), task("done")]);
    expect(p.inFlight).toBe(1);
    expect(p.done).toBe(1);
  });

  it("reads an empty board as nothing done, not as complete", () => {
    expect(seatProgress([])).toMatchObject({ done: 0, total: 0, ratio: 0 });
  });
});

describe("wellbeing", () => {
  it("is untroubled by a recent break at a sane allocation", () => {
    expect(wellbeing(1, 100)).toBe(1);
  });

  it("ignores time off until the grace period runs out", () => {
    expect(wellbeing(VACATION_GRACE_MONTHS, 100)).toBe(1);
  });

  it("falls the longer someone goes without a break", () => {
    const early = wellbeing(VACATION_GRACE_MONTHS + 3, 100);
    const late = wellbeing(VACATION_LIMIT_MONTHS, 100);
    expect(early).toBeLessThan(1);
    expect(late).toBeLessThan(early);
  });

  it("stops getting worse past the limit — it is already as bad as it reads", () => {
    expect(wellbeing(VACATION_LIMIT_MONTHS * 3, 100)).toBeCloseTo(
      wellbeing(VACATION_LIMIT_MONTHS, 100),
    );
  });

  it("counts over-allocation, but not allocation up to the ceiling", () => {
    expect(wellbeing(0, ALLOCATION_CEILING)).toBe(1);
    expect(wellbeing(0, ALLOCATION_CEILING + 40)).toBeLessThan(1);
  });

  it("treats a never-recorded break as mildly unknown, not as a crisis", () => {
    const unknown = wellbeing(null, 100);
    expect(unknown).toBeLessThan(1);
    expect(unknown).toBeGreaterThan(wellbeing(VACATION_LIMIT_MONTHS, 100));
  });

  it("stays inside 0..1 under everything at once", () => {
    expect(wellbeing(120, 400)).toBeGreaterThanOrEqual(0);
    expect(wellbeing(120, 400)).toBeLessThanOrEqual(1);
  });
});

describe("strainOf", () => {
  it("bands the score", () => {
    expect(strainOf(0.95)).toBe("ok");
    expect(strainOf(0.6)).toBe("watch");
    expect(strainOf(0.2)).toBe("risk");
  });
});

describe("personVitals", () => {
  it("reads the real columns the schema records", () => {
    const v = personVitals(
      { startDate: "2024-09-13", lastVacationAt: "2025-03-13", costPerMonth: "9136.00" },
      100,
      NOW,
    );
    expect(v.tenureMonths).toBeCloseTo(24, 0);
    expect(v.monthsSinceVacation).toBeCloseTo(18, 0);
    expect(v.costPerMonth).toBe(9136);
  });

  it("flags someone long overdue a break", () => {
    const v = personVitals({ startDate: "2020-01-01", lastVacationAt: "2024-01-01" }, 140, NOW);
    expect(v.strain).toBe("risk");
  });

  it("survives a person with nothing recorded", () => {
    const v = personVitals({}, 100, NOW);
    expect(v.tenureMonths).toBeNull();
    expect(v.costPerMonth).toBeNull();
    expect(v.wellbeing).toBeGreaterThan(0);
  });

  it("ignores a cost that isn't a number", () => {
    expect(personVitals({ costPerMonth: "not money" }, 100, NOW).costPerMonth).toBeNull();
  });
});

describe("unitProgress", () => {
  const member = (tasks: MockTask[], score = 1) => ({ tasks, wellbeing: score });

  it("rolls delivery up from every board in the branch", () => {
    const p = unitProgress([
      member([task("done"), task("backlog")]),
      member([task("done"), task("done")]),
    ]);
    expect(p.done).toBe(3);
    expect(p.total).toBe(4);
    expect(p.delivery).toBeCloseTo(0.75);
  });

  it("gives half credit to points in flight, so a sprint moves before it lands", () => {
    const allBacklog = unitProgress([member([task("backlog", 4), task("backlog", 4)])]);
    const halfMoving = unitProgress([member([task("in_progress", 4), task("backlog", 4)])]);
    expect(allBacklog.sprint).toBe(0);
    expect(halfMoving.sprint).toBeCloseTo(0.25);
  });

  it("averages wellbeing across the people, not the tasks", () => {
    expect(unitProgress([member([task("done")], 1), member([], 0)]).health).toBeCloseTo(0.5);
  });

  it("reads an empty branch as zero rather than complete", () => {
    expect(unitProgress([])).toMatchObject({ delivery: 0, sprint: 0, health: 0, people: 0 });
  });
});
