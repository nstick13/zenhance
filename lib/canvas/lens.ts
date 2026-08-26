/**
 * The lens (S3) — a workspace's choice of what the map's *colour* and *label*
 * carry. Pure and client-safe: no React, no DB, no Konva. The canvas asks this
 * module "what colour is this person, and what do I write under them?", so the
 * meaning of a seat lives in one file rather than being scattered through the
 * render blocks.
 *
 * Persisted as one jsonb blob on `workspaces.lens` (see lib/db/schema.ts).
 * Everything read from the DB goes through `normalizeLens`, so a blob written
 * by an older or newer build degrades to a default rather than crashing a map.
 */

import type { CanvasPerson } from "./buildCanvasMap";

// --- the config -----------------------------------------------------------

/** What colour means. `utilisation` is the pre-S3 behaviour and stays default. */
export type ColorBy = "utilisation" | "discipline" | "employment" | "stream";

/** What a seat is labelled with. `name` is the pre-S3 behaviour. */
export type LabelBy = "name" | "nameTitle" | "initials";

export type Lens = {
  colorBy: ColorBy;
  labelBy: LabelBy;
};

export const DEFAULT_LENS: Lens = { colorBy: "utilisation", labelBy: "name" };

const COLOR_BY_VALUES: ColorBy[] = ["utilisation", "discipline", "employment", "stream"];
const LABEL_BY_VALUES: LabelBy[] = ["name", "nameTitle", "initials"];

export const COLOR_BY_OPTIONS: { value: ColorBy; label: string; hint: string }[] = [
  { value: "utilisation", label: "Utilisation", hint: "Green → red as load passes 100%" },
  { value: "discipline", label: "Discipline", hint: "What each person is" },
  { value: "employment", label: "Employment", hint: "Employee, contractor, vendor" },
  { value: "stream", label: "Value stream", hint: "Their home stream's identity hue" },
];

export const LABEL_BY_OPTIONS: { value: LabelBy; label: string; hint: string }[] = [
  { value: "name", label: "Name", hint: "Full name under every seat" },
  { value: "nameTitle", label: "Name + title", hint: "Title always on, not only when zoomed in" },
  { value: "initials", label: "Initials", hint: "Quietest — the shape of the org, not the roster" },
];

/**
 * Coerce anything (a DB blob, a stale client value) into a valid Lens.
 * Unknown keys are dropped; unknown values fall back per-field, so one bad
 * setting never discards the other.
 */
export function normalizeLens(raw: unknown): Lens {
  if (!raw || typeof raw !== "object") return DEFAULT_LENS;
  const o = raw as Record<string, unknown>;
  const colorBy = COLOR_BY_VALUES.includes(o.colorBy as ColorBy)
    ? (o.colorBy as ColorBy)
    : DEFAULT_LENS.colorBy;
  const labelBy = LABEL_BY_VALUES.includes(o.labelBy as LabelBy)
    ? (o.labelBy as LabelBy)
    : DEFAULT_LENS.labelBy;
  return { colorBy, labelBy };
}

export const isDefaultLens = (l: Lens) =>
  l.colorBy === DEFAULT_LENS.colorBy && l.labelBy === DEFAULT_LENS.labelBy;

// --- colour ---------------------------------------------------------------

/**
 * Fallback hues for disciplines with no `disciplines.color` set. Same "paper"
 * register as STREAM_HUES but a distinct, wider set — a discipline and a value
 * stream are different questions and shouldn't answer in the same five colours.
 */
export const DISCIPLINE_RAMP = [
  "#0369a1", // engineering blue
  "#7c3aed", // violet
  "#b45309", // amber-brown
  "#0f766e", // teal
  "#be123c", // rose
  "#4d7c0f", // olive
  "#7e22ce", // purple
  "#1d4ed8", // indigo-blue
];

/** Employment is a fixed enum, so its colours are fixed too — comparable across
 *  workspaces, which is the whole point of the enum (see schema.ts). */
export const EMPLOYMENT_COLORS: Record<CanvasPerson["employment"], string> = {
  fte: "#0f766e",
  contractor: "#b45309",
  vendor: "#7c3aed",
  unknown: "#94a3b8",
};

export const EMPLOYMENT_ORDER: CanvasPerson["employment"][] = [
  "fte",
  "contractor",
  "vendor",
  "unknown",
];

export type DisciplineLike = { id: string; name: string; color: string | null };

/** Resolved colour per discipline id — the row's own colour, else the ramp. */
export function disciplineColors(list: DisciplineLike[]): Map<string, string> {
  const m = new Map<string, string>();
  list.forEach((d, i) => m.set(d.id, d.color ?? DISCIPLINE_RAMP[i % DISCIPLINE_RAMP.length]));
  return m;
}

/** Someone with no discipline set — deliberately grey, not a ramp colour, so a
 *  missing value reads as missing rather than as its own category. */
export const NO_VALUE_COLOR = "#b6b1a6";

export type PersonColorContext = {
  lens: Lens;
  /** Total allocation %, already summed by the caller. */
  utilisation: number;
  utilColor: (pct: number) => string;
  disciplineColor: Map<string, string>;
  /** Identity hue of the person's home value stream. */
  streamHue: string | null;
};

/** The single answer to "what colour is this seat?" under the active lens. */
export function personColor(p: CanvasPerson, ctx: PersonColorContext): string {
  switch (ctx.lens.colorBy) {
    case "discipline":
      return (p.disciplineId && ctx.disciplineColor.get(p.disciplineId)) || NO_VALUE_COLOR;
    case "employment":
      return EMPLOYMENT_COLORS[p.employment] ?? NO_VALUE_COLOR;
    case "stream":
      return ctx.streamHue ?? NO_VALUE_COLOR;
    case "utilisation":
    default:
      return ctx.utilColor(ctx.utilisation);
  }
}

// --- legend ---------------------------------------------------------------

export type LegendEntry = { key: string; label: string; color: string; count: number };

/**
 * The legend for the active lens, counted over the people actually on the map.
 * Utilisation returns its bands; the categorical lenses return only the values
 * present, most-populous first, so the legend describes *this* org rather than
 * the taxonomy in the abstract.
 */
export function buildLegend(
  lens: Lens,
  people: CanvasPerson[],
  ctx: {
    utilisationOf: (p: CanvasPerson) => number;
    disciplineColor: Map<string, string>;
    disciplineName: Map<string, string>;
    streamHueOf: (p: CanvasPerson) => string | null;
    streamNameOf: (p: CanvasPerson) => string | null;
    employmentLabel: Record<string, string>;
    utilColor: (pct: number) => string;
  },
): LegendEntry[] {
  if (lens.colorBy === "utilisation") {
    const bands: [string, string, (u: number) => boolean][] = [
      ["Unassigned", ctx.utilColor(0), (u) => u === 0],
      ["Under 100%", ctx.utilColor(50), (u) => u > 0 && u <= 100],
      ["Over 100%", ctx.utilColor(105), (u) => u > 100 && u <= 110],
      ["Over 110%", ctx.utilColor(120), (u) => u > 110],
    ];
    return bands.map(([label, color, test]) => ({
      key: label,
      label,
      color,
      count: people.filter((p) => test(ctx.utilisationOf(p))).length,
    }));
  }

  const buckets = new Map<string, LegendEntry>();
  const add = (key: string, label: string, color: string) => {
    const e = buckets.get(key);
    if (e) e.count += 1;
    else buckets.set(key, { key, label, color, count: 1 });
  };

  for (const p of people) {
    if (lens.colorBy === "discipline") {
      if (p.disciplineId) {
        add(
          p.disciplineId,
          ctx.disciplineName.get(p.disciplineId) ?? "Unknown",
          ctx.disciplineColor.get(p.disciplineId) ?? NO_VALUE_COLOR,
        );
      } else {
        add("__none", "No discipline", NO_VALUE_COLOR);
      }
    } else if (lens.colorBy === "employment") {
      add(p.employment, ctx.employmentLabel[p.employment] ?? p.employment, EMPLOYMENT_COLORS[p.employment]);
    } else {
      const name = ctx.streamNameOf(p);
      add(name ?? "__none", name ?? "No stream", ctx.streamHueOf(p) ?? NO_VALUE_COLOR);
    }
  }

  // Most-populous first, but keep the "missing value" bucket last wherever it
  // lands — a gap belongs at the bottom of a legend, not competing for the top.
  return [...buckets.values()].sort((a, b) => {
    const aMissing = a.key === "__none" || a.key === "unknown";
    const bMissing = b.key === "__none" || b.key === "unknown";
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });
}

// --- labels ---------------------------------------------------------------

/** "Marco Webb" -> "MW". Two letters max; a mononym gives one. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Marco Webb" -> "M. Webb" — the ghost-seat form, kept short but identifying. */
export function shortNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/**
 * What goes under a seat. Returns the primary line plus an optional secondary;
 * `nameTitle` promotes the title to always-on (at other lens settings the
 * title still appears, but only at the "roles" zoom level).
 */
export function personLabel(
  p: { name: string; title: string | null },
  lens: Lens,
  opts: { short?: boolean } = {},
): { primary: string; secondary: string | null } {
  const full = opts.short ? shortNameOf(p.name) : p.name;
  switch (lens.labelBy) {
    case "initials":
      return { primary: initialsOf(p.name), secondary: null };
    case "nameTitle":
      return { primary: full, secondary: p.title?.trim() || null };
    case "name":
    default:
      return { primary: full, secondary: null };
  }
}
