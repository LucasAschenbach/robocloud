import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let _supabaseAdmin: SupabaseClient | null = null;
let _supabaseAnon: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    if (!config.supabaseConfigured) {
      throw new Error("Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env");
    }
    _supabaseAdmin = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _supabaseAdmin;
}

export function getSupabaseAnon(): SupabaseClient {
  if (!_supabaseAnon) {
    if (!config.supabaseConfigured) {
      throw new Error("Supabase is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env");
    }
    _supabaseAnon = createClient(
      config.supabase.url,
      config.supabase.anonKey
    );
  }
  return _supabaseAnon;
}
