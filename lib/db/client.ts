import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Single Postgres connection pool reused across hot reloads in dev.
 * Uses the postgres.js driver, which talks to both local Postgres and Neon
 * (production) — switching environments is just a DATABASE_URL change.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const globalForDb = globalThis as unknown as {
  __zenhancePgClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__zenhancePgClient ??
  postgres(connectionString, { max: 10, prepare: false });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__zenhancePgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
