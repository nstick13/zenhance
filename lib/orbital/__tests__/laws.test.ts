/**
 * The four laws of the layout engine (Greg, 2026-09-23 —
 * docs/LAYOUT-ENGINE-PROMPT.md). These are not goals; if one of them cannot
 * be met the design changes, not the law. So each gets a test that fails the
 * moment it stops being true.
 *
 *   1  the picture is a pure function of structure and saved placements
 *   2  a node lands exactly where the hand let go, and reloads there
 *   3  an authored placement is an obstacle, never a suggestion
 *   4  the engine never crosses a connection or overlaps two bodies
 *
 * Law 4 binds the *engine*. A person may deliberately drop a node on top of
 * another; that placement stands, and that is Law 3.
 */
import { describe, expect, it } from "vitest";
import { buildDeepOrg } from "./fixtures/deepOrg";
import { demoInput } from "./orbitalFixture";
import { buildOrbitalTree, type OrgInput } from "../model";
import { layoutCompany } from "../complexity";
import { layoutOrbitalForest } from "../forest";
import { planInsertion } from "@/lib/map/growth/insertion";
import { anglePlacementOffsets, applyPositionOffsets, type Placement } from "../position";
import { descendantIds } from "../snap";
import { interactionOrbit, INTERACTION_ORBIT_MIN_PX } from "@/lib/map/growth/relationship";
import { structuralEnvelope } from "../envelope";
import type { OrbitalScene, PlacedUnit } from "../layout";

const deepInput = (people: number, maxDepth: number, seed: number): OrgInput => {
  const org = buildDeepOrg("w", { people, maxDepth, seed });
  return { units: org.units, people: org.people, assignments: org.assignments };
};

const treeOf = (input: OrgInput) =>
  buildOrbitalTree(input, { mergePassThroughRoot: false, workCountFor: () => 6 });

const big = deepInput(2400, 11, 20260914);
const mid = deepInput(1000, 8, 17);

const reachOf = (u: PlacedUnit) => u.footprint ?? u.r;

/** Every pair of bodies that shares space. */
function bodyOverlaps(scene: OrbitalScene): number {
  const us = scene.units;
  let n = 0;
  for (let i = 0; i < us.length; i++) {
    for (let j = i + 1; j < us.length; j++) {
      if (Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y) < reachOf(us[i]) + reachOf(us[j])) n++;
    }
  }
  return n;
}

/** Every pair of parent→child connections that cross. Links sharing an end
 *  meet there by design and are not crossings. */
function linkCrossings(scene: OrbitalScene): number {
  const segs = scene.links
    .filter((l) => l.kind === "unit")
    .map((l) => ({ a: l.from, b: l.to, s: l.sourceId, t: l.targetId }));
  const side = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (b.x - a.x) * (o.y - a.y) - (b.y - a.y) * (o.x - a.x);
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i];
      const q = segs[j];
      if (p.s === q.s || p.t === q.t || p.s === q.t || p.t === q.s) continue;
      const d1 = side(p.a, q.a, q.b);
      const d2 = side(p.b, q.a, q.b);
      const d3 = side(q.a, p.a, p.b);
      const d4 = side(q.b, p.a, p.b);
      if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) n++;
    }
  }
  return n;
}

describe("Law 1 — the picture is a pure function", () => {
  it("gives byte-identical positions for the same company, every time", () => {
    const tree = treeOf(big);
    const a = layoutCompany(tree).scene;
    const b = layoutCompany(tree).scene;
    expect(b.units.map((u) => [u.id, u.x, u.y])).toEqual(a.units.map((u) => [u.id, u.x, u.y]));
  });

  it("does not depend on the order the company arrives in", () => {
    const shuffled: OrgInput = {
      ...big,
      // Reverse every list. A layout that reads its input as a set cannot
      // notice; one that accumulates state will.
      units: [...big.units].reverse(),
      people: [...big.people].reverse(),
      assignments: [...big.assignments].reverse(),
    };
    const a = layoutCompany(treeOf(big)).scene;
    const b = layoutCompany(treeOf(shuffled)).scene;
    const key = (s: OrbitalScene) =>
      [...s.units].sort((p, q) => (p.id < q.id ? -1 : 1)).map((u) => [u.id, u.x, u.y]);
    expect(key(b)).toEqual(key(a));
  });

  it("holds on the ring map too", () => {
    const tree = treeOf(demoInput());
    const a = layoutOrbitalForest(tree);
    const b = layoutOrbitalForest(tree);
    expect(b.units.map((u) => [u.id, u.x, u.y])).toEqual(a.units.map((u) => [u.id, u.x, u.y]));
  });
});

describe("Law 4 — the engine never crosses a link or overlaps a body", () => {
  const companies: [string, OrbitalScene][] = [
    ["2,562 people, 11 levels", layoutCompany(treeOf(big)).scene],
    ["1,000 people, 8 levels", layoutCompany(treeOf(mid)).scene],
    ["the 45-person demo", layoutCompany(treeOf(demoInput())).scene],
  ];

  for (const [name, scene] of companies) {
    it(`draws ${name} with nothing on top of anything else`, () => {
      expect(bodyOverlaps(scene)).toBe(0);
    });

    it(`draws ${name} with no connection crossing another`, () => {
      expect(linkCrossings(scene)).toBe(0);
    });
  }

  it("lets children sit at different distances — and still never crosses", () => {
    // Greg, 2026-09-24: "make use of variable connection line lengths where
    // needed". Variation is what used to cause the only three crossings on
    // this company; it is now bounded by each branch's angular slot, so both
    // things can be true at once. The crossing count above is the other half
    // of this test.
    const scene = layoutCompany(treeOf(big)).scene;
    let varied = 0;
    let checked = 0;
    for (const parent of scene.units) {
      const kids = parent.childIds
        .map((id) => scene.unitById.get(id))
        .filter((k): k is PlacedUnit => !!k);
      if (kids.length < 2) continue;
      checked++;
      const ds = kids.map((k) => Math.hypot(k.x - parent.x, k.y - parent.y));
      if ((Math.max(...ds) - Math.min(...ds)) / Math.max(...ds) > 0.05) varied++;
    }
    expect(checked).toBeGreaterThan(50);
    expect(varied / checked).toBeGreaterThan(0.5);
  });

  it("fans children away from the grandparent, not all round the parent", () => {
    const scene = layoutCompany(treeOf(big)).scene;
    const spans: number[] = [];
    for (const parent of scene.units) {
      if (!parent.parentId) continue;
      const kids = parent.childIds
        .map((id) => scene.unitById.get(id))
        .filter((k): k is PlacedUnit => !!k);
      if (kids.length < 2) continue;
      const grandparent = scene.unitById.get(parent.parentId);
      if (!grandparent) continue;
      // The company's own child is a holding node: it stands in for the
      // company and uses the whole circle, with the company tucked into a
      // gap. Its children are legitimately all round it.
      if (!grandparent.parentId) continue;
      const home = Math.atan2(grandparent.y - parent.y, grandparent.x - parent.x);
      for (const kid of kids) {
        const a = Math.atan2(kid.y - parent.y, kid.x - parent.x);
        let away = Math.abs(a - home);
        while (away > Math.PI) away = Math.abs(away - 2 * Math.PI);
        // No child sits behind its parent, in the grandparent's direction.
        expect(away).toBeGreaterThan(Math.PI / 2 - 0.35);
      }
      const angles = kids.map((k) => Math.atan2(k.y - parent.y, k.x - parent.x) - home);
      spans.push(Math.max(...angles) - Math.min(...angles));
    }
    spans.sort((a, b) => a - b);
    // And the fan stays a fan: half of them inside a right angle or so.
    expect(spans[spans.length >> 1]).toBeLessThan((110 * Math.PI) / 180);
  });
});

describe("Law 2 — a node lands exactly where the hand let go", () => {
  // A company drawn in local geography, where a unit may be placed at any
  // distance. On the ring map the radius is the reporting level, so a drop
  // off the ring is refused instead — covered in insertion.test.ts.
  const tree = treeOf(big);
  const scene = layoutCompany(tree).scene;
  const parent = scene.units.find((u) => u.childIds.length >= 3 && u.depth > 0)!;
  const moving = scene.unitById.get(parent.childIds[0])!;
  const carried = descendantIds(scene, moving.id);

  /** Read a committed plan back the way a fresh page load does. */
  const reload = (placements: Map<string, Placement>) =>
    applyPositionOffsets(scene, anglePlacementOffsets(scene, placements), new Map());

  it("plans the drop at the pointer, not on the parent's orbit", () => {
    // Deliberately well off the orbit: a third of the way back to the parent.
    const orbit = Math.hypot(moving.x - parent.x, moving.y - parent.y);
    const theta = Math.atan2(moving.y - parent.y, moving.x - parent.x) + 0.9;
    const pointer = {
      x: parent.x + Math.cos(theta) * orbit * 0.62,
      y: parent.y + Math.sin(theta) * orbit * 0.62,
    };
    const plan = planInsertion({ scene, base: scene, unitId: moving.id, pointer, carried });
    expect(plan.kind).toBe("orbit");
    if (plan.kind !== "orbit") return;
    expect(plan.position.x).toBeCloseTo(pointer.x, 9);
    expect(plan.position.y).toBeCloseTo(pointer.y, 9);
    expect(plan.distance).toBeCloseTo(orbit * 0.62, 6);
  });

  it("reloads to the same point it was dropped at", () => {
    const orbit = Math.hypot(moving.x - parent.x, moving.y - parent.y);
    let checked = 0;
    for (const share of [0.55, 0.8, 1.25]) {
      for (const turn of [0.6, 2.4, -1.1]) {
        const theta = Math.atan2(moving.y - parent.y, moving.x - parent.x) + turn;
        const pointer = {
          x: parent.x + Math.cos(theta) * orbit * share,
          y: parent.y + Math.sin(theta) * orbit * share,
        };
        const plan = planInsertion({ scene, base: scene, unitId: moving.id, pointer, carried });
        if (plan.kind !== "orbit") continue;
        checked++;
        const placements = new Map<string, Placement>([
          [plan.unitId, { angle: plan.angle, distance: plan.distance }],
          ...plan.displaced.map((d) => [d.unitId, { angle: d.angle, distance: d.distance }] as const),
        ]);
        const after = reload(placements);
        const landed = after.unitById.get(moving.id)!;
        // Preview, commit and reload are the same point.
        expect(Math.hypot(landed.x - plan.position.x, landed.y - plan.position.y)).toBeLessThan(1e-6);
        // …and so is every neighbour that made room.
        for (const d of plan.displaced) {
          const after1 = after.unitById.get(d.unitId)!;
          expect(Math.hypot(after1.x - d.position.x, after1.y - d.position.y)).toBeLessThan(1e-6);
        }
      }
    }
    expect(checked).toBeGreaterThan(4);
  });

  it("refuses rather than accepting a drop it would have to move", () => {
    // Straight on top of a unit from another branch entirely.
    const other = scene.units.find((u) =>
      !carried.has(u.id) && u.parentId !== parent.id && u.id !== parent.id && u.depth > 1)!;
    const plan = planInsertion({
      scene,
      base: scene,
      unitId: moving.id,
      pointer: { x: other.x, y: other.y },
      carried,
    });
    expect(plan).toEqual({ kind: "none", reason: "no-room" });
  });
});

describe("Law 3 — an authored placement is an obstacle, not a suggestion", () => {
  const tree = treeOf(big);
  const scene = layoutCompany(tree).scene;
  const parent = scene.units.find((u) => u.childIds.length >= 4 && u.depth > 0)!;
  const [firstId, secondId] = parent.childIds;
  const authored = scene.unitById.get(firstId)!;
  const moving = scene.unitById.get(secondId)!;

  it("leaves a placed unit exactly where its person put it", () => {
    const orbit = Math.hypot(authored.x - parent.x, authored.y - parent.y);
    const theta = Math.atan2(authored.y - parent.y, authored.x - parent.x);
    const placements = new Map<string, Placement>([[authored.id, { angle: theta, distance: orbit * 0.7 }]]);
    const arranged = applyPositionOffsets(scene, anglePlacementOffsets(scene, placements), new Map());
    const placed = arranged.unitById.get(authored.id)!;
    const want = { x: parent.x + Math.cos(theta) * orbit * 0.7, y: parent.y + Math.sin(theta) * orbit * 0.7 };
    expect(Math.hypot(placed.x - want.x, placed.y - want.y)).toBeLessThan(1e-6);

    // Now drag a sibling to where that unit is not: the authored one must not
    // be pulled back to the calculated orbit by anybody else's landing.
    const pointer = { x: parent.x + Math.cos(theta + 1.8) * orbit, y: parent.y + Math.sin(theta + 1.8) * orbit };
    const plan = planInsertion({
      scene: arranged,
      base: scene,
      unitId: moving.id,
      pointer,
      carried: descendantIds(arranged, moving.id),
    });
    if (plan.kind !== "orbit") return;
    const next = new Map(placements);
    next.set(plan.unitId, { angle: plan.angle, distance: plan.distance });
    for (const d of plan.displaced) next.set(d.unitId, { angle: d.angle, distance: d.distance });
    const after = applyPositionOffsets(scene, anglePlacementOffsets(scene, next), new Map());
    const stayed = after.unitById.get(authored.id)!;
    // If it moved at all, it moved because the plan asked it to make room —
    // and then it is at the exact place the plan showed, not somewhere else.
    const asked = plan.displaced.find((d) => d.unitId === authored.id);
    if (asked) expect(Math.hypot(stayed.x - asked.position.x, stayed.y - asked.position.y)).toBeLessThan(1e-6);
    else expect(Math.hypot(stayed.x - placed.x, stayed.y - placed.y)).toBeLessThan(1e-6);
  });
});

describe("blast radius — one drag cannot move a distant branch", () => {
  const tree = treeOf(big);
  const scene = layoutCompany(tree).scene;

  it("moves only the dragged branch and the siblings that made room", () => {
    const parent = scene.units.find((u) => u.childIds.length >= 3 && u.depth > 0)!;
    const moving = scene.unitById.get(parent.childIds[1])!;
    const carried = descendantIds(scene, moving.id);
    const orbit = Math.hypot(moving.x - parent.x, moving.y - parent.y);
    const theta = Math.atan2(moving.y - parent.y, moving.x - parent.x) + 0.45;
    const pointer = { x: parent.x + Math.cos(theta) * orbit, y: parent.y + Math.sin(theta) * orbit };
    const plan = planInsertion({ scene, base: scene, unitId: moving.id, pointer, carried });
    expect(plan.kind).toBe("orbit");
    if (plan.kind !== "orbit") return;

    const placements = new Map<string, Placement>([
      [plan.unitId, { angle: plan.angle, distance: plan.distance }],
      ...plan.displaced.map((d) => [d.unitId, { angle: d.angle, distance: d.distance }] as const),
    ]);
    const after = applyPositionOffsets(scene, anglePlacementOffsets(scene, placements), new Map());

    // Everything that is allowed to move: the branch, and each neighbour that
    // made room, with its own branch.
    const allowed = new Set<string>(carried);
    for (const d of plan.displaced) for (const id of descendantIds(scene, d.unitId)) allowed.add(id);

    for (const u of scene.units) {
      if (allowed.has(u.id)) continue;
      const now = after.unitById.get(u.id)!;
      expect(Math.hypot(now.x - u.x, now.y - u.y)).toBeLessThan(1e-9);
    }
    // And the displaced set is genuinely the local one, not half the company.
    expect(plan.displaced.length).toBeLessThan(parent.childIds.length);
  });
});

describe("a parent's interaction orbit", () => {
  it("is a circle on the node, the same gap out for every unit", () => {
    const scene = layoutCompany(treeOf(mid)).scene;
    const scale = 0.5;
    for (const unit of scene.units.slice(0, 40)) {
      const drawn = unit.r * 0.8;
      const orbit = interactionOrbit(unit, scale, drawn);
      expect(orbit.centre).toEqual({ x: unit.x, y: unit.y });
      // Measured from the drawn edge, in screen pixels, so it looks the same
      // round a big unit and a small one.
      expect((orbit.radius - drawn) * scale).toBeCloseTo(INTERACTION_ORBIT_MIN_PX, 6);
    }
  });

  it("ignores where the unit's children happen to sit", () => {
    const unit = { id: "u", x: 10, y: -4, r: 30, footprint: 120 };
    const near = interactionOrbit({ ...unit }, 1, 30);
    const far = interactionOrbit({ ...unit, footprint: 900 }, 1, 30);
    expect(near).toEqual(far);
  });
});

describe("the territory outline stays in one piece", () => {
  /** Marching squares traces solid ground one way round and the pockets of
   *  open ground inside it the other, so the sign of the area says which a
   *  ring is. A contiguous territory has exactly one positive ring, however
   *  many holes it has. */
  const outerRings = (env: { rings: { x: number; y: number }[][] }) =>
    env.rings.filter((ring) => {
      let twice = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        twice += a.x * b.y - b.x * a.y;
      }
      return twice > 0;
    });

  it("wraps the whole of a large company as one territory", () => {
    // Greg, 2026-09-24: "The company boundary shrink wrap breaks when the
    // connection line becomes too long." A corridor thinner than the
    // sampler's step was simply not found, so the company came apart.
    const scene = layoutCompany(treeOf(big)).scene;
    expect(outerRings(structuralEnvelope(scene)).length).toBe(1);
  });

  it("holds even when one branch is flung a long way out", () => {
    const scene = layoutCompany(treeOf(big)).scene;
    const far = scene.units.find((u) => u.parentId && u.childIds.length > 0)!;
    const b = scene.bounds!;
    // Drag a whole branch out to eight times the company's own width, the way
    // a person could, and the route out must still read as one place.
    const by = { x: (b.maxX - b.minX) * 8, y: (b.maxY - b.minY) * 3 };
    const moved = new Set(descendantIds(scene, far.id));
    const shifted = {
      ...scene,
      units: scene.units.map((u) => (moved.has(u.id) ? { ...u, x: u.x + by.x, y: u.y + by.y } : u)),
      links: scene.links.map((l) => ({
        ...l,
        from: moved.has(l.sourceId) ? { x: l.from.x + by.x, y: l.from.y + by.y } : l.from,
        to: moved.has(l.targetId) ? { x: l.to.x + by.x, y: l.to.y + by.y } : l.to,
      })),
    };
    expect(outerRings(structuralEnvelope(shifted)).length).toBe(1);
  });
});
