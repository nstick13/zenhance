/**
 * Northwind — the large demo company, back in the local development database
 * (Greg, 2026-09-23).
 *
 * It was retired on 2026-09-20 because ~2,500 rows of invented people made the
 * dev database heavy and the scale claim could be made by a pure test instead.
 * That held while the work was pure geometry. It stopped holding the moment
 * the map had to be *navigated* at scale: thinning, the detail field, drag
 * landing and the territory outline are all things you can only judge by
 * driving them in a running app, and no large workspace existed to drive.
 *
 * So Northwind is a seeded company again, with three rails:
 *
 *  - **Local only.** The seeder refuses any database that is not on this
 *    machine. Production is never seeded from here, and there is no card for
 *    it on the import page.
 *  - **Invented people only**, from the same `buildDeepOrg` shape the pure
 *    scale tests use — so the company you look at and the company the tests
 *    prove things about are the same company.
 *  - **Its own workspace**, cleared and rebuilt on each run, so it can never
 *    disturb Sparrow Jam or Digital Tailoring.
 *
 * CLI: `npm run db:northwind` (add `--people=6000 --depth=13` to stress it).
 */
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { buildDeepOrg } from "@/lib/orbital/__tests__/fixtures/deepOrg";

type Db = PostgresJsDatabase<typeof schema>;

/** The workspace name. Invented carrier, invented people. */
export const NORTHWIND_WORKSPACE = "Northwind Trading Group";
const OWNER = "dev-user";

/** Postgres on this machine. Anything else is someone's real data. */
export function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Fill a workspace with the Northwind shape. Chunked inserts: ~2,500 people
 * and ~2,500 assignments exceed what one statement will carry.
 */
export async function seedNorthwindInto(
  db: Db,
  wid: string,
  opts: { people?: number; maxDepth?: number; seed?: number } = {},
): Promise<{ people: number; units: number }> {
  const { people, orgUnits, assignments, disciplines } = schema;

  const org = buildDeepOrg(wid, {
    people: opts.people ?? 2400,
    maxDepth: opts.maxDepth ?? 11,
    seed: opts.seed ?? 20260914,
    rootName: NORTHWIND_WORKSPACE,
  });

  await db.delete(assignments).where(eq(assignments.workspaceId, wid));
  await db.delete(orgUnits).where(eq(orgUnits.workspaceId, wid));
  await db.delete(people).where(eq(people.workspaceId, wid));
  await db.delete(disciplines).where(eq(disciplines.workspaceId, wid));

  const chunk = async <T>(rows: T[], insert: (batch: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
  };

  await chunk(org.disciplines, (batch) => db.insert(disciplines).values(batch));
  // People manage each other, so a chunked insert can reference a manager who
  // has not arrived yet. Land everyone first, then draw the reporting lines.
  await chunk(
    org.people.map((person) => ({ ...person, managerId: null })),
    (batch) => db.insert(people).values(batch),
  );
  const managed = org.people.filter((person) => person.managerId !== null);
  for (const person of managed) {
    await db.update(people).set({ managerId: person.managerId }).where(eq(people.id, person.id));
  }
  // Units carry parentId references, so they must go in parent-before-child
  // order. buildDeepOrg already emits them that way; sorting by depth keeps
  // that true if the generator ever changes.
  const depthOf = new Map<string, number>();
  const byId = new Map(org.units.map((u) => [u.id, u]));
  const depth = (id: string): number => {
    const known = depthOf.get(id);
    if (known !== undefined) return known;
    const parent = byId.get(id)?.parentId;
    const d = parent ? depth(parent) + 1 : 0;
    depthOf.set(id, d);
    return d;
  };
  const ordered = [...org.units].sort((a, b) => depth(a.id) - depth(b.id));
  await chunk(ordered, (batch) => db.insert(orgUnits).values(batch));
  await chunk(org.assignments, (batch) => db.insert(assignments).values(batch));

  return { people: org.people.length, units: org.units.length };
}

async function main() {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  config();

  const url = process.env.DATABASE_URL;
  if (!isLocalDatabase(url)) {
    console.error(
      "Refusing to seed: DATABASE_URL is not a local database.\n" +
      "Northwind is a development fixture and must never be written to a hosted database.",
    );
    process.exit(1);
  }

  const arg = (name: string) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split("=")[1]) : undefined;
  };

  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const sql = postgres(url!, { max: 1 });
  const db = drizzle(sql, { schema });

  const { workspaces, memberships } = schema;
  const existing = (
    await db.select().from(workspaces).where(eq(workspaces.name, NORTHWIND_WORKSPACE)).limit(1)
  )[0];
  const ws = existing ??
    (await db.insert(workspaces).values({ name: NORTHWIND_WORKSPACE, ownerUserId: OWNER }).returning())[0];
  await db
    .insert(memberships)
    .values({ workspaceId: ws.id, userId: OWNER, role: "owner" })
    .onConflictDoNothing();

  const started = Date.now();
  const result = await seedNorthwindInto(db, ws.id, {
    people: arg("people"),
    maxDepth: arg("depth"),
  });
  console.log(
    `Seeded "${NORTHWIND_WORKSPACE}": ${result.people} people, ${result.units} units ` +
    `in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  console.log("It is now in the header's company switcher for dev-user.");
  await sql.end();
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
