/**
 * One camera, local semantic detail (Greg, 2026-09-21).
 *
 * The map has exactly one geographic camera. Wheel and pinch zoom it; a drag
 * on the background pans it. Its scale is the **base zoom index**. Over that
 * sits a *local detail field*: a soft disc, pinned where the user tapped open
 * ground, inside which the map reads as though it were zoomed in by about one
 * semantic tier — without the camera moving at all.
 *
 * Everything that asks "how much of this should show here?" asks this file:
 * painting, labels, culling and hit-testing all read `effectiveScale`, so they
 * cannot disagree about what exists.
 *
 * The field may also spread marks apart a little (`lensDisplace`) so what it
 * reveals has room. That displacement is presentation only: it never touches
 * layout, is never saved, and fades to exactly nothing well before distant
 * regions, which stay perfectly still.
 */
import { revealAt, smoothstep, type Reveal } from "./lod";
import type { Point } from "./geometry";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Where each semantic tier is half-arrived, as camera scale — the midpoints of
 * lod's reveal bands. Between anchors the tier index is linear in log(scale),
 * so "one tier" is a multiplicative step, the way zoom is felt.
 *
 *   tier 0  company      whole-company territory
 *   tier 1  structure    ~0.15×  deeper units arrive
 *   tier 2  teams        ~0.52×  leads and unit gauges
 *   tier 3  people       ~1.9×   people and their boards
 *   tier 4  work         ~3.7×   individual work items
 */
export const TIER_ANCHORS: readonly number[] = [0.04, 0.15, 0.52, 1.9, 3.7];

const LOGS = TIER_ANCHORS.map(Math.log);

/** Continuous, strictly increasing tier index for a camera scale. Extrapolated
 *  beyond both ends on the nearest segment's slope, so it never flattens and
 *  can always be inverted. */
export function detailTier(scale: number): number {
  const l = Math.log(Math.max(scale, 1e-9));
  const last = LOGS.length - 1;
  let i = 0;
  if (l <= LOGS[0]) i = 0;
  else if (l >= LOGS[last]) i = last - 1;
  else while (i < last - 1 && l > LOGS[i + 1]) i++;
  return i + (l - LOGS[i]) / (LOGS[i + 1] - LOGS[i]);
}

/** The camera scale at which the continuous tier index reaches `tier`. */
export function scaleForTier(tier: number): number {
  const last = LOGS.length - 1;
  const i = Math.min(Math.max(Math.floor(tier), 0), last - 1);
  const t = tier - i;
  return Math.exp(LOGS[i] + (LOGS[i + 1] - LOGS[i]) * t);
}

/** How far the field may lift detail: about one tier, never more. */
export const FIELD_TIER_BOOST = 1;

export type DetailField = {
  /** World coordinates of the field's centre. It stays pinned to the place,
   *  not the screen, so panning carries it along with the map. */
  x: number;
  y: number;
  /** 0..1 — eased in when pinned, out when released. */
  strength: number;
  /** Radius on screen, in CSS pixels, so the field feels the same size at
   *  every zoom. */
  radiusPx: number;
};

/** A field about a third of the shorter side of the viewport, within bounds
 *  that keep it meaningful on a phone and restrained on a big monitor. */
export function fieldRadiusPx(viewport: { width: number; height: number }): number {
  return Math.min(260, Math.max(140, Math.min(viewport.width, viewport.height) * 0.3));
}

/** Share of the radius over which the field holds full strength before it
 *  begins to fall away. */
const FIELD_PLATEAU = 0.45;

/** How strongly the field acts at a world point: full across its core, easing
 *  smoothly to nothing at its rim. */
export function fieldInfluence(field: DetailField | null, point: Point, scale: number): number {
  if (!field || field.strength <= 0) return 0;
  const radius = field.radiusPx / Math.max(scale, 1e-9);
  const d = Math.hypot(point.x - field.x, point.y - field.y);
  return clamp01(field.strength) * (1 - smoothstep(FIELD_PLATEAU * radius, radius, d));
}

/** The scale the map should *read as* at a point: the camera's own, lifted by
 *  up to one tier where the field acts. Geometry never uses this — only
 *  decisions about what to show. */
export function effectiveScale(scale: number, influence: number): number {
  const lift = FIELD_TIER_BOOST * clamp01(influence);
  if (lift <= 0) return scale;
  return scaleForTier(detailTier(scale) + lift);
}

export function effectiveReveal(scale: number, influence: number): Reveal {
  return revealAt(effectiveScale(scale, influence));
}

/**
 * Spread marks apart around the field so what it reveals has room.
 *
 * A radial push that is zero at the centre, rises, then decays to exactly
 * zero at LENS_REACH radii, with a continuous slope at both ends. With
 * LENS_GAIN below 3 the mapping from distance to distance is strictly
 * increasing, so nothing can cross over anything else; at the centre marks
 * are LENS_GAIN + 1 times further apart than they really are.
 */
export const LENS_GAIN = 0.45;
export const LENS_REACH = 1.7;

export function lensDisplace(field: DetailField | null, point: Point, scale: number): Point {
  if (!field || field.strength <= 0) return point;
  const radius = field.radiusPx / Math.max(scale, 1e-9);
  const dx = point.x - field.x;
  const dy = point.y - field.y;
  const r = Math.hypot(dx, dy);
  const v = r / (radius * LENS_REACH);
  if (r < 1e-9 || v >= 1) return point;
  const factor = 1 + clamp01(field.strength) * LENS_GAIN * (1 - v) * (1 - v);
  return { x: field.x + dx * factor, y: field.y + dy * factor };
}

/** Where a point that is *drawn* at `shown` really is. The lens is strictly
 *  increasing along each bearing, so the inverse is a short bisection — what
 *  lets a tap land on the true world point under the finger. */
export function lensInverse(field: DetailField | null, shown: Point, scale: number): Point {
  if (!field || field.strength <= 0) return shown;
  const dx = shown.x - field.x;
  const dy = shown.y - field.y;
  const target = Math.hypot(dx, dy);
  if (target < 1e-9) return shown;
  const reach = (field.radiusPx / Math.max(scale, 1e-9)) * LENS_REACH;
  // Beyond the lens's reach nothing moved.
  if (target >= reach) return shown;
  const ux = dx / target;
  const uy = dy / target;
  const out = (r: number) => {
    const p = lensDisplace(field, { x: field.x + ux * r, y: field.y + uy * r }, scale);
    return Math.hypot(p.x - field.x, p.y - field.y);
  };
  let lo = 0;
  let hi = target;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (out(mid) < target) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  return { x: field.x + ux * r, y: field.y + uy * r };
}

/** Below this on-screen radius, or this presence, a mark is not something a
 *  finger or cursor should be able to catch. A tap there belongs to the open
 *  ground behind it. */
export const INTERACTABLE_PX = 3;
export const INTERACTABLE_PRESENCE = 0.5;

export function isInteractable(presence: number, drawnScreenPx: number): boolean {
  return presence >= INTERACTABLE_PRESENCE && drawnScreenPx >= INTERACTABLE_PX;
}
