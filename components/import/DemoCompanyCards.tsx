"use client";

import { useState, useTransition } from "react";
import { seedDemoCompany } from "@/lib/data/actions";
import { DEMO_COMPANIES, type DemoCompanyKind } from "@/lib/demoCompanies";

const STARTER_KINDS = ["small"] as const satisfies readonly DemoCompanyKind[];

/**
 * The "no file handy" door on the import page. Each card creates a *new*
 * workspace, seeds it, and drops you on its map — so the first thing a new
 * account can do is look at a real org, not an empty canvas.
 *
 * The action redirects, so the pending state never needs clearing: the page
 * is gone by the time it would matter.
 */
export function DemoCompanyCards() {
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<DemoCompanyKind | null>(null);

  const load = (kind: DemoCompanyKind) => {
    setRunning(kind);
    startTransition(() => {
      void seedDemoCompany(kind);
    });
  };

  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="text-sm font-semibold">No file handy?</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Load an example organization instead. It lands in a new company of its
        own — your current one is left exactly as it is.
      </p>

      <div className="mt-4 max-w-md">
        {STARTER_KINDS.map((kind) => {
          const c = DEMO_COMPANIES[kind];
          const isRunning = pending && running === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => load(kind)}
              disabled={pending}
              className="rounded-lg border border-line p-4 text-left transition hover:border-ink-soft disabled:opacity-60"
            >
              <span className="block text-sm font-medium">{c.label}</span>
              <span className="mt-1 block text-xs text-ink-soft">{c.blurb}</span>
              <span className="mt-3 block text-xs font-medium">
                {isRunning ? "Building the org…" : "Load →"}
              </span>
            </button>
          );
        })}
      </div>

    </section>
  );
}
