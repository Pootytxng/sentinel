import { lazy, memo, Suspense, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HardwareInfo } from "../../App";
import { useManualParts, MANUAL_KINDS, type ManualKind } from "./manual-parts";
import { readHologramV2 } from "../../design/theme";
import "./RigViewer.css";

// Official download page — opened EXTERNALLY via the allowlisted opener plugin (capabilities). A fixed
// constant, never from data; the user installs the monitor themselves (informed — no bundling, no
// driver shipped by Compy).
const HWINFO_URL = "https://www.hwinfo.com/download/";
const LHM_URL = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases";

// Lazy-load the three.js scene so the ~600KB 3D bundle only loads when the hologram is shown.
const RigHologram = lazy(() =>
  import("./RigHologram").then((m) => ({ default: m.RigHologram })),
);

// Memoized: `hw` is its only prop and is referentially stable (App sets hw only on refresh/apply,
// never on the 1 Hz monitoring tick). So the parent dashboard's per-second self-tick (which repaints
// the live charts) no longer drags the whole react-three-fiber rig scene through a reconcile every
// second — it only re-renders on a real hw change or its own interactions.
export const RigViewer = memo(function RigViewer({
  hw,
  chromeless = false,
}: {
  hw: HardwareInfo;
  // chromeless: render ONLY the 3D hologram canvas (no control bar, honesty caption, monitor nudge,
  // or "add a part" form) — for host surfaces that frame the hologram themselves (the Lab Ops
  // Console, whose corner gauges would otherwise collide with the viewer's bottom form). Manual
  // parts still render in the model; only the management CHROME is hidden.
  chromeless?: boolean;
}) {
  const [exploded, setExploded] = useState(false);
  // Hologram bay v2 (T4d): idle GPU ~0 — the bay rests on frameloop "demand", so continuous
  // orbit is an explicit opt-in (the Orbit button) instead of the default. V1 (flag off)
  // keeps its classic always-orbiting default.
  const [autoRotate, setAutoRotate] = useState(() => !readHologramV2());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { parts: manualParts, add, remove } = useManualParts();
  const [kind, setKind] = useState<ManualKind>("psu");
  const [name, setName] = useState("");

  // No fan sensors publishing → no monitor running → offer the honest "light up sensors" nudge.
  const [noMonitor, setNoMonitor] = useState(false);
  useEffect(() => {
    // The only consumer of noMonitor is the fan/monitor nudge, which lives behind {!chromeless}.
    // In chromeless mode (the Ops Console) polling get_fan_sensors every 6s buys nothing — skip it.
    if (chromeless) return;
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
  }, [chromeless]);

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    add({ kind, name: n });
    setName("");
  };

  return (
    <div className="rig-viewer">
      {!chromeless && (
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
          <span className="rig-hint">Drag to orbit · hover or click a part for its live specs</span>
        </div>
      )}

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

      {!chromeless && (
        <>
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
            — it reads live RPM and temps from a free monitor you run, instead of shipping a driver of
            its own. Install either (Compy reads both automatically):
          </p>
          <div className="rig-nudge-opt">
            <button
              type="button"
              className="btn-small btn-small-on rig-nudge-cta"
              onClick={() => {
                openUrl(LHM_URL).catch(() => {
                  /* opener blocked — the link text still stands */
                });
              }}
            >
              LibreHardwareMonitor
            </button>
            <span className="rig-nudge-opt-note">
              Open-source · runs persistently, no time limit, no setup. Heads-up: its low-level driver
              can trip strict anti-cheat (Valorant/Vanguard) — close it before those games.
            </span>
          </div>
          <div className="rig-nudge-opt">
            <button
              type="button"
              className="btn-small rig-nudge-cta"
              onClick={() => {
                openUrl(HWINFO_URL).catch(() => {
                  /* opener blocked — the link text still stands */
                });
              }}
            >
              HWiNFO
            </button>
            <span className="rig-nudge-opt-note">
              Gamer-trusted · turn on “Shared Memory Support” (the free version resets it about every
              12 hours).
            </span>
          </div>
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
        </>
      )}
    </div>
  );
});
