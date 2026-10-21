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

export default function HexLab({
  org, companyKey, initialDensity, groups: rawGroups, leads,
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
  /**
   * **The lab opens on the driver the work is in** — radial since 2026-10-18.
   *
   * It opened on the atlas because that is what `allocateByTerritory` defaults
   * to, and that default is right for the *API*: a caller who does not ask gets
   * what it always got. It was wrong here. Every spacing rule of the last three
   * days lives in the radial driver — the atlas has never held to the spacer at
   * all — so the page opened showing none of it, and Greg twice went looking
   * for work that was two clicks away. A study should open on the thing being
   * studied; the atlas is still a button away for comparison, which is the only
   * reason it is still here.
   */
  const [driver, setDriver] = useState<HexDriver>("radial");
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
     */
    const bornById = new Map(born.map((b) => [b.id, b]));
    const teamOfBorn = (id: string): string | null => {
      const walked = new Set<string>();
      let at: string | null = bornById.get(id)?.parentId ?? null;
      while (at && !walked.has(at)) {
        walked.add(at);
        const up = bornById.get(at);
        if (!up) return at; // a fixture unit: that is the team
        if (up.kind === "place") return up.id;
        at = up.parentId;
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
  }, [rawGroups, merges, born]);
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
      // A unit that has been merged away still has its old placement saved, and
      // stamping that on would put a ghost back on the map with nothing behind
      // it. The layout is the authority on who exists.
      if (!cells.has(id)) continue;
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
    const fill = new Path2D();
    for (const cell of zone.cells) {
      const pts = corners(cell, hexScene.hex.size);
      fill.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 6; i++) fill.lineTo(pts[i].x, pts[i].y);
      fill.closePath();
    }
    return { fill, walls: zone.walls };
  }, [hexScene, tree, peopleIds]);

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
   */
  const placeBorn = useCallback((id: string, cell: Cell) => {
    setMoves((m) => new Map(m).set(id, cell));
    setPinned((p) => new Set(p).add(id));
  }, []);

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
    setMoves(without);
    setReparents(without);
    setPinned((p) => {
      const next = new Set(p);
      for (const id of ids) next.delete(id);
      return next;
    });
    setPending(null);
    setMenu(null);
  }, [tree, remember]);

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
   * **`prefers-reduced-motion`.** Two things move on this page — the neck
   * arming over the dwell, and a node breathing until it is described — and
   * both stand down for anybody who has asked for that. Watched rather than
   * read once, because the setting can change while the page is open.
   */
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setStill(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

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
    /**
     * **Three tones, and the order they go down in.** Greg, 2026-10-18: the
     * zone is *"a grey between the team-zone and the background"*, and the team
     * zone goes *"slightly darker if necessary"* to stay apart from it. So:
     * white, then the group's ground, then the clear hexagon round each team,
     * each a step darker than the last, and nothing in any of them says which
     * colour the team is.
     */
    if (groupRings) {
      ctx.fillStyle = "#f7f8fa";
      ctx.fill(groupRings.fill);
    }
    if (teamSpacers) {
      /**
       * **Opaque, not a wash.** Greg: *"it should be light grey"*, and it was
       * not — a tint of `rgba(15,23,42,0.05)` over a cell that already carries
       * the nested region washes of every rung above it comes out mid grey, and
       * darker the deeper the company. A flat colour is the only way the ring
       * reads the same everywhere, which is the whole point of it being grey:
       * **colour is for what is there, grey is for the room around it.**
       */
      ctx.fillStyle = "#e8eaee";
      ctx.fill(teamSpacers);
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
    if (groupRings) {
      ctx.lineWidth = Math.max(0.6, 1.6 / scale);
      ctx.strokeStyle = "rgba(15,23,42,0.16)";
      ctx.beginPath();
      for (const seg of groupRings.walls) {
        ctx.moveTo(seg.from.x, seg.from.y);
        ctx.lineTo(seg.to.x, seg.to.y);
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
  }, [camera, scene, hexScene, chains, size, hover, regions, regionOrder, maxDepth, drag, pending, tree, justMoved, teamOutlines, teamSpacers, groupRings, bubbles, peopleIds, leadIds, hueById, pulse, still, born, unfinished, blankPaper, menu]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const world = worldAt(e.clientX, e.clientY, rect);
    const hit = unitAtPointer(world);
    pointerKind.current = e.pointerType || "mouse";

    /**
     * **A node that is asking for something answers a tap, not a drag.**
     *
     * While anything is breathing it is the only thing on the map asking for
     * attention, so a press on it opens its wizard rather than picking it up.
     * Everything else about dragging is untouched — including dragging that
     * same node, once it has been described.
     */
    if (hit && unfinished.has(hit) && !pending) {
      const node = born.find((b) => b.id === hit);
      if (node) {
        const at = stillNeeds(node) === "Needs a name" ? 0 : 1;
        setWizard({ id: hit, step: at });
        return;
      }
    }

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
        const over = allocation.occupants.get(cellKey(target)) ?? null;
        const stillOver = over !== null && over === drag.heldOver;
        setDrag({
          ...drag, world, target,
          landing: relaid?.cells ?? null,
          anchor: relaid?.cells.get(drag.unitId) ?? null,
          reshaped: false,
          radiated: Boolean(relaid),
          deference: relaid?.deference ?? null,
          heldOver: over && !drag.members.has(over) ? over : null,
          holdAt: stillOver && stillHolding ? drag.holdAt : world,
          holdSince: stillOver && stillHolding ? drag.holdSince : performance.now(),
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
    // A press that never travelled was a click, and a click is not this
    // handler's business. Letting it fall through would be a drag of zero
    // length asking the map to find room for a branch that never left.
    press.current = null;
    if (!drag || !hexScene) { setDrag(null); return; }

    const heldLongEnough = drag.heldOver && performance.now() - drag.holdSince > HOLD_MS;

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
    if (heldLongEnough && drag.heldOver) {
      setPending({
        kind: "merge", unitId: drag.unitId, withUnitId: drag.heldOver,
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
      <style>{`@keyframes zen-breathe {
        0%, 100% { box-shadow: 0 0 0 0 rgba(148,163,184,0.35); }
        50% { box-shadow: 0 0 0 16px rgba(148,163,184,0); }
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
        <button
          onClick={seedPerson}
          style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            zIndex: 20, width: 148, height: 148, borderRadius: "50%", cursor: "pointer",
            border: "2px dashed #94a3b8", background: "#fff", color: "#0f172a",
            fontFamily: "ui-sans-serif, system-ui", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 4,
            animation: still ? undefined : "zen-breathe 2.6s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: 34, lineHeight: 1, fontWeight: 300 }}>+</span>
          <span style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Start here</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>Add the first person</span>
        </button>
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
