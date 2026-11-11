/**
 * **The zoom ladder on the hex map** — what the map shows as you pull back,
 * and the one number that decides it.
 *
 * Greg opened this on 2026-11-06: *"we're going to look at what happens when
 * we use zoom. I think we need several levels of zoom, and smooth animations
 * between them."* He described five levels — people, a team or a few teams,
 * teams of teams, companies, conglomerates — and said plainly what he was
 * unsure of: *"what defines the transition between each zoom level."* The
 * reasoning behind the answer is `docs/HEX-ZOOM.md`; this file is the answer.
 *
 * ## One input: how big a cell is on the glass
 *
 * The orbital map asks its ladder about **world scale**, and there that is the
 * right question, because a unit's size depends on what it carries. Here every
 * cell is the same size — a person, a team, a division and the company each
 * occupy one — so the only honest question is how many pixels a cell covers in
 * front of you.
 *
 * Greg found that number himself on 2026-10-02, asking for people sooner:
 * *"Ideally, we want to be able to see two or three teams on a standard 13"
 * display, and more on a larger screen."* It travels, which is the point: it
 * is the same number on a 13" laptop and a 32" monitor, and what differs
 * between them is how much company you see at that level of detail — which is
 * exactly what should differ.
 *
 * **Three things are deliberately not inputs.** *Viewport size* is already
 * handled, by the sentence above. *How many nodes are on screen* would make
 * panning change the level — move sideways into a dense branch and the map
 * changes character without you touching the zoom — and it oscillates, because
 * revealing detail is what puts the marks on screen that then hide it again.
 * *Company size and depth* would mean learning the map twice; they decide how
 * many rungs a company **has**, which is the next section, not where the rungs
 * are.
 *
 * ## The ladder elides itself
 *
 * Measured on 2026-11-06 through the real code, the zoom range available runs
 * from about three and a half doublings on a ten-person company to seven and a
 * half on the eleven-rung one. So a fixed ladder gives Sparrow Jam its top two
 * or three rungs and a large company all five — and that is right rather than
 * a compromise, because **a ten-person company has no team-of-teams level** and
 * a map that invented one would be lying. Nothing here needs tuning per
 * company; the small ones simply never reach the outer rungs.
 *
 * ## Conglomerates are not a sixth level
 *
 * Greg's own last sentence — a conglomerate *"is effectively a repeat of the
 * immediate-above point"* — is the key to the whole design. Org depth runs from
 * two rungs to eleven, so zoom level N cannot map to org rung N. Instead
 * `placePresence` below asks one question of **every** rung at once: is this
 * one big enough to read, and is the rung inside it too small to bother with?
 * Teams blob into functions into divisions into the company into a
 * conglomerate, by the same arithmetic, on an org of any depth.
 */
import { smoothstep } from "@/lib/map/camera/lod";

/** Cell circumradius in screen pixels. A cell is twice this across. */
export type CellPx = number;

/** `hexSize` is the cell's circumradius in world units; `scale` the camera's. */
export const cellPxOf = (hexSize: number, scale: number): CellPx => hexSize * scale;

/**
 * **The rungs, in cell-pixels.**
 *
 * Each is about ×3.5 from the one below — a little under two doublings — which
 * is far enough apart to be distinct and close enough that five of them fit in
 * the range a large company has. Only `person` has been through Greg's eyes
 * (the 140–230 band below is his); the rest are derived from how big a thing's
 * footprint needs to be before you can read it, and are meant to be looked at
 * and argued with rather than trusted.
 *
 * `work` is the one rung nothing draws yet. The hex study has no work data —
 * it uses none of `lib/map/work` — so the rung is defined, named and reachable,
 * and shows a person's tile at its largest. Greg has not yet settled whether
 * there should be a work level below people at all; `docs/HEX-ZOOM.md` argues
 * there should, on the grounds that a person's tile at 460px across is a glance
 * at their work rather than a read of it.
 */
export const HEX_LADDER = [
  { name: "work", label: "Work", cellPx: 520 },
  { name: "person", label: "Person", cellPx: 230 },
  { name: "team", label: "Team", cellPx: 52 },
  { name: "function", label: "Function", cellPx: 14 },
  { name: "whole", label: "Whole", cellPx: 4 },
] as const;

export type HexLevel = (typeof HEX_LADDER)[number]["name"];

/**
 * **When a person reads as a person**, in cell-pixels — Greg, 2026-10-02.
 *
 * Fully by the time a cell's circumradius reaches 230px, which makes a cell
 * 460px across, so a 1440px laptop holds about three of them. They start
 * arriving at 140px. This band predates the ladder and is the one rung in it
 * that was settled by looking.
 */
export const PEOPLE_AT_CELL_PX: readonly [number, number] = [140, 230];

/**
 * **When an individual tile is worth drawing at all.** Below this the lattice
 * is a texture rather than a set of things, and only places read — which is
 * Greg's *"humans cease to be visible as avatars, but may remain visible as
 * nodes or dots"*, and then stop being even that.
 */
export const TILES_AT_CELL_PX: readonly [number, number] = [5, 16];

/**
 * **When a tile carries its own name.** A name needs more room than a tile.
 *
 * **Centred on 55px — Greg's `0.15×` — and that is what the two numbers are
 * for.** A label cannot cross-fade: it is type in a box, and half-painted type
 * is worse than no type. So unlike every other figure here this one is read as
 * a switch, at the middle of its band, and the band exists to say where the
 * middle is. A cell on this lattice is 364 world units, so 0.15× is 54.6px.
 *
 * Greg set it on 2026-11-07 after seeing both ends of it: *"we need a
 * middleground on the labels. They all appeared too soon prior to this fix,
 * but on this fix they appeared too late."* Too soon was every person counting
 * as a landmark and bypassing this band altogether; too late was the leftover
 * clause described in `docs/HEX-ZOOM.md` § *Every person was a landmark*,
 * which held human names back to `0.52×`.
 */
export const NAMES_AT_CELL_PX: readonly [number, number] = [42, 68];

/** **When a person's work could be read inside their own tile.** Nothing draws
 *  this yet; see the note on `work` in `HEX_LADDER`. */
export const WORK_AT_CELL_PX: readonly [number, number] = [380, 560];

export type HexReveal = {
  /** How much a person reads as an individual rather than as part of a team. */
  people: number;
  /** How much any single tile reads as a thing rather than as texture. */
  tiles: number;
  /** How much a tile carries its own name. */
  names: number;
  /** Reserved for the work rung. Nothing reads it yet. */
  work: number;
};

const band = (b: readonly [number, number], x: number) => smoothstep(b[0], b[1], x);

/**
 * Every figure runs continuously from 0 to 1 and is read from the live camera
 * each frame, so detail **morphs** rather than switching on. On this map that
 * is nearly free: cells do not move when you zoom, so unlike the orbital map
 * nothing has to animate position — only presence and geometry cross-fade.
 */
export function hexRevealAt(cellPx: CellPx): HexReveal {
  return {
    people: band(PEOPLE_AT_CELL_PX, cellPx),
    tiles: band(TILES_AT_CELL_PX, cellPx),
    names: band(NAMES_AT_CELL_PX, cellPx),
    work: band(WORK_AT_CELL_PX, cellPx),
  };
}

/**
 * **When a node's gauges arrive**, in screen pixels across the ground the node
 * stands on — its host tile, which is also the figure `ringBand` weights a
 * ring by, so one number decides both how heavy a gauge is and whether it is
 * there at all.
 *
 * Greg, 2026-11-09: *"make the health rings have the same zoom behaviour as
 * /org — in master centre, they should be visible all the time, with the human
 * and team rings visible on zoom."* That is the orbital map's
 * `unitRingReveal`: the centre always summarizes the company, and each layer
 * below it lights up as you come down to it.
 *
 * **The orbital map asks that of depth, and here it cannot be.** The ladder
 * elides itself — a two-rung company and an eleven-rung one span the same five
 * rungs — so depth N does not name a zoom, and a per-depth staircase would
 * either never reach the people on a deep company or arrive all at once on a
 * shallow one. The hex map's own question is the one this file opens with: how
 * big is the thing on the glass. It gives the same answer, because on this
 * lattice **size is standing**: a person's tile is four fifths of a cell, a
 * team's is its cell, a place above a team overflows it by half a radius and
 * the master centre by three (`hostRadius` in `HexLab.tsx`). So the stack
 * arrives outward-in without anything being told to, on a company of any
 * depth, and no rung needs a number of its own.
 *
 * **The band is 32–52px because that is where the person rings already were.**
 * A person's tile is `PERSON_TILE` of their cell less the active gap, so these
 * two numbers put a person's gauges at 42–68 cell-pixels — `NAMES_AT_CELL_PX`,
 * the one ring figure Greg has looked at and settled (2026-11-08: *"let's
 * start with health rings becoming visible when human labels become visible
 * too"*). Nothing about a person's rings changed; what changed is what happens
 * to everything bigger than a person.
 */
export const RINGS_AT_HOST_PX: readonly [number, number] = [32, 52];

/**
 * **Why there is no stagger in here, and where it went instead.**
 *
 * This band was briefly split per node on 2026-11-09, each node fading over a
 * narrower slice of it according to how far it stood from the master centre,
 * so that a rung's worth of gauges would arrive as a wave rather than
 * together. Greg looked at it: *"it doesn't appear to work well — the rings
 * just appear at the zoom level."*
 *
 * He was right, and the reason is one line in `HexLab.tsx`: `onWheel` sets the
 * camera straight from the event. A wheel notch is an instantaneous jump in
 * scale, so anything written as a function of zoom crosses its whole range
 * between two frames and there is nothing to watch. A zoom-driven wave can
 * only be seen while the zoom is *travelling*, which on this page is the rung
 * buttons and nothing else.
 *
 * So the arrival is a function of **time** now, and it lives in `HexLab.tsx`
 * where a clock belongs — see `RING_WAVE_SPREAD_MS`. This file keeps the
 * question it can answer honestly: *does this node's gauge belong at this
 * zoom*. When it starts belonging is the renderer's business.
 */

/**
 * **How much of this node's ring stack is here.**
 *
 * The root is exempt, exactly as depth 0 is on the orbital map: the company's
 * own reading is the one that is true at every zoom, and at the outermost rung
 * it is the only thing on the glass still saying anything.
 *
 * All three are drawable there. They were not until 2026-11-10, when the
 * stack stopped being measured off the tile and started hugging the mark in
 * screen pixels — see `ringBand` — so the company's dial now keeps every
 * reading it has at the outermost rung. What it does *not* keep there is three
 * separate readings, and that is `hexStackBlend` below rather than this.
 *
 * **Read from the node's footprint, not from what is drawn.** Since
 * 2026-11-11 a node shrinks inside its cell as you come in (`hexNodeRoom`),
 * which holds its drawn size still on the glass — so a gauge gated on the
 * drawn size would freeze half-arrived and never finish. `footRadius` in
 * `HexLab.tsx` is the unshrunk figure, and it is what belongs here: whether a
 * node is big enough to wear a reading is a question about the standing the
 * lattice gives it, not about how much air has been opened around it.
 */
export function hexRingReveal(hostPx: number, isRoot: boolean): number {
  return isRoot ? 1 : band(RINGS_AT_HOST_PX, hostPx);
}

/**
 * **One reading, or three.**
 *
 * Greg, 2026-11-11: *"the human health rings appear at around zoom level
 * 0.14x. At that level, let's have a simplified single-ring that is a summary
 * of the three. An 'overall health' icon that gives way to the three-ring
 * version at a zoom of 0.5x. Animate/blend between them smoothly."*
 *
 * `0` is the one summary ring, `1` is the three, and in between both are drawn
 * at complementary weights so that one dissolves into the other. What the
 * single ring says is `ringSummary` in `app/lab/hex/health.ts`; where it sits
 * is `summaryBand` beside it, which puts it on the innermost of the three so
 * that nothing moves across the handover — the other two simply grow out of
 * it.
 *
 * **People only.** The first build applied this to every node and Greg sent it
 * back the same day: *"we applied the changes to the non-human nodes too —
 * those nodes should retain the three-ring system exactly as it was before we
 * made this change."* So a team, a place and the master centre always wear
 * their three, and `isPerson` is false for them.
 *
 * He is right, and the reason is in his own first sentence: *"the human health
 * rings appear at around zoom level 0.14x. At that level …"*. The problem he
 * was solving is a person's, because a person's tile is the smallest thing on
 * the lattice and the only one whose three rings are hairlines when they
 * arrive. Everything above a person is already big enough to read three when
 * it first wears any, which is the whole of `hexRingReveal` — and the master
 * centre's three-colour dial at the outermost rung is a reading of the company
 * that nothing else on the glass is giving.
 *
 * **Measured against the cell for the people it does apply to.** Every other
 * figure about a gauge in this file is asked per node, because *which* nodes
 * wear one is a question about standing. The size of the thing asking here is
 * already settled — it is a person, and every person on a lattice is the same
 * size — so what is left is how much room there is on the glass, which Greg
 * named in camera scale. 110 and 182 cell-pixels are 0.30x and 0.50x on the
 * roomy lattice, whose cell is 364 world units to a corner. One number for
 * every person in the frame is also what keeps the crowd batch cheap.
 *
 * That leaves the single ring a plateau of its own, which is the point of it:
 * a person's gauges finish fading in at 0.19x, the one ring then holds alone
 * until 0.30x, and it has given way by the 0.50x Greg asked for.
 */
export const STACK_AT_CELL_PX: readonly [number, number] = [110, 182];

export function hexStackBlend(cellPx: CellPx, isPerson: boolean): number {
  return isPerson ? band(STACK_AT_CELL_PX, cellPx) : 1;
}

/**
 * **Where a line stops getting thicker.**
 *
 * Greg, 2026-11-11: *"line weights for connection lines and outlines, but not
 * health rings, should scale with the viewport after zoom of 0.15x — that is,
 * they should remain a fixed thickness after that."*
 *
 * A chain on this map is a weight in the **world** — a share of a cell — so on
 * the glass it grows with every zoom step, and by 1x a connection line between
 * two people is fifteen pixels of ink. That is right pulled back, where the
 * lines *are* the structure and have to survive being drawn a cell apart, and
 * wrong close in, where they are scaffolding around the thing you came to
 * read.
 *
 * What comes back is the factor a world weight is multiplied by: `1` until a
 * cell covers `WEIGHT_PINS_AT_CELL_PX`, and past that whatever holds the
 * weight still on the glass. 55 cell-pixels is 0.15x on the roomy lattice.
 *
 * **Not the gauges**, by Greg's own sentence. A ring's weight is already a
 * screen-pixel figure with a floor and a ceiling of its own (`ringBand`), and
 * a gauge is a reading rather than a line. It is excluded by not calling this.
 */
export const WEIGHT_PINS_AT_CELL_PX = 55;

export function hexPenPin(cellPx: CellPx): number {
  return Math.min(1, WEIGHT_PINS_AT_CELL_PX / Math.max(cellPx, 1e-6));
}

/**
 * **The air that opens around a node as you come in.**
 *
 * Greg, 2026-11-11: *"at zoom 0.15x, we should gradually shrink the size of
 * the nodes (foreground and background) within their zoned area hexagon —
 * which is the hexagon grid not the host tile — and track that size
 * proportionally to the zoom, until a zoom of 1x, thereafter the size
 * relationships between items on the canvas returns to being fixed. This is
 * intended to make human nodes appear as if they have their own space at this
 * scale — lots of whitespace around humans … what should reasonably look like
 * a mass of frogspawn at one zoom should gracefully give way to clear,
 * relational data at another."*
 *
 * *Proportionally to the zoom* is the inverse law, and it is the one reading
 * that makes the rest of that sentence come true. Multiply a node's world size
 * by `pin / cellPx` and its size **on the glass** stops changing: from 0.15x
 * to 1x a person is the same chip of glass however far in you come — the same
 * tile, the same dot, the same gauges at the same weights — and what the zoom
 * buys is the distance between them. The frogspawn at 0.15x, where the tiles
 * touch, has opened out into dots on a wide white field by 1x, and the chains
 * are then the only thing joining them, which is the relational reading.
 *
 * The cell is untouched, per Greg's parenthesis. The lattice is the frame all
 * of this happens inside, and it is also why the map stays navigable while the
 * nodes empty out: the hexagons are still where they were.
 *
 * Past 1x the factor holds at its floor and node sizes resume growing with the
 * camera — *"thereafter the size relationships … returns to being fixed"* — so
 * zooming past the plateau dives into a person the way it always did.
 */
export const ROOM_OPENS_AT_CELL_PX = 55;
export const ROOM_OPEN_BY_CELL_PX = 364;
/** What is left of a node once the air is fully open: 0.15x of a cell's worth
 *  of standing, held from 1x inward. */
export const NODE_ROOM_FLOOR = ROOM_OPENS_AT_CELL_PX / ROOM_OPEN_BY_CELL_PX;

export function hexNodeRoom(cellPx: CellPx): number {
  return Math.min(
    1,
    Math.max(NODE_ROOM_FLOOR, ROOM_OPENS_AT_CELL_PX / Math.max(cellPx, 1e-6)),
  );
}

/**
 * **The white tile stops opening out long before the dot does.**
 *
 * Greg, 2026-11-11, after seeing the above: *"the white host cell behind each
 * node — the one that's a bit transparent and has a white outline — should fix
 * its size relationship with its surroundings at zoom 0.2x."*
 *
 * So the tile takes the same ramp, and then **stops reading the camera at 73
 * cell-pixels**: from 0.2x inward it keeps whatever share of its cell it had
 * there — about three quarters — and grows with the lattice like everything
 * else. The dot inside it carries on to 1x.
 *
 * The two are different things and this is what tells them apart. The **dot**
 * is the node, so holding it still on the glass is what empties the map out
 * and leaves the chains carrying the structure. The **tile** is not a node at
 * all: it is the ground that node stands on, and its whole job is to say *this
 * much of the lattice is theirs*. A tile that goes on shrinking stops saying
 * that — it becomes a chip floating in a cell it no longer has any stated
 * relationship to, which is exactly what Greg saw. Freezing the ratio keeps
 * the sentence true at every zoom past 0.2x.
 *
 * Nothing is gated on this: `hexRingReveal` reads the node's **footprint**,
 * the standing the lattice gives it, which neither this nor `hexNodeRoom`
 * touches.
 */
export const TILE_ROOM_HOLDS_AT_CELL_PX = 73;

export function hexTileRoom(cellPx: CellPx): number {
  return hexNodeRoom(Math.min(cellPx, TILE_ROOM_HOLDS_AT_CELL_PX));
}

/**
 * **How big a place has to be before it reads as one**, in screen pixels
 * across its longest side.
 *
 * This is the threshold the recursion turns on, and it is the one number that
 * decides which rung is currently *the* gummy bear. Below 48px a region is a
 * smudge whatever it contains; by 150px it is somewhere you could point at and
 * name.
 */
export const PLACE_READS_AT: readonly [number, number] = [48, 150];

/**
 * **Which rung currently draws as a place of its own.**
 *
 * The input is one number per tier: how wide a *typical* region at that tier is
 * in world units — the median, because a mean follows the one enormous division
 * every company has. Tier 0 is a team, tier 1 a team of teams, and so on
 * outward; the keys need not be contiguous and need not start at nought.
 *
 * A tier is a place when it is **big enough to read** and the tier inside it is
 * **not** — so exactly one rung dominates at any zoom, and two neighbouring
 * rungs cross-fade through the middle of the transition instead of swapping.
 * It is the same `a · (1 − b)` idiom the orbital ladder uses to hand the torus
 * over to the people it stands for, applied up the hierarchy instead of down
 * into a node.
 *
 * The lowest tier has nothing inside it to defer to, so it simply swells as it
 * becomes readable: at person zoom a team is the place, which is what the map
 * already looked like before any of this existed.
 */
export function placePresence(
  /** tier → the median width of a region at that tier, in world units. */
  footprints: ReadonlyMap<number, number>,
  scale: number,
): Map<number, number> {
  const tiers = [...footprints.keys()].sort((a, b) => a - b);
  const readable = new Map<number, number>();
  for (const tier of tiers) {
    readable.set(tier, band(PLACE_READS_AT, (footprints.get(tier) ?? 0) * scale));
  }
  const out = new Map<number, number>();
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const mine = readable.get(tier) ?? 0;
    const inside = i === 0 ? 0 : (readable.get(tiers[i - 1]) ?? 0);
    out.set(tier, mine * (1 - inside));
  }
  return out;
}

/**
 * **The rung the viewer is standing on** — for the panel, and for the jump.
 *
 * The drawing itself always uses the continuous figures above; this is the name
 * to put on them. The nearest rung in **log** space, because the ladder is
 * geometric: halfway between 52 and 230 is 110, not 141.
 */
export function levelAt(cellPx: CellPx): HexLevel {
  let best: HexLevel = HEX_LADDER[HEX_LADDER.length - 1].name;
  let closest = Infinity;
  const here = Math.log(Math.max(cellPx, 1e-6));
  for (const rung of HEX_LADDER) {
    const d = Math.abs(Math.log(rung.cellPx) - here);
    if (d < closest) { closest = d; best = rung.name; }
  }
  return best;
}

/** The camera scale that puts the map on a given rung. */
export function scaleForLevel(level: HexLevel, hexSize: number): number {
  const rung = HEX_LADDER.find((r) => r.name === level) ?? HEX_LADDER[1];
  return rung.cellPx / Math.max(hexSize, 1e-6);
}

/**
 * **The rung one step in or out from here.**
 *
 * Not "the neighbour of `levelAt`", which would stick: standing at 150px reads
 * as `person`, and stepping out from `person` would land on `team` at 52 — past
 * where you already are — while stepping *in* would go to `work`, skipping the
 * 230 you were heading for. So this steps relative to the **cell-pixels**, and
 * lands on the next rung that is genuinely further in or out than you are now.
 *
 * Returns null at either end of the ladder, which is what disables the button.
 */
export function stepLevel(cellPx: CellPx, direction: "in" | "out"): HexLevel | null {
  // The ladder is written outermost-last, so "in" means a larger cellPx.
  const rungs = [...HEX_LADDER].sort((a, b) => a.cellPx - b.cellPx);
  const margin = 1.05;
  if (direction === "in") {
    for (const rung of rungs) if (rung.cellPx > cellPx * margin) return rung.name;
    return null;
  }
  for (let i = rungs.length - 1; i >= 0; i--) {
    if (rungs[i].cellPx < cellPx / margin) return rungs[i].name;
  }
  return null;
}

/**
 * **How much of the map the places at these tiers have taken between them.**
 *
 * The total, not the largest — which sounds like a detail and is the
 * difference between a company that blobs together and one that does not.
 *
 * `placePresence` spreads a handover across two neighbouring rungs; that is
 * the crossfade, and it is the whole reason nothing pops. Halfway through one,
 * two tiers hold half the place each and the **largest single share is a
 * half** — so anything that steps aside by `max` steps aside only halfway, and
 * half of the old picture stays up underneath the blob that has already taken
 * over from it.
 *
 * Normally that is invisible, because another notch of the wheel finishes the
 * handover. At the outermost zoom it is permanent: the camera stops when the
 * company fits the window, so whatever crossfade is in flight there stays in
 * flight. Measured on the thousand-person company at its floor on 2026-11-06,
 * the two region rungs held **0.30 and 0.67** — so a third of the grey room
 * and a third of every team's own ground stayed on screen over the regions,
 * and the map read as a honeycomb of team patches rather than as a company.
 * The total is 0.97: nearly all of it has gone, which is the honest answer.
 *
 * Clamped, because the tiers sum to one by construction rather than by
 * arithmetic.
 */
export function placeTaken(
  place: ReadonlyMap<number, number>,
  tiers: Iterable<number>,
): number {
  let sum = 0;
  for (const tier of tiers) sum += place.get(tier) ?? 0;
  return Math.min(1, Math.max(0, sum));
}

/**
 * **How much softer a boundary's corners are than the shape they round.**
 *
 * Greg, 2026-11-06: *"as we zoom out, I'd like the borders around the team
 * blobs to soften even further — so by 0.05x zoom, we'd see the border radius
 * on the hexagon outlines … as they are defined. However, everything on a zoom
 * <0.05x, the border radius should increase, so by the time we hit whatever
 * the next increment is, the border radius of those hexagons is so high the
 * team boundary begins to appear smooth."*
 *
 * `0.05×` is his, read off the panel, and on this lattice a cell is 364 world
 * units, so it is **18px a cell** — just outside the Function rung. The rung
 * below it is `whole`, at 4px, and that is where the ramp finishes: by the
 * time the whole company is on the glass, a team has no corners left.
 *
 * It returns a **multiplier** on `NODE_CORNER` rather than a radius, so one
 * number softens a team, a region and a collar alike and they cannot drift
 * apart. The top of it is past the point where a hexagon's corner circle meets
 * the edge midpoints — the drawing clamps each corner to what its own two
 * half-edges can pay for — so the last part of the ramp is the boundary
 * turning into arcs that meet tangentially, which is the thing Greg means by
 * *smooth*.
 */
export const SOFTEN_FROM_CELL_PX = 18;
export const SOFTEN_TO_CELL_PX = HEX_LADDER[HEX_LADDER.length - 1].cellPx;

/**
 * **The top of the ramp, and why it sits just past where it bites.**
 *
 * A convex corner cannot take a radius over `0.866` of the hexagon's — the
 * drawing clamps each to what its own two half-edges can pay for — so what
 * this multiplier can usefully reach depends on the base it multiplies. On
 * `NODE_CORNER = 1/2`, which is what every area boundary is drawn with, the
 * clamp lands at `1.73×`: almost exactly here, so the ramp runs its whole
 * length and arrives at a boundary with no straight edge left in it just as
 * the outermost rung does.
 *
 * It is written as a multiplier rather than as that `1.73` so the two stay
 * honest if the base ever moves. It moved for an hour on 2026-11-07, when the
 * base went to `2/3` before Greg scoped that to people only — at which point
 * the clamp would have been `1.30×` and the ramp would have finished at about
 * 7px a cell instead of 4px. The end state would still have been right, which
 * is the property worth having.
 */
export const SOFTEN_MAX = 1.8;

/**
 * **How many steps the ramp is cut into, and why it is cut at all.**
 *
 * This is the one figure on the ladder that is *not* continuous, and the
 * reason is cost rather than taste. Every other figure here is read straight
 * into a colour or an alpha; this one changes the **shape** of a path, so a
 * new value means re-tracing every team and every region. Finding a boundary
 * is the expensive part and does not depend on the zoom, so it is cached —
 * but re-tracing sixty times a second for a radius that has moved by a
 * thousandth is still waste. Twenty steps across the ramp is finer than the
 * eye can follow a corner opening, and works out at about one rebuild every
 * three wheel notches.
 */
export const SOFTEN_STEPS = 20;

/**
 * Measured in **log** space, like everything else about this camera: 18px to
 * 4px is four and a half times, and a ramp that is linear in pixels spends
 * nearly all of itself in the first wheel notch and then creeps. In log space
 * each notch softens the boundary by the same amount, which is what a hand on
 * a wheel expects.
 */
export function softeningAt(cellPx: CellPx): number {
  const here = Math.log(Math.max(cellPx, 1e-6));
  const from = Math.log(SOFTEN_FROM_CELL_PX);
  const to = Math.log(SOFTEN_TO_CELL_PX);
  const t = 1 - smoothstep(to, from, here);
  const soft = 1 + (SOFTEN_MAX - 1) * t;
  return Math.round(soft * SOFTEN_STEPS) / SOFTEN_STEPS;
}
