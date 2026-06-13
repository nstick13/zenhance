import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Next.js 16 renamed Middleware -> Proxy. Runs before each request.
 *
 * When Clerk keys are present we attach Clerk's auth context here; otherwise
 * (local dev-auth bypass) this is a no-op and pages enforce access via
 * `requireWorkspace()`. clerkMiddleware() is only invoked when enabled, so the
 * missing-keys path never executes it.
 */
const clerkEnabled =
  !!process.env.CLERK_SECRET_KEY &&
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default clerkEnabled
  ? clerkMiddleware()
  : function proxy() {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    // Run on everything except Next internals and files with an extension.
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
