import { useState } from "react";

// First-run introduction. Shown once (gated on a localStorage flag set when
// the user finishes or skips). Purpose: set expectations about what Sentinel
// is and — just as importantly — what it deliberately will NOT do, before the
// user lands on a list of changes they don't yet have context for.

export const ONBOARDED_KEY = "sentinel_onboarded_v1";

type Step = {
  tag: string;
  title: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    tag: "What this is",
    title: "A safety layer that happens to optimize",
    body: (
      <>
        <p>
          Sentinel isn't an optimizer that bolts on an undo button. It's a
          <strong> rollback-first Windows configuration tool</strong> that
          happens to optimize. Every change it suggests is one it can put back
          exactly the way it found it.
        </p>
        <p>
          It reads your actual hardware and only surfaces changes that make
          sense for <em>your</em> PC — not a generic checklist.
        </p>
      </>
    ),
  },
  {
    tag: "How it works",
    title: "Nothing changes without your say-so",
    body: (
      <>
        <p>Each recommendation shows you three separate facts:</p>
        <ul>
          <li>
            <strong>Recommended</strong> — what Sentinel thinks is best
          </li>
          <li>
            <strong>Current</strong> — what Windows is actually set to right now
          </li>
          <li>
            <strong>Applied by Sentinel</strong> — whether Sentinel made the
            change, or you/Windows already had it that way
          </li>
        </ul>
        <p>
          You apply changes one at a time, with a confirmation each time, and
          you can roll any of them back from the same switch.
        </p>
      </>
    ),
  },
  {
    tag: "Our promises",
    title: "What Sentinel will never do",
    body: (
      <>
        <ul>
          <li>
            <strong>No kernel driver.</strong> Sentinel stays in user space.
            (That's why it shows GPU temperature but not CPU temperature —
            reading CPU temps needs a driver, and we won't ship one.)
          </li>
          <li>
            <strong>No injecting into your games.</strong> FPS and the overlay
            observe from the outside — anti-cheat safe.
          </li>
          <li>
            <strong>Local-only.</strong> Nothing about your system leaves your
            PC. No accounts, no telemetry.
          </li>
        </ul>
      </>
    ),
  },
  {
    tag: "Trust",
    title: "Every change is logged",
    body: (
      <>
        <p>
          The <strong>Trust Ledger</strong> records every change Sentinel makes
          — what it was before, what it became, and when — so you can review
          and undo anything later, even across restarts.
        </p>
        <p>
          Recommendations are also labelled by evidence:{" "}
          <em>Verified</em> (Sentinel measured it),{" "}
          <em>Measured signal</em> (established benchmarks), or{" "}
          <em>Expected impact</em> (sound in theory, not yet measured). No
          overpromising.
        </p>
      </>
    ),
  },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* non-fatal */
    }
    onDone();
  };

  return (
    <div className="onb-backdrop">
      <div className="onb-card">
        <div className="onb-head">
          <span className="onb-brand">Sentinel</span>
          <button className="onb-skip" onClick={finish}>
            Skip
          </button>
        </div>

        <div className="onb-tag">{step.tag}</div>
        <h2 className="onb-title">{step.title}</h2>
        <div className="onb-body">{step.body}</div>

        <div className="onb-dots">
          {STEPS.map((_, idx) => (
            <span
              key={idx}
              className={`onb-dot ${idx === i ? "onb-dot-on" : ""}`}
            />
          ))}
        </div>

        <div className="onb-actions">
          <button
            className="btn-small"
            onClick={() => setI((n) => Math.max(0, n - 1))}
            disabled={i === 0}
          >
            Back
          </button>
          {last ? (
            <button className="btn" onClick={finish}>
              Get started
            </button>
          ) : (
            <button className="btn" onClick={() => setI((n) => n + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
