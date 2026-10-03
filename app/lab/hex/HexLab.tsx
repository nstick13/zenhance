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
import { routeAll } from "@/lib/map/layout/hex/route";
import { layoutCompany } from "@/lib/map/layout/complexity";
import type { OrbitalScene } from "@/lib/map/layout/layout";
import { allocate, TEAM_GAP } from "@/lib/map/layout/hex/allocate";
import {
  branchOf,
  dropOutcome,
  hoverGroup,
  outline,
  placeIsland,
  type DropOutcome,
} from "@/lib/map/layout/hex/arrange";
import {
  cellKey, cellToWorld, corners, cornersAt, worldToCell, type Cell,
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
 * Clear tiles between two groups, by how many rungs up to their common
 * ancestor: index 1 is a sibling, 2 a cousin, 3+ anyone further off.
 *
 * **One knob, in one place**, because this is the number Greg is judging by eye
 * and it should be changed without reading the allocator. Measured on
 * Northwind, the ladder below is met by every pair but one in 395 — the rule
 * is enforced; whether one tile between siblings *reads* as separation is the
 * question the knob exists to answer.
 *
 * Raising it costs map: the whole company spreads, and the allocation gets
 * slower because every region hunts further for clear water.
 */
const GAP_BY_RUNGS = [0, 1, 2, 3];

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
  org, companyKey, initialDensity, groups, leads, ancestry,
}: {
  org: LabOrg;
  companyKey: string;
  initialDensity: HexDensity;
  /** unit id → the group it should be kept together with, when people have
   *  been promoted to units and a team is a crowd rather than a cell. */
  groups?: readonly (readonly [string, string])[];
  /** The people who lead the unit they hang from. */
  leads?: readonly string[];
  /** Each group's line of ancestors, nearest first — how the layout tells a
   *  sibling from a cousin when deciding how far apart to put them. */
  ancestry?: readonly (readonly [string, readonly string[]])[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 1200, height: 800 });
  const [density, setDensity] = useState<HexDensity>(initialDensity);
  const [mode, setMode] = useState<"hex" | "orbits">("hex");
  const [hover, setHover] = useState<string | null>(null);

  /** Hand placements and reparents, kept in this browser between visits. */
  const [moves, setMoves] = useState<Map<string, Cell>>(() => new Map());
  const [reparents, setReparents] = useState<Map<string, string>>(() => new Map());
  /** Units somebody dragged themselves. Tidy up will not move these — it is
   *  what separates "neaten what I have" from "throw it away". */
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  /** 0 = as arranged, 1 = neatened. A second press compresses. */
  const [tidyStage, setTidyStage] = useState(0);
  const [loaded, setLoaded] = useState(false);
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
  const storeKey = `zenhance.lab.hex.${companyKey}`;

  useEffect(() => {
    setLoaded(false);
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
    setLoaded(true);
  }, [storeKey, baseTree]);

  useEffect(() => {
    if (!loaded) return; // never write back before the first read
    try {
      if (!moves.size && !reparents.size) window.localStorage.removeItem(storeKey);
      else window.localStorage.setItem(storeKey, JSON.stringify({
        moves: [...moves], reparents: [...reparents], pinned: [...pinned],
      }));
    } catch {
      // A browser that will not keep it is not a reason to stop working.
    }
  }, [storeKey, loaded, moves, reparents, pinned]);

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

  /**
   * How many clear tiles two groups want between them: one rung up to their
   * common ancestor is a sibling and wants one tile, two rungs is a cousin and
   * wants two, anything further wants the full gap.
   */
  const gapBetween = useMemo(() => {
    if (!ancestry?.length) return undefined;
    const line = new Map(ancestry.map(([id, up]) => [id, up]));
    const cache = new Map<string, number>();
    return (a: string, b: string) => {
      if (a === b) return 0;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const had = cache.get(key);
      if (had !== undefined) return had;
      const up = line.get(a) ?? [];
      const theirs = new Set([b, ...(line.get(b) ?? [])]);
      // Rungs from `a` to the first ancestor it shares with `b`. The unit
      // itself counts as rung 0, so a shared parent gives 1 — a sibling.
      let rungs = GAP_BY_RUNGS.length - 1;
      for (let i = 0; i < up.length; i++) {
        if (theirs.has(up[i])) { rungs = i + 1; break; }
      }
      const gap = Math.min(TEAM_GAP, GAP_BY_RUNGS[Math.min(rungs, GAP_BY_RUNGS.length - 1)]);
      cache.set(key, gap);
      return gap;
    };
  }, [ancestry]);

  const baseAllocation = useMemo(
    () => allocate(baseTree, { groupOf, gapBetween }),
    [baseTree, groupOf, gapBetween],
  );

  /** The allocation with every hand placement applied on top. Reparenting does
   *  **not** re-allocate: Greg's rule is that a reparented tile stays exactly
   *  where it was put and changes colour, so the cells are the person's. */
  const allocation = useMemo(() => {
    if (!moves.size) return baseAllocation;
    const cells = new Map(baseAllocation.cells);
    for (const [id, cell] of moves) cells.set(id, cell);
    const occupants = new Map<string, string>();
    for (const [id, cell] of cells) occupants.set(cellKey(cell), id);
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
      segments: outline(cells, hexScene.hex.size),
    }));
  }, [groups, hexScene]);
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
    const signature = `${companyKey}|${density}|${mode}|${size.width}x${size.height}`;
    if (fittedFor.current === signature || !scene.bounds) return;
    fittedFor.current = signature;
    setCamera(fitCamera(scene.bounds, size, { min: floor }));
  }, [companyKey, density, mode, size, scene, floor]);

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
    const base = revealAt(scale);
    const view = cullBox(camera, size);
    const hexSize = hexScene?.hex.size ?? 1;
    // Every cell is the same size here, so people arrive by how big a cell is
    // on screen rather than by world scale.
    const reveal = hexScene
      ? { ...base, people: smoothstep(PEOPLE_AT_CELL_PX[0], PEOPLE_AT_CELL_PX[1], hexSize * scale) }
      : base;

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
        ctx.beginPath();
        ctx.moveTo(chain.points[0].x, chain.points[0].y);
        for (let i = 1; i < chain.points.length; i++) {
          ctx.lineTo(chain.points[i].x, chain.points[i].y);
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Still scaled by the node, so the trunk stays heavier than the twigs.
        ctx.lineWidth = Math.max(0.6, hexSize * 0.27 * nodeScale(unit.depth, maxDepth));
        ctx.strokeStyle = css(hueFor(chain.unitId), unit.depth, maxDepth, 0.95);
        ctx.stroke();
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

    if (reveal.people > 0.01) {
      ctx.globalAlpha = reveal.people;
      for (const unit of visible) {
        for (const seat of scene.seatsByUnit.get(unit.id) ?? []) {
          ctx.beginPath();
          ctx.arc(seat.x, seat.y, seat.r, 0, Math.PI * 2);
          ctx.fillStyle = seat.kind === "lead" ? "#1e293b" : seat.kind === "open" ? "#fff" : "#94a3b8";
          ctx.fill();
          if (seat.kind === "open") {
            ctx.lineWidth = 1.2 / scale;
            ctx.strokeStyle = "#f59e0b";
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

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
  }, [camera, scene, hexScene, chains, size, hover, regions, regionOrder, maxDepth, drag, pending, tree, justMoved, teamOutlines, peopleIds, leadIds, hueById]);

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
      setDrag({
        unitId: hit, members, grabbed: hexScene.hex.cells.get(hit)!,
        from: world, world, target: hexScene.hex.cells.get(hit)!,
        landing: null, anchor: null, reshaped: false, radiated: false,
        armedAt: armed,
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
      const parentId = tree.units.get(drag.unitId)?.parentId ?? null;
      const parentCell = parentId ? hexScene.hex.cells.get(parentId) ?? null : null;
      const treeIt = drag.armedAt && parentCell ? parentCell : null;
      const landing = placeIsland(
        allocation.occupants, drag.members, drag.unitId, target,
        (id) => tree.units.get(id)?.childIds ?? [],
        treeIt,
        groupOf,
        gapBetween,
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
        radiated: landing.kind === "radiated" || landing.kind === "parted",
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
    const result = neaten(tree, allocation.cells, pinned, hexScene.hex.size);
    setMoves(new Map(result.cells));
    setTidyReport(result);
    setTidyStage(1);
  }, [hexScene, tidyStage, tree, allocation, pinned]);

  /**
   * Two units on one cell would make one of them impossible to point at, since
   * hover reads the cell's occupant. Nothing is known to cause it — 120 random
   * drags and reparents produce none — but Greg reported a tile he could not
   * hover on 2026-10-01, and a number on the screen beats a mystery.
   */
  const buried = allocation.cells.size - allocation.occupants.size;

  /**
   * People a cell could not hold.
   *
   * A unit's rings are the gap between its node and the edge of its tile, and
   * since 2026-10-02 there are four of them, holding people half again as big
   * as before. A shallow unit has a big node and a thin gap, so a large team
   * high up the tree can ask for more room than its cell has. Spilling into the
   * neighbour is the one thing a lattice must not do, so the layout leaves
   * those people out — and a number on the screen is the difference between a
   * known trade and a silent one.
   */
  const unseated = useMemo(() => {
    let missing = 0;
    for (const unit of scene.units) {
      const got = scene.seatsByUnit.get(unit.id)?.length ?? 0;
      missing += Math.max(0, unit.seatIds.length - got);
    }
    return missing;
  }, [scene]);

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
              </Small>
            )}
          </>
        )}
        <hr style={{ border: 0, borderTop: "1px solid #f1f5f9", margin: "2px 0" }} />
        <Small suppressHydrationWarning>
          {scene.units.length} units · {scene.seats.length} people · laid out in {ms.toFixed(0)}ms
        </Small>
        {stats ? (
          <>
            <Small>
              <b style={{ color: "#166534" }}>
                {((100 * stats.connected) / Math.max(1, stats.placed - 1)).toFixed(0)}%
              </b>{" "}of children touch their family · {stats.exclaves} exclaves
            </Small>
            <Small>
              {stats.wholeFamilies}/{stats.families} families are one patch ·{" "}
              {((100 * stats.touchingParent) / Math.max(1, stats.placed - 1)).toFixed(0)}% touch the
              parent itself
            </Small>
          </>
        ) : (
          <Small>the layout that ships today, drawn by this same renderer</Small>
        )}
        <Small>
          <b>{Math.round(b.maxX - b.minX).toLocaleString()} × {Math.round(b.maxY - b.minY).toLocaleString()}</b> world units across
        </Small>
        <Small>detail: {LOD_LADDER.find(([t]) => t === tier)?.[1] ?? tier}</Small>
        {buried > 0 && (
          <Small style={{ color: "#b91c1c" }}>
            <b>{buried}</b> unit{buried === 1 ? "" : "s"} sharing a cell with another —
            they cannot be pointed at. Please tell Claude what you just did.
          </Small>
        )}
        {unseated > 0 && (
          <Small style={{ color: "#b45309" }}>
            <b>{unseated}</b> {unseated === 1 ? "person has" : "people have"}{" "}
            no room in their cell — four rings is all a tile holds, and a shallow
            unit&rsquo;s node leaves less of one.
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
