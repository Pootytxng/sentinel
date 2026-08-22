import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { LabConsole } from "./LabConsole";
import ExperimentBench from "./ExperimentBench";
import { GpuProfile } from "./GpuProfile";
import { liveGpuProfileSnapshot } from "../data/gpu-profile-store";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { deriveReverted } from "./use-scan";
import { optimizeVerdict } from "./optimize-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { HardwareInfo } from "../App";
import "./lab-v2.css";

// LabGround — the Lab as ONE cohesive PROVING GROUND (spec 2026-07-08-lab-proving-ground, ★ PRIMARY
// BLUEPRINT §8, the BLENDED spine). The Optimize room doesn't sit ABOVE the Lab anymore (the first
// build stacked <Check>+<Fix> in a `.lg-fast` box over a demoted Lab in a `.lg-utility` box — the
// owner rejected that seam: "recreate a blended and brand new LAB, not just copy paste over the
// merge"). Instead, the tweak-apply IS station 1 of the Lab's own numbered spine — a native member
// with the same four-line contract, number badge, and card frame as stations 2–6. One room, one
// idiom, no seam.
//
// This shell is now THIN: it owns only the room verdict (fixes-first, faithful to Directive 2 — the
// stuff users came for leads) and hands every fast-path handler down to Lab's `ground` mode, which
// renders station 1's <OptimizeStation> body from the SAME audited apply path (zero new IPC, zero
// new mutation primitive). Rendered by App for the Lab tab ONLY when `compy_lab_ground` is on
// (DEFAULT ON since the 2026-07-10 flip; with it the standalone Optimize tab drops — this room's
// Optimize station is the one door) — flag "0" is the failsafe: App renders the untouched classic
// LabV2 + OptimizeV2 rooms, byte-identical (test-pinned).

export function LabGround(props: LabFastPathProps & {
  activeCount: number;
  diagnostics?: ReactNode;
  diagnosticsCaptured?: boolean;
  hw: HardwareInfo;
}) {
  const { t } = useTranslation();
  const {
    recs,
    changes,
    isAppliable,
    activeCount,
    diagnostics,
    diagnosticsCaptured = false,
    vendor = "any",
    hw,
    ...rest
  } = props;
  const reduced = useReducedMotion();
  const hud = useHudFlag();

  // The fixes-state verdict still drives the LED (a real room state) — but under the HUD the
  // HEADER carries a title only (owner title-header law 2026-07-10 round 2: "the header just
  // needs to be a title, not a description or notification statement"). The verdict's facts
  // live in their context: ready counts on the Safe-stack gauge + the station rows, drift in
  // Fix's "Applied — turned off outside Compy" group inside the Optimize panel.
  const reverted = useMemo(() => deriveReverted(changes), [changes]);
  const verdict = optimizeVerdict(recs, isAppliable, activeCount, reverted, t);

  // The whole fast-path bundle threaded to Lab's ground mode (station 1's body).
  const fast: LabFastPathProps = { recs, changes, isAppliable, vendor, ...rest };

  // C-14 (2026-08-22) — the GPU profile surface's live read. Built from what this rig ALREADY
  // measured (detected GPU identity + the hags-enable rec's real HwSchMode read), so mounting it
  // adds zero IPC. Fields that are not user-mode readable stay null and render as "unknown"; see
  // liveGpuProfileSnapshot for why power mode and peak temp are permanently absent here.
  const gpuSnapshot = useMemo(
    () => liveGpuProfileSnapshot(hw?.gpus?.[0], recs, new Date().toISOString()),
    [hw, recs],
  );

  return (
    <RoomShell
      room="lab"
      verdict={(() => {
        if (!hud) {
          // Flag off: the exact pre-rollout tree (verdict sentence as the h1, classic contract).
          return reduced || !verdict.settled ? (
            verdict.headline
          ) : (
            <DecryptedText
              key={verdict.headline}
              text={verdict.headline}
              animateOn="view"
              sequential
              speed={22}
              useOriginalCharsOnly
            />
          );
        }
        return (
          <>
            <HudMasthead
              label={t("lab.labGround.masthead")}
              led={!verdict.settled ? "scan" : verdict.allClear ? "ok" : "warn"}
            />
            <span className="hud-headline">{t("common.rail.lab", "Lab")}</span>
          </>
        );
      })()}
    >
      {/* THE OPS CONSOLE (spec 2026-07-09, Phase 1, Task 4) — a real 3D hologram center-stage with
          four corner arc gauges + a Dock of stations (Optimize primary, the measure→prove
          instruments beside it), replacing the Instrument Bench bento. Same audited apply path,
          zero new IPC. */}
      <LabConsole
        fast={fast}
        diagnostics={diagnostics}
        diagnosticsCaptured={diagnosticsCaptured}
        vendor={vendor}
        hw={hw}
      />
      {/* Intelligence Phase 3 — the controlled-experiment engine + optimization simulator. ARMED
          2026-07-17 (owner-signed): renders the bench when experiment_gate() is true; still
          fails-dark (renders NOTHING) if the gate ever reads false. */}
      {/* C-14 — the GPU profile surface, ADVISORY ONLY. Built, tested and mounted nowhere since
          2026-08-04 (owner fork B_gpu, closed 2026-08-22 in favour of wiring it in). It can never be
          anything but advisory: LOCKED rule 6 makes GPU-profile APPLY structurally impossible,
          because AMD profile state is not user-mode readable and so rollback-first cannot be
          satisfied. Nothing here writes to the machine. Sibling of the console, the same out-of-grid
          tile idiom ExperimentBench already uses. */}
      <GpuProfile currentSnapshot={gpuSnapshot} />
      <ExperimentBench />
    </RoomShell>
  );
}

export default LabGround;
