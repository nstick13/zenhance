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

/** Below this only the company and its first rung are drawn at all. */
export const CULL_SCALE = REVEAL_BANDS.deepUnits[0];

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
