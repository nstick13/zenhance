CREATE TYPE "public"."orbital_node_type" AS ENUM('unit', 'seat');--> statement-breakpoint
CREATE TABLE "orbital_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" text DEFAULT 'default' NOT NULL,
	"node_type" "orbital_node_type" NOT NULL,
	"node_id" text NOT NULL,
	"angle" numeric(9, 6),
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbital_nodes_workspace_board_node_uq" UNIQUE("workspace_id","board_id","node_type","node_id")
);
--> statement-breakpoint
ALTER TABLE "orbital_nodes" ADD CONSTRAINT "orbital_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orbital_nodes_workspace_idx" ON "orbital_nodes" USING btree ("workspace_id");