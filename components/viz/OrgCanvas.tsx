"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Stage, Layer, Group, Circle, Rect, Text, Arc } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { OrgUnit, Person, Assignment, MapNodeRow, Discipline } from "@/lib/db/schema";
import {
  saveMapNodePosition,
  moveAssignment,
  moveOrgUnit,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  createPerson,
  updatePerson,
  deletePerson,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  tidyUpCanvasLayout,
  saveLens,
  saveMapNodePositions,
} from "@/lib/data/actions";
import {
  buildCanvasMap,
  positionsFromRows,
  CROSS_CUTTING_ID,
  teamNodeRadius,
  teamRingRadius,
  type CanvasNode,
  type CanvasTeam,
  type CanvasPerson,
  type CanvasStream,
  type CanvasAllocation,
  type Position,
} from "@/lib/canvas/buildCanvasMap";

import {
  COLOR_BY_OPTIONS,
  LABEL_BY_OPTIONS,
  disciplineColors,
  personColor,
  personLabel,
  buildLegend,
  initialsOf,
  isDefaultLens,
  type Lens,
} from "@/lib/canvas/lens";
import {
  clearMyView,
  resolveOpeningLens,
  sameLens,
  writeMyView,
} from "@/lib/canvas/myView";
import { lower, type Vocabulary } from "@/lib/vocabulary";
import { VocabularyProvider, useVocabulary } from "@/components/VocabularyProvider";
import PersonTaskBoard from "@/components/viz/PersonTaskBoard";
import { GridBackdrop, MoneyFlowScene, AllocationScene, type AllocHub } from "@/components/viz/MoneyFlow";
import { computeMoneyFlowLayout, DEFAULT_COMPANY_NAME } from "@/lib/canvas/moneyFlow";
import {
  computeAllocationSpokes,
  computeHubGeometry,
  hubRecipient,
  CARD_W,
  CARD_PAD,
  CARD_TITLE_LINE_H,
  CARD_LINE_H,
} from "@/lib/canvas/allocationFlow";
import { snap as snapToGrid } from "@/lib/canvas/grid";

const CROSS_CUTTING_MODE = "connected" as const;
const GHOST_R = 18; // borrowed seat — deliberately smaller than a real seat (22)
import { overAllocatedPersonIds, allocationByPerson } from "@/lib/org/model";
import { computeGaps } from "@/lib/analytics/gaps";
import { computeRollup } from "@/lib/analytics/rollup";

/**
 * v2 canvas map — V2.0 "viewport" (docs/V2.md). Adapted from the verified
 * feel study at app/lab/canvas/CanvasMap.tsx, reading the real workspace
 * snapshot instead of mock data, with positions persisted to `map_nodes` on
 * drag end.
 *
 * V2.1 (parity) — analytics overlays ported here. Still staged for later
 * V2.1/V2.2 passes: the findings rail, scenario mode, drag-to-reassign,
 * search, zones, delivery/reporting layer toggles.
 */

// --- palette (Mini Metro / "paper" register, per docs/V2.md) --------------
const C = {
  paper: "#f6f4ee",
  ink: "#22272e",
  inkSoft: "#5c6570",
  line: "#e4e0d6",
  white: "#ffffff",
  team: "#10b981",
  cross: "#f59e0b",
  external: "#8b5cf6",
  crossStream: "#6366f1", // seats held by someone who spans multiple streams
  utilOk: "#22c55e",
  utilWarn: "#eab308",
  utilOver: "#ef4444",
  heat: "#dc2626",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif";

type Lod = "streams" | "teams" | "people" | "roles";

const lodLabels = (v: Vocabulary): [Lod, string][] => [
  ["streams", v.stream.plural],
  ["teams", v.team.plural],
  ["people", "People"],
  ["roles", "Roles"],
];

type OverlayType = "none" | "allocation" | "gaps" | "cost";

const OVERLAY_OPTIONS: { type: OverlayType; label: string }[] = [
  { type: "none", label: "Overview" },
  { type: "allocation", label: "Allocation" },
  { type: "gaps", label: "Gaps" },
  { type: "cost", label: "Cost / ROI" },
];

type NodeOverlay = { dimmed: boolean; badge: string | null; heatPct: number };
const NO_OVERLAY: NodeOverlay = { dimmed: false, badge: null, heatPct: 0 };

/** Identity colours for value streams — low-saturation "paper" register, used as
 *  a wash inside the stream rectangle and for its header type. Assigned by the
 *  stream's position in the (name-sorted) list, so a stream keeps its colour. */
// Deliberately avoids violet (external vendor teams), the ghost amber, and the
// utilisation red — a stream's identity must never read as a status.
const STREAM_HUES = ["#0e7490", "#4f46e5", "#9d174d", "#15803d", "#a16207"];
const streamHue = (i: number) => STREAM_HUES[i % STREAM_HUES.length];

const MIN_SCALE = 0.1;
const MAX_SCALE = 5; // was 3 — raised so "roles" LOD can pack tighter than the old cap allowed
const TEAM_DROP_PAD = 26; // slack beyond a team's own radius for drop targeting

function lodFor(scale: number): Lod {
  if (scale >= 1.5) return "roles";
  if (scale >= 0.45) return "people";
  if (scale >= 0.26) return "teams";
  return "streams";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const EMPLOYMENT_LABELS: Record<string, string> = {
  fte: "Employee",
  contractor: "Contractor",
  vendor: "Vendor",
  unknown: "—",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Intro choreography: each element gets a window inside the 0→1 intro clock,
 *  so the map assembles (hulls → teams → seats) instead of appearing whole. */
const INTRO_MS = 820;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const phase = (t: number, start: number, dur: number) => easeOut(clamp((t - start) / dur, 0, 1));

const utilOf = (p: CanvasPerson) => p.allocations.reduce((s, a) => s + a.pct, 0);

function utilColor(pct: number) {
  if (pct === 0) return C.inkSoft;
  if (pct > 110) return C.utilOver;
  if (pct > 100) return C.utilWarn;
  return C.utilOk;
}

const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}k`
      : `$${Math.round(n)}`;

type TeamStats = {
  heads: number;
  fte: number;
  cost: number;
  openRoles: number;
  target: number | null;
  shared: number;
};

export function OrgCanvas({
  people: peopleRows,
  units,
  assignments,
  mapNodeRows,
  disciplines,
  lens: initialLens,
  vocabulary,
}: {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  mapNodeRows: MapNodeRow[];
  disciplines: Discipline[];
  lens: Lens;
  /** What this workspace calls its two rungs (S5). Arrives as a prop the same
   *  way the lens does, then goes into context for the leaf components. */
  vocabulary: Vocabulary;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Scenario planning: `moves` overlays assignment -> new orgUnitId without
  // touching the server until Apply. Mirrors RadialOrg.tsx's staging pattern
  // (docs/V2.md V2.1). Node *position* is unaffected — drag always persists
  // immediately, since position is independent, persisted data, not layout.
  const [scenario, setScenario] = useState(false);
  const [moves, setMoves] = useState<Map<string, string>>(new Map());

  const { effAssignments, activeMoveCount } = useMemo(() => {
    if (moves.size === 0) return { effAssignments: assignments, activeMoveCount: 0 };
    let count = 0;
    const eff = assignments.map((a) => {
      const target = moves.get(a.id);
      if (target && target !== a.orgUnitId) {
        count++;
        return { ...a, orgUnitId: target };
      }
      return a;
    });
    return { effAssignments: eff, activeMoveCount: count };
  }, [assignments, moves]);

  const seed = useMemo(
    () => buildCanvasMap(
      { people: peopleRows, units, assignments: effAssignments },
      positionsFromRows(mapNodeRows),
      { crossCuttingMode: CROSS_CUTTING_MODE },
    ),
    [peopleRows, units, effAssignments, mapNodeRows],
  );

  const [nodes, setNodes] = useState<CanvasNode[]>(seed.nodes);
  const streams = seed.streams;

  // Re-derive node content (allocations, home) whenever real data or a staged
  // scenario move changes, keeping each node's current x/y. When mapNodeRows
  // changes (e.g. after Tidy up persists new positions), use the seed x/y
  // directly so the layout actually reflects the server-computed positions.
  const [prevSeed, setPrevSeed] = useState(seed);
  const [prevMapNodeRows, setPrevMapNodeRows] = useState(mapNodeRows);
  if (prevSeed !== seed) {
    setPrevSeed(seed);
    const positionsReset = prevMapNodeRows !== mapNodeRows;
    if (positionsReset) setPrevMapNodeRows(mapNodeRows);
    setNodes((prev) => {
      if (positionsReset) return seed.nodes;
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return seed.nodes.map((n) => {
        const existing = prevById.get(n.id);
        return existing ? { ...n, x: existing.x, y: existing.y } : n;
      });
    });
  }

  const [scale, setScale] = useState(0.3);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [overlayType, setOverlayType] = useState<OverlayType>("none");
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropStreamId, setDropStreamId] = useState<string | null>(null);
  const [introT, setIntroT] = useState(0);
  const [addMode, setAddMode] = useState(false); // Option/Alt held during a person drag
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState<"person" | "team" | "stream" | null>(null);
  // Deepest zoom rung — "click into" a person's task board (mock data, see
  // lib/mock/personTasks.ts). Feel study for customer research, not a real
  // work entity yet.
  const [openTaskPersonId, setOpenTaskPersonId] = useState<string | null>(null);

  // --- lens (S3 / S5) --------------------------------------------------------
  // Two tiers, deliberately. `initialLens` is the WORKSPACE DEFAULT — what a
  // colleague sees on their first open. What the topbar edits is MY VIEW: mine
  // alone, instant, and it never touches anyone else's map. Promoting my view
  // to the default is a separate, explicit act ("Make default").
  //
  // Before this split, every topbar click wrote workspace-wide immediately, so
  // flipping the lens mid-demo changed it permanently for everyone.
  //
  // Safe in a lazy initialiser because this component is `ssr: false` (see
  // OrgCanvasLoader) — reading storage during the first render can't cause a
  // hydration mismatch, and hydrating in an effect instead would flash the
  // workspace default before snapping to mine.
  const workspaceId = units[0]?.workspaceId ?? peopleRows[0]?.workspaceId ?? "";
  const opening = useMemo(
    () => resolveOpeningLens(workspaceId, initialLens),
    // Read once, on mount: this seeds state and must not re-run when the
    // workspace default changes underneath a view the user is already in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [lens, setLens] = useState<Lens>(opening.lens);
  /** The workspace default, which "Make default" advances. */
  const [defaultLens, setDefaultLens] = useState<Lens>(initialLens);
  const isMyView = !sameLens(lens, defaultLens);

  /** The colour-by list, with the "stream" row wearing this workspace's own
   *  word for the top rung rather than the shipped default. */
  const colorByOptions = useMemo(
    () =>
      COLOR_BY_OPTIONS.map((o) =>
        o.value === "stream"
          ? {
              ...o,
              label: vocabulary.stream.singular,
              hint: `Their home ${lower(vocabulary.stream.singular)}'s identity hue`,
            }
          : o,
      ),
    [vocabulary],
  );
  const [lensOpen, setLensOpen] = useState(false);
  const setLensField = useCallback(
    <K extends keyof Lens>(key: K, value: Lens[K]) => {
      setLens((prev) => {
        if (prev[key] === value) return prev;
        const next = { ...prev, [key]: value };
        // My view only. Nothing here reaches the server.
        writeMyView(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  /** Drop my override and fall back to what the workspace is set to. */
  const resetToDefault = useCallback(() => {
    clearMyView(workspaceId);
    setLens(defaultLens);
  }, [workspaceId, defaultLens]);

  /** Promote what I'm looking at to the workspace default — the one gesture
   *  here that changes what other people see, so it is never implicit. */
  const makeDefault = useCallback(() => {
    const next = lens;
    setDefaultLens(next);
    clearMyView(workspaceId); // my view and the default now agree
    void saveLens(next);
  }, [lens, workspaceId]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const pinch = useRef<{ dist: number; center: { x: number; y: number } } | null>(null);

  const lod = lodFor(scale);

  const teams = useMemo(() => nodes.filter((n): n is CanvasTeam => n.kind === "team"), [nodes]);
  const people = useMemo(() => nodes.filter((n): n is CanvasPerson => n.kind === "person"), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const realStreams = useMemo(() => streams.filter((t) => t.id !== CROSS_CUTTING_ID), [streams]);

  /** Where a new value stream hangs: beside the streams that already exist, so
   *  the top rung stays the top rung. Falls back to the root unit. */
  const streamParentId = useMemo(() => {
    const sibling = realStreams[0] ? units.find((u) => u.id === realStreams[0].id) : null;
    if (sibling) return sibling.parentId;
    return units.find((u) => !u.parentId)?.id ?? null;
  }, [realStreams, units]);

  /** Resolved colour per discipline — the row's own, else a ramp slot. */
  const disciplineColor = useMemo(() => disciplineColors(disciplines), [disciplines]);
  const disciplineName = useMemo(
    () => new Map(disciplines.map((d) => [d.id, d.name])),
    [disciplines],
  );

  /** Stable identity colour per value stream. */
  const hueOf = useMemo(() => {
    const m = new Map<string, string>();
    realStreams.forEach((t, i) => m.set(t.id, streamHue(i)));
    m.set(CROSS_CUTTING_ID, C.inkSoft);
    return m;
  }, [realStreams]);

  /** A person's home value stream — the team they sit in, not one they visit. */
  const homeStreamOf = useCallback(
    (p: CanvasPerson) => {
      const home = byId.get(p.homeId);
      return home && home.kind === "team" ? home : null;
    },
    [byId],
  );

  /** The one answer to "what colour is this seat?" — shared by real seats,
   *  ghost seats and the panel, so the lens can never disagree with itself. */
  const seatColor = useCallback(
    (p: CanvasPerson) =>
      personColor(p, {
        lens,
        utilisation: utilOf(p),
        utilColor,
        disciplineColor,
        streamHue: hueOf.get(homeStreamOf(p)?.streamId ?? "") ?? null,
      }),
    [lens, disciplineColor, hueOf, homeStreamOf],
  );

  /** Legend entries for the active lens, counted over the people on the map. */
  const legend = useMemo(
    () =>
      buildLegend(lens, people, {
        utilisationOf: utilOf,
        disciplineColor,
        disciplineName,
        streamHueOf: (p) => hueOf.get(homeStreamOf(p)?.streamId ?? "") ?? null,
        streamNameOf: (p) => homeStreamOf(p)?.streamName ?? null,
        employmentLabel: EMPLOYMENT_LABELS,
        utilColor,
      }),
    [lens, people, disciplineColor, disciplineName, hueOf, homeStreamOf],
  );

  // --- analytics overlays (V2.1 parity, ported from RadialOrg's getOverlayProps) ---
  const overAlloc = useMemo(() => overAllocatedPersonIds(effAssignments), [effAssignments]);
  const allocByPerson = useMemo(() => allocationByPerson(effAssignments), [effAssignments]);
  const gapsMap = useMemo(
    () => computeGaps({ units, people: peopleRows, assignments: effAssignments }),
    [units, peopleRows, effAssignments],
  );
  const rollupMap = useMemo(
    () => computeRollup({ units, people: peopleRows, assignments: effAssignments }),
    [units, peopleRows, effAssignments],
  );
  const maxUnitCost = useMemo(() => {
    let max = 0;
    for (const r of rollupMap.values()) if (r.totalCost > max) max = r.totalCost;
    return max;
  }, [rollupMap]);

  const teamOverlay = useCallback(
    (team: CanvasTeam): NodeOverlay => {
      if (overlayType === "none") return NO_OVERLAY;
      if (overlayType === "allocation") return { ...NO_OVERLAY, dimmed: true };
      if (overlayType === "gaps") {
        const gap = gapsMap.get(team.id);
        const hasGap = !!gap && gap.gap > 0;
        return { dimmed: !hasGap, badge: hasGap ? `${gap!.gap} open` : null, heatPct: 0 };
      }
      const cost = rollupMap.get(team.id)?.totalCost ?? 0;
      return {
        dimmed: false,
        badge: cost > 0 ? `${money(cost)}/mo` : null,
        heatPct: maxUnitCost > 0 ? cost / maxUnitCost : 0,
      };
    },
    [overlayType, gapsMap, rollupMap, maxUnitCost],
  );

  const personOverlay = useCallback(
    (person: CanvasPerson): NodeOverlay => {
      if (overlayType === "none") return NO_OVERLAY;
      if (overlayType === "allocation") {
        const isOver = overAlloc.has(person.id);
        const alloc = allocByPerson.get(person.id);
        return { dimmed: !isOver, badge: isOver && alloc ? `${alloc.teamCount} teams` : null, heatPct: 0 };
      }
      return { ...NO_OVERLAY, dimmed: true };
    },
    [overlayType, overAlloc, allocByPerson],
  );

  const streamOverlay = useCallback(
    (streamId: string, openRoles: number, cost: number): NodeOverlay => {
      if (overlayType === "none") return NO_OVERLAY;
      if (overlayType === "allocation") return { ...NO_OVERLAY, dimmed: true };
      if (overlayType === "gaps") {
        return { dimmed: openRoles === 0, badge: openRoles > 0 ? `${openRoles} open` : null, heatPct: 0 };
      }
      const roi = rollupMap.get(streamId)?.totalRoi ?? 0;
      return {
        dimmed: false,
        badge: roi > 0 ? `ROI ${money(roi)}` : null,
        heatPct: maxUnitCost > 0 ? cost / maxUnitCost : 0,
      };
    },
    [overlayType, rollupMap, maxUnitCost],
  );

  const teamStats = useMemo(() => {
    const m = new Map<string, TeamStats>();
    for (const s of teams) {
      m.set(s.id, { heads: 0, fte: 0, cost: 0, openRoles: s.openRoles, target: s.targetHeadcount, shared: 0 });
    }
    for (const p of people) {
      if (p.allocations.length === 0) {
        const st = m.get(p.homeId);
        if (st) {
          st.heads += 1;
          st.cost += p.costPerMonth;
        }
        continue;
      }
      for (const a of p.allocations) {
        const st = m.get(a.unitId);
        if (!st) continue;
        st.heads += 1;
        st.fte += a.pct / 100;
        st.cost += (p.costPerMonth * a.pct) / 100;
        if (p.homeId !== a.unitId) st.shared += 1;
      }
    }
    // Nothing ever allocates *to* the cross-cutting bucket (it's a display
    // home, not a real team) — aggregate it from its members directly.
    const cc = m.get(CROSS_CUTTING_ID);
    if (cc) {
      const members = people.filter((p) => p.homeId === CROSS_CUTTING_ID);
      cc.heads = members.length;
      cc.fte = members.reduce((s, p) => s + utilOf(p) / 100, 0);
      cc.cost = members.reduce((s, p) => s + p.costPerMonth, 0);
      cc.shared = members.length;
    }
    return m;
  }, [teams, people]);

  // Seats per team (home members + ghost seats). Drives the team circle size
  // and the member-ring radius, so a big team *looks* like a big team.
  const seatsByTeam = useMemo(() => {
    const m = new Map<string, number>();
    const bump = (id: string) => m.set(id, (m.get(id) ?? 0) + 1);
    for (const p of people) {
      if (p.crossCuttingTier !== null) {
        for (const a of p.allocations) bump(a.unitId);
      } else {
        bump(p.homeId);
      }
    }
    return m;
  }, [people]);

  const teamR = useCallback((id: string) => teamNodeRadius(seatsByTeam.get(id) ?? 0), [seatsByTeam]);

  // Ghost seat positions for every cross-cutting person with allocations —
  // cross-team and cross-stream alike. Placed into the *largest
  // angular gaps* of the team's real member ring, measured from live node
  // positions — so a ghost never lands on a member, and the layout survives
  // dragging members (or the team itself) around.
  const ghostSeats = useMemo(() => {
    const membersByTeam = new Map<string, CanvasPerson[]>();
    for (const p of people) {
      if (p.crossCuttingTier !== null || p.homeId === CROSS_CUTTING_ID) continue;
      if (!membersByTeam.has(p.homeId)) membersByTeam.set(p.homeId, []);
      membersByTeam.get(p.homeId)!.push(p);
    }
    const ghostsByTeam = new Map<string, Array<{ person: CanvasPerson; alloc: CanvasAllocation }>>();
    for (const p of people) {
      if (p.crossCuttingTier === null) continue;
      for (const a of p.allocations) {
        if (!ghostsByTeam.has(a.unitId)) ghostsByTeam.set(a.unitId, []);
        ghostsByTeam.get(a.unitId)!.push({ person: p, alloc: a });
      }
    }
    const result: Array<{ person: CanvasPerson; alloc: CanvasAllocation; gx: number; gy: number }> = [];
    for (const [teamId, ghosts] of ghostsByTeam) {
      const sq = byId.get(teamId);
      if (!sq || sq.kind !== "team" || (sq as CanvasTeam).isCrossCutting) continue;
      ghosts.sort((a, b) => a.person.name.localeCompare(b.person.name));

      const polar = (membersByTeam.get(teamId) ?? [])
        .map((m) => ({ a: Math.atan2(m.y - sq.y, m.x - sq.x), r: Math.hypot(m.x - sq.x, m.y - sq.y) }))
        .filter((q) => q.r > 1);
      const seats = seatsByTeam.get(teamId) ?? ghosts.length;
      const nominal = teamRingRadius(seats);
      const ringR = polar.length
        ? clamp(polar.reduce((s, q) => s + q.r, 0) / polar.length, teamNodeRadius(seats) + 40, 360)
        : nominal;

      const slots: number[] = [];
      if (polar.length === 0) {
        for (let i = 0; i < ghosts.length; i++) slots.push((2 * Math.PI * i) / ghosts.length - Math.PI / 2);
      } else {
        const occupied = polar.map((q) => q.a);
        for (let g = 0; g < ghosts.length; g++) {
          const all = [...occupied, ...slots].sort((a, b) => a - b);
          let bestMid = -Math.PI / 2;
          let bestGap = -1;
          for (let i = 0; i < all.length; i++) {
            const a0 = all[i];
            const a1 = i === all.length - 1 ? all[0] + 2 * Math.PI : all[i + 1];
            if (a1 - a0 > bestGap) {
              bestGap = a1 - a0;
              bestMid = a0 + (a1 - a0) / 2;
            }
          }
          slots.push(bestMid);
        }
      }

      ghosts.forEach(({ person, alloc }, i) => {
        result.push({
          person,
          alloc,
          gx: sq.x + Math.cos(slots[i]) * ringR,
          gy: sq.y + Math.sin(slots[i]) * ringR,
        });
      });
    }
    return result;
  }, [people, byId, seatsByTeam]);

  const streamAgg = useMemo(() => {
    // An empty stream has no contents to derive a box from, so it gets a
    // placeholder parked to the right of everything else. As soon as it holds
    // a team the box derives from its contents like every other stream.
    const empties: string[] = [];
    let farRight = 0;
    for (const s of teams) farRight = Math.max(farRight, s.x + 700);

    return streams
      .map((t) => {
        const own = teams.filter((s) => s.streamId === t.id);
        if (own.length === 0) {
          if (t.id === CROSS_CUTTING_ID) return null;
          const slot = empties.length;
          empties.push(t.id);
          return {
            ...t,
            x: farRight + 380,
            y: slot * 420,
            hw: 320,
            hh: 150,
            heads: 0,
            cost: 0,
            openRoles: 0,
            teams: 0,
          };
        }
        // A stream is drawn as a rounded rectangle sized to contain its teams
        // *and* their member rings — so more teams reads as a bigger block.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of own) {
          const rr = teamRingRadius(seatsByTeam.get(n.id) ?? 0) + 52; // + label headroom
          minX = Math.min(minX, n.x - rr);
          maxX = Math.max(maxX, n.x + rr);
          minY = Math.min(minY, n.y - rr);
          maxY = Math.max(maxY, n.y + rr);
        }
        const PAD_X = 70, PAD_TOP = 150, PAD_BOTTOM = 60; // PAD_TOP clears the stream header block
        minX -= PAD_X; maxX += PAD_X; minY -= PAD_TOP; maxY += PAD_BOTTOM;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const hw = (maxX - minX) / 2;
        const hh = (maxY - minY) / 2;
        let heads = 0;
        let cost = 0;
        let openRoles = 0;
        for (const s of own) {
          const st = teamStats.get(s.id);
          if (!st) continue;
          heads += st.heads;
          cost += st.cost;
          openRoles += st.openRoles;
        }
        return { ...t, x: cx, y: cy, hw, hh, heads, cost, openRoles, teams: own.length };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }, [streams, teams, teamStats, seatsByTeam]);

  // --- money flow — the company container + external entities ---------------
  // Pure geometry lives in lib/canvas/moneyFlow.ts; this just derives the
  // stream bounding box and the org's real total monthly cost to feed it.
  const moneyFlowLayout = useMemo(() => {
    if (streamAgg.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let totalMonthlyCost = 0;
    for (const t of streamAgg) {
      minX = Math.min(minX, t.x - t.hw);
      maxX = Math.max(maxX, t.x + t.hw);
      minY = Math.min(minY, t.y - t.hh);
      maxY = Math.max(maxY, t.y + t.hh);
      totalMonthlyCost += t.cost;
    }
    return computeMoneyFlowLayout({ minX, maxX, minY, maxY }, totalMonthlyCost);
  }, [streamAgg]);

  // --- allocation spokes — how each parent's budget splits across its
  // children. One "company" hub over the streams, and (once teams are
  // visible) one hub per stream over its own teams. Recursive by
  // construction: computeAllocationSpokes doesn't know which level it's at.
  //
  // Card placement (Greg, 2026-09-07): every hull's card is locked to its
  // own top-right corner and always rendered — the SAME card at every zoom
  // level, so "collapsing" as you zoom out is just the hull's background
  // fading away around a card that was there all along, not a swap between
  // two different elements. Once a hull's children are visible, a small
  // circle appears just below its card and becomes the real spoke endpoint
  // on both sides (the line arriving from its own parent, and the lines
  // fanning out to its children) — while collapsed, the card itself is the
  // endpoint. The company's children (the streams) are always present in
  // some form, so the company hub is always "expanded."
  const allocationHubs = useMemo((): AllocHub[] => {
    if (!moneyFlowLayout || streamAgg.length === 0) return [];
    const hubs: AllocHub[] = [];

    const totalHeads = streamAgg.reduce((s, t) => s + t.heads, 0);
    const totalCost = streamAgg.reduce((s, t) => s + t.cost, 0);
    const companyHull = {
      x: moneyFlowLayout.company.x,
      y: moneyFlowLayout.company.y,
      hw: moneyFlowLayout.company.hw,
      hh: moneyFlowLayout.company.hh,
    };
    const companyGeo = computeHubGeometry(companyHull, false, true);

    // Every stream's own geometry, computed once and reused both as the
    // target of the company's outgoing spoke and as the hub for the
    // stream's own outgoing spokes to its teams — so there's exactly one
    // place each stream "receives" a line, whichever level is asking.
    const streamGeo = new Map<string, ReturnType<typeof computeHubGeometry>>();
    for (const t of streamAgg) {
      const hull = { x: t.x, y: t.y, hw: t.hw, hh: t.hh };
      streamGeo.set(t.id, computeHubGeometry(hull, t.id !== CROSS_CUTTING_ID, lod !== "streams"));
    }

    hubs.push({
      id: "company",
      card: companyGeo.card,
      title: DEFAULT_COMPANY_NAME.toUpperCase(),
      ownerLine: null,
      statsLine: `${plural(totalHeads, "person").replace("persons", "people")} · ${money(totalCost)}/mo`,
      hue: C.ink,
      circle: companyGeo.circle,
      lines: computeAllocationSpokes(
        hubRecipient(companyGeo),
        streamAgg.map((t) => {
          const r = hubRecipient(streamGeo.get(t.id)!);
          return { id: t.id, ...r, cost: t.cost };
        }),
      ),
    });

    if (lod !== "streams") {
      for (const t of streamAgg) {
        const own = teams.filter((team) => team.streamId === t.id);
        if (own.length === 0) continue;
        const hue = hueOf.get(t.id) ?? C.inkSoft;
        const geo = streamGeo.get(t.id)!;
        const isBucket = t.id === CROSS_CUTTING_ID;
        hubs.push({
          id: `stream-${t.id}`,
          card: geo.card,
          title: t.name.toUpperCase(),
          ownerLine: isBucket ? null : { text: t.leadName ? `Led by ${t.leadName}` : "No owner", warn: !t.leadName },
          statsLine:
            t.teams === 0
              ? `Empty — add a ${lower(vocabulary.team.singular)} to fill it`
              : `${plural(t.teams, lower(vocabulary.team.singular))} · ${plural(t.heads, "person").replace("persons", "people")} · ${money(t.cost)}/mo`,
          hue,
          circle: geo.circle,
          lines: computeAllocationSpokes(
            hubRecipient(geo),
            own.map((team) => {
              const r = teamR(team.id);
              return { id: team.id, x: team.x, y: team.y, hw: r, hh: r, cost: teamStats.get(team.id)?.cost ?? 0 };
            }),
          ),
        });
      }
    }

    return hubs;
  }, [moneyFlowLayout, streamAgg, lod, teams, hueOf, teamStats, teamR, vocabulary]);

  // --- sizing ----------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || size.w === 0 || nodes.length === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 260;
    const s = clamp(
      Math.min(size.w / (maxX - minX + pad * 2), size.h / (maxY - minY + pad * 2)),
      MIN_SCALE,
      MAX_SCALE,
    );
    stage.scale({ x: s, y: s });
    stage.position({ x: size.w / 2 - ((minX + maxX) / 2) * s, y: size.h / 2 - ((minY + maxY) / 2) * s });
    stage.batchDraw();
    setScale(s);
  }, [nodes, size]);

  /** Frame one box (a value stream rectangle) rather than the whole world. */
  const frameBox = useCallback(
    (box: { x: number; y: number; hw: number; hh: number }) => {
      const stage = stageRef.current;
      if (!stage || size.w === 0) return;
      const s = clamp(
        Math.min(size.w / (box.hw * 2 * 1.04), size.h / (box.hh * 2 * 1.04)),
        MIN_SCALE,
        MAX_SCALE,
      );
      stage.scale({ x: s, y: s });
      stage.position({ x: size.w / 2 - box.x * s, y: size.h / 2 - box.y * s });
      stage.batchDraw();
      setScale(s);
    },
    [size],
  );

  // Open on a *view*, not on "fit everything": land on the value stream with the
  // most open roles (tie-break on headcount) — the one worth looking at.
  const didFit = useRef(false);
  useEffect(() => {
    if (!openTaskPersonId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTaskPersonId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTaskPersonId]);

  useEffect(() => {
    if (didFit.current || size.w === 0) return;
    didFit.current = true;
    const opening = streamAgg
      .filter((t) => t.id !== CROSS_CUTTING_ID)
      .sort((a, b) => b.openRoles - a.openRoles || b.heads - a.heads)[0];
    if (opening) frameBox(opening);
    else fit();
  }, [fit, frameBox, streamAgg, size]);

  // The intro clock is its own mount-only effect. It must NOT share the
  // once-guarded effect above: any dep change (or React's dev double-invoke)
  // runs that cleanup, cancels the frame, and the re-run returns early on the
  // guard — leaving introT pinned at 0, which renders the whole map invisible.
  // The timeout is a hard backstop: whatever happens to rAF, the map appears.
  useEffect(() => {
    // Reduced motion: same code path, zero-length clock — the first frame lands on 1.
    const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dur = reduced ? 1 : INTRO_MS;
    const started = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = clamp((now - started) / dur, 0, 1);
      setIntroT(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const backstop = setTimeout(() => setIntroT(1), INTRO_MS + 500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(backstop);
    };
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const old = stage.scaleX();
      const next = clamp(old * factor, MIN_SCALE, MAX_SCALE);
      const c = { x: size.w / 2, y: size.h / 2 };
      const world = { x: (c.x - stage.x()) / old, y: (c.y - stage.y()) / old };
      stage.scale({ x: next, y: next });
      stage.position({ x: c.x - world.x * next, y: c.y - world.y * next });
      stage.batchDraw();
      setScale(next);
    },
    [size],
  );

  const onWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const old = stage.scaleX();
    const dir = e.evt.deltaY > 0 ? 1 / 1.08 : 1.08;
    const next = clamp(old * dir, MIN_SCALE, MAX_SCALE);
    const world = { x: (pointer.x - stage.x()) / old, y: (pointer.y - stage.y()) / old };
    stage.scale({ x: next, y: next });
    stage.position({ x: pointer.x - world.x * next, y: pointer.y - world.y * next });
    stage.batchDraw();
    setScale(next);
  }, []);

  const onTouchMove = useCallback((e: KonvaEventObject<TouchEvent>) => {
    const t = e.evt.touches;
    if (t.length !== 2) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const p1 = { x: t[0].clientX, y: t[0].clientY };
    const p2 = { x: t[1].clientX, y: t[1].clientY };
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (!pinch.current) {
      pinch.current = { dist, center };
      return;
    }
    const box = stage.container().getBoundingClientRect();
    const local = { x: center.x - box.left, y: center.y - box.top };
    const old = stage.scaleX();
    const next = clamp(old * (dist / pinch.current.dist), MIN_SCALE, MAX_SCALE);
    const world = { x: (local.x - stage.x()) / old, y: (local.y - stage.y()) / old };
    stage.scale({ x: next, y: next });
    stage.position({ x: local.x - world.x * next, y: local.y - world.y * next });
    stage.batchDraw();
    setScale(next);
    pinch.current = { dist, center };
  }, []);

  const onTouchEnd = useCallback(() => {
    pinch.current = null;
  }, []);

  // --- drag: reposition + persist, plus drop-on-team reassignment -----------
  const nearestTeam = useCallback(
    (x: number, y: number): CanvasTeam | null => {
      let nearest: CanvasTeam | null = null;
      let best = Infinity;
      for (const s of teams) {
        if (s.isCrossCutting) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < teamNodeRadius(seatsByTeam.get(s.id) ?? 0) + TEAM_DROP_PAD && d < best) {
          best = d;
          nearest = s;
        }
      }
      return nearest;
    },
    [teams, seatsByTeam],
  );

  // Nearest stream whose hull actually contains (x, y) — used to reparent a
  // dragged team onto a different stream. Excludes the synthetic
  // cross-cutting bucket, which isn't a real org unit.
  const nearestStream = useCallback(
    (x: number, y: number) => {
      let nearest: (typeof streamAgg)[number] | null = null;
      let best = Infinity;
      for (const t of streamAgg) {
        if (t.id === CROSS_CUTTING_ID) continue;
        if (Math.abs(x - t.x) > t.hw || Math.abs(y - t.y) > t.hh) continue;
        const area = t.hw * t.hh; // nested boxes: the tightest one wins
        if (area < best) {
          best = area;
          nearest = t;
        }
      }
      return nearest;
    },
    [streamAgg],
  );

  // --- drag a whole value stream -------------------------------------------
  // The hull is *derived* from its contents, so it has no position to drag.
  // Dragging it therefore translates every team in the stream and every seat
  // in those teams, and the box follows because it is recomputed from them.
  //
  // Konva's own `draggable` can't drive this (the node's position is a
  // computed prop, so the drag and the re-render fight each other), so the
  // gesture is tracked from raw pointer deltas in world space instead.
  const streamDrag = useRef<{ id: string; last: Position; moved: boolean } | null>(null);
  const [draggingStreamId, setDraggingStreamId] = useState<string | null>(null);
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  /** Pointer position in world (pre-transform) coordinates. */
  const pointerWorld = useCallback((): Position | null => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!stage || !p) return null;
    const k = stage.scaleX();
    return { x: (p.x - stage.x()) / k, y: (p.y - stage.y()) / k };
  }, []);

  const moveStreamBy = useCallback((streamId: string, dx: number, dy: number) => {
    setNodes((prev) => {
      const teamIds = new Set(
        prev.filter((n): n is CanvasTeam => n.kind === "team" && n.streamId === streamId).map((n) => n.id),
      );
      if (teamIds.size === 0) return prev;
      return prev.map((n) =>
        (n.kind === "team" ? teamIds.has(n.id) : teamIds.has(n.homeId))
          ? { ...n, x: n.x + dx, y: n.y + dy }
          : n,
      );
    });
  }, []);

  const startStreamDrag = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>, streamId: string) => {
      const w = pointerWorld();
      if (!w) return;
      e.cancelBubble = true; // don't also pan the stage
      stageRef.current?.draggable(false);
      streamDrag.current = { id: streamId, last: w, moved: false };
      setDraggingStreamId(streamId);
    },
    [pointerWorld],
  );

  const dragStream = useCallback(() => {
    const d = streamDrag.current;
    if (!d) return false;
    const w = pointerWorld();
    if (!w) return true;
    const dx = w.x - d.last.x;
    const dy = w.y - d.last.y;
    if (dx || dy) {
      d.last = w;
      d.moved = true;
      moveStreamBy(d.id, dx, dy);
    }
    return true;
  }, [pointerWorld, moveStreamBy]);

  const endStreamDrag = useCallback(() => {
    const d = streamDrag.current;
    if (!d) return;
    streamDrag.current = null;
    setDraggingStreamId(null);
    stageRef.current?.draggable(true);
    if (!d.moved) return;
    const ns = nodesRef.current;
    const teamIds = new Set(
      ns.filter((n): n is CanvasTeam => n.kind === "team" && n.streamId === d.id).map((n) => n.id),
    );
    const rows = ns
      .filter((n) => (n.kind === "team" ? teamIds.has(n.id) : teamIds.has(n.homeId)))
      .map((n) => ({
        nodeType: (n.kind === "team" ? "unit" : "person") as "unit" | "person",
        nodeId: n.id,
        x: n.x,
        y: n.y,
      }));
    void saveMapNodePositions(rows);
  }, []);

  const onPersonDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (lod === "streams") {
        setDropTargetId(null);
        return;
      }
      setAddMode(!!e.evt.altKey);
      const target = nearestTeam(e.target.x(), e.target.y());
      setDropTargetId(target?.id ?? null);
    },
    [lod, nearestTeam],
  );

  const onTeamDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>, team: CanvasTeam) => {
      if (team.isCrossCutting) return;
      const target = nearestStream(e.target.x(), e.target.y());
      setDropStreamId(target && target.id !== team.streamId ? target.id : null);
    },
    [nearestStream],
  );

  const onNodeDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>, node: CanvasNode) => {
      const x = snapToGrid(e.target.x());
      const y = snapToGrid(e.target.y());
      e.target.position({ x, y }); // snap the shape itself, not just the stored state
      setDropTargetId(null);
      setDropStreamId(null);
      setAddMode(false);
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, x, y } : n)));
      const nodeType = node.kind === "team" ? "unit" : "person";
      startTransition(async () => {
        const result = await saveMapNodePosition(nodeType, node.id, x, y);
        if (!result.ok) console.error("Failed to save node position:", result.error);
      });

      if (node.kind === "team") {
        if (node.isCrossCutting) return;
        const target = nearestStream(x, y);
        if (!target || target.id === node.streamId) return;
        const targetStreamId = target.id;
        startTransition(async () => {
          const result = await moveOrgUnit(node.id, targetStreamId);
          if (!result.ok) console.error("Failed to move team to stream:", result.error);
          else router.refresh();
        });
        return;
      }

      if (node.kind !== "person" || lod === "streams" || node.allocations.length === 0) return;
      const target = nearestTeam(x, y);
      if (!target) return;
      const targetTeamId = target.id;
      const home = [...node.allocations].sort((a, b) => b.pct - a.pct)[0];
      if (node.allocations.some((a) => a.unitId === targetTeamId)) return;

      // Option/Alt-drag *adds* a team instead of moving them to it — the gesture
      // for "they now support this team too". Not stageable in scenario mode,
      // which stages moves (a swapped assignmentId), not new rows.
      if (e.evt.altKey) {
        startTransition(async () => {
          const result = await createAssignment({
            orgUnitId: targetTeamId,
            personId: node.id,
            roleOnTeam: node.title ?? "",
            allocationPct: 20,
            isOpenRole: false,
          });
          if (!result.ok) console.error("Failed to add to team:", result.error);
          else router.refresh();
        });
        return;
      }

      if (home.unitId === targetTeamId) return;
      if (scenario) {
        setMoves((prev) => {
          const next = new Map(prev);
          next.set(home.assignmentId, targetTeamId);
          return next;
        });
        return;
      }
      startTransition(async () => {
        const result = await moveAssignment(home.assignmentId, targetTeamId);
        if (!result.ok) console.error("Failed to reassign:", result.error);
        else router.refresh();
      });
    },
    [startTransition, lod, nearestTeam, nearestStream, scenario, router],
  );

  function toggleScenario() {
    if (scenario) {
      setMoves(new Map());
      setScenario(false);
    } else {
      setScenario(true);
    }
  }

  function applyScenario() {
    const entries = [...moves.entries()];
    startTransition(async () => {
      for (const [id, target] of entries) await moveAssignment(id, target);
      setMoves(new Map());
      setScenario(false);
      router.refresh();
    });
  }

  function discardScenario() {
    setMoves(new Map());
  }

  function tidyUp() {
    startTransition(async () => {
      await tidyUpCanvasLayout();
      router.refresh();
    });
  }

  // --- panel: select / edit / create -----------------------------------------
  function selectNode(id: string) {
    setSelectedId(id);
    setEditing(false);
    setCreating(null);
  }

  function closePanel() {
    setSelectedId(null);
    setEditing(false);
    setCreating(null);
  }

  function startCreate(kind: "person" | "team" | "stream") {
    setSelectedId(null);
    setEditing(false);
    setCreating(kind);
  }

  const showHover = useCallback((id: string) => {
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return;
    setHover({ id, x: p.x, y: p.y });
  }, []);

  const selected = selectedId ? byId.get(selectedId) : null;
  const hovered = hover ? byId.get(hover.id) : null;
  const panelOpen = !!selected || !!creating;

  const openTaskPerson = openTaskPersonId ? byId.get(openTaskPersonId) : null;
  const openTaskPersonTeams = useMemo(() => {
    if (!openTaskPerson || openTaskPerson.kind !== "person") return [];
    return openTaskPerson.allocations
      .map((a) => byId.get(a.unitId)?.name)
      .filter((n): n is string => !!n);
  }, [openTaskPerson, byId]);

  const showTeams = lod !== "streams";
  const showPeople = lod === "people" || lod === "roles";

  return (
    <VocabularyProvider vocabulary={vocabulary}>
    <div style={S.root}>
      {/* A toolbar, not a header — the app shell in app/(app)/layout.tsx already
          owns the brand and the nav, so repeating them here read as two headers
          stacked. The radial view is still reachable at /org?view=radial; the
          link is gone until it earns a place back (see ROADMAP: retire the
          radial once FindingsRail and the formal layer port). */}
      <header style={S.topbar}>
        <div style={S.overlayGroupFirst}>
          {OVERLAY_OPTIONS.map((o) => (
            <button
              key={o.type}
              style={S.overlayBtn(overlayType === o.type)}
              onClick={() => setOverlayType(o.type)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div style={S.overlayGroup}>
          {scenario && activeMoveCount > 0 && (
            <>
              <span style={S.pendingPill}>
                {activeMoveCount} pending move{activeMoveCount === 1 ? "" : "s"}
              </span>
              <button style={S.applyBtn} onClick={applyScenario} disabled={isPending}>
                {isPending ? "Applying…" : "Apply"}
              </button>
              <button style={S.discardBtn} onClick={discardScenario}>
                Discard
              </button>
            </>
          )}
          <button style={S.scenarioBtn(scenario)} onClick={toggleScenario}>
            {scenario ? "Scenario: on" : "Scenario mode"}
          </button>
        </div>
        <div style={S.overlayGroup}>
          <button style={S.btn} onClick={() => startCreate("person")}>
            + Person
          </button>
          <button style={S.btn} onClick={() => startCreate("team")}>
            + {vocabulary.team.singular}
          </button>
          <button style={S.btn} onClick={() => startCreate("stream")}>
            + {vocabulary.stream.singular}
          </button>
        </div>
        <div style={S.overlayGroup}>
          <button style={S.btn} onClick={tidyUp} disabled={isPending}>
            {isPending ? "Tidying…" : "Tidy up"}
          </button>
        </div>
        {/* The lens hides behind one button rather than adding a sixth row of
            pills — the topbar is already at its width budget. */}
        <div style={{ ...S.overlayGroup, position: "relative" }}>
          <button style={S.lensBtn(lensOpen || !isDefaultLens(lens))} onClick={() => setLensOpen((v) => !v)}>
            ◎ Lens
            {/* Amber dot = "you are in a mode", the same grammar the scenario
                chip uses. Grey = merely a non-default lens the whole workspace
                shares, which is nobody's business to reset. */}
            {isMyView ? <span style={S.myViewDot} /> : !isDefaultLens(lens) && <span style={S.lensDot} />}
          </button>
          {lensOpen && (
            <>
              <div style={S.scrim} onClick={() => setLensOpen(false)} />
              <div style={S.lensPanel}>
                <LensChoice
                  title="Colour by"
                  options={colorByOptions}
                  value={lens.colorBy}
                  onPick={(v) => setLensField("colorBy", v)}
                />
                <div style={S.lensDivider} />
                <LensChoice
                  title="Label by"
                  options={LABEL_BY_OPTIONS}
                  value={lens.labelBy}
                  onPick={(v) => setLensField("labelBy", v)}
                />
                {isMyView ? (
                  <div style={S.lensFootRow}>
                    <span style={S.myViewTag}>
                      <span style={S.myViewDot} />
                      Just for me
                    </span>
                    <button style={S.lensLink} onClick={resetToDefault}>
                      Reset
                    </button>
                    <button style={S.lensLink} onClick={makeDefault}>
                      Make default
                    </button>
                  </div>
                ) : (
                  <p style={S.lensFoot}>This workspace&apos;s default view.</p>
                )}
              </div>
            </>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={S.btn} onClick={() => zoomBy(1.45)} aria-label="Zoom in">
            +
          </button>
          <button style={S.btn} onClick={() => zoomBy(1 / 1.45)} aria-label="Zoom out">
            −
          </button>
          <button style={S.btn} onClick={fit}>
            Fit
          </button>
        </div>
      </header>

      <div ref={wrapRef} style={S.canvasWrap}>
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          draggable
          onWheel={onWheel}
          onMouseMove={dragStream}
          onMouseUp={endStreamDrag}
          onMouseLeave={endStreamDrag}
          onTouchMove={(e) => {
            // A stream drag in progress owns the gesture; pinch-zoom otherwise.
            if (dragStream()) {
              e.evt.preventDefault();
              return;
            }
            onTouchMove(e);
          }}
          onTouchEnd={() => {
            endStreamDrag();
            onTouchEnd();
          }}
          style={{ cursor: "grab" }}
          onClick={(e) => {
            if (e.target === e.target.getStage()) closePanel();
          }}
        >
          <Layer listening={false}>
            {moneyFlowLayout && (
              <>
                <GridBackdrop bounds={moneyFlowLayout.grid} />
                <MoneyFlowScene layout={moneyFlowLayout} />
              </>
            )}
            {streamAgg.map((t) => {
              const hue = hueOf.get(t.id) ?? C.inkSoft;
              const inP = phase(introT, 0, 0.45);
              // The analytics overlay (Allocation/Gaps/Cost-ROI) used to only
              // paint the collapsed streams-LOD card. Now that the card is
              // always on screen, dim/heat/badge apply directly to the hull
              // itself instead, so the overlay keeps working at every zoom.
              const ov = streamOverlay(t.id, t.openRoles, t.cost);
              return (
              <Group key={`hull-${t.id}`} x={t.x} y={t.y} opacity={(ov.dimmed ? 0.3 : 1) * inP}>
                {dropStreamId === t.id && (
                  <Rect
                    x={-t.hw - 16}
                    y={-t.hh - 16}
                    width={t.hw * 2 + 32}
                    height={t.hh * 2 + 32}
                    cornerRadius={52}
                    fill="#34d399"
                    opacity={0.14}
                  />
                )}
                <Rect
                  x={-t.hw}
                  y={-t.hh}
                  width={t.hw * 2}
                  height={t.hh * 2}
                  cornerRadius={40}
                  fill={C.white}
                  opacity={showTeams ? 0.72 : 0}
                  stroke={dropStreamId === t.id ? "#34d399" : C.line}
                  strokeWidth={dropStreamId === t.id ? 4 / scale : 2 / scale}
                  perfectDrawEnabled={false}
                />
                {showTeams && (
                  <Rect
                    x={-t.hw}
                    y={-t.hh}
                    width={t.hw * 2}
                    height={t.hh * 2}
                    cornerRadius={40}
                    fill={hue}
                    opacity={0.05}
                    perfectDrawEnabled={false}
                  />
                )}
                {ov.heatPct > 0 && (
                  <Rect
                    x={-t.hw}
                    y={-t.hh}
                    width={t.hw * 2}
                    height={t.hh * 2}
                    cornerRadius={40}
                    fill={C.heat}
                    opacity={ov.heatPct * 0.45}
                    listening={false}
                  />
                )}
                {/* A standing fact (open roles) stacks above an overlay-driven
                    badge, both floating just above the card — same two-line
                    stack the collapsed card used to show. */}
                {t.openRoles > 0 && (
                  <Text
                    text={`${t.openRoles} open`}
                    x={t.hw - CARD_W - CARD_PAD - 4}
                    y={-t.hh + CARD_PAD - (ov.badge ? 36 : 18)}
                    width={CARD_W}
                    align="right"
                    fontSize={13}
                    fontStyle="bold"
                    fontFamily={FONT}
                    fill={C.utilOver}
                    listening={false}
                  />
                )}
                {ov.badge && (
                  <Text
                    text={ov.badge}
                    x={t.hw - CARD_W - CARD_PAD - 4}
                    y={-t.hh + CARD_PAD - 18}
                    width={CARD_W}
                    align="right"
                    fontSize={13}
                    fontStyle="bold"
                    fontFamily={FONT}
                    fill={C.heat}
                    listening={false}
                  />
                )}
              </Group>
              );
            })}
          </Layer>

          <Layer>
            {/* Drag handles — the card strip grabs, not the whole box: the
                hull covers most of the viewport, and swallowing drags there
                would cost you pan-anywhere, which is the more common gesture.
                Now that the card is always on screen (it no longer only
                appears once teams are visible), the grip follows it and
                works at every zoom level too. */}
            {streamAgg.map((t) => {
              // No handle on the cross-cutting bucket (not a real unit) or on
              // an empty stream (nothing to move — its box is a placeholder).
              if (t.id === CROSS_CUTTING_ID || t.teams === 0) return null;
              const grabbing = draggingStreamId === t.id;
              const cardH =
                CARD_PAD * 2 + CARD_TITLE_LINE_H + CARD_LINE_H /* owner line */ + CARD_LINE_H;
              return (
                <Rect
                  key={`grip-${t.id}`}
                  x={t.x + t.hw - CARD_PAD - CARD_W}
                  y={t.y - t.hh + CARD_PAD}
                  width={CARD_W}
                  height={cardH}
                  cornerRadius={12}
                  fill={hueOf.get(t.id) ?? C.inkSoft}
                  opacity={grabbing ? 0.14 : 0}
                  onMouseEnter={() => {
                    const c = stageRef.current?.container();
                    if (c) c.style.cursor = "move";
                  }}
                  onMouseLeave={() => {
                    const c = stageRef.current?.container();
                    if (c) c.style.cursor = "grab";
                  }}
                  onMouseDown={(e) => startStreamDrag(e, t.id)}
                  onTouchStart={(e) => startStreamDrag(e, t.id)}
                />
              );
            })}
            <AllocationScene hubs={allocationHubs} />

            {showTeams &&
              teams.map((s, si) => {
                const st = teamStats.get(s.id);
                // Structural colour: a team wears its value stream's identity.
                // External vendor teams keep violet — "who employs them" outranks
                // "which stream they serve" for reading the map.
                const accent = s.isCrossCutting
                  ? C.cross
                  : s.isExternal
                    ? C.external
                    : (hueOf.get(s.streamId) ?? C.team);
                const inP = phase(introT, 0.12 + si * 0.04, 0.34);
                const gap = st && st.target != null ? st.target - Math.round(st.fte) : 0;
                const ov = teamOverlay(s);
                const r = teamR(s.id);
                const tw = r * 1.72; // keeps the widest line inside the circle, not just inside the bounding box
                const nameSize = clamp(Math.round(r * 0.215), 15, 24);
                const subSize = clamp(Math.round(r * 0.165), 12, 18);
                // Lay the label block out as one stack and centre it, so a name
                // that needs two lines pushes the stats down instead of sitting
                // on top of them.
                const perLine = Math.max(6, Math.floor(tw / (nameSize * 0.52)));
                const nameLines = clamp(Math.ceil(s.name.length / perLine), 1, 2);
                const nameH = nameLines * nameSize * 1.18;
                const lineH = subSize * 1.35;
                const rows = (st ? 1 : 0) + (gap > 0 ? 1 : 0) + (ov.badge ? 1 : 0);
                const yName = -(nameH + rows * lineH) / 2;
                const yStat = yName + nameH;
                const yGap = yStat + (st ? lineH : 0);
                const yBadge = yGap + (gap > 0 ? lineH : 0);
                return (
                  <Group
                    key={s.id}
                    x={s.x}
                    y={s.y}
                    opacity={(ov.dimmed ? 0.3 : 1) * inP}
                    scaleX={0.62 + 0.38 * inP}
                    scaleY={0.62 + 0.38 * inP}
                    draggable
                    onDragMove={(e) => onTeamDragMove(e, s)}
                    onDragEnd={(e) => onNodeDragEnd(e, s)}
                    onMouseEnter={() => showHover(s.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => selectNode(s.id)}
                    onTap={() => selectNode(s.id)}
                  >
                    {dropTargetId === s.id && (
                      <Circle radius={r + 14} fill={addMode ? C.cross : "#34d399"} opacity={0.2} listening={false} />
                    )}
                    <Circle
                      radius={r}
                      fill={C.white}
                      stroke={
                        dropTargetId === s.id ? (addMode ? C.cross : "#34d399") : selectedId === s.id ? C.ink : accent
                      }
                      strokeWidth={dropTargetId === s.id ? 5 : selectedId === s.id ? 6 : 4}
                      shadowColor={C.ink}
                      shadowBlur={22}
                      shadowOpacity={0.08}
                      shadowOffsetY={4}
                      perfectDrawEnabled={false}
                    />
                    {ov.heatPct > 0 && <Circle radius={r} fill={C.heat} opacity={ov.heatPct * 0.45} listening={false} />}
                    <Text text={s.name} x={-tw / 2} y={yName} width={tw} align="center" fontSize={nameSize} lineHeight={1.18} fontStyle="bold" fontFamily={FONT} fill={C.ink} listening={false} />
                    <Text
                      text={st ? `${st.heads} · ${st.fte.toFixed(1)} FTE` : ""}
                      x={-tw / 2}
                      y={yStat}
                      width={tw}
                      align="center"
                      fontSize={subSize}
                      fontFamily={FONT}
                      fill={C.inkSoft}
                      listening={false}
                    />
                    {gap > 0 && (
                      <Text text={`${gap} short`} x={-tw / 2} y={yGap} width={tw} align="center" fontSize={subSize} fontStyle="bold" fontFamily={FONT} fill={C.utilOver} listening={false} />
                    )}
                    {ov.badge && (
                      <Text
                        text={ov.badge}
                        x={-tw / 2}
                        y={yBadge}
                        width={tw}
                        align="center"
                        fontSize={subSize - 0.5}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={C.heat}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

            {/* Ghost seats — a borrowed seat for someone whose home is elsewhere.
                Dashed + smaller than a real seat; the wedge is this team's
                share of them. Amber = shared inside this stream; indigo + an
                outer halo = shared across streams (they hold seats in another
                stream too). Person-level state (over-allocation, utilisation
                colour) lives on the person's panel, not on a borrowed seat. */}
            {showPeople && ghostSeats.map(({ person: p, alloc: a, gx, gy }, gi) => {
              const ov = personOverlay(p);
              const sel = selectedId === p.id;
              const spansStreams = p.crossCuttingTier === "stream";
              // Under the default (utilisation) lens a ghost seat keeps its
              // cross-cutting accent — amber for cross-team, indigo for
              // cross-stream. Under any other lens the seat answers the
              // question the lens is asking, and "shared" is carried by the
              // dash, the smaller radius and the halo instead of by hue.
              const tierAccent = spansStreams ? C.crossStream : C.cross;
              const accent = lens.colorBy === "utilisation" ? tierAccent : seatColor(p);
              const gLabel = personLabel(p, lens, { short: true });
              const gInitials = lens.labelBy === "initials";
              // Settle outward from the team they orbit, so the ring is seen forming.
              const home = byId.get(a.unitId);
              const inP = phase(introT, 0.34 + gi * 0.012, 0.34);
              const ix = home ? home.x + (gx - home.x) * inP : gx;
              const iy = home ? home.y + (gy - home.y) * inP : gy;
              return (
                <Group
                  key={`ghost-${p.id}-${a.unitId}`}
                  x={ix}
                  y={iy}
                  opacity={(ov.dimmed ? 0.28 : 1) * inP}
                  onClick={() => selectNode(p.id)}
                  onTap={() => selectNode(p.id)}
                  onDblClick={() => setOpenTaskPersonId(p.id)}
                  onDblTap={() => setOpenTaskPersonId(p.id)}
                  onMouseEnter={() => showHover(p.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  {spansStreams && (
                    <Circle radius={GHOST_R + 5.5} stroke={tierAccent} strokeWidth={1.25} opacity={0.5} listening={false} />
                  )}
                  <Circle radius={GHOST_R} fill={C.white} />
                  <Arc
                    innerRadius={0}
                    outerRadius={GHOST_R - 2.5}
                    angle={(360 * clamp(a.pct, 0, 100)) / 100}
                    rotation={-90}
                    fill={accent}
                    opacity={0.18}
                    listening={false}
                  />
                  <Circle radius={GHOST_R} stroke={sel ? C.ink : accent} strokeWidth={sel ? 3.5 : 2.5} dash={[4, 4]} />
                  {gInitials ? (
                    <Text text={gLabel.primary} x={-20} y={-5} width={40} align="center" fontSize={12} fontStyle="bold" fontFamily={FONT} fill={C.inkSoft} listening={false} />
                  ) : (
                    <Text
                      text={gLabel.primary}
                      x={-56}
                      y={GHOST_R + 6}
                      width={112}
                      align="center"
                      fontSize={12}
                      fontFamily={FONT}
                      fill={C.inkSoft}
                      listening={false}
                    />
                  )}
                  {!gInitials && gLabel.secondary && (
                    <Text text={gLabel.secondary} x={-56} y={GHOST_R + 20} width={112} align="center" fontSize={10.5} fontFamily={FONT} fill={C.inkSoft} opacity={0.75} listening={false} />
                  )}
                  {lod === "roles" && !gInitials && (
                    <Text text={`${a.pct}%`} x={-56} y={GHOST_R + (gLabel.secondary ? 33 : 21)} width={112} align="center" fontSize={11} fontStyle="bold" fontFamily={FONT} fill={accent} listening={false} />
                  )}
                </Group>
              );
            })}

            {showPeople &&
              people.filter((p) => p.crossCuttingTier === null).map((p, pi) => {
                const u = utilOf(p);
                const shared = p.allocations.length > 1;
                const ov = personOverlay(p);
                const home = byId.get(p.homeId);
                const inP = phase(introT, 0.34 + pi * 0.012, 0.34);
                const ix = home ? home.x + (p.x - home.x) * inP : p.x;
                const iy = home ? home.y + (p.y - home.y) * inP : p.y;
                const label = personLabel(p, lens);
                // Initials go *inside* the circle: at that setting the point is
                // to read the org's shape, not its roster, so nothing hangs
                // below the seat to thicken the ring.
                const initialsInside = lens.labelBy === "initials";
                return (
                  <Group
                    key={p.id}
                    x={ix}
                    y={iy}
                    opacity={(ov.dimmed ? 0.3 : 1) * inP}
                    draggable
                    onDragMove={onPersonDragMove}
                    onDragEnd={(e) => onNodeDragEnd(e, p)}
                    onMouseEnter={() => showHover(p.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => selectNode(p.id)}
                    onTap={() => selectNode(p.id)}
                    onDblClick={() => setOpenTaskPersonId(p.id)}
                    onDblTap={() => setOpenTaskPersonId(p.id)}
                  >
                    <Circle radius={22} fill={C.white} stroke={selectedId === p.id ? C.ink : seatColor(p)} strokeWidth={shared ? 5 : 3.5} dash={shared ? [5, 3] : undefined} />
                    {/* The over-110% pip is a *fact*, not a colour choice — it
                        survives every lens, so switching to colour-by-discipline
                        never hides who is drowning. */}
                    {u > 110 && <Circle radius={7} y={-1} fill={C.utilOver} listening={false} />}
                    {initialsInside ? (
                      <Text text={initialsOf(p.name)} x={-22} y={-6} width={44} align="center" fontSize={14} fontStyle="bold" fontFamily={FONT} fill={C.ink} listening={false} />
                    ) : (
                      <Text text={label.primary} x={-70} y={28} width={140} align="center" fontSize={13} fontStyle="bold" fontFamily={FONT} fill={C.ink} listening={false} />
                    )}
                    {!initialsInside && label.secondary && lod !== "roles" && (
                      <Text text={label.secondary} x={-70} y={44} width={140} align="center" fontSize={11.5} fontFamily={FONT} fill={C.inkSoft} listening={false} />
                    )}
                    {lod === "roles" && !initialsInside && (
                      <>
                        <Text text={p.title ?? ""} x={-70} y={44} width={140} align="center" fontSize={11.5} fontFamily={FONT} fill={C.inkSoft} listening={false} />
                        <Text
                          text={u > 0 ? `${u}%` : "—"}
                          x={-70}
                          y={58}
                          width={140}
                          align="center"
                          fontSize={11.5}
                          fontStyle="bold"
                          fontFamily={FONT}
                          fill={utilColor(u)}
                          listening={false}
                        />
                      </>
                    )}
                    {ov.badge && (
                      <Text
                        text={ov.badge}
                        x={-70}
                        y={initialsInside ? 28 : lod === "roles" ? 74 : 44}
                        width={140}
                        align="center"
                        fontSize={11}
                        fontStyle="bold"
                        fontFamily={FONT}
                        fill={C.heat}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}
          </Layer>
        </Stage>

        <div style={S.lodDock}>
          {lodLabels(vocabulary).map(([id, label]) => (
            <span key={id} style={S.lodItem(lod === id)}>
              {label}
            </span>
          ))}
          <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>{scale.toFixed(2)}×</span>
        </div>

        {/* Legend follows the lens. The two dashed entries are *shape*, not
            colour, so they stay true whatever colour is carrying. */}
        <div style={S.legend}>
          {legend
            .filter((e) => e.count > 0)
            .map((e) => (
              <span key={e.key}>
                <i style={{ ...S.sw, background: e.color }} /> {e.label}
                <span style={S.legendCount}>{e.count}</span>
              </span>
            ))}
          <span style={S.legendSep} />
          <span>
            <i style={{ ...S.sw, border: `2px dashed ${C.cross}`, background: "transparent" }} /> multiple {lower(vocabulary.team.plural)}
          </span>
          <span>
            <i style={{ ...S.sw, border: `2px dashed ${C.crossStream}`, background: "transparent" }} /> multiple {lower(vocabulary.stream.plural)}
          </span>
        </div>

        {hovered && hover && (
          <div style={{ ...S.bubble, left: hover.x, top: hover.y }}>
            <strong>{hovered.name}</strong>
            <span style={{ fontSize: 11.5, color: "#ffffffbf" }}>
              {hovered.kind === "person"
                ? `${hovered.title ?? ""} · ${utilOf(hovered) || "—"}${utilOf(hovered) ? "%" : ""}`
                : `${teamStats.get(hovered.id)?.heads ?? 0} people · ${money(teamStats.get(hovered.id)?.cost ?? 0)}/mo`}
            </span>
          </div>
        )}
      </div>

      <aside style={{ ...S.panel, transform: panelOpen ? "translateX(0)" : "translateX(105%)" }}>
        {panelOpen && (
          <>
            <div style={S.panelHead}>
              <div>
                <div style={S.panelType}>
                  {creating
                    ? `New ${creating === "stream" ? lower(vocabulary.stream.singular) : creating === "team" ? lower(vocabulary.team.singular) : "person"}`
                    : selected?.kind === "person"
                      ? "Person"
                      : vocabulary.team.singular}
                </div>
                <h2 style={{ margin: "2px 0 0", fontSize: 19 }}>
                  {creating
                    ? creating === "person"
                      ? "Add person"
                      : creating === "team"
                        ? `Add ${lower(vocabulary.team.singular)}`
                        : `Add ${lower(vocabulary.stream.singular)}`
                    : selected?.name}
                </h2>
              </div>
              <button style={S.close} onClick={closePanel} aria-label="Close">
                ✕
              </button>
            </div>
            <div style={S.panelBody}>
              {creating === "person" && (
                <PersonForm mode="create" teams={teams} disciplines={disciplines} onSaved={closePanel} onCancel={closePanel} />
              )}
              {creating === "team" && (
                <TeamForm mode="create" streams={realStreams} people={people} onSaved={closePanel} onCancel={closePanel} />
              )}
              {creating === "stream" && (
                <StreamForm parentId={streamParentId} people={people} onSaved={closePanel} onCancel={closePanel} />
              )}
              {!creating && selected?.kind === "person" && !editing && (
                <PersonBody
                  person={selected}
                  byId={byId}
                  teams={teams}
                  disciplines={disciplines}
                  onSelect={selectNode}
                  onEdit={() => setEditing(true)}
                  onOpenBoard={() => setOpenTaskPersonId(selected.id)}
                />
              )}
              {!creating && selected?.kind === "person" && editing && (
                <PersonForm
                  mode="edit"
                  person={selected}
                  teams={teams}
                  disciplines={disciplines}
                  onSaved={() => setEditing(false)}
                  onCancel={() => setEditing(false)}
                  onDeleted={closePanel}
                />
              )}
              {!creating && selected?.kind === "team" && !editing && (
                <TeamBody
                  team={selected}
                  stats={teamStats.get(selected.id)}
                  people={people}
                  onSelect={selectNode}
                  onEdit={() => setEditing(true)}
                />
              )}
              {!creating && selected?.kind === "team" && editing && (
                <TeamForm
                  mode="edit"
                  team={selected}
                  streams={realStreams}
                  people={people}
                  onSaved={() => setEditing(false)}
                  onCancel={() => setEditing(false)}
                  onDeleted={closePanel}
                />
              )}
            </div>
          </>
        )}
      </aside>

      {openTaskPerson && openTaskPerson.kind === "person" && (
        <PersonTaskBoard
          key={openTaskPerson.id}
          person={openTaskPerson}
          accent={seatColor(openTaskPerson)}
          teamNames={openTaskPersonTeams}
          onBack={() => setOpenTaskPersonId(null)}
        />
      )}
    </div>
    </VocabularyProvider>
  );
}

// --- panel bodies ----------------------------------------------------------
function PersonBody({
  person,
  byId,
  teams,
  disciplines,
  onSelect,
  onEdit,
  onOpenBoard,
}: {
  person: CanvasPerson;
  byId: Map<string, CanvasNode>;
  teams: CanvasTeam[];
  disciplines: Discipline[];
  onSelect: (id: string) => void;
  onEdit: () => void;
  onOpenBoard: () => void;
}) {
  const u = utilOf(person);
  const mgr = person.managerId ? byId.get(person.managerId) : null;
  const discipline = disciplines.find((d) => d.id === person.disciplineId) ?? null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: C.inkSoft, fontSize: 13 }}>{person.title}</div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button style={S.editBtn} onClick={onOpenBoard}>
            Zoom to tasks →
          </button>
          <button style={S.editBtn} onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
      {/* Discipline is what they *are*; the title above is their HR label. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {discipline && (
          <span style={{ ...S.tag, background: `${discipline.color ?? C.inkSoft}1f`, color: C.ink }}>
            {discipline.name}
          </span>
        )}
        {person.employment !== "fte" && person.employment !== "unknown" && (
          <span style={{ ...S.tag, background: `${C.cross}22`, color: C.ink }}>
            {EMPLOYMENT_LABELS[person.employment]}
          </span>
        )}
        {person.location && <span style={S.tag}>{person.location}</span>}
      </div>
      <Meter label="Delivery load" value={u} />
      <Assignments person={person} byId={byId} teams={teams} onSelect={onSelect} />
      <Section title="Facts">
        <div style={S.facts}>
          <Fact label="Cost / mo" value={money(person.costPerMonth)} />
          <Fact label="Reports to" value={mgr?.name ?? "—"} />
          <Fact label="Started" value={person.startDate ?? "—"} />
          <Fact label="Last leave" value={person.lastVacationAt ?? "—"} />
          <Fact label="Employment" value={EMPLOYMENT_LABELS[person.employment] ?? "—"} />
          <Fact label="Time zone" value={person.timezone ?? "—"} />
        </div>
      </Section>
      {person.skills.length > 0 && (
        <Section title="Skills">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {person.skills.map((s) => (
              <span key={s} style={S.tag}>
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function TeamBody({
  team,
  stats,
  people,
  onSelect,
  onEdit,
}: {
  team: CanvasTeam;
  stats: TeamStats | undefined;
  people: CanvasPerson[];
  onSelect: (id: string) => void;
  onEdit: () => void;
}) {
  const members = team.isCrossCutting
    ? people.filter((p) => p.homeId === team.id)
    : people.filter((p) => p.allocations.some((a) => a.unitId === team.id));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: C.inkSoft, fontSize: 13 }}>
          {team.streamName}
          {team.vendorName ? ` · ${team.vendorName}` : ""}
        </div>
        {!team.isCrossCutting && (
          <button style={S.editBtn} onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      <Section title="Facts">
        <div style={S.facts}>
          <Fact label="People" value={String(stats?.heads ?? 0)} />
          <Fact label="FTE" value={(stats?.fte ?? 0).toFixed(1)} />
          <Fact label="Cost / mo" value={money(stats?.cost ?? 0)} />
          <Fact label="Target" value={team.targetHeadcount?.toString() ?? "—"} />
          <Fact label="Open roles" value={String(team.openRoles)} tone={team.openRoles ? C.utilOver : undefined} />
          <Fact label="Shared in" value={String(stats?.shared ?? 0)} />
        </div>
      </Section>
      <Section title={`People (${members.length})`}>
        <ul style={S.list}>
          {members.map((p) => {
            const a = p.allocations.find((x) => x.unitId === team.id);
            return (
              <li key={p.id} style={{ ...S.li, cursor: "pointer" }} onClick={() => onSelect(p.id)}>
                <span style={{ ...S.sw, background: utilColor(utilOf(p)) }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ color: C.inkSoft, fontVariantNumeric: "tabular-nums" }}>
                  {a ? `${a.role} · ${a.pct}%` : `${utilOf(p)}% total`}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// --- panel forms: create/edit person or team -------------------------------
type PersonFormState = {
  name: string;
  title: string;
  teamId: string;
  costPerMonth: string;
  skills: string;
  startDate: string;
  lastVacationAt: string;
  growthFocus: string;
  disciplineId: string;
  employment: "fte" | "contractor" | "vendor" | "unknown";
  location: string;
  timezone: string;
};

const emptyPersonForm: PersonFormState = {
  name: "",
  title: "",
  teamId: "",
  costPerMonth: "",
  skills: "",
  startDate: "",
  lastVacationAt: "",
  growthFocus: "",
  disciplineId: "",
  employment: "unknown",
  location: "",
  timezone: "",
};

/** The assignment drag-to-reassign would move: the highest-% one. */
function personHomeAllocation(p: CanvasPerson) {
  if (p.allocations.length === 0) return null;
  return [...p.allocations].sort((a, b) => b.pct - a.pct)[0];
}

function personToForm(p: CanvasPerson): PersonFormState {
  return {
    name: p.name,
    title: p.title ?? "",
    teamId: personHomeAllocation(p)?.unitId ?? "",
    costPerMonth: p.costPerMonth ? String(p.costPerMonth) : "",
    skills: p.skills.join(", "),
    startDate: p.startDate ?? "",
    lastVacationAt: p.lastVacationAt ?? "",
    growthFocus: p.growthFocus ?? "",
    disciplineId: p.disciplineId ?? "",
    employment: p.employment,
    location: p.location ?? "",
    timezone: p.timezone ?? "",
  };
}

function PersonForm({
  mode,
  person,
  teams,
  disciplines,
  onSaved,
  onCancel,
  onDeleted,
}: {
  mode: "create" | "edit";
  person?: CanvasPerson;
  teams: CanvasTeam[];
  disciplines: Discipline[];
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PersonFormState>(person ? personToForm(person) : emptyPersonForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const home = person ? personHomeAllocation(person) : null;
  const realTeams = teams.filter((s) => !s.isCrossCutting);

  function submit() {
    setError(null);
    startTransition(async () => {
      const { teamId, ...personFields } = form;
      let personId: string;
      if (mode === "edit" && person) {
        const res = await updatePerson(person.id, personFields);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        personId = person.id;
      } else {
        const res = await createPerson(personFields);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        personId = res.data.id;
      }

      const currentTeamId = home?.unitId ?? "";
      if (teamId !== currentTeamId) {
        if (teamId && home) {
          await moveAssignment(home.assignmentId, teamId);
        } else if (teamId && !home) {
          await createAssignment({
            orgUnitId: teamId,
            personId,
            roleOnTeam: "",
            allocationPct: 100,
            isOpenRole: false,
          });
        } else if (!teamId && home) {
          await deleteAssignment(home.assignmentId);
        }
      }

      router.refresh();
      onSaved();
    });
  }

  function remove() {
    if (!person) return;
    if (!confirm("Delete this person? Their assignments are removed too.")) return;
    startTransition(async () => {
      await deletePerson(person.id);
      router.refresh();
      onDeleted?.();
    });
  }

  return (
    <>
      <label style={S.formLabel}>Name *</label>
      <input style={S.formInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label style={S.formLabel}>Job title</label>
      <input style={S.formInput} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <p style={S.formHint}>Their HR label. Discipline below is what gets counted.</p>
      <label style={S.formLabel}>Discipline</label>
      <select
        style={S.formInput}
        value={form.disciplineId}
        onChange={(e) => setForm({ ...form, disciplineId: e.target.value })}
      >
        <option value="">— none —</option>
        {disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Employment</label>
      <select
        style={S.formInput}
        value={form.employment}
        onChange={(e) => setForm({ ...form, employment: e.target.value as PersonFormState["employment"] })}
      >
        {(["fte", "contractor", "vendor", "unknown"] as const).map((k) => (
          <option key={k} value={k}>
            {EMPLOYMENT_LABELS[k]}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Location</label>
      <input style={S.formInput} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      <label style={S.formLabel}>Time zone</label>
      <input
        style={S.formInput}
        placeholder="Europe/Berlin"
        value={form.timezone}
        onChange={(e) => setForm({ ...form, timezone: e.target.value })}
      />
      <label style={S.formLabel}>Team</label>
      <select
        style={S.formInput}
        value={form.teamId}
        onChange={(e) => setForm({ ...form, teamId: e.target.value })}
      >
        <option value="">— unassigned —</option>
        {realTeams.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {person && person.allocations.length > 1 && (
        <p style={S.formHint}>
          {person.name} is on {person.allocations.length} teams — this changes only their primary
          (highest-%) assignment, same as dragging their dot.
        </p>
      )}
      <label style={S.formLabel}>Cost / month ($)</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={form.costPerMonth}
        onChange={(e) => setForm({ ...form, costPerMonth: e.target.value })}
      />
      <label style={S.formLabel}>Skills (comma separated)</label>
      <input style={S.formInput} value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} />
      <label style={S.formLabel}>Start date (YYYY-MM-DD)</label>
      <input
        style={S.formInput}
        placeholder="YYYY-MM-DD"
        value={form.startDate}
        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
      />
      <label style={S.formLabel}>Last vacation (YYYY-MM-DD)</label>
      <input
        style={S.formInput}
        placeholder="YYYY-MM-DD"
        value={form.lastVacationAt}
        onChange={(e) => setForm({ ...form, lastVacationAt: e.target.value })}
      />
      <label style={S.formLabel}>Growth focus</label>
      <input
        style={S.formInput}
        value={form.growthFocus}
        onChange={(e) => setForm({ ...form, growthFocus: e.target.value })}
      />

      {error && <p style={S.formError}>{error}</p>}

      <div style={S.formActions}>
        <button style={S.applyBtn} onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create person"}
        </button>
        <button style={S.discardBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {mode === "edit" && (
        <button style={S.dangerBtn} onClick={remove} disabled={pending}>
          Delete person
        </button>
      )}
    </>
  );
}

type TeamFormState = {
  name: string;
  streamId: string;
  leadPersonId: string;
  targetHeadcount: string;
  costPerMonth: string;
  expectedRoi: string;
  isExternal: boolean;
  vendorName: string;
};

function emptyTeamForm(streams: CanvasStream[]): TeamFormState {
  return {
    name: "",
    streamId: streams[0]?.id ?? "",
    leadPersonId: "",
    targetHeadcount: "",
    costPerMonth: "",
    expectedRoi: "",
    isExternal: false,
    vendorName: "",
  };
}

// Assumes the team's real parentId is its stream directly — true today (the
// demo org has no sub-group nesting between stream and team; see the "Sub-groups"
// story in docs/ROADMAP.md). Revisit if that nesting lands.
function teamToForm(s: CanvasTeam): TeamFormState {
  return {
    name: s.name,
    streamId: s.streamId,
    leadPersonId: s.leadPersonId ?? "",
    targetHeadcount: s.targetHeadcount != null ? String(s.targetHeadcount) : "",
    costPerMonth: s.costPerMonth != null ? String(s.costPerMonth) : "",
    expectedRoi: s.expectedRoi != null ? String(s.expectedRoi) : "",
    isExternal: s.isExternal,
    vendorName: s.vendorName ?? "",
  };
}

function TeamForm({
  mode,
  team,
  streams,
  people,
  onSaved,
  onCancel,
  onDeleted,
}: {
  mode: "create" | "edit";
  team?: CanvasTeam;
  streams: CanvasStream[];
  people: CanvasPerson[];
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const vocab = useVocabulary();
  const [form, setForm] = useState<TeamFormState>(team ? teamToForm(team) : emptyTeamForm(streams));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!form.streamId) {
      setError(`Choose a ${lower(vocab.stream.singular)}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const payload = {
        name: form.name,
        kind: "team" as const,
        parentId: form.streamId,
        leadPersonId: form.leadPersonId,
        targetHeadcount: form.targetHeadcount,
        costPerMonth: form.costPerMonth,
        expectedRoi: form.expectedRoi,
        isExternal: form.isExternal,
        vendorName: form.vendorName,
      };
      const res =
        mode === "edit" && team ? await updateOrgUnit(team.id, payload) : await createOrgUnit(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onSaved();
    });
  }

  function remove() {
    if (!team) return;
    if (!confirm(`Delete "${team.name}" and its assignments?`)) return;
    startTransition(async () => {
      await deleteOrgUnit(team.id);
      router.refresh();
      onDeleted?.();
    });
  }

  return (
    <>
      <label style={S.formLabel}>Name *</label>
      <input style={S.formInput} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label style={S.formLabel}>{vocab.stream.singular} *</label>
      <select
        style={S.formInput}
        value={form.streamId}
        onChange={(e) => setForm({ ...form, streamId: e.target.value })}
      >
        {streams.length === 0 && (
          <option value="">No {lower(vocab.stream.plural)} yet</option>
        )}
        {streams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Lead</label>
      <select
        style={S.formInput}
        value={form.leadPersonId}
        onChange={(e) => setForm({ ...form, leadPersonId: e.target.value })}
      >
        <option value="">— none —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Target headcount</label>
      <input
        style={S.formInput}
        inputMode="numeric"
        value={form.targetHeadcount}
        onChange={(e) => setForm({ ...form, targetHeadcount: e.target.value })}
      />
      <label style={S.formLabel}>Unit cost / month ($)</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={form.costPerMonth}
        onChange={(e) => setForm({ ...form, costPerMonth: e.target.value })}
      />
      <label style={S.formLabel}>Expected ROI ($)</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={form.expectedRoi}
        onChange={(e) => setForm({ ...form, expectedRoi: e.target.value })}
      />
      <div style={S.formCheckboxRow}>
        <input
          type="checkbox"
          id="team-external"
          checked={form.isExternal}
          onChange={(e) => setForm({ ...form, isExternal: e.target.checked })}
        />
        <label htmlFor="team-external">External / vendor {lower(vocab.team.singular)}</label>
      </div>
      {form.isExternal && (
        <>
          <label style={S.formLabel}>Vendor name</label>
          <input
            style={S.formInput}
            value={form.vendorName}
            onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
          />
        </>
      )}

      {error && <p style={S.formError}>{error}</p>}

      <div style={S.formActions}>
        <button style={S.applyBtn} onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode === "edit" ? "Save changes" : `Create ${lower(vocab.team.singular)}`}
        </button>
        <button style={S.discardBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {mode === "edit" && (
        <button style={S.dangerBtn} onClick={remove} disabled={pending}>
          Delete team
        </button>
      )}
    </>
  );
}

/**
 * Create a value stream — the top rung. Deliberately the shortest form in the
 * app: a stream is a container, and everything interesting about it (teams,
 * cost, headcount) is rolled up from what you put inside it. It hangs off the
 * same parent as the streams that already exist, so the top rung stays the
 * top rung rather than accidentally nesting.
 */
function StreamForm({
  parentId,
  people,
  onSaved,
  onCancel,
}: {
  parentId: string | null;
  people: CanvasPerson[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const vocab = useVocabulary();
  const [name, setName] = useState("");
  const [leadPersonId, setLeadPersonId] = useState("");
  const [expectedRoi, setExpectedRoi] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createOrgUnit({
        name,
        kind: "group" as const,
        parentId,
        leadPersonId,
        targetHeadcount: "",
        costPerMonth: "",
        expectedRoi,
        isExternal: false,
        vendorName: "",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onSaved();
    });
  }

  return (
    <>
      <label style={S.formLabel}>Name *</label>
      <input style={S.formInput} value={name} onChange={(e) => setName(e.target.value)} />
      <label style={S.formLabel}>Owner</label>
      <select
        style={S.formInput}
        value={leadPersonId}
        onChange={(e) => setLeadPersonId(e.target.value)}
      >
        <option value="">— none —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label style={S.formLabel}>Expected ROI / mo</label>
      <input
        style={S.formInput}
        inputMode="decimal"
        value={expectedRoi}
        onChange={(e) => setExpectedRoi(e.target.value)}
      />

      {error && <p style={S.formError}>{error}</p>}

      <p style={{ margin: "10px 0 0", fontSize: 12, color: C.inkSoft }}>
        It lands empty, to the right of the map. Add a {lower(vocab.team.singular)} to fill it.
      </p>

      <div style={S.formActions}>
        <button style={S.applyBtn} onClick={submit} disabled={pending}>
          {pending ? "Saving…" : `Create ${lower(vocab.stream.singular)}`}
        </button>
        <button style={S.discardBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

/**
 * Editable team memberships for one person. This is the only place in the map
 * where you can put someone on a *second* team — dragging a dot and the Edit
 * form's Team picker both *move* the primary assignment rather than adding to
 * it, which is why a multi-team person previously could only be created from
 * /teams or an import.
 */
function Assignments({
  person,
  byId,
  teams,
  onSelect,
}: {
  person: CanvasPerson;
  byId: Map<string, CanvasNode>;
  teams: CanvasTeam[];
  onSelect: (id: string) => void;
}) {
  const router = useRouter();
  const vocab = useVocabulary();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addTeam, setAddTeam] = useState("");
  const [addPct, setAddPct] = useState("20");

  const taken = new Set(person.allocations.map((a) => a.unitId));
  const options = teams.filter((s) => !s.isCrossCutting && !taken.has(s.id));
  const total = utilOf(person);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong");
      else router.refresh();
    });
  };

  return (
    <Section title={vocab.team.plural}>
      {person.allocations.length === 0 ? (
        <p style={S.empty}>No delivery allocation — leadership or unassigned.</p>
      ) : (
        <ul style={S.list}>
          {person.allocations.map((a) => (
            <li key={a.assignmentId} style={S.li}>
              <button style={S.linkish} onClick={() => onSelect(a.unitId)} title="Show on map">
                {byId.get(a.unitId)?.name ?? a.unitId}
              </button>
              <input
                type="number"
                min={1}
                max={100}
                defaultValue={a.pct}
                disabled={pending}
                style={S.pctInput}
                aria-label={`Allocation % on ${byId.get(a.unitId)?.name ?? "team"}`}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next) || next === a.pct) return;
                  run(() => updateAssignment(a.assignmentId, { allocationPct: next }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span style={{ color: C.inkSoft }}>%</span>
              <button
                style={S.rowX}
                disabled={pending}
                onClick={() => run(() => deleteAssignment(a.assignmentId))}
                aria-label={`Remove from ${byId.get(a.unitId)?.name ?? "team"}`}
                title={`Remove from this ${lower(vocab.team.singular)}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {person.allocations.length > 0 && (
        <div style={{ ...S.allocTotal, color: total > 100 ? C.utilOver : C.inkSoft }}>
          {total}% allocated{total > 100 ? " — over-allocated" : ""}
        </div>
      )}

      {adding ? (
        <div style={S.addRow}>
          <select
            style={{ ...S.formInput, flex: 1 }}
            value={addTeam}
            onChange={(e) => setAddTeam(e.target.value)}
          >
            <option value="">Choose a team…</option>
            {options.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={100}
            value={addPct}
            onChange={(e) => setAddPct(e.target.value)}
            style={S.pctInput}
            aria-label="Allocation %"
          />
          <span style={{ color: C.inkSoft }}>%</span>
          <button
            style={S.editBtn}
            disabled={pending || !addTeam}
            onClick={() =>
              run(async () => {
                const res = await createAssignment({
                  orgUnitId: addTeam,
                  personId: person.id,
                  roleOnTeam: person.title ?? "",
                  allocationPct: addPct,
                  isOpenRole: false,
                });
                if (res.ok) {
                  setAdding(false);
                  setAddTeam("");
                  setAddPct("20");
                }
                return res;
              })
            }
          >
            Add
          </button>
          <button style={S.rowX} onClick={() => setAdding(false)} aria-label="Cancel">
            ✕
          </button>
        </div>
      ) : (
        options.length > 0 && (
          <button style={S.addBtn} onClick={() => setAdding(true)}>
            + Add to another team
          </button>
        )
      )}
      {error && <p style={{ ...S.empty, color: C.utilOver }}>{error}</p>}
      <p style={{ ...S.empty, marginTop: 8, fontSize: 11.5 }}>
        Tip: hold ⌥ while dragging someone onto a team to add that team instead of moving them.
      </p>
    </Section>
  );
}

/** One dimension of the lens: a titled column of radio-ish rows. Each row
 *  carries a hint, because "Discipline" alone doesn't say what will change. */
function LensChoice<T extends string>({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: readonly { value: T; label: string; hint: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <div style={S.lensTitle}>{title}</div>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} style={S.lensRow(on)} onClick={() => onPick(o.value)}>
            <span style={S.lensTick(on)}>{on ? "●" : "○"}</span>
            <span>
              <span style={{ display: "block", fontWeight: 600 }}>{o.label}</span>
              <span style={{ display: "block", fontSize: 11, color: C.inkSoft, marginTop: 1 }}>
                {o.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={S.h3}>{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={S.fact}>
      <div style={S.factLabel}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: tone ?? C.ink }}>{value}</div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span style={{ color: C.inkSoft }}>{label}</span>
        <strong style={{ color: utilColor(value) }}>{value ? `${value}%` : "—"}</strong>
      </div>
      <div style={S.track}>
        <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(value, 150) / 1.5}%`, background: utilColor(value) }} />
      </div>
    </div>
  );
}

// --- styles ------------------------------------------------------------------
const S = {
  root: {
    position: "relative" as const,
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT,
    overflow: "hidden",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 10,
    padding: "10px 16px",
    borderBottom: `1px solid ${C.line}`,
    zIndex: 20,
  },
  btn: {
    minWidth: 40,
    height: 40,
    padding: "0 12px",
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    background: C.white,
    color: C.ink,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  overlayGroup: {
    display: "flex",
    gap: 4,
    paddingLeft: 12,
    marginLeft: 4,
    borderLeft: `1px solid ${C.line}`,
  },
  /** The leading group has nothing to its left to divide it from. */
  overlayGroupFirst: { display: "flex", gap: 4 },
  overlayBtn: (active: boolean) => ({
    height: 34,
    padding: "0 11px",
    borderRadius: 8,
    border: `1px solid ${active ? C.ink : "transparent"}`,
    background: active ? C.ink : "transparent",
    color: active ? C.white : C.inkSoft,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  }),
  scenarioBtn: (active: boolean) => ({
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${active ? C.team : C.line}`,
    background: active ? C.team : C.white,
    color: active ? C.white : C.ink,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  }),
  pendingPill: {
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "#047857",
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: 999,
    padding: "7px 11px",
    whiteSpace: "nowrap" as const,
  },
  applyBtn: {
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: "none",
    background: C.team,
    color: C.white,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
  },
  discardBtn: {
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: "transparent",
    color: C.ink,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  editBtn: {
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${C.line}`,
    background: C.white,
    color: C.ink,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  formLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: C.inkSoft,
    marginTop: 14,
    marginBottom: 5,
  },
  formInput: {
    width: "100%",
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: C.paper,
    padding: "8px 10px",
    fontSize: 13.5,
    fontFamily: FONT,
    color: C.ink,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  formCheckboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    fontSize: 13,
    color: C.ink,
  },
  formError: {
    marginTop: 12,
    fontSize: 12.5,
    color: "#dc2626",
  },
  formHint: {
    marginTop: 6,
    marginBottom: 0,
    fontSize: 11.5,
    color: C.inkSoft,
    lineHeight: 1.4,
  },
  formActions: {
    display: "flex",
    gap: 8,
    marginTop: 20,
  },
  dangerBtn: {
    marginTop: 14,
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "transparent",
    color: "#dc2626",
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  canvasWrap: { position: "relative" as const, flex: 1, overflow: "hidden", touchAction: "none" as const },
  lodDock: {
    position: "absolute" as const,
    right: 14,
    bottom: 14,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    background: "#ffffffeb",
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
  },
  lodItem: (on: boolean) => ({
    color: on ? C.ink : "#b6bcc4",
    borderBottom: on ? `2px solid ${C.cross}` : "2px solid transparent",
    paddingBottom: 1,
  }),
  lensBtn: (active: boolean) => ({
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: `1px solid ${active ? C.ink : C.line}`,
    background: active ? C.ink : C.white,
    color: active ? C.white : C.ink,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  }),
  // Muted: the workspace as a whole sits on a non-default lens. Shared state,
  // nothing for one person to undo.
  lensDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: C.inkSoft,
    display: "inline-block",
  },
  // Amber: "you are in a mode", the same grammar as the scenario chip. Reserved
  // for state that is *yours* and that you can step back out of.
  myViewDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: C.cross,
    display: "inline-block",
  },
  scrim: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 40,
  },
  lensPanel: {
    position: "absolute" as const,
    top: 42,
    left: 12,
    zIndex: 41,
    width: 248,
    padding: 12,
    background: C.white,
    border: `1px solid ${C.line}`,
    borderRadius: 14,
    boxShadow: "0 12px 30px rgba(34,39,46,0.14)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  lensTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: C.inkSoft,
    marginBottom: 6,
  },
  lensRow: (on: boolean) => ({
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid transparent",
    background: on ? "#f2f0ea" : "transparent",
    color: C.ink,
    fontFamily: FONT,
    fontSize: 13,
    textAlign: "left" as const,
    cursor: "pointer",
  }),
  lensTick: (on: boolean) => ({ fontSize: 11, lineHeight: "18px", color: on ? C.ink : "#c3bfb4" }),
  lensDivider: { height: 1, background: C.line },
  lensFoot: { margin: 0, fontSize: 11, color: C.inkSoft },
  lensFootRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
  },
  myViewTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: C.ink,
    marginRight: "auto",
  },
  lensLink: {
    border: "none",
    background: "none",
    padding: 0,
    fontSize: 11,
    color: "#4338ca",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  legendCount: {
    marginLeft: 5,
    fontVariantNumeric: "tabular-nums" as const,
    color: "#a9a496",
  },
  legendSep: {
    width: 1,
    alignSelf: "stretch" as const,
    background: C.line,
  },
  legend: {
    position: "absolute" as const,
    left: 14,
    bottom: 14,
    maxWidth: "min(62vw, 720px)",
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: "6px 14px",
    padding: "10px 14px",
    background: "#ffffffeb",
    border: `1px solid ${C.line}`,
    borderRadius: 12,
    fontSize: 11.5,
    color: C.inkSoft,
    pointerEvents: "none" as const,
  },
  sw: { display: "inline-block", width: 10, height: 10, borderRadius: "50%", marginRight: 5, verticalAlign: "middle" },
  bubble: {
    position: "absolute" as const,
    transform: "translate(-50%, calc(-100% - 14px))",
    background: C.ink,
    color: C.white,
    padding: "8px 12px",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    pointerEvents: "none" as const,
    fontSize: 13,
    whiteSpace: "nowrap" as const,
    zIndex: 35,
  },
  panel: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    width: "min(360px, 88vw)",
    background: C.white,
    borderLeft: `1px solid ${C.line}`,
    display: "flex",
    flexDirection: "column" as const,
    transition: "transform .28s cubic-bezier(.32,.72,.3,1)",
    boxShadow: "-8px 0 24px #22272e0f",
    zIndex: 40,
  },
  panelHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 20px 12px", borderBottom: `1px solid ${C.line}` },
  panelType: { fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: C.inkSoft },
  panelBody: { padding: "16px 20px 24px", overflowY: "auto" as const },
  close: { width: 36, height: 36, borderRadius: "50%", border: "none", background: C.paper, color: C.ink, fontSize: 14, cursor: "pointer" },
  h3: { margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: C.inkSoft },
  facts: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" },
  fact: { background: C.paper, borderRadius: 10, padding: "9px 12px" },
  factLabel: { fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: C.inkSoft, marginBottom: 2 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  li: { display: "flex", alignItems: "center", gap: 9, padding: "10px 8px", borderRadius: 10, minHeight: 44, fontSize: 13.5 },
  tag: { background: C.paper, borderRadius: 999, padding: "4px 10px", fontSize: 12, color: C.inkSoft },
  track: { height: 8, borderRadius: 999, background: C.paper, overflow: "hidden", marginTop: 6 },
  empty: { margin: 0, fontSize: 13, color: C.inkSoft },
  linkish: {
    flex: 1,
    textAlign: "left" as const,
    border: "none",
    background: "transparent",
    padding: 0,
    font: "inherit",
    fontSize: 13.5,
    color: C.ink,
    cursor: "pointer",
  },
  pctInput: {
    width: 54,
    borderRadius: 8,
    border: `1px solid ${C.line}`,
    background: C.paper,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.ink,
    textAlign: "right" as const,
    outline: "none",
  },
  rowX: {
    width: 26,
    height: 26,
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: C.inkSoft,
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  allocTotal: { marginTop: 6, fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" as const },
  addRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 10 },
  addBtn: {
    marginTop: 10,
    width: "100%",
    height: 36,
    borderRadius: 10,
    border: `1px dashed ${C.line}`,
    background: "transparent",
    color: C.inkSoft,
    fontFamily: FONT,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
};
