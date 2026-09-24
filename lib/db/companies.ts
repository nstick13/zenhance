import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { DEMO_COMPANIES, type DemoCompanyKind } from "@/lib/demoCompanies";

/**
 * A small invented company for the dev user, alongside the 45-person default:
 *
 *   - **Sparrow Jam Manufacturing, OH** — ten people, two lines and an
 *     oversight group. Small enough that every person, every ring and every
 *     work item is on screen at once.
 *
 * A ~2,400-person enterprise shape used to sit alongside it. It was removed on
 * 2026-09-20 (Greg: "kill off Northwind entirely") — its generator survives
 * only as a test fixture, `lib/map/layout/__tests__/fixtures/deepOrg.ts`, because
 * it is the one thing proving the layout still holds at that size.
 *
 * It is seeded as a workspace the dev user is a member of, which is what
 * makes it appear in the header's company switcher. The existing Digital
 * Tailoring demo org is left exactly as it is and stays the default.
 *
 * Idempotent: re-running clears and rebuilds only Sparrow Jam.
 * CLI: `npm run db:companies`.
 */

const OWNER = "dev-user";

export { DEMO_COMPANIES, type DemoCompanyKind } from "@/lib/demoCompanies";

export const SPARROW_WORKSPACE = DEMO_COMPANIES.small.name;

type Db = PostgresJsDatabase<typeof schema>;

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
  if (kind !== "small") throw new Error("Unknown demo company kind.");
  return seedSparrowJam(db, wid);
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

  console.log(`"${SPARROW_WORKSPACE}" is now in the header's company switcher for dev-user.`);
  await sql.end();
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
