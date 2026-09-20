import { describe, expect, it } from "vitest";

import { buildMockOrg } from "./mockOrg";
import { focusProjection, globalProjection, type ProjectionOptions } from "./projection";

const base: ProjectionOptions = {
  focusId: null,
  selectedId: null,
  markBudget: 55,
  bandStep: 150,
  snapping: true,
};

describe("fixed-band orbital focus study", () => {
  it("keeps every represented global node on its fixed CEO+n band", () => {
    const org = buildMockOrg({ people: 2400, maxDepth: 11 });
    const view = globalProjection(org, base);

    expect(view.placed.length).toBeLessThanOrEqual(base.markBudget);
    expect(Math.max(...view.placed.map((placed) => placed.node.depth))).toBeLessThanOrEqual(3);
    for (const placed of view.placed) {
      expect(Math.hypot(placed.x, placed.y)).toBeCloseTo(placed.node.depth * base.bandStep, 2);
    }
  });

  it("does not let people or work-like totals change structural positions", () => {
    const org = buildMockOrg({ people: 2400, maxDepth: 11 });
    const before = globalProjection(org, base);
    org.nodes.forEach((node) => {
      node.headcount += 10_000;
      node.totalPeople += 10_000;
    });
    const after = globalProjection(org, base);

    expect(after.placed.map(({ node, x, y }) => [node.id, x, y])).toEqual(
      before.placed.map(({ node, x, y }) => [node.id, x, y]),
    );
  });

  it("uses real boundary nodes as counted collapsed branches", () => {
    const org = buildMockOrg({ people: 2400, maxDepth: 11 });
    const view = globalProjection(org, { ...base, markBudget: 24 });
    const collapsed = view.placed.filter((placed) => placed.collapsed);

    expect(collapsed.length).toBeGreaterThan(0);
    for (const placed of collapsed) {
      expect(org.byId.get(placed.node.id)).toBe(placed.node);
      expect(placed.node.childIds.length).toBeGreaterThan(0);
      expect(placed.node.totalPeople).toBeGreaterThanOrEqual(placed.node.headcount);
    }
  });

  it("re-roots a deep local view with clear ±1 and contextual ±2", () => {
    const org = buildMockOrg({ people: 2400, maxDepth: 11 });
    const focus = org.nodes.find((node) => node.depth >= 6 && node.childIds.length > 0)!;
    const view = focusProjection(org, { ...base, focusId: focus.id, selectedId: focus.id });
    const placedFocus = view.byId.get(focus.id)!;
    const parent = view.byId.get(focus.parentId!)!;
    const grandparentId = org.byId.get(focus.parentId!)?.parentId;

    expect(view.mode).toBe("local");
    expect(view.placed.length).toBeLessThanOrEqual(base.markBudget);
    expect([placedFocus.x, placedFocus.y, placedFocus.role]).toEqual([0, 0, "centre"]);
    expect(parent.role).toBe("near");
    expect(grandparentId && view.byId.get(grandparentId)?.role).toBe("context");
    expect(focus.childIds.some((id) => view.byId.get(id)?.role === "near")).toBe(true);
    expect(view.breadcrumb.at(-1)).toBe(focus);
  });

  it("discloses focus without pulling positions when snapping is off", () => {
    const org = buildMockOrg({ people: 2400, maxDepth: 11 });
    const focus = org.nodes.find((node) => node.depth >= 6 && node.childIds.length > 0)!;
    const view = focusProjection(org, {
      ...base,
      focusId: focus.id,
      selectedId: focus.id,
      snapping: false,
    });
    const placed = view.byId.get(focus.id)!;

    expect(view.mode).toBe("unsnapped");
    expect(Math.hypot(placed.x, placed.y)).toBeCloseTo(focus.depth * base.bandStep, 2);
    expect(Math.hypot(placed.x, placed.y)).toBeGreaterThan(0);
  });
});
