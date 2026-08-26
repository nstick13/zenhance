CREATE TYPE "public"."employment_type" AS ENUM('fte', 'contractor', 'vendor', 'unknown');--> statement-breakpoint
CREATE TABLE "disciplines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disciplines_workspace_name_uq" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "discipline_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "employment" "employment_type" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "disciplines" ADD CONSTRAINT "disciplines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disciplines_workspace_idx" ON "disciplines" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."disciplines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_discipline_idx" ON "people" USING btree ("discipline_id");