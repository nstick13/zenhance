"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Group, Circle, Rect, Line, Text } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  seedNodes,
  trains,
  type MapNode,
  type PersonNode,
  type SquadNode,
} from "./demoMap";

/**
 * v2 canvas map — lab sandbox (docs/LAB.md).
 *
 * Proving four things the shipped radial map (components/viz/RadialOrg.tsx)
 * structurally cannot do, before we commit to rebuilding /org around them:
 *
 *   1. Canvas rendering (Konva) — 60fps pan / pinch / node-drag on an iPad,
 *      where SVG + d3 starts dropping frames at this node count.
 *   2. Free-form placement — position is *data*, not the output of a layout
 *      algorithm. You put Atlas over there and it stays there.
 *   3. A four-rung semantic-zoom ladder (Trains → Squads → People → Roles)
 *      rather than the current two-level bloom.
 *   4. Zones — drag a box over a region of the map and get its bill:
 *      headcount, FTE, monthly cost, open roles. Spatial selection as a query.
 *
 * Mock data only; no DB, no auth, no imports from real components.
 */

// --- palette ---------------------------------------------------------------
// Light, flat, no-glow — the "Mini Metro" theme in docs/ROADMAP.md, and the
// register Greg's prototype uses. Deliberately not the shipped dark palettes.
const C = {
  paper: "#f6f4ee",
  ink: "#22272e",
  inkSoft: "#5c6570",
  line: "#e4e0d6",
  white: "#ffffff",
  squad: "#10b981",
  person: "#6b7280",
  cross: "#f59e0b",
  external: "#8b5cf6",
  edgeDelivery: "#10b981",
  edgeReporting: "#3b82f6",
  utilOk: "#22c55e",
  utilWarn: "#eab308",
  utilOver: "#ef4444",
  match: "#f59e0b",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

// --- semantic zoom ladder --------------------------------------------------
type Lod = "trains" | "squads" | "people" | "roles";

const LOD_LABELS: [Lod, string][] = [
  ["trains", "Trains"],
  ["squads", "Squads"],
  ["people", "People"],
  ["roles", "Roles"],
];

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

function lodFor(scale: number): Lod {
  if (scale >= 1.5) return "roles";
  if (scale >= 0.45) return "people";
  if (scale >= 0.26) return "squads";
  return "trains";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- derived metrics -------------------------------------------------------
/** Delivery load = the sum of a person's allocations across every team. */
const utilOf = (p: PersonNode) => p.allocations.reduce((s, a) => s + a.pct, 0);

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
      : `$${n}`;

type SquadStats = {
  /** Distinct people touching this squad, however small their slice. */
  heads: number;
  /** Full-time equivalents actually committed. */
  fte: number;
  /** Monthly cost, pro-rated by allocation. */
  cost: number;
  openRoles: number;
  target: number | null;
  /** People whose biggest seat is elsewhere. */
  shared: number;
};

export default function CanvasMap() {
  const [nodes, setNodes] = useState<MapNode[]>(seedNodes);
  const [scale, setScale] = useState(0.3);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [layers, setLayers] = useState({ delivery: true, reporting: false });
  const [zoneMode, setZoneMode] = useState(false);
  const [zone, setZone] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ dist: number; center: { x: number; y: number } } | null>(null);

  const lod = lodFor(scale);

  // --- indexes -------------------------------------------------------------
  const squads = useMemo(
    () => nodes.filter((n): n is SquadNode => n.kind === "squad"),
    [nodes],
  );
  const people = useMemo(
    () => nodes.filter((n): n is PersonNode => n.kind === "person"),
    [nodes],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const squadStats = useMemo(() => {
    const m = new Map<string, SquadStats>();
    for (const s of squads) {
      m.set(s.id, {
        heads: 0,
        fte: 0,
        cost: 0,
        openRoles: s.openRoles,
        target: s.targetHeadcount,
        shared: 0,
      });
    }
    for (const p of people) {
      for (const a of p.allocations) {
        const st = m.get(a.unit);
        if (!st) continue;
        st.heads += 1;
        st.fte += a.pct / 100;
        st.cost += (p.costPerMonth * a.pct) / 100;
        if (p.homeId !== a.unit) st.shared += 1;
      }
    }
    // People with no delivery allocation (leadership) still occupy their home.
    for (const p of people) {
      if (p.allocations.length === 0) {
        const st = m.get(p.homeId);
        if (st) {
          st.heads += 1;
          st.cost += p.costPerMonth;
        }
      }
    }
    return m;
  }, [squads, people]);

  /** Train nodes are computed, not stored — the centroid of their squads. */
  const trainAgg = useMemo(() => {
    return trains
      .map((t) => {
        const own = squads.filter((s) => s.train === t.name);
        if (own.length === 0) return null;
        const cx = own.reduce((s, n) => s + n.x, 0) / own.length;
        const cy = own.reduce((s, n) => s + n.y, 0) / own.length;
        const radius =
          own.reduce((r, n) => Math.max(r, Math.hypot(n.x - cx, n.y - cy)), 0) + 230;
        let heads = 0;
        let fte = 0;
        let cost = 0;
        let openRoles = 0;
        for (const s of own) {
          const st = squadStats.get(s.id);
          if (!st) continue;
          heads += st.heads;
          fte += st.fte;
          cost += st.cost;
          openRoles += st.openRoles;
        }
        return { ...t, x: cx, y: cy, radius, heads, fte, cost, openRoles, squads: own.length };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }, [squads, squadStats]);

  // --- search: matches get an additive halo, not just everyone-else-dims.
  // (docs/ROADMAP.md records that dim-only was illegible on a touch glance.)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    for (const n of nodes) {
      const hay =
        n.kind === "person"
          ? `${n.name} ${n.title} ${n.skills.join(" ")}`
          : `${n.name} ${n.train} ${n.vendorName ?? ""}`;
      if (hay.toLowerCase().includes(q)) hit.add(n.id);
    }
    return hit;
  }, [nodes, query]);

  // --- edges ---------------------------------------------------------------
  const edges = useMemo(() => {
    if (lod === "trains" || lod === "squads") return [];
    const out: { key: string; pts: number[]; color: string; dash?: number[]; dim: boolean }[] = [];
    for (const p of people) {
      if (layers.delivery) {
        for (const a of p.allocations) {
          const s = byId.get(a.unit);
          if (!s) continue;
          out.push({
            key: `d-${p.id}-${a.unit}`,
            pts: [p.x, p.y, s.x, s.y],
            color: C.edgeDelivery,
            dash: [2, 8],
            dim: !!matches && !matches.has(p.id) && !matches.has(a.unit),
          });
        }
      }
      if (layers.reporting && p.managerId) {
        const m = byId.get(p.managerId);
        if (!m) continue;
        out.push({
          key: `r-${p.id}`,
          pts: [p.x, p.y, m.x, m.y],
          color: C.edgeReporting,
          dim: !!matches && !matches.has(p.id) && !matches.has(p.managerId),
        });
      }
    }
    return out;
  }, [people, byId, layers, lod, matches]);

  // --- zone readout: spatial selection as a query --------------------------
  const zoneStats = useMemo(() => {
    if (!zone) return null;
    const inside = (n: MapNode) =>
      n.x >= zone.x && n.x <= zone.x + zone.w && n.y >= zone.y && n.y <= zone.y + zone.h;
    const ps = people.filter(inside);
    const ss = squads.filter(inside);
    const cost = ps.reduce((s, p) => s + p.costPerMonth, 0);
    const fte = ps.reduce((s, p) => s + Math.min(100, utilOf(p) || 100) / 100, 0);
    const over = ps.filter((p) => utilOf(p) > 100).length;
    const openRoles = ss.reduce((s, n) => s + n.openRoles, 0);
    return { people: ps.length, squads: ss.length, cost, fte, over, openRoles };
  }, [zone, people, squads]);

  // --- sizing --------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || size.w === 0) return;
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
    stage.position({
      x: size.w / 2 - ((minX + maxX) / 2) * s,
      y: size.h / 2 - ((minY + maxY) / 2) * s,
    });
    stage.batchDraw();
    setScale(s);
  }, [nodes, size]);

  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || size.w === 0) return;
    didFit.current = true;
    fit();
  }, [fit, size]);

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

  // --- pointer -------------------------------------------------------------
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

  const worldPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const p = stage.getPointerPosition();
    if (!p) return null;
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
  }, []);

  // Two-finger pinch. Konva's stage drag handles one-finger pan.
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

  // --- zone drawing --------------------------------------------------------
  const onStageDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!zoneMode) return;
      if (e.target !== e.target.getStage()) return;
      const w = worldPos();
      if (!w) return;
      drawStart.current = w;
      setDraft({ x: w.x, y: w.y, w: 0, h: 0 });
    },
    [zoneMode, worldPos],
  );

  const onStageMove = useCallback(() => {
    if (!zoneMode || !drawStart.current) return;
    const w = worldPos();
    if (!w) return;
    const s = drawStart.current;
    setDraft({
      x: Math.min(s.x, w.x),
      y: Math.min(s.y, w.y),
      w: Math.abs(w.x - s.x),
      h: Math.abs(w.y - s.y),
    });
  }, [zoneMode, worldPos]);

  const onStageUp = useCallback(() => {
    if (!zoneMode || !drawStart.current) return;
    drawStart.current = null;
    setDraft((d) => {
      if (d && d.w > 30 && d.h > 30) {
        setZone(d);
        setZoneMode(false);
      }
      return null;
    });
  }, [zoneMode]);

  // --- drag: reposition, and drop-on-squad to re-home ----------------------
  const nearestSquad = useCallback(
    (x: number, y: number, exclude: string) => {
      let best: { id: string; d: number } | null = null;
      for (const s of squads) {
        if (s.id === exclude) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < 120 && (!best || d < best.d)) best = { id: s.id, d };
      }
      return best?.id ?? null;
    },
    [squads],
  );

  const onNodeDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>, node: MapNode) => {
      if (node.kind !== "person") return;
      setDropTarget(nearestSquad(e.target.x(), e.target.y(), node.homeId));
    },
    [nearestSquad],
  );

  const onNodeDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>, node: MapNode) => {
      const x = e.target.x();
      const y = e.target.y();
      const target =
        node.kind === "person" ? nearestSquad(x, y, node.homeId) : null;
      setDropTarget(null);
      const before = nodes;
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== node.id) return n;
          if (n.kind === "person" && target) {
            // Move the majority seat to the squad they were dropped on. The
            // supporting slices stay put — that is the whole point of the
            // delivery layer.
            const majority = [...n.allocations].sort((a, b) => b.pct - a.pct)[0];
            const allocations = majority
              ? n.allocations.map((a) =>
                  a.unit === majority.unit ? { ...a, unit: target } : a,
                )
              : [{ unit: target, role: n.title, pct: 100 }];
            return { ...n, x, y, homeId: target, allocations };
          }
          return { ...n, x, y };
        }),
      );
      if (target) {
        const s = byId.get(target);
        setToast({
          text: `${node.name} → ${s?.name ?? target}`,
          undo: () => {
            setNodes(before);
            setToast(null);
          },
        });
      }
    },
    [nodes, byId, nearestSquad],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // --- hover bubble --------------------------------------------------------
  const showHover = useCallback((id: string) => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return;
    setHover({ id, x: p.x, y: p.y });
  }, []);

  const selected = selectedId ? byId.get(selectedId) : null;
  const hovered = hover ? byId.get(hover.id) : null;

  const dimOf = (id: string) => (matches && !matches.has(id) ? 0.16 : 1);
  const isMatch = (id: string) => !!matches && matches.has(id);

  const showSquads = lod !== "trains";
  const showPeople = lod === "people" || lod === "roles";

  return (
    <div style={S.root}>
      <header style={S.topbar}>
        <div style={S.brand}>
          <span style={S.dot} />
          <strong style={{ fontSize: 16, letterSpacing: "0.01em" }}>Zenhance</strong>
          <span style={S.badge}>v2 canvas lab</span>
        </div>
        <input
          style={S.search}
          type="search"
          value={query}
          placeholder="Search people, squads, skills"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the map"
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            style={S.chip(layers.delivery, C.edgeDelivery)}
            onClick={() => setLayers((l) => ({ ...l, delivery: !l.delivery }))}
          >
            Delivery
          </button>
          <button
            style={S.chip(layers.reporting, C.edgeReporting)}
            onClick={() => setLayers((l) => ({ ...l, reporting: !l.reporting }))}
          >
            Reporting
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            style={S.chip(zoneMode, C.cross)}
            onClick={() => {
              setZoneMode((z) => !z);
              setZone(null);
            }}
          >
            ◱ Zone
          </button>
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
          draggable={!zoneMode}
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={onStageDown}
          onTouchStart={onStageDown}
          onMouseMove={onStageMove}
          onMouseUp={onStageUp}
          style={{ cursor: zoneMode ? "crosshair" : "grab" }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) setSelectedId(null);
          }}
        >
          {/* Train hulls — the cluster a squad belongs to, always behind. */}
          <Layer listening={false}>
            {trainAgg.map((t) => (
              <Group key={`hull-${t.id}`} x={t.x} y={t.y}>
                <Circle
                  radius={t.radius}
                  fill={C.white}
                  opacity={showSquads ? 0.55 : 0}
                  stroke={C.line}
                  strokeWidth={2 / scale}
                  perfectDrawEnabled={false}
                />
                {showSquads && (
                  <Text
                    text={t.name.toUpperCase()}
                    x={-t.radius}
                    y={-t.radius + 24}
                    width={t.radius * 2}
                    align="center"
                    fontSize={34}
                    fontStyle="bold"
                    fontFamily={FONT}
                    fill={C.inkSoft}
                    opacity={0.45}
                  />
                )}
              </Group>
            ))}
          </Layer>

          {/* Edges */}
          <Layer listening={false}>
            {edges.map((e) => (
              <Line
                key={e.key}
                points={e.pts}
                stroke={e.color}
                strokeWidth={1.6 / scale}
                dash={e.dash?.map((d) => d / scale)}
                opacity={e.dim ? 0.05 : 0.34}
                perfectDrawEnabled={false}
                shadowForStrokeEnabled={false}
              />
            ))}
          </Layer>

          {/* Zone */}
          <Layer listening={false}>
            {(draft ?? zone) && (
              <Rect
                {...(draft ?? zone)!}
                fill={`${C.cross}14`}
                stroke={C.cross}
                strokeWidth={2 / scale}
                dash={[8 / scale, 6 / scale]}
              />
            )}
          </Layer>

          {/* Nodes */}
          <Layer>
            {/* Trains rung: one mark per cluster, nothing else. */}
            {!showSquads &&
              trainAgg.map((t) => (
                <Group
                  key={t.id}
                  x={t.x}
                  y={t.y}
                  onMouseEnter={() => showHover(t.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <Circle radius={150} fill={C.white} stroke={C.ink} strokeWidth={5} />
                  <Text
                    text={t.name}
                    x={-140}
                    y={-42}
                    width={280}
                    align="center"
                    fontSize={34}
                    fontStyle="bold"
                    fontFamily={FONT}
                    fill={C.ink}
                    listening={false}
                  />
                  <Text
                    text={`${t.heads} people · ${money(Math.round(t.cost))}/mo`}
                    x={-140}
                    y={4}
                    width={280}
                    align="center"
                    fontSize={20}
                    fontFamily={FONT}
                    fill={C.inkSoft}
                    listening={false}
                  />
                  {t.openRoles > 0 && (
                    <Text
                      text={`${t.openRoles} open`}
                      x={-140}
                      y={32}
                      width={280}
                      align="center"
                      fontSize={19}
                      fontStyle="bold"
                      fontFamily={FONT}
                      fill={C.utilOver}
                      listening={false}
                    />
                  )}
                </Group>
              ))}

            {/* Squads rung */}
            {showSquads &&
              squads.map((s) => {
                const st = squadStats.get(s.id);
                const accent = s.isCrossCutting
                  ? C.cross
                  : s.isExternal
                    ? C.external
                    : C.squad;
                const gap = st && st.target != null ? st.target - Math.round(st.fte) : 0;
                return (
                  <Group
                    key={s.id}
                    x={s.x}
                    y={s.y}
                    draggable
                    opacity={dimOf(s.id)}
                    onDragEnd={(e) => onNodeDragEnd(e, s)}
                    onMouseEnter={() => showHover(s.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelectedId(s.id)}
                    onTap={() => setSelectedId(s.id)}
                  >
                    {(isMatch(s.id) || dropTarget === s.id) && (
                      <Circle
                        radius={96}
                        stroke={dropTarget === s.id ? C.squad : C.match}
                        strokeWidth={6}
                        opacity={0.85}
                        listening={false}
                      />
                    )}
                    <Circle
                      radius={78}
                      fill={C.white}
                      stroke={selectedId === s.id ? C.ink : accent}
                      strokeWidth={selectedId === s.id ? 6 : 4}
                    />
                    <Text
                      text={s.name}
                      x={-72}
                      y={-24}
                      width={144}
                      align="center"
                      fontSize={17}
                      fontStyle="bold"
                      fontFamily={FONT}
                      fill={C.ink}
                      listening={false}
                    />
                    <Text
                      text={st ? `${st.heads} · ${st.fte.toFixed(1)} FTE` : ""}
                      x={-72}
                      y={-2}
                      width={144}
                      align="center"
                      fontSize={13}
                      fontFamily={FONT}
                      fill={C.inkSoft}
                      listening={false}
                    />
                    {gap > 0 && (
                      <Text
                        text={`${gap} short`}
                        x={-72}
                        y={16}
                        width={144}
                        align="center"
                        fontSize={13}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={C.utilOver}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

            {/* People rung */}
            {showPeople &&
              people.map((p) => {
                const u = utilOf(p);
                const shared = p.allocations.length > 1;
                return (
                  <Group
                    key={p.id}
                    x={p.x}
                    y={p.y}
                    draggable
                    opacity={dimOf(p.id)}
                    onDragMove={(e) => onNodeDragMove(e, p)}
                    onDragEnd={(e) => onNodeDragEnd(e, p)}
                    onMouseEnter={() => showHover(p.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelectedId(p.id)}
                    onTap={() => setSelectedId(p.id)}
                  >
                    {isMatch(p.id) && (
                      <Circle radius={34} stroke={C.match} strokeWidth={5} listening={false} />
                    )}
                    <Circle
                      radius={22}
                      fill={C.white}
                      stroke={selectedId === p.id ? C.ink : utilColor(u)}
                      strokeWidth={shared ? 5 : 3.5}
                      dash={shared ? [5, 3] : undefined}
                    />
                    {u > 110 && (
                      <Circle radius={7} y={-1} fill={C.utilOver} listening={false} />
                    )}
                    <Text
                      text={p.name}
                      x={-70}
                      y={28}
                      width={140}
                      align="center"
                      fontSize={13}
                      fontStyle="bold"
                      fontFamily={FONT}
                      fill={C.ink}
                      listening={false}
                    />
                    {/* Roles rung adds the detail that only reads when close in. */}
                    {lod === "roles" && (
                      <>
                        <Text
                          text={p.title}
                          x={-70}
                          y={44}
                          width={140}
                          align="center"
                          fontSize={11.5}
                          fontFamily={FONT}
                          fill={C.inkSoft}
                          listening={false}
                        />
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
                  </Group>
                );
              })}
          </Layer>
        </Stage>

        {/* LOD readout — makes the ladder legible while you zoom. */}
        <div style={S.lodDock}>
          {LOD_LABELS.map(([id, label]) => (
            <span key={id} style={S.lodItem(lod === id)}>
              {label}
            </span>
          ))}
          <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>
            {scale.toFixed(2)}×
          </span>
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
            <i style={{ ...S.sw, border: `2px dashed ${C.person}`, background: "transparent" }} />{" "}
            shared across teams
          </span>
        </div>

        {zoneMode && !zone && (
          <div style={S.hint}>Drag a box over part of the map to price it.</div>
        )}

        {zone && zoneStats && (
          <div style={S.zonePanel}>
            <div style={S.zoneHead}>
              <strong>Zone</strong>
              <button style={S.linkBtn} onClick={() => setZone(null)}>
                Clear
              </button>
            </div>
            <div style={S.zoneGrid}>
              <Stat label="People" value={String(zoneStats.people)} />
              <Stat label="Squads" value={String(zoneStats.squads)} />
              <Stat label="FTE" value={zoneStats.fte.toFixed(1)} />
              <Stat label="Cost / mo" value={money(Math.round(zoneStats.cost))} />
              <Stat
                label="Over-allocated"
                value={String(zoneStats.over)}
                tone={zoneStats.over ? C.utilOver : undefined}
              />
              <Stat
                label="Open roles"
                value={String(zoneStats.openRoles)}
                tone={zoneStats.openRoles ? C.utilOver : undefined}
              />
            </div>
          </div>
        )}

        {hovered && hover && (
          <div style={{ ...S.bubble, left: hover.x, top: hover.y }}>
            <strong>{hovered.name}</strong>
            <span style={{ fontSize: 11.5, color: "#ffffffbf" }}>
              {hovered.kind === "person"
                ? `${hovered.title} · ${utilOf(hovered) || "—"}${utilOf(hovered) ? "%" : ""}`
                : `${squadStats.get(hovered.id)?.heads ?? 0} people · ${money(
                    Math.round(squadStats.get(hovered.id)?.cost ?? 0),
                  )}/mo`}
            </span>
          </div>
        )}

        {toast && (
          <div style={S.toast}>
            {toast.text}
            {toast.undo && (
              <button style={S.toastUndo} onClick={toast.undo}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detail panel */}
      <aside style={{ ...S.panel, transform: selected ? "translateX(0)" : "translateX(105%)" }}>
        {selected && (
          <>
            <div style={S.panelHead}>
              <div>
                <div style={S.panelType}>
                  {selected.kind === "person" ? "Person" : "Squad"}
                </div>
                <h2 style={{ margin: "2px 0 0", fontSize: 19 }}>{selected.name}</h2>
              </div>
              <button style={S.close} onClick={() => setSelectedId(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <div style={S.panelBody}>
              {selected.kind === "person" ? (
                <PersonBody person={selected} byId={byId} onSelect={setSelectedId} />
              ) : (
                <SquadBody
                  squad={selected}
                  stats={squadStats.get(selected.id)}
                  people={people}
                  onSelect={setSelectedId}
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
  onSelect,
}: {
  person: PersonNode;
  byId: Map<string, MapNode>;
  onSelect: (id: string) => void;
}) {
  const u = utilOf(person);
  const mgr = person.managerId ? byId.get(person.managerId) : null;
  return (
    <>
      <div style={{ color: C.inkSoft, fontSize: 13 }}>{person.title}</div>
      <Meter label="Delivery load" value={u} />
      <Section title="Allocations">
        {person.allocations.length === 0 ? (
          <p style={S.empty}>No delivery allocation — leadership or unassigned.</p>
        ) : (
          <ul style={S.list}>
            {person.allocations.map((a) => (
              <li key={a.unit} style={S.li} onClick={() => onSelect(a.unit)}>
                <span style={{ ...S.sw, background: C.squad }} />
                <span style={{ flex: 1 }}>{byId.get(a.unit)?.name ?? a.unit}</span>
                <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>
                  {a.role} · {a.pct}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Facts">
        <div style={S.facts}>
          <Fact label="Cost / mo" value={money(person.costPerMonth)} />
          <Fact label="Reports to" value={mgr?.name ?? "—"} />
          <Fact label="Started" value={person.startDate ?? "—"} />
          <Fact label="Last leave" value={person.lastVacationAt ?? "—"} />
        </div>
      </Section>
      <Section title="Skills">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {person.skills.map((s) => (
            <span key={s} style={S.tag}>
              {s}
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}

function SquadBody({
  squad,
  stats,
  people,
  onSelect,
}: {
  squad: SquadNode;
  stats: SquadStats | undefined;
  people: PersonNode[];
  onSelect: (id: string) => void;
}) {
  const members = people.filter((p) => p.allocations.some((a) => a.unit === squad.id));
  return (
    <>
      <div style={{ color: C.inkSoft, fontSize: 13 }}>
        {squad.train}
        {squad.vendorName ? ` · ${squad.vendorName}` : ""}
      </div>
      <Section title="Facts">
        <div style={S.facts}>
          <Fact label="People" value={String(stats?.heads ?? 0)} />
          <Fact label="FTE" value={(stats?.fte ?? 0).toFixed(1)} />
          <Fact label="Cost / mo" value={money(Math.round(stats?.cost ?? 0))} />
          <Fact label="Target" value={squad.targetHeadcount?.toString() ?? "—"} />
          <Fact
            label="Open roles"
            value={String(squad.openRoles)}
            tone={squad.openRoles ? C.utilOver : undefined}
          />
          <Fact label="Shared in" value={String(stats?.shared ?? 0)} />
        </div>
      </Section>
      <Section title={`People (${members.length})`}>
        <ul style={S.list}>
          {members.map((p) => {
            const a = p.allocations.find((x) => x.unit === squad.id)!;
            return (
              <li key={p.id} style={S.li} onClick={() => onSelect(p.id)}>
                <span style={{ ...S.sw, background: utilColor(utilOf(p)) }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>
                  {a.role} · {a.pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// --- small presentational bits --------------------------------------------
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={S.factLabel}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tone ?? C.ink }}>{value}</div>
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
        <div
          style={{
            height: "100%",
            borderRadius: 999,
            width: `${Math.min(value, 150) / 1.5}%`,
            background: utilColor(value),
          }}
        />
      </div>
    </div>
  );
}

// --- styles ----------------------------------------------------------------
const S = {
  root: {
    position: "fixed" as const,
    inset: 0,
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
    boxShadow: `16px 0 0 -3px ${C.edgeReporting}, 28px 0 0 -3px ${C.squad}`,
    marginRight: 22,
  },
  badge: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: C.cross,
    border: `1px solid ${C.cross}`,
    borderRadius: 999,
    padding: "2px 8px",
  },
  search: {
    flex: "1 1 200px",
    maxWidth: 320,
    height: 40,
    padding: "0 14px",
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    background: C.white,
    fontFamily: FONT,
    fontSize: 14,
    color: C.ink,
    outline: "none",
  },
  chip: (on: boolean, accent: string) => ({
    height: 40,
    padding: "0 14px",
    borderRadius: 999,
    border: `1.5px solid ${on ? accent : C.line}`,
    background: on ? `${accent}14` : C.white,
    color: on ? accent : C.inkSoft,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  }),
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
  canvasWrap: {
    position: "relative" as const,
    flex: 1,
    overflow: "hidden",
    touchAction: "none" as const,
  },
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
  sw: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    marginRight: 5,
    verticalAlign: "middle",
  },
  hint: {
    position: "absolute" as const,
    top: 14,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 16px",
    background: `${C.cross}1f`,
    color: "#92400e",
    border: `1px solid ${C.cross}55`,
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
  },
  zonePanel: {
    position: "absolute" as const,
    top: 14,
    left: 14,
    width: 260,
    padding: "12px 14px",
    background: "#fffffff5",
    border: `1px solid ${C.cross}`,
    borderRadius: 14,
  },
  zoneHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  zoneGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" },
  linkBtn: {
    border: "none",
    background: "none",
    color: C.edgeReporting,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },
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
  toast: {
    position: "absolute" as const,
    bottom: 70,
    left: "50%",
    transform: "translateX(-50%)",
    background: C.ink,
    color: C.white,
    padding: "10px 18px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 14,
    zIndex: 30,
  },
  toastUndo: {
    border: "none",
    background: "none",
    color: C.cross,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    padding: 0,
  },
  panel: {
    position: "fixed" as const,
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
  panelHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "18px 20px 12px",
    borderBottom: `1px solid ${C.line}`,
  },
  panelType: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: C.inkSoft,
  },
  panelBody: { padding: "16px 20px 24px", overflowY: "auto" as const },
  close: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "none",
    background: C.paper,
    color: C.ink,
    fontSize: 14,
    cursor: "pointer",
  },
  h3: {
    margin: "0 0 8px",
    fontSize: 11.5,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    color: C.inkSoft,
  },
  facts: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" },
  fact: { background: C.paper, borderRadius: 10, padding: "9px 12px" },
  factLabel: {
    fontSize: 10.5,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: C.inkSoft,
    marginBottom: 2,
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  li: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "10px 8px",
    borderRadius: 10,
    cursor: "pointer",
    minHeight: 44,
    fontSize: 13.5,
  },
  tag: {
    background: C.paper,
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    color: C.inkSoft,
  },
  track: {
    height: 8,
    borderRadius: 999,
    background: C.paper,
    overflow: "hidden",
    marginTop: 6,
  },
  empty: { margin: 0, fontSize: 13, color: C.inkSoft },
};
