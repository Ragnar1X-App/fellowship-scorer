import { createClient } from "@supabase/supabase-js";

// Service role key — full access, server-side only, never exposed to the browser.
// Portable across Netlify Functions and Cloudflare Workers — takes credentials as
// parameters instead of reading process.env, since Workers don't have process.env.
export function getSupabaseServer(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey);
}
