/**
 * Vocabulary (S5, tab 1) — what this workspace *calls* the two rungs of the
 * map. Heather's org says "vertical product group" and means value stream;
 * a SAFe shop says "Agile Release Train". The structure is identical, so this
 * is display strings only: `org_units.kind` stays `group | team` and no data
 * migration is ever implied by a change here.
 *
 * Pure and client-safe by design, mirroring lib/canvas/lens.ts: no React, no
 * DB. Persisted as one jsonb blob on `workspaces.vocabulary`. Deliberately
 * NOT in `workspaces.lens` — the lens is a *view preference* that may become
 * per-user, while vocabulary is workspace-wide taxonomy everyone shares.
 *
 * Everything read from the DB goes through `normalizeVocabulary`, which
 * degrades per-field, so a blob written by an older or newer build can never
 * crash a page.
 */

// --- the config -----------------------------------------------------------

export type Term = {
  /** "Value stream" — sentence case, used mid-sentence and as a form label. */
  singular: string;
  /** "Value streams" — the plural. Not derived; "people" is not "persons". */
  plural: string;
};

export type Vocabulary = {
  /** The top rung: a group of teams that delivers something end to end. */
  stream: Term;
  /** The bottom rung: the unit people are actually assigned to. */
  team: Term;
};

export const DEFAULT_VOCABULARY: Vocabulary = {
  stream: { singular: "Value stream", plural: "Value streams" },
  team: { singular: "Team", plural: "Teams" },
};

/** Longest a term may be. Long enough for "Vertical product group", short
 *  enough that a canvas header or a button label still fits. */
export const MAX_TERM_LENGTH = 40;

// --- presets --------------------------------------------------------------

export type VocabularyPreset = {
  id: string;
  label: string;
  /** Heather: "give them examples with some metadata. Like, hey, here's how
   *  we would use this." One line on when this preset is the right one. */
  description: string;
  vocabulary: Vocabulary;
};

export const PRESETS: VocabularyPreset[] = [
  {
    id: "generic",
    label: "Generic",
    description:
      "Neutral delivery language. Start here if your org has no house term, or has three competing ones.",
    vocabulary: DEFAULT_VOCABULARY,
  },
  {
    id: "safe",
    label: "SAFe",
    description:
      "Scaled Agile terms. Use when your org runs PI planning and people already say “ART” out loud.",
    vocabulary: {
      stream: { singular: "Agile Release Train", plural: "Agile Release Trains" },
      team: { singular: "Team", plural: "Teams" },
    },
  },
  {
    id: "product-group",
    label: "Vertical product group",
    description:
      "Product-led language. Use when streams are named after the product they own rather than the flow of work.",
    vocabulary: {
      stream: { singular: "Vertical product group", plural: "Vertical product groups" },
      team: { singular: "Pod", plural: "Pods" },
    },
  },
];

export const presetById = (id: string): VocabularyPreset | undefined =>
  PRESETS.find((p) => p.id === id);

/** Which preset (if any) this vocabulary currently matches — so the settings
 *  UI can show "SAFe" rather than "Custom" for an untouched preset. */
export function matchPreset(v: Vocabulary): VocabularyPreset | null {
  return PRESETS.find((p) => sameVocabulary(p.vocabulary, v)) ?? null;
}

export const sameVocabulary = (a: Vocabulary, b: Vocabulary) =>
  a.stream.singular === b.stream.singular &&
  a.stream.plural === b.stream.plural &&
  a.team.singular === b.team.singular &&
  a.team.plural === b.team.plural;

export const isDefaultVocabulary = (v: Vocabulary) => sameVocabulary(v, DEFAULT_VOCABULARY);

// --- normalisation --------------------------------------------------------

function term(raw: unknown, fallback: Term): Term {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const one = str(o.singular);
  const many = str(o.plural);
  // Degrade per-field: a blob that only ever carried a singular still yields a
  // usable plural rather than discarding the singular the user typed.
  return {
    singular: one ?? fallback.singular,
    plural: many ?? (one ? `${one}s` : fallback.plural),
  };
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, MAX_TERM_LENGTH);
}

/**
 * Coerce anything (a DB blob, a stale client value) into a valid Vocabulary.
 * Unknown keys are dropped; every field falls back independently, so one bad
 * term never discards the other three.
 */
export function normalizeVocabulary(raw: unknown): Vocabulary {
  if (!raw || typeof raw !== "object") return DEFAULT_VOCABULARY;
  const o = raw as Record<string, unknown>;
  return {
    stream: term(o.stream, DEFAULT_VOCABULARY.stream),
    team: term(o.team, DEFAULT_VOCABULARY.team),
  };
}

// --- rendering helpers ----------------------------------------------------

/** Lower-case form for mid-sentence use: "Add a value stream". Acronym-ish
 *  terms ("Agile Release Train") keep their capitals — lowercasing "ART" or a
 *  proper noun reads as a typo, so only a plain capitalised word is folded. */
export function lower(t: string): string {
  const words = t.split(/\s+/).filter(Boolean);
  // Proper if any word carries a capital past its first letter ("ART"), or if
  // any word *after the first* is capitalised ("Agile Release Train"). A single
  // leading capital is just sentence case and folds.
  const looksProper =
    words.some((w) => w.slice(1) !== w.slice(1).toLowerCase()) ||
    words.slice(1).some((w) => w[0] !== w[0]?.toLowerCase());
  return looksProper ? t : t.toLowerCase();
}

/** Sentence-initial form: "Value stream", "Agile Release Train". */
export function title(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
