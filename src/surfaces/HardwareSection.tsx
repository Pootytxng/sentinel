import { useState } from "react";
import type { HardwareInfo } from "../App";
import { HardwareGrid } from "./HardwareGrid";
import { RigViewer } from "./rig/RigViewer";
import "./HardwareSection.css";

// "Your hardware" — the shared section both Homes render, with a Cards <-> 3D toggle. The 3D rig
// hologram is the default (the "tailored to your hardware" centerpiece; lazy-loaded, step-aside-safe);
// Cards stays one tap away for a lighter, no-three.js view.
export function HardwareSection({ hw }: { hw: HardwareInfo }) {
  const [view, setView] = useState<"cards" | "3d">("3d");
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
