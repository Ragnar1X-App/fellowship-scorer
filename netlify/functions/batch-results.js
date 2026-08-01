import { getSupabaseServer } from "../../src/lib/supabaseServer.js";

export default async (req) => {
  const supabase = getSupabaseServer();
  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");
  if (!batchId) return new Response(JSON.stringify({ error: "batchId required" }), { status: 400 });

  const { data, error } = await supabase.from("scores").select("*").eq("batch_id", batchId);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  return new Response(JSON.stringify({ results: data }), { headers: { "Content-Type": "application/json" } });
};
