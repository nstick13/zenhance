import { describe, expect, it } from "vitest";
import type { InsertionPlan } from "../insertion";
import type { Relation } from "../relationship";
import {
  canReparentAt,
  decideDrop,
  eligibleTargets,
  type DropContext,
} from "../drop";

const NOW = 10_000;

/** A relation held still long enough to be deliberate. `since` well in the
 *  past, and the hand where it started. */
const armed = (unitId: string): Relation =>
  ({ unitId, at: { x: 0, y: 0 }, since: NOW - 5_000, depth: 0.8, charge: 1 });

/** Contact made in passing — just arrived, hand still moving. */
const passing = (unitId: string): Relation =>
  ({ unitId, at: { x: 0, y: 0 }, since: NOW - 10, depth: 0.2, charge: 0 });

const drag = (over: Partial<DropContext> = {}): DropContext => ({
  unitId: "payments",
  origin: { x: 0, y: 0 },
  current: { x: 0, y: 0 },
  overTray: false,
  relation: null,
  reparent: null,
  reparentHold: null,
  plan: null,
  ...over,
});

const landing: InsertionPlan = {
  kind: "orbit", unitId: "payments", position: { x: 10, y: 10 }, angle: 1.2, distance: 300,
  displaced: [], guide: { centre: { x: 0, y: 0 }, radius: 300 },
};
const offRing: InsertionPlan = { kind: "none", reason: "off-orbit" };
const noRoom: InsertionPlan = { kind: "none", reason: "no-room" };

const on = { now: NOW, snapping: true };
const off = { now: NOW, snapping: false };

describe("the tray wins", () => {
  it("carries, whatever else is true of the drag", () => {
    // Someone holding a node above the basket has said where it is going.
    const d = drag({ overTray: true, relation: armed("design"), reparent: { parentId: "delivery" }, reparentHold: armed("delivery"), plan: landing });
    expect(decideDrop(d, on)).toEqual({ kind: "carry", unitId: "payments" });
  });
});

describe("merge is a question, and only when deliberate", () => {
  it("asks when the contact was held", () => {
    expect(decideDrop(drag({ relation: armed("design") }), on))
      .toEqual({ kind: "merge", fromId: "payments", intoId: "design" });
  });

  it("does not ask for contact made in passing", () => {
    // A node crossing another on its way somewhere is not a merge.
    expect(decideDrop(drag({ relation: passing("design"), plan: landing }), on).kind).toBe("place");
  });

  it("beats a reparent held at the same time", () => {
    const d = drag({ relation: armed("design"), reparent: { parentId: "delivery" }, reparentHold: armed("delivery") });
    expect(decideDrop(d, on).kind).toBe("merge");
  });
});

describe("reparent is a question, and only when deliberate", () => {
  it("asks when the orbit was held", () => {
    const d = drag({ reparent: { parentId: "delivery" }, reparentHold: armed("delivery") });
    expect(decideDrop(d, on)).toEqual({ kind: "reparent", fromId: "payments", parentId: "delivery" });
  });

  it("just lands when the orbit was crossed in passing", () => {
    const d = drag({ reparent: { parentId: "delivery" }, reparentHold: passing("delivery"), plan: landing });
    expect(decideDrop(d, on).kind).toBe("place");
  });

  it("does not ask when there is no orbit under it, however long it was held", () => {
    expect(decideDrop(drag({ reparent: null, reparentHold: armed("delivery"), plan: landing }), on).kind).toBe("place");
  });
});

describe("with snaps off, placement means nothing", () => {
  it("moves by the delta", () => {
    const d = drag({ origin: { x: 100, y: 100 }, current: { x: 160, y: 80 } });
    expect(decideDrop(d, off)).toEqual({ kind: "free", unitId: "payments", delta: { x: 60, y: -20 } });
  });

  it("ignores a wobble — that was a click, not a placement", () => {
    const d = drag({ origin: { x: 100, y: 100 }, current: { x: 100.5, y: 100.2 } });
    expect(decideDrop(d, off).kind).toBe("return");
  });

  it("still lets a held merge through, because that is structural not spatial", () => {
    expect(decideDrop(drag({ relation: armed("design") }), off).kind).toBe("merge");
  });

  it("commits through the planner when a free plan came with the drag", () => {
    // The basket route arrives with a free plan; the on-map route does not.
    // The two ended up behaving differently (ripple and placement count vs
    // neither) and this preserves both until Greg decides which is right.
    const freePlan = { kind: "free" as const, unitId: "payments", position: { x: 50, y: 50 } };
    expect(decideDrop(drag({ plan: freePlan, current: { x: 50, y: 50 } }), off))
      .toEqual({ kind: "place", unitId: "payments", plan: freePlan });
  });

  it("applies the raw delta when no plan came with it", () => {
    const d = drag({ origin: { x: 0, y: 0 }, current: { x: 50, y: 50 }, plan: null });
    expect(decideDrop(d, off).kind).toBe("free");
  });
});

describe("landing", () => {
  it("places what the preview showed", () => {
    const out = decideDrop(drag({ plan: landing }), on);
    expect(out).toMatchObject({ kind: "place", unitId: "payments" });
  });

  it("goes home when there is no plan at all", () => {
    expect(decideDrop(drag({ plan: null }), on)).toEqual({ kind: "return", unitId: "payments", offRing: false });
  });

  it("explains itself when the rings refused", () => {
    // The one refusal worth a sentence: the viewer aimed somewhere
    // reasonable and the geography said no.
    expect(decideDrop(drag({ plan: offRing }), on)).toEqual({ kind: "return", unitId: "payments", offRing: true });
  });

  it("stays quiet when there was simply no room", () => {
    expect(decideDrop(drag({ plan: noRoom }), on)).toEqual({ kind: "return", unitId: "payments", offRing: false });
  });
});

describe("a cancelled gesture is not an answer", () => {
  it("proposes nothing, even fully armed over a target", () => {
    const d = drag({ relation: armed("design"), reparent: { parentId: "d" }, reparentHold: armed("d"), plan: landing });
    expect(decideDrop(d, { ...on, cancelled: true })).toEqual({ kind: "return", unitId: "payments", offRing: false });
  });

  it("does not carry, even over the tray", () => {
    expect(decideDrop(drag({ overTray: true }), { ...on, cancelled: true }).kind).toBe("return");
  });

  it("says nothing out loud", () => {
    const out = decideDrop(drag({ plan: offRing }), { ...on, cancelled: true });
    expect(out).toMatchObject({ kind: "return", offRing: false });
  });
});

describe("eligibleTargets", () => {
  const units = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "parent" }];
  const base = { carried: null, presenceOf: () => 1, minPresence: 0.5, moving: new Set<string>(), parentId: null };

  it("offers everything visible and unrelated", () => {
    expect(eligibleTargets(units, base).map((u) => u.id)).toEqual(["a", "b", "c", "parent"]);
  });

  it("never offers a branch waiting in the basket", () => {
    // It is drawn as a placeholder, not as somewhere you can drop something.
    expect(eligibleTargets(units, { ...base, carried: new Set(["b"]) }).map((u) => u.id)).not.toContain("b");
  });

  it("never offers a mark too faint to see", () => {
    // Otherwise a drop lands on something the viewer never knew was there.
    const faint = (id: string) => (id === "c" ? 0.1 : 1);
    expect(eligibleTargets(units, { ...base, presenceOf: faint }).map((u) => u.id)).not.toContain("c");
  });

  it("never offers the branch being dragged", () => {
    expect(eligibleTargets(units, { ...base, moving: new Set(["a", "b"]) }).map((u) => u.id)).toEqual(["c", "parent"]);
  });

  it("never offers the node's own parent", () => {
    // Moving round your own parent is geography, and it is the one node you
    // are bound to pass close to.
    expect(eligibleTargets(units, { ...base, parentId: "parent" }).map((u) => u.id)).not.toContain("parent");
  });
});

describe("canReparentAt", () => {
  it("is off until unit names read", () => {
    expect(canReparentAt(0.4, 1)).toBe(false);
    expect(canReparentAt(1, 1)).toBe(true);
    expect(canReparentAt(4, 1)).toBe(true);
  });
});
