import { useState, type ReactNode } from "react";
import Lab from "./Lab";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { peekProbe } from "../data/probe-cache";
import { tuningGuideForVendor } from "../data/tuning-guides";
import { labVerdict, labMeasuredLine } from "./lab-v2-data";
import type { BenchmarkState } from "../types";
import type { GpuVendor } from "./walkthroughs";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "./lab-v2.css";

// LabV2 (V2-7, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Lab room on the V2 shell:
// verdict (the last graded benchmark, honest nothing-graded state) → measured line (instrument
// count + the read-only guarantee) → the room's working face. NO forward door — Lab is the last
// chapter (DOOR_MAP: lab → null; the rail is the way home).
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
  // Seeded from the probe cache (same key Lab reads) so a re-visit paints the verdict
  // instantly; live updates arrive through Lab's onBenchState — the SAME read, no second IPC.
  const [bench, setBench] = useState<BenchmarkState | null>(
    () => peekProbe("benchmark-state") ?? null,
  );
  const verdict = labVerdict(bench);
  // The same gates the body uses (vendor for Tuning, the diagnostics slot) — computed, never
  // hardcoded. Benchmark + Black Box + Latency are always present.
  const instruments = 3 + (tuningGuideForVendor(vendor) ? 1 : 0) + (diagnostics ? 1 : 0);

  return (
    <RoomShell
      room="lab"
      verdict={
        reduced ? (
          verdict.headline
        ) : (
          // Verdict-only DecryptedText (the adopt-list law) — the text is the pure helper's
          // real output; the animation never alters what is claimed.
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
      sub={verdict.sub}
      measured={labMeasuredLine(instruments)}
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
