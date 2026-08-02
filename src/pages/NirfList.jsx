import React, { useState, useEffect, useRef } from "react";
import { styles, COLOR } from "../styles.js";
import { parseNirfFile } from "../lib/parseSpreadsheet.js";
import { API_BASE } from "../lib/apiBase.js";

export default function NirfList() {
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");
  const fileInputRef = useRef(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/base-data`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setList(data.nirfList || []);
    } catch (err) {
      setError("Couldn't load NIRF list: " + err.message);
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
      const newList = await parseNirfFile(file);
      const res = await fetch(`${API_BASE}/base-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceNirf: newList }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setMessage(`Replaced NIRF list with ${newList.length} institute(s).`);
      await load();
    } catch (err) {
      setError(err.message);
    }
    setUploading(false);
    e.target.value = "";
  }

  const filtered = list ? list.filter((n) => n.n.toLowerCase().includes(filter.toLowerCase())) : [];

  return (
    <div>
      <div style={styles.panel}>
        <h2 style={styles.h2}>NIRF Ranking List</h2>
        <p style={styles.sub}>
          Institutes with a known NIRF rank score 2/5 on the Institute dimension (ranked 1-200); everyone
          else — including institutes not in this list at all — defaults to 5/5 (unranked, per your
          rubric's preference for Tier 2/3 institutes).
        </p>

        <div style={styles.dataBar}>
          <div style={styles.dataChip}>
            <span style={styles.dataChipLabel}>Ranked institutes</span>
            <span style={styles.dataChipValue}>{loading ? "…" : list?.length ?? 0}</span>
          </div>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}
        {message && <div style={{ ...styles.warnBox, background: COLOR.sealSoft, color: COLOR.seal, border: `1px solid ${COLOR.seal}` }}>{message}</div>}

        <div style={styles.uploadBox} onClick={() => fileInputRef.current.click()}>
          <div style={styles.uploadIcon}>↑</div>
          <div>
            <strong>{uploading ? "Uploading…" : "Replace NIRF list"}</strong>
            <div style={{ fontSize: 12, color: COLOR.inkSoft, marginTop: 2 }}>
              .xlsx with institute name and NIRF rank columns — this replaces the entire list
            </div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleUpload} disabled={uploading} />
      </div>

      {list && list.length > 0 && (
        <div style={styles.panel}>
          <h3 style={styles.h3}>Current list ({list.length})</h3>
          <input
            placeholder="Filter by institute name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLOR.border}`, fontSize: 13, marginBottom: 12, width: "100%" }}
          />
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Institute</th>
                <th style={styles.th}>NIRF Rank</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n, i) => (
                <tr key={i}>
                  <td style={styles.td}>{n.n}</td>
                  <td style={styles.td}>{n.r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list && list.length === 0 && !loading && (
        <div style={styles.warnBox}>No NIRF data yet — every institute will default to unranked (5/5) until you upload a list.</div>
      )}
    </div>
  );
}
