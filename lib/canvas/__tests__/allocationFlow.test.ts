import { describe, it, expect } from "vitest";
import { computeAllocationSpokes, computeHubGeometry, hubRecipient, type Box } from "../allocationFlow";

describe("computeAllocationSpokes", () => {
  const hub: Box = { x: 0, y: -200, hw: 150, hh: 30 };
  const children = [
    { id: "a", x: -400, y: 200, hw: 80, hh: 80, cost: 40_000 },
    { id: "b", x: 0, y: 200, hw: 80, hh: 80, cost: 60_000 },
    { id: "c", x: 400, y: 200, hw: 80, hh: 80, cost: 20_000 },
  ];

  it("touches each box's edge, not its centre", () => {
    const lines = computeAllocationSpokes(hub, children);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const child = children.find((c) => `alloc-${c.id}` === line.id)!;
      const end = line.points[line.points.length - 1];
      const onVerticalEdge = Math.abs(Math.abs(end.x - child.x) - child.hw) < 1e-6;
      const onHorizontalEdge = Math.abs(Math.abs(end.y - child.y) - child.hh) < 1e-6;
      expect(onVerticalEdge || onHorizontalEdge).toBe(true);
    }
  });

  it("routes each spoke octilinearly — every segment is horizontal, vertical, or 45°", () => {
    const lines = computeAllocationSpokes(hub, children);
    for (const line of lines) {
      for (let i = 1; i < line.points.length; i++) {
        const dx = line.points[i].x - line.points[i - 1].x;
        const dy = line.points[i].y - line.points[i - 1].y;
        const axisAligned = dx === 0 || dy === 0;
        const diagonal = Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.5;
        expect(axisAligned || diagonal).toBe(true);
      }
    }
  });

  it("fans siblings apart near the hub instead of leaving from one point", () => {
    const lines = computeAllocationSpokes(hub, children);
    const starts = lines.map((l) => l.points[0]);
    const unique = new Set(starts.map((p) => `${p.x},${p.y}`));
    expect(unique.size).toBe(starts.length);
  });

  it("labels each spoke with the child's own cost", () => {
    const lines = computeAllocationSpokes(hub, children);
    const middle = lines.find((l) => l.id === "alloc-b")!;
    expect(middle.amountLabel).toBe("$60k/mo");
  });

  it("is deterministic", () => {
    expect(computeAllocationSpokes(hub, children)).toEqual(computeAllocationSpokes(hub, children));
  });
});

describe("computeHubGeometry", () => {
  const hull: Box = { x: 500, y: 500, hw: 400, hh: 300 };

  it("locks the card to the hull's top-right corner", () => {
    const { card } = computeHubGeometry(hull, true, false);
    expect(card.x + card.hw).toBeLessThanOrEqual(hull.x + hull.hw);
    expect(card.y - card.hh).toBeGreaterThanOrEqual(hull.y - hull.hh);
    // Right-anchored: close to the hull's right edge, not centred or left.
    expect(hull.x + hull.hw - (card.x + card.hw)).toBeLessThan(30);
  });

  it("gives a shorter card when there's no owner line", () => {
    const withOwner = computeHubGeometry(hull, true, false);
    const withoutOwner = computeHubGeometry(hull, false, false);
    expect(withoutOwner.card.hh).toBeLessThan(withOwner.card.hh);
    // Same anchor either way — only the height (and so the vertical centre) changes.
    expect(withoutOwner.card.x).toBe(withOwner.card.x);
  });

  it("has no circle while collapsed, and one just below the card once expanded", () => {
    const collapsed = computeHubGeometry(hull, true, false);
    expect(collapsed.circle).toBeNull();

    const expanded = computeHubGeometry(hull, true, true);
    expect(expanded.circle).not.toBeNull();
    expect(expanded.card).toEqual(collapsed.card); // same card either way
    expect(expanded.circle!.y).toBeGreaterThan(expanded.card.y + expanded.card.hh);
    expect(expanded.circle!.x).toBe(expanded.card.x);
  });
});

describe("hubRecipient", () => {
  const hull: Box = { x: 0, y: 0, hw: 400, hh: 300 };

  it("is the card while collapsed", () => {
    const geo = computeHubGeometry(hull, true, false);
    expect(hubRecipient(geo)).toEqual(geo.card);
  });

  it("is the circle once expanded", () => {
    const geo = computeHubGeometry(hull, true, true);
    const r = hubRecipient(geo);
    expect(r.x).toBe(geo.circle!.x);
    expect(r.y).toBe(geo.circle!.y);
  });
});
