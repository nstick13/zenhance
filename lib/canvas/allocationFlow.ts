/**
 * Hub-and-spoke allocation lines: how a parent's budget splits across its
 * children. Used recursively at two levels — company → value streams, and a
 * value stream → its teams — via the same generic geometry. Pure, no
 * Konva/React, so it's unit-testable like the rest of lib/canvas/*.
 *
 * Every hub (company or stream) is a circle with a title-bearing circle at
 * its centre (Greg, 2026-09-12: "hulls... should be circular... and have a
 * central circle that has the title on it") — spokes always touch that
 * centre, hidden behind the circle drawn on top, whether the spoke is
 * arriving from the hub's own parent or fanning out to its children.
 */
import { straightPath, fanOffsets, fanPoint, LINE_GAP, type Point } from "./lineRouting";

export type Box = { x: number; y: number; hw: number; hh: number };

export type AllocationLine = {
  id: string;
  points: Point[];
  amountLabel: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nearest point on an axis-aligned box's boundary to an external point —
 *  so a spoke touches the box's edge, not its centre. Used only for
 *  non-circular recipients; see `anchorPoint`. Every real recipient in this
 *  system is currently a circle (hw === hh), but the geometry stays generic
 *  rather than assuming that. */
function nearestBoxPoint(from: { x: number; y: number }, box: Box) {
  return {
    x: clamp(from.x, box.x - box.hw, box.x + box.hw),
    y: clamp(from.y, box.y - box.hh, box.y + box.hh),
  };
}

/** A circular recipient is represented as a square box (hw === hh). */
const isCircle = (b: Box) => Math.abs(b.hw - b.hh) < 0.01;

/** Where a spoke actually touches a box: dead centre for a circle — the
 *  circle drawn on top hides the segment inside its own radius, "ends at
 *  centre, behind the circle" (Greg, 2026-09-12) — or the nearest edge
 *  point otherwise. */
function anchorPoint(from: { x: number; y: number }, box: Box) {
  return isCircle(box) ? { x: box.x, y: box.y } : nearestBoxPoint(from, box);
}

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

export type AllocationChild = Box & { id: string; cost: number };

/** Depth in the hierarchy — 1 for company→stream, 2 for stream→team.
 *  Thicker "between parents" (Greg, 2026-09-12), tapering thinner each
 *  level down. Exported as the single source of truth: the renderer draws
 *  each tier at exactly this width, and the fan spacing below is derived
 *  from it, so a thicker tier can never be spaced tighter than it is wide
 *  (which is what made two tier-1 siblings look like one fused line). */
export type Tier = 1 | 2;
export const TIER_STROKE: Record<Tier, number> = { 1: 11, 2: 7 };

/** One straight line per child, fanned apart near the hub so siblings
 *  leaving in similar directions read as parallel lines, not one
 *  overlapping bundle. Children are visited in angular order around the
 *  hub so the fan doesn't cross itself. Fan spacing is derived from this
 *  tier's own stroke width, so adjacent spokes always keep LINE_GAP of
 *  clear space between their edges regardless of how thick the tier is. */
export function computeAllocationSpokes(hub: Box, children: AllocationChild[], tier: Tier = 2): AllocationLine[] {
  const fanSpacing = TIER_STROKE[tier] + LINE_GAP;
  const ordered = [...children].sort(
    (a, b) => Math.atan2(a.y - hub.y, a.x - hub.x) - Math.atan2(b.y - hub.y, b.x - hub.x),
  );
  const offsets = fanOffsets(ordered.length, fanSpacing);
  return ordered.map((child, i) => {
    const to = anchorPoint(hub, child);
    const rawFrom = anchorPoint(to, hub);
    const from = fanPoint(rawFrom, to, offsets[i]);
    return { id: `alloc-${child.id}`, points: straightPath(from, to), amountLabel: `${money(child.cost)}/mo` };
  });
}

// --- hub title circle geometry ------------------------------------------

/** How big a hub's central title circle is, scaled gently by how many
 *  children it carries — company (many streams) reads bigger than a small
 *  stream, without either shrinking to illegible or ballooning unbounded. */
export function hubTitleRadius(childCount: number): number {
  return Math.round(clamp(72 + childCount * 12, 78, 160));
}

/** The point spoke lines actually touch: a hub's title circle, always —
 *  every hub (company or stream) has one. */
export function hubRecipient(circle: { x: number; y: number; r: number }): Box {
  return { x: circle.x, y: circle.y, hw: circle.r, hh: circle.r };
}
