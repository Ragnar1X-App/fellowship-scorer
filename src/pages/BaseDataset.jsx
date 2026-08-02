import React, { useState, useEffect, useRef } from "react";
import { styles, COLOR } from "../styles.js";
import { parseBaseProjectsFile } from "../lib/parseSpreadsheet.js";
import { API_BASE } from "../lib/apiBase.js";

export default function BaseDataset() {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const fileInputRef = useRef(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/base-data`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setProjects(data.baseProjects || []);
    } catch (err) {
      setError("Couldn't load base dataset: " + err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const newProjects = await parseBaseProjectsFile(file);
      const res = await fetch(`${API_BASE}/base-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addProjects: newProjects }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setMessage(`Added up to ${newProjects.length} project(s) — duplicates (matching title) were skipped automatically.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
    e.target.value = "";
  }

  return (
    <div>
      <div style={styles.panel}>
        <h2 style={styles.h2}>Base Dataset</h2>
        <p style={styles.sub}>
          Approved past projects, used to check new submissions for uniqueness. Every project you add here
          becomes part of the comparison corpus for future batches.
        </p>

        <div style={styles.dataBar}>
          <div style={styles.dataChip}>
            <span style={styles.dataChipLabel}>Projects in dataset</span>
            <span style={styles.dataChipValue}>{loading ? "…" : projects?.length ?? 0}</span>
          </div>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}
        {message && <div style={{ ...styles.warnBox, background: COLOR.sealSoft, color: COLOR.seal, border: `1px solid ${COLOR.seal}` }}>{message}</div>}

        <div style={styles.uploadBox} onClick={() => fileInputRef.current.click()}>
          <div style={styles.uploadIcon}>↑</div>
          <div>
            <strong>{uploading ? "Uploading…" : "Add more projects"}</strong>
            <div style={{ fontSize: 12, color: COLOR.inkSoft, marginTop: 2 }}>
              .xlsx with "Project Title" and "Project Description" columns
            </div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleUpload} disabled={uploading} />
      </div>

      {projects && projects.length > 0 && (
        <div style={styles.panel}>
          <h3 style={styles.h3}>Current projects ({projects.length})</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Title</th>
                <th style={styles.th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={i} onClick={() => setExpanded(expanded === i ? null : i)} style={{ cursor: "pointer" }}>
                  <td style={{ ...styles.td, fontWeight: 600, maxWidth: 280 }}>{p.t}</td>
                  <td style={styles.td}>
                    {expanded === i ? p.d : `${(p.d || "").slice(0, 120)}${(p.d || "").length > 120 ? "…" : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {projects && projects.length === 0 && !loading && (
        <div style={styles.warnBox}>No projects in the base dataset yet — uniqueness checks will show "N/A" until you add some.</div>
      )}
    </div>
  );
}
