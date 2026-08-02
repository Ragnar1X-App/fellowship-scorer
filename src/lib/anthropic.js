// Portable across Netlify Functions (Node) and Cloudflare Workers — takes the API key
// as a parameter instead of reading process.env directly, since Workers don't have
// process.env and pass secrets via the `env` binding instead.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

async function callClaude(body, apiKey) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }
  return response.json();
}

function extractJson(data) {
  const textBlock = (data.content || []).find((b) => b.type === "text");
  let raw = textBlock ? textBlock.text : "{}";
  raw = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

export async function judgeProjectQuality(title, description, apiKey) {
  const prompt = `You are an expert evaluator scoring an undergraduate AI project proposal for a national government AI fellowship. Score the project on these 5 dimensions, each 0-3 points (0=absent/poor, 1=weak, 2=adequate, 3=strong):

1. technical - Technical Soundness / appropriate AI usage
2. scalability - Scalability & Deployment potential
3. ethics - Responsible and Ethical Use of Tech & Data
4. relevance - National & Social Relevance
5. roadmap - Roadmap clarity (success metrics / development roadmap)

Project Title: ${title}
Project Description: ${description}

Respond with ONLY valid JSON, no markdown fences, no other text:
{"technical":0,"scalability":0,"ethics":0,"relevance":0,"roadmap":0,"justification":"one short sentence"}`;

  const data = await callClaude(
    {
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    },
    apiKey
  );

  try {
    const parsed = extractJson(data);
    const clamp = (v) => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));
    return {
      technical: clamp(parsed.technical),
      scalability: clamp(parsed.scalability),
      ethics: clamp(parsed.ethics),
      relevance: clamp(parsed.relevance),
      roadmap: clamp(parsed.roadmap),
      justification: parsed.justification || "",
    };
  } catch {
    return { technical: 0, scalability: 0, ethics: 0, relevance: 0, roadmap: 0, justification: "Failed to parse AI response." };
  }
}

export async function extractDocumentFields(base64Data, mediaType, apiKey) {
  const prompt = `You are reviewing a document submitted as part of an Indian government AI fellowship application. Read it carefully and extract:

IDENTIFYING FIELDS (exact as printed, or null):
- studentName, printedId, idType, instituteName, guideName, guideDesignation, projectTitle
- cgpaOrLatestMarks: overall CGPA/percentage if clearly stated; null if only per-semester SGPA is shown

DOCUMENT TYPE:
- docType: "marksheet" | "endorsement_guide" | "endorsement_institute_head" | "bank_passbook" | "other"

QUALITY / ELIGIBILITY CHECKLIST (true/false/null):
- isAttested, hasOfficialLetterhead, isStampedAndSigned
- semestersShown (number)
- hasAcademicBacklog, isLegible
- courseSubjects: array of course/subject names visible on a marksheet, if any (for cross-checking claimed AI courses)

Respond with ONLY valid JSON, no markdown fences:
{"studentName":null,"printedId":null,"idType":null,"instituteName":null,"guideName":null,"guideDesignation":null,"projectTitle":null,"cgpaOrLatestMarks":null,"docType":"other","isAttested":null,"hasOfficialLetterhead":null,"isStampedAndSigned":null,"semestersShown":null,"hasAcademicBacklog":null,"isLegible":null,"courseSubjects":[],"notes":""}`;

  const data = await callClaude(
    {
      model: MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: [
            mediaType === "application/pdf"
              ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64Data } }
              : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    apiKey
  );

  try {
    return extractJson(data);
  } catch {
    return { parseError: true, notes: "Failed to parse extraction response." };
  }
}
