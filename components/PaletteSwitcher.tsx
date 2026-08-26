"use client";

import { useEffect, useState } from "react";
import { PALETTES, PALETTE_IDS, DEFAULT_PALETTE, STORAGE_KEY, type PaletteId } from "@/lib/theme";

export function PaletteSwitcher() {
  const [current, setCurrent] = useState<PaletteId>(DEFAULT_PALETTE);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const palette = (PALETTE_IDS.includes(saved as PaletteId) ? saved : DEFAULT_PALETTE) as PaletteId;
    setCurrent(palette);
    document.documentElement.dataset.palette = palette;
    setMounted(true);
  }, []);

  function apply(id: PaletteId) {
    setCurrent(id);
    localStorage.setItem(STORAGE_KEY, id);
    document.documentElement.dataset.palette = id;
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Palette: ${PALETTES[current].name}`}
        aria-label="Change color palette"
        className="h-5 w-5 rounded-full border border-line hover:border-ink-soft transition-colors"
        style={{ backgroundColor: PALETTES[current].accent }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-20 flex items-center gap-2 rounded-lg border border-line bg-surface p-2 shadow-xl">
            {PALETTE_IDS.map((id) => (
              <button
                key={id}
                onClick={() => apply(id)}
                title={PALETTES[id].name}
                aria-label={PALETTES[id].name}
                className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                  current === id ? "ring-2 ring-white ring-offset-1 ring-offset-slate-900" : ""
                }`}
                style={{ backgroundColor: PALETTES[id].accent }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
