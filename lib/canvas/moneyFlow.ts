/**
 * Layout + numbers for the "money flow" scene — the company container and
 * the external entities (customers, shareholders, government, suppliers)
 * that sit outside it. Pure geometry/arithmetic, no Konva/React, so it's
 * unit-testable like the rest of lib/canvas/*.
 *
 * The "solar system" model (Greg, 2026-09-12): the company is a circle
 * centred on Exec — "the office of the executive team sits in the middle"
 * — so this circle is centred on the same origin buildCanvasMap.ts seeds
 * Exec at. Four external entities sit at the compass points outside it
 * (customers north, shareholders east, government south, suppliers west),
 * each connected by a straight radial line running to the circle's own
 * edge at that same angle.
 *
 * This is a communication device for customer research, not a financial
 * model: the dollar figures are illustrative ratios off the org's real
 * monthly payroll cost (the one number the canvas already knows), not a
 * real P&L. There is no finance data in the schema.
 *
 * Every line here is a straight radial segment (Greg, 2026-09-12: no more
 * grid-snapping, no more bent "railway" routing — see lib/canvas/grid.ts's
 * removal and lineRouting.ts's straightPath).
 */
import { straightPath, LINE_GAP, type Point } from "./lineRouting";

/** Stroke width for a money-flow line — exported so the renderer draws
 *  lines exactly this thick and never drifts from the spacing math below. */
export const FLOW_STROKE = 13.5;
/** Shareholders carries two parallel lines (investment in, dividends out);
 *  this half-offset gives them exactly LINE_GAP of clear space between
 *  their edges, the same rule every other parallel pair in the app follows. */
const SHAREHOLDER_HALF_OFFSET = (FLOW_STROKE + LINE_GAP) / 2;

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
   *  points[0] → points[last]. Routed octilinearly, though a radial line to
   *  one of the four compass points is already axis-aligned, so it's a
   *  straight 2-point path. */
  points: Point[];
  amountLabel: string | null;
};

/** `straightPath` plus the flow's kind/label — every flow entry below is
 *  built through this instead of a literal object, so none can end up as a
 *  bare from/to pair the renderer can't draw. */
function flow(id: string, kind: MoneyFlowKind, from: Point, to: Point, amountLabel: string | null): MoneyFlowLine {
  return { id, kind, points: straightPath(from, to), amountLabel };
}

/** hw === hh always — a square box standing in for a circle, the same
 *  convention lib/canvas/allocationFlow.ts's `isCircle` reads to decide a
 *  spoke should touch the centre rather than an edge. */
export type CompanyBox = { x: number; y: number; hw: number; hh: number };

export type MoneyFlowLayout = {
  company: CompanyBox;
  externalNodes: ExternalNode[];
  flows: MoneyFlowLine[];
};

const NODE_HW = 110;
const NODE_HH = 58;
const COMPANY_PAD = 90;
const NODE_OFFSET = 430;

// Compass angles (degrees; 0 = east, -90 = north — screen y grows downward).
const ANGLE_DEG = { customers: -90, shareholders: 0, government: 90, suppliers: 180 } as const;

// Illustrative ratios off total monthly payroll cost — not a real P&L.
const REVENUE_MULT = 2.4;
const SUPPLIERS_MULT = 0.18;
const TAXES_MULT = 0.15;
const DIVIDENDS_MULT = 0.1;

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

/** A point at `dist` from the origin, along a compass angle. */
function pointAt(deg: number, dist: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: dist * Math.cos(rad), y: dist * Math.sin(rad) };
}

export function computeMoneyFlowLayout(
  streamBounds: WorldBounds,
  totalMonthlyCost: number,
): MoneyFlowLayout {
  // Circle centred on Exec (the origin), sized to reach the furthest corner
  // of the streams' own bounding box plus a clear margin.
  const corners: Point[] = [
    { x: streamBounds.minX, y: streamBounds.minY },
    { x: streamBounds.maxX, y: streamBounds.minY },
    { x: streamBounds.minX, y: streamBounds.maxY },
    { x: streamBounds.maxX, y: streamBounds.maxY },
  ];
  const maxDist = Math.max(1, ...corners.map((p) => Math.hypot(p.x, p.y)));
  const radius = maxDist + COMPANY_PAD;
  const company: CompanyBox = { x: 0, y: 0, hw: radius, hh: radius };

  const hasCost = totalMonthlyCost > 0;
  const revenue = totalMonthlyCost * REVENUE_MULT;
  const suppliers = totalMonthlyCost * SUPPLIERS_MULT;
  const taxes = totalMonthlyCost * TAXES_MULT;
  const dividends = totalMonthlyCost * DIVIDENDS_MULT;

  const customers: ExternalNode = {
    id: "customers",
    name: "Clients & customers",
    ...pointAt(ANGLE_DEG.customers, radius + NODE_OFFSET),
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Revenue · ${money(revenue)}/mo` : "Revenue",
  };
  const shareholders: ExternalNode = {
    id: "shareholders",
    name: "Shareholders",
    ...pointAt(ANGLE_DEG.shareholders, radius + NODE_OFFSET),
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Dividends · -${money(dividends)}/mo` : "Capital & dividends",
  };
  const government: ExternalNode = {
    id: "government",
    name: "Government",
    ...pointAt(ANGLE_DEG.government, radius + NODE_OFFSET),
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Taxes · -${money(taxes)}/mo` : "Taxes",
  };
  const suppliers_: ExternalNode = {
    id: "suppliers",
    name: "Suppliers & other costs",
    ...pointAt(ANGLE_DEG.suppliers, radius + NODE_OFFSET),
    hw: NODE_HW,
    hh: NODE_HH,
    note: hasCost ? `Rent, tools, vendors · -${money(suppliers)}/mo` : "Rent, tools, vendors",
  };

  const externalNodes: ExternalNode[] = [customers, shareholders, government, suppliers_];
  const edgeAt = (deg: number) => pointAt(deg, radius);

  const flows: MoneyFlowLine[] = [
    flow(
      "customers-in",
      "income",
      { x: customers.x, y: customers.y + customers.hh },
      edgeAt(ANGLE_DEG.customers),
      hasCost ? `${money(revenue)}/mo` : null,
    ),
    flow(
      "shareholders-in",
      "income",
      { x: shareholders.x - shareholders.hw, y: shareholders.y - SHAREHOLDER_HALF_OFFSET },
      { x: radius, y: shareholders.y - SHAREHOLDER_HALF_OFFSET },
      null, // capital raises aren't a recurring monthly figure
    ),
    flow(
      "shareholders-out",
      "outflow",
      { x: radius, y: shareholders.y + SHAREHOLDER_HALF_OFFSET },
      { x: shareholders.x - shareholders.hw, y: shareholders.y + SHAREHOLDER_HALF_OFFSET },
      hasCost ? `-${money(dividends)}/mo` : null,
    ),
    flow(
      "government-out",
      "outflow",
      edgeAt(ANGLE_DEG.government),
      { x: government.x, y: government.y - government.hh },
      hasCost ? `-${money(taxes)}/mo` : null,
    ),
    flow(
      "suppliers-out",
      "outflow",
      { x: -radius, y: suppliers_.y },
      { x: suppliers_.x + suppliers_.hw, y: suppliers_.y },
      hasCost ? `-${money(suppliers)}/mo` : null,
    ),
  ];

  return { company, externalNodes, flows };
}
