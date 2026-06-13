"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-[calc(100vh-57px)] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-4xl font-bold text-fuchsia-400">Oops</p>
        <p className="mt-3 text-slate-400">Something went wrong on this page.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-fuchsia-500 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-400"
          >
            Try again
          </button>
          <Link
            href="/org"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800"
          >
            Go to Org
          </Link>
        </div>
      </div>
    </div>
  );
}
