import { describe, expect, it } from "vitest";
import { focusOrbital } from "../focus";
import { pathToUnit, treeForFocus } from "../model";
import { layoutOrbital } from "../layout";
import { buildOrbitalTree } from "../model";

const tree = buildOrbitalTree(
  {
    units: [
      { id: "root", name: "Company", parentId: null },
      { id: "a", name: "Division", parentId: "root" },
      { id: "b", name: "Sector", parentId: "a" },
      { id: "c", name: "Team", parentId: "b" },
      { id: "other", name: "Other", parentId: "root" },
    ],
    people: [{ id: "p", name: "Pat", title: "Builder" }],
    assignments: [{ personId: "p", orgUnitId: "c", allocationPct: 100 }],
  },
  { mergePassThroughRoot: false },
);

describe("orbital focus projection", () => {
  it("rebases a branch without changing its real tree", () => {
    const local = treeForFocus(tree, "b");
    expect(local?.rootId).toBe("b");
    expect([...local!.units.keys()]).toEqual(["b", "c"]);
    expect(local?.units.get("b")?.depth).toBe(0);
    expect(local?.units.get("c")?.depth).toBe(1);
    expect(tree.units.get("b")?.parentId).toBe("a");
  });

  it("keeps a complete clickable breadcrumb", () => {
    expect(pathToUnit(tree, "c").map((unit) => unit.id)).toEqual(["root", "a", "b", "c"]);
  });

  it("keeps context in the motion scene and local structure in the interaction scene", () => {
    const master = layoutOrbital(tree);
    const focused = focusOrbital(tree, master, "b");
    expect(focused?.scene.units).toHaveLength(master.units.length);
    expect(focused?.scene.unitById.get("b")?.x).toBe(0);
    expect(focused?.scene.unitById.get("b")?.y).toBe(0);
    expect(focused?.interactionScene.units.map((unit) => unit.id).sort()).toEqual(["b", "c"]);
    expect(focused?.scene.links.some((link) => link.sourceId === "a" && link.targetId === "b")).toBe(true);
  });
});
