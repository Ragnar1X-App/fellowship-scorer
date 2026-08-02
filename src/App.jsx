import React, { useState } from "react";
import { styles, FONT_IMPORT } from "./styles.js";
import ScoreBatch from "./pages/ScoreBatch.jsx";
import BaseDataset from "./pages/BaseDataset.jsx";
import NirfList from "./pages/NirfList.jsx";

const TABS = [
  { key: "score", label: "Score Batch", Component: ScoreBatch },
  { key: "base", label: "Base Dataset", Component: BaseDataset },
  { key: "nirf", label: "NIRF List", Component: NirfList },
];

export default function App() {
  const [tab, setTab] = useState("score");
  const Active = TABS.find((t) => t.key === tab).Component;

  return (
    <div style={styles.page}>
      <style dangerouslySetInnerHTML={{ __html: FONT_IMPORT }} />
      <header style={styles.headerBand}>
        <div style={styles.headerInner}>
          <div>
            <div style={styles.eyebrow}>IndiaAI Fellowship</div>
            <h1 style={styles.h1}>Fellowship Scorer</h1>
          </div>
          <nav style={styles.nav}>
            {TABS.map((t) => (
              <button key={t.key} style={styles.navTab(tab === t.key)} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div style={styles.container}>
        <Active />
      </div>
    </div>
  );
}
