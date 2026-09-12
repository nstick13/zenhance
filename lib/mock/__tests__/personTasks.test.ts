import { describe, it, expect } from "vitest";
import { tasksForPerson, inProgressCards, producedValue, MAX_ORBIT_CARDS } from "../personTasks";
import type { CanvasPerson } from "@/lib/canvas/buildCanvasMap";

function makePerson(id: string): CanvasPerson {
  return {
    id,
    kind: "person",
    name: "Test Person",
    x: 0,
    y: 0,
    title: "Engineer",
    homeId: "team-1",
    costPerMonth: 9000,
    managerId: null,
    lastVacationAt: null,
    startDate: null,
    skills: [],
    growthFocus: null,
    disciplineId: null,
    employment: "fte",
    location: null,
    timezone: null,
    allocations: [],
    crossCuttingTier: null,
  };
}

describe("tasksForPerson", () => {
  it("is deterministic for the same person id", () => {
    const p = makePerson("person-a");
    expect(tasksForPerson(p, ["Atlas"])).toEqual(tasksForPerson(p, ["Atlas"]));
  });

  it("gives a priced value XOR an essential note, never both or neither", () => {
    const tasks = tasksForPerson(makePerson("person-b"), ["Atlas"]);
    for (const t of tasks) {
      const hasValue = t.value !== null;
      const hasNote = t.essentialNote !== null;
      expect(hasValue).toBe(!hasNote);
    }
  });
});

describe("inProgressCards", () => {
  it("keeps only in-progress cards", () => {
    const tasks = tasksForPerson(makePerson("person-c"), ["Atlas"]);
    const cards = inProgressCards(tasks);
    expect(cards.every((t) => t.status === "in_progress")).toBe(true);
  });

  it("never exceeds MAX_ORBIT_CARDS", () => {
    // Try a spread of ids to make sure the cap holds regardless of how many
    // in-progress cards a given seed happens to produce.
    for (let i = 0; i < 25; i++) {
      const tasks = tasksForPerson(makePerson(`person-${i}`), ["Atlas"]);
      expect(inProgressCards(tasks).length).toBeLessThanOrEqual(MAX_ORBIT_CARDS);
    }
  });
});

describe("producedValue", () => {
  it("sums only priced in-progress cards, ignoring essential ones and other statuses", () => {
    const tasks = [
      { id: "1", title: "a", status: "in_progress" as const, priority: "low" as const, points: 1, tag: "x", value: 100, essentialNote: null },
      { id: "2", title: "b", status: "in_progress" as const, priority: "low" as const, points: 1, tag: "x", value: null, essentialNote: "necessary" },
      { id: "3", title: "c", status: "done" as const, priority: "low" as const, points: 1, tag: "x", value: 500, essentialNote: null },
    ];
    expect(producedValue(tasks)).toBe(100);
  });

  it("is 0 for an empty list", () => {
    expect(producedValue([])).toBe(0);
  });
});
