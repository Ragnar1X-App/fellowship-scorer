import React, { useState, useRef, useCallback } from "react";
import { parseWorkbookFile } from "./lib/parseSpreadsheet.js";

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

export default function App() {
  const [fileName, setFileName] = useState("");
  const [students, setStudents] = useState(null);
  const [batchId, setBatchId] = useState("");
  const [baseData, setBaseData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  async function loadBaseData() {
    const res = await fetch("/api/base-data");
    if (!res.ok) throw new Error("Failed to load base dataset from Supabase");
    return res.json();
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setFileName(file.name);
    setResults([]);
    try {
      const parsed = await parseWorkbookFile(file);
      setStudents(parsed.students);
      setBatchId(`batch-${Date.now()}`);
      const bd = await loadBaseData();
      setBaseData(bd);
      const linked = parsed.students.filter(
        (s) => s.documentUrls.endorsementGuide || s.documentUrls.endorsementHead || s.documentUrls.marksheet
      ).length;
      if (linked === 0) {
        setError(
          "No document hyperlinks found in this file. Make sure you're uploading the RAW file downloaded directly from the portal — opening and re-saving it (e.g. through Google Sheets) strips the links."
        );
      }
    } catch (err) {
      setError(err.message);
    }
  }

  const processAll = useCallback(async () => {
    if (!students || !baseData) return;
    setProcessing(true);
    setProgress({ done: 0, total: students.length });

    const greenOnly = students.filter((s) => s.commentFlag !== "red");
    const skipped = students.length - greenOnly.length;

    const outputs = await runWithConcurrency(
      greenOnly,
      async (student) => {
        try {
          const res = await fetch("/api/process-student", {
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
              /* response wasn't JSON, e.g. a raw Netlify timeout page */
            }
            throw new Error(detail);
          }
          return await res.json();
        } catch (err) {
          return { name: student.name, error: err.message };
        }
      },
      (done, total) => setProgress({ done, total })
    );

    setResults(outputs);
    setProcessing(false);
    if (skipped > 0) {
      setError((prev) => `${prev ? prev + " " : ""}Skipped ${skipped} student(s) flagged red in Comments.`);
    }
  }, [students, baseData, batchId]);

  function exportCSV() {
    const headers = [
      "Name",
      "Institution",
      "Subtotal (80)",
      "Document Score (20)",
      "Combined (100)",
      "Document Flags",
      "Justification",
    ];
    const lines = [headers.join(",")];
    results.forEach((r) => {
      if (r.error) {
        lines.push(`"${r.name}",,,,,"ERROR: ${r.error}",`);
        return;
      }
      const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      lines.push(
        [
          esc(r.name),
          esc(r.institution),
          r.subtotal80,
          r.documentScore,
          r.combinedTotal,
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
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Fellowship Scorer</h1>
      <p style={{ color: "#666" }}>
        Upload the raw spreadsheet exported directly from the portal. Documents are fetched and read
        automatically from the links embedded in the file — no manual download needed.
      </p>

      <div
        onClick={() => fileInputRef.current.click()}
        style={{ border: "2px dashed #ccc", borderRadius: 12, padding: 24, cursor: "pointer", marginBottom: 16 }}
      >
        {fileName ? `Selected: ${fileName}` : "Click to upload .xlsx"}
      </div>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleFile} />

      {error && <div style={{ background: "#fee", border: "1px solid #fbb", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {students && (
        <div style={{ marginBottom: 16 }}>
          <p>
            {students.length} students loaded.{" "}
            {students.filter((s) => s.commentFlag === "red").length} flagged red in Comments (will be skipped).
          </p>
          <button onClick={processAll} disabled={processing} style={{ padding: "10px 20px", fontSize: 14 }}>
            {processing ? `Processing ${progress.done}/${progress.total}…` : "Process batch"}
          </button>
        </div>
      )}

      {results.length > 0 && (
        <div>
          <button onClick={exportCSV} style={{ marginBottom: 12 }}>
            Export CSV
          </button>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
                <th>Name</th>
                <th>Institution</th>
                <th>Subtotal /80</th>
                <th>Docs /20</th>
                <th>Total /100</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {results
                .sort((a, b) => (b.combinedTotal || 0) - (a.combinedTotal || 0))
                .map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td>{r.name}</td>
                    <td>{r.institution}</td>
                    <td>{r.subtotal80 ?? "—"}</td>
                    <td>{r.documentScore ?? "—"}</td>
                    <td style={{ fontWeight: 700, color: r.error ? "#c00" : "inherit" }} title={r.error || ""}>
                      {r.combinedTotal ?? (r.error ? "ERROR (hover for reason)" : "—")}
                    </td>
                    <td>{(r.documentFlags || []).length}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
