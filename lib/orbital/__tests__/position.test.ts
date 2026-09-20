import { describe, expect, it } from "vitest";
import { applyPositionOffsets } from "../position";
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
});
