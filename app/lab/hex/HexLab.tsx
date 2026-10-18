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
import { BUBBLE_TIER, bubblesFor, grow } from "@/lib/map/layout/hex/bubbles";
import {
  branchOf,
  dropOutcome,
  hoverGroup,
  outline,
  placeIsland,
  type DropOutcome,
} from "@/lib/map/layout/hex/arrange";
import {
  cellKey, cellToWorld, corners, cornersAt, hexDistance, neighbours, worldToCell,
  type Cell,
} from "@/lib/map/layout/hex/coords";
import {
  cameraAbout, cullBox, fitCamera, minScaleFor, wheelZoom, type Camera, type Size,
} from "@/lib/map/camera/viewport";
import {
  LOD_LADDER, drawnUnitRadius, isLandmark, revealAt, smoothstep, tierAt, unitLabelVisible,
} from "@/lib/map/camera/lod";

export type LabOrg = OrgInput;

/** How long the hand must rest on a tile before a drop over it means merge
 *  rather than reparent. The orbital map's own dwell, and for the same reason:
 *  a pass must not arm anything. */
const HOLD_MS = 550;

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

/** How faint a connection line goes where it passes behind somebody's tile.
 *  Faint enough to read as *behind* rather than *through*, strong enough that
 *  the eye can still follow it out the far side. */
const BEHIND_ALPHA = 0.18;

/**
 * When the people appear, measured in **cell pixels** rather than world scale
 * (Greg, 2026-10-02).
 *
 * *"Right now it feels like we need to zoom too far before people become
 * visible… Ideally, we want to be able to see two or three teams on a standard
 * 13" display, and more on a larger screen."*
 *
 * The orbital map reveals people at 1.7–2.1× world scale, which is the right
 * question asked of the wrong map: there, a unit's size depends on what it
 * carries. Here every cell is the same size, so the honest question is how big
 * a cell is **on the glass** — and that answer travels, because it is the same
 * on a 13" laptop and a 32" monitor.
 *
 * Fully shown once a cell's circumradius reaches 230px: a cell is then 460px
 * across, so a 1440px-wide laptop shows about three teams, and a larger screen
 * proportionally more. They start arriving at 140px, around five cells across.
 */
const PEOPLE_AT_CELL_PX: [number, number] = [140, 230];


/**
 * How far the hand may drift and still be holding, as a share of a cell.
 *
 * Without this the clock ran from the moment the pointer entered a tile and
 * kept running while the hand was still moving, so dragging a branch slowly
 * across the map armed a merge on whatever it happened to be over — Greg,
 * 2026-10-01: *"pulling a family far away results in the reparent dialog
 * appearing."* The orbital map learned the same lesson on 2026-09-23. **A
 * dwell is a hold**: travel restarts the clock.
 */
const HOLD_SLACK = 0.25;

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
  | { kind: "reparent"; unitId: string; newParentId: string; cells: Map<string, Cell> }
  | { kind: "merge"; unitId: string; withUnitId: string }
  | { kind: "blocked"; unitId: string; occupiedBy: string; cells: Map<string, Cell> | null }
  | { kind: "reshape"; unitId: string; cells: Map<string, Cell> };

export default function HexLab({
  org, companyKey, initialDensity, groups, leads,
}: {
  org: LabOrg;
  companyKey: string;
  initialDensity: HexDensity;
  /** unit id → the group it should be kept together with, when people have
   *  been promoted to units and a team is a crowd rather than a cell. */
  groups?: readonly (readonly [string, string])[];
  /** The people who lead the unit they hang from. */
  leads?: readonly string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 1200, height: 800 });
  const [density, setDensity] = useState<HexDensity>(initialDensity);
  const [mode, setMode] = useState<"hex" | "orbits">("hex");
  /**
   * **Which driver decides where things go** — Greg, 2026-10-16, chose ragged
   * rings. Both are here because the only way to settle which reads better is to
   * put them side by side, which is how the atlas arrived beside the
   * archipelago. The atlas is still the default, so nothing anybody has looked
   * at so far changes until this is pressed.
   */
  const [driver, setDriver] = useState<HexDriver>("atlas");
  /**
   * **Whether a rung may step sideways round the centre.** Greg, 2026-10-17, on
   * seeing chains loop back: *"what is preventing that code from working?"*
   *
   * `forbid` is the default since 2026-10-17 and is now what Law 3 says. `allow`
   * is the older rule — *"equal distance is allowed; nearer is not"* — kept so
   * the two can still be put side by side, which is how the decision was made.
   * The toggle stays for that reason and not because the question is open.
   */
  const [sideways, setSideways] = useState<"allow" | "forbid">("forbid");
  const [hover, setHover] = useState<string | null>(null);

  /** Hand placements and reparents, kept in this browser between visits. */
  const [moves, setMoves] = useState<Map<string, Cell>>(() => new Map());
  const [reparents, setReparents] = useState<Map<string, string>>(() => new Map());
  /** Units somebody dragged themselves. Tidy up will not move these — it is
   *  what separates "neaten what I have" from "throw it away". */
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
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

  const baseTree = useMemo(
    () => buildOrbitalTree(org, { mergePassThroughRoot: false, workCountFor: () => 6 }),
    [org],
  );
  const tree = useMemo(
    () => (reparents.size ? applyOverrides(baseTree, { unitParent: reparents }) : baseTree),
    [baseTree, reparents],
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
      }) : null;
      // **Only keep what this company still contains.** An arrangement saved
      // before the fixture's ids became deterministic names units that no
      // longer exist, and keeping those entries puts phantom tiles on the map:
      // ground nothing can be placed on, cells that cannot be hovered, and a
      // dialog naming a raw id. Anything unrecognised is dropped on the floor.
      const known = (id: string) => baseTree.units.has(id);
      setMoves(new Map((saved?.moves ?? []).filter(([id]) => known(id))));
      setReparents(new Map(
        (saved?.reparents ?? []).filter(([id, parentId]) => known(id) && known(parentId)),
      ));
      setPinned(new Set((saved?.pinned ?? []).filter(known)));
    } catch {
      setMoves(new Map());
      setReparents(new Map());
      setPinned(new Set());
    }
    setTidyStage(0);
    setLoadedFor(storeKey);
  }, [storeKey, baseTree]);

  useEffect(() => {
    // Never write back before the first read, and never write one key's
    // arrangement under another's.
    if (loadedFor !== storeKey) return;
    try {
      if (!moves.size && !reparents.size) window.localStorage.removeItem(storeKey);
      else window.localStorage.setItem(storeKey, JSON.stringify({
        moves: [...moves], reparents: [...reparents], pinned: [...pinned],
      }));
    } catch {
      // A browser that will not keep it is not a reason to stop working.
    }
  }, [storeKey, loadedFor, moves, reparents, pinned]);

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
  const peopleIds = useMemo(() => new Set((groups ?? []).map(([id]) => id)), [groups]);
  const leadIds = useMemo(() => new Set(leads ?? []), [leads]);

  const groupOf = useMemo(() => {
    if (!groups?.length) return undefined;
    const map = new Map(groups);
    // A person belongs to their team; a team belongs to itself, so the team's
    // own cell counts as part of the crowd it is trying to stay next to.
    return (unitId: string) => map.get(unitId) ?? unitId;
  }, [groups]);


  const baseAllocation = useMemo(
    () => allocateByTerritory(baseTree, { leads: leadIds, people: peopleIds, driver, sideways }),
    [baseTree, leadIds, peopleIds, driver, sideways],
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
   * branch. A dial because the only way to settle how abrupt it should look is
   * to look at it; see `TAPER_RUNGS`.
   */
  const [taper, setTaper] = useState(TAPER_RUNGS);


  /** The allocation with every hand placement applied on top. Reparenting does
   *  **not** re-allocate: Greg's rule is that a reparented tile stays exactly
   *  where it was put and changes colour, so the cells are the person's. */
  const allocation = useMemo(() => {
    if (!moves.size) return baseAllocation;
    /**
     * **A hand placement only lands if its cell is still free.**
     *
     * Hand placements live in this browser and the engine changes underneath
     * them — a new rule, a different shape, a fix to the packer — and the cell
     * somebody put a tile on last week now belongs to somebody else. Applying
     * them blindly put two units on one cell: Greg, 2026-10-03, replaying 1,258
     * saved placements, *"72 units sharing a cell with another — they cannot be
     * pointed at."* Measured on a saved arrangement from the other shape, 1,479
     * placements produced 66 of them.
     *
     * Checking as we go keeps the map **injective at every step**, which is the
     * property that matters: the layout starts with one unit per cell, a
     * placement is only taken when its target is free, and taking it frees the
     * cell that unit came from. So the invariant cannot be broken by any
     * sequence of placements, however stale. Anything refused simply stays
     * where the engine put it, which is the honest answer to "that cell is not
     * yours any more".
     */
    const cells = new Map(baseAllocation.cells);
    const occupants = new Map<string, string>();
    for (const [id, cell] of cells) occupants.set(cellKey(cell), id);
    for (const [id, cell] of moves) {
      const key = cellKey(cell);
      const holder = occupants.get(key);
      if (holder !== undefined && holder !== id) continue;
      const had = cells.get(id);
      if (had) occupants.delete(cellKey(had));
      cells.set(id, cell);
      occupants.set(key, id);
    }
    return { ...baseAllocation, cells, occupants };
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
      const list = byTeam.get(teamId) ?? [];
      list.push(cell);
      byTeam.set(teamId, list);
    }
    // The team's own cell belongs inside its outline too.
    for (const teamId of byTeam.keys()) {
      const own = hexScene.hex.cells.get(teamId);
      if (own) byTeam.get(teamId)!.push(own);
    }
    return [...byTeam].map(([teamId, cells]) => ({
      teamId,
      cells,
      segments: outline(cells, hexScene.hex.size),
    }));
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
  const teamSpacers = useMemo(() => {
    if (!hexScene || !teamOutlines.length) return null;
    if (typeof Path2D === "undefined") return null;
    const size = hexScene.hex.size;
    const taken = new Set<string>();
    for (const cell of hexScene.hex.cells.values()) taken.add(cellKey(cell));
    const path = new Path2D();
    const drawn = new Set<string>();
    for (const team of teamOutlines) {
      for (const cell of grow(team.cells)) {
        const key = cellKey(cell);
        if (taken.has(key) || drawn.has(key)) continue;
        drawn.add(key);
        const pts = corners(cell, size);
        path.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) path.lineTo(pts[i].x, pts[i].y);
        path.closePath();
      }
    }
    return path;
  }, [hexScene, teamOutlines]);
  /**
   * **The bubbles** (Greg, 2026-10-16, requirements 4 and 6).
   *
   * Built from the *live* cells, so a bubble follows a hand that moved half a
   * division across the map and there is nothing to keep in step. Memoised on
   * the arrangement rather than computed in the paint loop: on the largest
   * company this is 131 bubbles over 37,000 cells and about 30ms, which is fine
   * once and hopeless sixty times a second.
   *
   * Each one is turned into a `Path2D` here too, for the same reason. Filling a
   * region cell by cell is tens of thousands of calls a frame; one path per
   * bubble is 131, and the browser unions the hexagons itself.
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
      const fill = new Path2D();
      for (const cell of bubble.cells) {
        const pts = corners(cell, size);
        fill.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) fill.lineTo(pts[i].x, pts[i].y);
        fill.closePath();
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const seg of bubble.edge) {
        minX = Math.min(minX, seg.from.x, seg.to.x);
        maxX = Math.max(maxX, seg.from.x, seg.to.x);
        minY = Math.min(minY, seg.from.y, seg.to.y);
        maxY = Math.max(maxY, seg.from.y, seg.to.y);
      }
      return { ...bubble, fill, box: { minX, maxX, minY, maxY } };
    });
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
  const maxDepth = useMemo(() => scene.units.reduce((m, u) => Math.max(m, u.depth), 0), [scene]);

  const floor = useMemo(
    () => minScaleFor(scene.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, size),
    [scene, size],
  );
  const [camera, setCamera] = useState<Camera>({ scale: 0.05, x: 0, y: 0 });
  const fit = useCallback(() => {
    if (scene.bounds) setCamera(fitCamera(scene.bounds, size, { min: floor }));
  }, [scene, size, floor]);
  /**
   * Fit when the *picture* changes, never when the arrangement does.
   *
   * `fit` depends on `scene`, and the scene changes on every move — so the
   * camera was snapping back to the whole company each time a tile was
   * repositioned, throwing away the zoom somebody was working at. Greg,
   * 2026-10-03: *"zoom should persist."* The signature is what the camera
   * actually responds to; a move is not part of it.
   */
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

  const commit = useCallback((
    cells: Map<string, Cell>,
    newParent?: { id: string; parentId: string },
    anchorId?: string,
  ) => {
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
  }, []);

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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.transform(scale, 0, 0, scale, camera.x, camera.y);

    const visible = scene.units.filter(
      (u) => u.x >= view.minX && u.x <= view.maxX && u.y >= view.minY && u.y <= view.maxY,
    );
    const visibleIds = new Set(visible.map((u) => u.id));
    const hueFor = (id: string) => hueById.get(id) ?? 0;
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
    const nodePath = (cell: Cell, depth: number, shrink = 1, person = false) => {
      const pts = cornersAt(
        cellToWorld(cell, hexSize),
        hexSize * nodeScale(person ? maxDepth : depth, maxDepth) * shrink,
      );
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
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
        const weight = Math.min(1, (onScreen - 48) / 112);
        if (weight <= 0) continue;

        const hue = hueFor(bubble.unitId);
        ctx.fillStyle = css(hue, bubble.depth, maxDepth, 0.05 * weight);
        ctx.fill(bubble.fill);

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
    if (teamSpacers) {
      ctx.fillStyle = "rgba(15,23,42,0.05)";
      ctx.fill(teamSpacers);
    }
    /**
     * **A line round a group of teams, which is a border coming back.**
     *
     * Greg took the borders off every bubble on 2026-10-16 — *"there are borders
     * around the bubbles — they don't need to be there"* — and what was drawn
     * then was a coastline in each region's own hue at every rung, twelve deep
     * on the largest company. This is one line, at one rung, in grey. The rung
     * is the one that holds teams, which is exactly the *"collection of teams
     * with a common parent"* the extra hexagon of space belongs to, so the line
     * is drawn where there is now real ground to show.
     */
    if (bubbles.length > 0) {
      ctx.lineWidth = Math.max(0.6, 1.6 / scale);
      ctx.strokeStyle = "rgba(15,23,42,0.14)";
      ctx.beginPath();
      for (const bubble of bubbles) {
        if (bubble.tier !== BUBBLE_TIER) continue;
        const { box } = bubble;
        if (box.maxX < view.minX || box.minX > view.maxX) continue;
        if (box.maxY < view.minY || box.minY > view.maxY) continue;
        for (const seg of bubble.edge) {
          ctx.moveTo(seg.from.x, seg.from.y);
          ctx.lineTo(seg.to.x, seg.to.y);
        }
      }
      ctx.stroke();
    }

    // 1a. The territory, as a faint wash over the whole cell. It is what makes
    //     a division read as one place from far away, where the nodes are only
    //     a few pixels — so it is strongest pulled back and fades as the nodes
    //     themselves take over.
    if (hexScene) {
      const wash = 0.30 - 0.24 * Math.min(1, scale / 1.1);
      if (wash > 0.02) {
        for (const unit of visible) {
          const cell = hexScene.hex.cells.get(unit.id);
          if (!cell) continue;
          hexPath(cell);
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
        ctx.lineWidth = Math.max(0.6, hexSize * 0.27 * nodeScale(unit.depth, maxDepth));
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
        for (const run of chain.runs) {
          ctx.beginPath();
          ctx.moveTo(run.points[0].x, run.points[0].y);
          for (let i = 1; i < run.points.length; i++) ctx.lineTo(run.points[i].x, run.points[i].y);
          ctx.strokeStyle = css(hueFor(chain.unitId), unit.depth, maxDepth, run.under ? BEHIND_ALPHA : 0.95);
          ctx.stroke();
        }
      }
    }

    // 2c. The nodes themselves, inset in their cells by depth — the company
    //     fills its hexagon, a team keeps half the area, and the gap between a
    //     node and its container is what tells two peers apart.
    if (hexScene) {
      for (const unit of visible) {
        const cell = hexScene.hex.cells.get(unit.id);
        if (!cell) continue;
        const moving = drag?.members.has(unit.id) ?? false;
        const person = peopleIds.has(unit.id);
        nodePath(cell, unit.depth, 1, person);
        ctx.fillStyle = css(hueFor(unit.id), unit.depth, maxDepth, moving ? 0.22 : 0.97);
        ctx.fill();
        // A structural node is a *place*; a person is a human. The border is
        // what says which, before you have read a single label.
        if (!person && peopleIds.size > 0) {
          ctx.lineWidth = Math.max(0.8, hexSize * 0.035);
          ctx.strokeStyle = "rgba(15,23,42,0.75)";
          ctx.stroke();
        }
      }
    }

    // 2c-ii. The leadership chain. Greg, 2026-10-03: *"let's put a
    //     stronger-coloured connection line between team leads and their
    //     parent nodes to indicate team leadership roles."* A lead is a person
    //     whose chain goes to a structural node, so the chain itself is the
    //     statement — this one line says "she runs this".
    if (hexScene && leadIds.size > 0) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const chain of chains) {
        if (!leadIds.has(chain.unitId)) continue;
        ctx.beginPath();
        ctx.moveTo(chain.points[0].x, chain.points[0].y);
        for (let i = 1; i < chain.points.length; i++) ctx.lineTo(chain.points[i].x, chain.points[i].y);
        ctx.lineWidth = Math.max(1.2, hexSize * 0.1);
        ctx.strokeStyle = "rgba(15,23,42,0.85)";
        ctx.stroke();
      }
    }

    // 2d. A line round each team, so a crowd of people reads as a team even
    //     though the colour is the division's. Under the nodes, like every
    //     other boundary.
    if (teamOutlines.length > 0) {
      ctx.lineWidth = Math.max(0.7, 2.2 / scale);
      ctx.strokeStyle = "rgba(15,23,42,0.30)";
      ctx.beginPath();
      for (const team of teamOutlines) {
        for (const seg of team.segments) {
          ctx.moveTo(seg.from.x, seg.from.y);
          ctx.lineTo(seg.to.x, seg.to.y);
        }
      }
      ctx.stroke();
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
    const warn = drag ? drag.reshaped : pending?.kind !== "reparent";
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
        ctx.beginPath();
        for (const seg of outline(cells, hexSize)) {
          ctx.moveTo(seg.from.x, seg.from.y);
          ctx.lineTo(seg.to.x, seg.to.y);
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
        nodePath(cell, unit.depth);
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
          nodePath(cell, parent.depth, 0.86);
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
          for (const chain of hops) {
            ctx.moveTo(chain.points[0].x, chain.points[0].y);
            for (let i = 1; i < chain.points.length; i++) {
              ctx.lineTo(chain.points[i].x, chain.points[i].y);
            }
          }
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
    for (const unit of visible) {
      // In hex mode the node carries "a unit is here", so the disc is only the
      // thing people orbit and is drawn at its true size. Holding it above a
      // screen floor, as the orbital map must, put a white dot on every tile at
      // overview and said nothing the hexagon was not already saying.
      const drawn = hexScene ? unit.r : drawnUnitRadius(unit, scale, unit.drawCeiling);
      if (drawn * scale < 2) continue;
      const isParent = unit.childIds.length > 0;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, drawn, 0, Math.PI * 2);
      ctx.fillStyle = unit.id === hover ? "#0f172a" : "#ffffff";
      ctx.fill();
      // A parent wears a heavier ring — same size, different treatment, which
      // is how you find the manager inside a blob of one colour.
      ctx.lineWidth = Math.max(0.5, (isParent ? 3 : 1.2) / scale);
      ctx.strokeStyle = css(hueFor(unit.id), unit.depth, maxDepth, 0.95);
      ctx.stroke();
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
      const inside = unitLabelVisible(drawn, scale) || forced.has(unit.id);
      const landmark = !inside && isLandmark(unit.depth);
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
  }, [camera, scene, hexScene, chains, size, hover, regions, regionOrder, maxDepth, drag, pending, tree, justMoved, teamOutlines, teamSpacers, bubbles, peopleIds, leadIds, hueById]);

  // --- input ---------------------------------------------------------------

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCamera((cam) => {
      const z = wheelZoom(cam, e.deltaY, pointer);
      return cameraAbout(Math.min(12, Math.max(floor, z.scale)), z.world, z.screen);
    });
  }, [floor]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const world = worldAt(e.clientX, e.clientY, rect);
    const hit = unitAtPointer(world);
    if (hexScene && hit && hit !== tree.rootId && !pending) {
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
      return;
    }
    pan.current = { x: e.clientX, y: e.clientY, cam: camera };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    if (pan.current) {
      const p = pan.current;
      setCamera({ scale: p.cam.scale, x: p.cam.x + (e.clientX - p.x), y: p.cam.y + (e.clientY - p.y) });
      return;
    }
    const world = worldAt(e.clientX, e.clientY, rect);
    if (drag && hexScene) {
      const target = worldToCell(world, hexScene.hex.size);

      // A hold is a hold. If the hand has travelled, the clock starts again —
      // even when it has not left the tile it is over.
      const travelled = Math.hypot(world.x - drag.holdAt.x, world.y - drag.holdAt.y);
      const stillHolding = travelled <= hexScene.hex.size * HOLD_SLACK;

      if (cellKey(target) === cellKey(drag.target)) {
        if (!stillHolding) {
          setDrag({ ...drag, world, holdAt: world, holdSince: performance.now() });
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
        setDrag({
          ...drag, world, target,
          landing: relaid?.cells ?? null,
          anchor: relaid?.cells.get(drag.unitId) ?? null,
          reshaped: false,
          radiated: Boolean(relaid),
          deference: relaid?.deference ?? null,
          heldOver: null,
          holdAt: world, holdSince: performance.now(),
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
      const over = allocation.occupants.get(cellKey(target)) ?? null;
      const stillOver = over && over === drag.heldOver;
      setDrag({
        ...drag, world, target,
        landing: landing.kind === "no-room" ? null : landing.cells,
        anchor: landing.kind === "no-room" ? null : landing.anchor,
        // Only a shape somebody built and would now lose is worth a dialog.
        // A tree the hand asked for is not one of those, and nor is a landing
        // that kept every group's shape and only stepped the clashes aside.
        reshaped: landing.kind === "reshaped",
        radiated: landing.kind === "parted",
        heldOver: over && !drag.members.has(over) ? over : null,
        holdAt: stillOver && stillHolding ? drag.holdAt : world,
        holdSince: stillOver && stillHolding ? drag.holdSince : performance.now(),
      });
      return;
    }
    setHover(unitAtPointer(world));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    pan.current = null;
    if (!drag || !hexScene) { setDrag(null); return; }

    const heldLongEnough = drag.heldOver && performance.now() - drag.holdSince > HOLD_MS;

    // Nowhere at all is the only reason a drop is refused now.
    if (!drag.landing || !drag.anchor) {
      setPending({ kind: "blocked", unitId: drag.unitId, occupiedBy: "", cells: null });
      setDrag(null);
      return;
    }

    // `dropOutcome` is asked the question it is for — does this change who
    // reports to whom — and asked it about where the branch is *actually*
    // landing, not about the cell under the cursor.
    const outcome: DropOutcome = dropOutcome(
      tree, allocation.occupants, drag.unitId, drag.anchor,
      { heldOver: heldLongEnough ? drag.heldOver : null },
    );

    if (outcome.kind === "offer-merge") {
      setPending({ kind: "merge", unitId: drag.unitId, withUnitId: outcome.withUnitId });
    } else if (drag.reshaped) {
      setPending({ kind: "reshape", unitId: drag.unitId, cells: drag.landing });
    } else if (outcome.kind === "offer-reparent") {
      setPending({
        kind: "reparent", unitId: drag.unitId,
        newParentId: outcome.newParentId, cells: drag.landing,
      });
    } else {
      commit(drag.landing, undefined, drag.unitId);
    }
    // This branch is now the one that just moved, so its governing node can be
    // picked straight back up to tree it. Not after a merge — there is no node
    // left to pick up.
    if (outcome.kind !== "offer-merge") {
      setJustMoved({ unitId: drag.unitId, at: drag.anchor, when: Date.now() });
    }
    setDrag(null);
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
    if (!hexScene || tidyStage > 0) {
      setMoves(new Map());
      setReparents(new Map());
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
  }, [driver, peopleIds, hexScene, tidyStage, tree, allocation, pinned]);

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
  const tier = tierAt(
    hexScene
      ? {
          ...revealAt(camera.scale),
          people: smoothstep(
            PEOPLE_AT_CELL_PX[0], PEOPLE_AT_CELL_PX[1], hexScene.hex.size * camera.scale,
          ),
        }
      : revealAt(camera.scale),
  );
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
  const nameOf = (id: string) => tree.units.get(id)?.name ?? id;

  return (
    <>
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ display: "block", cursor: drag ? "grabbing" : "grab", touchAction: "none" }}
      />

      {pending && (
        <Dialog>
          {pending.kind === "reparent" && (
            <>
              <b>Move {nameOf(pending.unitId)} under {nameOf(pending.newParentId)}?</b>
              <p style={pStyle}>
                It has come to rest against {nameOf(pending.newParentId)}. Say no and it stays
                exactly where you put it, keeping its own colour.
              </p>
              <Row>
                <Btn onClick={() => { commit(pending.cells, { id: pending.unitId, parentId: pending.newParentId }, pending.unitId); setPending(null); }} primary>Reparent</Btn>
                <Btn onClick={() => { commit(pending.cells, undefined, pending.unitId); setPending(null); }}>Just leave it there</Btn>
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
          {pending.kind === "merge" && (
            <>
              <b>{nameOf(pending.unitId)} and {nameOf(pending.withUnitId)}</b>
              <p style={pStyle}>
                You held one over the other. Reparenting moves the whole branch; merging is not
                wired in the study, exactly as it is not wired on the orbital map — what happens
                to both units&rsquo; people and who leads the result is undecided.
              </p>
              <Row>
                <Btn onClick={() => { setReparents((p) => new Map(p).set(pending.unitId, pending.withUnitId)); setPending(null); }} primary>Reparent branch</Btn>
                <Btn disabled>Merge entire branch</Btn>
                <Btn onClick={() => setPending(null)}>Cancel</Btn>
              </Row>
            </>
          )}
        </Dialog>
      )}

      <Panel>
        <Row>
          <strong style={{ fontSize: 13 }}>Hex grid study</strong>
          <span style={{ color: "#9ca3af" }}>{camera.scale.toFixed(2)}×</span>
        </Row>
        <Row>
          <span style={{ color: "#6b7280" }}>layout</span>
          <Btn small onClick={() => setMode("hex")} active={mode === "hex"}>hex</Btn>
          <Btn small onClick={() => setMode("orbits")} active={mode === "orbits"}>orbits (today)</Btn>
        </Row>
        <Row>
          <span style={{ color: "#6b7280" }}>place</span>
          <Btn small onClick={() => setDriver("atlas")} active={mode === "hex" && driver === "atlas"} disabled={mode !== "hex"}>atlas</Btn>
          <Btn small onClick={() => setDriver("radial")} active={mode === "hex" && driver === "radial"} disabled={mode !== "hex"}>radial</Btn>
        </Row>
        <Row>
          <span style={{ color: "#6b7280" }}>rung</span>
          <Btn small onClick={() => setSideways("allow")} active={mode === "hex" && driver === "radial" && sideways === "allow"} disabled={mode !== "hex" || driver !== "radial"}>sideways ok</Btn>
          <Btn small onClick={() => setSideways("forbid")} active={mode === "hex" && driver === "radial" && sideways === "forbid"} disabled={mode !== "hex" || driver !== "radial"}>strictly out</Btn>
        </Row>
        <Row>
          {/* **How quickly a moved branch hands itself back to the master
              centre.** One rung is the pointiest wedge there is: the node where
              your hand left it, its children already back where the centre had
              them. Two and three carry the hand's influence further down. The
              deference itself is not a setting — it is how far you drop it. */}
          <span style={{ color: "#6b7280" }}>wedge</span>
          {[1, 2, 3].map((n) => (
            <Btn
              key={n} small onClick={() => setTaper(n)}
              active={mode === "hex" && driver === "radial" && taper === n}
              disabled={mode !== "hex" || driver !== "radial"}
            >
              {n} rung{n > 1 ? "s" : ""}
            </Btn>
          ))}
        </Row>
        <Row>
          <span style={{ color: "#6b7280" }}>cell</span>
          {(["roomy", "tight"] as HexDensity[]).map((d) => (
            <Btn key={d} small onClick={() => setDensity(d)} active={mode === "hex" && d === density} disabled={mode !== "hex"}>{d}</Btn>
          ))}
          <Btn small onClick={fit}>fit</Btn>
        </Row>
        {loaded && (moves.size > 0 || reparents.size > 0) && (
          <>
            <Row>
              <Btn small onClick={tidy}>
                {tidyStage === 0 ? "tidy up" : "tidy up again — compress"}
              </Btn>
              <span style={{ color: "#94a3b8", fontSize: 11 }}>
                {moves.size} moved · {reparents.size} reparented
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
          {scene.units.length} units · {tree.seats.size} people · laid out in {ms.toFixed(0)}ms
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
        <Small>detail: {LOD_LADDER.find(([t]) => t === tier)?.[1] ?? tier}</Small>
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
