import type { OrgUnit, Person, Assignment } from "@/lib/db/schema";
import { indexById, childUnitsByParent, rootUnits } from "@/lib/org/model";

/**
 * Pure, client-safe transform from the org snapshot (the same tree
 * RadialOrg.tsx renders) into a flat node list for the v2 canvas map — see
 * docs/V2.md. No DB, no React.
 *
 * "Train" (the top zoom rung) isn't a schema concept — it's the first level
 * where the org tree branches below its root, walking down through any
 * chain of single-child groups (root org -> "Delivery Group" -> {Atlas,
 * Orion, Vega, Infosys Contractors} in the demo org). "Squad" = any
 * kind="team" unit at any depth below that.
 *
 * A person's map "home" is their majority-allocation team (>=60%); anyone
 * without one true home (a genuine cross-cutting supporter, or a lead with
 * no delivery allocation at all) clusters in a synthetic "Cross-cutting"
 * bucket — the shared-resource story that is Zenhance's differentiator.
 */

export const CROSS_CUTTING_ID = "__cross-cutting__";
const CROSS_CUTTING_NAME = "Cross-cutting";
const HOME_THRESHOLD_PCT = 60;

export type CanvasAllocation = { assignmentId: string; unitId: string; role: string; pct: number };

export type CanvasSquad = {
  id: string;
  kind: "squad";
  name: string;
  x: number;
  y: number;
  trainId: string;
  trainName: string;
  leadPersonId: string | null;
  leadName: string | null;
  targetHeadcount: number | null;
  costPerMonth: number | null;
  expectedRoi: number | null;
  openRoles: number;
  isExternal: boolean;
  vendorName: string | null;
  isCrossCutting: boolean;
};

export type CanvasPerson = {
  id: string;
  kind: "person";
  name: string;
  x: number;
  y: number;
  title: string | null;
  homeId: string;
  costPerMonth: number;
  managerId: string | null;
  lastVacationAt: string | null;
  startDate: string | null;
  skills: string[];
  growthFocus: string | null;
  allocations: CanvasAllocation[];
  crossCuttingTier: "squad" | "train" | null;
};

export type CanvasNode = CanvasSquad | CanvasPerson;

export type CanvasTrain = { id: string; name: string; expectedRoi: number | null };

export type CanvasMapData = { trains: CanvasTrain[]; nodes: CanvasNode[] };

export type Position = { x: number; y: number };

/** Positions persisted from a prior drag, keyed `${nodeType}:${nodeId}`. */
export function positionsFromRows(
  rows: { nodeType: "unit" | "person"; nodeId: string; x: string; y: string }[],
): Map<string, Position> {
  const m = new Map<string, Position>();
  for (const r of rows) m.set(`${r.nodeType}:${r.nodeId}`, { x: Number(r.x), y: Number(r.y) });
  return m;
}

/** First level below the root where the tree branches — the "train" rung. */
function topRungUnits(units: OrgUnit[]): OrgUnit[] {
  const byParent = childUnitsByParent(units);
  let level = rootUnits(units);
  while (level.length === 1) {
    const kids = byParent.get(level[0].id) ?? [];
    if (kids.length === 0) break;
    level = kids;
  }
  return level;
}

function trainOf(unit: OrgUnit, topIds: Set<string>, unitsById: Map<string, OrgUnit>): OrgUnit {
  let cur = unit;
  while (!topIds.has(cur.id) && cur.parentId) {
    const parent = unitsById.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Px of arc each seat needs before its name label starts crowding its neighbour. */
const SEAT_ARC = 104;

/**
 * A squad's circle grows with the number of seats it holds, so "big team" is
 * legible from the size alone before you read a single label.
 * Shared by the layout (here) and the renderer (OrgCanvas).
 */
export const squadNodeRadius = (seats: number): number => Math.round(clampN(58 + seats * 4.5, 62, 124));

/**
 * Radius of the member ring around a squad: clear of the (now variable) node,
 * and wide enough that every seat gets ~SEAT_ARC px of arc.
 */
export const squadRingRadius = (seats: number): number =>
  Math.round(Math.max(squadNodeRadius(seats) + 54, (seats * SEAT_ARC) / (2 * Math.PI)));

const ring = (i: number, count: number, radius: number, cx: number, cy: number): Position => {
  const angle = (2 * Math.PI * i) / Math.max(1, count) - Math.PI / 2;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
};

export type CrossCuttingMode = "bucket" | "connected";

export function buildCanvasMap(
  snapshot: { people: Person[]; units: OrgUnit[]; assignments: Assignment[] },
  positions: Map<string, Position>,
  options?: { crossCuttingMode?: CrossCuttingMode },
): CanvasMapData {
  const crossCuttingMode = options?.crossCuttingMode ?? "connected";
  const { people, units, assignments } = snapshot;
  const unitsById = indexById(units);
  const peopleById = indexById(people);
  const tops = topRungUnits(units);
  const topIds = new Set(tops.map((u) => u.id));
  const teams = units.filter((u) => u.kind === "team");

  const leadOf = new Map<string, OrgUnit[]>();
  for (const u of units) {
    if (!u.leadPersonId) continue;
    if (!leadOf.has(u.leadPersonId)) leadOf.set(u.leadPersonId, []);
    leadOf.get(u.leadPersonId)!.push(u);
  }

  const assignmentsByPerson = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!a.personId || unitsById.get(a.orgUnitId)?.kind !== "team") continue;
    if (!assignmentsByPerson.has(a.personId)) assignmentsByPerson.set(a.personId, []);
    assignmentsByPerson.get(a.personId)!.push(a);
  }

  // --- each person's map "home" -------------------------------------------
  const homeOf = new Map<string, string>();
  for (const p of people) {
    const asg = assignmentsByPerson.get(p.id) ?? [];
    if (asg.length > 0) {
      const majority = [...asg].sort((a, b) => (b.allocationPct ?? 0) - (a.allocationPct ?? 0))[0];
      homeOf.set(
        p.id,
        (majority.allocationPct ?? 0) >= HOME_THRESHOLD_PCT ? majority.orgUnitId : CROSS_CUTTING_ID,
      );
    } else {
      const led = leadOf.get(p.id)?.find((u) => u.kind === "team");
      homeOf.set(p.id, led ? led.id : CROSS_CUTTING_ID);
    }
  }
  const usesCrossCutting = people.some((p) => homeOf.get(p.id) === CROSS_CUTTING_ID);

  // --- group squads by train, list trains -----------------------------------
  const teamsByTrain = new Map<string, OrgUnit[]>();
  for (const t of teams) {
    const train = trainOf(t, topIds, unitsById);
    if (!teamsByTrain.has(train.id)) teamsByTrain.set(train.id, []);
    teamsByTrain.get(train.id)!.push(t);
  }
  for (const list of teamsByTrain.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  // Squad → train lookup used to classify cross-cutting people by tier.
  const squadToTrainId = new Map<string, string>();
  for (const [trainId, squadList] of teamsByTrain) {
    for (const sq of squadList) squadToTrainId.set(sq.id, trainId);
  }

  const trainList: CanvasTrain[] = tops
    .filter((t) => (teamsByTrain.get(t.id)?.length ?? 0) > 0)
    .map((t) => ({
      id: t.id,
      name: t.name,
      expectedRoi: t.expectedRoi != null ? Number(t.expectedRoi) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (usesCrossCutting) trainList.push({ id: CROSS_CUTTING_ID, name: CROSS_CUTTING_NAME, expectedRoi: null });

  // --- anchors: trains laid out in a grid, cross-cutting set apart ----------
  const TRAIN_SPACING = 1400;
  const realTrains = trainList.filter((t) => t.id !== CROSS_CUTTING_ID);
  const perRow = Math.max(1, Math.ceil(Math.sqrt(realTrains.length)));
  const trainAnchor = new Map<string, Position>();
  realTrains.forEach((t, i) => {
    trainAnchor.set(t.id, {
      x: (i % perRow) * TRAIN_SPACING,
      y: Math.floor(i / perRow) * TRAIN_SPACING,
    });
  });
  if (usesCrossCutting) {
    const midCol = (Math.min(perRow, realTrains.length) - 1) / 2;
    trainAnchor.set(CROSS_CUTTING_ID, { x: midCol * TRAIN_SPACING, y: -TRAIN_SPACING });
  }

  const nodes: CanvasNode[] = [];
  const squadAnchor = new Map<string, Position>();

  for (const t of trainList) {
    const anchor = trainAnchor.get(t.id)!;
    if (t.id === CROSS_CUTTING_ID) {
      const pos = positions.get(`unit:${CROSS_CUTTING_ID}`) ?? anchor;
      squadAnchor.set(CROSS_CUTTING_ID, pos);
      nodes.push({
        id: CROSS_CUTTING_ID,
        kind: "squad",
        name: CROSS_CUTTING_NAME,
        x: pos.x,
        y: pos.y,
        trainId: CROSS_CUTTING_ID,
        trainName: CROSS_CUTTING_NAME,
        leadPersonId: null,
        leadName: null,
        targetHeadcount: null,
        costPerMonth: null,
        expectedRoi: null,
        openRoles: 0,
        isExternal: false,
        vendorName: null,
        isCrossCutting: true,
      });
      continue;
    }
    const squadTeams = teamsByTrain.get(t.id) ?? [];
    const squadRadius = Math.max(300, 240 + squadTeams.length * 22);
    squadTeams.forEach((team, i) => {
      const seed = ring(i, squadTeams.length, squadRadius, anchor.x, anchor.y);
      const pos = positions.get(`unit:${team.id}`) ?? seed;
      squadAnchor.set(team.id, pos);
      const openRoles = assignments.filter((a) => a.orgUnitId === team.id && a.isOpenRole).length;
      nodes.push({
        id: team.id,
        kind: "squad",
        name: team.name,
        x: pos.x,
        y: pos.y,
        trainId: t.id,
        trainName: t.name,
        leadPersonId: team.leadPersonId,
        leadName: team.leadPersonId ? (peopleById.get(team.leadPersonId)?.name ?? null) : null,
        targetHeadcount: team.targetHeadcount,
        costPerMonth: team.costPerMonth != null ? Number(team.costPerMonth) : null,
        expectedRoi: team.expectedRoi != null ? Number(team.expectedRoi) : null,
        openRoles,
        isExternal: team.isExternal,
        vendorName: team.vendorName,
        isCrossCutting: false,
      });
    });
  }

  // --- people ring around their home squad -----------------------------------
  const peopleByHome = new Map<string, Person[]>();
  for (const p of people) {
    const home = homeOf.get(p.id)!;
    if (!peopleByHome.has(home)) peopleByHome.set(home, []);
    peopleByHome.get(home)!.push(p);
  }

  // Seats a squad holds = its home members plus a ghost seat for every
  // cross-squad person allocated to it. Drives both circle and ring size.
  const ghostSeatCount = new Map<string, number>();
  if (crossCuttingMode === "connected") {
    for (const p of people) {
      if (homeOf.get(p.id) !== CROSS_CUTTING_ID) continue;
      const asg = assignmentsByPerson.get(p.id) ?? [];
      if (asg.length === 0) continue;
      // Both tiers take a seat in every squad they serve — cross-train people
      // are only distinguished by the seat's accent, not by a separate node.
      for (const a of asg) ghostSeatCount.set(a.orgUnitId, (ghostSeatCount.get(a.orgUnitId) ?? 0) + 1);
    }
  }
  const seatsOf = (squadId: string) =>
    (peopleByHome.get(squadId)?.length ?? 0) + (ghostSeatCount.get(squadId) ?? 0);

  // Cross-cutting people with team allocations are rendered as ghost seats in
  // each squad they serve (see OrgCanvas), so their own node position is never
  // drawn — the centroid below is only a stable fallback for anything that
  // reads node coordinates. People without any team allocation cluster in the
  // bucket and are drawn normally.
  const bucketMembers: Person[] = [];

  for (const [homeId, members] of peopleByHome) {
    if (homeId === CROSS_CUTTING_ID && crossCuttingMode === "connected") {
      members.sort((a, b) => a.name.localeCompare(b.name));
      for (const p of members) {
        const asg = assignmentsByPerson.get(p.id) ?? [];
        const allocations: CanvasAllocation[] = asg.map((a) => ({
          assignmentId: a.id,
          unitId: a.orgUnitId,
          role: a.roleOnTeam ?? "",
          pct: a.allocationPct ?? 100,
        }));
        let seed: Position;
        if (asg.length > 0) {
          // Weighted centroid of the team anchors this person contributes to
          let totalPct = 0, cx = 0, cy = 0;
          for (const a of asg) {
            const anchor = squadAnchor.get(a.orgUnitId);
            if (!anchor) continue;
            const pct = a.allocationPct ?? 100;
            cx += anchor.x * pct;
            cy += anchor.y * pct;
            totalPct += pct;
          }
          seed = totalPct > 0
            ? { x: cx / totalPct, y: cy / totalPct }
            : (squadAnchor.get(CROSS_CUTTING_ID) ?? { x: 0, y: 0 });
        } else {
          bucketMembers.push(p);
          continue;
        }
        // Classify: cross-squad if all allocations share one train; cross-train otherwise.
        const trainSet = new Set(asg.map((a) => squadToTrainId.get(a.orgUnitId)).filter((t): t is string => !!t));
        const tier: "squad" | "train" = trainSet.size <= 1 ? "squad" : "train";
        // Always seed from squad positions for cross-cutting people — persisted positions
        // from the old bucket layout are stale and cause off-screen connection lines.
        nodes.push({
          id: p.id, kind: "person", name: p.name, x: seed.x, y: seed.y,
          title: p.title, homeId, costPerMonth: p.costPerMonth != null ? Number(p.costPerMonth) : 0,
          managerId: p.managerId, lastVacationAt: p.lastVacationAt, startDate: p.startDate,
          skills: p.skills, growthFocus: p.growthFocus, allocations, crossCuttingTier: tier,
        });
      }
      continue;
    }

    const anchor = squadAnchor.get(homeId);
    if (!anchor) continue;
    members.sort((a, b) => a.name.localeCompare(b.name));
    const radius = squadRingRadius(seatsOf(homeId));
    members.forEach((p, i) => {
      const seed = ring(i, members.length, radius, anchor.x, anchor.y);
      const pos = positions.get(`person:${p.id}`) ?? seed;
      const allocations: CanvasAllocation[] = (assignmentsByPerson.get(p.id) ?? []).map((a) => ({
        assignmentId: a.id,
        unitId: a.orgUnitId,
        role: a.roleOnTeam ?? "",
        pct: a.allocationPct ?? 100,
      }));
      nodes.push({
        id: p.id, kind: "person", name: p.name, x: pos.x, y: pos.y,
        title: p.title, homeId, costPerMonth: p.costPerMonth != null ? Number(p.costPerMonth) : 0,
        managerId: p.managerId, lastVacationAt: p.lastVacationAt, startDate: p.startDate,
        skills: p.skills, growthFocus: p.growthFocus, allocations, crossCuttingTier: null,
      });
    });
  }

  // Place any truly unallocated cross-cutting people in the bucket
  if (bucketMembers.length > 0) {
    const anchor = squadAnchor.get(CROSS_CUTTING_ID);
    if (anchor) {
      const radius = squadRingRadius(bucketMembers.length);
      bucketMembers.forEach((p, i) => {
        const seed = ring(i, bucketMembers.length, radius, anchor.x, anchor.y);
        const pos = positions.get(`person:${p.id}`) ?? seed;
        nodes.push({
          id: p.id, kind: "person", name: p.name, x: pos.x, y: pos.y,
          title: p.title, homeId: CROSS_CUTTING_ID,
          costPerMonth: p.costPerMonth != null ? Number(p.costPerMonth) : 0,
          managerId: p.managerId, lastVacationAt: p.lastVacationAt, startDate: p.startDate,
          skills: p.skills, growthFocus: p.growthFocus, allocations: [], crossCuttingTier: null,
        });
      });
    }
  }

  return { trains: trainList, nodes };
}
