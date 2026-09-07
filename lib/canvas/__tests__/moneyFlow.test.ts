import { describe, it, expect } from "vitest";
import { computeMoneyFlowLayout } from "../moneyFlow";
import { GRID_SIZE } from "../grid";

const BOUNDS = { minX: -300, maxX: 2100, minY: -200, maxY: 1500 };

describe("computeMoneyFlowLayout", () => {
  it("sizes the company box to contain the stream bounds, snapped to the grid", () => {
    const { company } = computeMoneyFlowLayout(BOUNDS, 100_000);
    const left = company.x - company.hw;
    const right = company.x + company.hw;
    const top = company.y - company.hh;
    const bottom = company.y + company.hh;
    expect(left).toBeLessThanOrEqual(BOUNDS.minX);
    expect(right).toBeGreaterThanOrEqual(BOUNDS.maxX);
    expect(top).toBeLessThanOrEqual(BOUNDS.minY);
    expect(bottom).toBeGreaterThanOrEqual(BOUNDS.maxY);
    expect(Math.abs(left % GRID_SIZE)).toBe(0);
    expect(Math.abs(top % GRID_SIZE)).toBe(0);
  });

  it("places every external node's anchor on the grid", () => {
    const { externalNodes } = computeMoneyFlowLayout(BOUNDS, 100_000);
    for (const n of externalNodes) {
      expect(Math.abs(n.x % GRID_SIZE)).toBe(0);
      expect(Math.abs(n.y % GRID_SIZE)).toBe(0);
    }
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
      expect(a.x === b.x || a.y === b.y).toBe(true);
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
