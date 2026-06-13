import type { Snapshot } from "@/lib/org/model";
import { childUnitsByParent, assignmentsByUnit } from "@/lib/org/model";

export type UnitRollup = {
  unitId: string;
  peopleCost: number;  // sum of person.costPerMonth * allocationPct% for filled slots
  directCost: number;  // unit.costPerMonth (e.g. contractor lump-sum)
  totalCost: number;   // peopleCost + directCost + sum(children.totalCost)
  totalRoi: number;    // sum of leaf-level expectedRoi in this subtree
};

/**
 * Recursive cost/ROI rollup over the unit tree. Pure — no DB calls.
 *
 * ROI is accumulated only from leaf units (kind='team' with no children) to
 * avoid double-counting groups that carry an estimated total alongside
 * their teams' individual ROIs.
 */
export function computeRollup({ units, people, assignments }: Snapshot): Map<string, UnitRollup> {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const asgByUnit = assignmentsByUnit(assignments);
  const childByParent = childUnitsByParent(units);
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const result = new Map<string, UnitRollup>();

  function walk(unitId: string): UnitRollup {
    if (result.has(unitId)) return result.get(unitId)!;

    const unit = unitsById.get(unitId)!;
    const unitAsgs = asgByUnit.get(unitId) ?? [];

    let peopleCost = 0;
    for (const a of unitAsgs) {
      if (!a.isOpenRole && a.personId) {
        const person = peopleById.get(a.personId);
        if (person?.costPerMonth) {
          peopleCost += (Number(person.costPerMonth) * (a.allocationPct ?? 100)) / 100;
        }
      }
    }

    const directCost = Number(unit.costPerMonth ?? 0);
    const children = childByParent.get(unitId) ?? [];
    const isLeaf = children.length === 0;

    let childCost = 0;
    let childRoi = 0;
    for (const child of children) {
      const c = walk(child.id);
      childCost += c.totalCost;
      childRoi += c.totalRoi;
    }

    const rollup: UnitRollup = {
      unitId,
      peopleCost,
      directCost,
      totalCost: peopleCost + directCost + childCost,
      totalRoi: isLeaf ? Number(unit.expectedRoi ?? 0) : childRoi,
    };
    result.set(unitId, rollup);
    return rollup;
  }

  for (const unit of units) walk(unit.id);
  return result;
}
