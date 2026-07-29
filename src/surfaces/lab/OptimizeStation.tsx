import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import Fix from "../Fix";
import Check from "../Check";
import { GamingMode } from "../GamingMode";
import { deriveReverted } from "../use-scan";
import { useDismissed } from "../dismissed";
import { resolveCarried } from "../../data/check-handoff";
import { recDisplayLabel } from "../../data/friendly-labels";
import { useReducedMotion } from "../../design/use-motion";
import { useExpertView } from "../../design/use-expert-view";
import { useCountTo } from "./use-count-to";
import { goalOf, type LabGoal } from "./lab-deck-data";
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
// preload / optimization cleanup (leftovers) / driver freshness) folds under a "More cleanup
// (optional)" disclosure so the hero stays the one-tap safe stack.

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

export function OptimizeStation(
  props: LabFastPathProps & { carriedRecIds?: string[]; goalFilter?: LabGoal | null },
) {
  const { t } = useTranslation();
  // Same drift derivation the Optimize room + verdict use — a drifted rec renders ONCE in Fix's
  // "turned off outside Compy" group, never double-counted as ready (one-mention law).
  const reverted = useMemo(() => deriveReverted(props.changes), [props.changes]);
  // §5 Power-features bay: lazy-mount Gaming Mode only when the user opens the disclosure, so the
  // Lab tab never spins up its session-state poll while the bay sits collapsed (the perf rails).
  const [powerOpen, setPowerOpen] = useState(false);
  const reduced = useReducedMotion();
  // Expert view (spec §3 — stop de-emphasizing the long tail): the station's ledger + cleanup
  // disclosures render OPEN so the full panel sits inline. `open={true}` only re-asserts on pref
  // transitions (React diffs its own vdom), so the user can still fold either one afterward. The
  // Power-features bay deliberately stays collapsed: it's a mode door with a lazy-mount polling
  // cost, not de-emphasized long-tail data.
  const expert = useExpertView();

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
  // Split the not-applied remainder by drift (the one-mention law: Fix's "turned off outside
  // Compy" group OWNS a drifted rec — the caption must not re-frame it as a fresh "enable",
  // which read as contradicting the corner gauge's ready count; owner-sweep catch 2026-07-10).
  const revertedIds = useMemo(() => new Set(reverted.map((r) => r.rec_id)), [reverted]);
  const pendingSafe = safeStack.filter((r) => !r.currently_applied);
  // ...and by dismissal, which OUTRANKS drift exactly as Fix.tsx does (isDismissed is tested
  // before the drift split there, so one rec can never be both "set aside" and "restore this").
  // The gauge's own numbers deliberately do NOT move: applied/total reports the RIG's state, and
  // setting a tweak aside doesn't turn anything on. The CAPTION is the action claim, so the
  // caption is what has to stop counting set-aside work as "left to enable" — before this split
  // the ring said "1 left to enable below" directly above Fix's "Nothing waiting", because
  // nothing here had ever consulted the dismissal set (self-review round 8).
  const { dismissed } = useDismissed();
  const setAsidePending = pendingSafe.filter((r) => dismissed.has(r.id)).length;
  const activePending = pendingSafe.filter((r) => !dismissed.has(r.id));
  const driftedPending = activePending.filter((r) => revertedIds.has(r.id)).length;
  const freshPending = activePending.length - driftedPending;
  // The check handoff (recovery items 3/4): what the user was just told about, resolved against the
  // catalog THIS station can see right now — not a replay of what Check said. A rec applied since,
  // or gone from the catalog entirely, is stated as that; only still-pending ones lead the list.
  const carried = useMemo(
    () => resolveCarried(props.carriedRecIds ?? [], props.recs),
    [props.carriedRecIds, props.recs],
  );
  const carriedOpenIds = useMemo(() => carried.open.map((r) => r.id), [carried.open]);
  // Goal filter (product-recovery Section 2). The deck candidate scopes THIS ONE audited fix list
  // to a user goal rather than rendering a separate list per group — a list per group means
  // repeated headings and N competing "enable all" buttons, which is precisely the overload
  // recovery item 13 names. Absent (every caller before the deck) → the full list, unchanged.
  // The hero gauge above deliberately keeps counting the WHOLE safe stack: it reports the rig's
  // state, not the chip the user happens to have selected.
  const shownRecs = useMemo(
    () =>
      props.goalFilter == null
        ? (props.recs ?? [])
        : (props.recs ?? []).filter((r) => goalOf(r) === props.goalFilter),
    [props.recs, props.goalFilter],
  );
  // Startup apps are cleanup work (they're what Fix renders alongside the cleanup recs). Under
  // "More FPS" they'd be an unrelated pile with no relationship to the filter the user picked.
  const shownStartup =
    props.goalFilter == null || props.goalFilter === "cleanup" ? props.startup : [];
  const gaugeTarget = props.recs == null || totalSafe === 0 ? null : appliedSafe;
  const gaugeValue = useCountTo(gaugeTarget, { reduced });
  const gaugeRatio = totalSafe > 0 && gaugeValue != null ? Math.min(1, Math.max(0, gaugeValue / totalSafe)) : 0;

  // The arrival note. Renders only when a handoff actually carried something AND the catalog has
  // loaded (props.recs null → resolveCarried returns empty, so nothing claims anything mid-load).
  // Every branch states what is true on arrival; none of them promises an outcome.
  const carriedTotal = carried.open.length + carried.done.length + carried.missing.length;
  const carriedBanner =
    carriedTotal === 0 ? null : (
      <div className="lab-carried" role="status">
        {carried.open.length > 0 ? (
          <>
            <p className="lab-carried-head">{t("lab.optimizeStation.carriedHead")}</p>
            <ul className="lab-carried-list">
              {/* ONE NAME PER REC: the same display-label layer the rows below use, so
                  "Compy found these during your check" names each tweak the way the row does. */}
              {carried.open.map((r) => {
                const name = recDisplayLabel(r.id, r.title);
                return (
                  <li key={r.id} className="lab-carried-item">
                    <span className="lab-carried-name">{name.headline}</span>
                    {name.tech && <span className="lab-carried-tech">{name.tech}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="lab-carried-hint">{t("lab.optimizeStation.carriedHint")}</p>
          </>
        ) : (
          <p className="lab-carried-head">
            {carried.done.length > 0
              ? t("lab.optimizeStation.carriedAllDone", { count: carried.done.length })
              : t("lab.optimizeStation.carriedNoneLeft")}
          </p>
        )}
        {/* Footnotes only when they carry news — an empty "0 applied since" line is noise. */}
        {carried.open.length > 0 && carried.done.length > 0 && (
          <p className="lab-carried-note">
            {t("lab.optimizeStation.carriedDone", {
              count: carried.done.length,
              titles: carried.done.map((r) => recDisplayLabel(r.id, r.title).headline).join(", "),
            })}
          </p>
        )}
        {carried.missing.length > 0 && carried.open.length > 0 && (
          <p className="lab-carried-note">
            {t("lab.optimizeStation.carriedMissing", { count: carried.missing.length })}
          </p>
        )}
      </div>
    );

  return (
    <div className="lab-optimize">
      {/* The one measured gauge (honesty-bound): your safe stack, applied vs total. Absent while
          the catalog loads or when this rig has no safe stack — never a fabricated number. */}
      {gaugeValue != null && (
        <div className="lab-gauge-row">
          <div
            className="lab-gauge"
            role="img"
            aria-label={t("lab.optimizeStation.gaugeAriaLabel", { applied: appliedSafe, total: totalSafe })}
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
              {/* Inner wrapper: the outer box centers the readout in the ring (a single-line
                  baseline flex anchors to the TOP of the 76px box — the readout painted over the
                  ring's top stroke, owner-caught 2026-07-10); baseline alignment between the big
                  number and its /total lives here. */}
              <span className="lab-gauge-txt">
                <span className="lab-gauge-num">{Math.round(gaugeValue)}</span>
                <span className="lab-gauge-den">/{totalSafe}</span>
              </span>
            </span>
          </div>
          <p className="lab-gauge-caption">
            <span className="lab-gauge-caption-k">{t("lab.optimizeStation.yourSafeStack")}</span>
            {/* State observation, never an action claim (consumer-panel Phase 0/1): currently_applied
                is a live system probe — a setting can be on because Windows shipped that way or the
                user set it themselves, not because Compy applied anything. "Fully applied" read as
                unconsented action to first-contact readers. */}
            {appliedSafe >= totalSafe
              ? t("lab.optimizeStation.allApplied", { total: totalSafe })
              : activePending.length === 0
                ? /* Everything still off is off BY CHOICE. Saying "all applied" here would be a
                     lie about the rig; saying "N left to enable" would be a lie about the list. */
                  t("lab.optimizeStation.nothingLeftSetAside", { count: setAsidePending })
                : driftedPending === 0
                  ? t("lab.optimizeStation.freshLeft", { count: freshPending })
                  : freshPending === 0
                    ? t("lab.optimizeStation.driftedRestore", { count: driftedPending })
                    : t("lab.optimizeStation.mixedLeft", {
                        totalLeft: freshPending + driftedPending,
                        fresh: freshPending,
                        drifted: driftedPending,
                      })}
            {/* Reconciles the arithmetic when work remains AND something is set aside: without it
                the ring's 8/9 minus "1 left to enable" leaves a rec the user can't account for. */}
            {activePending.length > 0 && setAsidePending > 0 &&
              t("lab.optimizeStation.setAsideNote", { count: setAsidePending })}
          </p>
        </div>
      )}
      {/* The hero: the vetted safe stack + the one-action "Apply reviewed" enable-all. This IS the
          audited Fix fixes surface — same components, same apply/rollback path — re-homed into the
          station. Under the room's HUD skin (default on) it already wears the instrument language,
          so there's no visual seam with stations 2–6. */}
      {/* Arrival context (recovery item 4): you came here from a check, so say what it found and
          lead with those rows. Every line below is the state Compy can see AT ARRIVAL — a tweak
          applied in between reads as applied, one that left the catalog reads as no longer
          relevant. Nothing here applies, dismisses, or changes anything. */}
      {carriedBanner}
      <Fix
        recs={shownRecs}
        startup={shownStartup}
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
        carried={carriedOpenIds}
      />

      {/* The record half of the room (owner decision 2026-07-10: with the standalone Optimize tab
          dropped, "undo stays reachable via the Lab panel" — this IS that path). The same audited
          ledger surface the classic room's "Applied" segment rendered (Fix view="ledger": active
          changes with per-row undo + the full history), one disclosure below the toggles it
          records. Zero new IPC; rollback resolves from history.json alone, same as everywhere. */}
      <details className="lab-optimize-more lab-optimize-ledger" open={expert || undefined}>
        <summary className="lab-optimize-more-summary">{t("lab.optimizeStation.appliedHistorySummary")}</summary>
        <div className="lab-optimize-more-body">
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
            view="ledger"
          />
        </div>
      </details>

      {/* Secondary to the enable-all (Directive 2: most users apply the safe stack and never look
          back). The broader system-hygiene scan — startup load, telemetry tasks, preinstalled
          apps, Optimization Cleanup (the leftovers audit), driver freshness — lives one disclosure
          away so it never crowds the hero. Same audited apply path inside; read-only where it
          advises. (The ARMED telemetry-task disable — the "bloat" of §5 — already lives in the
          fixes surface above.) */}
      <details className="lab-optimize-more" open={expert || undefined}>
        <summary className="lab-optimize-more-summary">{t("lab.optimizeStation.moreCleanupSummary")}</summary>
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
          <summary className="lab-optimize-more-summary">{t("lab.optimizeStation.powerFeaturesSummary")}</summary>
          <div className="lab-optimize-more-body">
            <p className="lab-optimize-power-intro">
              {t("lab.optimizeStation.powerFeaturesIntro")}
            </p>
            {powerOpen && <GamingMode />}
          </div>
        </details>
      )}
    </div>
  );
}

export default OptimizeStation;
