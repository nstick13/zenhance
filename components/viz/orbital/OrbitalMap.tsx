"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Konva from "konva";
import { Circle, Group, Layer, Shape, Stage, Text } from "react-konva";
import type { Assignment, OrbitalNodeRow, OrgUnit, Person } from "@/lib/db/schema";
import type { Vocabulary } from "@/lib/vocabulary";
import { clearOrbitalNodes, moveOrgUnit, saveOrbitalNodes } from "@/lib/data/actions";
import { tasksForPerson, type MockTask } from "@/lib/mock/personTasks";
import { boardTeams, boardsFor, statusRing } from "@/lib/map/work/board";
import {
  applyOverrides,
  buildOrbitalTree,
  type OrbitalTree,
  type StructureOverrides,
} from "@/lib/orbital/model";
import {
  type OrbitalScene,
  type PlacedSeat,
  type PlacedUnit,
} from "@/lib/orbital/layout";
import { descendantIds, snapSeat, type SeatSnap } from "@/lib/orbital/snap";
import { planInsertion, type InsertionPlan } from "@/lib/orbital/insertion";
import { carrierOf, type BasketTree } from "@/lib/map/basket/basket";
import { useBasket } from "./useBasket";
import {
  branchImpact,
  chargeAt,
  isArmed,
  magneticMergeTarget,
  magneticPosition,
  mergeCopy,
  overlapTarget,
  reparentOrbitTarget,
  trackRelation,
  type ReparentOrbit,
  type Relation,
} from "@/lib/orbital/relationship";
import { MotionStore, type MotionTarget } from "@/lib/orbital/motion";
import { READABLE_SCALE } from "@/lib/orbital/complexity";
import { focusOrbital } from "@/lib/orbital/focus";
import { layoutCompany, sceneBounds, type Bounds } from "@/lib/orbital/complexity";
import { useCamera } from "./useCamera";
import { MAX_SCALE, boundsOfUnits, centreOn, type Camera } from "@/lib/map/camera/viewport";
import {
  activeFocus,
  focusToCrumb,
  hasParentFocus,
  parentFocus,
  popFocus,
  pushFocus,
  type FocusFrame,
} from "@/lib/map/camera/focusStack";
import { structuralEnvelope } from "@/lib/orbital/envelope";
import {
  anglePlacementOffsets,
  applyPositionOffsets,
  combinePositionOffsets,
  type Placement,
} from "@/lib/orbital/position";
import {
  SEAT_RADIUS,
  WORK_RADIUS,
  angleDelta,
  angularStep,
  normalizeAngle,
  polar,
  type Point,
} from "@/lib/orbital/geometry";
import {
  isLandmark,
  LOD_LADDER,
  desiredUnitRadius,
  neighbourAwareRadius,
  revealAt,
  smoothstep,
  tierAt,
  unitLabelVisible,
  unitRingReveal,
  type Reveal,
} from "@/lib/orbital/lod";
import {
  INTERACTABLE_PRESENCE,
  effectiveScale,
  fieldInfluence,
  fieldRadiusPx,
  isInteractable,
  lensDisplace,
  lensInverse,
  type DetailField,
} from "@/lib/orbital/detail";
import { markBudget, revealDelay, stepPresence, visibleUnitIds, type VisibilityUnit } from "@/lib/orbital/visibility";
import { sizeIndex } from "@/lib/orbital/size";
import PersonTaskBoard from "@/components/viz/PersonTaskBoard";
import {
  UNIT_RING_KEYS,
  UNIT_RING_LABELS,
  type PersonVitals,
  type SeatProgress,
  type UnitProgress,
  type UnitRingKey,
} from "@/lib/map/signal/progress";
import { healthSource, seatRingsFor, unitRingsFor, vitalsFor } from "@/lib/map/signal/rings";
import { C, FONT, WORK_STATUS_FILL, healthColor } from "./theme";
import {
  RIPPLE_MS,
  paintEnvelope,
  paintExternalFlows,
  paintField,
  paintRelation,
  paintPreview,
  paintReportingLines,
  paintRipples,
  paintSeatLinks,
  paintSeatRings,
  paintTorus,
  paintUnitDiscs,
  paintUnitLinks,
  paintUnitRings,
  paintWorkCapsules,
  paintWorkDots,
  ringGeometry,
  unitDrawRadius,
  type ExternalFlow,
  type RenderCtx,
  type RingHover,
  type Ripple,
} from "./render";
import { SeatAvatar } from "./SeatAvatar";

/**
 * The orbital map — the company at the centre, everything else in orbit
 * around whatever it belongs to.
 *
 * Geometry lives in lib/orbital/*; per-frame drawing lives in ./render.ts.
 * This file owns the camera, the dragging and the state. Three things worth
 * knowing:
 *
 * - **Nothing is positioned by React.** One Konva.Animation reads the spring
 *   store and the live zoom and writes positions, scales and opacities
 *   directly. React decides only which nodes exist. That's what lets detail
 *   morph continuously as you zoom instead of popping in at a threshold.
 * - **Seats are positioned absolutely, not parented to their unit**, so a
 *   dragged stream lets its teams and people trail after it on their own
 *   springs.
 * - **Drag reads the map, not a grid**: ordinary movement round the current
 *   parent changes geography only. A different parent's semantic annulus or
 *   magnetic node contact may propose a reporting change, but only explicit
 *   confirmation edits it. Breaking orbits makes all placement visual-only.
 */

type Props = {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  vocabulary: Vocabulary;
  savedNodes: OrbitalNodeRow[];
  sampleWork: boolean;
  /** Dev-only: draw an invented demo company in local branch geography. */
  previewGeography?: "local";
};


const EXTERNAL_R = 86;
const EXTERNAL_GAP = 150;
/** Illustrative ratios off real monthly payroll — the schema holds no P&L,
 *  so these are a communication device, not a forecast. */
const EXTERNALS: {
  id: string;
  name: string;
  angle: number;
  direction: "in" | "out";
  ratio: number;
  note: string;
}[] = [
  { id: "customers", name: "Customers", angle: -Math.PI / 2, direction: "in", ratio: 2.4, note: "Revenue" },
  { id: "shareholders", name: "Shareholders & ownership", angle: 0, direction: "out", ratio: 0.1, note: "Dividends" },
  { id: "government", name: "Government", angle: Math.PI / 2, direction: "out", ratio: 0.15, note: "Taxes" },
  { id: "suppliers", name: "Suppliers", angle: Math.PI, direction: "out", ratio: 0.18, note: "Rent, tools, vendors" },
];

// --- the delighter that does a job ----------------------------------------
// Neighbours slide along their own orbit to open a gap where the thing in
// your hand is about to land. It reads as the map making room for you, and
// it tells you exactly where the commitment falls before you let go.
const YIELD_REACH = 2.4;
const YIELD_PUSH = 0.85;

type Painter = (ctx: Konva.Context, shape: Konva.Shape) => void;
type Painters = {
  envelope: Painter;
  field: Painter;
  relation: Painter;
  unitDiscs: Painter;
  unitRings: Painter;
  torus: Painter;
  seatRings: Painter;
  workCapsules: Painter;
  workDots: Painter;
  unitLinks: Painter;
  seatLinks: Painter;
  reportingLines: Painter;
  externalFlows: Painter;
  preview: Painter;
  ripples: Painter;
};

type DragState =
  | {
    kind: "unit";
    id: string;
    /** Its real parent — the line home a drop never changes. */
    parentId: string | null;
    origin: Point;
    current: Point;
    moved: Set<string>;
    /** Where it would land now, and who would make room. */
    plan: InsertionPlan | null;
    /** Held by Konva under the pointer (a drag on the map) rather than led by
     *  the pointer from the basket. */
    grabbed: boolean;
    /** Came out of the basket: a cancelled drop goes back into it. */
    fromBasket: boolean;
    /** The pointer is over the basket right now. */
    overTray: boolean;
    /** A unit it is deliberately on top of, and how armed that is. */
    relation: Relation | null;
    /** Physical node-to-node attraction, separate from the relationship
     * clock so retreat can restore the map immediately. */
    magnet: { unitId: string; centre: Point; radius: number; strength: number } | null;
    /** Strongest semantic parent orbit under the pointer. */
    reparent: ReparentOrbit | null;
    /** How long the hand has held still on that orbit. A reparent is a
     *  deliberate gesture, not something an ordinary drop can trigger. */
    reparentHold: Relation | null;
  }
  | {
    kind: "seat";
    id: string;
    origin: Point;
    current: Point;
    snap: SeatSnap | null;
    /** Another team this person is deliberately on top of. */
    relation: Relation | null;
  };

/** A relationship change waiting for a yes. Nothing has changed yet. */
type Proposal =
  | { kind: "merge"; fromId: string; intoId: string }
  | { kind: "reparent"; fromId: string; parentId: string }
  | { kind: "move"; seatId: string; toUnitId: string };

type HoverState =
  | { kind: "unit"; unit: PlacedUnit; x: number; y: number }
  | { kind: "external"; name: string; note: string; x: number; y: number }
  | { kind: "seat"; seat: PlacedSeat; x: number; y: number }
  | { kind: "ring"; unit: PlacedUnit; ring: UnitRingKey; x: number; y: number }
  | { kind: "torus"; unit: PlacedUnit; x: number; y: number }
  | { kind: "work"; seat: PlacedSeat; index: number; x: number; y: number };

/** What the pointer is over, among the things drawn rather than noded. */
type Hit =
  | { kind: "work"; seatId: string; index: number }
  | { kind: "ring"; unitId: string; ring: UnitRingKey }
  | { kind: "torus"; unitId: string };


const uid = (id: string) => `u:${id}`;
const sid = (id: string) => `s:${id}`;

/** Two taps on open ground within this long, and this close together on
 *  screen, mean one gesture. Generous on both counts: a finger is not a
 *  mouse, and the second tap of a double-tap lands a few pixels off. */
/** Room a landmark name needs to itself, in screen pixels. Wide, because a
 *  company name is long and two overlapping names are worse than one. */
const LABEL_CLEAR_PX = { x: 110, y: 26 };

const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 36;

export function OrbitalMap({ people, units, assignments, vocabulary, savedNodes, sampleWork, previewGeography }: Props) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const bgLayerRef = useRef<Konva.Layer | null>(null);
  const linkLayerRef = useRef<Konva.Layer | null>(null);
  const nodeLayerRef = useRef<Konva.Layer | null>(null);

  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [showReporting, setShowReporting] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [openWork, setOpenWork] = useState<{ seat: PlacedSeat; task: MockTask } | null>(null);
  /** Route inspection is deliberately separate from semantic focus: a click
   * says “show me how this connects”; double-click / Focus says “make this
   * the centre”. */
  const [routeUnitId, setRouteUnitId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [focusFrames, setFocusFrames] = useState<FocusFrame[]>([]);
  const activeFocusId = activeFocus(focusFrames);
  /** A short, plain explanation after a drop that did something the user
   *  might not expect — fades on its own. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Placements made with snaps off. Those mean nothing and are deliberately
   *  not saved, so the map says how many will be lost on reload. */
  const [sessionPlaced, setSessionPlaced] = useState(0);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  /** Where the pointer is on screen during a drag — for the basket and for
   *  panning when a held branch nears the edge. */
  const dragClientRef = useRef<Point | null>(null);
  /** Re-plan the current drag without a pointer event — when edge-panning
   *  slides the world under a finger that hasn't moved. */
  const dragFollowRef = useRef<(() => void) | null>(null);
  const refreshViewBoxRef = useRef<((force?: boolean) => void) | null>(null);
  const snappingRef = useRef(true);
  const onSeatDragMoveRef = useRef<(() => void) | null>(null);
  const deliberateTargetRef = useRef<
    ((point: Point, exclude: ReadonlySet<string>) => { unitId: string; depth: number } | null) | null
  >(null);
  const [openBoard, setOpenBoard] = useState<{ id: string; name: string; title: string | null } | null>(
    null,
  );
  const [, startTransition] = useTransition();

  // --- saved arrangement ---------------------------------------------------
  const seeded = useMemo(() => {
    const unitParent = new Map<string, string>();
    const seatUnit = new Map<string, string>();
    const angles = new Map<string, Placement>();
    for (const row of savedNodes) {
      if (row.nodeType === "unit") {
        if (row.angle != null) {
          const a = Number(row.angle);
          const d = row.distance == null ? null : Number(row.distance);
          if (Number.isFinite(a)) {
            angles.set(row.nodeId, { angle: a, distance: d != null && Number.isFinite(d) ? d : null });
          }
        }
        if (row.parentId) unitParent.set(row.nodeId, row.parentId);
      } else if (row.parentId) {
        seatUnit.set(row.nodeId, row.parentId);
      }
    }
    return { overrides: { unitParent, seatUnit } as StructureOverrides, angles };
  }, [savedNodes]);

  const [overrides, setOverrides] = useState<StructureOverrides>(seeded.overrides);
  const [angleOverrides, setAngleOverrides] = useState<Map<string, Placement>>(seeded.angles);
  const [positionRevision, setPositionRevision] = useState(0);

  const dragRef = useRef<DragState | null>(null);
  const sceneRef = useRef<OrbitalScene | null>(null);
  const interactionSceneRef = useRef<OrbitalScene | null>(null);
  /** The interaction scene before any saved placement — what a drop's saved
   *  angle is measured against when it is read back. */
  const baseInteractionRef = useRef<OrbitalScene | null>(null);
  const targetsRef = useRef<Map<string, MotionTarget>>(new Map());
  const motionRef = useRef(new MotionStore());
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const ripplesRef = useRef<Ripple[]>([]);
  const dirtyRef = useRef(true);
  const pendingFocusCameraRef = useRef<Camera | "frame" | null>(null);
  const focusRef = useRef<string | null>(null);
  /** The unit last clicked, and the route to it from the centre — read by the
   *  painters every frame, so clicking never waits on a React render. */
  const focusUnitRef = useRef<{ id: string | null; path: ReadonlySet<string> }>({ id: null, path: new Set() });
  const ringHoverRef = useRef<RingHover | null>(null);
  const workHoverRef = useRef<{ seatId: string; index: number } | null>(null);
  const unitHoverRef = useRef<string | null>(null);
  const showReportingRef = useRef(true);
  const pressOriginRef = useRef<Point | null>(null);
  const pressMovedRef = useRef(false);
  /** The last tap on open ground, so a second one can mean "leave focus".
   *  Kept here rather than relying on dblclick, which touch does not send. */
  const lastBlankTapRef = useRef<{ at: number; at0: Point } | null>(null);
  const renderRef = useRef<RenderCtx | null>(null);
  const focusBranchRef = useRef<ReadonlySet<string> | null>(null);
  const companyRef = useRef<string | null>(null);
  const unitOffsetsRef = useRef<Map<string, Point>>(new Map());
  const seatOffsetsRef = useRef<Map<string, Point>>(new Map());

  // --- the local detail field and the visibility budget ----------------------
  // A blank tap pins a soft field of extra detail where it landed (see
  // lib/orbital/detail.ts). React holds only *where* it is pinned — what
  // decides which seats and labels exist. Its live strength, and every mark's
  // presence, are eased in the frame loop and never pass through React.
  const [pinnedField, setPinnedField] = useState<Point | null>(null);
  const pinnedFieldRef = useRef<Point | null>(null);
  const fieldRef = useRef<DetailField | null>(null);
  const presenceRef = useRef(new Map<string, number>());
  const presenceTargetRef = useRef(new Map<string, number>());
  /** When a newly admitted mark may begin to fade in — the reveal ripples out
   *  from where the user acted instead of popping everywhere at once. */
  const presenceWaitRef = useRef(new Map<string, number>());
  const visibilityKeyRef = useRef("");
  const visibilityAtRef = useRef(0);
  const visibilityUnitsRef = useRef<VisibilityUnit[]>([]);
  const forcedRef = useRef<ReadonlySet<string>>(new Set());
  const reduceMotionRef = useRef(false);
  /** Per-frame cache of how much detail each unit's neighbourhood reads at. */
  const detailCacheRef = useRef(new Map<string, { scale: number; reveal: Reveal }>());
  /** Local geography: each dot's drawn radius this frame, swollen against its
   *  present neighbours. Everything drawn or caught reads it via `drawnOf`. */
  const drawnMapRef = useRef(new Map<string, number>());
  const localRef = useRef(false);

  // --- the work each person is carrying ------------------------------------
  // Whole boards, not just what's in flight: the completion ring is only
  // meaningful against everything someone holds, and it's what makes the
  // texture of work read at a glance.
  const boards = useMemo(
    () => boardsFor(people, units.map((u) => u.name), tasksForPerson, sampleWork),
    [people, units, sampleWork],
  );

  const allocationByPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignments) {
      if (!a.personId || a.isOpenRole) continue;
      map.set(a.personId, (map.get(a.personId) ?? 0) + (a.allocationPct ?? 0));
    }
    return map;
  }, [assignments]);

  const vitals = useMemo(
    () => vitalsFor(people, allocationByPerson, new Date()),
    [people, allocationByPerson],
  );

  // --- the org, folded into orbits ----------------------------------------
  const baseTree = useMemo(
    (): OrbitalTree =>
      buildOrbitalTree(
        {
          units: units.map((u) => ({
            id: u.id,
            name: u.name,
            parentId: u.parentId,
            isExternal: u.isExternal,
            leadPersonId: u.leadPersonId,
            vendorName: u.vendorName,
          })),
          people: people.map((p) => ({ id: p.id, name: p.name, title: p.title, photoUrl: p.photoUrl })),
          assignments: assignments.map((a) => ({
            personId: a.personId,
            orgUnitId: a.orgUnitId,
            allocationPct: a.allocationPct,
            isOpenRole: a.isOpenRole,
            roleOnTeam: a.roleOnTeam,
          })),
        },
        { workCountFor: (id) => boards.get(id)?.length ?? 0, mergePassThroughRoot: false },
      ),
    [units, people, assignments, boards],
  );

  const arrangedTree = useMemo(() => applyOverrides(baseTree, overrides), [baseTree, overrides]);

  // --- the basket ------------------------------------------------------------
  const basketTree = useMemo((): BasketTree => ({
    parentOf: (id) => {
      const parent = arrangedTree.units.get(id)?.parentId ?? null;
      return parent === "orbital-root" ? null : parent;
    },
    nameOf: (id) => arrangedTree.units.get(id)?.name ?? "This unit",
  }), [arrangedTree]);

  // The basket engine. Rules in lib/map/basket/basket.ts, tray arithmetic in
  // tray.ts, both pure and tested. See docs/ENGINES.md § Basket — including
  // why the drag-out callbacks below are a seam with Growth, not a shortcut.
  const childrenOf = useCallback(
    (id: string) => arrangedTree.units.get(id)?.childIds ?? [],
    [arrangedTree],
  );
  const {
    basket, basketRef, carriedBranch, carriedRoots,
    trayRef, trayHot, setTrayHot, flashEntry, flash, isOverTray,
    carry, returnEntry, returnAll, settle, noRoom,
    pressEntry, moveEntry, releaseEntry, cancelEntry,
  } = useBasket({
    tree: basketTree,
    childrenOf,
    say: setNotice,
    beginCarryDrag: (unitId) => beginCarryDragRef.current?.(unitId) ?? false,
    onCarryMove: (client) => { dragClientRef.current = client; followCarryRef.current?.(); },
    endCarryDrag: (cancelled) => endCarryDragRef.current?.(cancelled) ?? null,
    locate: (unitId) => locateCarriedRef.current?.(unitId),
  });

  // Created below, after the drag machinery exists. The basket reports
  // intent; the map decides what a drop means (that is Growth's job).
  const beginCarryDragRef = useRef<((unitId: string) => boolean) | null>(null);
  const followCarryRef = useRef<(() => void) | null>(null);
  const endCarryDragRef = useRef<((cancelled: boolean) => { landed: boolean; unitId: string } | null) | null>(null);
  const locateCarriedRef = useRef<((unitId: string) => void) | null>(null);
  const kindById = useMemo(() => new Map(units.map((u) => [u.id, u.kind])), [units]);

  // Rings for a company they fit; local branch geography for one that has
  // outgrown them (lib/orbital/complexity.ts). Deterministic per company.
  const masterScene = useMemo(
    () => layoutCompany(arrangedTree, {}, previewGeography).scene,
    [arrangedTree, previewGeography],
  );
  const local = masterScene.geography === "local";
  useEffect(() => {
    localRef.current = local;
    drawnMapRef.current.clear();
  }, [local]);
  const focusedView = useMemo(
    () => activeFocusId ? focusOrbital(arrangedTree, masterScene, activeFocusId) : null,
    [arrangedTree, masterScene, activeFocusId],
  );
  // Semantic focus only redraws the branch into a local orbital system while
  // snaps are on. With snaps off, user-authored geography is intentional: we
  // centre the camera on the focused node but never pull its neighbours in.
  const projectedScene = focusedView && snapping ? focusedView.scene : masterScene;
  const projectedInteractionScene = focusedView && snapping ? focusedView.interactionScene : projectedScene;
  const scene = useMemo(
    () => applyPositionOffsets(projectedScene,
      combinePositionOffsets(anglePlacementOffsets(projectedScene, angleOverrides), unitOffsetsRef.current),
      seatOffsetsRef.current),
    [projectedScene, angleOverrides, positionRevision],
  );
  const activeFamilyRootId = useMemo(() => {
    if (!activeFocusId) return null;
    let unit = arrangedTree.units.get(activeFocusId);
    while (unit?.parentId && unit.parentId !== "orbital-root") unit = arrangedTree.units.get(unit.parentId);
    return unit?.id ?? null;
  }, [activeFocusId, arrangedTree]);
  // The territory outline is settled structure: it changes when geography is
  // committed, never while anything is live.
  const envelope = useMemo(() => (scene.geography === "local" ? structuralEnvelope(scene) : null), [scene]);
  const guideFamilies = local ? [] : scene.families ?? (activeFocusId
    ? [{ rootId: activeFamilyRootId ?? activeFocusId, centre: { x: 0, y: 0 }, boundary: scene.extent + 82 }]
    : []);
  // The external contributor/subtractor sketch assumes a single central
  // company and illustrative ratios. Keep it in the synthetic demo only until
  // its place in a real forest is designed.
  const showSampleExternals = sampleWork && guideFamilies.length === 1;
  const interactionScene = useMemo(
    () => applyPositionOffsets(projectedInteractionScene,
      combinePositionOffsets(anglePlacementOffsets(projectedInteractionScene, angleOverrides), unitOffsetsRef.current),
      seatOffsetsRef.current),
    [projectedInteractionScene, angleOverrides, positionRevision],
  );

  const focusBreadcrumb = (focusedView?.breadcrumb ?? []).filter((unit) => unit.id !== "orbital-root");

  const focusBranch = focusedView?.branchIds ?? null;
  const selectedUnit = selectedUnitId ? scene.unitById.get(selectedUnitId) : undefined;

  // What the visibility budget weighs: each unit's share of the company, at
  // its settled place. Hidden units keep their place; they are only unpainted.
  useEffect(() => {
    const company = Math.max(1, ...scene.units.filter((u) => !u.parentId).map((u) => u.totalSeats));
    visibilityUnitsRef.current = scene.units.map((u) => ({
      id: u.id, parentId: u.parentId, x: u.x, y: u.y, weight: sizeIndex(u.totalSeats, company),
    }));
    visibilityKeyRef.current = "";
  }, [scene]);

  // Shown whatever the budget: the focused unit, the selected unit with its
  // immediate children, and the route home from each (visibility.ts adds the
  // ancestors). Tapping a unit brings these into prominence without moving
  // the camera.
  useEffect(() => {
    const forced = new Set<string>();
    if (activeFocusId) forced.add(activeFocusId);
    if (routeUnitId) forced.add(routeUnitId);
    if (selectedUnitId) {
      forced.add(selectedUnitId);
      for (const id of scene.unitById.get(selectedUnitId)?.childIds ?? []) forced.add(id);
    }
    forcedRef.current = forced;
    visibilityKeyRef.current = "";
  }, [activeFocusId, routeUnitId, selectedUnitId, scene]);

  useEffect(() => {
    pinnedFieldRef.current = pinnedField;
    visibilityKeyRef.current = "";
  }, [pinnedField]);

  // Touch screens get the basket along the bottom, where a thumb can reach it.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reduceMotionRef.current = query.matches;
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // The focus path: the unit you clicked and each unit above it, back to the
  // company (Greg, 2026-09-15). Rebuilt against the live scene, so it follows a
  // node that gets dragged to a new parent, and quietly empties if the unit is
  // gone — switching company, say.
  useEffect(() => {
    const path = new Set<string>();
    let unit = routeUnitId ? scene.unitById.get(routeUnitId) : undefined;
    while (unit) {
      path.add(unit.id);
      unit = unit.parentId ? scene.unitById.get(unit.parentId) : undefined;
    }
    focusUnitRef.current = { id: path.size > 0 ? routeUnitId : null, path };
    dirtyRef.current = true;
  }, [scene, routeUnitId]);

  // --- what the rings say --------------------------------------------------
  const seatRings = useMemo(() => seatRingsFor(scene.seats, boards), [scene, boards]);

  const workStatus = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const seat of scene.seats) {
      map.set(seat.id, statusRing(seat.personId ? (boards.get(seat.personId) ?? []) : []));
    }
    return map;
  }, [scene, boards]);

  /** A unit's rings cover its whole branch, not just the people sitting on
   *  it — "overall work item completedness for an entire team". */
  const unitRings = useMemo(
    () => unitRingsFor(
      scene.units.map((u) => u.id),
      {
        childrenOf: (id) => scene.unitById.get(id)?.childIds ?? [],
        seatsOf: (id) => scene.seatsByUnit.get(id) ?? [],
      },
      boards,
      healthSource(sampleWork, vitals),
    ),
    [scene, boards, vitals, sampleWork],
  );

  /** Payroll running through each branch — the one money flow the schema
   *  records. A shared person contributes their allocated share to each unit
   *  they sit on, so nobody is counted twice over. */
  const moneyByUnit = useMemo(() => {
    const costOf = new Map<string, number>();
    for (const p of people) {
      const n = p.costPerMonth == null ? 0 : Number(p.costPerMonth);
      costOf.set(p.id, Number.isFinite(n) ? n : 0);
    }
    const map = new Map<string, number>();
    const gather = (unitId: string): number => {
      const unit = scene.unitById.get(unitId);
      if (!unit) return 0;
      let total = 0;
      for (const seat of scene.seatsByUnit.get(unitId) ?? []) {
        if (!seat.personId) continue;
        total += (costOf.get(seat.personId) ?? 0) * (seat.allocationPct / 100);
      }
      for (const childId of unit.childIds) total += gather(childId);
      map.set(unitId, total);
      return total;
    };
    for (const unit of scene.units) if (!unit.parentId) gather(unit.id);
    return map;
  }, [scene, people]);

  const totalPayroll = scene.units.filter((unit) => !unit.parentId)
    .reduce((sum, unit) => sum + (moneyByUnit.get(unit.id) ?? 0), 0);
  const maxMoney = useMemo(() => Math.max(1, ...moneyByUnit.values()), [moneyByUnit]);

  /** Formal reporting lines, drawn between each person's primary seat and
   *  their manager's. Someone with several seats reports from the one they
   *  give most of their week to. */
  const reportingLines = useMemo(() => {
    const primary = new Map<string, PlacedSeat>();
    for (const seat of scene.seats) {
      if (!seat.personId) continue;
      const held = primary.get(seat.personId);
      if (!held || seat.allocationPct > held.allocationPct) primary.set(seat.personId, seat);
    }
    const out: { from: string; to: string }[] = [];
    for (const p of people) {
      if (!p.managerId || p.managerId === p.id) continue;
      const from = primary.get(p.id);
      const to = primary.get(p.managerId);
      if (from && to) out.push({ from: from.id, to: to.id });
    }
    return out;
  }, [scene, people]);

  useEffect(() => {
    showReportingRef.current = showReporting;
    dirtyRef.current = true;
  }, [showReporting]);
  const outerRadius = scene.extent + 60;
  const worldRadius = showSampleExternals && !activeFocusId
    ? outerRadius + EXTERNAL_GAP + EXTERNAL_R * 2
    : outerRadius;
  // The whole company's settled extent — what Fit frames and what minimum
  // zoom is measured against. On rings it is the circle it always was; in
  // local geography, the structural bounds plus the territory outline's
  // stand-off, whether or not every unit is currently painted.
  const worldBounds = useMemo((): Bounds => {
    if (!local) return { minX: -worldRadius, minY: -worldRadius, maxX: worldRadius, maxY: worldRadius };
    const b = sceneBounds(scene);
    const pad = (envelope?.pad ?? 0) * 1.5;
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }, [local, worldRadius, scene, envelope]);

  // The camera engine. All of its arithmetic lives in lib/map/camera and is
  // unit-tested there; this hook owns the stage, the size and the animation
  // frame. See docs/ENGINES.md § Camera.
  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);
  const {
    size, scale, viewBox, liveScale, hasTouched, markTouched, clearTouched,
    refreshViewBox, currentCamera, frame,
    animateCameraTo, animateFrame, animateBounds, onWheel,
  } = useCamera({ stageRef, wrapRef, worldBounds, onChange: markDirty });

  const reveal = useMemo(() => revealAt(scale), [scale]);
  const tier = tierAt(reveal);

  useEffect(() => {
    // A company switch can invalidate a focus history. Failing closed to the
    // whole company is calmer than leaving a breadcrumb to a missing unit.
    if (companyRef.current !== arrangedTree.rootId) {
      companyRef.current = arrangedTree.rootId;
      clearTouched();
      setFocusFrames([]);
      setSelectedUnitId(null);
      setRouteUnitId(null);
      setHover(null);
    } else if (activeFocusId && !arrangedTree.units.has(activeFocusId)) {
      setFocusFrames([]);
    }
  }, [activeFocusId, arrangedTree, clearTouched]);

  // Where a large company opens when we can't yet tell where the viewer sits
  // in it: the company and its first two reporting levels — the heart of
  // the place, with the rest a pan or a Fit away. Deterministic; invents no
  // role or location for the viewer.
  const startBounds = useMemo((): Bounds => {
    if (!local) return worldBounds;
    // The settled scene, saved placements included — framing the calculated
    // layout would open on wherever the company *would* be.
    const top = Math.min(...scene.units.map((u) => u.depth));
    return boundsOfUnits(scene.units.filter((u) => u.depth <= top + 2)) ?? worldBounds;
  }, [local, scene, worldBounds]);

  const externals = useMemo(
    (): (ExternalFlow & { note: string; angle: number })[] =>
      (activeFocusId || !showSampleExternals ? [] : EXTERNALS).map((e) => {
        const at = polar(e.angle, outerRadius + EXTERNAL_GAP + EXTERNAL_R);
        return {
          id: e.id,
          name: e.name,
          x: at.x,
          y: at.y,
          direction: e.direction,
          amount: totalPayroll * e.ratio,
          note: e.note,
          angle: e.angle,
        };
      }),
    [activeFocusId, outerRadius, totalPayroll, showSampleExternals],
  );

  // Units used to be culled below a fixed zoom, which quietly hid everything
  // past CEO+1 on a map whose whole structural range sits *under* that zoom —
  // half of why Northwind read as empty. Cull by what a node is actually worth
  // drawing instead: too small to see is the only reason to leave one out.
  const visibleUnits = scene.units;

  // People appear at 1.75x; below that only the lead is drawn, so the seat
  // list has to stay mounted for it even when the crowd is gone. Inside a
  // pinned detail field they may arrive a tier early.
  const fieldReveal = useMemo(
    () => (pinnedField ? revealAt(effectiveScale(scale, 1)) : null),
    [pinnedField, scale],
  );
  const showSeats = Math.max(
    reveal.people, reveal.lead, fieldReveal?.people ?? 0, fieldReveal?.lead ?? 0,
  ) > 0.015;

  /**
   * Only mount the seats that are actually on screen. A 2,400-person org has
   * 2,400+ seats, and at the zoom where people are drawn you can see a few
   * dozen of them — mounting the rest is pure cost. The box is deliberately
   * generous and updated on a throttle, so a fast pan never outruns it.
   */
  const seatsInView = useMemo(() => {
    if (!showSeats) return [];
    const crowd = reveal.people > 0.015;
    const leads = reveal.lead > 0.015;
    // Whose team sits inside the pinned field, where detail runs a tier ahead.
    const fieldReach = pinnedField ? fieldRadiusPx({ width: size.w, height: size.h }) / Math.max(scale, 1e-6) : 0;
    const inField = (seat: PlacedSeat) => {
      if (!pinnedField) return false;
      const unit = scene.unitById.get(seat.unitId);
      return !!unit && Math.hypot(unit.x - pinnedField.x, unit.y - pinnedField.y) <= fieldReach;
    };
    const fieldCrowd = (fieldReveal?.people ?? 0) > 0.015;
    const fieldLeads = (fieldReveal?.lead ?? 0) > 0.015;
    const pool = crowd
      ? scene.seats
      : scene.seats.filter((seat) =>
        (seat.kind === "lead" && (leads || (fieldLeads && inField(seat)))) || (fieldCrowd && inField(seat)));
    if (!viewBox || pool.length < 220) return pool;
    return pool.filter(
      (s) => s.x >= viewBox.minX && s.x <= viewBox.maxX && s.y >= viewBox.minY && s.y <= viewBox.maxY,
    );
  }, [scene, showSeats, reveal.people, reveal.lead, fieldReveal, pinnedField, scale, size, viewBox]);

  // --- motion targets ------------------------------------------------------
  const buildTargets = useCallback((s: OrbitalScene, drag: DragState | null) => {
    const targets = new Map<string, MotionTarget>();
    const delta =
      drag?.kind === "unit"
        ? { x: drag.current.x - drag.origin.x, y: drag.current.y - drag.origin.y }
        : null;
    const carried = drag?.kind === "unit" ? drag.moved : null;

    // Who makes room for the landing, and exactly where each will be after
    // the drop (lib/orbital/insertion.ts). Each carries its own branch; no
    // one else moves.
    const plan = drag?.kind === "unit" ? drag.plan : null;
    const seatSnap = drag?.kind === "seat" ? drag.snap : null;
    const shift = new Map<string, Point>();
    if (plan?.kind === "orbit") {
      for (const d of plan.displaced) {
        const by = { x: d.position.x - d.from.x, y: d.position.y - d.from.y };
        for (const id of descendantIds(s, d.unitId)) shift.set(id, by);
      }
    }

    for (const u of s.units) {
      const towed = carried?.has(u.id) ?? false;
      let x = u.x;
      let y = u.y;
      const by = shift.get(u.id);
      if (towed && delta) {
        x += delta.x;
        y += delta.y;
      } else if (by) {
        x += by.x;
        y += by.y;
      }
      targets.set(uid(u.id), {
        x,
        y,
        scale: drag?.kind === "unit" && drag.id === u.id ? 1.1 : 1,
      });
    }

    for (const seat of s.seats) {
      const towed = carried?.has(seat.unitId) ?? false;
      let x = seat.x;
      let y = seat.y;
      const by = shift.get(seat.unitId);
      if (towed && delta) {
        x += delta.x;
        y += delta.y;
      } else if (by) {
        x += by.x;
        y += by.y;
      } else if (seatSnap && seat.unitId === seatSnap.unitId && seat.id !== seatSnap.seatId) {
        const host = s.unitById.get(seat.unitId);
        if (host) {
          const ring = Math.hypot(seat.x - host.x, seat.y - host.y);
          const step = angularStep(SEAT_RADIUS, 6, ring);
          const offset = angleDelta(seatSnap.angle, seat.angle);
          const influence = 1 - smoothstep(0, step * YIELD_REACH, Math.abs(offset));
          if (influence > 0.001) {
            const shifted = seat.angle + (offset >= 0 ? 1 : -1) * step * YIELD_PUSH * influence;
            const at = polar(shifted, ring);
            x = host.x + at.x;
            y = host.y + at.y;
          }
        }
      }
      targets.set(sid(seat.id), {
        x,
        y,
        scale: drag?.kind === "seat" && drag.id === seat.id ? 1.35 : 1,
      });
    }
    return targets;
  }, []);

  // Publish the scene and targets outside React, for the frame loop.
  useEffect(() => {
    sceneRef.current = scene;
    interactionSceneRef.current = interactionScene;
    baseInteractionRef.current = projectedInteractionScene;
    focusBranchRef.current = focusBranch;
    targetsRef.current = buildTargets(scene, dragRef.current);
    motionRef.current.prune(new Set(targetsRef.current.keys()));
    dirtyRef.current = true;
  }, [scene, interactionScene, projectedInteractionScene, focusBranch, buildTargets]);

  /** Where a point is *drawn*: its place, spread a little by the local detail
   *  field's lens. Every painter, node and hit test goes through this one
   *  function, so what you see and what you can touch never disagree. */
  const lensed = useCallback((p: Point): Point => {
    const field = fieldRef.current;
    const stage = stageRef.current;
    if (!field || field.strength <= 0 || !stage) return p;
    return lensDisplace(field, p, stage.scaleX());
  }, []);

  const animatedAt = useCallback((key: string, fallback: Point): Point => {
    const state = motionRef.current.peek(key);
    return lensed(state ? { x: state.x.value, y: state.y.value } : fallback);
  }, [lensed]);

  const presenceOf = useCallback((unitId: string) => presenceRef.current.get(unitId) ?? 1, []);

  /** How big a unit's disc draws right now — the one number paint, hit areas,
   *  landmark names and drop targets all share. */
  const drawnOf = useCallback((unit: PlacedUnit): number => {
    const k = stageRef.current?.scaleX() ?? liveScale();
    return (localRef.current ? drawnMapRef.current.get(unit.id) : undefined) ?? unitDrawRadius(unit, k);
  }, [liveScale]);

  /** How much detail a unit's neighbourhood reads at, cached for the frame. */
  const detailFor = useCallback((unitId: string): { scale: number; reveal: Reveal } => {
    const cache = detailCacheRef.current;
    const known = cache.get(unitId);
    if (known) return known;
    const k = stageRef.current?.scaleX() ?? liveScale();
    const unit = sceneRef.current?.unitById.get(unitId);
    const influence = unit ? fieldInfluence(fieldRef.current, unit, k) : 0;
    const lifted = effectiveScale(k, influence);
    const result = {
      scale: lifted,
      reveal: influence > 0 ? revealAt(lifted) : (renderRef.current?.reveal ?? revealAt(k)),
    };
    cache.set(unitId, result);
    return result;
  }, [liveScale]);

  // Keep the painters' view of the world current.
  useEffect(() => {
    renderRef.current = {
      scene,
      reveal,
      unitRings,
      seatRings,
      workStatus,
      moneyByUnit,
      maxMoney,
      externals,
      reportingLines,
      showReporting,
      at: animatedAt,
      ripples: ripplesRef.current,
      snap: null,
      focusSeatId: null,
      hoveredRing: null,
      hoveredWork: null,
      hoveredUnitId: null,
      draggedUnitId: null,
      focusedUnitId: focusUnitRef.current.id,
      focusPath: focusUnitRef.current.path,
      focusBranch,
      scale: liveScale(),
      now: performance.now(),
      envelope,
      presence: presenceOf,
      revealFor: (unitId) => detailFor(unitId).reveal,
      detailScaleFor: (unitId) => detailFor(unitId).scale,
      fieldActive: false,
      field: null,
      carriedBranch,
      carriedRoots,
      inFlight: null,
      relation: null,
      reparent: null,
      drawn: drawnOf,
    };
    dirtyRef.current = true;
  }, [
    liveScale,
    carriedBranch,
    carriedRoots,
    envelope,
    scene,
    reveal,
    unitRings,
    seatRings,
    workStatus,
    moneyByUnit,
    maxMoney,
    externals,
    reportingLines,
    showReporting,
    focusBranch,
    animatedAt,
    presenceOf,
    detailFor,
    drawnOf,
  ]);

  // --- the frame loop ------------------------------------------------------
  useEffect(() => {
    const layers = [bgLayerRef.current, linkLayerRef.current, nodeLayerRef.current].filter(
      (l): l is Konva.Layer => !!l,
    );
    if (layers.length === 0) return;

    const anim = new Konva.Animation((frame) => {
      const dt = Math.max(0.001, (frame?.timeDiff ?? 16) / 1000);
      const now = frame?.time ?? performance.now();
      const stage = stageRef.current;
      const ctx = renderRef.current;
      if (!stage || !ctx) return false;

      // Reveal is read from the *live* stage scale, not from React state, so
      // the morph tracks the wheel exactly rather than in throttled steps.
      const live = revealAt(stage.scaleX());
      ctx.reveal = live;
      ctx.scale = stage.scaleX();
      ctx.now = now;
      ctx.ripples = ripplesRef.current;
      ctx.snap = snapHint(dragRef.current);
      ctx.focusSeatId = focusRef.current;
      ctx.hoveredRing = ringHoverRef.current;
      ctx.hoveredWork = workHoverRef.current;
      ctx.hoveredUnitId = unitHoverRef.current;
      ctx.focusedUnitId = focusUnitRef.current.id;
      ctx.focusPath = focusUnitRef.current.path;
      ctx.focusBranch = focusBranchRef.current;
      ctx.showReporting = showReportingRef.current;
      detailCacheRef.current.clear();
      const clock = performance.now();
      const reduce = reduceMotionRef.current;
      const k = stage.scaleX();

      // The local detail field eases toward where it is pinned. An active drag
      // suspends it: a preview must show exactly where things will land, and
      // a lens would bend that.
      const pin = dragRef.current ? null : pinnedFieldRef.current;
      const radiusPx = fieldRadiusPx({ width: stage.width(), height: stage.height() });
      let field = fieldRef.current;
      if (pin) {
        const from = field ?? { x: pin.x, y: pin.y, strength: 0, radiusPx };
        const glide = reduce ? 1 : 1 - Math.exp(-dt / 0.12);
        field = {
          x: from.x + (pin.x - from.x) * glide,
          y: from.y + (pin.y - from.y) * glide,
          strength: Math.min(1, from.strength + (reduce ? 1 : dt / 0.3)),
          radiusPx,
        };
      } else if (field) {
        const strength = Math.max(0, field.strength - (reduce ? 1 : dt / 0.25));
        field = strength > 0 ? { ...field, strength, radiusPx } : null;
      }
      fieldRef.current = field;
      ctx.fieldActive = !!field && field.strength > 0;
      ctx.field = field;

      // The visibility budget, re-spent when the view or the field moves — at
      // most every 80ms, because a pan asks the same question sixty times a
      // second and the answer barely changes.
      const viewKey = `${k.toFixed(4)}|${Math.round(stage.x())}|${Math.round(stage.y())}|` +
        `${pinnedFieldRef.current ? `${Math.round(pinnedFieldRef.current.x)},${Math.round(pinnedFieldRef.current.y)}` : "-"}|` +
        `${stage.width()}x${stage.height()}`;
      const stale = visibilityKeyRef.current === "";
      if (viewKey !== visibilityKeyRef.current && (stale || clock - visibilityAtRef.current > 80)) {
        visibilityKeyRef.current = viewKey;
        visibilityAtRef.current = clock;
        const w = stage.width() / k;
        const h = stage.height() / k;
        const view = { minX: -stage.x() / k, minY: -stage.y() / k, maxX: -stage.x() / k + w, maxY: -stage.y() / k + h };
        const pinned = pinnedFieldRef.current;
        const shown = visibleUnitIds({
          units: visibilityUnitsRef.current,
          view,
          budget: markBudget({ width: stage.width(), height: stage.height() }),
          scale: k,
          field: pinned ? { x: pinned.x, y: pinned.y, strength: 1, radiusPx } : null,
          forced: forcedRef.current,
          branch: focusBranchRef.current,
        });
        const firstTime = presenceTargetRef.current.size === 0;
        const origin = pinned ?? { x: view.minX + w / 2, y: view.minY + h / 2 };
        for (const u of visibilityUnitsRef.current) {
          const target = shown.has(u.id) ? 1 : 0;
          const before = presenceTargetRef.current.get(u.id);
          presenceTargetRef.current.set(u.id, target);
          // Nothing fades in on first paint; the map simply opens.
          if (firstTime || before === undefined) {
            presenceRef.current.set(u.id, target);
            continue;
          }
          if (target === 1 && before !== 1) {
            const px = Math.hypot(u.x - origin.x, u.y - origin.y) * k;
            presenceWaitRef.current.set(u.id, clock + revealDelay(px, reduce) * 1000);
          }
        }
      }
      for (const [id, target] of presenceTargetRef.current) {
        const current = presenceRef.current.get(id) ?? target;
        if (current === target) continue;
        const wait = presenceWaitRef.current.get(id);
        if (target > current && wait !== undefined && clock < wait) continue;
        presenceRef.current.set(id, stepPresence(current, target, dt, reduce));
      }

      // Local geography: dots carry headcount, and each swells until it meets
      // what its present neighbours want — so a division whose teams are
      // thinned away shows its weight, and gives room back smoothly as they
      // fade in. Drawn a touch inside that, as every disc is.
      if (localRef.current && sceneRef.current) {
        const units = sceneRef.current.units;
        const want = new Map(units.map((u) => [u.id, desiredUnitRadius(u, k)]));
        const map = drawnMapRef.current;
        map.clear();
        const present = (id: string) => presenceRef.current.get(id) ?? 1;
        for (const u of units) {
          map.set(u.id, neighbourAwareRadius(u, k, (id) => want.get(id) ?? 0, present) * 0.9);
        }
      }

      const drag = dragRef.current;
      // A deliberate drop onto another unit charges while it is held there.
      // Which unit is found on pointer events; here the charge is only read
      // again from the clock, so a finger that stays still still arms it —
      // and a slow frame can never arm a pass.
      if (drag) drag.relation = chargeAt(drag.relation, clock);
      ctx.relation = drag?.relation
        ? { ...drag.relation, kind: drag.kind === "unit" ? "merge" : "move", armed: isArmed(drag.relation) }
        : null;
      ctx.reparent = drag?.kind === "unit" && drag.reparent
        ? { ...drag.reparent, charge: chargeAt(drag.reparentHold, clock)?.charge ?? 0 }
        : null;

      motionRef.current.step(dt, targetsRef.current, reduce);
      ctx.draggedUnitId = drag?.kind === "unit" ? drag.id : null;
      ctx.inFlight = drag?.kind === "unit" && drag.fromBasket ? drag.moved : null;

      // A held branch near the edge of the map pans it, so a long move never
      // needs a second finger. Not over the basket, which has its own edge.
      const client = dragClientRef.current;
      if (drag?.kind === "unit" && client && !drag.overTray) {
        const rect = stage.container().getBoundingClientRect();
        const edge = 44;
        const speed = 560;
        const lx = client.x - rect.left;
        const ly = client.y - rect.top;
        const push = (d: number) => (d < edge ? speed * (1 - Math.max(0, d) / edge) : 0);
        const vx = push(lx) - push(rect.width - lx);
        const vy = push(ly) - push(rect.height - ly);
        if (vx !== 0 || vy !== 0) {
          const dx = vx * dt;
          const dy = vy * dt;
          stage.position({ x: stage.x() + dx, y: stage.y() + dy });
          if (drag.grabbed) {
            // Keep the held node under the finger as the world slides past.
            const node = nodeRefs.current.get(uid(drag.id));
            if (node) node.position({ x: node.x() - dx / k, y: node.y() - dy / k });
          }
          dragFollowRef.current?.();
          refreshViewBoxRef.current?.();
        }
      }

      /** Landmarks wanting a name this frame, nearest the top first. */
      const wantLabel: { node: Konva.Node; label: Konva.Node; depth: number; id: string }[] = [];
      for (const [key, node] of nodeRefs.current) {
        const isSeat = key.startsWith("s:");
        const held = drag && (drag.kind === "unit"
          ? drag.grabbed && key === uid(drag.id)
          : key === sid(drag.id));
        const state = motionRef.current.peek(key);
        if (!state) continue;

        if (held) {
          // The node under the cursor is Konva's to position, not ours.
          motionRef.current.place(key, node.x(), node.y());
        } else {
          node.position(lensed({ x: state.x.value, y: state.y.value }));
        }

        if (!isSeat) {
          // A unit's handle exists exactly when its mark does: nothing faded
          // out or too small to see keeps an invisible target, so a tap there
          // falls through to the open ground behind it.
          const id = key.slice(2);
          const unit = sceneRef.current?.unitById.get(id);
          const present = presenceRef.current.get(id) ?? 1;
          const drawnWorld = unit ? drawnOf(unit) : 0;
          const drawnPx = drawnWorld * k;
          const catchable = !!held || isInteractable(present, drawnPx);
          if (localRef.current && unit) {
            // The handle and the name follow the dot as it swells and gives way.
            const hit = node.findOne(".hit") as Konva.Circle | undefined;
            if (hit && Math.abs(hit.radius() - drawnWorld) > 1e-3) hit.radius(drawnWorld);
            const landmark = node.findOne(".landmark");
            if (landmark) {
              wantLabel.push({ node, label: landmark, depth: unit.depth, id });
              // Beneath the dot — and beneath its gauges when they show.
              const gauged = !!ctx.unitRings.get(id)?.people &&
                unitRingReveal(unit.depth, detailFor(id).scale) * smoothstep(5, 11, drawnPx) > 0.1;
              const beneath = gauged ? ringGeometry(unit, UNIT_RING_KEYS.length - 1, k, drawnWorld).radius : drawnWorld;
              landmark.y(beneath + 6 / k);
            }
          }
          if (node.listening() !== catchable) node.listening(catchable);
          const showing = !!held || present > 0.01;
          if (node.visible() !== showing) node.visible(showing);
          node.opacity(held ? 1 : present);
        }

        if (isSeat) {
          const seat = sceneRef.current?.seatById.get(key.slice(2));
          // People read at their own team's detail — lifted inside the field —
          // and are only ever as present as the team they sit on.
          const rv = seat ? detailFor(seat.unitId).reveal : live;
          const peopleOut = rv.people;
          const seatScale = peopleOut * peopleOut * (3 - 2 * peopleOut);
          const teamPresent = seat
            ? (presenceRef.current.get(seat.unitId) ?? 1) *
              (ctx.carriedBranch.has(seat.unitId) && !ctx.inFlight?.has(seat.unitId) ? 0.42 : 1)
            : 1;
          // Below the people band the lead is the last one standing: it is
          // how you find the node's point of contact at a glance.
          const presence = (seat?.kind === "lead" ? Math.max(peopleOut, rv.lead) : peopleOut) * teamPresent;
          const s = state.scale.value * (seat?.kind === "lead" ? Math.max(seatScale, rv.lead) : seatScale);
          node.scaleX(s);
          node.scaleY(s);
          // Everyone but the person being read steps back, so a crowded team
          // resolves into one legible figure instead of a thicket.
          const focus = focusRef.current;
          const dimmed = focus && focus !== key.slice(2) ? 0.22 : 1;
          node.opacity(presence * dimmed);
          node.visible(presence > 0.015);
        } else {
          node.scaleX(state.scale.value);
          node.scaleY(state.scale.value);
        }
      }

      // Landmark names, decluttered. Uniform dots mean the names are the only
      // thing orienting you at overview, and near the company they bunch —
      // so the higher-standing name wins its room and the others stand down
      // until there is space. Ranked by standing, then by id, so the same
      // view always keeps the same names.
      if (wantLabel.length > 0) {
        wantLabel.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
        const taken: { x: number; y: number }[] = [];
        for (const want of wantLabel) {
          const at = want.node.getAbsolutePosition();
          const clear = taken.every((t) =>
            Math.abs(t.x - at.x) > LABEL_CLEAR_PX.x || Math.abs(t.y - at.y) > LABEL_CLEAR_PX.y);
          if (want.label.visible() !== clear) want.label.visible(clear);
          if (clear) taken.push(at);
        }
      }

      if (ripplesRef.current.length > 0) {
        ripplesRef.current = ripplesRef.current.filter((r) => now - r.born < RIPPLE_MS);
        ctx.ripples = ripplesRef.current;
      }

      // The money packets are always travelling, so there is always a frame
      // worth drawing — this map never fully goes to sleep.
      return true;
    }, layers);

    anim.start();
    return () => {
      anim.stop();
    };
  }, [detailFor, drawnOf, lensed]);

  // --- camera --------------------------------------------------------------
  useEffect(() => {
    const pending = pendingFocusCameraRef.current;
    if (!pending) return;
    pendingFocusCameraRef.current = null;
    if (pending === "frame") {
      // Focus is a local decision view, not “fit this entire subtree”. On a
      // twelve-rung company the latter immediately recreates the lost-context
      // problem inside the branch. Frame the centre plus two reporting rings;
      // deeper structure remains present and can be approached normally.
      const focusedUnit = activeFocusId ? arrangedTree.units.get(activeFocusId) : undefined;
      if (local && focusedUnit && focusBranch) {
        // Local geography never moves for focus: frame the unit and its next
        // two levels exactly where they already are.
        const near = boundsOfUnits(
          scene.units.filter((u) => focusBranch.has(u.id) && u.depth <= focusedUnit.depth + 2));
        if (near) animateBounds(near);
      } else if (snapping) {
        const localBand = scene.bands[Math.min(2, scene.bands.length - 1)];
        animateFrame((localBand?.outer ?? scene.extent) + 70);
      } else {
        const focused = activeFocusId ? scene.unitById.get(activeFocusId) : undefined;
        if (focused) {
          const next = Math.max(liveScale(), Math.min(1.2, 56 / Math.max(1, focused.r)));
          animateCameraTo(centreOn(focused, next, { width: size.w, height: size.h }));
        }
      }
    }
    else animateCameraTo(pending);
  }, [activeFocusId, arrangedTree, focusBranch, local, scene, snapping, size, animateBounds, animateCameraTo, animateFrame, liveScale]);

  const enterFocus = useCallback((unitId: string) => {
    if (unitId === activeFocusId || !arrangedTree.units.has(unitId)) return;
    markTouched();
    pendingFocusCameraRef.current = "frame";
    setFocusFrames((current) => pushFocus(current, unitId));
    setSelectedUnitId(unitId);
    setRouteUnitId(unitId);
    setHover(null);
  }, [activeFocusId, arrangedTree, markTouched]);

  const leaveFocus = useCallback(() => {
    markTouched();
    const leavingId = activeFocus(focusFrames);
    if (!leavingId) return;
    const camera = currentCamera();
    // On rings a parent focus is re-laid at the origin; local geography never
    // moves, so the parent is wherever it already is.
    const parentId = parentFocus(focusFrames);
    const restored = hasParentFocus(focusFrames)
      ? (local && parentId ? masterScene.unitById.get(parentId) : { x: 0, y: 0 })
      : masterScene.unitById.get(leavingId);
    if (restored) {
      pendingFocusCameraRef.current = centreOn(restored, camera.scale, { width: size.w, height: size.h });
    }
    setFocusFrames((current) => popFocus(current));
    setSelectedUnitId(null);
    setHover(null);
  }, [currentCamera, focusFrames, local, masterScene, size, markTouched]);

  // Read by the blank-tap handler, which is created before these exist.
  const leaveFocusRef = useRef<(() => void) | null>(null);
  const activeFocusIdRef = useRef<string | null>(null);
  useEffect(() => {
    leaveFocusRef.current = leaveFocus;
    activeFocusIdRef.current = activeFocusId ?? null;
  }, [activeFocusId, leaveFocus]);

  // Esc steps back one thing at a time: the detail field, then the selection,
  // then one level of focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (proposal) setProposal(null);
      else if (pinnedFieldRef.current) setPinnedField(null);
      else if (selectedUnitId || routeUnitId) {
        setSelectedUnitId(null);
        setRouteUnitId(null);
      } else if (activeFocusId) leaveFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeFocusId, leaveFocus, proposal, routeUnitId, selectedUnitId]);

  const focusFromBreadcrumb = useCallback((unitId: string) => {
    markTouched();
    const camera = currentCamera();
    if (unitId === arrangedTree.rootId) {
      const current = activeFocusId ? masterScene.unitById.get(activeFocusId) : undefined;
      if (current) {
        pendingFocusCameraRef.current = centreOn(current, camera.scale, { width: size.w, height: size.h });
      }
      setFocusFrames([]);
      setSelectedUnitId(null);
      setRouteUnitId(null);
      return;
    }
    const crumb = local ? masterScene.unitById.get(unitId) : undefined;
    pendingFocusCameraRef.current = centreOn(
      { x: crumb?.x ?? 0, y: crumb?.y ?? 0 }, camera.scale, { width: size.w, height: size.h });
    setFocusFrames((current) => focusToCrumb(current, unitId));
    setSelectedUnitId(unitId);
    setRouteUnitId(unitId);
  }, [activeFocusId, arrangedTree.rootId, currentCamera, local, masterScene, size, markTouched]);

  useEffect(() => {
    if (hasTouched() || size.w === 0) return;
    // A large company opens on its heart, never so close that the first thing
    // seen is one enormous disc.
    frame(startBounds, local ? 0.25 : MAX_SCALE);
  }, [frame, local, startBounds, size, hasTouched]);

  // --- persistence ---------------------------------------------------------
  const persist = useCallback(
    (rows: {
      nodeType: "unit" | "seat";
      nodeId: string;
      angle: number | null;
      distance?: number | null;
      parentId: string | null;
    }[]) => {
      startTransition(async () => {
        const result = await saveOrbitalNodes(rows);
        if (!result.ok) console.error("Failed to save orbital arrangement:", result.error);
      });
    },
    [],
  );

  const ripple = useCallback((at: Point, reach: number) => {
    ripplesRef.current = [
      ...ripplesRef.current.slice(-7),
      { x: at.x, y: at.y, born: performance.now(), reach },
    ];
    dirtyRef.current = true;
  }, []);

  // --- dragging ------------------------------------------------------------
  const onUnitDragStart = useCallback(
    (unit: PlacedUnit) => {
      const s = sceneRef.current;
      const interactive = interactionSceneRef.current;
      if (!s || !interactive) return;
      setHover(null);
      // Dropping a node is not choosing it.
      pressMovedRef.current = true;
      setDragging(uid(unit.id));
      dragRef.current = {
        kind: "unit",
        id: unit.id,
        parentId: unit.parentId,
        origin: { x: unit.x, y: unit.y },
        current: { x: unit.x, y: unit.y },
        moved: descendantIds(interactive, unit.id),
        plan: null,
        grabbed: true,
        fromBasket: false,
        overTray: false,
        relation: null,
        magnet: null,
        reparent: null,
        reparentHold: null,
      };
      targetsRef.current = buildTargets(s, dragRef.current);
    },
    [buildTargets],
  );

  /** The unit a drag is deliberately on top of: its centre inside a visible,
   *  catchable disc that isn't part of what's being dragged. Never the company
   *  itself, and never a branch waiting in the basket. */
  const deliberateTarget = useCallback((point: Point, exclude: ReadonlySet<string>) => {
    const s = sceneRef.current;
    if (!s || !stageRef.current) return null;
    const waitingInBasket = renderRef.current?.carriedBranch;
    return overlapTarget(s.units, point, (id) => {
      const u = s.unitById.get(id);
      if (!u || !u.parentId || waitingInBasket?.has(id)) return 0;
      if ((presenceRef.current.get(id) ?? 1) < INTERACTABLE_PRESENCE) return 0;
      return drawnOf(u);
    }, exclude);
  }, [drawnOf]);

  /** Unit drags read two deliberately different invitations: a magnetic
   * body contact (merge/reparent choice) and a semantic annulus (reparent).
   * Neither uses a child's rendered connection length. */
  const unitRelationshipTargets = useCallback((
    point: Point,
    drag: Extract<DragState, { kind: "unit" }>,
  ) => {
    const s = sceneRef.current;
    const stage = stageRef.current;
    if (!s || !stage) return { magnet: null, reparent: null };
    const waitingInBasket = renderRef.current?.carriedBranch;
    const eligible = s.units.filter((unit) =>
      !waitingInBasket?.has(unit.id) &&
      (presenceRef.current.get(unit.id) ?? 1) >= INTERACTABLE_PRESENCE);
    const source = s.unitById.get(drag.id);
    // Moving round your own parent is geography, and the parent is the one
    // node you are bound to pass close to. It can never be a merge target.
    const notTargets = new Set(drag.moved);
    if (drag.parentId) notTargets.add(drag.parentId);
    const magnet = source ? magneticMergeTarget(
      eligible,
      point,
      drawnOf(source),
      (id) => {
        const unit = s.unitById.get(id);
        return unit ? drawnOf(unit) : 0;
      },
      notTargets,
      stage.scaleX(),
      drag.magnet?.unitId ?? null,
    ) : null;
    // A parent only offers its ring when the *camera* has reached the zoom
    // where unit names read — you have to be able to see what you are aiming
    // at (Greg, 2026-09-24). The magnifier deliberately does not count: it
    // lifts detail in one place, and switching a reporting-change gesture on
    // underneath it would be a trap. Zoomed further out, dragging is pure
    // geography and a reporting change is only reachable by dropping one node
    // onto another and choosing it.
    const canReparent = stage.scaleX() >= READABLE_SCALE;
    const reparent = magnet || !canReparent ? null : reparentOrbitTarget(
      eligible.map((unit) => ({
        id: unit.id,
        x: unit.x,
        y: unit.y,
        r: unit.r,
        footprint: unit.footprint,
      })),
      point,
      stage.scaleX(),
      drag.moved,
      drag.parentId,
      (id) => {
        const unit = s.unitById.get(id);
        return unit ? drawnOf(unit) : 0;
      },
    );
    return { magnet, reparent };
  }, [drawnOf]);
  useEffect(() => {
    deliberateTargetRef.current = deliberateTarget;
  }, [deliberateTarget]);
  useEffect(() => {
    snappingRef.current = snapping;
  }, [snapping]);

  const onUnitDragMove = useCallback(() => {
    const drag = dragRef.current;
    const s = interactionSceneRef.current;
    const displayed = sceneRef.current;
    if (!drag || drag.kind !== "unit" || !s || !displayed) return;
    const node = nodeRefs.current.get(uid(drag.id));
    if (!node) return;
    const pointerWorld = { x: node.x(), y: node.y() };
    drag.current = pointerWorld;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (stage && pointer) {
      const rect = stage.container().getBoundingClientRect();
      dragClientRef.current = { x: rect.left + pointer.x, y: rect.top + pointer.y };
    }
    const over = isOverTray(dragClientRef.current);
    if (over !== drag.overTray) {
      drag.overTray = over;
      setTrayHot(over);
    }
    // Break orbits is free placement with no gap-opening; otherwise plan the
    // landing afresh as the pointer moves, so the gap travels with it and
    // closes again the moment the pointer leaves every valid place. Over the
    // basket there is no landing on the map at all.
    // Deliberately on top of another unit, the target holds still: no gap
    // opens, and the drop becomes a question rather than a placement.
    const relationship = snapping && !over
      ? unitRelationshipTargets(pointerWorld, drag)
      : { magnet: null, reparent: null };
    drag.magnet = relationship.magnet;
    drag.reparent = relationship.reparent;
    const beat = performance.now();
    drag.relation = trackRelation(drag.relation, relationship.magnet, beat, pointerWorld);
    drag.reparentHold = trackRelation(
      drag.reparentHold,
      relationship.reparent ? { unitId: relationship.reparent.parentId, depth: 0 } : null,
      beat,
      pointerWorld,
    );
    if (relationship.magnet) {
      const source = displayed.unitById.get(drag.id);
      if (source) {
        drag.current = magneticPosition(
          pointerWorld,
          relationship.magnet,
          drawnOf(source),
          reduceMotionRef.current,
        );
        node.position(drag.current);
      }
    }
    const onTarget = !!relationship.magnet || !!relationship.reparent;
    drag.plan = snapping && !over && !onTarget
      ? planInsertion({
        scene: s,
        base: baseInteractionRef.current ?? s,
        unitId: drag.id,
        pointer: drag.current,
        carried: drag.moved,
      })
      : null;
    targetsRef.current = buildTargets(displayed, drag);
  }, [buildTargets, drawnOf, isOverTray, snapping, unitRelationshipTargets, setTrayHot]);

  /** Land a planned drop exactly as it was previewed. False when the plan is
   *  not a place — the caller sends the unit home. Shared by drags on the map
   *  and drags out of the basket, so the two can never land differently. */
  const commitPlan = useCallback((unitId: string, origin: Point, plan: InsertionPlan | null): boolean => {
    const s = sceneRef.current;
    if (!s || !plan || plan.kind === "none") return false;
    if (plan.kind === "free") {
      // Snaps off: placement that means nothing, and is deliberately not
      // saved — Break orbits is a way to look, not a way to arrange.
      const previous = unitOffsetsRef.current.get(unitId) ?? { x: 0, y: 0 };
      unitOffsetsRef.current.set(unitId, {
        x: previous.x + plan.position.x - origin.x,
        y: previous.y + plan.position.y - origin.y,
      });
      setPositionRevision((revision) => revision + 1);
      setSessionPlaced((count) => count + 1);
      ripple(plan.position, (s.unitById.get(unitId)?.r ?? 40) * 2.6);
      return true;
    }
    // Commit exactly what the preview showed: the unit where it landed and
    // each neighbour where it made room, as saved angles.
    ripple(plan.position, (s.unitById.get(plan.unitId)?.r ?? 40) * 2.6);
    const landed: { unitId: string; angle: number; distance?: number }[] =
      [{ unitId: plan.unitId, angle: plan.angle, distance: plan.distance }, ...plan.displaced];
    let cleared = false;
    for (const { unitId: id } of landed) if (unitOffsetsRef.current.delete(id)) cleared = true;
    if (cleared) setPositionRevision((revision) => revision + 1);
    setAngleOverrides((prev) => {
      const next = new Map(prev);
      for (const { unitId: id, angle, distance } of landed) next.set(id, { angle, distance });
      return next;
    });
    const ids = new Set(landed.map((l) => l.unitId));
    setOverrides((prev) => ({
      ...prev,
      unitParent: new Map([...(prev.unitParent ?? [])].filter(([id]) => !ids.has(id))),
    }));
    persist(landed.map(({ unitId: id, angle, distance }) => ({
      nodeType: "unit" as const,
      nodeId: id,
      angle: normalizeAngle(angle),
      distance: distance ?? null,
      // Geography never changes the organisation: the row keeps the real parent.
      parentId: baseTree.units.get(id)?.parentId ?? null,
    })));
    return true;
  }, [baseTree, persist, ripple]);

  const onUnitDragEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    dragClientRef.current = null;
    setDragging(null);
    setTrayHot(false);
    if (!drag || drag.kind !== "unit") return;
    const s = sceneRef.current;
    if (drag.overTray) {
      // Into the basket: a pending carry. The unit goes home and is marked.
      if (s) targetsRef.current = buildTargets(s, null);
      carry(drag.id);
      return;
    }
    if (isArmed(chargeAt(drag.relation, performance.now()))) {
      // A deliberate drop onto another unit asks; nothing changes until then.
      if (s) targetsRef.current = buildTargets(s, null);
      setProposal({ kind: "merge", fromId: drag.id, intoId: drag.relation!.unitId });
      return;
    }
    if (drag.reparent && isArmed(chargeAt(drag.reparentHold, performance.now()))) {
      // Held still on another parent's orbit: a deliberate reporting change,
      // and still only a question. A drop made in passing just lands.
      if (s) targetsRef.current = buildTargets(s, null);
      setProposal({ kind: "reparent", fromId: drag.id, parentId: drag.reparent.parentId });
      return;
    }
    if (!snapping && s) {
      const delta = { x: drag.current.x - drag.origin.x, y: drag.current.y - drag.origin.y };
      if (Math.hypot(delta.x, delta.y) > 1) {
        const previous = unitOffsetsRef.current.get(drag.id) ?? { x: 0, y: 0 };
        unitOffsetsRef.current.set(drag.id, { x: previous.x + delta.x, y: previous.y + delta.y });
        setPositionRevision((revision) => revision + 1);
      } else {
        targetsRef.current = buildTargets(s, null);
      }
      return;
    }
    if (!commitPlan(drag.id, drag.origin, drag.plan)) {
      // Released somewhere that isn't a place: back where it came from.
      if (s) targetsRef.current = buildTargets(s, null);
      if (drag.plan?.kind === "none" && drag.plan.reason === "off-orbit" && !local) {
        setNotice("Rings show reporting level here, so a unit stays on its own ring. Break orbits places it anywhere.");
      }
      return;
    }
    // A drop that lands takes the unit out of the basket if it was in it.
    settle(drag.id);
  }, [buildTargets, carry, commitPlan, local, settle, snapping, setTrayHot]);

  // --- carrying out of the basket ---------------------------------------------
  /** Screen point → world point under the live camera. */
  const clientToWorld = useCallback((client: Point): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.container().getBoundingClientRect();
    const k = stage.scaleX();
    return { x: (client.x - rect.left - stage.x()) / k, y: (client.y - rect.top - stage.y()) / k };
  }, []);

  /** Re-read a drag out of the basket from where the pointer is now. It uses
   *  the very same landing preview as a drag on the map. */
  const followCarry = useCallback(() => {
    const drag = dragRef.current;
    const s = interactionSceneRef.current;
    const displayed = sceneRef.current;
    const client = dragClientRef.current;
    if (!drag || drag.kind !== "unit" || !drag.fromBasket || !s || !displayed || !client) return;
    const world = clientToWorld(client);
    if (!world) return;
    drag.current = world;
    const over = isOverTray(client);
    if (over !== drag.overTray) {
      drag.overTray = over;
      setTrayHot(over);
    }
    const relationship = snapping && !over
      ? unitRelationshipTargets(world, drag)
      : { magnet: null, reparent: null };
    drag.magnet = relationship.magnet;
    drag.reparent = relationship.reparent;
    const beat = performance.now();
    drag.relation = trackRelation(drag.relation, relationship.magnet, beat, world);
    drag.reparentHold = trackRelation(
      drag.reparentHold,
      relationship.reparent ? { unitId: relationship.reparent.parentId, depth: 0 } : null,
      beat,
      world,
    );
    if (relationship.magnet) {
      const source = displayed.unitById.get(drag.id);
      if (source) drag.current = magneticPosition(
        world,
        relationship.magnet,
        drawnOf(source),
        reduceMotionRef.current,
      );
    }
    const onTarget = !!relationship.magnet || !!relationship.reparent;
    drag.plan = over || onTarget
      ? null
      : snapping
        ? planInsertion({ scene: s, base: baseInteractionRef.current ?? s, unitId: drag.id, pointer: world, carried: drag.moved })
        : { kind: "free", unitId: drag.id, position: world };
    targetsRef.current = buildTargets(displayed, drag);
  }, [buildTargets, clientToWorld, drawnOf, isOverTray, snapping, unitRelationshipTargets, setTrayHot]);

  useEffect(() => {
    dragFollowRef.current = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "seat") onSeatDragMoveRef.current?.();
      else if (drag.grabbed) onUnitDragMove();
      else followCarry();
    };
  }, [followCarry, onUnitDragMove]);

  /** Find a carried branch on the map: the camera glides to its placeholder
   *  at the current zoom, and its entry lights up. */
  const locateCarried = useCallback((unitId: string) => {
    const unit = sceneRef.current?.unitById.get(unitId);
    const stage = stageRef.current;
    if (!unit || !stage) return;
    const k = stage.scaleX();
    markTouched();
    animateCameraTo(centreOn(unit, k, { width: size.w, height: size.h }));
    flash(unitId);
  }, [animateCameraTo, size, markTouched, flash]);

  /**
   * The basket ↔ growth seam (docs/ENGINES.md § Basket).
   *
   * The basket reports *intent* — this press became a drag, the pointer
   * moved, the drag ended. What a drop **means** is growth's business, and
   * the two are sibling engines that must not import each other. So the
   * basket calls these, and these speak to the drag machinery. When growth
   * is extracted, this is the join that moves into `runtime`.
   */
  useEffect(() => {
    beginCarryDragRef.current = (unitId) => {
      const s = sceneRef.current;
      const interactive = interactionSceneRef.current;
      const unit = s?.unitById.get(unitId);
      if (!s || !interactive || !unit) return false;
      setHover(null);
      setDragging(uid(unit.id));
      dragRef.current = {
        kind: "unit",
        id: unit.id,
        parentId: unit.parentId,
        origin: { x: unit.x, y: unit.y },
        current: { x: unit.x, y: unit.y },
        moved: descendantIds(interactive, unit.id),
        plan: null,
        grabbed: false,
        fromBasket: true,
        overTray: true,
        relation: null,
        magnet: null,
        reparent: null,
        reparentHold: null,
      };
      return true;
    };

    followCarryRef.current = followCarry;
    locateCarriedRef.current = locateCarried;

    endCarryDragRef.current = (cancelled) => {
      const drag = dragRef.current;
      dragRef.current = null;
      dragClientRef.current = null;
      setDragging(null);
      const s = sceneRef.current;
      if (!drag || drag.kind !== "unit") return null;
      const settled = () => { if (s) targetsRef.current = buildTargets(s, null); };

      // A deliberate, held contact is a relationship change, not a placement.
      if (!cancelled && isArmed(chargeAt(drag.relation, performance.now()))) {
        settled();
        setProposal({ kind: "merge", fromId: drag.id, intoId: drag.relation!.unitId });
        return { landed: false, unitId: drag.id };
      }
      if (!cancelled && drag.reparent && isArmed(chargeAt(drag.reparentHold, performance.now()))) {
        settled();
        setProposal({ kind: "reparent", fromId: drag.id, parentId: drag.reparent.parentId });
        return { landed: false, unitId: drag.id };
      }

      const landed = !cancelled && !drag.overTray && commitPlan(drag.id, drag.origin, drag.plan);
      if (landed) return { landed: true, unitId: drag.id };

      // Cancelled, dropped back on the tray, or no room: it stays in the
      // basket — not back at its origin, which it never actually left.
      settled();
      if (!cancelled && !drag.overTray) setNotice(noRoom(drag.id));
      return { landed: false, unitId: drag.id };
    };
  }, [buildTargets, commitPlan, followCarry, locateCarried, noRoom]);

  const onSeatDragStart = useCallback((seat: PlacedSeat) => {
    setHover(null);
    setDragging(sid(seat.id));
    dragRef.current = {
      kind: "seat",
      id: seat.id,
      origin: { x: seat.x, y: seat.y },
      current: { x: seat.x, y: seat.y },
      snap: null,
      relation: null,
    };
  }, []);

  const onSeatDragMove = useCallback(() => {
    const drag = dragRef.current;
    const s = interactionSceneRef.current;
    const displayed = sceneRef.current;
    if (!drag || drag.kind !== "seat" || !s || !displayed) return;
    const node = nodeRefs.current.get(sid(drag.id));
    if (!node) return;
    drag.current = { x: node.x(), y: node.y() };
    // A broken-orbits board is spatial exploration only. Even dropping a
    // person directly onto a team must not silently change their assignment.
    // On the map, a person only re-settles round their own team; moving them
    // to another is a deliberate drop onto it, and that asks first.
    const own = s.seatById.get(drag.id)?.unitId;
    const target = snapping && own ? deliberateTarget(drag.current, new Set([own])) : null;
    drag.relation = trackRelation(drag.relation, target, performance.now());
    const onTarget = !!target;
    const snap = snapping && !onTarget ? snapSeat(s, drag.id, drag.current) : null;
    drag.snap = snap && !snap.moves ? snap : null;
    targetsRef.current = buildTargets(displayed, drag);
  }, [buildTargets, deliberateTarget, snapping]);
  useEffect(() => {
    onSeatDragMoveRef.current = onSeatDragMove;
  }, [onSeatDragMove]);

  const onSeatDragEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (!drag || drag.kind !== "seat") return;
    if (isArmed(chargeAt(drag.relation, performance.now()))) {
      const s = sceneRef.current;
      if (s) targetsRef.current = buildTargets(s, null);
      setProposal({ kind: "move", seatId: drag.id, toUnitId: drag.relation!.unitId });
      return;
    }
    if (!drag.snap) {
      const s = sceneRef.current;
      if (!snapping && s) {
        const delta = { x: drag.current.x - drag.origin.x, y: drag.current.y - drag.origin.y };
        if (Math.hypot(delta.x, delta.y) > 1) {
          const previous = seatOffsetsRef.current.get(drag.id) ?? { x: 0, y: 0 };
          seatOffsetsRef.current.set(drag.id, { x: previous.x + delta.x, y: previous.y + delta.y });
          setPositionRevision((revision) => revision + 1);
        } else {
          targetsRef.current = buildTargets(s, null);
        }
      } else if (s) {
        targetsRef.current = buildTargets(s, null);
      }
      return;
    }
    // Settled back round their own team: nothing about them has changed.
    ripple(drag.snap.position, SEAT_RADIUS * 4.5);
    const s = sceneRef.current;
    if (s) targetsRef.current = buildTargets(s, null);
  }, [buildTargets, ripple, snapping]);

  /** Yes to moving a person: exactly what the map has always done on a drop
   *  onto a team — and no more. It moves them on this map; it does not edit
   *  their team membership in People and Teams. Whether it should is Greg's
   *  call (docs/ORBITAL-INTERACTION.md). */
  const confirmMove = useCallback((seatId: string, toUnitId: string) => {
    if (seatOffsetsRef.current.delete(seatId)) setPositionRevision((revision) => revision + 1);
    setOverrides((prev) => ({
      ...prev,
      seatUnit: new Map(prev.seatUnit ?? []).set(seatId, toUnitId),
    }));
    persist([{ nodeType: "seat", nodeId: seatId, angle: null, parentId: toUnitId }]);
    setProposal(null);
  }, [persist]);
  const acceptMove = useCallback(() => {
    if (proposal?.kind === "move") confirmMove(proposal.seatId, proposal.toUnitId);
  }, [confirmMove, proposal]);

  /** Confirmed reporting-structure edit. The server re-validates tenancy and
   * cycles, moves the branch root, and removes only that root's stale saved
   * placement. Descendant arrangements remain authored geography. */
  const confirmReparent = useCallback((fromId: string, parentId: string) => {
    setProposal(null);
    startTransition(async () => {
      const result = await moveOrgUnit(fromId, parentId);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      unitOffsetsRef.current.delete(fromId);
      setAngleOverrides((previous) => {
        const next = new Map(previous);
        next.delete(fromId);
        return next;
      });
      setOverrides((previous) => ({
        ...previous,
        unitParent: new Map([...(previous.unitParent ?? [])].filter(([id]) => id !== fromId)),
      }));
      setPositionRevision((revision) => revision + 1);
      setNotice("Branch moved. Its descendants and their arrangements stayed together.");
      router.refresh();
    });
  }, [router]);

  const arranged =
    (overrides.unitParent?.size ?? 0) > 0 ||
    (overrides.seatUnit?.size ?? 0) > 0 ||
    angleOverrides.size > 0 ||
    unitOffsetsRef.current.size > 0 ||
    seatOffsetsRef.current.size > 0;

  // A notice says its piece and goes.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const resetArrangement = useCallback(() => {
    if (activeFocusId) pendingFocusCameraRef.current = "frame";
    setSnapping(true);
    setSessionPlaced(0);
    setOverrides({});
    setAngleOverrides(new Map());
    unitOffsetsRef.current.clear();
    seatOffsetsRef.current.clear();
    setPositionRevision((revision) => revision + 1);
    startTransition(async () => {
      const result = await clearOrbitalNodes();
      if (!result.ok) console.error("Failed to clear orbital arrangement:", result.error);
    });
  }, [activeFocusId]);

  /** The units the opened person actually sits on — the board flavours its
   *  cards with these, so handing it the whole org would be a lie. */
  const boardTeamNames = useMemo(
    () => openBoard
      ? boardTeams(scene.seats, (id) => scene.unitById.get(id)?.name, openBoard.id)
      : [],
    [openBoard, scene],
  );

  const screenOf = useCallback((world: Point): Point => {
    const stage = stageRef.current;
    if (!stage) return world;
    const s = stage.scaleX();
    return { x: stage.x() + world.x * s, y: stage.y() + world.y * s };
  }, []);

  /** Pointer position in world coordinates. */
  const pointerWorld = useCallback((): Point | null => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!stage || !p) return null;
    const k = stage.scaleX();
    return { x: (p.x - stage.x()) / k, y: (p.y - stage.y()) / k };
  }, []);

  /**
   * What the pointer is over, among the things that are *painted* rather than
   * given their own Konva node — work items, progress rings, the torus.
   * Several hundred work dots would be several hundred nodes; this is one
   * pass of arithmetic over the same geometry the painters use, so what you
   * can point at is exactly what you can see.
   */
  const hitTest = useCallback((world: Point): Hit | null => {
    const s = sceneRef.current;
    const stage = stageRef.current;
    if (!s || !stage) return null;
    const live = stage.scaleX();
    // The same presence, detail and drawn positions the painters used this
    // frame: a mark that is faded out, or not yet revealed here, can't be hit.
    const present = (unitId: string) => presenceOf(unitId) >= INTERACTABLE_PRESENCE;
    // Without a field every unit reads at the camera's own detail, so whole
    // passes can be skipped when nothing of that kind is showing anywhere.
    const fieldOn = !!fieldRef.current && fieldRef.current.strength > 0;
    const everywhere = revealAt(live);

    if (fieldOn || everywhere.workDots > 0.2) for (const seat of s.seats) {
      if (seat.work.length === 0 || !present(seat.unitId)) continue;
      if (detailFor(seat.unitId).reveal.workDots <= 0.2) continue;
      const drawn = animatedAt(sid(seat.id), seat);
      const dx = drawn.x - seat.x;
      const dy = drawn.y - seat.y;
      for (let i = 0; i < seat.work.length; i++) {
        const w = seat.work[i];
        if (Math.hypot(world.x - (w.x + dx), world.y - (w.y + dy)) <= WORK_RADIUS * 2.6) {
          return { kind: "work", seatId: seat.id, index: i };
        }
      }
    }

    for (const unit of s.units) {
      if (!present(unit.id)) continue;
      const at = animatedAt(uid(unit.id), unit);
      const d = Math.hypot(world.x - at.x, world.y - at.y);
      const opacity = unitRingReveal(unit.depth, detailFor(unit.id).scale);
      const drawn = drawnOf(unit);
      if (opacity <= 0.05 || drawn * live < 5) continue;
      for (let i = 0; i < UNIT_RING_KEYS.length; i++) {
        if (unitRings.get(unit.id)?.[UNIT_RING_KEYS[i]] == null) continue;
        const g = ringGeometry(unit, i, live, drawn);
        if (Math.abs(d - g.radius) <= Math.max(g.width, 7) / 2 + 2) {
          return { kind: "ring", unitId: unit.id, ring: UNIT_RING_KEYS[i] };
        }
      }
    }

    if (fieldOn || everywhere.torus > 0.2) for (const unit of s.units) {
      if (!present(unit.id) || detailFor(unit.id).reveal.torus <= 0.2) continue;
      const at = animatedAt(uid(unit.id), unit);
      const d = Math.hypot(world.x - at.x, world.y - at.y);
      if (Math.abs(d - unit.seatRingRadius) > SEAT_RADIUS + 3) continue;
      const a = Math.atan2(world.y - at.y, world.x - at.x);
      if (Math.abs(angleDelta(unit.seatFanAngle, a)) <= Math.max(unit.seatFanSpan, 0.22) / 2 + 0.06) {
        return { kind: "torus", unitId: unit.id };
      }
    }
    return null;
  }, [animatedAt, detailFor, drawnOf, presenceOf, unitRings]);

  const onStagePointerMove = useCallback(() => {
    if (dragRef.current) return;
    const s = sceneRef.current;
    const world = pointerWorld();
    if (!s || !world) return;
    const hit = hitTest(world);

    const nextRing = hit?.kind === "ring" ? { unitId: hit.unitId, key: hit.ring } : null;
    const nextWork = hit?.kind === "work" ? { seatId: hit.seatId, index: hit.index } : null;
    const nextUnit = hit?.kind === "torus" ? hit.unitId : null;
    const changed =
      nextRing?.unitId !== ringHoverRef.current?.unitId ||
      nextRing?.key !== ringHoverRef.current?.key ||
      nextWork?.seatId !== workHoverRef.current?.seatId ||
      nextWork?.index !== workHoverRef.current?.index ||
      nextUnit !== unitHoverRef.current;
    if (!changed) return;

    ringHoverRef.current = nextRing;
    workHoverRef.current = nextWork;
    unitHoverRef.current = nextUnit;
    dirtyRef.current = true;

    if (!hit) {
      // Only clear hovers this handler owns; a seat or unit node owns its own.
      setHover((prev) =>
        prev && (prev.kind === "ring" || prev.kind === "torus" || prev.kind === "work")
          ? null
          : prev,
      );
      return;
    }
    const at = screenOf(world);
    if (hit.kind === "work") {
      const seat = s.seatById.get(hit.seatId);
      if (seat) setHover({ kind: "work", seat, index: hit.index, x: at.x, y: at.y });
    } else if (hit.kind === "ring") {
      const unit = s.unitById.get(hit.unitId);
      if (unit) setHover({ kind: "ring", unit, ring: hit.ring, x: at.x, y: at.y });
    } else {
      const unit = s.unitById.get(hit.unitId);
      if (unit) setHover({ kind: "torus", unit, x: at.x, y: at.y });
    }
  }, [hitTest, pointerWorld, screenOf]);

  const onStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Konva fires click at the end of a drag too, so a pan across the map
    // would otherwise open whatever happened to be under the cursor.
    if (pressMovedRef.current) return;
    const world = pointerWorld();
    const s = sceneRef.current;
    if (!world || !s) return;
    const hit = hitTest(world);
    if (hit?.kind !== "work") {
      // Open ground (Greg, 2026-09-21): let go of whatever was selected, and
      // pin the local detail field here — it gently reveals what is there
      // without moving the camera or diving into the hierarchy. Tapping the
      // field's own centre again lifts it. A click on a unit bubbles up here
      // too, but its target is the unit, not the stage. Focus is left by its
      // breadcrumb or Esc, never by a stray tap.
      if (!hit && e.target === e.target.getStage()) {
        setRouteUnitId(null);
        setSelectedUnitId(null);
        const k = stageRef.current?.scaleX() ?? liveScale();
        const place = lensInverse(fieldRef.current, world, k);
        const current = pinnedFieldRef.current;
        const now = performance.now();
        const last = lastBlankTapRef.current;
        const second = !!last && now - last.at < DOUBLE_TAP_MS &&
          Math.hypot(place.x - last.at0.x, place.y - last.at0.y) * k < DOUBLE_TAP_PX;
        lastBlankTapRef.current = second ? null : { at: now, at0: place };
        // Second tap in quick succession on open ground: leave focus (Greg,
        // 2026-09-24). It also takes back the field the first tap pinned, so
        // the gesture does one thing rather than two.
        if (second && activeFocusIdRef.current) {
          setPinnedField(null);
          leaveFocusRef.current?.();
          return;
        }
        setPinnedField(current && Math.hypot(place.x - current.x, place.y - current.y) * k < 28 ? null : place);
      }
      return;
    }
    const seat = s.seatById.get(hit.seatId);
    const task = seat?.personId ? boards.get(seat.personId)?.[hit.index] : undefined;
    if (seat && task) setOpenWork({ seat, task });
  }, [hitTest, pointerWorld, boards, setPinnedField, liveScale]);

  const registerNode = useCallback((key: string, node: Konva.Group | null) => {
    if (node) nodeRefs.current.set(key, node);
    else nodeRefs.current.delete(key);
  }, []);

  // Built once, after mount, so the render pass itself never touches the ref
  // they close over — they read it at draw time, which is the whole point.
  const [painters, setPainters] = useState<Painters | null>(null);
  useEffect(() => {
    const get = () => renderRef.current;
    setPainters({
      envelope: paintEnvelope(get),
      field: paintField(get),
      relation: paintRelation(get),
      unitDiscs: paintUnitDiscs(get),
      unitRings: paintUnitRings(get),
      torus: paintTorus(get),
      seatRings: paintSeatRings(get),
      workCapsules: paintWorkCapsules(get),
      workDots: paintWorkDots(get),
      unitLinks: paintUnitLinks(get),
      seatLinks: paintSeatLinks(get),
      reportingLines: paintReportingLines(get),
      externalFlows: paintExternalFlows(get),
      preview: paintPreview(get),
      ripples: paintRipples(get),
    });
  }, []);
  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%", height: "100%", background: C.paper, overflow: "hidden" }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        draggable
        onWheel={onWheel}
        onDragStart={() => {
          markTouched();
        }}
        onDragMove={() => {
          dirtyRef.current = true;
          refreshViewBox();
          bgLayerRef.current?.batchDraw();
        }}
        onDragEnd={() => refreshViewBox(true)}
        onMouseDown={() => {
          const p = stageRef.current?.getPointerPosition();
          pressOriginRef.current = p ? { x: p.x, y: p.y } : null;
          pressMovedRef.current = false;
        }}
        onMouseMove={() => {
          const origin = pressOriginRef.current;
          const p = stageRef.current?.getPointerPosition();
          if (origin && p && Math.hypot(p.x - origin.x, p.y - origin.y) > 4) {
            pressMovedRef.current = true;
          }
          onStagePointerMove();
        }}
        onClick={onStageClick}
        onTap={onStageClick}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        {/* Local family boundaries are always visible. The three inner helper
            rings are visual guides, revealed only for a focused family. */}
        <Layer ref={bgLayerRef}>
          {/* Money runs under the whole map: the org sits on top of its own
              flows rather than beside them (Greg, 2026-09-14). */}
          {painters && showSampleExternals && (
            <Shape sceneFunc={painters.externalFlows} perfectDrawEnabled={false} listening={false} />
          )}
          {painters && envelope && (
            <Shape sceneFunc={painters.envelope} perfectDrawEnabled={false} listening={false} />
          )}
          {guideFamilies.flatMap((family) => {
            const focused = !!activeFamilyRootId && family.rootId === activeFamilyRootId;
            const fractions = focused ? [0.25, 0.5, 0.75, 1] : [1];
            return fractions.map((fraction) => (
              <Circle
                key={`guide-${family.rootId}-${fraction}`}
                x={family.centre.x}
                y={family.centre.y}
                radius={family.boundary * fraction}
                stroke={C.guide}
                strokeWidth={1.5 / Math.max(scale, 0.05)}
                dash={[2 / Math.max(scale, 0.05), 7 / Math.max(scale, 0.05)]}
                lineCap="round"
                perfectDrawEnabled={false}
                listening={false}
              />
            ));
          })}
          {!activeFocusId && showSampleExternals && EXTERNALS.map((ext) => {
            const at = polar(ext.angle, outerRadius + EXTERNAL_GAP + EXTERNAL_R);
            return (
              <Group
                key={ext.id}
                x={at.x}
                y={at.y}
                onMouseEnter={() => {
                  const point = screenOf(at);
                  setHover({ kind: "external", name: ext.name, note: ext.note, x: point.x, y: point.y });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={(event) => {
                  event.cancelBubble = true;
                  const point = screenOf(at);
                  setHover({ kind: "external", name: ext.name, note: ext.note, x: point.x, y: point.y });
                }}
                onTap={(event) => {
                  event.cancelBubble = true;
                  const point = screenOf(at);
                  setHover({ kind: "external", name: ext.name, note: ext.note, x: point.x, y: point.y });
                }}
              >
                <Circle
                  radius={EXTERNAL_R}
                  fill={C.white}
                  stroke={C.unitStroke}
                  strokeWidth={1.5 / Math.max(scale, 0.05)}
                  perfectDrawEnabled={false}
                />
                {scale >= 0.7 && <Text
                  text={ext.name}
                  x={-EXTERNAL_R + 12}
                  y={-14}
                  width={EXTERNAL_R * 2 - 24}
                  align="center"
                  fontSize={15}
                  fontFamily={FONT}
                  fill={C.inkSoft}
                  listening={false}
                />}
              </Group>
            );
          })}
        </Layer>

        {/* Connections and everything painted per frame, always behind the
            shapes they belong to. */}
        <Layer ref={linkLayerRef} listening={false}>
          {painters && (
            <>
              {/* Weighted by the money running through each branch. */}
              <Shape sceneFunc={painters.unitLinks} perfectDrawEnabled={false} listening={false} />
              {/* Dotted: the formal reporting line, a different kind of
                  relationship from the solid delivery structure. */}
              <Shape
                sceneFunc={painters.reportingLines}
                stroke={C.inkSoft}
                strokeWidth={1.2}
                dash={[5, 5]}
                opacity={0.5}
                perfectDrawEnabled={false}
              />
              {/* Per-person strength: people inside the detail field can be
                  out while those beyond it are not. */}
              <Shape sceneFunc={painters.seatLinks} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.workCapsules} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.workDots} perfectDrawEnabled={false} listening={false} />
              {/* The unit circles. Painted rather than React-managed because
                  their size tracks the live camera — see paintUnitDiscs. The
                  Groups in the node layer above are their handles. */}
              <Shape sceneFunc={painters.unitDiscs} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.torus} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.unitRings} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.seatRings} perfectDrawEnabled={false} listening={false} />
              <Shape
                sceneFunc={painters.preview}
                stroke={C.accent}
                strokeWidth={2.5 / Math.max(scale, 0.1)}
                dash={[10 / Math.max(scale, 0.1), 7 / Math.max(scale, 0.1)]}
                perfectDrawEnabled={false}
              />
              <Shape sceneFunc={painters.ripples} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.field} perfectDrawEnabled={false} listening={false} />
              <Shape sceneFunc={painters.relation} perfectDrawEnabled={false} listening={false} />
            </>
          )}
        </Layer>

        <Layer ref={nodeLayerRef}>
          {(() => {
            // Sized once for every label below.
            const fieldPx = fieldRadiusPx({ width: size.w, height: size.h });
            return visibleUnits.map((unit) => {
            // What you can grab is exactly what you can see: the handle takes
            // the disc's drawn size, not its laid-out one. Reading it from
            // React's throttled scale is fine here — the circle is invisible,
            // so a 3% step in it is a 3% step in nothing.
            const drawn = unitDrawRadius(unit, scale);
            const invScale = 1 / Math.max(scale, 0.01);
            const detailScale = pinnedField
              ? effectiveScale(scale, fieldInfluence({ ...pinnedField, strength: 1, radiusPx: fieldPx }, unit, scale))
              : scale;
            const named = unitLabelVisible(drawn, scale, detailScale);
            // Large dots name themselves beneath; the frame loop shows or
            // hides the name as the dot actually swells or gives way.
            const landmark = local && !named && isLandmark(unit.depth);
            // A name beneath a dot clears its gauges when they are showing.
            const gauged = !!unitRings.get(unit.id)?.people &&
              unitRingReveal(unit.depth, detailScale) * smoothstep(5, 11, drawn * scale) > 0.1;
            const beneath = gauged ? ringGeometry(unit, UNIT_RING_KEYS.length - 1, scale).radius : drawn;
            return (
              <Group
                key={unit.id}
                ref={(node) => registerNode(uid(unit.id), node)}
                x={unit.x}
                y={unit.y}
                draggable={unit.depth > 0 && unit.id !== activeFocusId}
                // Konva starts a drag on any movement at all, so a click with
                // a pixel of jitter became a zero-length drop — which re-ran
                // the snap and, now, would swallow the click that focuses the
                // node. A few pixels is the difference between the two.
                dragDistance={4}
                onDragStart={() => onUnitDragStart(unit)}
                onDragMove={onUnitDragMove}
                onDragEnd={onUnitDragEnd}
                onMouseEnter={() => {
                  const at = screenOf(animatedAt(uid(unit.id), unit));
                  setHover({ kind: "unit", unit, x: at.x, y: at.y });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (pressMovedRef.current) return;
                  // Every path starts at the company, so clicking it clears
                  // the route rather than drawing one of zero length.
                  setRouteUnitId(unit.id === arrangedTree.rootId ? null : unit.id);
                  setSelectedUnitId(unit.id);
                  // A carried placeholder points at its basket entry.
                  const carrier = carrierOf(basketRef.current, unit.id, basketTree);
                  if (carrier) flash(carrier);
                }}
                onTap={() => {
                  if (pressMovedRef.current) return;
                  setRouteUnitId(unit.id === arrangedTree.rootId ? null : unit.id);
                  setSelectedUnitId(unit.id);
                  const carrier = carrierOf(basketRef.current, unit.id, basketTree);
                  if (carrier) flash(carrier);
                }}
                onDblClick={() => enterFocus(unit.id)}
                onDblTap={() => enterFocus(unit.id)}
              >
                <Circle name="hit" radius={drawn} fill="transparent" perfectDrawEnabled={false} />
                {(!focusBranch || focusBranch.has(unit.id)) && named && (
                  <Text
                    text={unit.name}
                    x={-drawn}
                    y={-6 * invScale}
                    width={drawn * 2}
                    align="center"
                    wrap="none"
                    ellipsis
                    fontSize={Math.min(15, Math.max(11, drawn * scale * 0.24)) * invScale}
                    fontFamily={FONT}
                    fill={C.ink}
                    listening={false}
                  />
                )}
                {(!focusBranch || focusBranch.has(unit.id)) && landmark && (
                  <Text
                    name="landmark"
                    text={unit.name}
                    x={-80 * invScale}
                    y={beneath + 6 * invScale}
                    width={160 * invScale}
                    align="center"
                    wrap="none"
                    ellipsis
                    fontSize={11 * invScale}
                    fontFamily={FONT}
                    fill={C.inkSoft}
                    listening={false}
                  />
                )}
              </Group>
            );
            });
          })()}

          {seatsInView.map((seat) => {
              const isDragged = dragging === sid(seat.id);
              const open = seat.kind === "open";
              const strain = seat.personId ? vitals.get(seat.personId)?.strain : undefined;
              return (
                <Group
                  key={seat.id}
                  ref={(node) => registerNode(sid(seat.id), node)}
                  x={seat.x}
                  y={seat.y}
                  draggable
                  onDragStart={() => onSeatDragStart(seat)}
                  onDragMove={onSeatDragMove}
                  onDragEnd={onSeatDragEnd}
                  onMouseEnter={() => {
                    const at = screenOf(animatedAt(sid(seat.id), seat));
                    focusRef.current = seat.id;
                    dirtyRef.current = true;
                    setHover({ kind: "seat", seat, x: at.x, y: at.y });
                  }}
                  onMouseLeave={() => {
                    focusRef.current = null;
                    dirtyRef.current = true;
                    setHover(null);
                  }}
                  onClick={(event) => {
                    event.cancelBubble = true;
                    const at = screenOf(animatedAt(sid(seat.id), seat));
                    setHover({ kind: "seat", seat, x: at.x, y: at.y });
                  }}
                  onTap={(event) => {
                    event.cancelBubble = true;
                    const at = screenOf(animatedAt(sid(seat.id), seat));
                    setHover({ kind: "seat", seat, x: at.x, y: at.y });
                  }}
                >
                  {/* The avatar art is non-interactive; this single invisible
                      circle keeps the whole face tappable without duplicating
                      hit regions for each illustrated feature. */}
                  <Circle radius={seat.r + 2} fill="rgba(0,0,0,0.001)" perfectDrawEnabled={false} />
                  {seat.shared && (
                    <Circle
                      radius={seat.r + 4}
                      stroke={C.seat}
                      strokeWidth={1}
                      dash={[3, 3]}
                      opacity={0.7}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  )}
                  {open ? (
                    <Circle radius={seat.r} fill={C.seatOpen} stroke={C.inkSoft} strokeWidth={1.5} dash={[3, 3]} perfectDrawEnabled={false} />
                  ) : (
                    <SeatAvatar seat={seat} stroke={isDragged ? C.accent : strain === "risk" ? C.risk : strain === "watch" ? C.watch : C.white} />
                  )}
                </Group>
              );
            })}
        </Layer>
      </Stage>

      {activeFocusId && (
        <nav style={S.breadcrumb} aria-label="Focused organisation path">
          <button
            type="button"
            style={S.crumbClose}
            onClick={leaveFocus}
            aria-label="Leave focus"
            title="Leave focus (Esc)"
          >
            ×
          </button>
          {focusBreadcrumb.map((unit, index) => (
            <span key={unit.id} style={S.crumbWrap}>
              {index > 0 && <span style={S.crumbDivider}>›</span>}
              <button
                type="button"
                style={S.crumb(unit.id === activeFocusId)}
                onClick={() => focusFromBreadcrumb(unit.id)}
              >
                {unit.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {selectedUnit && (
        <OrbitalUnitCard
          unit={selectedUnit}
          scene={scene}
          rings={unitRings.get(selectedUnit.id)}
          absoluteDepth={arrangedTree.units.get(selectedUnit.id)?.depth ?? selectedUnit.depth}
          activeFocusId={activeFocusId}
          companyId={arrangedTree.rootId}
          onFocus={() => enterFocus(selectedUnit.id)}
          onClose={() => setSelectedUnitId(null)}
        />
      )}

      {notice && (
        <div role="status" aria-live="polite" style={S.notice}>
          {notice}
        </div>
      )}

      {(basket.length > 0 || (dragging?.startsWith("u:") ?? false)) && (() => {
        const edge = coarsePointer || size.w < 760 ? "bottom" : "right";
        const describe = (unitId: string) => {
          const unit = arrangedTree.units.get(unitId);
          const kind = kindById.get(unitId);
          let below = 0;
          const stack = [...(unit?.childIds ?? [])];
          while (stack.length > 0) {
            const id = stack.pop()!;
            below++;
            stack.push(...(arrangedTree.units.get(id)?.childIds ?? []));
          }
          const people = unit?.totalSeats ?? 0;
          const type = kind === "team" ? vocabulary.team.singular : "Unit";
          const reach = [
            below > 0 ? `${below} ${below === 1 ? "unit" : "units"} below` : null,
            `${people} ${people === 1 ? "person" : "people"}`,
          ].filter(Boolean).join(" · ");
          return { name: unit?.name ?? "Unit", line: `${type} · ${reach}` };
        };
        return (
          <aside
            ref={trayRef}
            aria-label="Basket — branches being carried"
            style={S.tray(edge, trayHot, basket.length === 0)}
          >
            <div style={S.trayHead}>
              <span>Basket</span>
              {basket.length > 1 && (
                <button type="button" style={S.trayLink} onClick={returnAll}>
                  Return all
                </button>
              )}
            </div>
            {basket.length === 0 && (
              <div style={S.trayEmpty}>Drop here to carry this branch across the map</div>
            )}
            <div style={S.trayList(edge)}>
              {basket.map((entry) => {
                const { name, line } = describe(entry.unitId);
                return (
                  <div
                    key={entry.unitId}
                    style={S.trayEntry(flashEntry === entry.unitId, edge)}
                    data-unit-id={entry.unitId}
                    onPointerDown={pressEntry}
                    onPointerMove={moveEntry}
                    onPointerUp={releaseEntry}
                    onPointerCancel={cancelEntry}
                    title="Tap to find it on the map · drag onto the map to place it"
                  >
                    <span aria-hidden style={S.trayGrip}>⠿</span>
                    <span style={S.trayText}>
                      <strong style={S.trayName}>{name}</strong>
                      <span style={S.trayLine}>{line}</span>
                      {entry.absorbed.length > 0 && (
                        <span style={S.trayLine}>includes {entry.absorbed.join(", ")}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      style={S.trayReturn(edge)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => returnEntry(entry.unitId)}
                      aria-label={`Return ${name} to where it lives`}
                    >
                      Return
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        );
      })()}

      {proposal && (() => {
        const close = () => setProposal(null);
        if (proposal.kind === "merge") {
          const from = arrangedTree.units.get(proposal.fromId)?.name ?? "This unit";
          const into = arrangedTree.units.get(proposal.intoId)?.name ?? "that unit";
          const impact = branchImpact(arrangedTree, proposal.fromId, (id) => kindById.get(id));
          const copy = mergeCopy(from, into, impact);
          return (
            <div style={S.modalBackdrop} role="presentation" onClick={close}>
              <section
                style={S.confirmCard}
                role="dialog"
                aria-modal="true"
                aria-labelledby="proposal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div style={S.panelKicker}>relationship change · nothing has changed</div>
                <div id="proposal-title" style={S.panelTitle}>Move or merge &ldquo;{from}&rdquo; with &ldquo;{into}&rdquo;?</div>
                <p style={S.confirmCopy}>{copy.body}</p>
                <p style={S.confirmCopy}>
                  <strong>Reparent branch</strong> moves {from} and everything below it under {into}; it does not combine the two units.
                </p>
                <p style={S.confirmNote}>
                  Merging isn&rsquo;t switched on yet: what happens to both units&rsquo; own people, and who leads the
                  merged unit, still need deciding. So this can&rsquo;t be completed here.
                </p>
                <div style={S.confirmActions}>
                  <button
                    type="button"
                    style={S.confirmPrimary(false)}
                    onClick={() => confirmReparent(proposal.fromId, proposal.intoId)}
                  >
                    Reparent branch
                  </button>
                  <button type="button" style={S.confirmPrimary(true)} disabled title="Needs a product decision first">
                    Merge entire branch
                  </button>
                  <button type="button" style={S.confirmSecondary} onClick={close} autoFocus>
                    Cancel
                  </button>
                </div>
              </section>
            </div>
          );
        }
        if (proposal.kind === "reparent") {
          const from = arrangedTree.units.get(proposal.fromId)?.name ?? "This branch";
          const parent = arrangedTree.units.get(proposal.parentId)?.name ?? "that unit";
          const impact = branchImpact(arrangedTree, proposal.fromId, (id) => kindById.get(id));
          const below = impact.childUnits + impact.teams;
          return (
            <div style={S.modalBackdrop} role="presentation" onClick={close}>
              <section
                style={S.confirmCard}
                role="dialog"
                aria-modal="true"
                aria-labelledby="proposal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div style={S.panelKicker}>reporting change · nothing has changed</div>
                <div id="proposal-title" style={S.panelTitle}>Move {from} under {parent}?</div>
                <p style={S.confirmCopy}>
                  {from} and everything below it will move together under {parent}.
                </p>
                <p style={S.confirmNote}>
                  {below > 0 ? `${below} ${below === 1 ? "unit" : "units"} below this branch and ` : ""}
                  {impact.people} {impact.people === 1 ? "person" : "people"} will remain together.
                </p>
                <div style={S.confirmActions}>
                  <button type="button" style={S.confirmSecondary} onClick={close} autoFocus>
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={S.confirmPrimary(false)}
                    onClick={() => confirmReparent(proposal.fromId, proposal.parentId)}
                  >
                    Move branch
                  </button>
                </div>
              </section>
            </div>
          );
        }
        const seat = scene.seatById.get(proposal.seatId);
        const person = seat?.name ?? "This person";
        const fromTeam = seat ? arrangedTree.units.get(seat.unitId)?.name : undefined;
        const toTeam = arrangedTree.units.get(proposal.toUnitId)?.name ?? "that team";
        return (
          <div style={S.modalBackdrop} role="presentation" onClick={close}>
            <section
              style={S.confirmCard}
              role="dialog"
              aria-modal="true"
              aria-labelledby="proposal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div style={S.panelKicker}>relationship change · nothing has changed</div>
              <div id="proposal-title" style={S.panelTitle}>Move {person} to {toTeam}?</div>
              <p style={S.confirmCopy}>
                {person} will show on {toTeam} on this map{fromTeam ? `, instead of ${fromTeam}` : ""}.
              </p>
              <p style={S.confirmNote}>
                This changes the map only. Their team membership in People and Teams stays as it is.
              </p>
              <div style={S.confirmActions}>
                <button type="button" style={S.confirmSecondary} onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  style={S.confirmPrimary(false)}
                  onClick={acceptMove}
                  autoFocus
                >
                  Move on this map
                </button>
              </div>
            </section>
          </div>
        );
      })()}

      {hover && (
        <OrbitalHoverCard
          hover={hover}
          vocabulary={vocabulary}
          scene={scene}
          unitRings={unitRings}
          seatRings={seatRings}
          vitals={vitals}
          boards={boards}
        />
      )}

      {openWork && (
        <aside style={S.panel}>
          <div style={S.panelHead}>
            <div>
              <div style={S.panelKicker}>work item</div>
              <div style={S.panelTitle}>{openWork.task.title}</div>
            </div>
            <button type="button" style={S.panelClose} onClick={() => setOpenWork(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            <span
              style={{
                ...S.hoverTag,
                background: WORK_STATUS_FILL[openWork.task.status],
                color: C.white,
              }}
            >
              {openWork.task.status.replace("_", " ")}
            </span>
            <span style={S.hoverTag}>{openWork.task.points} pts</span>
            <span style={S.hoverTag}>{openWork.task.tag}</span>
            <span style={S.hoverTag}>{openWork.task.priority}</span>
          </div>
          <div style={{ ...S.hoverStat, marginTop: 14 }}>
            <span>assigned to</span>
            <strong>{openWork.seat.name}</strong>
          </div>
          {openWork.task.value !== null ? (
            <div style={S.hoverStat}>
              <span>projected value</span>
              <strong style={{ color: C.ok }}>{money(openWork.task.value)}</strong>
            </div>
          ) : (
            <div style={{ ...S.hoverSub, marginTop: 8, fontStyle: "italic", lineHeight: 1.4 }}>
              {openWork.task.essentialNote}
            </div>
          )}
          <button
            type="button"
            style={S.panelAction}
            onClick={() => {
              const seat = openWork.seat;
              if (!seat.personId) return;
              setOpenBoard({ id: seat.personId, name: seat.name, title: seat.role });
              setOpenWork(null);
            }}
            disabled={!openWork.seat.personId}
          >
            Open {openWork.seat.name.split(" ")[0]}&rsquo;s board →
          </button>
          <div style={S.hoverFootnote}>mock work data — no tracker integration yet</div>
        </aside>
      )}

      {openBoard && (
        <div style={S.boardOverlay}>
          <PersonTaskBoard
            key={openBoard.id}
            person={openBoard}
            accent={C.ink}
            teamNames={boardTeamNames}
            onBack={() => setOpenBoard(null)}
          />
        </div>
      )}

      <div style={S.hud}>
        {LOD_LADDER.map(([id, label]) => (
          <span key={id} style={S.hudItem(tier === id)}>
            {label}
          </span>
        ))}
        <span style={S.hudScale}>{scale.toFixed(2)}×</span>
        <button
          type="button"
          onClick={() => setShowReporting((v) => !v)}
          style={S.hudToggle(showReporting)}
          title="Reporting lines — dotted, shown for whoever you point at"
        >
          reporting
        </button>
      </div>

      <div style={S.controls}>
        {previewGeography && (
          <span role="status" style={S.modeIndicator} title="Dev only: this invented company is drawn the way a large company would be">
            Large-company preview
          </span>
        )}
        <button type="button" style={S.button} onClick={() => frame(worldBounds)} title="Show the whole company">
          Fit
        </button>
        {snapping ? (
          <button
            type="button"
            style={S.button}
            onClick={() => {
              if (activeFocusId) pendingFocusCameraRef.current = "frame";
              setSnapping(false);
            }}
            title="Move nodes and people freely without changing reporting lines"
          >
            Break orbits
          </button>
        ) : (
          <span role="status" style={S.modeIndicator}>Whiteboard mode</span>
        )}
        <button type="button" style={S.button} onClick={resetArrangement} disabled={snapping && !arranged} title="Discard visual placements and restore the calculated orbital layout; company data stays unchanged">
          Tidy up
        </button>
      </div>

      {!activeFocusId && <div style={S.legend}>
        <span>
          <i style={{ ...S.dot, background: C.seatLead }} /> lead
        </span>
        <span>
          <i style={{ ...S.dot, background: C.seat }} /> person
        </span>
        <span>
          <i style={{ ...S.dot, background: "transparent", border: `1.5px dashed ${C.inkSoft}` }} /> open role
        </span>
        <span>
          <i style={{ ...S.dot, background: "transparent", border: `2px solid ${C.risk}` }} /> needs a break
        </span>
        {sampleWork && <span style={S.legendHint}>
          sample rings: {UNIT_RING_LABELS.delivery} · {UNIT_RING_LABELS.sprint} · {UNIT_RING_LABELS.health}
        </span>}
        <span style={S.legendHint}>
          {snapping
            ? local
              ? "drag a unit anywhere its branch fits · it stays where you let go · tap open ground to look closer there"
              : "drag along a ring to adjust placement · tap open ground to look closer there · tidy up restores the calculated map"
            : "move nodes and people freely · visual only · resets on reload or tidy up"}
        </span>
        {!snapping && sessionPlaced > 0 && (
          <span style={S.legendHint}>
            {sessionPlaced === 1 ? "1 free placement" : `${sessionPlaced} free placements`} · not saved
          </span>
        )}
      </div>}
    </div>
  );
}

function snapHint(drag: DragState | null): RenderCtx["snap"] {
  if (!drag) return null;
  if (drag.kind === "unit") {
    const plan = drag.plan;
    if (!plan || plan.kind === "none") return null;
    return {
      kind: "unit",
      unitId: plan.unitId,
      position: plan.position,
      guide: plan.kind === "orbit" ? plan.guide : null,
      parentId: drag.parentId,
    };
  }
  return drag.snap ? { kind: "seat", position: drag.snap.position, unitId: drag.snap.unitId } : null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
const months = (m: number | null) =>
  m === null ? "—" : m < 18 ? `${Math.round(m)} months` : `${(m / 12).toFixed(1)}y`;

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
      <span style={S.meterTrack}>
        <span style={{ ...S.meterFill, width: `${Math.round(Math.min(1, value) * 100)}%`, background: color }} />
      </span>
      <span style={{ font: `500 11px ${FONT}`, color: C.inkSoft, whiteSpace: "nowrap" }}>
        {label} {pct(value)}
      </span>
    </div>
  );
}

function OrbitalUnitCard({
  unit,
  scene,
  rings,
  absoluteDepth,
  activeFocusId,
  companyId,
  onFocus,
  onClose,
}: {
  unit: PlacedUnit;
  scene: OrbitalScene;
  rings?: UnitProgress;
  absoluteDepth: number;
  activeFocusId: string | null;
  companyId: string;
  onFocus: () => void;
  onClose: () => void;
}) {
  const lead = (scene.seatsByUnit.get(unit.id) ?? []).find((seat) => seat.kind === "lead");
  const focused = activeFocusId === unit.id;
  const canFocus = unit.id !== companyId && !focused;
  return (
    <aside style={S.focusCard} aria-label={`${unit.name} details`}>
      <div style={S.panelHead}>
        <div>
          <div style={S.panelKicker}>organisational node · CEO+{absoluteDepth}</div>
          <div style={S.panelTitle}>{unit.name}</div>
        </div>
        <button type="button" style={S.panelClose} onClick={onClose} aria-label="Close unit details">×</button>
      </div>
      {rings && UNIT_RING_KEYS.some((key) => rings[key] !== null) && (
        <div style={{ marginTop: 10 }}>
          {rings.delivery !== null && <Meter label={UNIT_RING_LABELS.delivery} value={rings.delivery} color={C.delivery} />}
          {rings.sprint !== null && <Meter label={UNIT_RING_LABELS.sprint} value={rings.sprint} color={C.sprint} />}
          {rings.health !== null && <Meter label={UNIT_RING_LABELS.health} value={rings.health} color={healthColor(rings.health)} />}
        </div>
      )}
      <div style={{ ...S.hoverSub, marginTop: 10 }}>
        {unit.totalSeats} {unit.totalSeats === 1 ? "person" : "people"} in this branch
        {unit.childIds.length > 0 ? ` · ${unit.childIds.length} direct reports` : ""}
      </div>
      <div style={S.hoverSub}>{lead ? `Led by ${lead.name}` : "No owner"}</div>
      <button type="button" style={S.panelAction} onClick={onFocus} disabled={!canFocus}>
        {focused ? "Current focus" : unit.id === companyId ? "Company centre" : "Focus this node"}
      </button>
    </aside>
  );
}

function OrbitalHoverCard({
  hover,
  vocabulary,
  scene,
  unitRings,
  seatRings,
  vitals,
  boards,
}: {
  hover: HoverState;
  vocabulary: Vocabulary;
  scene: OrbitalScene;
  unitRings: Map<string, UnitProgress>;
  seatRings: Map<string, SeatProgress>;
  vitals: Map<string, PersonVitals>;
  boards: Map<string, MockTask[]>;
}) {
  if (hover.kind === "external") {
    return (
      <div style={{ ...S.hoverCard, left: hover.x, top: hover.y }}>
        <div style={S.hoverName}>{hover.name}</div>
        <div style={S.hoverSub}>{hover.note}</div>
      </div>
    );
  }
  if (hover.kind === "unit") {
    const { unit } = hover;
    const rung =
      unit.depth === 0
        ? "Company"
        : unit.depth === 1
          ? vocabulary.stream.singular
          : unit.depth === 2
            ? vocabulary.team.singular
            : `Rung ${unit.depth}`;
    const seats = scene.seatsByUnit.get(unit.id) ?? [];
    const lead = seats.find((s) => s.kind === "lead");
    const rings = unitRings.get(unit.id);
    return (
      <div style={{ ...S.hoverCard, left: hover.x, top: hover.y }}>
        <div style={S.hoverName}>{unit.name}</div>
        <div style={S.hoverSub}>
          {rung} · CEO+{unit.depth}
        </div>
        {rings && UNIT_RING_KEYS.some((key) => rings[key] !== null) && (
          <div style={{ marginTop: 8 }}>
            {rings.delivery !== null && <Meter label={UNIT_RING_LABELS.delivery} value={rings.delivery} color={C.delivery} />}
            {rings.sprint !== null && <Meter label={UNIT_RING_LABELS.sprint} value={rings.sprint} color={C.sprint} />}
            {rings.health !== null && <Meter label={UNIT_RING_LABELS.health} value={rings.health} color={healthColor(rings.health)} />}
          </div>
        )}
        <div style={{ ...S.hoverSub, marginTop: 8 }}>
          {unit.totalSeats} {unit.totalSeats === 1 ? "person" : "people"} in this branch
          {unit.childIds.length > 0 ? ` · ${unit.childIds.length} below` : ""}
        </div>
        {rings && rings.total > 0 && (
          <div style={S.hoverSub}>
            {rings.done}/{rings.total} work items done
          </div>
        )}
        <div style={{ ...S.hoverSub, fontWeight: lead ? 400 : 700, color: lead ? C.inkSoft : C.alert }}>
          {lead ? `Led by ${lead.name}` : "No owner"}
        </div>
      </div>
    );
  }

  if (hover.kind === "ring") {
    const rings = unitRings.get(hover.unit.id);
    if (!rings) return null;
    const value = rings[hover.ring];
    if (value === null) return null;
    const crowd = (scene.seatsByUnit.get(hover.unit.id) ?? [])
      .map((s) => (s.personId ? vitals.get(s.personId) : undefined))
      .filter((v): v is PersonVitals => !!v);
    const overdue = crowd.filter((v) => v.strain !== "ok").length;
    return (
      <div style={{ ...S.hoverCard, left: hover.x, top: hover.y }}>
        <div style={S.hoverName}>{UNIT_RING_LABELS[hover.ring]}</div>
        <div style={S.hoverSub}>{hover.unit.name}</div>
        <div style={{ ...S.hoverBig, color: hover.ring === "health" ? healthColor(value) : C.ink }}>
          {pct(value)}
        </div>
        {hover.ring === "delivery" && (
          <>
            <div style={S.hoverStat}>
              <span>items done</span>
              <strong>
                {rings.done}/{rings.total}
              </strong>
            </div>
            {/* Sample figures until there's a real work integration. */}
            <div style={S.hoverStat}>
              <span>blocked</span>
              <strong>{rings.total % 4}</strong>
            </div>
            <div style={S.hoverStat}>
              <span>vs last week</span>
              <strong style={{ color: C.ok }}>+6%</strong>
            </div>
          </>
        )}
        {hover.ring === "sprint" && (
          <>
            <div style={S.hoverStat}>
              <span>points moved</span>
              <strong>{pct(value)}</strong>
            </div>
            <div style={S.hoverStat}>
              <span>days left</span>
              <strong>4</strong>
            </div>
            <div style={S.hoverStat}>
              <span>carry-over risk</span>
              <strong>{value < 0.5 ? "high" : "low"}</strong>
            </div>
          </>
        )}
        {hover.ring === "health" && (
          <>
            <div style={S.hoverStat}>
              <span>people</span>
              <strong>{rings.people}</strong>
            </div>
            <div style={S.hoverStat}>
              <span>overdue a break</span>
              <strong style={{ color: overdue > 0 ? C.watch : C.ink }}>{overdue}</strong>
            </div>
            <div style={S.hoverStat}>
              <span>last pulse survey</span>
              <strong>3.9/5</strong>
            </div>
          </>
        )}
        <div style={S.hoverFootnote}>sample data — no work integration yet</div>
      </div>
    );
  }

  if (hover.kind === "torus") {
    const crowd = (scene.seatsByUnit.get(hover.unit.id) ?? []).filter((s) => s.kind !== "lead");
    return (
      <div style={{ ...S.hoverCard, left: hover.x, top: hover.y, width: 250 }}>
        <div style={S.hoverName}>{hover.unit.name}</div>
        <div style={S.hoverSub}>
          {crowd.length} {crowd.length === 1 ? "person" : "people"}
        </div>
        <div style={S.memberGrid}>
          {crowd.map((s) => (
            <span key={s.id} style={S.memberChip}>
              {s.kind === "open" ? "open role" : s.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (hover.kind === "work") {
    const task = boards.get(hover.seat.personId ?? "")?.[hover.index];
    if (!task) return null;
    return (
      <div style={{ ...S.hoverCard, left: hover.x, top: hover.y, width: 225 }}>
        <div style={S.hoverName}>{task.title}</div>
        <div style={S.hoverSub}>{hover.seat.name}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          <span style={{ ...S.hoverTag, background: WORK_STATUS_FILL[task.status], color: C.white }}>
            {task.status.replace("_", " ")}
          </span>
          <span style={S.hoverTag}>{task.points} pts</span>
          <span style={S.hoverTag}>{task.tag}</span>
        </div>
        <div style={S.hoverFootnote}>click to open</div>
      </div>
    );
  }

  const { seat } = hover;
  const unit = scene.unitById.get(seat.unitId);
  const progress = seatRings.get(seat.id);
  const v = seat.personId ? vitals.get(seat.personId) : undefined;
  return (
    <div style={{ ...S.hoverCard, left: hover.x, top: hover.y, width: 235 }}>
      <div style={S.hoverName}>{seat.kind === "open" ? "Open role" : seat.name}</div>
      <div style={S.hoverSub}>{seat.role ?? "—"}</div>
      <div style={{ ...S.hoverSub, marginTop: 6 }}>{unit ? `${unit.name} · CEO+${unit.depth}` : ""}</div>
      {progress && progress.total > 0 && (
        <div style={S.hoverStat}>
          <span>stories</span>
          <strong>
            {progress.done}/{progress.total}
          </strong>
        </div>
      )}
      {v && (
        <>
          <div style={S.hoverStat}>
            <span>tenure</span>
            <strong>{months(v.tenureMonths)}</strong>
          </div>
          <div style={S.hoverStat}>
            <span>since last break</span>
            <strong style={{ color: v.strain === "ok" ? C.ink : healthColor(v.wellbeing) }}>
              {months(v.monthsSinceVacation)}
            </strong>
          </div>
          <div style={S.hoverStat}>
            <span>allocated</span>
            <strong style={{ color: v.allocationPct > 100 ? C.risk : C.ink }}>{v.allocationPct}%</strong>
          </div>
          {v.costPerMonth !== null && (
            <div style={S.hoverStat}>
              <span>cost to business</span>
              <strong>{money(v.costPerMonth)}pcm</strong>
            </div>
          )}
          {v.strain !== "ok" && (
            <div style={{ ...S.hoverFlag, color: healthColor(v.wellbeing) }}>
              {v.strain === "risk" ? "RISK OF BURNOUT" : "WATCH FOR BURNOUT"}
            </div>
          )}
        </>
      )}
      {seat.shared && <div style={{ ...S.hoverSub, marginTop: 6 }}>Shared across teams</div>}
    </div>
  );
}

const S = {
  breadcrumb: {
    position: "absolute" as const,
    left: 16,
    top: 16,
    zIndex: 8,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 4,
    maxWidth: "calc(100% - 350px)",
  },
  crumbWrap: { display: "inline-flex", alignItems: "center", gap: 4 },
  tray: (edge: "right" | "bottom", hot: boolean, empty: boolean) => ({
    position: "absolute" as const,
    zIndex: 11,
    ...(edge === "right"
      ? { right: 12, bottom: 72, width: 240, maxHeight: "min(52%, 420px)" }
      : { left: 12, right: 12, bottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)" }),
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: 10,
    borderRadius: 16,
    background: hot ? "rgba(236,245,252,0.97)" : "rgba(255,255,255,0.96)",
    border: `1.5px ${empty ? "dashed" : "solid"} ${hot ? C.accent : C.link}`,
    boxShadow: hot ? "0 10px 28px rgba(36,191,219,0.28)" : "0 8px 24px rgba(34,43,88,0.12)",
    font: `500 12px/1.3 ${FONT}`,
    color: C.ink,
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
  }),
  trayHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    font: `700 10px ${FONT}`,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: C.inkSoft,
  },
  trayLink: {
    minHeight: 32,
    padding: "0 8px",
    border: "none",
    background: "transparent",
    color: C.path,
    font: `600 12px ${FONT}`,
    cursor: "pointer",
  },
  trayEmpty: { color: C.inkSoft, padding: "10px 4px" },
  trayList: (edge: "right" | "bottom") => ({
    display: "flex",
    flexDirection: edge === "right" ? ("column" as const) : ("row" as const),
    gap: 8,
    overflow: "auto" as const,
  }),
  trayEntry: (flash: boolean, edge: "right" | "bottom") => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    minWidth: edge === "bottom" ? 240 : undefined,
    padding: "6px 6px 6px 8px",
    borderRadius: 12,
    background: C.white,
    border: `1px solid ${flash ? C.path : C.link}`,
    boxShadow: flash ? `0 0 0 3px rgba(118,90,232,0.25)` : "none",
    cursor: "grab",
    touchAction: "none" as const,
    userSelect: "none" as const,
  }),
  trayGrip: { color: C.inkSoft, fontSize: 16, lineHeight: 1 },
  trayText: { display: "flex", flexDirection: "column" as const, minWidth: 0, flex: 1 },
  trayName: { font: `600 13px ${FONT}`, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  trayLine: { color: C.inkSoft, fontSize: 11, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" },
  trayReturn: (edge: "right" | "bottom") => ({
    minHeight: edge === "bottom" ? 44 : 36,
    minWidth: 60,
    padding: "0 10px",
    borderRadius: 10,
    border: `1px solid ${C.link}`,
    background: "rgba(255,255,255,0.9)",
    color: C.ink,
    font: `600 12px ${FONT}`,
    cursor: "pointer",
  }),
  notice: {
    position: "absolute" as const,
    left: "50%",
    bottom: 72,
    transform: "translateX(-50%)",
    zIndex: 12,
    maxWidth: "min(520px, calc(100% - 32px))",
    padding: "10px 14px",
    borderRadius: 12,
    background: C.ink,
    color: C.white,
    font: `500 13px/1.4 ${FONT}`,
    boxShadow: "0 8px 24px rgba(34,43,88,0.18)",
    pointerEvents: "none" as const,
  },
  /** The dependable way out of focus, big enough for a thumb. */
  crumbClose: {
    width: 40,
    height: 40,
    marginRight: 4,
    border: `1px solid ${C.link}`,
    borderRadius: 999,
    background: "rgba(255,255,255,0.95)",
    color: C.ink,
    font: `500 20px/1 ${FONT}`,
    cursor: "pointer",
  },
  crumbDivider: { color: C.inkSoft, opacity: 0.45, font: `500 12px ${FONT}` },
  crumb: (active: boolean) => ({
    maxWidth: 170,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    border: `1px solid ${active ? C.ink : C.link}`,
    borderRadius: 999,
    padding: "5px 9px",
    background: active ? C.ink : "rgba(255,255,255,0.9)",
    color: active ? C.white : C.inkSoft,
    font: `600 11px ${FONT}`,
    cursor: "pointer",
  }),
  focusCard: {
    position: "absolute" as const,
    right: 16,
    top: 64,
    zIndex: 9,
    width: 270,
    padding: 15,
    borderRadius: 14,
    background: "rgba(255,255,255,0.97)",
    border: `1px solid ${C.link}`,
    boxShadow: "0 14px 36px rgba(34,39,46,0.14)",
  },
  modalBackdrop: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 40,
    display: "grid",
    placeItems: "center",
    background: "rgba(34,39,46,0.22)",
    backdropFilter: "blur(3px)",
  },
  confirmCard: {
    width: 380,
    maxWidth: "calc(100% - 32px)",
    padding: 20,
    borderRadius: 16,
    background: C.white,
    border: `1px solid ${C.link}`,
    boxShadow: "0 20px 60px rgba(34,39,46,0.22)",
  },
  confirmCopy: { margin: "10px 0 0", font: `400 13px/1.5 ${FONT}`, color: C.inkSoft },
  confirmNote: {
    margin: "12px 0 0",
    padding: "8px 10px",
    borderRadius: 10,
    background: C.track,
    font: `400 12px/1.45 ${FONT}`,
    color: C.ink,
  },
  confirmActions: { display: "flex", gap: 8, marginTop: 18 },
  confirmSecondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    border: `1px solid ${C.link}`,
    background: C.white,
    color: C.ink,
    font: `600 13px ${FONT}`,
    cursor: "pointer",
  },
  confirmPrimary: (disabled: boolean) => ({
    flex: 1.4,
    minHeight: 44,
    borderRadius: 10,
    border: "none",
    background: disabled ? C.track : C.ink,
    color: disabled ? C.inkSoft : C.white,
    font: `600 13px ${FONT}`,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  hud: {
    position: "absolute" as const,
    left: "50%",
    transform: "translateX(-50%)",
    bottom: 16,
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "7px 12px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.88)",
    border: `1px solid ${C.link}`,
    font: `500 12px ${FONT}`,
    color: C.inkSoft,
    backdropFilter: "blur(6px)",
  },
  hudItem: (on: boolean) => ({
    color: on ? C.ink : C.inkSoft,
    fontWeight: on ? 700 : 500,
    opacity: on ? 1 : 0.55,
  }),
  hudScale: { color: C.inkSoft, fontVariantNumeric: "tabular-nums" as const, marginLeft: 4 },
  hudToggle: (on: boolean) => ({
    marginLeft: 4,
    padding: "3px 8px",
    borderRadius: 999,
    border: `1px ${on ? "solid" : "dashed"} ${C.link}`,
    background: on ? C.paper : "transparent",
    font: `500 11px ${FONT}`,
    color: on ? C.ink : C.inkSoft,
    cursor: "pointer",
    opacity: on ? 1 : 0.7,
  }),
  controls: {
    position: "absolute" as const,
    right: 16,
    bottom: 16,
    display: "flex",
    gap: 8,
  },
  button: {
    padding: "7px 12px",
    borderRadius: 8,
    border: `1px solid ${C.link}`,
    background: "rgba(255,255,255,0.9)",
    font: `500 12px ${FONT}`,
    color: C.ink,
    cursor: "pointer",
  },
  modeIndicator: {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 12px",
    borderRadius: 8,
    background: C.ink,
    font: `500 12px ${FONT}`,
    color: C.white,
  },
  legend: {
    position: "absolute" as const,
    left: 16,
    top: 16,
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px 14px",
    alignItems: "center",
    maxWidth: 430,
    padding: "8px 12px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.82)",
    border: `1px solid ${C.link}`,
    font: `500 11.5px ${FONT}`,
    color: C.inkSoft,
  },
  legendHint: { opacity: 0.75, fontStyle: "italic" as const, flexBasis: "100%" as const },
  dot: {
    display: "inline-block",
    width: 9,
    height: 9,
    borderRadius: "50%",
    marginRight: 5,
    verticalAlign: "middle" as const,
  },
  hoverCard: {
    position: "absolute" as const,
    width: 235,
    padding: "11px 13px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.97)",
    border: `1px solid ${C.link}`,
    boxShadow: "0 12px 30px rgba(34,39,46,0.13)",
    pointerEvents: "none" as const,
    zIndex: 5,
  },
  hoverName: { font: `700 14px ${FONT}`, color: C.ink },
  hoverSub: { font: `400 12px ${FONT}`, color: C.inkSoft, marginTop: 2 },
  hoverStat: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    font: `400 12px ${FONT}`,
    color: C.inkSoft,
    marginTop: 4,
  },
  panel: {
    position: "absolute" as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: 300,
    // Clears the page's view switcher, which floats above this.
    padding: "58px 20px 18px",
    background: "rgba(255,255,255,0.97)",
    borderLeft: `1px solid ${C.link}`,
    boxShadow: "-14px 0 34px rgba(34,39,46,0.10)",
    zIndex: 6,
    overflowY: "auto" as const,
  },
  panelHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  panelKicker: {
    font: `600 10.5px ${FONT}`,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    color: C.inkSoft,
  },
  panelTitle: { font: `700 17px ${FONT}`, color: C.ink, marginTop: 4, lineHeight: 1.3 },
  panelClose: {
    border: "none",
    background: "transparent",
    font: `400 22px ${FONT}`,
    color: C.inkSoft,
    cursor: "pointer",
    lineHeight: 1,
    padding: 0,
  },
  panelAction: {
    marginTop: 18,
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "none",
    background: C.ink,
    color: C.white,
    font: `600 12.5px ${FONT}`,
    cursor: "pointer",
  },
  boardOverlay: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 30,
    background: C.paper,
  },
  hoverBig: { font: `700 22px ${FONT}`, marginTop: 6, fontVariantNumeric: "tabular-nums" as const },
  hoverFootnote: {
    marginTop: 8,
    font: `400 10.5px ${FONT}`,
    color: C.inkSoft,
    opacity: 0.7,
    fontStyle: "italic" as const,
  },
  memberGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 4,
    marginTop: 8,
  },
  memberChip: {
    font: `500 11px ${FONT}`,
    color: C.ink,
    background: C.paper,
    borderRadius: 5,
    padding: "3px 6px",
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  },
  hoverTag: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 999,
    background: C.paper,
    font: `500 11px ${FONT}`,
    color: C.inkSoft,
  },
  hoverFlag: {
    marginTop: 8,
    font: `700 11.5px ${FONT}`,
    letterSpacing: 0.6,
  },
  meterTrack: {
    position: "relative" as const,
    display: "inline-block",
    width: 74,
    height: 5,
    borderRadius: 999,
    background: C.track,
    overflow: "hidden" as const,
    flexShrink: 0,
  },
  meterFill: {
    position: "absolute" as const,
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
};
