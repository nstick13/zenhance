import { describe, expect, it } from "vitest";
import type { MockTask, TaskStatus } from "@/lib/mock/personTasks";
import {
  boardTeams,
  boardsFor,
  columns,
  isDone,
  isInFlight,
  statusRing,
  summarise,
} from "../board";

let n = 0;
const task = (status: TaskStatus, points = 3): MockTask => ({
  id: `t${n++}`,
  title: "A piece of work",
  status,
  priority: "medium",
  points,
  tag: "Platform",
  value: 1000,
  essentialNote: null,
});

describe("what counts as in flight", () => {
  it("is someone actually on it, not merely not-done", () => {
    expect(isInFlight("in_progress")).toBe(true);
    expect(isInFlight("review")).toBe(true);
    expect(isInFlight("backlog")).toBe(false);
    expect(isInFlight("done")).toBe(false);
  });

  it("separates done from everything else", () => {
    expect(isDone("done")).toBe(true);
    expect(isDone("review")).toBe(false);
  });
});

describe("summarise", () => {
  it("is all zeroes for an empty board", () => {
    expect(summarise([])).toEqual({ total: 0, done: 0, inFlight: 0, backlog: 0, pointsRemaining: 0 });
  });

  it("counts each state once and only once", () => {
    const s = summarise([task("backlog"), task("in_progress"), task("review"), task("done")]);
    expect(s).toMatchObject({ total: 4, done: 1, inFlight: 2, backlog: 1 });
    expect(s.done + s.inFlight + s.backlog).toBe(s.total);
  });

  it("owes points for everything unfinished, including review", () => {
    // Review is not finished. Counting it as done would quietly flatter
    // every board that has a queue waiting on someone else.
    expect(summarise([task("done", 8), task("review", 5), task("backlog", 2)]).pointsRemaining).toBe(7);
  });

  it("owes nothing when everything is finished", () => {
    expect(summarise([task("done", 8), task("done", 5)]).pointsRemaining).toBe(0);
  });
});

describe("statusRing", () => {
  it("keeps board order rather than sorting by status", () => {
    // Sorting would make one item finishing look like the whole ring
    // reshuffling, instead of that one dot changing colour.
    const tasks = [task("done"), task("backlog"), task("in_progress"), task("backlog")];
    expect(statusRing(tasks)).toEqual(["done", "backlog", "in_progress", "backlog"]);
  });

  it("is empty for someone with nothing on", () => {
    expect(statusRing([])).toEqual([]);
  });
});

describe("columns", () => {
  it("always offers every column, empty ones included", () => {
    const cols = columns([task("done")]);
    expect(cols.map((c) => c.status)).toEqual(["backlog", "in_progress", "review", "done"]);
    expect(cols.find((c) => c.status === "backlog")!.tasks).toEqual([]);
  });

  it("puts each task in exactly one column", () => {
    const tasks = [task("backlog"), task("backlog"), task("review"), task("done")];
    const cols = columns(tasks);
    expect(cols.reduce((n, c) => n + c.tasks.length, 0)).toBe(tasks.length);
  });
});

describe("boardTeams", () => {
  const seats = [
    { personId: "p1", unitId: "u1" },
    { personId: "p1", unitId: "u2" },
    { personId: "p1", unitId: "u1" },
    { personId: "p2", unitId: "u3" },
  ];
  const names: Record<string, string> = { u1: "Payments", u2: "Platform", u3: "Design" };
  const nameOf = (id: string) => names[id];

  it("names only the teams that person actually sits on", () => {
    expect(boardTeams(seats, nameOf, "p1").sort()).toEqual(["Payments", "Platform"]);
  });

  it("does not repeat a team someone holds two seats on", () => {
    expect(boardTeams(seats, nameOf, "p1")).toHaveLength(2);
  });

  it("says General rather than nothing for someone with no seat", () => {
    expect(boardTeams(seats, nameOf, "nobody")).toEqual(["General"]);
  });

  it("says General when every seat names a unit that has gone", () => {
    expect(boardTeams([{ personId: "p9", unitId: "missing" }], nameOf, "p9")).toEqual(["General"]);
  });
});

describe("boardsFor", () => {
  const people = [{ id: "a" }, { id: "b" }];
  const make = () => [task("done")];

  it("gives everyone a board when sample work is on", () => {
    expect(boardsFor(people, ["T"], make, true).size).toBe(2);
  });

  it("gives nobody one when it is off — a real workspace shows no work, not invented work", () => {
    expect(boardsFor(people, ["T"], make, false).size).toBe(0);
  });
});
