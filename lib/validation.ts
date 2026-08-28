import { z } from "zod";

/**
 * Shared Zod schemas — used by forms, server actions, and CSV import so the
 * same validation runs everywhere. Empty strings from form inputs are coerced
 * to null/undefined where appropriate.
 */

const emptyToNull = (v: unknown) =>
  v === "" || v === undefined ? null : v;

const optionalString = z.preprocess(emptyToNull, z.string().trim().min(1).nullable());

const optionalMoney = z.preprocess(
  emptyToNull,
  z.coerce.number().nonnegative().nullable(),
);

const optionalDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable(),
);

export const personInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  title: optionalString,
  startDate: optionalDate,
  costPerMonth: optionalMoney,
  skills: z
    .preprocess(
      (v) =>
        typeof v === "string"
          ? v.split(",").map((s) => s.trim()).filter(Boolean)
          : Array.isArray(v)
            ? v
            : [],
      z.array(z.string()),
    )
    .default([]),
  growthFocus: optionalString,
  photoUrl: optionalString,
  lastVacationAt: optionalDate,
  /** What they *are* (structured). `title` above is their HR label (free text). */
  disciplineId: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
  employment: z.enum(["fte", "contractor", "vendor", "unknown"]).default("unknown"),
  location: optionalString,
  timezone: optionalString,
});
export type PersonInput = z.infer<typeof personInput>;

export const orgUnitInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["group", "team"]).default("team"),
  parentId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  leadPersonId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  targetHeadcount: z.preprocess(
    emptyToNull,
    z.coerce.number().int().nonnegative().nullable(),
  ),
  isExternal: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  vendorName: optionalString,
  costPerMonth: optionalMoney,
  expectedRoi: optionalMoney,
});
export type OrgUnitInput = z.infer<typeof orgUnitInput>;

export const assignmentInput = z
  .object({
    personId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
    orgUnitId: z.string().uuid(),
    roleOnTeam: optionalString,
    allocationPct: z.preprocess(
      (v) => (v === "" || v === undefined ? 100 : v),
      z.coerce.number().int().min(1).max(100),
    ),
    isOpenRole: z
      .preprocess((v) => v === true || v === "on" || v === "true", z.boolean())
      .default(false),
  })
  .refine((d) => d.isOpenRole || d.personId, {
    message: "An assignment needs a person, or must be marked an open role",
    path: ["personId"],
  });
export type AssignmentInput = z.infer<typeof assignmentInput>;

/** Partial edit of an existing assignment (allocation % and/or role on team). */
export const assignmentPatch = z.object({
  allocationPct: z.coerce.number().int().min(1).max(100).optional(),
  roleOnTeam: optionalString.optional(),
});
export type AssignmentPatch = z.infer<typeof assignmentPatch>;

/** A hex colour as the settings colour picker writes it. Null clears it back
 *  to the ramp, which is a legitimate choice, not an empty form. */
const hexColor = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0369a1")
    .nullable(),
);

/** One discipline row (S5 settings). Validates the colour and carries sort
 *  order, because here both are typed by a human rather than inherited from
 *  an import — the import path find-or-creates by name only. */
export const disciplineUpdate = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Keep it under 60 characters"),
  color: hexColor,
  sortOrder: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? 0 : v),
    z.coerce.number().int().min(0),
  ),
});
export type DisciplineUpdate = z.infer<typeof disciplineUpdate>;

/** The map lens (S3). Both fields required — the client always sends a whole
 *  lens, and a partial write would silently reset the other dimension. */
export const lensInput = z.object({
  colorBy: z.enum(["utilisation", "discipline", "employment", "stream"]),
  labelBy: z.enum(["name", "nameTitle", "initials"]),
});
export type LensInput = z.infer<typeof lensInput>;

/** The workspace vocabulary (S5 tab 1). Every field required — the settings
 *  form always sends a whole vocabulary, and a partial write would silently
 *  reset the terms it omitted. Shape mirrors lib/vocabulary.ts. */
const term = z.object({
  singular: z.string().trim().min(1, "A name is required").max(40, "Keep it under 40 characters"),
  plural: z.string().trim().min(1, "A plural is required").max(40, "Keep it under 40 characters"),
});

export const vocabularyInput = z.object({
  stream: term,
  team: term,
});
export type VocabularyInput = z.infer<typeof vocabularyInput>;

/** A Spread team-count threshold anywhere it's set by a user: a whole number,
 *  at least 2 (below that "spread" is meaningless — one team isn't a spread). */
const spreadThreshold = z
  .number()
  .int("Use a whole number")
  .min(2, "A spread starts at 2 teams")
  .max(50, "Keep it under 50");

/** The workspace-wide findings config (S5 tab 5) — detector switches + the
 *  default Spread threshold. The per-discipline overrides are their own action. */
export const findingsConfigInput = z.object({
  spreadEnabled: z.boolean(),
  overCommitmentEnabled: z.boolean(),
  couplingEnabled: z.boolean(),
  defaultSpreadThreshold: spreadThreshold,
});
export type FindingsConfigInput = z.infer<typeof findingsConfigInput>;

/** One discipline's Spread override: a threshold, or null for "no limit". */
export const disciplineSpreadInput = z.object({
  disciplineId: z.string().uuid(),
  threshold: spreadThreshold.nullable(),
});
export type DisciplineSpreadInput = z.infer<typeof disciplineSpreadInput>;
