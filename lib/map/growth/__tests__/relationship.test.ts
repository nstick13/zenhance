import { describe, expect, it } from "vitest";
import {
  DWELL_MS,
  branchImpact,
  chargeAt,
  interactionOrbit,
  isArmed,
  magneticMergeTarget,
  magneticPosition,
  metaballBridge,
  mergeCopy,
  overlapTarget,
  reparentOrbitTarget,
  trackRelation,
  validateReparent,
} from "../relationship";
import { buildOrbitalTree } from "@/lib/orbital/model";

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

describe("semantic parent orbits", () => {
  const parents = [
    { id: "old", x: 0, y: 0, r: 30, footprint: 45 },
    { id: "new", x: 300, y: 0, r: 40, footprint: 55 },
    { id: "child", x: 420, y: 0, r: 20, footprint: 25 },
  ];

  it("does not derive interaction radius from rendered connection length", () => {
    const short = { ...parents[1], childOrbit: 120 };
    const long = { ...parents[1], childOrbit: 900 };
    expect(interactionOrbit(short, 1)).toEqual(interactionOrbit(long, 1));
  });

  it("proposes a different eligible parent on its annulus", () => {
    const orbit = interactionOrbit(parents[1], 1);
    const target = reparentOrbitTarget(
      parents,
      { x: parents[1].x + orbit.radius, y: parents[1].y },
      1,
      new Set(["dragged", "child"]),
      "old",
    );
    expect(target?.parentId).toBe("new");
    expect(target?.strength).toBeCloseTo(1);
  });

  it("rejects self, descendants, the current parent and cycles", () => {
    const orbit = interactionOrbit(parents[2], 1);
    expect(reparentOrbitTarget(
      parents,
      { x: parents[2].x + orbit.radius, y: 0 },
      1,
      new Set(["child"]),
      "old",
    )).toBeNull();
    const parentById = new Map<string, string | null>([["root", null], ["a", "root"], ["b", "a"]]);
    expect(validateReparent(parentById, "a", "a")).toMatch(/own parent/);
    expect(validateReparent(parentById, "a", "b")).toMatch(/own branch/);
    expect(validateReparent(parentById, "b", "root")).toBeNull();
    expect(validateReparent(parentById, "b", "foreign")).toMatch(/this company/);
  });
});

describe("magnetic merge feedback", () => {
  it("appears before full overlap and supplies the kissing bridge", () => {
    const target = magneticMergeTarget(
      [{ id: "b", x: 100, y: 0 }],
      { x: 35, y: 0 },
      30,
      () => 30,
      new Set(),
      1,
    );
    expect(target).not.toBeNull();
    expect(target!.depth).toBe(0);
    expect(metaballBridge({ x: 35, y: 0, r: 30 }, { x: 100, y: 0, r: 30 }, 30)).not.toBeNull();
  });

  it("clears on retreat and cannot arm from a quick pass", () => {
    const near = magneticMergeTarget([{ id: "b", x: 100, y: 0 }], { x: 35, y: 0 }, 30, () => 30, new Set(), 1)!;
    const first = trackRelation(null, near, 0);
    expect(isArmed(trackRelation(first, near, 100))).toBe(false);
    expect(magneticMergeTarget([{ id: "b", x: 100, y: 0 }], { x: 0, y: 0 }, 20, () => 20, new Set(), 1)).toBeNull();
    expect(trackRelation(first, null, 110)).toBeNull();
  });

  it("uses an immediate static joined position for reduced motion", () => {
    const target = { centre: { x: 100, y: 0 }, radius: 30, strength: 0.2 };
    const still = magneticPosition({ x: 25, y: 0 }, target, 30, true);
    const moving = magneticPosition({ x: 25, y: 0 }, target, 30, false);
    expect(still).toEqual({ x: 40, y: 0 });
    expect(moving.x).toBeGreaterThan(25);
    expect(moving.x).toBeLessThan(40);
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

describe("a drag that is still travelling never asks a question", () => {
  const target = { unitId: "b", depth: 0 };

  it("restarts the dwell whenever the hand moves on", () => {
    // Greg, 2026-09-23: a short drag round a unit's own parent opened a merge
    // proposal, because the clock ran from first contact while the hand was
    // still moving. A dwell is a hold.
    let relation = trackRelation(null, target, 0, { x: 0, y: 0 });
    for (let t = 100; t <= DWELL_MS * 3; t += 100) {
      relation = trackRelation(relation, target, t, { x: t / 4, y: 0 });
    }
    expect(isArmed(relation)).toBe(false);
  });

  it("still arms when the hand comes to rest on the target", () => {
    let relation = trackRelation(null, target, 0, { x: 0, y: 0 });
    relation = trackRelation(relation, target, 50, { x: 40, y: 0 });
    // Now held: the same spot, sampled as the clock runs past the dwell.
    for (let t = 100; t <= DWELL_MS + 200; t += 100) {
      relation = trackRelation(relation, target, t, { x: 41, y: 0 });
    }
    expect(isArmed(relation)).toBe(true);
  });

  it("treats a hand that barely trembles as still", () => {
    let relation = trackRelation(null, target, 0, { x: 0, y: 0 });
    for (let t = 100; t <= DWELL_MS + 200; t += 100) {
      relation = trackRelation(relation, target, t, { x: (t / 100) % 2, y: 0 });
    }
    expect(isArmed(relation)).toBe(true);
  });
});
