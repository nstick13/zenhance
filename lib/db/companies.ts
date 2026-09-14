import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { buildDeepOrg } from "./deepOrg";
import { DEMO_COMPANIES, type DemoCompanyKind } from "@/lib/demoCompanies";

/**
 * Two more companies for the dev user, so the map can be judged at sizes the
 * 45-person demo org can't show (Greg, 2026-09-14):
 *
 *   - **Sparrow Jam Manufacturing, OH** — ten people, two lines and an
 *     oversight group. Small enough that every person, every ring and every
 *     work item is on screen at once.
 *   - **Northwind Freight & Logistics** — ~2,400 people over eleven rungs,
 *     with delivery teams surfacing at every depth from CEO+2 to CEO+11
 *     (lib/db/deepOrg.ts). Invented name and synthetic people, but a real
 *     enterprise *shape*: ragged depth, cross-cutting supporters, and formal
 *     reporting lines that diverge from the delivery structure.
 *
 * Both are seeded as workspaces the dev user is a member of, which is what
 * makes them appear in the header's company switcher. The demo org is left
 * exactly as it is and stays the default.
 *
 * Idempotent: re-running clears and rebuilds only these two workspaces.
 * CLI: `npm run db:companies`.
 */

const OWNER = "dev-user";

export { DEMO_COMPANIES, type DemoCompanyKind } from "@/lib/demoCompanies";

export const SPARROW_WORKSPACE = DEMO_COMPANIES.small.name;
export const LARGE_WORKSPACE = DEMO_COMPANIES.large.name;

type Db = PostgresJsDatabase<typeof schema>;

async function insertInChunks<T>(
  db: Db,
  table: unknown,
  rows: T[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.insert(table as any).values(chunk as any);
  }
}

/** Find or create a workspace by name, owned by `owner`, with membership. */
async function workspaceNamed(db: Db, name: string, owner: string = OWNER): Promise<string> {
  const { workspaces, memberships } = schema;
  const existing = (
    await db.select().from(workspaces).where(eq(workspaces.name, name)).limit(1)
  )[0];
  const ws =
    existing ??
    (await db.insert(workspaces).values({ name, ownerUserId: owner }).returning())[0];
  await db
    .insert(memberships)
    .values({ workspaceId: ws.id, userId: owner, role: "owner" })
    .onConflictDoNothing();
  return ws.id;
}

async function clearOrg(db: Db, wid: string): Promise<void> {
  const { people, orgUnits, assignments, disciplines } = schema;
  await db.delete(assignments).where(eq(assignments.workspaceId, wid));
  await db.delete(orgUnits).where(eq(orgUnits.workspaceId, wid));
  await db.delete(people).where(eq(people.workspaceId, wid));
  await db.delete(disciplines).where(eq(disciplines.workspaceId, wid));
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// --- Sparrow Jam ------------------------------------------------------------

type JamPerson = {
  name: string;
  title: string;
  discipline: string;
  cost: number;
  startedDaysAgo: number;
  vacationDaysAgo: number | null;
  manager?: string;
};

const JAM_DISCIPLINES = ["Production", "Quality", "Logistics", "Maintenance", "Leadership"];

const JAM_PEOPLE: JamPerson[] = [
  { name: "Marilyn Vasquez", title: "Plant Manager", discipline: "Leadership", cost: 9200, startedDaysAgo: 3400, vacationDaysAgo: 120 },
  { name: "Dale Brenner", title: "Quality & Compliance", discipline: "Quality", cost: 6400, startedDaysAgo: 2100, vacationDaysAgo: 620, manager: "Marilyn Vasquez" },
  { name: "Rosa Kerrigan", title: "Line Lead — Preserves", discipline: "Production", cost: 6100, startedDaysAgo: 2600, vacationDaysAgo: 240, manager: "Marilyn Vasquez" },
  { name: "Anita Cho", title: "Preserves Operator", discipline: "Production", cost: 4300, startedDaysAgo: 900, vacationDaysAgo: 150, manager: "Rosa Kerrigan" },
  { name: "Sam Whitfield", title: "Preserves Operator", discipline: "Production", cost: 4150, startedDaysAgo: 420, vacationDaysAgo: 90, manager: "Rosa Kerrigan" },
  { name: "Bea Lindqvist", title: "Batch Technician", discipline: "Quality", cost: 4800, startedDaysAgo: 1500, vacationDaysAgo: 700, manager: "Rosa Kerrigan" },
  { name: "Curtis Nowak", title: "Line Lead — Packing", discipline: "Logistics", cost: 5900, startedDaysAgo: 2200, vacationDaysAgo: 310, manager: "Marilyn Vasquez" },
  { name: "Tomas Reyes", title: "Packing Operator", discipline: "Logistics", cost: 4100, startedDaysAgo: 650, vacationDaysAgo: 200, manager: "Curtis Nowak" },
  { name: "Gail Ferriday", title: "Dispatch Coordinator", discipline: "Logistics", cost: 4600, startedDaysAgo: 1800, vacationDaysAgo: null, manager: "Curtis Nowak" },
  { name: "Herb Tanaka", title: "Maintenance Engineer", discipline: "Maintenance", cost: 5400, startedDaysAgo: 3000, vacationDaysAgo: 540, manager: "Marilyn Vasquez" },
];

const JAM_UNITS: { name: string; kind: "group" | "team"; parent?: string; lead?: string; target?: number }[] = [
  { name: SPARROW_WORKSPACE, kind: "group" },
  { name: "Oversight", kind: "group", parent: SPARROW_WORKSPACE, lead: "Marilyn Vasquez" },
  { name: "Preserves Line", kind: "team", parent: SPARROW_WORKSPACE, lead: "Rosa Kerrigan", target: 4 },
  { name: "Packing & Dispatch", kind: "team", parent: SPARROW_WORKSPACE, lead: "Curtis Nowak", target: 4 },
];

const JAM_ASSIGNMENTS: { person: string | null; unit: string; role: string; pct?: number; open?: boolean }[] = [
  { person: "Marilyn Vasquez", unit: "Oversight", role: "Plant Manager" },
  { person: "Dale Brenner", unit: "Oversight", role: "Quality & Compliance" },
  { person: "Rosa Kerrigan", unit: "Preserves Line", role: "Line Lead" },
  { person: "Anita Cho", unit: "Preserves Line", role: "Operator" },
  { person: "Sam Whitfield", unit: "Preserves Line", role: "Operator" },
  { person: "Bea Lindqvist", unit: "Preserves Line", role: "Batch Technician" },
  { person: "Curtis Nowak", unit: "Packing & Dispatch", role: "Line Lead" },
  { person: "Tomas Reyes", unit: "Packing & Dispatch", role: "Operator" },
  { person: "Gail Ferriday", unit: "Packing & Dispatch", role: "Dispatch" },
  // One person genuinely split across both lines, so even a ten-person org
  // shows the shared-seat case the map draws with a dashed ring.
  { person: "Herb Tanaka", unit: "Preserves Line", role: "Maintenance", pct: 50 },
  { person: "Herb Tanaka", unit: "Packing & Dispatch", role: "Maintenance", pct: 50 },
  { person: null, unit: "Packing & Dispatch", role: "Operator", open: true },
];

export async function seedSparrowJam(db: Db, wid: string): Promise<{ people: number; units: number }> {
  const { people, orgUnits, assignments, disciplines } = schema;
  await clearOrg(db, wid);

  const discId: Record<string, string> = {};
  for (const [i, name] of JAM_DISCIPLINES.entries()) {
    const [row] = await db
      .insert(disciplines)
      .values({ workspaceId: wid, name, color: "#5c6570", sortOrder: i })
      .returning();
    discId[name] = row.id;
  }

  const personId: Record<string, string> = {};
  for (const p of JAM_PEOPLE) {
    const [row] = await db
      .insert(people)
      .values({
        workspaceId: wid,
        name: p.name,
        title: p.title,
        startDate: daysAgo(p.startedDaysAgo),
        costPerMonth: p.cost.toString(),
        lastVacationAt: p.vacationDaysAgo === null ? null : daysAgo(p.vacationDaysAgo),
        disciplineId: discId[p.discipline] ?? null,
        employment: "fte",
        location: "Columbus, OH",
        timezone: "America/New_York",
      })
      .returning();
    personId[p.name] = row.id;
  }
  for (const p of JAM_PEOPLE) {
    if (!p.manager) continue;
    await db
      .update(people)
      .set({ managerId: personId[p.manager] })
      .where(eq(people.id, personId[p.name]));
  }

  const unitId: Record<string, string> = {};
  for (const u of JAM_UNITS) {
    const [row] = await db
      .insert(orgUnits)
      .values({
        workspaceId: wid,
        name: u.name,
        kind: u.kind,
        parentId: u.parent ? unitId[u.parent] : null,
        leadPersonId: u.lead ? personId[u.lead] : null,
        targetHeadcount: u.target ?? null,
      })
      .returning();
    unitId[u.name] = row.id;
  }

  await db.insert(assignments).values(
    JAM_ASSIGNMENTS.map((a) => ({
      workspaceId: wid,
      personId: a.person ? personId[a.person] : null,
      orgUnitId: unitId[a.unit],
      roleOnTeam: a.role,
      allocationPct: a.pct ?? 100,
      isOpenRole: a.open ?? false,
    })),
  );

  return { people: JAM_PEOPLE.length, units: JAM_UNITS.length };
}

// --- the large one ----------------------------------------------------------

export async function seedLarge(db: Db, wid: string): Promise<{ people: number; units: number; teams: number; depth: number }> {
  const { people, orgUnits, assignments, disciplines } = schema;
  await clearOrg(db, wid);

  const org = buildDeepOrg(wid, {
    people: 2400,
    maxDepth: 11,
    seed: 20260914,
    rootName: LARGE_WORKSPACE,
  });

  await insertInChunks(db, disciplines, org.disciplines);
  // People before units: org_units.leadPersonId references people.id. And
  // managers are wired afterwards: a person's manager can land in a later
  // chunk, and Postgres checks the self-reference at end of *statement*, not
  // end of transaction.
  const managers = org.people
    .filter((p) => p.managerId)
    .map((p) => ({ id: p.id, managerId: p.managerId! }));
  await insertInChunks(db, people, org.people.map((p) => ({ ...p, managerId: null })));
  // Units are generated parents-first, which the FKs require.
  await insertInChunks(db, orgUnits, org.units);
  await insertInChunks(db, assignments, org.assignments);

  for (const m of managers) {
    await db.update(people).set({ managerId: m.managerId }).where(eq(people.id, m.id));
  }

  const byId = new Map(org.units.map((u) => [u.id, u]));
  const depthOf = (u: (typeof org.units)[number]) => {
    let d = 0;
    let cursor = u.parentId;
    while (cursor && d < 25) {
      d += 1;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return d;
  };
  return {
    people: org.people.length,
    units: org.units.length,
    teams: org.units.filter((u) => u.kind === "team").length,
    depth: Math.max(...org.units.map(depthOf)),
  };
}

/**
 * Fill an existing, empty workspace with one of the demo companies. The caller
 * owns creating the workspace and its membership, which is what lets the same
 * code seed for `dev-user` from the CLI and for a signed-in Clerk user from
 * the app. Re-running clears that workspace's org first, so it's idempotent.
 */
export async function seedDemoCompanyInto(
  db: Db,
  wid: string,
  kind: DemoCompanyKind,
): Promise<{ people: number; units: number }> {
  return kind === "small" ? seedSparrowJam(db, wid) : seedLarge(db, wid);
}

async function main() {
  // CLI-only bootstrap. Kept inside main() so importing this module from the
  // app (for the in-app "start from an example" action) doesn't run dotenv or
  // open a second connection pool.
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  config();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });

  const jam = await seedSparrowJam(db, await workspaceNamed(db, SPARROW_WORKSPACE));
  console.log(`Seeded "${SPARROW_WORKSPACE}":`, jam);

  const large = await seedLarge(db, await workspaceNamed(db, LARGE_WORKSPACE));
  console.log(`Seeded "${LARGE_WORKSPACE}":`, large);

  console.log("\nBoth are now in the header's company switcher for dev-user.");
  await sql.end();
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
