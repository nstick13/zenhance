import "server-only";
import { db } from "@/lib/db/client";
import {
  people,
  orgUnits,
  assignments,
  mapNodes,
  disciplines,
  eq,
  and,
  asc,
  sql,
  type Person,
  type OrgUnit,
  type Assignment,
  type MapNodeRow,
  type Discipline,
} from "@/lib/db/orm";
import { requireWorkspace } from "@/lib/auth/workspace";
import { normalizeLens, type Lens } from "@/lib/canvas/lens";
import { normalizeVocabulary, type Vocabulary } from "@/lib/vocabulary";

/** Everything needed to render the org, fetched in one workspace-scoped pass. */
export type OrgSnapshot = {
  workspaceId: string;
  people: Person[];
  units: OrgUnit[];
  assignments: Assignment[];
  disciplines: Discipline[];
  /** The workspace's display lens (S3), already normalised to a valid shape. */
  lens: Lens;
  /** What this workspace calls its two rungs (S5), normalised on the way out. */
  vocabulary: Vocabulary;
};

export async function getOrgSnapshot(): Promise<OrgSnapshot> {
  const { workspace } = await requireWorkspace();
  const wid = workspace.id;
  const [p, u, a, d] = await Promise.all([
    db.select().from(people).where(eq(people.workspaceId, wid)).orderBy(asc(people.name)),
    db.select().from(orgUnits).where(eq(orgUnits.workspaceId, wid)).orderBy(asc(orgUnits.name)),
    db.select().from(assignments).where(eq(assignments.workspaceId, wid)),
    db.select().from(disciplines).where(eq(disciplines.workspaceId, wid)).orderBy(asc(disciplines.sortOrder)),
  ]);
  return {
    workspaceId: wid,
    people: p,
    units: u,
    assignments: a,
    disciplines: d,
    lens: normalizeLens(workspace.lens),
    vocabulary: normalizeVocabulary(workspace.vocabulary),
  };
}

/** The workspace's vocabulary alone — for pages that need the labels but not
 *  the whole org. Always normalised, so callers never see a raw blob. */
export async function getVocabulary(): Promise<Vocabulary> {
  const { workspace } = await requireWorkspace();
  return normalizeVocabulary(workspace.vocabulary);
}

/** The workspace's default lens alone — for the Map defaults settings tab,
 *  which edits the workspace-wide default (the canvas edits only *my view*). */
export async function getWorkspaceLens(): Promise<Lens> {
  const { workspace } = await requireWorkspace();
  return normalizeLens(workspace.lens);
}

export async function getDisciplines(): Promise<Discipline[]> {
  const { workspace } = await requireWorkspace();
  return db
    .select()
    .from(disciplines)
    .where(eq(disciplines.workspaceId, workspace.id))
    .orderBy(asc(disciplines.sortOrder));
}

/**
 * How many people hold each discipline, workspace-scoped. The settings tab
 * shows this next to every row so "delete" is never a blind action, and one
 * grouped count beats N round trips from the client.
 */
export async function getDisciplinePeopleCounts(): Promise<Record<string, number>> {
  const { workspace } = await requireWorkspace();
  const rows = await db
    .select({ id: people.disciplineId, n: sql<number>`count(*)::int` })
    .from(people)
    .where(eq(people.workspaceId, workspace.id))
    .groupBy(people.disciplineId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.id) out[r.id] = r.n;
  return out;
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

/** Persisted canvas-map node positions (v2). A missing row falls back to a
 * computed seed layout — see lib/canvas/buildCanvasMap.ts. */
export async function getMapNodes(boardId = "default"): Promise<MapNodeRow[]> {
  const { workspace } = await requireWorkspace();
  return db
    .select()
    .from(mapNodes)
    .where(and(eq(mapNodes.workspaceId, workspace.id), eq(mapNodes.boardId, boardId)));
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
