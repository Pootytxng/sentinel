import { useMemo, type ReactNode } from "react";
import { LabConsole } from "./LabConsole";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { deriveReverted } from "./use-scan";
import { optimizeVerdict, optimizeMeasuredLine } from "./optimize-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { GameReadiness } from "../types";
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
// (DEFAULT OFF, P-series preview) — flag off, App renders the untouched LabV2 + OptimizeV2 rooms, so
// the app is byte-identical (test-pinned).

export function LabGround(props: LabFastPathProps & {
  readiness: GameReadiness | null;
  activeCount: number;
  diagnostics?: ReactNode;
  diagnosticsCaptured?: boolean;
  hw: HardwareInfo;
}) {
  const {
    recs,
    changes,
    isAppliable,
    readiness,
    activeCount,
    diagnostics,
    diagnosticsCaptured = false,
    vendor = "any",
    hw,
    ...rest
  } = props;
  const reduced = useReducedMotion();
  const hud = useHudFlag();

  // Verdict = the fixes state (the primary surface). Drifted rows are named, never counted as
  // "ready to apply" (the one-mention law) — same pure helper the Optimize room uses.
  const reverted = useMemo(() => deriveReverted(changes), [changes]);
  const verdict = optimizeVerdict(recs, isAppliable, activeCount, reverted);
  const measured = optimizeMeasuredLine(readiness, recs);

  // The whole fast-path bundle threaded to Lab's ground mode (station 1's body).
  const fast: LabFastPathProps = { recs, changes, isAppliable, vendor, ...rest };

  return (
    <RoomShell
      room="lab"
      verdict={(() => {
        const headline =
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
          );
        if (!hud) return headline; // flag off: the exact pre-rollout tree
        return (
          <>
            <HudMasthead
              label="Proving ground"
              led={!verdict.settled ? "scan" : verdict.allClear ? "ok" : "warn"}
            />
            <span className="hud-headline">{headline}</span>
          </>
        );
      })()}
      sub={verdict.sub}
      measured={measured}
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
        readiness={readiness}
      />
    </RoomShell>
  );
}

export default LabGround;
