import { lazy, Suspense, useState } from "react";
import type { HardwareInfo } from "../../App";
import "./RigViewer.css";

// Lazy-load the three.js scene so the ~600KB 3D bundle only loads when the hologram is actually shown
// (keeps Compy's initial load lean). The viewer owns the interaction state + the control bar.
const RigHologram = lazy(() =>
  import("./RigHologram").then((m) => ({ default: m.RigHologram })),
);

export function RigViewer({ hw }: { hw: HardwareInfo }) {
  const [exploded, setExploded] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="rig-viewer">
      <div className="rig-controls">
        <button
          type="button"
          className={`btn-small ${exploded ? "btn-small-on" : ""}`}
          onClick={() => setExploded((v) => !v)}
        >
          {exploded ? "Reassemble" : "Exploded view"}
        </button>
        <button
          type="button"
          className={`btn-small ${autoRotate ? "btn-small-on" : ""}`}
          onClick={() => setAutoRotate((v) => !v)}
          aria-pressed={autoRotate}
          title="Toggle auto-rotate"
        >
          Orbit
        </button>
        <span className="rig-hint">Drag to orbit · hover a part for its live specs</span>
      </div>

      <div className="rig-canvas">
        <Suspense fallback={<div className="rig-loading">Initializing hologram…</div>}>
          <RigHologram
            hw={hw}
            exploded={exploded}
            autoRotate={autoRotate}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={(id) => setSelectedId(id || null)}
            onHover={setHoveredId}
          />
        </Suspense>
      </div>

      <p className="rig-honesty">
        Tailored to your rig — every part and spec here is read live from your PC. A cooler, PSU and
        case fans aren't software-detectable, so Compy shows them faint rather than guess.
      </p>
    </div>
  );
}
