import { describe, expect, it } from "vitest";
import { layoutOrbitalForest, visibleRootIds } from "@/lib/map/layout/forest";
import { buildOrbitalTree } from "@/lib/map/layout/model";
import { snapUnitOnRing } from "@/lib/map/layout/snap";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";

function forest(count: number) {
  return buildOrbitalTree({
    units: Array.from({ length: count }, (_, index) => ({
      id: `root-${index}`,
      name: `Family ${index}`,
      parentId: null,
    })),
    people: [],
    assignments: [],
  }, { mergePassThroughRoot: false });
}

describe("independent orbital families", () => {
  it("does not render the indexing-only synthetic root or invent a link", () => {
    const tree = forest(2);
    const scene = layoutOrbitalForest(tree);
    expect(visibleRootIds(tree)).toEqual(["root-0", "root-1"]);
    expect(scene.unitById.has("orbital-root")).toBe(false);
    expect(scene.links).toHaveLength(0);
    expect(scene.families).toHaveLength(2);
    expect(scene.families![0].centre.y).toBe(scene.families![1].centre.y);
    const distance = Math.abs(scene.families![0].centre.x - scene.families![1].centre.x);
    expect(distance).toBeGreaterThan(scene.families![0].boundary + scene.families![1].boundary);
  });

  it("packs three as a triangle, four as a square, and five as a centred grid", () => {
    const three = layoutOrbitalForest(forest(3)).families!;
    expect(three[0].centre.y).toBe(three[1].centre.y);
    expect(three[2].centre.y).toBeGreaterThan(three[0].centre.y);
    expect(three[2].centre.x).toBeCloseTo(0);

    const four = layoutOrbitalForest(forest(4)).families!;
    expect(new Set(four.map((family) => family.centre.y)).size).toBe(2);
    expect(new Set(four.map((family) => family.centre.x)).size).toBe(2);

    const five = layoutOrbitalForest(forest(5)).families!;
    expect(five).toHaveLength(5);
    expect(five.every((family) => Number.isFinite(family.centre.x + family.centre.y))).toBe(true);
  });

  it("snaps inside the dragged node's own family rather than the page origin", () => {
    const tree = buildOrbitalTree({
      units: [
        { id: "a", name: "A", parentId: null },
        { id: "a-child", name: "A child", parentId: "a" },
        { id: "b", name: "B", parentId: null },
        { id: "b-child", name: "B child", parentId: "b" },
      ],
      people: [], assignments: [],
    }, { mergePassThroughRoot: false });
    const scene = layoutOrbitalForest(tree);
    expect(scene.bands).toHaveLength(0);
    const family = scene.families!.find((candidate) => candidate.rootId === "b")!;
    const radius = family.bands.find((band) => band.depth === 1)!.radius;
    const result = snapUnitOnRing(scene, "b-child", {
      x: family.centre.x + radius, y: family.centre.y,
    });
    expect(result?.parentId).toBe("b");
    expect(Math.hypot(result!.position.x - family.centre.x, result!.position.y - family.centre.y))
      .toBeCloseTo(radius);
  });

  it("lays out a 2,500-person, eleven-rung shape without a synthetic visible node", () => {
    const org = buildDeepOrg("scale-check", { people: 2562, maxDepth: 11, seed: 20260914 });
    const tree = buildOrbitalTree({ units: org.units, people: org.people, assignments: org.assignments },
      { mergePassThroughRoot: false });
    const scene = layoutOrbitalForest(tree);
    // The generator treats this as a target and adds leads, so the actual
    // headcount can be higher than requested.
    expect(org.people.length).toBeGreaterThan(2500);
    expect(scene.unitById.has("orbital-root")).toBe(false);
    expect(scene.units.length).toBeGreaterThan(100);
    expect(scene.seats.length).toBeGreaterThan(2500);
    expect(scene.units.every((unit) => Number.isFinite(unit.x) && Number.isFinite(unit.y))).toBe(true);
  });
});
