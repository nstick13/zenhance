import Link from "next/link";

/** Shared top nav for all marketing pages. Server component (no client JS). */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          <span className="text-fuchsia-400">Zen</span>hance
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-slate-300 sm:flex">
          <Link href="/features" className="hover:text-white">Features</Link>
          <Link href="/pricing" className="hover:text-white">Pricing</Link>
          <Link href="/about" className="hover:text-white">About</Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="hidden text-sm text-slate-300 hover:text-white sm:block">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md bg-fuchsia-500 px-4 py-1.5 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/20 hover:bg-fuchsia-400"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
