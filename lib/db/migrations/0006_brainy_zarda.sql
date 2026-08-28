CREATE TABLE "findings_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"discipline_id" uuid,
	"spread_threshold" integer,
	"spread_enabled" boolean DEFAULT true NOT NULL,
	"over_commitment_enabled" boolean DEFAULT true NOT NULL,
	"coupling_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_policy_workspace_discipline_uq" UNIQUE("workspace_id","discipline_id")
);
--> statement-breakpoint
ALTER TABLE "findings_policy" ADD CONSTRAINT "findings_policy_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings_policy" ADD CONSTRAINT "findings_policy_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."disciplines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_policy_workspace_idx" ON "findings_policy" USING btree ("workspace_id");--> statement-breakpoint
-- The UNIQUE above leaves the workspace-wide row (discipline_id IS NULL)
-- unconstrained, because Postgres treats NULLs as distinct in a UNIQUE. This
-- partial unique index keeps that config row single per workspace. Not
-- represented in the Drizzle schema (it can't express a partial unique), so it
-- lives only here — apply it with the rest of this migration.
CREATE UNIQUE INDEX "findings_policy_workspace_default_uq" ON "findings_policy" USING btree ("workspace_id") WHERE "discipline_id" IS NULL;