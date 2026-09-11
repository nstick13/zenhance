/**
 * Hub-and-spoke allocation lines: how a parent's budget splits across its
 * children. Used recursively at two levels — company → value streams, and a
 * value stream → its teams — via the same generic geometry. Pure, no
 * Konva/React, so it's unit-testable like the rest of lib/canvas/*.
 *
 * Design (Greg, 2026-09-07): a hull's title card is locked to its top-right
 * corner and always rendered — the same card at every zoom level, so the
 * hull "collapsing" as you zoom out is just its background fading away
 * around a card that was there all along, not a swap between two different
 * elements. While a hull's children are visible, a small circle appears
 * just below its card and becomes the actual line endpoint (both the line
 * arriving from its own parent, and the lines fanning out to its children)
 * — so spokes never have to terminate inside the card's text.
 */
import { octilinearPath, fanOffsets, fanPoint, LINE_GAP, type Point } from "./lineRouting";

export type Box = { x: number; y: number; hw: number; hh: number };

export type AllocationLine = {
  id: string;
  points: Point[];
  amountLabel: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nearest point on an axis-aligned box's boundary to an external point —
 *  so a spoke touches the box's edge, not its centre. */
function nearestBoxPoint(from: { x: number; y: number }, box: Box) {
  return {
    x: clamp(from.x, box.x - box.hw, box.x + box.hw),
    y: clamp(from.y, box.y - box.hh, box.y + box.hh),
  };
}

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

export type AllocationChild = Box & { id: string; cost: number };

/** Stroke width for a spoke — exported so the renderer draws lines exactly
 *  this thick and never drifts from the spacing math below. */
export const ALLOC_STROKE = 9;
/** Centreline-to-centreline spacing that gives adjacent parallel spokes
 *  exactly LINE_GAP of clear space between their edges. */
const FAN_SPACING = ALLOC_STROKE + LINE_GAP;

/** One line per child, routed octilinearly (Mini Metro style — 45°/straight
 *  segments, never an arbitrary angle) and fanned apart near the hub so
 *  siblings leaving in similar directions read as parallel lines, not one
 *  overlapping bundle. Children are visited in angular order around the
 *  hub so the fan doesn't cross itself. */
export function computeAllocationSpokes(hub: Box, children: AllocationChild[]): AllocationLine[] {
  const ordered = [...children].sort(
    (a, b) => Math.atan2(a.y - hub.y, a.x - hub.x) - Math.atan2(b.y - hub.y, b.x - hub.x),
  );
  const offsets = fanOffsets(ordered.length, FAN_SPACING);
  return ordered.map((child, i) => {
    const to = nearestBoxPoint(hub, child);
    const rawFrom = nearestBoxPoint(to, hub);
    const from = fanPoint(rawFrom, to, offsets[i]);
    return { id: `alloc-${child.id}`, points: octilinearPath(from, to), amountLabel: `${money(child.cost)}/mo` };
  });
}

// --- hub card geometry -------------------------------------------------

export const CARD_W = 230;
export const CARD_PAD = 14;
export const CARD_TITLE_LINE_H = 24;
export const CARD_LINE_H = 17;
export const CARD_CIRCLE_R = 8;
export const CARD_CIRCLE_GAP = 14;

export type HubGeometry = { card: Box; circle: { x: number; y: number; r: number } | null };

/** The card's height depends only on whether it carries an owner line
 *  (streams do, the company doesn't) — everything else is fixed, so this
 *  is the one place that decides it, shared by the renderer and the line
 *  math instead of each guessing the other's layout. */
export function computeHubGeometry(hull: Box, hasOwnerLine: boolean, expanded: boolean): HubGeometry {
  const cardH = CARD_PAD * 2 + CARD_TITLE_LINE_H + (hasOwnerLine ? CARD_LINE_H : 0) + CARD_LINE_H;
  const left = hull.x + hull.hw - CARD_PAD - CARD_W;
  const top = hull.y - hull.hh + CARD_PAD;
  const card: Box = { x: left + CARD_W / 2, y: top + cardH / 2, hw: CARD_W / 2, hh: cardH / 2 };
  if (!expanded) return { card, circle: null };
  return { card, circle: { x: card.x, y: card.y + card.hh + CARD_CIRCLE_GAP + CARD_CIRCLE_R, r: CARD_CIRCLE_R } };
}

/** The point spoke lines actually touch: the circle once one exists,
 *  otherwise the card itself. */
export function hubRecipient(geo: HubGeometry): Box {
  return geo.circle ? { x: geo.circle.x, y: geo.circle.y, hw: geo.circle.r, hh: geo.circle.r } : geo.card;
}
