import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BlackBoxReport, CrashIncident } from "../types";
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
