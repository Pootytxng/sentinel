import { lazy, memo, Suspense, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../../i18n";
import type { HardwareInfo } from "../../App";
import { useManualParts } from "./manual-parts";
import { RigManualParts } from "./RigManualParts";
import { rigSelectionStatus, type RigSelection } from "./rig-parts";
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
  cameraDist,
  cameraTargetY,
  onSelectedIdChange,
  focusId = null,
  dimmed = false,
}: {
  hw: HardwareInfo;
  // chromeless: render ONLY the 3D hologram canvas (no control bar, honesty caption, monitor nudge,
  // or "add a part" form) — for host surfaces that frame the hologram themselves (the Lab Ops
  // Console, whose corner gauges would otherwise collide with the viewer's bottom form). Manual
  // parts still render in the model; only the management CHROME is hidden.
  chromeless?: boolean;
  // HOW CLOSE THE CAMERA SITS, passed straight through to the hologram's own `cameraDist` (which
  // both seats the camera and gives FitCamera its base distance). Undefined means "the hologram's
  // default", so every existing caller is unchanged by construction — this is a pass-through, not
  // a new default. A host that frames the bay itself needs it: the Lab bench gives the rig a whole
  // panel, and at the shared distance the model sat marooned in it no matter how large the window
  // grew. Guard: lab-bench-framing-guard.test.ts pins that the default stays in RigHologram, so
  // adding one here would re-frame every rig in the app from a single line.
  cameraDist?: number;
  // WHERE THE CAMERA AIMS VERTICALLY, passed straight through like cameraDist and undefined by
  // default for the same reason: every existing caller keeps the hologram's own framing. The Lab
  // bench aims lower so the floor ring gets the bottom air its comp draws (#224 round 4).
  cameraTargetY?: number;
  // Selection stays internal state (autoRotate/exploded live here too) — this is an OPT-IN mirror
  // for a host that wants to react to it (e.g. the Ops Console showing evidence for the selected
  // part), not a hand-off of ownership.
  onSelectedIdChange?: (id: string | null, what: RigSelection | null) => void;
  /** P7-rig-care: a part the HOST's evidence points at (the Care station's newest assessed crash).
   *  Shown as the selection until the user picks or clears one themselves on this mount — the
   *  answer points, it never fights the user. Sticky per mount: a later focus (a rescan) does not
   *  take the rig back from a user who already picked. Not mirrored to `onSelectedIdChange`: that stays the
   *  user's own selection. Default null — every other host is untouched. */
  focusId?: string | null;
  /** P7-rig-care: the host's evidence points away from the parts (RigHologram `dimmed`). */
  dimmed?: boolean;
}) {
  const { t } = useTranslation();
  const [exploded, setExploded] = useState(false);
  // Hologram bay v2 (T4d): idle GPU ~0 — the bay rests on frameloop "demand", so continuous
  // orbit is an explicit opt-in (the Orbit button) instead of the default. V1 (flag off)
  // keeps its classic always-orbiting default.
  const [autoRotate, setAutoRotate] = useState(() => !readHologramV2());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // P7-rig-care: once the user picks or clears a part, the host's focus steps aside (derived at
  // render, never re-asserted in an effect).
  const [userPicked, setUserPicked] = useState(false);
  const shownId = !userPicked && focusId ? focusId : selectedId;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // What the hologram drew, for the keyboard picker below. Empty until the lazy 3D chunk mounts.
  const [inventory, setInventory] = useState<RigSelection[]>([]);
  // The picker panel and the on-canvas spec cards both want the top-left of the stage. While the
  // picker holds focus the cards stand down (self-review 2026-08-11 caught one landing across the
  // list rows, illegible at narrow widths) — the model still highlights the focused part.
  const [pickerFocused, setPickerFocused] = useState(false);

  // One selection path for pointer and keyboard alike: both land here, so the host mirror can never
  // see a selection the other route wouldn't have produced.
  const select = useCallback(
    (id: string, what: RigSelection | null) => {
      const next = id || null;
      setUserPicked(true);
      setSelectedId(next);
      onSelectedIdChange?.(next, what);
    },
    [onSelectedIdChange],
  );

  // add/remove live in RigManualParts now; this instance only draws the list in the hologram.
  const { parts: manualParts } = useManualParts();

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
            selectedId={shownId}
            hoveredId={hoveredId}
            // `what` rides along so a host can answer for a fan or a user-added part, neither of
            // which is in `buildRigParts`. Selection ownership is unchanged — this is still a
            // mirror of our state, now one the host can actually read.
            onSelect={select}
            onHover={setHoveredId}
            onInventory={setInventory}
            cardsSuppressed={pickerFocused}
            manualParts={manualParts}
            // Chromeless = the Lab evidence map: no explode/orbit buttons, so clicking the model is
            // the only way in and nothing may block a real part's hitbox.
            evidenceMap={chromeless}
            cameraDist={cameraDist}
            cameraTargetY={cameraTargetY}
            dimmed={dimmed}
          />
        </Suspense>

        {/* The keyboard's way in. The hologram is a WebGL canvas — its parts are meshes, not DOM, so
            a pointer was the ONLY way to select one and everything the evidence panel shows was
            unreachable without a mouse (#49 a11y acceptance). These are real buttons: Tab reaches
            them, Enter/Space activates, aria-pressed reports which is selected. They sit off-screen
            until one takes focus, then the group appears over the stage — so the pointer experience
            and the owner-approved framing are unchanged, and a keyboard user sees where they are. */}
        {inventory.length > 0 && (
          <ul
            className="rig-picker"
            aria-label={t("gaming.rigViewer.picker.label")}
            onFocus={() => setPickerFocused(true)}
            // Only when focus leaves the list entirely — moving between its own buttons must not
            // flicker the cards back on for a frame.
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPickerFocused(false);
            }}
          >
            {inventory.map((item) => {
              const status = rigSelectionStatus(item);
              const value =
                item.source === "fan" && item.rpm !== null
                  ? t("gaming.rigViewer.picker.rpm", { rpm: item.rpm })
                  : t(`gaming.rigViewer.picker.status.${status}`);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="rig-picker-item"
                    // The scene itself is a WebGL canvas — a mesh has no selector, so a live review
                    // (or any driver outside jsdom) could only reach a part by matching its
                    // localized label or by counting rows, both of which move. The id is the same
                    // one the hologram selects by, so this is the stable way in.
                    data-rig-part={item.id}
                    aria-pressed={shownId === item.id}
                    onClick={() => select(item.id, item)}
                    onFocus={() => setHoveredId(item.id)}
                    onBlur={() => setHoveredId((h) => (h === item.id ? null : h))}
                  >
                    <span className="rig-picker-name">{item.name}</span>
                    <span className="rig-picker-value">{value}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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

      {/* Extracted to RigManualParts (Train 1, 2026-08-12) so the Lab can mount the same form in
          its own chrome — chromeless hid this one, which left manual parts unreachable in the only
          live mount. Hook instances sync, so both surfaces see one list. */}
      <RigManualParts />
        </>
      )}
    </div>
  );
});
