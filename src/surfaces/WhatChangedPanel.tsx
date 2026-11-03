import { Term } from "../design/Term";
import { withTerms } from "../design/with-terms";
import { ConfidenceWord } from "../design/ConfidenceWord";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  WhatChangedOutcome,
  IntelHypothesis,
  IntelSessionRef,
  EvidenceGraph,
  EvidenceNodeType,
  EvidenceRelation,
  SessionSummary,
  Comparability,
  SessionComparability,
  AppliedChange,
} from "../types";
import { useIntelligenceFlag } from "../design/use-hud";
import { useExpertView } from "../design/use-expert-view";
import { SectionLabel, VerdictBand, COMPARABILITY_TONE } from "./measurement-chrome";
import { Picker } from "../design/Picker";
import { knownFps } from "../lib/session-metrics";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import { eventText } from "./event-text";

// Intelligence Phase 1 — the "What changed?" panel (Monitor session debrief slot). Renders the
// deterministic Rust engine's verdict for THIS session vs the previous session of the same game:
// meaningful metric deltas, what happened in between, most likely cause with its evidence AND what
// argues against it, and the next test. Additive beside ComparisonCard (which keeps the rec-scoped
// A/B story). Read-only; every sentence comes from persisted records. Flag compy_intelligence
// (default ON) — "0" renders nothing, restoring the prior tree byte-identical.
//
// Intelligence Phase 2 adds two Expert-view affordances on the SAME engine + flag: the §4C evidence
// graph (an inspectable re-projection of the report, no new data) rendered inside the working, and
// SessionInvestigator — the good-vs-bad picker that compares any two same-game sessions via
// what_changed_between. Both stay behind Expert view so the everyday face remains plain-language.

const fmtWhen = (iso: string, expert: boolean): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // unreadable → show the raw stamp, never guess
  return expert
    ? d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const sign = (n: number) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

// One hypothesis, in §7 language: title + confidence band, Evidence, What argues against it.
function HypothesisBlock({ h, lead }: { h: IntelHypothesis; lead: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`wcp-hypo${lead ? " wcp-hypo-lead" : ""}`}>
      <div className="wcp-hypo-head">
        <span className="wcp-hypo-title">{h.title}</span>
        <span className="wcp-hypo-conf">
          <ConfidenceWord band={h.confidence} />
        </span>
      </div>
      {h.supporting_evidence.length > 0 && (
        <div className="wcp-evi">
          <span className="wcp-evi-label">{t("optimize.whatChangedPanel.evidence")}</span>
          <ul>
            {h.supporting_evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {h.contradicting_evidence.length > 0 && (
        <div className="wcp-evi">
          <span className="wcp-evi-label">{t("optimize.whatChangedPanel.arguesAgainst")}</span>
          <ul>
            {h.contradicting_evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {h.missing_evidence.length > 0 && (
        <div className="wcp-evi wcp-evi-missing">
          <span className="wcp-evi-label">{t("optimize.whatChangedPanel.notRecorded")}</span>
          <ul>
            {h.missing_evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// A session's FPS as this panel prints it: one decimal when measured, the panel's own "not measured"
// when the record carries the sampler's 0, a negative, a non-finite value or nothing (#671). Never
// "0.0", never "NaN", and never a throw on a missing field.
function fpsLabel(v: unknown, t: TFunction): string {
  const fps = knownFps(v);
  return fps != null ? fps.toFixed(1) : t("optimize.whatChangedPanel.sessionLine.notMeasured");
}

function SessionLine({
  tag,
  r,
  expert,
}: {
  tag: string;
  r: IntelSessionRef;
  expert: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="wcp-session">
      <span className="wcp-session-tag">{tag}</span>
      <span>
        {t("optimize.whatChangedPanel.sessionLine.main", {
          when: fmtWhen(r.started_at, expert),
          low1: fpsLabel(r.low1_fps, t),
          avg: fpsLabel(r.avg_fps, t),
        })}
        {expert &&
          t("optimize.whatChangedPanel.sessionLine.samplesSuffix", {
            samples: r.samples,
            minutes: Math.round(r.duration_secs / 60),
          })}
        {expert &&
          r.gaming_mode_active != null &&
          (r.gaming_mode_active
            ? t("optimize.whatChangedPanel.sessionLine.gamingOn")
            : t("optimize.whatChangedPanel.sessionLine.gamingOff"))}
      </span>
    </div>
  );
}

// §4C node/edge vocabularies → the plain words the everyday user would use. Kept a static map (enum
// key → i18n key suffix) so a new backend variant surfaces as a TS error here rather than a silent
// raw kebab string on screen; the display text itself lives in the i18n JSON.
const NODE_TYPE_KEY: Record<EvidenceNodeType, string> = {
  symptom: "symptom",
  metric: "metric",
  event: "event",
  driver: "driver",
  "os-update": "osUpdate",
  "compy-change": "compyChange",
  "external-change": "externalChange",
  hypothesis: "hypothesis",
  experiment: "experiment",
  conclusion: "conclusion",
};
const nodeTypeLabel = (n: EvidenceNodeType, t: TFunction): string =>
  t(`optimize.whatChangedPanel.nodeType.${NODE_TYPE_KEY[n]}`);

const RELATION_KEY: Record<EvidenceRelation, string> = {
  supports: "supports",
  "correlates-with": "correlatesWith",
  "occurred-before": "occurredBefore",
  "requires-verification": "requiresVerification",
  "ruled-out-by": "ruledOutBy",
};
const relationLabel = (r: EvidenceRelation, t: TFunction): string =>
  t(`optimize.whatChangedPanel.relation.${RELATION_KEY[r]}`);

// §4C evidence graph — Expert view only. A deterministic, inspectable re-projection of the report
// above (the wrapper builds it from the finished report; it adds no data). We render it as a plain
// node list + link list — every node cites where it came from, so an expert can trace each claim
// back to a record. The directive is explicit: the normal view stays plain-language; only the
// Expert view exposes the detailed graph.
function EvidenceGraphBlock({ graph }: { graph: EvidenceGraph }) {
  const { t } = useTranslation();
  if (graph.nodes.length === 0) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const labelFor = (id: string) => byId.get(id)?.label ?? id;
  return (
    <div className="wcp-graph">
      <SectionLabel>{t("optimize.whatChangedPanel.evidenceGraph")}</SectionLabel>
      <p className="wcp-graph-note">{t("optimize.whatChangedPanel.evidenceGraphNote")}</p>
      <ul className="wcp-graph-nodes">
        {graph.nodes.map((n) => (
          <li className="wcp-graph-node" key={n.id}>
            <span className={`wcp-graph-kind wcp-graph-kind-${n.node_type}`}>
              {nodeTypeLabel(n.node_type, t)}
            </span>
            <span className="wcp-graph-label">{n.label}</span>
            <span className="wcp-graph-meta">
              {n.reliability} · {n.source_reference}
            </span>
          </li>
        ))}
      </ul>
      {graph.edges.length > 0 && (
        <ul className="wcp-graph-edges">
          {graph.edges.map((e, i) => (
            <li className="wcp-graph-edge" key={`${e.from}|${e.to}|${e.relation}|${i}`}>
              <span className="wcp-graph-edge-line">
                <span className="wcp-graph-from">{labelFor(e.from)}</span>{" "}
                <span className="wcp-graph-rel">{relationLabel(e.relation, t)}</span>{" "}
                <span className="wcp-graph-to">{labelFor(e.to)}</span>
              </span>
              {e.explanation && <span className="wcp-graph-why">{e.explanation}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// §F/§G comparability — how far two sessions may HONESTLY be compared. The four verdicts map to the
// plain-language bands METHODOLOGY §11 states up front, so the reader sees the comparison's basis
// before any cause talk. Static map (enum key → i18n key suffix): a new backend variant surfaces as
// a TS error here, never a raw kebab band on screen.
const COMPARABILITY_KEY: Record<Comparability, string> = {
  comparable: "comparable",
  partial: "partial",
  "not-comparable": "notComparable",
  unknown: "unknown",
};
const comparabilityLabel = (c: Comparability, t: TFunction): string =>
  t(`optimize.whatChangedPanel.comparability.${COMPARABILITY_KEY[c]}`);

// Expert-only confidence-ceiling wording (a BAND, never a number — METHODOLOGY §10). Static map
// (enum key → i18n key suffix): a new backend variant surfaces as a TS error here.
const CONF_LIMIT_KEY: Record<SessionComparability["confidence_limit"], string> = {
  unknown: "unknown",
  low: "low",
  medium: "medium",
  high: "high",
};
const confLimitLabel = (c: SessionComparability["confidence_limit"], t: TFunction): string =>
  t(`optimize.whatChangedPanel.confLimit.${CONF_LIMIT_KEY[c]}`);

// The comparison-basis banner (Tasks F + G). Stated up front, before the headline's cause talk:
// the verdict band + WHY (the prose `reasons`, plus `missing_context` — the conditions we couldn't
// confirm matched, which ARE the "why" for a missing-driven Partial/Unknown and must never be
// silently dropped). The terse before→after values live one expand down in ComparabilityDetail, so
// this stays prose and that stays values — complementary, not a repeat.
function ComparabilityBanner({ c }: { c: SessionComparability }) {
  const { t } = useTranslation();
  const why = [...c.reasons, ...c.missing_context];
  return (
    <div className={`wcp-compare wcp-compare-${c.verdict}`}>
      <VerdictBand tone={COMPARABILITY_TONE[c.verdict]}>
        {comparabilityLabel(c.verdict, t)}
      </VerdictBand>
      {why.length > 0 && (
        <ul className="wcp-compare-why">
          {why.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The finer comparability specifics, inside "the working": the exact conditions that differed
// (before → after values, distinct granularity from the banner's prose), the metric axes both
// captures actually recorded (the only ones a comparison may honestly touch), and — Expert only —
// the confidence ceiling this comparability imposes. Renders nothing when there's nothing to add.
function ComparabilityDetail({ c, expert }: { c: SessionComparability; expert: boolean }) {
  const { t } = useTranslation();
  if (c.changed_context.length === 0 && c.shared_metrics.length === 0 && !expert) return null;
  return (
    <div className="wcp-compare-detail">
      <SectionLabel>{t("optimize.whatChangedPanel.howComparable")}</SectionLabel>
      {c.changed_context.length > 0 && (
        <div className="wcp-compare-row">
          <span className="wcp-compare-key">{t("optimize.whatChangedPanel.whatDiffered")}</span>
          <span className="wcp-compare-val">{c.changed_context.join(" · ")}</span>
        </div>
      )}
      {c.shared_metrics.length > 0 && (
        <div className="wcp-compare-row">
          <span className="wcp-compare-key">{t("optimize.whatChangedPanel.comparedOn")}</span>
          <span className="wcp-compare-val">{c.shared_metrics.join(", ")}</span>
        </div>
      )}
      {expert && (
        <div className="wcp-compare-row">
          <span className="wcp-compare-key">
            {t("optimize.whatChangedPanel.confidenceCappedAt")}
          </span>
          <span className="wcp-compare-val">{confLimitLabel(c.confidence_limit, t)}</span>
        </div>
      )}
    </div>
  );
}

// The full report render, shared by the auto for-this-session panel and the investigator's
// good-vs-bad comparison. `outcome` is the engine's own union — unavailable renders the honest
// one-line reason, a report renders the verdict + working. No fabrication path: both faces come
// straight from persisted records. Exported for the Care view's stutter comparison (P6-stutter,
// StutterCompare.tsx), which reuses it rather than drawing a second report.
export function WhatChangedReportView({
  outcome,
  expert,
  headline,
  causeTag,
  activeChangeFor,
  onRollback,
  busy = false,
  hideNextAction = false,
}: {
  outcome: WhatChangedOutcome;
  expert: boolean;
  /** Overrides the "vs your previous X session" head line — the investigator names both picks. */
  headline?: string;
  /** P6-stutter: a tag set beside each cause heading ("not proven cause"), so a surface that must
   *  not read as a diagnosis can say so on the cause itself. Absent = unchanged. */
  causeTag?: string;
  /** BACKLOG:236 — resolves `next_action_rec_id` against the LIVE ledger. All three below are
   *  optional together: absent (or no live row) → the next-test sentence renders alone, exactly as
   *  before. The engine's own doc comment fixes the destination: the Trust Ledger, never the bench. */
  activeChangeFor?: (recId: string) => AppliedChange | undefined;
  onRollback?: (c: AppliedChange) => Promise<unknown>;
  busy?: boolean;
  /** P6-next: the next-test sentence is shown as the Care view's one next step, above; it is not
   *  repeated here. The rollback affordance (when resolvable) stays. Absent = unchanged. */
  hideNextAction?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (outcome.kind === "unavailable") {
    return (
      <div className={`wcp wcp-unavailable`}>
        <span className="wcp-tag">{t("optimize.whatChangedPanel.whatChangedTag")}</span>{" "}
        {outcome.reason}
      </div>
    );
  }

  const r = outcome;
  const leader = r.leading_hypotheses[0] ?? null;
  const others = r.leading_hypotheses.slice(1);
  // The headline already names the leader for the plain-language face; the expanded block
  // below shows its evidence. Confounded reports refuse a single cause — no leader block.
  // Not-comparable reports also refuse a cause: the ComparabilityBanner is the sole owner of
  // the "why" (its reasons + changed_context), so a "Most likely cause" card here would
  // triple-state the same hardware/context break the banner already carries. The backend
  // leaves leading_hypotheses empty on that path (intelligence.rs different-rig gate); this
  // invariant defends the surface even if a future producer ever populates one.
  const notComparable = r.comparability.verdict === "not-comparable";
  const showLeader =
    !r.confounded && !notComparable && leader != null && leader.id !== "insufficient-evidence";

  // BACKLOG:236, Ledger half. The engine hands over a rec id only where it READ one still-active
  // apply row off the Trust Ledger for this window (intelligence.rs); the confounded path never
  // carries one. Here that id is resolved against the LIVE ledger, so the button reflects the
  // machine as it is now, not the snapshot the report was built from — and after the rollback lands
  // it stops resolving and the button disappears on its own. Anything missing (no id, no live row,
  // no handler) leaves the sentence standing by itself, which is why it names its own destination.
  const rollbackTarget =
    r.next_action_rec_id && activeChangeFor && onRollback
      ? activeChangeFor(r.next_action_rec_id)
      : undefined;

  return (
    <div className={`wcp wcp-${r.verdict}`}>
      <div className="wcp-head">
        <span>
          {headline ?? t("optimize.whatChangedPanel.headlineDefault", { game: r.game })}
        </span>
        <span className="wcp-nf">
          <Term id="noise-floor">{t("optimize.whatChangedPanel.noiseFloor", { pct: r.noise_floor_pct.toFixed(0) })}</Term>
        </span>
      </div>

      <h3 className="wcp-headline">{withTerms(r.headline)}</h3>

      <ComparabilityBanner c={r.comparability} />

      {r.confounded && r.notes.length > 0 && <p className="wcp-note">{r.notes[0]}</p>}

      {showLeader && (
        <>
          <SectionLabel>{t("optimize.whatChangedPanel.mostLikelyCause")}</SectionLabel>
          {causeTag && <span className="wcp-cause-tag">{causeTag}</span>}
          <HypothesisBlock h={leader} lead />
        </>
      )}

      {r.next_action && (!hideNextAction || rollbackTarget) && (
        <div className="wcp-next-block">
          {!hideNextAction && (
            <p className="wcp-next">
              <SectionLabel>{t("optimize.whatChangedPanel.nextTest")}</SectionLabel>{" "}
              {r.next_action}
            </p>
          )}
          {rollbackTarget && (
            <button
              type="button"
              className="wcp-next-rollback"
              disabled={busy}
              onClick={() => {
                void onRollback!(rollbackTarget);
              }}
            >
              {busy
                ? t("optimize.whatChangedPanel.rollingBackEllipsis")
                : t("optimize.whatChangedPanel.rollBackNamed", {
                    title: rollbackTarget.rec_title,
                  })}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        className="wcp-detail-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>
          {open
            ? t("optimize.whatChangedPanel.hideTheWorking")
            : t("optimize.whatChangedPanel.showTheWorking")}
        </span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="wcp-detail">
          <div className="wcp-sessions">
            <SessionLine tag={t("optimize.whatChangedPanel.tagBaseline")} r={r.baseline} expert={expert} />
            <SessionLine tag={t("optimize.whatChangedPanel.tagThisOne")} r={r.current} expert={expert} />
            <div className="wcp-gap">
              {t("optimize.whatChangedPanel.gapDays", { count: r.gap_days })}
            </div>
          </div>

          <ComparabilityDetail c={r.comparability} expert={expert} />

          {r.observations.length > 0 && (
            <div className="wcp-obs">
              {r.observations.map((o) => (
                <div className="wcp-obs-row" key={o.metric}>
                  <span className="wcp-obs-metric">{o.metric}</span>
                  <span className="wcp-obs-vals">
                    {o.baseline.toFixed(1)} → {o.current.toFixed(1)} ({sign(o.delta_pct)}%)
                  </span>
                  <span className="wcp-obs-tag">
                    {o.reference_only
                      ? t("optimize.whatChangedPanel.referenceOnly")
                      : o.meaningful
                        ? t("optimize.whatChangedPanel.pastNoiseFloor")
                        : t("optimize.whatChangedPanel.insideNoiseFloor")}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="wcp-between">
            <SectionLabel>{t("optimize.whatChangedPanel.betweenTheseSessions")}</SectionLabel>
            {r.events_between.length === 0 ? (
              <p className="wcp-between-none">
                {t("optimize.whatChangedPanel.nothingRecordedBetween")}
              </p>
            ) : (
              <ul>
                {r.events_between.map((ev) => (
                  <li key={ev.id}>
                    {eventText(ev, t)}
                    <span className="wcp-between-when">
                      {" "}
                      · {ev.observed_between ? t("optimize.whatChangedPanel.observedByPrefix") : ""}
                      {fmtWhen(ev.timestamp, expert)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {others.length > 0 && (
            <div className="wcp-others">
              <SectionLabel>{t("optimize.whatChangedPanel.alsoPossible")}</SectionLabel>
              {causeTag && <span className="wcp-cause-tag">{causeTag}</span>}
              {others.map((h) => (
                <HypothesisBlock h={h} key={h.id} lead={false} />
              ))}
            </div>
          )}

          {r.unknowns.length > 0 && (
            <div className="wcp-unknowns">
              <SectionLabel>{t("optimize.whatChangedPanel.whatCompyCantKnow")}</SectionLabel>
              <ul>
                {r.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {expert && r.ruled_out.length > 0 && (
            <div className="wcp-ruled-out">
              <SectionLabel>{t("optimize.whatChangedPanel.ruledOut")}</SectionLabel>
              {r.ruled_out.map((h) => (
                <HypothesisBlock h={h} key={h.id} lead={false} />
              ))}
            </div>
          )}

          {expert && <EvidenceGraphBlock graph={r.evidence_graph} />}

          {expert && <p className="wcp-method">{r.method_note}</p>}
        </div>
      )}
    </div>
  );
}

export function WhatChangedPanel({
  startedAt,
  activeChangeFor,
  onRollback,
  busy = false,
}: {
  startedAt: string;
  /** BACKLOG:236 — optional together; absent = the next-test sentence renders alone (unchanged). */
  activeChangeFor?: (recId: string) => AppliedChange | undefined;
  onRollback?: (c: AppliedChange) => Promise<unknown>;
  busy?: boolean;
}) {
  const on = useIntelligenceFlag();
  const expert = useExpertView();
  const [outcome, setOutcome] = useState<WhatChangedOutcome | null>(null);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    invoke<WhatChangedOutcome>("what_changed_for_session", { startedAt })
      .then((o) => {
        if (alive) setOutcome(o);
      })
      .catch(() => {}); // fetch failure → no panel; never a fabricated report
    return () => {
      alive = false;
    };
  }, [on, startedAt]);

  if (!on || !outcome) return null;

  return (
    <WhatChangedReportView
      outcome={outcome}
      expert={expert}
      activeChangeFor={activeChangeFor}
      onRollback={onRollback}
      busy={busy}
    />
  );
}

// ─── Intelligence Phase 2 — good-vs-bad session investigator (Monitor) ─────────
// The §4D "what changed between the last good session and the first bad session?" workflow, made
// interactive: pick any two sessions of the same game and the SAME deterministic engine
// (what_changed_between) explains the delta. Expert-view only — it's a deliberate investigation
// tool, not the everyday debrief. Read-only; the picks come from already-recorded sessions.

type GameGroup = { game: string; sessions: SessionSummary[] };

export function SessionInvestigator({
  sessions,
  activeChangeFor,
  onRollback,
  rollbackBusy = false,
}: {
  sessions: SessionSummary[];
  /** BACKLOG:236 — optional together; absent = the next-test sentence renders alone (unchanged).
   *  Named `rollbackBusy` because this surface already owns a local `busy` for its OWN compare
   *  fetch; the two are unrelated and must never gate each other. */
  activeChangeFor?: (recId: string) => AppliedChange | undefined;
  onRollback?: (c: AppliedChange) => Promise<unknown>;
  rollbackBusy?: boolean;
}) {
  const { t } = useTranslation();
  const on = useIntelligenceFlag();
  const expert = useExpertView();

  // Group by game (process_name), keep only games with ≥2 sessions — nothing to compare otherwise.
  // Sessions oldest→newest so "baseline" defaults to the earlier one and "current" to the later.
  const groups = useMemo<GameGroup[]>(() => {
    const by = new Map<string, SessionSummary[]>();
    for (const s of sessions) {
      const g = s.process_name;
      if (!g) continue;
      (by.get(g) ?? by.set(g, []).get(g)!).push(s);
    }
    const out: GameGroup[] = [];
    for (const [game, list] of by) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.started_at.localeCompare(b.started_at));
      out.push({ game, sessions: sorted });
    }
    out.sort((a, b) => a.game.localeCompare(b.game));
    return out;
  }, [sessions]);

  const [game, setGame] = useState<string>("");
  const [baselineAt, setBaselineAt] = useState<string>("");
  const [currentAt, setCurrentAt] = useState<string>("");
  const [outcome, setOutcome] = useState<WhatChangedOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const active = groups.find((g) => g.game === game) ?? groups[0] ?? null;
  // What each Picker SHOWS is derived from `active`, not read straight off the raw state. The
  // effect below repairs the state, but it runs after paint: with the raw state a first render
  // (and every render where a group set changed) draws an empty trigger for a frame. The native
  // `<select>` this replaced never showed that, because a browser falls back to the first option
  // when `value` matches none — the Picker deliberately shows its placeholder instead, so the
  // fallback has to be written down here rather than inherited from the platform.
  const starts = active?.sessions.map((s) => s.started_at) ?? [];
  const shownGame = active?.game ?? "";
  const shownBaseline = starts.includes(baselineAt) ? baselineAt : (starts[0] ?? "");
  const shownCurrent = starts.includes(currentAt)
    ? currentAt
    : (starts[starts.length - 1] ?? "");

  // Keep the selections valid as the group set changes (game list, default picks).
  useEffect(() => {
    if (!active) {
      setGame("");
      setBaselineAt("");
      setCurrentAt("");
      return;
    }
    if (game !== active.game) setGame(active.game);
    if (baselineAt !== shownBaseline) setBaselineAt(shownBaseline);
    if (currentAt !== shownCurrent) setCurrentAt(shownCurrent);
  }, [active, game, baselineAt, currentAt, shownBaseline, shownCurrent]);

  if (!on || !expert || groups.length === 0) return null;

  // Compares what the user is LOOKING AT. The raw state is one render behind after a group switch,
  // so reading it here would let the button's enabled-ness — and, in that window, the comparison
  // itself — belong to the previous game while the pickers already show the new one.
  const run = () => {
    if (!shownBaseline || !shownCurrent) return;
    setBusy(true);
    setOutcome(null);
    invoke<WhatChangedOutcome>("what_changed_between", {
      baselineStartedAt: shownBaseline,
      currentStartedAt: shownCurrent,
    })
      .then((o) => setOutcome(o))
      .catch(() => setOutcome(null)) // fetch failure → no report; never a fabricated one
      .finally(() => setBusy(false));
  };

  const optLabel = (s: SessionSummary) =>
    t("optimize.whatChangedPanel.sessionLine.main", {
      when: fmtWhen(s.started_at, expert),
      low1: fpsLabel(s.low1_fps_est, t),
      avg: fpsLabel(s.avg_fps, t),
    });

  const sameSession = shownBaseline === shownCurrent;

  return (
    <div className="wcp-investigate">
      <div className="wcp-inv-head">
        <span className="wcp-tag">{t("optimize.whatChangedPanel.investigateTag")}</span>
        <span className="wcp-inv-sub">
          {t("optimize.whatChangedPanel.compareAnyTwo", { game: active?.game })}
        </span>
      </div>

      <div className="wcp-inv-controls">
        {/* C-10: three native <select>s became Pickers. `<label>` became a plain wrapper with an
            explicit `labelledBy` — implicit label association only reaches real form controls, and
            the Picker's trigger is a button. */}
        {groups.length > 1 && (
          <div className="wcp-inv-field">
            <span id="wcp-inv-game">{t("optimize.whatChangedPanel.gameLabel")}</span>
            <Picker
              labelledBy="wcp-inv-game"
              value={shownGame}
              onChange={setGame}
              options={groups.map((g) => ({ value: g.game, label: `${g.game} (${g.sessions.length})` }))}
            />
          </div>
        )}
        <div className="wcp-inv-field">
          <span id="wcp-inv-baseline">{t("optimize.whatChangedPanel.baselineGoodLabel")}</span>
          <Picker
            labelledBy="wcp-inv-baseline"
            value={shownBaseline}
            onChange={setBaselineAt}
            options={(active?.sessions ?? []).map((s) => ({
              value: s.started_at,
              label: optLabel(s),
            }))}
          />
        </div>
        <div className="wcp-inv-field">
          <span id="wcp-inv-current">{t("optimize.whatChangedPanel.compareSuspectLabel")}</span>
          <Picker
            labelledBy="wcp-inv-current"
            value={shownCurrent}
            onChange={setCurrentAt}
            options={(active?.sessions ?? []).map((s) => ({
              value: s.started_at,
              label: optLabel(s),
            }))}
          />
        </div>
        <button
          type="button"
          className="wcp-inv-run"
          onClick={run}
          disabled={busy || sameSession || !shownBaseline || !shownCurrent}
        >
          {busy
            ? t("optimize.whatChangedPanel.comparingEllipsis")
            : t("optimize.whatChangedPanel.compareButton")}
        </button>
      </div>

      {sameSession && (
        <p className="wcp-inv-hint">{t("optimize.whatChangedPanel.pickTwoDifferentSessions")}</p>
      )}

      {outcome && (
        <div className="wcp-inv-result">
          <WhatChangedReportView
            outcome={outcome}
            expert={expert}
            headline={t("optimize.whatChangedPanel.headlineBetween")}
            activeChangeFor={activeChangeFor}
            onRollback={onRollback}
            busy={rollbackBusy}
          />
        </div>
      )}
    </div>
  );
}
