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

// Fetches a document from a direct URL (e.g. fellowship.indiaai.gov.in/download/...)
// and returns it as base64 + a guessed media type. Plain server-to-server HTTP —
// not subject to browser CORS, not subject to robots.txt (that only applies to
// crawler-style tools, not a normal fetch call).
async function fetchDocumentAsBase64(url, timeoutMs = 15000) {
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
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), mediaType };
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timed out after ${timeoutMs / 1000}s fetching ${url}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export default async (req) => {
  try {
    const body = await req.json();
    const { batchId, student, baseProjects, nirfList } = body;
    // student = { name, institution, marks, courseCount, courseNames, title, description,
    //             guideName, documentUrls: { endorsementGuide, endorsementHead, marksheet } }

    // These are cheap/local — no need to parallelize.
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

    // The expensive part: previously this ran project-judging, THEN each document's
    // fetch+extract one after another — 4 sequential Claude calls plus 3 sequential
    // fetches, easily 30+ seconds and past Netlify's function timeout. Running all 4
    // independent tasks concurrently instead cuts wall-clock time to roughly the
    // slowest single call, not the sum of all of them.
    const qualPromise =
      student.title || student.description
        ? judgeProjectQuality(student.title, student.description, process.env.ANTHROPIC_API_KEY)
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
        const extracted = await extractDocumentFields(base64, mediaType, process.env.ANTHROPIC_API_KEY);
        return { fileName: docType, docType, extracted };
      } catch (err) {
        return { fileName: docType, docType, extracted: null, error: err.message };
      }
    });

    const [qualResult, ...docResults] = await Promise.all([qualPromise, ...docPromises]);
    const qual = qualResult;
    const docs = docResults;

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

    // Persist to Supabase
    const supabase = getSupabaseServer(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // The scores table has a foreign key on batch_id -> batches(id). Make sure that
    // row exists first, or every score write fails silently.
    await supabase.from("batches").upsert({ id: batchId }, { onConflict: "id", ignoreDuplicates: true });

    const { error: saveError } = await supabase.from("scores").upsert(
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
    if (saveError) {
      result.saveWarning = "Scored successfully but failed to save to Supabase: " + saveError.message;
    }

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
