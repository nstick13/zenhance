"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchWorkspace } from "@/lib/data/actions";

/**
 * Which company you're looking at. The header already showed the workspace
 * name; this makes it the control it looked like (Greg, 2026-09-14).
 *
 * The chosen workspace is a *preference* held in a cookie and validated
 * server-side against the user's memberships — picking one here can never
 * reach a tenant they don't belong to (see lib/auth/workspace.ts).
 */
export function WorkspaceSwitcher({
  current,
  options,
}: {
  current: { id: string; name: string };
  options: { id: string; name: string; headcount: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to switch between: keep the plain label the header always had.
  if (options.length < 2) return <span>{current.name}</span>;

  const choose = (id: string) => {
    setOpen(false);
    if (id === current.id) return;
    startTransition(async () => {
      const result = await switchWorkspace(id);
      if (!result.ok) {
        console.error("Failed to switch company:", result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-paper disabled:opacity-60"
      >
        <span>{current.name}</span>
        <span aria-hidden className="text-ink-soft text-[10px] leading-none">
          ▼
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
        >
          {options.map((o) => {
            const active = o.id === current.id;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(o.id)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-paper ${
                  active ? "bg-paper" : ""
                }`}
              >
                <span className={`truncate text-sm ${active ? "font-semibold text-ink" : "text-ink"}`}>
                  {o.name}
                </span>
                <span className="shrink-0 text-xs text-ink-soft">
                  {o.headcount.toLocaleString()} people
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
