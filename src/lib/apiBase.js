// Set VITE_API_BASE_URL to your deployed Worker URL, e.g.:
// https://fellowship-scorer-api.your-subdomain.workers.dev
// Falls back to the relative /api/* path (Netlify Functions) if unset, so this
// still works during the transition or for local dev without a Worker running.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
