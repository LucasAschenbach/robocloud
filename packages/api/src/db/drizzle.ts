import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString = config.supabase.url
      ? `${config.supabase.url.replace("https://", "postgresql://postgres:postgres@").replace(".supabase.co", ".supabase.co:5432")}/postgres`
      : "postgresql://postgres:postgres@localhost:5432/postgres";

    try {
      _sql = postgres(connectionString, { max: 10 });
      _db = drizzle(_sql, { schema });
    } catch {
      console.warn("[db] Could not connect to PostgreSQL, running in memory-only mode");
    }
  }
  return _db;
}

export function getSql() {
  if (!_sql) getDb();
  return _sql;
}

export { schema };
