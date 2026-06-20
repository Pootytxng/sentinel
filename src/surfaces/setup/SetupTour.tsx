import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconCpuOff, IconShieldCheck, IconWifiOff } from "@tabler/icons-react";
import type { HardwareInfo } from "../../App";
import type { PriorityItem } from "../../types";
import type { RigLine } from "../../Onboarding";
import { Wordmark } from "../../design/Wordmark";
import { TrustSwitch } from "../../design/TrustSwitch";
import { useConfirm } from "../../design/ConfirmDialog";
import { useScan, type ScanRecLite } from "../use-scan";
import { buildRigParts } from "../rig/rig-parts";
import { buildSetupSteps, type SetupStep } from "./setup-steps";
import "./SetupTour.css";

// The combined "Compy Setup & Tour" — a re-runnable, full-screen HoloLens journey. The 3D framework
// is the persistent centerpiece; the glass HUD shows the current step. Leg 1 (setup) reuses the
// existing first-experience content (rig / seatbelt / house rules / live first-check). Leg 2 (tour)
// flies the framework through each room. Read-only except the first-check's one-click apply, which
// reuses the audited apply_recommendation path behind a confirm. Honors reduced-motion.

export const SETUP_TOUR_KEY = "compy_setup_tour_v1";

// Lazy so the three.js hardware scene only loads when the tour opens.
const HardwareTourScene = lazy(() =>
  import("./HardwareTourScene").then((m) => ({ default: m.HardwareTourScene })),
);

function prefersReduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SetupTour({ hw, rig, onDone }: { hw: HardwareInfo; rig: RigLine[]; onDone: () => void }) {
  const steps = useMemo(() => buildSetupSteps(buildRigParts(hw)), [hw]);
  const [i, setI] = useState(0);
  const step = steps[i];
  const reduced = useMemo(prefersReduced, []);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // Keyboard: Esc closes, arrows navigate, Tab is trapped inside the overlay.
  useEffect(() => {
    const root = rootRef.current;
    root?.focus();
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
    <div className="st-backdrop" ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Compy setup and tour">
      <div className="st-veil" aria-hidden="true" />

      {/* 3D hardware centerpiece — the user's real rig; the camera flies to the focused component. */}
      <div className="st-stage">
        <Suspense fallback={<div className="st-loading">Initializing hologram…</div>}>
          <HardwareTourScene hw={hw} focusId={focusId} reduced={reduced} paused={false} />
        </Suspense>
      </div>

      {/* HUD */}
      <header className="st-head">
        <span className="st-brand">
          <Wordmark size={20} />
        </span>
        <span className="st-leg">{legLabel}</span>
        <button className="st-skip" onClick={finish}>
          Skip
        </button>
      </header>

      <div className="st-panel">
        <div className="st-step">
          {step.kind === "rig" && <StepRig rig={rig} />}
          {step.kind === "seatbelt" && <StepSeatbelt />}
          {step.kind === "rules" && <StepRules />}
          {step.kind === "check" && <StepCheck />}
          {step.kind === "lesson" && <StepLesson step={step} />}
        </div>

        <div className="st-progress" aria-hidden="true">
          {steps.map((s, idx) => (
            <span
              key={s.id}
              className={`st-tick ${idx === i ? "st-tick-on" : ""} ${idx < i ? "st-tick-done" : ""} ${
                s.leg === "tour" ? "st-tick-tour" : ""
              }`}
            />
          ))}
        </div>

        <div className="st-actions">
          <button className="btn-small" onClick={back} disabled={i === 0}>
            Back
          </button>
          <span className="st-count">
            {i + 1} / {steps.length}
          </span>
          <button className="btn" onClick={next}>
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
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
      <p className="st-body">
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
      <p className="st-body">
        Try it — the switch above is live (and changes nothing here). Every real change lands in the{" "}
        <strong>Trust Ledger</strong> with its before-state. Undoable today, undoable in six months.
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
      <p className="st-body st-kicker">
        The sketchy tweaks aren't missing. <strong>They're refused.</strong>
      </p>
    </>
  );
}

function StepCheck() {
  const { readiness, priorities, recs, running, elapsed, phase, rerun } = useScan();
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

  const limiters = priorities?.limiters ?? [];
  const fixCount = limiters.length;
  const top = limiters[0] ?? null;
  const checks = readiness?.checks ?? [];

  if (running || phase !== "verdict") {
    return (
      <>
        <div className="st-tag">FIRST CHECK</div>
        <h2 className="st-title">Reading your rig…</h2>
        <div className="st-scanning">
          <span className="st-scan-pulse" />
          <span>Running real checks{elapsed ? ` · ${elapsed.toFixed(1)}s` : "…"}</span>
        </div>
        <p className="st-body">No guessing — Compy measures this machine, then tells you the truth.</p>
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
      {top ? (
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
        <p className="st-body">
          {checks.length} checks came back right — measured on this rig, not assumed.
        </p>
      )}
      <p className="st-body">
        Reversible, every one. The rest of the tour shows you around — tap Next.
      </p>
    </>
  );
}

// ── Leg 2 step — a hardware lesson (role · affected metric · the real tweaks that touch it) ─────────

function StepLesson({ step }: { step: SetupStep }) {
  const l = step.lesson;
  if (!l) return null;
  return (
    <>
      <div className="st-tag">{l.eyebrow}</div>
      <h2 className="st-title">{step.title}</h2>
      <p className="st-body">{l.role}</p>
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
      {l.note && <p className="st-note">{l.note}</p>}
    </>
  );
}
