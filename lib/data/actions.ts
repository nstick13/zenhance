"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { people, orgUnits, assignments, eq, and } from "@/lib/db/orm";
import { requireWorkspace } from "@/lib/auth/workspace";
import {
  personInput,
  orgUnitInput,
  assignmentInput,
} from "@/lib/validation";
import { seedDemoOrg } from "@/lib/data/demoSeed";

/**
 * Mutations. Each action resolves the tenant via requireWorkspace() and scopes
 * every write to workspace.id — clients never pass a workspace id.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

function revalidateAll() {
  revalidatePath("/org");
  revalidatePath("/people");
  revalidatePath("/teams");
}

// --- people ---------------------------------------------------------------
export async function createPerson(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const parsed = personInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  const [row] = await db
    .insert(people)
    .values({
      workspaceId: workspace.id,
      name: v.name,
      title: v.title,
      startDate: v.startDate,
      costPerMonth: v.costPerMonth?.toString() ?? null,
      skills: v.skills,
      growthFocus: v.growthFocus,
      photoUrl: v.photoUrl,
      lastVacationAt: v.lastVacationAt,
    })
    .returning({ id: people.id });
  revalidateAll();
  return { ok: true, data: { id: row.id } };
}

export async function updatePerson(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = personInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  await db
    .update(people)
    .set({
      name: v.name,
      title: v.title,
      startDate: v.startDate,
      costPerMonth: v.costPerMonth?.toString() ?? null,
      skills: v.skills,
      growthFocus: v.growthFocus,
      photoUrl: v.photoUrl,
      lastVacationAt: v.lastVacationAt,
      updatedAt: new Date(),
    })
    .where(and(eq(people.id, id), eq(people.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deletePerson(id: string): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  await db
    .delete(people)
    .where(and(eq(people.id, id), eq(people.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

// --- org units (teams / groups) ------------------------------------------
export async function createOrgUnit(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const parsed = orgUnitInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  const [row] = await db
    .insert(orgUnits)
    .values({
      workspaceId: workspace.id,
      name: v.name,
      kind: v.kind,
      parentId: v.parentId,
      leadPersonId: v.leadPersonId,
      targetHeadcount: v.targetHeadcount,
      isExternal: v.isExternal,
      vendorName: v.vendorName,
      costPerMonth: v.costPerMonth?.toString() ?? null,
      expectedRoi: v.expectedRoi?.toString() ?? null,
    })
    .returning({ id: orgUnits.id });
  revalidateAll();
  return { ok: true, data: { id: row.id } };
}

export async function updateOrgUnit(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = orgUnitInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  if (v.parentId === id) return fail("A unit cannot be its own parent");
  await db
    .update(orgUnits)
    .set({
      name: v.name,
      kind: v.kind,
      parentId: v.parentId,
      leadPersonId: v.leadPersonId,
      targetHeadcount: v.targetHeadcount,
      isExternal: v.isExternal,
      vendorName: v.vendorName,
      costPerMonth: v.costPerMonth?.toString() ?? null,
      expectedRoi: v.expectedRoi?.toString() ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(orgUnits.id, id), eq(orgUnits.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteOrgUnit(id: string): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  await db
    .delete(orgUnits)
    .where(and(eq(orgUnits.id, id), eq(orgUnits.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

/** Reparent a unit (used by drag-and-drop in M4). */
export async function moveOrgUnit(
  id: string,
  parentId: string | null,
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  if (parentId === id) return fail("A unit cannot be its own parent");
  await db
    .update(orgUnits)
    .set({ parentId, updatedAt: new Date() })
    .where(and(eq(orgUnits.id, id), eq(orgUnits.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

// --- assignments ----------------------------------------------------------
export async function createAssignment(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const parsed = assignmentInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  const [row] = await db
    .insert(assignments)
    .values({
      workspaceId: workspace.id,
      personId: v.isOpenRole ? null : v.personId,
      orgUnitId: v.orgUnitId,
      roleOnTeam: v.roleOnTeam,
      allocationPct: v.allocationPct,
      isOpenRole: v.isOpenRole,
    })
    .returning({ id: assignments.id });
  revalidateAll();
  return { ok: true, data: { id: row.id } };
}

export async function deleteAssignment(id: string): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  await db
    .delete(assignments)
    .where(and(eq(assignments.id, id), eq(assignments.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

// --- demo org ---------------------------------------------------------------
export async function loadDemoOrg(): Promise<never> {
  const { workspace } = await requireWorkspace();
  await seedDemoOrg(workspace.id);
  revalidateAll();
  redirect("/org");
}

/** Move a person's assignment to a different unit (drag-and-drop, M4). */
export async function moveAssignment(
  id: string,
  orgUnitId: string,
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  await db
    .update(assignments)
    .set({ orgUnitId })
    .where(and(eq(assignments.id, id), eq(assignments.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}
