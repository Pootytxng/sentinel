import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { LabConsole } from "./LabConsole";
import { LabDeck } from "./lab/LabDeck";
import ExperimentBench from "./ExperimentBench";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag, useLabDeckFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { deriveReverted } from "./use-scan";
import { optimizeVerdict } from "./optimize-v2-data";
import { useDismissed } from "./dismissed";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { GameReadiness, Priorities } from "../types";
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
  readiness: GameReadiness | null;
  activeCount: number;
  diagnostics?: ReactNode;
  diagnosticsCaptured?: boolean;
  hw: HardwareInfo;
  // The MEASURED limiter ranking, threaded through for the deck candidate's "your next best move"
  // card. Optional: absent → the card cites the catalog instead of claiming a measurement.
  priorities?: Priorities | null;
}) {
  const { t } = useTranslation();
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
    priorities = null,
    ...rest
  } = props;
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  // The decision-journey candidate (product-recovery train, 2026-07-28). DEFAULT OFF — a temporary
  // owner-comparison flag. Off, this room renders exactly today's LabConsole dock + ExperimentBench
  // (pinned by lab-deck-flag.test.tsx); on, the deck replaces both (it hosts the bench in its
  // "Measure & prove" section, so the bench is never mounted twice).
  const deck = useLabDeckFlag();

  // The fixes-state verdict still drives the LED (a real room state) — but under the HUD the
  // HEADER carries a title only (owner title-header law 2026-07-10 round 2: "the header just
  // needs to be a title, not a description or notification statement"). The verdict's facts
  // live in their context: ready counts on the Safe-stack gauge + the station rows, drift in
  // Fix's "Applied — turned off outside Compy" group inside the Optimize panel.
  const reverted = useMemo(() => deriveReverted(changes), [changes]);
  // The ONE session-wide "Not for me" set — the room verdict must not promise work the user
  // already declined (self-review round 9, 2026-07-29).
  const { dismissed } = useDismissed();
  const verdict = optimizeVerdict(recs, isAppliable, dismissed, activeCount, reverted, t);

  // The whole fast-path bundle threaded to Lab's ground mode (station 1's body).
  const fast: LabFastPathProps = { recs, changes, isAppliable, vendor, ...rest };

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
      {deck ? (
        /* THE DECK candidate — the same room ordered by the user's decision journey instead of by
           our module structure (recovery items 13/15). Same audited apply path, zero new IPC. */
        <LabDeck
          fast={fast}
          diagnostics={diagnostics}
          diagnosticsCaptured={diagnosticsCaptured}
          priorities={priorities}
          activeCount={activeCount}
        />
      ) : (
        <>
          {/* THE OPS CONSOLE (spec 2026-07-09, Phase 1, Task 4) — a real 3D hologram center-stage
              with four corner arc gauges + a Dock of stations (Optimize primary, the measure→prove
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
          {/* Intelligence Phase 3 — the controlled-experiment engine + optimization simulator. ARMED
              2026-07-17 (owner-signed): renders the bench when experiment_gate() is true; still
              fails-dark (renders NOTHING) if the gate ever reads false. */}
          <ExperimentBench />
        </>
      )}
    </RoomShell>
  );
}

export default LabGround;
