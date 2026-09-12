"use client";

import { useEffect, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Text, Circle, Line } from "react-konva";
import { type MoneyFlowLayout, FLOW_STROKE } from "@/lib/canvas/moneyFlow";
import { TIER_STROKE, type AllocationLine, type Tier } from "@/lib/canvas/allocationFlow";
import { pointAlongPath, type Point, type Spoke } from "@/lib/canvas/lineRouting";

/**
 * The macro layer: the company container and the external entities
 * (customers, shareholders, government, suppliers) with animated flow
 * lines. Rendered behind the existing stream/team/people content, in the
 * same non-listening background layer.
 *
 * Every connection in this file is a plain straight line (Greg,
 * 2026-09-12: "we don't need the railway diagram lines anymore... just
 * directly connect... using a straight line for now") — no bent routing,
 * no rounded-corner arcs.
 *
 * Deliberately non-interactive for this first pass — these nodes are
 * derived from the company box, not draggable/persisted data, unlike
 * people/teams. See the ROADMAP note if that changes.
 */

const INCOME = "#16a34a";
const OUTFLOW = "#dc2626";
const LINE = "#e4e0d6";
const INK = "#22272e";
const INK_SOFT = "#5c6570";
const WHITE = "#ffffff";
const FONT = "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

const PACKET_DURATION_MS = 3400;
const PACKETS_PER_FLOW = 2;

/** A pill-shaped background behind a dollar label so a chunky, saturated
 *  line never fights the text sitting on top of it. */
function LabelChip({ x, y, width, height, color, text, fontSize }: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  fontSize: number;
}) {
  return (
    <>
      <Rect x={x} y={y} width={width} height={height} cornerRadius={height / 2} fill={WHITE} opacity={0.92} listening={false} />
      <Text
        text={text}
        x={x}
        y={y + (height - fontSize) / 2 - 1}
        width={width}
        align="center"
        fontSize={fontSize}
        fontStyle="bold"
        fontFamily={FONT}
        fill={color}
        listening={false}
      />
    </>
  );
}

const flat = (points: Point[]) => points.flatMap((p) => [p.x, p.y]);

export function MoneyFlowScene({ layout, scale }: { layout: MoneyFlowLayout; scale: number }) {
  const invScale = 1 / scale;
  const groupRef = useRef<Konva.Group | null>(null);
  const lineRefs = useRef(new Map<string, Konva.Line>());
  const packetRefs = useRef(new Map<string, Konva.Circle[]>());

  useEffect(() => {
    const layer = groupRef.current?.getLayer() ?? null;
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const t = frame.time;
      layout.flows.forEach((f, i) => {
        const line = lineRefs.current.get(f.id);
        if (line) {
          const breathe = Math.sin(t / 1400 + i * 0.9) * 0.5 + 0.5; // 0..1, slow
          line.opacity(0.55 + 0.3 * breathe);
        }
        const packets = packetRefs.current.get(f.id);
        if (!packets) return;
        for (let pi = 0; pi < packets.length; pi++) {
          const p = packets[pi];
          const phaseMs = (pi * PACKET_DURATION_MS) / packets.length;
          const localT = ((t + phaseMs) % PACKET_DURATION_MS) / PACKET_DURATION_MS;
          const at = pointAlongPath(f.points, localT);
          p.x(at.x);
          p.y(at.y);
          // Fade in/out near the endpoints so packets don't pop.
          p.opacity(Math.sin(localT * Math.PI));
        }
      });
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [layout]);

  return (
    <Group ref={groupRef} listening={false}>
      {/* The "solar system": one circle, centred on Exec (Greg, 2026-09-12). */}
      <Circle
        x={layout.company.x}
        y={layout.company.y}
        radius={layout.company.hw}
        fill={WHITE}
        opacity={0.55}
        stroke={INK_SOFT}
        strokeWidth={2.5}
        dash={[10, 8]}
        perfectDrawEnabled={false}
      />

      {layout.flows.map((f) => {
        const color = f.kind === "income" ? INCOME : OUTFLOW;
        const mid = pointAlongPath(f.points, 0.5);
        return (
          <Group key={f.id}>
            <Line
              ref={(node) => {
                if (node) lineRefs.current.set(f.id, node);
              }}
              points={flat(f.points)}
              stroke={color}
              strokeWidth={FLOW_STROKE}
              lineCap="butt"
              opacity={0.7}
              perfectDrawEnabled={false}
            />
            {f.amountLabel && (
              <LabelChip x={mid.x - 42} y={mid.y - 11} width={84} height={22} color={color} text={f.amountLabel} fontSize={12} />
            )}
            {Array.from({ length: PACKETS_PER_FLOW }).map((_, pi) => (
              <Circle
                key={pi}
                ref={(node) => {
                  if (!node) return;
                  const arr = packetRefs.current.get(f.id) ?? [];
                  arr[pi] = node;
                  packetRefs.current.set(f.id, arr);
                }}
                x={f.points[0].x}
                y={f.points[0].y}
                radius={FLOW_STROKE * 0.6}
                fill={WHITE}
                stroke={color}
                strokeWidth={invScale}
                perfectDrawEnabled={false}
              />
            ))}
          </Group>
        );
      })}

      {layout.externalNodes.map((n) => (
        <Group key={n.id} x={n.x} y={n.y}>
          <Rect
            x={-n.hw}
            y={-n.hh}
            width={n.hw * 2}
            height={n.hh * 2}
            cornerRadius={18}
            fill={WHITE}
            stroke={LINE}
            strokeWidth={2}
            perfectDrawEnabled={false}
          />
          <Text
            text={n.name}
            x={-n.hw + 10}
            y={-n.hh + 15}
            width={n.hw * 2 - 20}
            align="center"
            fontSize={13.5}
            fontStyle="bold"
            fontFamily={FONT}
            fill={INK}
          />
          <Text
            text={n.note}
            x={-n.hw + 10}
            y={-n.hh + 38}
            width={n.hw * 2 - 20}
            align="center"
            fontSize={11}
            fontFamily={FONT}
            fill={INK_SOFT}
          />
        </Group>
      ))}
    </Group>
  );
}

/**
 * A hub's central, permanently-visible title circle, with spokes to its
 * children (each labeled with that child's share of the hub's budget). One
 * instance covers the company → value-stream level; one per stream covers
 * stream → team. The richer owner/stats/produced-value detail lives in a
 * hover-only DOM popup (OrgCanvas.tsx's HubHoverCard) instead of a
 * permanent on-canvas card (Greg, 2026-09-12) — this component only draws
 * the circle, its title, and its spokes; `onHoverHub`/`onLeaveHub`/
 * `onDragHub` let the parent own everything hover- or drag-related, since
 * only it knows which hub ids are draggable value streams.
 */
export type AllocHub = {
  id: string;
  title: string;
  ownerLine: { text: string; warn: boolean } | null;
  statsLine: string;
  /** "Produces ~$X/mo" — the inferred value of what this hub's people are
   *  currently shipping, rolled up from their in-progress cards. Absent
   *  when nothing priced is in flight. */
  producedLine: string | null;
  hue: string;
  circle: { x: number; y: number; r: number };
  lines: AllocationLine[];
  /** Depth in the hierarchy — used to pick the spoke's stroke width (and,
   *  via computeAllocationSpokes, the fan spacing that's derived from it).
   *  See lib/canvas/allocationFlow.ts's TIER_STROKE — the single source of
   *  truth for both. */
  tier: Tier;
};

const ALLOC_BREATHE_MS = 1600;

/** Largest font size at which `text` still fits `width` on one line. */
const fitFontSize = (text: string, width: number, max: number, min: number) =>
  Math.min(max, Math.max(min, width / Math.max(1, text.length * 0.56)));

export function AllocationScene({
  hubs,
  scale,
  onHoverHub,
  onLeaveHub,
  onDragHub,
  draggingHubId,
}: {
  hubs: AllocHub[];
  scale: number;
  onHoverHub?: (hub: AllocHub) => void;
  onLeaveHub?: () => void;
  onDragHub?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, hub: AllocHub) => void;
  draggingHubId?: string | null;
}) {
  const invScale = 1 / scale;
  const groupRef = useRef<Konva.Group | null>(null);
  const lineRefs = useRef(new Map<string, Konva.Line>());

  useEffect(() => {
    const layer = groupRef.current?.getLayer() ?? null;
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const t = frame.time;
      let i = 0;
      for (const hub of hubs) {
        for (const line of hub.lines) {
          const ref = lineRefs.current.get(line.id);
          if (ref) {
            const breathe = Math.sin(t / ALLOC_BREATHE_MS + i * 0.7) * 0.5 + 0.5;
            ref.opacity(0.45 + 0.28 * breathe);
          }
          i++;
        }
      }
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [hubs]);

  return (
    <Group ref={groupRef}>
      {hubs.map((hub) => {
        const titleSize = fitFontSize(hub.title, hub.circle.r * 1.7, 15, 10);
        return (
          <Group key={hub.id}>
            {hub.lines.map((l) => {
              const mid = pointAlongPath(l.points, 0.5);
              return (
                <Group key={l.id}>
                  <Line
                    ref={(node) => {
                      if (node) lineRefs.current.set(l.id, node);
                    }}
                    points={flat(l.points)}
                    stroke={hub.hue}
                    strokeWidth={TIER_STROKE[hub.tier]}
                    lineCap="round"
                    opacity={0.6}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                  <LabelChip x={mid.x - 36} y={mid.y - 10} width={72} height={19} color={hub.hue} text={l.amountLabel} fontSize={10.5} />
                </Group>
              );
            })}
            <Circle
              x={hub.circle.x}
              y={hub.circle.y}
              radius={hub.circle.r}
              fill={WHITE}
              stroke={hub.hue}
              strokeWidth={(draggingHubId === hub.id ? 4 : 2.5) * invScale}
              dash={draggingHubId === hub.id ? [10, 6] : undefined}
              onMouseEnter={(e) => {
                const c = e.target.getStage()?.container();
                if (c) c.style.cursor = "move";
                onHoverHub?.(hub);
              }}
              onMouseLeave={(e) => {
                const c = e.target.getStage()?.container();
                if (c) c.style.cursor = "grab";
                onLeaveHub?.();
              }}
              onMouseDown={(e) => onDragHub?.(e, hub)}
              onTouchStart={(e) => onDragHub?.(e, hub)}
              perfectDrawEnabled={false}
            />
            <Text
              text={hub.title}
              x={hub.circle.x - hub.circle.r}
              y={hub.circle.y - titleSize / 2}
              width={hub.circle.r * 2}
              align="center"
              wrap="none"
              ellipsis
              fontSize={titleSize}
              fontStyle="bold"
              fontFamily={FONT}
              fill={hub.hue}
              listening={false}
            />
          </Group>
        );
      })}
    </Group>
  );
}

/**
 * A plain, label-free connection — team → person and person → card (Greg,
 * 2026-09-12) — same straight-line routing as the cost-bearing spokes
 * above, just without a card/circle/label at either end — the circles
 * already there (team, person, work-item) are the endpoints. Each spoke
 * carries its own colour/dash so a person→card line can match its card's
 * own "priced vs essential" treatment.
 */
export type ColoredSpoke = Spoke & { color: string; dash?: number[] };

export function SpokeScene({
  spokes,
  strokeWidth,
  opacity = 0.5,
}: {
  spokes: ColoredSpoke[];
  strokeWidth: number;
  opacity?: number;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const lineRefs = useRef(new Map<string, Konva.Line>());

  useEffect(() => {
    const layer = groupRef.current?.getLayer() ?? null;
    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const t = frame.time;
      spokes.forEach((s, i) => {
        const ref = lineRefs.current.get(s.id);
        if (ref) {
          const breathe = Math.sin(t / 1700 + i * 0.6) * 0.5 + 0.5;
          ref.opacity(opacity * (0.55 + 0.45 * breathe));
        }
      });
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [spokes, opacity]);

  return (
    <Group ref={groupRef} listening={false}>
      {spokes.map((s) => (
        <Line
          key={s.id}
          ref={(node) => {
            if (node) lineRefs.current.set(s.id, node);
          }}
          points={flat(s.points)}
          stroke={s.color}
          strokeWidth={strokeWidth}
          dash={s.dash}
          lineCap="round"
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}
