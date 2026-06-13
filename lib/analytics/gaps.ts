import type { Snapshot } from "@/lib/org/model";
import { assignmentsByUnit, unitStaffing } from "@/lib/org/model";

export type UnitGap = {
  unitId: string;
  filled: number;
  open: number;
  target: number | null;
  gap: number;
};

export function computeGaps({ units, assignments }: Snapshot): Map<string, UnitGap> {
  const asgByUnit = assignmentsByUnit(assignments);
  const result = new Map<string, UnitGap>();
  for (const unit of units) {
    const staffing = unitStaffing(unit, asgByUnit.get(unit.id) ?? []);
    result.set(unit.id, { unitId: unit.id, ...staffing });
  }
  return result;
}
