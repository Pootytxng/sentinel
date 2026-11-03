import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeLedger } from "../../data/ledger-write";
import { useTranslation } from "react-i18next";
import { IconCpuOff, IconShieldCheck, IconWifiOff } from "@tabler/icons-react";
import type { HardwareInfo } from "../../App";
import type { PriorityItem } from "../../types";
import { Wordmark } from "../../design/Wordmark";
import { NavGlyph } from "../../design/NavGlyph";
import { HOME_RAIL, type HomeRailId } from "../../design/homeRail";
import { readSetupStepper } from "../../design/theme";
import { StepIndicator, StepConnector } from "../../design/vendor/Stepper/Stepper";
import { TrustSwitch } from "../../design/TrustSwitch";
import { useConfirm } from "../../design/ConfirmDialog";
import { useReducedMotion } from "../../design/use-motion";
import { useScan, type ScanRecLite } from "../use-scan";
import { buildRigParts } from "../rig/rig-parts";
import { buildSetupSteps, type SetupStep } from "./setup-steps";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../../i18n";
import "./SetupTour.css";

// The combined "Compy Setup & Tour" — a re-runnable, contained HoloLens console. A centered card with
// a bordered 3D STAGE (the user's real hardware) beside a calm content panel; chrome anchored top
// (wordmark · leg · skip) and bottom (progress · back/next). Leg 1 reuses the first-experience
// content; Leg 2 tours each component (role · metric · the real tweaks · the tab that manages them)
// and ends with a six-tab recap. Read-only except the first-check's audited one-click apply. Honors
// reduced-motion.

export const SETUP_TOUR_KEY = "compy_setup_tour_v1";

// The pre-tour first-run modal (`Onboarding`) was retired by C-05 and DELETED by C-18b; these two
// exports were the only live things left in it, and neither was ever about the modal. `ONBOARDED_KEY`
// is still WRITTEN on finish so the "have they seen it" signal survives an upgrade from the old
// build — nothing reads it back (`src/first-run-front-door-guard.test.ts` fails the build if App does).
export const ONBOARDED_KEY = "compy_onboarded_v1";

/** One detected-hardware line for the rig step, built by App from the cached startup snapshot. */
export type RigLine = { label: string; value: string };

const TAB_ICON: Record<HomeRailId, string> = Object.fromEntries(
  HOME_RAIL.map((r) => [r.id, r.icon]),
) as Record<HomeRailId, string>;

// Lazy so the three.js hardware scene only loads when the tour opens.
const HardwareTourScene = lazy(() =>
  import("./HardwareTourScene").then((m) => ({ default: m.HardwareTourScene })),
);

export function SetupTour({ hw, rig, onDone }: { hw: HardwareInfo; rig: RigLine[]; onDone: () => void }) {
  const { t } = useTranslation();
  // The tour follows the rail the user actually has (P6 §4 alignment). The `compy_optimize` and
  // `compy_lab_ground` flags were retired in the 2026-08-06 generation prune — the four-room
  // proving-ground rail is the only rail, so both arguments are literal `true` now.
  // The lessons, recap and tab blurbs resolve through i18n with their English as the fallback, so
  // zh-CN reads whole (CR-zh-gpu, 2026-11-03).
  const steps = useMemo(
    () =>
      // `t` reaches the rig parts too, so a placeholder part name (no PSU detected → "Power Supply")
      // reads 电源 in zh-CN like the detected ones (desk review 2026-11-03).
      buildSetupSteps(buildRigParts(hw, t), true, true, (key, fallback, vars) =>
        t(key, { defaultValue: fallback, ...(vars ?? {}) }),
      ),
    [hw, t],
  );
  // The room that holds the ledger, named by its rail label as the rail renders it today: the
  // `lab` entry reads "Test" (`common.rail.lab`, localized), not the retired "Lab" (desk review
  // 2026-11-03: stale since the rail was relabeled) — so the seatbelt step never names a tab the
  // rail doesn't show.
  const fixLabel = t("common.rail.lab");
  const [i, setI] = useState(0);
  const step = steps[i];
  const reduced = useReducedMotion();
  // Stepper progress preview (compy_setup_stepper, DEFAULT ON): the footer's progress row as
  // numbered React Bits step indicators instead of the anonymous ticks. Presentation only.
  const [stepper, setStepper] = useState(readSetupStepper);
  useEffect(() => {
    const onChange = () => setStepper(readSetupStepper());
    window.addEventListener("compy:setup-stepper-changed", onChange);
    return () => window.removeEventListener("compy:setup-stepper-changed", onChange);
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(SETUP_TOUR_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onDone();
  }, [onDone]);

  const next = useCallback(() => {
    setI((n) => {
      if (n >= steps.length - 1) {
        finish();
        return n;
      }
      return n + 1;
    });
  }, [steps.length, finish]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Initial focus lands ONCE on mount on a real control (the primary Next button), not the
  // non-interactive backdrop — so screen-reader/keyboard users start on something operable. Kept
  // in its OWN mount-only effect: folding it into the keydown effect below re-stole focus back to
  // Next on every re-render where finish/next/back changed identity (finish chains off the onDone
  // prop), yanking the caret out from under a user who had tabbed elsewhere. Falls back to root.
  useEffect(() => {
    (nextRef.current ?? rootRef.current)?.focus();
  }, []);

  // Keydown wiring re-subscribes when the callbacks change identity (harmless — always uses the
  // latest finish/next/back), but it must NEVER move focus; that's the mount effect's sole job.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open confirm (the apply / turn-it-on prompt) owns the keyboard: arrows changed the step
      // under it and Esc closed the whole tour along with it (codebase review 2026-11-03).
      if (document.querySelector('[role="alertdialog"][aria-modal="true"]')) return;
      const root = rootRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        back();
      } else if (e.key === "Tab" && root) {
        const f = root.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, next, back]);

  const focusId = step.kind === "lesson" ? (step.focusId ?? null) : null;
  const isLast = i === steps.length - 1;
  // C-05 — ONE FLOW, ONE NAME. The header used to read "GUIDED SETUP" on step 1 and "HARDWARE
  // TOUR" on step 5 (docs/decisions/2026-08-11-design-navigation-audit.md §4: "The flow is also
  // called two different things"), so the app introduced itself under two names inside a single
  // ten-step run. The leg is still in the step model (buildSetupSteps orders by it); what is gone
  // is rendering it as a NAME. Progress is the step counter's job — it is already in the footer,
  // and it never has to lie about what the flow is called.
  // Pinned by src/first-run-front-door-guard.test.ts (one-name case).
  const flowName = t("home.setupTour.flowName");

  return (
    <div
      className="st-backdrop"
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("home.setupTour.dialogAria")}
    >
      <div className="st-console">
        <header className="st-head">
          <span className="st-brand">
            <Wordmark size={19} />
          </span>
          <span className="st-leg">{flowName}</span>
          <button className="st-skip" onClick={finish} aria-label={t("home.setupTour.skipAria")}>
            {t("home.setupTour.skip")}
          </button>
        </header>

        <div className="st-body">
          {/* Contained 3D stage — the user's real hardware (camera centred, generous margin).
              Decorative: the text panel carries the meaning, so hide the canvas from the a11y tree. */}
          <div className="st-stage" aria-hidden="true">
            <Suspense fallback={<div className="st-loading">{t("home.setupTour.stageLoading")}</div>}>
              <HardwareTourScene hw={hw} focusId={focusId} reduced={reduced} />
            </Suspense>
          </div>

          {/* Calm content panel — never overlaps the stage. */}
          <div className="st-panel">
            {step.kind === "rig" && <StepRig rig={rig} />}
            {step.kind === "seatbelt" && <StepSeatbelt fixLabel={fixLabel} />}
            {step.kind === "rules" && <StepRules />}
            {step.kind === "check" && <StepCheck />}
            {step.kind === "lesson" && <StepLesson step={step} />}
            {step.kind === "tabmap" && <StepTabMap step={step} />}
          </div>
        </div>

        <footer className="st-footer">
          {stepper ? (
            // Numbered indicators + animated connectors (vendored Stepper primitives). Click hops
            // straight to a step — the same free navigation the arrow keys already allow. Pointer
            // affordance only (aria-hidden like the ticks): keyboard/AT users have Back/Next.
            <div className="st-progress st-progress-stepper" aria-hidden="true">
              {steps.map((s, idx) => (
                <Fragment key={s.id}>
                  <StepIndicator
                    step={idx + 1}
                    currentStep={i + 1}
                    reduced={reduced}
                    onClickStep={(n) => setI(n - 1)}
                  />
                  {idx < steps.length - 1 && <StepConnector isComplete={i > idx} reduced={reduced} />}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="st-progress" aria-hidden="true">
              {steps.map((s, idx) => (
                <span
                  key={s.id}
                  className={`st-tick ${idx === i ? "st-tick-on" : ""} ${idx < i ? "st-tick-done" : ""}`}
                />
              ))}
            </div>
          )}
          <div className="st-nav">
            <button className="btn-small" onClick={back} disabled={i === 0}>
              {t("home.setupTour.footer.back")}
            </button>
            <span
              className="st-count"
              role="status"
              aria-live="polite"
              aria-label={t("home.setupTour.footer.stepAria", { current: i + 1, total: steps.length })}
            >
              {t("home.setupTour.footer.stepCount", { current: i + 1, total: steps.length })}
            </span>
            <button className="btn" ref={nextRef} onClick={next}>
              {isLast ? t("home.setupTour.footer.finish") : t("home.setupTour.footer.next")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Leg 1 steps ──────────────────────────────────────────────────────────────

function StepRig({ rig }: { rig: RigLine[] }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="st-tag">{t("home.setupTour.rig.tag")}</div>
      <h2 className="st-title">{t("home.setupTour.rig.title")}</h2>
      <div className="st-detect">
        {rig.length === 0
          ? [0, 1, 2, 3].map((n) => <div key={n} className="st-detect-row st-shimmer" />)
          : rig.map((line) => (
              <div key={line.label} className="st-detect-row">
                <span className="st-detect-check">✓</span>
                <span className="st-detect-label">{line.label}</span>
                <span className="st-detect-value">{line.value}</span>
              </div>
            ))}
      </div>
      <p className="st-body-text">
        {t("home.setupTour.rig.bodyPre")} <strong>{t("home.setupTour.rig.bodyEmph")}</strong>{" "}
        {t("home.setupTour.rig.bodyPost")}
      </p>
    </>
  );
}

function StepSeatbelt({ fixLabel }: { fixLabel: string }) {
  const { t } = useTranslation();
  const [applied, setApplied] = useState(false);
  return (
    <>
      <div className="st-tag">{t("home.setupTour.seatbelt.tag")}</div>
      <h2 className="st-title">{t("home.setupTour.seatbelt.title")}</h2>
      <div className="st-demo">
        <div className="st-demo-row">
          <div>
            <div className="st-demo-name">{t("home.setupTour.seatbelt.demoName")}</div>
            <div className="st-demo-sub">{t("home.setupTour.seatbelt.demoSub")}</div>
          </div>
          <TrustSwitch
            applied={applied}
            busy={false}
            onToggle={() => setApplied((a) => !a)}
            ariaLabel={
              applied
                ? t("home.setupTour.seatbelt.undoAria")
                : t("home.setupTour.seatbelt.applyAria")
            }
          />
        </div>
        {applied && <div className="st-demo-ledger">{t("home.setupTour.seatbelt.ledger")}</div>}
      </div>
      <p className="st-body-text">
        {t("home.setupTour.seatbelt.bodyPre")} <strong>{fixLabel}</strong>{" "}
        {t("home.setupTour.seatbelt.bodyPost")}
      </p>
    </>
  );
}

function StepRules() {
  const { t } = useTranslation();
  const rules = [
    { Icon: IconCpuOff, text: t("home.setupTour.rules.noKernelDriver") },
    { Icon: IconShieldCheck, text: t("home.setupTour.rules.noInjection") },
    { Icon: IconWifiOff, text: t("home.setupTour.rules.wifiOff") },
  ];
  return (
    <>
      <div className="st-tag">{t("home.setupTour.rules.tag")}</div>
      <h2 className="st-title">{t("home.setupTour.rules.title")}</h2>
      <div className="st-rules">
        {rules.map((r) => (
          <div key={r.text} className="st-rule">
            <r.Icon className="st-rule-icon" size={18} stroke={1.75} />
            <span>{r.text}</span>
          </div>
        ))}
      </div>
      <p className="st-body-text st-kicker">
        {t("home.setupTour.rules.kickerPre")} <strong>{t("home.setupTour.rules.kickerEmph")}</strong>
      </p>
    </>
  );
}

function StepCheck() {
  const { t } = useTranslation();
  const { readiness, priorities, recs, reverted, running, failed, elapsed, phase, rerun } = useScan();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const recFor = (lim: PriorityItem | null): ScanRecLite | null => {
    if (!lim) return null;
    const id = lim.linked ?? lim.id;
    const rec = recs.find((r) => r.id === id);
    return rec && !rec.currently_applied ? rec : null;
  };

  const applyLimiter = async (lim: PriorityItem) => {
    const rec = recFor(lim);
    if (!rec) return;
    const ok = await confirm({
      title: t("home.setupTour.check.applyConfirmTitle", { title: rec.title }),
      body: t("home.setupTour.check.confirmBody"),
      confirmLabel: t("home.setupTour.check.applyLabel"),
    });
    if (!ok) return;
    setApplyingId(rec.id);
    try {
      await writeLedger("apply_recommendation", { recId: rec.id, recTitle: rec.title });
      await rerun();
    } catch (e) {
      setApplyingId(null);
      // Tell the user it didn't apply (e.g. a declined UAC prompt) instead of silently swallowing it
      // — mirrors FirstCheck's acknowledge-only NOTICE so the tour never lies about a no-op.
      await confirm({
        title: t("home.setupTour.check.applyFailedTitle"),
        body: String(e),
        confirmLabel: t("home.setupTour.check.ok"),
        acknowledge: true,
      });
    } finally {
      setApplyingId(null);
    }
  };

  // Turn a specific drifted-off change back on, right here (no "go to another tab"). Re-applies the
  // exact rec the ledger says drifted; the apply path snapshots prior state so it stays reversible.
  const applyReverted = async (rev: { rec_id: string; title: string }) => {
    const ok = await confirm({
      title: t("home.setupTour.check.turnOnConfirmTitle", { title: rev.title }),
      body: t("home.setupTour.check.confirmBody"),
      confirmLabel: t("home.setupTour.check.turnOn"),
    });
    if (!ok) return;
    setApplyingId(rev.rec_id);
    try {
      await writeLedger("apply_recommendation", { recId: rev.rec_id, recTitle: rev.title });
      await rerun();
    } catch (e) {
      setApplyingId(null);
      // Surface the failure (e.g. declined UAC) rather than silently swallowing it — same NOTICE as above.
      await confirm({
        title: t("home.setupTour.check.turnOnFailedTitle"),
        body: String(e),
        confirmLabel: t("home.setupTour.check.ok"),
        acknowledge: true,
      });
    } finally {
      setApplyingId(null);
    }
  };

  const limiters = priorities?.limiters ?? [];
  const fixCount = limiters.length;
  const top = limiters[0] ?? null;
  // "Came back right" counts only checks that were READ and right: an unread check is never a pass,
  // and an advisory attention check is not one either (codebase review 2026-11-03).
  const readyCount = readiness?.ready_count ?? 0;
  const unreadCount = readiness?.unknown_count ?? 0;
  const advisoryCount = readiness?.advisory_count ?? 0;
  // The "applied-changes" limiter is the vague-flag anti-pattern: name the actual drifted setting(s)
  // and carry the fix inline, instead of "1 setting(s) — go to Optimize/Ledger".
  const driftTop = top?.id === "applied-changes" && reverted.length > 0;
  const gameModeDrifted = reverted.some((r) => r.rec_id === "game-mode");

  if (running || phase !== "verdict") {
    return (
      <>
        <div className="st-tag">{t("home.setupTour.check.tag")}</div>
        <h2 className="st-title">{t("home.setupTour.check.readingTitle")}</h2>
        <div className="st-scanning">
          <span className="st-scan-pulse" />
          <span>
            {t("home.setupTour.check.runningChecks")}
            {elapsed
              ? t("home.setupTour.check.elapsedSuffix", { elapsed: elapsed.toFixed(1) })
              : t("home.setupTour.check.elapsedPending")}
          </span>
        </div>
        <p className="st-body-text">{t("home.setupTour.check.noGuessing")}</p>
      </>
    );
  }

  // The scan rejected and nothing was ever read: say so and let the tour go on (the footer's Next is
  // always there). A clean headline here would claim a measurement nobody made (CR-tour-reject).
  if (failed && !readiness) {
    return (
      <>
        <div className="st-tag">{t("home.setupTour.check.tag")}</div>
        <h2 className="st-title">{t("home.setupTour.check.readFailedTitle")}</h2>
        <p className="st-body-text">{t("home.setupTour.check.readFailedBody")}</p>
        <div className="st-spotlight-foot">
          <button className="btn-small btn-small-on" onClick={() => rerun()}>
            {t("home.setupTour.check.tryAgain")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="st-tag">{t("home.setupTour.check.tag")}</div>
      <h2 className="st-title">
        {fixCount > 0
          ? t("home.setupTour.check.readyFixing", { count: fixCount })
          : unreadCount > 0
            ? t("home.setupTour.check.readyCleanPartial")
            : t("home.setupTour.check.readyClean")}
      </h2>
      {driftTop ? (
        <div className="st-spotlight">
          <div className="st-spotlight-tag">{t("home.setupTour.check.spotlightTag")}</div>
          <div className="st-spotlight-title">
            {t("home.setupTour.check.revertedTitle", {
              count: reverted.length,
              title: reverted[0]?.title,
            })}
          </div>
          <p className="st-spotlight-reason">
            {t("home.setupTour.check.revertedReason", {
              count: reverted.length,
              names: reverted.map((r) => r.title).join(", "),
            })}
          </p>
          <div className="st-spotlight-foot st-spotlight-actions">
            {reverted.map((rev) => (
              <button
                key={rev.rec_id}
                className="btn-small btn-small-on"
                disabled={applyingId !== null}
                onClick={() => applyReverted(rev)}
              >
                {applyingId === rev.rec_id
                  ? t("home.setupTour.check.turningOn")
                  : reverted.length === 1
                    ? t("home.setupTour.check.turnBackOn")
                    : t("home.setupTour.check.turnTitleOn", { title: rev.title })}
              </button>
            ))}
          </div>
          {gameModeDrifted && <p className="st-note">{t("home.setupTour.check.gameModeNote")}</p>}
        </div>
      ) : top ? (
        <div className="st-spotlight">
          <div className="st-spotlight-tag">{t("home.setupTour.check.spotlightTag")}</div>
          <div className="st-spotlight-title">{top.title}</div>
          <p className="st-spotlight-reason">{top.reason}</p>
          <div className="st-spotlight-foot">
            {recFor(top) ? (
              <button
                className="btn-small btn-small-on"
                disabled={applyingId !== null}
                onClick={() => applyLimiter(top)}
              >
                {applyingId === recFor(top)?.id
                  ? t("home.setupTour.check.applying")
                  : t("home.setupTour.check.applyFix")}
              </button>
            ) : (
              <span className="st-chip-muted">{t("home.setupTour.check.advisory")}</span>
            )}
          </div>
        </div>
      ) : (
        <>
          {readyCount > 0 && (
            <p className="st-body-text">{t("home.setupTour.check.checksClean", { count: readyCount })}</p>
          )}
          {unreadCount > 0 && (
            <p className="st-body-text">{t("home.setupTour.check.checksUnread", { count: unreadCount })}</p>
          )}
          {/* Named, never counted as right: the band, Home's card, the first check and Check say it
              too (desk review 2026-11-03). */}
          {advisoryCount > 0 && (
            <p className="st-body-text">{t("home.setupTour.check.checksAdvisory", { count: advisoryCount })}</p>
          )}
        </>
      )}
      <p className="st-body-text">{t("home.setupTour.check.reversibleFooter")}</p>
    </>
  );
}

// ── Leg 2 — hardware lesson (role · metric · real tweaks · the tab that manages them) ──────────────

function StepLesson({ step }: { step: SetupStep }) {
  const { t } = useTranslation();
  const l = step.lesson;
  if (!l) return null;
  return (
    <>
      <div className="st-tag">{l.eyebrow}</div>
      <h2 className="st-title">{step.title}</h2>
      <p className="st-body-text">{l.role}</p>
      <div className="st-affects">
        <span className="st-affects-key">{t("home.setupTour.lesson.drivesLabel")}</span> {l.affects}
      </div>
      <div className="st-tweaks">
        {/* "can tune" + the fine line (tester Matthew 2026-07-22: the old "tunes here" present
            tense read like the tour was applying things — "I was like 'ight bet I'm down'").
            The tour is read-only; expectation is now set where it formed. */}
        <div className="st-tweaks-head">{t("home.setupTour.lesson.tweaksHead")}</div>
        <ul className="st-tweaks-list">
          {l.tweaks.map((tw) => (
            <li key={tw}>{tw}</li>
          ))}
        </ul>
        <p className="st-tweaks-fine">{t("home.setupTour.lesson.tweaksFine")}</p>
      </div>
      <div className="st-tabchip">
        <span className="st-tabchip-ico">
          <NavGlyph name={TAB_ICON[l.tab.id]} />
        </span>
        <span>{l.tab.tie}</span>
      </div>
      {l.note && <p className="st-note">{l.note}</p>}
    </>
  );
}

// ── Leg 2 finale — the six-tab recap ───────────────────────────────────────────────────────────────

function StepTabMap({ step }: { step: SetupStep }) {
  const { t } = useTranslation();
  const tabs = step.tabs ?? [];
  return (
    <>
      <div className="st-tag">{t("home.setupTour.tabMap.tag")}</div>
      <h2 className="st-title">{step.title}</h2>
      <p className="st-body-text">{step.body}</p>
      <div className="st-tabgrid">
        {tabs.map((tab) => (
          // No single room is highlighted — this recap is a neutral "here's where everything lives".
          <div key={tab.id} className="st-tabcard">
            <span className="st-tabcard-ico">
              <NavGlyph name={tab.icon} />
            </span>
            <div className="st-tabcard-text">
              <div className="st-tabcard-name">{tab.label}</div>
              <div className="st-tabcard-blurb">{tab.blurb}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
