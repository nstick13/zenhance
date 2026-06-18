import { config } from "dotenv";
config({ path: ".env.local" });
config();

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { applyDemoOrg } from "../data/demoOrg";

/**
 * Seeds the dev-user workspace with the canonical demo org. The org data and
 * insert logic live in `lib/data/demoOrg.ts`, shared with the in-app
 * "Load demo org" flow (`lib/data/demoSeed.ts`) so the two can't drift.
 * Idempotent — `applyDemoOrg` clears the workspace's org data first.
 * Run with `npm run db:seed`.
 */

const OWNER = "dev-user";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql, { schema });
  const { workspaces, memberships } = schema;

  // Find or create the dev workspace.
  let ws = (
    await db.select().from(workspaces).where(eq(workspaces.ownerUserId, OWNER)).limit(1)
  )[0];
  if (!ws) {
    ws = (
      await db
        .insert(workspaces)
        .values({ name: "Digital Tailoring Supplies", ownerUserId: OWNER })
        .returning()
    )[0];
    await db
      .insert(memberships)
      .values({ workspaceId: ws.id, userId: OWNER, role: "owner" })
      .onConflictDoNothing();
  }

  const counts = await applyDemoOrg(db, ws.id);
  console.log(`Seeded workspace ${ws.id}:`, counts);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
