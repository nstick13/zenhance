CREATE TYPE "public"."map_node_type" AS ENUM('unit', 'person');--> statement-breakpoint
CREATE TABLE "map_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" text DEFAULT 'default' NOT NULL,
	"node_type" "map_node_type" NOT NULL,
	"node_id" text NOT NULL,
	"x" numeric(10, 2) NOT NULL,
	"y" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_nodes_workspace_board_node_uq" UNIQUE("workspace_id","board_id","node_type","node_id")
);
--> statement-breakpoint
ALTER TABLE "map_nodes" ADD CONSTRAINT "map_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_nodes_workspace_idx" ON "map_nodes" USING btree ("workspace_id");