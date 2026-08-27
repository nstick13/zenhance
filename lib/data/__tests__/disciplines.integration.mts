/**
 * Integration check for the S5 discipline CRUD (lib/data/disciplineOps.ts) and
 * the workspace vocabulary column. Runs against a *throwaway workspace with no
 * demo seed* — the roadmap's acceptance criterion — then cleans it up.
 *
 * It drives the real ops the server actions call, so what passes here is the
 * code the settings tab runs, not a re-implementation of it.
 *
 * Run: npx tsx lib/data/__tests__/disciplines.integration.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, asc } from "drizzle-orm";
import * as schema from "../../db/schema";
import { disciplineColors } from "../../canvas/lens";
import { normalizeVocabulary, PRESETS } from "../../vocabulary";

// disciplineOps pulls in lib/db/client, which reads DATABASE_URL at module
// scope — so it has to be imported *after* dotenv has run, not hoisted above it.
const {
  createDisciplineOp,
  updateDisciplineOp,
  deleteDisciplineOp,
  disciplineUsageOp,
  mergeDisciplinesOp,
  reorderDisciplinesOp,
} = await import("../disciplineOps");

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sql, { schema });
const { workspaces, people, disciplines } = schema;

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

async function main() {
  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Settings Test", ownerUserId: "test-settings-" + Date.now() })
    .returning();
  const wid = ws.id;

  try {
    // --- a genuinely empty workspace ---------------------------------------
    const seeded = await db.select().from(disciplines).where(eq(disciplines.workspaceId, wid));
    assert(seeded.length === 0, "a fresh workspace starts with no disciplines (no demo seed)");
    assert(ws.vocabulary === null, "a fresh workspace starts with no vocabulary blob");

    // --- create ------------------------------------------------------------
    const eng = await createDisciplineOp(wid, { name: "Engineering", color: "#0369a1" });
    const qa = await createDisciplineOp(wid, { name: "QA", color: null });
    const qaDupe = await createDisciplineOp(wid, { name: "Q A", color: null });
    assert(eng.ok && qa.ok && qaDupe.ok, "create three disciplines from scratch");
    if (!eng.ok || !qa.ok || !qaDupe.ok) throw new Error("create failed; rest is moot");

    const collision = await createDisciplineOp(wid, { name: "Engineering", color: null });
    assert(
      !collision.ok && /already exists/.test(collision.error),
      "a duplicate name fails with a sentence, not a Postgres 23505",
    );

    let rows = await db
      .select()
      .from(disciplines)
      .where(eq(disciplines.workspaceId, wid))
      .orderBy(asc(disciplines.sortOrder));
    assert(
      rows.map((r) => r.sortOrder).join(",") === "0,1,2",
      "new rows park at the end of the sort order",
    );

    // --- rename + recolour -------------------------------------------------
    const renamed = await updateDisciplineOp(wid, eng.data.id, {
      name: "Software Engineering",
      color: "#7c3aed",
      sortOrder: 0,
    });
    assert(renamed.ok, "rename + recolour in one write");
    const [engRow] = await db.select().from(disciplines).where(eq(disciplines.id, eng.data.id));
    assert(engRow.name === "Software Engineering", "the new name persisted");
    assert(engRow.color === "#7c3aed", "the new colour persisted");

    const renameCollision = await updateDisciplineOp(wid, qa.data.id, {
      name: "Software Engineering",
      color: null,
      sortOrder: 1,
    });
    assert(
      !renameCollision.ok && /already exists/.test(renameCollision.error),
      "renaming onto a taken name fails with a clear message",
    );

    // --- colour-by-discipline reads the stored colour ----------------------
    rows = await db
      .select()
      .from(disciplines)
      .where(eq(disciplines.workspaceId, wid))
      .orderBy(asc(disciplines.sortOrder));
    const colors = disciplineColors(rows);
    assert(
      colors.get(eng.data.id) === "#7c3aed",
      "colour-by-discipline uses disciplines.color, not the ramp",
    );
    assert(
      colors.get(qa.data.id) !== undefined && colors.get(qa.data.id) !== null,
      "a row left on auto still gets a ramp colour",
    );

    // --- reorder -----------------------------------------------------------
    const reordered = await reorderDisciplinesOp(wid, [
      qa.data.id,
      qaDupe.data.id,
      eng.data.id,
    ]);
    assert(reordered.ok, "reorder accepted");
    rows = await db
      .select()
      .from(disciplines)
      .where(eq(disciplines.workspaceId, wid))
      .orderBy(asc(disciplines.sortOrder));
    assert(
      rows.map((r) => r.id).join(",") === [qa.data.id, qaDupe.data.id, eng.data.id].join(","),
      "sortOrder now reflects the requested order",
    );

    // A foreign id must not be able to reorder anything.
    const [other] = await db
      .insert(workspaces)
      .values({ name: "Other", ownerUserId: "test-settings-other-" + Date.now() })
      .returning();
    const foreign = await createDisciplineOp(other.id, { name: "Design", color: null });
    if (foreign.ok) {
      await reorderDisciplinesOp(wid, [foreign.data.id, eng.data.id]);
      const [foreignRow] = await db
        .select()
        .from(disciplines)
        .where(eq(disciplines.id, foreign.data.id));
      assert(
        foreignRow.sortOrder === 0 && foreignRow.workspaceId === other.id,
        "an id from another workspace is ignored by reorder",
      );
    }
    await db.delete(workspaces).where(eq(workspaces.id, other.id));

    // --- people, then merge ------------------------------------------------
    const [alice, bob, cara] = await db
      .insert(people)
      .values([
        { workspaceId: wid, name: "Alice", disciplineId: qa.data.id },
        { workspaceId: wid, name: "Bob", disciplineId: qaDupe.data.id },
        { workspaceId: wid, name: "Cara", disciplineId: eng.data.id },
      ])
      .returning();

    assert((await disciplineUsageOp(wid, qa.data.id)) === 1, "usage count sees Alice on QA");

    const merged = await mergeDisciplinesOp(wid, qaDupe.data.id, qa.data.id);
    assert(merged.ok && merged.data.moved === 1, "merge moved the one person on the dupe");
    const [bobRow] = await db.select().from(people).where(eq(people.id, bob.id));
    assert(bobRow.disciplineId === qa.data.id, "Bob now holds the surviving QA row");
    const gone = await db.select().from(disciplines).where(eq(disciplines.id, qaDupe.data.id));
    assert(gone.length === 0, "the merged-away discipline is deleted");
    assert(
      !(await mergeDisciplinesOp(wid, qa.data.id, qa.data.id)).ok,
      "merging a discipline into itself is refused",
    );

    // --- delete with reassign ---------------------------------------------
    assert((await disciplineUsageOp(wid, qa.data.id)) === 2, "QA now holds two people");
    const del = await deleteDisciplineOp(wid, qa.data.id, eng.data.id);
    assert(del.ok && del.data.reassigned === 2, "delete reassigned both people");
    const after = await db.select().from(people).where(eq(people.workspaceId, wid));
    assert(
      after.every((p) => p.disciplineId === eng.data.id),
      "Alice, Bob and Cara all point at Software Engineering",
    );
    assert(
      (await db.select().from(disciplines).where(eq(disciplines.id, qa.data.id))).length === 0,
      "the deleted discipline is gone",
    );

    // --- delete with no reassign target ------------------------------------
    const del2 = await deleteDisciplineOp(wid, eng.data.id, null);
    assert(del2.ok && del2.data.reassigned === 3, "delete-to-none nulled all three people");
    const orphaned = await db.select().from(people).where(eq(people.workspaceId, wid));
    assert(
      orphaned.every((p) => p.disciplineId === null),
      "nobody is left pointing at a deleted row",
    );
    assert(
      (await db.select().from(disciplines).where(eq(disciplines.workspaceId, wid))).length === 0,
      "the workspace is back to zero disciplines",
    );
    assert(
      orphaned.length === 3 &&
        [alice.id, bob.id, cara.id].every((id) => orphaned.some((p) => p.id === id)),
      "all three people rows survived the deletes",
    );

    // --- vocabulary round trip --------------------------------------------
    const safe = PRESETS.find((p) => p.id === "safe")!;
    await db
      .update(workspaces)
      .set({ vocabulary: safe.vocabulary })
      .where(eq(workspaces.id, wid));
    const [reread] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
    assert(
      normalizeVocabulary(reread.vocabulary).stream.singular === "Agile Release Train",
      "vocabulary survives a round trip through the jsonb column",
    );

    // A blob from an older/newer build must degrade, never crash.
    await db
      .update(workspaces)
      .set({ vocabulary: { stream: { singular: "Portfolio" }, junk: 1 } })
      .where(eq(workspaces.id, wid));
    const [degraded] = await db.select().from(workspaces).where(eq(workspaces.id, wid));
    const v = normalizeVocabulary(degraded.vocabulary);
    assert(
      v.stream.singular === "Portfolio" && v.stream.plural === "Portfolios" &&
        v.team.singular === "Team",
      "a partial blob degrades per-field instead of crashing a page",
    );
  } finally {
    await db.delete(workspaces).where(eq(workspaces.id, wid));
    await sql.end();
    // disciplineOps talks through lib/db/client's shared pool, which is parked
    // on globalThis for dev hot-reload. Close it too or the process never exits.
    const shared = (globalThis as { __zenhancePgClient?: { end: () => Promise<void> } })
      .__zenhancePgClient;
    if (shared) await shared.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll discipline + vocabulary assertions passed.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
