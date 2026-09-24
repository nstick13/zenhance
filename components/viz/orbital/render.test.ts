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

describe("every painter, on local geography with a detail field and thinning", () => {
  it("paints a whole frame without throwing, and never paints a hidden unit", async () => {
    const { buildOrbitalTree } = await import("@/lib/map/layout/model");
    const { layoutOrbitalForest } = await import("@/lib/map/layout/forest");
    const { structuralEnvelope } = await import("@/lib/map/layout/envelope");
    const { revealAt } = await import("@/lib/map/camera/lod");
    const { effectiveScale, fieldInfluence } = await import("@/lib/map/camera/detail");
    const { demoInput } = await import("@/lib/map/layout/__tests__/orbitalFixture");
    const render = await import("./render");

    const scene = layoutOrbitalForest(buildOrbitalTree(demoInput(), { workCountFor: () => 4 }), { geography: "local" });
    const hidden = scene.units.find((u) => u.parentId && u.childIds.length === 0)!;
    const field = { x: scene.units[1].x, y: scene.units[1].y, strength: 1, radiusPx: 200 };
    const scale = 0.9;
    const arcs: [number, number][] = [];
    // A context that accepts any call and records where arcs were drawn.
    const ctx = new Proxy({}, {
      get: (_target, key) => key === "arc"
        ? (x: number, y: number) => arcs.push([x, y])
        : () => undefined,
    }) as unknown as Konva.Context;
    const shape = { } as Konva.Shape;
    const detail = (id: string) => {
      const unit = scene.unitById.get(id)!;
      const s = effectiveScale(scale, fieldInfluence(field, unit, scale));
      return { scale: s, reveal: revealAt(s) };
    };
    const c: RenderCtx = {
      scene,
      reveal: revealAt(scale),
      unitRings: new Map(scene.units.map((u) => [u.id, { delivery: 0.4, sprint: 0.5, health: 0.8, people: 3 } as never])),
      seatRings: new Map(),
      workStatus: new Map(scene.seats.map((s) => [s.id, ["done", "backlog"]])),
      moneyByUnit: new Map(),
      maxMoney: 1,
      externals: [],
      reportingLines: [],
      showReporting: true,
      at: (_key, fallback) => fallback,
      ripples: [],
      snap: null,
      focusSeatId: scene.seats[0]?.id ?? null,
      hoveredRing: null,
      hoveredWork: null,
      hoveredUnitId: null,
      draggedUnitId: null,
      focusedUnitId: null,
      focusPath: new Set(),
      focusBranch: null,
      scale,
      now: 0,
      envelope: structuralEnvelope(scene),
      presence: (id) => (id === hidden.id ? 0 : 1),
      revealFor: (id) => detail(id).reveal,
      detailScaleFor: (id) => detail(id).scale,
      fieldActive: true,
      field,
      // One branch waiting in the basket, drawn as a placeholder with a badge.
      carriedBranch: new Set([scene.units[2].id]),
      carriedRoots: new Set([scene.units[2].id]),
      inFlight: null,
      // An armed merge proposal on another unit.
      relation: { unitId: scene.units[3].id, charge: 1, kind: "merge", armed: true },
      reparent: null,
      drawn: (unit) => render.unitDrawRadius(unit, scale),
    };
    const get = () => c;
    for (const paint of [
      render.paintEnvelope, render.paintField, render.paintUnitLinks, render.paintSeatLinks,
      render.paintReportingLines, render.paintWorkCapsules, render.paintWorkDots, render.paintUnitDiscs,
      render.paintTorus, render.paintUnitRings, render.paintSeatRings, render.paintPreview, render.paintRipples,
      render.paintRelation,
    ]) {
      expect(() => paint(get)(ctx, shape)).not.toThrow();
    }
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.some(([x, y]) => x === hidden.x && y === hidden.y)).toBe(false);
  });
});
