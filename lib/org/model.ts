import type { OrgUnit, Person, Assignment } from "@/lib/db/schema";

/**
 * Pure, client-safe helpers over an org snapshot. Shared by the visualization
 * (M3/M4) and the analytics overlays (M5) so both read the structure the same
 * way. No DB or server imports here.
 */

export type Snapshot = {
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
};

export function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export function childUnitsByParent(units: OrgUnit[]): Map<string | null, OrgUnit[]> {
  const m = new Map<string | null, OrgUnit[]>();
  for (const u of units) {
    const k = u.parentId ?? null;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(u);
  }
  for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return m;
}

export function assignmentsByUnit(assignments: Assignment[]): Map<string, Assignment[]> {
  const m = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!m.has(a.orgUnitId)) m.set(a.orgUnitId, []);
    m.get(a.orgUnitId)!.push(a);
  }
  return m;
}

/** Depth-first ordered units with indentation depth — for tree outlines/minimaps. */
export function orderedUnitTree(units: OrgUnit[]): { unit: OrgUnit; depth: number }[] {
  const byParent = childUnitsByParent(units);
  const ids = new Set(units.map((u) => u.id));
  const out: { unit: OrgUnit; depth: number }[] = [];
  const walk = (parentKey: string | null, depth: number) => {
    for (const u of byParent.get(parentKey) ?? []) {
      out.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  // Roots: parentId null, or a parent that isn't in this workspace's set.
  walk(null, 0);
  for (const u of units) {
    if (u.parentId && !ids.has(u.parentId)) {
      out.push({ unit: u, depth: 0 });
      walk(u.id, 1);
    }
  }
  return out;
}

export function rootUnits(units: OrgUnit[]): OrgUnit[] {
  const ids = new Set(units.map((u) => u.id));
  return units
    .filter((u) => !u.parentId || !ids.has(u.parentId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function pathToRoot(unitId: string, unitsById: Map<string, OrgUnit>): OrgUnit[] {
  const path: OrgUnit[] = [];
  let cur = unitsById.get(unitId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? unitsById.get(cur.parentId) : undefined;
  }
  return path;
}

export type Allocation = { personId: string; totalPct: number; teamCount: number };

/** Per-person allocation totals across all (filled) assignments. */
export function allocationByPerson(assignments: Assignment[]): Map<string, Allocation> {
  const m = new Map<string, Allocation>();
  for (const a of assignments) {
    if (!a.personId || a.isOpenRole) continue;
    const cur = m.get(a.personId) ?? { personId: a.personId, totalPct: 0, teamCount: 0 };
    cur.totalPct += a.allocationPct ?? 0;
    cur.teamCount += 1;
    m.set(a.personId, cur);
  }
  return m;
}

/** People on more than one team, or summing to >100% allocation. */
export function overAllocatedPersonIds(assignments: Assignment[]): Set<string> {
  const out = new Set<string>();
  for (const a of allocationByPerson(assignments).values()) {
    if (a.teamCount > 1 || a.totalPct > 100) out.add(a.personId);
  }
  return out;
}

/** Filled vs. target headcount and open-role count for a unit. */
export function unitStaffing(
  unit: OrgUnit,
  unitAssignments: Assignment[],
): { filled: number; open: number; target: number | null; gap: number } {
  const filled = unitAssignments.filter((a) => !a.isOpenRole && a.personId).length;
  const open = unitAssignments.filter((a) => a.isOpenRole).length;
  const target = unit.targetHeadcount ?? null;
  const gap = target != null ? Math.max(0, target - filled) : open;
  return { filled, open, target, gap };
}

export function tenureYears(startDate: string | null): number | null {
  if (!startDate) return null;
  const start = new Date(startDate).getTime();
  if (Number.isNaN(start)) return null;
  return (Date.now() - start) / (365.25 * 24 * 3600 * 1000);
}
