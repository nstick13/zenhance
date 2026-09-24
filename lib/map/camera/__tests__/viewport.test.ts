import { describe, expect, it } from "vitest";
import {
  MAX_SCALE,
  boundsOfUnits,
  cameraAbout,
  cameraProgress,
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
  type Camera,
} from "../viewport";

const SIZE = { width: 1000, height: 800 };
/** world → screen, the relationship every camera has to satisfy. */
const project = (p: { x: number; y: number }, c: Camera) => ({
  x: p.x * c.scale + c.x,
  y: p.y * c.scale + c.y,
});

describe("centreOn", () => {
  it("puts the point in the middle of the screen", () => {
    const at = project({ x: 1234, y: -567 }, centreOn({ x: 1234, y: -567 }, 0.4, SIZE));
    expect(at.x).toBeCloseTo(500);
    expect(at.y).toBeCloseTo(400);
  });

  it("holds at any scale", () => {
    for (const scale of [0.01, 0.5, 1, 12]) {
      const at = project({ x: 90, y: 90 }, centreOn({ x: 90, y: 90 }, scale, SIZE));
      expect(at.x).toBeCloseTo(500);
      expect(at.y).toBeCloseTo(400);
    }
  });
});

describe("fitCamera", () => {
  const bounds = { minX: -200, minY: -100, maxX: 200, maxY: 100 };

  it("centres the box", () => {
    const at = project({ x: 0, y: 0 }, fitCamera(bounds, SIZE));
    expect(at.x).toBeCloseTo(500);
    expect(at.y).toBeCloseTo(400);
  });

  it("centres an off-origin box on its own centre, not the origin", () => {
    const off = { minX: 800, minY: 800, maxX: 1200, maxY: 1000 };
    const at = project({ x: 1000, y: 900 }, fitCamera(off, SIZE));
    expect(at.x).toBeCloseTo(500);
    expect(at.y).toBeCloseTo(400);
  });

  it("keeps the whole box on screen", () => {
    const cam = fitCamera(bounds, SIZE);
    const tl = project({ x: bounds.minX, y: bounds.minY }, cam);
    const br = project({ x: bounds.maxX, y: bounds.maxY }, cam);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(SIZE.width);
    expect(br.y).toBeLessThanOrEqual(SIZE.height);
  });

  it("respects the ceiling on a tiny box instead of zooming to absurdity", () => {
    expect(fitCamera({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, SIZE, { max: 2 }).scale).toBe(2);
  });

  it("respects the floor on a huge box", () => {
    const huge = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
    expect(fitCamera(huge, SIZE, { min: 0.05 }).scale).toBe(0.05);
  });
});

describe("minScaleFor", () => {
  it("lets a 2,560-person company be seen whole — the point of it not being a constant", () => {
    // Tens of thousands of units across. A fixed 0.06 floor would strand the
    // viewer inside it, which is exactly the reported scale complaint.
    const vast = { minX: -20000, minY: -20000, maxX: 20000, maxY: 20000 };
    const min = minScaleFor(vast, SIZE);
    const whole = fitCamera(vast, SIZE, { min });
    expect(min).toBeLessThan(0.06);
    expect(whole.scale).toBeGreaterThan(min); // the fit is reachable, not clamped away
  });

  it("does not let a small company zoom out into empty space", () => {
    expect(minScaleFor({ minX: -300, minY: -300, maxX: 300, maxY: 300 }, SIZE)).toBe(0.06);
  });

  it("survives a zero-sized viewport during first mount", () => {
    const min = minScaleFor({ minX: -500, minY: -500, maxX: 500, maxY: 500 }, { width: 0, height: 0 });
    expect(Number.isFinite(min)).toBe(true);
    expect(min).toBeGreaterThan(0);
  });
});

describe("wheelZoom", () => {
  const camera: Camera = { scale: 0.5, x: 120, y: -40 };
  const pointer = { x: 300, y: 260 };

  it("keeps whatever is under the pointer under the pointer", () => {
    const { scale, world, screen } = wheelZoom(camera, -240, pointer);
    const at = project(world, cameraAbout(scale, world, screen));
    expect(at.x).toBeCloseTo(pointer.x);
    expect(at.y).toBeCloseTo(pointer.y);
  });

  it("zooms in on a negative delta and out on a positive one", () => {
    expect(wheelZoom(camera, -100, pointer).scale).toBeGreaterThan(camera.scale);
    expect(wheelZoom(camera, 100, pointer).scale).toBeLessThan(camera.scale);
  });

  it("is proportional, so a notch feels the same at every zoom", () => {
    const near = wheelZoom({ ...camera, scale: 0.1 }, -100, pointer).scale / 0.1;
    const far = wheelZoom({ ...camera, scale: 8 }, -100, pointer).scale / 8;
    expect(near).toBeCloseTo(far);
  });

  it("never flips or zeroes the scale, however violent the wheel", () => {
    for (const delta of [-100000, -5000, 5000, 100000]) {
      expect(wheelZoom(camera, delta, pointer).scale).toBeGreaterThan(0);
    }
  });
});

describe("cullBox", () => {
  it("contains the viewport", () => {
    const camera = centreOn({ x: 0, y: 0 }, 0.5, SIZE);
    const box = cullBox(camera, SIZE);
    expect(box.minX).toBeLessThan(-SIZE.width / 2 / 0.5 + 1);
    expect(box.maxX).toBeGreaterThan(SIZE.width / 2 / 0.5 - 1);
  });

  it("pads beyond it, so panning finds seats already mounted", () => {
    const camera = centreOn({ x: 0, y: 0 }, 1, SIZE);
    const padded = cullBox(camera, SIZE, 0.6);
    const tight = cullBox(camera, SIZE, 0);
    expect(padded.minX).toBeLessThan(tight.minX);
    expect(padded.maxY).toBeGreaterThan(tight.maxY);
  });

  it("covers more world as you zoom out", () => {
    const wide = cullBox(centreOn({ x: 0, y: 0 }, 0.1, SIZE), SIZE);
    const close = cullBox(centreOn({ x: 0, y: 0 }, 4, SIZE), SIZE);
    expect(wide.maxX - wide.minX).toBeGreaterThan(close.maxX - close.minX);
  });

  it("does not divide by zero before the first frame", () => {
    expect(Number.isFinite(cullBox({ scale: 0, x: 0, y: 0 }, SIZE).minX)).toBe(true);
  });
});

describe("radiusCamera", () => {
  it("fits the circle to the smaller dimension, with a little air", () => {
    // A 1000x800 viewport is constrained by its height, so the circle should
    // very nearly fill the height and sit comfortably inside the width.
    const cam = radiusCamera(400, { x: 0, y: 0 }, SIZE);
    const onScreenRadius = 400 * cam.scale;
    expect(onScreenRadius).toBeLessThan(SIZE.height / 2);
    expect(onScreenRadius).toBeGreaterThan((SIZE.height / 2) * 0.9);
    expect(onScreenRadius).toBeLessThan(SIZE.width / 2);
  });

  it("centres on a centre that is not the origin", () => {
    const at = project({ x: 5000, y: -2000 }, radiusCamera(300, { x: 5000, y: -2000 }, SIZE));
    expect(at.x).toBeCloseTo(500);
    expect(at.y).toBeCloseTo(400);
  });

  it("survives a zero radius", () => {
    expect(Number.isFinite(radiusCamera(0, { x: 0, y: 0 }, SIZE).scale)).toBe(true);
  });
});

describe("easing a move", () => {
  it("starts where it starts and ends where it ends", () => {
    const from: Camera = { scale: 0.2, x: 0, y: 0 };
    const to: Camera = { scale: 1.4, x: -300, y: 120 };
    expect(lerpCamera(from, to, 0)).toEqual(from);
    expect(lerpCamera(from, to, 1)).toEqual(to);
  });

  it("decelerates — more than half the distance is covered by halfway", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("lands immediately when motion is reduced", () => {
    expect(cameraProgress(0, 0)).toBe(1);
  });

  it("never overshoots a long frame gap", () => {
    expect(cameraProgress(99999, 560)).toBe(1);
  });
});

describe("scaleChanged", () => {
  it("ignores a nudge React does not need to hear about", () => {
    expect(scaleChanged(1, 1.01)).toBe(false);
  });

  it("notices a real change", () => {
    expect(scaleChanged(1, 1.5)).toBe(true);
    expect(scaleChanged(1.5, 1)).toBe(true);
  });
});

describe("boundsOfUnits", () => {
  it("includes each unit's reach, not just its centre", () => {
    const b = boundsOfUnits([{ x: 0, y: 0, r: 50 }])!;
    expect(b).toEqual({ minX: -50, minY: -50, maxX: 50, maxY: 50 });
  });

  it("prefers a territory footprint over the disc", () => {
    const b = boundsOfUnits([{ x: 0, y: 0, r: 10, footprint: 200 }])!;
    expect(b.maxX).toBe(200);
  });

  it("falls back to the disc when footprint is null", () => {
    expect(boundsOfUnits([{ x: 0, y: 0, r: 10, footprint: null }])!.maxX).toBe(10);
  });

  it("returns null for no units, rather than an inverted box that fits to nothing", () => {
    expect(boundsOfUnits([])).toBeNull();
  });
});

describe("clampScale", () => {
  it("holds both ends", () => {
    expect(clampScale(999, 0.05)).toBe(MAX_SCALE);
    expect(clampScale(0.00001, 0.05)).toBe(0.05);
    expect(clampScale(1, 0.05)).toBe(1);
  });
});
