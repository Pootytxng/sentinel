import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HardwareInfo } from "../../App";
import { useManualParts, MANUAL_KINDS, type ManualKind } from "./manual-parts";
import "./RigViewer.css";

// Official download page — opened EXTERNALLY via the allowlisted opener plugin (capabilities). A fixed
// constant, never from data; the user installs the monitor themselves (informed — no bundling, no
// driver shipped by Compy).
const HWINFO_URL = "https://www.hwinfo.com/download/";

// Lazy-load the three.js scene so the ~600KB 3D bundle only loads when the hologram is shown.
const RigHologram = lazy(() =>
  import("./RigHologram").then((m) => ({ default: m.RigHologram })),
);

export function RigViewer({ hw }: { hw: HardwareInfo }) {
  const [exploded, setExploded] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { parts: manualParts, add, remove } = useManualParts();
  const [kind, setKind] = useState<ManualKind>("psu");
  const [name, setName] = useState("");

  // No fan sensors publishing → no monitor running → offer the honest "light up sensors" nudge.
  const [noMonitor, setNoMonitor] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      invoke<{ label: string; rpm: number; source: string }[]>("get_fan_sensors")
        .then((f) => !cancelled && setNoMonitor(f.length === 0))
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    add({ kind, name: n });
    setName("");
  };

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
            manualParts={manualParts}
          />
        </Suspense>
      </div>

      <p className="rig-honesty">
        Tailored to your rig — parts and specs read live from your PC. Fans spin at their real RPM
        when HWiNFO or LibreHardwareMonitor is running; without one they stay faint placeholders. A
        PSU and the cooler model have no software identity, so they remain ghosts rather than guesses.
      </p>

      {noMonitor && (
        <div className="rig-nudge">
          <div className="rig-nudge-title">Light up your fans &amp; temperatures</div>
          <p className="rig-nudge-body">
            Your fans show as ghosts because Compy stays <strong>driver-free</strong> (anti-cheat-safe)
            — it reads live RPM and temps from a free monitor you run, instead of installing a driver of
            its own. Install <strong>HWiNFO</strong> and turn on its “Shared Memory Support,” and Compy
            picks it up automatically. (These monitors use a low-level driver to reach the sensors, so
            it’s your call — HWiNFO is the gamer-trusted one.)
          </p>
          <button
            type="button"
            className="btn-small btn-small-on rig-nudge-cta"
            onClick={() => {
              openUrl(HWINFO_URL).catch(() => {
                /* opener blocked — the written steps still stand */
              });
            }}
          >
            Get HWiNFO — official site
          </button>
        </div>
      )}

      <div className="rig-manual">
        <form className="rig-manual-form" onSubmit={onAdd}>
          <span className="rig-manual-label">Add a part Compy can't detect:</span>
          <select
            className="rig-manual-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as ManualKind)}
            aria-label="Component type"
          >
            {MANUAL_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            className="rig-manual-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Corsair RM850x"
            maxLength={48}
            aria-label="Component name"
          />
          <button type="submit" className="btn-small btn-small-on" disabled={!name.trim()}>
            Add
          </button>
        </form>
        {manualParts.length > 0 && (
          <ul className="rig-manual-list">
            {manualParts.map((p) => (
              <li key={p.id} className="rig-manual-item">
                <span className="rig-manual-item-name">{p.name}</span>
                <span className="rig-manual-item-tag">user-added</span>
                <button
                  type="button"
                  className="rig-manual-remove"
                  onClick={() => remove(p.id)}
                  aria-label={`Remove ${p.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
