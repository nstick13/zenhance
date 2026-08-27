import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/workspace";
import { isClerkEnabled } from "@/lib/auth/currentUser";
import { PaletteSwitcher } from "@/components/PaletteSwitcher";
import { normalizeVocabulary } from "@/lib/vocabulary";

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
  // The nav wears the workspace's own word for the bottom rung (S5 tab 1).
  const vocab = normalizeVocabulary(workspace.vocabulary);

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/org" className="text-lg font-semibold tracking-tight">
            <span style={{ color: "var(--accent-text)" }}>Zen</span>hance
          </Link>
          <nav className="flex items-center gap-4 text-sm text-ink-soft">
            <Link href="/org" className="hover:text-ink">
              Org
            </Link>
            <Link href="/people" className="hover:text-ink">
              People
            </Link>
            <Link href="/teams" className="hover:text-ink">
              {vocab.team.plural}
            </Link>
            <Link href="/import" className="hover:text-ink">
              Import
            </Link>
            <Link href="/settings" className="hover:text-ink">
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-soft">
          <PaletteSwitcher />
          <span>{workspace.name}</span>
          {isClerkEnabled() ? (
            <UserButtonSlot />
          ) : (
            <span className="rounded bg-paper px-2 py-0.5 text-xs text-ink-soft">
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
