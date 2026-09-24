import { describe, it, expect } from "vitest";
import { angleDelta, radiusOf, sectorContains, type Point } from "@/lib/map/layout/geometry";
import { applyOverrides, buildOrbitalTree } from "@/lib/map/layout/model";
import { bandAtRadius, layoutOrbital, unitOwningAngle } from "@/lib/map/layout/layout";
import { demoInput } from "@/lib/map/layout/__tests__/orbitalFixture";

const scene = () => layoutOrbital(buildOrbitalTree(demoInput(), { workCountFor: () => 6 }));

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe("layoutOrbital — rungs", () => {
  it("puts the company at the exact centre", () => {
    const s = scene();
    const root = s.unitById.get("company")!;
    expect(root.x).toBeCloseTo(0);
    expect(root.y).toBeCloseTo(0);
    expect(root.depth).toBe(0);
  });

  it("holds every node on a rung at one radius from the centre — radius is depth", () => {
    const s = scene();
    for (let depth = 1; depth <= s.maxDepth; depth++) {
      const radii = s.units.filter((u) => u.depth === depth).map((u) => radiusOf(u));
      expect(radii.length).toBeGreaterThan(0);
      for (const r of radii) expect(r).toBeCloseTo(radii[0], 6);
    }
  });

  it("pushes each rung strictly further out than the one inside it", () => {
    const s = scene();
    for (let depth = 1; depth <= s.maxDepth; depth++) {
      const inner = s.bands.find((b) => b.depth === depth - 1)!.radius;
      const outer = s.bands.find((b) => b.depth === depth)!.radius;
      expect(outer).toBeGreaterThan(inner);
    }
  });

  it("leaves clear air between a rung's furniture and the next rung's nodes", () => {
    const s = scene();
    for (const unit of s.units) {
      const parent = unit.parentId ? s.unitById.get(unit.parentId) : null;
      if (!parent) continue;
      expect(dist(unit, parent)).toBeGreaterThan(unit.r + parent.r);
    }
  });
});

describe("layoutOrbital — holds up as the org grows", () => {
  /** A deliberately wide org: many streams, many teams each, many people. */
  const wide = (streams: number, teamsPer: number, peoplePer: number) => {
    const input = {
      units: [{ id: "root", name: "Company", parentId: null as string | null }],
      people: [] as { id: string; name: string }[],
      assignments: [] as { personId: string; orgUnitId: string; allocationPct: number }[],
    };
    for (let s = 0; s < streams; s++) {
      input.units.push({ id: `s${s}`, name: `Stream ${s}`, parentId: "root" });
      for (let t = 0; t < teamsPer; t++) {
        const tid = `s${s}t${t}`;
        input.units.push({ id: tid, name: `Team ${s}-${t}`, parentId: `s${s}` });
        for (let p = 0; p < peoplePer; p++) {
          const pid = `${tid}p${p}`;
          input.people.push({ id: pid, name: `Person ${pid}` });
          input.assignments.push({ personId: pid, orgUnitId: tid, allocationPct: 100 });
        }
      }
    }
    return layoutOrbital(buildOrbitalTree(input, { workCountFor: () => 4 }));
  };

  it("never overlaps two nodes on a rung, however many are standing on it", () => {
    // The regression: rung radius used to come from node size alone, so a
    // rung holding eighty teams got the same circumference as one holding
    // eight and the packer compressed them straight through each other.
    const s = wide(8, 6, 8);
    for (let depth = 1; depth <= s.maxDepth; depth++) {
      const rung = s.units.filter((u) => u.depth === depth);
      for (let i = 0; i < rung.length; i++) {
        for (let j = i + 1; j < rung.length; j++) {
          expect(dist(rung[i], rung[j])).toBeGreaterThan(rung[i].r + rung[j].r);
        }
      }
    }
  });

  it("grows the map outward as the org gets wider", () => {
    expect(wide(8, 6, 8).extent).toBeGreaterThan(wide(3, 3, 8).extent);
    expect(wide(14, 10, 9).extent).toBeGreaterThan(wide(8, 6, 8).extent);
  });

  it("keeps people clear of each other on a crowded unit", () => {
    const s = wide(6, 5, 14);
    for (const [, group] of s.seatsByUnit) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          expect(dist(group[i], group[j])).toBeGreaterThan(group[i].r + group[j].r - 1e-6);
        }
      }
    }
  });

  it("draws every unit at one size, however big the org gets", () => {
    // Since 2026-09-24 a unit is one size on both maps (geometry.UNIT_RADIUS),
    // so the rung a node stands on no longer changes how big it is. What this
    // guards now is that the *rungs* still open out for a wider org — the
    // spacing does the work that node size used to.
    const small = scene();
    const big = wide(14, 10, 9);
    expect(big.maxDepth).toBeGreaterThanOrEqual(2);
    for (let d = 1; d <= big.maxDepth; d++) {
      expect(big.bands[d].nodeRadius).toBe(small.bands[d].nodeRadius);
      expect(big.bands[d].radius).toBeGreaterThan(small.bands[d].radius);
    }
  });

  it("never lets a rung's nodes outgrow the rung inside it", () => {
    // Depth used to be carried by size. It is carried by the visible routes
    // now, so equal is the expected answer below the company — what must
    // never happen is a rung's nodes growing as you go outward.
    for (const s of [scene(), wide(8, 6, 8), wide(14, 10, 9)]) {
      for (let d = 1; d < s.bands.length; d++) {
        expect(s.bands[d].nodeRadius).toBeLessThanOrEqual(s.bands[d - 1].nodeRadius);
      }
    }
  });
});

describe("layoutOrbital — angle follows the parent", () => {
  it("sits a child outboard of its parent, on the side away from the grandparent", () => {
    const s = scene();
    for (const unit of s.units) {
      if (unit.depth < 2) continue;
      const parent = s.unitById.get(unit.parentId!)!;
      const grandparent = s.unitById.get(parent.parentId!)!;
      // Further from the grandparent than its own parent is…
      expect(dist(unit, grandparent)).toBeGreaterThan(dist(parent, grandparent));
      // …and on the outward side of it, not doubling back past it.
      const outward = { x: parent.x - grandparent.x, y: parent.y - grandparent.y };
      const toChild = { x: unit.x - parent.x, y: unit.y - parent.y };
      expect(outward.x * toChild.x + outward.y * toChild.y).toBeGreaterThan(0);
    }
  });

  it("keeps every child inside the sector its parent handed it", () => {
    const s = scene();
    for (const unit of s.units) {
      if (!unit.parentId) continue;
      expect(sectorContains(unit.sector, unit.angle)).toBe(true);
    }
  });

  it("never lets two sibling sectors overlap", () => {
    const s = scene();
    for (const parent of s.units) {
      const kids = parent.childIds.map((id) => s.unitById.get(id)!).filter(Boolean);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const gap = Math.abs(angleDelta(kids[i].sector.center, kids[j].sector.center));
          expect(gap).toBeGreaterThanOrEqual(
            kids[i].sector.halfSpan + kids[j].sector.halfSpan - 1e-6,
          );
        }
      }
    }
  });

  it("spreads the company's own children around the whole circle", () => {
    const s = scene();
    const first = s.units.filter((u) => u.depth === 1).map((u) => u.angle).sort((a, b) => a - b);
    const spread = first[first.length - 1] - first[0];
    expect(spread).toBeGreaterThan(Math.PI); // not huddled on one side
  });

  it("packs a cluster tightly and leaves the rest of the ring empty", () => {
    const s = scene();
    const atlasKids = s.unitById.get("atlas")!.childIds.map((id) => s.unitById.get(id)!);
    const angles = atlasKids.map((u) => u.angle).sort((a, b) => a - b);
    expect(angles[angles.length - 1] - angles[0]).toBeLessThan(Math.PI / 2);
  });

  it("never overlaps two nodes on the same rung", () => {
    const s = scene();
    for (let depth = 1; depth <= s.maxDepth; depth++) {
      const onRung = s.units.filter((u) => u.depth === depth);
      for (let i = 0; i < onRung.length; i++) {
        for (let j = i + 1; j < onRung.length; j++) {
          expect(dist(onRung[i], onRung[j])).toBeGreaterThan(onRung[i].r + onRung[j].r);
        }
      }
    }
  });
});

describe("layoutOrbital — people", () => {
  it("fans a leaf's people outward, away from their unit's parent", () => {
    const s = scene();
    const starlight = s.unitById.get("starlight")!;
    const atlas = s.unitById.get("atlas")!;
    const outward = Math.atan2(starlight.y - atlas.y, starlight.x - atlas.x);
    expect(Math.abs(angleDelta(outward, starlight.seatFanAngle))).toBeLessThan(Math.PI / 2);
  });

  it("moves a branch's people off to the side, where its children aren't", () => {
    const s = scene();
    const atlas = s.unitById.get("atlas")!;
    for (const childId of atlas.childIds) {
      const child = s.unitById.get(childId)!;
      const toChild = Math.atan2(child.y - atlas.y, child.x - atlas.x);
      expect(Math.abs(angleDelta(toChild, atlas.seatFanAngle))).toBeGreaterThan(0.4);
    }
  });

  it("hangs every seat off its own unit, clear of the circle", () => {
    const s = scene();
    for (const seat of s.seats) {
      const unit = s.unitById.get(seat.unitId)!;
      expect(dist(seat, unit)).toBeGreaterThan(unit.r + seat.r);
    }
  });

  it("never overlaps two people on the same unit", () => {
    const s = scene();
    for (const [, group] of s.seatsByUnit) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          expect(dist(group[i], group[j])).toBeGreaterThan(group[i].r + group[j].r - 1e-6);
        }
      }
    }
  });

  it("runs each person's work grid straight out along their own link home", () => {
    const s = scene();
    const withWork = s.seats.filter((seat) => seat.work.length > 0);
    expect(withWork.length).toBeGreaterThan(0);
    for (const seat of withWork) {
      const unit = s.unitById.get(seat.unitId)!;
      const axis = Math.atan2(seat.y - unit.y, seat.x - unit.x);
      for (const w of seat.work) {
        // Every work item is further from the unit than the person is.
        expect(dist(w, unit)).toBeGreaterThan(dist(seat, unit));
      }
      // The grid's long axis is that same line, not an arbitrary one: the
      // furthest row sits almost exactly on it.
      const last = seat.work[seat.work.length - 1];
      const gridAxis = Math.atan2(last.y - seat.y, last.x - seat.x);
      expect(Math.abs(angleDelta(axis, gridAxis))).toBeLessThan(0.3);
    }
  });
});

describe("layoutOrbital — links and extent", () => {
  it("draws a link for every parent/child and every person", () => {
    const s = scene();
    const unitLinks = s.links.filter((l) => l.kind === "unit");
    const seatLinks = s.links.filter((l) => l.kind === "seat");
    expect(unitLinks).toHaveLength(s.units.length - 1); // everything but the centre
    expect(seatLinks).toHaveLength(s.seats.length);
  });

  it("contains everything it draws, work items included", () => {
    const s = scene();
    for (const unit of s.units) expect(radiusOf(unit) + unit.r).toBeLessThanOrEqual(s.extent + 1e-6);
    for (const seat of s.seats) {
      for (const w of seat.work) expect(radiusOf(w)).toBeLessThanOrEqual(s.extent + 1e-6);
    }
  });

  it("is deterministic", () => {
    expect(scene().units).toEqual(scene().units);
    expect(scene().seats).toEqual(scene().seats);
  });
});

describe("the backdrop as a classifier", () => {
  it("reads a radius back as the rung it belongs to", () => {
    const s = scene();
    for (const band of s.bands) {
      expect(bandAtRadius(s, band.radius)).toBe(band.depth);
    }
  });

  it("hands an angle to the unit whose sector owns it", () => {
    const s = scene();
    for (const unit of s.units.filter((u) => u.depth === 1)) {
      expect(unitOwningAngle(s, 1, unit.angle)?.id).toBe(unit.id);
    }
  });
});

describe("angle overrides", () => {
  it("moves only the node that was dragged", () => {
    const tree = buildOrbitalTree(demoInput());
    const before = layoutOrbital(tree);
    const target = before.unitById.get("orion")!;
    const after = layoutOrbital(tree, {
      angleOverrides: new Map([["orion", target.angle + 0.6]]),
    });
    expect(after.unitById.get("orion")!.angle).toBeCloseTo(target.angle + 0.6);
    expect(after.unitById.get("atlas")!.angle).toBeCloseTo(before.unitById.get("atlas")!.angle);
  });

  it("keeps a promoted node clear of the siblings that shuffle to receive it", () => {
    // The regression: dropping a team onto the company's ring adds a fifth
    // child, so the whole ring re-spreads — and a sibling can land exactly on
    // the angle the drop just chose. The snap was computed against the ring
    // as it stood *before* the move, so only the layout can catch this.
    const tree = applyOverrides(buildOrbitalTree(demoInput()), {
      unitParent: new Map([["starlight", "company"]]),
    });
    const before = layoutOrbital(tree);
    const dropped = before.unitById.get("starlight")!.angle;
    const after = layoutOrbital(tree, { angleOverrides: new Map([["starlight", dropped]]) });

    const promoted = after.unitById.get("starlight")!;
    for (const sibling of after.units.filter((u) => u.depth === 1 && u.id !== "starlight")) {
      expect(Math.hypot(sibling.x - promoted.x, sibling.y - promoted.y)).toBeGreaterThan(
        sibling.r + promoted.r,
      );
    }
  });

  it("holds a dragged node near where it was dropped rather than re-packing it away", () => {
    const tree = buildOrbitalTree(demoInput());
    const before = layoutOrbital(tree);
    const wanted = before.unitById.get("moonlight")!.angle + 0.25;
    const after = layoutOrbital(tree, { angleOverrides: new Map([["moonlight", wanted]]) });
    expect(Math.abs(angleDelta(wanted, after.unitById.get("moonlight")!.angle))).toBeLessThan(0.2);
  });

  it("carries the dragged node's subtree round with it", () => {
    // Not by an identical delta: a child is placed inside the slice its parent
    // hands it, and a drag re-centres that slice on the angle it was dropped
    // at — so the subtree follows the *slice*, not the parent's own offset
    // within it. What has to hold is that the family travels with its parent
    // and stays underneath it.
    const tree = buildOrbitalTree(demoInput());
    const before = layoutOrbital(tree);
    const shift = 0.6;
    const after = layoutOrbital(tree, {
      angleOverrides: new Map([["atlas", before.unitById.get("atlas")!.angle + shift]]),
    });
    const parentBefore = before.unitById.get("atlas")!;
    const parentAfter = after.unitById.get("atlas")!;
    const childBefore = before.unitById.get("starlight")!;
    const childAfter = after.unitById.get("starlight")!;

    expect(parentAfter.angle).toBeCloseTo(parentBefore.angle + shift, 5); // it went where it was put
    expect(sectorContains(parentAfter.sector, childAfter.angle)).toBe(true); // child still its parent's
    // And the child didn't drift away from its parent while following.
    const offsetBefore = Math.abs(angleDelta(parentBefore.angle, childBefore.angle));
    const offsetAfter = Math.abs(angleDelta(parentAfter.angle, childAfter.angle));
    expect(offsetAfter).toBeLessThanOrEqual(offsetBefore + 0.05);
  });
});
