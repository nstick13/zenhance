"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Konva from "konva";
import { Circle, Group, Layer, Shape, Stage, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Assignment, OrbitalNodeRow, OrgUnit, Person } from "@/lib/db/schema";
import type { Vocabulary } from "@/lib/vocabulary";
import { clearOrbitalNodes, saveOrbitalNodes } from "@/lib/data/actions";
import { tasksForPerson, type MockTask } from "@/lib/mock/personTasks";
import {
  applyOverrides,
  buildOrbitalTree,
  type OrbitalTree,
  type StructureOverrides,
} from "@/lib/orbital/model";
import {
  layoutOrbital,
  type OrbitalScene,
  type PlacedSeat,
  type PlacedUnit,
} from "@/lib/orbital/layout";
import { descendantIds, snapSeat, snapUnitOnRing, type SeatSnap, type UnitSnap } from "@/lib/orbital/snap";
import { MotionStore, type MotionTarget } from "@/lib/orbital/motion";
import { focusOrbital } from "@/lib/orbital/focus";
import { applyPositionOffsets } from "@/lib/orbital/position";
import {
  SEAT_RADIUS,
  WORK_RADIUS,
  angleDelta,
  angularStep,
  normalizeAngle,
  polar,
  type Point,
} from "@/lib/orbital/geometry";
import { LOD_LADDER, revealAt, smoothstep, tierAt, unitLabelVisible, unitRingReveal } from "@/lib/orbital/lod";
import PersonTaskBoard from "@/components/viz/PersonTaskBoard";
import {
  UNIT_RING_KEYS,
  UNIT_RING_LABELS,
  personVitals,
  seatProgress,
  unitProgress,
  type PersonVitals,
  type SeatProgress,
  type UnitProgress,
  type UnitRingKey,
} from "@/lib/orbital/progress";
import { C, FONT, WORK_STATUS_FILL, healthColor } from "./theme";
import {
  RIPPLE_MS,
  paintExternalFlows,
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
 * - **Drag reads the map, not a grid**: in normal orbits, angle changes visual
 *   placement and radius may propose a level change; neither silently edits
 *   reporting structure. Breaking orbits makes all placement visual-only.
 */

type Props = {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  vocabulary: Vocabulary;
  savedNodes: OrbitalNodeRow[];
};

const MAX_SCALE = 12;

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
  | { kind: "unit"; id: string; origin: Point; current: Point; moved: Set<string>; snap: UnitSnap | null }
  | { kind: "seat"; id: string; origin: Point; current: Point; snap: SeatSnap | null };

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

type CameraSnapshot = { scale: number; x: number; y: number };
type FocusFrame = { unitId: string };

const uid = (id: string) => `u:${id}`;
const sid = (id: string) => `s:${id}`;

export function OrbitalMap({ people, units, assignments, vocabulary, savedNodes }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const bgLayerRef = useRef<Konva.Layer | null>(null);
  const linkLayerRef = useRef<Konva.Layer | null>(null);
  const nodeLayerRef = useRef<Konva.Layer | null>(null);

  // A zero-sized measurement (a container not yet laid out) gives Konva a
  // zero-sized canvas, which throws on first draw. Fall back to a viewport.
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [scale, setScale] = useState(0.4);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(
    null,
  );
  const [showReporting, setShowReporting] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [openWork, setOpenWork] = useState<{ seat: PlacedSeat; task: MockTask } | null>(null);
  /** Route inspection is deliberately separate from semantic focus: a click
   * says “show me how this connects”; double-click / Focus says “make this
   * the centre”. */
  const [routeUnitId, setRouteUnitId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [focusFrames, setFocusFrames] = useState<FocusFrame[]>([]);
  const activeFocusId = focusFrames[focusFrames.length - 1]?.unitId ?? null;
  const [pendingLevelChange, setPendingLevelChange] = useState<{ unitId: string; from: number; to: number } | null>(null);
  const [openBoard, setOpenBoard] = useState<{ id: string; name: string; title: string | null } | null>(
    null,
  );
  const [, startTransition] = useTransition();

  // --- saved arrangement ---------------------------------------------------
  const seeded = useMemo(() => {
    const unitParent = new Map<string, string>();
    const seatUnit = new Map<string, string>();
    const angles = new Map<string, number>();
    for (const row of savedNodes) {
      if (row.nodeType === "unit") {
        if (row.angle != null) {
          const a = Number(row.angle);
          if (Number.isFinite(a)) angles.set(row.nodeId, a);
        }
        if (row.parentId) unitParent.set(row.nodeId, row.parentId);
      } else if (row.parentId) {
        seatUnit.set(row.nodeId, row.parentId);
      }
    }
    return { overrides: { unitParent, seatUnit } as StructureOverrides, angles };
  }, [savedNodes]);

  const [overrides, setOverrides] = useState<StructureOverrides>(seeded.overrides);
  const [angleOverrides, setAngleOverrides] = useState<Map<string, number>>(seeded.angles);
  const [positionRevision, setPositionRevision] = useState(0);

  const scaleRef = useRef(scale);
  const dragRef = useRef<DragState | null>(null);
  const sceneRef = useRef<OrbitalScene | null>(null);
  const interactionSceneRef = useRef<OrbitalScene | null>(null);
  const targetsRef = useRef<Map<string, MotionTarget>>(new Map());
  const motionRef = useRef(new MotionStore());
  const nodeRefs = useRef(new Map<string, Konva.Group>());
  const ripplesRef = useRef<Ripple[]>([]);
  const dirtyRef = useRef(true);
  const cameraRafRef = useRef<number | null>(null);
  const cameraTouched = useRef(false);
  const pendingFocusCameraRef = useRef<CameraSnapshot | "frame" | null>(null);
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
  const renderRef = useRef<RenderCtx | null>(null);
  const focusBranchRef = useRef<ReadonlySet<string> | null>(null);
  const companyRef = useRef<string | null>(null);
  const unitOffsetsRef = useRef<Map<string, Point>>(new Map());
  const seatOffsetsRef = useRef<Map<string, Point>>(new Map());

  // --- the work each person is carrying ------------------------------------
  // Whole boards, not just what's in flight: the completion ring is only
  // meaningful against everything someone holds, and it's what makes the
  // texture of work read at a glance.
  const boards = useMemo(() => {
    const tags = units.map((u) => u.name);
    const map = new Map<string, MockTask[]>();
    for (const p of people) map.set(p.id, tasksForPerson(p, tags));
    return map;
  }, [people, units]);

  const allocationByPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assignments) {
      if (!a.personId || a.isOpenRole) continue;
      map.set(a.personId, (map.get(a.personId) ?? 0) + (a.allocationPct ?? 0));
    }
    return map;
  }, [assignments]);

  const vitals = useMemo(() => {
    const now = new Date();
    const map = new Map<string, PersonVitals>();
    for (const p of people) {
      map.set(p.id, personVitals(p, allocationByPerson.get(p.id) ?? 100, now));
    }
    return map;
  }, [people, allocationByPerson]);

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
        { workCountFor: (id) => boards.get(id)?.length ?? 0 },
      ),
    [units, people, assignments, boards],
  );

  const arrangedTree = useMemo(() => applyOverrides(baseTree, overrides), [baseTree, overrides]);
  const masterScene = useMemo(
    () => layoutOrbital(arrangedTree, { angleOverrides }),
    [arrangedTree, angleOverrides],
  );
  const focusedView = useMemo(
    () => activeFocusId ? focusOrbital(arrangedTree, masterScene, activeFocusId, { angleOverrides }) : null,
    [arrangedTree, masterScene, activeFocusId, angleOverrides],
  );
  // Semantic focus only redraws the branch into a local orbital system while
  // snaps are on. With snaps off, user-authored geography is intentional: we
  // centre the camera on the focused node but never pull its neighbours in.
  const projectedScene = focusedView && snapping ? focusedView.scene : masterScene;
  const projectedInteractionScene = focusedView && snapping ? focusedView.interactionScene : projectedScene;
  const scene = useMemo(
    () => applyPositionOffsets(projectedScene, unitOffsetsRef.current, seatOffsetsRef.current),
    [projectedScene, positionRevision],
  );
  const interactionScene = useMemo(
    () => applyPositionOffsets(projectedInteractionScene, unitOffsetsRef.current, seatOffsetsRef.current),
    [projectedInteractionScene, positionRevision],
  );

  useEffect(() => {
    // A company switch can invalidate a focus history. Failing closed to the
    // whole company is calmer than leaving a breadcrumb to a missing unit.
    if (companyRef.current !== arrangedTree.rootId) {
      companyRef.current = arrangedTree.rootId;
      cameraTouched.current = false;
      setFocusFrames([]);
      setSelectedUnitId(null);
      setRouteUnitId(null);
      setHover(null);
    } else if (activeFocusId && !arrangedTree.units.has(activeFocusId)) {
      setFocusFrames([]);
    }
  }, [activeFocusId, arrangedTree]);

  const focusBreadcrumb = focusedView?.breadcrumb ?? [];

  const focusBranch = focusedView?.branchIds ?? null;
  const selectedUnit = selectedUnitId ? scene.unitById.get(selectedUnitId) : undefined;

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
  const seatRings = useMemo(() => {
    const map = new Map<string, SeatProgress>();
    for (const seat of scene.seats) {
      map.set(seat.id, seatProgress(seat.personId ? (boards.get(seat.personId) ?? []) : []));
    }
    return map;
  }, [scene, boards]);

  const workStatus = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const seat of scene.seats) {
      const tasks = seat.personId ? (boards.get(seat.personId) ?? []) : [];
      map.set(
        seat.id,
        tasks.map((t) => t.status),
      );
    }
    return map;
  }, [scene, boards]);

  /** A unit's rings cover its whole branch, not just the people sitting on
   *  it — "overall work item completedness for an entire team". */
  const unitRings = useMemo(() => {
    const map = new Map<string, UnitProgress>();
    const gather = (unitId: string): { tasks: MockTask[]; wellbeing: number }[] => {
      const unit = scene.unitById.get(unitId);
      if (!unit) return [];
      const own = (scene.seatsByUnit.get(unitId) ?? [])
        .filter((s) => s.personId)
        .map((s) => ({
          tasks: boards.get(s.personId!) ?? [],
          wellbeing: vitals.get(s.personId!)?.wellbeing ?? 1,
        }));
      return unit.childIds.reduce<{ tasks: MockTask[]; wellbeing: number }[]>(
        (acc, childId) => acc.concat(gather(childId)),
        own,
      );
    };
    for (const unit of scene.units) map.set(unit.id, unitProgress(gather(unit.id)));
    return map;
  }, [scene, boards, vitals]);

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

  const totalPayroll = moneyByUnit.get(scene.units.find((u) => !u.parentId)?.id ?? "") ?? 0;
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

  const reveal = useMemo(() => revealAt(scale), [scale]);
  const tier = tierAt(reveal);
  useEffect(() => {
    showReportingRef.current = showReporting;
    dirtyRef.current = true;
  }, [showReporting]);
  const outerRadius = scene.extent + 60;
  const worldRadius = activeFocusId ? outerRadius : outerRadius + EXTERNAL_GAP + EXTERNAL_R * 2;

  const externals = useMemo(
    (): (ExternalFlow & { note: string; angle: number })[] =>
      (activeFocusId ? [] : EXTERNALS).map((e) => {
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
    [activeFocusId, outerRadius, totalPayroll],
  );

  // Units used to be culled below a fixed zoom, which quietly hid everything
  // past CEO+1 on a map whose whole structural range sits *under* that zoom —
  // half of why Northwind read as empty. Cull by what a node is actually worth
  // drawing instead: too small to see is the only reason to leave one out.
  const visibleUnits = scene.units;

  // People appear at 1.75x; below that only the lead is drawn, so the seat
  // list has to stay mounted for it even when the crowd is gone.
  const showSeats = reveal.people > 0.015 || reveal.lead > 0.015;

  /**
   * Only mount the seats that are actually on screen. A 2,400-person org has
   * 2,400+ seats, and at the zoom where people are drawn you can see a few
   * dozen of them — mounting the rest is pure cost. The box is deliberately
   * generous and updated on a throttle, so a fast pan never outruns it.
   */
  const seatsInView = useMemo(() => {
    if (!showSeats) return [];
    const crowd = reveal.people > 0.015;
    const pool = crowd ? scene.seats : scene.seats.filter((s) => s.kind === "lead");
    if (!viewBox || pool.length < 220) return pool;
    return pool.filter(
      (s) => s.x >= viewBox.minX && s.x <= viewBox.maxX && s.y >= viewBox.minY && s.y <= viewBox.maxY,
    );
  }, [scene, showSeats, reveal.people, viewBox]);

  // --- motion targets ------------------------------------------------------
  const buildTargets = useCallback((s: OrbitalScene, drag: DragState | null) => {
    const targets = new Map<string, MotionTarget>();
    const delta =
      drag?.kind === "unit"
        ? { x: drag.current.x - drag.origin.x, y: drag.current.y - drag.origin.y }
        : null;
    const carried = drag?.kind === "unit" ? drag.moved : null;

    // Who has to shuffle aside to make room for the landing.
    const unitSnap = drag?.kind === "unit" ? drag.snap : null;
    const seatSnap = drag?.kind === "seat" ? drag.snap : null;
    const yieldBand = unitSnap ? s.bands.find((b) => b.depth === unitSnap.depth)?.radius : undefined;
    const yieldStep = yieldBand
      ? angularStep(s.units.find((u) => u.depth === unitSnap!.depth)?.r ?? 40, 8, yieldBand)
      : 0;

    for (const u of s.units) {
      const towed = carried?.has(u.id) ?? false;
      let x = u.x;
      let y = u.y;
      if (towed && delta) {
        x += delta.x;
        y += delta.y;
      } else if (unitSnap && yieldBand && u.depth === unitSnap.depth && !carried?.has(u.id)) {
        const offset = angleDelta(unitSnap.angle, u.angle);
        const influence = 1 - smoothstep(0, yieldStep * YIELD_REACH, Math.abs(offset));
        if (influence > 0.001) {
          const shifted = u.angle + (offset >= 0 ? 1 : -1) * yieldStep * YIELD_PUSH * influence;
          const at = polar(shifted, yieldBand);
          x = at.x;
          y = at.y;
        }
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
      if (towed && delta) {
        x += delta.x;
        y += delta.y;
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
    focusBranchRef.current = focusBranch;
    targetsRef.current = buildTargets(scene, dragRef.current);
    motionRef.current.prune(new Set(targetsRef.current.keys()));
    dirtyRef.current = true;
  }, [scene, interactionScene, focusBranch, buildTargets]);

  const animatedAt = useCallback((key: string, fallback: Point): Point => {
    const state = motionRef.current.peek(key);
    return state ? { x: state.x.value, y: state.y.value } : fallback;
  }, []);

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
      scale: scaleRef.current,
      now: performance.now(),
    };
    dirtyRef.current = true;
  }, [
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

      motionRef.current.step(dt, targetsRef.current);
      const drag = dragRef.current;
      ctx.draggedUnitId = drag?.kind === "unit" ? drag.id : null;
      const peopleOut = live.people;
      const seatScale = peopleOut * peopleOut * (3 - 2 * peopleOut);

      for (const [key, node] of nodeRefs.current) {
        const isSeat = key.startsWith("s:");
        const held = drag && key === (drag.kind === "unit" ? uid(drag.id) : sid(drag.id));
        const state = motionRef.current.peek(key);
        if (!state) continue;

        if (held) {
          // The node under the cursor is Konva's to position, not ours.
          motionRef.current.place(key, node.x(), node.y());
        } else {
          node.position({ x: state.x.value, y: state.y.value });
        }

        if (isSeat) {
          const seat = sceneRef.current?.seatById.get(key.slice(2));
          // Below the people band the lead is the last one standing: it is
          // how you find the node's point of contact at a glance.
          const presence = seat?.kind === "lead" ? Math.max(peopleOut, live.lead) : peopleOut;
          const s = state.scale.value * (seat?.kind === "lead" ? Math.max(seatScale, live.lead) : seatScale);
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
  }, []);

  // --- camera --------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 1440, h: el.clientHeight || 900 });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  /** Recompute the culling box, at most every 120ms — mounting and unmounting
   *  hundreds of seats on every mousemove would cost more than it saves. */
  const viewClock = useRef(0);
  const refreshViewBox = useCallback(
    (force = false) => {
      const stage = stageRef.current;
      if (!stage) return;
      const now = performance.now();
      if (!force && now - viewClock.current < 120) return;
      viewClock.current = now;
      const k = stage.scaleX() || 1;
      const w = stage.width() / k;
      const h = stage.height() / k;
      const padX = w * 0.6;
      const padY = h * 0.6;
      const minX = -stage.x() / k - padX;
      const minY = -stage.y() / k - padY;
      setViewBox({ minX, minY, maxX: minX + w + padX * 2, maxY: minY + h + padY * 2 });
    },
    [],
  );

  // How far out you're allowed to go has to depend on the org: a 2,500-person
  // map is forty thousand units across, and a fixed floor would strand you
  // zoomed into the middle of it, unable to see the whole thing.
  const minScale = useMemo(
    () => Math.min(0.06, ((Math.min(size.w, size.h) || 600) / (worldRadius * 2 * 1.06)) * 0.85),
    [size, worldRadius],
  );
  const minScaleRef = useRef(minScale);
  useEffect(() => {
    minScaleRef.current = minScale;
  }, [minScale]);

  const applyCamera = useCallback((next: number, centre: Point, screen: Point) => {
    const stage = stageRef.current;
    if (!stage) return;
    const clamped = Math.min(MAX_SCALE, Math.max(minScaleRef.current, next));
    stage.scale({ x: clamped, y: clamped });
    stage.position({ x: screen.x - centre.x * clamped, y: screen.y - centre.y * clamped });
    stage.batchDraw();
    scaleRef.current = clamped;
    dirtyRef.current = true;
    // React only needs to know when the change is big enough to matter to a
    // label or the HUD; the morph itself reads the stage directly.
    setScale((prev) => (Math.abs(Math.log(clamped / prev)) > 0.03 ? clamped : prev));
    refreshViewBox(true);
  }, [refreshViewBox]);

  const frame = useCallback(
    (radius: number, centre: Point = { x: 0, y: 0 }) => {
      const fit = Math.min(size.w, size.h) / (radius * 2 * 1.06);
      applyCamera(fit, centre, { x: size.w / 2, y: size.h / 2 });
    },
    [size, applyCamera],
  );

  const currentCamera = useCallback((): CameraSnapshot => {
    const stage = stageRef.current;
    return stage
      ? { scale: stage.scaleX(), x: stage.x(), y: stage.y() }
      : { scale: scaleRef.current, x: size.w / 2, y: size.h / 2 };
  }, [size]);

  const animateCameraTo = useCallback((target: CameraSnapshot) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (cameraRafRef.current !== null) cancelAnimationFrame(cameraRafRef.current);
    const start = currentCamera();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : 560;
    const born = performance.now();
    const tick = (now: number) => {
      const raw = duration === 0 ? 1 : Math.min(1, (now - born) / duration);
      const t = 1 - Math.pow(1 - raw, 3);
      const next = {
        scale: start.scale + (target.scale - start.scale) * t,
        x: start.x + (target.x - start.x) * t,
        y: start.y + (target.y - start.y) * t,
      };
      stage.scale({ x: next.scale, y: next.scale });
      stage.position({ x: next.x, y: next.y });
      scaleRef.current = next.scale;
      dirtyRef.current = true;
      stage.batchDraw();
      if (raw < 1) {
        cameraRafRef.current = requestAnimationFrame(tick);
      } else {
        cameraRafRef.current = null;
        setScale(next.scale);
        refreshViewBox(true);
      }
    };
    cameraRafRef.current = requestAnimationFrame(tick);
  }, [currentCamera, refreshViewBox]);

  const animateFrame = useCallback((radius: number, centre: Point = { x: 0, y: 0 }) => {
    const fit = Math.min(size.w, size.h) / (radius * 2 * 1.06);
    const next = Math.min(MAX_SCALE, Math.max(minScaleRef.current, fit));
    animateCameraTo({
      scale: next,
      x: size.w / 2 - centre.x * next,
      y: size.h / 2 - centre.y * next,
    });
  }, [size, animateCameraTo]);

  useEffect(() => () => {
    if (cameraRafRef.current !== null) cancelAnimationFrame(cameraRafRef.current);
  }, []);

  useEffect(() => {
    const pending = pendingFocusCameraRef.current;
    if (!pending) return;
    pendingFocusCameraRef.current = null;
    if (pending === "frame") {
      // Focus is a local decision view, not “fit this entire subtree”. On a
      // twelve-rung company the latter immediately recreates the lost-context
      // problem inside the branch. Frame the centre plus two reporting rings;
      // deeper structure remains present and can be approached normally.
      if (snapping) {
        const localBand = scene.bands[Math.min(2, scene.bands.length - 1)];
        animateFrame((localBand?.outer ?? scene.extent) + 70);
      } else {
        const focused = activeFocusId ? scene.unitById.get(activeFocusId) : undefined;
        if (focused) {
          const next = Math.max(scaleRef.current, Math.min(1.2, 56 / Math.max(1, focused.r)));
          animateCameraTo({
            scale: next,
            x: size.w / 2 - focused.x * next,
            y: size.h / 2 - focused.y * next,
          });
        }
      }
    }
    else animateCameraTo(pending);
  }, [activeFocusId, scene, snapping, size, animateCameraTo, animateFrame]);

  const enterFocus = useCallback((unitId: string) => {
    if (unitId === activeFocusId || !arrangedTree.units.has(unitId)) return;
    cameraTouched.current = true;
    pendingFocusCameraRef.current = "frame";
    setFocusFrames((current) => [...current, { unitId }]);
    setSelectedUnitId(unitId);
    setRouteUnitId(unitId);
    setHover(null);
  }, [activeFocusId, arrangedTree]);

  const leaveFocus = useCallback(() => {
    cameraTouched.current = true;
    const leaving = focusFrames[focusFrames.length - 1];
    if (!leaving) return;
    const camera = currentCamera();
    const hasParentFocus = focusFrames.length > 1;
    const restored = hasParentFocus ? { x: 0, y: 0 } : masterScene.unitById.get(leaving.unitId);
    if (restored) {
      pendingFocusCameraRef.current = {
        scale: camera.scale,
        x: size.w / 2 - restored.x * camera.scale,
        y: size.h / 2 - restored.y * camera.scale,
      };
    }
    setFocusFrames((current) => current.slice(0, -1));
    setSelectedUnitId(null);
    setHover(null);
  }, [currentCamera, focusFrames, masterScene, size]);

  const focusFromBreadcrumb = useCallback((unitId: string) => {
    cameraTouched.current = true;
    const camera = currentCamera();
    if (unitId === arrangedTree.rootId) {
      const current = activeFocusId ? masterScene.unitById.get(activeFocusId) : undefined;
      if (current) {
        pendingFocusCameraRef.current = {
          scale: camera.scale,
          x: size.w / 2 - current.x * camera.scale,
          y: size.h / 2 - current.y * camera.scale,
        };
      }
      setFocusFrames([]);
      setSelectedUnitId(null);
      setRouteUnitId(null);
      return;
    }
    pendingFocusCameraRef.current = {
      scale: camera.scale,
      x: size.w / 2,
      y: size.h / 2,
    };
    setFocusFrames((current) => {
      const existing = current.findIndex((entry) => entry.unitId === unitId);
      if (existing >= 0) return current.slice(0, existing + 1);
      const top = current[current.length - 1];
      return top ? [...current.slice(0, -1), { unitId }] : current;
    });
    setSelectedUnitId(unitId);
    setRouteUnitId(unitId);
  }, [activeFocusId, arrangedTree.rootId, currentCamera, masterScene, size]);

  useEffect(() => {
    if (cameraTouched.current || size.w === 0) return;
    frame(worldRadius);
  }, [frame, worldRadius, size]);

  const onWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      cameraTouched.current = true;
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!stage || !pointer) return;
      const current = stage.scaleX();
      const world = { x: (pointer.x - stage.x()) / current, y: (pointer.y - stage.y()) / current };
      applyCamera(current * Math.exp(-e.evt.deltaY * 0.0015), world, pointer);
    },
    [applyCamera],
  );

  // --- persistence ---------------------------------------------------------
  const persist = useCallback(
    (rows: { nodeType: "unit" | "seat"; nodeId: string; angle: number | null; parentId: string | null }[]) => {
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
        origin: { x: unit.x, y: unit.y },
        current: { x: unit.x, y: unit.y },
        moved: descendantIds(interactive, unit.id),
        snap: null,
      };
      targetsRef.current = buildTargets(s, dragRef.current);
    },
    [buildTargets],
  );

  const onUnitDragMove = useCallback(() => {
    const drag = dragRef.current;
    const s = interactionSceneRef.current;
    const displayed = sceneRef.current;
    if (!drag || drag.kind !== "unit" || !s || !displayed) return;
    const node = nodeRefs.current.get(uid(drag.id));
    if (!node) return;
    drag.current = { x: node.x(), y: node.y() };
    drag.snap = snapping ? snapUnitOnRing(s, drag.id, drag.current) : null;
    targetsRef.current = buildTargets(displayed, drag);
  }, [buildTargets, snapping]);

  const onUnitDragEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (!drag || drag.kind !== "unit") return;
    const s = sceneRef.current;
    const snap = drag.snap;
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
    if (!snap || !s) {
      if (s) targetsRef.current = buildTargets(s, null);
      return;
    }
    const dragged = s.unitById.get(drag.id);
    if (snap.rerungs && dragged) {
      const focusDepth = activeFocusId ? (arrangedTree.units.get(activeFocusId)?.depth ?? 0) : 0;
      setPendingLevelChange({
        unitId: drag.id,
        from: arrangedTree.units.get(drag.id)?.depth ?? dragged.depth,
        to: focusDepth + snap.depth,
      });
      targetsRef.current = buildTargets(s, null);
      return;
    }
    ripple(snap.position, (s.unitById.get(snap.unitId)?.r ?? 40) * 2.6);
    if (unitOffsetsRef.current.delete(drag.id)) setPositionRevision((revision) => revision + 1);
    setAngleOverrides((prev) => new Map(prev).set(drag.id, snap.angle));
    setOverrides((prev) => ({
      ...prev,
      unitParent: new Map([...(prev.unitParent ?? [])].filter(([unitId]) => unitId !== drag.id)),
    }));
    const realParentId = baseTree.units.get(drag.id)?.parentId ?? snap.parentId;
    persist([
      { nodeType: "unit", nodeId: drag.id, angle: normalizeAngle(snap.angle), parentId: realParentId },
    ]);
  }, [activeFocusId, arrangedTree, baseTree, buildTargets, persist, ripple, snapping]);

  const onSeatDragStart = useCallback((seat: PlacedSeat) => {
    setHover(null);
    setDragging(sid(seat.id));
    dragRef.current = {
      kind: "seat",
      id: seat.id,
      origin: { x: seat.x, y: seat.y },
      current: { x: seat.x, y: seat.y },
      snap: null,
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
    drag.snap = snapping ? snapSeat(s, drag.id, drag.current) : null;
    targetsRef.current = buildTargets(displayed, drag);
  }, [buildTargets, snapping]);

  const onSeatDragEnd = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    if (!drag || drag.kind !== "seat") return;
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
    const snap = drag.snap;
    ripple(snap.position, SEAT_RADIUS * 4.5);
    if (seatOffsetsRef.current.delete(drag.id)) setPositionRevision((revision) => revision + 1);
    setOverrides((prev) => ({
      ...prev,
      seatUnit: new Map(prev.seatUnit ?? []).set(drag.id, snap.unitId),
    }));
    persist([{ nodeType: "seat", nodeId: drag.id, angle: null, parentId: snap.unitId }]);
  }, [buildTargets, persist, ripple, snapping]);

  const arranged =
    (overrides.unitParent?.size ?? 0) > 0 ||
    (overrides.seatUnit?.size ?? 0) > 0 ||
    angleOverrides.size > 0 ||
    unitOffsetsRef.current.size > 0 ||
    seatOffsetsRef.current.size > 0;

  const resetArrangement = useCallback(() => {
    if (activeFocusId) pendingFocusCameraRef.current = "frame";
    setSnapping(true);
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
  const boardTeamNames = useMemo(() => {
    if (!openBoard) return [];
    const names = scene.seats
      .filter((s) => s.personId === openBoard.id)
      .map((s) => scene.unitById.get(s.unitId)?.name)
      .filter((n): n is string => !!n);
    return names.length > 0 ? [...new Set(names)] : ["General"];
  }, [openBoard, scene]);

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
    const rv = revealAt(stage.scaleX());

    if (rv.workDots > 0.2) {
      for (const seat of s.seats) {
        for (let i = 0; i < seat.work.length; i++) {
          const w = seat.work[i];
          if (Math.hypot(world.x - w.x, world.y - w.y) <= WORK_RADIUS * 2.6) {
            return { kind: "work", seatId: seat.id, index: i };
          }
        }
      }
    }

    const live = stage.scaleX();
    for (const unit of s.units) {
      const d = Math.hypot(world.x - unit.x, world.y - unit.y);
      const opacity = unitRingReveal(unit.depth, live);
      if (opacity <= 0.05 || unitDrawRadius(unit, live) * live < 5) continue;
      for (let i = 0; i < UNIT_RING_KEYS.length; i++) {
        const g = ringGeometry(unit, i, live);
        if (Math.abs(d - g.radius) <= Math.max(g.width, 7) / 2 + 2) {
          return { kind: "ring", unitId: unit.id, ring: UNIT_RING_KEYS[i] };
        }
      }
    }

    if (rv.torus > 0.2) {
      for (const unit of s.units) {
        const d = Math.hypot(world.x - unit.x, world.y - unit.y);
        if (Math.abs(d - unit.seatRingRadius) > SEAT_RADIUS + 3) continue;
        const a = Math.atan2(world.y - unit.y, world.x - unit.x);
        if (Math.abs(angleDelta(unit.seatFanAngle, a)) <= Math.max(unit.seatFanSpan, 0.22) / 2 + 0.06) {
          return { kind: "torus", unitId: unit.id };
        }
      }
    }
    return null;
  }, []);

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
      // Clicking open paper lets go of the route. A click on a unit bubbles up
      // here too, but its target is the unit, not the stage.
      if (!hit && e.target === e.target.getStage()) {
        if (activeFocusId) leaveFocus();
        else {
          setRouteUnitId(null);
          setSelectedUnitId(null);
        }
      }
      return;
    }
    const seat = s.seatById.get(hit.seatId);
    const task = seat?.personId ? boards.get(seat.personId)?.[hit.index] : undefined;
    if (seat && task) setOpenWork({ seat, task });
  }, [hitTest, pointerWorld, boards, activeFocusId, leaveFocus]);

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
          cameraTouched.current = true;
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
        {/* One quiet guide at each actual snap radius; reporting data is unchanged. */}
        <Layer ref={bgLayerRef}>
          {/* Money runs under the whole map: the org sits on top of its own
              flows rather than beside them (Greg, 2026-09-14). */}
          {painters && (
            <Shape sceneFunc={painters.externalFlows} perfectDrawEnabled={false} listening={false} />
          )}
          {scene.bands.filter((band) => band.depth > 0).map((band) => (
            <Circle
              key={`band-${band.depth}`}
              radius={band.radius}
              stroke={C.guide}
              strokeWidth={1.5 / Math.max(scale, 0.05)}
              dash={[2 / Math.max(scale, 0.05), 7 / Math.max(scale, 0.05)]}
              lineCap="round"
              perfectDrawEnabled={false}
              listening={false}
            />
          ))}
          {!activeFocusId && EXTERNALS.map((ext) => {
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
              <Shape
                sceneFunc={painters.seatLinks}
                stroke={C.seatLink}
                strokeWidth={1.8}
                lineCap="round"
                opacity={Math.max(reveal.people, reveal.lead)}
                perfectDrawEnabled={false}
              />
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
            </>
          )}
        </Layer>

        <Layer ref={nodeLayerRef}>
          {visibleUnits.map((unit) => {
            // What you can grab is exactly what you can see: the handle takes
            // the disc's drawn size, not its laid-out one. Reading it from
            // React's throttled scale is fine here — the circle is invisible,
            // so a 3% step in it is a 3% step in nothing.
            const drawn = unitDrawRadius(unit, scale);
            const invScale = 1 / Math.max(scale, 0.01);
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
                }}
                onTap={() => {
                  if (pressMovedRef.current) return;
                  setRouteUnitId(unit.id === arrangedTree.rootId ? null : unit.id);
                  setSelectedUnitId(unit.id);
                }}
                onDblClick={() => enterFocus(unit.id)}
                onDblTap={() => enterFocus(unit.id)}
              >
                <Circle radius={drawn} fill="transparent" perfectDrawEnabled={false} />
                {(!focusBranch || focusBranch.has(unit.id)) &&
                  unitLabelVisible(drawn, scale) && (
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
              </Group>
            );
          })}

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

      {pendingLevelChange && (
        <div style={S.modalBackdrop} role="presentation">
          <section style={S.confirmCard} role="dialog" aria-modal="true" aria-labelledby="level-change-title">
            <div style={S.panelKicker}>restructure proposal</div>
            <div id="level-change-title" style={S.panelTitle}>Change this unit’s level?</div>
            <p style={S.confirmCopy}>
              {arrangedTree.units.get(pendingLevelChange.unitId)?.name ?? "This unit"} would move from CEO+
              {pendingLevelChange.from} to CEO+{pendingLevelChange.to}. No change has been made: choosing its new
              parent is still an open product decision.
            </p>
            <button type="button" style={S.panelAction} onClick={() => setPendingLevelChange(null)}>Cancel</button>
          </section>
        </div>
      )}

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
        <button type="button" style={S.button} onClick={() => frame(worldRadius)}>
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
        <span style={S.legendHint}>
          rings: {UNIT_RING_LABELS.delivery} · {UNIT_RING_LABELS.sprint} · {UNIT_RING_LABELS.health}
        </span>
        <span style={S.legendHint}>
          {snapping
            ? "drag along a ring to adjust placement · tidy up restores the calculated map"
            : "move nodes and people freely · visual only · resets on reload or tidy up"}
        </span>
      </div>}
    </div>
  );
}

function snapHint(drag: DragState | null): RenderCtx["snap"] {
  if (!drag?.snap) return null;
  return drag.snap.kind === "unit"
    ? {
        kind: "unit",
        position: drag.snap.position,
        parentId: drag.snap.parentId,
        depth: drag.snap.depth,
        unitId: drag.snap.unitId,
      }
    : { kind: "seat", position: drag.snap.position, unitId: drag.snap.unitId };
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
      {rings && rings.people > 0 && (
        <div style={{ marginTop: 10 }}>
          <Meter label={UNIT_RING_LABELS.delivery} value={rings.delivery} color={C.delivery} />
          <Meter label={UNIT_RING_LABELS.sprint} value={rings.sprint} color={C.sprint} />
          <Meter label={UNIT_RING_LABELS.health} value={rings.health} color={healthColor(rings.health)} />
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
        {rings && rings.people > 0 && (
          <div style={{ marginTop: 8 }}>
            <Meter label={UNIT_RING_LABELS.delivery} value={rings.delivery} color={C.delivery} />
            <Meter label={UNIT_RING_LABELS.sprint} value={rings.sprint} color={C.sprint} />
            <Meter label={UNIT_RING_LABELS.health} value={rings.health} color={healthColor(rings.health)} />
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
              <strong>{pct(rings.sprint)}</strong>
            </div>
            <div style={S.hoverStat}>
              <span>days left</span>
              <strong>4</strong>
            </div>
            <div style={S.hoverStat}>
              <span>carry-over risk</span>
              <strong>{rings.sprint < 0.5 ? "high" : "low"}</strong>
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
    width: 340,
    maxWidth: "calc(100% - 32px)",
    padding: 20,
    borderRadius: 16,
    background: C.white,
    border: `1px solid ${C.link}`,
    boxShadow: "0 20px 60px rgba(34,39,46,0.22)",
  },
  confirmCopy: { margin: "10px 0 0", font: `400 13px/1.5 ${FONT}`, color: C.inkSoft },
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
