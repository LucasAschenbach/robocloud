import "dotenv/config";

export const config = {
  port: parseInt(process.env["API_PORT"] ?? "3000", 10),
  host: process.env["API_HOST"] ?? "0.0.0.0",

  supabase: {
    url: process.env["SUPABASE_URL"] ?? "",
    anonKey: process.env["SUPABASE_ANON_KEY"] ?? "",
    serviceRoleKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
  },
} as const;
