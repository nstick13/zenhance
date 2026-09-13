import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, workspaces, type Workspace } from "@/lib/db/schema";
import { getUserId } from "./currentUser";

/** Which of their workspaces the user last chose. */
export const WORKSPACE_COOKIE = "zenhance_workspace";

/**
 * Every workspace this user belongs to, oldest first — the list behind the
 * company switcher in the app header.
 */
export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({ workspace: workspaces })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.createdAt));
  return rows.map((r) => r.workspace);
}

/**
 * Resolves the active workspace for the current user, creating one on first
 * sign-in. This is the single choke point every page/action uses to obtain the
 * tenant scope — never query without it.
 *
 * The switcher's choice arrives in a cookie, which is **not** trusted: it only
 * selects among workspaces this user is already a member of, so a forged
 * cookie can't reach another tenant's data. Anything unrecognised silently
 * falls back to their first workspace.
 */
export async function getOrCreateWorkspace(
  userId: string,
): Promise<Workspace> {
  const existing = await listWorkspaces(userId);

  if (existing.length > 0) {
    const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    return existing.find((w) => w.id === chosen) ?? existing[0];
  }

  // Bootstrap: create workspace + owner membership atomically.
  return db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({ name: "My Organization", ownerUserId: userId })
      .returning();
    await tx
      .insert(memberships)
      .values({ workspaceId: ws.id, userId, role: "owner" })
      .onConflictDoNothing();
    return ws;
  });
}

/**
 * Switch the active company. Validates membership before writing the cookie —
 * the cookie is a *preference*, never a capability.
 */
export async function selectWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const allowed = await db
    .select({ id: memberships.workspaceId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  if (allowed.length === 0) return false;
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}

export type WorkspaceContext = {
  userId: string;
  workspace: Workspace;
};

/**
 * Returns the current user's workspace context, redirecting to sign-in if the
 * request is unauthenticated. Use at the top of every protected page/action.
 */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const userId = await getUserId();
  if (!userId) {
    redirect("/sign-in");
  }
  const workspace = await getOrCreateWorkspace(userId);
  return { userId, workspace };
}

/** Asserts a row belongs to the given workspace (defense-in-depth helper). */
export function assertSameWorkspace(
  workspaceId: string,
  ctx: WorkspaceContext,
): void {
  if (workspaceId !== ctx.workspace.id) {
    throw new Error("Cross-workspace access denied");
  }
}

export { and, eq };
