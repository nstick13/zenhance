/**
 * Findings-policy mutations, one layer below the server actions (S5 tab 5).
 *
 * Same split as disciplineOps: the actions own auth, Zod validation and cache
 * revalidation; this file is the workspace-scoped data work, taking the tenant
 * id explicitly so it's exercisable from an integration script.
 *
 * The table carries two row shapes (see schema.ts): the `discipline_id IS NULL`
 * row holds the workspace-wide config, and every other row is one discipline's
 * Spread override. These ops keep that invariant — the workspace row is
 * upserted in place, discipline overrides are set or cleared individually.
 *
 * No "use server", no next/cache — plain data code.
 */

import { db } from "@/lib/db/client";
import {
  disciplines,
  findingsPolicy,
  and,
  eq,
  isNull,
} from "@/lib/db/orm";
import type { FindingsPolicyRow } from "@/lib/analytics/findingsPolicy";

export type OpResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const nope = (error: string): OpResult<never> => ({ ok: false, error });

/** Every policy row for a workspace, shaped for `resolveFindingsPolicy`. */
export async function listFindingsPolicyOp(workspaceId: string): Promise<FindingsPolicyRow[]> {
  const rows = await db
    .select({
      disciplineId: findingsPolicy.disciplineId,
      spreadThreshold: findingsPolicy.spreadThreshold,
      spreadEnabled: findingsPolicy.spreadEnabled,
      overCommitmentEnabled: findingsPolicy.overCommitmentEnabled,
      couplingEnabled: findingsPolicy.couplingEnabled,
    })
    .from(findingsPolicy)
    .where(eq(findingsPolicy.workspaceId, workspaceId));
  return rows;
}

/**
 * Upsert the workspace-wide config row (the `discipline_id IS NULL` slot): the
 * three detector switches and the default Spread threshold. Done as select →
 * update|insert rather than an ON CONFLICT, because the constraint that keeps
 * this row single is a *partial* unique index the driver's onConflict can't
 * name directly.
 */
export async function saveWorkspaceFindingsConfigOp(
  workspaceId: string,
  v: {
    spreadEnabled: boolean;
    overCommitmentEnabled: boolean;
    couplingEnabled: boolean;
    defaultSpreadThreshold: number;
  },
): Promise<OpResult> {
  const set = {
    spreadThreshold: v.defaultSpreadThreshold,
    spreadEnabled: v.spreadEnabled,
    overCommitmentEnabled: v.overCommitmentEnabled,
    couplingEnabled: v.couplingEnabled,
    updatedAt: new Date(),
  };
  const updated = await db
    .update(findingsPolicy)
    .set(set)
    .where(and(eq(findingsPolicy.workspaceId, workspaceId), isNull(findingsPolicy.disciplineId)))
    .returning({ id: findingsPolicy.id });
  if (updated.length === 0) {
    await db.insert(findingsPolicy).values({ workspaceId, disciplineId: null, ...set });
  }
  return { ok: true, data: undefined };
}

/**
 * Set one discipline's Spread override. `threshold` is a positive team count to
 * flag at, or null for "no limit" (never flag this discipline). Clearing the
 * override entirely — back to inheriting the workspace default — is a separate
 * op, because null already means something here.
 */
export async function setDisciplineSpreadOp(
  workspaceId: string,
  disciplineId: string,
  threshold: number | null,
): Promise<OpResult> {
  const [owned] = await db
    .select({ id: disciplines.id })
    .from(disciplines)
    .where(and(eq(disciplines.id, disciplineId), eq(disciplines.workspaceId, workspaceId)));
  if (!owned) return nope("That discipline no longer exists.");

  const updated = await db
    .update(findingsPolicy)
    .set({ spreadThreshold: threshold, updatedAt: new Date() })
    .where(
      and(
        eq(findingsPolicy.workspaceId, workspaceId),
        eq(findingsPolicy.disciplineId, disciplineId),
      ),
    )
    .returning({ id: findingsPolicy.id });
  if (updated.length === 0) {
    await db
      .insert(findingsPolicy)
      .values({ workspaceId, disciplineId, spreadThreshold: threshold });
  }
  return { ok: true, data: undefined };
}

/** Drop a discipline's override so it inherits the workspace default again. */
export async function clearDisciplineSpreadOp(
  workspaceId: string,
  disciplineId: string,
): Promise<OpResult> {
  await db
    .delete(findingsPolicy)
    .where(
      and(
        eq(findingsPolicy.workspaceId, workspaceId),
        eq(findingsPolicy.disciplineId, disciplineId),
      ),
    );
  return { ok: true, data: undefined };
}
