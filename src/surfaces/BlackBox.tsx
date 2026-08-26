import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import type {
  BlackBoxReport,
  CrashIncident,
  CrashAssessment,
  CaseIntelligenceMatch,
} from "../types";
import { resolutionFor, type HelpMark } from "../data/blackbox-resolution";
import "./BlackBox.css";

// Black Box v1 (Paramedic Mode) — READ-ONLY crash/freeze evidence reader, rendered as a Lab
// instrument. On-demand scan only (no background watcher in v1). It reports the evidence Windows
// recorded + Compy's own "last vitals" — and makes ZERO causal claims. The receipt expander holds
// the raw IDs/module/code; plain English up top (Sarah & Caleb bar).
export function BlackBox({
  onReport,
  selectedIncidentId,
}: {
  // Feeds the scan result up (V2 Lab's latest-readings strip) — same read, no second IPC.
  onReport?: (r: BlackBoxReport) => void;
  /** The exact incident the user was routed here to see (Care observer deep-link, Tier 1 task 9).
   *  When present the station scans on mount instead of waiting for a click — a user who followed
   *  "Find out why" already asked the question, and making them press Scan is asking it twice. */
  selectedIncidentId?: string | null;
} = {}) {
  const { t } = useTranslation();
  const [report, setReport] = useState<BlackBoxReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = () => {
    setScanning(true);
    setError(null);
    invoke<BlackBoxReport>("get_crash_blackbox")
      .then((r) => {
        setReport(r);
        onReport?.(r);
      })
      .catch(() => setError(t("gaming.blackBox.scanErrorMsg")))
      .finally(() => setScanning(false));
  };

  // Arrive-and-scan, once, only on a deep-link. The scan itself is the SAME on-demand read a click
  // makes — no watcher, no cadence, no second IPC shape.
  useEffect(() => {
    if (selectedIncidentId) scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount by design
  }, []);

  // Was the incident the user came for actually found? A scan can honestly come back without it:
  // the record may have aged past the newest-25 cap, or a source that named it may need admin. The
  // station SAYS so rather than silently showing a list and letting the user assume they misread
  // the card — "the thing you clicked is not here" is information, and hiding it is the dead-end
  // this product exists to avoid.
  const selectedMissing =
    !!selectedIncidentId &&
    !!report &&
    !scanning &&
    !report.incidents.some((i) => i.incident_id === selectedIncidentId);

  return (
    <div className="bb">
      <p className="bb-intro">
        {t("gaming.blackBox.introPre")} <em>{t("gaming.blackBox.introEmph")}</em>{" "}
        {t("gaming.blackBox.introPost")}
      </p>

      <button className="bb-scan cmp-door" onClick={scan} disabled={scanning}>
        {scanning
          ? t("gaming.blackBox.scanningEllipsis")
          : report
          ? t("gaming.blackBox.scanAgainButton")
          : t("gaming.blackBox.scanButton")}
      </button>

      {error && <p className="bb-error">{error}</p>}

      {report && !scanning && (
        <div className="bb-results">
          {report.incidents.length === 0 ? (
            report.skipped_sources.length > 0 ? (
              <p className="bb-empty">{t("gaming.blackBox.emptyWithSkipped")}</p>
            ) : (
              <p className="bb-empty">{t("gaming.blackBox.emptyClean")}</p>
            )
          ) : (
            <ul className="bb-list">
              {report.incidents.map((inc, i) => (
                <IncidentRow
                  key={inc.incident_id || `${inc.when}-${i}`}
                  inc={inc}
                  allIncidents={report.incidents}
                  selected={!!selectedIncidentId && inc.incident_id === selectedIncidentId}
                />
              ))}
            </ul>
          )}

          {selectedMissing && (
            <p className="bb-selected-missing">{t("gaming.blackBox.selectedMissing")}</p>
          )}

          {report.skipped_sources.length > 0 && (
            <p className="bb-skipped">
              {t("gaming.blackBox.skippedIntro", { sources: report.skipped_sources.join("; ") })}{" "}
              {t("gaming.blackBox.skippedRunAdmin", { count: report.skipped_sources.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IncidentRow({
  inc,
  allIncidents,
  selected = false,
}: {
  inc: CrashIncident;
  allIncidents: CrashIncident[];
  /** This is the exact incident the user was routed here to see. Marked, and scrolled into view —
   *  a deep-link that lands the user in a list of twenty-five rows has not actually arrived. */
  selected?: boolean;
}) {
  const { t } = useTranslation();
  const [showReceipt, setShowReceipt] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [selected]);
  const r = inc.receipt;
  return (
    <li className="bb-item" ref={ref} data-selected={selected ? "true" : undefined}>
      {selected && <p className="bb-selected-note">{t("gaming.blackBox.selectedNote")}</p>}
      <div className="bb-item-head">
        <span className="bb-tag">{inc.tag}</span>
        <span className="bb-headline">{inc.headline}</span>
      </div>

      {inc.vitals ? (
        <div className="bb-vitals">
          <span className="bb-vitals-label">{t("gaming.blackBox.vitalsLabel")}</span>
          <span className="bb-vitals-text">{inc.vitals.summary}</span>
        </div>
      ) : (
        <div className="bb-vitals bb-vitals-none">
          <span className="bb-vitals-text">{t("gaming.blackBox.noVitalsMsg")}</span>
        </div>
      )}

      {/* Black Box v2 (only present when blackbox_v2_gate() is ON): triage — consistent-with + a
          strength WORD (never a percentage) + the evidence + ONE reversible next step. v2.1 adds the
          measured-absence line under a step the user marked helpful. */}
      {inc.assessment && <AssessmentBlock inc={inc} allIncidents={allIncidents} />}

      {/* Compy Care Tier 1 (only present when case_intelligence_gate() is ON and the SIGNED catalog
          matched): somebody else's published write-up, carried verbatim. A separate section from the
          triage block above on purpose — that one is Compy's own reading, this one is a quote. */}
      {inc.case_intelligence && <KnownIssueBlock m={inc.case_intelligence} />}

      <button
        className="bb-receipt-toggle"
        onClick={() => setShowReceipt((s) => !s)}
        aria-expanded={showReceipt}
      >
        {showReceipt ? t("gaming.blackBox.hideReceiptButton") : t("gaming.blackBox.showReceiptButton")}
      </button>

      {showReceipt && (
        <dl className="bb-receipt">
          <div className="bb-receipt-row">
            <dt>{t("gaming.blackBox.sourceLabel")}</dt>
            <dd>{r.source}</dd>
          </div>
          {r.faulting_app && (
            <div className="bb-receipt-row">
              <dt>{t("gaming.blackBox.faultingAppLabel")}</dt>
              <dd>{r.faulting_app}</dd>
            </div>
          )}
          {r.faulting_module && (
            <div className="bb-receipt-row">
              <dt>{t("gaming.blackBox.faultingModuleLabel")}</dt>
              <dd>{r.faulting_module}</dd>
            </div>
          )}
          {r.code && (
            <div className="bb-receipt-row">
              <dt>{t("gaming.blackBox.codeLabel")}</dt>
              <dd>{r.code}</dd>
            </div>
          )}
          {r.detail && (
            <div className="bb-receipt-row">
              <dt>{t("gaming.blackBox.rawLabel")}</dt>
              <dd className="bb-raw">{r.detail}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

// Black Box v2 triage block. "Consistent with…" framing only — never "the cause is…". Shows the exact
// evidence it fired on and ONE reversible next step (research-only steps are clearly marked, never "do
// this" for anything irreversible). Rendered only when the backend gate populated `assessment`.
function AssessmentBlock({ inc, allIncidents }: { inc: CrashIncident; allIncidents: CrashIncident[] }) {
  const { t } = useTranslation();
  const a = inc.assessment as CrashAssessment; // only rendered when present
  const research = a.next_step.research_only;
  return (
    <div className={`bb-assess bb-assess-${a.strength}`}>
      <div className="bb-assess-head">
        <span className="bb-assess-label">{t("gaming.blackBox.whatThisPointsTo")}</span>
        <span className={`bb-strength bb-strength-${a.strength}`}>
          {t(`gaming.blackBox.strengthLabel.${a.strength}`)}
        </span>
      </div>
      <p className="bb-assess-line">
        {a.beyond_us
          ? t("gaming.blackBox.assessLinePreBeyond")
          : t("gaming.blackBox.assessLinePreConsistent")}{" "}
        <strong>{a.consistent_with}</strong>
        {a.beyond_us ? (
          <>
            {" "}
            {t("gaming.blackBox.assessLinePostBeyond")}
          </>
        ) : (
          "."
        )}
      </p>
      <ul className="bb-assess-evidence">
        {a.evidence.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <div className={`bb-nextstep${research ? " bb-nextstep-research" : ""}`}>
        <span className="bb-nextstep-tag">
          {research ? t("gaming.blackBox.worthResearching") : t("gaming.blackBox.safeNextStep")}
        </span>
        <p className="bb-nextstep-headline">{a.next_step.headline}</p>
        <p className="bb-nextstep-detail">{a.next_step.detail}</p>
      </div>
      <ResolutionFeedback inc={inc} allIncidents={allIncidents} />
    </div>
  );
}

// Compy Care Tier 1 — the signed known-issue write-up.
//
// Every string rendered here comes from the catalog entry that was signature-verified before it
// reached the frontend; this component contributes structure and labels, never a claim. Two rules
// it exists to keep visible:
//
//   1. WHOSE WORDS. It is a section of its own, headed and attributed, so a user can always tell
//      the publisher's write-up from Compy's own reading in the block above it. Merging them would
//      be the cheapest possible way to launder an outside claim into a Compy one.
//   2. WHAT COMPY COULD CHECK. `matched_known_issue` means every required fact was readable;
//      `possible_known_issue` means some were not, and it says so rather than rounding up.
//
// `evidence_refs` arrive as KEYS ("faulting_module"), never as this machine's values — the wire
// stays safe to log or show a friend, and the plain-English label is looked up here.
function KnownIssueBlock({ m }: { m: CaseIntelligenceMatch }) {
  const { t } = useTranslation();
  const matched = m.level === "matched_known_issue";
  // A failed `openUrl` used to be swallowed: the user clicked "Open the write-up" and nothing
  // happened, which is exactly what a broken button looks like. Rare (it needs a machine with no
  // registered browser handler), but the failure mode is the worst kind — the app looks broken and
  // the user has no way to reach the page. The recovery is the URL itself, shown to be copied.
  const [sourceUnopenable, setSourceUnopenable] = useState(false);
  return (
    <section className="bb-known" aria-label={t("gaming.blackBox.knownIssue.label")}>
      <div className="bb-known-head">
        <span className="bb-known-label">{t("gaming.blackBox.knownIssue.label")}</span>
      </div>
      <p className="bb-known-line">{matched
          ? t("gaming.blackBox.knownIssue.matchedLine")
          : t("gaming.blackBox.knownIssue.possibleLine")}</p>

      <p className="bb-known-title">{m.title}</p>
      <p className="bb-known-summary">{m.summary}</p>

      {m.evidence_refs.length > 0 && (
        <div className="bb-known-lined-up">
          <span className="bb-known-sublabel">{t("gaming.blackBox.knownIssue.linedUpLabel")}</span>
          <ul className="bb-known-evidence">
            {m.evidence_refs.map((ref) => (
              // The static head stays a full dotted path so `orphan-key-guard` can harvest the
              // prefix — the shape SupportEvidence.tsx uses, and the only one that scan can see.
              // defaultValue: a catalog signed by a newer schema could name a fact this build has no
              // label for. Showing the raw key would be worse than showing nothing, so it is dropped.
              <li key={ref}>
                {t(`gaming.blackBox.knownIssue.evidenceKey.${ref}`, { defaultValue: "" })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.next_steps.length > 0 && (
        <div className="bb-known-steps">
          <span className="bb-known-sublabel">{t("gaming.blackBox.knownIssue.stepsLabel")}</span>
          {m.next_steps.map((step, i) => (
            <div
              key={i}
              className={`bb-known-step${step.research_only ? " bb-known-step-research" : ""}`}
            >
              <span className="bb-known-step-tag">
                {step.research_only
                  ? t("gaming.blackBox.worthResearching")
                  : t("gaming.blackBox.safeNextStep")}
              </span>
              <p className="bb-known-step-headline">{step.headline}</p>
              <p className="bb-known-step-detail">{step.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* The caveats ride WITH the advice, never in a collapsed panel of their own — advice shown
          without the line that says when not to take it is the omission the honesty rules exist for. */}
      {m.contraindications.length > 0 && (
        <div className="bb-known-caution">
          <span className="bb-known-sublabel">{t("gaming.blackBox.knownIssue.cautionLabel")}</span>
          <ul className="bb-known-caution-list">
            {m.contraindications.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bb-known-source">
        {/* A button, not a link: the URL leaves the app only on a click, and it goes to the user's
            own browser rather than anywhere the webview could follow it. The URL is the catalog's
            own, already checked against the compiled origin allowlist during verification. */}
        {sourceUnopenable ? (
          <span className="bb-known-source-fallback">
            {t("gaming.blackBox.knownIssue.sourceUnopenable")}{" "}
            <span className="bb-known-source-url">{m.source_url}</span>
          </span>
        ) : (
          <button
            className="bb-known-source-btn"
            onClick={() => {
              openUrl(m.source_url).catch(() => setSourceUnopenable(true));
            }}
          >
            {t("gaming.blackBox.knownIssue.sourceButton")}
          </button>
        )}
        <span className="bb-known-provenance">
          {t("gaming.blackBox.knownIssue.publishedOn", { date: m.source_updated_at })} ·{" "}
          {t("gaming.blackBox.knownIssue.catalogVersion", { version: m.catalog_version })}
        </span>
      </div>
      <p className="bb-known-attribution">{t("gaming.blackBox.knownIssue.attribution")}</p>
    </section>
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
  const { t } = useTranslation();
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
        <span className="bb-resolved-mark">{t("gaming.blackBox.resolvedMark")}</span>
        {res && <span className={`bb-resolved-since bb-resolved-${res.status}`}>{res.text}</span>}
      </div>
    );
  }
  if (mark?.vote === "no") {
    return <p className="bb-helpful bb-helpful-done">{t("gaming.blackBox.thanksNoted")}</p>;
  }
  return (
    <div className="bb-helpful">
      <span className="bb-helpful-q">{t("gaming.blackBox.didThisHelpQuestion")}</span>
      <button className="bb-helpful-btn" onClick={() => cast("yes")}>
        {t("gaming.blackBox.yesButton")}
      </button>
      <button className="bb-helpful-btn" onClick={() => cast("no")}>
        {t("gaming.blackBox.noButton")}
      </button>
    </div>
  );
}
