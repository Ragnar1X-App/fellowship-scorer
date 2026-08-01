import * as XLSX from "xlsx";
import { autoDetectColumns, mergeAiCourseColumns, classifyFillColor } from "./scoring.js";

// Extracts the raw URL from a =HYPERLINK("url","label") formula string.
function urlFromHyperlinkFormula(formula) {
  if (!formula) return null;
  const match = formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
  return match ? match[1] : null;
}

export async function parseWorkbookFile(file) {
  const isCsv = /\.csv$/i.test(file.name || "") || file.type === "text/csv";
  const buf = await file.arrayBuffer();
  const wb = isCsv
    ? XLSX.read(new TextDecoder().decode(buf), { type: "string" })
    : XLSX.read(buf, { type: "array", cellStyles: true, cellFormula: true });

  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (json.length < 2) throw new Error("Sheet has no data rows.");

  const rawHdrs = json[0];
  const rawJsonRows = json.slice(1);
  const withRowNum = rawJsonRows.map((r, i) => ({ row: r, sheetRow: i + 2 }));
  const nonBlank = withRowNum.filter((p) => p.row.some((c) => c !== ""));
  const rawDataRows = nonBlank.map((p) => p.row);
  const rowNumbers = nonBlank.map((p) => p.sheetRow);

  const { headers, rows, mergedIdx } = mergeAiCourseColumns(rawHdrs, rawDataRows);
  const colMap = autoDetectColumns(headers);
  if (mergedIdx !== null) {
    colMap.courseNames = mergedIdx;
    colMap.courseCount = -1;
  }

  // Recover real document URLs from HYPERLINK() formulas (survives only on a raw,
  // unmodified portal export — opening/resaving through Sheets/Excel strips these).
  function urlAt(rowIdx, colIdx) {
    if (colIdx < 0) return null;
    const sheetRow = rowNumbers[rowIdx];
    const addr = XLSX.utils.encode_cell({ r: sheetRow - 1, c: colIdx });
    const cell = ws[addr];
    if (!cell) return null;
    if (cell.f) return urlFromHyperlinkFormula(cell.f);
    if (typeof cell.v === "string" && cell.v.startsWith("http")) return cell.v;
    return null;
  }

  function commentFlagAt(rowIdx) {
    if (colMap.comments < 0) return "none";
    const sheetRow = rowNumbers[rowIdx];
    const addr = XLSX.utils.encode_cell({ r: sheetRow - 1, c: colMap.comments });
    const cell = ws[addr];
    const rgb = cell && cell.s && cell.s.fgColor && cell.s.fgColor.rgb;
    return classifyFillColor(rgb);
  }

  const get = (row, field) => {
    const i = colMap[field];
    return i >= 0 && i !== undefined ? row[i] : "";
  };

  const students = rows.map((row, idx) => ({
    name: get(row, "name") || `Row ${idx + 2}`,
    institution: get(row, "institution") || "",
    marks: get(row, "marks"),
    courseCount: get(row, "courseCount"),
    courseNames: get(row, "courseNames"),
    title: (get(row, "title") || "").toString(),
    description: (get(row, "description") || "").toString(),
    guideName: get(row, "guideName") || "",
    commentFlag: commentFlagAt(idx),
    documentUrls: {
      endorsementGuide: urlAt(idx, colMap.endorsementGuideUrl),
      endorsementHead: urlAt(idx, colMap.endorsementHeadUrl),
      marksheet: urlAt(idx, colMap.marksheetUrl),
    },
  }));

  return { headers, colMap, students };
}
