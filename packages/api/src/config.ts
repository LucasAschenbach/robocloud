import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findEnvFile(): string | undefined {
  let dir = resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envPath = findEnvFile();
if (envPath) {
  loadDotenv({ path: envPath });
}

const port = parseInt(process.env["API_PORT"] ?? "3000", 10);
if (Number.isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid API_PORT: ${process.env["API_PORT"]}`);
}

export const config = {
  port,
  host: process.env["API_HOST"] ?? "0.0.0.0",
  publicUrl: process.env["API_PUBLIC_URL"] ?? "",

  supabase: {
    url: process.env["SUPABASE_URL"] ?? "",
    anonKey: process.env["SUPABASE_ANON_KEY"] ?? "",
    serviceRoleKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
  },

  databaseUrl: process.env["DATABASE_URL"] ?? "",

  robotAgentSecret: process.env["ROBOT_AGENT_SECRET"] ?? "",

  get supabaseConfigured(): boolean {
    return !!(this.supabase.url && this.supabase.anonKey && this.supabase.serviceRoleKey
      && this.supabase.serviceRoleKey !== "your-service-role-key");
  },

  get wsBaseUrl(): string {
    if (this.publicUrl) {
      return this.publicUrl.replace(/^http/, "ws");
    }
    const host = this.host === "0.0.0.0" ? "localhost" : this.host;
    return `ws://${host}:${this.port}`;
  },
} as const;
