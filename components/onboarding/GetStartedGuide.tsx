"use client";

/**
 * The guided start, once the company exists.
 *
 * It sits *on* the map rather than in front of it (Greg, 2026-09-19: "as if
 * starting a game"), asks for one thing at a time, and every answer appears on
 * the map behind it straight away. It reads the org to decide what to ask, so
 * it never asks for something you already have and it picks up wherever you
 * left off — no stored progress to drift out of step with reality.
 *
 * It retires itself: once there is a team with a person in it, the last step
 * is a way out, and dismissing it is remembered.
 */

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { addTeammate, createOrgUnit } from "@/lib/data/actions";
import type { Vocabulary } from "@/lib/vocabulary";
import { lower } from "@/lib/vocabulary";

const KEY = "zenhance_start_guide_done";
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const isDismissed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private browsing, or storage blocked. Showing the guide is the safe
    // failure: it can always be dismissed again.
    return false;
  }
};
/** Hidden until the browser tells us otherwise, so a dismissed guide never
 *  flashes up during hydration. */
const dismissedOnServer = () => true;
const dismiss = () => {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* nothing to remember it with; it will return next load */
  }
  listeners.forEach((l) => l());
};

export type GuideUnit = { id: string; name: string; kind: string; parentId: string | null };

export function GetStartedGuide({
  units,
  peopleCount,
  vocabulary,
}: {
  units: GuideUnit[];
  peopleCount: number;
  vocabulary: Vocabulary;
}) {
  const router = useRouter();
  const done = useSyncExternalStore(subscribe, isDismissed, dismissedOnServer);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const root = units.find((u) => u.parentId === null) ?? null;
  const streams = units.filter((u) => u.kind === "group" && u.parentId !== null);
  const teams = units.filter((u) => u.kind === "team");

  // An org this small is still being set up; past that, the guide has no
  // business on screen even if it was never dismissed.
  const stillSettingUp = teams.length < 2 || peopleCount < 1;
  if (done || !root || !stillSettingUp) return null;

  const step = streams.length === 0 ? 1 : teams.length === 0 ? 2 : peopleCount === 0 ? 3 : 4;

  const streamWord = lower(vocabulary.stream.singular);
  const teamWord = lower(vocabulary.team.singular);

  const choices = step === 2 ? streams : step === 3 ? teams : [];
  const chosen = parentId && choices.some((c) => c.id === parentId) ? parentId : choices[0]?.id ?? null;

  const prompt =
    step === 1
      ? `Add your first ${streamWord}`
      : step === 2
        ? `Now a ${teamWord} inside it`
        : `Put someone in a ${teamWord}`;

  const hint =
    step === 1
      ? `The big pieces of ${root.name} — a product line, a region, a function.`
      : step === 2
        ? `The group people actually sit in.`
        : `Just a name for now. You can fill in the rest later.`;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Type a name first");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result =
        step === 3
          ? chosen
            ? await addTeammate(trimmed, chosen)
            : { ok: false as const, error: `Add a ${teamWord} first` }
          : await createOrgUnit({
              name: trimmed,
              kind: step === 1 ? "group" : "team",
              parentId: step === 1 ? root.id : chosen,
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
      setName("");
      router.refresh();
    });
  };

  return (
    // Clear of the zoom ladder along the bottom and the account button in the
    // corner, so the guide never sits on top of the controls it is describing.
    <div className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center p-4 sm:justify-end sm:p-6">
      <div className="pointer-events-auto w-full max-w-sm rounded-lg border border-line bg-surface/95 p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            {step === 4 ? "Ready" : `Getting started · ${step} of 3`}
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="rounded px-2 py-1 text-xs text-ink-soft hover:text-ink"
          >
            {step === 4 ? "Done" : "Skip"}
          </button>
        </div>

        {step === 4 ? (
          <p className="mt-2 text-sm text-ink">
            That&apos;s a map. Drag things around, click a circle to see its route back to{" "}
            {root.name}, and keep adding whenever you like.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm font-medium text-ink">{prompt}</p>
            <p className="mt-1 text-xs text-ink-soft">{hint}</p>

            {choices.length > 1 && (
              <select
                aria-label={step === 2 ? `Which ${streamWord}` : `Which ${teamWord}`}
                value={chosen ?? ""}
                onChange={(e) => setParentId(e.target.value)}
                className="mt-3 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink"
              >
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            <div className="mt-3 flex gap-2">
              <input
                autoFocus
                value={name}
                disabled={pending}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder={step === 3 ? "Sam Okafor" : step === 2 ? "Checkout" : "Payments"}
                className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-ink disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-60"
              >
                {pending ? "Adding…" : "Add"}
              </button>
            </div>
            <p aria-live="polite" className="mt-2 min-h-[1rem] text-xs text-red-600">
              {error}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
