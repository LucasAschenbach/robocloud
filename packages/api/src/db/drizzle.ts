import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

let _sql: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;
let _initAttempted = false;

export function getDb() {
  if (!_initAttempted) {
    _initAttempted = true;
    const connectionString = config.databaseUrl || null;

    if (!connectionString) {
      console.warn("[db] DATABASE_URL not set — running in memory-only mode");
      return null;
    }

    try {
      _sql = postgres(connectionString, { max: 10 });
      _db = drizzle(_sql, { schema });
      console.log("[db] PostgreSQL connected");
    } catch (err) {
      console.warn("[db] Could not connect to PostgreSQL, running in memory-only mode:", err);
    }
  }
  return _db;
}

export function getSql() {
  if (!_sql) getDb();
  return _sql;
}

export { schema };
