import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { LabConsole } from "./LabConsole";
import ExperimentBench from "./ExperimentBench";
import { GpuProfile } from "./GpuProfile";
import { liveGpuProfileSnapshot } from "../data/gpu-profile-store";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag } from "../design/use-hud";
import { deriveReverted } from "./use-scan";
import { optimizeVerdict, safeFixesReady } from "./optimize-v2-data";
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
  // The classic failsafe's verdict is a FLAG, not a title (#547): it now sits under the room's h1,
  // and when it flags something actionable it names the fix beside itself. Drift outranks nothing —
  // the verdict already leads with ready fixes when both exist — so the label follows the verdict.
  const ready =
    recs == null ? 0 : safeFixesReady(recs, isAppliable, new Set(reverted.map((r) => r.rec_id)));
  const classicFixLabel =
    !verdict.settled || verdict.allClear
      ? undefined
      : ready > 0
        ? t("lab.labConsole.verdictFix.ready", { count: ready })
        : t("lab.labConsole.verdictFix.drifted", { count: reverted.length });

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
    /* THE SHELL MOVED DOWN INTO THE CONSOLE (issue #49 slice 6). The approved Test direction is a
       narrative column beside an evidence column, and every fact in both — which station is open,
       what the hologram has selected, what the bench has measured — is state LabConsole holds.
       Writing the shell up here would have meant threading its setters back down through this
       wrapper for nothing. What stays here is what is genuinely this component's: the room verdict
       computed off the fixes state, and the two out-of-grid surfaces that are siblings of the
       console rather than parts of it. */
    <LabConsole
      fast={fast}
      diagnostics={diagnostics}
      diagnosticsCaptured={diagnosticsCaptured}
      vendor={vendor}
      hw={hw}
      hud={hud}
      /* The eyebrow dot speaks the SAME verdict the classic sub line speaks — one source, so the
         dot and the sentence can never disagree about the room. */
      ledState={!verdict.settled ? "scan" : verdict.allClear ? "ok" : "warn"}
      classicVerdict={
        reduced || !verdict.settled ? (
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
        )
      }
      classicFixLabel={classicFixLabel}
      below={
        <>
          {/* C-14 — the GPU profile surface, ADVISORY ONLY. It can never be anything but advisory:
              LOCKED rule 6 makes GPU-profile APPLY structurally impossible, because AMD profile
              state is not user-mode readable and so rollback-first cannot be satisfied. Nothing
              here writes to the machine. */}
          <GpuProfile currentSnapshot={gpuSnapshot} />
          {/* Intelligence Phase 3 — the controlled-experiment engine + optimization simulator.
              ARMED 2026-07-17 (owner-signed); still fails dark (renders NOTHING) if the gate ever
              reads false. */}
          <ExperimentBench />
        </>
      }
    />
  );
}

export default LabGround;
