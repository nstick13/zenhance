import {
  overAllocatedPersonIds,
  allocationByPerson,
  rootUnits,
  type Allocation,
  type Snapshot,
} from "@/lib/org/model";
import { computeGaps } from "./gaps";
import { computeRollup } from "./rollup";

export { overAllocatedPersonIds, allocationByPerson };
export type { Allocation };

export type OrgSummary = {
  totalCostPerMonth: number;
  totalRoi: number;
  openRoles: number;
  overAllocatedCount: number;
};

export function computeOrgSummary(snapshot: Snapshot): OrgSummary {
  const overAlloc = overAllocatedPersonIds(snapshot.assignments);
  const gaps = computeGaps(snapshot);
  const rollup = computeRollup(snapshot);

  const roots = rootUnits(snapshot.units);
  let totalCostPerMonth = 0;
  let totalRoi = 0;
  for (const root of roots) {
    const r = rollup.get(root.id);
    if (r) {
      totalCostPerMonth += r.totalCost;
      totalRoi += r.totalRoi;
    }
  }

  let openRoles = 0;
  for (const gap of gaps.values()) openRoles += gap.gap;

  return { totalCostPerMonth, totalRoi, openRoles, overAllocatedCount: overAlloc.size };
}
