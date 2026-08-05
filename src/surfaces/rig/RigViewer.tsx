import { lazy, memo, Suspense, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../../i18n";
import type { HardwareInfo } from "../../App";
import { useManualParts, MANUAL_KINDS, manualKindLabel, type ManualKind } from "./manual-parts";
import { readHologramV2 } from "../../design/theme";
import { useDocumentVisible } from "../../data/use-document-visible";
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
  const { t } = useTranslation();
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
  const visible = useDocumentVisible();
  useEffect(() => {
    // The only consumer of noMonitor is the fan/monitor nudge, which lives behind {!chromeless}.
    // In chromeless mode (the Ops Console) polling get_fan_sensors every 6s buys nothing — skip it.
    // Q7 idle-cost: same for a hidden window — the nudge can't be read, so don't re-read sensors.
    if (chromeless || !visible) return;
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
  }, [chromeless, visible]);

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
            {exploded
              ? t("gaming.rigViewer.reassembleButton")
              : t("gaming.rigViewer.explodedViewButton")}
          </button>
          <button
            type="button"
            className={`btn-small ${autoRotate ? "btn-small-on" : ""}`}
            onClick={() => setAutoRotate((v) => !v)}
            aria-pressed={autoRotate}
            title={t("gaming.rigViewer.toggleAutoRotateTitle")}
          >
            {t("gaming.rigViewer.orbitButton")}
          </button>
          <span className="rig-hint">{t("gaming.rigViewer.dragHint")}</span>
        </div>
      )}

      <div className="rig-canvas">
        <Suspense fallback={<div className="rig-loading">{t("gaming.rigViewer.initializingHologram")}</div>}>
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
      <p className="rig-honesty">{t("gaming.rigViewer.honestyNote")}</p>

      {noMonitor && (
        <div className="rig-nudge">
          <div className="rig-nudge-title">{t("gaming.rigViewer.nudgeTitle")}</div>
          <p className="rig-nudge-body">
            {t("gaming.rigViewer.nudgeBodyPre")}{" "}
            <strong>{t("gaming.rigViewer.nudgeBodyEmph")}</strong>{" "}
            {t("gaming.rigViewer.nudgeBodyPost")}
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
              {t("gaming.rigViewer.libreHardwareMonitorButton")}
            </button>
            <span className="rig-nudge-opt-note">{t("gaming.rigViewer.lhmNote")}</span>
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
              {t("gaming.rigViewer.hwinfoButton")}
            </button>
            <span className="rig-nudge-opt-note">{t("gaming.rigViewer.hwinfoNote")}</span>
          </div>
        </div>
      )}

      <div className="rig-manual">
        <form className="rig-manual-form" onSubmit={onAdd}>
          <span className="rig-manual-label">{t("gaming.rigViewer.addPartLabel")}</span>
          <select
            className="rig-manual-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as ManualKind)}
            aria-label={t("gaming.rigViewer.componentTypeAriaLabel")}
          >
            {MANUAL_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {manualKindLabel(k.value, t)}
              </option>
            ))}
          </select>
          <input
            className="rig-manual-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("gaming.rigViewer.addPartPlaceholder")}
            maxLength={48}
            aria-label={t("gaming.rigViewer.componentNameAriaLabel")}
          />
          <button type="submit" className="btn-small btn-small-on" disabled={!name.trim()}>
            {t("gaming.rigViewer.addButton")}
          </button>
        </form>
        {manualParts.length > 0 && (
          <ul className="rig-manual-list">
            {manualParts.map((p) => (
              <li key={p.id} className="rig-manual-item">
                <span className="rig-manual-item-name">{p.name}</span>
                <span className="rig-manual-item-tag">{t("gaming.rigViewer.userAddedTag")}</span>
                <button
                  type="button"
                  className="rig-manual-remove"
                  onClick={() => remove(p.id)}
                  aria-label={t("gaming.rigViewer.removePartAriaLabel", { name: p.name })}
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
