import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-[calc(100vh-57px)] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-4xl font-bold text-fuchsia-400">404</p>
        <p className="mt-3 text-slate-400">We couldn&apos;t find that page.</p>
        <div className="mt-6">
          <Link
            href="/org"
            className="rounded-md bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-400"
          >
            Go to Org
          </Link>
        </div>
      </div>
    </div>
  );
}
