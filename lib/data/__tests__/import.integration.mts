/**
 * Integration check for the import resolution logic (parent/lead/person by
 * name, transactional). Runs the same insert+resolve sequence importOrg uses,
 * against a throwaway workspace, then asserts and cleans up.
 * Run: npx tsx lib/data/__tests__/import.integration.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql, { schema });
const { workspaces, people, orgUnits, assignments } = schema;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Import Test", ownerUserId: "test-import-" + Date.now() })
    .returning();
  const wid = ws.id;

  try {
    // Template-shaped payload: parent + lead + person references are by name,
    // and rows are intentionally out of order (team references a person/parent
    // defined elsewhere) to prove resolution is order-independent.
    const peopleRows = [
      { name: "Sarah Reeve" },
      { name: "Aimee Bradford" },
    ];
    const teamRows = [
      { name: "Starlight", kind: "team", parent: "Delivery Group", lead: "Aimee Bradford" },
      { name: "Delivery Group", kind: "group", parent: "", lead: "Sarah Reeve" },
    ];
    const assignmentRows = [
      { person: "Aimee Bradford", team: "Starlight", role: "Lead", allocationPct: "100", isOpenRole: "" },
      { person: "", team: "Starlight", role: "Engineer", allocationPct: "100", isOpenRole: "yes" },
    ];

    await db.transaction(async (tx) => {
      const personIdByName = new Map<string, string>();
      const unitIdByName = new Map<string, string>();

      for (const r of peopleRows) {
        const [row] = await tx
          .insert(people)
          .values({ workspaceId: wid, name: r.name })
          .returning({ id: people.id });
        personIdByName.set(r.name.toLowerCase(), row.id);
      }
      for (const t of teamRows) {
        const [row] = await tx
          .insert(orgUnits)
          .values({ workspaceId: wid, name: t.name, kind: t.kind as "team" | "group" })
          .returning({ id: orgUnits.id });
        unitIdByName.set(t.name.toLowerCase(), row.id);
      }
      for (const t of teamRows) {
        const id = unitIdByName.get(t.name.toLowerCase())!;
        const parentId = t.parent ? unitIdByName.get(t.parent.toLowerCase()) ?? null : null;
        const leadId = t.lead ? personIdByName.get(t.lead.toLowerCase()) ?? null : null;
        if (parentId || leadId)
          await tx.update(orgUnits).set({ parentId, leadPersonId: leadId }).where(eq(orgUnits.id, id));
      }
      const truthy = (v: string) => ["yes", "true", "1", "y", "x"].includes(v.toLowerCase());
      for (const a of assignmentRows) {
        const unitId = unitIdByName.get(a.team.toLowerCase());
        if (!unitId) continue;
        const isOpen = truthy(a.isOpenRole);
        const personId = isOpen ? null : personIdByName.get(a.person.toLowerCase()) ?? null;
        if (!isOpen && !personId) continue;
        await tx.insert(assignments).values({
          workspaceId: wid,
          orgUnitId: unitId,
          personId,
          roleOnTeam: a.role,
          allocationPct: Number(a.allocationPct),
          isOpenRole: isOpen,
        });
      }
    });

    const units = await db.select().from(orgUnits).where(eq(orgUnits.workspaceId, wid));
    const star = units.find((u) => u.name === "Starlight")!;
    const delivery = units.find((u) => u.name === "Delivery Group")!;
    const aimee = (
      await db.select().from(people).where(eq(people.workspaceId, wid))
    ).find((p) => p.name === "Aimee Bradford")!;
    const asg = await db.select().from(assignments).where(eq(assignments.workspaceId, wid));

    assert(units.length === 2, "created 2 units");
    assert(star.parentId === delivery.id, "Starlight parent resolved to Delivery Group (out-of-order)");
    assert(star.leadPersonId === aimee.id, "Starlight lead resolved by name");
    assert(asg.length === 2, "created 2 assignments");
    assert(asg.some((a) => a.isOpenRole && a.personId === null), "open-role assignment has null person");
    assert(asg.some((a) => a.personId === aimee.id), "person assignment resolved by name");
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, wid)); // cascades
    await sql.end();
  }
  console.log(process.exitCode ? "\nIMPORT TEST FAILED" : "\nIMPORT TEST PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
