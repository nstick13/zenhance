"use client";

import { useMemo, useState, useRef, useEffect, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { linkRadial } from "d3-shape";
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type D3ZoomEvent } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition";
import type { OrgUnit, Person, Assignment } from "@/lib/db/schema";
import { moveAssignment } from "@/lib/data/actions";
import {
  indexById,
  childUnitsByParent,
  assignmentsByUnit,
  rootUnits,
  pathToRoot,
  overAllocatedPersonIds,
  unitStaffing,
  allocationByPerson,
  tenureYears,
} from "@/lib/org/model";
import { computeRollup, type UnitRollup } from "@/lib/analytics/rollup";
import { computeGaps, type UnitGap } from "@/lib/analytics/gaps";
import { computeOrgSummary, type OrgSummary } from "@/lib/analytics/allocation";
import { computeAllFindings, type Finding } from "@/lib/analytics/findings";

type OverlayType = "none" | "allocation" | "gaps" | "cost";

type NodeDatum = {
  key: string;
  kind: "unit" | "member";
  name: string;
  unit?: OrgUnit;
  assignment?: Assignment;
  person?: Person | null;
  isOpenRole?: boolean;
  memberCount?: number;
  childUnitCount?: number;
  overAllocated?: boolean;
  isCenter?: boolean;
};

const WIDTH = 1040;
const HEIGHT = 760;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const INNER_RADIUS = 185;
const OUTER_RADIUS = Math.min(CX, CY) - 36;
const DROP_RADIUS = 34;

function pointRadial(angle: number, r: number): [number, number] {
  const a = angle - Math.PI / 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const a0 = (startDeg * Math.PI) / 180;
  const a1 = (endDeg * Math.PI) / 180;
  const x0 = Math.cos(a0) * r;
  const y0 = Math.sin(a0) * r;
  const x1 = Math.cos(a1) * r;
  const y1 = Math.sin(a1) * r;
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export function RadialOrg({
  people,
  units,
  assignments,
}: {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Scenario planning: `moves` overlays assignment -> new orgUnitId without
  // touching the server until Apply (or, in live mode, persists immediately).
  const [scenario, setScenario] = useState(false);
  const [moves, setMoves] = useState<Map<string, string>>(new Map());

  // Apply only *active* moves — ones the server hasn't caught up to yet. This
  // makes live mode self-cleaning after router.refresh (the move equals server
  // state, so it drops out) with no setState-in-effect.
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

  const [overlayType, setOverlayType] = useState<OverlayType>("none");
  const [showFindings, setShowFindings] = useState(false);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"delivery" | "formal">("delivery");

  const unitsById = useMemo(() => indexById(units), [units]);
  const peopleById = useMemo(() => indexById(people), [people]);
  const childByParent = useMemo(() => childUnitsByParent(units), [units]);
  const asgByUnit = useMemo(() => assignmentsByUnit(effAssignments), [effAssignments]);
  const overAlloc = useMemo(() => overAllocatedPersonIds(effAssignments), [effAssignments]);
  const allocByPerson = useMemo(() => allocationByPerson(effAssignments), [effAssignments]);
  const roots = useMemo(() => rootUnits(units), [units]);

  const effSnapshot = useMemo(
    () => ({ people, units, assignments: effAssignments }),
    [people, units, effAssignments],
  );
  const rollupMap = useMemo(() => computeRollup(effSnapshot), [effSnapshot]);
  const gapsMap = useMemo(() => computeGaps(effSnapshot), [effSnapshot]);
  const orgSummary = useMemo(() => computeOrgSummary(effSnapshot), [effSnapshot]);
  const findings = useMemo(() => computeAllFindings(effSnapshot), [effSnapshot]);
  const maxUnitCost = useMemo(() => {
    let max = 1;
    for (const r of rollupMap.values()) if (r.totalCost > max) max = r.totalCost;
    return max;
  }, [rollupMap]);

  const defaultFocusId = useMemo(() => {
    let cur = roots[0];
    if (!cur) return "";
    for (;;) {
      const kids = childByParent.get(cur.id) ?? [];
      if (kids.length === 1 && kids[0].kind === "group") cur = kids[0];
      else break;
    }
    return cur.id;
  }, [roots, childByParent]);

  const [focusId, setFocusId] = useState<string>(defaultFocusId);
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const focusUnit = unitsById.get(focusId) ?? unitsById.get(defaultFocusId) ?? roots[0];

  // --- zoom state ----------------------------------------------------------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [zoomTransform, setZoomTransform] = useState({ x: 0, y: 0, k: 1 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .filter((event: Event) => {
        if (event.type === "wheel") return true;
        if (event.type === "dblclick") return false;
        const te = event as TouchEvent;
        if (te.touches && te.touches.length >= 2) return true;
        const target = event.target as Element;
        if (target.closest("[data-draggable]")) return false;
        if ((event as MouseEvent).button) return false;
        return true;
      })
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        const t = event.transform;
        setZoomTransform({ x: t.x, y: t.y, k: t.k });
      });

    zoomRef.current = zoomBehavior;
    select(svg).call(zoomBehavior);
    select(svg).call(zoomBehavior.transform, zoomIdentity);

    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const toggleFindings = useCallback(() => {
    setShowFindings((v) => {
      if (v) setSelectedFindingId(null);
      return !v;
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (svg && z) select(svg).transition().duration(250).call(z.scaleBy, 1.4);
  }, []);

  const handleZoomOut = useCallback(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (svg && z) select(svg).transition().duration(250).call(z.scaleBy, 1 / 1.4);
  }, []);

  const handleZoomReset = useCallback(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (svg && z) select(svg).transition().duration(300).call(z.transform, zoomIdentity);
  }, []);

  // --- drag state ---------------------------------------------------------
  const gRef = useRef<SVGGElement | null>(null);
  const pendingRef = useRef<{
    startX: number;
    startY: number;
    key: string;
    assignmentId?: string;
    name: string;
    dragged: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<{ name: string; x: number; y: number } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // --- semantic zoom (Google Maps-style level of detail) -------------------
  const DETAIL_START = 2.0;
  const DETAIL_FULL = 3.0;
  const detailOpacity = Math.max(0, Math.min(1,
    (zoomTransform.k - DETAIL_START) / (DETAIL_FULL - DETAIL_START),
  ));

  const { nodes, links } = useMemo(() => {
    if (!focusUnit) return { nodes: [], links: [] as PointLink[] };

    const memberData = (unitId: string): NodeDatum[] =>
      (asgByUnit.get(unitId) ?? []).map((a) => {
        const person = a.personId ? peopleById.get(a.personId) ?? null : null;
        return {
          key: a.id,
          kind: "member",
          name: a.isOpenRole ? "Open role" : person?.name ?? "Unknown",
          assignment: a,
          person,
          isOpenRole: a.isOpenRole,
          overAllocated: !!person && overAlloc.has(person.id),
        };
      });

    const unitDatum = (u: OrgUnit, isCenter = false): NodeDatum => {
      const kids = childByParent.get(u.id) ?? [];
      return {
        key: u.id,
        kind: "unit",
        name: u.name,
        unit: u,
        childUnitCount: kids.length,
        memberCount: (asgByUnit.get(u.id) ?? []).length,
        isCenter,
      };
    };

    const childrenAccessor = (d: NodeDatum): NodeDatum[] | null => {
      if (d.kind === "member" || !d.unit) return null;
      if (d.unit.id !== focusUnit.id) return null;
      const kids = childByParent.get(d.unit.id) ?? [];
      return kids.length ? kids.map((k) => unitDatum(k)) : memberData(d.unit.id);
    };

    const h = hierarchy<NodeDatum>(unitDatum(focusUnit, true), childrenAccessor);
    const layout = tree<NodeDatum>()
      .size([2 * Math.PI, h.height === 0 ? 1 : INNER_RADIUS])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth));
    const root = layout(h);

    const link = linkRadial<unknown, HierarchyPointNode<NodeDatum>>()
      .angle((d) => d.x)
      .radius((d) => d.y);
    const pointLinks: PointLink[] = root.links().map((l) => ({
      path: link({ source: l.source, target: l.target }) ?? "",
      key: `${l.source.data.key}->${l.target.data.key}`,
    }));
    return { nodes: root.descendants(), links: pointLinks };
  }, [focusUnit, childByParent, asgByUnit, peopleById, overAlloc]);

  const selectedFinding = useMemo(
    () => findings.find((f) => f.id === selectedFindingId) ?? null,
    [findings, selectedFindingId],
  );

  const unitNodePositions = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const n of nodes) {
      if (n.data.kind === "unit" && n.data.unit) {
        m.set(n.data.unit.id, pointRadial(n.x, n.y));
      }
    }
    return m;
  }, [nodes]);

  // Formal reporting tree — person-nodes connected by managerId instead of
  // team membership. Computed lazily; empty when viewMode = "delivery".
  const { formalNodes, formalLinks } = useMemo(() => {
    if (viewMode !== "formal" || people.length === 0) {
      return { formalNodes: [] as typeof nodes, formalLinks: [] as PointLink[] };
    }
    const personIds = new Set(people.map((p) => p.id));
    const childrenByManager = new Map<string, Person[]>();
    for (const person of people) {
      const key = person.managerId && personIds.has(person.managerId) ? person.managerId : "__root__";
      if (!childrenByManager.has(key)) childrenByManager.set(key, []);
      childrenByManager.get(key)!.push(person);
    }
    const roots = childrenByManager.get("__root__") ?? people;
    const root = [...roots].sort(
      (a, b) => (childrenByManager.get(b.id)?.length ?? 0) - (childrenByManager.get(a.id)?.length ?? 0),
    )[0];
    if (!root) return { formalNodes: [], formalLinks: [] };

    const toDatum = (person: Person, isCenter = false): NodeDatum => ({
      key: person.id,
      kind: "member",
      name: person.name,
      person,
      isCenter,
    });
    const childrenAcc = (d: NodeDatum): NodeDatum[] | null => {
      if (!d.person) return null;
      const kids = childrenByManager.get(d.person.id) ?? [];
      return kids.length > 0 ? kids.map((k) => toDatum(k)) : null;
    };
    const h = hierarchy<NodeDatum>(toDatum(root, true), childrenAcc);
    const layout = tree<NodeDatum>()
      .size([2 * Math.PI, h.height === 0 ? 1 : INNER_RADIUS])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth));
    const r = layout(h);
    const link = linkRadial<unknown, HierarchyPointNode<NodeDatum>>()
      .angle((d) => d.x)
      .radius((d) => d.y);
    return {
      formalNodes: r.descendants(),
      formalLinks: r.links().map((l) => ({
        path: link({ source: l.source, target: l.target }) ?? "",
        key: `${l.source.data.key}->${l.target.data.key}`,
      })),
    };
  }, [viewMode, people]);

  // Which team is the viewport zooming toward?
  const zoomFocusTeamId = useMemo(() => {
    if (detailOpacity <= 0) return null;
    const vcx = (WIDTH / 2 - zoomTransform.x) / zoomTransform.k - CX;
    const vcy = (HEIGHT / 2 - zoomTransform.y) / zoomTransform.k - CY;
    let bestDist = Infinity;
    let bestId: string | null = null;
    for (const n of nodes) {
      if (n.data.kind !== "unit" || n.data.isCenter) continue;
      const [nx, ny] = pointRadial(n.x, n.y);
      const d = Math.hypot(nx - vcx, ny - vcy);
      if (d < bestDist) { bestDist = d; bestId = n.data.key; }
    }
    return bestId;
  }, [detailOpacity, nodes, zoomTransform]);

  // Members of the focused team, arranged in a ring around its node
  const detailMembers = useMemo(() => {
    if (!zoomFocusTeamId) return [];
    const teamNode = nodes.find((n) => n.data.key === zoomFocusTeamId);
    if (!teamNode) return [];
    const members = asgByUnit.get(zoomFocusTeamId) ?? [];
    if (members.length === 0) return [];

    const [cx, cy] = pointRadial(teamNode.x, teamNode.y);
    const ringR = 90;

    return members.map((a, i) => {
      const angle = (2 * Math.PI * i) / members.length - Math.PI / 2;
      const person = a.personId ? peopleById.get(a.personId) ?? null : null;
      return {
        key: a.id,
        x: cx + Math.cos(angle) * ringR,
        y: cy + Math.sin(angle) * ringR,
        cx,
        cy,
        name: a.isOpenRole ? "Open role" : person?.name ?? "Unknown",
        isOpenRole: a.isOpenRole,
        person,
        assignment: a,
        overAllocated: !!person && overAlloc.has(person.id),
      };
    });
  }, [zoomFocusTeamId, nodes, asgByUnit, peopleById, overAlloc]);

  // Whether the zoom-focused node is a group (has sub-units rather than members)
  const zoomFocusIsGroup = useMemo(() => {
    if (!zoomFocusTeamId) return false;
    return (childByParent.get(zoomFocusTeamId) ?? []).length > 0;
  }, [zoomFocusTeamId, childByParent]);

  // Detail sub-teams shown in a ring when zoomed into a group node
  const detailSubTeams = useMemo(() => {
    if (!zoomFocusTeamId || !zoomFocusIsGroup) return [];
    const teamNode = nodes.find((n) => n.data.key === zoomFocusTeamId);
    if (!teamNode) return [];
    const kids = childByParent.get(zoomFocusTeamId) ?? [];
    if (kids.length === 0) return [];
    const [cx, cy] = pointRadial(teamNode.x, teamNode.y);
    const ringR = 90;
    return kids.map((u, i) => {
      const angle = (2 * Math.PI * i) / kids.length - Math.PI / 2;
      return {
        key: u.id,
        x: cx + Math.cos(angle) * ringR,
        y: cy + Math.sin(angle) * ringR,
        cx, cy,
        unit: u,
        memberCount: (asgByUnit.get(u.id) ?? []).length,
      };
    });
  }, [zoomFocusTeamId, zoomFocusIsGroup, nodes, childByParent, asgByUnit]);

  // Second-level semantic zoom: members bloom around the nearest detail sub-team
  const DETAIL2_START = 3.0;
  const DETAIL2_FULL = 4.0;
  const detail2Opacity = Math.max(0, Math.min(1,
    (zoomTransform.k - DETAIL2_START) / (DETAIL2_FULL - DETAIL2_START),
  ));

  const zoomFocusSubTeamId = useMemo(() => {
    if (detailSubTeams.length === 0 || detail2Opacity <= 0) return null;
    const vcx = (WIDTH / 2 - zoomTransform.x) / zoomTransform.k - CX;
    const vcy = (HEIGHT / 2 - zoomTransform.y) / zoomTransform.k - CY;
    let bestDist = Infinity;
    let bestId: string | null = null;
    for (const t of detailSubTeams) {
      const d = Math.hypot(t.x - vcx, t.y - vcy);
      if (d < bestDist) { bestDist = d; bestId = t.key; }
    }
    return bestId;
  }, [detailSubTeams, detail2Opacity, zoomTransform]);

  const detail2Members = useMemo(() => {
    if (!zoomFocusSubTeamId) return [];
    const subTeam = detailSubTeams.find((t) => t.key === zoomFocusSubTeamId);
    if (!subTeam) return [];
    const members = asgByUnit.get(zoomFocusSubTeamId) ?? [];
    if (members.length === 0) return [];
    const ringR = 55;
    return members.map((a, i) => {
      const angle = (2 * Math.PI * i) / members.length - Math.PI / 2;
      const person = a.personId ? peopleById.get(a.personId) ?? null : null;
      return {
        key: a.id,
        x: subTeam.x + Math.cos(angle) * ringR,
        y: subTeam.y + Math.sin(angle) * ringR,
        cx: subTeam.x,
        cy: subTeam.y,
        name: a.isOpenRole ? "Open role" : person?.name ?? "Unknown",
        isOpenRole: a.isOpenRole,
        person,
        assignment: a,
        overAllocated: !!person && overAlloc.has(person.id),
      };
    });
  }, [zoomFocusSubTeamId, detailSubTeams, asgByUnit, peopleById, overAlloc]);

  const context = useMemo(() => {
    if (!focusUnit) return [] as ContextNode[];
    const parent = focusUnit.parentId ? unitsById.get(focusUnit.parentId) ?? null : null;
    const siblings = parent
      ? (childByParent.get(parent.id) ?? []).filter((u) => u.id !== focusUnit.id)
      : [];
    const list: { unit: OrgUnit; role: "parent" | "sibling" }[] = [];
    if (parent) list.push({ unit: parent, role: "parent" });
    for (const s of siblings) list.push({ unit: s, role: "sibling" });
    const n = list.length;
    return list.map((item, i) => {
      const angle = n > 0 ? (i / n) * 2 * Math.PI : 0;
      const [x, y] = pointRadial(angle, OUTER_RADIUS);
      return { ...item, x, y };
    });
  }, [focusUnit, unitsById, childByParent]);

  const displayNodes = viewMode === "formal" ? formalNodes : nodes;
  const displayLinks = viewMode === "formal" ? formalLinks : links;

  const breadcrumb = focusUnit ? pathToRoot(focusUnit.id, unitsById) : [];
  const selectedNode = displayNodes.find((n) => n.data.key === selectedPersonKey) ?? null;
  const selectedDetailMember = !selectedNode && selectedPersonKey
    ? detailMembers.find((m) => m.key === selectedPersonKey)
      ?? detail2Members.find((m) => m.key === selectedPersonKey)
      ?? null
    : null;
  const selectedDatum: NodeDatum | null = selectedNode
    ? selectedNode.data
    : selectedDetailMember
      ? {
          key: selectedDetailMember.key,
          kind: "member",
          name: selectedDetailMember.name,
          assignment: selectedDetailMember.assignment,
          person: selectedDetailMember.person,
          isOpenRole: selectedDetailMember.isOpenRole,
          overAllocated: selectedDetailMember.overAllocated,
        }
      : null;
  const isZoomedIn = zoomTransform.k > 1.05 || Math.abs(zoomTransform.x) > 5 || Math.abs(zoomTransform.y) > 5;
  const hasParent = !!(focusUnit?.parentId && unitsById.has(focusUnit.parentId));
  const canZoomOut = isZoomedIn || hasParent;
  const pendingCount = activeMoveCount;

  function focusOn(id: string) {
    setSelectedPersonKey(null);
    setFocusId(id);
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (svg && z) select(svg).transition().duration(300).call(z.transform, zoomIdentity);
  }

  function performMove(assignmentId: string, targetUnitId: string) {
    const current = effAssignments.find((a) => a.id === assignmentId);
    if (!current || current.orgUnitId === targetUnitId) return;
    setMoves((prev) => {
      const next = new Map(prev);
      next.set(assignmentId, targetUnitId);
      return next;
    });
    if (!scenario) {
      startTransition(async () => {
        await moveAssignment(assignmentId, targetUnitId);
        router.refresh();
      });
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
  function toggleScenario() {
    if (scenario) {
      setMoves(new Map());
      setScenario(false);
    } else {
      setScenario(true);
    }
  }

  // --- pointer / drag handlers -------------------------------------------
  function clientToLocal(clientX: number, clientY: number): [number, number] {
    const ctm = gRef.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [pt.x, pt.y];
  }

  function beginMemberPointer(e: React.PointerEvent, datum: NodeDatum) {
    pendingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      key: datum.key,
      assignmentId: datum.assignment?.id,
      name: datum.name,
      dragged: false,
    };
  }

  function onSvgPointerMove(e: React.PointerEvent) {
    const p = pendingRef.current;
    if (!p) return;
    const dx = e.clientX - p.startX;
    const dy = e.clientY - p.startY;
    if (!p.dragged && Math.hypot(dx, dy) > 5) p.dragged = true;
    if (!p.dragged) return;
    const [lx, ly] = clientToLocal(e.clientX, e.clientY);
    setDrag({ name: p.name, x: lx, y: ly });
    let nearest: string | null = null;
    let best = DROP_RADIUS;
    for (const c of context) {
      const d = Math.hypot(c.x - lx, c.y - ly);
      if (d < best) {
        best = d;
        nearest = c.unit.id;
      }
    }
    for (const n of nodes) {
      if (n.data.kind !== "unit" || n.data.isCenter) continue;
      const [nx, ny] = pointRadial(n.x, n.y);
      const d = Math.hypot(nx - lx, ny - ly);
      if (d < best) {
        best = d;
        nearest = n.data.key;
      }
    }
    for (const t of detailSubTeams) {
      const d = Math.hypot(t.x - lx, t.y - ly);
      if (d < best) {
        best = d;
        nearest = t.key;
      }
    }
    setHoverId(nearest);
  }

  function onSvgPointerUp() {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    if (p.dragged) {
      if (hoverId && p.assignmentId) performMove(p.assignmentId, hoverId);
    } else {
      setSelectedPersonKey(p.key);
    }
    setDrag(null);
    setHoverId(null);
  }

  return (
    <div className="flex h-full flex-col">
      <SummaryBar
        summary={orgSummary}
        overlayType={overlayType}
        onOverlay={setOverlayType}
        findingsCount={findings.length}
        showFindings={showFindings}
        onToggleFindings={toggleFindings}
        viewMode={viewMode}
        onViewMode={setViewMode}
      />
      <div className="flex min-h-0 flex-1">
      <div className="relative flex-1" style={drag ? { userSelect: "none" } : undefined}>
        {/* Breadcrumb — delivery mode only */}
        {viewMode === "delivery" && (
          <div className="absolute left-4 top-3 z-10 flex items-center gap-1 text-sm text-slate-400">
            {breadcrumb.map((u, i) => (
              <span key={u.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-600">/</span>}
                <button
                  onClick={() => focusOn(u.id)}
                  className={u.id === focusId ? "accent-text" : "hover:text-slate-100"}
                >
                  {u.name}
                </button>
              </span>
            ))}
          </div>
        )}
        {viewMode === "formal" && (
          <div className="absolute left-4 top-3 z-10 text-sm text-slate-500">
            Formal reporting structure
          </div>
        )}

        {/* Scenario controls + mobile panel toggle */}
        <div className="absolute right-4 top-3 z-10 flex items-center gap-2 text-sm">
          {scenario && pendingCount > 0 && (
            <>
              <span className="rounded bg-sky-500/15 px-2 py-1 text-xs text-sky-300">
                {pendingCount} pending move{pendingCount === 1 ? "" : "s"}
              </span>
              <button
                onClick={applyScenario}
                disabled={isPending}
                className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
              >
                {isPending ? "Applying…" : "Apply"}
              </button>
              <button
                onClick={discardScenario}
                className="rounded-md border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800"
              >
                Discard
              </button>
            </>
          )}
          <button
            onClick={toggleScenario}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              scenario
                ? "bg-sky-500 text-white hover:bg-sky-400"
                : "border border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {scenario ? "Scenario: on" : "Scenario mode"}
          </button>
          <button
            onClick={() => setShowPanel((v) => !v)}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 lg:hidden"
            aria-label="Toggle detail panel"
          >
            {showPanel ? "Close" : "Details"}
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-full w-full"
          style={{ maxHeight: "calc(100vh - 57px)", touchAction: "none" }}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerLeave={onSvgPointerUp}
        >
          <defs>
            <radialGradient id="sphere" cx="35%" cy="30%" r="75%">
              <stop offset="0%"   style={{ stopColor: "var(--sphere-0)" }} />
              <stop offset="45%"  style={{ stopColor: "var(--sphere-1)" }} />
              <stop offset="100%" style={{ stopColor: "var(--sphere-2)" }} />
            </radialGradient>
            <radialGradient id="sphereTeam" cx="35%" cy="30%" r="75%">
              <stop offset="0%"   style={{ stopColor: "var(--sphere-team-0)" }} />
              <stop offset="50%"  style={{ stopColor: "var(--sphere-team-1)" }} />
              <stop offset="100%" style={{ stopColor: "var(--sphere-team-2)" }} />
            </radialGradient>
            <radialGradient id="member" cx="35%" cy="30%" r="80%">
              <stop offset="0%"   style={{ stopColor: "var(--sphere-member-0)" }} />
              <stop offset="100%" style={{ stopColor: "var(--sphere-member-1)" }} />
            </radialGradient>
            <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="heat" cx="35%" cy="30%" r="75%">
              <stop offset="0%"   stopColor="#fdba74" />
              <stop offset="100%" stopColor="#dc2626" />
            </radialGradient>
          </defs>

          <g transform={`translate(${zoomTransform.x},${zoomTransform.y}) scale(${zoomTransform.k})`}>
          <g ref={gRef} transform={`translate(${CX},${CY})`}>
            {/* Context satellites — delivery mode only */}
            {viewMode === "delivery" && (
              <>
                <g fill="none">
                  {context.map((c) => (
                    <line
                      key={`cl-${c.unit.id}`}
                      x1={0} y1={0} x2={c.x} y2={c.y}
                      stroke="#64748b"
                      strokeOpacity={0.12}
                      strokeWidth={1.5}
                      strokeDasharray="2 5"
                    />
                  ))}
                </g>
                {context.map((c) => (
                  <ContextSatellite
                    key={c.unit.id}
                    node={c}
                    highlight={hoverId === c.unit.id}
                    dropMode={!!drag}
                    onClick={() => focusOn(c.unit.id)}
                  />
                ))}
              </>
            )}

            <g fill="none">
              {displayLinks.map((l) => (
                <path
                  key={l.key}
                  d={l.path}
                  stroke="url(#sphere)"
                  strokeOpacity={0.25}
                  strokeWidth={6}
                  strokeLinecap="round"
                />
              ))}
            </g>

            {displayNodes.map((n) => {
              const [x, y] = pointRadial(n.x, n.y);
              const outwardDeg = (n.x * 180) / Math.PI - 90;
              const isDragged = drag && pendingRef.current?.key === n.data.key;
              const ov = getOverlayProps(
                n.data, overlayType, overAlloc, allocByPerson, gapsMap, rollupMap, maxUnitCost,
              );
              const effectiveOverlay: NodeOverlay = showFindings && selectedFinding
                ? {
                    dimmed: n.data.kind === "unit" && n.data.unit
                      ? !selectedFinding.involvedUnitIds.includes(n.data.unit.id)
                      : n.data.kind === "member" && n.data.person
                      ? !selectedFinding.involvedPersonIds.includes(n.data.person.id)
                      : true,
                    badge: null,
                    heatPct: 0,
                    roiLabel: null,
                  }
                : ov;
              return (
                <RadarNode
                  key={n.data.key}
                  datum={n.data}
                  x={x}
                  y={y}
                  outwardDeg={outwardDeg}
                  canZoomOut={viewMode === "delivery" && n.data.isCenter ? canZoomOut : false}
                  selected={n.data.key === selectedPersonKey}
                  ghosted={!!isDragged}
                  overlay={effectiveOverlay}
                  membersRevealed={viewMode === "delivery" && detailOpacity > 0 && n.data.key === zoomFocusTeamId}
                  dropHighlight={viewMode === "delivery" && !!drag && hoverId === n.data.key}
                  onClick={
                    viewMode === "formal"
                      ? n.data.person
                        ? () => { setSelectedPersonKey(n.data.key); setShowPanel(true); }
                        : undefined
                      : n.data.kind === "unit"
                      ? () => onUnitClick(n.data)
                      : undefined
                  }
                  onPointerDown={
                    viewMode === "delivery" && n.data.kind === "member"
                      ? (e) => beginMemberPointer(e, n.data)
                      : undefined
                  }
                />
              );
            })}

            {/* ── Findings: ambient presence dots (delivery mode only) ── */}
            {viewMode === "delivery" && showFindings && !selectedFinding && nodes.map((n) => {
              if (n.data.kind !== "unit" || !n.data.unit || n.data.isCenter) return null;
              const unitFindings = findings.filter((f) =>
                f.involvedUnitIds.includes(n.data.unit!.id),
              );
              if (unitFindings.length === 0) return null;
              const pos = unitNodePositions.get(n.data.unit.id);
              if (!pos) return null;
              const spread = 14;
              const total = (unitFindings.length - 1) * spread;
              return (
                <g key={`amb-${n.data.key}`}>
                  {unitFindings.map((f, i) => (
                    <circle
                      key={`dot-${f.id}`}
                      cx={pos[0] - total / 2 + i * spread}
                      cy={pos[1] - 34}
                      r={4.5}
                      fill={f.color}
                      stroke="#070a12"
                      strokeWidth={1.5}
                      style={{ animation: "findingAmbientPulse 3s ease-in-out infinite" }}
                    />
                  ))}
                </g>
              );
            })}

            {/* ── Findings: spotlight on selected finding (delivery mode only) ── */}
            {viewMode === "delivery" && showFindings && selectedFinding && (() => {
              const color = selectedFinding.color;
              if (selectedFinding.spotlightType === "hub") {
                return (
                  <>
                    {selectedFinding.involvedUnitIds.map((uid) => {
                      const pos = unitNodePositions.get(uid);
                      if (!pos) return null;
                      return (
                        <line
                          key={`hub-${uid}`}
                          x1={0} y1={0} x2={pos[0]} y2={pos[1]}
                          stroke={color} strokeWidth={3} strokeOpacity={0.85}
                          strokeDasharray="6 6"
                          style={{ animation: "findingDash 1s linear infinite" }}
                        />
                      );
                    })}
                    <circle cx={0} cy={0} r={18} fill={color} opacity={0.9} />
                    <circle
                      cx={0} cy={0} r={18} fill="none" stroke={color} strokeWidth={2}
                      style={{ animation: "findingPulseRing 1.6s ease-out infinite", transformOrigin: "0px 0px" }}
                    />
                  </>
                );
              }
              if (selectedFinding.spotlightType === "ribbon" && selectedFinding.involvedUnitIds.length === 2) {
                const posA = unitNodePositions.get(selectedFinding.involvedUnitIds[0]);
                const posB = unitNodePositions.get(selectedFinding.involvedUnitIds[1]);
                if (!posA || !posB) return null;
                return (
                  <path
                    d={`M ${posA[0]} ${posA[1]} Q 0 0 ${posB[0]} ${posB[1]}`}
                    fill="none"
                    stroke={color} strokeWidth={5} strokeOpacity={0.85}
                    strokeDasharray="6 6"
                    style={{ animation: "findingDash 1s linear infinite" }}
                  />
                );
              }
              return null;
            })()}

            {/* Pulse rings on involved units when a finding is focused — delivery only */}
            {viewMode === "delivery" && showFindings && selectedFinding &&
              selectedFinding.involvedUnitIds.map((uid) => {
                const pos = unitNodePositions.get(uid);
                if (!pos) return null;
                return (
                  <circle
                    key={`ring-${uid}`}
                    cx={pos[0]} cy={pos[1]} r={22} fill="none"
                    stroke={selectedFinding.color} strokeWidth={2.5}
                    style={{
                      animation: "findingPulseRing 1.8s ease-out infinite",
                      transformOrigin: `${pos[0]}px ${pos[1]}px`,
                    }}
                  />
                );
              })
            }

            {/* Semantic zoom: members bloom around the focused team — delivery only */}
            {viewMode === "delivery" && detailOpacity > 0 && detailMembers.length > 0 && (
              <g opacity={detailOpacity} style={{ transition: "opacity 150ms" }}>
                {detailMembers.map((m) => (
                  <line
                    key={`dl-${m.key}`}
                    x1={m.cx}
                    y1={m.cy}
                    x2={m.x}
                    y2={m.y}
                    stroke="#94a3b8"
                    strokeOpacity={0.2}
                    strokeWidth={1.5}
                  />
                ))}
                {detailMembers.map((m) => {
                  const labelBelow = m.y < m.cy;
                  return (
                    <g
                      key={`dm-${m.key}`}
                      transform={`translate(${m.x},${m.y})`}
                      style={{ cursor: "pointer" }}
                      data-draggable=""
                      onClick={() => setSelectedPersonKey(m.key)}
                      onPointerDown={(e) =>
                        beginMemberPointer(e, {
                          key: m.key,
                          kind: "member",
                          name: m.name,
                          assignment: m.assignment,
                          person: m.person,
                          isOpenRole: m.isOpenRole,
                          overAllocated: m.overAllocated,
                        })
                      }
                    >
                      {m.isOpenRole ? (
                        <circle r={7} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" />
                      ) : (
                        <circle r={8} fill="url(#member)" />
                      )}
                      {m.overAllocated && (
                        <circle r={12} fill="none" stroke="#fbbf24" strokeWidth={2} />
                      )}
                      <text
                        y={labelBelow ? 20 : -12}
                        textAnchor="middle"
                        className="fill-slate-200"
                        style={{ fontSize: 10 }}
                      >
                        {m.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* Semantic zoom: sub-teams bloom around a focused group — delivery only */}
            {viewMode === "delivery" && detailOpacity > 0 && detailSubTeams.length > 0 && (
              <g opacity={detailOpacity} style={{ transition: "opacity 150ms" }}>
                {detailSubTeams.map((t) => (
                  <line
                    key={`stl-${t.key}`}
                    x1={t.cx}
                    y1={t.cy}
                    x2={t.x}
                    y2={t.y}
                    stroke="#94a3b8"
                    strokeOpacity={0.2}
                    strokeWidth={1.5}
                  />
                ))}
                {detailSubTeams.map((t) => {
                  const isDropTarget = !!drag && hoverId === t.key;
                  return (
                    <g
                      key={`st-${t.key}`}
                      transform={`translate(${t.x},${t.y})`}
                      style={{ cursor: "pointer" }}
                      onClick={() => focusOn(t.key)}
                    >
                      {isDropTarget && <circle r={DROP_RADIUS} fill="#34d399" opacity={0.12} />}
                      <circle
                        r={14}
                        fill="url(#sphereTeam)"
                        filter="url(#glow)"
                        stroke={isDropTarget ? "#34d399" : undefined}
                        strokeWidth={isDropTarget ? 2 : 0}
                      />
                      <text
                        y={24}
                        textAnchor="middle"
                        className="fill-slate-200"
                        style={{ fontSize: 11, fontWeight: 600 }}
                      >
                        {t.unit.name}
                      </text>
                      {t.memberCount > 0 && !(detail2Opacity > 0 && t.key === zoomFocusSubTeamId) && (
                        <text y={38} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>
                          {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}

            {/* Second-level semantic zoom: members bloom around the focused sub-team */}
            {detail2Opacity > 0 && detail2Members.length > 0 && (
              <g opacity={detail2Opacity} style={{ transition: "opacity 150ms" }}>
                {detail2Members.map((m) => (
                  <line
                    key={`d2l-${m.key}`}
                    x1={m.cx}
                    y1={m.cy}
                    x2={m.x}
                    y2={m.y}
                    stroke="#94a3b8"
                    strokeOpacity={0.2}
                    strokeWidth={1.5}
                  />
                ))}
                {detail2Members.map((m) => {
                  const labelBelow = m.y < m.cy;
                  return (
                    <g
                      key={`d2m-${m.key}`}
                      transform={`translate(${m.x},${m.y})`}
                      style={{ cursor: "pointer" }}
                      data-draggable=""
                      onClick={() => setSelectedPersonKey(m.key)}
                      onPointerDown={(e) =>
                        beginMemberPointer(e, {
                          key: m.key,
                          kind: "member",
                          name: m.name,
                          assignment: m.assignment,
                          person: m.person,
                          isOpenRole: m.isOpenRole,
                          overAllocated: m.overAllocated,
                        })
                      }
                    >
                      {m.isOpenRole ? (
                        <circle r={7} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" />
                      ) : (
                        <circle r={8} fill="url(#member)" />
                      )}
                      {m.overAllocated && (
                        <circle r={12} fill="none" stroke="#fbbf24" strokeWidth={2} />
                      )}
                      <text
                        y={labelBelow ? 20 : -12}
                        textAnchor="middle"
                        className="fill-slate-200"
                        style={{ fontSize: 10 }}
                      >
                        {m.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* Drag ghost */}
            {drag && (
              <g transform={`translate(${drag.x},${drag.y})`} style={{ pointerEvents: "none" }}>
                <circle r={9} fill="url(#member)" opacity={0.9} />
                <text y={-14} textAnchor="middle" className="fill-slate-100" style={{ fontSize: 11 }}>
                  {drag.name}
                </text>
              </g>
            )}
          </g>
          </g>
        </svg>

        {/* Zoom controls */}
        <div className="absolute bottom-14 right-4 z-10 flex flex-col gap-1">
          <button
            onClick={handleZoomIn}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-lg text-slate-300 shadow-md backdrop-blur hover:bg-slate-800 hover:text-white"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            onClick={handleZoomOut}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-lg text-slate-300 shadow-md backdrop-blur hover:bg-slate-800 hover:text-white"
            aria-label="Zoom out"
          >
            −
          </button>
          {(Math.abs(zoomTransform.k - 1) > 0.01 || Math.abs(zoomTransform.x) > 1 || Math.abs(zoomTransform.y) > 1) && (
            <button
              onClick={handleZoomReset}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/90 text-[10px] text-slate-400 shadow-md backdrop-blur hover:bg-slate-800 hover:text-white"
              aria-label="Reset zoom"
            >
              1:1
            </button>
          )}
        </div>

        {/* Hint */}
        <div className="absolute bottom-3 left-4 text-xs text-slate-600">
          Drag a member onto a faint team to reassign them
          {scenario ? " (changes held until you Apply)." : "."}
        </div>
      </div>

      {/* On desktop: inline aside. On mobile: slide-over overlay when showPanel=true */}
      <aside
        className={`
          w-80 shrink-0 border-l border-slate-800 overflow-y-auto
          lg:relative lg:flex lg:flex-col
          ${showPanel || showFindings
            ? "absolute inset-y-0 right-0 z-20 flex flex-col bg-slate-950"
            : "hidden lg:flex"}
        `}
      >
        {showFindings ? (
          <FindingsRail
            findings={findings}
            selectedId={selectedFindingId}
            onSelect={(id) =>
              setSelectedFindingId((cur) => (cur === id ? null : id))
            }
          />
        ) : selectedDatum ? (
          <PersonPanel
            datum={selectedDatum}
            teamCount={
              selectedDatum.person
                ? allocByPerson.get(selectedDatum.person.id)?.teamCount ?? 1
                : 0
            }
          />
        ) : focusUnit ? (
          <UnitPanel
            unit={focusUnit}
            assignments={asgByUnit.get(focusUnit.id) ?? []}
            lead={focusUnit.leadPersonId ? peopleById.get(focusUnit.leadPersonId) ?? null : null}
            canZoomOut={canZoomOut}
            hasChildUnits={(childByParent.get(focusUnit.id) ?? []).length > 0}
          />
        ) : null}
      </aside>
      </div>
    </div>
  );

  function onUnitClick(d: NodeDatum) {
    if (!d.unit) return;
    if (d.unit.id === focusUnit.id) {
      // Phase 1: if visually zoomed in, reset the camera first (stay on same focus)
      if (isZoomedIn) {
        const svg = svgRef.current;
        const z = zoomRef.current;
        if (svg && z) select(svg).transition().duration(300).call(z.transform, zoomIdentity);
        return;
      }
      // Phase 2: at default zoom, navigate up to parent
      if (hasParent) focusOn(focusUnit.parentId!);
      return;
    }
    focusOn(d.unit.id);
  }
}

type PointLink = { path: string; key: string };
type ContextNode = { unit: OrgUnit; role: "parent" | "sibling"; x: number; y: number };

type NodeOverlay = {
  dimmed: boolean;
  badge: string | null;
  heatPct: number;   // 0–1 for cost heat fill
  roiLabel: string | null;
};

function getOverlayProps(
  datum: NodeDatum,
  overlayType: OverlayType,
  overAlloc: Set<string>,
  allocByPerson: Map<string, { teamCount: number; totalPct: number }>,
  gapsMap: Map<string, UnitGap>,
  rollupMap: Map<string, UnitRollup>,
  maxCost: number,
): NodeOverlay {
  const none: NodeOverlay = { dimmed: false, badge: null, heatPct: 0, roiLabel: null };
  if (overlayType === "none") return none;

  if (overlayType === "allocation") {
    if (datum.kind === "member" && !datum.isOpenRole && datum.person) {
      const isOver = overAlloc.has(datum.person.id);
      const alloc = allocByPerson.get(datum.person.id);
      return {
        dimmed: !isOver,
        badge: isOver && alloc ? `${alloc.teamCount} teams` : null,
        heatPct: 0,
        roiLabel: null,
      };
    }
    return { ...none, dimmed: true };
  }

  if (overlayType === "gaps") {
    if (datum.kind === "unit" && datum.unit) {
      const gap = gapsMap.get(datum.unit.id);
      const hasGap = !!gap && gap.gap > 0;
      return {
        dimmed: !hasGap,
        badge: hasGap ? `${gap.gap} open` : null,
        heatPct: 0,
        roiLabel: null,
      };
    }
    return { ...none, dimmed: true };
  }

  if (overlayType === "cost") {
    if (datum.kind === "unit" && datum.unit) {
      const r = rollupMap.get(datum.unit.id);
      const cost = r?.totalCost ?? 0;
      const heatPct = maxCost > 0 ? cost / maxCost : 0;
      const isGroup = datum.unit.kind === "group";
      const roi = r?.totalRoi ?? 0;
      return {
        dimmed: false,
        badge: cost > 0 ? `$${Math.round(cost / 1000)}k/mo` : null,
        heatPct,
        roiLabel: isGroup && roi > 0 ? `ROI $${(roi / 1_000_000).toFixed(1)}M` : null,
      };
    }
    return none;
  }

  return none;
}

function ContextSatellite({
  node,
  highlight,
  dropMode,
  onClick,
}: {
  node: ContextNode;
  highlight: boolean;
  dropMode: boolean;
  onClick: () => void;
}) {
  const isGroup = node.unit.kind === "group";
  const isParent = node.role === "parent";
  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      onClick={onClick}
      style={{ cursor: "pointer", opacity: highlight ? 1 : dropMode ? 0.7 : 0.45 }}
    >
      {highlight && <circle r={DROP_RADIUS} fill="#34d399" opacity={0.12} />}
      <circle
        r={isParent ? 13 : 11}
        fill={isGroup ? "url(#sphere)" : "url(#sphereTeam)"}
        stroke={highlight ? "#34d399" : undefined}
        strokeWidth={highlight ? 2 : 0}
      />
      <text
        y={isParent ? -20 : 22}
        textAnchor="middle"
        className="fill-slate-300"
        style={{ fontSize: 11, fontWeight: isParent ? 600 : 400 }}
      >
        {isParent ? `↑ ${node.unit.name}` : node.unit.name}
      </text>
    </g>
  );
}

function RadarNode({
  datum,
  x,
  y,
  outwardDeg,
  canZoomOut,
  selected,
  ghosted,
  overlay,
  membersRevealed,
  dropHighlight,
  onClick,
  onPointerDown,
}: {
  datum: NodeDatum;
  x: number;
  y: number;
  outwardDeg: number;
  canZoomOut: boolean;
  selected: boolean;
  ghosted: boolean;
  overlay: NodeOverlay;
  membersRevealed?: boolean;
  dropHighlight?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const isUnit = datum.kind === "unit";
  const isGroup = datum.unit?.kind === "group";
  const isCenter = !!datum.isCenter;
  const sphereR = isCenter ? 24 : isUnit ? 16 : datum.isOpenRole ? 7 : 8;
  const fill = datum.isOpenRole
    ? "none"
    : isUnit
      ? isGroup || isCenter
        ? "url(#sphere)"
        : "url(#sphereTeam)"
      : "url(#member)";

  const baseOpacity = ghosted ? 0.3 : overlay.dimmed ? 0.18 : 1;

  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      data-draggable={onPointerDown ? "" : undefined}
      style={{ cursor: "pointer", opacity: baseOpacity }}
    >
      {isUnit && (
        <g transform={`rotate(${outwardDeg})`} fill="none">
          {[sphereR + 6, sphereR + 12, sphereR + 18].map((r, i) => (
            <path
              key={r}
              d={arcPath(r, -52, 52)}
              style={{ stroke: `var(--arc-${i})` }}
              strokeOpacity={0.8}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          ))}
        </g>
      )}

      {/* Cost heat tint — rendered behind the sphere */}
      {overlay.heatPct > 0 && (
        <circle r={sphereR + 10} fill="url(#heat)" opacity={overlay.heatPct * 0.55} />
      )}

      {datum.isOpenRole ? (
        <circle r={sphereR} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" />
      ) : (
        <circle r={sphereR} fill={fill} filter={isUnit ? "url(#glow)" : undefined} />
      )}

      {datum.overAllocated && <circle r={sphereR + 4} fill="none" stroke="#fbbf24" strokeWidth={2} />}
      {selected && <circle r={sphereR + 6} fill="none" style={{ stroke: "var(--accent-ring)" }} strokeWidth={2} />}
      {dropHighlight && (
        <>
          <circle r={DROP_RADIUS} fill="#34d399" opacity={0.12} />
          <circle r={sphereR + 2} fill="none" stroke="#34d399" strokeWidth={2} />
        </>
      )}

      {/* Gaps overlay: dashed ring on units with open seats */}
      {overlay.badge && !datum.isOpenRole && isUnit && (
        <circle r={sphereR + 5} fill="none" stroke="#f97316" strokeWidth={1.5} strokeDasharray="3 2" />
      )}

      <text
        y={isUnit ? sphereR + 34 : sphereR + 14}
        textAnchor="middle"
        className="fill-slate-200"
        style={{ fontSize: isCenter ? 15 : isUnit ? 13 : 11, fontWeight: isUnit ? 600 : 400 }}
      >
        {datum.name}
      </text>

      {/* Overlay badge label */}
      {overlay.badge && (
        <text
          y={isUnit ? -(sphereR + 8) : -(sphereR + 6)}
          textAnchor="middle"
          style={{ fontSize: 10, fill: isUnit ? "#fb923c" : "#fbbf24", fontWeight: 600 }}
        >
          {overlay.badge}
        </text>
      )}

      {/* ROI label for cost overlay on group nodes */}
      {overlay.roiLabel && (
        <text
          y={isUnit ? sphereR + 48 : sphereR + 26}
          textAnchor="middle"
          style={{ fontSize: 10, fill: "#34d399" }}
        >
          {overlay.roiLabel}
        </text>
      )}

      {isCenter && canZoomOut && (
        <text y={-(sphereR + 12)} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>
          ↑ click to zoom out
        </text>
      )}

      {isUnit && !isCenter && !membersRevealed && datum.childUnitCount === 0 && (datum.memberCount ?? 0) > 0 && (
        <text y={sphereR + 50} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 10 }}>
          {datum.memberCount} member{datum.memberCount === 1 ? "" : "s"} ›
        </text>
      )}
      {isUnit && !isCenter && !membersRevealed && (datum.childUnitCount ?? 0) > 0 && (
        <text y={sphereR + 50} textAnchor="middle" className="fill-indigo-300/70" style={{ fontSize: 10 }}>
          {datum.childUnitCount} team{datum.childUnitCount === 1 ? "" : "s"} ›
        </text>
      )}
    </g>
  );
}

function fmtMoney(v: string | null): string {
  if (!v) return "—";
  return `$${Number(v).toLocaleString()}`;
}

function UnitPanel({
  unit,
  assignments,
  lead,
  canZoomOut,
  hasChildUnits,
}: {
  unit: OrgUnit;
  assignments: Assignment[];
  lead: Person | null;
  canZoomOut: boolean;
  hasChildUnits: boolean;
}) {
  const staffing = unitStaffing(unit, assignments);
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
        {unit.kind === "group" ? "Group" : "Team"}
        {unit.isExternal && ` · ${unit.vendorName ?? "External"}`}
      </div>
      <h2 className="text-lg font-semibold">{unit.name}</h2>
      {lead && (
        <p className="mt-1 text-sm text-slate-400">
          Lead: <span className="text-slate-200">{lead.name}</span>
        </p>
      )}
      <dl className="mt-4 space-y-2 text-sm">
        <Row label="Members" value={`${staffing.filled}`} />
        {staffing.target != null && <Row label="Target" value={`${staffing.target}`} />}
        <Row
          label="Open roles"
          value={staffing.open > 0 ? <span className="text-amber-400">{staffing.open}</span> : "0"}
        />
        <Row label="Expected ROI" value={fmtMoney(unit.expectedRoi)} />
        <Row label="Unit cost / mo" value={fmtMoney(unit.costPerMonth)} />
      </dl>
      <p className="mt-6 text-xs text-slate-500">
        {hasChildUnits ? "Click a team to focus it." : "Click a member for details."}
        {canZoomOut && " Faint nodes around the edge are the parent and sibling teams — click to jump."}
      </p>
    </div>
  );
}

function PersonPanel({ datum, teamCount }: { datum: NodeDatum; teamCount: number }) {
  if (datum.isOpenRole) {
    return (
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-amber-500">Open role</div>
        <h2 className="text-lg font-semibold">{datum.assignment?.roleOnTeam ?? "Open role"}</h2>
        <p className="mt-2 text-sm text-slate-400">
          This seat is unfilled
          {datum.assignment?.allocationPct ? ` (${datum.assignment.allocationPct}% allocation)` : ""}.
        </p>
      </div>
    );
  }
  const p = datum.person;
  if (!p) return null;
  const years = tenureYears(p.startDate);
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <div
          className="h-12 w-12 rounded-full"
          style={{ background: "linear-gradient(to bottom right, var(--sphere-member-0), var(--sphere-member-1))" }}
        />
        <div>
          <h2 className="text-lg font-semibold leading-tight">{p.name}</h2>
          <p className="text-sm text-slate-400">{p.title ?? "—"}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        {datum.assignment?.roleOnTeam && <Row label="Role on team" value={datum.assignment.roleOnTeam} />}
        {datum.assignment && datum.assignment.allocationPct !== 100 && (
          <Row label="Allocation" value={`${datum.assignment.allocationPct}%`} />
        )}
        <Row label="Cost / mo" value={fmtMoney(p.costPerMonth)} />
        {years != null && <Row label="Tenure" value={`${years.toFixed(1)} yrs`} />}
        {p.growthFocus && <Row label="Growth focus" value={p.growthFocus} />}
        <Row
          label="On teams"
          value={
            teamCount > 1 ? (
              <span className="text-amber-400">{teamCount} (multiple allocation)</span>
            ) : (
              `${teamCount}`
            )
          }
        />
      </dl>
      {(p.skills ?? []).length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Skills</div>
          <div className="flex flex-wrap gap-1.5">
            {p.skills.map((s) => (
              <span key={s} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}

const OVERLAY_OPTIONS: { type: OverlayType; label: string }[] = [
  { type: "none", label: "Overview" },
  { type: "allocation", label: "Allocation" },
  { type: "gaps", label: "Gaps" },
  { type: "cost", label: "Cost / ROI" },
];

function SummaryBar({
  summary,
  overlayType,
  onOverlay,
  findingsCount,
  showFindings,
  onToggleFindings,
  viewMode,
  onViewMode,
}: {
  summary: OrgSummary;
  overlayType: OverlayType;
  onOverlay: (t: OverlayType) => void;
  findingsCount: number;
  showFindings: boolean;
  onToggleFindings: () => void;
  viewMode: "delivery" | "formal";
  onViewMode: (m: "delivery" | "formal") => void;
}) {
  const fmtCost = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;
  const fmtRoi = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n > 0 ? `$${Math.round(n / 1000)}k` : "—";

  return (
    <div className="flex shrink-0 items-center gap-0 border-b border-slate-800 bg-slate-900/80 px-4 text-sm">
      {/* View mode toggle */}
      <div className="flex items-center gap-1 border-r border-slate-800 pr-4 py-2">
        {(["delivery", "formal"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onViewMode(m)}
            className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
              viewMode === m ? "accent-active" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Overlay toggles + Findings — delivery mode only */}
      {viewMode === "delivery" && (
        <>
          <div className="flex items-center gap-1 border-r border-slate-800 pr-4 py-2">
            {OVERLAY_OPTIONS.map((o) => (
              <button
                key={o.type}
                onClick={() => onOverlay(o.type)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  overlayType === o.type
                    ? "accent-active"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center border-r border-slate-800 px-3 py-2">
            <button
              onClick={onToggleFindings}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                showFindings ? "accent-active" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Findings{findingsCount > 0 ? ` (${findingsCount})` : ""}
            </button>
          </div>
        </>
      )}

      {/* Metrics */}
      <div className="flex items-center gap-6 px-4 py-2">
        <Metric label="Cost / mo" value={fmtCost(summary.totalCostPerMonth)} />
        <Metric label="Expected ROI" value={fmtRoi(summary.totalRoi)} />
        <Metric
          label="Open roles"
          value={String(summary.openRoles)}
          alert={summary.openRoles > 0}
        />
        <Metric
          label="Over-allocated"
          value={String(summary.overAllocatedCount)}
          alert={summary.overAllocatedCount > 0}
        />
      </div>

      <a
        href="/org"
        className="ml-auto shrink-0 rounded px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-300"
      >
        ← Back to the map
      </a>
    </div>
  );
}

const FINDING_KIND_LABELS: Record<string, string> = {
  "over-allocation": "Over-allocation",
  coupling: "Hidden coupling",
};

function FindingsRail({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="text-sm font-bold tracking-wide">
        What we found
        <span className="ml-1 font-normal text-slate-500">· {findings.length}</span>
      </div>

      {findings.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">No findings — org looks clean.</p>
      )}

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
        {findings.map((f) => {
          const on = selectedId === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              className="rounded-xl border p-3.5 text-left transition-colors"
              style={{
                borderColor: on ? f.color : "#1d2740",
                background: on ? "rgba(20,27,46,.9)" : "rgba(14,20,36,.6)",
                boxShadow: on
                  ? `0 0 0 1px ${f.color}33, 0 8px 30px -12px ${f.color}66`
                  : "none",
              }}
            >
              {/* Signal row — always shown */}
              <div className="flex items-center gap-3">
                <div className="min-w-[52px]">
                  <div
                    className="text-2xl font-extrabold leading-none"
                    style={{ color: f.color }}
                  >
                    {f.stat}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: f.color }}
                    />
                    <span className="text-xs font-bold text-slate-100">
                      {FINDING_KIND_LABELS[f.kind] ?? f.kind}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{f.statSub}</div>
                </div>
                <span
                  className="inline-block text-xs transition-transform duration-200"
                  style={{
                    color: f.color,
                    opacity: 0.6,
                    transform: on ? "rotate(90deg)" : undefined,
                  }}
                >
                  ›
                </span>
              </div>

              {/* Narrative — revealed on focus */}
              {on && (
                <div
                  className="mt-3 pt-3 text-sm leading-relaxed text-slate-300"
                  style={{ borderTop: `1px solid ${f.color}22` }}
                >
                  {f.narrativeText}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="pt-2 text-xs leading-relaxed text-slate-600">
        Ambient: all findings on the map, equal weight, colour by category. Click to
        focus.
      </p>
    </div>
  );
}

function Metric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-600">{label}</span>
      <span className={alert ? "font-semibold text-amber-400" : "text-slate-300"}>{value}</span>
    </div>
  );
}
