import type { Snapshot } from "@/lib/org/model";
import { allocationByPerson, assignmentsByUnit, indexById } from "@/lib/org/model";

export type FindingKind = "over-allocation" | "coupling";

export type Finding = {
  id: string;
  kind: FindingKind;
  color: string;
  /** Primary numeric stat, e.g. "165%" or "3" */
  stat: string;
  /** Short subtitle shown in the Signal row */
  statSub: string;
  /** Plain-text narrative revealed on focus */
  narrativeText: string;
  /** Unit IDs involved — drives ambient dots + spotlight */
  involvedUnitIds: string[];
  /** Person IDs involved — drives node dimming on focus */
  involvedPersonIds: string[];
  spotlightType: "hub" | "ribbon" | "team";
};

export const FINDING_COLORS: Record<FindingKind, string> = {
  "over-allocation": "#ff7a8a",
  coupling: "#f5b14a",
};

export function computeOverAllocFindings(snapshot: Snapshot): Finding[] {
  const allocMap = allocationByPerson(snapshot.assignments);
  const peopleById = indexById(snapshot.people);
  const findings: Finding[] = [];

  for (const [personId, alloc] of allocMap) {
    if (alloc.teamCount <= 1 && alloc.totalPct <= 100) continue;
    const person = peopleById.get(personId);
    const unitIds = snapshot.assignments
      .filter((a) => a.personId === personId && !a.isOpenRole)
      .map((a) => a.orgUnitId);

    const pct = Math.round(alloc.totalPct);
    findings.push({
      id: `overalloc-${personId}`,
      kind: "over-allocation",
      color: FINDING_COLORS["over-allocation"],
      stat: `${pct}%`,
      statSub: `${person?.name ?? "Unknown"} · ${alloc.teamCount} teams`,
      narrativeText: `${person?.name ?? "Unknown"} is spread across ${alloc.teamCount} teams at ${pct}% total allocation.`,
      involvedUnitIds: unitIds,
      involvedPersonIds: [personId],
      spotlightType: "hub",
    });
  }

  return findings.sort((a, b) => {
    const pa = allocMap.get(a.involvedPersonIds[0])!;
    const pb = allocMap.get(b.involvedPersonIds[0])!;
    return pb.totalPct - pa.totalPct;
  });
}

export function computeCouplingFindings(snapshot: Snapshot): Finding[] {
  const asgByUnit = assignmentsByUnit(snapshot.assignments);
  const unitsById = indexById(snapshot.units);
  const unitIds = snapshot.units.map((u) => u.id);
  const findings: Finding[] = [];

  for (let i = 0; i < unitIds.length; i++) {
    for (let j = i + 1; j < unitIds.length; j++) {
      const aA = asgByUnit.get(unitIds[i]) ?? [];
      const aB = asgByUnit.get(unitIds[j]) ?? [];
      const setA = new Set(
        aA.filter((a) => !a.isOpenRole && a.personId).map((a) => a.personId!),
      );
      const setB = new Set(
        aB.filter((a) => !a.isOpenRole && a.personId).map((a) => a.personId!),
      );
      const shared = [...setA].filter((id) => setB.has(id));
      if (shared.length < 2) continue;

      const unitA = unitsById.get(unitIds[i]);
      const unitB = unitsById.get(unitIds[j]);
      if (!unitA || !unitB) continue;

      findings.push({
        id: `coupling-${unitIds[i]}-${unitIds[j]}`,
        kind: "coupling",
        color: FINDING_COLORS.coupling,
        stat: String(shared.length),
        statSub: `shared · ${unitA.name} ↔ ${unitB.name}`,
        narrativeText: `${unitA.name} and ${unitB.name} share ${shared.length} ${shared.length === 1 ? "person" : "people"} — structurally separate, operationally coupled.`,
        involvedUnitIds: [unitIds[i], unitIds[j]],
        involvedPersonIds: shared,
        spotlightType: "ribbon",
      });
    }
  }

  return findings.sort((a, b) => b.involvedPersonIds.length - a.involvedPersonIds.length);
}

export function computeAllFindings(snapshot: Snapshot): Finding[] {
  return [
    ...computeOverAllocFindings(snapshot),
    ...computeCouplingFindings(snapshot),
  ];
}
