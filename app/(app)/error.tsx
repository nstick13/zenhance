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
        <p className="text-4xl font-bold text-grow">Oops</p>
        <p className="mt-3 text-ink-soft">Something went wrong on this page.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft"
          >
            Try again
          </button>
          <Link
            href="/org"
            className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-paper"
          >
            Go to Org
          </Link>
        </div>
      </div>
    </div>
  );
}
