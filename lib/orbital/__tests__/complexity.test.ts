import { describe, expect, it } from "vitest";
import {
  LOCAL_MUST_WIN_BY,
  MAX_ZOOM_TO_READ,
  REFERENCE_VIEWPORT,
  fitScaleFor,
  layoutCompany,
  sceneBounds,
  visualComplexity,
  zoomToRead,
} from "../complexity";
import { buildOrbitalTree, type OrgInput } from "../model";
import { demoInput } from "./orbitalFixture";
import { buildDeepOrg } from "./fixtures/deepOrg";

/** Sparrow Jam's shape: a plant, an oversight group and two lines, ten people. */
function sparrowShape(): OrgInput {
  const units = [
    { id: "plant", name: "Plant", parentId: null },
    { id: "oversight", name: "Oversight", parentId: "plant", leadPersonId: "p0" },
    { id: "preserves", name: "Preserves", parentId: "plant", leadPersonId: "p2" },
    { id: "packing", name: "Packing", parentId: "plant", leadPersonId: "p6" },
  ];
  const people = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
  const at = ["oversight", "oversight", "preserves", "preserves", "preserves", "preserves", "packing", "packing", "packing", "preserves"];
  const assignments = people.map((p, i) => ({ personId: p.id, orgUnitId: at[i] }));
  return { units, people, assignments };
}

const deep = (people: number, maxDepth: number, seed: number) => {
  const org = buildDeepOrg("complexity", { people, maxDepth, seed });
  return { units: org.units, people: org.people, assignments: org.assignments } as OrgInput;
};

const choose = (input: OrgInput) =>
  layoutCompany(buildOrbitalTree(input, { mergePassThroughRoot: false, workCountFor: () => 6 }));

describe("choosing how to draw a company", () => {
  it("increases radial looseness monotonically with visual complexity", () => {
    const measured = [1, 2, 4, 8, 16, 32, 64, 128].map(visualComplexity);
    expect(measured[0]).toBe(0);
    expect(measured.at(-1)).toBe(1);
    for (let i = 1; i < measured.length; i++) expect(measured[i]).toBeGreaterThanOrEqual(measured[i - 1]);

    const representative = [
      choose(sparrowShape()),
      choose(demoInput()),
      choose(deep(400, 6, 7)),
      choose(deep(1000, 8, 17)),
      choose(deep(2562, 11, 20260914)),
    ].sort((a, b) => a.choice.ringZoomToRead - b.choice.ringZoomToRead);
    for (let i = 1; i < representative.length; i++) {
      expect(representative[i].choice.radialLooseness)
        .toBeGreaterThanOrEqual(representative[i - 1].choice.radialLooseness);
    }
  });

  it("keeps small companies on their rings", () => {
    const sparrow = choose(sparrowShape());
    const tailoring = choose(demoInput());
    expect(sparrow.choice.geography).toBe("orbital");
    expect(tailoring.choice.geography).toBe("orbital");
    expect(sparrow.scene.geography).toBeUndefined();
    expect(sparrow.choice.ringZoomToRead).toBeLessThanOrEqual(MAX_ZOOM_TO_READ);
    // The ring test passes, so the local drawing is never even computed.
    expect(sparrow.choice.localZoomToRead).toBeNull();
  });

  it("moves a twelve-level, 2,500-person company to local branch geography", () => {
    const big = choose(deep(2562, 11, 20260914));
    expect(big.choice.geography).toBe("local");
    expect(big.scene.geography).toBe("local");
    expect(big.choice.ringZoomToRead).toBeGreaterThan(MAX_ZOOM_TO_READ);
    expect(big.choice.ringZoomToRead / big.choice.localZoomToRead!).toBeGreaterThanOrEqual(LOCAL_MUST_WIN_BY);
  });

  it("stays on rings when local geography would not genuinely fit better", () => {
    // Deep enough to fail the ring test, but local is no real improvement.
    const mid = choose(deep(400, 6, 7));
    expect(mid.choice.ringZoomToRead).toBeGreaterThan(MAX_ZOOM_TO_READ);
    expect(mid.choice.geography).toBe("orbital");
  });

  it("is deterministic — the same company always gets the same drawing", () => {
    const input = deep(2562, 11, 20260914);
    const a = choose(input);
    const b = choose(input);
    expect(a.choice).toEqual(b.choice);
    expect(a.scene.units.map((u) => [u.x, u.y])).toEqual(b.scene.units.map((u) => [u.x, u.y]));
  });

  it("measures against a fixed reference screen, never the live window", () => {
    const { scene } = choose(demoInput());
    const expected = 0.7 / fitScaleFor(sceneBounds(scene), REFERENCE_VIEWPORT);
    expect(zoomToRead(scene)).toBeCloseTo(expected, 9);
  });

  it("fits bounds by their tighter side", () => {
    const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    expect(fitScaleFor(bounds, { width: 400, height: 400 })).toBeCloseTo(400 / (200 * 1.06));
    expect(fitScaleFor(bounds, { width: 1000, height: 50 })).toBeCloseTo(50 / (100 * 1.06));
  });
});
