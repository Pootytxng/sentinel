import { useMemo, useState } from "react";
import Fix from "../Fix";
import Check from "../Check";
import { GamingMode } from "../GamingMode";
import { deriveReverted } from "../use-scan";
import { useReducedMotion } from "../../design/use-motion";
import { useCountTo } from "./use-count-to";
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
  // §5 armed-feature bay (spec 2026-07-08 §5, owner nod "all three"): whether Gaming Mode is armed
  // (gaming_mode_gate LIVE). When true, station 1 offers the "Power features" bay — Gaming Mode +
  // service-suspend as read-first, apply-behind-confirm, reversible changes you can prove right in
  // the Lab. Optional so non-App callers (tests) pass nothing; the bay just doesn't render.
  gamingEnabled?: boolean;
};

// The hero gauge ring geometry (a static SVG circle swept by stroke-dashoffset).
const GAUGE_R = 32;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

export function OptimizeStation(props: LabFastPathProps) {
  // Same drift derivation the Optimize room + verdict use — a drifted rec renders ONCE in Fix's
  // "turned off outside Compy" group, never double-counted as ready (one-mention law).
  const reverted = useMemo(() => deriveReverted(props.changes), [props.changes]);
  // §5 Power-features bay: lazy-mount Gaming Mode only when the user opens the disclosure, so the
  // Lab tab never spins up its session-state poll while the bay sits collapsed (the perf rails).
  const [powerOpen, setPowerOpen] = useState(false);
  const reduced = useReducedMotion();

  // Data-reactive hero gauge (Task 4) — bound to a REAL measured number: how much of THIS rig's
  // safe, one-click stack is already applied. The stack = safe-tier, eligible, appliable recs; the
  // gauge fills to applied / total. HONESTY RAIL: the gauge renders ONLY when that measured source
  // exists — recs still loading (null) or no safe stack for this rig → target null → nothing
  // animates (no placeholder zero). Every animated value traces to the catalog eval, not a guess.
  const safeStack = useMemo(
    () =>
      (props.recs ?? []).filter(
        (r) => r.severity === "safe" && r.eligible !== false && props.isAppliable(r.id),
      ),
    [props.recs, props.isAppliable],
  );
  const totalSafe = safeStack.length;
  const appliedSafe = safeStack.filter((r) => r.currently_applied).length;
  const gaugeTarget = props.recs == null || totalSafe === 0 ? null : appliedSafe;
  const gaugeValue = useCountTo(gaugeTarget, { reduced });
  const gaugeRatio = totalSafe > 0 && gaugeValue != null ? Math.min(1, Math.max(0, gaugeValue / totalSafe)) : 0;

  return (
    <div className="lab-optimize">
      {/* The one measured gauge (honesty-bound): your safe stack, applied vs total. Absent while
          the catalog loads or when this rig has no safe stack — never a fabricated number. */}
      {gaugeValue != null && (
        <div className="lab-gauge-row">
          <div
            className="lab-gauge"
            role="img"
            aria-label={`${appliedSafe} of ${totalSafe} safe tweaks applied`}
          >
            <svg className="lab-gauge-ring" viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
              <circle className="lab-gauge-track" cx="38" cy="38" r={GAUGE_R} />
              <circle
                className="lab-gauge-fill"
                cx="38"
                cy="38"
                r={GAUGE_R}
                style={{
                  strokeDasharray: GAUGE_C,
                  strokeDashoffset: GAUGE_C * (1 - gaugeRatio),
                }}
              />
            </svg>
            <span className="lab-gauge-center" aria-hidden="true">
              <span className="lab-gauge-num">{Math.round(gaugeValue)}</span>
              <span className="lab-gauge-den">/{totalSafe}</span>
            </span>
          </div>
          <p className="lab-gauge-caption">
            <span className="lab-gauge-caption-k">Your safe stack</span>
            {appliedSafe >= totalSafe
              ? "Fully applied — your rig is set."
              : `${totalSafe - appliedSafe} left to enable below — one tap each, reversible.`}
          </p>
        </div>
      )}
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
          hero. Same audited apply path inside; read-only where it advises. (The ARMED telemetry-task
          disable — the "bloat" of §5 — already lives in the fixes surface above.) */}
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

      {/* §5 Power features (spec 2026-07-08 §5, owner nod) — the bigger reversible changes you can
          make AND prove in the proving ground: Gaming Mode (foreground boost) + service-suspend,
          the same audited controls from Play, gathered here so you can measure them at the Benchmark
          station. Read-first, apply-behind-confirm (Gaming Mode owns its own confirm/undo flow),
          fully reversible. Only shown when Gaming Mode is armed; Gaming Mode mounts lazily on open so
          the collapsed bay never polls. */}
      {props.gamingEnabled && (
        <details
          className="lab-optimize-more lab-optimize-power"
          onToggle={(e) => setPowerOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="lab-optimize-more-summary">Power features — Gaming Mode (advanced, reversible)</summary>
          <div className="lab-optimize-more-body">
            <p className="lab-optimize-power-intro">
              Bigger changes you can make and prove here. These are the same reversible controls from
              Play — apply one, then run the Benchmark station to measure what it did on your rig.
            </p>
            {powerOpen && <GamingMode />}
          </div>
        </details>
      )}
    </div>
  );
}

export default OptimizeStation;
