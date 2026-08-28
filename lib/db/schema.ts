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
  jsonb,
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

export const mapNodeType = pgEnum("map_node_type", ["unit", "person"]);

/**
 * How a person is employed. Deliberately a fixed enum, not a workspace-defined
 * list: outsourcing exposure is a headline finding, so "contractor" has to mean
 * the same thing in every workspace to stay comparable.
 */
export const employmentType = pgEnum("employment_type", [
  "fte",
  "contractor",
  "vendor",
  "unknown",
]);

// --- workspace (tenant) ---------------------------------------------------
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(), // Clerk user id
  /**
   * The map lens (S3): how this workspace chooses to *read* its org — what
   * colour and label carry. One jsonb blob rather than a column per setting,
   * because the set of display dimensions will keep growing and each one is
   * a display preference, never a fact anything queries or joins on.
   * Null = the defaults in lib/canvas/lens.ts. Shape is validated on write
   * and re-normalised on read, so an older/newer blob can never crash a map.
   */
  lens: jsonb("lens"),
  /**
   * What this workspace *calls* the two rungs (S5 tab 1): stream/team singular
   * and plural. A separate blob from `lens` on purpose — the lens is a view
   * preference that may become per-user, while vocabulary is workspace-wide
   * taxonomy everyone shares. Display strings only: `org_units.kind` stays
   * `group | team` and nothing here implies a data migration.
   * Null = the defaults in lib/vocabulary.ts; re-normalised on read.
   */
  vocabulary: jsonb("vocabulary"),
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
/**
 * A workspace's discipline taxonomy — what a person *is* (developer, QA, SRE),
 * as opposed to `people.title` (their HR label, free text) or
 * `assignments.roleOnTeam` (what they do on one specific team, free text).
 *
 * A table rather than an enum or a text[] because: every org's list differs;
 * renaming one is a single row instead of a rewrite across every person; and
 * colour-by-discipline needs a stable, user-settable colour per value.
 */
export const disciplines = pgTable(
  "disciplines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Hex colour used by colour-by-discipline; null = assign one from a ramp. */
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("disciplines_workspace_idx").on(t.workspaceId),
    unique("disciplines_workspace_name_uq").on(t.workspaceId, t.name),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    managerId: uuid("manager_id").references((): AnyPgColumn => people.id, {
      onDelete: "set null",
    }), // self-ref formal reporting line; null = no manager in this workspace
    startDate: date("start_date"), // tenure
    costPerMonth: numeric("cost_per_month", { precision: 12, scale: 2 }),
    skills: text("skills").array().notNull().default([]),
    growthFocus: text("growth_focus"),
    photoUrl: text("photo_url"),
    lastVacationAt: date("last_vacation_at"), // powers burnout fast-follow
    /** What they *are*. Structured, because analytics counts it. */
    disciplineId: uuid("discipline_id").references(() => disciplines.id, {
      onDelete: "set null",
    }),
    employment: employmentType("employment").notNull().default("unknown"),
    location: text("location"), // free text, for display
    timezone: text("timezone"), // IANA name, e.g. "Europe/Berlin" — powers distribution drag
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("people_workspace_idx").on(t.workspaceId),
    index("people_manager_idx").on(t.managerId),
    index("people_discipline_idx").on(t.disciplineId),
  ],
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

// --- map nodes (v2 canvas: persisted per-workspace node positions) --------
// Polymorphic over `people` / `orgUnits` (and synthetic nodes like the
// cross-cutting bucket computed in lib/canvas/buildCanvasMap.ts) — no FK on
// nodeId, so it's advisory placement data, not a source of truth. A missing
// row falls back to a computed seed layout (see docs/V2.md).
export const mapNodes = pgTable(
  "map_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: text("board_id").notNull().default("default"),
    nodeType: mapNodeType("node_type").notNull(),
    nodeId: text("node_id").notNull(),
    x: numeric("x", { precision: 10, scale: 2 }).notNull(),
    y: numeric("y", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("map_nodes_workspace_board_node_uq").on(
      t.workspaceId,
      t.boardId,
      t.nodeType,
      t.nodeId,
    ),
    index("map_nodes_workspace_idx").on(t.workspaceId),
  ],
);

// --- findings policy (S5 tab 5: the detector/policy config) ---------------
/**
 * A workspace's rules for what the findings detectors may raise. Deliberately
 * the first *policy*-class config to get a real table (lens and vocabulary are
 * jsonb blobs): this is compared against live data and keyed by discipline, so
 * it is joined and queried, not just displayed.
 *
 * Two row shapes share the table:
 *  - the row with `disciplineId = NULL` holds the workspace-wide config — the
 *    three detector switches and the default Spread threshold;
 *  - every other row holds one discipline's Spread override in `spreadThreshold`
 *    (a number = flag at N, NULL = no limit). No row for a discipline = inherit.
 *
 * A brand-new table read only by the findings path on purpose — nothing in the
 * always-on `requireWorkspace` selects it, so the migration's blast radius is
 * the findings surface alone, not the whole app.
 */
export const findingsPolicy = pgTable(
  "findings_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** NULL = the workspace-wide config row; otherwise a discipline override. */
    disciplineId: uuid("discipline_id").references(() => disciplines.id, {
      onDelete: "cascade",
    }),
    /** Team count at which Spread fires. On the workspace row: the default.
     *  On a discipline row: N = flag at N, NULL = no limit (never flag). */
    spreadThreshold: integer("spread_threshold"),
    /** Detector switches — read only from the workspace-wide (NULL) row. */
    spreadEnabled: boolean("spread_enabled").notNull().default(true),
    overCommitmentEnabled: boolean("over_commitment_enabled").notNull().default(true),
    couplingEnabled: boolean("coupling_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("findings_policy_workspace_idx").on(t.workspaceId),
    // One row per (workspace, discipline); the workspace-wide row is the NULL
    // slot. Postgres treats NULLs as distinct in a UNIQUE, so this is backed by
    // a partial unique index in the migration to keep that row single.
    unique("findings_policy_workspace_discipline_uq").on(t.workspaceId, t.disciplineId),
  ],
);

// --- relations ------------------------------------------------------------
export const workspacesRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
  people: many(people),
  orgUnits: many(orgUnits),
  assignments: many(assignments),
  mapNodes: many(mapNodes),
}));

export const mapNodesRelations = relations(mapNodes, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [mapNodes.workspaceId],
    references: [workspaces.id],
  }),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [people.workspaceId],
    references: [workspaces.id],
  }),
  manager: one(people, {
    fields: [people.managerId],
    references: [people.id],
    relationName: "person_manager",
  }),
  reports: many(people, { relationName: "person_manager" }),
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
export type Discipline = typeof disciplines.$inferSelect;
export type OrgUnit = typeof orgUnits.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type MapNodeRow = typeof mapNodes.$inferSelect;
export type FindingsPolicyRow = typeof findingsPolicy.$inferSelect;
