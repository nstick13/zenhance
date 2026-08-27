/**
 * Integration check for S2's import mapping — the four recognized person
 * attributes, and the title→discipline suggestion.
 *
 * Unlike import.integration.mts (which re-implements the resolution logic),
 * this drives the REAL engine: `commitImport` from lib/data/importCommit.ts,
 * the same function the server action calls. Runs against a throwaway
 * workspace with an empty taxonomy, then cleans up.
 *
 * Run: npx tsx lib/data/__tests__/importS2.integration.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";
import { commitImport, type Tx } from "../importCommit";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql, { schema });
const { workspaces, people, disciplines } = schema;

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Import S2 Test", ownerUserId: "test-import-s2-" + Date.now() })
    .returning();
  const wid = ws.id;

  try {
    // --- 1. explicit columns, messy values ------------------------------
    // Deliberately the vocabulary a real HRIS export uses, not ours.
    const res = await db.transaction(async (tx) => {
      return commitImport(tx as Tx, wid, {
        people: [
          { name: "Devraj Patel", title: "Security Engineer", discipline: "Security", employment: "Full-Time", location: "Pune", timezone: "IST" },
          { name: "Grace Okafor", title: "QA Engineer", discipline: "QA", employment: "Contractor (Infosys)", location: "Lagos", timezone: "Africa/Lagos" },
          { name: "Mira Lindqvist", title: "Software Engineer", discipline: "Engineering", employment: "vendor", location: "Stockholm", timezone: "europe/stockholm" },
          { name: "Tom Reeve", title: "Delivery Lead", discipline: "Delivery", employment: "Band 7", location: "London", timezone: "Middle Earth/Shire" },
        ],
        teams: [{ name: "Earthlight", kind: "team" }],
        assignments: [{ person: "Devraj Patel", team: "Earthlight", allocationPct: "100" }],
      });
    });

    assert(res.ok, "import committed");
    if (!res.ok) throw new Error("import failed: " + JSON.stringify(res.errors));

    assert(res.created.people === 4, `created 4 people (got ${res.created.people})`);
    assert(
      res.created.disciplines === 4,
      `find-or-create built the 4 disciplines from an empty taxonomy (got ${res.created.disciplines})`,
    );

    const rows = await db.select().from(people).where(eq(people.workspaceId, wid));
    const by = (n: string) => rows.find((p) => p.name === n)!;

    assert(by("Devraj Patel").employment === "fte", '"Full-Time" → fte');
    assert(by("Grace Okafor").employment === "contractor", '"Contractor (Infosys)" → contractor');
    assert(by("Mira Lindqvist").employment === "vendor", '"vendor" → vendor');
    assert(
      by("Tom Reeve").employment === "unknown",
      '"Band 7" → unknown rather than a guess',
    );

    assert(by("Devraj Patel").timezone === "Asia/Kolkata", '"IST" → Asia/Kolkata');
    assert(
      by("Mira Lindqvist").timezone === "Europe/Stockholm",
      'lowercase IANA is canonicalised, not stored verbatim',
    );
    assert(
      by("Tom Reeve").timezone === null,
      "an unresolvable zone is left empty, not stored wrong",
    );
    assert(by("Grace Okafor").location === "Lagos", "location imported");

    assert(
      res.warnings.length === 2,
      `bad values reported as warnings, not silently dropped (got ${res.warnings.length}: ${res.warnings.join(" | ")})`,
    );

    const taxonomy = await db.select().from(disciplines).where(eq(disciplines.workspaceId, wid));
    assert(taxonomy.length === 4, `taxonomy has 4 disciplines (got ${taxonomy.length})`);
    const secId = taxonomy.find((d) => d.name === "Security")!.id;
    assert(by("Devraj Patel").disciplineId === secId, "person linked to the created discipline");

    // --- 2. title→discipline suggestion, reusing the taxonomy ------------
    // "Software Engineer" must find the existing "Engineering" rather than
    // creating a near-duplicate beside it.
    const res2 = await db.transaction(async (tx) => {
      return commitImport(tx as Tx, wid, {
        people: [
          { name: "Ana Ruiz", title: "Senior Software Engineer" },
          { name: "Bo Chen", title: "Product Manager" },
          { name: "Cy Adeyemi", title: "Band 7 Associate" },
        ],
        teams: [],
        assignments: [],
        suggestDisciplineFromTitle: true,
      });
    });
    assert(res2.ok, "suggestion import committed");
    if (!res2.ok) throw new Error("second import failed");

    const rows2 = await db.select().from(people).where(eq(people.workspaceId, wid));
    const by2 = (n: string) => rows2.find((p) => p.name === n)!;
    const tax2 = await db.select().from(disciplines).where(eq(disciplines.workspaceId, wid));
    const engId = tax2.find((d) => d.name === "Engineering")!.id;

    assert(
      by2("Ana Ruiz").disciplineId === engId,
      '"Senior Software Engineer" reused the existing Engineering, no near-duplicate',
    );
    assert(
      res2.created.disciplines === 1,
      `only Product was newly created (got ${res2.created.disciplines})`,
    );
    assert(
      by2("Bo Chen").disciplineId === tax2.find((d) => d.name === "Product")!.id,
      '"Product Manager" → Product, not Management',
    );
    assert(
      by2("Cy Adeyemi").disciplineId === null,
      "an unmatched title leaves the discipline empty rather than inventing one",
    );
    assert(tax2.length === 5, `taxonomy grew to exactly 5 (got ${tax2.length})`);

    // --- 3. opt-out is honoured ------------------------------------------
    const res3 = await db.transaction(async (tx) => {
      return commitImport(tx as Tx, wid, {
        people: [{ name: "Dee Fowler", title: "QA Engineer" }],
        teams: [],
        assignments: [],
      });
    });
    assert(res3.ok, "opt-out import committed");
    const dee = (await db.select().from(people).where(eq(people.workspaceId, wid))).find(
      (p) => p.name === "Dee Fowler",
    )!;
    assert(
      dee.disciplineId === null,
      "without the opt-in, no discipline is inferred from the title",
    );

    // --- 4. a validation failure rolls everything back --------------------
    const before = (await db.select().from(people).where(eq(people.workspaceId, wid))).length;
    let rolledBack = false;
    try {
      await db.transaction(async (tx) => {
        const bad = await commitImport(tx as Tx, wid, {
          people: [{ name: "Valid Person" }, { name: "" }], // blank name fails validation
          teams: [],
          assignments: [],
        });
        if (!bad.ok) {
          rolledBack = true;
          throw new Error("rollback");
        }
      });
    } catch {
      /* expected */
    }
    const after = (await db.select().from(people).where(eq(people.workspaceId, wid))).length;
    assert(rolledBack, "a blank name is a validation error, not a silent skip");
    assert(after === before, `nothing was written on a failed import (${before} → ${after})`);
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, wid)); // cascades
    await sql.end();
  }
  console.log(failures ? `\nS2 IMPORT TEST FAILED (${failures})` : "\nS2 IMPORT TEST PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
