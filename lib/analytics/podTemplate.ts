/**
 * Pod template (S5 tab 4, "Standards") — a workspace's definition of what a
 * *complete* team looks like, and the compare-to-ideal that measures every team
 * against it. Pure and client-safe (no React, no DB).
 *
 * Heather's CTO is asking this quarter how ~90 pods rate against agile
 * maturity; this is that, as role-coverage analytics on `disciplineId` (now a
 * real field since S2 import mapping). Two deliberate design calls from the
 * canvas:
 *  - **Ranges, not fixed counts.** A template that calls a 5-person team wrong
 *    for having 5 engineers instead of 4 gets switched off in a week. Each role
 *    is a discipline with a `min` and an optional `max` (null = no upper bound).
 *  - **A table, never the canvas.** "They're not going to want blobs" — at 90
 *    pods this reads as a sortable gap column, not a drawn overlay.
 */

import type { Snapshot } from "@/lib/org/model";
import { assignmentsByUnit } from "@/lib/org/model";

/** One row of the ideal pod: a required discipline and its acceptable range. */
export type PodTemplateRole = {
  disciplineId: string;
  /** Fewest of this discipline a complete pod has. ≥ 1 in practice. */
  minCount: number;
  /** Most before a pod is "heavy"; null = no upper bound (the "N+" case). */
  maxCount: number | null;
};

export type RoleStatus = "ok" | "over" | "under" | "missing";
export type PodCategory = "complete" | "missing" | "under" | "over";

export type PodRoleGap = {
  disciplineId: string;
  actual: number;
  min: number;
  max: number | null;
  status: RoleStatus;
};

export type PodTeamGap = {
  teamId: string;
  teamName: string;
  roles: PodRoleGap[];
  /** The single gap that names the team's headline, or null when complete. */
  worst: PodRoleGap | null;
  category: PodCategory;
};

export type PodGapReport = {
  teams: PodTeamGap[];
  summary: Record<PodCategory, number>;
  hasTemplate: boolean;
};

// Worst-first: a missing required role outranks under-strength, which outranks
// over-strength. "ok" never becomes a headline.
const SEVERITY: Record<RoleStatus, number> = { missing: 3, under: 2, over: 1, ok: 0 };

function statusOf(actual: number, role: PodTemplateRole): RoleStatus {
  if (actual === 0 && role.minCount >= 1) return "missing";
  if (actual < role.minCount) return "under";
  if (role.maxCount !== null && actual > role.maxCount) return "over";
  return "ok";
}

const CATEGORY_OF: Record<RoleStatus, PodCategory> = {
  missing: "missing",
  under: "under",
  over: "over",
  ok: "complete",
};

/**
 * Compare every team (kind === "team") to the template. Composition is counted
 * over *seats* — a person filling a role on two teams counts once on each, which
 * is the right unit for "does this pod have a QA", not "how many unique QAs".
 * Open roles don't count toward coverage: an unfilled seat is exactly the gap.
 */
export function computePodGaps(
  snapshot: Snapshot,
  template: PodTemplateRole[],
): PodGapReport {
  const summary: Record<PodCategory, number> = { complete: 0, missing: 0, under: 0, over: 0 };
  if (template.length === 0) {
    return { teams: [], summary, hasTemplate: false };
  }

  const asgByUnit = assignmentsByUnit(snapshot.assignments);
  const disciplineOf = new Map<string, string | null>(
    snapshot.people.map((p) => [p.id, p.disciplineId ?? null]),
  );

  const teams: PodTeamGap[] = [];
  for (const unit of snapshot.units) {
    if (unit.kind !== "team") continue;

    // Count filled seats per discipline in this team.
    const counts = new Map<string, number>();
    for (const a of asgByUnit.get(unit.id) ?? []) {
      if (a.isOpenRole || !a.personId) continue;
      const disc = disciplineOf.get(a.personId) ?? null;
      if (disc) counts.set(disc, (counts.get(disc) ?? 0) + 1);
    }

    const roles: PodRoleGap[] = template.map((r) => {
      const actual = counts.get(r.disciplineId) ?? 0;
      return {
        disciplineId: r.disciplineId,
        actual,
        min: r.minCount,
        max: r.maxCount,
        status: statusOf(actual, r),
      };
    });

    // Headline = the worst role; ties break to the bigger shortfall.
    let worst: PodRoleGap | null = null;
    for (const role of roles) {
      if (role.status === "ok") continue;
      if (
        !worst ||
        SEVERITY[role.status] > SEVERITY[worst.status] ||
        (SEVERITY[role.status] === SEVERITY[worst.status] &&
          role.min - role.actual > worst.min - worst.actual)
      ) {
        worst = role;
      }
    }

    const category = worst ? CATEGORY_OF[worst.status] : "complete";
    summary[category] += 1;
    teams.push({ teamId: unit.id, teamName: unit.name, roles, worst, category });
  }

  return { teams, summary, hasTemplate: true };
}

/** Human label for a team's headline gap, given the discipline's name. */
export function gapLabel(gap: PodRoleGap | null, disciplineName: string): string {
  if (!gap) return "Complete";
  switch (gap.status) {
    case "missing":
      return `No ${disciplineName}`;
    case "under":
      return `Thin on ${disciplineName}`;
    case "over":
      return `Heavy on ${disciplineName}`;
    default:
      return "Complete";
  }
}
