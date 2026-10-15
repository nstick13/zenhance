/**
 * The lab's four companies, built outside React.
 *
 * This was inline in `page.tsx` until 2026-10-14, which meant the only way to
 * get the exact company Greg is looking at was to render a page. A repro of a
 * fault he reported therefore had to re-implement the promotion of people to
 * units from memory — forty lines that would drift from the real thing and
 * quietly stop reproducing anything.
 *
 * Nothing here is new behaviour. It is the same code, somewhere a test can
 * reach it.
 */
import { buildDeepOrg } from "@/lib/map/layout/__tests__/fixtures/deepOrg";
import type { OrgInput } from "@/lib/map/layout/model";

/**
 * `spotlight` forces the first and last team to a given size, so both ends of
 * Greg's question are always on the map: *"a team with a few members, and a
 * team with the maximum number of members you can realistically squeeze into a
 * host cell — say 50."* Sparrow-ish is left alone; a fifty-person team inside a
 * ten-person company is not a case anyone needs to look at.
 */
const SPOTLIGHT = { small: 3, large: 50 };

export const COMPANIES = {
  small: { label: "Sparrow-ish · 10", people: 10, maxDepth: 2, spotlight: undefined },
  medium: { label: "Digital Tailoring-ish · 45", people: 45, maxDepth: 4, spotlight: SPOTLIGHT },
  large: { label: "1,000 · 8 rungs", people: 1000, maxDepth: 8, spotlight: SPOTLIGHT },
  northwind: { label: "Northwind · 2,562 · 11 rungs", people: 2400, maxDepth: 11, spotlight: SPOTLIGHT },
} as const;

export type CompanyKey = keyof typeof COMPANIES;
export type Strata = "teams" | "people";

export type LabCompany = {
  org: OrgInput;
  /** unit id → the team it belongs to, so the layout can keep a team whole. */
  groups: [string, string][];
  /** The people who lead the unit they report to. */
  leads: string[];
};

export function buildLabCompany(key: CompanyKey, strata: Strata): LabCompany {
  const spec = COMPANIES[key];
  const org = buildDeepOrg("hexlab", {
    people: spec.people,
    maxDepth: spec.maxDepth,
    seed: 7,
    spotlight: spec.spotlight,
    // A flat team is a lie, and it is the lie that decides whether this works:
    // fifty people reporting to one node is a fifty-wide span no lattice can
    // seat. Given a real tree it is spans of two to five.
    inTeamSpan: strata === "people" ? [2, 5] : undefined,
  });

  /** Person id → the team they sit in, for the layout's cohesion grouping. */
  const teamOf = new Map<string, string>();
  for (const a of org.assignments) {
    if (a.personId && !teamOf.has(a.personId)) teamOf.set(a.personId, a.orgUnitId);
  }
  /**
   * A team's lead hangs off the **team**, not off their own manager.
   *
   * The fixture gives a lead a `managerId` pointing at the lead of the unit
   * above — true to life, and wrong here: following it made every lead chain
   * to the lead above them, so the whole company's people formed one tree
   * hanging off the CEO and every team cell was a childless orphan sitting
   * among the units. That is what stranded team nodes 17 to 19 cells from
   * their own people. The reporting line a lead has upward is drawn by the
   * team's own chain to its parent unit; the person belongs to the team.
   */
  const leadOf = new Map(org.units.filter((u) => u.leadPersonId).map((u) => [u.leadPersonId!, u.id]));
  const peopleById = new Map(org.people.map((p) => [p.id, p]));
  const personUnits = strata === "people"
    ? [...teamOf].map(([personId, unitId]) => {
        const manager = peopleById.get(personId)?.managerId ?? null;
        const leads = leadOf.get(personId);
        return {
          id: `person:${personId}`,
          name: peopleById.get(personId)?.name ?? personId,
          parentId: leads ? leads : manager ? `person:${manager}` : unitId,
          leadPersonId: null,
          team: unitId,
          /** Drawn differently: this person leads the unit they hang from. */
          isLead: Boolean(leads),
        };
      })
    : [];

  // Only the fields `buildOrbitalTree` reads — the rest of a seeded company is
  // weight this page would carry for nothing.
  const payload: OrgInput = {
    units: [
      ...org.units.map((u) => ({
        id: u.id,
        name: u.name,
        parentId: u.parentId ?? null,
        leadPersonId: u.leadPersonId ?? null,
      })),
      ...personUnits.map(({ team, isLead, ...u }) => { void team; void isLead; return u; }),
    ],
    // With people promoted to units they are no longer seats, so the unit tree
    // is the whole picture and nothing orbits anything.
    people: strata === "people" ? [] : org.people.map((p) => ({ id: p.id, name: p.name })),
    assignments: strata === "people" ? [] : org.assignments.map((a) => ({
      personId: a.personId,
      orgUnitId: a.orgUnitId,
      allocationPct: a.allocationPct ?? 100,
    })),
  };


  return {
    org: payload,
    groups: personUnits.map((u) => [u.id, u.team]),
    leads: personUnits.filter((u) => u.isLead).map((u) => u.id),
  };
}
