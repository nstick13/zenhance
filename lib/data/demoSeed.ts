import { db } from "@/lib/db/client";
import { applyDemoOrg } from "@/lib/data/demoOrg";

/**
 * Seeds the given workspace with the canonical demo org (the in-app
 * "Load demo org" flow). The org data and insert logic live in
 * `lib/data/demoOrg.ts` so this and the CLI seed (`lib/db/seed.ts`) stay in
 * lockstep. Idempotent — clears existing org data first.
 */
export async function seedDemoOrg(workspaceId: string): Promise<void> {
  await applyDemoOrg(db, workspaceId);
}
