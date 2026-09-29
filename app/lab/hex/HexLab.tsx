"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity --
 * Two things a feel study does that a production component should not.
 *
 * `set-state-in-effect`: the camera re-fits when the company or the cell size
 * changes. That is a deliberate cascading render — you have just swapped the
 * world out from under the viewer and framing the new one is the point.
 *
 * `purity`: the panel reports how long the layout took, which means calling
 * `performance.now()` around it during render. Measuring the thing under study
 * is most of why this page exists. Neither belongs in `/org`; both belong here.
 */

/**
 * `/lab/hex` — client half. A plain 2D canvas, driven by the pure engines.
 *
 * **Deliberately not Konva.** The point of the study is partly to show that
 * the hex layout is isolated: everything moving on this page comes out of
 * `lib/map/camera/viewport.ts` and `lib/map/camera/lod.ts` unchanged, and the
 * renderer under it is four hundred lines of `ctx.arc`. If the layout only
 * worked inside `OrbitalMap.tsx` we would not know whether it was the layout
 * or the three thousand lines around it doing the work.
 *
 * Nothing here is production. No database, no auth, no persistence — a
 * refresh puts everything back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildOrbitalTree, type OrgInput } from "@/lib/map/layout/model";
import { layoutHex, type HexDensity, type HexScene } from "@/lib/map/layout/hex/scene";
import { layoutCompany } from "@/lib/map/layout/complexity";
import type { OrbitalScene } from "@/lib/map/layout/layout";
import { cellKey, corners, worldToCell, type Cell } from "@/lib/map/layout/hex/coords";
import {
  cameraAbout,
  cullBox,
  fitCamera,
  minScaleFor,
  wheelZoom,
  type Camera,
  type Size,
} from "@/lib/map/camera/viewport";
import {
  LOD_LADDER,
  drawnUnitRadius,
  isLandmark,
  revealAt,
  tierAt,
  unitLabelVisible,
} from "@/lib/map/camera/lod";

export type LabOrg = OrgInput;

/** One hue per top-level branch. Territory is what makes a map readable at a
 *  glance — you know you are in Falcon before you can read the word Falcon —
 *  and on a lattice a territory is just the cells a branch occupies, so it
 *  costs a fill rather than a marching-squares pass. */
const BRANCH_HUES = [210, 28, 150, 330, 265, 96, 186, 48, 300, 128, 12, 240];

const hueOf = (branchId: string, order: string[]): number =>
  BRANCH_HUES[Math.max(0, order.indexOf(branchId)) % BRANCH_HUES.length];

/**
 * Which ancestor a unit takes its colour from.
 *
 * Not "child of the root". A real company's top is usually a chain — this
 * fixture's root has one child, and the rung below that has three, one of
 * which carries most of the company. Colouring by either painted 395 units
 * essentially one blue and the territory said nothing.
 *
 * So: the shallowest rung that holds at least `MIN_REGIONS` units. That is
 * the level a reader would point at and call a division, and it is the level
 * where colour starts doing work.
 */
const MIN_REGIONS = 6;

function regionOf(scene: { units: { id: string; parentId: string | null; depth: number }[] }): Map<string, string> {
  const byDepth = new Map<number, string[]>();
  for (const u of scene.units) {
    const list = byDepth.get(u.depth);
    if (list) list.push(u.id);
    else byDepth.set(u.depth, [u.id]);
  }
  let regionDepth = 1;
  const deepest = Math.max(...scene.units.map((u) => u.depth));
  while (regionDepth < deepest && (byDepth.get(regionDepth)?.length ?? 0) < MIN_REGIONS) regionDepth++;

  const parentOf = new Map(scene.units.map((u) => [u.id, u.parentId] as const));
  const depthOf = new Map(scene.units.map((u) => [u.id, u.depth] as const));
  const out = new Map<string, string>();
  for (const u of scene.units) {
    let id: string | null = u.id;
    while (id && (depthOf.get(id) ?? 0) > regionDepth) id = parentOf.get(id) ?? null;
    if (id) out.set(u.id, id);
  }
  return out;
}

export default function HexLab({
  org,
  companyKey,
  initialDensity,
}: {
  org: LabOrg;
  companyKey: string;
  initialDensity: HexDensity;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 1200, height: 800 });
  const [density, setDensity] = useState<HexDensity>(initialDensity);
  const [showGrid, setShowGrid] = useState(true);
  const [mode, setMode] = useState<"hex" | "orbits">("hex");
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const tree = useMemo(
    () => buildOrbitalTree(org, { mergePassThroughRoot: false, workCountFor: () => 6 }),
    [org],
  );

  /** The same renderer draws both layouts, because both emit an
   *  `OrbitalScene`. That is the whole isolation claim, made visible: flip
   *  between them and only the positions change. */
  const { scene, hexScene, ms } = useMemo(() => {
    const t0 = performance.now();
    if (mode === "orbits") {
      const s = layoutCompany(tree).scene;
      return { scene: s as OrbitalScene, hexScene: null, ms: performance.now() - t0 };
    }
    const s = layoutHex(tree, { density });
    return { scene: s as OrbitalScene, hexScene: s as HexScene, ms: performance.now() - t0 };
  }, [tree, density, mode]);

  /** cell → unit, for pointing at things. Constant time, which the orbital
   *  map's own hit test is not. */
  const occupants = useMemo(() => {
    const m = new Map<string, string>();
    if (hexScene) for (const [unitId, cell] of hexScene.hex.cells) m.set(cellKey(cell), unitId);
    return m;
  }, [hexScene]);

  const regions = useMemo(() => regionOf(scene), [scene]);

  /** Region order, fixed by headcount so a colour never moves between reloads. */
  const regionOrder = useMemo(() => {
    const weight = new Map<string, number>();
    for (const u of scene.units) {
      const b = regions.get(u.id);
      if (!b) continue;
      weight.set(b, (weight.get(b) ?? 0) + u.seatIds.length);
    }
    return [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  }, [scene, regions]);

  const floor = useMemo(
    () => minScaleFor(scene.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, size),
    [scene, size],
  );

  const [camera, setCamera] = useState<Camera>({ scale: 0.05, x: 0, y: 0 });
  const fit = useCallback(() => {
    if (!scene.bounds) return;
    setCamera(fitCamera(scene.bounds, size, { min: floor }));
  }, [scene, size, floor]);

  // Re-fit whenever the company or the cell size changes — the study is about
  // looking at whole companies, so landing zoomed into nowhere helps nobody.
  useEffect(() => { fit(); }, [companyKey, density, fit]);

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
    const reveal = revealAt(scale);
    const view = cullBox(camera, size);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.transform(scale, 0, 0, scale, camera.x, camera.y);

    const visible = scene.units.filter(
      (u) => u.x >= view.minX && u.x <= view.maxX && u.y >= view.minY && u.y <= view.maxY,
    );
    const visibleIds = new Set(visible.map((u) => u.id));
    const hueFor = (unitId: string) => hueOf(regions.get(unitId) ?? unitId, regionOrder);

    // 1. Territory. Strongest when pulled back, because that is when colour is
    //    doing the work a name cannot. On the lattice a territory is simply the
    //    cells a region occupies — no outline to compute, no gaps to bridge.
    const territoryAlpha = 0.34 - 0.26 * Math.min(1, scale / 1.2);
    if (hexScene && territoryAlpha > 0.02) {
      const hexSize = hexScene.hex.size;
      for (const unit of visible) {
        const cell = hexScene.hex.cells.get(unit.id);
        if (!cell) continue;
        const pts = corners(cell, hexSize);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fillStyle = `hsla(${hueFor(unit.id)}, 64%, 56%, ${territoryAlpha})`;
        ctx.fill();
      }
    }

    // 2. The lattice itself, once a hexagon is big enough on screen to read as
    //    a shape. Below that it is hatching, not a grid.
    const cellPx = hexScene ? hexScene.hex.size * scale : 0;
    if (hexScene && showGrid && cellPx > 14) {
      ctx.lineWidth = Math.max(0.5, 1 / scale);
      ctx.strokeStyle = `rgba(30, 41, 59, ${Math.min(0.16, (cellPx - 14) / 300)})`;
      for (const unit of visible) {
        const cell = hexScene.hex.cells.get(unit.id);
        if (!cell) continue;
        const pts = corners(cell, hexScene.hex.size);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // 3. Connections, from the scene's own links so both layouts draw the same
    //    way. A child in the next cell gets a straight edge; a child that had
    //    to jump gets a curve, so the drawing says "this one is not where it
    //    wanted to be" without anyone having to explain it.
    //
    //    Jumps are drawn first and faint. There are 106 of them on this
    //    company, and at full strength they swept across every territory and
    //    reintroduced exactly the criss-cross Greg complained about in
    //    September. The one you are pointing at comes forward instead.
    ctx.lineCap = "round";
    const drawLink = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      steps: number,
      lit: boolean,
    ) => {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (steps > 1) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(0.16, 0.04 * steps) * len;
        ctx.quadraticCurveTo(
          (from.x + to.x) / 2 - (dy / len) * bow,
          (from.y + to.y) / 2 + (dx / len) * bow,
          to.x, to.y,
        );
      } else {
        ctx.lineTo(to.x, to.y);
      }
      ctx.lineWidth = Math.max(0.5, (steps > 1 ? (lit ? 3 : 1.2) : 2.2) / scale);
      ctx.strokeStyle = steps > 1
        ? (lit ? "rgba(217, 119, 6, 0.95)" : "rgba(217, 119, 6, 0.16)")
        : "rgba(99, 102, 241, 0.30)";
      ctx.stroke();
    };

    const unitLinks = scene.links.filter((l) => l.kind === "unit");
    const passes: [boolean, boolean][] = [[true, false], [false, false], [true, true]];
    for (const [jumpsOnly, litOnly] of passes) {
      for (const link of unitLinks) {
        if (!visibleIds.has(link.targetId) && !visibleIds.has(link.sourceId)) continue;
        const from = scene.unitById.get(link.sourceId);
        const to = scene.unitById.get(link.targetId);
        if (!from || !to) continue;
        const steps = hexScene ? hexScene.hex.steps.get(link.targetId) ?? 1 : 1;
        const isJump = steps > 1;
        if (isJump !== jumpsOnly) continue;
        const lit = hover !== null && (link.targetId === hover || link.sourceId === hover);
        if (litOnly !== lit) continue;
        drawLink(from, to, steps, lit);
      }
    }

    // 4. The units themselves.
    for (const unit of visible) {
      const drawn = drawnUnitRadius(unit, scale, unit.drawCeiling);
      if (drawn * scale < 0.35) continue;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, drawn, 0, Math.PI * 2);
      ctx.fillStyle = unit.id === hover ? "#1e1b4b" : "#ffffff";
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, (unit.depth === 0 ? 3 : 1.6) / scale);
      ctx.strokeStyle = `hsla(${hueFor(unit.id)}, 58%, 40%, 0.9)`;
      ctx.stroke();
    }

    // 5. People, once there is room for them. Straight from the orbital
    //    engine's own seat placement — this is the "human nodes orbit a
    //    parental node centred in the hexagon" half of Greg's model, and it is
    //    code that already existed.
    if (reveal.people > 0.01) {
      ctx.globalAlpha = reveal.people;
      for (const unit of visible) {
        const seats = scene.seatsByUnit.get(unit.id);
        if (!seats) continue;
        for (const seat of seats) {
          ctx.beginPath();
          ctx.arc(seat.x, seat.y, seat.r, 0, Math.PI * 2);
          ctx.fillStyle = seat.kind === "lead" ? "#4338ca" : seat.kind === "open" ? "#fff" : "#a5b4fc";
          ctx.fill();
          if (seat.kind === "open") {
            ctx.lineWidth = 1.2 / scale;
            ctx.strokeStyle = "#f59e0b";
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    } else if (reveal.torus > 0.01) {
      // The stand-in arc, exactly as the shipped map does it: a unit says how
      // many people it has before you can see them.
      ctx.globalAlpha = reveal.torus;
      for (const unit of visible) {
        if (unit.seatIds.length === 0) continue;
        const drawn = drawnUnitRadius(unit, scale, unit.drawCeiling);
        ctx.beginPath();
        ctx.arc(unit.x, unit.y, drawn * 1.9,
          unit.seatFanAngle - unit.seatFanSpan / 2,
          unit.seatFanAngle + unit.seatFanSpan / 2);
        ctx.lineWidth = Math.max(0.8, 4 / scale);
        ctx.strokeStyle = "rgba(129, 140, 248, 0.75)";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // 6. Labels, in screen space so text stays crisp at any camera scale.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const ordered = [...visible].sort((a, b) => a.depth - b.depth);
    for (const unit of ordered) {
      const drawn = drawnUnitRadius(unit, scale, unit.drawCeiling);
      const inside = unitLabelVisible(drawn, scale);
      const landmark = !inside && isLandmark(unit.depth);
      if (!inside && !landmark) continue;
      const sx = unit.x * scale + camera.x;
      const sy = unit.y * scale + camera.y;
      if (sx < -80 || sy < -30 || sx > size.width + 80 || sy > size.height + 30) continue;
      const fontPx = inside ? 12 : Math.max(10, 16 - unit.depth * 1.5);
      ctx.font = `${unit.depth <= 1 ? 650 : 500} ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(unit.name).width;
      const ly = inside ? sy : sy + drawn * scale + 10;
      // Cheap declutter: a name that would sit on one already drawn is dropped,
      // and because the list is ordered by depth the one that survives is the
      // one standing higher in the company.
      const h = fontPx + 8;
      if (placed.some((p) =>
        Math.abs(p.x - sx) < (p.w + w) / 2 + 8 && Math.abs(p.y - ly) < (p.h + h) / 2)) continue;
      placed.push({ x: sx, y: ly, w, h });
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.fillRect(sx - w / 2 - 4, ly - h / 2, w + 8, h);
      ctx.fillStyle = unit.depth <= 1 ? "#0f172a" : "#334155";
      ctx.fillText(unit.name, sx, ly);
    }
  }, [camera, scene, hexScene, size, hover, showGrid, regions, regionOrder]);

  // --- input ---------------------------------------------------------------

  const drag = useRef<{ x: number; y: number; cam: Camera } | null>(null);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCamera((cam) => {
      const z = wheelZoom(cam, e.deltaY, pointer);
      const clamped = Math.min(12, Math.max(floor, z.scale));
      return cameraAbout(clamped, z.world, z.screen);
    });
  }, [floor]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cam: camera };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const d = drag.current;
      setCamera({ scale: d.cam.scale, x: d.cam.x + (e.clientX - d.x), y: d.cam.y + (e.clientY - d.y) });
      return;
    }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const world = {
      x: (e.clientX - rect.left - camera.x) / camera.scale,
      y: (e.clientY - rect.top - camera.y) / camera.scale,
    };
    if (hexScene) {
      // Constant time: the lattice knows which cell a point is in. The orbital
      // map has to walk every unit in the cull box for the same answer.
      const cell: Cell = worldToCell(world, hexScene.hex.size);
      setHover(occupants.get(cellKey(cell)) ?? null);
      return;
    }
    let best: string | null = null;
    let bestD = Infinity;
    for (const u of scene.units) {
      const d = Math.hypot(u.x - world.x, u.y - world.y);
      if (d < bestD && d < Math.max(u.r * 2.5, 40 / camera.scale)) { bestD = d; best = u.id; }
    }
    setHover(best);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const hovered = hover ? scene.unitById.get(hover) : null;
  const tier = tierAt(revealAt(camera.scale));
  const stats = hexScene?.hex.stats ?? null;
  const b = scene.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const hoverSteps = hovered ? hexScene?.hex.steps.get(hovered.id) ?? 1 : 1;

  return (
    <>
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ display: "block", cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      />
      <Panel>
        <Row>
          <strong style={{ fontSize: 13 }}>Hex grid study</strong>
          <span style={{ color: "#9ca3af" }}>{camera.scale.toFixed(2)}×</span>
        </Row>
        <Row>
          <span style={{ color: "#6b7280" }}>layout</span>
          <button onClick={() => setMode("hex")} style={pill(mode === "hex")}>hex</button>
          <button onClick={() => setMode("orbits")} style={pill(mode === "orbits")}>orbits (today)</button>
        </Row>
        <Row>
          <span style={{ color: "#6b7280" }}>cell</span>
          {(["roomy", "tight"] as HexDensity[]).map((d) => (
            <button key={d} onClick={() => setDensity(d)} style={pill(mode === "hex" && d === density)}
              disabled={mode !== "hex"}>{d}</button>
          ))}
          <button onClick={() => setShowGrid((g) => !g)} style={pill(showGrid && mode === "hex")}
            disabled={mode !== "hex"}>grid</button>
          <button onClick={fit} style={pill(false)}>fit</button>
        </Row>
        <hr style={{ border: 0, borderTop: "1px solid #f1f5f9", margin: "2px 0" }} />
        {/* The layout is timed on the server render and again on the client,
            and the two never agree to the millisecond. */}
        <Small suppressHydrationWarning>
          {scene.units.length} units · {scene.seats.length} people · laid out in {ms.toFixed(0)}ms
        </Small>
        {stats ? (
          <Small>
            <b style={{ color: "#166534" }}>
              {((100 * stats.adjacent) / Math.max(1, stats.placed - 1)).toFixed(0)}%
            </b>{" "}of children sit next to their parent · {stats.jumped} jumped
            {stats.worstJump > 0 ? ` (worst ${stats.worstJump} cells)` : ""}
          </Small>
        ) : (
          <Small>the layout that ships today, drawn by this same renderer</Small>
        )}
        <Small>
          <b>{Math.round(b.maxX - b.minX).toLocaleString()} × {Math.round(b.maxY - b.minY).toLocaleString()}</b>
          {" "}world units across
        </Small>
        <Small>detail: {LOD_LADDER.find(([t]) => t === tier)?.[1] ?? tier}</Small>
        {hovered && (
          <Small>
            <b>{hovered.name}</b> — CEO+{hovered.depth} · {hovered.totalSeats} in branch
            {hoverSteps > 1 ? ` · jumped ${hoverSteps} cells` : ""}
          </Small>
        )}
      </Panel>
    </>
  );
}

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      position: "absolute", right: 12, top: 12, width: 264, padding: "10px 12px",
      background: "rgba(255,255,255,0.94)", border: "1px solid #e5e7eb", borderRadius: 12,
      display: "flex", flexDirection: "column", gap: 6, zIndex: 5,
      fontFamily: "ui-sans-serif, system-ui", fontSize: 12, color: "#374151",
      boxShadow: "0 6px 20px rgba(15,23,42,0.06)",
    }}
  >
    {children}
  </div>
);

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
);

const Small = ({
  children,
  suppressHydrationWarning,
}: {
  children: React.ReactNode;
  suppressHydrationWarning?: boolean;
}) => (
  <div style={{ fontSize: 11, lineHeight: 1.5, color: "#4b5563" }}
    suppressHydrationWarning={suppressHydrationWarning}>
    {children}
  </div>
);

const pill = (on: boolean): React.CSSProperties => ({
  padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontSize: 11,
  border: `1px solid ${on ? "#4f46e5" : "#e5e7eb"}`,
  background: on ? "#4f46e5" : "#fff", color: on ? "#fff" : "#374151",
});
