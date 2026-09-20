"use client";

// Archived after the semantic-focus interaction graduated to OrbitalMap.

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { buildMockOrg, type Org, type OrgNode } from "./mockOrg";
import { project, type PlacedNode, type Projection } from "./projection";

const C = {
  paper: "#f6f4ef",
  panel: "#fffdf8",
  ink: "#22272e",
  inkSoft: "#626a73",
  faint: "#a9a394",
  band: "#ddd7c8",
  fill: "#fffdf8",
  stroke: "#aaa394",
  link: "#c9c3b5",
  violet: "#7667f5",
  delivery: "#343a43",
  sprint: "#7b8490",
  health: "#d9b84b",
  person: "#737b85",
  work: "#343a43",
};

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const VIEW_W = 1000;
const VIEW_H = 760;

const DATASETS = {
  small: { label: "Sparrow · 10", people: 10, maxDepth: 3, seed: 12, rootName: "Sparrow Jam Manufacturing" },
  medium: { label: "Digital · 45", people: 45, maxDepth: 5, seed: 44, rootName: "Digital Tailoring Supplies" },
  large: { label: "Northwind · 2,400", people: 2400, maxDepth: 11, seed: 20260915, rootName: "Northwind Freight & Logistics" },
} as const;

type DatasetKey = keyof typeof DATASETS;
type Camera = { x: number; y: number; k: number };

const short = (value: string, length = 14) =>
  value.length <= length ? value : `${value.slice(0, length - 1)}…`;

function hash(value: string, salt: number) {
  let n = 2166136261 ^ salt;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0) / 4294967295;
}

function metrics(node: OrgNode) {
  return {
    delivery: 0.18 + hash(node.id, 11) * 0.72,
    sprint: 0.2 + hash(node.id, 37) * 0.68,
    health: 0.42 + hash(node.id, 71) * 0.5,
  };
}

function nodeOpacity(node: PlacedNode) {
  if (node.role === "centre") return 1;
  if (node.role === "near") return 0.96;
  if (node.role === "context") return 0.43;
  return 0.16;
}

function peopleFor(node: PlacedNode, zoom: number) {
  if (node.role !== "centre" && node.role !== "near") return [];
  const count = Math.min(node.node.headcount, 16);
  const radius = node.radius + 17;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      angle,
      work: zoom >= 2.15 ? 1 + Math.floor(hash(`${node.node.id}-${index}`, 101) * 3) : 0,
    };
  });
}

export default function OrbitalFocusMap() {
  const [dataset, setDataset] = useState<DatasetKey>("large");
  const [markBudget, setMarkBudget] = useState(55);
  const [bandStep, setBandStep] = useState(150);
  const [snapping, setSnapping] = useState(true);
  const [showPeople, setShowPeople] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
  const returnCamera = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ clientX: number; clientY: number; camera: Camera } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const org = useMemo<Org>(() => buildMockOrg(DATASETS[dataset]), [dataset]);
  const view = useMemo<Projection>(
    () => project(org, { focusId, selectedId, markBudget, bandStep, snapping }),
    [org, focusId, selectedId, markBudget, bandStep, snapping],
  );
  const hovered = hoveredId ? view.byId.get(hoveredId) : undefined;
  const inspected = hovered ?? (selectedId ? view.byId.get(selectedId) : undefined);
  const focused = focusId ? org.byId.get(focusId) : undefined;
  /** The master map deliberately opens through CEO+3, so its initial camera
   * fits those fixed bands. A local map only has two descendant rings and can
   * use the full scale. This is camera framing, never layout geometry. */
  const framingScale = view.mode === "local" ? 1 : 0.65;
  const effectiveScale = camera.k * framingScale;
  const worldCentre = view.mode === "unsnapped" && focusId
    ? view.byId.get(focusId) ?? { x: 0, y: 0 }
    : { x: 0, y: 0 };

  const resetDataset = (next: DatasetKey) => {
    setDataset(next);
    setFocusId(null);
    setSelectedId(null);
    setHoveredId(null);
    setCamera({ x: 0, y: 0, k: 1 });
  };

  const enterFocus = (node: OrgNode) => {
    if (!focusId) returnCamera.current = camera;
    setFocusId(node.id);
    setSelectedId(node.id);
    setHoveredId(null);
    setCamera((current) => ({
      x: 0,
      y: 0,
      k: current.k,
    }));
  };

  const changeSnapping = (next: boolean) => {
    setSnapping(next);
    if (!focusId) return;
    setCamera((current) => ({ ...current, x: 0, y: 0 }));
  };

  const leaveFocus = () => {
    if (!focusId) {
      setSelectedId(null);
      return;
    }
    setFocusId(null);
    setSelectedId(null);
    setHoveredId(null);
    if (snapping) {
      setCamera((current) => ({ ...returnCamera.current, k: current.k }));
    }
  };

  const pointerInViewBox = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W - VIEW_W / 2,
      y: ((clientY - rect.top) / rect.height) * VIEW_H - VIEW_H / 2,
    };
  };

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const pointer = pointerInViewBox(event.clientX, event.clientY);
    const nextK = Math.max(0.65, Math.min(4.5, camera.k * Math.exp(-event.deltaY * 0.0014)));
    const nextEffective = nextK * framingScale;
    const world = { x: (pointer.x - camera.x) / effectiveScale, y: (pointer.y - camera.y) / effectiveScale };
    setCamera({ x: pointer.x - world.x * nextEffective, y: pointer.y - world.y * nextEffective, k: nextK });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const held = drag.current;
    if (!held) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((event.clientX - held.clientX) / rect.width) * VIEW_W;
    const dy = ((event.clientY - held.clientY) / rect.height) * VIEW_H;
    setCamera({ ...held.camera, x: held.camera.x + dx, y: held.camera.y + dy });
  };

  return (
    <div style={S.shell}>
      <aside style={S.sidebar}>
        <div style={S.eyebrow}>Design study · fixed bands</div>
        <h1 style={S.title}>Scale without losing place</h1>
        <p style={S.intro}>
          Reporting distance is an index, not a measurement. Bands stay fixed; density is handled by
          opening real branches and collapsing the rest.
        </p>

        <div style={S.datasetRow}>
          {(Object.keys(DATASETS) as DatasetKey[]).map((key) => (
            <button key={key} type="button" style={S.pill(dataset === key)} onClick={() => resetDataset(key)}>
              {DATASETS[key].label}
            </button>
          ))}
        </div>

        <Stat label="Organisational nodes" value={org.totals.units.toLocaleString()} />
        <Stat label="People" value={org.totals.people.toLocaleString()} />
        <Stat label="Nodes represented" value={`${view.placed.length} / ${markBudget}`} strong />
        <Stat label="Fixed band step" value={`${bandStep}`} />

        <Control
          label="Structural mark budget"
          hint="People and work do not count toward this budget."
          value={markBudget}
          min={16}
          max={90}
          step={1}
          onChange={setMarkBudget}
        />
        <Control
          label="Fixed band distance"
          hint="Unchanged by company size, headcount, or work."
          value={bandStep}
          min={120}
          max={190}
          step={5}
          onChange={setBandStep}
        />

        <Toggle checked={snapping} onChange={changeSnapping} label="Snapping on" />
        <Toggle checked={showPeople} onChange={setShowPeople} label="Show people on local nodes" />

        <div style={S.note}>
          <strong>Try this.</strong> Double-click a counted circle, or select it and use <em>Focus this
          node</em>. Its branch becomes a temporary local map: parent and children stay clear;
          grandparent, grandchildren and peers step back. Scroll changes detail only. Click empty
          space to leave focus without zooming out.
        </div>

        {!snapping && (
          <div style={S.warning}>
            Snapping is off. Focus still centres and filters, but nodes retain their master-map positions.
          </div>
        )}
      </aside>

      <main style={S.stage}>
        <div style={S.topbar}>
          <div style={S.breadcrumb}>
            {view.breadcrumb.length === 0 ? (
              <span style={S.modeBadge}>Whole company · CEO+0–3</span>
            ) : (
              view.breadcrumb.map((node, index) => (
                <span key={node.id} style={S.crumbWrap}>
                  {index > 0 && <span style={S.crumbDivider}>›</span>}
                  <button
                    type="button"
                    style={S.crumb(node.id === focusId)}
                    onClick={() => {
                      if (node.id === org.rootId) leaveFocus();
                      else enterFocus(node);
                    }}
                  >
                    {short(node.name, 22)}
                  </button>
                </span>
              ))
            )}
          </div>
          <div style={S.modeText}>
            {view.mode === "global" ? "master arrangement" : view.mode === "local" ? "local focus" : "focus · positions unlocked"}
          </div>
        </div>

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${-VIEW_W / 2} ${-VIEW_H / 2} ${VIEW_W} ${VIEW_H}`}
          style={{ display: "block", cursor: drag.current ? "grabbing" : "grab", touchAction: "none" }}
          onWheel={onWheel}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { clientX: event.clientX, clientY: event.clientY, camera };
          }}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            drag.current = null;
          }}
          onPointerCancel={() => { drag.current = null; }}
          onPointerLeave={() => { drag.current = null; setHoveredId(null); }}
          onClick={(event) => {
            if (event.target === event.currentTarget) leaveFocus();
          }}
        >
          <g transform={`translate(${camera.x} ${camera.y})`}>
            <g transform={`scale(${effectiveScale})`}>
              <g transform={`translate(${-worldCentre.x} ${-worldCentre.y})`}>
                <Bands view={view} bandStep={bandStep} focus={focused} />
                <Links view={view} bandStep={bandStep} />
                {showPeople && focusId && view.placed.map((node) => (
                  <People key={`people-${node.node.id}`} placed={node} zoom={camera.k} />
                ))}
                {view.placed.map((placed) => (
                  <NodeMark
                    key={placed.node.id}
                    placed={placed}
                    selected={selectedId === placed.node.id}
                    onSelect={() => setSelectedId(placed.node.id)}
                    onFocus={() => enterFocus(placed.node)}
                    onHover={setHoveredId}
                  />
                ))}
              </g>
            </g>
          </g>
        </svg>

        {inspected && (
          <HoverCard
            placed={inspected}
            focused={focusId === inspected.node.id}
            onFocus={() => enterFocus(inspected.node)}
          />
        )}

        <div style={S.legend}>
          <span><i style={{ ...S.legendDot, borderColor: C.violet }} /> route / selection</span>
          <span><i style={{ ...S.legendDot, borderStyle: "dashed" }} /> unopened real branch</span>
          <span><i style={{ ...S.personDot }} /> human</span>
          <span style={{ color: C.faint }}>double-click or Focus button · click paper exits · scroll reveals</span>
        </div>
      </main>
    </div>
  );
}

function Bands({ view, bandStep, focus }: { view: Projection; bandStep: number; focus?: OrgNode }) {
  if (view.mode === "local") {
    return (
      <g opacity={0.9} pointerEvents="none">
        {[1, 2].map((level) => (
          <g key={level}>
            <circle r={level * bandStep} fill="none" stroke={C.band} strokeWidth={1.2} />
            <text x={0} y={-level * bandStep - 9} textAnchor="middle" fontSize={12} fill={C.faint}>
              {level === 1 ? "+1 · children" : "+2 · grandchildren"}
            </text>
          </g>
        ))}
        <text x={0} y={-82} textAnchor="middle" fontSize={11} fill={C.faint}>
          local centre · CEO+{focus?.depth ?? 0}
        </text>
      </g>
    );
  }

  return (
    <g opacity={0.9} pointerEvents="none">
      {[1, 2, 3].map((level) => (
        <g key={level}>
          <circle r={level * bandStep} fill="none" stroke={C.band} strokeWidth={1.2} />
          <text x={0} y={-level * bandStep - 9} textAnchor="middle" fontSize={12} fill={C.faint}>
            CEO+{level}
          </text>
        </g>
      ))}
    </g>
  );
}

function Links({ view, bandStep }: { view: Projection; bandStep: number }) {
  const lines = view.placed.flatMap((node) => {
    const parent = node.node.parentId ? view.byId.get(node.node.parentId) : undefined;
    if (!parent) return [];
    return [{ node, parent }];
  });
  const routeStart = view.placed
    .filter((node) => node.onRoute)
    .sort((a, b) => a.node.depth - b.node.depth)[0];

  return (
    <g pointerEvents="none">
      {lines.filter(({ node, parent }) => !(node.onRoute && parent.onRoute)).map(({ node, parent }) => (
        <line
          key={`link-${node.node.id}`}
          x1={parent.x}
          y1={parent.y}
          x2={node.x}
          y2={node.y}
          stroke={C.link}
          strokeWidth={1.5}
          opacity={Math.min(nodeOpacity(node), nodeOpacity(parent))}
        />
      ))}
      {lines.filter(({ node, parent }) => node.onRoute && parent.onRoute).map(({ node, parent }) => (
        <line
          key={`route-${node.node.id}`}
          x1={parent.x}
          y1={parent.y}
          x2={node.x}
          y2={node.y}
          stroke={C.violet}
          strokeWidth={3.2}
          opacity={0.78}
        />
      ))}
      {view.mode === "local" && view.hasMoreAncestors && routeStart && (
        <g opacity={0.48}>
          <line
            x1={routeStart.x}
            y1={routeStart.y}
            x2={routeStart.x - bandStep * 0.72}
            y2={routeStart.y}
            stroke={C.violet}
            strokeWidth={2.4}
            strokeDasharray="7 6"
          />
          <path
            d={`M ${routeStart.x - bandStep * 0.72} ${routeStart.y} l 12 -7 l 0 14 z`}
            fill={C.violet}
          />
          <text x={routeStart.x - bandStep * 0.38} y={routeStart.y - 10} textAnchor="middle" fontSize={11} fill={C.violet}>
            route to company centre
          </text>
        </g>
      )}
    </g>
  );
}

function NodeMark({
  placed,
  selected,
  onSelect,
  onFocus,
  onHover,
}: {
  placed: PlacedNode;
  selected: boolean;
  onSelect: () => void;
  onFocus: () => void;
  onHover: (id: string | null) => void;
}) {
  const m = metrics(placed.node);
  const opacity = nodeOpacity(placed);
  const ringRadius = placed.radius + 8;
  const circumference = TAU * ringRadius;
  const textWidth = placed.radius * 1.65;
  return (
    <g
      transform={`translate(${placed.x} ${placed.y})`}
      opacity={opacity}
      role="button"
      tabIndex={0}
      aria-label={`${placed.node.name}, CEO plus ${placed.node.depth}`}
      style={{ cursor: "pointer", transition: "transform 480ms cubic-bezier(.2,.8,.2,1), opacity 320ms ease" }}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onDoubleClick={(event) => { event.stopPropagation(); onFocus(); }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => onHover(placed.node.id)}
      onMouseLeave={() => onHover(null)}
    >
      {[m.delivery, m.sprint, m.health].map((value, index) => (
        <circle
          key={index}
          r={ringRadius + index * 5}
          fill="none"
          stroke={index === 0 ? C.delivery : index === 1 ? C.sprint : C.health}
          strokeWidth={2.7}
          strokeDasharray={`${circumference * value} ${circumference}`}
          transform="rotate(-90)"
          opacity={0.72}
        />
      ))}
      <circle
        r={placed.radius}
        fill={C.fill}
        stroke={selected ? C.ink : placed.onRoute ? C.violet : C.stroke}
        strokeWidth={selected ? 4 : placed.onRoute ? 2.8 : 1.6}
      />
      {placed.collapsed && (
        <circle
          r={Math.max(10, placed.radius - 7)}
          fill="none"
          stroke={C.stroke}
          strokeWidth={1.1}
          strokeDasharray="4 4"
        />
      )}
      <text textAnchor="middle" y={placed.collapsed ? -5 : 4} fontSize={placed.role === "centre" ? 12.5 : 10.5} fill={C.ink}>
        {short(placed.node.name, placed.role === "centre" ? 17 : 13)}
      </text>
      {placed.collapsed && (
        <text textAnchor="middle" y={11} fontSize={8.7} fill={C.inkSoft}>
          {placed.node.totalTeams}t · {placed.node.totalPeople}p
        </text>
      )}
      {!placed.collapsed && placed.node.isTeam && (
        <text textAnchor="middle" y={16} fontSize={8.7} fill={C.inkSoft}>
          {placed.node.headcount} people
        </text>
      )}
      <rect x={-textWidth / 2} y={-placed.radius} width={textWidth} height={placed.radius * 2} fill="transparent" />
    </g>
  );
}

function People({ placed, zoom }: { placed: PlacedNode; zoom: number }) {
  const people = peopleFor(placed, zoom);
  if (people.length === 0) return null;
  return (
    <g transform={`translate(${placed.x} ${placed.y})`} pointerEvents="none" opacity={nodeOpacity(placed)}>
      {people.map((person, index) => (
        <g key={index} transform={`translate(${person.x} ${person.y})`}>
          <line x1={0} y1={0} x2={-Math.cos(person.angle) * 10} y2={-Math.sin(person.angle) * 10} stroke={C.link} strokeWidth={1} />
          <circle r={5.2} fill={index === 0 ? C.ink : C.person} />
          {Array.from({ length: person.work }, (_, workIndex) => {
            const distance = 10 + workIndex * 7;
            return (
              <circle
                key={workIndex}
                cx={Math.cos(person.angle) * distance}
                cy={Math.sin(person.angle) * distance}
                r={2.2}
                fill={C.work}
                opacity={0.62}
              />
            );
          })}
        </g>
      ))}
      {placed.node.headcount > people.length && (
        <text x={0} y={placed.radius + 30} textAnchor="middle" fontSize={9} fill={C.inkSoft}>
          +{placed.node.headcount - people.length}
        </text>
      )}
    </g>
  );
}

function HoverCard({ placed, focused, onFocus }: { placed: PlacedNode; focused: boolean; onFocus: () => void }) {
  const m = metrics(placed.node);
  return (
    <div style={S.hoverCard}>
      <strong style={{ fontSize: 14 }}>{placed.node.name}</strong>
      <span style={{ color: C.inkSoft, fontSize: 11.5 }}>
        {placed.node.isTeam ? "Team" : "Organisational node"} · CEO+{placed.node.depth}
      </span>
      <Metric label="delivery" value={m.delivery} color={C.delivery} />
      <Metric label="sprint" value={m.sprint} color={C.sprint} />
      <Metric label="team health" value={m.health} color={C.health} />
      <span style={{ color: C.inkSoft, fontSize: 11.5 }}>
        {placed.node.totalPeople.toLocaleString()} people · {placed.node.totalTeams.toLocaleString()} teams in branch
      </span>
      <button type="button" style={S.focusButton} disabled={focused} onClick={onFocus}>
        {focused ? "Current focus" : placed.collapsed ? "Open this branch" : "Focus this node"}
      </button>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={S.metric}>
      <span style={{ width: 72 }}>{label}</span>
      <span style={S.metricTrack}><i style={{ ...S.metricFill, width: `${value * 100}%`, background: color }} /></span>
      <span>{Math.round(value * 100)}%</span>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={S.stat}>
      <span style={{ color: C.inkSoft }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 500, fontSize: strong ? 16 : 13 }}>{value}</span>
    </div>
  );
}

function Control({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={S.control}>
      <span style={S.controlHead}><strong>{label}</strong><span>{value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span style={S.hint}>{hint}</span>
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label style={S.toggle}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const TAU = Math.PI * 2;

const S = {
  shell: {
    display: "flex",
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    background: C.paper,
    color: C.ink,
    fontFamily: FONT,
  } satisfies CSSProperties,
  sidebar: {
    width: 292,
    flexShrink: 0,
    padding: "22px 20px",
    borderRight: `1px solid ${C.band}`,
    background: "rgba(255,253,248,0.78)",
    overflowY: "auto",
  } satisfies CSSProperties,
  eyebrow: { fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.inkSoft } satisfies CSSProperties,
  title: { fontSize: 20, margin: "6px 0 10px", fontWeight: 650 } satisfies CSSProperties,
  intro: { fontSize: 12.5, lineHeight: 1.55, color: C.inkSoft, margin: "0 0 14px" } satisfies CSSProperties,
  datasetRow: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 } satisfies CSSProperties,
  pill: (active: boolean): CSSProperties => ({
    border: `1px solid ${active ? C.ink : C.band}`,
    borderRadius: 999,
    background: active ? C.ink : "transparent",
    color: active ? C.paper : C.inkSoft,
    padding: "5px 8px",
    fontSize: 10.5,
    cursor: "pointer",
  }),
  stat: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", fontSize: 12.5 } satisfies CSSProperties,
  control: { display: "grid", gap: 5, margin: "15px 0" } satisfies CSSProperties,
  controlHead: { display: "flex", justifyContent: "space-between", fontSize: 12 } satisfies CSSProperties,
  hint: { fontSize: 10.5, lineHeight: 1.4, color: C.inkSoft } satisfies CSSProperties,
  toggle: { display: "flex", alignItems: "center", gap: 8, margin: "9px 0", fontSize: 12.5, color: C.inkSoft } satisfies CSSProperties,
  note: { marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.band}`, color: C.inkSoft, fontSize: 11.5, lineHeight: 1.55 } satisfies CSSProperties,
  warning: { marginTop: 12, padding: 10, borderRadius: 9, background: "#efece4", fontSize: 11, lineHeight: 1.45, color: C.inkSoft } satisfies CSSProperties,
  stage: { position: "relative", flex: 1, overflow: "hidden" } satisfies CSSProperties,
  topbar: { position: "absolute", zIndex: 5, top: 14, left: 18, right: 18, display: "flex", justifyContent: "space-between", gap: 12, pointerEvents: "none" } satisfies CSSProperties,
  breadcrumb: { display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", pointerEvents: "auto", maxWidth: "78%" } satisfies CSSProperties,
  modeBadge: { display: "inline-flex", padding: "5px 10px", borderRadius: 999, background: C.ink, color: C.paper, fontSize: 11.5 } satisfies CSSProperties,
  crumbWrap: { display: "inline-flex", gap: 3, alignItems: "center" } satisfies CSSProperties,
  crumbDivider: { color: C.faint, fontSize: 12 } satisfies CSSProperties,
  crumb: (active: boolean): CSSProperties => ({
    border: "none",
    background: active ? C.ink : "rgba(246,244,239,0.8)",
    color: active ? C.paper : C.inkSoft,
    borderRadius: 999,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 11,
  }),
  modeText: { fontSize: 10.5, color: C.inkSoft, letterSpacing: 0.7, textTransform: "uppercase", paddingTop: 6 } satisfies CSSProperties,
  hoverCard: { position: "absolute", zIndex: 6, top: 58, right: 18, width: 230, display: "grid", gap: 7, padding: 13, borderRadius: 12, background: "rgba(255,253,248,0.96)", border: `1px solid ${C.band}`, boxShadow: "0 12px 30px rgba(34,39,46,0.12)" } satisfies CSSProperties,
  focusButton: { border: "none", borderRadius: 8, padding: "8px 10px", background: C.ink, color: C.paper, fontSize: 11.5, cursor: "pointer" } satisfies CSSProperties,
  metric: { display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: C.inkSoft } satisfies CSSProperties,
  metricTrack: { width: 74, height: 4, borderRadius: 999, background: C.band, overflow: "hidden" } satisfies CSSProperties,
  metricFill: { display: "block", height: "100%", borderRadius: 999 } satisfies CSSProperties,
  legend: { position: "absolute", zIndex: 5, left: 18, bottom: 14, display: "flex", flexWrap: "wrap", gap: 13, alignItems: "center", padding: "7px 10px", border: `1px solid ${C.band}`, borderRadius: 10, background: "rgba(255,253,248,0.88)", color: C.inkSoft, fontSize: 10.5, pointerEvents: "none" } satisfies CSSProperties,
  legendDot: { display: "inline-block", width: 10, height: 10, border: `2px solid ${C.stroke}`, borderRadius: "50%", marginRight: 4, verticalAlign: -1 } satisfies CSSProperties,
  personDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: C.person, marginRight: 4 } satisfies CSSProperties,
};
