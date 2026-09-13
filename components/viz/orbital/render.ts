/**
 * Everything the orbital map draws imperatively, once per frame.
 *
 * These are Konva `sceneFunc`s rather than React nodes on purpose. The
 * morphs (Greg, 2026-09-13/14) need to interpolate on *every* frame as the
 * camera moves — an arc shrinking onto a circle, a torus resolving into
 * people, a capsule opening into the work inside it — and pushing that
 * through React would mean a re-render per frame. Each of these is one Shape
 * that reads the live scene, the live zoom and the live spring positions and
 * paints the lot in a single pass.
 *
 * Nothing here hit-tests. Anything hoverable is found mathematically in
 * OrbitalMap's pointer handler, which is cheaper than giving several hundred
 * dots their own Konva nodes and keeps this file to pure drawing.
 */
import type Konva from "konva";
import {
  SEAT_RADIUS,
  TAU,
  WORK_CAPSULE_GAP,
  WORK_CAPSULE_W,
  WORK_RADIUS,
  workCapsuleLength,
  type Point,
} from "@/lib/orbital/geometry";
import type { OrbitalScene } from "@/lib/orbital/layout";
import { lerp, type Reveal } from "@/lib/orbital/lod";
import {
  UNIT_RING_KEYS,
  type SeatProgress,
  type UnitProgress,
  type UnitRingKey,
} from "@/lib/orbital/progress";
import { C, WORK_STATUS_FILL, healthColor } from "./theme";

export type Ripple = { x: number; y: number; born: number; reach: number };

/** How long a landing ripple takes to spread and fade. */
export const RIPPLE_MS = 620;

export type SnapHint =
  | { kind: "unit"; position: Point; parentId: string; depth: number; unitId: string }
  | { kind: "seat"; position: Point; unitId: string };

/** One of the four bodies outside the company, and which way its money runs. */
export type ExternalFlow = {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: "in" | "out";
  /** Monthly figure — sets the line's weight and its packet size. */
  amount: number;
};

export type RingHover = { unitId: string; key: UnitRingKey };

export type RenderCtx = {
  scene: OrbitalScene;
  reveal: Reveal;
  unitRings: Map<string, UnitProgress>;
  seatRings: Map<string, SeatProgress>;
  /** Per work item, its status — what gives a dot or a capsule its colour. */
  workStatus: Map<string, string[]>;
  /** Money running through each unit's branch, and the largest of them, so a
   *  line's weight reads as "how much of the business runs through here". */
  moneyByUnit: Map<string, number>;
  maxMoney: number;
  externals: ExternalFlow[];
  /** Live, spring-animated position of a node, by motion key. */
  at: (key: string, fallback: Point) => Point;
  ripples: Ripple[];
  snap: SnapHint | null;
  focusSeatId: string | null;
  hoveredRing: RingHover | null;
  hoveredWork: { seatId: string; index: number } | null;
  hoveredUnitId: string | null;
  now: number;
};

export type CtxGetter = () => RenderCtx | null;

const uid = (id: string) => `u:${id}`;
const sid = (id: string) => `s:${id}`;

// --- ring geometry ---------------------------------------------------------
const RING_CHUNKY_WIDTH = 10;
const RING_THIN_WIDTH = 3;
const RING_CHUNKY_STEP = 14;
const RING_THIN_STEP = 5.5;
const RING_THIN_INSET = 7;

const SEAT_RING_WIDTH = 2.4;

/** Rings sit back until you ask them a question (Greg, 2026-09-14). */
const RING_RESTING_ALPHA = 0.34;

/** A rounded rectangle, drawn by hand — Konva's context doesn't proxy the
 *  browser's own `roundRect`. */
function roundRectPath(ctx: Konva.Context, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
}

/** Where a unit's ring `i` sits and how thick it is at the current zoom.
 *  Shared with the hit test, so what you can point at is exactly what you
 *  can see — the one number both sides have to agree on. */
export function ringGeometry(
  unit: { r: number; seatRingRadius: number },
  index: number,
  settle: number,
) {
  const base = lerp(unit.seatRingRadius, unit.r + RING_THIN_INSET, settle);
  const step = lerp(RING_CHUNKY_STEP, RING_THIN_STEP, settle);
  return {
    radius: base + index * step,
    width: lerp(RING_CHUNKY_WIDTH, RING_THIN_WIDTH, settle),
  };
}

/**
 * A unit's progress rings: delivery, sprint, health. At distance these are
 * chunky arcs standing out in the orbit where the people will be — they *are*
 * what you read when nothing else is drawn. As you approach they shrink onto
 * the circle and thin out, leaving the orbit free for the torus, and then for
 * the people themselves.
 */
export function paintUnitRings(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c) return;
    const settle = c.reveal.ringSettle;

    ctx.save();
    ctx.setAttr("lineCap", "round");
    for (const unit of c.scene.units) {
      const progress = c.unitRings.get(unit.id);
      if (!progress || progress.people === 0) continue;
      const centre = c.at(uid(unit.id), unit);
      const from = unit.seatFanAngle - Math.max(unit.seatFanSpan, 0.9) / 2;

      UNIT_RING_KEYS.forEach((key, i) => {
        const value = Math.max(0, Math.min(1, progress[key]));
        const { radius, width } = ringGeometry(unit, i, settle);
        if (radius <= 0) return;
        const hovered = c.hoveredRing?.unitId === unit.id && c.hoveredRing.key === key;
        const colour = key === "delivery" ? C.ink : key === "sprint" ? C.inkSoft : healthColor(value);

        if (settle > 0.02) {
          ctx.setAttr("globalAlpha", (hovered ? 0.7 : 0.3) * settle);
          ctx.setAttr("strokeStyle", C.track);
          ctx.setAttr("lineWidth", width);
          ctx.beginPath();
          ctx.arc(centre.x, centre.y, radius, 0, TAU, false);
          ctx.stroke();
        }

        if (value <= 0.001) return;
        // Hovering lifts the ring off the page: full colour and a shadow.
        if (hovered) {
          ctx.setAttr("shadowColor", "rgba(34,39,46,0.5)");
          ctx.setAttr("shadowBlur", 14);
          ctx.setAttr("shadowOffsetY", 3);
        }
        ctx.setAttr("globalAlpha", hovered ? 1 : RING_RESTING_ALPHA);
        ctx.setAttr("strokeStyle", colour);
        ctx.setAttr("lineWidth", hovered ? width * 1.35 : width);
        ctx.beginPath();
        ctx.arc(centre.x, centre.y, radius, from, from + value * TAU, false);
        ctx.stroke();
        if (hovered) {
          ctx.setAttr("shadowColor", "transparent");
          ctx.setAttr("shadowBlur", 0);
          ctx.setAttr("shadowOffsetY", 0);
        }
      });
    }
    ctx.restore();
  };
}

/**
 * The torus: one thick arc standing exactly where a unit's people will be,
 * its length set by how many there are (Greg, 2026-09-14). It arrives once
 * the rings have settled onto the circle, and gives way to the people
 * themselves as you keep going. It inherits their fan angle, so it obeys the
 * "furthest side from the grandparent" rule without being told to.
 */
export function paintTorus(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c) return;
    const t = c.reveal.torus;
    if (t <= 0.01) return;

    ctx.save();
    ctx.setAttr("lineCap", "round");
    ctx.setAttr("strokeStyle", C.seat);
    ctx.setAttr("lineWidth", SEAT_RADIUS * 2);
    for (const unit of c.scene.units) {
      const crowd = (c.scene.seatsByUnit.get(unit.id) ?? []).filter((s) => s.kind !== "lead");
      if (crowd.length === 0) continue;
      const centre = c.at(uid(unit.id), unit);
      const span = Math.max(unit.seatFanSpan, 0.22);
      const hovered = c.hoveredUnitId === unit.id;
      ctx.setAttr("globalAlpha", t * (hovered ? 0.55 : 0.3));
      ctx.beginPath();
      ctx.arc(
        centre.x,
        centre.y,
        unit.seatRingRadius,
        unit.seatFanAngle - span / 2,
        unit.seatFanAngle + span / 2,
        false,
      );
      ctx.stroke();
    }
    ctx.restore();
  };
}

/** A person's completion ring, once the people themselves are out. */
export function paintSeatRings(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c) return;
    const visible = c.reveal.people;
    if (visible <= 0.01) return;

    ctx.save();
    ctx.setAttr("lineCap", "round");
    ctx.setAttr("lineWidth", SEAT_RING_WIDTH);
    for (const seat of c.scene.seats) {
      const progress = c.seatRings.get(seat.id);
      if (!progress || progress.total === 0) continue;
      const at = c.at(sid(seat.id), seat);
      const focused = !c.focusSeatId || c.focusSeatId === seat.id;
      const radius = SEAT_RADIUS + 4.2;

      ctx.setAttr("globalAlpha", 0.3 * visible * (focused ? 1 : 0.3));
      ctx.setAttr("strokeStyle", C.track);
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius, 0, TAU, false);
      ctx.stroke();

      if (progress.ratio <= 0.001) continue;
      ctx.setAttr("globalAlpha", 0.85 * visible * (focused ? 1 : 0.3));
      ctx.setAttr("strokeStyle", C.ink);
      ctx.beginPath();
      const from = -Math.PI / 2;
      ctx.arc(at.x, at.y, radius, from, from + progress.ratio * TAU, false);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/** The order statuses stack along a capsule: finished nearest the person, so
 *  it reads as progress running outward from them. */
const CAPSULE_ORDER = ["done", "review", "in_progress", "backlog"] as const;

/**
 * One capsule per person, lying along the line that joins them to their team
 * so the whole map reads radially. Semitransparent, and banded by status —
 * its colour-coding is the shape of that person's board at a glance. Above
 * 3.5x it gives way to the items themselves.
 */
export function paintWorkCapsules(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c) return;
    const t = c.reveal.workCapsule;
    if (t <= 0.01) return;

    for (const seat of c.scene.seats) {
      const statuses = c.workStatus.get(seat.id) ?? [];
      if (statuses.length === 0) continue;
      const live = c.at(sid(seat.id), seat);
      const focused = !c.focusSeatId || c.focusSeatId === seat.id;
      const length = workCapsuleLength(statuses.length);
      const reach = SEAT_RADIUS + WORK_CAPSULE_GAP + length / 2;

      ctx.save();
      ctx.setAttr("globalAlpha", t * (focused ? 0.72 : 0.14));
      ctx.translate(live.x + Math.cos(seat.angle) * reach, live.y + Math.sin(seat.angle) * reach);
      ctx.rotate(seat.angle);
      ctx.beginPath();
      roundRectPath(
        ctx,
        -length / 2,
        -WORK_CAPSULE_W / 2,
        length,
        WORK_CAPSULE_W,
        WORK_CAPSULE_W / 2,
      );
      ctx.clip();
      let x = -length / 2;
      for (const status of CAPSULE_ORDER) {
        const share = statuses.filter((s) => s === status).length / statuses.length;
        if (share <= 0) continue;
        const w = share * length;
        ctx.setAttr("fillStyle", WORK_STATUS_FILL[status] ?? C.inkSoft);
        ctx.beginPath();
        ctx.rect(x, -WORK_CAPSULE_W / 2, w, WORK_CAPSULE_W);
        ctx.fill();
        x += w;
      }
      ctx.restore();
    }
  };
}

/** The individual work items, once you're close enough to point at one. */
export function paintWorkDots(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c) return;
    const t = c.reveal.workDots;
    if (t <= 0.01) return;

    ctx.save();
    for (const seat of c.scene.seats) {
      if (seat.work.length === 0) continue;
      const live = c.at(sid(seat.id), seat);
      const dx = live.x - seat.x;
      const dy = live.y - seat.y;
      const statuses = c.workStatus.get(seat.id) ?? [];
      const focused = !c.focusSeatId || c.focusSeatId === seat.id;

      for (let i = 0; i < seat.work.length; i++) {
        const hovered = c.hoveredWork?.seatId === seat.id && c.hoveredWork.index === i;
        ctx.setAttr("globalAlpha", t * (focused || hovered ? 1 : 0.16));
        ctx.setAttr("fillStyle", WORK_STATUS_FILL[statuses[i]] ?? C.inkSoft);
        ctx.beginPath();
        ctx.arc(
          seat.work[i].x + dx,
          seat.work[i].y + dy,
          hovered ? WORK_RADIUS * 1.8 : WORK_RADIUS,
          0,
          TAU,
          false,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  };
}

/**
 * Parent → child, weighted by the money running through the child's branch
 * (Greg, 2026-09-14). Payroll is the one flow the schema actually records, so
 * that is what sets the weight: a fat line is where the business spends.
 */
export function paintUnitLinks(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c) return;
    ctx.save();
    ctx.setAttr("lineCap", "round");
    ctx.setAttr("strokeStyle", C.link);
    ctx.setAttr("globalAlpha", 0.8);
    for (const link of c.scene.links) {
      if (link.kind !== "unit") continue;
      const from = c.at(uid(link.sourceId), link.from);
      const to = c.at(uid(link.targetId), link.to);
      const share = c.maxMoney > 0 ? (c.moneyByUnit.get(link.targetId) ?? 0) / c.maxMoney : 0;
      ctx.setAttr("lineWidth", 2.5 + Math.sqrt(Math.max(0, share)) * 20);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/** Unit → person. Below the people band only the lead is drawn, so only its
 *  line is drawn with it. */
export function paintSeatLinks(get: CtxGetter) {
  return (ctx: Konva.Context, shape: Konva.Shape) => {
    const c = get();
    if (!c) return;
    const people = c.reveal.people;
    if (Math.max(people, c.reveal.lead) <= 0.01) return;
    ctx.beginPath();
    for (const seat of c.scene.seats) {
      if (seat.kind !== "lead" && people <= 0.01) continue;
      const unit = c.scene.unitById.get(seat.unitId);
      if (!unit) continue;
      const from = c.at(uid(unit.id), unit);
      const to = c.at(sid(seat.id), seat);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.strokeShape(shape);
  };
}

const PACKET_MS = 4200;
const PACKETS_PER_FLOW = 3;

/**
 * The four bodies outside the company, each joined to its centre by a line
 * that runs *under* the whole map (Greg, 2026-09-14) — so the org sits on top
 * of its own money rather than beside it. Packets travel each line the way
 * the money actually moves: inward for revenue and investment, outward for
 * tax, dividends and suppliers.
 */
export function paintExternalFlows(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c || c.externals.length === 0) return;
    const biggest = Math.max(...c.externals.map((e) => e.amount), 1);

    ctx.save();
    ctx.setAttr("lineCap", "round");
    for (const ext of c.externals) {
      const colour = ext.direction === "in" ? C.ok : C.risk;
      const share = ext.amount / biggest;
      ctx.setAttr("strokeStyle", colour);
      ctx.setAttr("lineWidth", 5 + Math.sqrt(share) * 18);
      ctx.setAttr("globalAlpha", 0.2);
      ctx.beginPath();
      ctx.moveTo(ext.x, ext.y);
      ctx.lineTo(0, 0);
      ctx.stroke();

      ctx.setAttr("fillStyle", colour);
      for (let i = 0; i < PACKETS_PER_FLOW; i++) {
        const phase = ((c.now / PACKET_MS + i / PACKETS_PER_FLOW) % 1 + 1) % 1;
        const travel = ext.direction === "in" ? 1 - phase : phase;
        ctx.setAttr("globalAlpha", 0.55 * Math.sin(phase * Math.PI));
        ctx.beginPath();
        ctx.arc(ext.x * travel, ext.y * travel, 7 + share * 6, 0, TAU, false);
        ctx.fill();
      }
    }
    ctx.restore();
  };
}

/**
 * Where the thing in your hand will land — the functional half of the
 * delight: the stretch of orbit the new parent owns, and the space being
 * held open for the drop.
 */
export function paintPreview(get: CtxGetter) {
  return (ctx: Konva.Context, shape: Konva.Shape) => {
    const c = get();
    if (!c?.snap) return;
    const snap = c.snap;
    ctx.beginPath();
    if (snap.kind === "unit") {
      const band = c.scene.bands.find((b) => b.depth === snap.depth);
      const parent = c.scene.unitById.get(snap.parentId);
      if (band && parent) {
        ctx.arc(
          0,
          0,
          band.radius,
          parent.sector.center - parent.sector.halfSpan,
          parent.sector.center + parent.sector.halfSpan,
          false,
        );
        const at = c.at(uid(parent.id), parent);
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(snap.position.x, snap.position.y);
      }
      const r = c.scene.unitById.get(snap.unitId)?.r ?? 40;
      ctx.moveTo(snap.position.x + r, snap.position.y);
      ctx.arc(snap.position.x, snap.position.y, r, 0, TAU, false);
    } else {
      const unit = c.scene.unitById.get(snap.unitId);
      if (unit) {
        const at = c.at(uid(unit.id), unit);
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(snap.position.x, snap.position.y);
      }
      const r = SEAT_RADIUS * 1.9;
      ctx.moveTo(snap.position.x + r, snap.position.y);
      ctx.arc(snap.position.x, snap.position.y, r, 0, TAU, false);
    }
    ctx.strokeShape(shape);
  };
}

/** The landing itself: one ring spreading from where a node came to rest. */
export function paintRipples(get: CtxGetter) {
  return (ctx: Konva.Context) => {
    const c = get();
    if (!c || c.ripples.length === 0) return;
    ctx.save();
    ctx.setAttr("strokeStyle", C.accent);
    for (const ripple of c.ripples) {
      const age = (c.now - ripple.born) / RIPPLE_MS;
      if (age < 0 || age > 1) continue;
      const eased = 1 - (1 - age) * (1 - age);
      ctx.setAttr("globalAlpha", (1 - age) * 0.55);
      ctx.setAttr("lineWidth", lerp(5, 1, age));
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.reach * eased, 0, TAU, false);
      ctx.stroke();
    }
    ctx.restore();
  };
}

/** Ambient motes, parallaxed by the layer they sit in. */
export function paintDust(points: Point[]) {
  return (ctx: Konva.Context, shape: Konva.Shape) => {
    ctx.beginPath();
    for (const p of points) {
      ctx.moveTo(p.x + 1.6, p.y);
      ctx.arc(p.x, p.y, 1.6, 0, TAU, false);
    }
    ctx.fillShape(shape);
  };
}
