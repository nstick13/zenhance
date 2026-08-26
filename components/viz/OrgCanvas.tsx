"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Stage, Layer, Group, Circle, Rect, Text, Arc } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { OrgUnit, Person, Assignment, MapNodeRow } from "@/lib/db/schema";
import {
  saveMapNodePosition,
  moveAssignment,
  moveOrgUnit,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  createPerson,
  updatePerson,
  deletePerson,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  tidyUpCanvasLayout,
} from "@/lib/data/actions";
import {
  buildCanvasMap,
  positionsFromRows,
  CROSS_CUTTING_ID,
  squadNodeRadius,
  squadRingRadius,
  type CanvasNode,
  type CanvasSquad,
  type CanvasPerson,
  type CanvasStream,
  type CanvasAllocation,
} from "@/lib/canvas/buildCanvasMap";

const CROSS_CUTTING_MODE = "connected" as const;
const GHOST_R = 18; // borrowed seat — deliberately smaller than a real seat (22)

/** "Marco Webb" -> "M. Webb". Ghost seats repeat the same person across squads;
 *  the short form keeps the ring readable without dropping identity. */
const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0][0]}. ${parts[parts.length - 1]}`;
};
import { overAllocatedPersonIds, allocationByPerson } from "@/lib/org/model";
import { computeGaps } from "@/lib/analytics/gaps";
import { computeRollup } from "@/lib/analytics/rollup";

/**
 * v2 canvas map — V2.0 "viewport" (docs/V2.md). Adapted from the verified
 * feel study at app/lab/canvas/CanvasMap.tsx, reading the real workspace
 * snapshot instead of mock data, with positions persisted to `map_nodes` on
 * drag end.
 *
 * V2.1 (parity) — analytics overlays ported here. Still staged for later
 * V2.1/V2.2 passes: the findings rail, scenario mode, drag-to-reassign,
 * search, zones, delivery/reporting layer toggles.
 */

// --- palette (Mini Metro / "paper" register, per docs/V2.md) --------------
const C = {
  paper: "#f6f4ee",
  ink: "#22272e",
  inkSoft: "#5c6570",
  line: "#e4e0d6",
  white: "#ffffff",
  squad: "#10b981",
  cross: "#f59e0b",
  external: "#8b5cf6",
  crossStream: "#6366f1", // seats held by someone who spans multiple streams
  utilOk: "#22c55e",
  utilWarn: "#eab308",
  utilOver: "#ef4444",
  heat: "#dc2626",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

type Lod = "streams" | "squads" | "people" | "roles";

const LOD_LABELS: [Lod, string][] = [
  ["streams", "Value streams"],
  ["squads", "Squads"],
  ["people", "People"],
  ["roles", "Roles"],
];

type OverlayType = "none" | "allocation" | "gaps" | "cost";

const OVERLAY_OPTIONS: { type: OverlayType; label: string }[] = [
  { type: "none", label: "Overview" },
  { type: "allocation", label: "Allocation" },
  { type: "gaps", label: "Gaps" },
  { type: "cost", label: "Cost / ROI" },
];

type NodeOverlay = { dimmed: boolean; badge: string | null; heatPct: number };
const NO_OVERLAY: NodeOverlay = { dimmed: false, badge: null, heatPct: 0 };

/** Identity colours for value streams — low-saturation "paper" register, used as
 *  a wash inside the stream rectangle and for its header type. Assigned by the
 *  stream's position in the (name-sorted) list, so a stream keeps its colour. */
// Deliberately avoids violet (external vendor squads), the ghost amber, and the
// utilisation red — a stream's identity must never read as a status.
const STREAM_HUES = ["#0e7490", "#4f46e5", "#9d174d", "#15803d", "#a16207"];
const streamHue = (i: number) => STREAM_HUES[i % STREAM_HUES.length];

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const SQUAD_DROP_PAD = 26; // slack beyond a squad's own radius for drop targeting

function lodFor(scale: number): Lod {
  if (scale >= 1.5) return "roles";
  if (scale >= 0.45) return "people";
  if (scale >= 0.26) return "squads";
  return "streams";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Largest font size at which `text` still fits `width` on one line. */
const fitFontSize = (text: string, width: number, max: number, min: number) =>
  clamp(width / Math.max(1, text.length * 0.58), min, max);

/** Intro choreography: each element gets a window inside the 0→1 intro clock,
 *  so the map assembles (hulls → squads → seats) instead of appearing whole. */
const INTRO_MS = 820;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const phase = (t: number, start: number, dur: number) => easeOut(clamp((t - start) / dur, 0, 1));

const utilOf = (p: CanvasPerson) => p.allocations.reduce((s, a) => s + a.pct, 0);

function utilColor(pct: number) {
  if (pct === 0) return C.inkSoft;
  if (pct > 110) return C.utilOver;
  if (pct > 100) return C.utilWarn;
  return C.utilOk;
}

const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}k`
      : `$${Math.round(n)}`;

type SquadStats = {
  heads: number;
  fte: number;
  cost: number;
  openRoles: number;
  target: number | null;
  shared: number;
};

export function OrgCanvas({
  people: peopleRows,
  units,
  assignments,
  mapNodeRows,
}: {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  mapNodeRows: MapNodeRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Scenario planning: `moves` overlays assignment -> new orgUnitId without
  // touching the server until Apply. Mirrors RadialOrg.tsx's staging pattern
  // (docs/V2.md V2.1). Node *position* is unaffected — drag always persists
  // immediately, since position is independent, persisted data, not layout.
  const [scenario, setScenario] = useState(false);
  const [moves, setMoves] = useState<Map<string, string>>(new Map());

  const { effAssignments, activeMoveCount } = useMemo(() => {
    if (moves.size === 0) return { effAssignments: assignments, activeMoveCount: 0 };
    let count = 0;
    const eff = assignments.map((a) => {
      const target = moves.get(a.id);
      if (target && target !== a.orgUnitId) {
        count++;
        return { ...a, orgUnitId: target };
      }
      return a;
    });
    return { effAssignments: eff, activeMoveCount: count };
  }, [assignments, moves]);

  const seed = useMemo(
    () => buildCanvasMap(
      { people: peopleRows, units, assignments: effAssignments },
      positionsFromRows(mapNodeRows),
      { crossCuttingMode: CROSS_CUTTING_MODE },
    ),
    [peopleRows, units, effAssignments, mapNodeRows],
  );

  const [nodes, setNodes] = useState<CanvasNode[]>(seed.nodes);
  const streams = seed.streams;

  // Re-derive node content (allocations, home) whenever real data or a staged
  // scenario move changes, keeping each node's current x/y. When mapNodeRows
  // changes (e.g. after Tidy up persists new positions), use the seed x/y
  // directly so the layout actually reflects the server-computed positions.
  const [prevSeed, setPrevSeed] = useState(seed);
  const [prevMapNodeRows, setPrevMapNodeRows] = useState(mapNodeRows);
  if (prevSeed !== seed) {
    setPrevSeed(seed);
    const positionsReset = prevMapNodeRows !== mapNodeRows;
    if (positionsReset) setPrevMapNodeRows(mapNodeRows);
    setNodes((prev) => {
      if (positionsReset) return seed.nodes;
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return seed.nodes.map((n) => {
        const existing = prevById.get(n.id);
        return existing ? { ...n, x: existing.x, y: existing.y } : n;
      });
    });
  }

  const [scale, setScale] = useState(0.3);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [overlayType, setOverlayType] = useState<OverlayType>("none");
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropStreamId, setDropStreamId] = useState<string | null>(null);
  const [introT, setIntroT] = useState(0);
  const [addMode, setAddMode] = useState(false); // Option/Alt held during a person drag
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState<"person" | "squad" | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const pinch = useRef<{ dist: number; center: { x: number; y: number } } | null>(null);

  const lod = lodFor(scale);

  const squads = useMemo(() => nodes.filter((n): n is CanvasSquad => n.kind === "squad"), [nodes]);
  const people = useMemo(() => nodes.filter((n): n is CanvasPerson => n.kind === "person"), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const realStreams = useMemo(() => streams.filter((t) => t.id !== CROSS_CUTTING_ID), [streams]);

  /** Stable identity colour per value stream. */
  const hueOf = useMemo(() => {
    const m = new Map<string, string>();
    realStreams.forEach((t, i) => m.set(t.id, streamHue(i)));
    m.set(CROSS_CUTTING_ID, C.inkSoft);
    return m;
  }, [realStreams]);

  // --- analytics overlays (V2.1 parity, ported from RadialOrg's getOverlayProps) ---
  const overAlloc = useMemo(() => overAllocatedPersonIds(effAssignments), [effAssignments]);
  const allocByPerson = useMemo(() => allocationByPerson(effAssignments), [effAssignments]);
  const gapsMap = useMemo(
    () => computeGaps({ units, people: peopleRows, assignments: effAssignments }),
    [units, peopleRows, effAssignments],
  );
  const rollupMap = useMemo(
    () => computeRollup({ units, people: peopleRows, assignments: effAssignments }),
    [units, peopleRows, effAssignments],
  );
  const maxUnitCost = useMemo(() => {
    let max = 0;
    for (const r of rollupMap.values()) if (r.totalCost > max) max = r.totalCost;
    return max;
  }, [rollupMap]);

  const squadOverlay = useCallback(
    (squad: CanvasSquad): NodeOverlay => {
      if (overlayType === "none") return NO_OVERLAY;
      if (overlayType === "allocation") return { ...NO_OVERLAY, dimmed: true };
      if (overlayType === "gaps") {
        const gap = gapsMap.get(squad.id);
        const hasGap = !!gap && gap.gap > 0;
        return { dimmed: !hasGap, badge: hasGap ? `${gap!.gap} open` : null, heatPct: 0 };
      }
      const cost = rollupMap.get(squad.id)?.totalCost ?? 0;
      return {
        dimmed: false,
        badge: cost > 0 ? `${money(cost)}/mo` : null,
        heatPct: maxUnitCost > 0 ? cost / maxUnitCost : 0,
      };
    },
    [overlayType, gapsMap, rollupMap, maxUnitCost],
  );

  const personOverlay = useCallback(
    (person: CanvasPerson): NodeOverlay => {
      if (overlayType === "none") return NO_OVERLAY;
      if (overlayType === "allocation") {
        const isOver = overAlloc.has(person.id);
        const alloc = allocByPerson.get(person.id);
        return { dimmed: !isOver, badge: isOver && alloc ? `${alloc.teamCount} teams` : null, heatPct: 0 };
      }
      return { ...NO_OVERLAY, dimmed: true };
    },
    [overlayType, overAlloc, allocByPerson],
  );

  const streamOverlay = useCallback(
    (streamId: string, openRoles: number, cost: number): NodeOverlay => {
      if (overlayType === "none") return NO_OVERLAY;
      if (overlayType === "allocation") return { ...NO_OVERLAY, dimmed: true };
      if (overlayType === "gaps") {
        return { dimmed: openRoles === 0, badge: openRoles > 0 ? `${openRoles} open` : null, heatPct: 0 };
      }
      const roi = rollupMap.get(streamId)?.totalRoi ?? 0;
      return {
        dimmed: false,
        badge: roi > 0 ? `ROI ${money(roi)}` : null,
        heatPct: maxUnitCost > 0 ? cost / maxUnitCost : 0,
      };
    },
    [overlayType, rollupMap, maxUnitCost],
  );

  const squadStats = useMemo(() => {
    const m = new Map<string, SquadStats>();
    for (const s of squads) {
      m.set(s.id, { heads: 0, fte: 0, cost: 0, openRoles: s.openRoles, target: s.targetHeadcount, shared: 0 });
    }
    for (const p of people) {
      if (p.allocations.length === 0) {
        const st = m.get(p.homeId);
        if (st) {
          st.heads += 1;
          st.cost += p.costPerMonth;
        }
        continue;
      }
      for (const a of p.allocations) {
        const st = m.get(a.unitId);
        if (!st) continue;
        st.heads += 1;
        st.fte += a.pct / 100;
        st.cost += (p.costPerMonth * a.pct) / 100;
        if (p.homeId !== a.unitId) st.shared += 1;
      }
    }
    // Nothing ever allocates *to* the cross-cutting bucket (it's a display
    // home, not a real team) — aggregate it from its members directly.
    const cc = m.get(CROSS_CUTTING_ID);
    if (cc) {
      const members = people.filter((p) => p.homeId === CROSS_CUTTING_ID);
      cc.heads = members.length;
      cc.fte = members.reduce((s, p) => s + utilOf(p) / 100, 0);
      cc.cost = members.reduce((s, p) => s + p.costPerMonth, 0);
      cc.shared = members.length;
    }
    return m;
  }, [squads, people]);

  // Seats per squad (home members + ghost seats). Drives the squad circle size
  // and the member-ring radius, so a big team *looks* like a big team.
  const seatsBySquad = useMemo(() => {
    const m = new Map<string, number>();
    const bump = (id: string) => m.set(id, (m.get(id) ?? 0) + 1);
    for (const p of people) {
      if (p.crossCuttingTier !== null) {
        for (const a of p.allocations) bump(a.unitId);
      } else {
        bump(p.homeId);
      }
    }
    return m;
  }, [people]);

  const squadR = useCallback((id: string) => squadNodeRadius(seatsBySquad.get(id) ?? 0), [seatsBySquad]);

  // Ghost seat positions for every cross-cutting person with allocations —
  // cross-squad and cross-stream alike. Placed into the *largest
  // angular gaps* of the squad's real member ring, measured from live node
  // positions — so a ghost never lands on a member, and the layout survives
  // dragging members (or the squad itself) around.
  const ghostSeats = useMemo(() => {
    const membersBySquad = new Map<string, CanvasPerson[]>();
    for (const p of people) {
      if (p.crossCuttingTier !== null || p.homeId === CROSS_CUTTING_ID) continue;
      if (!membersBySquad.has(p.homeId)) membersBySquad.set(p.homeId, []);
      membersBySquad.get(p.homeId)!.push(p);
    }
    const ghostsBySquad = new Map<string, Array<{ person: CanvasPerson; alloc: CanvasAllocation }>>();
    for (const p of people) {
      if (p.crossCuttingTier === null) continue;
      for (const a of p.allocations) {
        if (!ghostsBySquad.has(a.unitId)) ghostsBySquad.set(a.unitId, []);
        ghostsBySquad.get(a.unitId)!.push({ person: p, alloc: a });
      }
    }
    const result: Array<{ person: CanvasPerson; alloc: CanvasAllocation; gx: number; gy: number }> = [];
    for (const [squadId, ghosts] of ghostsBySquad) {
      const sq = byId.get(squadId);
      if (!sq || sq.kind !== "squad" || (sq as CanvasSquad).isCrossCutting) continue;
      ghosts.sort((a, b) => a.person.name.localeCompare(b.person.name));

      const polar = (membersBySquad.get(squadId) ?? [])
        .map((m) => ({ a: Math.atan2(m.y - sq.y, m.x - sq.x), r: Math.hypot(m.x - sq.x, m.y - sq.y) }))
        .filter((q) => q.r > 1);
      const seats = seatsBySquad.get(squadId) ?? ghosts.length;
      const nominal = squadRingRadius(seats);
      const ringR = polar.length
        ? clamp(polar.reduce((s, q) => s + q.r, 0) / polar.length, squadNodeRadius(seats) + 40, 360)
        : nominal;

      const slots: number[] = [];
      if (polar.length === 0) {
        for (let i = 0; i < ghosts.length; i++) slots.push((2 * Math.PI * i) / ghosts.length - Math.PI / 2);
      } else {
        const occupied = polar.map((q) => q.a);
        for (let g = 0; g < ghosts.length; g++) {
          const all = [...occupied, ...slots].sort((a, b) => a - b);
          let bestMid = -Math.PI / 2;
          let bestGap = -1;
          for (let i = 0; i < all.length; i++) {
            const a0 = all[i];
            const a1 = i === all.length - 1 ? all[0] + 2 * Math.PI : all[i + 1];
            if (a1 - a0 > bestGap) {
              bestGap = a1 - a0;
              bestMid = a0 + (a1 - a0) / 2;
            }
          }
          slots.push(bestMid);
        }
      }

      ghosts.forEach(({ person, alloc }, i) => {
        result.push({
          person,
          alloc,
          gx: sq.x + Math.cos(slots[i]) * ringR,
          gy: sq.y + Math.sin(slots[i]) * ringR,
        });
      });
    }
    return result;
  }, [people, byId, seatsBySquad]);

  const streamAgg = useMemo(() => {
    return streams
      .map((t) => {
        const own = squads.filter((s) => s.streamId === t.id);
        if (own.length === 0) return null;
        // A stream is drawn as a rounded rectangle sized to contain its squads
        // *and* their member rings — so more squads reads as a bigger block.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of own) {
          const rr = squadRingRadius(seatsBySquad.get(n.id) ?? 0) + 52; // + label headroom
          minX = Math.min(minX, n.x - rr);
          maxX = Math.max(maxX, n.x + rr);
          minY = Math.min(minY, n.y - rr);
          maxY = Math.max(maxY, n.y + rr);
        }
        const PAD_X = 70, PAD_TOP = 150, PAD_BOTTOM = 60; // PAD_TOP clears the stream header block
        minX -= PAD_X; maxX += PAD_X; minY -= PAD_TOP; maxY += PAD_BOTTOM;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const hw = (maxX - minX) / 2;
        const hh = (maxY - minY) / 2;
        let heads = 0;
        let cost = 0;
        let openRoles = 0;
        for (const s of own) {
          const st = squadStats.get(s.id);
          if (!st) continue;
          heads += st.heads;
          cost += st.cost;
          openRoles += st.openRoles;
        }
        return { ...t, x: cx, y: cy, hw, hh, heads, cost, openRoles, squads: own.length };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }, [streams, squads, squadStats, seatsBySquad]);

  // --- sizing ----------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || size.w === 0 || nodes.length === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 260;
    const s = clamp(
      Math.min(size.w / (maxX - minX + pad * 2), size.h / (maxY - minY + pad * 2)),
      MIN_SCALE,
      MAX_SCALE,
    );
    stage.scale({ x: s, y: s });
    stage.position({ x: size.w / 2 - ((minX + maxX) / 2) * s, y: size.h / 2 - ((minY + maxY) / 2) * s });
    stage.batchDraw();
    setScale(s);
  }, [nodes, size]);

  /** Frame one box (a value stream rectangle) rather than the whole world. */
  const frameBox = useCallback(
    (box: { x: number; y: number; hw: number; hh: number }) => {
      const stage = stageRef.current;
      if (!stage || size.w === 0) return;
      const s = clamp(
        Math.min(size.w / (box.hw * 2 * 1.12), size.h / (box.hh * 2 * 1.12)),
        MIN_SCALE,
        MAX_SCALE,
      );
      stage.scale({ x: s, y: s });
      stage.position({ x: size.w / 2 - box.x * s, y: size.h / 2 - box.y * s });
      stage.batchDraw();
      setScale(s);
    },
    [size],
  );

  // Open on a *view*, not on "fit everything": land on the value stream with the
  // most open roles (tie-break on headcount) — the one worth looking at.
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || size.w === 0) return;
    didFit.current = true;
    const opening = streamAgg
      .filter((t) => t.id !== CROSS_CUTTING_ID)
      .sort((a, b) => b.openRoles - a.openRoles || b.heads - a.heads)[0];
    if (opening) frameBox(opening);
    else fit();
  }, [fit, frameBox, streamAgg, size]);

  // The intro clock is its own mount-only effect. It must NOT share the
  // once-guarded effect above: any dep change (or React's dev double-invoke)
  // runs that cleanup, cancels the frame, and the re-run returns early on the
  // guard — leaving introT pinned at 0, which renders the whole map invisible.
  // The timeout is a hard backstop: whatever happens to rAF, the map appears.
  useEffect(() => {
    // Reduced motion: same code path, zero-length clock — the first frame lands on 1.
    const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dur = reduced ? 1 : INTRO_MS;
    const started = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = clamp((now - started) / dur, 0, 1);
      setIntroT(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const backstop = setTimeout(() => setIntroT(1), INTRO_MS + 500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(backstop);
    };
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const old = stage.scaleX();
      const next = clamp(old * factor, MIN_SCALE, MAX_SCALE);
      const c = { x: size.w / 2, y: size.h / 2 };
      const world = { x: (c.x - stage.x()) / old, y: (c.y - stage.y()) / old };
      stage.scale({ x: next, y: next });
      stage.position({ x: c.x - world.x * next, y: c.y - world.y * next });
      stage.batchDraw();
      setScale(next);
    },
    [size],
  );

  const onWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const old = stage.scaleX();
    const dir = e.evt.deltaY > 0 ? 1 / 1.08 : 1.08;
    const next = clamp(old * dir, MIN_SCALE, MAX_SCALE);
    const world = { x: (pointer.x - stage.x()) / old, y: (pointer.y - stage.y()) / old };
    stage.scale({ x: next, y: next });
    stage.position({ x: pointer.x - world.x * next, y: pointer.y - world.y * next });
    stage.batchDraw();
    setScale(next);
  }, []);

  const onTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const t = e.evt.touches;
    if (t.length !== 2) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const p1 = { x: t[0].clientX, y: t[0].clientY };
    const p2 = { x: t[1].clientX, y: t[1].clientY };
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (!pinch.current) {
      pinch.current = { dist, center };
      return;
    }
    const box = stage.container().getBoundingClientRect();
    const local = { x: center.x - box.left, y: center.y - box.top };
    const old = stage.scaleX();
    const next = clamp(old * (dist / pinch.current.dist), MIN_SCALE, MAX_SCALE);
    const world = { x: (local.x - stage.x()) / old, y: (local.y - stage.y()) / old };
    stage.scale({ x: next, y: next });
    stage.position({ x: local.x - world.x * next, y: local.y - world.y * next });
    stage.batchDraw();
    setScale(next);
    pinch.current = { dist, center };
  }, []);

  const onTouchEnd = useCallback(() => {
    pinch.current = null;
  }, []);

  // --- drag: reposition + persist, plus drop-on-squad reassignment -----------
  const nearestSquad = useCallback(
    (x: number, y: number): CanvasSquad | null => {
      let nearest: CanvasSquad | null = null;
      let best = Infinity;
      for (const s of squads) {
        if (s.isCrossCutting) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < squadNodeRadius(seatsBySquad.get(s.id) ?? 0) + SQUAD_DROP_PAD && d < best) {
          best = d;
          nearest = s;
        }
      }
      return nearest;
    },
    [squads, seatsBySquad],
  );

  // Nearest stream whose hull actually contains (x, y) — used to reparent a
  // dragged squad onto a different stream. Excludes the synthetic
  // cross-cutting bucket, which isn't a real org unit.
  const nearestStream = useCallback(
    (x: number, y: number) => {
      let nearest: (typeof streamAgg)[number] | null = null;
      let best = Infinity;
      for (const t of streamAgg) {
        if (t.id === CROSS_CUTTING_ID) continue;
        if (Math.abs(x - t.x) > t.hw || Math.abs(y - t.y) > t.hh) continue;
        const area = t.hw * t.hh; // nested boxes: the tightest one wins
        if (area < best) {
          best = area;
          nearest = t;
        }
      }
      return nearest;
    },
    [streamAgg],
  );

  const onPersonDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (lod === "streams") {
        setDropTargetId(null);
        return;
      }
      setAddMode(!!e.evt.altKey);
      const target = nearestSquad(e.target.x(), e.target.y());
      setDropTargetId(target?.id ?? null);
    },
    [lod, nearestSquad],
  );

  const onSquadDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>, squad: CanvasSquad) => {
      if (squad.isCrossCutting) return;
      const target = nearestStream(e.target.x(), e.target.y());
      setDropStreamId(target && target.id !== squad.streamId ? target.id : null);
    },
    [nearestStream],
  );

  const onNodeDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>, node: CanvasNode) => {
      const x = e.target.x();
      const y = e.target.y();
      setDropTargetId(null);
      setDropStreamId(null);
      setAddMode(false);
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, x, y } : n)));
      const nodeType = node.kind === "squad" ? "unit" : "person";
      startTransition(async () => {
        const result = await saveMapNodePosition(nodeType, node.id, x, y);
        if (!result.ok) console.error("Failed to save node position:", result.error);
      });

      if (node.kind === "squad") {
        if (node.isCrossCutting) return;
        const target = nearestStream(x, y);
        if (!target || target.id === node.streamId) return;
        const targetStreamId = target.id;
        startTransition(async () => {
          const result = await moveOrgUnit(node.id, targetStreamId);
          if (!result.ok) console.error("Failed to move squad to stream:", result.error);
          else router.refresh();
        });
        return;
      }

      if (node.kind !== "person" || lod === "streams" || node.allocations.length === 0) return;
      const target = nearestSquad(x, y);
      if (!target) return;
      const targetSquadId = target.id;
      const home = [...node.allocations].sort((a, b) => b.pct - a.pct)[0];
      if (node.allocations.some((a) => a.unitId === targetSquadId)) return;

      // Option/Alt-drag *adds* a team instead of moving them to it — the gesture
      // for "they now support this squad too". Not stageable in scenario mode,
      // which stages moves (a swapped assignmentId), not new rows.
      if (e.evt.altKey) {
        startTransition(async () => {
          const result = await createAssignment({
            orgUnitId: targetSquadId,
            personId: node.id,
            roleOnTeam: node.title ?? "",
            allocationPct: 20,
            isOpenRole: false,
          });
          if (!result.ok) console.error("Failed to add to team:", result.error);
          else router.refresh();
        });
        return;
      }

      if (home.unitId === targetSquadId) return;
      if (scenario) {
        setMoves((prev) => {
          const next = new Map(prev);
          next.set(home.assignmentId, targetSquadId);
          return next;
        });
        return;
      }
      startTransition(async () => {
        const result = await moveAssignment(home.assignmentId, targetSquadId);
        if (!result.ok) console.error("Failed to reassign:", result.error);
        else router.refresh();
      });
    },
    [startTransition, lod, nearestSquad, nearestStream, scenario, router],
  );

  function toggleScenario() {
    if (scenario) {
      setMoves(new Map());
      setScenario(false);
    } else {
      setScenario(true);
    }
  }

  function applyScenario() {
    const entries = [...moves.entries()];
    startTransition(async () => {
      for (const [id, target] of entries) await moveAssignment(id, target);
      setMoves(new Map());
      setScenario(false);
      router.refresh();
    });
  }

  function discardScenario() {
    setMoves(new Map());
  }

  function tidyUp() {
    startTransition(async () => {
      await tidyUpCanvasLayout();
      router.refresh();
    });
  }

  // --- panel: select / edit / create -----------------------------------------
  function selectNode(id: string) {
    setSelectedId(id);
    setEditing(false);
    setCreating(null);
  }

  function closePanel() {
    setSelectedId(null);
    setEditing(false);
    setCreating(null);
  }

  function startCreate(kind: "person" | "squad") {
    setSelectedId(null);
    setEditing(false);
    setCreating(kind);
  }

  const showHover = useCallback((id: string) => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return;
    setHover({ id, x: p.x, y: p.y });
  }, []);

  const selected = selectedId ? byId.get(selectedId) : null;
  const hovered = hover ? byId.get(hover.id) : null;
  const panelOpen = !!selected || !!creating;

  const showSquads = lod !== "streams";
  const showPeople = lod === "people" || lod === "roles";

  return (
    <div style={S.root}>
      <header style={S.topbar}>
        <div style={S.brand}>
          <span style={S.dot} />
          <strong style={{ fontSize: 16, letterSpacing: "0.01em" }}>Zenhance</strong>
        </div>
        <a style={S.viewLink} href="/org">
          ⟲ Radial view
        </a>
        <div style={S.overlayGroup}>
          {OVERLAY_OPTIONS.map((o) => (
            <button
              key={o.type}
              style={S.overlayBtn(overlayType === o.type)}
              onClick={() => setOverlayType(o.type)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div style={S.overlayGroup}>
          {scenario && activeMoveCount > 0 && (
            <>
              <span style={S.pendingPill}>
                {activeMoveCount} pending move{activeMoveCount === 1 ? "" : "s"}
              </span>
              <button style={S.applyBtn} onClick={applyScenario} disabled={isPending}>
                {isPending ? "Applying…" : "Apply"}
              </button>
              <button style={S.discardBtn} onClick={discardScenario}>
                Discard
              </button>
            </>
          )}
          <button style={S.scenarioBtn(scenario)} onClick={toggleScenario}>
            {scenario ? "Scenario: on" : "Scenario mode"}
          </button>
        </div>
        <div style={S.overlayGroup}>
          <button style={S.btn} onClick={() => startCreate("person")}>
            + Person
          </button>
          <button style={S.btn} onClick={() => startCreate("squad")}>
            + Squad
          </button>
        </div>
        <div style={S.overlayGroup}>
          <button style={S.btn} onClick={tidyUp} disabled={isPending}>
            {isPending ? "Tidying…" : "Tidy up"}
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={S.btn} onClick={() => zoomBy(1.45)} aria-label="Zoom in">
            +
          </button>
          <button style={S.btn} onClick={() => zoomBy(1 / 1.45)} aria-label="Zoom out">
            −
          </button>
          <button style={S.btn} onClick={fit}>
            Fit
          </button>
        </div>
      </header>

      <div ref={wrapRef} style={S.canvasWrap}>
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          draggable
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ cursor: "grab" }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) closePanel();
          }}
        >
          <Layer listening={false}>
            {streamAgg.map((t) => {
              const hue = hueOf.get(t.id) ?? C.inkSoft;
              const inP = phase(introT, 0, 0.45);
              return (
              <Group key={`hull-${t.id}`} x={t.x} y={t.y} opacity={inP}>
                {dropStreamId === t.id && (
                  <Rect
                    x={-t.hw - 16}
                    y={-t.hh - 16}
                    width={t.hw * 2 + 32}
                    height={t.hh * 2 + 32}
                    cornerRadius={52}
                    fill="#34d399"
                    opacity={0.14}
                  />
                )}
                <Rect
                  x={-t.hw}
                  y={-t.hh}
                  width={t.hw * 2}
                  height={t.hh * 2}
                  cornerRadius={40}
                  fill={C.white}
                  opacity={showSquads ? 0.72 : 0}
                  stroke={dropStreamId === t.id ? "#34d399" : C.line}
                  strokeWidth={dropStreamId === t.id ? 4 / scale : 2 / scale}
                  perfectDrawEnabled={false}
                />
                {showSquads && (
                  <Rect
                    x={-t.hw}
                    y={-t.hh}
                    width={t.hw * 2}
                    height={t.hh * 2}
                    cornerRadius={40}
                    fill={hue}
                    opacity={0.05}
                    perfectDrawEnabled={false}
                  />
                )}
                {showSquads && (() => {
                  // Header: the stream's identity, then who is accountable for it,
                  // then its size. Each on its own line, and the name shrinks to fit
                  // a narrow stream rather than wrapping into the lines below it.
                  const label = t.name.toUpperCase();
                  const inner = t.hw * 2 - 112;
                  const nameSize = fitFontSize(label, inner, 34, 15);
                  const isBucket = t.id === CROSS_CUTTING_ID;
                  const yName = -t.hh + 38;
                  const yOwner = yName + nameSize + 12;
                  const yStats = yOwner + (isBucket ? 0 : 21);
                  return (
                    <>
                      <Rect
                        x={-t.hw + 46}
                        y={yName - 2}
                        width={5}
                        height={yStats - yName + 20}
                        cornerRadius={3}
                        fill={hue}
                        opacity={0.75}
                      />
                      <Text
                        text={label}
                        x={-t.hw + 66}
                        y={yName}
                        width={inner}
                        wrap="none"
                        ellipsis
                        fontSize={nameSize}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={hue}
                        opacity={0.75}
                      />
                      {!isBucket && (
                        <Text
                          text={t.leadName ? `Led by ${t.leadName}` : "No owner"}
                          x={-t.hw + 66}
                          y={yOwner}
                          width={inner}
                          wrap="none"
                          ellipsis
                          fontSize={16}
                          fontStyle={t.leadName ? "normal" : "bold"}
                          fontFamily={FONT}
                          fill={t.leadName ? C.inkSoft : C.utilOver}
                        />
                      )}
                      <Text
                        text={`${plural(t.squads, "squad")} · ${plural(t.heads, "person").replace("persons", "people")} · ${money(t.cost)}/mo`}
                        x={-t.hw + 66}
                        y={yStats}
                        width={inner}
                        wrap="none"
                        ellipsis
                        fontSize={16}
                        fontFamily={FONT}
                        fill={C.inkSoft}
                        opacity={0.85}
                      />
                    </>
                  );
                })()}
              </Group>
              );
            })}
          </Layer>

          <Layer>
            {!showSquads &&
              streamAgg.map((t) => {
                const ov = streamOverlay(t.id, t.openRoles, t.cost);
                // Collapsed stream card — width grows with squad count.
                const bw = clamp(140 + t.squads * 26, 150, 300);
                const bh = 104;
                const tw = bw * 2 - 36;
                return (
                  <Group
                    key={t.id}
                    x={t.x}
                    y={t.y}
                    opacity={ov.dimmed ? 0.3 : 1}
                    onMouseEnter={() => showHover(t.id)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <Rect
                      x={-bw}
                      y={-bh}
                      width={bw * 2}
                      height={bh * 2}
                      cornerRadius={26}
                      fill={C.white}
                      stroke={hueOf.get(t.id) ?? C.ink}
                      strokeWidth={5}
                      shadowColor={C.ink}
                      shadowBlur={26}
                      shadowOpacity={0.1}
                      shadowOffsetY={5}
                      perfectDrawEnabled={false}
                    />
                    {ov.heatPct > 0 && (
                      <Rect x={-bw} y={-bh} width={bw * 2} height={bh * 2} cornerRadius={26} fill={C.heat} opacity={ov.heatPct * 0.45} listening={false} />
                    )}
                    <Text text={t.name} x={-tw / 2} y={-42} width={tw} align="center" fontSize={34} fontStyle="bold" fontFamily={FONT} fill={C.ink} listening={false} />
                    <Text
                      text={`${t.heads} people · ${money(t.cost)}/mo`}
                      x={-tw / 2}
                      y={4}
                      width={tw}
                      align="center"
                      fontSize={20}
                      fontFamily={FONT}
                      fill={C.inkSoft}
                      listening={false}
                    />
                    {t.openRoles > 0 && (
                      <Text text={`${t.openRoles} open`} x={-tw / 2} y={32} width={tw} align="center" fontSize={19} fontStyle="bold" fontFamily={FONT} fill={C.utilOver} listening={false} />
                    )}
                    {ov.badge && (
                      <Text
                        text={ov.badge}
                        x={-tw / 2}
                        y={t.openRoles > 0 ? 58 : 32}
                        width={tw}
                        align="center"
                        fontSize={18}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={C.heat}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

            {showSquads &&
              squads.map((s, si) => {
                const st = squadStats.get(s.id);
                // Structural colour: a squad wears its value stream's identity.
                // External vendor squads keep violet — "who employs them" outranks
                // "which stream they serve" for reading the map.
                const accent = s.isCrossCutting
                  ? C.cross
                  : s.isExternal
                    ? C.external
                    : (hueOf.get(s.streamId) ?? C.squad);
                const inP = phase(introT, 0.12 + si * 0.04, 0.34);
                const gap = st && st.target != null ? st.target - Math.round(st.fte) : 0;
                const ov = squadOverlay(s);
                const r = squadR(s.id);
                const tw = r * 1.72; // keeps the widest line inside the circle, not just inside the bounding box
                const nameSize = clamp(Math.round(r * 0.215), 15, 24);
                const subSize = clamp(Math.round(r * 0.165), 12, 18);
                // Lay the label block out as one stack and centre it, so a name
                // that needs two lines pushes the stats down instead of sitting
                // on top of them.
                const perLine = Math.max(6, Math.floor(tw / (nameSize * 0.52)));
                const nameLines = clamp(Math.ceil(s.name.length / perLine), 1, 2);
                const nameH = nameLines * nameSize * 1.18;
                const lineH = subSize * 1.35;
                const rows = (st ? 1 : 0) + (gap > 0 ? 1 : 0) + (ov.badge ? 1 : 0);
                const yName = -(nameH + rows * lineH) / 2;
                const yStat = yName + nameH;
                const yGap = yStat + (st ? lineH : 0);
                const yBadge = yGap + (gap > 0 ? lineH : 0);
                return (
                  <Group
                    key={s.id}
                    x={s.x}
                    y={s.y}
                    opacity={(ov.dimmed ? 0.3 : 1) * inP}
                    scaleX={0.62 + 0.38 * inP}
                    scaleY={0.62 + 0.38 * inP}
                    draggable
                    onDragMove={(e) => onSquadDragMove(e, s)}
                    onDragEnd={(e) => onNodeDragEnd(e, s)}
                    onMouseEnter={() => showHover(s.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => selectNode(s.id)}
                    onTap={() => selectNode(s.id)}
                  >
                    {dropTargetId === s.id && (
                      <Circle radius={r + 14} fill={addMode ? C.cross : "#34d399"} opacity={0.2} listening={false} />
                    )}
                    <Circle
                      radius={r}
                      fill={C.white}
                      stroke={
                        dropTargetId === s.id ? (addMode ? C.cross : "#34d399") : selectedId === s.id ? C.ink : accent
                      }
                      strokeWidth={dropTargetId === s.id ? 5 : selectedId === s.id ? 6 : 4}
                      shadowColor={C.ink}
                      shadowBlur={22}
                      shadowOpacity={0.08}
                      shadowOffsetY={4}
                      perfectDrawEnabled={false}
                    />
                    {ov.heatPct > 0 && <Circle radius={r} fill={C.heat} opacity={ov.heatPct * 0.45} listening={false} />}
                    <Text text={s.name} x={-tw / 2} y={yName} width={tw} align="center" fontSize={nameSize} lineHeight={1.18} fontStyle="bold" fontFamily={FONT} fill={C.ink} listening={false} />
                    <Text
                      text={st ? `${st.heads} · ${st.fte.toFixed(1)} FTE` : ""}
                      x={-tw / 2}
                      y={yStat}
                      width={tw}
                      align="center"
                      fontSize={subSize}
                      fontFamily={FONT}
                      fill={C.inkSoft}
                      listening={false}
                    />
                    {gap > 0 && (
                      <Text text={`${gap} short`} x={-tw / 2} y={yGap} width={tw} align="center" fontSize={subSize} fontStyle="bold" fontFamily={FONT} fill={C.utilOver} listening={false} />
                    )}
                    {ov.badge && (
                      <Text
                        text={ov.badge}
                        x={-tw / 2}
                        y={yBadge}
                        width={tw}
                        align="center"
                        fontSize={subSize - 0.5}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={C.heat}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

            {/* Ghost seats — a borrowed seat for someone whose home is elsewhere.
                Dashed + smaller than a real seat; the wedge is this squad's
                share of them. Amber = shared inside this stream; indigo + an
                outer halo = shared across streams (they hold seats in another
                stream too). Person-level state (over-allocation, utilisation
                colour) lives on the person's panel, not on a borrowed seat. */}
            {showPeople && ghostSeats.map(({ person: p, alloc: a, gx, gy }, gi) => {
              const ov = personOverlay(p);
              const sel = selectedId === p.id;
              const spansStreams = p.crossCuttingTier === "stream";
              const accent = spansStreams ? C.crossStream : C.cross;
              // Settle outward from the squad they orbit, so the ring is seen forming.
              const home = byId.get(a.unitId);
              const inP = phase(introT, 0.34 + gi * 0.012, 0.34);
              const ix = home ? home.x + (gx - home.x) * inP : gx;
              const iy = home ? home.y + (gy - home.y) * inP : gy;
              return (
                <Group
                  key={`ghost-${p.id}-${a.unitId}`}
                  x={ix}
                  y={iy}
                  opacity={(ov.dimmed ? 0.28 : 1) * inP}
                  onClick={() => selectNode(p.id)}
                  onTap={() => selectNode(p.id)}
                  onMouseEnter={() => showHover(p.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  {spansStreams && (
                    <Circle radius={GHOST_R + 5.5} stroke={accent} strokeWidth={1.25} opacity={0.5} listening={false} />
                  )}
                  <Circle radius={GHOST_R} fill={C.white} />
                  <Arc
                    innerRadius={0}
                    outerRadius={GHOST_R - 2.5}
                    angle={(360 * clamp(a.pct, 0, 100)) / 100}
                    rotation={-90}
                    fill={accent}
                    opacity={0.18}
                    listening={false}
                  />
                  <Circle radius={GHOST_R} stroke={sel ? C.ink : accent} strokeWidth={sel ? 3.5 : 2.5} dash={[4, 4]} />
                  <Text
                    text={shortName(p.name)}
                    x={-56}
                    y={GHOST_R + 6}
                    width={112}
                    align="center"
                    fontSize={12}
                    fontFamily={FONT}
                    fill={C.inkSoft}
                    listening={false}
                  />
                  {lod === "roles" && (
                    <Text text={`${a.pct}%`} x={-56} y={GHOST_R + 21} width={112} align="center" fontSize={11} fontStyle="bold" fontFamily={FONT} fill={accent} listening={false} />
                  )}
                </Group>
              );
            })}

            {showPeople &&
              people.filter((p) => p.crossCuttingTier === null).map((p, pi) => {
                const u = utilOf(p);
                const shared = p.allocations.length > 1;
                const ov = personOverlay(p);
                const home = byId.get(p.homeId);
                const inP = phase(introT, 0.34 + pi * 0.012, 0.34);
                const ix = home ? home.x + (p.x - home.x) * inP : p.x;
                const iy = home ? home.y + (p.y - home.y) * inP : p.y;
                return (
                  <Group
                    key={p.id}
                    x={ix}
                    y={iy}
                    opacity={(ov.dimmed ? 0.3 : 1) * inP}
                    draggable
                    onDragMove={onPersonDragMove}
                    onDragEnd={(e) => onNodeDragEnd(e, p)}
                    onMouseEnter={() => showHover(p.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => selectNode(p.id)}
                    onTap={() => selectNode(p.id)}
                  >
                    <Circle radius={22} fill={C.white} stroke={selectedId === p.id ? C.ink : utilColor(u)} strokeWidth={shared ? 5 : 3.5} dash={shared ? [5, 3] : undefined} />
                    {u > 110 && <Circle radius={7} y={-1} fill={C.utilOver} listening={false} />}
                    <Text text={p.name} x={-70} y={28} width={140} align="center" fontSize={13} fontStyle="bold" fontFamily={FONT} fill={C.ink} listening={false} />
                    {lod === "roles" && (
                      <>
                        <Text text={p.title ?? ""} x={-70} y={44} width={140} align="center" fontSize={11.5} fontFamily={FONT} fill={C.inkSoft} listening={false} />
                        <Text
                          text={u > 0 ? `${u}%` : "—"}
                          x={-70}
                          y={58}
                          width={140}
                          align="center"
                          fontSize={11.5}
                          fontStyle="bold"
                          fontFamily={FONT}
                          fill={utilColor(u)}
                          listening={false}
                        />
                      </>
                    )}
                    {ov.badge && (
                      <Text
                        text={ov.badge}
                        x={-70}
                        y={lod === "roles" ? 74 : 44}
                        width={140}
                        align="center"
                        fontSize={11}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={C.heat}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}
          </Layer>
        </Stage>

        <div style={S.lodDock}>
          {LOD_LABELS.map(([id, label]) => (
            <span key={id} style={S.lodItem(lod === id)}>
              {label}
            </span>
          ))}
          <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>{scale.toFixed(2)}×</span>
        </div>

        <div style={S.legend}>
          <span>
            <i style={{ ...S.sw, background: C.utilOk }} /> ≤100%
          </span>
          <span>
            <i style={{ ...S.sw, background: C.utilWarn }} /> 100–110%
          </span>
          <span>
            <i style={{ ...S.sw, background: C.utilOver }} /> over
          </span>
          <span>
            <i style={{ ...S.sw, border: `2px dashed ${C.cross}`, background: "transparent" }} /> multiple squads
          </span>
          <span>
            <i style={{ ...S.sw, border: `2px dashed ${C.crossStream}`, background: "transparent" }} /> multiple value streams
          </span>
        </div>

        {hovered && hover && (
          <div style={{ ...S.bubble, left: hover.x, top: hover.y }}>
            <strong>{hovered.name}</strong>
            <span style={{ fontSize: 11.5, color: "#ffffffbf" }}>
              {hovered.kind === "person"
                ? `${hovered.title ?? ""} · ${utilOf(hovered) || "—"}${utilOf(hovered) ? "%" : ""}`
                : `${squadStats.get(hovered.id)?.heads ?? 0} people · ${money(squadStats.get(hovered.id)?.cost ?? 0)}/mo`}
            </span>
          </div>
        )}
      </div>

      <aside style={{ ...S.panel, transform: panelOpen ? "translateX(0)" : "translateX(105%)" }}>
        {panelOpen && (
          <>
            <div style={S.panelHead}>
              <div>
                <div style={S.panelType}>
                  {creating ? `New ${creating}` : selected?.kind === "person" ? "Person" : "Squad"}
                </div>
                <h2 style={{ margin: "2px 0 0", fontSize: 19 }}>
                  {creating ? (creating === "person" ? "Add person" : "Add squad") : selected?.name}
                </h2>
              </div>
              <button style={S.close} onClick={closePanel} aria-label="Close">
                ✕
              </button>
            </div>
            <div style={S.panelBody}>
              {creating === "person" && (
                <PersonForm mode="create" squads={squads} onSaved={closePanel} onCancel={closePanel} />
              )}
              {creating === "squad" && (
                <SquadForm mode="create" streams={realStreams} people={people} onSaved={closePanel} onCancel={closePanel} />
              )}
              {!creating && selected?.kind === "person" && !editing && (
                <PersonBody
                  person={selected}
                  byId={byId}
                  squads={squads}
                  onSelect={selectNode}
                  onEdit={() => setEditing(true)}
                />
              )}
              {!creating && selected?.kind === "person" && editing && (
                <PersonForm
                  mode="edit"
                  person={selected}
                  squads={squads}
                  onSaved={() => setEditing(false)}
                  onCancel={() => setEditing(false)}
                  onDeleted={closePanel}
                />
              )}
              {!creating && selected?.kind === "squad" && !editing && (
                <SquadBody
                  squad={selected}
                  stats={squadStats.get(selected.id)}
                  people={people}
                  onSelect={selectNode}
                  onEdit={() => setEditing(true)}
                />
              )}
              {!creating && selected?.kind === "squad" && editing && (
                <SquadForm
                  mode="edit"
                  squad={selected}
                  streams={realStreams}
                  people={people}
                  onSaved={() => setEditing(false)}
                  onCancel={() => setEditing(false)}
                  onDeleted={closePanel}
                />
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// --- panel bodies ----------------------------------------------------------
function PersonBody({
  person,
  byId,
  squads,
  onSelect,
  onEdit,
}: {
  person: CanvasPerson;
  byId: Map<string, CanvasNode>;
  squads: CanvasSquad[];
  onSelect: (id: string) => void;
  onEdit: () => void;
}) {
  const u = utilOf(person);
  const mgr = person.managerId ? byId.get(person.managerId) : null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: C.inkSoft, fontSize: 13 }}>{person.title}</div>
        <button style={S.editBtn} onClick={onEdit}>
          Edit
        </button>
      </div>
      <Meter label="Delivery load" value={u} />
      <Assignments person={person} byId={byId} squads={squads} onSelect={onSelect} />
      <Section title="Facts">
        <div style={S.facts}>
          <Fact label="Cost / mo" value={money(person.costPerMonth)} />
          <Fact label="Reports to" value={mgr?.name ?? "—"} />
          <Fact label="Started" value={person.startDate ?? "—"} />
          <Fact label="Last leave" value={person.lastVacationAt ?? "—"} />
        </div>
      </Section>
      {person.skills.length > 0 && (
        <Section title="Skills">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {person.skills.map((s) => (
              <span key={s} style={S.tag}>
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function SquadBody({
  squad,
  stats,
  people,
  onSelect,
  onEdit,
}: {
  squad: CanvasSquad;
  stats: SquadStats | undefined;
  people: CanvasPerson[];
  onSelect: (id: string) => void;
  onEdit: () => void;
}) {
  const members = squad.isCrossCutting
    ? people.filter((p) => p.homeId === squad.id)
    : people.filter((p) => p.allocations.some((a) => a.unitId === squad.id));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: C.inkSoft, fontSize: 13 }}>
          {squad.streamName}
          {squad.vendorName ? ` · ${squad.vendorName}` : ""}
        </div>
        {!squad.isCrossCutting && (
          <button style={S.editBtn} onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      <Section title="Facts">
        <div style={S.facts}>
          <Fact label="People" value={String(stats?.heads ?? 0)} />
          <Fact label="FTE" value={(stats?.fte ?? 0).toFixed(1)} />
          <Fact label="Cost / mo" value={money(stats?.cost ?? 0)} />
          <Fact label="Target" value={squad.targetHeadcount?.toString() ?? "—"} />
          <Fact label="Open roles" value={String(squad.openRoles)} tone={squad.openRoles ? C.utilOver : undefined} />
          <Fact label="Shared in" value={String(stats?.shared ?? 0)} />
        </div>
      </Section>
      <Section title={`People (${members.length})`}>
        <ul style={S.list}>
          {members.map((p) => {
            const a = p.allocations.find((x) => x.unitId === squad.id);
            return (
              <li key={p.id} style={{ ...S.li, cursor: "pointer" }} onClick={() => onSelect(p.id)}>
                <span style={{ ...S.sw, background: utilColor(utilOf(p)) }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>
                  {a ? `${a.role} · ${a.pct}%` : `${utilOf(p)}% total`}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// --- panel forms: create/edit person or squad -------------------------------
type PersonFormState = {
  name: string;
  title: string;
  squadId: string;
  costPerMonth: string;
  skills: string;
  startDate: string;
  lastVacationAt: string;
  growthFocus: string;
};

const emptyPersonForm: PersonFormState = {
  name: "",
  title: "",
  squadId: "",
  costPerMonth: "",
  skills: "",
  startDate: "",
  lastVacationAt: "",
  growthFocus: "",
};

/** The assignment drag-to-reassign would move: the highest-% one. */
function personHomeAllocation(p: CanvasPerson) {
  if (p.allocations.length === 0) return null;
  return [...p.allocations].sort((a, b) => b.pct - a.pct)[0];
}

function personToForm(p: CanvasPerson): PersonFormState {
  return {
    name: p.name,
    title: p.title ?? "",
    squadId: personHomeAllocation(p)?.unitId ?? "",
    costPerMonth: p.costPerMonth ? String(p.costPerMonth) : "",
    skills: p.skills.join(", "),
    startDate: p.startDate ?? "",
    lastVacationAt: p.lastVacationAt ?? "",
    growthFocus: p.growthFocus ?? "",
  };
}

function PersonForm({
  mode,
  person,
  squads,
  onSaved,
  onCancel,
  onDeleted,
}: {
  mode: "create" | "edit";
  person?: CanvasPerson;
  squads: CanvasSquad[];
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PersonFormState>(person ? personToForm(person) : emptyPersonForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const home = person ? personHomeAllocation(person) : null;
  const realSquads = squads.filter((s) => !s.isCrossCutting);

  function submit() {
    setError(null);
    startTransition(async () => {
      const { squadId, ...personFields } = form;
      let personId: string;
      if (mode === "edit" && person) {
        const res = await updatePerson(person.id, personFields);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        personId = person.id;
      } else {
        const res = await createPerson(personFields);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        personId = res.data.id;
      }

      const currentSquadId = home?.unitId ?? "";
      if (squadId !== currentSquadId) {
        if (squadId && home) {
          await moveAssignment(home.assignmentId, squadId);
        } else if (squadId && !home) {
          await createAssignment({
            orgUnitId: squadId,
            personId,
            roleOnTeam: "",
            allocationPct: 100,
            isOpenRole: false,
          });
        } else if (!squadId && home) {
          await deleteAssignment(home.assignmentId);
        }
      }

      router.refresh();
      onSaved();
    });
  }

  function remove() {
    if (!person) return;
    if (!confirm("Delete this person? Their assignments are removed too.")) return;
    startTransition(async () => {
      await deletePerson(person.id);
      router.refresh();
      onDeleted?.();
    });
  }

  return (
    <>
      <label style={S.formLabel}>Name *</label>
      <input style={S.formInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label style={S.formLabel}>Title</label>
      <input style={S.formInput} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <label style={S.formLabel}>Squad</label>
      <select
        style={S.formInput}
        value={form.squadId}
        onChange={(e) => setForm({ ...form, squadId: e.target.value })}
      >
        <option value="">— unassigned —</option>
        {realSquads.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {person && person.allocations.length > 1 && (
        <p style={S.formHint}>
          {person.name} is on {person.allocations.length} teams — this changes only their primary
          (highest-%) assignment, same as dragging their dot.
        </p>
      )}
      <label style={S.formLabel}>Cost / month ($)</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={form.costPerMonth}
        onChange={(e) => setForm({ ...form, costPerMonth: e.target.value })}
      />
      <label style={S.formLabel}>Skills (comma separated)</label>
      <input style={S.formInput} value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
      <label style={S.formLabel}>Start date (YYYY-MM-DD)</label>
      <input
        style={S.formInput}
        placeholder="YYYY-MM-DD"
        value={form.startDate}
        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
      />
      <label style={S.formLabel}>Last vacation (YYYY-MM-DD)</label>
      <input
        style={S.formInput}
        placeholder="YYYY-MM-DD"
        value={form.lastVacationAt}
        onChange={(e) => setForm({ ...form, lastVacationAt: e.target.value })}
      />
      <label style={S.formLabel}>Growth focus</label>
      <input
        style={S.formInput}
        value={form.growthFocus}
        onChange={(e) => setForm({ ...form, growthFocus: e.target.value })}
      />

      {error && <p style={S.formError}>{error}</p>}

      <div style={S.formActions}>
        <button style={S.applyBtn} onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create person"}
        </button>
        <button style={S.discardBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {mode === "edit" && (
        <button style={S.dangerBtn} onClick={remove} disabled={pending}>
          Delete person
        </button>
      )}
    </>
  );
}

type SquadFormState = {
  name: string;
  streamId: string;
  leadPersonId: string;
  targetHeadcount: string;
  costPerMonth: string;
  expectedRoi: string;
  isExternal: boolean;
  vendorName: string;
};

function emptySquadForm(streams: CanvasStream[]): SquadFormState {
  return {
    name: "",
    streamId: streams[0]?.id ?? "",
    leadPersonId: "",
    targetHeadcount: "",
    costPerMonth: "",
    expectedRoi: "",
    isExternal: false,
    vendorName: "",
  };
}

// Assumes the squad's real parentId is its stream directly — true today (the
// demo org has no sub-group nesting between stream and team; see the "Sub-groups"
// story in docs/ROADMAP.md). Revisit if that nesting lands.
function squadToForm(s: CanvasSquad): SquadFormState {
  return {
    name: s.name,
    streamId: s.streamId,
    leadPersonId: s.leadPersonId ?? "",
    targetHeadcount: s.targetHeadcount != null ? String(s.targetHeadcount) : "",
    costPerMonth: s.costPerMonth != null ? String(s.costPerMonth) : "",
    expectedRoi: s.expectedRoi != null ? String(s.expectedRoi) : "",
    isExternal: s.isExternal,
    vendorName: s.vendorName ?? "",
  };
}

function SquadForm({
  mode,
  squad,
  streams,
  people,
  onSaved,
  onCancel,
  onDeleted,
}: {
  mode: "create" | "edit";
  squad?: CanvasSquad;
  streams: CanvasStream[];
  people: CanvasPerson[];
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SquadFormState>(squad ? squadToForm(squad) : emptySquadForm(streams));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!form.streamId) {
      setError("Choose a value stream");
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload = {
        name: form.name,
        kind: "team" as const,
        parentId: form.streamId,
        leadPersonId: form.leadPersonId,
        targetHeadcount: form.targetHeadcount,
        costPerMonth: form.costPerMonth,
        expectedRoi: form.expectedRoi,
        isExternal: form.isExternal,
        vendorName: form.vendorName,
      };
      const res =
        mode === "edit" && squad ? await updateOrgUnit(squad.id, payload) : await createOrgUnit(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onSaved();
    });
  }

  function remove() {
    if (!squad) return;
    if (!confirm(`Delete "${squad.name}" and its assignments?`)) return;
    startTransition(async () => {
      await deleteOrgUnit(squad.id);
      router.refresh();
      onDeleted?.();
    });
  }

  return (
    <>
      <label style={S.formLabel}>Name *</label>
      <input style={S.formInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label style={S.formLabel}>Value stream *</label>
      <select
        style={S.formInput}
        value={form.streamId}
        onChange={(e) => setForm({ ...form, streamId: e.target.value })}
      >
        {streams.length === 0 && <option value="">No value streams yet</option>}
        {streams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Lead</label>
      <select
        style={S.formInput}
        value={form.leadPersonId}
        onChange={(e) => setForm({ ...form, leadPersonId: e.target.value })}
      >
        <option value="">— none —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Target headcount</label>
      <input
        style={S.formInput}
        inputMode="numeric"
        value={form.targetHeadcount}
        onChange={(e) => setForm({ ...form, targetHeadcount: e.target.value })}
      />
      <label style={S.formLabel}>Unit cost / month ($)</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={form.costPerMonth}
        onChange={(e) => setForm({ ...form, costPerMonth: e.target.value })}
      />
      <label style={S.formLabel}>Expected ROI ($)</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={form.expectedRoi}
        onChange={(e) => setForm({ ...form, expectedRoi: e.target.value })}
      />
      <div style={S.formCheckboxRow}>
        <input
          type="checkbox"
          id="squad-external"
          checked={form.isExternal}
          onChange={(e) => setForm({ ...form, isExternal: e.target.checked })}
        />
        <label htmlFor="squad-external">External / vendor team</label>
      </div>
      {form.isExternal && (
        <>
          <label style={S.formLabel}>Vendor name</label>
          <input
            style={S.formInput}
            value={form.vendorName}
            onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
          />
        </>
      )}

      {error && <p style={S.formError}>{error}</p>}

      <div style={S.formActions}>
        <button style={S.applyBtn} onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create squad"}
        </button>
        <button style={S.discardBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {mode === "edit" && (
        <button style={S.dangerBtn} onClick={remove} disabled={pending}>
          Delete squad
        </button>
      )}
    </>
  );
}

/**
 * Editable team memberships for one person. This is the only place in the map
 * where you can put someone on a *second* team — dragging a dot and the Edit
 * form's Squad picker both *move* the primary assignment rather than adding to
 * it, which is why a multi-team person previously could only be created from
 * /teams or an import.
 */
function Assignments({
  person,
  byId,
  squads,
  onSelect,
}: {
  person: CanvasPerson;
  byId: Map<string, CanvasNode>;
  squads: CanvasSquad[];
  onSelect: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addSquad, setAddSquad] = useState("");
  const [addPct, setAddPct] = useState("20");

  const taken = new Set(person.allocations.map((a) => a.unitId));
  const options = squads.filter((s) => !s.isCrossCutting && !taken.has(s.id));
  const total = utilOf(person);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  };

  return (
    <Section title="Teams">
      {person.allocations.length === 0 ? (
        <p style={S.empty}>No delivery allocation — leadership or unassigned.</p>
      ) : (
        <ul style={S.list}>
          {person.allocations.map((a) => (
            <li key={a.assignmentId} style={S.li}>
              <button style={S.linkish} onClick={() => onSelect(a.unitId)} title="Show on map">
                {byId.get(a.unitId)?.name ?? a.unitId}
              </button>
              <input
                type="number"
                min={1}
                max={100}
                defaultValue={a.pct}
                disabled={pending}
                style={S.pctInput}
                aria-label={`Allocation % on ${byId.get(a.unitId)?.name ?? "team"}`}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next) || next === a.pct) return;
                  run(() => updateAssignment(a.assignmentId, { allocationPct: next }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span style={{ color: C.inkSoft }}>%</span>
              <button
                style={S.rowX}
                disabled={pending}
                onClick={() => run(() => deleteAssignment(a.assignmentId))}
                aria-label={`Remove from ${byId.get(a.unitId)?.name ?? "team"}`}
                title="Remove from this team"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {person.allocations.length > 0 && (
        <div style={{ ...S.allocTotal, color: total > 100 ? C.utilOver : C.inkSoft }}>
          {total}% allocated{total > 100 ? " — over-allocated" : ""}
        </div>
      )}

      {adding ? (
        <div style={S.addRow}>
          <select
            style={{ ...S.formInput, flex: 1 }}
            value={addSquad}
            onChange={(e) => setAddSquad(e.target.value)}
          >
            <option value="">Choose a team…</option>
            {options.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={100}
            value={addPct}
            onChange={(e) => setAddPct(e.target.value)}
            style={S.pctInput}
            aria-label="Allocation %"
          />
          <span style={{ color: C.inkSoft }}>%</span>
          <button
            style={S.editBtn}
            disabled={pending || !addSquad}
            onClick={() =>
              run(async () => {
                const res = await createAssignment({
                  orgUnitId: addSquad,
                  personId: person.id,
                  roleOnTeam: person.title ?? "",
                  allocationPct: addPct,
                  isOpenRole: false,
                });
                if (res.ok) {
                  setAdding(false);
                  setAddSquad("");
                  setAddPct("20");
                }
                return res;
              })
            }
          >
            Add
          </button>
          <button style={S.rowX} onClick={() => setAdding(false)} aria-label="Cancel">
            ✕
          </button>
        </div>
      ) : (
        options.length > 0 && (
          <button style={S.addBtn} onClick={() => setAdding(true)}>
            + Add to another team
          </button>
        )
      )}
      {error && <p style={{ ...S.empty, color: C.utilOver }}>{error}</p>}
      <p style={{ ...S.empty, marginTop: 8, fontSize: 11.5 }}>
        Tip: hold ⌥ while dragging someone onto a squad to add that team instead of moving them.
      </p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={S.h3}>{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={S.fact}>
      <div style={S.factLabel}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: tone ?? C.ink }}>{value}</div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: C.inkSoft }}>{label}</span>
        <strong style={{ color: utilColor(value) }}>{value ? `${value}%` : "—"}</strong>
      </div>
      <div style={S.track}>
        <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(value, 150) / 1.5}%`, background: utilColor(value) }} />
      </div>
    </div>
  );
}

// --- styles ------------------------------------------------------------------
const S = {
  root: {
    position: "relative" as const,
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT,
    overflow: "hidden",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 10,
    padding: "10px 16px",
    borderBottom: `1px solid ${C.line}`,
    zIndex: 20,
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: C.ink,
    marginRight: 6,
  },
  viewLink: {
    fontSize: 13,
    fontWeight: 600,
    color: C.inkSoft,
    textDecoration: "none",
  },
  btn: {
    minWidth: 40,
    height: 40,
    padding: "0 12px",
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    background: C.white,
    color: C.ink,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  overlayGroup: {
    display: "flex",
    gap: 4,
    paddingLeft: 12,
    marginLeft: 4,
    borderLeft: `1px solid ${C.line}`,
  },
  overlayBtn: (active: boolean) => ({
    height: 34,
    padding: "0 11px",
    borderRadius: 8,
    border: `1px solid ${active ? C.ink : "transparent"}`,
    background: active ? C.ink : "transparent",
    color: active ? C.white : C.inkSoft,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  }),
  scenarioBtn: (active: boolean) => ({
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${active ? C.squad : C.line}`,
    background: active ? C.squad : C.white,
    color: active ? C.white : C.ink,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  }),
  pendingPill: {
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "#047857",
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: 999,
    padding: "7px 11px",
    whiteSpace: "nowrap" as const,
  },
  applyBtn: {
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: "none",
    background: C.squad,
    color: C.white,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  discardBtn: {
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: "transparent",
    color: C.ink,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  editBtn: {
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${C.line}`,
    background: C.white,
    color: C.ink,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  formLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: C.inkSoft,
    marginTop: 14,
    marginBottom: 5,
  },
  formInput: {
    width: "100%",
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: C.paper,
    padding: "8px 10px",
    fontSize: 13.5,
    fontFamily: FONT,
    color: C.ink,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  formCheckboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    fontSize: 13,
    color: C.ink,
  },
  formError: {
    marginTop: 12,
    fontSize: 12.5,
    color: "#dc2626",
  },
  formHint: {
    marginTop: 6,
    marginBottom: 0,
    fontSize: 11.5,
    color: C.inkSoft,
    lineHeight: 1.4,
  },
  formActions: {
    display: "flex",
    gap: 8,
    marginTop: 20,
  },
  dangerBtn: {
    marginTop: 14,
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "transparent",
    color: "#dc2626",
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  canvasWrap: { position: "relative" as const, flex: 1, overflow: "hidden", touchAction: "none" as const },
  lodDock: {
    position: "absolute" as const,
    right: 14,
    bottom: 14,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    background: "#ffffffeb",
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
  },
  lodItem: (on: boolean) => ({
    color: on ? C.ink : "#b6bcc4",
    borderBottom: on ? `2px solid ${C.cross}` : "2px solid transparent",
    paddingBottom: 1,
  }),
  legend: {
    position: "absolute" as const,
    left: 14,
    bottom: 14,
    display: "flex",
    gap: 14,
    padding: "10px 14px",
    background: "#ffffffeb",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    fontSize: 11.5,
    color: C.inkSoft,
    pointerEvents: "none" as const,
  },
  sw: { display: "inline-block", width: 10, height: 10, borderRadius: "50%", marginRight: 5, verticalAlign: "middle" },
  bubble: {
    position: "absolute" as const,
    transform: "translate(-50%, calc(-100% - 14px))",
    background: C.ink,
    color: C.white,
    padding: "8px 12px",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    pointerEvents: "none" as const,
    fontSize: 13,
    whiteSpace: "nowrap" as const,
    zIndex: 35,
  },
  panel: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: "min(360px, 88vw)",
    background: C.white,
    borderLeft: `1px solid ${C.line}`,
    display: "flex",
    flexDirection: "column" as const,
    transition: "transform .28s cubic-bezier(.32,.72,.3,1)",
    boxShadow: "-8px 0 24px #22272e0f",
    zIndex: 40,
  },
  panelHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 20px 12px", borderBottom: `1px solid ${C.line}` },
  panelType: { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: C.inkSoft },
  panelBody: { padding: "16px 20px 24px", overflowY: "auto" as const },
  close: { width: 36, height: 36, borderRadius: "50%", border: "none", background: C.paper, color: C.ink, fontSize: 14, cursor: "pointer" },
  h3: { margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: C.inkSoft },
  facts: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" },
  fact: { background: C.paper, borderRadius: 10, padding: "9px 12px" },
  factLabel: { fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: C.inkSoft, marginBottom: 2 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  li: { display: "flex", alignItems: "center", gap: 9, padding: "10px 8px", borderRadius: 10, minHeight: 44, fontSize: 13.5 },
  tag: { background: C.paper, borderRadius: 999, padding: "4px 10px", fontSize: 12, color: C.inkSoft },
  track: { height: 8, borderRadius: 999, background: C.paper, overflow: "hidden", marginTop: 6 },
  empty: { margin: 0, fontSize: 13, color: C.inkSoft },
  linkish: {
    flex: 1,
    textAlign: "left" as const,
    border: "none",
    background: "transparent",
    padding: 0,
    font: "inherit",
    fontSize: 13.5,
    color: C.ink,
    cursor: "pointer",
  },
  pctInput: {
    width: 54,
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: C.paper,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.ink,
    textAlign: "right" as const,
    outline: "none",
  },
  rowX: {
    width: 26,
    height: 26,
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: C.inkSoft,
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  allocTotal: { marginTop: 6, fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" as const },
  addRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 10 },
  addBtn: {
    marginTop: 10,
    width: "100%",
    height: 36,
    borderRadius: 10,
    border: `1px dashed ${C.line}`,
    background: "transparent",
    color: C.inkSoft,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
};
