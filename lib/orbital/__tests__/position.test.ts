import { describe, expect, it } from "vitest";
import { anglePlacementOffsets, applyPositionOffsets, combinePositionOffsets } from "../position";
import { layoutOrbital } from "../layout";
import { buildOrbitalTree } from "../model";
import { demoInput } from "./orbitalFixture";

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
