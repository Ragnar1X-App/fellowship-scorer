import { getSupabaseServer } from "../../src/lib/supabaseServer.js";

export default async (req) => {
  const supabase = getSupabaseServer();

  if (req.method === "GET") {
    const [{ data: projects }, { data: nirf }] = await Promise.all([
      supabase.from("base_projects").select("title, description"),
      supabase.from("nirf_list").select("institute_name, rank"),
    ]);
    return new Response(
      JSON.stringify({
        baseProjects: (projects || []).map((p) => ({ t: p.title, d: p.description })),
        nirfList: (nirf || []).map((n) => ({ n: n.institute_name, r: n.rank })),
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  if (req.method === "POST") {
    // body: { addProjects: [{t,d}], replaceNirf: [{n,r}] }
    const body = await req.json();
    if (body.addProjects && body.addProjects.length > 0) {
      await supabase.from("base_projects").upsert(
        body.addProjects.map((p) => ({ title: p.t, description: p.d })),
        { onConflict: "title", ignoreDuplicates: true }
      );
    }
    if (body.replaceNirf && body.replaceNirf.length > 0) {
      await supabase.from("nirf_list").delete().neq("institute_name", "__never__");
      await supabase
        .from("nirf_list")
        .insert(body.replaceNirf.map((n) => ({ institute_name: n.n, rank: String(n.r) })));
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("Method not allowed", { status: 405 });
};
