import { judgeProjectQuality, extractDocumentFields } from "../../src/lib/anthropic.js";
import {
  academicScore,
  coursesScore,
  instituteScore,
  maxSimilarityAgainstCorpus,
  uniquenessScoreFromSimilarity,
  aggregateStudentDocuments,
} from "../../src/lib/scoring.js";
import { getSupabaseServer } from "../../src/lib/supabaseServer.js";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// Workers don't have Node's Buffer — encode base64 manually, in chunks to avoid
// blowing the call stack on large PDFs.
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchDocumentAsBase64(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    const mediaType = contentType.includes("pdf")
      ? "application/pdf"
      : contentType.includes("png")
      ? "image/png"
      : "image/jpeg";
    const buf = await res.arrayBuffer();
    return { base64: arrayBufferToBase64(buf), mediaType };
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timed out after ${timeoutMs / 1000}s fetching ${url}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleProcessStudent(req, env, origin) {
  const body = await req.json();
  const { batchId, student, baseProjects, nirfList } = body;

  const acad = academicScore(student.marks);
  const crs = coursesScore(student.courseCount, student.courseNames);
  const inst = instituteScore(student.institution, nirfList);

  let uniq = { score: 0 };
  let closestMatch = null;
  if (student.title || student.description) {
    const sim = maxSimilarityAgainstCorpus(`${student.title} ${student.description}`, baseProjects);
    uniq = uniquenessScoreFromSimilarity(sim.sim);
    uniq.simPct = sim.sim === null ? null : Math.round(sim.sim * 100);
    closestMatch = sim.title;
  }

  const qualPromise =
    student.title || student.description
      ? judgeProjectQuality(student.title, student.description, env.ANTHROPIC_API_KEY)
      : Promise.resolve({
          technical: 0,
          scalability: 0,
          ethics: 0,
          relevance: 0,
          roadmap: 0,
          justification: "No project description.",
        });

  const urls = student.documentUrls || {};
  const docEntries = Object.entries(urls).filter(([, url]) => url);
  const docPromises = docEntries.map(async ([docType, url]) => {
    try {
      const { base64, mediaType } = await fetchDocumentAsBase64(url);
      const extracted = await extractDocumentFields(base64, mediaType, env.ANTHROPIC_API_KEY);
      return { fileName: docType, docType, extracted };
    } catch (err) {
      return { fileName: docType, docType, extracted: null, error: err.message };
    }
  });

  const [qual, ...docs] = await Promise.all([qualPromise, ...docPromises]);
  const qualTotal = qual.technical + qual.scalability + qual.ethics + qual.relevance + qual.roadmap;
  const validDocs = docs.filter((d) => d.extracted && !d.extracted.parseError);

  let docAgg = null;
  if (validDocs.length > 0) {
    docAgg = aggregateStudentDocuments(validDocs, {
      name: student.name,
      institution: student.institution,
      guideName: student.guideName,
      title: student.title,
    });
  }

  const subtotal80 = acad.score + crs.score + inst.score + uniq.score + qualTotal;
  const documentScore = docAgg ? docAgg.fieldScore : 0;
  const combinedTotal = subtotal80 + documentScore;

  const result = {
    name: student.name,
    institution: student.institution,
    title: student.title,
    academic: acad,
    courses: crs,
    institute: inst,
    uniqueness: uniq,
    closestMatch,
    qualitative: qual,
    qualTotal,
    subtotal80,
    documentScore,
    combinedTotal,
    documentFlags: docAgg ? docAgg.flags : [],
    documentsProcessed: docs.length,
    documentErrors: docs.filter((d) => d.error).map((d) => ({ docType: d.docType, error: d.error })),
  };

  const supabase = getSupabaseServer(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await supabase.from("scores").upsert(
    {
      batch_id: batchId,
      student_name: student.name,
      institution: student.institution,
      result,
      status: "done",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "batch_id,student_name" }
  );

  return json(result, 200, origin);
}

async function handleBaseData(req, env, origin) {
  const supabase = getSupabaseServer(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  if (req.method === "GET") {
    const [{ data: projects }, { data: nirf }] = await Promise.all([
      supabase.from("base_projects").select("title, description"),
      supabase.from("nirf_list").select("institute_name, rank"),
    ]);
    return json(
      {
        baseProjects: (projects || []).map((p) => ({ t: p.title, d: p.description })),
        nirfList: (nirf || []).map((n) => ({ n: n.institute_name, r: n.rank })),
      },
      200,
      origin
    );
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (body.addProjects && body.addProjects.length > 0) {
      await supabase.from("base_projects").upsert(
        body.addProjects.map((p) => ({ title: p.t, description: p.d })),
        { onConflict: "title", ignoreDuplicates: true }
      );
    }
    if (body.replaceNirf && body.replaceNirf.length > 0) {
      await supabase.from("nirf_list").delete().neq("institute_name", "__never__");
      await supabase.from("nirf_list").insert(body.replaceNirf.map((n) => ({ institute_name: n.n, rank: String(n.r) })));
    }
    return json({ ok: true }, 200, origin);
  }

  return json({ error: "Method not allowed" }, 405, origin);
}

async function handleBatchResults(req, env, origin) {
  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");
  if (!batchId) return json({ error: "batchId required" }, 400, origin);

  const supabase = getSupabaseServer(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.from("scores").select("*").eq("batch_id", batchId);
  if (error) return json({ error: error.message }, 500, origin);

  return json({ results: data }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === "/process-student") return await handleProcessStudent(request, env, origin);
      if (url.pathname === "/base-data") return await handleBaseData(request, env, origin);
      if (url.pathname === "/batch-results") return await handleBatchResults(request, env, origin);
      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      return json({ error: err.message }, 500, origin);
    }
  },
};
