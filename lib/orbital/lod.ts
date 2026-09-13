/**
 * How much of itself the map shows at a given zoom (Greg, 2026-09-13/14).
 *
 * Detail arrives by *morphing*, not by switching on. Each figure below runs
 * continuously from 0 to 1 across a band of zoom, and the renderer reads it
 * every frame from the live camera, so nothing ever pops into existence.
 *
 * The ladder, from far to near:
 *
 *   < 1.0    units, their rings, and one pinned dot per unit — the lead, the
 *            person you'd talk to about this node
 *   1.0–1.75 the lead is joined by a torus: one thick arc standing where that
 *            unit's people will be, its length set by how many there are
 *   1.75+    the torus resolves into the people themselves, and each of them
 *            grows a capsule holding their whole board
 *   3.5+     the capsule resolves into individual work items you can point at
 *   5.5+     names are drawn on the map; below that they live in hover
 *
 * Each level is the one above it magnified rather than a different drawing,
 * which is what makes zooming feel like walking closer.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Hermite ease between two edges — flat at both ends, so a morph starts and
 *  finishes gently instead of snapping at the boundary. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Zoom bands, as [start, fullyShown]. */
export const REVEAL_BANDS = {
  deepUnits: [0.1, 0.2],
  /** Progress rings travel from chunky arcs out in the orbit to thin gauges
   *  on the circle — done before the torus arrives, so the two never fight
   *  over the same stretch of orbit. */
  ringSettle: [0.45, 0.95],
  lead: [0.4, 0.65],
  torus: [0.95, 1.3],
  people: [1.7, 2.1],
  workCapsule: [1.75, 2.15],
  workDots: [3.4, 4.0],
  labels: [5.3, 6.0],
} as const;

/** A node drawn smaller than this on screen isn't worth a draw call. Nothing
 *  reaches it while `drawnUnitRadius` is holding the floors below. */
export const UNIT_CULL_PX = 0.35;

/**
 * How big a unit actually draws at a given zoom.
 *
 * Northwind is 45,000 units across. Pulled back far enough to see it whole,
 * every node is a fraction of a pixel and the map reads as fog — Greg,
 * 2026-09-14: "the scale of the organisational nodes is far too small to be
 * seen meaningfully at any level of zoom". So a node claims a minimum size *on
 * screen*, and how much it claims depends on how central it is: the company
 * and its divisions hold a legible bubble however far out you pull, while the
 * deep teams sit as faint specks and swell toward their true size as you come
 * down to them.
 *
 * Two properties make this safe rather than a hack. A node never draws
 * *smaller* than it was laid out, so its people and their work can't come
 * adrift from it — the inflation only ever adds, and it melts away exactly
 * when the zoom stops needing it. And each rung's ceiling is held short of
 * both its neighbour and its own arc slot, so no amount of pulling back turns
 * the rings into a blot.
 *
 * The side effect is the one Greg asked for: while the floor is binding, a
 * node's screen size doesn't change as you zoom — the central ones "remain the
 * same absolute size as we zoomed in" — and it starts growing the moment its
 * real radius overtakes the floor.
 */
const SCREEN_FLOOR_PX = [30, 11, 8, 6, 4.4, 3.2, 2.4, 1.8, 1.4, 1.15, 1, 0.9];
const SCREEN_FLOOR_DEEPEST = 0.85;

export function screenFloorPx(depth: number): number {
  return SCREEN_FLOOR_PX[depth] ?? SCREEN_FLOOR_DEEPEST;
}

export function drawnUnitRadius(
  unit: { r: number; depth: number },
  scale: number,
  ceiling: number,
): number {
  const floor = screenFloorPx(unit.depth) / Math.max(scale, 1e-6);
  return Math.min(Math.max(unit.r, floor), Math.max(unit.r, ceiling));
}

/** How present a node looks. A speck held above the pixel floor shouldn't read
 *  as solidly as a bubble you could click, so the faintest ones sit back. */
export function unitPresence(drawnScreenPx: number): number {
  return 0.35 + 0.65 * smoothstep(1, 4, drawnScreenPx);
}

export type Reveal = {
  deepUnits: number;
  /** 0 = chunky arcs out in the orbit, 1 = thin gauges on the circle. */
  ringSettle: number;
  /** The pinned lead dot. */
  lead: number;
  /** The aggregate arc standing in for a unit's people. */
  torus: number;
  /** The people themselves. */
  people: number;
  /** One capsule per person, holding their whole board. */
  workCapsule: number;
  /** Individual, pointable work items. */
  workDots: number;
  /** Names drawn on the map rather than left to hover. */
  labels: number;
};

const band = (b: readonly [number, number], scale: number) => smoothstep(b[0], b[1], scale);

export function revealAt(scale: number): Reveal {
  const people = band(REVEAL_BANDS.people, scale);
  const dots = band(REVEAL_BANDS.workDots, scale);
  return {
    deepUnits: band(REVEAL_BANDS.deepUnits, scale),
    ringSettle: band(REVEAL_BANDS.ringSettle, scale),
    lead: band(REVEAL_BANDS.lead, scale),
    // The torus is a stand-in: it arrives, then gives way to the real people.
    torus: band(REVEAL_BANDS.torus, scale) * (1 - people),
    people,
    // Likewise the capsule gives way to the items inside it.
    workCapsule: band(REVEAL_BANDS.workCapsule, scale) * (1 - dots),
    workDots: dots,
    labels: band(REVEAL_BANDS.labels, scale),
  };
}

/** The rung of the ladder the viewer is on — for the HUD only. The drawing
 *  itself always uses the continuous figures. */
export type LodTier = "company" | "structure" | "teams" | "people" | "work";

export const LOD_LADDER: [LodTier, string][] = [
  ["company", "Company"],
  ["structure", "Structure"],
  ["teams", "Teams"],
  ["people", "People"],
  ["work", "Work"],
];

export function tierAt(reveal: Reveal): LodTier {
  if (reveal.workDots > 0.5) return "work";
  if (reveal.people > 0.5) return "people";
  if (reveal.torus > 0.3 || reveal.lead > 0.5) return "teams";
  if (reveal.deepUnits > 0.5) return "structure";
  return "company";
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
