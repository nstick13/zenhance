import { describe, it, expect } from "vitest";
import { computeAllocationSpokes, computeHubGeometry, hubRecipient, TIER_STROKE, type Box } from "../allocationFlow";
import { LINE_GAP } from "../lineRouting";

describe("computeAllocationSpokes", () => {
  const hub: Box = { x: 0, y: -200, hw: 150, hh: 30 };
  const children = [
    { id: "a", x: -400, y: 200, hw: 80, hh: 80, cost: 40_000 },
    { id: "b", x: 0, y: 200, hw: 80, hh: 80, cost: 60_000 },
    { id: "c", x: 400, y: 200, hw: 80, hh: 80, cost: 20_000 },
  ];

  it("touches a circular child's exact centre (hw === hh) — ends behind the circle", () => {
    const lines = computeAllocationSpokes(hub, children);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const child = children.find((c) => `alloc-${c.id}` === line.id)!;
      const end = line.points[line.points.length - 1];
      expect(end).toEqual({ x: child.x, y: child.y });
    }
  });

  it("touches a non-circular child's (a card's) nearest edge, not its centre", () => {
    const cardChildren = [{ id: "card", x: 500, y: 500, hw: 100, hh: 30, cost: 10_000 }];
    const [line] = computeAllocationSpokes(hub, cardChildren);
    const end = line.points[line.points.length - 1];
    expect(end).not.toEqual({ x: 500, y: 500 });
    const onVerticalEdge = Math.abs(Math.abs(end.x - 500) - 100) < 1e-6;
    const onHorizontalEdge = Math.abs(Math.abs(end.y - 500) - 30) < 1e-6;
    expect(onVerticalEdge || onHorizontalEdge).toBe(true);
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

  it("fans tier 1 wider than tier 2 — a thicker tier can't be spaced tighter than it is wide", () => {
    // This is the regression: two same-tier siblings must clear LINE_GAP
    // between their edges, or a thick tier reads as one fused line (which
    // is exactly what happened when fan spacing ignored tier width).
    // Hub is far below a tight horizontal spread of children, so both
    // siblings' fan offsets point in nearly the same (near-horizontal)
    // perpendicular direction — the straight-line gap between their
    // fanned start points is then ~equal to the fan spacing itself.
    const farHub: Box = { x: 0, y: -50_000, hw: 5, hh: 5 };
    const twoKids = [
      { id: "a", x: -20, y: 0, hw: 40, hh: 40, cost: 1 },
      { id: "b", x: 20, y: 0, hw: 40, hh: 40, cost: 1 },
    ];
    const spacing = (tier: 1 | 2) => {
      const [l0, l1] = computeAllocationSpokes(farHub, twoKids, tier);
      return Math.hypot(l0.points[0].x - l1.points[0].x, l0.points[0].y - l1.points[0].y);
    };
    expect(spacing(1)).toBeCloseTo(TIER_STROKE[1] + LINE_GAP, 1);
    expect(spacing(2)).toBeCloseTo(TIER_STROKE[2] + LINE_GAP, 1);
    expect(spacing(1)).toBeGreaterThan(spacing(2));
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

  it("grows the card by one line when it carries a produced-value line", () => {
    const without = computeHubGeometry(hull, true, false, false);
    const withProduced = computeHubGeometry(hull, true, false, true);
    expect(withProduced.card.hh).toBeGreaterThan(without.card.hh);
    expect(withProduced.card.x).toBe(without.card.x); // same anchor, only height changes
  });

  it("defaults to no produced-value line when the argument is omitted", () => {
    expect(computeHubGeometry(hull, true, false)).toEqual(computeHubGeometry(hull, true, false, false));
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
