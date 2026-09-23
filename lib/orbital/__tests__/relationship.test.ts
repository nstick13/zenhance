import { describe, expect, it } from "vitest";
import {
  DWELL_MS,
  branchImpact,
  chargeAt,
  isArmed,
  mergeCopy,
  overlapTarget,
  trackRelation,
} from "../relationship";
import { buildOrbitalTree } from "../model";

const units = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 100, y: 0 },
];
const radius = () => 30;

describe("finding a deliberate target", () => {
  it("needs the dragged centre inside a disc — brushing the rim is not enough", () => {
    expect(overlapTarget(units, { x: 129, y: 0 }, radius, new Set())).toEqual({ unitId: "b", depth: expect.any(Number) });
    expect(overlapTarget(units, { x: 131, y: 0 }, radius, new Set())).toBeNull();
    expect(overlapTarget(units, { x: 50, y: 0 }, radius, new Set())).toBeNull();
  });

  it("never targets itself or its own branch", () => {
    expect(overlapTarget(units, { x: 100, y: 0 }, radius, new Set(["b"]))).toBeNull();
  });

  it("reads how deep the push is: 1 at the centre, near 0 at the rim", () => {
    expect(overlapTarget(units, { x: 100, y: 0 }, radius, new Set())!.depth).toBe(1);
    expect(overlapTarget(units, { x: 128, y: 0 }, radius, new Set())!.depth).toBeLessThan(0.1);
  });
});

describe("arming a relationship proposal", () => {
  const over = (depth = 0.2) => ({ unitId: "b", depth });

  it("does nothing on approach", () => {
    expect(trackRelation(null, null, 0)).toBeNull();
  });

  it("arms after a deliberate dwell, not a pass", () => {
    const first = trackRelation(null, over(), 1000);
    expect(isArmed(trackRelation(first, over(), 1250))).toBe(false);
    expect(isArmed(trackRelation(first, over(), 1000 + DWELL_MS))).toBe(true);
  });

  it("arms faster when pushed deep into the target", () => {
    const first = trackRelation(null, over(0.9), 0);
    expect(isArmed(trackRelation(first, over(0.9), DWELL_MS / 3))).toBe(true);
  });

  it("starts the clock again on a new target", () => {
    const first = trackRelation(null, over(), 0);
    const moved = trackRelation(trackRelation(first, over(), 600), { unitId: "a", depth: 0.2 }, 610);
    expect(moved!.unitId).toBe("a");
    expect(moved!.charge).toBe(0);
  });

  it("lets go the moment the pointer leaves, so release changes nothing", () => {
    const first = trackRelation(null, over(), 0);
    expect(trackRelation(first, null, 800)).toBeNull();
  });

  it("measures the dwell by the clock, so one long frame can't turn a pass into a proposal", () => {
    // The first time the overlap is seen is the start, however late that is.
    const seenLate = trackRelation(null, over(), 5000);
    expect(seenLate!.charge).toBe(0);
    expect(isArmed(chargeAt(seenLate, 5100))).toBe(false);
    expect(isArmed(chargeAt(seenLate, 5000 + DWELL_MS))).toBe(true);
  });
});

describe("what a merge carries", () => {
  const tree = buildOrbitalTree({
    units: [
      { id: "co", name: "Company", parentId: null },
      { id: "ops", name: "Customer Operations", parentId: "co" },
      { id: "svc", name: "Service Delivery", parentId: "co" },
      { id: "region", name: "Region", parentId: "ops" },
      { id: "t1", name: "T1", parentId: "ops" },
      { id: "t2", name: "T2", parentId: "region" },
    ],
    people: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }],
    assignments: [
      { personId: "p1", orgUnitId: "t1" },
      { personId: "p2", orgUnitId: "t2" },
      { personId: "p2", orgUnitId: "t1", allocationPct: 20 },
      { personId: "p3", orgUnitId: "svc" },
    ],
  }, { mergePassThroughRoot: false });
  const kind = (id: string) => (id.startsWith("t") ? "team" : "group") as "team" | "group";

  it("counts the whole branch, each person once", () => {
    expect(branchImpact(tree, "ops", kind)).toEqual({ childUnits: 1, teams: 2, people: 2 });
  });

  it("says so in plain words, including how to merge only the unit", () => {
    const copy = mergeCopy("Customer Operations", "Service Delivery", { childUnits: 4, teams: 11, people: 83 });
    expect(copy.title).toBe('Merge "Customer Operations" into "Service Delivery"?');
    expect(copy.body).toBe(
      "Customer Operations carries its entire branch: 4 child units, 11 teams and 83 people. " +
      "They will all remain together beneath the merged unit. " +
      "To merge only Customer Operations, cancel and reassign its child units first.",
    );
  });

  it("does not invent a branch for a unit without one", () => {
    const copy = mergeCopy("T1", "Service Delivery", { childUnits: 0, teams: 0, people: 1 });
    expect(copy.body).toBe("T1 has no units below it. It holds 1 person.");
  });
});
