CREATE TABLE "pod_template_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"discipline_id" uuid NOT NULL,
	"min_count" integer DEFAULT 1 NOT NULL,
	"max_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pod_template_roles_workspace_discipline_uq" UNIQUE("workspace_id","discipline_id")
);
--> statement-breakpoint
ALTER TABLE "pod_template_roles" ADD CONSTRAINT "pod_template_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_template_roles" ADD CONSTRAINT "pod_template_roles_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "public"."disciplines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pod_template_roles_workspace_idx" ON "pod_template_roles" USING btree ("workspace_id");