import type { Snapshot } from "@/lib/org/model";
import { allocationByPerson, assignmentsByUnit, indexById } from "@/lib/org/model";
import {
  DEFAULT_FINDINGS_POLICY,
  SPREAD_TEAM_THRESHOLD,
  spreadThresholdFor,
  type FindingsPolicy,
} from "./findingsPolicy";

// Re-exported so existing importers (and tests) keep getting it from here; the
// definition moved to findingsPolicy.ts to break a findings↔policy cycle.
export { SPREAD_TEAM_THRESHOLD };

export type FindingKind = "spread" | "over-commitment" | "coupling";

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
  // Spread is a structural coverage/bus-factor signal, not a load-danger one —
  // it gets its own indigo so it never reads as the utilisation red.
  spread: "#8b9df0",
  "over-commitment": "#ff7a8a",
  coupling: "#f5b14a",
};

/** Assignment unit IDs a person actually holds (open roles excluded). */
function heldUnitIds(snapshot: Snapshot, personId: string): string[] {
  return snapshot.assignments
    .filter((a) => a.personId === personId && !a.isOpenRole)
    .map((a) => a.orgUnitId);
}

/**
 * Per-person Spread threshold. A plain number applies to everyone; a function
 * lets the caller vary it by the person (that's how the per-discipline policy
 * feeds in) — returning `null` means "no limit", i.e. never flag this person.
 */
export type SpreadThreshold =
  | number
  | ((person: Snapshot["people"][number] | undefined) => number | null);

/**
 * Spread — a person present on `threshold`+ teams. Count-based and %-free per
 * the settled "no % in findings" rule: how many teams is the whole point, the
 * declared load belongs to Over-commitment. `threshold` defaults to the
 * workspace-wide seed; the per-discipline policy passes a resolver instead.
 */
export function computeSpreadFindings(
  snapshot: Snapshot,
  threshold: SpreadThreshold = SPREAD_TEAM_THRESHOLD,
): Finding[] {
  const allocMap = allocationByPerson(snapshot.assignments);
  const peopleById = indexById(snapshot.people);
  const findings: Finding[] = [];

  for (const [personId, alloc] of allocMap) {
    const person = peopleById.get(personId);
    const limit = typeof threshold === "function" ? threshold(person) : threshold;
    // null = no limit for this person (a discipline the org exempts).
    if (limit == null || alloc.teamCount < limit) continue;
    findings.push({
      id: `spread-${personId}`,
      kind: "spread",
      color: FINDING_COLORS.spread,
      stat: String(alloc.teamCount),
      statSub: `${person?.name ?? "Unknown"} · ${alloc.teamCount} teams`,
      narrativeText: `${person?.name ?? "Unknown"} is spread across ${alloc.teamCount} teams.`,
      involvedUnitIds: heldUnitIds(snapshot, personId),
      involvedPersonIds: [personId],
      spotlightType: "hub",
    });
  }

  return findings.sort(
    (a, b) =>
      allocMap.get(b.involvedPersonIds[0])!.teamCount -
      allocMap.get(a.involvedPersonIds[0])!.teamCount,
  );
}

/**
 * Over-commitment — a person whose declared allocation exceeds 100%. This is
 * the finding that legitimately carries a %, because the number *is* the load.
 */
export function computeOverCommitmentFindings(snapshot: Snapshot): Finding[] {
  const allocMap = allocationByPerson(snapshot.assignments);
  const peopleById = indexById(snapshot.people);
  const findings: Finding[] = [];

  for (const [personId, alloc] of allocMap) {
    if (alloc.totalPct <= 100) continue;
    const person = peopleById.get(personId);
    const pct = Math.round(alloc.totalPct);
    findings.push({
      id: `overcommit-${personId}`,
      kind: "over-commitment",
      color: FINDING_COLORS["over-commitment"],
      stat: `${pct}%`,
      statSub: `${person?.name ?? "Unknown"} · ${alloc.teamCount} teams`,
      narrativeText: `${person?.name ?? "Unknown"} is committed to ${pct}% across ${alloc.teamCount} teams — more than one person's time.`,
      involvedUnitIds: heldUnitIds(snapshot, personId),
      involvedPersonIds: [personId],
      spotlightType: "hub",
    });
  }

  return findings.sort(
    (a, b) =>
      allocMap.get(b.involvedPersonIds[0])!.totalPct -
      allocMap.get(a.involvedPersonIds[0])!.totalPct,
  );
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

/**
 * All findings under a workspace's policy (S5 tab 5). A detector switched off
 * contributes nothing; Spread reads its per-person threshold from the policy,
 * so a discipline the org marks "no limit" simply never fires. The default
 * policy — every detector on, Spread at the seeded threshold for everyone —
 * reproduces the pre-config behaviour exactly, so callers that don't yet load
 * a policy (and any workspace before the table is populated) are unaffected.
 */
export function computeAllFindings(
  snapshot: Snapshot,
  policy: FindingsPolicy = DEFAULT_FINDINGS_POLICY,
): Finding[] {
  return [
    ...(policy.spreadEnabled
      ? computeSpreadFindings(snapshot, (p) => spreadThresholdFor(policy, p?.disciplineId ?? null))
      : []),
    ...(policy.overCommitmentEnabled ? computeOverCommitmentFindings(snapshot) : []),
    ...(policy.couplingEnabled ? computeCouplingFindings(snapshot) : []),
  ];
}
