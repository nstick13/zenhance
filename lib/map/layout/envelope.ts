/**
 * The quiet outline around a large company's occupied territory (Greg,
 * 2026-09-21).
 *
 * It is a smoothed offset around *structure* — every unit and the room its
 * people need, and the routes between them — and nothing else. It is not a
 * data region: it implies no ownership and no health. It is computed once from
 * the settled geography, so people appearing, hover, work dots and a drag in
 * progress can never make it breathe. Hidden units still count: thinning
 * decides what is painted, not where the company is.
 *
 * Method: a smooth union (log-sum-exp) of each unit's footprint disc and a
 * slimmer capsule along each parent→child route, sampled on a grid, traced
 * with marching squares and softened with three rounds of Chaikin smoothing.
 * The soft union lets neighbouring discs melt into one territory instead of a
 * string of bubbles, which is what reads as "a place" rather than a diagram.
 */
import type { Point } from "@/lib/map/layout/geometry";

export type EnvelopeSource = {
  units: readonly { x: number; y: number; r: number; footprint?: number }[];
  links: readonly { kind: "unit" | "seat"; from: Point; to: Point }[];
};

export type Envelope = {
  /** Closed outlines, each a list of points. Outer boundaries and any open
   *  ground enclosed by branches alike. */
  rings: Point[][];
  /** How far the outline stands off the structure it wraps. */
  pad: number;
};

type Element =
  | { kind: "disc"; x: number; y: number; r: number }
  | { kind: "capsule"; ax: number; ay: number; bx: number; by: number; r: number };

/** How many grid steps wide a connection's corridor must be before the
 *  sampler can be relied on to find it. Two samples across is the least that
 *  marching squares can trace without gaps; a little over that is stable. */
const CORRIDOR_STEPS = 2.5;
/** …and how many a unit's own body must be. Smaller than the corridor
 *  figure because a disc is round: it covers samples in both directions. */
const BODY_STEPS = 1.5;

const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Samples across the longer side of the territory. Enough to follow a team's
 *  footprint, few enough to trace in a few milliseconds on an old laptop. */
const GRID_SAMPLES = 150;

export function structuralEnvelope(source: EnvelopeSource): Envelope {
  const units = source.units;
  if (units.length === 0) return { rings: [], pad: 0 };
  const reaches = units.map((u) => u.footprint ?? u.r).sort((a, b) => a - b);
  const median = reaches[Math.floor(reaches.length / 2)];
  // Generous and soft on purpose: the outline should follow the major lobes
  // of the territory, not trace every team, and a pocket of open ground only
  // earns its own outline when it is big enough to be a place in its own right.
  const pad = Math.max(60, median * 0.6);
  const soft = pad * 1.1;

  // A corridor has to be wider than the sampler's step, or the grid steps
  // straight over it and the territory falls apart at long connections
  // (Greg, 2026-09-24: "the shrink wrap breaks when the connection line
  // becomes too long. It should remain contiguous."). The step follows the
  // company's size, so on a big company the corridors widen to match — which
  // is also what stops a 40,000-unit-wide territory looking like beads on a
  // thread.
  let spread = 0;
  {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const u of units) {
      const reach = (u.footprint ?? u.r) + pad;
      x0 = Math.min(x0, u.x - reach);
      y0 = Math.min(y0, u.y - reach);
      x1 = Math.max(x1, u.x + reach);
      y1 = Math.max(y1, u.y + reach);
    }
    spread = Math.max(x1 - x0, y1 - y0);
  }
  const step0 = spread / GRID_SAMPLES;
  const linkPad = Math.max(pad, step0 * CORRIDOR_STEPS);
  // The same argument applies to the units themselves. One branch carried a
  // long way out stretches the grid until the *rest* of the company is
  // thinner than a sample, and the territory it belongs to disappears from
  // under it. Nothing may be smaller than the sampler can see.
  const floor = step0 * BODY_STEPS;

  const elements: Element[] = units.map((u) => ({
    kind: "disc",
    x: u.x,
    y: u.y,
    r: Math.max((u.footprint ?? u.r) + pad, floor),
  }));
  for (const link of source.links) {
    if (link.kind !== "unit") continue;
    elements.push({ kind: "capsule", ax: link.from.x, ay: link.from.y, bx: link.to.x, by: link.to.y, r: linkPad });
  }

  // Bounds, with room for the soft union to swell past the discs.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of elements) {
    const [x0, y0, x1, y1] = e.kind === "disc"
      ? [e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r]
      : [Math.min(e.ax, e.bx) - e.r, Math.min(e.ay, e.by) - e.r, Math.max(e.ax, e.bx) + e.r, Math.max(e.ay, e.by) + e.r];
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  const margin = soft * 4;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  const step = Math.max(maxX - minX, maxY - minY) / GRID_SAMPLES;
  const cols = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxY - minY) / step) + 1;

  // Bucket elements by the grid cells they can influence, so each sample
  // only visits what is near it.
  const influence = soft * 6;
  const bucket = new Map<number, Element[]>();
  const cellOf = (x: number, y: number) => [Math.floor((x - minX) / step), Math.floor((y - minY) / step)];
  for (const e of elements) {
    const [x0, y0, x1, y1] = e.kind === "disc"
      ? [e.x - e.r - influence, e.y - e.r - influence, e.x + e.r + influence, e.y + e.r + influence]
      : [Math.min(e.ax, e.bx) - e.r - influence, Math.min(e.ay, e.by) - e.r - influence,
        Math.max(e.ax, e.bx) + e.r + influence, Math.max(e.ay, e.by) + e.r + influence];
    const [c0, r0] = cellOf(x0, y0);
    const [c1, r1] = cellOf(x1, y1);
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
        const k = r * cols + c;
        const list = bucket.get(k);
        if (list) list.push(e);
        else bucket.set(k, [e]);
      }
    }
  }

  // The field: positive inside the territory, negative outside, with the
  // union softened so near neighbours merge.
  const field = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + c * step;
      const y = minY + r * step;
      let sum = 0;
      for (const e of bucket.get(r * cols + c) ?? []) {
        const d = e.kind === "disc" ? Math.hypot(x - e.x, y - e.y) : distToSegment(x, y, e.ax, e.ay, e.bx, e.by);
        sum += Math.exp((e.r - d) / soft);
      }
      field[r * cols + c] = sum > 0 ? soft * Math.log(sum) : -Infinity;
    }
  }

  // Traced outlines wind one way and enclosed pockets the other (outlines
  // have negative signed area here). Every outline is kept; a pocket only if
  // it is big enough to read as open ground rather than a gap between teams.
  const minPocket = (pad * 6) ** 2;
  const rings = traceContours(field, cols, rows, (c, r) => ({ x: minX + c * step, y: minY + r * step }))
    .filter((ring) => {
      if (ring.length < 4) return false;
      const area = ringArea(ring);
      return area < 0 || area >= minPocket;
    })
    .map((ring) => chaikin(chaikin(chaikin(ring))));
  return { rings, pad };
}

/** Marching squares at level 0, joined into closed rings. */
function traceContours(
  field: Float64Array,
  cols: number,
  rows: number,
  at: (c: number, r: number) => Point,
): Point[][] {
  const v = (c: number, r: number) => {
    const value = field[r * cols + c];
    return Number.isFinite(value) ? value : -1e9;
  };
  const lerpEdge = (c0: number, r0: number, c1: number, r1: number): Point => {
    const a = v(c0, r0);
    const b = v(c1, r1);
    const t = a === b ? 0.5 : a / (a - b);
    const p = at(c0, r0);
    const q = at(c1, r1);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  // Edge ids so segments can be stitched exactly: horizontal edges below
  // vertical ones in one numbering.
  const hEdge = (c: number, r: number) => r * cols + c;
  const vEdge = (c: number, r: number) => cols * rows + r * cols + c;
  const points = new Map<number, Point>();
  const next = new Map<number, number>();

  const point = (edge: number, make: () => Point) => {
    if (!points.has(edge)) points.set(edge, make());
    return edge;
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = v(c, r) > 0 ? 1 : 0;
      const tr = v(c + 1, r) > 0 ? 1 : 0;
      const br = v(c + 1, r + 1) > 0 ? 1 : 0;
      const bl = v(c, r + 1) > 0 ? 1 : 0;
      const code = tl * 8 + tr * 4 + br * 2 + bl;
      if (code === 0 || code === 15) continue;
      const top = () => point(hEdge(c, r), () => lerpEdge(c, r, c + 1, r));
      const right = () => point(vEdge(c + 1, r), () => lerpEdge(c + 1, r, c + 1, r + 1));
      const bottom = () => point(hEdge(c, r + 1), () => lerpEdge(c, r + 1, c + 1, r + 1));
      const left = () => point(vEdge(c, r), () => lerpEdge(c, r, c, r + 1));
      // Segments run with the inside on their left, so rings close
      // consistently and neighbouring cells share edge ids.
      const seg = (a: number, b: number) => next.set(a, b);
      switch (code) {
        case 1: seg(left(), bottom()); break;
        case 2: seg(bottom(), right()); break;
        case 3: seg(left(), right()); break;
        case 4: seg(right(), top()); break;
        case 5: seg(left(), top()); seg(right(), bottom()); break;
        case 6: seg(bottom(), top()); break;
        case 7: seg(left(), top()); break;
        case 8: seg(top(), left()); break;
        case 9: seg(top(), bottom()); break;
        case 10: seg(top(), right()); seg(bottom(), left()); break;
        case 11: seg(top(), right()); break;
        case 12: seg(right(), left()); break;
        case 13: seg(right(), bottom()); break;
        case 14: seg(bottom(), left()); break;
      }
    }
  }

  const rings: Point[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring: Point[] = [];
    let cursor: number | undefined = start;
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      ring.push(points.get(cursor)!);
      cursor = next.get(cursor);
    }
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}

export function ringArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return a / 2;
}

/** One round of corner cutting on a closed ring. */
function chaikin(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
    out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
  }
  return out;
}

/** Ray-cast point-in-ring test, even-odd across all rings — inside the
 *  territory means inside an outer outline and not inside a hole. */
export function insideEnvelope(envelope: Envelope, p: Point): boolean {
  let inside = false;
  for (const ring of envelope.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}
