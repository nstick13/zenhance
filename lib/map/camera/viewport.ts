/**
 * The camera engine — what pan, zoom and focus actually compute (Greg,
 * 2026-09-24; first engine extracted under docs/ENGINES.md).
 *
 * Every function here takes numbers and returns numbers. No React, no Konva,
 * no stage. That is the whole point: the camera used to be ~265 lines braided
 * through a 3,869-line component, where the only way to check that a fit was
 * right was to open a browser and squint. Here it is a unit test.
 *
 * The React and Konva half lives in `components/viz/orbital/useCamera.ts`,
 * which owns the stage, the rAF loop and the state. It should stay thin: if
 * you find yourself doing arithmetic there, it belongs in this file.
 *
 * A **camera** is `{ scale, x, y }` — exactly what a Konva stage wants, where
 * x/y are the stage's screen-space offset, not a world point. World → screen
 * is `world * scale + offset`. Most bugs in here have been sign errors in
 * that one line, so it is written once, in `centreOn`, and reused.
 */
import { fitScaleFor, type Bounds } from "@/lib/orbital/complexity";

export type Size = { width: number; height: number };
export type Camera = { scale: number; x: number; y: number };
export type ViewBox = { minX: number; minY: number; maxX: number; maxY: number };

/** Zoomed all the way in. Beyond this the map is one person and some noise. */
export const MAX_SCALE = 12;

/** How much beyond the viewport the cull box reaches, as a fraction of the
 *  viewport. Seats inside it are mounted; outside it they are not. Generous
 *  because mounting is the expensive part — a pan should find them ready. */
export const CULL_PAD = 0.6;

/** Cull box recompute interval. Mounting hundreds of seats on every mousemove
 *  costs more than it saves. */
export const VIEW_BOX_MS = 120;

/** How long a camera move takes. Zero when the viewer asked for less motion. */
export const CAMERA_MS = 560;

/** Below this, a scale change is not worth re-rendering React for — the morph
 *  itself reads the stage directly every frame. ~3% in log space. */
export const SCALE_EPSILON = 0.03;

export const clampScale = (next: number, min: number, max = MAX_SCALE): number =>
  Math.min(max, Math.max(min, next));

/** Worth telling React about? */
export const scaleChanged = (from: number, to: number): boolean =>
  Math.abs(Math.log(to / from)) > SCALE_EPSILON;

/** The world rectangle currently worth mounting, padded so a pan does not
 *  race the cull. */
export function cullBox(camera: Camera, size: Size, pad = CULL_PAD): ViewBox {
  const k = camera.scale || 1;
  const w = size.width / k;
  const h = size.height / k;
  const padX = w * pad;
  const padY = h * pad;
  const minX = -camera.x / k - padX;
  const minY = -camera.y / k - padY;
  return { minX, minY, maxX: minX + w + padX * 2, maxY: minY + h + padY * 2 };
}

/** Put this world point in the middle of the screen at this scale. The one
 *  place world→screen is written down. */
export const centreOn = (point: { x: number; y: number }, scale: number, size: Size): Camera => ({
  scale,
  x: size.width / 2 - point.x * scale,
  y: size.height / 2 - point.y * scale,
});

export const centreOfBounds = (b: Bounds) => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});

/** Frame a world rectangle. */
export function fitCamera(
  bounds: Bounds,
  size: Size,
  { min = 0, max = MAX_SCALE }: { min?: number; max?: number } = {},
): Camera {
  const scale = clampScale(fitScaleFor(bounds, size), min, max);
  return centreOn(centreOfBounds(bounds), scale, size);
}

/** Frame a circle of this radius about a centre — the ring map's own fit.
 *  The 1.06 is breathing room, so the outermost ring is not flush to the
 *  glass. */
export function radiusCamera(
  radius: number,
  centre: { x: number; y: number },
  size: Size,
  { min = 0, max = MAX_SCALE }: { min?: number; max?: number } = {},
): Camera {
  const fit = Math.min(size.width, size.height) / (Math.max(1, radius) * 2 * 1.06);
  return centreOn(centre, clampScale(fit, min, max), size);
}

/**
 * How far out you are allowed to go.
 *
 * It cannot be a constant. A 2,560-person map is tens of thousands of units
 * across; a fixed floor strands you zoomed into the middle of it, unable to
 * reach the whole thing — which is exactly what internal testing reported on
 * 2026-09-13 ("Orbital loses context quickly because of the scale").
 *
 * So: whichever is smaller, a fixed ceiling or a little beyond the scale that
 * frames the entire company. `slack` below 1 buys that "a little beyond".
 */
export function minScaleFor(
  worldBounds: Bounds,
  size: Size,
  { ceiling = 0.06, slack = 0.85 }: { ceiling?: number; slack?: number } = {},
): number {
  const safe = { width: size.width || 600, height: size.height || 600 };
  return Math.min(ceiling, fitScaleFor(worldBounds, safe) * slack);
}

/** Decelerating, so a move arrives rather than stopping. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const lerpCamera = (from: Camera, to: Camera, t: number): Camera => ({
  scale: from.scale + (to.scale - from.scale) * t,
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/** Progress through a move: 0..1, and 1 immediately when duration is 0 so
 *  reduced motion lands on the first frame instead of dividing by zero. */
export const cameraProgress = (elapsed: number, duration: number): number =>
  duration <= 0 ? 1 : Math.min(1, elapsed / duration);

/**
 * Zoom about the pointer, so the thing under the cursor stays under it.
 *
 * Exponential in the wheel delta: every notch is the same *proportional*
 * change, which is what makes the zoom feel even whether you are looking at
 * the whole company or at one person.
 */
export function wheelZoom(
  camera: Camera,
  deltaY: number,
  pointer: { x: number; y: number },
  rate = 0.0015,
): { scale: number; world: { x: number; y: number }; screen: { x: number; y: number } } {
  const k = camera.scale || 1;
  return {
    scale: k * Math.exp(-deltaY * rate),
    world: { x: (pointer.x - camera.x) / k, y: (pointer.y - camera.y) / k },
    screen: pointer,
  };
}

/** Apply a scale about a fixed screen point — the shared tail of wheel zoom
 *  and any other "zoom but keep this pinned" gesture. */
export const cameraAbout = (
  scale: number,
  world: { x: number; y: number },
  screen: { x: number; y: number },
): Camera => ({ scale, x: screen.x - world.x * scale, y: screen.y - world.y * scale });

/** A unit as the camera needs to see it: where it is and how far it reaches.
 *  `footprint` is a unit's territory where it has one, `r` its disc. */
export type Reachable = { x: number; y: number; r: number; footprint?: number | null };

/** The box containing these units, reach included.
 *
 *  Returns null for an empty list rather than the inverted-infinity box —
 *  that box silently fits to nothing, and the caller should decide what to do
 *  instead of animating into the void. */
export function boundsOfUnits(units: readonly Reachable[], pad = 0): Bounds | null {
  if (units.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const u of units) {
    const reach = u.footprint ?? u.r;
    minX = Math.min(minX, u.x - reach);
    minY = Math.min(minY, u.y - reach);
    maxX = Math.max(maxX, u.x + reach);
    maxY = Math.max(maxY, u.y + reach);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export type { Bounds };
