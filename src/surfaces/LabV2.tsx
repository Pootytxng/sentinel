import { useState, type ReactNode } from "react";
import Lab from "./Lab";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { peekProbe } from "../data/probe-cache";
import { labVerdict } from "./lab-v2-data";
import type { BenchmarkState } from "../types";
import type { GpuVendor } from "./walkthroughs";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "./lab-v2.css";

// LabV2 (V2-7, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Lab room on the V2 shell:
// verdict (the last graded benchmark, honest nothing-graded state) → the room's working face.
// NO forward door — Lab is the last chapter (DOOR_MAP: lab → null; the rail is the way home).
// No measured-line header strip (owner header-slop law 2026-07-10) — the read-only guarantee
// lives in the Lab body's own copy; the instrument count is the visible instrument list.
//
// This is the classic Lab composed VERBATIM with the same props and the same audited read-only
// probes (get_benchmark_state / get_latency_diagnostics / session reads — zero new IPC, nothing
// mutated). The v2 prop only trims Lab's standalone head (one-mention law: RoomShell's verdict
// is the ONE summary); classic renders are byte-identical without it (test-pinned). The re-skin
// is the token re-point in lab-v2.css — the same mechanism the five themes and the other v2
// rooms use; classic CSS/DOM untouched.
//
// Deliberately NO primaryAction — like Blackbook (the P6 spec's "may have none" room), Lab's
// work IS its instruments, and hoisting one would demote the rest. The verdict's own sub
// already coaches "start with Benchmark".

export function LabV2({
  diagnostics,
  vendor = "any",
  diagnosticsCaptured = false,
}: {
  diagnostics?: ReactNode;
  vendor?: GpuVendor;
  // Threads to Lab's latest-readings strip (fill pass, spec 2026-07-05): whether the system
  // report behind the diagnostics slot actually has sections — never claim "captured" otherwise.
  diagnosticsCaptured?: boolean;
}) {
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  // Seeded from the probe cache (same key Lab reads) so a re-visit paints the verdict
  // instantly; live updates arrive through Lab's onBenchState — the SAME read, no second IPC.
  const [bench, setBench] = useState<BenchmarkState | null>(
    () => peekProbe("benchmark-state") ?? null,
  );
  const verdict = labVerdict(bench);

  return (
    <RoomShell
      room="lab"
      verdict={(() => {
        if (!hud) {
          // Flag off: the exact pre-rollout tree — the verdict sentence as the h1, with the
          // verdict-only DecryptedText moment (the adopt-list law).
          return reduced ? (
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
        // HUD header = title only (owner title-header law 2026-07-10 round 2). The last graded
        // benchmark lives in its context — the station list's own readings (the same
        // stationReading source). No LED: the instruments below own their own states.
        return (
          <>
            <HudMasthead label="Test bench" />
            <span className="hud-headline">Lab</span>
          </>
        );
      })()}
      sub={hud ? undefined : verdict.sub}
    >
      <Lab
        v2
        diagnostics={diagnostics}
        vendor={vendor}
        onBenchState={setBench}
        diagnosticsCaptured={diagnosticsCaptured}
      />
    </RoomShell>
  );
}

export default LabV2;
