import { describe, it, expect } from "vitest";
import { polar, radiusOf } from "@/lib/map/layout/geometry";
import { buildOrbitalTree } from "@/lib/map/layout/model";
import { layoutOrbital } from "@/lib/map/layout/layout";
import { descendantIds, snapSeat, snapUnit, snapUnitOnRing } from "@/lib/map/layout/snap";
import { demoInput } from "@/lib/map/layout/__tests__/orbitalFixture";

const scene = () => layoutOrbital(buildOrbitalTree(demoInput(), { workCountFor: () => 4 }));

describe("snapUnit — angle says who you belong to", () => {
  it("hands a node to whichever parent's sector it was dropped in", () => {
    const s = scene();
    const orion = s.unitById.get("orion")!;
    const starlight = s.unitById.get("starlight")!; // an Atlas team
    // Drop it out at its own rung, but under Orion's angle.
    const snap = snapUnit(s, starlight.id, polar(orion.angle, radiusOf(starlight)));
    expect(snap).not.toBeNull();
    expect(snap!.parentId).toBe("orion");
    expect(snap!.reparents).toBe(true);
  });

  it("leaves a node where it is when it barely moves", () => {
    const s = scene();
    const starlight = s.unitById.get("starlight")!;
    const snap = snapUnit(s, starlight.id, { x: starlight.x, y: starlight.y });
    expect(snap!.parentId).toBe("atlas");
    expect(snap!.reparents).toBe(false);
    expect(snap!.rerungs).toBe(false);
  });
});

describe("snapUnit — radius says which rung you are on", () => {
  it("promotes a node dragged inward onto the rung it was dropped on", () => {
    const s = scene();
    const starlight = s.unitById.get("starlight")!; // depth 2
    const innerBand = s.bands.find((b) => b.depth === 1)!.radius;
    const snap = snapUnit(s, starlight.id, polar(starlight.angle, innerBand));
    expect(snap!.depth).toBe(1);
    expect(snap!.rerungs).toBe(true);
    expect(snap!.parentId).toBe("company"); // a rung up means a new parent too
  });

  it("lands the node exactly on that rung's band, not where the cursor was", () => {
    const s = scene();
    const band = s.bands.find((b) => b.depth === 2)!.radius;
    const snap = snapUnit(s, "starlight", polar(0.4, band + 40));
    expect(radiusOf(snap!.position)).toBeCloseTo(band, 6);
  });

  it("refuses to displace the company at the centre", () => {
    const s = scene();
    expect(snapUnit(s, s.unitById.get("company")!.id, { x: 10, y: 10 })).toBeNull();
  });

  it("never drops below the first rung, however far in you drag", () => {
    const s = scene();
    const snap = snapUnit(s, "starlight", { x: 1, y: 1 });
    expect(snap!.depth).toBeGreaterThanOrEqual(1);
  });
});

describe("snapUnit — a subtree can't swallow itself", () => {
  it("collects a node's own descendants", () => {
    const s = scene();
    const ids = descendantIds(s, "atlas");
    expect([...ids].sort()).toEqual(["atlas", "moonlight", "starlight"]);
  });

  it("never reparents a node onto one of its own children", () => {
    const s = scene();
    const starlight = s.unitById.get("starlight")!;
    const band = s.bands.find((b) => b.depth === 2)!.radius;
    // Aim Atlas straight at where its own child Starlight sits.
    const snap = snapUnit(s, "atlas", polar(starlight.angle, band));
    expect(snap).not.toBeNull();
    expect(descendantIds(s, "atlas").has(snap!.parentId)).toBe(false);
  });
});

describe("snapUnit — no burying one node under another", () => {
  it("nudges off a sibling already sitting at that angle", () => {
    const s = scene();
    const moonlight = s.unitById.get("moonlight")!;
    const band = s.bands.find((b) => b.depth === 2)!.radius;
    const snap = snapUnit(s, "starlight", polar(moonlight.angle, band));
    expect(snap!.parentId).toBe("atlas");
    expect(Math.abs(snap!.angle - moonlight.angle)).toBeGreaterThan(1e-3);
  });
});

describe("snapUnitOnRing — geography never changes reporting", () => {
  it("keeps the real parent when moved beside another parent's units", () => {
    const s = scene();
    const orion = s.unitById.get("orion")!;
    const starlight = s.unitById.get("starlight")!;
    const snap = snapUnitOnRing(s, starlight.id, polar(orion.angle, radiusOf(starlight)));
    expect(snap?.parentId).toBe("atlas");
    expect(snap?.reparents).toBe(false);
    expect(snap?.rerungs).toBe(false);
  });

  it("only proposes a level change when moved to another ring", () => {
    const s = scene();
    const starlight = s.unitById.get("starlight")!;
    const innerBand = s.bands.find((band) => band.depth === 1)!.radius;
    const snap = snapUnitOnRing(s, starlight.id, polar(starlight.angle, innerBand));
    expect(snap?.depth).toBe(1);
    expect(snap?.rerungs).toBe(true);
    expect(snap?.parentId).toBe("atlas");
  });
});

describe("snapSeat", () => {
  it("follows the unit the cursor is nearest", () => {
    const s = scene();
    const seat = s.seats.find((x) => x.personId === "ana" && x.unitId === "starlight")!;
    const moonlight = s.unitById.get("moonlight")!;
    const snap = snapSeat(s, seat.id, { x: moonlight.x + 4, y: moonlight.y + 4 });
    expect(snap!.unitId).toBe("moonlight");
    expect(snap!.moves).toBe(true);
  });

  it("lands on that unit's seat ring, clear of the circle", () => {
    const s = scene();
    const seat = s.seats[0];
    const target = s.unitById.get("earthlight")!;
    const snap = snapSeat(s, seat.id, { x: target.x + 30, y: target.y - 10 })!;
    const away = Math.hypot(snap.position.x - target.x, snap.position.y - target.y);
    expect(away).toBeGreaterThan(target.r + seat.r);
  });

  it("can move a person up a rung, onto a group", () => {
    const s = scene();
    const seat = s.seats.find((x) => x.unitId === "starlight")!;
    const atlas = s.unitById.get("atlas")!;
    const snap = snapSeat(s, seat.id, { x: atlas.x, y: atlas.y - atlas.r - 6 })!;
    expect(snap.unitId).toBe("atlas");
  });

  it("does not stack a person on top of one already there", () => {
    const s = scene();
    const moving = s.seats.find((x) => x.unitId === "starlight" && x.personId === "ana")!;
    const sitting = s.seats.find((x) => x.unitId === "moonlight")!;
    const snap = snapSeat(s, moving.id, { x: sitting.x, y: sitting.y })!;
    const apart = Math.hypot(snap.position.x - sitting.x, snap.position.y - sitting.y);
    expect(apart).toBeGreaterThan(moving.r);
  });

  it("is null for a seat the scene has never heard of", () => {
    expect(snapSeat(scene(), "nope", { x: 0, y: 0 })).toBeNull();
  });
});
