import "server-only";
import { db } from "@/lib/db/client";
import {
  people,
  orgUnits,
  assignments,
  eq,
  and,
  asc,
  type Person,
  type OrgUnit,
  type Assignment,
} from "@/lib/db/orm";
import { requireWorkspace } from "@/lib/auth/workspace";

/** Everything needed to render the org, fetched in one workspace-scoped pass. */
export type OrgSnapshot = {
  workspaceId: string;
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
};

export async function getOrgSnapshot(): Promise<OrgSnapshot> {
  const { workspace } = await requireWorkspace();
  const wid = workspace.id;
  const [p, u, a] = await Promise.all([
    db.select().from(people).where(eq(people.workspaceId, wid)).orderBy(asc(people.name)),
    db.select().from(orgUnits).where(eq(orgUnits.workspaceId, wid)).orderBy(asc(orgUnits.name)),
    db.select().from(assignments).where(eq(assignments.workspaceId, wid)),
  ]);
  return { workspaceId: wid, people: p, units: u, assignments: a };
}

export async function getPeople(): Promise<Person[]> {
  const { workspace } = await requireWorkspace();
  return db
    .select()
    .from(people)
    .where(eq(people.workspaceId, workspace.id))
    .orderBy(asc(people.name));
}

export async function getOrgUnits(): Promise<OrgUnit[]> {
  const { workspace } = await requireWorkspace();
  return db
    .select()
    .from(orgUnits)
    .where(eq(orgUnits.workspaceId, workspace.id))
    .orderBy(asc(orgUnits.name));
}

export async function getPerson(id: string): Promise<Person | null> {
  const { workspace } = await requireWorkspace();
  const rows = await db
    .select()
    .from(people)
    .where(and(eq(people.id, id), eq(people.workspaceId, workspace.id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrgUnit(id: string): Promise<OrgUnit | null> {
  const { workspace } = await requireWorkspace();
  const rows = await db
    .select()
    .from(orgUnits)
    .where(and(eq(orgUnits.id, id), eq(orgUnits.workspaceId, workspace.id)))
    .limit(1);
  return rows[0] ?? null;
}
