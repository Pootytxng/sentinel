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
} from "../types";
import { useIntelligenceFlag } from "../design/use-hud";
import { useExpertView } from "../design/use-expert-view";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";

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
          {t("optimize.whatChangedPanel.confidenceTag", { level: h.confidence })}
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
          low1: r.low1_fps.toFixed(1),
          avg: r.avg_fps.toFixed(1),
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
      <span className="wcp-section-label">{t("optimize.whatChangedPanel.evidenceGraph")}</span>
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
      <span className="wcp-compare-band">{comparabilityLabel(c.verdict, t)}</span>
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
      <span className="wcp-section-label">{t("optimize.whatChangedPanel.howComparable")}</span>
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
// straight from persisted records.
function WhatChangedReportView({
  outcome,
  expert,
  arcV2,
  headline,
}: {
  outcome: WhatChangedOutcome;
  expert: boolean;
  arcV2: boolean;
  /** Overrides the "vs your previous X session" head line — the investigator names both picks. */
  headline?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (outcome.kind === "unavailable") {
    return (
      <div className={`wcp wcp-unavailable${arcV2 ? " arc-v2" : ""}`}>
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

  return (
    <div className={`wcp wcp-${r.verdict}${arcV2 ? " arc-v2" : ""}`}>
      <div className="wcp-head">
        <span>
          {headline ?? t("optimize.whatChangedPanel.headlineDefault", { game: r.game })}
        </span>
        <span className="wcp-nf">
          {t("optimize.whatChangedPanel.noiseFloor", { pct: r.noise_floor_pct.toFixed(0) })}
        </span>
      </div>

      <h3 className="wcp-headline">{r.headline}</h3>

      <ComparabilityBanner c={r.comparability} />

      {r.confounded && r.notes.length > 0 && <p className="wcp-note">{r.notes[0]}</p>}

      {showLeader && (
        <>
          <div className="wcp-section-label">
            {t("optimize.whatChangedPanel.mostLikelyCause")}
          </div>
          <HypothesisBlock h={leader} lead />
        </>
      )}

      {r.next_action && (
        <p className="wcp-next">
          <span className="wcp-section-label">{t("optimize.whatChangedPanel.nextTest")}</span>{" "}
          {r.next_action}
        </p>
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
            <span className="wcp-section-label">
              {t("optimize.whatChangedPanel.betweenTheseSessions")}
            </span>
            {r.events_between.length === 0 ? (
              <p className="wcp-between-none">
                {t("optimize.whatChangedPanel.nothingRecordedBetween")}
              </p>
            ) : (
              <ul>
                {r.events_between.map((ev) => (
                  <li key={ev.id}>
                    {ev.summary}
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
              <span className="wcp-section-label">{t("optimize.whatChangedPanel.alsoPossible")}</span>
              {others.map((h) => (
                <HypothesisBlock h={h} key={h.id} lead={false} />
              ))}
            </div>
          )}

          {r.unknowns.length > 0 && (
            <div className="wcp-unknowns">
              <span className="wcp-section-label">
                {t("optimize.whatChangedPanel.whatCompyCantKnow")}
              </span>
              <ul>
                {r.unknowns.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {expert && r.ruled_out.length > 0 && (
            <div className="wcp-ruled-out">
              <span className="wcp-section-label">{t("optimize.whatChangedPanel.ruledOut")}</span>
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

export function WhatChangedPanel({ startedAt, arcV2 = false }: { startedAt: string; arcV2?: boolean }) {
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

  return <WhatChangedReportView outcome={outcome} expert={expert} arcV2={arcV2} />;
}

// ─── Intelligence Phase 2 — good-vs-bad session investigator (Monitor) ─────────
// The §4D "what changed between the last good session and the first bad session?" workflow, made
// interactive: pick any two sessions of the same game and the SAME deterministic engine
// (what_changed_between) explains the delta. Expert-view only — it's a deliberate investigation
// tool, not the everyday debrief. Read-only; the picks come from already-recorded sessions.

type GameGroup = { game: string; sessions: SessionSummary[] };

export function SessionInvestigator({
  sessions,
  arcV2 = false,
}: {
  sessions: SessionSummary[];
  arcV2?: boolean;
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

  // Keep the selections valid as the group set changes (game list, default picks).
  useEffect(() => {
    if (!active) {
      setGame("");
      setBaselineAt("");
      setCurrentAt("");
      return;
    }
    if (game !== active.game) setGame(active.game);
    const starts = active.sessions.map((s) => s.started_at);
    if (!starts.includes(baselineAt)) setBaselineAt(starts[0]);
    if (!starts.includes(currentAt)) setCurrentAt(starts[starts.length - 1]);
  }, [active, game, baselineAt, currentAt]);

  if (!on || !expert || groups.length === 0) return null;

  const run = () => {
    if (!baselineAt || !currentAt) return;
    setBusy(true);
    setOutcome(null);
    invoke<WhatChangedOutcome>("what_changed_between", {
      baselineStartedAt: baselineAt,
      currentStartedAt: currentAt,
    })
      .then((o) => setOutcome(o))
      .catch(() => setOutcome(null)) // fetch failure → no report; never a fabricated one
      .finally(() => setBusy(false));
  };

  const optLabel = (s: SessionSummary) =>
    t("optimize.whatChangedPanel.sessionLine.main", {
      when: fmtWhen(s.started_at, expert),
      low1: s.low1_fps_est.toFixed(1),
      avg: s.avg_fps.toFixed(1),
    });

  const sameSession = baselineAt === currentAt;

  return (
    <div className={`wcp-investigate${arcV2 ? " arc-v2" : ""}`}>
      <div className="wcp-inv-head">
        <span className="wcp-tag">{t("optimize.whatChangedPanel.investigateTag")}</span>
        <span className="wcp-inv-sub">
          {t("optimize.whatChangedPanel.compareAnyTwo", { game: active?.game })}
        </span>
      </div>

      <div className="wcp-inv-controls">
        {groups.length > 1 && (
          <label className="wcp-inv-field">
            <span>{t("optimize.whatChangedPanel.gameLabel")}</span>
            <select value={game} onChange={(e) => setGame(e.target.value)}>
              {groups.map((g) => (
                <option value={g.game} key={g.game}>
                  {g.game} ({g.sessions.length})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="wcp-inv-field">
          <span>{t("optimize.whatChangedPanel.baselineGoodLabel")}</span>
          <select value={baselineAt} onChange={(e) => setBaselineAt(e.target.value)}>
            {active?.sessions.map((s) => (
              <option value={s.started_at} key={s.started_at}>
                {optLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="wcp-inv-field">
          <span>{t("optimize.whatChangedPanel.compareSuspectLabel")}</span>
          <select value={currentAt} onChange={(e) => setCurrentAt(e.target.value)}>
            {active?.sessions.map((s) => (
              <option value={s.started_at} key={s.started_at}>
                {optLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="wcp-inv-run"
          onClick={run}
          disabled={busy || sameSession || !baselineAt || !currentAt}
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
            arcV2={arcV2}
            headline={t("optimize.whatChangedPanel.headlineBetween")}
          />
        </div>
      )}
    </div>
  );
}
