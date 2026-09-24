"use client";

/**
 * The camera engine's React half (docs/ENGINES.md § Camera).
 *
 * Everything here is stage, state and timing. All the arithmetic lives in
 * `lib/map/camera/viewport.ts`, where it can be tested without a browser — if
 * you are about to compute a fit or a centre in this file, it belongs there.
 *
 * What this owns: the viewport size, the live scale, the cull box, the
 * animation frame, and the one clamped write to the Konva stage.
 *
 * What it deliberately does not own: **which** unit to focus and where to
 * frame when you do. That is focus *policy* and it needs the scene and the
 * tree, so it stays with the map for now (see ENGINES.md § Status).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  CAMERA_MS,
  MAX_SCALE,
  VIEW_BOX_MS,
  cameraAbout,
  cameraProgress,
  centreOfBounds,
  centreOn,
  clampScale,
  cullBox,
  easeOutCubic,
  fitCamera,
  lerpCamera,
  minScaleFor,
  radiusCamera,
  scaleChanged,
  wheelZoom,
  type Bounds,
  type Camera,
  type ViewBox,
} from "@/lib/map/camera/viewport";

type Options = {
  /** The Konva stage. Owned by the map, written only through here. */
  stageRef: React.RefObject<Konva.Stage | null>;
  /** The element the stage fills; observed for size. */
  wrapRef: React.RefObject<HTMLDivElement | null>;
  /** The company's settled extent — what Fit frames and what the zoom floor
   *  is measured against. */
  worldBounds: Bounds;
  /** Called whenever the camera moves, so the frame loop repaints. */
  onChange?: () => void;
};

export type CameraApi = {
  size: { w: number; h: number };
  scale: number;
  viewBox: ViewBox | null;
  minScale: number;

  /** The scale on the stage right now. React's `scale` lags it on purpose —
   *  it only re-renders when the change is big enough to matter to a label.
   *  Read this when you need the truth this frame. */
  liveScale: () => number;
  /** Has the viewer moved the camera themselves? Once they have, we stop
   *  choosing an opening view for them. */
  hasTouched: () => boolean;
  /** Say the viewer took the wheel. */
  markTouched: () => void;
  /** Say they have not — after a company switch, where a fresh opening view
   *  is the right thing. */
  clearTouched: () => void;

  refreshViewBox: (force?: boolean) => void;
  currentCamera: () => Camera;
  /** Immediate: set scale about a fixed screen point. */
  applyCamera: (scale: number, world: { x: number; y: number }, screen: { x: number; y: number }) => void;
  /** Immediate: frame a world box. */
  frame: (bounds: Bounds, maxScale?: number) => void;
  /** Eased. */
  animateCameraTo: (target: Camera) => void;
  animateFrame: (radius: number, centre?: { x: number; y: number }) => void;
  animateBounds: (bounds: Bounds, maxScale?: number) => void;
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
};

export function useCamera({ stageRef, wrapRef, worldBounds, onChange }: Options): CameraApi {
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [scale, setScale] = useState(0.4);
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);

  const scaleRef = useRef(scale);
  const rafRef = useRef<number | null>(null);
  const touched = useRef(false);
  const viewClock = useRef(0);

  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]);
  const notify = useCallback(() => changed.current?.(), []);

  const viewport = useMemo(
    () => ({ width: size.w || 600, height: size.h || 600 }),
    [size],
  );

  // How far out you may go depends on the org — see minScaleFor.
  const minScale = useMemo(() => minScaleFor(worldBounds, viewport), [worldBounds, viewport]);
  const minScaleRef = useRef(minScale);
  useEffect(() => { minScaleRef.current = minScale; }, [minScale]);

  // A zero-sized measurement (a container not yet laid out) gives Konva a
  // zero-sized canvas, which throws on first draw — hence the fallbacks.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 1440, h: el.clientHeight || 900 });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [wrapRef]);

  /** Recompute the cull box, at most every 120ms — mounting and unmounting
   *  hundreds of seats on every mousemove would cost more than it saves. */
  const refreshViewBox = useCallback((force = false) => {
    const stage = stageRef.current;
    if (!stage) return;
    const now = performance.now();
    if (!force && now - viewClock.current < VIEW_BOX_MS) return;
    viewClock.current = now;
    setViewBox(
      cullBox(
        { scale: stage.scaleX(), x: stage.x(), y: stage.y() },
        { width: stage.width(), height: stage.height() },
      ),
    );
  }, [stageRef]);

  const currentCamera = useCallback((): Camera => {
    const stage = stageRef.current;
    return stage
      ? { scale: stage.scaleX(), x: stage.x(), y: stage.y() }
      : { scale: scaleRef.current, x: size.w / 2, y: size.h / 2 };
  }, [stageRef, size]);

  /** The single place the stage is written. */
  const write = useCallback((camera: Camera, settle: boolean) => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scale({ x: camera.scale, y: camera.scale });
    stage.position({ x: camera.x, y: camera.y });
    stage.batchDraw();
    scaleRef.current = camera.scale;
    notify();
    // React only needs to know when the change is big enough to matter to a
    // label or the HUD; the morph itself reads the stage directly.
    if (settle) setScale(camera.scale);
    else setScale((prev) => (scaleChanged(prev, camera.scale) ? camera.scale : prev));
  }, [stageRef, notify]);

  const applyCamera = useCallback((
    next: number,
    world: { x: number; y: number },
    screen: { x: number; y: number },
  ) => {
    if (!stageRef.current) return;
    write(cameraAbout(clampScale(next, minScaleRef.current), world, screen), false);
    refreshViewBox(true);
  }, [stageRef, write, refreshViewBox]);

  const frame = useCallback((bounds: Bounds, maxScale = MAX_SCALE) => {
    if (!stageRef.current) return;
    const fit = fitCamera(bounds, { width: size.w, height: size.h }, { min: minScaleRef.current, max: maxScale });
    applyCamera(fit.scale, centreOfBounds(bounds), { x: size.w / 2, y: size.h / 2 });
  }, [stageRef, size, applyCamera]);

  const animateCameraTo = useCallback((target: Camera) => {
    if (!stageRef.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = currentCamera();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : CAMERA_MS;
    const born = performance.now();
    const tick = (now: number) => {
      const raw = cameraProgress(now - born, duration);
      write(lerpCamera(start, target, easeOutCubic(raw)), raw >= 1);
      if (raw < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        refreshViewBox(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stageRef, currentCamera, write, refreshViewBox]);

  const animateFrame = useCallback((radius: number, centre = { x: 0, y: 0 }) => {
    animateCameraTo(
      radiusCamera(radius, centre, { width: size.w, height: size.h }, { min: minScaleRef.current }),
    );
  }, [size, animateCameraTo]);

  const animateBounds = useCallback((bounds: Bounds, maxScale = 1.2) => {
    animateCameraTo(
      fitCamera(bounds, { width: size.w, height: size.h }, { min: minScaleRef.current, max: maxScale }),
    );
  }, [size, animateCameraTo]);

  const onWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    touched.current = true;
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const { scale: next, world, screen } = wheelZoom(
      { scale: stage.scaleX(), x: stage.x(), y: stage.y() },
      e.evt.deltaY,
      pointer,
    );
    applyCamera(next, world, screen);
  }, [stageRef, applyCamera]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const liveScale = useCallback(() => scaleRef.current, []);
  const hasTouched = useCallback(() => touched.current, []);
  const markTouched = useCallback(() => { touched.current = true; }, []);
  const clearTouched = useCallback(() => { touched.current = false; }, []);

  return {
    size, scale, viewBox, minScale,
    liveScale, hasTouched, markTouched, clearTouched,
    refreshViewBox, currentCamera, applyCamera, frame,
    animateCameraTo, animateFrame, animateBounds, onWheel,
  };
}

export { centreOn };
