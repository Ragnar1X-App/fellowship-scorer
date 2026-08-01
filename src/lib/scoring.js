// Ported from the FellowshipScorer artifact. Pure logic only — no window.storage,
// no fetch to api.anthropic.com directly (that happens server-side in Netlify Functions).

/* ---------- text similarity (uniqueness check) ---------- */
const STOPWORDS = new Set(
  "a an the and or of to for in on with using use used is are was were be been being this that these those will can could would should it its as by from at into via not no also which who whom their his her our your my we they he she i you it's project system model based data using develop developed development aims aim help enable provide provides"
    .split(" ")
);

export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function termFreq(tokens) {
  const tf = {};
  tokens.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
  return tf;
}

function buildCorpusModel(docs) {
  const df = {};
  docs.forEach((tokens) => {
    new Set(tokens).forEach((t) => (df[t] = (df[t] || 0) + 1));
  });
  const N = docs.length;
  const idf = {};
  Object.keys(df).forEach((t) => {
    idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
  });
  return idf;
}

function tfidfVector(tokens, idf) {
  const tf = termFreq(tokens);
  const vec = {};
  let norm = 0;
  Object.keys(tf).forEach((t) => {
    const w = tf[t] * (idf[t] || Math.log(1));
    vec[t] = w;
    norm += w * w;
  });
  norm = Math.sqrt(norm) || 1;
  Object.keys(vec).forEach((t) => (vec[t] = vec[t] / norm));
  return vec;
}

function cosineSim(vecA, vecB) {
  const keys = Object.keys(vecA).length < Object.keys(vecB).length ? Object.keys(vecA) : Object.keys(vecB);
  let sum = 0;
  keys.forEach((k) => {
    if (vecA[k] && vecB[k]) sum += vecA[k] * vecB[k];
  });
  return sum;
}

export function maxSimilarityAgainstCorpus(newText, corpusDocs) {
  const newTokens = tokenize(newText);
  const allTokenSets = corpusDocs.map((d) => tokenize(d.t + " " + d.d));
  const idf = buildCorpusModel([...allTokenSets, newTokens]);
  const newVec = tfidfVector(newTokens, idf);
  let best = { sim: 0, title: null };
  corpusDocs.forEach((d, i) => {
    const sim = cosineSim(newVec, tfidfVector(allTokenSets[i], idf));
    if (sim > best.sim) best = { sim, title: d.t };
  });
  return best;
}

// Your custom point bands (updated from the original rubric)
export function uniquenessScoreFromSimilarity(simFraction) {
  const pct = simFraction * 100;
  if (pct <= 20) return { score: 30, band: "0-20% similar" };
  if (pct <= 40) return { score: 25, band: "21-40% similar" };
  if (pct <= 60) return { score: 20, band: "41-60% similar" };
  if (pct <= 80) return { score: 10, band: "61-80% similar" };
  return { score: 0, band: ">80% similar" };
}

/* ---------- rule-based sub-scores ---------- */
export function academicScore(raw) {
  if (raw === null || raw === undefined || raw === "") return { score: 0, note: "No CGPA/marks provided" };
  const val = parseFloat(raw);
  if (isNaN(val)) return { score: 0, note: "Unparseable value: " + raw };
  if (val <= 10) {
    if (val >= 9.0) return { score: 20, note: `CGPA ${val} (9.0+)` };
    if (val >= 8.5) return { score: 18, note: `CGPA ${val} (8.5-8.99)` };
    if (val >= 8.0) return { score: 16, note: `CGPA ${val} (8.0-8.49)` };
    return { score: 0, note: `CGPA ${val} below 8.0 (below rubric floor)` };
  }
  if (val >= 90) return { score: 20, note: `${val}% (90+)` };
  if (val >= 85) return { score: 18, note: `${val}% (85-89.99)` };
  if (val >= 80) return { score: 16, note: `${val}% (80-84.99)` };
  return { score: 0, note: `${val}% below 80% (below rubric floor)` };
}

export function coursesScore(count, namesText) {
  let n = count;
  if (n === null || n === undefined || n === "" || isNaN(parseFloat(n))) {
    n = namesText ? namesText.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).length : 0;
  } else {
    n = parseFloat(n);
  }
  if (n >= 3) return { score: 10, note: `${n} AI courses (all 3 matched)` };
  if (n === 2) return { score: 8, note: `${n} AI courses (2 matched)` };
  if (n === 1) return { score: 6, note: `${n} AI course (1 matched)` };
  return { score: 0, note: `${n || 0} AI courses found` };
}

function parseRankBand(rankStr) {
  if (!rankStr) return null;
  const s = String(rankStr).trim();
  if (/^na$/i.test(s)) return null;
  const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return parseInt(range[2], 10);
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

export function normalizeName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function instituteScore(instituteName, nirfList) {
  const norm = normalizeName(instituteName);
  if (!norm) return { score: 5, note: "No institute name provided; treated as unranked (>200)" };
  let match = nirfList.find((r) => normalizeName(r.n) === norm);
  if (!match) {
    match = nirfList.find((r) => normalizeName(r.n).includes(norm) || norm.includes(normalizeName(r.n)));
  }
  if (!match) return { score: 5, note: `"${instituteName}" not found in NIRF list; treated as >200 (unranked)` };
  const band = parseRankBand(match.r);
  if (band === null) return { score: 5, note: `"${instituteName}" listed as NA; treated as >200` };
  if (band <= 200) return { score: 2, note: `"${instituteName}" NIRF rank ${match.r} (1-200)` };
  return { score: 5, note: `"${instituteName}" NIRF rank ${match.r} (>200)` };
}

/* ---------- fuzzy / token-set name matching ---------- */
export function nameTokenSet(s) {
  return new Set(normalizeName(s).split(" ").filter((t) => t.length > 1));
}

export function tokenSetOverlap(a, b) {
  const setA = nameTokenSet(a);
  const setB = nameTokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  setA.forEach((t) => {
    if (setB.has(t)) shared++;
  });
  return shared / Math.max(setA.size, setB.size);
}

export function fuzzyMatches(a, b, threshold = 0.5) {
  if (!a || !b) return false;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return tokenSetOverlap(a, b) >= threshold;
}

/* ---------- document aggregation ---------- */
export function aggregateStudentDocuments(docs, sheetFields) {
  const { name: sheetName, institution: sheetInstitution, guideName: sheetGuide, title: sheetTitle } = sheetFields;

  const nameOk = docs.some((d) => fuzzyMatches(d.extracted.studentName, sheetName));
  const instOk = docs.some((d) => fuzzyMatches(d.extracted.instituteName, sheetInstitution));
  const guideOk = sheetGuide
    ? docs.some((d) => d.extracted.guideName && fuzzyMatches(d.extracted.guideName, sheetGuide))
    : false;
  const titleOk = sheetTitle
    ? docs.some((d) => d.extracted.projectTitle && fuzzyMatches(d.extracted.projectTitle, sheetTitle, 0.35))
    : false;

  const ids = docs.map((d) => d.extracted.printedId).filter(Boolean);
  const idConsistent = ids.length <= 1 || ids.every((id) => normalizeName(id) === normalizeName(ids[0]));
  const stampedSigned = docs.some((d) => d.extracted.isStampedAndSigned === true);

  const fieldScore =
    (nameOk ? 2 : 0) + (idConsistent ? 2 : 0) + (instOk ? 2 : 0) + (guideOk ? 2 : 0) + (titleOk ? 2 : 0) + (stampedSigned ? 10 : 0);

  const flags = [];
  docs.forEach((d) => {
    const ex = d.extracted;
    if (ex.isAttested === false) flags.push(`Unattested digital marksheet (${d.fileName || d.docType})`);
    if (ex.hasOfficialLetterhead === false) flags.push(`No official letterhead detected (${d.fileName || d.docType})`);
    if (ex.isStampedAndSigned === false) flags.push(`Not stamped & signed (${d.fileName || d.docType})`);
    if (ex.semestersShown === 1) flags.push(`Only 1 semester of marks shown (${d.fileName || d.docType})`);
    if (ex.hasAcademicBacklog === true) flags.push(`Possible academic backlog / fail detected (${d.fileName || d.docType})`);
    if (ex.isLegible === false) flags.push(`Document not clearly legible (${d.fileName || d.docType})`);
    if (ex.guideDesignation && /guest|adjunct|visiting/i.test(ex.guideDesignation)) {
      flags.push(`Guide designation is "${ex.guideDesignation}" (${d.fileName || d.docType})`);
    }
  });
  if (!idConsistent) flags.push(`Printed ID differs across documents: ${ids.join(" vs ")}`);
  if (!nameOk) flags.push("Extracted name doesn't clearly match spreadsheet");
  if (!instOk) flags.push("Extracted institute doesn't clearly match spreadsheet");

  return {
    docCount: docs.length,
    docTypes: docs.map((d) => d.extracted.docType).filter(Boolean),
    fieldScore,
    stampedSigned,
    flags,
    latestCgpa: docs.map((d) => d.extracted.cgpaOrLatestMarks).find((v) => v !== null && v !== undefined),
  };
}

/* ---------- column auto-detection ---------- */
export const FIELD_HINTS = {
  name: {
    include: ["student full name", "student name", "name of student", "full name", "applicant name"],
    fallback: ["name"],
    exclude: ["guide", "co-guide", "father", "mother", "parent", "bank", "college", "institute"],
  },
  institution: {
    include: ["institution name", "institute name", "college name"],
    fallback: ["institution", "institute", "college"],
    exclude: ["graduation institute", "post-graduation institute"],
  },
  marks: {
    include: ["cgpa", "marks percentage", "cgpa/ marks"],
    fallback: ["percentage", "marks"],
    exclude: ["post-graduation"],
  },
  courseCount: { include: ["number of ai", "no. of ai", "ai courses count"], fallback: [], exclude: [] },
  courseNames: {
    include: ["names of the ai", "ai course names", "course names"],
    fallback: ["ai courses", "ai course"],
    exclude: [],
  },
  title: { include: ["project title", "research title"], fallback: [], exclude: [] },
  description: {
    include: ["project description", "project brief", "project summary", "project concept", "research concept"],
    fallback: [],
    exclude: [],
  },
  comments: { include: ["comments"], fallback: ["remark", "internal note"], exclude: [] },
  guideName: { include: ["guide name"], fallback: ["project guide"], exclude: ["co-guide"] },
  endorsementGuideUrl: { include: ["endorsment by project guide", "endorsement by project guide"], fallback: [], exclude: [] },
  endorsementHeadUrl: { include: ["endorsment by institute head", "endorsement by institute head"], fallback: [], exclude: [] },
  marksheetUrl: { include: ["consolidated ug", "marksheet"], fallback: [], exclude: [] },
};

function findByHints(lowerHeaders, hints) {
  for (const hint of hints.include) {
    const idx = lowerHeaders.findIndex((h) => h.includes(hint) && !hints.exclude.some((ex) => h.includes(ex)));
    if (idx !== -1) return idx;
  }
  for (const hint of hints.fallback || []) {
    const idx = lowerHeaders.findIndex((h) => h.includes(hint) && !hints.exclude.some((ex) => h.includes(ex)));
    if (idx !== -1) return idx;
  }
  return -1;
}

export function autoDetectColumns(headers) {
  const lowerHeaders = headers.map((h) => (h || "").toString().toLowerCase());
  const result = {};
  Object.entries(FIELD_HINTS).forEach(([field, hints]) => {
    result[field] = findByHints(lowerHeaders, hints);
  });
  return result;
}

export function mergeAiCourseColumns(headers, rows) {
  const pattern = /ai\s*course\s*\d+/i;
  const matchIdx = headers.map((h, i) => (pattern.test((h || "").toString()) ? i : -1)).filter((i) => i !== -1);
  if (matchIdx.length < 2) return { headers, rows, mergedIdx: null };
  const newHeaders = [...headers, "AI Course Names (auto-merged)"];
  const newRows = rows.map((row) => {
    const vals = matchIdx.map((i) => row[i]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    return [...row, vals.join("; ")];
  });
  return { headers: newHeaders, rows: newRows, mergedIdx: newHeaders.length - 1 };
}

/* ---------- fill-color classification (red/green Comments flag) ---------- */
export function classifyFillColor(rgbHex) {
  if (!rgbHex || rgbHex.length < 6) return "none";
  const hex = rgbHex.slice(-6);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "none";
  if (r > 200 && g > 200 && b > 200) return "none";
  if (r > g + 25 && r > b + 25) return "red";
  if (g > r + 15 && g > b - 40) return "green";
  return "other";
}
