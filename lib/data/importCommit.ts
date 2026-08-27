import { people, orgUnits, assignments, disciplines, eq } from "@/lib/db/orm";
import { personInput, orgUnitInput } from "@/lib/validation";
import type { db } from "@/lib/db/client";
import {
  normalizeEmployment,
  normalizeTimezone,
  suggestDiscipline,
} from "./importMapping";

/**
 * The import engine — deliberately NOT a "use server" module.
 *
 * `importOrg` in ./import.ts is the thin server action over this; the logic
 * lives here so the integration test can drive the real code against a
 * throwaway workspace instead of re-implementing it and proving nothing.
 *
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
  manager?: string; // manager name → resolved to managerId
  /** Discipline *name*; find-or-created in the workspace's taxonomy. */
  discipline?: string;
  employment?: string; // free text → the fixed enum, via normalizeEmployment
  location?: string;
  timezone?: string; // free text → IANA, via normalizeTimezone
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
  /**
   * Fill an empty discipline by reading the person's title (S2). Off unless
   * the wizard asked for it, and the wizard only asks after showing exactly
   * what the pass would create — a taxonomy is not something to invent behind
   * someone's back.
   */
  suggestDisciplineFromTitle?: boolean;
};

export type ImportError = { sheet: string; row: number; message: string };

export type ImportResult =
  | {
      ok: true;
      created: { people: number; teams: number; assignments: number; disciplines: number };
      /**
       * Non-blocking: values we could not make sense of and therefore left
       * empty. The org still lands — "close enough for what we want to talk
       * about" beats refusing the file — but the losses are stated, never
       * silent.
       */
      warnings: string[];
    }
  | { ok: false; errors: ImportError[] };

const truthy = (v?: string) =>
  !!v && ["1", "true", "yes", "y", "x"].includes(v.trim().toLowerCase());

/** A Drizzle transaction handle, as `db.transaction` hands it over. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function commitImport(
  tx: Tx,
  wid: string,
  payload: ImportPayload,
): Promise<ImportResult> {
  const errors: ImportError[] = [];

  const warnings: string[] = [];
  let droppedTimezones = 0;
  let unreadEmployment = 0;

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
      location: r.location,
    });
    if (!parsed.success)
      errors.push({ sheet: "People", row: i + 2, message: parsed.error.issues[0].message });
    if (!parsed.success) return null;

    // The S2 fields never fail an import — a bad value degrades to empty and
    // is counted, because the alternative is an org that won't load at all.
    const employment = normalizeEmployment(r.employment);
    if (r.employment?.trim() && employment === "unknown") unreadEmployment++;

    const timezone = normalizeTimezone(r.timezone);
    if (r.timezone?.trim() && !timezone) droppedTimezones++;

    return {
      data: parsed.data,
      manager: r.manager,
      discipline: r.discipline?.trim() || null,
      employment,
      timezone,
    };
  });

  if (unreadEmployment > 0)
    warnings.push(
      `${unreadEmployment} employment value(s) weren't recognised and were left as "unknown".`,
    );
  if (droppedTimezones > 0)
    warnings.push(
      `${droppedTimezones} timezone(s) couldn't be resolved to an IANA zone and were left empty.`,
    );

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
  // Pre-load existing rows so name references resolve to them too.
  const existingPeople = await tx
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.workspaceId, wid));
  const existingUnits = await tx
    .select({ id: orgUnits.id, name: orgUnits.name })
    .from(orgUnits)
    .where(eq(orgUnits.workspaceId, wid));

  const existingDisciplines = await tx
    .select({ id: disciplines.id, name: disciplines.name })
    .from(disciplines)
    .where(eq(disciplines.workspaceId, wid));

  const personIdByName = new Map(existingPeople.map((p) => [p.name.toLowerCase(), p.id]));
  const unitIdByName = new Map(existingUnits.map((u) => [u.name.toLowerCase(), u.id]));
  const disciplineIdByName = new Map(
    existingDisciplines.map((d) => [d.name.toLowerCase(), d.id]),
  );
  // Suggestions resolve against the workspace's own taxonomy first, so an
  // org that already curated "Software Engineering" never gets a second,
  // near-duplicate "Engineering" created beside it.
  const knownDisciplineNames = existingDisciplines.map((d) => d.name);
  let createdDisciplines = 0;

  /**
   * Find-or-create, matching `ensureDiscipline`'s semantics but inside this
   * transaction — an import that half-commits a taxonomy would be worse
   * than one that fails.
   */
  const resolveDiscipline = async (name: string): Promise<string> => {
    const key = name.toLowerCase();
    const hit = disciplineIdByName.get(key);
    if (hit) return hit;
    const [row] = await tx
      .insert(disciplines)
      .values({ workspaceId: wid, name, sortOrder: knownDisciplineNames.length })
      .returning({ id: disciplines.id });
    disciplineIdByName.set(key, row.id);
    knownDisciplineNames.push(name);
    createdDisciplines++;
    return row.id;
  };

  // People — insert first, then wire managerId in a second pass so
  // forward-references resolve regardless of row order in the sheet.
  let createdPeople = 0;
  for (const v of validPeople) {
    if (!v) continue;
    if (personIdByName.has(v.data.name.toLowerCase())) continue;

    // An explicit discipline column wins; the title is only read when the
    // sheet didn't say and the user opted in.
    const disciplineName =
      v.discipline ??
      (payload.suggestDisciplineFromTitle
        ? suggestDiscipline(v.data.title, knownDisciplineNames)
        : null);
    const disciplineId = disciplineName ? await resolveDiscipline(disciplineName) : null;

    const [row] = await tx
      .insert(people)
      .values({
        workspaceId: wid,
        name: v.data.name,
        title: v.data.title,
        startDate: v.data.startDate,
        costPerMonth: v.data.costPerMonth?.toString() ?? null,
        skills: v.data.skills,
        growthFocus: v.data.growthFocus,
        photoUrl: v.data.photoUrl,
        lastVacationAt: v.data.lastVacationAt,
        disciplineId,
        employment: v.employment,
        location: v.data.location,
        timezone: v.timezone,
      })
      .returning({ id: people.id });
    personIdByName.set(v.data.name.toLowerCase(), row.id);
    createdPeople++;
  }
  // Second pass: resolve manager by name now that all people exist.
  for (const v of validPeople) {
    if (!v?.manager?.trim()) continue;
    const personId = personIdByName.get(v.data.name.toLowerCase());
    const managerId = personIdByName.get(v.manager.trim().toLowerCase()) ?? null;
    if (personId && managerId) {
      await tx.update(people).set({ managerId }).where(eq(people.id, personId));
    }
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

  return {
    ok: true,
    created: {
      people: createdPeople,
      teams: createdTeams,
      assignments: createdAssignments,
      disciplines: createdDisciplines,
    },
    warnings,
  };
}
