/**
 * Hexagonal coordinates — the lattice everything sits on (Greg, 2026-09-29).
 *
 * Greg, after a week driving the 2,562-person company: *"let's shoot for a
 * hexagon based layout. The base hexagon can be a team — because within that
 * base hexagon, human nodes can orbit a parental node that's centred on the
 * middle of the hexagon."*
 *
 * **This reverses a call he made on 2026-09-13** — *"snapping is relative to
 * parent orbits, rather than an absolute grid"*, the sentence `snap.ts` opens
 * with. The reason it changed: free placement is what made arrangements look
 * accidental, and a continuous plane is what let the company sprawl to
 * 39,842 x 57,611 units, which is why you can travel for a hundred-fold of
 * zoom without passing anything named.
 *
 * ## Why hexagons
 *
 * A unit is a disc. Hexagonal close packing is the densest packing of equal
 * circles there is, so a hex lattice wastes less room than a square one for
 * exactly the thing we are packing. Six neighbours are all equidistant, where
 * a square grid has four near and four diagonal — so "next to" means one
 * thing rather than two. And a hex lattice grows in rounded, ragged
 * territories rather than city blocks, which is the organic shape Greg asked
 * for without anyone having to draw it.
 *
 * ## The convention here
 *
 * **Axial coordinates** `(q, r)`, **flat-top** hexagons. Flat-top because the
 * company reads left to right and flat-top gives true east and west
 * neighbours; a pointy-top lattice has no horizontal neighbour at all.
 *
 * Cube coordinates `(x, y, z)` with `x + y + z = 0` exist only inside this
 * file, for distance and rounding, which are ugly in axial and trivial in
 * cube. Nothing outside needs to know they are there.
 *
 * `size` is a hexagon's **circumradius** — centre to corner. Its inradius,
 * centre to edge, is `size * sqrt(3) / 2`, and that is what content has to
 * fit inside.
 *
 * Pure: no React, no Konva, no database, no randomness. Same input, same
 * lattice, for ever.
 */

export type Cell = { q: number; r: number };
export type Point = { x: number; y: number };

/** Lattice-space key. Cells are compared and stored by this, never by object
 *  identity — two `{q:1,r:0}` are the same cell. */
export const cellKey = (cell: Cell): string => `${cell.q},${cell.r}`;

export const cellFromKey = (key: string): Cell => {
  const [q, r] = key.split(",");
  return { q: Number(q), r: Number(r) };
};

export const sameCell = (a: Cell, b: Cell): boolean => a.q === b.q && a.r === b.r;

/**
 * The six directions, in world order starting due east and turning
 * anticlockwise (screen y grows downward, so anticlockwise on screen is
 * clockwise in maths — the order below is what actually reads as a rotation).
 */
export const DIRECTIONS: readonly Cell[] = [
  { q: 1, r: 0 },   // east
  { q: 1, r: -1 },  // north-east
  { q: 0, r: -1 },  // north-west
  { q: -1, r: 0 },  // west
  { q: -1, r: 1 },  // south-west
  { q: 0, r: 1 },   // south-east
] as const;

export const add = (a: Cell, b: Cell): Cell => ({ q: a.q + b.q, r: a.r + b.r });
export const subtract = (a: Cell, b: Cell): Cell => ({ q: a.q - b.q, r: a.r - b.r });
export const scale = (cell: Cell, k: number): Cell => ({ q: cell.q * k, r: cell.r * k });

export const neighbour = (cell: Cell, direction: number): Cell =>
  add(cell, DIRECTIONS[((direction % 6) + 6) % 6]);

export const neighbours = (cell: Cell): Cell[] => DIRECTIONS.map((d) => add(cell, d));

/**
 * How many steps apart two cells are. In cube space this is the largest of
 * the three axis differences, which is why cube exists at all.
 */
export function hexDistance(a: Cell, b: Cell): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  // Cube z is -(q + r), so the third difference is -(dq + dr).
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Every cell exactly `radius` steps from `centre`, walking the ring once.
 * Ring 0 is the centre itself; ring n has 6n cells.
 *
 * The walk starts at the western cell and goes round, so the order is stable
 * and the first cell of every ring lies on the same axis — which is what
 * makes an allocation reproducible rather than merely deterministic.
 */
export function ring(centre: Cell, radius: number): Cell[] {
  if (radius <= 0) return [{ ...centre }];
  const out: Cell[] = [];
  // Start `radius` steps south-west, then walk the six sides. The corner has
  // to be the one *opposite* the first walk direction or the path spirals
  // instead of closing — it started on the western corner until 2026-09-29,
  // which put cells in the ring that were not `radius` steps out at all.
  let cell = add(centre, scale(DIRECTIONS[4], radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push({ ...cell });
      cell = neighbour(cell, side);
    }
  }
  return out;
}

/** Every cell within `radius` steps, innermost first. */
export function spiral(centre: Cell, radius: number): Cell[] {
  const out: Cell[] = [{ ...centre }];
  for (let k = 1; k <= radius; k++) out.push(...ring(centre, k));
  return out;
}

/** How many cells a spiral of this radius holds: 1, 7, 19, 37, ... */
export const spiralSize = (radius: number): number =>
  radius <= 0 ? 1 : 1 + 3 * radius * (radius + 1);

const SQRT3 = Math.sqrt(3);

/** Centre to edge. Content must fit inside this to stay in its own cell. */
export const inradius = (size: number): number => (size * SQRT3) / 2;

/** Where a cell's centre falls in world space. Flat-top. */
export const cellToWorld = (cell: Cell, size: number): Point => ({
  x: size * 1.5 * cell.q,
  y: size * SQRT3 * (cell.r + cell.q / 2),
});

/** Which cell a world point falls in. Flat-top, with cube rounding — the
 *  nearest cell centre, not the one whose box you are in, because hexagons
 *  have no boxes. */
export function worldToCell(point: Point, size: number): Cell {
  const q = (2 / 3) * (point.x / size);
  const r = (-point.x / 3 + (SQRT3 / 3) * point.y) / size;
  return roundCell(q, r);
}

/** Round fractional axial coordinates to the nearest real cell. Done in cube
 *  space: round all three, then repair whichever drifted furthest so the
 *  x + y + z = 0 invariant holds. */
export function roundCell(qf: number, rf: number): Cell {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let x = Math.round(xf);
  let y = Math.round(yf);
  let z = Math.round(zf);
  const dx = Math.abs(x - xf);
  const dy = Math.abs(y - yf);
  const dz = Math.abs(z - zf);
  if (dx > dy && dx > dz) x = -y - z;
  else if (dy > dz) y = -x - z;
  else z = -x - y;
  // `+ 0` collapses -0 to 0. Without it `cellKey` produces both "1,-0" and
  // "1,0" for one cell, and the occupancy map stops being an occupancy map.
  return { q: x + 0, r: z + 0 };
}

/** The direction, in world radians, from one cell to another. Used to point
 *  a branch away from where it came from, and to fan a unit's people into
 *  whatever side of its hexagon is facing open ground. */
export function worldAngle(from: Cell, to: Cell, size: number): number {
  const a = cellToWorld(from, size);
  const b = cellToWorld(to, size);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** A hexagon's six corners in world space, flat-top: the first corner is due
 *  east, then anticlockwise. */
export function corners(cell: Cell, size: number): Point[] {
  const c = cellToWorld(cell, size);
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    out.push({ x: c.x + size * Math.cos(angle), y: c.y + size * Math.sin(angle) });
  }
  return out;
}

/** Which of the six directions points most nearly along `angle` (world
 *  radians). Used to turn "away from my parent" into a lattice direction. */
export function directionNearest(angle: number, size: number): number {
  let best = 0;
  let bestDot = -Infinity;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  for (let i = 0; i < 6; i++) {
    const p = cellToWorld(DIRECTIONS[i], size);
    const len = Math.hypot(p.x, p.y) || 1;
    const dot = (p.x / len) * ax + (p.y / len) * ay;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}
