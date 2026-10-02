/**
 * Where a team's people stand (Greg, 2026-10-02).
 *
 * *"People should orbit on 'rings' that are offsets of the node hexagon. They
 * gather on the side opposite the connection line, with one exception — the
 * team lead, who sits near the connection line. They do not sit 'inside' the
 * team node — but they should sit inside the host tile."*
 *
 * ## Why this is not the orbital map's seating
 *
 * The orbital engine sits people on *circular* rings around a disc, and puts
 * the first six **inside** the unit. On a lattice both of those are wrong. The
 * node is a hexagon, so a ring concentric with it is a hexagon too — anything
 * circular reads as a different shape sitting in the wrong hole. And a cell is
 * a hard boundary: whatever a unit has, it has to fit in its own tile, because
 * the tile next door belongs to somebody else.
 *
 * ## The shape of it
 *
 * Rings are hexagons concentric with the node and the cell, all three in the
 * same orientation, so the whole figure is one family of nested hexagons. A
 * person's position on a ring is given by a **perimeter parameter** `t` in
 * [0, 6) — one unit per side, so equal steps in `t` are equal distances along
 * the ring, which is what makes the spacing even. (Equal steps in *angle*
 * would bunch people at the corners.)
 *
 * Filling runs outward from `t` directly opposite the way home, alternating
 * sides, so a team of four is a small arc on the far side and a team of fifty
 * wraps most of the way round. Nobody has to decide which case they are in.
 *
 * The lead is the exception and sits on the innermost ring, on the home side —
 * so the eye travelling down the chain arrives at the lead first.
 *
 * ## Fitting inside the tile
 *
 * Two hexagons that are concentric and share an orientation are related by a
 * plain scale, so clearance is easy: between a ring of circumradius `r` and a
 * hexagon of circumradius `R`, the narrowest gap is `(√3/2)(R − r)`, at the
 * middle of a side. So a dot of radius `p` clears when `R − r ≥ 2p/√3`. That
 * one inequality gives both the innermost ring (clear of the node) and the
 * outermost (inside the cell), with no special cases.
 */
import type { Point } from "@/lib/map/layout/hex/coords";

/** The narrowest gap between concentric hexagons is at the middle of a side,
 *  which is √3/2 of the difference in circumradius. Inverted: how much
 *  circumradius a dot of radius `p` needs to clear a boundary. */
export const CLEARANCE = 2 / Math.sqrt(3);

export type PersonSeat = {
  id: string;
  x: number;
  y: number;
  r: number;
  kind: "person" | "lead" | "open";
  /** 0 is the innermost ring. The lead is always on 0. */
  ring: number;
};

export type SeatRequest = { id: string; kind: "person" | "lead" | "open" };

/** How much bigger a person is here than on the orbital map. Greg, 2026-10-02:
 *  *"let's make human nodes 50% bigger — scale 1.5x."* */
export const PERSON_SCALE = 1.5;

/** Clear air between two rings, on top of the two dots' own diameters. Greg
 *  asked for *"a bit more spacing"* on the same day; this is what sets it. */
export const SEAT_RING_GAP = 10;

/** How many rings a unit may use. Greg: *"let's provide for four possible
 *  rungs."* A team cell has room for more, but four is as many as reads as a
 *  crowd round a node rather than as a dartboard — and it is the cap that
 *  decides what "too many people for one cell" means. */
export const MAX_PEOPLE_RINGS = 4;

/**
 * A point on a hexagonal ring, by distance round its perimeter.
 *
 * `t` runs 0..6, one unit per side, starting at the corner on the +x axis and
 * turning the same way `cornersAt` numbers its corners. Values outside the
 * range wrap, so a caller can step past the end without bookkeeping.
 */
export function pointOnHexRing(centre: Point, r: number, t: number): Point {
  const wrapped = ((t % 6) + 6) % 6;
  const i = Math.floor(wrapped);
  const f = wrapped - i;
  const a0 = (Math.PI / 3) * i;
  const a1 = (Math.PI / 3) * (i + 1);
  const x0 = r * Math.cos(a0);
  const y0 = r * Math.sin(a0);
  const x1 = r * Math.cos(a1);
  const y1 = r * Math.sin(a1);
  return { x: centre.x + x0 + (x1 - x0) * f, y: centre.y + y0 + (y1 - y0) * f };
}

/**
 * The perimeter parameter where a ray at `angle` leaves the ring.
 *
 * Scale-free — the answer is the same for every ring — so a direction converts
 * once and applies to all of them.
 */
export function hexRingParam(angle: number): number {
  const TAU = Math.PI * 2;
  const a = ((angle % TAU) + TAU) % TAU;
  const i = Math.floor(a / (Math.PI / 3)) % 6;
  const a0 = (Math.PI / 3) * i;
  const a1 = (Math.PI / 3) * (i + 1);
  // Unit ring; the fraction along the side is independent of radius.
  const ax = Math.cos(a0);
  const ay = Math.sin(a0);
  const dx = Math.cos(a1) - ax;
  const dy = Math.sin(a1) - ay;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const denom = dx * uy - dy * ux;
  if (Math.abs(denom) < 1e-12) return i;
  const f = -(ax * uy - ay * ux) / denom;
  return i + Math.min(1, Math.max(0, f));
}

/**
 * **The one line that makes the pattern neat.**
 *
 * Greg, 2026-10-02: *"make the way the people arrange themselves on each rung
 * nice and neat — please write a line of code that governs an evenly-spaced
 * pattern along the rungs."*
 *
 * A whole number of people **per side**, so every ring carries a dot exactly on
 * each of its six corners and an even run between them — and consecutive rings
 * differ by exactly six, which is the lattice's own arithmetic. The result is a
 * honeycomb rather than four unrelated arcs: 3, 4, 5, 6 to a side on the four
 * rings of a team cell, each dot sitting on a radial line out from the centre.
 *
 * `floor` rather than `round` because it is also the safety bound: it can only
 * make the spacing wider than `step`, never narrower, so two dots can never
 * touch however the radii fall.
 */
const slotsOn = (r: number, step: number) => 6 * Math.max(1, Math.floor(r / step));

/** How far apart two perimeter parameters are, the short way round: 0..3. */
export function ringGap(a: number, b: number): number {
  const x = (((a - b) % 6) + 6) % 6;
  return Math.min(x, 6 - x);
}

export type RingPlan = { r: number; slots: number };

/**
 * The rings available between a node and the edge of its cell, innermost
 * first, and how many people each holds.
 *
 * Returns nothing at all when the node leaves no room — which is a real answer,
 * not a failure: a unit whose node fills its tile has nowhere to stand anyone,
 * and the caller should say so rather than drawing people over the edge.
 */
export function ringsBetween(
  nodeR: number,
  cellR: number,
  seatR: number,
  gap: number,
  maxRings = MAX_PEOPLE_RINGS,
): RingPlan[] {
  const step = 2 * seatR + gap;
  const first = nodeR + CLEARANCE * seatR;
  const last = cellR - CLEARANCE * seatR;
  const out: RingPlan[] = [];
  for (let r = first; r <= last + 1e-9 && out.length < maxRings; r += step) {
    out.push({ r, slots: slotsOn(r, step) });
  }
  return out;
}

/**
 * Seat a unit's people around its node.
 *
 * `homeAngle` points at the parent — the way the connection line leaves. The
 * lead goes there; everybody else gathers opposite and spreads from it.
 *
 * People who do not fit inside the tile are **left out**, and the caller gets
 * fewer seats back than it asked for. Spilling into the neighbouring cell is
 * the one thing a lattice must never do, so the overflow is the caller's
 * problem to show — not something to hide by drawing over the boundary.
 */
export function placePeople(options: {
  centre: Point;
  /** Circumradius of the node hexagon the people orbit. */
  nodeR: number;
  /** Circumradius of the cell they must stay inside. */
  cellR: number;
  seatR: number;
  gap: number;
  homeAngle: number;
  seats: readonly SeatRequest[];
}): PersonSeat[] {
  const { centre, nodeR, cellR, seatR, gap, homeAngle, seats } = options;
  if (seats.length === 0) return [];
  const rings = ringsBetween(nodeR, cellR, seatR, gap);
  if (rings.length === 0) return [];

  const tHome = hexRingParam(homeAngle);
  const tAway = hexRingParam(homeAngle + Math.PI);

  const lead = seats.find((s) => s.kind === "lead") ?? null;
  const rest = seats.filter((s) => s !== lead);

  const out: PersonSeat[] = [];
  // Slots are anchored to the hexagon itself — slot j of a ring sits at
  // `j * span`, so the corners always carry one. People are then *chosen* from
  // that fixed grid, nearest the far side first, which is how the arrangement
  // can be both neat and still gathered where Greg asked for it.
  const slotAt = (t: number, span: number) => Math.round(t / span);

  let leadSlot = 0;
  if (lead) {
    const span = 6 / rings[0].slots;
    leadSlot = slotAt(tHome, span);
    out.push({
      ...lead, ring: 0, ...pointOnHexRing(centre, rings[0].r, leadSlot * span), r: seatR,
    });
  }

  let next = 0;
  for (let k = 0; k < rings.length && next < rest.length; k++) {
    const { r, slots } = rings[k];
    const span = 6 / slots;
    const from = slotAt(tAway, span);
    // Outward from the far side, alternating: 0, +1, −1, +2, −2…
    for (let i = 0; i < slots && next < rest.length; i++) {
      const step = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
      const j = ((from + step) % slots + slots) % slots;
      // The lead owns its slot, so nobody lands on top of it. Once a ring is
      // full enough to wrap all the way round, somebody does try.
      if (lead && k === 0 && j === ((leadSlot % slots) + slots) % slots) continue;
      out.push({ ...rest[next], ring: k, ...pointOnHexRing(centre, r, j * span), r: seatR });
      next++;
    }
  }
  return out;
}

/** How many people a cell can hold, given the node inside it. What the lab
 *  calls "realistically squeezed in". */
export function capacity(nodeR: number, cellR: number, seatR: number, gap: number): number {
  return ringsBetween(nodeR, cellR, seatR, gap).reduce((n, ring) => n + ring.slots, 0);
}
