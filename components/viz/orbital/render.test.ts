import { describe, expect, it, vi } from "vitest";
import type Konva from "konva";
import { paintRipples, RIPPLE_MS, type RenderCtx } from "./render";

describe("landing ripple", () => {
  it("paints an active drop without interrupting the map's animation frame", () => {
    const setAttr = vi.fn();
    const arc = vi.fn();
    const ctx = {
      save: vi.fn(),
      setAttr,
      beginPath: vi.fn(),
      arc,
      stroke: vi.fn(),
      restore: vi.fn(),
    } as unknown as Konva.Context;
    const now = 1000;
    const get = () => ({
      now,
      ripples: [{ x: 12, y: 24, born: now - RIPPLE_MS / 2, reach: 40 }],
    }) as RenderCtx;

    expect(() => paintRipples(get)(ctx)).not.toThrow();
    expect(setAttr).toHaveBeenCalledWith("lineWidth", 3);
    expect(arc).toHaveBeenCalledWith(12, 24, 30, 0, Math.PI * 2, false);
  });
});
