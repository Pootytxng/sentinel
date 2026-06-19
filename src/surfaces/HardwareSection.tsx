import { useState } from "react";
import type { HardwareInfo } from "../App";
import { HardwareGrid } from "./HardwareGrid";
import { RigViewer } from "./rig/RigViewer";
import "./HardwareSection.css";

// "Your hardware" — the shared section both Homes render, now with a Cards <-> 3D toggle. Cards is the
// default (light, no three.js); the 3D rig hologram lazy-loads only when the user picks "3D".
export function HardwareSection({ hw }: { hw: HardwareInfo }) {
  const [view, setView] = useState<"cards" | "3d">("cards");
  return (
    <section className="hw-section">
      <div className="hw-section-head">
        <h2 className="section-title">Your hardware</h2>
        <div className="hw-view-toggle" role="tablist" aria-label="Hardware view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "cards"}
            className={`hw-view-btn ${view === "cards" ? "hw-view-on" : ""}`}
            onClick={() => setView("cards")}
          >
            Cards
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "3d"}
            className={`hw-view-btn ${view === "3d" ? "hw-view-on" : ""}`}
            onClick={() => setView("3d")}
          >
            3D
          </button>
        </div>
      </div>
      {view === "cards" ? <HardwareGrid hw={hw} /> : <RigViewer hw={hw} />}
    </section>
  );
}
