import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Next.js uses .env.local for local secrets; load it for drizzle-kit too,
// falling back to .env.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
