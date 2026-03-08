import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const supabaseAnon = createClient(
  config.supabase.url,
  config.supabase.anonKey
);
