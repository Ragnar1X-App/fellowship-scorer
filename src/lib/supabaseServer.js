import { createClient } from "@supabase/supabase-js";

// Service role key — full access, server-side only, never exposed to the browser.
export function getSupabaseServer() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
