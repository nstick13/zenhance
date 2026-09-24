import { describe, expect, it } from "vitest";
import { chordAngle, openGap, planInsertion, type InsertionPlan } from "../insertion";
import { anglePlacementOffsets, applyPositionOffsets } from "../position";
import { buildOrbitalTree, type OrgInput } from "../model";
import { layoutOrbitalForest } from "../forest";
import { descendantIds } from "../snap";
import type { OrbitalScene } from "../layout";
import { buildDeepOrg } from "./fixtures/deepOrg";

/** A company whose single division has eight teams — enough for a crowded ring. */
function crowded(): OrgInput {
  const units = [
    { id: "co", name: "Company", parentId: null },
    { id: "a", name: "A", parentId: "co" },
    { id: "b", name: "B", parentId: "co" },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, parentId: "a" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, parentId: "b" })),
  ];
  return { units, people: [], assignments: [] };
}

const ring = () => layoutOrbitalForest(buildOrbitalTree(crowded(), { mergePassThroughRoot: false }));

/** Commit a plan the way the map does — as saved angles on top of the
 *  arrangement already saved — and read the scene back. */
function commit(base: OrbitalScene, saved: Map<string, number>, plan: InsertionPlan) {
  const angles = new Map(saved);
  if (plan.kind === "orbit") {
    angles.set(plan.unitId, plan.angle);
    for (const d of plan.displaced) angles.set(d.unitId, d.angle);
  }
  return applyPositionOffsets(base, anglePlacementOffsets(base, angles), new Map());
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("opening a gap on a circle", () => {
  const need = () => 0.2;

  it("moves nothing when the spot is already clear", () => {
    const moved = openGap(0, [{ id: "p", angle: 1 }, { id: "q", angle: -1 }], need);
    expect(moved?.size).toBe(0);
  });

  it("pushes only the neighbours that would collide, by exactly enough", () => {
    const moved = openGap(0, [
      { id: "p", angle: 0.1 },
      { id: "q", angle: 0.35 },
      { id: "far", angle: 1.5 },
      { id: "back", angle: -0.05 },
    ], need)!;
    expect(moved.get("p")).toBeCloseTo(0.2);
    expect(moved.get("q")).toBeCloseTo(0.4);
    expect(moved.get("back")).toBeCloseTo(-0.2);
    expect(moved.has("far")).toBe(false);
  });

  it("refuses when the circle has no room left", () => {
    const items = Array.from({ length: 31 }, (_, i) => ({ id: `i${i}`, angle: (i * 2 * Math.PI) / 31 }));
    expect(openGap(0.05, items, need)).toBeNull();
  });

  it("measures clearance between two orbits by the chord, not the arc", () => {
    expect(chordAngle(100, 100, 0)).toBe(0);
    expect(chordAngle(100, 300, 150)).toBe(0);
    expect(chordAngle(100, 100, 100)).toBeCloseTo(Math.PI / 3);
  });
});

describe("dragging on the ring map", () => {
  const scene = ring();

  it("lands on the unit's own ring, at the pointer's angle", () => {
    const a3 = scene.unitById.get("a3")!;
    const r = Math.hypot(a3.x, a3.y);
    const plan = planInsertion({ scene, base: scene, unitId: "a3", pointer: { x: 0, y: r }, carried: descendantIds(scene, "a3") });
    expect(plan.kind).toBe("orbit");
    if (plan.kind !== "orbit") return;
    expect(Math.hypot(plan.position.x, plan.position.y)).toBeCloseTo(r);
    expect(plan.angle).toBeCloseTo(Math.PI / 2);
  });

  it("never offers another ring — radius is never a restructure", () => {
    const a3 = scene.unitById.get("a3")!;
    const inner = scene.unitById.get("a")!;
    const plan = planInsertion({ scene, base: scene, unitId: "a3", pointer: { x: inner.x, y: inner.y }, carried: descendantIds(scene, "a3") });
    expect(plan).toEqual({ kind: "none", reason: "off-orbit" });
    // And nothing in any plan names a parent.
    const onRing = planInsertion({ scene, base: scene, unitId: "a3", pointer: { x: a3.x, y: a3.y }, carried: new Set(["a3"]) });
    expect(JSON.stringify(onRing)).not.toMatch(/parent/i);
  });

  it("previews exactly what it commits, and moves nothing else", () => {
    const a0 = scene.unitById.get("a0")!;
    const a1 = scene.unitById.get("a1")!;
    // Drop a7 right between a0 and a1, which sit shoulder to shoulder.
    const between = { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 };
    const carried = descendantIds(scene, "a7");
    const plan = planInsertion({ scene, base: scene, unitId: "a7", pointer: between, carried });
    expect(plan.kind).toBe("orbit");
    if (plan.kind !== "orbit") return;
    expect(plan.displaced.length).toBeGreaterThan(0);
    const after = commit(scene, new Map(), plan);
    expect(near(after.unitById.get("a7")!, plan.position)).toBeLessThan(1e-6);
    for (const d of plan.displaced) expect(near(after.unitById.get(d.unitId)!, d.position)).toBeLessThan(1e-6);
    const touched = new Set(["a7", ...plan.displaced.map((d) => d.unitId)]);
    for (const u of scene.units) {
      if (touched.has(u.id)) continue;
      expect(near(after.unitById.get(u.id)!, u)).toBeLessThan(1e-6);
    }
    // Only the local neighbours moved — nothing from the other division.
    expect(plan.displaced.every((d) => d.unitId.startsWith("a"))).toBe(true);
  });

  it("carries on exactly when an arrangement is already saved", () => {
    const saved = new Map([["a2", scene.unitById.get("a2")!.angle + 0.15]]);
    const shown = commit(scene, saved, { kind: "none", reason: "off-orbit" });
    const b1 = shown.unitById.get("b1")!;
    const plan = planInsertion({ scene: shown, base: scene, unitId: "a5", pointer: { x: b1.x, y: b1.y }, carried: new Set(["a5"]) });
    if (plan.kind !== "orbit") throw new Error("expected a ring landing");
    const after = commit(scene, saved, plan);
    expect(near(after.unitById.get("a5")!, plan.position)).toBeLessThan(1e-6);
    for (const d of plan.displaced) expect(near(after.unitById.get(d.unitId)!, d.position)).toBeLessThan(1e-6);
  });
});

describe("dragging in local branch geography", () => {
  const input = (() => {
    const org = buildDeepOrg("insertion", { people: 2562, maxDepth: 11, seed: 20260914 });
    return { units: org.units, people: org.people, assignments: org.assignments };
  })();
  const scene = layoutOrbitalForest(buildOrbitalTree(input, { mergePassThroughRoot: false, workCountFor: () => 6 }), { geography: "local" });
  const parent = scene.units.find((u) => u.childIds.length >= 4 && u.depth >= 3)!;
  const mover = scene.unitById.get(parent.childIds[parent.childIds.length - 1])!;

  it("inserts among siblings on the unit's own orbit, previewing exactly what commits", () => {
    let inserted = 0;
    let displacedAny = 0;
    for (const p of scene.units.filter((u) => u.childIds.length >= 3)) {
      const kids = p.childIds.map((id) => scene.unitById.get(id)!);
      const moving = kids[kids.length - 1];
      const orbit = Math.hypot(moving.x - p.x, moving.y - p.y);
      const a = Math.atan2(kids[0].y - p.y, kids[0].x - p.x);
      const b = Math.atan2(kids[1].y - p.y, kids[1].x - p.x);
      const mid = Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
      const pointer = { x: p.x + orbit * Math.cos(mid), y: p.y + orbit * Math.sin(mid) };
      const carried = descendantIds(scene, moving.id);
      const plan = planInsertion({ scene, base: scene, unitId: moving.id, pointer, carried });
      if (plan.kind !== "orbit") continue;
      inserted++;
      if (plan.displaced.length > 0) displacedAny++;
      const after = commit(scene, new Map(), plan);
      expect(near(after.unitById.get(moving.id)!, plan.position)).toBeLessThan(1e-6);
      for (const d of plan.displaced) {
        expect(p.childIds).toContain(d.unitId);
        expect(near(after.unitById.get(d.unitId)!, d.position)).toBeLessThan(1e-6);
      }
      // Nothing outside the mover, the displaced siblings and their branches moved.
      const travelling = new Set<string>();
      for (const id of [moving.id, ...plan.displaced.map((d) => d.unitId)]) {
        for (const x of descendantIds(scene, id)) travelling.add(x);
      }
      for (const u of scene.units) {
        if (!travelling.has(u.id)) expect(near(after.unitById.get(u.id)!, u)).toBeLessThan(1e-6);
      }
    }
    expect(inserted).toBeGreaterThan(5);
    expect(displacedAny).toBeGreaterThan(0);
  });

  it("accepts open ground only where the branch's root fits without touching anything", () => {
    const b = scene.bounds!;
    const outside = { x: b.maxX + mover.footprint! * 3, y: b.maxY + mover.footprint! * 3 };
    const carried = descendantIds(scene, mover.id);
    expect(planInsertion({ scene, base: scene, unitId: mover.id, pointer: outside, carried }).kind).toBe("free");
    // Right on top of an unrelated unit there is no room.
    const other = scene.units.find((u) => u.depth === 5 && !carried.has(u.id) && u.parentId !== parent.id)!;
    expect(planInsertion({ scene, base: scene, unitId: mover.id, pointer: { x: other.x, y: other.y }, carried }))
      .toEqual({ kind: "none", reason: "no-room" });
  });

  it("never moves the company itself", () => {
    const root = scene.units.find((u) => !u.parentId)!;
    expect(planInsertion({ scene, base: scene, unitId: root.id, pointer: { x: 0, y: 0 }, carried: new Set() }).kind).toBe("none");
  });
});
