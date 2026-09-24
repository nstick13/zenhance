import { describe, expect, it } from "vitest";
import {
  MAX_MARK_BUDGET,
  MIN_MARK_BUDGET,
  markBudget,
  revealDelay,
  stepPresence,
  visibleUnitIds,
  type ViewRect,
  type VisibilityUnit,
} from "@/lib/map/runtime/visibility";
import { buildOrbitalTree } from "@/lib/map/layout/model";
import { layoutOrbitalForest } from "@/lib/map/layout/forest";
import { sizeIndex } from "@/lib/map/layout/size";
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";

const everywhere: ViewRect = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };

/** A company with three divisions of very different size, each with teams
 *  spread in a line to the east, west and south. */
function company(): VisibilityUnit[] {
  const out: VisibilityUnit[] = [{ id: "co", parentId: null, x: 0, y: 0, weight: 1 }];
  const divisions = [
    { id: "big", weight: 0.9, dx: 1, dy: 0, teams: 12 },
    { id: "mid", weight: 0.6, dx: -1, dy: 0, teams: 6 },
    { id: "small", weight: 0.3, dx: 0, dy: 1, teams: 3 },
  ];
  for (const d of divisions) {
    out.push({ id: d.id, parentId: "co", x: d.dx * 100, y: d.dy * 100, weight: d.weight });
    for (let t = 0; t < d.teams; t++) {
      out.push({
        id: `${d.id}-t${t}`,
        parentId: d.id,
        x: d.dx * (200 + t * 40),
        y: d.dy * (200 + t * 40),
        weight: 0.1 + t * 0.001,
      });
    }
  }
  return out;
}

describe("progressive visibility — spending the screen", () => {
  it("shows everything when the budget is not binding — a small company loses nothing", () => {
    const units = company();
    const shown = visibleUnitIds({ units, view: everywhere, budget: 999, scale: 1 });
    expect(shown.size).toBe(units.length);
  });

  it("never spends more than the budget on what is on screen", () => {
    const units = company();
    for (const budget of [1, 4, 9, 15]) {
      const shown = visibleUnitIds({ units, view: everywhere, budget, scale: 1 });
      expect(shown.size).toBeLessThanOrEqual(Math.max(budget, 1));
    }
  });

  it("always shows the company, however small the budget", () => {
    const shown = visibleUnitIds({ units: company(), view: everywhere, budget: 0, scale: 1 });
    expect(shown.has("co")).toBe(true);
  });

  it("never reveals a unit before the route that leads to it", () => {
    const units = company();
    const byId = new Map(units.map((u) => [u.id, u]));
    for (const budget of [2, 3, 5, 8, 13]) {
      const shown = visibleUnitIds({ units, view: everywhere, budget, scale: 1 });
      for (const id of shown) {
        const parent = byId.get(id)!.parentId;
        if (parent) expect(shown.has(parent)).toBe(true);
      }
    }
  });

  it("spends first on the branches that carry the most people", () => {
    const shown = visibleUnitIds({ units: company(), view: everywhere, budget: 4, scale: 1 });
    expect([...shown].sort()).toEqual(["big", "co", "mid", "small"]);
  });

  it("spends near the local field before bigger units elsewhere", () => {
    const units = company();
    // The field sits over the small division's teams, far to the south,
    // between its second and third team.
    const field = { x: 0, y: 260, strength: 1, radiusPx: 120 };
    const shown = visibleUnitIds({ units, view: everywhere, budget: 6, scale: 1, field });
    expect(shown.has("small-t1")).toBe(true);
    expect(shown.has("small-t2")).toBe(true);
    expect(shown.has("big-t0")).toBe(false);
    expect(shown.has("mid-t0")).toBe(false);
  });

  it("forces a selected unit and its route home, whatever the budget", () => {
    const units = company();
    const shown = visibleUnitIds({
      units, view: everywhere, budget: 1, scale: 1, forced: new Set(["small-t2"]),
    });
    expect(shown.has("small-t2")).toBe(true);
    expect(shown.has("small")).toBe(true);
    expect(shown.has("co")).toBe(true);
  });

  it("lets off-screen units through free, so a visible team is not hidden by an unseen parent", () => {
    const units = company();
    // Only the far east is on screen: the big division itself (x=100) is not.
    const view: ViewRect = { minX: 500, minY: -50, maxX: 1000, maxY: 50 };
    const shown = visibleUnitIds({ units, view, budget: 3, scale: 1 });
    expect(shown.has("big")).toBe(true);
    const visibleTeams = units.filter((u) => u.parentId === "big" && u.x >= 500 && u.x <= 1000);
    const shownThere = visibleTeams.filter((u) => shown.has(u.id));
    expect(shownThere.length).toBe(3);
  });

  it("spends on a focused branch before its surrounding context", () => {
    const units = company();
    const branch = new Set(["small", "small-t0", "small-t1", "small-t2"]);
    const shown = visibleUnitIds({ units, view: everywhere, budget: 7, scale: 1, branch });
    for (const id of branch) expect(shown.has(id)).toBe(true);
  });

  it("is deterministic", () => {
    const units = company();
    const a = visibleUnitIds({ units, view: everywhere, budget: 7, scale: 1 });
    const b = visibleUnitIds({ units: [...units], view: everywhere, budget: 7, scale: 1 });
    expect([...a]).toEqual([...b]);
  });

  it("thins a 2,500-person company to a legible handful of marks at overview", () => {
    const org = buildDeepOrg("visibility", { people: 2562, maxDepth: 11, seed: 20260914 });
    const tree = buildOrbitalTree({ units: org.units, people: org.people, assignments: org.assignments },
      { mergePassThroughRoot: false });
    const scene = layoutOrbitalForest(tree);
    const company = [...tree.units.values()].find((u) => u.parentId === null || u.parentId === "orbital-root")!;
    const units = scene.units.map((u) => ({
      id: u.id, parentId: u.parentId, x: u.x, y: u.y,
      weight: sizeIndex(u.totalSeats, company.totalSeats),
    }));
    const budget = markBudget({ width: 1024, height: 768 });
    const shown = visibleUnitIds({ units, view: everywhere, budget, scale: 0.01 });
    expect(scene.units.length).toBeGreaterThan(400);
    expect(shown.size).toBeLessThanOrEqual(budget);
    expect(shown.size).toBeGreaterThan(budget * 0.9);
  });
});

describe("budget and fades", () => {
  it("sizes the budget to the screen, within bounds", () => {
    expect(markBudget({ width: 1024, height: 768 })).toBe(120);
    expect(markBudget({ width: 390, height: 760 })).toBe(45);
    expect(markBudget({ width: 100, height: 100 })).toBe(MIN_MARK_BUDGET);
    expect(markBudget({ width: 3840, height: 2160 })).toBe(MAX_MARK_BUDGET);
  });

  it("fades presence continuously toward its target and never overshoots", () => {
    let p = 0;
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      p = stepPresence(p, 1, 1 / 60);
      seen.push(p);
    }
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(0.1);
    expect(Math.max(...seen)).toBe(1);
    expect(stepPresence(1, 0, 10)).toBe(0);
  });

  it("ripples new marks outward from the gesture, and skips the ripple under reduced motion", () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(300)).toBeGreaterThan(revealDelay(100));
    expect(revealDelay(10000)).toBeLessThanOrEqual(0.28);
    expect(revealDelay(300, true)).toBe(0);
  });
});
