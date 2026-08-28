/**
 * Pod-template mutations, one layer below the server actions (S5 tab 4).
 * Same split as disciplineOps/findingsPolicyOps: auth, Zod and revalidation
 * live in the actions; this is the workspace-scoped data work.
 */

import { db } from "@/lib/db/client";
import { disciplines, podTemplateRoles, and, eq } from "@/lib/db/orm";
import type { PodTemplateRole } from "@/lib/analytics/podTemplate";

export type OpResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const nope = (error: string): OpResult<never> => ({ ok: false, error });

/** The workspace's template rows, shaped for `computePodGaps`. */
export async function listPodTemplateOp(workspaceId: string): Promise<PodTemplateRole[]> {
  return db
    .select({
      disciplineId: podTemplateRoles.disciplineId,
      minCount: podTemplateRoles.minCount,
      maxCount: podTemplateRoles.maxCount,
    })
    .from(podTemplateRoles)
    .where(eq(podTemplateRoles.workspaceId, workspaceId));
}

/** Add or update one role's range. Upsert by (workspace, discipline). */
export async function savePodTemplateRoleOp(
  workspaceId: string,
  v: { disciplineId: string; minCount: number; maxCount: number | null },
): Promise<OpResult> {
  const [owned] = await db
    .select({ id: disciplines.id })
    .from(disciplines)
    .where(and(eq(disciplines.id, v.disciplineId), eq(disciplines.workspaceId, workspaceId)));
  if (!owned) return nope("That discipline no longer exists.");

  const updated = await db
    .update(podTemplateRoles)
    .set({ minCount: v.minCount, maxCount: v.maxCount, updatedAt: new Date() })
    .where(
      and(
        eq(podTemplateRoles.workspaceId, workspaceId),
        eq(podTemplateRoles.disciplineId, v.disciplineId),
      ),
    )
    .returning({ id: podTemplateRoles.id });
  if (updated.length === 0) {
    await db.insert(podTemplateRoles).values({
      workspaceId,
      disciplineId: v.disciplineId,
      minCount: v.minCount,
      maxCount: v.maxCount,
    });
  }
  return { ok: true, data: undefined };
}

/** Drop a role from the ideal pod. */
export async function removePodTemplateRoleOp(
  workspaceId: string,
  disciplineId: string,
): Promise<OpResult> {
  await db
    .delete(podTemplateRoles)
    .where(
      and(
        eq(podTemplateRoles.workspaceId, workspaceId),
        eq(podTemplateRoles.disciplineId, disciplineId),
      ),
    );
  return { ok: true, data: undefined };
}
