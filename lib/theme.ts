export const PALETTE_IDS = ["cosmic", "forest", "crimson", "ocean", "ember"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const DEFAULT_PALETTE: PaletteId = "cosmic";
export const STORAGE_KEY = "zenhance-palette";

export const PALETTES: Record<PaletteId, { name: string; accent: string }> = {
  cosmic:  { name: "Cosmic",  accent: "#e879f9" },
  forest:  { name: "Forest",  accent: "#4ade80" },
  crimson: { name: "Crimson", accent: "#fb7185" },
  ocean:   { name: "Ocean",   accent: "#38bdf8" },
  ember:   { name: "Ember",   accent: "#fbbf24" },
};
