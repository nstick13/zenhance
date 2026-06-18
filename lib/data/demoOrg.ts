import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

/**
 * The canonical Zenhance demo org — a single source of truth consumed by both
 * seeders (the `tsx` CLI in `lib/db/seed.ts` and the in-app "Load demo org" in
 * `lib/data/demoSeed.ts`) so the two can never drift.
 *
 * This is the *pitch* org: ~45 people across three release trains, deliberately
 * messy so every analytic has something visceral to surface —
 *   - cross-cutting supporters (SRE / security / platform / data / agile coach)
 *     embedded across multiple teams → over-allocation + team coupling
 *   - open roles vs. targetHeadcount → staffing gaps
 *   - formal reporting lines that skip levels and diverge from delivery teams
 *   - contractors alongside FTEs, varied cost / tenure / stale vacation dates
 *
 * Everything is referenced by *name* here; `applyDemoOrg` resolves names to ids
 * at insert time. Cross-cutting people are embedded into each team they support
 * (data-only) — the "orbit the train" rendering is a separate viz story.
 */

export type DemoPerson = {
  name: string;
  title: string;
  costPerMonth: number;
  skills: string[];
  startDate?: string;
  growthFocus?: string;
  lastVacationAt?: string;
  /** Name of this person's formal manager; resolved to managerId. */
  manager?: string;
};

export type DemoUnit = {
  name: string;
  kind: "group" | "team";
  /** Name of parent unit; omit for the root. Parents must precede children. */
  parent?: string;
  /** Name of the lead person. */
  lead?: string;
  targetHeadcount?: number;
  isExternal?: boolean;
  vendorName?: string;
  costPerMonth?: number;
  expectedRoi?: number;
};

export type DemoAssignment = {
  /** Person name, or null for an open role. */
  person: string | null;
  /** Unit name. */
  unit: string;
  role: string;
  allocationPct?: number;
  isOpenRole?: boolean;
};

// --- people ----------------------------------------------------------------
export const demoPeople: DemoPerson[] = [
  // Leadership
  { name: "Sarah Reeve", title: "Delivery Lead", costPerMonth: 15500, skills: ["Leadership", "SAFe", "Org design"], startDate: "2017-02-01", growthFocus: "Scaling delivery" },
  { name: "Aimee Bradford", title: "RTE — Atlas", costPerMonth: 12800, skills: ["Leadership", "Architecture", "Java"], startDate: "2019-06-15", lastVacationAt: "2025-09-01", manager: "Sarah Reeve" },
  { name: "Aaron Richter", title: "RTE — Orion", costPerMonth: 12600, skills: ["Leadership", "Go", "Platform"], startDate: "2018-05-01", manager: "Sarah Reeve" },
  { name: "Nadia Khan", title: "RTE — Vega", costPerMonth: 12400, skills: ["Leadership", "Product", "Agile"], startDate: "2019-09-01", manager: "Sarah Reeve" },

  // Cross-cutting supporters — report straight to Sarah (skip-level mess)
  { name: "Marcus Webb", title: "Staff SRE", costPerMonth: 12200, skills: ["Kubernetes", "Terraform", "Observability"], startDate: "2020-03-01", lastVacationAt: "2023-06-01", growthFocus: "Platform leadership", manager: "Sarah Reeve" },
  { name: "Devraj Patel", title: "Security Engineer", costPerMonth: 11800, skills: ["AppSec", "Threat modeling", "Compliance"], startDate: "2020-08-01", lastVacationAt: "2023-02-01", manager: "Sarah Reeve" },
  { name: "Grace Okafor", title: "Staff Platform Engineer", costPerMonth: 11600, skills: ["Go", "Kubernetes", "CI/CD"], startDate: "2021-01-15", manager: "Sarah Reeve" },
  { name: "Yuki Tanaka", title: "Data / Analytics Engineer", costPerMonth: 10900, skills: ["SQL", "dbt", "Python"], startDate: "2021-07-01", manager: "Sarah Reeve" },
  { name: "Helena Brandt", title: "Agile Coach", costPerMonth: 10200, skills: ["Coaching", "SAFe", "Facilitation"], startDate: "2019-11-01", manager: "Sarah Reeve" },

  // Atlas — Starlight
  { name: "Thomas Le", title: "Senior Engineer", costPerMonth: 10200, skills: ["Java", "Kafka", "Microservices"], startDate: "2020-03-01", manager: "Aimee Bradford" },
  { name: "Angela Smith", title: "Engineer", costPerMonth: 9200, skills: ["Java", "JavaScript", "CRM"], startDate: "2022-01-10", growthFocus: "Archaeology of legacy code", lastVacationAt: "2023-01-05", manager: "Aimee Bradford" },
  { name: "Areline De Lisle", title: "QA Engineer", costPerMonth: 8500, skills: ["QA", "Automation", "Cypress"], startDate: "2021-09-01", manager: "Thomas Le" },
  { name: "Ben Carter", title: "Engineer", costPerMonth: 7600, skills: ["JavaScript", "React"], startDate: "2024-02-01", manager: "Sarah Reeve" }, // skip-level: junior reporting to delivery lead
  { name: "Owen Reilly", title: "Engineer", costPerMonth: 8100, skills: ["Java", "Spring"], startDate: "2023-05-01", manager: "Thomas Le" },

  // Atlas — Moonlight
  { name: "Priya Nair", title: "Engineer", costPerMonth: 9100, skills: ["Java", "Spring", "Kafka"], startDate: "2021-04-01", manager: "Aimee Bradford" },
  { name: "Richard Stewartson", title: "Database Engineer", costPerMonth: 9600, skills: ["Postgres", "ETL", "Performance"], startDate: "2020-11-01", manager: "Priya Nair" },
  { name: "Sofia Marchetti", title: "Engineer", costPerMonth: 8900, skills: ["JavaScript", "React", "Node"], startDate: "2023-01-15", manager: "Aaron Richter" }, // divergence: delivers Atlas, reports Orion
  { name: "Naomi Cole", title: "QA Engineer", costPerMonth: 8200, skills: ["QA", "Selenium"], startDate: "2022-10-01", manager: "Priya Nair" },

  // Atlas — Nebula
  { name: "Liam Walsh", title: "Senior Engineer", costPerMonth: 10100, skills: ["Go", "gRPC", "Distributed systems"], startDate: "2020-07-01", manager: "Aimee Bradford" },
  { name: "Hana Kim", title: "Engineer", costPerMonth: 8700, skills: ["Go", "Kubernetes"], startDate: "2022-06-01", manager: "Liam Walsh" },
  { name: "Tobias Frank", title: "Engineer", costPerMonth: 8400, skills: ["Rust", "Go"], startDate: "2023-03-01", manager: "Liam Walsh" },
  { name: "Felix Braun", title: "QA Engineer", costPerMonth: 7900, skills: ["QA", "Performance testing"], startDate: "2024-04-01", manager: "Liam Walsh" },

  // Orion — Earthlight
  { name: "Lena Ortiz", title: "QA Lead", costPerMonth: 9300, skills: ["QA", "Selenium", "Leadership"], startDate: "2021-02-01", manager: "Aaron Richter" },
  { name: "Carlos Mendes", title: "Engineer", costPerMonth: 8800, skills: ["Java", "Spring"], startDate: "2022-03-01", manager: "Aimee Bradford" }, // divergence: delivers Orion, reports Atlas
  { name: "Sven Larsson", title: "Senior Engineer", costPerMonth: 10000, skills: ["Java", "Architecture"], startDate: "2019-08-01", manager: "Aaron Richter" },
  { name: "Aisha Bello", title: "Engineer", costPerMonth: 8300, skills: ["JavaScript", "React"], startDate: "2023-07-01", manager: "Lena Ortiz" },
  { name: "Zara Haddad", title: "Engineer", costPerMonth: 8000, skills: ["Python", "Django"], startDate: "2024-01-10" }, // recent hire, no manager set (data gap)

  // Orion — Dawnbreak
  { name: "Hannah Schmidt", title: "Engineer", costPerMonth: 9000, skills: ["Java", "Kafka"], startDate: "2021-05-01", manager: "Aaron Richter" },
  { name: "Omar Farouk", title: "Engineer", costPerMonth: 8600, skills: ["Go", "Kubernetes"], startDate: "2022-09-01", manager: "Hannah Schmidt" },
  { name: "Mateo Rossi", title: "Engineer", costPerMonth: 8200, skills: ["JavaScript", "Vue"], startDate: "2023-04-01", manager: "Hannah Schmidt" },
  { name: "Chloe Dubois", title: "QA Engineer", costPerMonth: 7800, skills: ["QA", "Automation"], startDate: "2024-03-01", manager: "Hannah Schmidt" },

  // Orion — Tideway
  { name: "Diego Alvarez", title: "Senior Engineer", costPerMonth: 9900, skills: ["Java", "Architecture", "Kafka"], startDate: "2020-02-01", manager: "Aaron Richter" },
  { name: "Mei Lin", title: "Engineer", costPerMonth: 8500, skills: ["Java", "Spring"], startDate: "2022-11-01", manager: "Diego Alvarez" },
  { name: "Paul Nguyen", title: "Engineer", costPerMonth: 8100, skills: ["Go", "gRPC"], startDate: "2023-06-01", manager: "Diego Alvarez" },
  { name: "Sara Lindqvist", title: "QA Engineer", costPerMonth: 7700, skills: ["QA", "Cypress"], startDate: "2024-05-01", manager: "Diego Alvarez" },

  // Vega — Ironclad
  { name: "Fatima Noor", title: "Team Lead", costPerMonth: 10300, skills: ["Leadership", "Java", "Security"], startDate: "2019-04-01", manager: "Nadia Khan" },
  { name: "Jonas Berg", title: "Engineer", costPerMonth: 8800, skills: ["Java", "Spring"], startDate: "2022-02-01", manager: "Fatima Noor" },
  { name: "Ingrid Solberg", title: "Engineer", costPerMonth: 8400, skills: ["Go", "Kubernetes"], startDate: "2023-02-01", manager: "Fatima Noor" },
  { name: "Kwame Mensah", title: "QA Engineer", costPerMonth: 7900, skills: ["QA", "Automation"], startDate: "2023-09-01", manager: "Fatima Noor" },

  // Vega — Lighthouse
  { name: "Ravi Kapoor", title: "Senior Engineer", costPerMonth: 10000, skills: ["Java", "Architecture"], startDate: "2020-10-01", manager: "Nadia Khan" },
  { name: "Emma Thompson", title: "QA Engineer", costPerMonth: 8300, skills: ["QA", "Selenium"], startDate: "2022-07-01", manager: "Ravi Kapoor" },
  { name: "Lucas Silva", title: "Engineer", costPerMonth: 8200, skills: ["JavaScript", "React"], startDate: "2023-08-01", manager: "Ravi Kapoor" },
  { name: "Noah Berger", title: "Engineer", costPerMonth: 7800, skills: ["Python", "FastAPI"], startDate: "2024-06-01" }, // recent hire, no manager set

  // Contractors (Infosys)
  { name: "Vikram Rao", title: "Contractor — Engineer", costPerMonth: 7000, skills: ["Java", "Spring"], startDate: "2024-09-01" },
  { name: "Anita Desai", title: "Contractor — QA", costPerMonth: 6800, skills: ["QA", "Automation"], startDate: "2025-01-01" },
];

// --- units (parents precede children) --------------------------------------
export const demoUnits: DemoUnit[] = [
  { name: "Digital Tailoring Supplies", kind: "group" },
  { name: "Delivery Group", kind: "group", parent: "Digital Tailoring Supplies", lead: "Sarah Reeve", expectedRoi: 28000000 },

  // Release trains (sub-groups)
  { name: "Atlas", kind: "group", parent: "Delivery Group", lead: "Aimee Bradford", expectedRoi: 11000000 },
  { name: "Orion", kind: "group", parent: "Delivery Group", lead: "Aaron Richter", expectedRoi: 9500000 },
  { name: "Vega", kind: "group", parent: "Delivery Group", lead: "Nadia Khan", expectedRoi: 6500000 },

  // Atlas teams
  { name: "Starlight", kind: "team", parent: "Atlas", lead: "Thomas Le", targetHeadcount: 6, expectedRoi: 4200000 },
  { name: "Moonlight", kind: "team", parent: "Atlas", lead: "Priya Nair", targetHeadcount: 6, expectedRoi: 3600000 },
  { name: "Nebula", kind: "team", parent: "Atlas", lead: "Liam Walsh", targetHeadcount: 5, expectedRoi: 3200000 },

  // Orion teams
  { name: "Earthlight", kind: "team", parent: "Orion", lead: "Lena Ortiz", targetHeadcount: 6, expectedRoi: 3500000 },
  { name: "Dawnbreak", kind: "team", parent: "Orion", lead: "Hannah Schmidt", targetHeadcount: 5, expectedRoi: 3000000 },
  { name: "Tideway", kind: "team", parent: "Orion", lead: "Diego Alvarez", targetHeadcount: 5, expectedRoi: 2800000 },

  // Vega teams
  { name: "Ironclad", kind: "team", parent: "Vega", lead: "Fatima Noor", targetHeadcount: 6, expectedRoi: 3400000 },
  { name: "Lighthouse", kind: "team", parent: "Vega", lead: "Ravi Kapoor", targetHeadcount: 5, expectedRoi: 2600000 },

  // Contractors — sit under Delivery Group, cross-cutting vendor team
  { name: "Infosys Contractors", kind: "team", parent: "Delivery Group", isExternal: true, vendorName: "Infosys", costPerMonth: 52000, targetHeadcount: 4 },
];

// --- assignments -----------------------------------------------------------
// Supporters are embedded into each team they touch; that's what drives the
// over-allocation and coupling findings. Open roles carry person: null.
export const demoAssignments: DemoAssignment[] = [
  // Atlas — Starlight
  { person: "Thomas Le", unit: "Starlight", role: "Team Lead" },
  { person: "Angela Smith", unit: "Starlight", role: "Engineer", allocationPct: 60 }, // multi-team
  { person: "Areline De Lisle", unit: "Starlight", role: "QA" },
  { person: "Ben Carter", unit: "Starlight", role: "Engineer" },
  { person: "Owen Reilly", unit: "Starlight", role: "Engineer" },
  { person: "Marcus Webb", unit: "Starlight", role: "SRE", allocationPct: 40 }, // supporter
  { person: "Grace Okafor", unit: "Starlight", role: "Platform", allocationPct: 40 }, // supporter
  { person: null, unit: "Starlight", role: "Engineer", isOpenRole: true },

  // Atlas — Moonlight
  { person: "Priya Nair", unit: "Moonlight", role: "Team Lead" },
  { person: "Richard Stewartson", unit: "Moonlight", role: "Database Engineer" },
  { person: "Sofia Marchetti", unit: "Moonlight", role: "Engineer" },
  { person: "Naomi Cole", unit: "Moonlight", role: "QA" },
  { person: "Angela Smith", unit: "Moonlight", role: "Engineer", allocationPct: 40 }, // multi-team
  { person: "Marcus Webb", unit: "Moonlight", role: "SRE", allocationPct: 40 }, // supporter
  { person: "Yuki Tanaka", unit: "Moonlight", role: "Data", allocationPct: 35 }, // supporter
  { person: null, unit: "Moonlight", role: "Engineer", isOpenRole: true },

  // Atlas — Nebula
  { person: "Liam Walsh", unit: "Nebula", role: "Team Lead" },
  { person: "Hana Kim", unit: "Nebula", role: "Engineer" },
  { person: "Tobias Frank", unit: "Nebula", role: "Engineer" },
  { person: "Felix Braun", unit: "Nebula", role: "QA" },
  { person: "Marcus Webb", unit: "Nebula", role: "SRE", allocationPct: 40 }, // supporter
  { person: "Grace Okafor", unit: "Nebula", role: "Platform", allocationPct: 40 }, // supporter
  { person: "Devraj Patel", unit: "Nebula", role: "Security", allocationPct: 30 }, // supporter
  { person: null, unit: "Nebula", role: "QA", isOpenRole: true },

  // Orion — Earthlight
  { person: "Lena Ortiz", unit: "Earthlight", role: "Team Lead" },
  { person: "Carlos Mendes", unit: "Earthlight", role: "Engineer" },
  { person: "Sven Larsson", unit: "Earthlight", role: "Senior Engineer" },
  { person: "Aisha Bello", unit: "Earthlight", role: "Engineer" },
  { person: "Zara Haddad", unit: "Earthlight", role: "Engineer" },
  { person: "Devraj Patel", unit: "Earthlight", role: "Security", allocationPct: 30 }, // supporter
  { person: "Yuki Tanaka", unit: "Earthlight", role: "Data", allocationPct: 35 }, // supporter
  { person: null, unit: "Earthlight", role: "Engineer", isOpenRole: true },

  // Orion — Dawnbreak
  { person: "Hannah Schmidt", unit: "Dawnbreak", role: "Team Lead" },
  { person: "Omar Farouk", unit: "Dawnbreak", role: "Engineer" },
  { person: "Mateo Rossi", unit: "Dawnbreak", role: "Engineer" },
  { person: "Chloe Dubois", unit: "Dawnbreak", role: "QA" },
  { person: "Devraj Patel", unit: "Dawnbreak", role: "Security", allocationPct: 30 }, // supporter
  { person: "Yuki Tanaka", unit: "Dawnbreak", role: "Data", allocationPct: 35 }, // supporter
  { person: null, unit: "Dawnbreak", role: "QA", isOpenRole: true },

  // Orion — Tideway
  { person: "Diego Alvarez", unit: "Tideway", role: "Team Lead" },
  { person: "Mei Lin", unit: "Tideway", role: "Engineer" },
  { person: "Paul Nguyen", unit: "Tideway", role: "Engineer" },
  { person: "Sara Lindqvist", unit: "Tideway", role: "QA" },
  { person: "Helena Brandt", unit: "Tideway", role: "Scrum Master", allocationPct: 50 }, // supporter
  { person: null, unit: "Tideway", role: "Engineer", isOpenRole: true },

  // Vega — Ironclad
  { person: "Fatima Noor", unit: "Ironclad", role: "Team Lead" },
  { person: "Jonas Berg", unit: "Ironclad", role: "Engineer" },
  { person: "Ingrid Solberg", unit: "Ironclad", role: "Engineer" },
  { person: "Kwame Mensah", unit: "Ironclad", role: "QA" },
  { person: "Devraj Patel", unit: "Ironclad", role: "Security", allocationPct: 30 }, // supporter
  { person: null, unit: "Ironclad", role: "Engineer", isOpenRole: true },

  // Vega — Lighthouse
  { person: "Ravi Kapoor", unit: "Lighthouse", role: "Team Lead" },
  { person: "Emma Thompson", unit: "Lighthouse", role: "QA" },
  { person: "Lucas Silva", unit: "Lighthouse", role: "Engineer" },
  { person: "Noah Berger", unit: "Lighthouse", role: "Engineer" },
  { person: "Helena Brandt", unit: "Lighthouse", role: "Scrum Master", allocationPct: 50 }, // supporter
  { person: null, unit: "Lighthouse", role: "Engineer", isOpenRole: true },

  // Contractors
  { person: "Vikram Rao", unit: "Infosys Contractors", role: "Contractor" },
  { person: "Anita Desai", unit: "Infosys Contractors", role: "Contractor" },
  { person: null, unit: "Infosys Contractors", role: "Contractor", isOpenRole: true },
  { person: null, unit: "Infosys Contractors", role: "Contractor", isOpenRole: true },
];

/**
 * Wipe and re-seed a workspace's org with the canonical demo data.
 * Works with any postgres.js Drizzle client (the CLI seed and the app share the
 * same schema). Idempotent — clears the workspace's org data first.
 */
export async function applyDemoOrg(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
): Promise<{ people: number; units: number; assignments: number }> {
  const { people, orgUnits, assignments } = schema;
  const wid = workspaceId;

  // Clear existing org data (assignments cascade from people/units anyway).
  await db.delete(assignments).where(eq(assignments.workspaceId, wid));
  await db.delete(orgUnits).where(eq(orgUnits.workspaceId, wid));
  await db.delete(people).where(eq(people.workspaceId, wid));

  // People — insert first (without managers), then wire managerId by name.
  const insertedPeople = await db
    .insert(people)
    .values(
      demoPeople.map((p) => ({
        workspaceId: wid,
        name: p.name,
        title: p.title,
        costPerMonth: p.costPerMonth.toString(),
        skills: p.skills,
        startDate: p.startDate ?? null,
        growthFocus: p.growthFocus ?? null,
        lastVacationAt: p.lastVacationAt ?? null,
      })),
    )
    .returning();
  const personId = Object.fromEntries(insertedPeople.map((p) => [p.name, p.id])) as Record<string, string>;

  for (const p of demoPeople) {
    if (!p.manager) continue;
    await db
      .update(people)
      .set({ managerId: personId[p.manager] })
      .where(eq(people.id, personId[p.name]));
  }

  // Units — sequential so each parent id exists before its children.
  const unitId: Record<string, string> = {};
  for (const u of demoUnits) {
    const [row] = await db
      .insert(orgUnits)
      .values({
        workspaceId: wid,
        name: u.name,
        kind: u.kind,
        parentId: u.parent ? unitId[u.parent] : null,
        leadPersonId: u.lead ? personId[u.lead] : null,
        targetHeadcount: u.targetHeadcount ?? null,
        isExternal: u.isExternal ?? false,
        vendorName: u.vendorName ?? null,
        costPerMonth: u.costPerMonth != null ? u.costPerMonth.toString() : null,
        expectedRoi: u.expectedRoi != null ? u.expectedRoi.toString() : null,
      })
      .returning();
    unitId[u.name] = row.id;
  }

  // Assignments.
  await db.insert(assignments).values(
    demoAssignments.map((a) => ({
      workspaceId: wid,
      personId: a.person ? personId[a.person] : null,
      orgUnitId: unitId[a.unit],
      roleOnTeam: a.role,
      allocationPct: a.allocationPct ?? 100,
      isOpenRole: a.isOpenRole ?? false,
    })),
  );

  return {
    people: demoPeople.length,
    units: demoUnits.length,
    assignments: demoAssignments.length,
  };
}
