import "server-only";

/**
 * Centralized current-user resolution.
 *
 * In production (and whenever Clerk keys are present) this delegates to Clerk.
 * For local development before Clerk is configured, a *fenced* dev bypass
 * injects a fixed user so the app is runnable. The bypass is only active when:
 *   - NODE_ENV !== "production", AND
 *   - DEV_AUTH === "1", AND
 *   - Clerk keys are absent.
 * It can never activate in a production build.
 */

const DEV_USER_ID = "dev-user";

export function isClerkEnabled(): boolean {
  return (
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}

export function isDevAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH === "1" &&
    !isClerkEnabled()
  );
}

/** Returns the current Clerk (or dev) user id, or null if unauthenticated. */
export async function getUserId(): Promise<string | null> {
  if (isClerkEnabled()) {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    return userId ?? null;
  }
  if (isDevAuthEnabled()) {
    return DEV_USER_ID;
  }
  return null;
}

/** Like getUserId but throws if unauthenticated. Use in trusted server paths. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}
