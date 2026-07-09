import { useMemo, useState, type ReactNode } from "react";
import Lab from "./Lab";
import Check from "./Check";
import Fix from "./Fix";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { peekProbe } from "../data/probe-cache";
import { deriveReverted } from "./use-scan";
import { optimizeVerdict, optimizeMeasuredLine } from "./optimize-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import type {
  BenchmarkState,
  Recommendation,
  StartupEntry,
  AppliedChange,
  SessionSummary,
  GameReadiness,
} from "../types";
import type { GpuVendor } from "./walkthroughs";
import "./lab-v2.css";
import "./LabGround.css";

// LabGround — the Lab as a PROVING GROUND (spec 2026-07-08-lab-proving-ground, ★ PRIMARY
// BLUEPRINT, phase 1). The Optimize room MERGES into the Lab so both paths live in ONE slim room
// (owner Directive 2: "organized, slim, easy-to-navigate, one room"). Rendered by App for the Lab
// tab ONLY when `compy_lab_ground` is on (DEFAULT OFF, P-series preview) — flag off, App renders
// the untouched LabV2 + OptimizeV2 rooms, so the app is byte-identical (test-pinned).
//
// Two paths, one room (Directive 2):
//   • FAST PATH (the primary surface most users came for): the vetted safe tweaks + the existing
//     "Apply all safe fixes" one-action enable-all — NO benchmarking required. This is Check + Fix
//     (the Optimize "Fixes" segment) composed VERBATIM: the same audited apply/batch path, the
//     same rollback-first per-row undo, ZERO new IPC, zero new mutation primitive.
//   • UTILITY PATH (optional, beside it): the measure→test→prove instruments as ONE linear spine
//     (Lab's `ground` mode — the intake router as front door + the numbered station progression),
//     collapsing the three old nav idioms (bento/guided/classic) into one. Power users prove the
//     stack; casual users scroll right past it. Discoverable precisely because it's in the same
//     room as the tweaks.
//
// The verdict leads with the fixes state (optimizeVerdict) — the stuff they came for — not the
// bench, faithful to Directive 2's re-weighting. No forward door (DOOR_MAP.lab → null): Lab is
// still the terminal room; the circular gallery/completion pathing arrives in phase 3.

export function LabGround({
  // ── Fast-path half (identical to the OptimizeV2 fixes wiring) ──
  isAppliable,
  onOpenLibrary,
  onChanged,
  vendor = "any",
  sessions = [],
  gpus = [],
  recs,
  startup,
  changes,
  busyId,
  activeChangeFor,
  onToggleRec,
  onToggleStartup,
  onRollback,
  onApplyBatch,
  readiness,
  activeCount,
  // ── Utility (Lab) half ──
  diagnostics,
  diagnosticsCaptured = false,
}: {
  isAppliable: (recId: string) => boolean;
  onOpenLibrary: (focusId?: string) => void;
  onChanged: () => void;
  vendor?: GpuVendor;
  sessions?: SessionSummary[];
  gpus?: { name: string; driver_age_days: number | null }[];
  recs: Recommendation[] | null;
  startup: StartupEntry[];
  changes: AppliedChange[];
  busyId: string | null;
  activeChangeFor: (recId: string) => AppliedChange | undefined;
  onToggleRec: (recId: string) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  onRollback: (c: AppliedChange) => void;
  onApplyBatch: (
    recIds: string[],
  ) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
  readiness: GameReadiness | null;
  activeCount: number;
  diagnostics?: ReactNode;
  diagnosticsCaptured?: boolean;
}) {
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  // Bench state feeds nothing in the RoomShell verdict here (the verdict is fixes-first), but Lab
  // still emits it through onBenchState — kept so the utility spine paints its bench line instantly
  // from the same cached read (zero new IPC), exactly as LabV2 does.
  const [, setBench] = useState<BenchmarkState | null>(() => peekProbe("benchmark-state") ?? null);

  // Verdict = the fixes state (the primary surface). Drifted rows are named, never counted as
  // "ready to apply" (the one-mention law) — same pure helper the Optimize room uses.
  const reverted = useMemo(() => deriveReverted(changes), [changes]);
  const verdict = optimizeVerdict(recs, isAppliable, activeCount, reverted);
  const measured = optimizeMeasuredLine(readiness, recs);

  const fixProps = {
    recs: recs ?? [],
    startup,
    changes,
    busyId,
    isAppliable,
    activeChangeFor,
    onToggleRec,
    onToggleStartup,
    onRollback,
    onApplyBatch,
    onOpenLibrary,
    vendor,
  };

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
      {/* ── FAST PATH — the tweaks + one-action enable-all (no benchmark required) ── */}
      <section className="lg-fast" aria-label="Enable the good tweaks">
        <Check
          isAppliable={isAppliable}
          onOpenLibrary={onOpenLibrary}
          onChanged={onChanged}
          vendor={vendor}
          sessions={sessions}
          gpus={gpus}
          embedded
          v2Ia
        />
        <Fix {...fixProps} view="fixes" v2Ia reverted={reverted} />
      </section>

      {/* ── UTILITY PATH — prove it yourself (optional), the measure→prove instruments ── */}
      <section className="lg-utility" aria-label="Measure and prove it yourself">
        <div className="lg-utility-intro">
          <span className="lg-utility-kicker">Optional · prove it yourself</span>
          <p className="lg-utility-lead">
            The tweaks above are the safe stack — enable them and you're done. If you want to see
            the difference on <em>your</em> rig, the instruments below measure it: pick what
            you're here to do, run a real before/after, keep only what actually moved.
          </p>
        </div>
        <Lab
          v2
          ground
          diagnostics={diagnostics}
          vendor={vendor}
          onBenchState={setBench}
          diagnosticsCaptured={diagnosticsCaptured}
        />
      </section>
    </RoomShell>
  );
}

export default LabGround;
