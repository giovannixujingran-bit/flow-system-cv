import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

function ensurePool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_MODE=postgres");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
    });
  }
  return pool;
}

export function getDbPool(databaseUrl = process.env.DATABASE_URL): Pool {
  return ensurePool(databaseUrl);
}

export function getDbClient(databaseUrl = process.env.DATABASE_URL): NodePgDatabase<typeof schema> {
  const activePool = ensurePool(databaseUrl);
  if (!db) {
    db = drizzle(activePool, {
      schema,
    });
  }
  return db;
}

export async function closeDbClient(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = null;
  db = null;
}
