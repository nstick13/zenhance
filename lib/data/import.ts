"use server";

import { db } from "@/lib/db/client";
import { people, orgUnits, assignments, eq } from "@/lib/db/orm";
import { requireWorkspace } from "@/lib/auth/workspace";
import { personInput, orgUnitInput } from "@/lib/validation";

/**
 * Transactional org import. The client maps spreadsheet columns to these
 * normalized rows; this action validates everything and commits in one
 * transaction (all-or-nothing). References are resolved by name:
 *   - a team's `parent` / `lead` -> existing or just-created units/people
 *   - an assignment's `person` / `team` -> existing or just-created rows
 */

export type ImportPersonRow = {
  name: string;
  title?: string;
  costPerMonth?: string;
  skills?: string;
  startDate?: string;
  growthFocus?: string;
  lastVacationAt?: string;
};

export type ImportTeamRow = {
  name: string;
  kind?: string;
  parent?: string;
  lead?: string;
  targetHeadcount?: string;
  isExternal?: string;
  vendor?: string;
  costPerMonth?: string;
  expectedRoi?: string;
};

export type ImportAssignmentRow = {
  person?: string;
  team: string;
  role?: string;
  allocationPct?: string;
  isOpenRole?: string;
};

export type ImportPayload = {
  people: ImportPersonRow[];
  teams: ImportTeamRow[];
  assignments: ImportAssignmentRow[];
};

export type ImportError = { sheet: string; row: number; message: string };

export type ImportResult =
  | { ok: true; created: { people: number; teams: number; assignments: number } }
  | { ok: false; errors: ImportError[] };

const truthy = (v?: string) =>
  !!v && ["1", "true", "yes", "y", "x"].includes(v.trim().toLowerCase());

export async function importOrg(payload: ImportPayload): Promise<ImportResult> {
  const { workspace } = await requireWorkspace();
  const wid = workspace.id;
  const errors: ImportError[] = [];

  // --- validate -----------------------------------------------------------
  const validPeople = payload.people.map((r, i) => {
    const parsed = personInput.safeParse({
      name: r.name,
      title: r.title,
      costPerMonth: r.costPerMonth,
      skills: r.skills,
      startDate: r.startDate,
      growthFocus: r.growthFocus,
      lastVacationAt: r.lastVacationAt,
    });
    if (!parsed.success)
      errors.push({ sheet: "People", row: i + 2, message: parsed.error.issues[0].message });
    return parsed.success ? parsed.data : null;
  });

  const validTeams = payload.teams.map((r, i) => {
    const parsed = orgUnitInput.safeParse({
      name: r.name,
      kind: r.kind || "team",
      parentId: null, // resolved by name below
      leadPersonId: null,
      targetHeadcount: r.targetHeadcount,
      isExternal: truthy(r.isExternal),
      vendorName: r.vendor,
      costPerMonth: r.costPerMonth,
      expectedRoi: r.expectedRoi,
    });
    if (!parsed.success)
      errors.push({ sheet: "Teams", row: i + 2, message: parsed.error.issues[0].message });
    return parsed.success ? { data: parsed.data, parent: r.parent, lead: r.lead } : null;
  });

  payload.assignments.forEach((r, i) => {
    if (!r.team?.trim())
      errors.push({ sheet: "Assignments", row: i + 2, message: "Team is required" });
    if (!truthy(r.isOpenRole) && !r.person?.trim())
      errors.push({
        sheet: "Assignments",
        row: i + 2,
        message: "Needs a person, or mark it an open role",
      });
  });

  if (errors.length > 0) return { ok: false, errors };

  // --- commit -------------------------------------------------------------
  try {
    const result = await db.transaction(async (tx) => {
      // Pre-load existing rows so name references resolve to them too.
      const existingPeople = await tx
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(eq(people.workspaceId, wid));
      const existingUnits = await tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.workspaceId, wid));

      const personIdByName = new Map(existingPeople.map((p) => [p.name.toLowerCase(), p.id]));
      const unitIdByName = new Map(existingUnits.map((u) => [u.name.toLowerCase(), u.id]));

      // People
      let createdPeople = 0;
      for (const v of validPeople) {
        if (!v) continue;
        if (personIdByName.has(v.name.toLowerCase())) continue;
        const [row] = await tx
          .insert(people)
          .values({
            workspaceId: wid,
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
        personIdByName.set(v.name.toLowerCase(), row.id);
        createdPeople++;
      }

      // Teams (create first, then wire parent/lead by name)
      let createdTeams = 0;
      for (const t of validTeams) {
        if (!t) continue;
        if (unitIdByName.has(t.data.name.toLowerCase())) continue;
        const [row] = await tx
          .insert(orgUnits)
          .values({
            workspaceId: wid,
            name: t.data.name,
            kind: t.data.kind,
            targetHeadcount: t.data.targetHeadcount,
            isExternal: t.data.isExternal,
            vendorName: t.data.vendorName,
            costPerMonth: t.data.costPerMonth?.toString() ?? null,
            expectedRoi: t.data.expectedRoi?.toString() ?? null,
          })
          .returning({ id: orgUnits.id });
        unitIdByName.set(t.data.name.toLowerCase(), row.id);
        createdTeams++;
      }
      for (const t of validTeams) {
        if (!t) continue;
        const id = unitIdByName.get(t.data.name.toLowerCase());
        if (!id) continue;
        const parentId = t.parent ? unitIdByName.get(t.parent.toLowerCase()) ?? null : null;
        const leadId = t.lead ? personIdByName.get(t.lead.toLowerCase()) ?? null : null;
        if (parentId || leadId) {
          await tx
            .update(orgUnits)
            .set({ parentId, leadPersonId: leadId })
            .where(eq(orgUnits.id, id));
        }
      }

      // Assignments
      let createdAssignments = 0;
      for (const a of payload.assignments) {
        const unitId = unitIdByName.get(a.team.trim().toLowerCase());
        if (!unitId) continue; // team not found; skip rather than fail commit
        const isOpen = truthy(a.isOpenRole);
        const personId = isOpen
          ? null
          : personIdByName.get((a.person ?? "").trim().toLowerCase()) ?? null;
        if (!isOpen && !personId) continue;
        const alloc = a.allocationPct ? Math.max(1, Math.min(100, parseInt(a.allocationPct, 10) || 100)) : 100;
        await tx.insert(assignments).values({
          workspaceId: wid,
          orgUnitId: unitId,
          personId,
          roleOnTeam: a.role || null,
          allocationPct: alloc,
          isOpenRole: isOpen,
        });
        createdAssignments++;
      }

      return { people: createdPeople, teams: createdTeams, assignments: createdAssignments };
    });

    return { ok: true, created: result };
  } catch (e) {
    return {
      ok: false,
      errors: [{ sheet: "—", row: 0, message: e instanceof Error ? e.message : "Import failed" }],
    };
  }
}
