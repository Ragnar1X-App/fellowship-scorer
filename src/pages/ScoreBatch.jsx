import React, { useState, useRef, useCallback } from "react";
import { styles, COLOR, bandColor } from "../styles.js";
import { parseWorkbookFile } from "../lib/parseSpreadsheet.js";
import { API_BASE } from "../lib/apiBase.js";

const CONCURRENCY = 4;

async function runWithConcurrency(items, worker, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function run() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
      done++;
      onProgress(done, items.length);
    }
  }
  await Promise.all(new Array(CONCURRENCY).fill(0).map(run));
  return results;
}

function bandFromTotal(total) {
  if (total >= 56) return "Likely select";
  if (total >= 44) return "Borderline";
  return "Below cutoff";
}

export default function ScoreBatch() {
  const [fileName, setFileName] = useState("");
  const [students, setStudents] = useState(null);
  const [batchId, setBatchId] = useState("");
  const [baseData, setBaseData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const fileInputRef = useRef(null);

  const hasComments = students ? students.some((s) => s.commentFlag !== "none") : false;

  async function loadBaseData() {
    const res = await fetch(`${API_BASE}/base-data`);
    if (!res.ok) throw new Error("Failed to load base dataset from Supabase");
    return res.json();
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setWarnings([]);
    setFileName(file.name);
    setResults([]);
    try {
      const parsed = await parseWorkbookFile(file);
      setStudents(parsed.students);
      setBatchId(`batch-${Date.now()}`);
      const bd = await loadBaseData();
      setBaseData(bd);

      const withDocUrls = parsed.students.filter(
        (s) => s.documentUrls.endorsementGuide || s.documentUrls.endorsementHead || s.documentUrls.marksheet
      ).length;

      const w = [];
      if (withDocUrls === 0) {
        w.push(
          "No document hyperlinks found in this file. Make sure you're uploading the RAW file downloaded directly from the portal — opening and re-saving it strips the links."
        );
      } else {
        w.push(`Document links found for ${withDocUrls}/${parsed.students.length} students.`);
      }
      if (!bd.baseProjects || bd.baseProjects.length === 0) {
        w.push("Base dataset is empty — uniqueness scoring will show N/A for everyone until you add data on the Base Dataset tab.");
      }
      if (!bd.nirfList || bd.nirfList.length === 0) {
        w.push("NIRF list is empty — every institute will default to unranked (5/5) until you upload one on the NIRF List tab.");
      }
      setWarnings(w);
    } catch (err) {
      setError(err.message);
    }
  }

  const processAll = useCallback(async () => {
    if (!students || !baseData) return;
    setProcessing(true);
    setProgress({ done: 0, total: students.length });

    // Process every student — a red/green Comments column, if present, only exists on
    // batches a human has already reviewed. It's shown as a comparison against the AI's
    // own verdict, never used to skip anyone. Real incoming batches won't have this at all.
    const outputs = await runWithConcurrency(
      students,
      async (student) => {
        try {
          const res = await fetch(`${API_BASE}/process-student`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              batchId,
              student,
              baseProjects: baseData.baseProjects,
              nirfList: baseData.nirfList,
            }),
          });
          if (!res.ok) {
            let detail = `Server error ${res.status}`;
            try {
              const body = await res.json();
              if (body.error) detail = body.error;
            } catch {
              /* not JSON, e.g. a raw timeout page */
            }
            throw new Error(detail);
          }
          const data = await res.json();
          return { ...data, commentFlag: student.commentFlag, commentText: student.commentText };
        } catch (err) {
          return { name: student.name, error: err.message, commentFlag: student.commentFlag, commentText: student.commentText };
        }
      },
      (done, total) => setProgress({ done, total })
    );

    setResults(outputs);
    setProcessing(false);
  }, [students, baseData, batchId]);

  function exportCSV() {
    const headers = [
      "Name",
      "Institution",
      "Subtotal (80)",
      "Document Score (20)",
      "Combined (100)",
      "AI Band",
      "Human Comment",
      "Docs Attempted",
      "Doc Errors",
      "Document Flags",
      "Justification",
    ];
    const lines = [headers.join(",")];
    results.forEach((r) => {
      const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      if (r.error) {
        lines.push([esc(r.name), "", "", "", "", "", esc(r.commentText), "", "", "", esc("ERROR: " + r.error)].join(","));
        return;
      }
      lines.push(
        [
          esc(r.name),
          esc(r.institution),
          r.subtotal80,
          r.documentScore,
          r.combinedTotal,
          esc(bandFromTotal(r.subtotal80)),
          esc(r.commentText),
          r.documentsProcessed ?? 0,
          esc((r.documentErrors || []).map((e) => `${e.docType}: ${e.error}`).join("; ")),
          esc((r.documentFlags || []).join("; ")),
          esc(r.qualitative?.justification),
        ].join(",")
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={styles.panel}>
        <h2 style={styles.h2}>Score a batch</h2>
        <p style={styles.sub}>
          Upload the raw spreadsheet exported directly from the portal. Documents are fetched and read
          automatically from the links embedded in the file — no manual download needed.
        </p>

        <div style={styles.uploadBox} onClick={() => fileInputRef.current.click()}>
          <div style={styles.uploadIcon}>↑</div>
          <div>
            <strong>{fileName || "Click to upload .xlsx"}</strong>
            {students && <div style={{ fontSize: 12, color: COLOR.inkSoft, marginTop: 2 }}>{students.length} students loaded</div>}
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleFile} />

        {error && <div style={styles.errorBox}>{error}</div>}
        {warnings.map((w, i) => (
          <div key={i} style={styles.warnBox}>
            {w}
          </div>
        ))}

        {hasComments && (
          <div style={styles.warnBox}>
            This file has manual review Comments from a past evaluation ({students.filter((s) => s.commentFlag === "red").length}{" "}
            flagged red, {students.filter((s) => s.commentFlag === "green").length} green). Every student will still be
            scored — the human's original verdict is shown alongside the AI's score for comparison, not used to skip anyone.
          </div>
        )}

        {students && (
          <button style={styles.primaryBtn} onClick={processAll} disabled={processing}>
            {processing ? `Processing ${progress.done}/${progress.total}…` : `Score ${students.length} students`}
          </button>
        )}
        {processing && (
          <div style={styles.progressBarOuter}>
            <div style={{ ...styles.progressBarInner, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div style={styles.panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={styles.h3}>Results ({results.length})</h3>
            <button style={styles.secondaryBtn} onClick={exportCSV}>
              Export CSV
            </button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Institution</th>
                <th style={styles.th}>Subtotal /80</th>
                <th style={styles.th}>Docs /20</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Docs found</th>
                {hasComments && <th style={styles.th}>Human verdict</th>}
              </tr>
            </thead>
            <tbody>
              {[...results]
                .sort((a, b) => (b.combinedTotal || 0) - (a.combinedTotal || 0))
                .map((r, i) => {
                  const band = r.subtotal80 !== undefined ? bandFromTotal(r.subtotal80) : null;
                  return (
                    <tr key={i}>
                      <td style={styles.td}>{r.name}</td>
                      <td style={styles.td}>{r.institution}</td>
                      <td style={styles.td}>{r.subtotal80 ?? "—"}</td>
                      <td style={styles.td}>{r.documentScore ?? "—"}</td>
                      <td style={styles.td}>
                        {r.error ? (
                          <span style={{ color: COLOR.flagRed, fontWeight: 700 }} title={r.error}>
                            ERROR
                          </span>
                        ) : (
                          <span style={styles.scoreStamp(bandColor(band))}>{r.combinedTotal}</span>
                        )}
                      </td>
                      <td
                        style={styles.td}
                        title={(r.documentErrors || []).map((e) => `${e.docType}: ${e.error}`).join("\n")}
                      >
                        {r.documentsProcessed ?? 0}
                        {(r.documentErrors || []).length > 0 && (
                          <span style={{ color: COLOR.flagRed }}> ({r.documentErrors.length} failed)</span>
                        )}
                      </td>
                      {hasComments && (
                        <td style={styles.td}>
                          {r.commentFlag !== "none" && (
                            <span style={styles.badge(r.commentFlag)}>{r.commentFlag}</span>
                          )}
                          {r.commentText && (
                            <div style={{ fontSize: 11, color: COLOR.inkSoft, marginTop: 2 }}>{r.commentText}</div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
