import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/workspace";
import { isClerkEnabled } from "@/lib/auth/currentUser";

/**
 * Protected app shell. `requireWorkspace()` enforces auth (redirecting to
 * /sign-in when unauthenticated) and bootstraps the tenant on first visit.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { workspace } = await requireWorkspace();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/org" className="text-lg font-semibold tracking-tight">
            <span className="text-fuchsia-400">Zen</span>hance
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-400">
            <Link href="/org" className="hover:text-slate-100">
              Org
            </Link>
            <Link href="/people" className="hover:text-slate-100">
              People
            </Link>
            <Link href="/teams" className="hover:text-slate-100">
              Teams
            </Link>
            <Link href="/import" className="hover:text-slate-100">
              Import
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>{workspace.name}</span>
          {isClerkEnabled() ? (
            <UserButtonSlot />
          ) : (
            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
              dev auth
            </span>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

async function UserButtonSlot() {
  const { UserButton } = await import("@clerk/nextjs");
  return <UserButton />;
}
