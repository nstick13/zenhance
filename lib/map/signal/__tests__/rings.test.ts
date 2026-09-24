import { describe, expect, it } from "vitest";
import type { MockTask, TaskStatus } from "@/lib/mock/personTasks";
import type { PersonVitals } from "../progress";
import {
  branchMembers,
  healthSource,
  seatRingsFor,
  unitRingsFor,
  type BranchSource,
} from "../rings";

let n = 0;
const task = (status: TaskStatus, points = 3): MockTask => ({
  id: `t${n++}`, title: "A piece of work", status, priority: "medium",
  points, tag: "Platform", value: 1000, essentialNote: null,
});

//  company ─ delivery ─ payments
//          └ design
const children: Record<string, string[]> = {
  company: ["delivery", "design"], delivery: ["payments"], payments: [], design: [],
};
const seats: Record<string, { personId: string | null }[]> = {
  company: [{ personId: "ceo" }],
  delivery: [{ personId: "dlead" }],
  payments: [{ personId: "p1" }, { personId: "p2" }, { personId: null }],
  design: [{ personId: "d1" }],
};
const source: BranchSource = {
  childrenOf: (id) => children[id] ?? [],
  seatsOf: (id) => seats[id] ?? [],
};
const boards = new Map<string, MockTask[]>([
  ["ceo", [task("done")]],
  ["dlead", [task("backlog")]],
  ["p1", [task("done"), task("done")]],
  ["p2", [task("in_progress")]],
  ["d1", [task("done")]],
]);
const noHealth = () => null;

describe("branchMembers", () => {
  it("speaks for the whole branch, not just the people sitting on the unit", () => {
    // A team lead's ring that ignored their teams would be the most
    // misleading number on the map.
    expect(branchMembers("delivery", source, boards, noHealth)).toHaveLength(3); // dlead + p1 + p2
  });

  it("covers everyone for the company", () => {
    expect(branchMembers("company", source, boards, noHealth)).toHaveLength(5);
  });

  it("is just its own people at a leaf", () => {
    expect(branchMembers("design", source, boards, noHealth)).toHaveLength(1);
  });

  it("skips open roles — a vacant seat carries no work", () => {
    const members = branchMembers("payments", source, boards, noHealth);
    expect(members).toHaveLength(2);
  });

  it("gives someone with no board an empty one rather than undefined", () => {
    const orphan: BranchSource = { childrenOf: () => [], seatsOf: () => [{ personId: "ghost" }] };
    expect(branchMembers("x", orphan, boards, noHealth)).toEqual([{ tasks: [], health: null }]);
  });

  it("does not hang on a cyclic tree", () => {
    // The tree should never contain a cycle, but the original walk had no
    // guard — one bad row would have hung the render thread rather than
    // drawing a wrong number, and a hang is invisible in a screenshot.
    const cyclic: BranchSource = {
      childrenOf: (id) => (id === "a" ? ["b"] : ["a"]),
      seatsOf: (id) => (id === "a" ? [{ personId: "p1" }] : [{ personId: "p2" }]),
    };
    expect(branchMembers("a", cyclic, boards, noHealth)).toHaveLength(2);
  });

  it("counts a person once per seat they hold, because each seat is work", () => {
    const shared: BranchSource = {
      childrenOf: (id) => (id === "top" ? ["one", "two"] : []),
      seatsOf: (id) => (id === "top" ? [] : [{ personId: "p1" }]),
    };
    expect(branchMembers("top", shared, boards, noHealth)).toHaveLength(2);
  });
});

describe("healthSource", () => {
  const vitals = new Map<string, PersonVitals>([
    ["p1", { tenureMonths: 12, monthsSinceVacation: 2, costPerMonth: null,
             allocationPct: 100, wellbeing: 0.8, strain: "ok" }],
  ]);

  it("is null on a real workspace, because the schema records no health", () => {
    // Null renders as "no measurement", never as a measured zero.
    expect(healthSource(false, vitals)("p1")).toBeNull();
  });

  it("illustrates with wellbeing only on a demo fixture", () => {
    expect(healthSource(true, vitals)("p1")).toBe(0.8);
  });

  it("is null for someone with no vitals even when illustrating", () => {
    expect(healthSource(true, vitals)("unknown")).toBeNull();
  });
});

describe("seatRingsFor", () => {
  it("gives each person their own board and nobody else's", () => {
    const rings = seatRingsFor([{ id: "s1", personId: "p1" }, { id: "s2", personId: "p2" }], boards);
    expect(rings.get("s1")).toMatchObject({ done: 2, total: 2, ratio: 1 });
    expect(rings.get("s2")).toMatchObject({ done: 0, total: 1, inFlight: 1 });
  });

  it("gives an open role an empty ring rather than no entry", () => {
    const rings = seatRingsFor([{ id: "open", personId: null }], boards);
    expect(rings.get("open")).toMatchObject({ total: 0, ratio: 0 });
  });
});

describe("unitRingsFor", () => {
  it("rolls the branch up, so a parent reads higher than one of its teams", () => {
    const rings = unitRingsFor(["company", "delivery", "payments"], source, boards, noHealth);
    // payments: 2 of 3 done. delivery adds dlead's backlog item: 2 of 4.
    expect(rings.get("payments")!.delivery).toBeCloseTo(2 / 3);
    expect(rings.get("delivery")!.delivery).toBeCloseTo(2 / 4);
    expect(rings.get("company")!.total).toBe(6);
  });

  it("reports null, not zero, when a branch has no work at all", () => {
    const empty = unitRingsFor(["design"], source, new Map(), noHealth);
    expect(empty.get("design")!.delivery).toBeNull();
  });

  it("leaves health null on a real workspace", () => {
    expect(unitRingsFor(["company"], source, boards, noHealth).get("company")!.health).toBeNull();
  });
});
