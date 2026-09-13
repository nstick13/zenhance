import type { OrgInput } from "../model";

/**
 * A miniature of the real demo org's shape: a holding company whose only
 * child is the delivery group, value streams under that, teams under those,
 * and leads who hold no assignment on the unit they lead (which is how a
 * human ends up orbiting a group rather than a team).
 */
export function demoInput(): OrgInput {
  return {
    units: [
      { id: "company", name: "Digital Tailoring", parentId: null },
      { id: "delivery", name: "Delivery Group", parentId: "company", leadPersonId: "sarah" },
      { id: "atlas", name: "Atlas", parentId: "delivery", leadPersonId: "aimee" },
      { id: "orion", name: "Orion", parentId: "delivery", leadPersonId: "aaron" },
      { id: "vega", name: "Vega", parentId: "delivery", leadPersonId: "nadia" },
      { id: "starlight", name: "Starlight", parentId: "atlas", leadPersonId: "tom" },
      { id: "moonlight", name: "Moonlight", parentId: "atlas" },
      { id: "earthlight", name: "Earthlight", parentId: "orion" },
      { id: "ironclad", name: "Ironclad", parentId: "vega" },
      {
        id: "infosys",
        name: "Infosys Contractors",
        parentId: "delivery",
        isExternal: true,
        vendorName: "Infosys",
      },
    ],
    people: [
      { id: "sarah", name: "Sarah Reeve", title: "Delivery Director" },
      { id: "aimee", name: "Aimee Bradford", title: "Stream Lead" },
      { id: "aaron", name: "Aaron Richter", title: "Stream Lead" },
      { id: "nadia", name: "Nadia Khan", title: "Stream Lead" },
      { id: "tom", name: "Thomas Le", title: "Team Lead" },
      { id: "ana", name: "Ana Silva", title: "Engineer" },
      { id: "ben", name: "Ben Carter", title: "Engineer" },
      { id: "cara", name: "Cara Diaz", title: "QA" },
      { id: "marcus", name: "Marcus Webb", title: "SRE" },
    ],
    assignments: [
      { personId: "tom", orgUnitId: "starlight", allocationPct: 100, roleOnTeam: "Team Lead" },
      { personId: "ana", orgUnitId: "starlight", allocationPct: 100 },
      { personId: "ben", orgUnitId: "starlight", allocationPct: 100 },
      { personId: "marcus", orgUnitId: "starlight", allocationPct: 40 },
      { personId: "marcus", orgUnitId: "moonlight", allocationPct: 40 },
      { personId: "cara", orgUnitId: "moonlight", allocationPct: 100 },
      { personId: "ana", orgUnitId: "earthlight", allocationPct: 50 },
      { personId: null, orgUnitId: "earthlight", isOpenRole: true, roleOnTeam: "Engineer" },
      { personId: "ben", orgUnitId: "ironclad", allocationPct: 20 },
    ],
  };
}
