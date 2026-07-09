import { useMemo } from "react";
import Fix from "../Fix";
import Check from "../Check";
import { deriveReverted } from "../use-scan";
import type {
  Recommendation,
  StartupEntry,
  AppliedChange,
  SessionSummary,
} from "../../types";
import type { GpuVendor } from "../walkthroughs";
import "./OptimizeStation.css";

// OptimizeStation — the body of the Lab's station 1 "Optimize" (spec 2026-07-08 §8, the blended
// spine). This is the FAST PATH the owner's Directive 2 puts first: enable the safe, vetted stack
// in one tap, no benchmarking required. It reuses the AUDITED rollback-first apply path verbatim
// (Fix's `view="fixes"` surface — same onApplyBatch → apply_recommendations_batch one-UAC batch,
// the same per-row onToggleRec/onRollback undo, ZERO new mutation primitive, zero new IPC). Its job
// is presentation: render that apply surface INSIDE a Lab station so it reads as a native member of
// the numbered spine (stations 2–6), NOT the old bolted-on Optimize panel that made the seam the
// owner rejected. The enable-all hero leads; Check's broader system-hygiene scan (startup / bloat /
// preload / leftovers / driver freshness) folds under a "More cleanup (optional)" disclosure so the
// hero stays the one-tap safe stack.

// The fast-path prop bundle — everything the OptimizeV2 room already receives (App threads the
// identical handlers), passed straight through to the audited apply surface. Exported so Lab can
// accept it as ONE optional prop group used only in `ground` mode.
export type LabFastPathProps = {
  recs: Recommendation[] | null;
  startup: StartupEntry[];
  changes: AppliedChange[];
  busyId: string | null;
  isAppliable: (recId: string) => boolean;
  activeChangeFor: (recId: string) => AppliedChange | undefined;
  onToggleRec: (recId: string) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  onRollback: (c: AppliedChange) => void;
  onApplyBatch: (
    recIds: string[],
  ) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
  onOpenLibrary: (focusId?: string) => void;
  onChanged: () => void;
  sessions: SessionSummary[];
  gpus: { name: string; driver_age_days: number | null }[];
  vendor: GpuVendor;
};

export function OptimizeStation(props: LabFastPathProps) {
  // Same drift derivation the Optimize room + verdict use — a drifted rec renders ONCE in Fix's
  // "turned off outside Compy" group, never double-counted as ready (one-mention law).
  const reverted = useMemo(() => deriveReverted(props.changes), [props.changes]);

  return (
    <div className="lab-optimize">
      {/* The hero: the vetted safe stack + the one-action "Apply reviewed" enable-all. This IS the
          audited Fix fixes surface — same components, same apply/rollback path — re-homed into the
          station. Under the room's HUD skin (default on) it already wears the instrument language,
          so there's no visual seam with stations 2–6. */}
      <Fix
        recs={props.recs ?? []}
        startup={props.startup}
        changes={props.changes}
        busyId={props.busyId}
        isAppliable={props.isAppliable}
        activeChangeFor={props.activeChangeFor}
        onToggleRec={props.onToggleRec}
        onToggleStartup={props.onToggleStartup}
        onRollback={props.onRollback}
        onApplyBatch={props.onApplyBatch}
        onOpenLibrary={props.onOpenLibrary}
        vendor={props.vendor}
        view="fixes"
        v2Ia
        reverted={reverted}
      />

      {/* Secondary to the enable-all (Directive 2: most users apply the safe stack and never look
          back). The broader system-hygiene scan — startup load, telemetry tasks, preinstalled
          apps, past tweaks, driver freshness — lives one disclosure away so it never crowds the
          hero. Same audited apply path inside; read-only where it advises. */}
      <details className="lab-optimize-more">
        <summary className="lab-optimize-more-summary">More cleanup (optional)</summary>
        <div className="lab-optimize-more-body">
          <Check
            embedded
            v2Ia
            isAppliable={props.isAppliable}
            onOpenLibrary={props.onOpenLibrary}
            onChanged={props.onChanged}
            vendor={props.vendor}
            sessions={props.sessions}
            gpus={props.gpus}
          />
        </div>
      </details>
    </div>
  );
}

export default OptimizeStation;
