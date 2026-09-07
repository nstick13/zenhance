/**
 * Layout + numbers for the "money flow" scene — the company container and
 * the external entities (customers, shareholders, government, suppliers)
 * that sit outside it. Pure geometry/arithmetic, no Konva/React, so it's
 * unit-testable like the rest of lib/canvas/*.
 *
 * This is a communication device for customer research, not a financial
 * model: the dollar figures are illustrative ratios off the org's real
 * monthly payroll cost (the one number the canvas already knows), not a
 * real P&L. There is no finance data in the schema.
 */
import { snap } from "./grid";
import { octilinearPath, type Point } from "./lineRouting";

export const DEFAULT_COMPANY_NAME = "Galaxy Holdings";

export type WorldBounds = { minX: number; maxX: number; minY: number; maxY: number };

export type ExternalNodeId = "customers" | "shareholders" | "government" | "suppliers";

export type ExternalNode = {
  id: ExternalNodeId;
  name: string;
  x: number;
  y: number;
  hw: number;
  hh: number;
  note: string;
};

export type MoneyFlowKind = "income" | "outflow";

export type MoneyFlowLine = {
  id: string;
  kind: MoneyFlowKind;
  /** Direction always matches the real money flow — packets animate along
   *  points[0] → points[last]. Routed octilinearly, though these are all
   *  already axis-aligned by construction, so it's a straight 2-point path. */
  points: Point[];
  amountLabel: string | null;
};

/** `octilinearPath` plus the flow's kind/label — every flow entry below is
 *  built through this instead of a literal object, so none can end up as a
 *  bare from/to pair the renderer can't draw. */
function flow(id: string, kind: MoneyFlowKind, from: Point, to: Point, amountLabel: string | null): MoneyFlowLine {
  return { id, kind, points: octilinearPath(from, to), amountLabel };
}

export type CompanyBox = { x: number; y: number; hw: number; hh: number };

export type MoneyFlowLayout = {
  company: CompanyBox;
  grid: WorldBounds;
  externalNodes: ExternalNode[];
  flows: MoneyFlowLine[];
};

const NODE_HW = 110;
const NODE_HH = 58;
const COMPANY_PAD = 90;
const NODE_OFFSET = 430;
const GRID_PAD = 140;

// Illustrative ratios off total monthly payroll cost — not a real P&L.
const REVENUE_MULT = 2.4;
const SUPPLIERS_MULT = 0.18;
const TAXES_MULT = 0.15;
const DIVIDENDS_MULT = 0.1;

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

export function computeMoneyFlowLayout(
  streamBounds: WorldBounds,
  totalMonthlyCost: number,
): MoneyFlowLayout {
  const minX = snap(streamBounds.minX - COMPANY_PAD);
  const maxX = snap(streamBounds.maxX + COMPANY_PAD);
  const minY = snap(streamBounds.minY - COMPANY_PAD);
  const maxY = snap(streamBounds.maxY + COMPANY_PAD);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const company: CompanyBox = { x: cx, y: cy, hw: (maxX - minX) / 2, hh: (maxY - minY) / 2 };
  // The true centre of two grid-aligned edges isn't necessarily itself on
  // the grid (e.g. edges at -200/1500 average to 650). External-node anchors
  // use this snapped pair instead, so every anchor — not just the company
  // box — sits on a grid line.
  const cxs = snap(cx);
  const cys = snap(cy);

  const hasCost = totalMonthlyCost > 0;
  const revenue = totalMonthlyCost * REVENUE_MULT;
  const suppliers = totalMonthlyCost * SUPPLIERS_MULT;
  const taxes = totalMonthlyCost * TAXES_MULT;
  const dividends = totalMonthlyCost * DIVIDENDS_MULT;

  const customers: ExternalNode = {
    id: "customers",
    name: "Clients & customers",
    x: cxs,
    y: snap(minY - NODE_OFFSET),
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Revenue · ${money(revenue)}/mo` : "Revenue",
  };
  const shareholders: ExternalNode = {
    id: "shareholders",
    name: "Shareholders",
    x: snap(maxX + NODE_OFFSET),
    y: cys,
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Dividends · -${money(dividends)}/mo` : "Capital & dividends",
  };
  const government: ExternalNode = {
    id: "government",
    name: "Government",
    x: cxs,
    y: snap(maxY + NODE_OFFSET),
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Taxes · -${money(taxes)}/mo` : "Taxes",
  };
  const suppliers_: ExternalNode = {
    id: "suppliers",
    name: "Suppliers & other costs",
    x: snap(minX - NODE_OFFSET),
    y: cys,
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Rent, tools, vendors · -${money(suppliers)}/mo` : "Rent, tools, vendors",
  };

  const externalNodes: ExternalNode[] = [customers, shareholders, government, suppliers_];

  const flows: MoneyFlowLine[] = [
    flow(
      "customers-in",
      "income",
      { x: cxs, y: customers.y + customers.hh },
      { x: cxs, y: minY },
      hasCost ? `${money(revenue)}/mo` : null,
    ),
    flow(
      "shareholders-in",
      "income",
      { x: shareholders.x - shareholders.hw, y: cys - 22 },
      { x: maxX, y: cys - 22 },
      null, // capital raises aren't a recurring monthly figure
    ),
    flow(
      "shareholders-out",
      "outflow",
      { x: maxX, y: cys + 22 },
      { x: shareholders.x - shareholders.hw, y: cys + 22 },
      hasCost ? `-${money(dividends)}/mo` : null,
    ),
    flow(
      "government-out",
      "outflow",
      { x: cxs, y: maxY },
      { x: cxs, y: government.y - government.hh },
      hasCost ? `-${money(taxes)}/mo` : null,
    ),
    flow(
      "suppliers-out",
      "outflow",
      { x: minX, y: cys },
      { x: suppliers_.x + suppliers_.hw, y: cys },
      hasCost ? `-${money(suppliers)}/mo` : null,
    ),
  ];

  const grid: WorldBounds = {
    minX: minX - NODE_OFFSET - NODE_HW - GRID_PAD,
    maxX: maxX + NODE_OFFSET + NODE_HW + GRID_PAD,
    minY: minY - NODE_OFFSET - NODE_HH - GRID_PAD,
    maxY: maxY + NODE_OFFSET + NODE_HH + GRID_PAD,
  };

  return { company, grid, externalNodes, flows };
}
