import { describe, expect, it } from "vitest";
import {
  BRANCH_GAP,
  FAN_WIDE,
  layoutBranches,
  localUnitRadius,
  LOCAL_MAX_R,
  LOCAL_MIN_R,
} from "@/lib/map/layout/branches";
import { structuralEnvelope, insideEnvelope } from "@/lib/map/layout/envelope";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { layoutOrbitalForest } from "@/lib/map/layout/forest";
import { treeForFocus } from "@/lib/map/layout/model";
import { unitDiscRadius, type OrbitalScene } from "@/lib/map/layout/layout";
import { UNIT_RADIUS, angleDelta } from "@/lib/map/layout/geometry";
import { desiredUnitRadius, neighbourAwareRadius } from "@/lib/map/camera/lod";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";

/** The deep fixture mints random UUIDs; give its units stable ids so two
 *  builds can be compared unit for unit. */
function stableDeep(people = 2562, maxDepth = 11, seed = 20260914): OrgInput {
  const org = buildDeepOrg("branches", { people, maxDepth, seed });
  const map = new Map<string, string>();
  org.units.forEach((u, i) => map.set(u.id, `u${i}`));
  org.people.forEach((p, i) => map.set(p.id, `p${i}`));
  const m = (id: string | null) => (id == null ? null : map.get(id) ?? id);
  return {
    units: org.units.map((u) => ({ id: m(u.id)!, name: u.name, parentId: m(u.parentId), leadPersonId: m(u.leadPersonId) })),
    people: org.people.map((p) => ({ id: m(p.id)!, name: p.name, title: p.title })),
    assignments: org.assignments.map((a) => ({
      personId: m(a.personId), orgUnitId: m(a.orgUnitId)!, allocationPct: a.allocationPct, isOpenRole: a.isOpenRole,
    })),
  };
}

const deepScene = (input = stableDeep()) =>
  layoutBranches(buildOrbitalTree(input, { mergePassThroughRoot: false, workCountFor: () => 6 }));

function footprintOverlaps(scene: OrbitalScene): number {
  let n = 0;
  const us = scene.units;
  for (let i = 0; i < us.length; i++) {
    for (let j = i + 1; j < us.length; j++) {
      const a = us[i];
      const b = us[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.footprint! + b.footprint! - 1e-6) n++;
    }
  }
  return n;
}

/** A chain: one unit per level, each with a small team on it. */
function chain(levels: number): OrgInput {
  const units = Array.from({ length: levels }, (_, i) => ({
    id: `c${i}`, name: `Level ${i}`, parentId: i === 0 ? null : `c${i - 1}`,
  }));
  const people = Array.from({ length: levels * 4 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
  const assignments = people.map((p, i) => ({ personId: p.id, orgUnitId: `c${Math.floor(i / 4)}` }));
  return { units, people, assignments };
}

describe("local branch geography", () => {
  const scene = deepScene();

  it("never lets two units' footprints overlap on a 2,500-person company", () => {
    expect(scene.units.length).toBeGreaterThan(400);
    expect(footprintOverlaps(scene)).toBe(0);
  });

  it("is far more compact than a company-wide ring map of the same company", () => {
    const ring = layoutOrbitalForest(buildOrbitalTree(stableDeep(), { mergePassThroughRoot: false, workCountFor: () => 6 }));
    const b = scene.bounds!;
    const localSpan = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    // Local geography is no longer chosen for compactness. Since 2026-09-24
    // it fans tightly and runs one way, which costs room and buys a map you
    // can read your position in (complexity.RINGS_HOPELESS says why that is
    // still the right trade). It must still not be *worse* than the rings.
    expect(localSpan).toBeLessThan(ring.extent * 1.7);
  });

  it("is deterministic", () => {
    const again = deepScene();
    expect(again.units.map((u) => [u.id, u.x, u.y])).toEqual(scene.units.map((u) => [u.id, u.x, u.y]));
  });

  it("keeps low-complexity siblings circular, then permits monotonically more radial variation", () => {
    const tree = buildOrbitalTree(stableDeep(400, 6, 7), { mergePassThroughRoot: false, workCountFor: () => 6 });
    const variation = (looseness: number) => {
      const placed = layoutBranches(tree, { radialLooseness: looseness });
      let sum = 0;
      for (const parent of placed.units) {
        const lengths = parent.childIds.map((id) => {
          const child = placed.unitById.get(id)!;
          return Math.hypot(child.x - parent.x, child.y - parent.y);
        });
        if (lengths.length > 1) sum += Math.max(...lengths) - Math.min(...lengths);
      }
      return sum;
    };
    const values = [0, 0.25, 0.5, 0.75, 1].map(variation);
    expect(values[0]).toBeCloseTo(0, 6);
    expect(values.at(-1)).toBeGreaterThan(0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 1e-6);
  });

  it("keeps every looseness level deterministic, bounded, local and collision-free", () => {
    const input = stableDeep(1000, 8, 17);
    const tree = buildOrbitalTree(input, { mergePassThroughRoot: false, workCountFor: () => 6 });
    for (const looseness of [0, 0.33, 0.66, 1]) {
      const a = layoutBranches(tree, { radialLooseness: looseness });
      const b = layoutBranches(tree, { radialLooseness: looseness });
      expect(a.units.map((u) => [u.id, u.x, u.y])).toEqual(b.units.map((u) => [u.id, u.x, u.y]));
      expect(footprintOverlaps(a)).toBe(0);
      const bounds = a.bounds!;
      expect(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)).toBeLessThan(1e7);
    }
  });

  it("gathers each unit's children around it, fanned away from its own parent", () => {
    for (const unit of scene.units) {
      if (!unit.parentId || unit.childIds.length === 0) continue;
      const parent = scene.unitById.get(unit.parentId)!;
      // The company's only child is laid out as a hub and is exempt.
      if (!parent.parentId && parent.childIds.length === 1) continue;
      const away = Math.atan2(unit.y - parent.y, unit.x - parent.x);
      for (const id of unit.childIds) {
        const child = scene.unitById.get(id)!;
        const bearing = Math.atan2(child.y - unit.y, child.x - unit.x);
        // A fan may widen past the preferred angle when holding a branch
        // tighter would fling it to the horizon, but never past FAN_WIDE.
        expect(Math.abs(angleDelta(away, bearing))).toBeLessThanOrEqual(FAN_WIDE / 2 + 1e-6);
      }
    }
  });

  it("links every parent to every child, so depth is carried by the routes", () => {
    const unitLinks = scene.links.filter((l) => l.kind === "unit");
    expect(unitLinks.length).toBe(scene.units.length - 1);
  });

  it("grows a deep chain by its length, not by doubling at each link", () => {
    const span = (levels: number) => {
      const s = layoutBranches(buildOrbitalTree(chain(levels), { mergePassThroughRoot: false }));
      const b = s.bounds!;
      return Math.max(b.maxX - b.minX, b.maxY - b.minY);
    };
    const ten = span(10);
    const thirty = span(30);
    expect(footprintOverlaps(layoutBranches(buildOrbitalTree(chain(30), { mergePassThroughRoot: false })))).toBe(0);
    // Linear growth: three times the links, a bit over three times the span.
    expect(thirty / ten).toBeLessThan(4);
    expect(thirty).toBeLessThan(1e6);
  });

  it("keeps the inside of a branch unchanged when an unrelated branch changes", () => {
    const base = stableDeep();
    const tree = buildOrbitalTree(base, { mergePassThroughRoot: false, workCountFor: () => 6 });
    // Pick two different divisions under the company's hub.
    const rootId = tree.rootId;
    const hub = tree.units.get(tree.units.get(rootId)!.childIds[0])!;
    const [a, b] = hub.childIds;
    // Add a team deep inside branch A.
    const leaf = [...tree.units.values()].find((u) => {
      let cursor: string | null = u.id;
      while (cursor && cursor !== a) cursor = tree.units.get(cursor)?.parentId ?? null;
      return cursor === a && u.childIds.length === 0;
    })!;
    const changed: OrgInput = { ...base, units: [...base.units, { id: "added", name: "Added team", parentId: leaf.id }] };
    const before = layoutBranches(tree);
    const after = deepScene(changed);
    // Every unit in branch B keeps its position relative to B itself.
    const branchB = [...treeForFocus(tree, b)!.units.keys()];
    const bBefore = before.unitById.get(b)!;
    const bAfter = after.unitById.get(b)!;
    for (const id of branchB) {
      const u0 = before.unitById.get(id)!;
      const u1 = after.unitById.get(id)!;
      const rel0 = { x: u0.x - bBefore.x, y: u0.y - bBefore.y };
      const rel1 = { x: u1.x - bAfter.x, y: u1.y - bAfter.y };
      // Same shape: equal distances from the branch root (it may rotate bodily).
      expect(Math.hypot(rel1.x, rel1.y)).toBeCloseTo(Math.hypot(rel0.x, rel0.y), 4);
    }
  });

  it("draws every unit at one size, with the company larger", () => {
    // Greg, 2026-09-24. The headcount pipeline below is intact and switched
    // off (size.SIZE_BY_HEADCOUNT); these two lines still hold it honest.
    expect(localUnitRadius(0)).toBe(LOCAL_MIN_R);
    expect(localUnitRadius(1)).toBe(LOCAL_MAX_R);
    const root = scene.units.find((u) => u.parentId === null)!;
    expect(root.r).toBeGreaterThan(UNIT_RADIUS);
    for (const u of scene.units) {
      if (u === root) continue;
      // One size, unless this unit's own people needed the room.
      expect(u.r).toBeGreaterThanOrEqual(UNIT_RADIUS - 1e-9);
      expect(u.r).toBe(unitDiscRadius(UNIT_RADIUS, u.seatIds.length));
      // Nothing carries an overview dot size any more, so the painters fall
      // back to the disc and every unit reads the same.
      expect(u.dotPx).toBeUndefined();
    }
  });

  it("never lets a zoomed-out dot swell into its nearest neighbour", () => {
    for (const u of scene.units) {
      for (const v of scene.units) {
        if (u === v) continue;
        expect(u.drawCeiling + v.drawCeiling).toBeLessThanOrEqual(Math.hypot(u.x - v.x, u.y - v.y) + 1e-6);
      }
    }
  });

  it("keeps people inside their own unit's footprint", () => {
    for (const seat of scene.seats) {
      const unit = scene.unitById.get(seat.unitId)!;
      expect(Math.hypot(seat.x - unit.x, seat.y - unit.y)).toBeLessThanOrEqual(unit.footprint! + 1e-6);
    }
  });

  it("keeps clear space between neighbours", () => {
    for (const unit of scene.units) {
      if (!unit.parentId) continue;
      const parent = scene.unitById.get(unit.parentId)!;
      expect(Math.hypot(unit.x - parent.x, unit.y - parent.y))
        .toBeGreaterThanOrEqual(unit.footprint! + parent.footprint! + BRANCH_GAP - 1e-6);
    }
  });
});

describe("the structural envelope", () => {
  const scene = deepScene();
  const envelope = structuralEnvelope(scene);

  it("wraps every unit's settled position", () => {
    for (const u of scene.units) expect(insideEnvelope(envelope, u)).toBe(true);
  });

  it("is a single territory for a single connected company", () => {
    // One outer outline; any others are pockets of open ground inside it.
    const areas = envelope.rings.map((ring) => {
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
      return Math.abs(a / 2);
    });
    const largest = Math.max(...areas);
    expect(areas.filter((a) => a > largest * 0.5)).toHaveLength(1);
  });

  it("stands off the structure, and not absurdly far", () => {
    const b = scene.bounds!;
    const xs = envelope.rings.flat().map((p) => p.x);
    const ys = envelope.rings.flat().map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(b.minX);
    expect(Math.max(...xs)).toBeGreaterThan(b.maxX);
    // The stand-off grows with the company, because a corridor has to stay
    // wider than the sampler's step (envelope.CORRIDOR_STEPS).
    const reach = Math.max(envelope.pad * 4, (b.maxX - b.minX) / 12);
    expect(Math.min(...xs)).toBeGreaterThan(b.minX - reach);
    expect(Math.max(...ys)).toBeLessThan(b.maxY + reach);
  });

  it("depends only on structure, so it is identical however often it is computed", () => {
    expect(structuralEnvelope(scene)).toEqual(envelope);
  });

  it("traces two separate territories as two outlines", () => {
    const two = structuralEnvelope({
      units: [{ x: 0, y: 0, r: 50 }, { x: 5000, y: 0, r: 50 }],
      links: [],
    });
    expect(two.rings).toHaveLength(2);
    expect(insideEnvelope(two, { x: 0, y: 0 })).toBe(true);
    expect(insideEnvelope(two, { x: 2500, y: 0 })).toBe(false);
  });
});

describe("dots that carry headcount without colliding", () => {
  const scene = deepScene();
  const byId = scene.unitById;
  const radiusAt = (scale: number, present: (id: string) => number) => {
    const want = (id: string) => desiredUnitRadius(byId.get(id)!, scale);
    return new Map(scene.units.map((u) => [u.id, neighbourAwareRadius(u, scale, want, present)]));
  };

  it("never lets two present dots overlap, at any zoom", () => {
    for (const scale of [0.02, 0.04, 0.08, 0.2, 0.6, 1.5]) {
      const drawn = radiusAt(scale, () => 1);
      for (const u of scene.units) {
        for (const n of u.near ?? []) {
          expect(drawn.get(u.id)! + drawn.get(n.id)!).toBeLessThanOrEqual(n.d + 1e-6);
        }
      }
    }
  });

  it("lets a unit take the room when the units round it are hidden", () => {
    // Far enough out that the screen floor makes the dots wide compared with
    // the gaps between them — which is when neighbours are competing at all.
    const scale = 0.005;
    const root = scene.units.find((u) => !u.parentId)!;
    const crowdedAll = radiusAt(scale, () => 1);
    // Whoever is most hemmed in by its neighbours gains the most when they
    // are thinned away — and never enough to cover a hidden neighbour.
    let gained = 0;
    for (const u of scene.units) {
      if (!u.parentId || u.parentId === root.id || (u.near?.length ?? 0) === 0) continue;
      const alone = radiusAt(scale, (id) => (id === u.id ? 1 : 0)).get(u.id)!;
      expect(alone).toBeGreaterThanOrEqual(crowdedAll.get(u.id)! - 1e-9);
      // Never wider than the room to its nearest neighbour — unless its own
      // disc is already wider than that room, which nothing may shrink.
      const room = Math.max(u.r, u.near![0].d - 2 / scale);
      expect(alone).toBeLessThanOrEqual(room + 1e-6);
      if (alone > crowdedAll.get(u.id)! + 1e-9) gained++;
    }
    expect(gained).toBeGreaterThan(0);
  });

  it("keeps two close neighbours both prominent, sharing the room between them", () => {
    const scale = 0.005;
    const drawn = radiusAt(scale, () => 1);
    // The closest pair on the map: whatever room there is between them, they
    // share it rather than one taking it and flattening the other.
    let pair: { a: string; b: string; d: number } | null = null;
    for (const u of scene.units) {
      const near = u.near?.[0];
      if (!near) continue;
      if (!pair || near.d < pair.d) pair = { a: u.id, b: near.id, d: near.d };
    }
    if (!pair) throw new Error("no neighbours");
    const room = pair.d - 2 / scale;
    expect(drawn.get(pair.a)! + drawn.get(pair.b)!).toBeLessThanOrEqual(Math.max(room, byId.get(pair.a)!.r + byId.get(pair.b)!.r) + 1e-6);
    // Neither is squeezed below its own disc.
    expect(drawn.get(pair.a)!).toBeGreaterThanOrEqual(byId.get(pair.a)!.r - 1e-9);
    expect(drawn.get(pair.b)!).toBeGreaterThanOrEqual(byId.get(pair.b)!.r - 1e-9);
  });

  it("reads the same whatever a unit carries, now that size says nothing", () => {
    // Greg, 2026-09-24: one size for every unit. A ten-person team and the
    // division above it are the same mark; what tells them apart is the
    // routes, the labels and the detail you get by going closer — not area.
    const scale = 0.04;
    const alone = (id: string) => neighbourAwareRadius(byId.get(id)!, scale, () => 0, () => 0) * scale;
    const teams = scene.units.filter((u) => u.childIds.length === 0);
    const smallTeam = teams.reduce((a, b) => (a.totalSeats <= b.totalSeats ? a : b));
    const division = scene.units.filter((u) => u.depth === 2).reduce((a, b) => (a.totalSeats >= b.totalSeats ? a : b));
    expect(alone(division.id)).toBeCloseTo(alone(smallTeam.id), 6);
  });
});
