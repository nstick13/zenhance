import { describe, expect, it } from "vitest";
import { anglePlacementOffsets, applyPositionOffsets, combinePositionOffsets, savedAnglePoint } from "@/lib/map/layout/position";
import { angleDelta } from "@/lib/map/layout/geometry";
import { layoutOrbital } from "@/lib/map/layout/layout";
import { layoutOrbitalForest } from "@/lib/map/layout/forest";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import { buildOrbitalTree } from "@/lib/map/layout/model";
import { demoInput } from "@/lib/map/layout/__tests__/orbitalFixture";

describe("snap-off position offsets", () => {
  it("moves a unit and its people without changing its parent", () => {
    const scene = layoutOrbital(buildOrbitalTree(demoInput()));
    const before = scene.unitById.get("starlight")!;
    const seatBefore = scene.seatsByUnit.get("starlight")![0];
    const moved = applyPositionOffsets(scene, new Map([["starlight", { x: 70, y: -20 }]]), new Map());
    expect(moved.unitById.get("starlight")?.parentId).toBe(before.parentId);
    expect(moved.unitById.get("starlight")?.x).toBe(before.x + 70);
    expect(moved.seatById.get(seatBefore.id)?.x).toBe(seatBefore.x + 70);
  });

  it("can move a person independently", () => {
    const scene = layoutOrbital(buildOrbitalTree(demoInput()));
    const seat = scene.seats[0];
    const moved = applyPositionOffsets(scene, new Map(), new Map([[seat.id, { x: 12, y: 18 }]]));
    expect(moved.seatById.get(seat.id)?.unitId).toBe(seat.unitId);
    expect(moved.seatById.get(seat.id)?.y).toBe(seat.y + 18);
  });

  it("places a dragged branch without re-packing any unrelated node", () => {
    const scene = layoutOrbital(buildOrbitalTree(demoInput()));
    const atlas = scene.unitById.get("atlas")!;
    const beforeChild = scene.unitById.get("starlight")!;
    const beforeOther = scene.unitById.get("orion")!;
    const offsets = anglePlacementOffsets(scene, new Map([["atlas", atlas.angle + 0.35]]));
    const moved = applyPositionOffsets(scene, offsets, new Map());
    const afterAtlas = moved.unitById.get("atlas")!;
    const afterChild = moved.unitById.get("starlight")!;
    const afterOther = moved.unitById.get("orion")!;
    expect(afterAtlas.x).not.toBeCloseTo(atlas.x);
    expect(afterChild.x - beforeChild.x).toBeCloseTo(afterAtlas.x - atlas.x);
    expect(afterChild.y - beforeChild.y).toBeCloseTo(afterAtlas.y - atlas.y);
    expect(afterOther.x).toBe(beforeOther.x);
    expect(afterOther.y).toBe(beforeOther.y);
  });

  it("adds free placement to a saved orbital position", () => {
    const scene = layoutOrbital(buildOrbitalTree(demoInput()));
    const saved = anglePlacementOffsets(scene, new Map([["atlas", scene.unitById.get("atlas")!.angle + 0.2]]));
    const combined = combinePositionOffsets(saved, new Map([["atlas", { x: 12, y: -7 }]]));
    expect(combined.get("atlas")!.x).toBeCloseTo(saved.get("atlas")!.x + 12);
    expect(combined.get("atlas")!.y).toBeCloseTo(saved.get("atlas")!.y - 7);
  });
});

describe("saved angles in local branch geography", () => {
  const tree = () => {
    const org = buildDeepOrg("position", { people: 2562, maxDepth: 11, seed: 20260914 });
    return buildOrbitalTree({ units: org.units, people: org.people, assignments: org.assignments },
      { mergePassThroughRoot: false, workCountFor: () => 6 });
  };
  const built = tree();
  const scene = layoutOrbitalForest(built, { geography: "local" });
  const fromParent = (u: { x: number; y: number }, p: { x: number; y: number }) => Math.atan2(u.y - p.y, u.x - p.x);

  it("reads a saved angle as the unit's direction from its parent, at its own orbit", () => {
    const unit = scene.units.find((u) => u.depth === 4)!;
    const parent = scene.unitById.get(unit.parentId!)!;
    const orbit = Math.hypot(unit.x - parent.x, unit.y - parent.y);
    const turned = fromParent(unit, parent) + 0.12;
    const offsets = anglePlacementOffsets(scene, new Map([[unit.id, turned]]));
    const moved = applyPositionOffsets(scene, offsets, new Map()).unitById.get(unit.id)!;
    expect(moved.x).toBeCloseTo(parent.x + orbit * Math.cos(turned), 6);
    expect(moved.y).toBeCloseTo(parent.y + orbit * Math.sin(turned), 6);
  });

  it("brings every drop back exactly where it was dropped", () => {
    let checked = 0;
    for (const unit of scene.units) {
      if (!unit.parentId) continue;
      const parent = scene.unitById.get(unit.parentId)!;
      const orbit = Math.hypot(unit.x - parent.x, unit.y - parent.y);
      for (const turn of [-0.4, 0.25]) {
        const spot = savedAnglePoint(parent, orbit, fromParent(unit, parent) + turn);
        const saved = fromParent(spot, parent);
        const moved = applyPositionOffsets(scene, anglePlacementOffsets(scene, new Map([[unit.id, saved]])), new Map())
          .unitById.get(unit.id)!;
        expect(moved.x).toBeCloseTo(spot.x, 6);
        expect(moved.y).toBeCloseTo(spot.y, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(800);
  });

  it("carries an arrangement saved on rings to the same side of each unit's parent", () => {
    const ring = layoutOrbitalForest(built);
    const centre = ring.families![0].centre;
    const deviations: number[] = [];
    for (const unit of ring.units) {
      if (!unit.parentId) continue;
      const parent = ring.unitById.get(unit.parentId)!;
      // What a ring-era save holds: the direction from the centre…
      const saved = Math.atan2(unit.y - centre.y, unit.x - centre.x);
      // …against where the ring map actually had the unit, seen from its parent.
      deviations.push(Math.abs(angleDelta(saved, fromParent(unit, parent))));
    }
    deviations.sort((a, b) => a - b);
    expect(deviations[Math.floor(deviations.length / 2)]).toBeLessThan((15 * Math.PI) / 180);
    expect(deviations[deviations.length - 1]).toBeLessThan(Math.PI / 2);
  });

  it("never discards a saved angle, and leaves the company itself where it is", () => {
    const root = scene.units.find((u) => u.parentId === null)!;
    const unit = scene.units.find((u) => u.depth === 6)!;
    const offsets = anglePlacementOffsets(scene, new Map([[unit.id, 2.5], [root.id, 1.23]]));
    expect(offsets.has(unit.id)).toBe(true);
    const moved = applyPositionOffsets(scene, offsets, new Map());
    expect(moved.unitById.get(root.id)!.x).toBe(root.x);
    expect(moved.unitById.get(unit.id)!.x).not.toBeCloseTo(unit.x, 3);
  });

  it("carries a moved unit's branch with it", () => {
    const unit = scene.units.find((u) => u.depth === 3 && u.childIds.length > 0)!;
    const child = scene.unitById.get(unit.childIds[0])!;
    const parent = scene.unitById.get(unit.parentId!)!;
    const offsets = anglePlacementOffsets(scene, new Map([[unit.id, fromParent(unit, parent) + 0.2]]));
    const moved = applyPositionOffsets(scene, offsets, new Map());
    const u1 = moved.unitById.get(unit.id)!;
    const c1 = moved.unitById.get(child.id)!;
    expect(c1.x - child.x).toBeCloseTo(u1.x - unit.x, 6);
    expect(c1.y - child.y).toBeCloseTo(u1.y - unit.y, 6);
  });
});
