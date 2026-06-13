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
