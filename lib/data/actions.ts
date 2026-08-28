"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { people, orgUnits, assignments, mapNodes, disciplines, workspaces, eq, and, sql } from "@/lib/db/orm";
import { requireWorkspace } from "@/lib/auth/workspace";
import {
  personInput,
  orgUnitInput,
  assignmentInput,
  assignmentPatch,
  disciplineUpdate,
  lensInput,
  vocabularyInput,
  findingsConfigInput,
  disciplineSpreadInput,
  podTemplateRoleInput,
} from "@/lib/validation";
import { seedDemoOrg } from "@/lib/data/demoSeed";
import {
  createDisciplineOp,
  updateDisciplineOp,
  deleteDisciplineOp,
  mergeDisciplinesOp,
  reorderDisciplinesOp,
} from "@/lib/data/disciplineOps";
import {
  saveWorkspaceFindingsConfigOp,
  setDisciplineSpreadOp,
  clearDisciplineSpreadOp,
} from "@/lib/data/findingsPolicyOps";
import {
  savePodTemplateRoleOp,
  removePodTemplateRoleOp,
} from "@/lib/data/podTemplateOps";
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
 * The settings-tab CRUD (S5 tab 2). Each of these is auth + validation +
 * revalidation around lib/data/disciplineOps.ts, which owns the workspace-
 * scoped data work — see that file for why the split exists.
 */
export async function createDiscipline(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const { workspace } = await requireWorkspace();
  const parsed = disciplineUpdate.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const res = await createDisciplineOp(workspace.id, {
    name: parsed.data.name,
    color: parsed.data.color,
  });
  if (res.ok) revalidateAll();
  return res;
}

/** Rename, recolour and reposition one discipline in a single write. */
export async function updateDiscipline(id: string, raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = disciplineUpdate.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const res = await updateDisciplineOp(workspace.id, id, parsed.data);
  if (res.ok) revalidateAll();
  return res;
}

/** Delete a discipline, moving everyone who holds it first. */
export async function deleteDiscipline(
  id: string,
  reassignToId: string | null,
): Promise<ActionResult<{ reassigned: number }>> {
  const { workspace } = await requireWorkspace();
  const res = await deleteDisciplineOp(workspace.id, id, reassignToId);
  if (res.ok) revalidateAll();
  return res;
}

/** Fold one discipline into another. */
export async function mergeDisciplines(
  fromId: string,
  intoId: string,
): Promise<ActionResult<{ moved: number }>> {
  const { workspace } = await requireWorkspace();
  const res = await mergeDisciplinesOp(workspace.id, fromId, intoId);
  if (res.ok) revalidateAll();
  return res;
}

/** Persist a new sort order. */
export async function reorderDisciplines(orderedIds: string[]): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const res = await reorderDisciplinesOp(workspace.id, orderedIds);
  if (res.ok) revalidateAll();
  return res;
}

// --- vocabulary (S5 tab 1) --------------------------------------------------

/**
 * Persist what this workspace calls its two rungs. Display strings only —
 * `org_units.kind` is untouched, so this is never a migration.
 */
export async function saveVocabulary(raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = vocabularyInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid vocabulary");
  await db
    .update(workspaces)
    .set({ vocabulary: parsed.data, updatedAt: new Date() })
    .where(eq(workspaces.id, workspace.id));
  revalidateAll();
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

// --- findings policy (S5 tab 5) ---------------------------------------------
/**
 * The workspace-wide findings config: detector switches + the default Spread
 * threshold. Changing it changes what the findings engine raises, so /org (the
 * findings surface) revalidates alongside /settings.
 */
export async function saveFindingsConfig(raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = findingsConfigInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid config");
  const res = await saveWorkspaceFindingsConfigOp(workspace.id, parsed.data);
  if (res.ok) {
    revalidatePath("/org");
    revalidatePath("/settings");
  }
  return res;
}

/** Set (or clear) one discipline's Spread override. `threshold: null` means
 *  "no limit"; passing `clear: true` removes the override entirely (inherit). */
export async function setDisciplineSpread(
  raw: unknown,
  clear = false,
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  if (clear) {
    const id = typeof raw === "string" ? raw : "";
    if (!id) return fail("Invalid discipline");
    const res = await clearDisciplineSpreadOp(workspace.id, id);
    if (res.ok) {
      revalidatePath("/org");
      revalidatePath("/settings");
    }
    return res;
  }
  const parsed = disciplineSpreadInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid override");
  const res = await setDisciplineSpreadOp(
    workspace.id,
    parsed.data.disciplineId,
    parsed.data.threshold,
  );
  if (res.ok) {
    revalidatePath("/org");
    revalidatePath("/settings");
  }
  return res;
}

// --- pod template (S5 tab 4) ------------------------------------------------
/** Add or update one role's range in the ideal pod. */
export async function savePodTemplateRole(raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = podTemplateRoleInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid role");
  const res = await savePodTemplateRoleOp(workspace.id, parsed.data);
  if (res.ok) revalidatePath("/settings");
  return res;
}

/** Remove a discipline from the ideal pod. */
export async function removePodTemplateRole(disciplineId: string): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  if (typeof disciplineId !== "string" || !disciplineId) return fail("Invalid discipline");
  const res = await removePodTemplateRoleOp(workspace.id, disciplineId);
  if (res.ok) revalidatePath("/settings");
  return res;
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

/**
 * Persist many positions at once — dragging a value stream moves every team in
 * it and every seat in those teams, which would otherwise be dozens of
 * round-trips for one gesture.
 */
export async function saveMapNodePositions(
  rows: { nodeType: "unit" | "person"; nodeId: string; x: number; y: number }[],
  boardId = "default",
): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  if (rows.length === 0) return { ok: true, data: undefined };
  if (rows.length > 2000) return fail("Too many positions in one write");
  const values = rows.map((r) => {
    if (r.nodeType !== "unit" && r.nodeType !== "person") throw new Error("Invalid node type");
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) throw new Error("Invalid position");
    return {
      workspaceId: workspace.id,
      boardId,
      nodeType: r.nodeType,
      nodeId: r.nodeId,
      x: r.x.toFixed(2),
      y: r.y.toFixed(2),
    };
  });
  await db
    .insert(mapNodes)
    .values(values)
    .onConflictDoUpdate({
      target: [mapNodes.workspaceId, mapNodes.boardId, mapNodes.nodeType, mapNodes.nodeId],
      set: { x: sql`excluded.x`, y: sql`excluded.y`, updatedAt: new Date() },
    });
  return { ok: true, data: undefined };
}

// --- lens (S3: per-workspace display config) --------------------------------
/**
 * Persist the map lens *default*. Validated here rather than trusted, because
 * the value lands in a schemaless jsonb column — the Zod parse *is* the column
 * type. Fired from two places: the canvas topbar's "Make default", and the
 * Map defaults settings tab. Both edit the workspace-wide default; the topbar's
 * ordinary lens flips stay in browser storage (my view) and never come here.
 */
export async function saveLens(raw: unknown): Promise<ActionResult> {
  const { workspace } = await requireWorkspace();
  const parsed = lensInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid lens");
  await db
    .update(workspaces)
    .set({ lens: parsed.data, updatedAt: new Date() })
    .where(eq(workspaces.id, workspace.id));
  revalidatePath("/org");
  revalidatePath("/settings");
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
