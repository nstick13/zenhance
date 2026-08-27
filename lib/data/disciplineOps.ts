/**
 * Discipline mutations, one layer below the server actions (S5 tab 2).
 *
 * The actions in lib/data/actions.ts own auth (`requireWorkspace`), Zod
 * validation and cache revalidation; everything *here* is the workspace-scoped
 * data work, taking the tenant id as an explicit argument. Splitting it out
 * buys two things: the tenancy rule ("scope by workspace_id, always") lives in
 * one readable place, and the sequence is exercisable from an integration
 * script against a throwaway workspace without faking a signed-in user.
 *
 * No "use server", no next/cache, no server-only — this is plain data code.
 */

import { db } from "@/lib/db/client";
import { people, disciplines, eq, and, sql } from "@/lib/db/orm";

export type OpResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const nope = (error: string): OpResult<never> => ({ ok: false, error });

/** The ids this workspace actually owns. Every op filters against this rather
 *  than trusting an id off the wire. */
async function ownedIds(workspaceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: disciplines.id })
    .from(disciplines)
    .where(eq(disciplines.workspaceId, workspaceId));
  return new Set(rows.map((r) => r.id));
}

/**
 * Does another row in this workspace already hold this name? The unique index
 * is `(workspace_id, name)`, so checking first turns a raw Postgres 23505 into
 * a sentence the user can act on.
 */
export async function nameTaken(
  workspaceId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: disciplines.id })
    .from(disciplines)
    .where(and(eq(disciplines.workspaceId, workspaceId), eq(disciplines.name, name)));
  return rows.some((r) => r.id !== exceptId);
}

/** Create. Unlike the import's find-or-create, a duplicate name is an error the user
 *  should see rather than a silent find-or-create. New rows park at the end. */
export async function createDisciplineOp(
  workspaceId: string,
  v: { name: string; color: string | null },
): Promise<OpResult<{ id: string }>> {
  if (await nameTaken(workspaceId, v.name, null)) {
    return nope(`A discipline called “${v.name}” already exists.`);
  }
  const [agg] = await db
    .select({ max: sql<number | null>`max(${disciplines.sortOrder})` })
    .from(disciplines)
    .where(eq(disciplines.workspaceId, workspaceId));
  const [row] = await db
    .insert(disciplines)
    .values({
      workspaceId,
      name: v.name,
      color: v.color,
      sortOrder: (agg?.max ?? -1) + 1,
    })
    .returning({ id: disciplines.id });
  return { ok: true, data: { id: row.id } };
}

/** Rename, recolour and reposition in a single write. */
export async function updateDisciplineOp(
  workspaceId: string,
  id: string,
  v: { name: string; color: string | null; sortOrder: number },
): Promise<OpResult> {
  if (await nameTaken(workspaceId, v.name, id)) {
    return nope(`A discipline called “${v.name}” already exists. Merge them instead.`);
  }
  const updated = await db
    .update(disciplines)
    .set({ name: v.name, color: v.color, sortOrder: v.sortOrder })
    .where(and(eq(disciplines.id, id), eq(disciplines.workspaceId, workspaceId)))
    .returning({ id: disciplines.id });
  if (updated.length === 0) return nope("That discipline no longer exists.");
  return { ok: true, data: undefined };
}

/** How many people hold this discipline — shown before a delete, because
 *  `people.discipline_id` is ON DELETE SET NULL and losing a value silently is
 *  exactly what an org-design tool must not do. */
export async function disciplineUsageOp(
  workspaceId: string,
  id: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(people)
    .where(and(eq(people.workspaceId, workspaceId), eq(people.disciplineId, id)));
  return row?.n ?? 0;
}

/**
 * Delete, first moving everyone who holds it to another discipline or to none.
 * Both halves run in one transaction, so a workspace can never be left with
 * people pointing at a row on its way out.
 */
export async function deleteDisciplineOp(
  workspaceId: string,
  id: string,
  reassignToId: string | null,
): Promise<OpResult<{ reassigned: number }>> {
  if (reassignToId === id) return nope("Pick a different discipline to reassign to.");
  const ids = await ownedIds(workspaceId);
  if (!ids.has(id)) return nope("That discipline no longer exists.");
  if (reassignToId && !ids.has(reassignToId)) {
    return nope("The discipline you're reassigning to no longer exists.");
  }

  const reassigned = await db.transaction(async (tx) => {
    const moved = await tx
      .update(people)
      .set({ disciplineId: reassignToId, updatedAt: new Date() })
      .where(and(eq(people.workspaceId, workspaceId), eq(people.disciplineId, id)))
      .returning({ id: people.id });
    await tx
      .delete(disciplines)
      .where(and(eq(disciplines.id, id), eq(disciplines.workspaceId, workspaceId)));
    return moved.length;
  });

  return { ok: true, data: { reassigned } };
}

/**
 * Fold one discipline into another: everyone moves, the source row goes away.
 * This is the cure for what the import's find-or-create can leave behind — an import that
 * spells "QA" three ways leaves three rows, and this is how they become one.
 */
export async function mergeDisciplinesOp(
  workspaceId: string,
  fromId: string,
  intoId: string,
): Promise<OpResult<{ moved: number }>> {
  if (fromId === intoId) return nope("Pick two different disciplines to merge.");
  const ids = await ownedIds(workspaceId);
  if (!ids.has(fromId) || !ids.has(intoId)) {
    return nope("One of those disciplines no longer exists.");
  }

  const moved = await db.transaction(async (tx) => {
    const rows = await tx
      .update(people)
      .set({ disciplineId: intoId, updatedAt: new Date() })
      .where(and(eq(people.workspaceId, workspaceId), eq(people.disciplineId, fromId)))
      .returning({ id: people.id });
    await tx
      .delete(disciplines)
      .where(and(eq(disciplines.id, fromId), eq(disciplines.workspaceId, workspaceId)));
    return rows.length;
  });

  return { ok: true, data: { moved } };
}

/** Persist a new order. Ids outside this workspace are dropped rather than
 *  trusted, so a tampered list can only reorder what the caller already owns. */
export async function reorderDisciplinesOp(
  workspaceId: string,
  orderedIds: string[],
): Promise<OpResult> {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return nope("Invalid order");
  }
  const ids = await ownedIds(workspaceId);
  const valid = orderedIds.filter((id) => ids.has(id));
  if (valid.length === 0) return { ok: true, data: undefined };

  await db.transaction(async (tx) => {
    for (let i = 0; i < valid.length; i++) {
      await tx
        .update(disciplines)
        .set({ sortOrder: i })
        .where(and(eq(disciplines.id, valid[i]), eq(disciplines.workspaceId, workspaceId)));
    }
  });
  return { ok: true, data: undefined };
}
