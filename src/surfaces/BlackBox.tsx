import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BlackBoxReport, CrashIncident, CrashAssessment } from "../types";
import { resolutionFor, type HelpMark } from "../data/blackbox-resolution";
import "./BlackBox.css";

// Black Box v1 (Paramedic Mode) — READ-ONLY crash/freeze evidence reader, rendered as a Lab
// instrument. On-demand scan only (no background watcher in v1). It reports the evidence Windows
// recorded + Compy's own "last vitals" — and makes ZERO causal claims. The receipt expander holds
// the raw IDs/module/code; plain English up top (Sarah & Caleb bar).
export function BlackBox() {
  const [report, setReport] = useState<BlackBoxReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = () => {
    setScanning(true);
    setError(null);
    invoke<BlackBoxReport>("get_crash_blackbox")
      .then((r) => setReport(r))
      .catch(() => setError("Couldn't read the crash log just now — try again in a moment."))
      .finally(() => setScanning(false));
  };

  return (
    <div className="bb">
      <p className="bb-intro">
        Black Box reads the crash and freeze evidence Windows already recorded, and overlays Compy's
        own <em>last vitals</em> from any session that was running at the time. It only reports what
        was logged — it makes no guesses about the cause.
      </p>

      <button className="bb-scan cmp-door" onClick={scan} disabled={scanning}>
        {scanning ? "Scanning…" : report ? "Scan again" : "Scan for recent crashes"}
      </button>

      {error && <p className="bb-error">{error}</p>}

      {report && !scanning && (
        <div className="bb-results">
          {report.incidents.length === 0 ? (
            report.skipped_sources.length > 0 ? (
              <p className="bb-empty">
                No crashes or freezes in what Compy could read. Some records below need administrator
                — run Compy as admin to check those too.
              </p>
            ) : (
              <p className="bb-empty">
                No crashes or freezes recorded. Either nothing went wrong, or whatever happened left no
                trace Windows recorded.
              </p>
            )
          ) : (
            <ul className="bb-list">
              {report.incidents.map((inc, i) => (
                <IncidentRow key={`${inc.when}-${i}`} inc={inc} allIncidents={report.incidents} />
              ))}
            </ul>
          )}

          {report.skipped_sources.length > 0 && (
            <p className="bb-skipped">
              Skipped — needs administrator: {report.skipped_sources.join("; ")}. Run Compy as admin
              to include {report.skipped_sources.length > 1 ? "these" : "this"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IncidentRow({ inc, allIncidents }: { inc: CrashIncident; allIncidents: CrashIncident[] }) {
  const [showReceipt, setShowReceipt] = useState(false);
  const r = inc.receipt;
  return (
    <li className="bb-item">
      <div className="bb-item-head">
        <span className="bb-tag">{inc.tag}</span>
        <span className="bb-headline">{inc.headline}</span>
      </div>

      {inc.vitals ? (
        <div className="bb-vitals">
          <span className="bb-vitals-label">last vitals</span>
          <span className="bb-vitals-text">{inc.vitals.summary}</span>
        </div>
      ) : (
        <div className="bb-vitals bb-vitals-none">
          <span className="bb-vitals-text">
            Compy wasn't monitoring at that moment — no vitals to show.
          </span>
        </div>
      )}

      {/* Black Box v2 (only present when blackbox_v2_gate() is ON): triage — consistent-with + a
          strength WORD (never a percentage) + the evidence + ONE reversible next step. v2.1 adds the
          measured-absence line under a step the user marked helpful. */}
      {inc.assessment && <AssessmentBlock inc={inc} allIncidents={allIncidents} />}

      <button
        className="bb-receipt-toggle"
        onClick={() => setShowReceipt((s) => !s)}
        aria-expanded={showReceipt}
      >
        {showReceipt ? "Hide the receipt" : "Show the receipt"}
      </button>

      {showReceipt && (
        <dl className="bb-receipt">
          <div className="bb-receipt-row">
            <dt>Source</dt>
            <dd>{r.source}</dd>
          </div>
          {r.faulting_app && (
            <div className="bb-receipt-row">
              <dt>Faulting app</dt>
              <dd>{r.faulting_app}</dd>
            </div>
          )}
          {r.faulting_module && (
            <div className="bb-receipt-row">
              <dt>Faulting module</dt>
              <dd>{r.faulting_module}</dd>
            </div>
          )}
          {r.code && (
            <div className="bb-receipt-row">
              <dt>Code</dt>
              <dd>{r.code}</dd>
            </div>
          )}
          {r.detail && (
            <div className="bb-receipt-row">
              <dt>Raw</dt>
              <dd className="bb-raw">{r.detail}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

const STRENGTH_LABEL: Record<CrashAssessment["strength"], string> = {
  // Strength is a WORD, never a percentage (the v2 law). These are the only strength surfaces.
  strong: "Strong signal",
  partial: "Partial signal",
  weak: "Weak signal",
};

// Black Box v2 triage block. "Consistent with…" framing only — never "the cause is…". Shows the exact
// evidence it fired on and ONE reversible next step (research-only steps are clearly marked, never "do
// this" for anything irreversible). Rendered only when the backend gate populated `assessment`.
function AssessmentBlock({ inc, allIncidents }: { inc: CrashIncident; allIncidents: CrashIncident[] }) {
  const a = inc.assessment as CrashAssessment; // only rendered when present
  const research = a.next_step.research_only;
  return (
    <div className={`bb-assess bb-assess-${a.strength}`}>
      <div className="bb-assess-head">
        <span className="bb-assess-label">What this points to</span>
        <span className={`bb-strength bb-strength-${a.strength}`}>{STRENGTH_LABEL[a.strength]}</span>
      </div>
      <p className="bb-assess-line">
        {a.beyond_us ? "This one is " : "The evidence is consistent with "}
        <strong>{a.consistent_with}</strong>
        {a.beyond_us ? " — beyond what Compy can safely narrow down." : "."}
      </p>
      <ul className="bb-assess-evidence">
        {a.evidence.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <div className={`bb-nextstep${research ? " bb-nextstep-research" : ""}`}>
        <span className="bb-nextstep-tag">{research ? "Worth researching" : "Safe next step"}</span>
        <p className="bb-nextstep-headline">{a.next_step.headline}</p>
        <p className="bb-nextstep-detail">{a.next_step.detail}</p>
      </div>
      <ResolutionFeedback inc={inc} allIncidents={allIncidents} />
    </div>
  );
}

const FEEDBACK_LOG_KEY = "compy_bb_feedback";

// Read the locally-stored "Did this help?" mark for an incident. Prefers the timestamped feedback log
// (so v2.1 can anchor a "since"); falls back to the v2.0 plain per-key vote (no timestamp → no "since",
// but the vote is still remembered). Local only — never reads the network.
function readHelpMark(incidentKey: string, voteKey: string): HelpMark | null {
  try {
    const raw = localStorage.getItem(FEEDBACK_LOG_KEY);
    const log: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(log)) {
      for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e && e.when === incidentKey && typeof e.at === "string") {
          return { vote: String(e.vote), at: e.at };
        }
      }
    }
    const v = localStorage.getItem(voteKey);
    if (v) return { vote: v, at: "" }; // old untimed mark — remembered, but can't anchor a "since"
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

// v2.0 "Did this help?" control + v2.1 measured-payoff. ALL LOCAL, zero outbound. On a step the user
// marked "yes", v2.1 reports a measured ABSENCE from the log ("No {kind} recorded in N days since") or an
// honest recurrence — it NEVER claims the fix worked (that's an unproven causal claim; resolutionFor
// guarantees the copy stays factual). A thumbs-down is how a wrong rule surfaces later (local feedback log).
function ResolutionFeedback({ inc, allIncidents }: { inc: CrashIncident; allIncidents: CrashIncident[] }) {
  const incidentKey = inc.when;
  const voteKey = `compy_bb_helpful_${incidentKey}`;
  const [mark, setMark] = useState<HelpMark | null>(() => readHelpMark(incidentKey, voteKey));
  const cast = (v: "yes" | "no") => {
    const at = new Date().toISOString();
    setMark({ vote: v, at });
    try {
      localStorage.setItem(voteKey, v);
      // Append to a capped LOCAL feedback log (no send — fleet aggregation is v3, gated).
      const log = JSON.parse(localStorage.getItem(FEEDBACK_LOG_KEY) || "[]");
      log.push({ when: incidentKey, consistent_with: inc.assessment?.consistent_with ?? "", vote: v, at });
      localStorage.setItem(FEEDBACK_LOG_KEY, JSON.stringify(log.slice(-100)));
    } catch {
      /* localStorage unavailable — the vote just isn't remembered, no harm */
    }
  };

  if (mark?.vote === "yes") {
    const res = resolutionFor(inc, allIncidents, mark);
    return (
      <div className="bb-resolved">
        <span className="bb-resolved-mark">✓ You marked this pointed you the right way</span>
        {res && <span className={`bb-resolved-since bb-resolved-${res.status}`}>{res.text}</span>}
      </div>
    );
  }
  if (mark?.vote === "no") {
    return (
      <p className="bb-helpful bb-helpful-done">Thanks — noted; we'd rather stay quiet than guess wrong.</p>
    );
  }
  return (
    <div className="bb-helpful">
      <span className="bb-helpful-q">Did this point you the right way?</span>
      <button className="bb-helpful-btn" onClick={() => cast("yes")}>
        Yes
      </button>
      <button className="bb-helpful-btn" onClick={() => cast("no")}>
        No
      </button>
    </div>
  );
}
