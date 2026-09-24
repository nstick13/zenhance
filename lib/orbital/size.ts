/**
 * How big a unit's dot is — a *broad-brush* sense of how many people sit at
 * or below it (Greg, 2026-09-21).
 *
 * People are poor at comparing bubble areas, so nothing here promises that a
 * dot twice the area holds twice the people. Bigger generally means more
 * people below; two dots of similar size only share an order of magnitude.
 * Exact counts belong in labels and the tap/hover card.
 *
 * The pipeline is explicit so it can be tuned by eye rather than by maths:
 *
 *   descendant headcount
 *     → compressed proportion   log-compressed share of the company, 0..1
 *     → tuned size index        SIZE_INDEX_CURVE, freely editable, 0..1
 *     → bounded screen area     between DOT_MIN_PX and DOT_MAX_PX, in px²
 *     → radius                  derived from the area, never interpolated
 *
 * Area is what the eye reads, so it is area that interpolates; the radius is
 * only ever derived from it.
 */

/** Smallest and largest dot radius on screen, in CSS pixels. Hard limits:
 *  nothing the index says can push a dot outside them. */
export const DOT_MIN_PX = 2.5;
export const DOT_MAX_PX = 26;
/** The company (or the focused unit standing in for it) always reads as the
 *  place everything else hangs from, whatever its share says. */
export const MASTER_DOT_FLOOR_PX = 30;

/**
 * compressed proportion → size index. Product-tuned control points, not a
 * formula: edit them freely, keeping both columns non-decreasing and inside
 * 0..1 (a test holds that line). The shape here keeps small teams near the
 * floor, lets mid-sized branches separate, and saves the top of the range for
 * the few units that really carry the company.
 */
export const SIZE_INDEX_CURVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.3, 0.02],
  [0.5, 0.08],
  [0.7, 0.3],
  [0.85, 0.6],
  [1, 1],
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A unit's share of the company, log-compressed so a 12-person team and a
 * 1,200-person division are both visible on the same map. Relative to the
 * company, not absolute: the map is always read against itself.
 */
export function compressedHeadcount(count: number, companyCount: number): number {
  const total = Math.max(1, companyCount);
  const own = Math.max(0, Math.min(count, total));
  if (total <= 1) return own > 0 ? 1 : 0;
  return clamp01(Math.log1p(own) / Math.log1p(total));
}

/** Piecewise-linear lookup on a curve of [x, y] points sorted by x. */
export function interpolateCurve(curve: readonly (readonly [number, number])[], x: number): number {
  if (curve.length === 0) return clamp01(x);
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return curve[curve.length - 1][1];
}

export function sizeIndex(count: number, companyCount: number): number {
  return clamp01(interpolateCurve(SIZE_INDEX_CURVE, compressedHeadcount(count, companyCount)));
}

/** size index → screen area (px²) → screen radius (px). */
export function dotScreenRadius(index: number, opts: { master?: boolean } = {}): number {
  const minArea = Math.PI * DOT_MIN_PX * DOT_MIN_PX;
  const maxArea = Math.PI * DOT_MAX_PX * DOT_MAX_PX;
  const area = minArea + (maxArea - minArea) * clamp01(index);
  const radius = Math.sqrt(area / Math.PI);
  return opts.master ? Math.max(radius, MASTER_DOT_FLOOR_PX) : radius;
}

/** The whole pipeline in one call: headcount in, on-screen radius out. */
export function headcountDotPx(count: number, companyCount: number, opts: { master?: boolean } = {}): number {
  return dotScreenRadius(sizeIndex(count, companyCount), opts);
}
