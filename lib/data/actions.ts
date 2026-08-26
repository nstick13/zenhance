"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { people, orgUnits, assignments, mapNodes, disciplines, eq, and } from "@/lib/db/orm";
import { requireWorkspace } from "@/lib/auth/workspace";
import {
  personInput,
  orgUnitInput,
  assignmentInput,
  assignmentPatch,
  disciplineInput,
} from "@/lib/validation";
import { seedDemoOrg } from "@/lib/data/demoSeed";
import { getOrgSnapshot } from "@/lib/data/queries";
import { buildCanvasMap } from "@/lib/canvas/buildCanvasMap";

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
      disciplineId: v.disciplineId ?? null,
      employment: v.employment,
      location: v.location,
      timezone: v.timezone,
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
      disciplineId: v.disciplineId ?? null,
      employment: v.employment,
      location: v.location,
      timezone: v.timezone,
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

// --- disciplines ----------------------------------------------------------

/**
 * Find-or-create a discipline by name. Import and inline entry both lean on
 * this: an unrecognised value creates the discipline rather than blocking on
 * taxonomy setup, and the user renames or merges afterwards.
 */
export async function ensureDiscipline(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const parsed = disciplineInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const v = parsed.data;
  const [existing] = await db
    .select({ id: disciplines.id })
    .from(disciplines)
    .where(and(eq(disciplines.workspaceId, workspace.id), eq(disciplines.name, v.name)));
  if (existing) return { ok: true, data: { id: existing.id } };
  const [row] = await db
    .insert(disciplines)
    .values({ workspaceId: workspace.id, name: v.name, color: v.color })
    .returning({ id: disciplines.id });
  revalidateAll();
  return { ok: true, data: { id: row.id } };
}

export async function renameDiscipline(id: string, raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = disciplineInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  await db
    .update(disciplines)
    .set({ name: parsed.data.name, color: parsed.data.color })
    .where(and(eq(disciplines.id, id), eq(disciplines.workspaceId, workspace.id)));
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

/** Edit an existing assignment in place — the allocation % and/or role. */
export async function updateAssignment(id: string, raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = assignmentPatch.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return { ok: true, data: undefined };
  await db
    .update(assignments)
    .set(patch)
    .where(and(eq(assignments.id, id), eq(assignments.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteAssignment(id: string): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  await db
    .delete(assignments)
    .where(and(eq(assignments.id, id), eq(assignments.workspaceId, workspace.id)));
  revalidateAll();
  return { ok: true, data: undefined };
}

// --- map nodes (v2 canvas: persisted node positions) ----------------------
/** Upsert a dragged node's position. Fires on every drag end, so this
 * deliberately skips revalidateAll() — the canvas already reflects the move
 * optimistically and a route revalidation would just cause a jarring refetch. */
export async function saveMapNodePosition(
  nodeType: "unit" | "person",
  nodeId: string,
  x: number,
  y: number,
  boardId = "default",
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  if (nodeType !== "unit" && nodeType !== "person") return fail("Invalid node type");
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fail("Invalid position");
  await db
    .insert(mapNodes)
    .values({
      workspaceId: workspace.id,
      boardId,
      nodeType,
      nodeId,
      x: x.toFixed(2),
      y: y.toFixed(2),
    })
    .onConflictDoUpdate({
      target: [mapNodes.workspaceId, mapNodes.boardId, mapNodes.nodeType, mapNodes.nodeId],
      set: { x: x.toFixed(2), y: y.toFixed(2), updatedAt: new Date() },
    });
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

/** Tidy up canvas layout — recompute positions from org structure and persist them. */
export async function tidyUpCanvasLayout(): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const snapshot = await getOrgSnapshot();

  // Recompute layout from scratch (empty positions map = fresh seed layout)
  const mapData = buildCanvasMap(
    { people: snapshot.people, units: snapshot.units, assignments: snapshot.assignments },
    new Map(),
  );

  // Batch upsert all positions
  for (const node of mapData.nodes) {
    await db
      .insert(mapNodes)
      .values({
        workspaceId: workspace.id,
        boardId: "default",
        nodeType: node.kind === "team" ? "unit" : "person",
        nodeId: node.id,
        x: node.x.toFixed(2),
        y: node.y.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [mapNodes.workspaceId, mapNodes.boardId, mapNodes.nodeType, mapNodes.nodeId],
        set: { x: node.x.toFixed(2), y: node.y.toFixed(2), updatedAt: new Date() },
      });
  }

  revalidateAll();
  return { ok: true, data: undefined };
}
