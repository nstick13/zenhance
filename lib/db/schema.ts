import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  date,
  timestamp,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Zenhance data model.
 *
 * The delivery org is modelled as a generic *tree of units* (`orgUnits`,
 * self-referencing via `parentId`) plus `people`, joined by `assignments`
 * (the many-to-many edge that makes "this person is on N teams" detectable).
 * Every row is scoped by `workspaceId` — the tenant boundary. All data access
 * goes through the workspace-scoped layer in `lib/auth/workspace.ts`.
 */

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);

export const orgUnitKind = pgEnum("org_unit_kind", ["group", "team"]);

// --- workspace (tenant) ---------------------------------------------------
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(), // Clerk user id
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- membership (forward-compat for invites; v1 uses owner only) ----------
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // Clerk user id
    role: membershipRole("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memberships_workspace_user_uq").on(t.workspaceId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

// --- people ---------------------------------------------------------------
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    startDate: date("start_date"), // tenure
    costPerMonth: numeric("cost_per_month", { precision: 12, scale: 2 }),
    skills: text("skills").array().notNull().default([]),
    growthFocus: text("growth_focus"),
    photoUrl: text("photo_url"),
    lastVacationAt: date("last_vacation_at"), // powers burnout fast-follow
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("people_workspace_idx").on(t.workspaceId)],
);

// --- org units (the delivery tree: groups and teams) ----------------------
export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id, {
      onDelete: "cascade",
    }), // self-ref; null = root

    name: text("name").notNull(),
    kind: orgUnitKind("kind").notNull().default("team"),
    leadPersonId: uuid("lead_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    targetHeadcount: integer("target_headcount"), // for gap detection
    isExternal: boolean("is_external").notNull().default(false), // contractor team
    vendorName: text("vendor_name"),
    costPerMonth: numeric("cost_per_month", { precision: 12, scale: 2 }),
    expectedRoi: numeric("expected_roi", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("org_units_workspace_idx").on(t.workspaceId),
    index("org_units_parent_idx").on(t.parentId),
  ],
);

// --- assignments (person <-> org_unit edge) -------------------------------
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "cascade",
    }), // null when isOpenRole = true
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnits.id, { onDelete: "cascade" }),
    roleOnTeam: text("role_on_team"),
    allocationPct: integer("allocation_pct").notNull().default(100),
    isOpenRole: boolean("is_open_role").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assignments_workspace_idx").on(t.workspaceId),
    index("assignments_person_idx").on(t.personId),
    index("assignments_org_unit_idx").on(t.orgUnitId),
  ],
);

// --- relations ------------------------------------------------------------
export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
  people: many(people),
  orgUnits: many(orgUnits),
  assignments: many(assignments),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [people.workspaceId],
    references: [workspaces.id],
  }),
  assignments: many(assignments),
}));

export const orgUnitsRelations = relations(orgUnits, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [orgUnits.workspaceId],
    references: [workspaces.id],
  }),
  parent: one(orgUnits, {
    fields: [orgUnits.parentId],
    references: [orgUnits.id],
    relationName: "org_unit_parent",
  }),
  children: many(orgUnits, { relationName: "org_unit_parent" }),
  lead: one(people, {
    fields: [orgUnits.leadPersonId],
    references: [people.id],
  }),
  assignments: many(assignments),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [assignments.workspaceId],
    references: [workspaces.id],
  }),
  person: one(people, {
    fields: [assignments.personId],
    references: [people.id],
  }),
  orgUnit: one(orgUnits, {
    fields: [assignments.orgUnitId],
    references: [orgUnits.id],
  }),
}));

// Convenience types
export type Workspace = typeof workspaces.$inferSelect;
export type Person = typeof people.$inferSelect;
export type OrgUnit = typeof orgUnits.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
