import { describe, it, expect } from "vitest";
import { computeMoneyFlowLayout } from "../moneyFlow";

const BOUNDS = { minX: -300, maxX: 2100, minY: -200, maxY: 1500 };

describe("computeMoneyFlowLayout", () => {
  it("centres the company circle on the origin — Exec's own position", () => {
    const { company } = computeMoneyFlowLayout(BOUNDS, 100_000);
    expect(company.x).toBe(0);
    expect(company.y).toBe(0);
    expect(company.hw).toBe(company.hh); // a square box standing in for a circle
  });

  it("sizes the company circle to reach every corner of the stream bounds", () => {
    const { company } = computeMoneyFlowLayout(BOUNDS, 100_000);
    const radius = company.hw;
    const corners = [
      { x: BOUNDS.minX, y: BOUNDS.minY },
      { x: BOUNDS.maxX, y: BOUNDS.minY },
      { x: BOUNDS.minX, y: BOUNDS.maxY },
      { x: BOUNDS.maxX, y: BOUNDS.maxY },
    ];
    for (const c of corners) {
      expect(Math.hypot(c.x, c.y)).toBeLessThanOrEqual(radius);
    }
  });

  it("places each external node at its own compass point around the circle", () => {
    const { externalNodes } = computeMoneyFlowLayout(BOUNDS, 100_000);
    const at = (id: string) => externalNodes.find((n) => n.id === id)!;
    expect(at("customers").y).toBeLessThan(0); // north
    expect(at("customers").x).toBeCloseTo(0);
    expect(at("shareholders").x).toBeGreaterThan(0); // east
    expect(at("shareholders").y).toBeCloseTo(0);
    expect(at("government").y).toBeGreaterThan(0); // south
    expect(at("government").x).toBeCloseTo(0);
    expect(at("suppliers").x).toBeLessThan(0); // west
    expect(at("suppliers").y).toBeCloseTo(0);
  });

  it("keeps income flows pointed at the company and outflows pointed away", () => {
    const { flows, company } = computeMoneyFlowLayout(BOUNDS, 100_000);
    const distToCompany = (p: { x: number; y: number }) =>
      Math.hypot(p.x - company.x, p.y - company.y);
    for (const f of flows) {
      const start = f.points[0];
      const end = f.points[f.points.length - 1];
      const arrivesAtCompany = distToCompany(end) < distToCompany(start);
      expect(arrivesAtCompany).toBe(f.kind === "income");
    }
  });

  it("routes every flow as a straight, already axis-aligned line", () => {
    const { flows } = computeMoneyFlowLayout(BOUNDS, 100_000);
    for (const f of flows) {
      expect(f.points).toHaveLength(2);
      const [a, b] = f.points;
      // Without grid-snapping, a compass angle's cos/sin isn't always
      // *exactly* zero (floating-point trig) — close enough to read as
      // perfectly axis-aligned on screen is the real bar here.
      const xAligned = Math.abs(a.x - b.x) < 1e-6;
      const yAligned = Math.abs(a.y - b.y) < 1e-6;
      expect(xAligned || yAligned).toBe(true);
    }
  });

  it("scales dollar figures with total monthly cost, and omits them at zero", () => {
    const withCost = computeMoneyFlowLayout(BOUNDS, 200_000);
    const zeroCost = computeMoneyFlowLayout(BOUNDS, 0);
    const revenueFlow = withCost.flows.find((f) => f.id === "customers-in")!;
    expect(revenueFlow.amountLabel).toMatch(/\$\d+(\.\d+)?[km]?\/mo/i);
    const zeroRevenueFlow = zeroCost.flows.find((f) => f.id === "customers-in")!;
    expect(zeroRevenueFlow.amountLabel).toBeNull();
  });

  it("is deterministic for the same input", () => {
    const a = computeMoneyFlowLayout(BOUNDS, 150_000);
    const b = computeMoneyFlowLayout(BOUNDS, 150_000);
    expect(a).toEqual(b);
  });
});
