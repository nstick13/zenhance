/**
 * **Merging one unit into another** (Greg, 2026-10-19).
 *
 * Both maps have carried a disabled *Merge entire branch* button for months,
 * for one stated reason: what happened to both units' people, and who led the
 * result, was undecided. Greg settled both — the people are children, so they
 * become the survivor's children, and two leads is allowed — so the override
 * could finally be written. These are its rules.
 */
import { describe, expect, it } from "vitest";
import { applyOverrides, buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";

const treeOf = (): OrbitalTree =>
  buildOrbitalTree(
    {
      units: [
        { id: "co", name: "Company", parentId: null, leadPersonId: null },
        { id: "left", name: "Left division", parentId: "co", leadPersonId: null },
        { id: "right", name: "Right division", parentId: "co", leadPersonId: null },
        { id: "a", name: "Team A", parentId: "left", leadPersonId: null },
        { id: "b", name: "Team B", parentId: "right", leadPersonId: null },
        { id: "a1", name: "Ana", parentId: "a", leadPersonId: null },
        { id: "a2", name: "Bo", parentId: "a", leadPersonId: null },
        { id: "b1", name: "Cal", parentId: "b", leadPersonId: null },
      ],
      people: [],
      assignments: [],
    },
    { mergePassThroughRoot: false, workCountFor: () => 0 },
  );

describe("everything either team held ends up on the survivor", () => {
  it("moves the absorbed team's people across and removes the team", () => {
    const after = applyOverrides(treeOf(), { unitMerge: new Map([["a", "b"]]) });
    expect(after.units.has("a")).toBe(false);
    expect(after.units.get("b")!.childIds.sort()).toEqual(["a1", "a2", "b1"]);
    expect(after.units.get("a1")!.parentId).toBe("b");
  });

  it("changes nothing above either team", () => {
    const after = applyOverrides(treeOf(), { unitMerge: new Map([["a", "b"]]) });
    // The survivor keeps its own parent; the absorbed one's parent just loses
    // a child. Greg, via the grow study: *"nothing above either team changes."*
    expect(after.units.get("b")!.parentId).toBe("right");
    expect(after.units.get("left")!.childIds).toEqual([]);
    expect(after.units.get("co")!.childIds.sort()).toEqual(["left", "right"]);
  });

  it("recomputes the rungs the moved people now sit on", () => {
    const before = treeOf();
    const after = applyOverrides(before, { unitMerge: new Map([["a", "b"]]) });
    expect(before.units.get("a1")!.depth).toBe(3);
    expect(after.units.get("a1")!.depth).toBe(3); // left→a→a1 becomes right→b→a1
    expect(after.units.get("b")!.totalSeats).toBe(before.units.get("b")!.totalSeats);
  });
});

describe("a merge that cannot mean anything is skipped, not thrown", () => {
  it("refuses to merge a unit into its own descendant", () => {
    const after = applyOverrides(treeOf(), { unitMerge: new Map([["left", "a"]]) });
    expect(after.units.has("left")).toBe(true);
    expect(after.units.get("a")!.parentId).toBe("left");
  });

  it("refuses to merge the company away", () => {
    const after = applyOverrides(treeOf(), { unitMerge: new Map([["co", "left"]]) });
    expect(after.rootId).toBe("co");
    expect(after.units.has("co")).toBe(true);
  });

  it("ignores a merge into a unit that is not there", () => {
    const after = applyOverrides(treeOf(), { unitMerge: new Map([["a", "ghost"]]) });
    expect(after.units.has("a")).toBe(true);
  });

  it("follows the chain when the survivor has itself been merged away", () => {
    // a → b, and b → right. Both must end up on `right`, with nothing left
    // pointing at a unit that no longer exists.
    const after = applyOverrides(treeOf(), { unitMerge: new Map([["a", "b"], ["b", "right"]]) });
    expect(after.units.has("a")).toBe(false);
    expect(after.units.has("b")).toBe(false);
    expect(after.units.get("right")!.childIds.sort()).toEqual(["a1", "a2", "b1"]);
    for (const unit of after.units.values()) {
      for (const childId of unit.childIds) expect(after.units.has(childId)).toBe(true);
      if (unit.parentId) expect(after.units.has(unit.parentId)).toBe(true);
    }
  });
});

describe("a merge sits beside the other overrides", () => {
  it("runs before them, so a reparent talks about the tree that is left", () => {
    const after = applyOverrides(treeOf(), {
      unitMerge: new Map([["a", "b"]]),
      unitParent: new Map([["a1", "left"]]),
    });
    expect(after.units.get("a1")!.parentId).toBe("left");
    expect(after.units.get("b")!.childIds.sort()).toEqual(["a2", "b1"]);
  });

  it("is a no-op on a tree nobody has merged", () => {
    const tree = treeOf();
    expect(applyOverrides(tree, { unitMerge: new Map() })).toBe(tree);
  });
});
