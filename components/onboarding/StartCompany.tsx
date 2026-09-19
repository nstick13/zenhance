"use client";

/**
 * The first thing a brand-new workspace sees.
 *
 * Greg, 2026-09-19: "a user should go directly into the map, as if starting a
 * game." So this is not a form on a page — it is the map with nothing in it
 * yet. Same paper, same rings, and one empty circle at the centre waiting for
 * a name. Typing it creates the company and the real map takes over, so the
 * first thing you ever do already happened *on the map*.
 *
 * The other two doors stay, quietly: loading an example and importing a
 * spreadsheet are still the fastest routes for anyone who has a file or just
 * wants a look around.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createOrgUnit } from "@/lib/data/actions";
import type { Vocabulary } from "@/lib/vocabulary";
import { lower } from "@/lib/vocabulary";

export function StartCompany({ vocabulary }: { vocabulary: Vocabulary }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give it a name to get started");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createOrgUnit({
        name: trimmed,
        kind: "group",
        parentId: null,
        leadPersonId: null,
        targetHeadcount: null,
        isExternal: false,
        vendorName: null,
        costPerMonth: null,
        expectedRoi: null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The map is a server component; refreshing swaps this screen for it.
      router.refresh();
    });
  };

  return (
    <div className="relative flex h-[calc(100vh-57px)] items-center justify-center overflow-hidden bg-paper text-ink">
      {/* The rungs, already there before anything stands on them. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="-400 -400 800 800"
      >
        {[120, 220, 320, 420].map((r) => (
          <circle key={r} cx={0} cy={0} r={r} fill="none" stroke="currentColor" strokeWidth={1} className="text-line" />
        ))}
      </svg>

      <div className="relative z-10 w-full max-w-sm px-6 text-center">
        <div className="mx-auto flex aspect-square w-64 flex-col items-center justify-center rounded-full border border-line bg-surface p-8 shadow-sm">
          <label htmlFor="company-name" className="text-sm font-medium text-ink">
            What&apos;s your company called?
          </label>
          <input
            id="company-name"
            autoFocus
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") start();
            }}
            placeholder="Acme Freight"
            className="mt-3 w-full rounded-md border border-line bg-paper px-3 py-2 text-center text-sm outline-none focus:border-ink disabled:opacity-60"
          />
          <button
            type="button"
            onClick={start}
            disabled={pending}
            className="mt-3 w-full rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-60"
          >
            {pending ? "Starting…" : "Start"}
          </button>
          <p aria-live="polite" className="mt-2 min-h-[1rem] text-xs text-red-600">
            {error}
          </p>
        </div>

        <p className="mt-6 text-sm text-ink-soft">
          You&apos;ll add your {lower(vocabulary.stream.plural)} and {lower(vocabulary.team.plural)} on the
          map itself — nothing to fill in first.
        </p>

        <p className="mt-4 text-xs text-ink-soft">
          Or{" "}
          <Link href="/import" className="underline hover:text-ink">
            import a spreadsheet
          </Link>{" "}
          ·{" "}
          <Link href="/import#examples" className="underline hover:text-ink">
            load an example company
          </Link>
        </p>
      </div>
    </div>
  );
}
