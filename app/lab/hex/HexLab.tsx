"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity --
 * Two things a feel study does that a production component should not.
 *
 * `set-state-in-effect`: the camera re-fits when the company or the cell size
 * changes. That is a deliberate cascading render — the world has just been
 * swapped out from under the viewer and framing the new one is the point.
 *
 * `purity`: the panel reports how long the layout took, which means calling
 * `performance.now()` around it during render. Measuring the thing under study
 * is most of why this page exists.
 */

/**
 * `/lab/hex` — client half. A plain 2D canvas driven by the pure engines.
 *
 * **Deliberately not Konva.** Part of the point is to show the hex layout is
 * isolated: everything that moves comes out of `lib/map/camera/` unchanged, the
 * arrangement rules come out of `lib/map/layout/hex/arrange.ts`, and the
 * renderer between them is a few hundred lines of `ctx.arc`.
 *
 * No database, no auth, no persistence. A refresh puts everything back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyOverrides, buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { holdActions } from "./questions";
import { menuFor, type MenuAction } from "./menu";
import { applyHand, settle } from "./hand";
import { boundaryLoops, pushOut, type Loop } from "./loops";
import { layoutHex, nodeScale, type HexDensity, type HexScene } from "@/lib/map/layout/hex/scene";
import { neaten } from "@/lib/map/layout/hex/tidy";
import { TAPER_RUNGS, branchShape, deferBranch, type BranchShape } from "@/lib/map/layout/hex/defer";
import { routeAll } from "@/lib/map/layout/hex/route";
import { layoutCompany } from "@/lib/map/layout/complexity";
import type { OrbitalScene } from "@/lib/map/layout/layout";
import {
  allocateByTerritory,
  headings,
  relayBranch,
  restBranch,
  type HexDriver,
} from "@/lib/map/layout/hex/territory";
import { bubblesFor, groupZones, grow } from "@/lib/map/layout/hex/bubbles";
import { groundAt, holderOf } from "@/lib/map/layout/hex/ground";
import {
  branchOf,
  hoverGroup,
  outline,
  placeIsland,
} from "@/lib/map/layout/hex/arrange";
import {
  cellKey, cellToWorld, corners, cornersAt, hexDistance, neighbours, ring, worldToCell,
  type Cell, type Point,
} from "@/lib/map/layout/hex/coords";
import {
  cameraAbout, cameraProgress, clampScale, cullBox, easeOutCubic, fitCamera, minScaleFor,
  wheelZoom, type Camera, type Size,
} from "@/lib/map/camera/viewport";
import {
  drawnUnitRadius, isLandmark, smoothstep, unitLabelVisible,
} from "@/lib/map/camera/lod";
import {
  HEX_LADDER,
  cellPxOf,
  hexRevealAt,
  levelAt,
  placePresence,
  placeTaken,
  scaleForLevel,
  softeningAt,
  stepLevel,
  type HexLevel,
} from "@/lib/map/camera/hexLod";

export type LabOrg = OrgInput;

/** How long the hand must rest on a tile before a drop over it means merge
 *  rather than reparent. The orbital map's own dwell, and for the same reason:
 *  a pass must not arm anything. */
const HOLD_MS = 550;

/** The master centre. A company grown from nothing starts here. */
const ORIGIN: Cell = { q: 0, r: 0 };

/**
 * Invented, per the house rule that demo mode uses invented data only. These
 * are suggestions in the wizard, never anything the map fills in by itself: a
 * node that nobody has described stays undescribed and says so.
 */
const SAMPLE_NAMES = ["Ana Whitfield", "Marcus Reyn", "Priya Solanki", "Tom Okafor", "Lena Brandt"];
const ROLES = [
  "Engineer", "Designer", "Product manager", "Delivery lead",
  "Analyst", "Quality engineer", "Architect",
];
const PLACE_NAMES = ["Checkout", "Onboarding", "Payments", "Search", "Mobile", "Customer Portal"];
const PURPOSES = [
  "Builds and runs a product",
  "Keeps a platform standing",
  "Serves customers directly",
  "Holds several teams together",
];

/**
 * The second pick-up — Greg's "radiating" gesture, 2026-10-02.
 *
 * *"When a user first moves the group of nodes, the rearrange shouldn't happen
 * — the block should move as-is, since this is predictable. If a user then
 * picks up the governing node of that block within, say, 30s, and moves it
 * within the nearest 4x4 grid of hexagons, then the rearrange function should
 * kick in and tree the thing away from the grandparented origin."*
 *
 * So a first drop never rearranges anything: what you built is what lands. Put
 * the branch down, pick its governing node straight back up, and set it down
 * nearby, and *that* second gesture means "now tree yourself" — the branch
 * lays itself out radiating away from its own parent, so the chain home runs
 * clear. There is no dialog, because the gesture is the consent.
 *
 * **Shortened to five seconds on 2026-10-03** — *"where a user moves the same
 * parental node again within a short period (5 seconds, I think)"* — and the
 * distance gate removed with it. The gesture is now purely "pick it straight
 * back up", wherever you then put it down, which is simpler to explain and
 * simpler to perform. What it does on release also changed: it is now a tidy
 * up, laying the branch out by the same rules the company uses on load, rather
 * than only treeing it away from its parent.
 */
const RADIATE_WINDOW_MS = 5_000;

/**
 * **How long it takes to travel between two rungs of the zoom ladder.**
 *
 * Long enough to see where you went — the whole value of a named jump is that
 * you keep your bearings, and a cut does not give you that — and short enough
 * that pressing it twice in a row does not feel like waiting. `CAMERA_MS` in
 * the camera engine is 560, which is right for flying across a company and too
 * slow for stepping one rung.
 */
const LEVEL_TRAVEL_MS = 420;

/** How faint a connection line goes where it passes behind somebody's tile.
 *  Faint enough to read as *behind* rather than *through*, strong enough that
 *  the eye can still follow it out the far side. */
const BEHIND_ALPHA = 0.18;

/**
 * **When the people appear is no longer kept here.** It was the first thing on
 * this map measured in cell-pixels rather than world scale — Greg, 2026-10-02,
 * asking for people sooner — and on 2026-11-06 it became the first rung of a
 * whole ladder measured that way. It now lives with the rest of it, as
 * `PEOPLE_AT_CELL_PX` in `lib/map/camera/hexLod.ts`, with his words attached.
 */

/**
 * **How much of a corner comes off a node's hexagon.** Greg asked for a
 * quarter on 2026-11-05 — *"round the edges of all hexagons to, say, 25% of
 * the length of the vertex"* — looked at it on the map and took it to **half**
 * the same day, which is where it has stayed.
 *
 * A regular hexagon's side is exactly its circumradius, so this is also a
 * straight fraction of the radius each node is drawn at — which means the
 * corner stays the same share of the edge at every rung, as the nodes change
 * size by depth, instead of looking blunter the smaller a node gets.
 *
 * It is the radius of the circle tucked into the corner, and that circle
 * meets each edge `r / tan(60°)` back from the point. **The useful range is
 * 0 to 0.866**: at nothing it is the bare hexagon, at a half about 42% of
 * every edge is still dead straight, and at 0.866 the tangent points meet at
 * the edge midpoints and the tile has become its own inscribed circle. So
 * this one number is the whole dial between hexagon and circle.
 *
 *
 * **Nearly everything that is a hexagon on this map takes it** — an active
 * tile one at a time, an area along the boundary of its union (see
 * `unionLoops` and `pathOfLoops`, which is how an area rounds without its
 * tiles cleaving at every seam). The three cells a gesture draws, in
 * `hexPath`, are the last square corners left.
 *
 * **Three things now read it differently rather than take it**, and all three
 * are this dial turned up rather than a second way of rounding. A *human*'s
 * mark takes `PERSON_CORNER`, which is the dial at its top and therefore a
 * circle; the *tile a human stands on* takes `PERSON_TILE_CORNER`, two
 * thirds; and an *area* boundary is multiplied by `softeningAt` below 18px a
 * cell, so a team's ground goes smooth as you pull back. The first two are
 * Greg, 2026-11-07, and they are **people only** — a place keeps the half,
 * which is what tells the two apart at a glance.
 */
const NODE_CORNER = 0.5;

/**
 * **The clear ground every active hexagon keeps to itself.** Greg,
 * 2026-11-06: *"make active hexagons (and proportionally everything within
 * them) a wee bit smaller so that they would always have a few pixels of
 * space between each other."*
 *
 * Three numbers for one idea, because the idea has a floor and a ceiling. The
 * **share** is the look — a tile is this much smaller than its cell at every
 * zoom, so the mosaic keeps its proportions as the camera moves. The
 * **pixels** are the promise: a share of a 15px cell at overview is not a few
 * pixels of space, it is none, so the gap is never allowed below this on the
 * glass. The **ceiling** is the other end of the same promise — at a far
 * enough zoom-out that floor would eat the tile, so it stops here.
 */
const ACTIVE_GAP = 0.04;
const ACTIVE_GAP_PX = 3;
const ACTIVE_GAP_MAX = 0.12;

/**
 * **How much smaller a human is drawn than the cell it stands in.** Greg,
 * 2026-11-07, after driving the zoom ladder: *"as the zoom reveals the humans
 * at around 0.05x zoom, my feeling is the map quickly becomes too crowded. We
 * need to give the hexagons the appearance of having more whitespace … human
 * nodes need to be smaller. The central hexagon should be half the current
 * size, nested within the outer hexagon that should be perhaps 80% its
 * current size."*
 *
 * **Two hexagons, two numbers, and the cell itself does not move.** The
 * *central* one is the mark that says a person is here (`nodePath`); the
 * *outer* one is the white translucent host (`washPath`). Both shrink inside
 * a cell that stays exactly where the lattice put it, so this is a drawing
 * change and not a layout one — nothing re-lays, no law is touched, and a cell
 * is still one unit's (Law 1).
 *
 * **Only a human.** A structural node keeps its full size, which widens the
 * gap between a place and a person rather than scaling everything down
 * together — and that is the point, because the crowding Greg is describing is
 * the people. It is also the first half of his own idea for the other
 * direction: *"we can make team head nodes … appear to be bigger because we
 * can offset backgrounds around them."*
 *
 * The outer one is taken off the cell **after** `activeInset`, so the promise
 * that two active hexagons never touch — and never come within a few pixels of
 * each other on the glass — only gets easier to keep.
 */
const PERSON_MARK = 0.5;
const PERSON_TILE = 0.8;

/**
 * **A person's host cell is white glass, not a second coloured node.**
 *
 * Greg, 2026-11-07: the opaque coloured host cell disappeared into the ground
 * behind it. The replacement is white and fifteen per cent transparent —
 * eighty-five per cent opacity — while the person itself carries the exact
 * colour of its organisational parent.
 */
const PERSON_TILE_OPACITY = 0.85;

/**
 * **A human is drawn as a circle.** Greg, 2026-11-07, on the half-size marks:
 * *"they're now nestled far enough inside their host hexagons that we could
 * dial up the border radius so that they appear circular. This would not be
 * true for parent nodes, or anything that wasn't a human node (for now)."*
 *
 * `√3/2` is not an approximation of a circle — it is the exact top of
 * `NODE_CORNER`'s range, where each corner's circle reaches the midpoint of
 * both its edges, every straight edge is used up, and a rounded hexagon *is*
 * its own inscribed circle. So this is the same dial at its limit rather than
 * a second way of drawing a person, which matters: the mark stays concentric
 * with its cell, keeps the clear ground `ACTIVE_GAP` promises it, and shrinks
 * and grows with everything else.
 *
 * **It makes the two kinds of thing tell themselves apart by shape, not only
 * by size.** A place is a hexagon and holds the lattice's own geometry; a
 * person is a circle and reads as a body standing on it. Until today the only
 * difference was the dark border a structural node wears.
 *
 * The circle's radius is `√3/2` of the hexagon's, so a person reads a little
 * smaller again than `PERSON_MARK` alone would suggest.
 */
const PERSON_CORNER = Math.sqrt(3) / 2;

/**
 * **And the hexagon a human stands on is softer than a place's.** Greg,
 * 2026-11-07: *"let's give the host hexagons a bit more rounding, but not so
 * that the thing appears as a circle. I think border radius is half the
 * hexagon radius, let's make it ⅔?"* — and, asked whether he meant every
 * hexagon or only the ones hosting people, **only the ones hosting people**.
 *
 * At two thirds the corner's circle meets each edge 38.5% of the way back
 * from its end, so **23% of every edge is still dead straight**: soft, and
 * still visibly six-sided, which is what *"not … a circle"* asks for. It is
 * 77% of the way along `NODE_CORNER`'s range rather than at the end of it,
 * where `PERSON_CORNER` sits.
 *
 * So a person is now three things nested, each a turn further round the same
 * dial: a **circle** for the body, a **two-thirds hexagon** for the tile it
 * stands on, and the **half**-rounded ground of whatever place holds them.
 */
const PERSON_TILE_CORNER = 2 / 3;

/**
 * **How big a node is, in cell radii, by what kind of thing it is.** Greg,
 * 2026-11-07, after seeing the first attempt and sharpening it: *"nodes that
 * aren't master-centre or a human or a team-level node should consume their
 * entire cell plus half a radius in addition … a fixed size regardless of the
 * node. 'Fill the container' meant expand until it touched the first border,
 * not grow in proportion to the container size."* And: *"master centre should
 * be 3x the radius of its host cell."*
 *
 * So four flat numbers and no arithmetic about regions at all:
 *
 * | | radius |
 * | --- | --- |
 * | a person | the old floor, halved, as a circle (`PERSON_MARK`) |
 * | a team | its cell, less the clear ground every active hexagon keeps |
 * | a place above a team | `PLACE_SPAN` — the cell and half a radius more |
 * | the master centre | `MASTER_SPAN` — three cell radii |
 *
 * **The last two overflow the lattice on purpose**, so neither takes
 * `activeShrink`: the clear-ground promise is about tiles that must not touch,
 * and these are meant to. Three radii is nearly two cells' worth of reach
 * (`√3 ≈ 1.73` radii to a neighbour's centre), so the master centre covers the
 * ring around it and some of the one beyond.
 *
 * Growing a place *in proportion to its own region* was the first reading of
 * this and it is gone — it made every rung's node a different size, which is
 * the `nodeScale` grading this replaced, wearing different clothes.
 */
const PLACE_SPAN = 1.5;
const MASTER_SPAN = 3;

/**
 * The rendered radius of a structural node in cell radii. Kept outside the
 * painter because area geometry has to answer the same question: a bubble
 * must wrap the mark people can see, not the smaller host cell it replaced.
 */
function structuralNodeSpan(
  id: string,
  rootId: string,
  people: ReadonlySet<string>,
  tiers: ReadonlyMap<string, number> | undefined,
): number {
  if (people.has(id)) return 0;
  if (id === rootId) return MASTER_SPAN;
  return (tiers?.get(id) ?? 0) >= 1 ? PLACE_SPAN : 1;
}

/**
 * **How heavy a connection line is**, as a fraction of a cell's radius, before
 * the per-rung grading that keeps a trunk heavier than a twig.
 *
 * Halved on 2026-11-07, with the human tiles: Greg, *"let's make the
 * connection lines between people and their parent half the thickness too,
 * which may also scale all other connection lines."* It does scale them all,
 * which is his *"may"* taken as permission rather than as a side effect — a
 * person's line halving while the trunk above it held would turn the trunk
 * into the loudest thing on the map, and the weights are a hierarchy, not four
 * separate decisions.
 *
 * `LEAD_WEIGHT` is the darker line from a team lead to their place, and it
 * halves with the rest for the same reason.
 */
const CHAIN_WEIGHT = 0.135;
const LEAD_WEIGHT = 0.05;

/**
 * **How wide a chain swings through its knees, by how long the chain is.**
 * Greg, 2026-11-06: *"short connection lines — say branching between two
 * nodes that are 1-3 hexagons, or 2-6 radii, apart — should have the radius
 * equal to one hexagon. Any connection line longer than that but shorter than
 * say 12 hexagon-widths should be 2 radii of knee curvature. Anything above
 * that should have a knee bend of 6 radii."*
 *
 * Everything here is in **cell radii**, which is also Greg's unit: a hexagon
 * is two of them across. The thresholds are his — 6 radii and 24 — and so is
 * the ladder, 1 → 2 → 6.
 *
 * The thought behind it is that a curve should be in proportion to the
 * journey. A hop to the person next door has no room for a sweep and should
 * not pretend to; a line crossing half a company reads as one gesture if it
 * banks rather than turns, and as plumbing if it does not.
 *
 * **Measured along the line, not across it.** A chain that goes round a
 * crowd is a long line however near its two ends are, and it is the line we
 * are drawing. It is also one number per chain rather than per corner, so a
 * chain that is broken into runs where it passes behind somebody still bends
 * the same way all the way along.
 */
/**
 * **A coloured ground is atmosphere, not another solid node.**
 *
 * Its colour comes from the structural node that owns it, and the alpha is
 * real: ten per cent colour over whatever lies beneath.
 */
const REGION_FILL_OPACITY = 0.10;
const REGION_EDGE_OPACITY = 0.18;
const TEAM_EDGE_DARKER = 0.10;

/** A team's colour is a quiet place once its people are visible, then moves
 * closer to the owning node's colour as their tiles fade.
 *
 * Greg, 2026-11-08, on the 66% first try: the ground *"washes out the
 * connection lines between people in that team ... especially if they're
 * further from the parental node"*. A chain is the child's own hue, and the
 * further out it runs the paler that hue is, so a strong ground eats the
 * faintest lines first — exactly the ones that say who reports to whom at the
 * edge of a team. Taken to a half the same day and then to **30%**, which is
 * where it settled: enough colour to say which team you are standing in,
 * little enough that every chain inside it still reads. The far end is
 * untouched at 90% — by then the people and their lines have faded and the
 * colour is all that is left to carry the team. */
const TEAM_GROUND_OPACITY_NEAR = 0.30;
const TEAM_GROUND_OPACITY_FAR = 0.90;

/** The outer group zone is retained in the geometry but deliberately not
 * painted while the layer stack is being simplified. */
const SHOW_OUTERMOST_ZONE = false;

/**
 * **How far a team's ground stands clear of the cells it holds.** Greg,
 * 2026-11-06: *"that outline (and by definition the fill within it) needs to
 * be offset outwards a little — show me what it looks like if we offset it by
 * half of one hexagon radius."* Greg settled it back at a quarter on
 * 2026-11-07 after seeing the corrected single family boundary.
 */
const TEAM_SPREAD = 0.25;

const KNEE_BY_LENGTH: readonly { within: number; radii: number }[] = [
  { within: 6, radii: 1 },
  { within: 24, radii: 2 },
  { within: Infinity, radii: 6 },
];

/**
 * **Corner-rounding, written once for both things that take a path.**
 *
 * `CanvasPath` is the slice of the drawing API that a `Path2D` and a canvas
 * context both implement, so an area's shape can be *built* into a reusable
 * `Path2D` once and a hover outline *drawn* straight onto the context, with
 * one piece of geometry between them.
 *
 * Walking the edge **midpoints** and letting `arcTo` cut each corner is what
 * keeps it honest: `arcTo` runs a line to where the corner's circle first
 * touches the edge and then the arc, so the straight part of every edge is
 * whatever the rounding leaves rather than a number anybody guessed. A
 * midpoint is always at least the tangent distance from the corner while the
 * radius stays under `0.866` of an edge, so the path cannot overshoot itself.
 *
 * It rounds whichever way the path turns, which is the whole point for an
 * area: a corner that bites *into* a shape gets the same treatment as one that
 * sticks out.
 */
function traceRounded(path: CanvasPath, loop: Loop, r: number, inward = r) {
  const pts = loop.points;
  const n = pts.length;
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  if (!loop.closed) {
    // An open run keeps its ends where they are and rounds only what is
    // actually a corner — closing it would invent an edge.
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) path.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r);
    path.lineTo(pts[n - 1].x, pts[n - 1].y);
    return;
  }
  const start = mid(pts[n - 1], pts[0]);
  path.moveTo(start.x, start.y);
  let from = start;
  for (let i = 0; i < n; i++) {
    const next = mid(pts[i], pts[(i + 1) % n]);
    /**
     * **Each corner takes what its own two half-edges can pay for.**
     *
     * Walking midpoints gives every corner half of each edge beside it, and
     * the tangent point sits `r / tan(θ/2)` back from the corner — so the
     * radius a corner can afford is `half-edge · tan(θ/2)`, which on a plain
     * hexagon works out at the documented `0.866` of an edge and never binds.
     * It binds once a shape is *offset*: pushing a boundary outward shortens
     * the edges inside a notch, and an unclamped radius would then put the
     * tangent point past the midpoint and fold the path back on itself.
     */
    const ax = from.x - pts[i].x, ay = from.y - pts[i].y;
    const bx = next.x - pts[i].x, by = next.y - pts[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la > 1e-9 && lb > 1e-9) {
      /**
       * **Which way the corner bends, so the two can be rounded differently.**
       *
       * The material lies to the left of travel (see `pushOut`), so a corner
       * that sticks *out* of the shape turns toward it — a left turn, and a
       * positive cross product. `inward` is for the other sort, the notch
       * where two tiles meet, and it defaults to `r` so every caller that
       * wants one radius keeps getting exactly what it had.
       */
      const want = ax * by - ay * bx < 0 ? r : inward;
      const theta = Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb))));
      path.arcTo(pts[i].x, pts[i].y, next.x, next.y, Math.min(want, Math.min(la, lb) * Math.tan(theta / 2)));
    }
    from = next;
  }
  path.closePath();
}

/**
 * **An area as one rounded shape, not as rounded tiles.**
 *
 * Greg, 2026-11-05, on the area hexagons: *"where an area tile joins another,
 * we get a concave angle between the two touching hexagons … we need that to
 * appear rounded, rather than it to cleave as the two rounded hexagons
 * touch."*
 *
 * Which is why nothing here rounds a tile. Every area on this map is a *set*
 * of cells that the browser has been unioning for us — each one drawn as a
 * sharp hexagon into a `Path2D`, with the seams disappearing because the fill
 * covers them. Round those hexagons individually and the seams stop
 * disappearing: each pair of neighbours meets at two cusps, and an area turns
 * into a run of beads.
 *
 * So the rounding is applied to the **boundary of the union** instead — the
 * edges with nothing of the area's own on the other side. Convex corners round
 * outward, the reflex ones where two tiles meet round inward, and the shape
 * reads as one piece of ground with soft edges, which is what an area was
 * always pretending to be.
 *
 * `evenodd`, wherever this is filled: an area with a hole in it — a team's
 * collar of clear ground, say — comes back as two rings, and the inner one has
 * to punch the middle out rather than fill it in.
 */
/**
 * **An area, optionally standing `outward` clear of the cells it holds.**
 *
 * Greg, 2026-11-06: *"if the current corner rounding radius is equal to half
 * a hexagon radius, then if we offset the line by +0.25 hexagon radii, the
 * new convex corner radius should be 3/4 hexagon radius. Concave radii should
 * remain unchanged."*
 *
 * Which is what a shape *does* when it is pushed outward: the corners that
 * stick out are swept round a circle that much bigger, because every point on
 * them has moved `outward` further from the same centre. A notch does the
 * opposite by the same arithmetic — its radius would shrink — and Greg's call
 * is to leave those alone, so a team keeps the same soft bite between its
 * tiles however far its ground stands off them.
 */
/**
 * **The expensive half, and the one the zoom does not change.**
 *
 * These two were one function until 2026-11-06, when Greg asked for a
 * boundary that softens as you pull back — which means the same set of cells
 * has to be traced again at a new radius while the camera is moving. Finding
 * the boundary is the costly part (`outline` walks every cell, and on the
 * thousand-person company that is 37,000 of them) and it does not depend on
 * the radius at all. So the walk is memoised on the arrangement and only the
 * tracing is redone, which is a few hundred `arcTo` calls.
 */
function unionLoops(cells: readonly Cell[], size: number, outward = 0): Loop[] {
  if (!cells.length) return [];
  const loops = boundaryLoops(outline(cells, size), size);
  return outward > 0 ? loops.map((loop) => pushOut(loop, outward)) : loops;
}

/**
 * **Those loops as one path**, at whatever corner the zoom asks for. `soften`
 * multiplies the radius; 1 is the radius every area on this map is defined
 * with, and the ramp above it is `softeningAt`.
 *
 * Each corner is still clamped to what its own two half-edges can pay for —
 * see `traceRounded` — so a radius far past what a hexagon can take does not
 * fold the path back on itself. It simply runs out of straight edge, which is
 * exactly the smooth boundary the far end of the ramp is after.
 */
function pathOfLoops(
  loops: readonly Loop[],
  size: number,
  outward = 0,
  soften = 1,
): Path2D | null {
  if (typeof Path2D === "undefined" || !loops.length) return null;
  const path = new Path2D();
  const corner = size * NODE_CORNER * soften;
  for (const loop of loops) traceRounded(path, loop, corner + outward, corner);
  return path;
}

/**
 * The same rounded hexagon as a path string, for the one place that is drawn
 * in SVG rather than on the canvas. The canvas uses `arcTo`, which takes the
 * corner and the radius and works the tangents out itself; there is no such
 * primitive in a path `d`, so the tangent points are worked out here. Both
 * describe the same thing — a circle of radius `r` tucked into the corner,
 * touching both edges — so the two renderings agree by construction.
 */
function roundedHexD(pts: Point[], radius: number): string {
  const n = pts.length;
  // Distance from the point back to where the circle meets the edge. The
  // interior angle of a regular hexagon is 120°, so this is r / tan(60°).
  const back = radius / Math.sqrt(3);
  const along = (from: Point, to: Point, by: number): Point => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: from.x + (dx / len) * by, y: from.y + (dy / len) * by };
  };
  const at = (i: number) => pts[(i + n) % n];
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const inTo = along(at(i), at(i - 1), back);  // where the arc starts
    const outOf = along(at(i), at(i + 1), back); // where it leaves
    parts.push(`${i === 0 ? "M" : "L"} ${inTo.x.toFixed(2)} ${inTo.y.toFixed(2)}`);
    // Corners come off `cornersAt` anticlockwise in maths, which is clockwise
    // on a screen whose y grows downward — hence the sweep flag.
    parts.push(`A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${outOf.x.toFixed(2)} ${outOf.y.toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/**
 * **The seed, and why it is a hexagon.** The first press on blank paper is the
 * only thing on this page that is not a cell, and until now it was a circle —
 * ported straight from the orbital grow study, where everything is round. On a
 * lattice that reads as some other kind of object arriving. What it actually
 * is is the first cell: the thing you are about to make, in the shape it will
 * be the moment you press it.
 *
 * Flat-top, taken from the engine's own `cornersAt` rather than written out as
 * a path, so the invitation cannot drift out of orientation if the lattice
 * ever turns. `SEED_R` is a circumradius: it makes a hexagon about as tall as
 * the 148px circle it replaced, which is a little wider, because a hexagon of
 * the same width reads lighter than the circle round it.
 */
const SEED_R = 86;
/**
 * How far the breath pushes past the resting edge. The circle's pulse was a
 * 16px `box-shadow` spread on a 74px radius — 1.22× — and the same ratio on a
 * hexagon loses the reading at the flats, where the edge is nearest the
 * middle, so this pushes a little further.
 */
const SEED_BEAT = 1.3;
/** The square the hexagon and its breath are drawn in, centred on (0, 0). */
const SEED_BOX = Math.ceil(2 * SEED_R * SEED_BEAT);
const SEED_CORNERS = cornersAt({ x: 0, y: 0 }, SEED_R);
/**
 * The hexagon, in the drawing's own units — and rounded by the same
 * `NODE_CORNER` as a node, because that is what it is about to become. Press
 * it and the dashed seed turns into the person's own tile in the same place
 * and nearly the same size; square corners here would make that a swap rather
 * than the one thing becoming the other.
 */
const SEED_D = roundedHexD(SEED_CORNERS, SEED_R * NODE_CORNER);
/**
 * The same hexagon as a `clip-path`, so **the hit area is the shape**. The
 * breath needs room to grow into, which means the button's box is half again
 * as big as the hexagon in it; a square button would take presses from blank
 * paper well outside the invitation, and on this page that is a click doing
 * something other than what it looks like it will.
 */
const SEED_CLIP = SEED_CORNERS
  .map((c) => `${(50 + (100 * c.x) / SEED_BOX).toFixed(2)}% ${(50 + (100 * c.y) / SEED_BOX).toFixed(2)}%`)
  .join(", ");


/**
 * **How far the hand may drift and still be holding — in pixels of screen.**
 *
 * Without a budget at all the clock ran from the moment the pointer entered a
 * tile and kept running while the hand was still moving, so dragging a branch
 * slowly across the map armed a merge on whatever it happened to be over —
 * Greg, 2026-10-01: *"pulling a family far away results in the reparent dialog
 * appearing."* The orbital map learned the same lesson on 2026-09-23. **A
 * dwell is a hold**: travel restarts the clock.
 *
 * **It was a share of a cell until 2026-10-30, and that was the bug.** A cell
 * is a distance in the world, and the world shrinks as you zoom out, so the
 * budget shrank with it while the hand kept wobbling in pixels. A quarter of a
 * cell is 27 px of allowance on Sparrow Jam at 0.30× and **0.9 px** on the
 * 1,000-person company at the 0.01× it opens on — less than one pixel, for
 * 550 ms, while dragging. The hold then never completed: the neck animation
 * fired, because that is drawn the moment the pointer is over somebody, and
 * the dialog never came, because the clock had restarted on the last twitch.
 * Greg found it on the 1,000-person company: *"I could only reparent to Quartz
 * Team 50 — while the animation fired, the dialog offering reparent did not."*
 * Whether it worked was luck, which is why it looked like *"only fires once"*.
 *
 * Measured in the browser with the handler instrumented: a 40 px wobble at
 * 0.30× put 267 world units against a 91-unit budget and reset the clock to
 * 71 ms on every move.
 *
 * Six times `MOVE_SLOP_PX`, deliberately: the travel that means *this is a
 * gesture rather than a click* is 4 px, and a hold tolerates six times that
 * before it counts as the hand moving on. Both are now read in the same units
 * as the hand that makes them.
 */
export const HOLD_SLACK_PX = 24;

/**
 * **Who the hold is about, once it is about somebody.**
 *
 * The question *what am I holding over* is answered by the cell under the
 * pointer, and a cell is a distance in the world: at the 0.01–0.02× a whole
 * company is seen at, it is **fifteen pixels across**. So a hand that wobbles
 * three or four pixels keeps stepping off the target onto the empty ground
 * beside it, `heldOver` goes back to null, and whether the dialog appears
 * comes down to which cell the pointer happened to be in at the instant it was
 * released. Caught in the browser on the 1,000-person company, 2026-10-30:
 * two moves before the release had Union Team 82 held, and the release itself
 * had `heldOver: null`.
 *
 * That is the other half of Greg's *"while the animation fired, the dialog
 * offering reparent did not"* — and of why it seemed to work once and then
 * never again. It was never *once*; it was a coin toss at every release.
 *
 * So: **empty ground beside the thing you are holding over does not end the
 * hold.** Another unit does, because you are now asking about that one, and so
 * does travelling further than `HOLD_SLACK_PX`, which is already what *the
 * hand has moved on* means. Nothing here weakens the dwell — the clock is
 * untouched — it only stops the subject flickering under a steady hand.
 */
export function heldSubject(
  current: string | null,
  under: string | null,
  stillHolding: boolean,
): string | null {
  if (under) return under;
  return stillHolding ? current : null;
}

/**
 * **How far the hand must travel before a press is a drag or a pan**, in
 * screen pixels. Greg, 2026-10-20, agreeing to it and leaving the number here:
 * *"a press must move before it counts as a drag or a pan."*
 *
 * It is what makes a **click** a thing of its own on this map, which the
 * double-click gesture needs: until now a pointer going down on a node picked
 * the node up there and then, so every tap was a one-pixel drag that had to
 * find somewhere for the whole branch to land. On a map with placements all
 * over it there often is nowhere, and the release then said *"your tile can't
 * fit here right now"* about a gesture nobody made — the standing fault this
 * closes for free.
 *
 * Four pixels is the usual slop for this (it is what a browser's own `click`
 * allows between `pointerdown` and `pointerup`), and it is short enough that
 * a deliberate drag still starts under the finger.
 */
const MOVE_SLOP_PX = 4;

/** How many steps back the page keeps. Greg, 2026-10-20: *"about ten steps of
 *  history — or five if it turns out to be heavy."* Each step is six
 *  references to state that was being replaced anyway, so ten is not heavy. */
const UNDO_DEPTH = 10;

/**
 * **What a double-click opened, and where.**
 *
 * Greg, 2026-10-20: *"The gesture will eventually bring up a short menu, hold
 * the location as highlighted, and potentially provide wider options via a
 * menu elsewhere."* So the menu is short, it opens at the point of action, and
 * the cell it is about stays lit while it is open — `cell` is both of those at
 * once.
 */
type Menu = {
  /** Where to draw it, in pixels inside the canvas. */
  at: { x: number; y: number };
  /** The cell the gesture was about: lit while the menu is open, and where
   *  anything made here lands. */
  cell: Cell;
} & (
  | {
      kind: "make";
      /** Whose ground it is, or null on open paper. */
      holder: string | null;
      ring: 1 | 2 | null;
    }
  | { kind: "node"; unitId: string }
);

/** Everything a hand can do to this page, in one object. */
type Snapshot = {
  moves: Map<string, Cell>;
  reparents: Map<string, string>;
  pinned: Set<string>;
  merges: Map<string, string>;
  born: Born[];
  removed: Set<string>;
  renames: Map<string, string>;
  tidyStage: number;
};

/**
 * Colour, by Greg's rule of 2026-09-30: **hue says which part of the company,
 * lightness says how deep.** *"Deep/dark red is 'CFO'; lightest wash purple is
 * 'marketing interns'."*
 *
 * The lightness range is relative to how many rungs the company actually has —
 * *"a 2-layer company does not have an almost-black executive and several
 * #fefefe-wash child nodes; they'd both sit at just-distinguishable shades."*
 *
 * Hue comes from the region today. It should come from function or discipline
 * once a unit carries one; `people.disciplineId` exists, units have nothing.
 */
/**
 * Hues, generated rather than listed (Greg, 2026-10-03).
 *
 * *"There shouldn't be a limit on number of base colours to be using — we can
 * push this up to say 100."* Twelve hand-picked hues was a ceiling, and on a
 * company of 2,957 cells it showed.
 *
 * Stepping by the golden angle walks the whole rainbow and never puts two
 * consecutive entries near each other, at any count — so a hundred regions are
 * as distinguishable as a dozen, without a table to maintain.
 */
const GOLDEN_ANGLE = 137.508;
const hueAt = (index: number): number => (index * GOLDEN_ANGLE) % 360;

/**
 * How far a team's hue may drift from its division's.
 *
 * Territory, not confetti: a division owns a *family* of hues, and its teams
 * are shades within it. So an archipelago reads as one place from far away and
 * still resolves into separate islands close up — which is the whole point of
 * separating them in the first place.
 */
const TEAM_HUE_SPREAD = 26;

/** Darkest at the top of the company, lightening with depth. The span is the
 *  part that scales: two rungs get two adjacent shades, twelve get the lot. */
function toneOf(depth: number, maxDepth: number): { l: number; s: number } {
  const span = Math.min(0.44, 0.09 + maxDepth * 0.035);
  const t = maxDepth <= 0 ? 0 : Math.min(1, depth / maxDepth);
  return { l: 0.34 + t * span, s: 0.52 - t * 0.18 };
}

const css = (hue: number, depth: number, maxDepth: number, alpha = 1) => {
  const { l, s } = toneOf(depth, maxDepth);
  return `hsla(${hue}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(0)}%, ${alpha})`;
};

/**
 * Which ancestor a unit takes its hue from.
 *
 * Not "child of the root": a real company's top is usually a chain, and this
 * fixture's root has one child, so colouring by it painted 395 units one blue.
 * Not a fixed minimum either — "at least six" gave a thirteen-unit company nine
 * regions, which is a different hue for almost every tile and says nothing.
 *
 * So the target scales with the company: about the square root of its units,
 * never more than the palette holds. Thirteen units want four regions; four
 * hundred want twelve. Then take the rung whose population is nearest that.
 */
const MAX_REGIONS = 12;
function regionOf(units: { id: string; parentId: string | null; depth: number }[]): Map<string, string> {
  const byDepth = new Map<number, number>();
  for (const u of units) byDepth.set(u.depth, (byDepth.get(u.depth) ?? 0) + 1);
  const deepest = units.reduce((m, u) => Math.max(m, u.depth), 0);
  const target = Math.max(2, Math.min(MAX_REGIONS, Math.round(Math.sqrt(units.length))));
  let regionDepth = 1;
  let best = Infinity;
  for (let d = 1; d <= deepest; d++) {
    const n = byDepth.get(d) ?? 0;
    if (n < 2) continue;
    // Prefer the rung nearest the target, and the shallower one on a tie — a
    // division you can name beats a rung of teams you cannot.
    const distance = Math.abs(n - target) + (n > MAX_REGIONS ? 100 : 0);
    if (distance < best) { best = distance; regionDepth = d; }
  }

  const parentOf = new Map(units.map((u) => [u.id, u.parentId] as const));
  const depthOf = new Map(units.map((u) => [u.id, u.depth] as const));
  const out = new Map<string, string>();
  for (const u of units) {
    let id: string | null = u.id;
    while (id && (depthOf.get(id) ?? 0) > regionDepth) id = parentOf.get(id) ?? null;
    if (id) out.set(u.id, id);
  }
  return out;
}

type Pending =
  /** `cells` is where the branch would land, or null when there is nowhere for
   *  it to go — which does not stop the question being asked. */
  | { kind: "merge"; unitId: string; withUnitId: string; cells: Map<string, Cell> | null }
  | { kind: "blocked"; unitId: string; occupiedBy: string; cells: Map<string, Cell> | null }
  | { kind: "reshape"; unitId: string; cells: Map<string, Cell> }
  /** Taking a node off the map, and everything under it with it. */
  | { kind: "remove"; unitId: string; count: number };

/**
 * **A node somebody made, rather than one the fixture came with.**
 *
 * Greg, 2026-10-19, on bringing the grow study into hex: *"people are going to
 * want to create things wherever they want, then tidy them up using assists
 * later… while we develop Grow, let's be unconstrained by the layout engine
 * for mega-scale stuff."*
 *
 * The mechanism for that is this: **everything born here is born as a hand
 * placement.** Its cell goes straight into `moves` and its id into `pinned`,
 * which puts it under Law 0 — *the hand outranks the engine* — where no driver
 * has standing to move it. So no law has to be suspended for the Grow path;
 * the engine simply never gets a say about a node it did not place.
 *
 * `kind` is what the lattice needs to know: a **person** is a human and may
 * only touch their own team, a **place** is a team or anything above one.
 * Nothing here is a seat: this lab has people as units, which is the model
 * Greg chose on 2026-10-02 to avoid *"one mode to view people, one to view the
 * org."*
 */
export type Born = {
  id: string;
  kind: "person" | "place";
  /** Null until somebody says. A node breathes until it is *described*. */
  name: string | null;
  /** A person's role. */
  role: string | null;
  /** A place's purpose. Prose — it never reaches the map, only the panel. */
  purpose: string | null;
  parentId: string | null;
};

/** What a node is still waiting to be told, or null when it is complete. */
export function stillNeeds(node: Born): string | null {
  if (!node.name?.trim()) return "Needs a name";
  if (node.kind === "person" && !node.role?.trim()) return "Needs a role";
  if (node.kind === "place" && !node.purpose?.trim()) return "Needs a purpose";
  return null;
}

/**
 * **The five settings Greg settled on 2026-11-06**, which used to be five rows
 * of buttons on the panel:
 *
 * > *"layout is always hex (remove orbits, but don't delete orbital from main
 * > yet, we might keep it as an option) · place should always be radial · rung
 * > is strictly out · wedge is 1 rung · cells are roomy."*
 *
 * Each of these was already the value the lab opened on, so **nothing about
 * the picture changes** — what goes is the ability to change it, and five rows
 * of panel explaining choices nobody is making any more. The reasoning behind
 * each one is kept below, because the reason a decision was made outlives the
 * switch that made it.
 *
 * They are `const` rather than inlined so the code that reads them still reads
 * like a question being asked, and so turning one back on is a one-line edit
 * here rather than an archaeology exercise. Each is deliberately typed as its
 * **wider union**, not as the literal — that keeps the other branch alive and
 * type-checking instead of letting TypeScript narrow it into dead code that
 * the next tidy-up deletes.
 */

/**
 * **Hex, always.** Orbits is the layout that ships today, and it was here to
 * be put beside the lattice; that comparison is made. Greg's instruction is
 * explicit that this is the *lab's* answer and not the product's — *"don't
 * delete orbital from main yet, we might keep it as an option"* — so
 * `layoutCompany` and everything under `components/viz/orbital/` is untouched,
 * and `/org` still draws orbits. The branch below that reads this constant is
 * left standing for the same reason.
 */
const LAYOUT: "hex" | "orbits" = "hex";

/**
 * **Radial, always** — Greg chose ragged concentric bands on 2026-10-16, and
 * the atlas stayed one button away for comparison. Every spacing rule since
 * then lives in the radial driver and the atlas has never held to the spacer
 * at all, so the two are no longer comparable: the atlas is not a second
 * opinion, it is an older one. It remains in `lib/map/layout/hex/` as the
 * other driver `allocateByTerritory` can run, and that API default is
 * unchanged.
 */
const DRIVER: HexDriver = "radial";

/**
 * **Strictly out** — a rung may not step sideways round the centre. Greg,
 * 2026-10-17, on seeing chains loop back: *"what is preventing that code from
 * working?"* It became Law 3 the same day, so the toggle was offering a choice
 * the laws had already taken (`docs/MAP-LAWS.md`). `allow` is the older rule —
 * *"equal distance is allowed; nearer is not"* — and the comparison it existed
 * for is in the record.
 */
const SIDEWAYS: "allow" | "forbid" = "forbid";

/** **Roomy cells.** `tight` packs the same company into about half the area
 *  and was worth seeing once; the ground a family needs is what the room is
 *  paying for (see the table at the top of `docs/HEX-LAYOUT.md`). */
const DENSITY: HexDensity = "roomy";

export default function HexLab({
  org, companyKey, groups: rawGroups, leads,
}: {
  org: LabOrg;
  companyKey: string;
  /** unit id → the group it should be kept together with, when people have
   *  been promoted to units and a team is a crowd rather than a cell. */
  groups?: readonly (readonly [string, string])[];
  /** The people who lead the unit they hang from. */
  leads?: readonly string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 1200, height: 800 });
  // The settled preferences, under the names the rest of this file reads them
  // by. See the block above the component for why each one is what it is.
  const density = DENSITY;
  const mode = LAYOUT;
  const driver = DRIVER;
  const sideways = SIDEWAYS;
  const [hover, setHover] = useState<string | null>(null);

  /** Hand placements and reparents, kept in this browser between visits. */
  const [moves, setMoves] = useState<Map<string, Cell>>(() => new Map());
  const [reparents, setReparents] = useState<Map<string, string>>(() => new Map());
  /** Units somebody dragged themselves. Tidy up will not move these — it is
   *  what separates "neaten what I have" from "throw it away". */
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  /** Units merged away: the one that went in → the survivor. */
  const [merges, setMerges] = useState<Map<string, string>>(() => new Map());
  /** Units somebody made on this page, in the order they arrived. */
  const [born, setBorn] = useState<Born[]>(() => []);
  /**
   * **Units somebody took off the map**, them and everything under them.
   *
   * Greg, 2026-10-21, on whether removing should wait: *build it now*. Once a
   * node costs two clicks to make, a map with no way to unmake one fills up
   * with accidents, and undo only reaches back ten steps.
   *
   * It is a lab-side filter rather than an override in `lib/map`, because
   * nothing in the engine should learn that units can be deleted: the tree is
   * built from the company it is handed, and this decides what it is handed.
   */
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  /**
   * **What somebody called a node that came with the company.**
   *
   * A node made here is described through its own wizard, which knows about
   * roles and purposes because it made the thing. A node the fixture handed
   * down already has all of that; the only thing left to say about it is what
   * it should be called. So describing one is a rename, and it is kept apart
   * from `born` for the same reason the ids are: these units exist whether or
   * not anybody touches them.
   */
  const [renames, setRenames] = useState<Map<string, string>>(() => new Map());
  /** 0 = as arranged, 1 = neatened. A second press compresses. */
  const [tidyStage, setTidyStage] = useState(0);
  /**
   * **Which key the arrangement in state was read from** — not merely *whether*
   * one has been read.
   *
   * A boolean was enough while there was one key per company. With a key per
   * driver it is not: on the render where the driver changes, the saving effect
   * still closes over the previous render's `moves`, because the reading
   * effect's `setMoves` has only been *scheduled*. It would write the atlas's
   * arrangement into radial's key before React re-rendered — silently, and onto
   * cells that mean something different. Comparing the key the data came from
   * with the key in hand makes that unrepresentable rather than merely unlikely.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor !== null;
  const [pending, setPending] = useState<Pending | null>(null);
  /** The short menu a double-click opened. One at a time, like a dialog. */
  const [menu, setMenu] = useState<Menu | null>(null);
  /** The node being renamed, and what has been typed so far. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);



  /**
   * **The company, plus whatever has been made on the page.**
   *
   * Born nodes go in as ordinary units, so everything downstream — the drivers,
   * the spacer rule, the drag path, merging — treats a node somebody made
   * exactly like one the fixture came with. Nothing in `lib/map` learns that
   * creation is happening, which is the same discipline people-as-units was
   * built to.
   */
  const orgWithBorn = useMemo<LabOrg>(() => {
    if (!born.length && !removed.size && !renames.size) return org;
    const units = [
      ...org.units,
      ...born.map((b) => ({
        id: b.id,
        // An unnamed node still needs something to sort by; what the map
        // *draws* for it is decided by `nameOf`, not by this.
        name: b.name?.trim() || "",
        parentId: b.parentId,
        leadPersonId: null,
      })),
    ];
    const named = renames.size
      ? units.map((u) => (renames.has(u.id) ? { ...u, name: renames.get(u.id)! } : u))
      : units;
    if (!removed.size) return { ...org, units: named };
    return {
      ...org,
      units: named.filter((u) => !removed.has(u.id)),
      // An assignment outlives the unit it points at, and a seat hanging off
      // nothing is a person the map has nowhere to draw.
      assignments: org.assignments.filter((a) => !removed.has(a.orgUnitId)),
    };
  }, [org, born, removed, renames]);

  const baseTree = useMemo(
    () => buildOrbitalTree(orgWithBorn, { mergePassThroughRoot: false, workCountFor: () => 6 }),
    [orgWithBorn],
  );
  /** True when the root is the tree builder's own, rather than a unit of the
   *  company: a blank page has one, and so does any company with more than one
   *  thing at the top. */
  const syntheticRoot = useMemo(
    () => !orgWithBorn.units.some((u) => u.id === baseTree.rootId),
    [orgWithBorn, baseTree],
  );
  /** The tree as it stands, for effects that must read it without depending
   *  on it. See the arrangement loader below. Written in an effect rather than
   *  during render, which is where a ref may be touched. */
  const treeNow = useRef(baseTree);
  useEffect(() => { treeNow.current = baseTree; }, [baseTree]);
  /**
   * **A merge changes the shape of the company; a reparent does not.**
   *
   * Two trees, deliberately. A reparented tile *"stays exactly where it was put
   * and changes colour"*, so the layout is never asked to run again for one —
   * which is why `baseAllocation` has always been built from `baseTree`. A
   * merge cannot work that way: a node has gone and its people now belong to
   * somebody else, so the ground has to be laid again around the survivor.
   * `mergedTree` is what the layout sees; `tree` adds the hand's reparents on
   * top of it for everything that reads the structure.
   */
  const mergedTree = useMemo(
    () => (merges.size ? applyOverrides(baseTree, { unitMerge: merges }) : baseTree),
    [baseTree, merges],
  );
  const tree = useMemo(
    () => (reparents.size ? applyOverrides(mergedTree, { unitParent: reparents }) : mergedTree),
    [mergedTree, reparents],
  );

  // --- keeping an arrangement -----------------------------------------------
  //
  // `localStorage`, because a lab has no database by house rule and an
  // arrangement is worth more than the ten seconds it took to make. It is
  // per-browser and per-company, and every read and write is wrapped: a private
  // window or blocked site data throws rather than returning nothing, and an
  // arrangement is not worth a blank page.
  /**
   * **The suffix is the driver, and `.atlas` keeps its exact old spelling.**
   *
   * It was a dead suffix from the archipelago days until 2026-10-16, when a
   * second driver arrived and made it load-bearing again: an arrangement is a
   * set of *cells*, and the two drivers do not put a company on the same cells
   * at all. Sharing one key would have applied an atlas arrangement to radial
   * ground — every placement landing on whatever unit happened to be at that
   * coordinate, which is worse than losing it, because it looks like it worked.
   *
   * The atlas's own spelling is unchanged so that arrangements saved before
   * today still load. Greg has one on Northwind that is the only specimen
   * anybody has of a hand-built arrangement at that scale.
   */
  const storeKey = `zenhance.lab.hex.${companyKey}.${driver}${driver === "radial" && sideways === "forbid" ? ".out" : ""}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storeKey);
      const saved = raw ? (JSON.parse(raw) as {
        moves?: [string, Cell][]; reparents?: [string, string][]; pinned?: string[];
        merges?: [string, string][]; born?: Born[]; removed?: string[];
        renames?: [string, string][];
      }) : null;
      // **Only keep what this company still contains.** An arrangement saved
      // before the fixture's ids became deterministic names units that no
      // longer exist, and keeping those entries puts phantom tiles on the map:
      // ground nothing can be placed on, cells that cannot be hovered, and a
      // dialog naming a raw id. Anything unrecognised is dropped on the floor.
      // **Born nodes load first and are their own authority on existing.**
      // Everything else is filtered against the tree, and the tree does not
      // contain them until they are back in state.
      const bornBack = (saved?.born ?? []).filter((b) => b && b.id && (b.kind === "person" || b.kind === "place"));
      setBorn(bornBack);
      const bornIds = new Set(bornBack.map((b) => b.id));
      const known = (id: string) => treeNow.current.units.has(id) || bornIds.has(id);
      setMoves(new Map((saved?.moves ?? []).filter(([id]) => known(id))));
      setReparents(new Map(
        (saved?.reparents ?? []).filter(([id, parentId]) => known(id) && known(parentId)),
      ));
      setPinned(new Set((saved?.pinned ?? []).filter(known)));
      setMerges(new Map(
        (saved?.merges ?? []).filter(([goneId, intoId]) => known(goneId) && known(intoId)),
      ));
      // **Removals are not filtered against the tree**, because the tree is
      // what they act on: an id is only still in it while it has not been
      // taken off the map. Filtering here would undo every removal on reload.
      setRemoved(new Set(saved?.removed ?? []));
      setRenames(new Map((saved?.renames ?? []).filter(([id]) => known(id))));
    } catch {
      setMoves(new Map());
      setReparents(new Map());
      setPinned(new Set());
      setMerges(new Map());
      setBorn([]);
      setRemoved(new Set());
      setRenames(new Map());
    }
    setTidyStage(0);
    setLoadedFor(storeKey);
    /**
     * **The tree is read through a ref, and is deliberately not a dependency.**
     *
     * `baseTree` is built from the company *plus* whatever has been born, so
     * depending on it here is a loop: loading sets `born`, which rebuilds the
     * tree, which runs this again — React's own *"maximum update depth
     * exceeded"*, several hundred times a second. Asking a ref gets the same
     * answer about the same tree without tying this effect to it, and keeps
     * `known` meaning exactly what it meant before: does this id exist in the
     * company as the engine sees it, synthesised root and all.
     */
  }, [storeKey]);

  useEffect(() => {
    // Never write back before the first read, and never write one key's
    // arrangement under another's.
    if (loadedFor !== storeKey) return;
    try {
      if (!moves.size && !reparents.size && !merges.size && !born.length && !removed.size && !renames.size) {
        window.localStorage.removeItem(storeKey);
      } else {
        window.localStorage.setItem(storeKey, JSON.stringify({
          moves: [...moves], reparents: [...reparents], pinned: [...pinned],
          merges: [...merges], born, removed: [...removed], renames: [...renames],
        }));
      }
    } catch {
      // A browser that will not keep it is not a reason to stop working.
    }
  }, [storeKey, loadedFor, moves, reparents, pinned, merges, born, removed, renames]);

  /**
   * Who is a person rather than a structural node. Greg, 2026-10-03: *"at the
   * moment I can't tell what's a person and what's not."*
   *
   * Two rules follow from it. A person is drawn at the **base size**, the same
   * everywhere, whatever rung their reporting line happens to put them on —
   * depth grades a structure, and a person is not a structure. And a
   * structural node wears a darker border, so the thing that is a *place* is
   * visibly not the thing that is a *human*.
   */
  const peopleIds = useMemo(
    () => new Set([
      ...(rawGroups ?? []).map(([id]) => id),
      ...born.filter((b) => b.kind === "person").map((b) => b.id),
    ]),
    [rawGroups, born],
  );

  /**
   * **Who belongs to which team, after any merges.**
   *
   * The server hands down the company as it was built, so a person whose team
   * has since been merged away still points at a unit that no longer exists.
   * Everything that reads this — the crowd outlines, the drop path's
   * `groupOf`, and the panel's count of people sitting next to a stranger —
   * then disagrees with the tree, and the first thing it says is that two
   * people who have just been put on one team are strangers to each other.
   */
  const groups = useMemo(() => {
    /**
     * A born person's team is their nearest ancestor that is **not** a person
     * — the same reading `spacerRule` uses, and for the same reason: in a
     * people-as-units model a person's parent is usually their manager, and a
     * manager is not a team.
     *
     * **Asked of the tree, not of the record of what was made.** It used to
     * walk `born`'s own `parentId`, which is where a node *started*; a
     * reparent is an override on top of that and never touched it. So moving
     * somebody to another team moved their line and left everything that reads
     * this — their colour, the outline round their crowd, which neighbours
     * count as strangers — still pointing at the team they came from. Greg,
     * 2026-10-21: *"tried to reparent her to another team. The animation
     * fires, the result does not."* His own rule for this gesture is that the
     * tile stays where it was and **changes colour**, and the colour was the
     * part that could not change.
     *
     * The tree has every override applied, so merges come with it for free.
     */
    const teamOfBorn = (id: string): string | null => {
      const walked = new Set<string>([id]);
      let at: string | null = tree.units.get(id)?.parentId ?? null;
      while (at && !walked.has(at)) {
        walked.add(at);
        if (!peopleIds.has(at)) return at;
        at = tree.units.get(at)?.parentId ?? null;
      }
      return null;
    };
    const bornPairs = born
      .filter((b) => b.kind === "person")
      .map((b) => [b.id, teamOfBorn(b.id)] as const)
      .filter((pair): pair is readonly [string, string] => pair[1] !== null);

    if (!merges.size) {
      if (!bornPairs.length) return rawGroups;
      return [...(rawGroups ?? []), ...bornPairs];
    }
    const survivor = (id: string) => {
      let at = id;
      const walked = new Set<string>([at]);
      while (merges.has(at)) {
        const next = merges.get(at)!;
        if (walked.has(next)) break;
        walked.add(next);
        at = next;
      }
      return at;
    };
    return [...(rawGroups ?? []), ...bornPairs]
      .map(([personId, teamId]) => [personId, survivor(teamId)] as const);
  }, [rawGroups, merges, born, tree, peopleIds]);
  const leadIds = useMemo(() => new Set(leads ?? []), [leads]);

  /**
   * **Which lead arrived first, where a merge has left a unit with two.**
   *
   * Derived from the order the merges were made rather than held as its own
   * state: the lead that came in with the nth merge is the nth newcomer, and
   * the layout chains it that far out along the axis. Nothing to keep in step,
   * and it survives a reload for free because `merges` does.
   */
  const leadOrder = useMemo(() => {
    const out = new Map<string, number>();
    let nth = 0;
    for (const [goneId] of merges) {
      nth += 1;
      const gone = baseTree.units.get(goneId);
      if (!gone) continue;
      for (const childId of gone.childIds) if (leadIds.has(childId)) out.set(childId, nth);
    }
    return out;
  }, [merges, baseTree, leadIds]);

  const groupOf = useMemo(() => {
    if (!groups?.length) return undefined;
    const map = new Map(groups);
    // A person belongs to their team; a team belongs to itself, so the team's
    // own cell counts as part of the crowd it is trying to stay next to.
    return (unitId: string) => map.get(unitId) ?? unitId;
  }, [groups]);


  const baseAllocation = useMemo(
    () => allocateByTerritory(mergedTree, { leads: leadIds, leadOrder, people: peopleIds, driver, sideways }),
    [mergedTree, leadIds, leadOrder, peopleIds, driver, sideways],
  );

  /**
   * **The layout's own spacing, for the gestures that re-lay a branch.**
   *
   * Greg, 2026-10-14: *"the 'pick up and place within five seconds' rule…
   * pushes everything together so the gap between anything is zero, which means
   * it's not applying the same rules as the auto-tidy. To me that feels
   * inconsistent."*
   *
   * It is the same rule now. `spacedBy` is what `layoutTerritories` kept clear
   * round each unit, and both the tidy button and the five-second re-pickup are
   * handed it — they are the same gesture at different scopes. A plain drop
   * still gets nothing, because Law 0 says where a hand puts something is not
   * the engine's business to improve.
   */
  /**
   * The company's own bearings. Worked out from the shape of the tree before
   * anything is packed, so it costs one pass over the units and never changes
   * while a drag is live — see `headings`. A re-laid branch is handed this so
   * it keeps facing the way it always faced rather than growing outward from
   * whichever node the hand happened to grab.
   */
  const compass = useMemo(() => headings(tree), [tree]);

  /**
   * **How many rungs the deference takes to arrive**, when a node is put back
   * where its own rung belongs. One makes the wedge as pointy as it can be —
   * the node in your hand, then its children already back where the master
   * centre had them. Larger carries the hand's influence further down the
   * branch. It was a dial because the only way to settle how abrupt it should
   * look is to look at it; Greg looked, and settled it at one on 2026-11-06 —
   * *"wedge is 1 rung"* — which is the value `TAPER_RUNGS` already held and the
   * value the lab always opened on.
   */
  const taper = TAPER_RUNGS;


  /** The allocation with every hand placement applied on top. Reparenting does
   *  **not** re-allocate: Greg's rule is that a reparented tile stays exactly
   *  where it was put and changes colour, so the cells are the person's. */
  const allocation = useMemo(() => {
    if (!moves.size) return baseAllocation;
    // `applyHand` carries the whole rule, and why a stale placement is refused
    // rather than stamped on.
    return { ...baseAllocation, ...applyHand(baseAllocation.cells, moves) };
  }, [baseAllocation, moves]);

  const { scene, hexScene, ms } = useMemo(() => {
    const t0 = performance.now();
    if (mode === "orbits") {
      const s = layoutCompany(tree).scene;
      return { scene: s as OrbitalScene, hexScene: null, ms: performance.now() - t0 };
    }
    const s = layoutHex(tree, { density, allocation });
    return { scene: s as OrbitalScene, hexScene: s as HexScene, ms: performance.now() - t0 };
  }, [tree, density, mode, allocation]);

  /** Every chain, routed round the tiles rather than drawn across them. Once
   *  per arrangement — it is 8ms on the 2,562-person company, which is far too
   *  much to do per frame and nothing at all to do per drag. */
  const chains = useMemo(
    () => (hexScene ? routeAll(tree, hexScene.hex.cells, hexScene.hex.size) : []),
    [hexScene, tree],
  );

  /**
   * Which region each unit's colour comes from.
   *
   * With people promoted to units, `regionOf` was choosing its rung by unit
   * count across the *whole* tree — on Northwind that landed on rung 17, deeper
   * than any team, so almost every unit became its own region and the map was
   * 2,900 colours cycling through twelve hues. That is the confetti.
   *
   * The structure is what has territory, so the rung is chosen over the
   * structural units alone, and a person simply takes their team's region.
   */
  const regions = useMemo(() => {
    if (peopleIds.size === 0) return regionOf(scene.units);
    const structural = scene.units.filter((u) => !peopleIds.has(u.id));
    const byStructure = regionOf(structural);
    const out = new Map(byStructure);
    const teamOfPerson = new Map(groups ?? []);
    for (const u of scene.units) {
      if (!peopleIds.has(u.id)) continue;
      const team = teamOfPerson.get(u.id);
      const region = team ? byStructure.get(team) : undefined;
      if (region) out.set(u.id, region);
    }
    return out;
  }, [scene, peopleIds, groups]);

  /**
   * The hue each unit is drawn in: its division's, shaded by which team inside
   * that division it belongs to. People take their team's shade exactly, so a
   * team is one colour and a division is one family of colours.
   */
  const hueById = useMemo(() => {
    const teamOfPerson = new Map(groups ?? []);
    const teamOf = (id: string) => teamOfPerson.get(id) ?? id;
    const order: string[] = [];
    const seen = new Set<string>();
    for (const u of scene.units) {
      const r = regions.get(u.id) ?? u.id;
      if (!seen.has(r)) { seen.add(r); order.push(r); }
    }
    // Teams are numbered within their own region, so the shades of one
    // division are spread across its band rather than drawn at random.
    const teamIndex = new Map<string, number>();
    const perRegion = new Map<string, number>();
    for (const u of scene.units) {
      const team = teamOf(u.id);
      if (teamIndex.has(team)) continue;
      const r = regions.get(team) ?? regions.get(u.id) ?? team;
      const n = perRegion.get(r) ?? 0;
      perRegion.set(r, n + 1);
      teamIndex.set(team, n);
    }
    const out = new Map<string, number>();
    for (const u of scene.units) {
      const r = regions.get(u.id) ?? u.id;
      const base = hueAt(Math.max(0, order.indexOf(r)));
      const team = teamOf(u.id);
      const k = teamIndex.get(team) ?? 0;
      const spread = perRegion.get(r) ?? 1;
      const drift = spread <= 1 ? 0 : ((k / (spread - 1)) - 0.5) * 2 * TEAM_HUE_SPREAD;
      out.set(u.id, (base + drift + 360) % 360);
    }
    return out;
  }, [scene, regions, groups]);

  /**
   * One outline per team, drawn at rest rather than only on hover.
   *
   * With people promoted to units, colour can no longer say "these belong
   * together": the palette has twelve hues and a company has hundreds of
   * teams, so colouring by team just cycles. Greg's rule 8 machinery already
   * draws an exact boundary round a set of cells, so a team gets one — the
   * division keeps the colour, the team gets the line.
   */
  const teamOutlines = useMemo(() => {
    if (!groups?.length || !hexScene) return [];
    const byTeam = new Map<string, Cell[]>();
    for (const [unitId, teamId] of groups) {
      const cell = hexScene.hex.cells.get(unitId);
      if (!cell) continue;
      const cells = byTeam.get(teamId) ?? [];
      cells.push(cell);
      byTeam.set(teamId, cells);
    }
    // The team's own cell belongs inside its outline too.
    for (const teamId of byTeam.keys()) {
      const own = hexScene.hex.cells.get(teamId);
      if (own) byTeam.get(teamId)!.push(own);
    }
    return [...byTeam].map(([teamId, cells]) => {
      const size = hexScene.hex.size;
      const outward = size * TEAM_SPREAD;
      const loops = unionLoops(cells, size, outward);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const loop of loops) {
        for (const point of loop.points) {
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
      }
      /**
       * One boundary around the union of the team node's cell and every child
       * cell — not one shape per member. It is pushed out once by a quarter-cell
       * radius, then the one resulting line is filled.
       */
      return { teamId, cells, loops, box: { minX, maxX, minY, maxY } };
    });
  }, [groups, hexScene]);

  /**
   * **The clear hexagon round each team, drawn as ground rather than as team.**
   *
   * Greg, 2026-10-18: *"the hexagon spacing itself should be a faint grey —
   * just darker than the background, regardless of what colour a team has."*
   *
   * Which is a rule about what colour *means* on this map, and a good one:
   * **colour is for what is there, grey is for the room around it.** The ring
   * was taking the hue of whichever region's wash it fell inside, so the space
   * a team keeps read as more of the team — the opposite of what the space is
   * for. Every ring is now the same neutral whoever it belongs to, which is
   * also how you can see at a glance that the spacing rule is one rule.
   *
   * Only the cells nobody stands on: a ring cell that turns out to be occupied
   * belongs to whoever is standing there.
   */
  /**
   * **The ring round a group of teams** — the second hexagon of clear ground,
   * drawn where it actually is.
   *
   * Two things were wrong with the first attempt, and Greg saw both: *"I do not
   * see the additional perimeter of an additional hexagon around the group of
   * teams."*
   *
   *  - It was drawn as the **tier-1 bubble's** edge, and a bubble is the shape
   *    *grown by one* — which is exactly where each team's own spacer already
   *    is. So the line landed on top of the team ring instead of outside it.
   *    The group's ring is the *second* hexagon out, so the shape is grown
   *    twice.
   *  - Tier is about **places**, not about teams: a node only reaches tier 1 if
   *    its children are big enough to count as places, so on Northwind just
   *    **51 of the 117 groups of teams** had a bubble at all and the other 66
   *    were never drawn.
   *
   * It now asks `groupFor` — the very function that decides the spacing — so
   * the line and the ground it draws cannot disagree. One rule, one answer, and
   * if a group is scattered the pieces each get their own ring for free,
   * because growing a set of cells knows nothing about whether they touch.
   */
  const groupRings = useMemo(() => {
    if (!hexScene) return null;
    if (typeof Path2D === "undefined") return null;
    const zone = groupZones({
      tree, cells: hexScene.hex.cells, people: peopleIds, size: hexScene.hex.size,
    });
    if (!zone.cells.length) return null;
    /**
     * One rounded shape for both the ground and the line round it. The walls
     * `groupZones` hands back are the boundary of this very set, so stroking
     * the shape that was filled is the same ink by a shorter route — and the
     * line and the ground it draws *cannot* disagree, which was the point of
     * asking `groupFor` for both in the first place.
     */
    const loops = unionLoops(zone.cells, hexScene.hex.size);
    return loops.length ? loops : null;
  }, [hexScene, tree, peopleIds]);

  /**
   * **A team's ground, not a team's collar.** Greg, 2026-11-06: *"it looks
   * like the area hexagons are less a background and more a perimeter that's
   * calculated. This needs to change so it's a background and covers the
   * whole area underneath active hexagons."*
   *
   * It was exactly a collar: every cell within one step of the team that
   * nobody was standing on. So the ground stopped at the tiles and started
   * again on the other side of them, and wherever two neighbouring tiles did
   * not quite meet — which rounding their corners opened up — the page showed
   * through as a little white star. The stars were never the fault; the fault
   * is that there was nothing underneath.
   *
   * The team's own cells are in the set now, so this draws one continuous
   * piece of ground with the team standing on it. The collar is still a
   * collar — it is simply the part of the ground nobody is on.
   *
   * Somebody else's cell is still left alone: a division standing next door
   * keeps its own, which is `groupZones`' rule — *a zone is room, not ground
   * to annex* — and the reason this asks `own` rather than dropping `taken`.
   */
  const teamSpacers = useMemo(() => {
    if (!hexScene || !teamOutlines.length) return null;
    if (typeof Path2D === "undefined") return null;
    const size = hexScene.hex.size;
    const taken = new Set<string>();
    for (const cell of hexScene.hex.cells.values()) taken.add(cellKey(cell));
    const drawn = new Set<string>();
    const spacer: Cell[] = [];
    for (const team of teamOutlines) {
      const own = new Set(team.cells.map(cellKey));
      for (const cell of grow(team.cells)) {
        const key = cellKey(cell);
        if (drawn.has(key)) continue;
        if (taken.has(key) && !own.has(key)) continue;
        drawn.add(key);
        spacer.push(cell);
      }
    }
    // Every team's ground in one set, so two teams whose ground touches round
    // as the single shape they already looked like.
    return unionLoops(spacer, size);
  }, [hexScene, teamOutlines]);
  /**
   * **The bubbles** (Greg, 2026-10-16, requirements 4 and 6).
   *
   * Built from the same live cell groups the hover outline uses, so a bubble
   * follows a hand move and remains one boundary around the branch rather than
   * a collection of member halos.
   */
  const bubbles = useMemo(() => {
    if (!hexScene || !allocation.tier) return [];
    // A client component is still rendered once on the server, where there is no
    // canvas and so no `Path2D`. It recomputes on the client at hydration, which
    // is the only pass whose answer is ever drawn.
    if (typeof Path2D === "undefined") return [];
    const size = hexScene.hex.size;
    return bubblesFor({
      tree, cells: allocation.cells, tier: allocation.tier, size,
      occupants: allocation.occupants,
    }).map((bubble) => {
      const loops = unionLoops(bubble.cells, size);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const loop of loops) {
        for (const point of loop.points) {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
      return { ...bubble, loops, box: { minX, maxX, minY, maxY } };
    }).filter((b) => b.loops.length > 0);
  }, [hexScene, allocation, tree]);

  const regionOrder = useMemo(() => {
    const weight = new Map<string, number>();
    for (const u of scene.units) {
      const r = regions.get(u.id);
      if (r) weight.set(r, (weight.get(r) ?? 0) + u.seatIds.length);
    }
    return [...weight.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  }, [scene, regions]);
  /**
   * **How many strata the company has**, which grades every node's size and
   * every wash's tone — Greg, 2026-09-30: *"each step calculated based on how
   * many strata there are."*
   *
   * **Counted over the company the engine laid, not the hand's sketch on top
   * of it.** The second half of the flinch, and the one the original write-up
   * missed: making a person inside a team adds a rung, every step in the
   * grading gets shorter, and the whole map re-sizes and re-shades around a
   * node nobody has even named yet. Measured on Sparrow Jam on 2026-10-30:
   * nothing moved a pixel and Granite Division still swelled by about a third.
   *
   * It skips the nodes **made here and placed by hand**, which is the same
   * rule `settle` keeps for cells — **tidy is where the engine gets its say
   * back**, and its second press clears the placements, at which point a grown
   * rung counts like any other.
   *
   * Not `pinned` on its own, which was this code's first mistake: `commit`
   * pins *any* unit a hand has dragged, so reading it alone would have taken a
   * dragged team out of the company's own count of its rungs. A node the
   * company came with is a rung whoever moved it.
   *
   * On blank paper every node is the hand's, so there is no company to count
   * and it falls back to counting them: a company grown from nothing grades
   * itself as it deepens, exactly as it did before this.
   */
  const maxDepth = useMemo(() => {
    const made = new Set(born.filter((b) => pinned.has(b.id)).map((b) => b.id));
    const deepest = (us: typeof scene.units) => us.reduce((m, u) => Math.max(m, u.depth), 0);
    const laid = made.size ? scene.units.filter((u) => !made.has(u.id)) : scene.units;
    return deepest(laid.length ? laid : scene.units);
  }, [scene, pinned, born]);

  /**
   * **A ground takes its colour from the structural node that owns it.**
   *
   * Descendant averaging made the area behind people drift toward their pale
   * tone and hid their opaque host cells inside it. A team ground now uses the
   * team node exactly; a higher bubble uses its own organisational node. The
   * fill keeps its real alpha channel so the hierarchy beneath remains visible.
   */
  const tintOfNode = useCallback((id: string) => {
    const unit = scene.unitById.get(id);
    if (!unit) return null;
    const hue = hueById.get(id) ?? 0;
    const { l, s } = toneOf(unit.depth, maxDepth);
    const h = hue.toFixed(1);
    const sp = (s * 100).toFixed(0);
    const lp = l * 100;
    const presence = (value: number) => Math.min(1, Math.max(0, value));
    return {
      fill: (alpha = 1, opacity = REGION_FILL_OPACITY) =>
        `hsla(${h}, ${sp}%, ${lp.toFixed(0)}%, ${opacity * presence(alpha)})`,
      line: (alpha = 1, opacity = REGION_EDGE_OPACITY) =>
        `hsla(${h}, ${sp}%, ${(lp * (1 - TEAM_EDGE_DARKER)).toFixed(0)}%, ${opacity * presence(alpha)})`,
    };
  }, [scene, hueById, maxDepth]);

  const teamTints = useMemo(() => {
    const out = new Map<string, ReturnType<typeof tintOfNode>>();
    for (const team of teamOutlines) out.set(team.teamId, tintOfNode(team.teamId));
    return out;
  }, [teamOutlines, tintOfNode]);

  const bubbleTints = useMemo(() => {
    const out = new Map<string, ReturnType<typeof tintOfNode>>();
    for (const bubble of bubbles) out.set(bubble.unitId, tintOfNode(bubble.unitId));
    return out;
  }, [bubbles, tintOfNode]);

  /**
   * **Which rungs outside a team could take over from it.**
   *
   * The ladder hands a place outward, and the handover only works if there is
   * something out there to hand it *to*. There often is not: a unit only
   * reaches bubble tier 1 if its children are big enough to count as places,
   * so on Digital Tailoring just **three** nodes have a bubble at all, and on
   * Northwind it was 51 of 117. Fading every team's ground out on the way to
   * a region that does not exist leaves those teams as grey smudges belonging
   * to nothing — which is what the first version of this did, and it was
   * plainest on the 45-person company, where the outermost zoom went almost
   * white.
   *
   * So each team is asked which of its ancestors actually has a bubble. If
   * none of them is currently drawing as a place, the team keeps its own
   * ground however far out you pull: nothing has taken over, so nothing is
   * given up.
   */
  const teamCover = useMemo(() => {
    const out = new Map<string, number[]>();
    if (!teamOutlines.length || !allocation.tier) return out;
    const bubbled = new Set(bubbles.map((b) => b.unitId));
    for (const team of teamOutlines) {
      const tiers: number[] = [];
      let id: string | null = scene.unitById.get(team.teamId)?.parentId ?? null;
      while (id) {
        if (bubbled.has(id)) {
          const tier = allocation.tier.get(id);
          if (tier !== undefined) tiers.push(tier);
        }
        id = scene.unitById.get(id)?.parentId ?? null;
      }
      out.set(team.teamId, tiers);
    }
    return out;
  }, [teamOutlines, bubbles, scene, allocation.tier]);

  /**
   * **How wide a typical region is at each rung, in world units.**
   *
   * This is the whole input to the recursion in `placePresence`: the ladder
   * asks, of every rung at once, whether a region at that rung is big enough
   * on screen to read as a place. Tier nought is a team; tier one a team of
   * teams, and so on outward.
   *
   * **The median, not the mean.** Every company has one enormous division and
   * a long tail of small ones, and a mean follows the enormous one — which
   * would hold a rung on screen long after the regions you are actually
   * looking at had become specks.
   */
  const footprints = useMemo(() => {
    const spans = new Map<number, number[]>();
    const add = (tier: number, span: number) => {
      const list = spans.get(tier) ?? [];
      list.push(span);
      spans.set(tier, list);
    };
    if (hexScene) {
      for (const team of teamOutlines) {
        add(0, Math.max(
          team.box.maxX - team.box.minX,
          team.box.maxY - team.box.minY,
        ));
      }
    }
    for (const bubble of bubbles) {
      add(bubble.tier, Math.max(bubble.box.maxX - bubble.box.minX, bubble.box.maxY - bubble.box.minY));
    }
    const out = new Map<number, number>();
    for (const [tier, list] of spans) {
      list.sort((a, b) => a - b);
      out.set(tier, list[Math.floor(list.length / 2)]);
    }
    return out;
  }, [teamOutlines, bubbles, hexScene]);

  const floor = useMemo(
    () => minScaleFor(scene.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, size),
    [scene, size],
  );
  /**
   * **`prefers-reduced-motion`.** Three things move on this page — the neck
   * arming over the dwell, a node breathing until it is described, and since
   * 2026-11-06 the camera travelling between two rungs of the zoom ladder —
   * and all three stand down for anybody who has asked for that. The jump
   * still *happens*; it simply arrives rather than travels, which is the right
   * reading of the setting: it asks for less motion, not less function.
   *
   * Watched rather than read once, because it can change while the page is
   * open.
   */
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setStill(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const [camera, setCamera] = useState<Camera>({ scale: 0.05, x: 0, y: 0 });

  /**
   * **The one number the whole ladder reads** — how many pixels a cell covers
   * on the glass. See `lib/map/camera/hexLod.ts` for why it is this and not
   * world scale, the window size, or how many nodes are on screen.
   */
  const cellPx = cellPxOf(hexScene?.hex.size ?? 1, camera.scale);
  const level = levelAt(cellPx);

  /**
   * **How soft every area boundary is right now, and the paths at that
   * softness.** Greg, 2026-11-06: *"by the time we hit whatever the next
   * increment is, the border radius of those hexagons is so high the team
   * boundary begins to appear smooth."*
   *
   * The higher region, collar and group ring still soften together as they
   * recede. A team container is the exception since 2026-11-07: Greg fixed its
   * rounding at half a cell radius, matching the hover outline, so it is traced
   * with `soften = 1` below rather than inheriting the overview ramp.
   *
   * `softeningAt` comes back **in steps** rather than continuously, so this
   * memo rebuilds a few times across the ramp instead of on every frame; the
   * reasoning for that is on `SOFTEN_STEPS`.
   */
  const soften = softeningAt(cellPx);
  const areaPaths = useMemo(() => {
    const size = hexScene?.hex.size ?? 1;
    const teams = new Map<string, Path2D>();
    for (const team of teamOutlines) {
      // The loops have already been pushed out by a quarter radius. Their corner
      // is also exactly half a radius, matching the hover outline's union
      // calculation rather than adding the stand-off to the rounding again.
      const path = pathOfLoops(team.loops, size, 0, 1);
      if (path) teams.set(team.teamId, path);
    }
    const blobs = new Map<string, Path2D>();
    for (const bubble of bubbles) {
      const path = pathOfLoops(bubble.loops, size, 0, soften);
      if (path) blobs.set(bubble.unitId, path);
    }
    return {
      teams,
      blobs,
      spacers: teamSpacers ? pathOfLoops(teamSpacers, size, 0, soften) : null,
      // Keep the geometry live so the outer zone can be restored with one
      // switch; it is intentionally absent from the current visual stack.
      rings: SHOW_OUTERMOST_ZONE && groupRings
        ? pathOfLoops(groupRings, size, 0, soften)
        : null,
    };
  }, [soften, hexScene, teamOutlines, bubbles, teamSpacers, groupRings]);
  const fit = useCallback(() => {
    if (scene.bounds) setCamera(fitCamera(scene.bounds, size, { min: floor }));
  }, [scene, size, floor]);

  /**
   * **Going to a rung of the ladder, rather than scrubbing until you arrive.**
   *
   * Greg asked for *"several levels of zoom, and smooth animations between
   * them"*, and those are two separate features that are easy to confuse. The
   * **morph** is what the painter does every frame, continuously, as the wheel
   * turns — there are no steps in it and there should not be. This is the
   * other half: a way to *name* a rung and go there, which is what makes the
   * ladder learnable at all. Reachable only by scrubbing, the levels might as
   * well not have names.
   *
   * **The centre of the window stays put** while it travels. The scale is
   * interpolated **geometrically** — a camera moves in multiples, not in
   * additions, so halfway between 4× and 230× is 30×, not 117× — and the
   * offset is recomputed from that scale each frame rather than interpolated
   * alongside it, which is what keeps the point under the middle of the screen
   * exactly still instead of drifting and settling.
   *
   * It is also where the zoom can run out: a rung past `MAX_SCALE`, or past
   * the floor that stops you pulling back further than the whole company, is
   * clamped. A ten-person company simply cannot reach the outer rungs, which
   * is the ladder eliding itself rather than a failure.
   */
  const travel = useRef<number>(0);
  const arrival = useRef<number>(0);
  /**
   * **Where the camera is, for a journey that is about to start.**
   *
   * A ref rather than reading `camera` through a `setCamera` updater, which is
   * what this did for an hour and which does not work: React may run an
   * updater more than once, so the journey started twice from two different
   * places and the two loops fought over every frame. It landed wherever the
   * loser's last write happened to be — pressing *Function* on the
   * thousand-person company arrived at 7.2px instead of 14px, which looks for
   * all the world like a clamp and is not one. An updater must be pure; this
   * is the side effect moved out of it.
   */
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);

  const jumpTo = useCallback((target: HexLevel) => {
    if (!hexScene) return;
    cancelAnimationFrame(travel.current);
    const from = cameraRef.current;
    const want = clampScale(scaleForLevel(target, hexScene.hex.size), floor);
    const screen = { x: size.width / 2, y: size.height / 2 };
    const centre = {
      x: (screen.x - from.x) / from.scale,
      y: (screen.y - from.y) / from.scale,
    };
    /**
     * **A jump arrives at something, not at empty ground.**
     *
     * Holding the middle of the window still is the predictable thing to do
     * and is what the wheel does, so that is the default. But a named jump is
     * a navigational act rather than a nudge, and this map has a great deal of
     * blank lattice in it — pressing *Person* while the middle of the window
     * happens to be over open ground zooms all the way in on nothing, which is
     * the worst moment the ladder can give you.
     *
     * So: if there is nobody under the middle of the window, aim at whoever is
     * nearest to it. The shift is as small as it can be, because it is the
     * *nearest*, and in the common case — the middle of the window is over the
     * company, as it is after `fit` — there is no shift at all.
     */
    const here = allocation.occupants.get(cellKey(worldToCell(centre, hexScene.hex.size)));
    let world = centre;
    if (!here) {
      let best = Infinity;
      for (const unit of scene.units) {
        const d = (unit.x - centre.x) ** 2 + (unit.y - centre.y) ** 2;
        if (d < best) { best = d; world = { x: unit.x, y: unit.y }; }
      }
    }
    const settle = (s: number) => cameraAbout(s, world, screen);
    if (still || Math.abs(Math.log(want / from.scale)) < 0.01) {
      setCamera(settle(want));
      return;
    }
    const t0 = performance.now();
    const ratio = want / from.scale;
    const step = () => {
      const progress = cameraProgress(performance.now() - t0, LEVEL_TRAVEL_MS);
      setCamera(settle(from.scale * ratio ** easeOutCubic(progress)));
      if (progress < 1) travel.current = requestAnimationFrame(step);
      else window.clearTimeout(arrival.current);
    };
    travel.current = requestAnimationFrame(step);
    /**
     * **A journey always arrives, even if nobody watches it.**
     *
     * `requestAnimationFrame` stops firing while a tab is in the background,
     * so a jump begun just before somebody switched away would freeze at
     * whatever fraction it had reached and be sitting there, between two
     * rungs, when they came back. Caught while driving this in a browser pane
     * that had been hidden: pressing *Function* from *Team* left the camera at
     * 28px, which is neither.
     *
     * So the animation is the nice way to arrive and this is the guarantee.
     * Whichever gets there first cancels the other.
     */
    window.clearTimeout(arrival.current);
    arrival.current = window.setTimeout(() => {
      cancelAnimationFrame(travel.current);
      setCamera(settle(want));
    }, LEVEL_TRAVEL_MS + 150);
  }, [hexScene, floor, size, still, allocation, scene]);

  /** A gesture of the user's own outranks a journey they started earlier. */
  const stopTravel = useCallback(() => {
    cancelAnimationFrame(travel.current);
    window.clearTimeout(arrival.current);
  }, []);
  useEffect(() => () => {
    cancelAnimationFrame(travel.current);
    window.clearTimeout(arrival.current);
  }, []);
  /**
   * Fit when the *picture* changes, never when the arrangement does.
   *
   * `fit` depends on `scene`, and the scene changes on every move — so the
   * camera was snapping back to the whole company each time a tile was
   * repositioned, throwing away the zoom somebody was working at. Greg,
   * 2026-10-03: *"zoom should persist."* The signature is what the camera
   * actually responds to; a move is not part of it.
   */
  /**
   * **The camera steps back after something is made.** Creation changes the
   * arrangement, and the fit below deliberately ignores arrangement changes —
   * so a grown company would otherwise appear off-screen at whatever zoom the
   * last gesture left behind. Capped so that one node does not fill the glass.
   */
  /**
   * **Look again** — set when something is made on blank paper and the view
   * has to be re-framed around it.
   *
   * State rather than a ref, although a ref is all the mechanism needs: the
   * menu's handlers are created while the component renders, and a function
   * that writes a ref cannot be called from there. One extra render for a
   * gesture that happens once per company is a fair price for the rule
   * holding everywhere else.
   */
  const [lookAgain, setLookAgain] = useState(false);
  useEffect(() => {
    if (!lookAgain || !scene.bounds) return;
    setLookAgain(false);
    /**
     * **Frame the ground, not just the nodes.** Fitting a one-node company to
     * its own bounds puts a single cell across the whole glass, which reads as
     * a huge coloured shape rather than as a person standing somewhere. A few
     * cells of air on every side shows the lattice they are standing on and
     * leaves somewhere for the next one to go.
     */
    const air = (hexScene?.hex.size ?? 0) * 2.5;
    const b = scene.bounds;
    // The settings panel owns the right-hand strip, so the company is framed
    // in what is left of the glass rather than under it.
    const clear = { width: Math.max(320, size.width - 300), height: size.height };
    setCamera(fitCamera(
      { minX: b.minX - air, minY: b.minY - air, maxX: b.maxX + air, maxY: b.maxY + air },
      clear,
      { min: floor, max: 2.2 },
    ));
  }, [lookAgain, scene, hexScene, size, floor]);

  const fittedFor = useRef("");
  useEffect(() => {
    // The driver belongs in here: swapping it re-lays the whole company, so the
    // camera has to refit or the new arrangement opens off screen.
    const signature = `${companyKey}|${density}|${mode}|${driver}|${sideways}|${size.width}x${size.height}`;
    if (fittedFor.current === signature || !scene.bounds) return;
    fittedFor.current = signature;
    setCamera(fitCamera(scene.bounds, size, { min: floor }));
  }, [companyKey, density, mode, driver, sideways, size, scene, floor]);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- dragging ------------------------------------------------------------

  type Drag = {
    unitId: string;
    members: Map<string, Cell>;
    grabbed: Cell;
    from: { x: number; y: number };
    world: { x: number; y: number };
    target: Cell;
    landing: Map<string, Cell> | null;
    /** Where the hand was when the hold clock last started. */
    holdAt: { x: number; y: number };
    /** Where the landing actually seats the anchor — which is not the cell
     *  under the cursor when that one was occupied. */
    anchor: Cell | null;
    reshaped: boolean;
    /** The branch was treed by the second-pick-up gesture. */
    radiated: boolean;
    /** The tidy-up gesture is live for this drag: the same node was picked
     *  straight back up inside the window. */
    armedAt: Cell | null;
    /**
     * **How much the branch is answering to the master centre, where it is now.**
     *
     * This was the branch's own shape, worked out **once** when the gesture
     * armed — which it had to be, because re-laying it cost a third of a second
     * and this runs as the pointer moves. A shape that can be computed once is
     * also a shape that cannot depend on where you put it, and that is exactly
     * what Greg asked for on 2026-10-17: *"the further away from master-centre
     * the user moves it, the less it observes the layout behaviour defined by
     * master-centre."* So it is re-laid as the hand moves, which `deferBranch`
     * costs 7ms for the largest branch on the largest company, and what is kept
     * here is the one number that came out of it — for the panel, and so the
     * drawing can say which of the three it is showing.
     */
    deference: number | null;
    /**
     * **The branch's own shape, worked out once when the gesture armed.**
     *
     * Which is where this started: a branch's shape does not change as the hand
     * moves, only where it lands and which way it is turned. What *does* change
     * with the hand is how much of that shape is used at all — the deference —
     * and that half is a lerp. So the 26ms half is computed once and the
     * per-move half is cheap, which is the arrangement the old code had for the
     * right reason even though it then froze the wrong thing.
     */
    afar: BranchShape | null;
    heldOver: string | null;
    holdSince: number;
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The branch that landed last, and when — the only thing the gesture needs
   *  to remember between two drags. */
  const [justMoved, setJustMoved] = useState<{ unitId: string; at: Cell; when: number } | null>(null);
  const pan = useRef<{ x: number; y: number; cam: Camera } | null>(null);

  const worldAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => ({
      x: (clientX - rect.left - camera.x) / camera.scale,
      y: (clientY - rect.top - camera.y) / camera.scale,
    }),
    [camera],
  );

  // The offer expires by itself, so the ring never promises something that has
  // already lapsed.
  useEffect(() => {
    if (!justMoved) return;
    const left = RADIATE_WINDOW_MS - (Date.now() - justMoved.when);
    if (left <= 0) { setJustMoved(null); return; }
    const t = setTimeout(() => setJustMoved(null), left);
    return () => clearTimeout(t);
  }, [justMoved]);

  /* --- one step back ------------------------------------------------------ */

  /**
   * **Undo.** Greg, 2026-10-20: *"A button in the interface **and** ctrl+z /
   * cmd+z. One step back per press, with about ten steps of history."*
   *
   * *"This matters more than it looks: once a node can be made in two clicks,
   * people will make them by accident"* — and until now the only way back was
   * tidy's second press, which throws the whole arrangement away.
   *
   * Everything a hand can do on this page lives in six pieces of state, all of
   * them replaced rather than mutated, so a step back is just keeping the old
   * ones. No diffing, nothing to keep in step, and the cost of a step is six
   * references.
   *
   * **Naming is not a step.** The wizard writes on every keystroke, and ten
   * steps of history would otherwise be ten letters of somebody's name. The
   * step is the thing that was *made*; undoing it takes the node with it.
   */
  const [past, setPast] = useState<Snapshot[]>([]);
  const canUndo = past.length > 0;

  /**
   * Call this **before** changing anything, from the gesture that changes it.
   * What it keeps is the state of the render the gesture was created in, which
   * is the state before the change — no refs, and nothing to keep in step.
   */
  const remember = useCallback(() => {
    setPast((p) => [
      ...p.slice(-(UNDO_DEPTH - 1)),
      { moves, reparents, pinned, merges, born, removed, renames, tidyStage },
    ]);
  }, [moves, reparents, pinned, merges, born, removed, renames, tidyStage]);

  const undo = useCallback(() => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    setMoves(last.moves);
    setReparents(last.reparents);
    setPinned(last.pinned);
    setMerges(last.merges);
    setBorn(last.born);
    setRemoved(last.removed);
    setRenames(last.renames);
    setTidyStage(last.tidyStage);
    // A question about something that may no longer be there is not a question.
    setPending(null);
    setMenu(null);
  }, [past]);

  /**
   * `ctrl+z` / `cmd+z`, except while somebody is typing — a name half entered
   * in the wizard is the browser's own undo to give back, not ours.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const on = e.target as HTMLElement | null;
      if (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.isContentEditable)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  /**
   * **`[` and `]` step out and in a rung of the zoom ladder.**
   *
   * Not `cmd+-` and `cmd+=`, which is what the design note first suggested and
   * what a browser uses to resize the whole page. Taking those from somebody
   * who meant to make the text bigger is a worse fault than the shortcut being
   * slightly less obvious, and the buttons on the panel are the discoverable
   * route in any case. Bare keys, so they do not fight anything, and never
   * while a name is being typed.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const on = e.target as HTMLElement | null;
      if (on && (on.tagName === "INPUT" || on.tagName === "TEXTAREA" || on.isContentEditable)) return;
      const next = stepLevel(cellPx, e.key === "]" ? "in" : "out");
      if (!next) return;
      e.preventDefault();
      jumpTo(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cellPx, jumpTo]);

  const commit = useCallback((
    cells: Map<string, Cell>,
    newParent?: { id: string; parentId: string },
    anchorId?: string,
  ) => {
    remember();
    setMoves((prev) => {
      const next = new Map(prev);
      for (const [id, cell] of cells) next.set(id, cell);
      return next;
    });
    if (anchorId) setPinned((prev) => new Set(prev).add(anchorId));
    if (newParent) {
      setReparents((prev) => new Map(prev).set(newParent.id, newParent.parentId));
    }
    setTidyStage(0); // a hand has been in it again
  }, [remember]);

  /* --- growing a company from nothing ------------------------------------ */

  /**
   * **This page is for making a company, not for looking at one.**
   *
   * True only for the blank fixture, which hands down no units at all. The
   * rest of the lab is unchanged by everything below: a company that arrived
   * with content never shows the seed and never opens a wizard.
   */
  const growing = org.units.length === 0;

  /**
   * A new id. It used to count from a ref, which was one shared mutable thing
   * more than this needs — and a ref read from anything the menu touches is
   * enough for the compiler's rules to call the whole menu a render-time ref
   * access. The clock and five random characters are unique enough for ids
   * that live in one browser tab.
   */
  const makeId = useCallback((kind: Born["kind"]) => {
    // People keep the fixture's own prefix so nothing downstream has to learn
    // that there are two ways to be a person.
    const stamp = Date.now().toString(36);
    return `${kind === "person" ? "person" : "place"}:born-${stamp}-${Math.random().toString(36).slice(2, 7)}`;
  }, []);

  /**
   * **Born in the hand's layer.** A created node's cell goes into `moves` and
   * its id into `pinned`, which is what makes Greg's instruction true without
   * suspending a law: under Law 0 the engine may not move either, so no driver
   * has an opinion about where a grown company sits.
   *
   * **And everything already on the map stays where it is** — `settle`, which
   * carries the reasoning. Without it, making one node on a five-unit company
   * re-laid four of them, because the layout is a pure function of the whole
   * tree and one more unit is a different tree. Tidy is the way back.
   */
  const placeBorn = useCallback((id: string, cell: Cell) => {
    setMoves((m) => settle(allocation.cells, m, syntheticRoot ? tree.rootId : null).set(id, cell));
    setPinned((p) => new Set(p).add(id));
  }, [allocation, syntheticRoot, tree]);

  const [wizard, setWizard] = useState<{ id: string; step: number } | null>(null);

  /** The first click on blank paper makes a **human** — not a company. */
  const seedPerson = useCallback(() => {
    remember();
    const id = makeId("person");
    setBorn((b) => [...b, { id, kind: "person", name: null, role: null, purpose: null, parentId: null }]);
    placeBorn(id, ORIGIN);
    setWizard({ id, step: 0 });
    setLookAgain(true);
  }, [makeId, placeBorn, remember]);

  const describe = useCallback((id: string, patch: Partial<Born>) => {
    setBorn((b) => b.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  /**
   * **The reveal.** On *"yes, they have teammates"* the GUI creates two nodes
   * at once — a **parent** (the team) and a **sibling** (the teammate) — and
   * the person who answered steps aside to make room between them.
   *
   * The team is **discovered, not declared**. That is the whole point of the
   * sequence, and it is why the create-a-person flow deliberately never asks
   * which team somebody is in: asking would mean the team already existed, and
   * the reveal would be dead.
   *
   * On a lattice this is exact in a way the orbital study could not be. There,
   * a new node arrived at an angle that had to be remembered or the siblings
   * would spin round their parent; here the team takes the cell the person was
   * standing on and the two humans step to either side of it.
   */
  const formTeam = useCallback(() => {
    const lone = born.find((b) => b.kind === "person" && b.parentId === null);
    if (!lone) return;
    remember();
    const at = moves.get(lone.id) ?? ORIGIN;
    const teamId = makeId("place");
    const mateId = makeId("person");
    const around = neighbours(at);
    const mine = around[3];   // west
    const theirs = around[0]; // east
    setBorn((b) => [
      ...b.map((n) => (n.id === lone.id ? { ...n, parentId: teamId } : n)),
      { id: teamId, kind: "place", name: null, role: null, purpose: null, parentId: null },
      { id: mateId, kind: "person", name: null, role: null, purpose: null, parentId: teamId },
    ]);
    setMoves((m) => new Map(m).set(teamId, at).set(lone.id, mine).set(mateId, theirs));
    setPinned((p) => new Set(p).add(teamId).add(mateId));
    // Both arrivals are still asking for something, so neither gets a wizard
    // opened on it: the breathing nodes are the invitation.
    setWizard(null);
    setLookAgain(true);
  }, [born, moves, makeId, remember]);

  /* --- making things ------------------------------------------------------ */

  /**
   * **Somewhere to stand**, next to `from` and as near `toward` as the ground
   * allows. A new node has to arrive on a free cell, and the direction it
   * prefers is the whole difference between a parent and a child: Law 3 puts
   * children outward, so a child aims away from the centre and a new parent
   * aims back towards it.
   */
  const freeNear = useCallback((from: Cell, toward: Cell | null): Cell | null => {
    const free = (c: Cell) => !allocation.occupants.has(cellKey(c));
    const sorted = (cells: Cell[]) =>
      toward ? [...cells].sort((a, b) => hexDistance(a, toward) - hexDistance(b, toward)) : cells;
    for (let radius = 1; radius <= 8; radius++) {
      for (const c of sorted(ring(from, radius))) if (free(c)) return c;
    }
    return null;
  }, [allocation]);

  /**
   * **A node, made where somebody pointed.**
   *
   * The whole of the grow study's lesson, on a lattice: *the cell you point at
   * is the position*. It is born in the hand's layer like everything else that
   * is made here, so no driver has standing to move it, and its wizard opens
   * straight away because a node nobody has described is not yet anything.
   */
  const makeNode = useCallback((kind: Born["kind"], parentId: string | null, cell: Cell) => {
    remember();
    const id = makeId(kind);
    setBorn((b) => [...b, { id, kind, name: null, role: null, purpose: null, parentId }]);
    placeBorn(id, cell);
    setWizard({ id, step: 0 });
    setMenu(null);
    // **The first thing on blank paper re-frames the view**, exactly as the
    // seed button does. Until something exists the whole screen is inside one
    // cell, because a map with nothing on it has nothing to set a scale by —
    // so the node that arrives is drawn the size of the glass until the camera
    // is told to look again.
    //
    // **Only there.** On a company that already has something on it the camera
    // stays put: moving the view out from under somebody who is building is
    // worse than anything it would fix, and the first version of this re-framed
    // the whole of Sparrow Jam the moment one person was added to a team.
    if (growing && !born.length) setLookAgain(true);
  }, [growing, born, makeId, placeBorn, remember]);

  /**
   * **Something above a node** — the one creation that cannot be done by
   * pointing, and the reason the node menu exists at all.
   *
   * A child goes in a cell; a parent is a rung. There is nowhere spatial to
   * say *above*, so it is said here instead: the new place takes the node's
   * own parent, and the node becomes its child. The reparent goes through the
   * same override every other reparent uses, so nothing downstream learns a
   * second way for a parent to change.
   */
  const makeAbove = useCallback((unitId: string) => {
    const at = hexScene?.hex.cells.get(unitId);
    if (!at || unitId === tree.rootId) return;
    const cell = freeNear(at, ORIGIN);
    if (!cell) return;
    remember();
    const id = makeId("place");
    const parentId = tree.units.get(unitId)?.parentId ?? null;
    setBorn((b) => [...b, { id, kind: "place", name: null, role: null, purpose: null, parentId }]);
    placeBorn(id, cell);
    setReparents((r) => new Map(r).set(unitId, id));
    setWizard({ id, step: 0 });
    setMenu(null);
  }, [hexScene, tree, freeNear, makeId, placeBorn, remember]);

  /**
   * **Taking a node off the map**, and everything under it with it.
   *
   * Greg, 2026-10-21, choosing to build this now rather than leave it to undo:
   * a map where making something costs two clicks and unmaking it costs
   * nothing but luck fills up with accidents. It asks first, like a merge
   * does, because a branch is a lot to lose by mistake — and undo brings it
   * all back, which is what the dialog says.
   *
   * The hand's own layers are cleaned out at the same time. A placement left
   * behind for a unit that no longer exists is only waiting to be stamped onto
   * somebody else's cell if that id ever comes back.
   */
  const removeBranch = useCallback((unitId: string) => {
    const ids = branchOf(tree, unitId);
    remember();
    setRemoved((prev) => new Set([...prev, ...ids]));
    setBorn((b) => b.filter((n) => !ids.has(n.id)));
    const without = <T,>(map: Map<string, T>) => {
      const next = new Map(map);
      for (const id of ids) next.delete(id);
      return next;
    };
    // Taking a branch off the map is a different tree too, so the rest of the
    // company would re-lay around the hole exactly as it does when something
    // is made — see `settle`. It stays where it is instead, and the hole
    // closes on the next tidy.
    setMoves((m) => without(settle(allocation.cells, m, syntheticRoot ? tree.rootId : null)));
    setReparents(without);
    setPinned((p) => {
      const next = new Set(p);
      for (const id of ids) next.delete(id);
      return next;
    });
    setPending(null);
    setMenu(null);
  }, [tree, allocation, syntheticRoot, remember]);

  /**
   * **One place decides where a picked-up branch's children go.**
   *
   * There were three. The atlas re-laid the branch as a company of its own and
   * `restBranch` translated the finished body under the hand; `placeIsland` had
   * a `radiateFrom` path that re-flowed the branch itself and was already
   * unreachable from this gesture; and the radial driver had inherited the
   * first of those, which is what made a picked-up node *its own master centre*
   * — the behaviour Greg retired on 2026-10-17.
   *
   * Under the radial driver it is now `deferBranch`: the branch is laid in the
   * **map's own frame**, the node stays exactly where the hand let go, and how
   * much its descendants answer to the master centre falls off with how far the
   * hand has taken it from where its rung belongs. The atlas keeps the old path
   * unchanged — it has no ring floors and so nothing to defer to.
   */
  const reLay = useCallback(
    (
      unitId: string,
      at: Cell,
      afar?: BranchShape | null,
    ): { cells: Map<string, Cell>; deference: number | null; afar: BranchShape } | null => {
      if (driver === "radial") {
        const laid = deferBranch({
          tree, anchorId: unitId, hand: at,
          afar: afar ?? undefined,
          // The master centre's own answer, never the arrangement pasted over
          // it: deference is measured against what the engine would do, so a
          // second pick-up of the same node is derived afresh rather than from
          // the last drop.
          calculated: baseAllocation.cells,
          occupants: allocation.occupants,
          floors: baseAllocation.floors ?? [],
          tier: baseAllocation.tier,
          people: peopleIds,
          leads: leadIds,
          taper,
        });
        return { cells: laid.cells, deference: laid.deference, afar: laid.afar };
      }
      const home = tree.units.get(unitId)?.parentId ?? null;
      const homeCell = home ? hexScene?.hex.cells.get(home) ?? null : null;
      const grabbed = hexScene?.hex.cells.get(unitId);
      const shape = relayBranch({
        tree, anchorId: unitId,
        homeward: homeCell && grabbed
          ? { q: homeCell.q - grabbed.q, r: homeCell.r - grabbed.r }
          : null,
        leads: leadIds, people: peopleIds, compass,
      });
      if (!shape) return null;
      const moving = new Set(branchOf(tree, unitId));
      const rested = restBranch(shape.cells, at, allocation.occupants, moving);
      return rested
        ? { cells: rested.cells, deference: null, afar: { offsets: shape.cells, radius: shape.radius } }
        : null;
    },
    [driver, tree, baseAllocation, allocation, peopleIds, leadIds, compass, hexScene, taper],
  );

  // --- drawing -------------------------------------------------------------

  /** Nothing has been made yet, so there is nothing to draw. */
  const blankPaper = growing && born.length === 0;

  /** Nodes still waiting to be told something. They breathe. */
  const unfinished = useMemo(
    () => new Set(born.filter((b) => stillNeeds(b) !== null).map((b) => b.id)),
    [born],
  );

  /**
   * **A clock, and only while the hand is resting on somebody.**
   *
   * The neck below grows over the dwell, and nothing else repaints while the
   * hand is perfectly still — a pointer that has stopped sends no events, so
   * the arming would freeze half-drawn at exactly the moment it is saying
   * something. This ticks while `heldOver` is set and stops dead the instant it
   * is not, which is the only way a loop earns its keep against the iPad in
   * AGENTS.md.
   */
  const [pulse, tick] = useState(0);
  const holding = drag?.heldOver ?? null;
  /** The clock runs while the hand rests on somebody, or while anything is
   *  still asking to be described — and stops dead otherwise. */
  const beating = Boolean(holding) || unfinished.size > 0 || menu !== null;
  useEffect(() => {
    if (!beating || still) return;
    let raf = 0;
    const step = () => { tick((n) => n + 1); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [beating, still]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const { scale } = camera;
    const view = cullBox(camera, size);
    const hexSize = hexScene?.hex.size ?? 1;

    /**
     * **The zoom ladder, read fresh every frame from the live camera.**
     *
     * One number in — how many pixels a cell covers on the glass — and out of
     * it comes how much a person reads as themselves, how much any single tile
     * reads at all, whether a tile carries its own name, and which rung of the
     * hierarchy currently draws as a place of its own. Every figure is a
     * continuous curve, so detail morphs rather than switching on.
     *
     * The lattice makes this nearly free: cells do not move when you zoom, so
     * unlike the orbital map nothing has to animate position. Only presence and
     * colour cross-fade, which is also why it should hold up on the old iPad in
     * AGENTS.md.
     */
    const px = cellPxOf(hexSize, scale);
    const reveal = hexRevealAt(px);
    const place = placePresence(footprints, scale);

    /**
     * **A team is the innermost place, and it hands itself outward.**
     *
     * `place.get(0)` is 1 everywhere you can see a team properly, which is
     * every zoom this map had before the ladder existed — so close in, nothing
     * here changed. Pull back far enough that a team is a smudge and it falls
     * away, while the rung outside it takes the ground above. That handover is
     * the whole ladder, and a team is simply its first rung.
     */
    const teamPlace = teamOutlines.length > 0 ? (place.get(0) ?? 1) : 0;
    /**
     * **How much of this team's job the regions outside it have taken over** —
     * added up, not the largest of them. A handover crossfades across two
     * rungs, so the largest single share through the middle of one is a half,
     * and a team that steps aside by that much is still half there under the
     * blob that has taken over from it. See `placeTaken`.
     */
    const takenOver = (teamId: string) =>
      placeTaken(place, teamCover.get(teamId) ?? []);
    /** So a team's ground is whichever is stronger: its own rung being the
     *  place, or nobody outside it having taken that job on. */
    const groundOf = (teamId: string) => Math.max(teamPlace, 1 - takenOver(teamId));
    /**
     * **Team colour carries the people as their tiles disappear.** `tiles` is
     * fully present by about 0.05× on this lattice, where the team ground is
     * 30% opaque — light enough that the palest chain inside the team still
     * reads against it. Pull out through the tile fade and it darkens
     * continuously toward 90% of the owning team node's colour, by which
     * point those chains have gone and the colour is doing the work alone.
     */
    const teamGroundOpacity = TEAM_GROUND_OPACITY_NEAR
      + (TEAM_GROUND_OPACITY_FAR - TEAM_GROUND_OPACITY_NEAR) * (1 - reveal.tiles);
    // The edge is already ten per cent darker in lightness; sharing the fill's
    // alpha keeps the whole `teamOutlines` material at the requested opacity.
    const teamEdgeOpacity = teamGroundOpacity;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    /**
     * **Blank paper is blank.** With nothing in it, `buildOrbitalTree`
     * synthesises a root so that the rest of the engine always has one — and
     * drawing it put a single enormous cell behind the "start here" button,
     * which is a company nobody made. The tree keeps its root; the canvas
     * simply has nothing to say until somebody makes something.
     */
    if (blankPaper) return;
    ctx.save();
    ctx.transform(scale, 0, 0, scale, camera.x, camera.y);

    const visible = scene.units.filter(
      (u) => u.x >= view.minX && u.x <= view.maxX && u.y >= view.minY && u.y <= view.maxY,
    );
    const visibleIds = new Set(visible.map((u) => u.id));
    const hueFor = (id: string) => hueById.get(id) ?? 0;
    /** The weight already used by the connection immediately beside a node.
     * Host outlines read as part of that line rather than as another border,
     * so this is deliberately shared by both painters. */
    const chainWidth = (depth: number) =>
      Math.max(0.6, hexSize * CHAIN_WEIGHT * nodeScale(depth, maxDepth));
    const adjacentConnectionWidth = (id: string, depth: number) =>
      leadIds.has(id) ? Math.max(1.2, hexSize * LEAD_WEIGHT) : chainWidth(depth);
    /** A person wears the exact colour of the first organisational node above
     * them, including that node's tone rather than the person's paler rung. */
    const colourOwnerOf = (id: string) => {
      let owner = scene.unitById.get(id);
      while (owner && peopleIds.has(owner.id) && owner.parentId) {
        const parent = scene.unitById.get(owner.parentId);
        if (!parent) break;
        owner = parent;
      }
      return owner;
    };
    /** The cell's own hexagon, full size — the container. */
    const hexPath = (cell: Cell) => {
      const pts = corners(cell, hexSize);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };

    /**
     * The node inside the cell, concentric. Sized by how deep the unit sits —
     * except for a person, who is always the base size, because depth grades a
     * structure and a person is not one.
     */
    /**
     * **A hexagon with its corners rounded by `NODE_CORNER` of an edge** —
     * the shape of everything *active*, whatever size it is drawn at.
     *
     * Walking the edge *midpoints* and letting `arcTo` cut each corner is
     * what keeps this honest: `arcTo` runs a line to where the corner's
     * circle first touches the edge and then the arc, so the straight part of
     * every edge is whatever the rounding leaves, never guessed. A midpoint is
     * always at least the tangent distance from the corner while the radius
     * stays under `0.866` of an edge, so the path cannot overshoot itself
     * however small the thing is drawn.
     */
    const roundedHex = (centre: Point, radius: number, corner = NODE_CORNER) => {
      ctx.beginPath();
      traceRounded(ctx, { points: cornersAt(centre, radius), closed: true }, radius * corner);
    };

    /**
     * **How much comes off an active hexagon so it never touches its
     * neighbour** — `ACTIVE_GAP` and its two clamps, in world units.
     *
     * Two neighbouring cells are `√3 · size` apart centre to centre, and a
     * tile's flat edge is `√3/2 · radius` from its own centre, so a tile drawn
     * at the full size of its cell meets its neighbour exactly. Taking `i` off
     * the radius opens `√3 · i` of ground between the two, which is where the
     * √3 below comes from: the pixel floor is a gap on the glass, and this
     * turns it back into a radius.
     */
    const activeInset = Math.min(
      hexSize * ACTIVE_GAP_MAX,
      Math.max(hexSize * ACTIVE_GAP, ACTIVE_GAP_PX / scale / Math.sqrt(3)),
    );
    /** The same thing as a factor, for everything drawn *inside* a cell —
     *  Greg: *"and proportionally everything within them"*. */
    const activeShrink = hexSize > 0 ? 1 - activeInset / hexSize : 1;

    /**
     * **How big a node's own mark is, and what that says about it.** Greg,
     * 2026-11-07, replacing the even grading by rung with four statements:
     *
     * - a **person** is small — half the old floor, and a circle;
     * - a **team** *"should now fill their host cell"*, so it is the cell;
     * - a **place above a team** overflows its cell by half a radius, a fixed
     *   amount whatever it holds (`PLACE_SPAN`);
     * - the **master centre** *"should be huge"*, at `MASTER_SPAN` cell radii.
     *
     * The old `nodeScale` grading — every rung a step bigger than the one
     * below — has gone from everything except a person's floor. Size used to
     * say *how senior*; it now says *what kind of thing this is*, which is a
     * question the eye can actually answer at a glance.
     *
     * Everything still multiplies by `activeShrink`, so the clear ground an
     * active hexagon keeps is kept whatever the rule.
     *
     * **A place above a team is a team-level node that has been drawn
     * bigger, and that is all.** Two richer readings were tried first and
     * both are written up in `docs/HEX-LAYOUT.md`: drawing the node *as* its
     * region's own path, which costs 3.3 seconds a frame because stroking the
     * boundary of thousands of cells is nothing like filling it; and growing
     * it in proportion to its region, which put eight screen-wide hexagons
     * over each other on the eight-rung company. Greg's answer to both was to
     * make it a constant.
     */
    const markRadius = (id: string, depth: number): number => {
      if (peopleIds.has(id)) {
        return hexSize * nodeScale(maxDepth, maxDepth) * PERSON_MARK * activeShrink;
      }
      void depth;
      const span = structuralNodeSpan(id, tree.rootId, peopleIds, allocation.tier);
      // A team still keeps the active-cell gap. Larger places deliberately
      // overflow, and their bubbles now make room for that same span.
      return hexSize * span * (span <= 1 ? activeShrink : 1);
    };

    const nodePath = (cell: Cell, id: string, depth: number, shrink = 1) => {
      const person = peopleIds.has(id);
      // A person is the dial at its limit, which is a circle — `PERSON_CORNER`.
      // The tile behind them stays a hexagon, and so does every place.
      roundedHex(
        cellToWorld(cell, hexSize),
        markRadius(id, depth) * shrink,
        person ? PERSON_CORNER : NODE_CORNER,
      );
    };


    /**
     * **The active hexagon's host**, which is the whole cell behind the mark.
     * Structural cells use the unit's colour; a person's is white glass.
     * Greg, 2026-11-05: *"this border, which is a hexagon layer
     * sitting behind the active hexagon, should also be rounded"* — and it is
     * not an **area** hexagon, however it is sized: an area hexagon is grey
     * ground, this one takes the colour of whoever stands on it, so it reads
     * as part of the thing rather than the room around it. Same shape as the
     * node it sits behind, therefore, at the size of the cell less the clear
     * ground every active hexagon keeps — see `activeInset`, which is what
     * stops two of these ever touching.
     */
    const washPath = (cell: Cell, person = false) =>
      roundedHex(
        cellToWorld(cell, hexSize),
        (hexSize - activeInset) * (person ? PERSON_TILE : 1),
        person ? PERSON_TILE_CORNER : NODE_CORNER,
      );

    /**
     * **A chain, with its knees rounded.** Greg, 2026-11-06: *"put a nice
     * gentle curve on the connection lines where they currently knee — make
     * the curve radius equal to one hexagon cell radius."*
     *
     * The router walks the lattice, so every corner is a 60° turn and a
     * mitred join made each one a visible elbow. One cell's radius barely
     * cuts the corner — the arc passes `size · (1/sin60° − 1)`, about a
     * seventh of a cell, inside the point — while taking `size / tan60°`, a
     * little over half a cell, off each leg. Gentle is exactly the word.
     *
     * **Clamped per corner, because a leg can be shorter than the arc wants.**
     * The tangent point sits `r / tan(θ/2)` back from the corner, so a radius
     * the legs cannot pay for would put it *past* the far end and the line
     * would double back on itself. Each corner therefore takes the largest
     * radius that fits in half of its shorter leg — half, so two corners on
     * one leg never reach across each other — and a line that doubles back
     * (θ→0) rounds to nothing and stays a corner, which is honest: there is
     * no room there for a curve.
     *
     * No `beginPath` of its own: the route home traces several chains into a
     * single path and strokes it twice, for a casing under a core.
     */
    const traceElbows = (points: readonly Point[], radius: number) => {
      const n = points.length;
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < n - 1; i++) {
        const back = points[i - 1], at = points[i], on = points[i + 1];
        const ax = back.x - at.x, ay = back.y - at.y;
        const bx = on.x - at.x, by = on.y - at.y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 1e-6 || lb < 1e-6) continue;
        const theta = Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb))));
        const fits = (Math.min(la, lb) / 2) * Math.tan(theta / 2);
        ctx.arcTo(at.x, at.y, on.x, on.y, Math.min(radius, fits));
      }
      if (n > 1) ctx.lineTo(points[n - 1].x, points[n - 1].y);
    };

    /**
     * **How far a chain actually travels**, and the knee radius that length
     * earns it — `KNEE_BY_LENGTH`, read in cell radii.
     */
    const kneeFor = (points: readonly Point[]) => {
      let travelled = 0;
      for (let i = 1; i < points.length; i++) {
        travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      const step = KNEE_BY_LENGTH.find((s) => travelled <= s.within * hexSize);
      return hexSize * (step?.radii ?? 1);
    };

    // 1. The bubbles. Greg, 2026-10-16: *"concentric toruses comprised of shaded
    //    hexagon zones offset from master-center"*, and *"a bubble is taken as
    //    the shape of the contained node then offset wider by one hexagon
    //    spacing."*
    //
    //    Under everything, because a bubble is the ground a group stands on
    //    rather than a thing in its own right — Greg: *"bubbles are visually
    //    meaningful but currently do not connote any other functional
    //    significance."*
    //
    //    Outermost first, so a division's wash goes down before the teams nested
    //    inside it and the small ones stay legible. The fill is deliberately
    //    nearly nothing: on an eleven-rung company a leaf cell sits inside ten
    //    bubbles, and anything you can comfortably see once is a black smudge
    //    ten times over. It is the *edges* that carry the reading, and they are
    //    drawn at a weight that grows with the tier, so the eye gets the size of
    //    a region from the weight of its line before it can read a label.
    /**
     * **The rung that is the place is painted last.**
     *
     * Region grounds used to go down before the teams, which is the order the
     * hierarchy is in and the wrong order for the eye. Pulled right out on the
     * thousand-person company, a team is 27px across — a dot — and 165 of
     * those dots were being painted *over* the divisions that had taken the
     * map, so what you saw was a scatter of team patches and no company. Greg,
     * 2026-11-06: *"the org unit cluster hasn't blobbed together like the
     * teams have, even though there are area outlines to enable it."*
     *
     * So the rule is the ladder's own: whichever rung is currently the place
     * is the subject, and the subject is on top. Close in that changes
     * nothing, because `solid` is zero for every region there and the list
     * below stays empty.
     */
    const solidBlobs: { bubble: (typeof bubbles)[number]; shape: Path2D; solid: number }[] = [];
    if (bubbles.length > 0) {
      for (const bubble of bubbles) {
        const { box } = bubble;
        if (box.maxX < view.minX || box.minX > view.maxX) continue;
        if (box.maxY < view.minY || box.minY > view.maxY) continue;
        /**
         * **A bubble fades in with its size on screen rather than switching on.**
         *
         * Drawn flat, every rung's bubble is painted at every zoom — twelve of
         * them nested on the largest company — and the overview turns into a
         * thicket of boundaries with no hierarchy in it, which is the confetti
         * fault wearing a new coat. A hard cut-off instead makes regions pop in
         * and out as the camera moves, which is worse.
         *
         * So the weight follows how big the thing actually is in front of you:
         * nothing under 48px, full strength by 160px. At overview only the
         * divisions carry a line, and the teams arrive as you come down to them.
         * It is the same idea as the territory wash below, which fades out as
         * the nodes take over.
         */
        const onScreen = Math.max(box.maxX - box.minX, box.maxY - box.minY) * scale;
        const weight = smoothstep(48, 160, onScreen);

        /**
         * **And how much this rung is *the* place right now** — the zoom
         * ladder's recursion, which is what makes a conglomerate the same
         * mechanism as a team instead of a sixth special case.
         *
         * Greg, 2026-11-06: *"then there's companies, which would bubble all
         * teams on the same branch together as a super-gummy bear blob."* That
         * is this: when a rung is big enough to read and the rung inside it has
         * become too small to bother with, this rung takes the ground and the
         * edge a team takes when you are close in, and the teams inside it fade
         * into it. Pull back another step and the same thing happens one rung
         * further out, for as many rungs as the company has.
         */
        const solid = place.get(bubble.tier) ?? 0;
        if (weight <= 0 && solid <= 0.004) continue;

        const shape = areaPaths.blobs.get(bubble.unitId);
        if (!shape) continue;
        const hue = hueFor(bubble.unitId);
        if (weight > 0) {
          ctx.fillStyle = css(hue, bubble.depth, maxDepth, 0.05 * weight);
          ctx.fill(shape, "evenodd");
        }
        /**
         * **A region's own ground is not drawn here** — it waits until after
         * the teams, in `1d`. The wash above is context and belongs under
         * everything; the ground is the region *being the place*, and the
         * place goes on top.
         */
        if (solid > 0.004) solidBlobs.push({ bubble, shape, solid });

        /**
         * **No line round a region** (Greg, 2026-10-16): *"there are borders
         * around the bubbles — they don't need to be there."*
         *
         * They were there for one afternoon, drawn as an atlas draws them: a
         * coastline in the region's own hue and a frontier between two regions
         * in neutral ink. The measurement that came out of it is worth keeping
         * even though the lines are not — on Northwind's teams view the atlas
         * driver is **0.3%** frontier and radial is **22%**, which says the
         * atlas draws islands with sea between them and radial draws a continent
         * of countries that meet. The wash alone carries the region, and twelve
         * nested outlines carried a thicket.
         */
      }
    }

    // 1b. The clear hexagon round each team, and the ring round a group of
    //     them. Greg, 2026-10-18: the spacing is *"a faint grey, just darker
    //     than the background, regardless of what colour a team has"*, and the
    //     group's is *"a grey between the background and the team outline"*.
    //     Drawn over the region washes on purpose: these cells are room, not
    //     territory, and they should read as the same room everywhere.
    /**
     * **Grey is fixed material, not part of the zoom handover.** The remaining
     * spacing ground stays `#f6f6f6` at full opacity at every rung. The outer
     * group zone uses the same material if `SHOW_OUTERMOST_ZONE` is restored,
     * but that layer is switched off for now.
     */
    if (areaPaths.rings) {
      ctx.fillStyle = "#f6f6f6";
      ctx.fill(areaPaths.rings, "evenodd");
    }
    if (areaPaths.spacers) {
      ctx.fillStyle = "#f6f6f6";
      ctx.fill(areaPaths.spacers, "evenodd");
    }
    /**
     * **The silhouette of the whole, and nothing inside it.**
     *
     * Greg, 2026-10-18: *"where two large zones touch, there should not be an
     * outline."* Not a quieter line, not one line instead of two — none. So the
     * only edges here are the ones with background on the other side; two
     * groups that meet simply become one shape, which is what *bubbling
     * together* means.
     */
    if (areaPaths.rings) {
      ctx.lineWidth = Math.max(0.6, 1.6 / scale);
      ctx.strokeStyle = "rgba(15,23,42,0.16)";
      ctx.stroke(areaPaths.rings);
    }

    /**
     * **The ground a team stands on, in its organisational node's colour** —
     * the last of the area hexagons, and the only one that is not grey.
     *
     * It goes down after every grey and before the first active cell, so every
     * node still lands on top. The earlier descendant average was replaced on
     * 2026-11-07: the owner is now the colour source, and the fill is true
     * translucent colour rather than an opaque colour pre-mixed with paper.
     *
     * It is one `Path2D` from the same stitched boundary as the hover outline,
     * so its fill and its single stroke cannot expose internal cell edges.
     */
    if (teamOutlines.length > 0) {
      ctx.lineWidth = Math.max(0.7, 2.2 / scale);
      for (const team of teamOutlines) {
        const tint = teamTints.get(team.teamId);
        const ground = groundOf(team.teamId);
        const shape = areaPaths.teams.get(team.teamId);
        if (!shape || !tint || ground <= 0.004) continue;
        ctx.fillStyle = tint.fill(ground, teamGroundOpacity);
        ctx.fill(shape, "evenodd");
        ctx.strokeStyle = tint.line(ground, teamEdgeOpacity);
        ctx.stroke(shape);
      }
    }

    // 1d. And the region that has taken over from those teams, over the top of
    //     them — see `solidBlobs`. Outermost first, so a division's ground goes
    //     down before the ones nested inside it.
    if (solidBlobs.length > 0) {
      ctx.lineWidth = Math.max(0.7, 2.2 / scale);
      for (const { bubble, shape, solid } of solidBlobs) {
        const tint = bubbleTints.get(bubble.unitId);
        if (!tint) continue;
        ctx.fillStyle = tint.fill(solid);
        ctx.fill(shape, "evenodd");
        ctx.strokeStyle = tint.line(solid);
        ctx.stroke(shape);
      }
    }

    // 1a. The territory, as a faint wash over the whole cell. It is what makes
    //     a division read as one place from far away, where the nodes are only
    //     a few pixels — so it is strongest pulled back and fades as the nodes
    //     themselves take over.
    if (hexScene) {
      /**
       * **Strongest in the middle of the ladder, and gone at both ends.**
       *
       * It used to be `0.30 − 0.24 · min(1, scale / 1.1)` — world scale, which
       * means nothing on a lattice where every cell is the same size. Two
       * things are true about this wash and the old form only captured one.
       * Close in it should step back, because the tile itself carries who is
       * there: that is the `reveal.people` term, as before. But *pulled right
       * out* it should also go, because a few thousand separate washes fight
       * the blob that is supposed to be carrying the company at that distance
       * — and the old form made it strongest exactly there. `reveal.tiles` is
       * that second half: below about 16px a cell it stops being a thing and
       * becomes texture, and the region's own ground takes over.
       */
      const wash = (0.30 - 0.24 * reveal.people) * reveal.tiles;
      if (wash > 0.02) {
        for (const unit of visible) {
          // A person's own tile goes up last, with the person — see `2d`.
          if (peopleIds.has(unit.id)) continue;
          const cell = hexScene.hex.cells.get(unit.id);
          if (!cell) continue;
          washPath(cell, false);
          ctx.fillStyle = css(hueFor(unit.id), unit.depth, maxDepth, wash);
          ctx.fill();
        }
      }
    }

    // 2. No borders on the tiles themselves. Greg, 2026-09-30: *"grid tiles
    //    (background) should not show borders; but I like that occupied grid
    //    tiles are slightly darker than the aether grid."* The wash above is
    //    the whole of it — an occupied cell is a shade darker than the page and
    //    nothing draws its edges.

    // 2b. The chains. Greg, 2026-09-30: *"sibling nodes should have
    //     self-coloured connection lines that are permanently visible and chain
    //     back to the parent node… the connection lines follow the same
    //     geometry as the hover-state path, but sit behind it on the z axis."*
    //
    //     Each line belongs to the child and wears the child's colour, runs
    //     strictly along the lattice's own angles, and is drawn before the
    //     nodes so it emerges from behind them rather than crossing them. The
    //     trunk is thicker than the twigs, because a line's weight is the one
    //     thing left that can carry standing once every node is the same shape.
    if (hexScene) {
      for (const chain of chains) {
        if (!visibleIds.has(chain.unitId) && !visibleIds.has(chain.parentId)) continue;
        const unit = scene.unitById.get(chain.unitId);
        if (!unit) continue;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Still scaled by the node, so the trunk stays heavier than the twigs.
        ctx.lineWidth = chainWidth(unit.depth);
        /**
         * **A stretch that runs behind somebody is drawn faint.**
         *
         * Greg, 2026-10-15: *"we need to make it so that chaining can run
         * behind existing colleagues — perhaps by fading the colour of the
         * connection line. This should stop a bunch of the spaghetti
         * appearance."*
         *
         * The router now takes those short cuts rather than walking round
         * everybody — see `THROUGH_A_STRANGER` — and this is the other half of
         * the same idea. Without it a line that crosses a tile reads as
         * *through* it, which is the thing that looks like tangle; faded, it
         * reads as going behind, and the eye drops it and picks it up again on
         * the far side.
         */
        const knee = kneeFor(chain.points);
        for (const run of chain.runs) {
          ctx.beginPath();
          traceElbows(run.points, knee);
          ctx.strokeStyle = css(hueFor(chain.unitId), unit.depth, maxDepth, run.under ? BEHIND_ALPHA : 0.95);
          ctx.stroke();
        }
      }
    }

    // 2b-ii. The leadership chain. Greg, 2026-10-03: *"let's put a
    //     stronger-coloured connection line between team leads and their
    //     parent nodes to indicate team leadership roles."* A lead is a person
    //     whose chain goes to a structural node, so the chain itself is the
    //     statement — this one line says "she runs this".
    //
    //     **It moved under the nodes and the people on 2026-11-08.** Greg's
    //     rule for every connection line: above the coloured background zones,
    //     below nodes and human hexagons. This one was the single exception —
    //     drawn after the people, it crossed over the white host ring that the
    //     same day's edge pass had sized to match it, and over the lead's own
    //     face. Ordinary chains had always run underneath. Now both do, so a
    //     line emerges from behind whoever it connects instead of being laid
    //     across them.
    if (hexScene && leadIds.size > 0) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const chain of chains) {
        if (!leadIds.has(chain.unitId)) continue;
        ctx.beginPath();
        traceElbows(chain.points, kneeFor(chain.points));
        ctx.lineWidth = adjacentConnectionWidth(chain.unitId, scene.unitById.get(chain.unitId)?.depth ?? 0);
        ctx.strokeStyle = "rgba(15,23,42,0.85)";
        ctx.stroke();
      }
    }

    // 2c. The nodes themselves, sized by what kind of thing they are rather
    //     than by how senior they are — see `markRadius`. A person is a small
    //     circle, a team fills its cell, a place above a team is its own
    //     region, and the master centre is two cell radii across.
    /**
     * **Biggest first.** The marks now overlap on purpose: the master centre
     * is wider than the distance to its neighbours' centres, and a region
     * covers everything standing inside it. Drawn in `visible` order that
     * would be a lottery — a division painted after its own teams would
     * swallow them. Drawn largest-first, every smaller thing lands on top of
     * the bigger thing that contains it, and the nesting reads as nesting.
     *
     * Sorted on the extent each one will actually draw at, so it keeps itself
     * honest if any of the four rules changes.
     */
    if (hexScene) {
      /**
       * **A big node can be on screen when its own cell is not.** `visible`
       * culls on where a unit *stands*, which was the right question while
       * every node was a mark inside its cell. A place now reaches out to its
       * region's edge, so panning until its own tile left the window would
       * blink it out with most of it still in view. Each one is therefore
       * tested against the window grown by its own reach.
       */
      const extent = new Map<string, number>();
      const drawn = new Map(visible.map((u) => [u.id, u]));
      for (const unit of visible) extent.set(unit.id, markRadius(unit.id, unit.depth));
      for (const unit of scene.units) {
        if (drawn.has(unit.id)) continue;
        const r = markRadius(unit.id, unit.depth);
        if (r <= hexSize) continue;
        if (unit.x + r < view.minX || unit.x - r > view.maxX) continue;
        if (unit.y + r < view.minY || unit.y - r > view.maxY) continue;
        drawn.set(unit.id, unit);
        extent.set(unit.id, r);
      }
      const bySize = [...drawn.values()].sort(
        (a, b) => (extent.get(b.id) ?? 0) - (extent.get(a.id) ?? 0),
      );
      for (const unit of bySize) {
        if (peopleIds.has(unit.id)) continue;
        const cell = hexScene.hex.cells.get(unit.id);
        if (!cell) continue;
        const moving = drag?.members.has(unit.id) ?? false;
        nodePath(cell, unit.id, unit.depth);
        ctx.fillStyle = css(hueFor(unit.id), unit.depth, maxDepth, moving ? 0.22 : 0.97);
        ctx.fill();
        // White separates a structural node from the coloured ground without
        // introducing a second dark boundary into the map.
        if (peopleIds.size > 0) {
          ctx.lineWidth = Math.max(0.8, hexSize * 0.035);
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.stroke();
        }
      }
    }

    /**
     * **2d. And the people, over everything.** Greg, 2026-11-07: *"all human
     * nodes and their host cells should sit on a z-axis point above other
     * nodes, including master centre. That means, in the 1000-person company,
     * Nina Lindqvist would appear to clip into 'a deep enterprise shape'.
     * This is expected."*
     *
     * It is the rule that makes the other three safe. A place now overflows
     * its cell by half a radius and the master centre by three, so a person
     * standing next to one would otherwise be buried by it — and the people
     * are the thing the map is of. Their own tile comes with them, because a
     * circle alone on a place's ground would read as a dot on the place
     * rather than as somebody standing there.
     *
     * Tiles first and then marks, rather than tile-and-mark per person, so
     * that a neighbour's tile can never cover a mark either.
     */
    if (hexScene) {
      const tileAlpha = PERSON_TILE_OPACITY * reveal.tiles;
      const folk = visible.filter((u) => peopleIds.has(u.id));
      if (tileAlpha > 0.02) {
        for (const unit of folk) {
          const cell = hexScene.hex.cells.get(unit.id);
          if (!cell) continue;
          washPath(cell, true);
          ctx.fillStyle = `rgba(255,255,255,${tileAlpha})`;
          ctx.fill();
        }
        // Draw all host fills before any host edge, so a neighbouring host can
        // never paint over the white continuation of its connection line.
        ctx.strokeStyle = `rgba(255,255,255,${reveal.tiles})`;
        for (const unit of folk) {
          const cell = hexScene.hex.cells.get(unit.id);
          if (!cell) continue;
          washPath(cell, true);
          ctx.lineWidth = adjacentConnectionWidth(unit.id, unit.depth);
          ctx.stroke();
        }
      }
      for (const unit of folk) {
        const cell = hexScene.hex.cells.get(unit.id);
        if (!cell) continue;
        const moving = drag?.members.has(unit.id) ?? false;
        const owner = colourOwnerOf(unit.id) ?? unit;
        nodePath(cell, unit.id, unit.depth);
        ctx.fillStyle = css(hueFor(owner.id), owner.depth, maxDepth, moving ? 0.22 : 0.97);
        ctx.fill();
      }
    }

    // 3. Where a dragged branch would land. Greg: *"make the nearest hexagon
    //    grids below them glow or shade faintly indicating where it would land
    //    when the user drops it."*
    //
    //    It stays lit while a dialog is open, because every one of those
    //    dialogs talks about "the highlighted cell" and a promise like that has
    //    to be visible when it is being made.
    // 3a. The offer. A gesture nobody can see is a gesture nobody will find,
    //     so while the window is open the branch that just landed wears a
    //     dashed ring round its governing node: pick me up again.
    if (hexScene && justMoved && !drag && !pending) {
      hexPath(justMoved.at);
      ctx.lineWidth = Math.max(0.8, 2 / scale);
      ctx.strokeStyle = "rgba(13,148,136,0.55)";
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const proposed = drag?.landing ?? (pending && "cells" in pending ? pending.cells : null);
    // Amber is "this is not going in as you drew it". While a drag is live that
    // is the reshape flag; the only dialogs left that carry cells — reshape and
    // blocked — are both saying exactly that, so they are always amber.
    const warn = drag ? drag.reshaped : true;
    // A tree the hand asked for gets its own colour, so the gesture is visibly
    // a different thing from a landing that had to give up its shape.
    const treeing = drag?.radiated ?? false;
    if (hexScene && proposed) {
      for (const cell of proposed.values()) {
        hexPath(cell);
        ctx.fillStyle = treeing
          ? "rgba(13,148,136,0.30)"
          : warn ? "rgba(217,119,6,0.32)" : "rgba(37,99,235,0.28)";
        ctx.fill();
        ctx.lineWidth = Math.max(0.8, 2.6 / scale);
        ctx.strokeStyle = treeing
          ? "rgba(15,118,110,0.95)"
          : warn ? "rgba(180,83,9,0.95)" : "rgba(29,78,216,0.95)";
        ctx.stroke();
      }
    }

    // 3b. **The neck.** Two nodes the hand is pushing together visibly start to
    //     run into one another, and the shape *stays* while the dwell arms,
    //     because the question on screen is about those two. Carried over from
    //     the grow study (2026-09-20), where it was the whole of how a merge
    //     announced itself; what it had and this does not is a merge animation
    //     on commit, which belongs with the choreography and not with the
    //     gesture.
    //
    //     It arms over `HOLD_MS` rather than appearing at the end: a shape that
    //     only exists once the gesture has already succeeded teaches nobody
    //     that the gesture is there.
    if (hexScene && drag?.heldOver && drag.anchor) {
      const here = cellToWorld(drag.anchor, hexSize);
      const theirCell = hexScene.hex.cells.get(drag.heldOver);
      if (theirCell) {
        const there = cellToWorld(theirCell, hexSize);
        // Under reduced motion the shape simply *is* there, at full strength:
        // the gesture still announces itself, it just does not grow.
        const held = still ? 1 : Math.min(1, (performance.now() - drag.holdSince) / HOLD_MS);
        const dx = there.x - here.x;
        const dy = there.y - here.y;
        const span = Math.hypot(dx, dy) || 1;
        const nx = -dy / span;
        const ny = dx / span;
        const midX = (here.x + there.x) / 2;
        const midY = (here.y + there.y) / 2;
        /**
         * **It pinches in the middle**, which is the whole of why a metaball
         * reads as two things running together rather than as a bar joining
         * them: the ends flare into each node and the isthmus between is
         * narrower than either. It swells as the dwell completes — a thread
         * while you could still be passing through, half a node's width once
         * the choice is armed.
         */
        const flare = hexSize * 0.40;
        const waist = hexSize * (0.07 + 0.21 * held);
        // A quadratic sits at (P0 + 2C + P2)/4 halfway along, so this is the
        // control point that puts the curve exactly on the waist there.
        const bend = 2 * waist - flare;
        ctx.beginPath();
        ctx.moveTo(here.x + nx * flare, here.y + ny * flare);
        ctx.quadraticCurveTo(midX + nx * bend, midY + ny * bend,
          there.x + nx * flare, there.y + ny * flare);
        ctx.lineTo(there.x - nx * flare, there.y - ny * flare);
        ctx.quadraticCurveTo(midX - nx * bend, midY - ny * bend,
          here.x - nx * flare, here.y - ny * flare);
        ctx.closePath();
        ctx.fillStyle = `rgba(109,40,217,${0.18 + 0.34 * held})`;
        ctx.fill();
        ctx.lineWidth = Math.max(0.8, 2 / scale);
        ctx.strokeStyle = `rgba(91,33,182,${0.35 + 0.5 * held})`;
        ctx.stroke();
      }
    }

    // 3c. **A node breathes until it is described, not until it is named.**
    //     The grow study's rule, 2026-09-19: "named but no role" is still an
    //     empty node. The halo rides on `fill` rather than a stroke, because a
    //     stroke is a screen width and this wants to read as the cell itself
    //     being unfinished.
    if (hexScene && unfinished.size > 0) {
      const beat = still ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 620);
      for (const id of unfinished) {
        const cell = hexScene.hex.cells.get(id);
        if (!cell) continue;
        hexPath(cell);
        ctx.fillStyle = `rgba(234,88,12,${0.10 + 0.16 * beat})`;
        ctx.fill();
        ctx.lineWidth = Math.max(0.8, 2.2 / scale);
        ctx.strokeStyle = `rgba(194,65,12,${0.45 + 0.35 * beat})`;
        ctx.setLineDash([5 / scale, 4 / scale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 4. The chunky outline round everything meta-connected — rule 8's answer
    //    to an exclave, instead of a tether. Exact on a lattice: an edge is on
    //    the boundary when the cell across it is not in the set.
    const focusId = drag?.unitId ?? hover;
    const focusUnit = focusId ? tree.units.get(focusId) : null;
    const parentId = focusUnit?.parentId ?? null;
    const siblingIds = parentId
      ? new Set((tree.units.get(parentId)?.childIds ?? []).filter((id) => id !== focusId))
      : new Set<string>();
    const childIds = new Set(focusUnit?.childIds ?? []);

    if (hexScene && focusId) {
      // The whole branch when the tile runs something; its parent and siblings
      // when it runs nothing. See `hoverGroup`.
      const family = hoverGroup(tree, focusId);
      const cells = [...family].map((id) => hexScene.hex.cells.get(id)).filter(Boolean) as Cell[];
      if (cells.length) {
        /**
         * **Rounded to match everything else active** (Greg, 2026-11-05). This
         * is the one active outline that is not a hexagon: where a family's
         * cells touch it wraps several of them, so it has corners that bite
         * inward as well as corners that stick out. Hence the stitching —
         * `outline` gives edges, and rounding needs to know which edge comes
         * next. The radius is the same fraction of an edge as a node's, and a
         * cell edge is `hexSize`.
         */
        ctx.beginPath();
        for (const loop of boundaryLoops(outline(cells, hexSize), hexSize)) {
          traceRounded(ctx, loop, hexSize * NODE_CORNER);
        }
        ctx.lineWidth = Math.max(1.5, 5 / scale);
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(15,23,42,0.85)";
        ctx.stroke();
      }
    }

    // 5. Who is family, at a glance. Greg, 2026-09-30: *"when I hover on a
    //    tile, its siblings should grow a white border too, and it should be
    //    apparent who the parent tile is."*
    //
    //    Four treatments, in descending weight: the tile you are pointing at,
    //    the parent (heaviest, because it is the answer to the question), the
    //    siblings, and the children in a dashed line so they read as the other
    //    direction rather than more of the same.
    if (hexScene && focusId) {
      // The bands follow the *node*, not its container — the node is the thing
      // a person is pointing at now that the two are different sizes.
      const band = (id: string, width: number, dash: number[] = []) => {
        const cell = hexScene.hex.cells.get(id);
        const unit = scene.unitById.get(id);
        if (!cell || !unit) return;
        ctx.setLineDash(dash.map((d) => d / scale));
        ctx.lineWidth = Math.max(0.8, width / scale);
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        // The person flag matters here since 2026-11-07: a human's mark is
        // half the size, and a band drawn without it would ring empty ground.
        nodePath(cell, id, unit.depth);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      for (const id of siblingIds) band(id, 2.6);
      for (const id of childIds) band(id, 2.6, [7, 5]);
      band(focusId, 4);
      if (parentId) {
        // The parent wears the white band and a dark one just inside it, so it
        // is the one tile in the family you cannot mistake for another.
        band(parentId, 5);
        const cell = hexScene.hex.cells.get(parentId);
        const parent = scene.unitById.get(parentId);
        if (cell && parent) {
          // Concentric with the node, inside its white band. `nodePath` takes
          // the centre at the real cell size and only shrinks the radius —
          // shrinking through `corners` would move the centre too, which is
          // what left this band floating off its tile on 2026-09-30.
          nodePath(cell, parentId, parent.depth, 0.86);
          ctx.lineWidth = Math.max(0.8, 2.6 / scale);
          ctx.strokeStyle = "rgba(15,23,42,0.9)";
          ctx.stroke();
        }
      }
    }

    // 6. The route home, on demand rather than always — which is what replaced
    //    the connection lines. It runs strictly along the lattice's own angles
    //    (30°, 90°, 150° and their opposites), so it lies parallel to an edge
    //    of every hexagon it crosses instead of cutting across them. A white
    //    casing under a dark core keeps it readable over both a near-black
    //    executive tile and a pale wash one.
    if (hexScene && focusId) {
      const home = new Set<string>();
      let walk: string | null = focusId;
      while (walk) { home.add(walk); walk = tree.units.get(walk)?.parentId ?? null; }
      const hops = chains.filter((c) => home.has(c.unitId));
      if (hops.length) {
        const trace = () => {
          ctx.beginPath();
          for (const chain of hops) traceElbows(chain.points, kneeFor(chain.points));
        };
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        trace();
        ctx.lineWidth = Math.max(1.6, 7 / scale);
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.stroke();
        trace();
        ctx.lineWidth = Math.max(0.9, 3.6 / scale);
        ctx.strokeStyle = "rgba(15,23,42,0.92)";
        ctx.stroke();
      }
    }

    // 6. In orbits mode there is no lattice, so the old links come back — this
    //    is the shipped layout drawn by the same renderer, for comparison.
    if (!hexScene) {
      ctx.lineCap = "round";
      for (const link of scene.links) {
        if (link.kind !== "unit") continue;
        const a = scene.unitById.get(link.sourceId);
        const b = scene.unitById.get(link.targetId);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = Math.max(0.5, 2 / scale);
        ctx.strokeStyle = "rgba(99,102,241,0.3)";
        ctx.stroke();
      }
    }

    // 7. The unit itself, and its people once there is room for them.
    /**
     * **How present a node is, on the ladder.**
     *
     * Greg, 2026-11-06, on the rung where teams become gummy bears: *"this is
     * where humans cease to be visible as avatars, but may remain visible as
     * nodes or dots"*, and one rung further out, of a company: *"only its
     * leading node would be visible as the utile interaction at this level of
     * zoom."*
     *
     * Both fall out of one line. A node fades with `reveal.tiles` as its cell
     * stops being a thing you could point at — **unless it is the node the
     * current place belongs to**, in which case it holds. A unit's tier is how
     * many rungs of places sit beneath it, so the unit governing whichever
     * bubble is currently the place has exactly the tier that `placePresence`
     * is lighting up. So the leading node of the blob you are looking at stays,
     * and everything inside it goes quiet, at every rung and without anything
     * here knowing which rung that is.
     */
    const tierOf = allocation.tier;
    for (const unit of visible) {
      // In hex mode the node carries "a unit is here", so the disc is only the
      // thing people orbit and is drawn at its true size. Holding it above a
      // screen floor, as the orbital map must, put a white dot on every tile at
      // overview and said nothing the hexagon was not already saying.
      const drawn = hexScene ? unit.r : drawnUnitRadius(unit, scale, unit.drawCeiling);
      if (drawn * scale < 2) continue;
      const leads = place.get(tierOf?.get(unit.id) ?? -1) ?? 0;
      const presence = hexScene ? Math.max(reveal.tiles, leads) : 1;
      if (presence <= 0.02) continue;
      const isParent = unit.childIds.length > 0;
      ctx.globalAlpha = presence;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, drawn, 0, Math.PI * 2);
      ctx.fillStyle = unit.id === hover ? "#0f172a" : "#ffffff";
      ctx.fill();
      // A parent wears a heavier ring — same size, different treatment, which
      // is how you find the manager inside a blob of one colour.
      ctx.lineWidth = Math.max(0.5, (isParent ? 3 : 1.2) / scale);
      ctx.strokeStyle = css(hueFor(unit.id), unit.depth, maxDepth, 0.95);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /**
     * **People are not drawn as dots any more.**
     *
     * Greg, 2026-10-15: *"when viewing 'teams' don't show the dots for people —
     * that's a hangover from the orbits model. It's redundant in this version."*
     *
     * It was: on the orbital map a unit was a disc and its people orbited it, so
     * dots round a node were how you saw a team at all. Here a team *is* a
     * hexagon with ground of its own, and the people view promotes every person
     * to a hexagon in their own right — so the dots were a second, fainter way
     * of saying what the tile already said.
     */

    ctx.restore();

    // 8. Labels, in screen space so text stays crisp at any camera scale.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    // The tile being pointed at and its parent are named first and always,
    // whatever the zoom. Answering "who is the parent" is the whole point of
    // the hover, and a nameless hexagon does not answer it.
    const forced = new Set([focusId, parentId].filter(Boolean) as string[]);
    const ordered = [...visible].sort(
      (a, b) =>
        Number(forced.has(b.id)) - Number(forced.has(a.id)) || a.depth - b.depth,
    );
    for (const unit of ordered) {
      const drawn = drawnUnitRadius(unit, scale, unit.drawCeiling);
      /**
       * **A tile names itself once there is room for the name**, which on a
       * lattice is a question about the cell and not about the camera.
       *
       * This used to call `unitLabelVisible`, whose gate is `0.7×` *world
       * scale* — the orbital map's question, and meaningless here. The
       * ladder's own band is cell-pixels, like everything else.
       *
       * **And `drawn × scale ≥ 7` went with it on 2026-11-07**, because it was
       * the same mistake left behind: `drawn` here is the white *centre mark*,
       * a constant 13.44 world units on every unit the hex scene lays, so that
       * clause was a pure camera gate wearing a size's clothing — and a strict
       * one. Worked through: the mark's screen floor pins `drawn × scale` at
       * 4.5px through the middle of the range, so the test could not pass
       * until the mark's own radius took over at `0.52×`. That is why Greg saw
       * human names arrive *"too late"* once they stopped counting as
       * landmarks. On this map the thing with room for a name is the **cell**,
       * and `NAMES_AT_CELL_PX` is the only honest measure of that.
       */
      const named = hexScene
        ? reveal.names > 0.5
        : unitLabelVisible(drawn, scale);
      const inside = named || forced.has(unit.id);
      /**
       * **And a place names itself while it is the place.** At overview the
       * standing rule still applies — the company and the rungs just below it
       * are the landmarks you navigate by — but so does the ladder: whichever
       * rung is currently drawing as a gummy bear should say what it is, or it
       * is a coloured shape with nothing to tell you.
       *
       * **A person is never a place, and leaving that unsaid was a bug.**
       * `allocation.tier` is set for *every* unit the engine places, and a
       * person's tier is 0 — the same number a team gets, because the tier
       * counts the rungs of places beneath you and a person has none. So from
       * the day this line was written (2026-11-06) until 2026-11-07, every
       * person on the map counted as a landmark at every zoom where teams
       * were the place, which is everything from the Function rung inward.
       * Their names bypassed `NAMES_AT_CELL_PX` entirely and drew at 18px a
       * cell, where the band says nothing should be named until 26px. That is
       * most of the crowding Greg reported — *"as the zoom reveals the humans
       * at around 0.05x zoom … the map quickly becomes too crowded"* — and it
       * is why his *"you'd have to zoom to, say, >0.15x before human labels
       * appeared"* could not have worked as a change to the band alone.
       */
      const leading = !peopleIds.has(unit.id)
        && (place.get(allocation.tier?.get(unit.id) ?? -1) ?? 0) > 0.35;
      const landmark = !inside && (isLandmark(unit.depth) || leading);
      if (!inside && !landmark) continue;
      const sx = unit.x * scale + camera.x;
      const sy = unit.y * scale + camera.y;
      if (sx < -80 || sy < -30 || sx > size.width + 80 || sy > size.height + 30) continue;
      const fontPx = inside ? 12 : Math.max(10, 16 - unit.depth * 1.5);
      const bold = unit.depth <= 1 || forced.has(unit.id);
      ctx.font = `${bold ? 650 : 500} ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(unit.name).width;
      const ly = inside ? sy : sy + drawn * scale + 10;
      const h = fontPx + 8;
      if (placed.some((p) =>
        Math.abs(p.x - sx) < (p.w + w) / 2 + 8 && Math.abs(p.y - ly) < (p.h + h) / 2)) continue;
      placed.push({ x: sx, y: ly, w, h });
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillRect(sx - w / 2 - 4, ly - h / 2, w + 8, h);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(unit.name, sx, ly);
    }
    /**
     * **The tile the menu is about stays lit.** Greg, 2026-10-20: *"a faint
     * outline or other colour change/pulse animation should play when the user
     * clicks in a vacant tile."*
     *
     * Without it the gesture is invisible: a double-click is fast, the menu
     * opens beside the pointer rather than on it, and a node then appears
     * somewhere nobody was looking. The outline is the sentence *here, this
     * one* — and it holds while you choose, which is the second half of what
     * he asked for.
     *
     * Drawn last, in screen space, so it sits over everything including the
     * labels. It breathes unless the machine has been asked not to animate.
     */
    if (menu && hexScene) {
      const lit = corners(menu.cell, hexScene.hex.size)
        .map((pt) => ({ x: pt.x * scale + camera.x, y: pt.y * scale + camera.y }));
      ctx.beginPath();
      ctx.moveTo(lit[0].x, lit[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(lit[i].x, lit[i].y);
      ctx.closePath();
      const beat = still ? 0.55 : 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(performance.now() / 420));
      ctx.fillStyle = `rgba(37,99,235,${beat * 0.14})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(37,99,235,${beat})`;
      ctx.stroke();
    }

    // `pulse` is the dwell clock: it carries no value, it is what makes this
    // effect run again while the hand is resting on somebody and nothing else
    // is moving. See the neck, above.
  }, [camera, scene, hexScene, chains, size, hover, regions, regionOrder, maxDepth, drag, pending, tree, justMoved, teamOutlines, teamTints, areaPaths, bubbles, bubbleTints, footprints, teamCover, allocation.tier, peopleIds, leadIds, hueById, pulse, still, born, unfinished, blankPaper, menu]);

  // --- input ---------------------------------------------------------------

  const onWheel = useCallback((e: React.WheelEvent) => {
    // A hand on the wheel outranks a journey that hand started a moment ago.
    stopTravel();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCamera((cam) => {
      const z = wheelZoom(cam, e.deltaY, pointer);
      return cameraAbout(Math.min(12, Math.max(floor, z.scale)), z.world, z.screen);
    });
  }, [floor, stopTravel]);

  const unitAtPointer = useCallback((world: { x: number; y: number }): string | null => {
    if (hexScene) return allocation.occupants.get(cellKey(worldToCell(world, hexScene.hex.size))) ?? null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const u of scene.units) {
      const d = Math.hypot(u.x - world.x, u.y - world.y);
      if (d < bestD && d < Math.max(u.r * 2.5, 40 / camera.scale)) { bestD = d; best = u.id; }
    }
    return best;
  }, [hexScene, allocation, scene, camera.scale]);

  /**
   * **The hand is down, and nothing has been decided yet.**
   *
   * A press used to be a drag from its first pixel. It is now held here until
   * it either travels `MOVE_SLOP_PX` — and becomes a drag or a pan — or lets
   * go without travelling, which is a click and belongs to the gestures that
   * are made of clicks.
   */
  const press = useRef<{
    x: number; y: number;
    world: { x: number; y: number };
    hit: string | null;
    cam: Camera;
  } | null>(null);

  /** What put the pointer down last — a mouse, a pen or a finger. Touch keeps
   *  double-tap for zoom, so the create gesture has to know. */
  const pointerKind = useRef<string>("mouse");

  /**
   * **The dwell, in a ref, because a clock read from React state is not a
   * clock.**
   *
   * `heldOver` / `holdAt` / `holdSince` live on the drag's state as well — the
   * neck animation is drawn from them, and a frame late is invisible there.
   * The *decision* may not be a frame late. Every pointer event reads the drag
   * its last **render** produced, so on a heavy map, where a render costs more
   * than the gap between two moves, the handler is reading a hold from a
   * second ago: measured on 2026-10-30, `performance.now() - holdSince` came
   * back as a flat ~1,000 ms on every move of a drag that was still arriving,
   * which is to say the clock was measuring how far behind the renderer was.
   *
   * Both halves of the gesture now read this instead: it is written
   * synchronously inside the move handler and read synchronously on release,
   * so what the release decides is what the hand actually did. The state copy
   * is for drawing only.
   */
  const hold = useRef<{ over: string | null; at: { x: number; y: number }; since: number }>({
    over: null, at: { x: 0, y: 0 }, since: 0,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    // Capture keeps the gesture with the canvas when the hand leaves it. It
    // throws where there is no live pointer to capture, and a gesture that
    // cannot be captured still works — it is the rest of this handler that
    // matters.
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const world = worldAt(e.clientX, e.clientY, rect);
    const hit = unitAtPointer(world);
    pointerKind.current = e.pointerType || "mouse";

    // A menu is about the place it opened on. Touching the map anywhere is
    // enough to mean "not that, then".
    if (menu) setMenu(null);
    press.current = { x: e.clientX, y: e.clientY, world, hit, cam: camera };
  };

  /**
   * **Picking a branch up**, once the hand has travelled far enough to mean
   * it. Everything here is what `onPointerDown` used to do on the first pixel;
   * the only change is when it runs. Answers whether it took the gesture, so
   * a press on open paper — or on the one node nobody may carry — falls
   * through to panning.
   */
  const beginDrag = (hit: string, world: { x: number; y: number }): boolean => {
    if (hexScene && hit !== tree.rootId && !pending) {
      // A tile travels with its branch, so one gesture moves a single team or a
      // whole island — Greg's rules 5 and 7 are the same drag.
      const members = new Map<string, Cell>();
      for (const id of branchOf(tree, hit)) {
        const c = hexScene.hex.cells.get(id);
        if (c) members.set(id, c);
      }
      // Picking up the governing node of the branch that just landed, while
      // the window is open, arms the tree-it gesture for this drag.
      const armed =
        justMoved &&
        justMoved.unitId === hit &&
        Date.now() - justMoved.when < RADIATE_WINDOW_MS
          ? justMoved.at
          : null;
      /**
       * **Ask the atlas for the branch's shape, now, while the hand is still.**
       *
       * Greg, 2026-10-15: *"people in the same team should glue together where
       * space allows, and where space doesn't, the whole team should move,
       * rather than isolate one human."* That is measure-then-reserve, and the
       * atlas is the only engine here that does it — on a clean load every one
       * of the 1,000-person company's 230 teams is in one piece with every
       * person exactly one tile from their node. The company's own compass goes
       * with it so the branch keeps facing the way it always faced.
       */
      const grabbedAt = hexScene.hex.cells.get(hit)!;
      const shape = armed
        ? branchShape({ tree, anchorId: hit, people: peopleIds, leads: leadIds })
        : null;
      const relaid = armed ? reLay(hit, grabbedAt, shape) : null;
      /**
       * **An armed pick-up shows its answer immediately.**
       *
       * A landing used to be worked out only once the pointer crossed into a
       * *different* cell, which is fine for carrying something somewhere and
       * wrong for this gesture: picking a node straight back up and setting it
       * down where it already was is the whole point of the five-second rule,
       * and that drag never leaves its own cell. The release then found no
       * landing and refused the drop — *"there is nowhere free nearby"* — on a
       * map that was nearly empty.
       */
      hold.current = { over: null, at: world, since: performance.now() };
      setDrag({
        unitId: hit, members, grabbed: grabbedAt,
        from: world, world, target: grabbedAt,
        landing: relaid?.cells ?? null,
        anchor: relaid?.cells.get(hit) ?? null,
        reshaped: false, radiated: Boolean(relaid),
        armedAt: armed,
        deference: relaid?.deference ?? null,
        afar: shape,
        heldOver: null, holdAt: world, holdSince: performance.now(),
      });
      return true;
    }
    return false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();

    /**
     * **The moment a press becomes a gesture.** Travel decides which one: a
     * node under the hand is picked up, anything else pans. The pan is
     * anchored where the hand went *down* rather than where it is now, so
     * crossing the threshold does not jump the map by four pixels.
     */
    const held = press.current;
    if (held && !drag && !pan.current) {
      if (Math.hypot(e.clientX - held.x, e.clientY - held.y) <= MOVE_SLOP_PX) return;
      press.current = null;
      if (held.hit && beginDrag(held.hit, held.world)) return;
      pan.current = { x: held.x, y: held.y, cam: held.cam };
    }

    if (pan.current) {
      const p = pan.current;
      setCamera({ scale: p.cam.scale, x: p.cam.x + (e.clientX - p.x), y: p.cam.y + (e.clientY - p.y) });
      return;
    }
    const world = worldAt(e.clientX, e.clientY, rect);
    if (drag && hexScene) {
      const target = worldToCell(world, hexScene.hex.size);

      // A hold is a hold. If the hand has travelled, the clock starts again —
      // even when it has not left the tile it is over. Measured on the screen,
      // where the hand is (`HOLD_SLACK_PX`), and against the ref rather than
      // the rendered state (`hold`), so the clock cannot be a render behind.
      const travelled = Math.hypot(world.x - hold.current.at.x, world.y - hold.current.at.y) * camera.scale;
      const stillHolding = travelled <= HOLD_SLACK_PX;
      /** Writes the dwell down, synchronously. The clock restarts unless the
       *  hand is still *and* still asking about the same unit. */
      const keep = (subject: string | null) => {
        const same = subject !== null && subject === hold.current.over;
        hold.current = {
          over: subject,
          at: same && stillHolding ? hold.current.at : world,
          since: same && stillHolding ? hold.current.since : performance.now(),
        };
        return hold.current;
      };

      if (cellKey(target) === cellKey(drag.target)) {
        if (!stillHolding) {
          const now = keep(hold.current.over);
          setDrag({ ...drag, world, holdAt: now.at, holdSince: now.since });
        }
        return;
      }
      // One mechanism decides where the branch goes, and it is this one. What
      // is drawn now is exactly what commits on release.
      //
      // The gesture only counts while the branch is still near where it was —
      // carry it across the map and it is a move again, not a request to tree.
      /**
       * **The armed gesture carries a shape; a plain drag carries a silhouette.**
       *
       * When the same node is picked straight back up, the branch has already
       * been re-laid by the atlas — teams measured, ground reserved, every
       * person against their own node. All that is left is to find where that
       * body can come to rest, which is a translation and a collision test. A
       * body that cannot fit under the hand settles nearby **whole**: Law 2
       * before convenience, and the opposite of what the old path did, which
       * was to take the branch apart one unit at a time until the pieces fitted.
       */
      if (drag.armedAt) {
        const relaid = reLay(drag.unitId, target, drag.afar);
        /**
         * **An armed gesture still answers the hand resting on somebody.**
         *
         * This said `heldOver: null` outright, and it closed a door that
         * nothing else opened. Picking a node straight back up is what you do
         * the moment a move has not come out how you wanted, so the five
         * seconds after *every* move were five seconds in which no relationship
         * question could be asked at all. Greg: *"reparenting or making a
         * change only fires once. That means once I've moved something I can't
         * manually move it again."*
         *
         * It survived until now because adjacency was a second route to a
         * reparent; deleting that on 2026-10-19 left this as the only one, and
         * the gap became the whole gesture. **Re-laying a branch and asking
         * about its parent are different questions**, and holding the hand
         * still over another node answers the second whatever the first is
         * doing — so the dwell is read here exactly as it is on the plain path.
         */
        const under = allocation.occupants.get(cellKey(target)) ?? null;
        const over = heldSubject(hold.current.over, under, stillHolding);
        const now = keep(over && !drag.members.has(over) ? over : null);
        setDrag({
          ...drag, world, target,
          landing: relaid?.cells ?? null,
          anchor: relaid?.cells.get(drag.unitId) ?? null,
          reshaped: false,
          radiated: Boolean(relaid),
          deference: relaid?.deference ?? null,
          heldOver: now.over,
          holdAt: now.at,
          holdSince: now.since,
        });
        return;
      }

      const landing = placeIsland(
        allocation.occupants, drag.members, drag.unitId, target,
        (id) => tree.units.get(id)?.childIds ?? [],
        // **`groupOf` stays; `gapBetween` goes.** Law 4: the layout owns
        // spacing and the drop path holds no rule of its own. `gapBetween` was
        // the drop path's second, tighter rule — kinship rungs capped at
        // `TEAM_GAP = 3` — quietly compressing a map whose gaps are a share of
        // what they separate, on every drag.
        //
        // `groupOf` is a different thing wearing the same coat, and it is
        // load-bearing: it is what tells a clash which body may step aside, so
        // the rest can translate as-is. Measured over 484 clashing drops on the
        // 1,000-person company, removing it turns *every* one of them from
        // `parted` into `gathered` and takes whole families inside the branch
        // from 224/248 to about 80 — the confetti itself. A draft rule set
        // proposed deleting both; see `app/lab/hex/confetti.test.ts`.
        groupOf,
      );
      const under = allocation.occupants.get(cellKey(target)) ?? null;
      const over = heldSubject(hold.current.over, under, stillHolding);
      const now = keep(over && !drag.members.has(over) ? over : null);
      setDrag({
        ...drag, world, target,
        landing: landing.kind === "no-room" ? null : landing.cells,
        anchor: landing.kind === "no-room" ? null : landing.anchor,
        // Only a shape somebody built and would now lose is worth a dialog.
        // A tree the hand asked for is not one of those, and nor is a landing
        // that kept every group's shape and only stepped the clashes aside.
        reshaped: landing.kind === "reshaped",
        radiated: landing.kind === "parted",
        /**
         * **Any two units arm it. What they are decides the question asked.**
         *
         * This briefly required the two to be of the same kind — the grow
         * study's *"like pairs with like"* — and that was wrong here, because
         * grow had somewhere else to put the question and hex does not. There,
         * a person meeting a team was answered by dropping them on the team's
         * orbit. Hex has no orbit, and the adjacency route was deleted the same
         * day, so gating the dwell as well left **no way at all** to make a
         * person report to a team. Greg found it within minutes: *"I was able
         * to reparent Dune Team 5 into a child of Buff Team 6 (good), but
         * thereafter unable to reparent or merge."* Two teams are alike; the
         * pair he tried next was not.
         *
         * `alike` still earns its keep one layer up, in the dialog: it is what
         * chooses between the merge questions and a plain reparent.
         */
        heldOver: now.over,
        holdAt: now.at,
        holdSince: now.since,
      });
      return;
    }
    setHover(unitAtPointer(world));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* never had it */ }
    pan.current = null;
    // A press that never travelled is a click rather than a drag: `press` is
    // still set, because nothing converted it.
    const tapped = press.current;
    press.current = null;

    /**
     * **A node that is asking for something answers a tap** by opening its
     * wizard. That is the invitation on blank paper: a breathing node is the
     * only thing on the map asking for attention.
     *
     * **It used to answer a press**, which was the same thing while the only
     * breathing nodes were the two the grow sequence made. Once anything could
     * be made anywhere, it stopped being the same thing: a node you had not
     * described yet could not be picked up at all, so it could not be moved,
     * and it could not be reparented — Greg, 2026-10-21: *"I can double click
     * to create a thing on the whitespace, but I can't then reparent it."*
     *
     * A tap and a drag are now different gestures, so this is a tap.
     */
    if (tapped?.hit && !pending && unfinished.has(tapped.hit)) {
      const node = born.find((b) => b.id === tapped.hit);
      if (node) {
        setWizard({ id: tapped.hit, step: stillNeeds(node) === "Needs a name" ? 0 : 1 });
        setDrag(null);
        return;
      }
    }
    if (!drag || !hexScene) { setDrag(null); return; }

    // Read off `hold`, not off the rendered drag: on a heavy map the state is
    // a render behind the hand, and a dwell decided from it is a measure of
    // the renderer rather than of the gesture. See `hold`.
    const heldOver = hold.current.over;
    const heldLongEnough = heldOver !== null && performance.now() - hold.current.since > HOLD_MS;

    /**
     * **A deliberate hold is a question about the org, and it is asked first.**
     *
     * This used to sit *below* the refusal, and that is the fault Greg hit:
     * *"reparenting or making a change only fires once… thereafter unable to
     * reparent or merge."* A branch has to find somewhere for every one of its
     * cells to land, and on a map a hand has already rearranged — his had 68
     * placements on it — the ground beside a target runs out. The release then
     * took the refusal path and said *"your tile can't fit here right now"*,
     * and the question he had deliberately held for was never asked. The first
     * gesture of a session works because the map is still roomy; the ones after
     * it stop working as it fills, which is exactly "only fires once".
     *
     * **Neither answer needs the branch to go anywhere.** Reparenting re-lays
     * it under its new parent and merging dissolves it into the other unit, so
     * where it would have sat if it had merely been dropped is beside the
     * point. The landing is carried through for the reparent, which keeps it
     * where the hand left it when there is room, and is simply null when there
     * is not.
     */
    if (heldLongEnough && heldOver) {
      setPending({
        kind: "merge", unitId: drag.unitId, withUnitId: heldOver,
        cells: drag.landing,
      });
      setDrag(null);
      return;
    }

    // Nowhere at all is the only reason a plain drop is refused.
    if (!drag.landing || !drag.anchor) {
      setPending({ kind: "blocked", unitId: drag.unitId, occupiedBy: "", cells: null });
      setDrag(null);
      return;
    }

    /**
     * **Nothing is left to ask.** With the hold handled above and nearness no
     * longer meaning anything, a plain release has one meaning: it moved.
     * `placeIsland` has already resolved any clash into a landing, so there is
     * nobody to be in the way by the time we get here — which is why
     * `dropOutcome` is no longer consulted on this path at all. It still
     * answers the same question for the engine's own tests.
     */
    if (drag.reshaped) {
      setPending({ kind: "reshape", unitId: drag.unitId, cells: drag.landing });
    } else {
      commit(drag.landing, undefined, drag.unitId);
    }
    // This branch is now the one that just moved, so its governing node can be
    // picked straight back up to tree it.
    setJustMoved({ unitId: drag.unitId, at: drag.anchor, when: Date.now() });
    setDrag(null);
  };

  /**
   * **Double-click is how things get made.**
   *
   * Greg, 2026-10-19: *"I think the next model needs a double-click thing, and
   * depending on what you click, you get options."* What you clicked is
   * answered in two places — `allocation.occupants` for *somebody is standing
   * here*, and `groundAt` for *this is somebody's space* — and the menu that
   * opens is the only difference between them.
   *
   * **Touch is left alone.** Greg, 2026-10-20: on a touchscreen *"double-tap
   * stays zoom, and pinch stays zoom"*. He accepts that the two inputs then
   * differ, and points at Apple and Miro for doing the same.
   *
   * **The same at every scale.** *"As of right now, double click should work
   * consistently across scales."* There is no build mode and no gate on the
   * size of the company: an empty page and a 2,562-person one answer a
   * double-click the same way.
   */
  const onDoubleClick = (e: React.MouseEvent) => {
    if (pointerKind.current === "touch") return;
    if (!hexScene || pending) { setMenu(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const world = worldAt(e.clientX, e.clientY, rect);
    const cell = worldToCell(world, hexScene.hex.size);
    const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    /**
     * **A root nobody made is not a node to click on.**
     *
     * A company with several top-level units — and a blank page, which has
     * none — gets a root synthesised by the tree builder so everything has one
     * ancestor. It stands on a cell like anything else, and on blank paper
     * that cell is the whole screen, so every double-click landed on it and
     * the only menu anybody could reach was *describe the Organisation*.
     * It is not in the company and nobody can point at it, so here it is not
     * standing anywhere.
     */
    const occupants = syntheticRoot
      ? new Map([...allocation.occupants].filter(([, id]) => id !== tree.rootId))
      : allocation.occupants;

    const standing = occupants.get(cellKey(cell)) ?? null;
    if (standing) {
      setMenu({ kind: "node", unitId: standing, at, cell });
      return;
    }
    const ground = groundAt({
      cell,
      occupants,
      depthOf: (id) => tree.units.get(id)?.depth ?? 0,
    });
    const holder = ground
      ? holderOf({
          ground,
          parentOf: (id) => tree.units.get(id)?.parentId ?? null,
          isPerson: (id) => peopleIds.has(id),
        })
      : null;
    setMenu({ kind: "make", holder, ring: ground?.ring ?? null, at, cell });
  };

  /**
   * Greg's two presses, 2026-09-30.
   *
   * The first neatens what is there: stragglers travel back to their families
   * and branches turn to face away from where their own chain arrives, while
   * everything anybody placed by hand stays exactly where they put it. The
   * second is the old behaviour — throw the arrangement away and go back to the
   * calculated one.
   */
  const [tidyReport, setTidyReport] = useState<ReturnType<typeof neaten> | null>(null);
  const tidy = useCallback(() => {
    // Both presses are a step back from, including the one that throws the
    // arrangement away — which until undo existed was itself the only way back.
    remember();
    if (!hexScene || tidyStage > 0) {
      // The second press throws the whole arrangement away, and that has always
      // included the structure the hand changed as well as where things sit.
      // Merges go with it for the same reason: there is no other undo here.
      setMoves(new Map());
      setReparents(new Map());
      setMerges(new Map());
      setPinned(new Set());
      setTidyStage(0);
      setTidyReport(null);
      return;
    }
    // **Tidy is handed the layout's own spacing** rather than inventing one.
    // Law 4: one measure of distance. `spacedBy` is what `layoutTerritories`
    // actually kept clear round each unit — a share of the size of the thing it
    // separates — and it is a property of the tree, so a hand arrangement does
    // not change what a unit is owed.
    const result = neaten(
      tree, allocation.cells, pinned, hexScene.hex.size,
      allocation.spacedBy,
      // The spacer rule applies to tidy too — Greg, 2026-10-16: *"on load, or
      // using the auto-tidy function"*. Handed only when the driver that laid
      // the map holds to it; the atlas does not and never has.
      driver === "radial" ? peopleIds : undefined,
    );
    setMoves(new Map(result.cells));
    setTidyReport(result);
    setTidyStage(1);
  }, [driver, peopleIds, hexScene, tidyStage, tree, allocation, pinned, remember]);

  /**
   * Two units on one cell would make one of them impossible to point at, since
   * hover reads the cell's occupant. Nothing is known to cause it — 120 random
   * drags and reparents produce none — but Greg reported a tile he could not
   * hover on 2026-10-01, and a number on the screen beats a mystery.
   */
  /**
   * **A live count of how mixed up the map is** (Greg, 2026-10-06).
   *
   * *"I think we're measuring the wrong thing re the confetti. I'd guess we're
   * measuring something to do with parenting, where we should be measuring
   * adjacency?"*
   *
   * He was right. The first version asked whether each team was internally
   * whole and whether people sat beside their own manager — and both came back
   * clean while the screen was plainly a mess, because a thousand intact little
   * teams strewn across the map is exactly what it was reporting as healthy.
   *
   * These ask about **adjacency to strangers** instead, which is what the eye
   * is actually reading: who is my neighbour, and do they belong with me. A
   * person pressed against somebody from another team, or a group pressed
   * against a group it is not part of, is a boundary the eye cannot use.
   */
  const scatter = useMemo(() => {
    if (peopleIds.size === 0 || !groups?.length) return null;
    const at = new Map<string, string>();
    for (const [id, cell] of allocation.cells) at.set(cellKey(cell), id);
    const teamOfPerson = new Map(groups);
    const teamOf = (id: string) => teamOfPerson.get(id) ?? id;

    let crowded = 0, withNeighbours = 0;
    for (const id of peopleIds) {
      const cell = allocation.cells.get(id);
      if (!cell) continue;
      const mine = teamOf(id);
      let any = false, stranger = false;
      for (const nb of neighbours(cell)) {
        const who = at.get(cellKey(nb));
        if (!who) continue;
        any = true;
        if (teamOf(who) !== mine) { stranger = true; break; }
      }
      if (any) withNeighbours++;
      if (stranger) crowded++;
    }

    /** Which ancestor a unit belongs to, `rungs` up from the top. */
    const branchAt = (id: string, depth: number): string | null => {
      let up: string | null = id;
      while (up) {
        const unit = tree.units.get(up);
        if (!unit) return null;
        if (unit.depth === depth) return up;
        up = unit.parentId ?? null;
      }
      return null;
    };
    // The rung where the company first fans out — the big territories a reader
    // would call divisions, whatever the fixture names them.
    let rung = 1;
    for (let d = 1; d <= 4; d++) {
      const n = new Set([...allocation.cells.keys()].map((id) => branchAt(id, d)).filter(Boolean)).size;
      if (n >= 4) { rung = d; break; }
      rung = d;
    }
    const owner = new Map<string, string>();
    for (const [id, cell] of allocation.cells) {
      const a = branchAt(id, rung);
      if (a) owner.set(cellKey(cell), a);
    }
    let touching = 0;
    for (const [key, mine] of owner) {
      const [q, r] = key.split(",").map(Number);
      for (const nb of neighbours({ q, r })) {
        const theirs = owner.get(cellKey(nb));
        if (theirs && theirs !== mine) { touching++; break; }
      }
    }
    return {
      people: peopleIds.size, crowded, withNeighbours,
      divisions: new Set(owner.values()).size, touching, rung,
    };
  }, [peopleIds, groups, tree, allocation]);

  const buried = allocation.cells.size - allocation.occupants.size;
  /** Units the layout never gave a cell to. A dropped unit is simply absent
   *  from the map, which is the one fault nothing else here would show. */
  const missing = tree.units.size - allocation.cells.size;


  const hovered = hover ? scene.unitById.get(hover) : null;
  /**
   * **Counted from what is on the screen, not from what was calculated.**
   *
   * The panel used to read these off `allocation.stats`, and the `allocation`
   * memo builds itself with `{ ...baseAllocation, cells, occupants }` — which
   * copies the statistics of the **calculated** layout straight through while
   * replacing the cells underneath them. So after a thousand hand placements
   * the panel was faithfully describing a map nobody was looking at any more.
   *
   * Greg, 2026-10-06, with 1,258 placements of his own on screen: *"it states
   * that there are 91% of children touching their family, yet on the zoom alone
   * I can see such examples as 'Cliff Petrov', 'Kit Io', and 'Ben Xu' as
   * separated from their family groups."* He was reading the arrangement and
   * the number was reading the calculation. Both were right, about different
   * maps.
   *
   * There is no allowance in this one either. The engine's own figure asks
   * whether a unit is further out than the spacing rule *told* it to be, which
   * is the right question of a rule and the wrong question of a picture — and
   * with the gap now a share of a territory's size that allowance can run to a
   * dozen tiles, so somebody plainly adrift still counted as connected. On
   * screen, touching means touching.
   */
  const live = useMemo(() => {
    const cells = allocation.cells;
    let touchingFamily = 0, touchingParent = 0, children = 0;
    let families = 0, wholeFamilies = 0;
    /**
     * **Law 3, counted live.** How many units sit nearer the master centre
     * than their own parent does, and the worst case in tiles.
     *
     * This had no number on the panel until 2026-10-14: the 33–35% everybody
     * quoted came from a one-off probe against a build that has since changed,
     * so the baseline every new rule was to be judged against could not be
     * seen while using the map. Greg, 2026-10-06, on what it looks like: the
     * line from a deep team back to the centre *"seems to loop back on
     * itself."*
     */
    let curled = 0, curlWorst = 0;
    /** Rungs that take you no closer to the centre — sideways counts. Places
     *  only, because Law 3 holds only places to it. */
    let level = 0, levelOf = 0;
    const centre = cells.get(tree.rootId);
    for (const unit of tree.units.values()) {
      const own = cells.get(unit.id);
      if (!own) continue;
      if (unit.parentId) {
        children++;
        const kin = new Set<string>();
        const parent = cells.get(unit.parentId);
        if (parent) {
          kin.add(cellKey(parent));
          if (hexDistance(own, parent) === 1) touchingParent++;
        }
        for (const sib of tree.units.get(unit.parentId)?.childIds ?? []) {
          if (sib === unit.id) continue;
          const c = cells.get(sib);
          if (c) kin.add(cellKey(c));
        }
        for (const nb of neighbours(own)) {
          if (kin.has(cellKey(nb))) { touchingFamily++; break; }
        }
        if (parent && centre) {
          const out = hexDistance(own, centre);
          const parentOut = hexDistance(parent, centre);
          // Equal distance is allowed by the law; nearer is not.
          if (out < parentOut) { curled++; curlWorst = Math.max(curlWorst, parentOut - out); }
          /**
           * **The number that was missing** — and it counts *places*, because
           * that is who Law 3 holds to it.
           *
           * Curl-back counts only a rung that goes inward, and on a clean load
           * that is nought, which is why the panel said the map had no loopbacks
           * while Greg could see that it did. A rung that goes neither in nor
           * out still takes you round the centre, and six of those is a circle.
           *
           * Counting people in it is the same mistake wearing the other coat:
           * Law 3 says an individual is *"pushed outward, never forbidden from
           * the near side"*, so a person standing level with their manager is
           * the law working rather than failing, and including them read 38%
           * on a map where every place was obeying.
           */
          if (!peopleIds.has(unit.id)) {
            levelOf++;
            if (out <= parentOut) level++;
          }
        }
      }
      if (unit.childIds.length === 0) continue;
      families++;
      const patch = new Set([cellKey(own)]);
      for (const id of unit.childIds) {
        const c = cells.get(id);
        if (c) patch.add(cellKey(c));
      }
      const seen = new Set([cellKey(own)]);
      const queue: Cell[] = [own];
      while (queue.length) {
        const at = queue.pop()!;
        for (const nb of neighbours(at)) {
          const k = cellKey(nb);
          if (patch.has(k) && !seen.has(k)) { seen.add(k); queue.push(nb); }
        }
      }
      if (seen.size === patch.size) wholeFamilies++;
    }
    return {
      children, touchingFamily, touchingParent,
      exclaves: children - touchingFamily, families, wholeFamilies,
      curled, curlWorst, level, levelOf,
    };
  }, [peopleIds, allocation, tree]);

  const stats = hexScene?.hex.stats ?? null;
  const b = scene.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const nameOf = (id: string) => {
    const named = tree.units.get(id)?.name?.trim();
    if (named) return named;
    const unborn = born.find((b) => b.id === id);
    return unborn ? (unborn.kind === "person" ? "This person" : "This team") : id;
  };

  /* --- the wizard --------------------------------------------------------- */
  const wizardNode = wizard ? born.find((b) => b.id === wizard.id) ?? null : null;
  const loneRoot = wizardNode
    ? wizardNode.kind === "person" && wizardNode.parentId === null
      && born.filter((b) => b.parentId === null).length === 1
    : false;
  const wizardSteps = wizardNode ? stepsFor(wizardNode.kind, loneRoot) : [];
  const step = wizardNode ? wizardSteps[Math.min(wizard!.step, wizardSteps.length - 1)] : null;

  /** The card goes on the side with more room, so it never sits on the node it
   *  is asking about — the grow study's rule, at its simplest. */
  const wizardSide = (() => {
    if (!wizardNode) return "right" as const;
    const cell = allocation.cells.get(wizardNode.id);
    if (!cell || !hexScene) return "right" as const;
    const at = cellToWorld(cell, hexScene.hex.size);
    return at.x * camera.scale + camera.x < size.width / 2 ? ("right" as const) : ("left" as const);
  })();

  const answer = (value: string) => {
    if (!wizardNode || !step) return;
    if (step.key === "teammates") {
      if (value === "yes") formTeam();
      else setWizard(null);
      return;
    }
    describe(wizardNode.id, { [step.key]: value } as Partial<Born>);
    if (step.key !== "name") advance();
  };

  function advance() {
    if (!wizard) return;
    if (wizard.step < wizardSteps.length - 1) setWizard({ ...wizard, step: wizard.step + 1 });
    else setWizard(null);
  }

  return (
    <>
      {/**
        * The seed's breath. It was a `box-shadow` spread, which a browser
        * always rounds off to the border radius — so the pulse round a
        * hexagon would have been a circle whatever shape the button was.
        * A hexagon growing out from behind the resting one says the same
        * thing and says it in the map's own shape.
        */}
      <style>{`@keyframes zen-breathe {
        0%, 100% { transform: scale(1); opacity: 0.38; }
        50% { transform: scale(${SEED_BEAT}); opacity: 0; }
      }`}</style>
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{ display: "block", cursor: drag ? "grabbing" : "grab", touchAction: "none" }}
      />

      {/**
        * **Blank paper, and one thing to press.** Greg's framing for the grow
        * study: *"the user starts with almost nothing."* Click it and you
        * create a **human** — not a company, not a value stream.
        */}
      {growing && born.length === 0 && (
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            zIndex: 20, width: SEED_BOX, height: SEED_BOX,
            // The box is only the room the breath needs. Everything in it that
            // is not the hexagon has to let presses through to the canvas.
            pointerEvents: "none",
          }}
        >
          <svg
            viewBox={`${-SEED_BOX / 2} ${-SEED_BOX / 2} ${SEED_BOX} ${SEED_BOX}`}
            width={SEED_BOX}
            height={SEED_BOX}
            style={{ display: "block", overflow: "visible" }}
            aria-hidden
          >
            {!still && (
              <path
                d={SEED_D}
                fill="rgba(148,163,184,0.38)"
                style={{
                  // The hexagon is centred on the drawing's origin, so the
                  // breath grows about its own middle without a measurement.
                  transformBox: "view-box", transformOrigin: "0 0",
                  animation: "zen-breathe 2.6s ease-in-out infinite",
                }}
              />
            )}
            <path
              d={SEED_D}
              fill="#ffffff"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeDasharray="7 6"
            />
          </svg>
          <button
            onClick={seedPerson}
            style={{
              position: "absolute", inset: 0, cursor: "pointer", pointerEvents: "auto",
              clipPath: `polygon(${SEED_CLIP})`,
              border: "none", padding: 0, background: "transparent", color: "#0f172a",
              fontFamily: "ui-sans-serif, system-ui", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 4,
            }}
          >
            <span style={{ fontSize: 34, lineHeight: 1, fontWeight: 300 }}>+</span>
            <span style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Start here</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>Add the first person</span>
          </button>
        </div>
      )}

      {/* The wizard. One question at a time, beside the node it is about. */}
      {wizardNode && step && (
        <div style={{
          position: "absolute", top: 96, zIndex: 21, width: 300, padding: "14px 16px",
          ...(wizardSide === "right" ? { right: 300 } : { left: 24 }),
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
          boxShadow: "0 18px 48px rgba(15,23,42,0.18)",
          fontFamily: "ui-sans-serif, system-ui", fontSize: 13, color: "#0f172a",
        }}>
          <b>{step.key === "teammates" && wizardNode.name
            ? `Does ${wizardNode.name.split(" ")[0]} have any teammates?`
            : step.title}</b>

          {step.kind === "text" && (
            <>
              <input
                autoFocus
                value={wizardNode.name ?? ""}
                placeholder={step.placeholder}
                onChange={(e) => describe(wizardNode.id, { name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && wizardNode.name?.trim()) advance(); }}
                style={{
                  width: "100%", marginTop: 10, padding: "8px 10px", fontSize: 13,
                  border: "1px solid #e2e8f0", borderRadius: 9, outline: "none",
                }}
              />
              <Row>
                <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {step.suggestions.slice(0, 3).map((name) => (
                    <Btn key={name} small onClick={() => describe(wizardNode.id, { name })}>{name}</Btn>
                  ))}
                </div>
              </Row>
              <div style={{ marginTop: 12 }}>
                <Btn primary disabled={!wizardNode.name?.trim()} onClick={advance}>Next</Btn>
              </div>
            </>
          )}

          {step.kind === "select" && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
              {step.options.map((option) => (
                <Btn key={option} onClick={() => answer(option)}>{option}</Btn>
              ))}
            </div>
          )}

          {step.kind === "choice" && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <Btn primary onClick={() => answer("yes")}>Yes — they work with others</Btn>
              <Small>A team will open up around them.</Small>
              <Btn onClick={() => answer("no")}>Not yet — just them</Btn>
              <Small>You can add teammates at any time.</Small>
            </div>
          )}

          <div style={{ marginTop: 12, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            <Btn small onClick={() => setWizard(null)}>Leave it for now</Btn>
          </div>
        </div>
      )}

      {/**
        * **The short menu**, at the point of action. Greg, 2026-10-20: *"the
        * gesture will eventually bring up a short menu, hold the location as
        * highlighted, and potentially provide wider options via a menu
        * elsewhere."* Three items at most, so it is read rather than scanned,
        * and the cell it is about stays lit underneath it.
        *
        * The wording is **relational**, not ranked. Hex has no rungs in a
        * user's sense — the engine knows a person and a place, and "level" is
        * only how deep something happens to sit — so the menu says what the
        * new thing would be *to the place you clicked*, which is the grow
        * study's own lesson about a team being discovered rather than
        * declared.
        */}
      {menu && !pending && !renaming && (() => {
        const held = menu.kind === "node" ? menu.unitId : null;
        const at = hexScene && held ? hexScene.hex.cells.get(held) ?? null : null;
        // Outward is away from the centre: the far side of the node, which the
        // nearest-free search then aims at.
        const outward = at ? { q: at.q * 2, r: at.r * 2 } : null;
        const room = at && outward ? freeNear(at, outward) : null;
        // On blank paper there is no company to belong to, and the first
        // person is a root — which is what opens the teammates question. Every
        // other company has one, and a thing "on its own" is its child rather
        // than a second root with nothing above it.
        const islandParent = org.units.length ? tree.rootId : null;

        const items = menuFor(
          held
            ? {
                kind: "node", unitId: held,
                isRoot: held === tree.rootId,
                isBorn: born.some((b) => b.id === held),
                hasRoom: room !== null,
              }
            : { kind: "make", holder: menu.kind === "make" ? menu.holder : null },
          nameOf,
        );

        const run = (action: MenuAction) => {
          if (action.do === "make") {
            const parentId = action.where === "holder" && menu.kind === "make"
              ? menu.holder ?? islandParent
              : islandParent;
            makeNode(action.kind, parentId, menu.cell);
            return;
          }
          if (!held) return;
          if (action.do === "describe") { setWizard({ id: held, step: 0 }); setMenu(null); return; }
          if (action.do === "rename") { setRenaming({ id: held, value: nameOf(held) }); setMenu(null); return; }
          if (action.do === "under") { if (room) makeNode("person", held, room); return; }
          if (action.do === "above") { makeAbove(held); return; }
          setPending({ kind: "remove", unitId: held, count: branchOf(tree, held).size });
          setMenu(null);
        };

        const wide = 232;
        const left = Math.min(Math.max(8, menu.at.x + 10), Math.max(8, size.width - wide - 8));
        const top = Math.min(Math.max(8, menu.at.y + 10), Math.max(8, size.height - 60 - items.length * 32));
        return (
          <div
            style={{
              position: "absolute", left, top, zIndex: 22, width: wide, padding: 6,
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
              boxShadow: "0 18px 48px rgba(15,23,42,0.18)",
              fontFamily: "ui-sans-serif, system-ui", fontSize: 13, color: "#0f172a",
              display: "flex", flexDirection: "column", gap: 2,
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => run(item.action)}
                style={{
                  textAlign: "left", padding: item.danger ? "10px 9px 7px" : "7px 9px",
                  borderRadius: 8, cursor: "pointer", font: "inherit",
                  border: "none", borderTop: item.danger ? "1px solid #f1f5f9" : undefined,
                  marginTop: item.danger ? 4 : undefined,
                  background: "transparent",
                  color: item.danger ? "#b91c1c" : "#0f172a",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = item.danger ? "#fef2f2" : "#f8fafc"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >{item.label}</button>
            ))}
            <Small style={{ padding: "2px 9px 4px" }}>
              {menu.kind === "make"
                ? menu.holder ? `This ground is ${nameOf(menu.holder)}'s.` : "Open ground."
                : "Double-click the map to make something."}
            </Small>
          </div>
        );
      })()}

      {/** Describing a node the company came with: the one thing left to say
        * about it is what it should be called. */}
      {renaming && (() => {
        const save = () => {
          const value = renaming.value.trim();
          if (value) {
            remember();
            setRenames((r) => new Map(r).set(renaming.id, value));
          }
          setRenaming(null);
        };
        return (
          <Dialog>
            <b>What should this be called?</b>
            <input
              autoFocus
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setRenaming(null);
              }}
              style={{
                width: "100%", marginTop: 10, padding: "8px 10px", fontSize: 13,
                border: "1px solid #e2e8f0", borderRadius: 9, outline: "none",
              }}
            />
            <Row>
              <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                <Btn primary onClick={save} disabled={!renaming.value.trim()}>Rename</Btn>
                <Btn onClick={() => setRenaming(null)}>Cancel</Btn>
              </div>
            </Row>
          </Dialog>
        );
      })()}

      {pending && (
        <Dialog>
          {pending.kind === "remove" && (
            <>
              <b>Remove {nameOf(pending.unitId)}?</b>
              <p style={pStyle}>
                {pending.count > 1
                  ? `It and the ${pending.count - 1} nodes under it come off the map. `
                  : "It comes off the map. "}
                Undo brings it back.
              </p>
              <Row>
                <Btn primary onClick={() => removeBranch(pending.unitId)}>Remove</Btn>
                <Btn onClick={() => setPending(null)}>Keep it</Btn>
              </Row>
            </>
          )}

          {pending.kind === "reshape" && (
            <>
              <b>Your shape might change to fit into where you want to put it</b>
              <p style={pStyle}>
                {nameOf(pending.unitId)} and its branch will not go in as they are. Proceed and
                they will be reflowed into the nearest free ground.
              </p>
              <Row>
                <Btn onClick={() => { commit(pending.cells, undefined, pending.unitId); setPending(null); }} primary>Proceed</Btn>
                <Btn onClick={() => setPending(null)}>Put it back</Btn>
              </Row>
            </>
          )}
          {pending.kind === "blocked" && (
            <>
              <b>Your tile can&rsquo;t fit here right now</b>
              <p style={pStyle}>
                {pending.occupiedBy ? `${nameOf(pending.occupiedBy)} is already there. ` : ""}
                {pending.cells
                  ? "Would you like to place it in the highlighted cell? It stays linked to its parent whether or not they are touching."
                  : "There is nowhere free nearby."}
              </p>
              <Row>
                {pending.cells && (
                  <Btn onClick={() => { commit(pending.cells!, undefined, pending.unitId); setPending(null); }} primary>Place it there</Btn>
                )}
                <Btn onClick={() => setPending(null)}>Put it back</Btn>
              </Row>
            </>
          )}
          {pending.kind === "merge" && (() => {
            /**
             * **Two actions, the same two the radial `/org` map offers.**
             *
             * Greg, 2026-10-19, having seen a third: *"We need the options to
             * match exactly what we had on the radial /org version… There
             * should not be an option that does whatever XOR thing is happening
             * to the team not being moved."* The third was *give them a shared
             * parent*, and it moved the unit the hand was **not** holding and
             * then left the map looking untouched. Gone.
             *
             * The confirmation stays, which he asked for twice: *"reparenting
             * should ask for confirmation, even after it's showing an animation
             * or visual to demonstrate to the user that it's happening."* The
             * neck shows what the gesture is about; this is what commits it.
             */
            const held = pending.unitId;
            const over = pending.withUnitId;
            const actions = holdActions((id) => peopleIds.has(id), held, over);

            // What the hand is actually carrying, in the words `/org` uses: the
            // places below it, and the people inside the whole branch.
            const branch = [...branchOf(tree, held)].filter((id) => id !== held);
            const below = branch.filter((id) => !peopleIds.has(id)).length;
            const holds = branch.filter((id) => peopleIds.has(id)).length;
            const count = (n: number, one: string, many: string) =>
              `${n} ${n === 1 ? one : many}`;

            return (
              <>
                <div style={{
                  fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase",
                  color: "#6b7280", fontWeight: 700,
                }}>
                  Relationship change · nothing has changed
                </div>
                <b>Move or merge &ldquo;{nameOf(held)}&rdquo; with &ldquo;{nameOf(over)}&rdquo;?</b>
                <p style={pStyle}>
                  {below === 0
                    ? `${nameOf(held)} has no units below it.`
                    : `${nameOf(held)} has ${count(below, "unit", "units")} below it.`}
                  {holds > 0 ? ` It holds ${count(holds, "person", "people")}.` : ""}
                </p>
                <p style={pStyle}>
                  <b>Reparent branch</b> moves {nameOf(held)} and everything below it under{" "}
                  {nameOf(over)}; it does not combine the two units.
                </p>
                {actions.merge ? (
                  <p style={pStyle}>
                    <b>Merge entire branch</b> folds everything {nameOf(held)} holds — teams and
                    people alike — into {nameOf(over)}, and {nameOf(held)} stops existing. Nothing
                    above either of them changes.
                  </p>
                ) : (
                  <p style={{ ...pStyle, background: "#eef2ff", padding: "10px 12px", borderRadius: 8 }}>
                    {actions.whyNotMerge}
                  </p>
                )}
                <Row>
                  <Btn
                    primary
                    onClick={() => {
                      // **It stays where the hand left it.** Greg's objection to
                      // the option that "snaps back to the layout unchanged"
                      // applies here too: a gesture that visibly does nothing
                      // reads as a gesture that failed. Where the branch had
                      // somewhere to land, that landing is kept; where it had
                      // none, only the reporting line changes.
                      if (pending.cells) commit(pending.cells, { id: held, parentId: over }, held);
                      else { remember(); setReparents((p) => new Map(p).set(held, over)); }
                      setPending(null);
                    }}
                  >Reparent branch</Btn>
                  <Btn
                    disabled={!actions.merge}
                    onClick={() => {
                      if (!actions.merge) return;
                      remember();
                      setMerges((p) => new Map(p).set(held, over));
                      // Its saved placement is about to belong to nobody.
                      setMoves((p) => { const next = new Map(p); next.delete(held); return next; });
                      setPending(null);
                    }}
                  >Merge entire branch</Btn>
                  <Btn onClick={() => setPending(null)}>Cancel</Btn>
                </Row>
              </>
            );
          })()}
        </Dialog>
      )}

      <Panel>
        <Row>
          <strong style={{ fontSize: 13 }}>Hex grid study</strong>
          <span style={{ color: "#9ca3af" }}>{camera.scale.toFixed(2)}×</span>
        </Row>
        {/**
          * **The ladder, as somewhere to go rather than somewhere you end up.**
          *
          * Greg, 2026-11-06: *"I think we need several levels of zoom, and
          * smooth animations between them."* The drawing itself never steps —
          * it morphs continuously with the wheel — so this row is the other
          * half of that sentence: the rungs have names, and pressing one
          * travels there. `[` and `]` do the same from the keyboard.
          *
          * A rung the company cannot reach is still shown and still works; it
          * simply clamps, which is what a ten-person company does to the outer
          * rungs. Hiding them would make the ladder look different per company,
          * which is the one thing the design is trying not to do.
          */}
        <Row>
          <span style={{ color: "#6b7280" }}>zoom</span>
          {HEX_LADDER.map((rung) => (
            <Btn
              key={rung.name}
              small
              onClick={() => jumpTo(rung.name)}
              active={level === rung.name}
              disabled={!hexScene}
            >
              {rung.label}
            </Btn>
          ))}
        </Row>
        {/**
          * **The five settings rows came off here on 2026-11-06.** Layout,
          * place, rung, wedge and cell were each a row of buttons, and Greg
          * settled all five — see the constants above the component, which
          * hold both the values and the reasoning. Everything that is left in
          * this panel either *does* something (fit, undo, tidy) or *reports*
          * something, which is the distinction worth keeping: the study still
          * needs to tell you what the layout did, now that it has stopped
          * asking you how to do it.
          */}
        <Row>
          <Btn small onClick={fit}>fit</Btn>
          {/** Greg, 2026-10-20: *"a button in the interface **and** ctrl+z /
            * cmd+z"*. It sits with the other things you press rather than
            * floating over the map, and it is always here once there is
            * something to go back to — including on a company nobody has
            * made anything on, because a drag is a step too. */}
          <Btn small onClick={undo} disabled={!canUndo}>undo</Btn>
        </Row>
        {loaded && (moves.size > 0 || reparents.size > 0) && (
          <>
            <Row>
              <Btn small onClick={tidy}>
                {tidyStage === 0 ? "tidy up" : "tidy up again — compress"}
              </Btn>
              {/** **"held", not "moved", since 2026-10-30.** Making something
                * settles the whole map into the hand's layer — see `settle`
                * in `hand.ts` — so this counts what the hand is holding and
                * what tidy would hand back to the engine, not how many tiles
                * anybody has dragged. Saying "moved" of a map nobody had
                * dragged was the readout telling a small lie. */}
              <span style={{ color: "#94a3b8", fontSize: 11 }}>
                {moves.size} held · {reparents.size} reparented
              </span>
            </Row>
            {tidyReport && (
              <Small style={{ color: "#166534" }}>
                gathered {tidyReport.gathered}, turned {tidyReport.turned} ·
                {" "}cousin clashes {tidyReport.before.cousins} → {tidyReport.after.cousins}
                {tidyReport.spaced.full + tidyReport.spaced.squeezed > 0 && (
                  <>
                    {" "}· kept the layout&apos;s room for{" "}
                    <b>{tidyReport.spaced.full}</b>, squeezed{" "}
                    <b style={{ color: tidyReport.spaced.squeezed === 0 ? "#166534" : "#b45309" }}>
                      {tidyReport.spaced.squeezed}
                    </b>
                  </>
                )}
              </Small>
            )}
          </>
        )}
        <hr style={{ border: 0, borderTop: "1px solid #f1f5f9", margin: "2px 0" }} />
        <Small suppressHydrationWarning>
          {/**
            * **Counted as people and places, not units and seats.** This read
            * `{scene.units.length} units · {tree.seats.size} people` until
            * 2026-11-06, and `seats` is nought on the people strata — every
            * human is a unit now, so nothing is orbiting anything. With the
            * teams strata gone that line said "0 people" about a map covered
            * in them. *Place* is Greg's word, from the same day.
            */}
          {peopleIds.size} {peopleIds.size === 1 ? "person" : "people"} ·{" "}
          {scene.units.length - peopleIds.size}
          {scene.units.length - peopleIds.size === 1 ? " place" : " places"} ·
          {" "}laid out in {ms.toFixed(0)}ms
        </Small>
        {stats ? (
          <>
            <Small suppressHydrationWarning>
              <b style={{ color: "#166534" }}>
                {((100 * live.touchingFamily) / Math.max(1, live.children)).toFixed(0)}%
              </b>{" "}of children touch their family ·{" "}
              <b style={{ color: live.exclaves === 0 ? "#166534" : "#b91c1c" }}>{live.exclaves}</b>
              {" "}do not
            </Small>
            <Small suppressHydrationWarning>
              {live.wholeFamilies}/{live.families} families are one patch ·{" "}
              {((100 * live.touchingParent) / Math.max(1, live.children)).toFixed(0)}% touch the
              parent itself
            </Small>
            {/* Law 3. Counted from the arrangement on screen, like the rest. */}
            <Small suppressHydrationWarning>
              <b style={{ color: live.curled === 0 ? "#166534" : "#b91c1c" }}>
                {((100 * live.curled) / Math.max(1, live.children)).toFixed(0)}%
              </b>{" "}sit nearer the centre than their parent
              {live.curled > 0 ? <> · worst <b>{live.curlWorst}</b> tiles</> : null}
            </Small>
            {/* The one that shows a loopback. Curl-back alone reads nought on a
                clean load while chains still wind round the centre. */}
            <Small suppressHydrationWarning>
              <b style={{ color: live.level === 0 ? "#166534" : "#b45309" }}>
                {((100 * live.level) / Math.max(1, live.levelOf)).toFixed(0)}%
              </b>{" "}of team-and-above rungs go round the centre, not away from it
            </Small>
          </>
        ) : (
          <Small>the layout that ships today, drawn by this same renderer</Small>
        )}
        <Small>
          <b>{Math.round(b.maxX - b.minX).toLocaleString()} × {Math.round(b.maxY - b.minY).toLocaleString()}</b> world units across
        </Small>
        {/**
          * **How big a cell is, which is the number the whole ladder reads.**
          * On the panel because it is otherwise invisible, and because every
          * threshold in `hexLod.ts` is written in it — so anybody arguing with
          * where a rung sits can see the figure they are arguing about.
          */}
        <Small>
          cell <b>{cellPx.toFixed(cellPx < 10 ? 1 : 0)}px</b> ·{" "}
          {Math.round(size.width / Math.max(cellPx * 1.5, 0.01))} across
        </Small>
        {/**
          * **What the branch in your hand is answering to**, while you hold it.
          *
          * The whole of the gesture is one number and there is no way to guess
          * it from the screen, so it is on the panel: at 1.00 the branch is
          * going back to the picture the master centre drew, and at nought it is
          * an orderly chart pointing away from the centre. The chart's size is
          * there too, because a chart of a large branch is *wide* — far wider
          * than the radial picture it replaces — and that is the honest
          * objection to dragging a division out to the edge.
          */}
        {drag?.deference !== null && drag?.deference !== undefined && (
          <Small suppressHydrationWarning style={{ color: "#0f766e" }}>
            deference <b>{drag.deference.toFixed(2)}</b> —{" "}
            {drag.deference > 0.9
              ? "going back to where the master centre had it"
              : drag.deference > 0.4
                ? "part way between the centre's picture and a chart"
                : "an orderly chart, pointing away from the centre"}
          </Small>
        )}
        {scatter && (
          <>
            <Small suppressHydrationWarning>
              <b style={{ color: scatter.crowded === 0 ? "#166534" : scatter.crowded > scatter.people / 20 ? "#b91c1c" : "#a16207" }}>
                {scatter.crowded}
              </b>{" "}of {scatter.people} people sit next to somebody from another team
            </Small>
            <Small suppressHydrationWarning>
              <b style={{ color: scatter.touching === 0 ? "#166534" : "#b91c1c" }}>{scatter.touching}</b>
              {" "}cells press against a different one of the {scatter.divisions} top-level
              groups (rung {scatter.rung})
            </Small>
          </>
        )}
        {missing > 0 && (
          <Small style={{ color: "#b91c1c" }}>
            <b>{missing}</b> unit{missing === 1 ? " is" : "s are"} missing from the map
            entirely — the layout gave {missing === 1 ? "it" : "them"} no cell. Please tell
            Claude what you just did.
          </Small>
        )}
        {buried > 0 && (
          <Small style={{ color: "#b91c1c" }}>
            <b>{buried}</b> unit{buried === 1 ? "" : "s"} sharing a cell with another —
            they cannot be pointed at. Please tell Claude what you just did.
          </Small>
        )}
        <Small style={{ color: "#94a3b8" }}>
          {mode === "hex"
            ? justMoved
              ? "pick that tile up again within 5s to tidy its branch — islands spaced by how closely related they are"
              : "drag a tile to move it and its branch · hold over another to merge"
            : "drag to pan"}
        </Small>
        {hovered && (
          <Small>
            <b>{hovered.name}</b> — CEO+{hovered.depth} · {hovered.totalSeats} in branch
            {hexScene?.hex.exclaves.has(hovered.id) ? " · exclave" : ""}
          </Small>
        )}
      </Panel>
    </>
  );
}

const pStyle: React.CSSProperties = { margin: "6px 0 10px", fontSize: 12, lineHeight: 1.55, color: "#475569" };

/**
 * **What a node is asked, and in what order** — the grow study's sequence,
 * unchanged (2026-09-19).
 *
 * A person is asked who they are and what they do. The **lone first person**
 * is then asked one more thing, and it is the question the whole study exists
 * for: *does this person have any teammates?* Nobody else is asked it, because
 * once there is a team there is nothing left to discover.
 */
type Step =
  | { key: "name"; title: string; kind: "text"; placeholder: string; suggestions: readonly string[] }
  | { key: "role" | "purpose"; title: string; kind: "select"; options: readonly string[] }
  | { key: "teammates"; title: string; kind: "choice" };

export function stepsFor(kind: "person" | "place", isLoneRoot: boolean): Step[] {
  if (kind === "place") {
    return [
      { key: "name", title: "What is this team called?", kind: "text", placeholder: "Team name", suggestions: PLACE_NAMES },
      { key: "purpose", title: "What does it deliver?", kind: "select", options: PURPOSES },
    ];
  }
  const base: Step[] = [
    { key: "name", title: "Who is this?", kind: "text", placeholder: "Their name", suggestions: SAMPLE_NAMES },
    { key: "role", title: "What do they do?", kind: "select", options: ROLES },
  ];
  if (!isLoneRoot) return base;
  return [...base, { key: "teammates", title: "Does this person have any teammates?", kind: "choice" }];
}

const Dialog = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    position: "absolute", left: "50%", top: 72, transform: "translateX(-50%)", zIndex: 20,
    width: 380, padding: "14px 16px", background: "#fff", border: "1px solid #e2e8f0",
    borderRadius: 14, boxShadow: "0 18px 48px rgba(15,23,42,0.18)",
    fontFamily: "ui-sans-serif, system-ui", fontSize: 13, color: "#0f172a",
  }}>{children}</div>
);

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    position: "absolute", right: 12, top: 12, width: 272, padding: "10px 12px",
    background: "rgba(255,255,255,0.94)", border: "1px solid #e5e7eb", borderRadius: 12,
    display: "flex", flexDirection: "column", gap: 6, zIndex: 5,
    fontFamily: "ui-sans-serif, system-ui", fontSize: 12, color: "#374151",
    boxShadow: "0 6px 20px rgba(15,23,42,0.06)",
  }}>{children}</div>
);

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
);

const Small = ({ children, suppressHydrationWarning, style }: {
  children: React.ReactNode; suppressHydrationWarning?: boolean; style?: React.CSSProperties;
}) => (
  <div style={{ fontSize: 11, lineHeight: 1.5, color: "#4b5563", ...style }}
    suppressHydrationWarning={suppressHydrationWarning}>{children}</div>
);

const Btn = ({ children, onClick, active, primary, disabled, small }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean;
  primary?: boolean; disabled?: boolean; small?: boolean;
}) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small ? "3px 9px" : "6px 12px", borderRadius: 999,
    cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 11 : 12,
    border: `1px solid ${active || primary ? "#1e293b" : "#e2e8f0"}`,
    background: active || primary ? "#1e293b" : "#fff",
    color: disabled ? "#cbd5e1" : active || primary ? "#fff" : "#334155",
    opacity: disabled ? 0.6 : 1,
  }}>{children}</button>
);
