import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BlackBoxReport, CrashIncident, CrashAssessment } from "../types";
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
                <IncidentRow key={`${inc.when}-${i}`} inc={inc} />
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

function IncidentRow({ inc }: { inc: CrashIncident }) {
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
          strength WORD (never a percentage) + the evidence + ONE reversible next step. */}
      {inc.assessment && <AssessmentBlock a={inc.assessment} incidentKey={inc.when} />}

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
function AssessmentBlock({ a, incidentKey }: { a: CrashAssessment; incidentKey: string }) {
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
      <HelpfulControl incidentKey={incidentKey} consistentWith={a.consistent_with} />
    </div>
  );
}

// "Did this help?" — the honesty feedback loop. Stored locally only (no network); a thumbs-down on a
// rule is how a wrong rule surfaces later. v2.1 aggregates this; v2.0 just records it per incident.
function HelpfulControl({ incidentKey, consistentWith }: { incidentKey: string; consistentWith: string }) {
  const voteKey = `compy_bb_helpful_${incidentKey}`;
  const [vote, setVote] = useState<string | null>(() => {
    try {
      return localStorage.getItem(voteKey);
    } catch {
      return null;
    }
  });
  const cast = (v: "yes" | "no") => {
    setVote(v);
    try {
      localStorage.setItem(voteKey, v);
      // Append to a capped local feedback log so wrong rules can surface (local-only, no send).
      const log = JSON.parse(localStorage.getItem("compy_bb_feedback") || "[]");
      log.push({ when: incidentKey, consistent_with: consistentWith, vote: v, at: new Date().toISOString() });
      localStorage.setItem("compy_bb_feedback", JSON.stringify(log.slice(-100)));
    } catch {
      /* localStorage unavailable — the vote just isn't remembered, no harm */
    }
  };
  if (vote) {
    return (
      <p className="bb-helpful bb-helpful-done">
        Thanks — noted{vote === "no" ? "; we'd rather stay quiet than guess wrong." : "."}
      </p>
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
