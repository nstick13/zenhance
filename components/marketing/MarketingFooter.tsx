import Link from "next/link";

/** Shared footer for all marketing pages. */
export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-base font-semibold">
            <span className="text-fuchsia-400">Zen</span>hance
          </span>
          <p className="mt-1 text-xs text-slate-500">Your delivery org, not your HR chart.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
          <Link href="/features" className="hover:text-white">Features</Link>
          <Link href="/pricing" className="hover:text-white">Pricing</Link>
          <Link href="/about" className="hover:text-white">About</Link>
          <Link href="/sign-in" className="hover:text-white">Sign in</Link>
        </nav>
      </div>
      <div className="border-t border-slate-900 px-6 py-4 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} Zenhance. All rights reserved.
      </div>
    </footer>
  );
}
