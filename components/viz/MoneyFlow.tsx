"use client";

import { useEffect, useRef } from "react";
import Konva from "konva";
import { Group, Rect, Text, Circle, Shape } from "react-konva";
import { type MoneyFlowLayout, type WorldBounds, FLOW_STROKE } from "@/lib/canvas/moneyFlow";
import { GRID_SIZE } from "@/lib/canvas/grid";
import { CARD_PAD, CARD_LINE_H, ALLOC_STROKE, type AllocationLine, type Box } from "@/lib/canvas/allocationFlow";
import { pointAlongPath, type Point } from "@/lib/canvas/lineRouting";

/**
 * The macro layer: the grid backdrop, the company container, and the
 * external entities (customers, shareholders, government, suppliers) with
 * animated flow lines. Rendered behind the existing stream/team/people
 * content, in the same non-listening background layer.
 *
 * Line rendering (Greg, 2026-09-07): tube-map register — chunky strokes,
 * routed octilinearly (lib/canvas/lineRouting.ts), with a real rounded arc
 * at every bend rather than a sharp corner or a stroke-join rounding. Every
 * routed line in this file goes through `roundedPolylineSceneFunc` so the
 * two line systems (money flow, allocation spokes) read as one visual
 * language.
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
const GRID_DOT = "#d9d4c5";
const FONT = "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

const PACKET_DURATION_MS = 3400;
const PACKETS_PER_FLOW = 2;
const FLOW_CORNER_R = 60; // 3x the original 20 (Greg, 2026-09-11)
const ALLOC_CORNER_R = 42; // 3x the original 14

/** A `Shape` sceneFunc that draws `points` as one continuous stroke with a
 *  real rounded arc at every interior vertex (`ctx.arcTo`) — the Mini Metro
 *  look, not just a thick line's own rounded join. */
function roundedPolylineSceneFunc(points: Point[], radius: number) {
  return (ctx: Konva.Context, shape: Konva.Shape) => {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      ctx.arcTo(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, radius);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.strokeShape(shape);
  };
}

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

export function GridBackdrop({ bounds }: { bounds: WorldBounds }) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        const startX = Math.ceil(bounds.minX / GRID_SIZE) * GRID_SIZE;
        const startY = Math.ceil(bounds.minY / GRID_SIZE) * GRID_SIZE;
        for (let x = startX; x <= bounds.maxX; x += GRID_SIZE) {
          for (let y = startY; y <= bounds.maxY; y += GRID_SIZE) {
            ctx.rect(x - 1, y - 1, 2, 2);
          }
        }
        ctx.fillStyle = GRID_DOT;
        ctx.fillStrokeShape(shape);
      }}
    />
  );
}

export function MoneyFlowScene({ layout }: { layout: MoneyFlowLayout }) {
  const groupRef = useRef<Konva.Group | null>(null);
  const lineRefs = useRef(new Map<string, Konva.Shape>());
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
      <Rect
        x={layout.company.x - layout.company.hw}
        y={layout.company.y - layout.company.hh}
        width={layout.company.hw * 2}
        height={layout.company.hh * 2}
        cornerRadius={56}
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
            <Shape
              ref={(node) => {
                if (node) lineRefs.current.set(f.id, node);
              }}
              sceneFunc={roundedPolylineSceneFunc(f.points, FLOW_CORNER_R)}
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
                strokeWidth={2.5}
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
 * A titled hub card locked to a hull's top-right corner, with spokes to its
 * children (each labeled with that child's share of the hub's budget) and,
 * once its children are visible, a small circle just below the card that
 * spokes actually connect to — both the one arriving from its own parent
 * and the ones fanning out to its children. One instance covers the company
 * → value-stream level; one per stream covers stream → team. The geometry
 * (card size, circle position, spoke routing) comes pre-computed from
 * lib/canvas/allocationFlow.ts so this component only draws it — it never
 * decides layout itself, which is what keeps the card and the spoke
 * endpoints from drifting apart.
 */
export type AllocHub = {
  id: string;
  card: Box;
  title: string;
  ownerLine: { text: string; warn: boolean } | null;
  statsLine: string;
  hue: string;
  circle: { x: number; y: number; r: number } | null;
  lines: AllocationLine[];
};

const ALLOC_BREATHE_MS = 1600;

/** Largest font size at which `text` still fits `width` on one line. */
const fitFontSize = (text: string, width: number, max: number, min: number) =>
  Math.min(max, Math.max(min, width / Math.max(1, text.length * 0.56)));

export function AllocationScene({ hubs }: { hubs: AllocHub[] }) {
  const groupRef = useRef<Konva.Group | null>(null);
  const lineRefs = useRef(new Map<string, Konva.Shape>());

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
    <Group ref={groupRef} listening={false}>
      {hubs.map((hub) => {
        const innerW = hub.card.hw * 2 - CARD_PAD * 2;
        const titleSize = fitFontSize(hub.title, innerW, 16, 11);
        const yTitle = hub.card.y - hub.card.hh + CARD_PAD;
        const yOwner = yTitle + titleSize + 5;
        const yStats = yOwner + (hub.ownerLine ? CARD_LINE_H : 0);
        return (
          <Group key={hub.id}>
            {hub.lines.map((l) => {
              const mid = pointAlongPath(l.points, 0.5);
              return (
                <Group key={l.id}>
                  <Shape
                    ref={(node) => {
                      if (node) lineRefs.current.set(l.id, node);
                    }}
                    sceneFunc={roundedPolylineSceneFunc(l.points, ALLOC_CORNER_R)}
                    stroke={hub.hue}
                    strokeWidth={ALLOC_STROKE}
                    lineCap="butt"
                    opacity={0.6}
                    perfectDrawEnabled={false}
                  />
                  <LabelChip x={mid.x - 36} y={mid.y - 10} width={72} height={19} color={hub.hue} text={l.amountLabel} fontSize={10.5} />
                </Group>
              );
            })}
            {hub.circle && (
              <Circle
                x={hub.circle.x}
                y={hub.circle.y}
                radius={hub.circle.r}
                fill={WHITE}
                stroke={hub.hue}
                strokeWidth={2.5}
                perfectDrawEnabled={false}
              />
            )}
            <Rect
              x={hub.card.x - hub.card.hw}
              y={hub.card.y - hub.card.hh}
              width={hub.card.hw * 2}
              height={hub.card.hh * 2}
              cornerRadius={10}
              fill={WHITE}
              stroke={hub.hue}
              strokeWidth={2}
              perfectDrawEnabled={false}
            />
            <Text
              text={hub.title}
              x={hub.card.x - hub.card.hw + CARD_PAD}
              y={yTitle}
              width={innerW}
              wrap="none"
              ellipsis
              fontSize={titleSize}
              fontStyle="bold"
              fontFamily={FONT}
              fill={hub.hue}
            />
            {hub.ownerLine && (
              <Text
                text={hub.ownerLine.text}
                x={hub.card.x - hub.card.hw + CARD_PAD}
                y={yOwner}
                width={innerW}
                wrap="none"
                ellipsis
                fontSize={11}
                fontStyle={hub.ownerLine.warn ? "bold" : "normal"}
                fontFamily={FONT}
                fill={hub.ownerLine.warn ? "#ef4444" : INK_SOFT}
              />
            )}
            <Text
              text={hub.statsLine}
              x={hub.card.x - hub.card.hw + CARD_PAD}
              y={yStats}
              width={innerW}
              wrap="none"
              ellipsis
              fontSize={11}
              fontFamily={FONT}
              fill={INK_SOFT}
              opacity={0.85}
            />
          </Group>
        );
      })}
    </Group>
  );
}
