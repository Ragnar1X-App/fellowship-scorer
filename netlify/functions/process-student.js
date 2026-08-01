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
async function fetchDocumentAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  const mediaType = contentType.includes("pdf")
    ? "application/pdf"
    : contentType.includes("png")
    ? "image/png"
    : "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString("base64"), mediaType };
}

export default async (req) => {
  try {
    const body = await req.json();
    const { batchId, student, baseProjects, nirfList } = body;
    // student = { name, institution, marks, courseCount, courseNames, title, description,
    //             guideName, documentUrls: { endorsementGuide, endorsementHead, marksheet } }

    const acad = academicScore(student.marks);
    const crs = coursesScore(student.courseCount, student.courseNames);
    const inst = instituteScore(student.institution, nirfList);

    let uniq = { score: 0 };
    let closestMatch = null;
    if (student.title || student.description) {
      const sim = maxSimilarityAgainstCorpus(`${student.title} ${student.description}`, baseProjects);
      uniq = uniquenessScoreFromSimilarity(sim.sim);
      uniq.simPct = Math.round(sim.sim * 100);
      closestMatch = sim.title;
    }

    let qual = { technical: 0, scalability: 0, ethics: 0, relevance: 0, roadmap: 0, justification: "No project description." };
    if (student.title || student.description) {
      qual = await judgeProjectQuality(student.title, student.description);
    }
    const qualTotal = qual.technical + qual.scalability + qual.ethics + qual.relevance + qual.roadmap;

    // Fetch + extract each available document for this student
    const urls = student.documentUrls || {};
    const docEntries = Object.entries(urls).filter(([, url]) => url);
    const docs = [];
    for (const [docType, url] of docEntries) {
      try {
        const { base64, mediaType } = await fetchDocumentAsBase64(url);
        const extracted = await extractDocumentFields(base64, mediaType);
        docs.push({ fileName: docType, docType, extracted });
      } catch (err) {
        docs.push({ fileName: docType, docType, extracted: null, error: err.message });
      }
    }
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
    const supabase = getSupabaseServer();
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

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
