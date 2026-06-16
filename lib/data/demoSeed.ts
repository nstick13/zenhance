import { db } from "@/lib/db/client";
import { people, orgUnits, assignments } from "@/lib/db/orm";
import { eq } from "drizzle-orm";

/**
 * Seeds the given workspace with the pitch-deck example org.
 * Idempotent — clears existing org data first.
 */
export async function seedDemoOrg(workspaceId: string): Promise<void> {
  const wid = workspaceId;

  await db.delete(assignments).where(eq(assignments.workspaceId, wid));
  await db.delete(orgUnits).where(eq(orgUnits.workspaceId, wid));
  await db.delete(people).where(eq(people.workspaceId, wid));

  const mk = (
    name: string,
    title: string,
    costPerMonth: number,
    skills: string[],
    extra: Partial<typeof people.$inferInsert> = {},
  ): typeof people.$inferInsert => ({
    workspaceId: wid,
    name,
    title,
    costPerMonth: costPerMonth.toString(),
    skills,
    ...extra,
  });

  const p = await db
    .insert(people)
    .values([
      mk("Sarah Reeve", "Delivery Lead", 14500, ["Leadership", "SAFe"], {
        startDate: "2019-02-01",
        growthFocus: "Org design",
      }),
      mk("Aimee Bradford", "Team Lead", 11200, ["Java", "Architecture"], {
        startDate: "2020-06-15",
        lastVacationAt: "2024-10-01",
      }),
      mk("Thomas Le", "Senior Engineer", 9800, ["Java", "Kafka"], {
        startDate: "2021-03-01",
      }),
      mk("Angela Smith", "Engineer", 9136, ["Java", "JavaScript", "CRM"], {
        startDate: "2022-01-10",
        growthFocus: "Archaeology of legacy code",
        lastVacationAt: "2023-01-05",
      }),
      mk("Areline De Lisle", "QA Engineer", 8400, ["QA", "Automation"], {
        startDate: "2021-09-01",
      }),
      mk("Richard Stewartson", "Database Engineer", 9200, ["Postgres", "ETL"], {
        startDate: "2020-11-01",
      }),
      mk("Aaron Richter", "Team Lead", 11000, ["Leadership", "Go"], {
        startDate: "2018-05-01",
      }),
      mk("Priya Nair", "Engineer", 8900, ["Java", "Spring"], {
        startDate: "2023-04-01",
      }),
      mk("Marcus Webb", "DevOps Engineer", 9700, ["Kubernetes", "Terraform"], {
        startDate: "2022-08-01",
      }),
      mk("Lena Ortiz", "QA Engineer", 8200, ["QA", "Selenium"], {
        startDate: "2023-02-01",
      }),
      mk("Sofia Marchetti", "Engineer", 8700, ["JavaScript", "React"], {
        startDate: "2024-01-15",
      }),
    ])
    .returning();

  const byName = Object.fromEntries(p.map((x) => [x.name, x.id])) as Record<string, string>;

  const [root] = await db
    .insert(orgUnits)
    .values({ workspaceId: wid, name: "Digital Tailoring Supplies", kind: "group" })
    .returning();

  const [delivery] = await db
    .insert(orgUnits)
    .values({
      workspaceId: wid,
      name: "Delivery Group",
      kind: "group",
      parentId: root.id,
      leadPersonId: byName["Sarah Reeve"],
      expectedRoi: "12500000",
    })
    .returning();

  const teams = await db
    .insert(orgUnits)
    .values([
      {
        workspaceId: wid,
        name: "Starlight",
        kind: "team",
        parentId: delivery.id,
        leadPersonId: byName["Aimee Bradford"],
        targetHeadcount: 6,
        expectedRoi: "4200000",
      },
      {
        workspaceId: wid,
        name: "Moonlight",
        kind: "team",
        parentId: delivery.id,
        targetHeadcount: 5,
        expectedRoi: "3100000",
      },
      {
        workspaceId: wid,
        name: "Earthlight",
        kind: "team",
        parentId: delivery.id,
        leadPersonId: byName["Aaron Richter"],
        targetHeadcount: 6,
        expectedRoi: "2000000",
      },
      {
        workspaceId: wid,
        name: "Infosys Contractors",
        kind: "team",
        parentId: delivery.id,
        isExternal: true,
        vendorName: "Infosys",
        costPerMonth: "48000",
        targetHeadcount: 4,
      },
    ])
    .returning();

  const team = Object.fromEntries(teams.map((t) => [t.name, t.id])) as Record<string, string>;

  const assign = (
    personName: string | null,
    unitId: string,
    roleOnTeam: string,
    allocationPct = 100,
    isOpenRole = false,
  ): typeof assignments.$inferInsert => ({
    workspaceId: wid,
    personId: personName ? byName[personName] : null,
    orgUnitId: unitId,
    roleOnTeam,
    allocationPct,
    isOpenRole,
  });

  // Formal reporting lines — diverge from delivery teams intentionally.
  // Richard & Priya: formally under Aaron (Ops) but deliver on Moonlight.
  // Sofia: formally under Aimee (Dev) but delivers on Earthlight.
  const reportsTo: Array<[string, string]> = [
    ["Aimee Bradford",    "Sarah Reeve"],
    ["Aaron Richter",     "Sarah Reeve"],
    ["Thomas Le",         "Aimee Bradford"],
    ["Angela Smith",      "Aimee Bradford"],
    ["Areline De Lisle",  "Aimee Bradford"],
    ["Sofia Marchetti",   "Aimee Bradford"],
    ["Marcus Webb",       "Aaron Richter"],
    ["Lena Ortiz",        "Aaron Richter"],
    ["Richard Stewartson","Aaron Richter"],
    ["Priya Nair",        "Aaron Richter"],
  ];
  for (const [name, mgr] of reportsTo) {
    await db
      .update(people)
      .set({ managerId: byName[mgr] })
      .where(eq(people.id, byName[name]));
  }

  await db.insert(assignments).values([
    assign("Aimee Bradford", team["Starlight"], "Team Lead"),
    assign("Thomas Le", team["Starlight"], "Senior Engineer"),
    assign("Angela Smith", team["Starlight"], "Engineer", 60),
    assign("Areline De Lisle", team["Starlight"], "QA"),
    assign(null, team["Starlight"], "Engineer", 100, true),
    assign(null, team["Starlight"], "Engineer", 100, true),
    assign("Richard Stewartson", team["Moonlight"], "Database Engineer"),
    assign("Priya Nair", team["Moonlight"], "Engineer"),
    assign("Angela Smith", team["Moonlight"], "Engineer", 40),
    assign(null, team["Moonlight"], "QA", 100, true),
    assign("Aaron Richter", team["Earthlight"], "Team Lead"),
    assign("Marcus Webb", team["Earthlight"], "DevOps"),
    assign("Lena Ortiz", team["Earthlight"], "QA"),
    assign("Sofia Marchetti", team["Earthlight"], "Engineer"),
    assign(null, team["Infosys Contractors"], "Contractor", 100, true),
    assign(null, team["Infosys Contractors"], "Contractor", 100, true),
  ]);
}
