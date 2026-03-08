import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

const connectionString = config.supabase.url
  ? `${config.supabase.url.replace("https://", "postgresql://postgres:postgres@").replace(".supabase.co", ".supabase.co:5432")}/postgres`
  : "postgresql://postgres:postgres@localhost:5432/postgres";

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

try {
  sql = postgres(connectionString, { max: 10 });
  db = drizzle(sql, { schema });
} catch {
  console.warn("[db] Could not connect to PostgreSQL, running in memory-only mode");
  sql = null as unknown as ReturnType<typeof postgres>;
  db = null as unknown as ReturnType<typeof drizzle>;
}

export { db, sql };
export { schema };
