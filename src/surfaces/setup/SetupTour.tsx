import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconCpuOff, IconShieldCheck, IconWifiOff } from "@tabler/icons-react";
import type { HardwareInfo } from "../../App";
import type { PriorityItem } from "../../types";
import type { RigLine } from "../../Onboarding";
import { Wordmark } from "../../design/Wordmark";
import { NavGlyph } from "../../design/NavGlyph";
import { HOME_RAIL, type HomeRailId } from "../../design/homeRail";
import { TrustSwitch } from "../../design/TrustSwitch";
import { useConfirm } from "../../design/ConfirmDialog";
import { useReducedMotion } from "../../design/use-motion";
import { useScan, type ScanRecLite } from "../use-scan";
import { buildRigParts } from "../rig/rig-parts";
import { buildSetupSteps, type SetupStep } from "./setup-steps";
import "./SetupTour.css";

// The combined "Compy Setup & Tour" — a re-runnable, contained HoloLens console. A centered card with
// a bordered 3D STAGE (the user's real hardware) beside a calm content panel; chrome anchored top
// (wordmark · leg · skip) and bottom (progress · back/next). Leg 1 reuses the first-experience
// content; Leg 2 tours each component (role · metric · the real tweaks · the tab that manages them)
// and ends with a six-tab recap. Read-only except the first-check's audited one-click apply. Honors
// reduced-motion.

export const SETUP_TOUR_KEY = "compy_setup_tour_v1";

const TAB_ICON: Record<HomeRailId, string> = Object.fromEntries(
  HOME_RAIL.map((r) => [r.id, r.icon]),
) as Record<HomeRailId, string>;

// Lazy so the three.js hardware scene only loads when the tour opens.
const HardwareTourScene = lazy(() =>
  import("./HardwareTourScene").then((m) => ({ default: m.HardwareTourScene })),
);

export function SetupTour({ hw, rig, onDone }: { hw: HardwareInfo; rig: RigLine[]; onDone: () => void }) {
  const steps = useMemo(() => buildSetupSteps(buildRigParts(hw)), [hw]);
  const [i, setI] = useState(0);
  const step = steps[i];
  const reduced = useReducedMotion();
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

  useEffect(() => {
    const root = rootRef.current;
    // Initial focus lands on a real control (the primary Next button), not the non-interactive
    // backdrop — so screen-reader/keyboard users start on something operable. Falls back to root.
    (nextRef.current ?? root)?.focus();
    const onKey = (e: KeyboardEvent) => {
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
  const legLabel = step.leg === "setup" ? "Guided setup" : "Hardware tour";

  return (
    <div
      className="st-backdrop"
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Compy setup and tour"
    >
      <div className="st-console">
        <header className="st-head">
          <span className="st-brand">
            <Wordmark size={19} />
          </span>
          <span className="st-leg">{legLabel}</span>
          <button className="st-skip" onClick={finish} aria-label="Skip setup and tour">
            Skip ✕
          </button>
        </header>

        <div className="st-body">
          {/* Contained 3D stage — the user's real hardware (camera centred, generous margin).
              Decorative: the text panel carries the meaning, so hide the canvas from the a11y tree. */}
          <div className="st-stage" aria-hidden="true">
            <Suspense fallback={<div className="st-loading">Initializing hologram…</div>}>
              <HardwareTourScene hw={hw} focusId={focusId} reduced={reduced} paused={false} />
            </Suspense>
          </div>

          {/* Calm content panel — never overlaps the stage. */}
          <div className="st-panel">
            {step.kind === "rig" && <StepRig rig={rig} />}
            {step.kind === "seatbelt" && <StepSeatbelt />}
            {step.kind === "rules" && <StepRules />}
            {step.kind === "check" && <StepCheck />}
            {step.kind === "lesson" && <StepLesson step={step} />}
            {step.kind === "tabmap" && <StepTabMap step={step} />}
          </div>
        </div>

        <footer className="st-footer">
          <div className="st-progress" aria-hidden="true">
            {steps.map((s, idx) => (
              <span
                key={s.id}
                className={`st-tick ${idx === i ? "st-tick-on" : ""} ${idx < i ? "st-tick-done" : ""}`}
              />
            ))}
          </div>
          <div className="st-nav">
            <button className="btn-small" onClick={back} disabled={i === 0}>
              Back
            </button>
            <span
              className="st-count"
              role="status"
              aria-live="polite"
              aria-label={`Step ${i + 1} of ${steps.length}`}
            >
              {i + 1} / {steps.length}
            </span>
            <button className="btn" ref={nextRef} onClick={next}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Leg 1 steps ──────────────────────────────────────────────────────────────

function StepRig({ rig }: { rig: RigLine[] }) {
  return (
    <>
      <div className="st-tag">YOUR RIG</div>
      <h2 className="st-title">Compy just read your machine</h2>
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
        Every suggestion you'll see was picked for <strong>this exact hardware</strong> — nothing
        generic, nothing it can't undo.
      </p>
    </>
  );
}

function StepSeatbelt() {
  const [applied, setApplied] = useState(false);
  return (
    <>
      <div className="st-tag">THE SEATBELT</div>
      <h2 className="st-title">One click to apply. One click to take it back.</h2>
      <div className="st-demo">
        <div className="st-demo-row">
          <div>
            <div className="st-demo-name">Power plan</div>
            <div className="st-demo-sub">Recommended: High performance · Current: Balanced</div>
          </div>
          <TrustSwitch
            applied={applied}
            busy={false}
            onToggle={() => setApplied((a) => !a)}
            ariaLabel={applied ? "Undo power plan (demo)" : "Apply power plan (demo)"}
          />
        </div>
        {applied && (
          <div className="st-demo-ledger">
            Trust Ledger — power plan · Balanced → High performance · just now
          </div>
        )}
      </div>
      <p className="st-body-text">
        Try it — the switch is live (and changes nothing here). Every real change lands in the{" "}
        <strong>Tune</strong> tab's ledger with its before-state. Undoable today, undoable in six months.
      </p>
    </>
  );
}

function StepRules() {
  const rules = [
    { Icon: IconCpuOff, text: "No kernel driver — stays in user space" },
    { Icon: IconShieldCheck, text: "No game injection — anti-cheat safe by design" },
    { Icon: IconWifiOff, text: "Nothing leaves your PC — no account, no telemetry" },
  ];
  return (
    <>
      <div className="st-tag">HOUSE RULES</div>
      <h2 className="st-title">What Compy refuses to do</h2>
      <div className="st-rules">
        {rules.map((r) => (
          <div key={r.text} className="st-rule">
            <r.Icon className="st-rule-icon" size={18} stroke={1.75} />
            <span>{r.text}</span>
          </div>
        ))}
      </div>
      <p className="st-body-text st-kicker">
        The sketchy tweaks aren't missing. <strong>They're refused.</strong>
      </p>
    </>
  );
}

function StepCheck() {
  const { readiness, priorities, recs, reverted, running, elapsed, phase, rerun } = useScan();
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
      title: `Apply "${rec.title}"?`,
      body: "Compy snapshots the prior state so you can roll this back anytime.",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setApplyingId(rec.id);
    try {
      await invoke("apply_recommendation", { recId: rec.id, recTitle: rec.title });
      await rerun();
    } catch {
      /* leave state as-is */
    } finally {
      setApplyingId(null);
    }
  };

  // Turn a specific drifted-off change back on, right here (no "go to another tab"). Re-applies the
  // exact rec the ledger says drifted; the apply path snapshots prior state so it stays reversible.
  const applyReverted = async (rev: { rec_id: string; title: string }) => {
    const ok = await confirm({
      title: `Turn "${rev.title}" back on?`,
      body: "Compy snapshots the prior state so you can roll this back anytime.",
      confirmLabel: "Turn it on",
    });
    if (!ok) return;
    setApplyingId(rev.rec_id);
    try {
      await invoke("apply_recommendation", { recId: rev.rec_id, recTitle: rev.title });
      await rerun();
    } catch {
      /* leave state as-is */
    } finally {
      setApplyingId(null);
    }
  };

  const limiters = priorities?.limiters ?? [];
  const fixCount = limiters.length;
  const top = limiters[0] ?? null;
  const checks = readiness?.checks ?? [];
  // The "applied-changes" limiter is the vague-flag anti-pattern: name the actual drifted setting(s)
  // and carry the fix inline, instead of "1 setting(s) — go to Optimize/Ledger".
  const driftTop = top?.id === "applied-changes" && reverted.length > 0;
  const gameModeDrifted = reverted.some((r) => r.rec_id === "game-mode");

  if (running || phase !== "verdict") {
    return (
      <>
        <div className="st-tag">FIRST CHECK</div>
        <h2 className="st-title">Reading your rig…</h2>
        <div className="st-scanning">
          <span className="st-scan-pulse" />
          <span>Running real checks{elapsed ? ` · ${elapsed.toFixed(1)}s` : "…"}</span>
        </div>
        <p className="st-body-text">No guessing — Compy measures this machine, then tells you the truth.</p>
      </>
    );
  }

  return (
    <>
      <div className="st-tag">FIRST CHECK</div>
      <h2 className="st-title">
        {fixCount === 0
          ? "Ready to play — this rig measured clean"
          : `Ready to play — ${fixCount} thing${fixCount === 1 ? "" : "s"} worth fixing`}
      </h2>
      {driftTop ? (
        <div className="st-spotlight">
          <div className="st-spotlight-tag">#1 BIGGEST LIMITER</div>
          <div className="st-spotlight-title">
            {reverted.length === 1
              ? `“${reverted[0].title}” turned itself back off`
              : `${reverted.length} settings you applied turned back off`}
          </div>
          <p className="st-spotlight-reason">
            {reverted.length === 1
              ? "You turned this on with Compy, but something outside Compy switched it back. Turn it back on right here — or leave it, your call."
              : `You turned these on with Compy, but they're off now: ${reverted
                  .map((r) => r.title)
                  .join(", ")}. Turn them back on right here.`}
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
                  ? "Turning on…"
                  : reverted.length === 1
                    ? "Turn it back on"
                    : `Turn “${rev.title}” on`}
              </button>
            ))}
          </div>
          {gameModeDrifted && (
            <p className="st-note">
              Heads-up: Game Mode keeps switching off because your recording software (AMD Adrenalin)
              resets it at every restart — turning it on works, but it won't stick.
            </p>
          )}
        </div>
      ) : top ? (
        <div className="st-spotlight">
          <div className="st-spotlight-tag">#1 BIGGEST LIMITER</div>
          <div className="st-spotlight-title">{top.title}</div>
          <p className="st-spotlight-reason">{top.reason}</p>
          <div className="st-spotlight-foot">
            {recFor(top) ? (
              <button
                className="btn-small btn-small-on"
                disabled={applyingId !== null}
                onClick={() => applyLimiter(top)}
              >
                {applyingId === recFor(top)?.id ? "Applying…" : "Apply this fix"}
              </button>
            ) : (
              <span className="st-chip-muted">advisory — no one-click change</span>
            )}
          </div>
        </div>
      ) : (
        <p className="st-body-text">
          {checks.length} checks came back right — measured on this rig, not assumed.
        </p>
      )}
      <p className="st-body-text">Reversible, every one. Next, a quick tour of your rig — tap Next.</p>
    </>
  );
}

// ── Leg 2 — hardware lesson (role · metric · real tweaks · the tab that manages them) ──────────────

function StepLesson({ step }: { step: SetupStep }) {
  const l = step.lesson;
  if (!l) return null;
  return (
    <>
      <div className="st-tag">{l.eyebrow}</div>
      <h2 className="st-title">{step.title}</h2>
      <p className="st-body-text">{l.role}</p>
      <div className="st-affects">
        <span className="st-affects-key">Drives</span> {l.affects}
      </div>
      <div className="st-tweaks">
        <div className="st-tweaks-head">Settings Compy tunes here</div>
        <ul className="st-tweaks-list">
          {l.tweaks.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
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
  const tabs = step.tabs ?? [];
  return (
    <>
      <div className="st-tag">THE TOUR</div>
      <h2 className="st-title">{step.title}</h2>
      <p className="st-body-text">{step.body}</p>
      <div className="st-tabgrid">
        {tabs.map((t) => (
          // No single room is highlighted — this recap is a neutral "here's where everything lives".
          <div key={t.id} className="st-tabcard">
            <span className="st-tabcard-ico">
              <NavGlyph name={t.icon} />
            </span>
            <div className="st-tabcard-text">
              <div className="st-tabcard-name">{t.label}</div>
              <div className="st-tabcard-blurb">{t.blurb}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
