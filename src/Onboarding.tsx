import { useEffect, useState } from "react";
import { IconCpuOff, IconShieldCheck, IconWifiOff } from "@tabler/icons-react";
import { TrustSwitch } from "./design/TrustSwitch";
import { PulseC } from "./design/PulseC";

// First-run experience — Moment 1 of the first-experience arc.
// Spec: docs/superpowers/specs/2026-06-04-first-experience-arc-design.md (owner-approved VERBATIM —
// copy changes need owner sign-off). Three steps, ~70 words: (1) Compy already read THIS machine,
// (2) demonstrate the apply/undo seatbelt — VISUAL ONLY, mutates nothing, (3) what Compy refuses to
// do. Shown once, gated on ONBOARDED_KEY (set on finish or Skip).

export const ONBOARDED_KEY = "compy_onboarded_v1";

/** One detected-hardware line for Step 1, built by App from the cached startup snapshot. */
export type RigLine = { label: string; value: string };

export default function Onboarding({
  onDone,
  rig,
  arcV2 = false,
}: {
  onDone: () => void;
  rig: RigLine[];
  arcV2?: boolean;
}) {
  const [step, setStep] = useState(0);

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onDone();
  };

  return (
    <div className={`onb-backdrop ${arcV2 ? "arc-v2" : ""}`}>
      <div className="onb-card">
        <div className="onb-head">
          <span className="onb-brand">
            {arcV2 && <PulseC size={22} />}
            Compy
          </span>
          <button className="onb-skip" onClick={finish}>
            Skip
          </button>
        </div>

        <div className="onb-step">
          {step === 0 && <StepRig rig={rig} />}
          {step === 1 && <StepSeatbelt arcV2={arcV2} />}
          {step === 2 && <StepHouseRules />}
        </div>

        <div className="onb-dots">
          {[0, 1, 2].map((idx) => (
            <span key={idx} className={`onb-dot ${idx === step ? "onb-dot-on" : ""}`} />
          ))}
        </div>

        <div className="onb-actions">
          <button
            className="btn-small"
            onClick={() => setStep((n) => Math.max(0, n - 1))}
            disabled={step === 0}
          >
            Back
          </button>
          {step < 2 ? (
            <button className="btn" onClick={() => setStep((n) => n + 1)}>
              Next
            </button>
          ) : (
            // Routes to Moment 2 (first-check landing) once that's built; for now finishes onboarding
            // → the main app (which shows the readiness check).
            <button className="btn" onClick={finish}>
              Run my first check
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Step 1 — YOUR RIG. Hardware was already read at startup; the per-line stagger is display polish
// only (no fake scan time). Shimmer until real values exist — never show hardware that wasn't probed.
function StepRig({ rig }: { rig: RigLine[] }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (rig.length === 0) return;
    setShown(0);
    const timers = rig.map((_, idx) =>
      window.setTimeout(() => setShown((n) => Math.max(n, idx + 1)), idx * 420 + 120),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [rig]);

  return (
    <>
      <div className="onb-tag">YOUR RIG</div>
      <h2 className="onb-title">Compy just read your machine</h2>
      <div className="onb-detect">
        {rig.length === 0
          ? [0, 1, 2, 3].map((i) => <div key={i} className="onb-detect-row onb-shimmer" />)
          : rig.map((line, idx) => (
              <div
                key={line.label}
                className={`onb-detect-row ${idx < shown ? "onb-detect-in" : "onb-detect-pending"}`}
              >
                <span className="onb-detect-check">✓</span>
                <span className="onb-detect-label">{line.label}</span>
                <span className="onb-detect-dash">—</span>
                <span className="onb-detect-value">{line.value}</span>
              </div>
            ))}
      </div>
      <p className="onb-body">
        Every suggestion you'll see was picked for <strong>this exact hardware</strong>. Nothing
        generic. Nothing it can't undo.
      </p>
    </>
  );
}

// Step 2 — THE SEATBELT. The demo card is VISUAL ONLY: Apply/Undo flips local state and shows a
// mock ledger line — it never calls a command or mutates anything.
function StepSeatbelt({ arcV2 }: { arcV2: boolean }) {
  const [applied, setApplied] = useState(false);
  return (
    <>
      <div className="onb-tag">THE SEATBELT</div>
      <h2 className="onb-title">One click to apply. One click to take it back.</h2>
      <div className="onb-demo">
        <div className="onb-demo-row">
          <div className="onb-demo-info">
            <div className="onb-demo-name">Power plan</div>
            <div className="onb-demo-sub">Recommended: High performance · Current: Balanced</div>
          </div>
          {arcV2 ? (
            // Demo mode — the shared trust-switch, but it mutates NOTHING (flips local state only).
            <TrustSwitch
              applied={applied}
              busy={false}
              onToggle={() => setApplied((a) => !a)}
              ariaLabel={applied ? "Undo power plan (demo)" : "Apply power plan (demo)"}
            />
          ) : applied ? (
            <button className="btn-small onb-demo-btn" onClick={() => setApplied(false)}>
              Undo
            </button>
          ) : (
            <button
              className="btn-small btn-small-on onb-demo-btn"
              onClick={() => setApplied(true)}
            >
              Apply
            </button>
          )}
        </div>
        {applied && (
          <div className="onb-demo-ledger">
            Trust Ledger — power plan · Balanced → High performance · just now
          </div>
        )}
      </div>
      <p className="onb-body">
        Try it — the button above is live. Every change lands in the <strong>Trust Ledger</strong>{" "}
        with its before-state. Undoable today, undoable in six months.
      </p>
    </>
  );
}

// Step 3 — HOUSE RULES.
function StepHouseRules() {
  const rules = [
    { Icon: IconCpuOff, text: "No kernel driver — stays in user space" },
    { Icon: IconShieldCheck, text: "No game injection — anti-cheat safe by design" },
    { Icon: IconWifiOff, text: "Nothing leaves your PC — no account, no telemetry" },
  ];
  return (
    <>
      <div className="onb-tag">HOUSE RULES</div>
      <h2 className="onb-title">What Compy refuses to do</h2>
      <div className="onb-rules">
        {rules.map((r) => (
          <div key={r.text} className="onb-rule">
            <r.Icon className="onb-rule-icon" size={18} stroke={1.75} />
            <span className="onb-rule-text">{r.text}</span>
          </div>
        ))}
      </div>
      <p className="onb-body onb-kicker">
        The sketchy tweaks aren't missing. <strong>They're refused.</strong>
      </p>
    </>
  );
}
