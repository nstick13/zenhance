import "server-only";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { memberships, workspaces, type Workspace } from "@/lib/db/schema";
import { getUserId } from "./currentUser";

/**
 * Resolves the active workspace for the current user, creating one on first
 * sign-in (v1 is one-user-per-workspace). This is the single choke point every
 * page/action uses to obtain the tenant scope — never query without it.
 */
export async function getOrCreateWorkspace(
  userId: string,
): Promise<Workspace> {
  const existing = await db
    .select({ workspace: workspaces })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].workspace;
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
