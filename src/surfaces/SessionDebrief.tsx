import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import type {
  SessionSummary,
  Priorities,
  Recommendation,
  AppliedChange,
  ComparisonResult,
} from "../types";
import { FpsTrace } from "../design/FpsTrace";
import { Term } from "../design/Term";
import { useConfirm } from "../design/ConfirmDialog";
import { TuningDebrief } from "./TuningDebrief";
import { WhatChangedPanel, SessionInvestigator } from "./WhatChangedPanel";
import { prettyGameName } from "./game-name";
import { type GpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, gradeColor, type Grade } from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { readDisplayRefreshHz } from "../design/theme";
import { displayModeLabel, screenTargetLine } from "../data/display-mode";
import { useExpertView } from "../design/use-expert-view";
import { Depth, ReceiptRow, receiptPct } from "../design/Depth";
import { LessonLine } from "../design/LessonLine";
import { LESSON_KEY, lessonRuleForVerdict } from "./test-summary";
import { knownFps, leftOutSecs, allBackground, leftOutSpan } from "../lib/session-metrics";
import { liveChangeGroups } from "../data/live-changes";
import "../i18n";

// Session debrief cluster — extracted verbatim from App.tsx so it can render in place inside Play
// (halfway-home §1, owner-greenlit). Locked copy unchanged. Styles are global (App.css / arc).

// `label` is a ReactNode so a caller can gloss jargon inline, exactly as DebriefTile does —
// this receipt prints "1% low", and a bare measurement word is a dead end (jargon-term-gloss-guard).
function CmpReceipt({ label, before, after }: { label: ReactNode; before: number; after: number }) {
  const max = Math.max(before, after, 1);
  return (
    <div className="cmp-receipt">
      <span className="cmp-receipt-label">{label}</span>
      <div className="cmp-receipt-bars">
        <div className="cmp-bar cmp-bar-before" style={{ width: `${(before / max) * 100}%` }}>
          <span>{before.toFixed(0)}</span>
        </div>
        <div className="cmp-bar cmp-bar-after" style={{ width: `${(after / max) * 100}%` }}>
          <span>{after.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}

// The comparison verdict card. Replaces the debrief insight box once an armed comparison resolves.
// Null result = neutral (never red): the instrument working. Win = same layout + evidence standard,
// credit split. Regressed = honest, revert-forward.
function ComparisonCard({
  r,
  nextSuspect,
  onRevert,
  onDismiss,
  reverting,
}: {
  r: ComparisonResult;
  nextSuspect: string | null;
  onRevert: () => void;
  onDismiss: () => void;
  reverting: boolean;
}) {
  const { t } = useTranslation();
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  // Only these verdicts are a fair measured comparison — confounded/expired show no numbers.
  const isMeasured =
    r.verdict === "no-change" || r.verdict === "improved" || r.verdict === "regressed";
  // Show the delta in both units — FPS (what you feel) and % (what the noise floor is in).
  // Expert view (spec §2): the raw measured delta at 1 decimal instead of the whole-FPS rounding.
  const expert = useExpertView();
  const dFps = (d: number) => (expert ? Number(d.toFixed(1)) : Math.round(d));
  const dAvgFps = dFps(r.after_avg_fps - r.baseline_avg_fps);
  const dLowFps = dFps(r.after_low1_fps - r.baseline_low1_fps);
  const deltaLine = t("monitor.sessionDebrief.deltaLine", {
    avgSign: sign(dAvgFps),
    avgPct: sign(r.delta_avg_pct),
    lowSign: sign(dLowFps),
    lowPct: sign(r.delta_low1_pct),
    inOut:
      r.verdict === "no-change"
        ? t("monitor.sessionDebrief.insideNoiseFloor")
        : t("monitor.sessionDebrief.outsideNoiseFloor"),
    noiseFloor: r.noise_floor_pct,
  });

  // P7-depth-verdicts (Constitution §13): ANSWER = the verdict and what to do about it; EXPLANATION =
  // the comparison in both units against the noise floor, and what a null result means; RECEIPT = the
  // before/after readings and the exact fields the verdict was judged on. No new data.
  const rk = (k: string) => t(`monitor.sessionDebrief.receipt.${k}`);
  const one = (n: number) => n.toFixed(1);
  // P7-teach (Constitution §14): after this PC's own result, at most one lesson from the P5-learned
  // rule table over the stored verdict and deltas (the same rules the Trial summary teaches with),
  // worded for a Trial of this change. No rule = no lesson, and the stored verdict wins: a rule whose
  // 1% low direction disagrees with it is never shown. It sits in the explanation: the answer stays
  // the verdict and the choice.
  const lessonRule = lessonRuleForVerdict(r.verdict, r.delta_low1_pct, r.delta_avg_pct, r.noise_floor_pct);
  return (
    <div className={`cmp cmp-${r.verdict}`} data-testid="cmp-card">
      <Depth
        testId="cmp-depth"
        answer={
          <>
      <div className="cmp-head">
        <span>{t("monitor.sessionDebrief.comparisonHeader", { title: r.rec_title, game: prettyGameName(r.game) })}</span>
      </div>

      {r.verdict === "no-change" && (
        <>
          <h2 className="cmp-headline">{t("monitor.sessionDebrief.noMeasurableChange")}</h2>
          <p className="cmp-sub">
            {t("monitor.sessionDebrief.noChangeSub")}
          </p>
        </>
      )}
      {r.verdict === "improved" && (
        <>
          <h2 className="cmp-headline cmp-win">
            {t("monitor.sessionDebrief.improvedHeadlinePre", { pct: sign(r.delta_low1_pct) })}
            <Term id="one-percent-lows">{t("monitor.sessionDebrief.improvedHeadlineEmph")}</Term>
          </h2>
          <p className="cmp-sub">
            {t("monitor.sessionDebrief.improvedSub", { game: prettyGameName(r.game) })}
          </p>
        </>
      )}
      {r.verdict === "regressed" && (
        <>
          <h2 className="cmp-headline cmp-bad">{t("monitor.sessionDebrief.regressedHeadline")}</h2>
          <p className="cmp-sub">
            {/* Every prose segment gets the SAME bag: which segment holds {{game}} is the
                translator's call, not ours. English trails it ("… in Valorant"); Chinese leads
                with it ("你在 Valorant 中的 …"). Feeding only one segment renders raw braces in
                whichever locale disagrees — see src/i18n/locale-parity-guard.test.ts. */}
            {t("monitor.sessionDebrief.regressedSubPre", { game: prettyGameName(r.game) })}
            <Term id="one-percent-lows">{t("monitor.sessionDebrief.regressedSubEmph1")}</Term>
            {t("monitor.sessionDebrief.regressedSubMid", { game: prettyGameName(r.game) })}
            <Term id="noise-floor">{t("monitor.sessionDebrief.regressedSubEmph2")}</Term>
            {t("monitor.sessionDebrief.regressedSubPost", { game: prettyGameName(r.game) })}
          </p>
        </>
      )}
      {r.verdict === "confounded" && (
        <>
          <h2 className="cmp-headline">{t("monitor.sessionDebrief.confoundedHeadline")}</h2>
          <p className="cmp-sub">
            {t("monitor.sessionDebrief.confoundedSub", { title: r.rec_title })}
          </p>
        </>
      )}
      {r.verdict === "expired" && (
        <>
          <h2 className="cmp-headline">{t("monitor.sessionDebrief.expiredHeadline")}</h2>
          <p className="cmp-sub">
            {t("monitor.sessionDebrief.expiredSub")}
          </p>
        </>
      )}

      <div className="cmp-actions">
        {nextSuspect && (
          <button className="btn-small" onClick={onDismiss}>
            {t("monitor.sessionDebrief.chaseSuspect", { suspect: nextSuspect })}
          </button>
        )}
        {r.verdict === "improved" ? (
          <button className="btn-small btn-small-on" onClick={onDismiss}>
            {t("monitor.sessionDebrief.keepIt")}
          </button>
        ) : (
          <button className="btn-small" disabled={reverting} onClick={onRevert}>
            {reverting ? t("monitor.sessionDebrief.reverting") : t("monitor.sessionDebrief.revertIt")}
          </button>
        )}
      </div>

      <div className="cmp-tally">{t("monitor.sessionDebrief.honestTally")}</div>
          </>
        }
        explanation={
          isMeasured ? (
            <>
              <p className="cmp-delta">{deltaLine}</p>
              {r.verdict === "no-change" && (
                <div className="cmp-means">
                  {t("monitor.sessionDebrief.noChangeMeansPre")}
                  <strong>{t("monitor.sessionDebrief.noChangeMeansEmph", { title: r.rec_title.toLowerCase() })}</strong>
                  {t("monitor.sessionDebrief.noChangeMeansPost")}
                </div>
              )}
              {lessonRule && (
                <LessonLine
                  rule={lessonRule}
                  testId="cmp-lesson"
                  sentence={t(`lab.experimentBench.summary.lesson.${LESSON_KEY[lessonRule]}`, {
                    change: r.rec_title,
                    game: prettyGameName(r.game),
                  })}
                />
              )}
            </>
          ) : undefined
        }
        receipt={
          isMeasured ? (
            <>
              <span className="cmp-nf">{t("monitor.sessionDebrief.noiseFloor", { pct: r.noise_floor_pct })}</span>
              <div className="cmp-receipts">
                <CmpReceipt label={t("monitor.sessionDebrief.avgFpsLabel")} before={r.baseline_avg_fps} after={r.after_avg_fps} />
                <CmpReceipt
                  label={<Term id="one-percent-lows">{t("monitor.sessionDebrief.oneLowLabel")}</Term>}
                  before={r.baseline_low1_fps}
                  after={r.after_low1_fps}
                />
              </div>
              <dl className="cmp-receipt-fields">
                <ReceiptRow label={rk("change")} value={r.rec_id} />
                <ReceiptRow label={rk("game")} value={r.game} />
                <ReceiptRow label={rk("baselineAvg")} value={`${one(r.baseline_avg_fps)} fps`} />
                <ReceiptRow label={rk("afterAvg")} value={`${one(r.after_avg_fps)} fps (${receiptPct(r.delta_avg_pct)})`} />
                <ReceiptRow label={rk("baselineLow")} value={`${one(r.baseline_low1_fps)} fps`} />
                <ReceiptRow label={rk("afterLow")} value={`${one(r.after_low1_fps)} fps (${receiptPct(r.delta_low1_pct)})`} />
                <ReceiptRow label={rk("verdict")} value={r.verdict} />
                <ReceiptRow label={rk("kind")} value={r.kind ?? null} />
              </dl>
            </>
          ) : undefined
        }
      />
    </div>
  );
}

// Moment 3 verdict bands from the 1%-low/avg ratio. The ~0.60 band copy is verbatim from the spec;
// the others are conservative extrapolations (tunable) — see the spec's "conservative, tunable" note.
// Owner-tunable bands (set 2026-06-04). The middle subtitle is the spec's verbatim line.
function verdictBand(t: TFunction, ratio: number): { h: string; sub: string } {
  const pct = Math.round(ratio * 100);
  if (ratio >= 0.75)
    return {
      h: t("monitor.sessionDebrief.verdict.smooth.headline"),
      sub: t("monitor.sessionDebrief.verdict.smooth.sub", { pct }),
    };
  if (ratio >= 0.55)
    return {
      h: t("monitor.sessionDebrief.verdict.dips.headline"),
      sub: t("monitor.sessionDebrief.verdict.dips.sub", { pct }),
    };
  return {
    h: t("monitor.sessionDebrief.verdict.rough.headline"),
    sub: t("monitor.sessionDebrief.verdict.rough.sub", { pct }),
  };
}

// Moment 3 — session debrief card (first-experience arc). The most-recent session, read honestly:
// verdict sentence, four tiles (1% low always labeled an estimate), at most ONE insight, a
// context strip, and the #1-fix CTA. Copy verbatim from the spec where the spec specifies it.
export function SessionDebrief({
  s,
  priorities,
  recs,
  apply,
  busyId,
  onExport,
  changes,
  rollback,
  activeChangeFor,
  vendor,
  sessions,
}: {
  s: SessionSummary;
  priorities: Priorities | null;
  recs: Recommendation[];
  /** Resolves true only when the apply was recorded. */
  apply: (rec: Recommendation) => Promise<boolean>;
  busyId: string | null;
  onExport: () => void;
  changes: AppliedChange[];
  /** Resolves true only when the undo was recorded. */
  rollback: (c: AppliedChange) => Promise<boolean>;
  /** BACKLOG:236 Ledger half (additive — absent = prose only): lets the "What changed?" next-test
   *  line carry a real rollback button when the engine named a still-active rec id. */
  activeChangeFor?: (recId: string) => AppliedChange | undefined;
  /** Tuning before/after (spec 2026-06-08) — provided only where the full session list + GPU vendor
   *  are available (Play). Absent → the tuning cluster doesn't render (classic Sessions tab). */
  vendor?: GpuVendor;
  sessions?: SessionSummary[];
}) {
  const { t } = useTranslation();
  const [ctxOpen, setCtxOpen] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [reverting, setReverting] = useState(false);
  const confirm = useConfirm();
  // Expert view (spec §2): the tiles show the raw measured value at 1 decimal instead of the
  // whole-FPS rounding. Same SessionSummary fields, display precision only.
  const expert = useExpertView();
  // A session aggregate is printed only when it is a reading (knownFps: finite and above zero);
  // the sampler's unknown is 0, so anything else is the em dash, never "0" (#608).
  const fmtFps = (n: number | null) => (n == null ? "—" : n.toFixed(expert ? 1 : 0));
  const avgFps = knownFps(s.avg_fps);
  const lowFps = knownFps(s.low1_fps_est);
  const screenLine = screenTargetLine(avgFps, s.hw_fingerprint?.display, t);
  // Honesty gate (LOCKED rule #5): NVIDIA GPU temp comes from NVML — implemented, NOT hardware-verified
  // — so it's never graded authoritatively. Routed through the shared gpu-sensor helper (one source,
  // can't drift) — same gate Play + the Home/Monitoring surfaces use.
  const tempGrade = (c: number | null | undefined): Grade => gradeGpuTempForVendor(vendor, c);
  // Show a resolved comparison only if it's for THIS session's game (Moment 4). A TUNING result is
  // NOT a fix comparison — it has no ledger entry to revert — so it's excluded here and rendered by
  // the dedicated TuningDebrief instead (no duplicate card, no meaningless revert button).
  useEffect(() => {
    invoke<ComparisonResult | null>("get_latest_comparison")
      .then((c) => setComparison(c && c.game === s.process_name && c.kind !== "tuning" ? c : null))
      .catch(() => {});
  }, [s.process_name]);
  // The verdict, the insights and the clean line all argue from the 1%-low/average ratio, so with
  // either reading unknown there is no ratio and nothing here concludes from one (#608). The old
  // fallback of 1 called an unmeasured session "Smooth"; an unknown low of 0 called it "Rough".
  const ratio = avgFps != null && lowFps != null ? Math.min(1, lowFps / avgFps) : null;
  // P4-comparable-show: time the game spent behind another window was left out of every number,
  // so the card says how much. A session that was behind the whole time says that is why it has no
  // readings. No focus reading (null) says nothing.
  const leftOut = leftOutSecs(s);
  const backgroundOnly = allBackground(s);
  const v =
    backgroundOnly && leftOut != null
      ? {
          h: t("monitor.sessionDebrief.verdict.background.headline"),
          sub: t("monitor.sessionDebrief.verdict.background.sub", { span: leftOutSpan(leftOut, t) }),
        }
      : ratio == null
      ? {
          h: t("monitor.sessionDebrief.verdict.unmeasured.headline"),
          sub: t("monitor.sessionDebrief.verdict.unmeasured.sub"),
        }
      : verdictBand(t, ratio);

  const fmtDur = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
  };
  const when = new Date(s.started_at);
  const end = new Date(when.getTime() + s.duration_secs * 1000);
  const range = `${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${end.toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit" },
  )}`;

  // At most ONE insight: (a) GPU-vs-system hint, (b) prime-suspect open limiter, else none.
  const topLimiter = priorities?.limiters?.[0] ?? null;
  const gpuLoafed =
    s.peak_gpu_usage_pct != null && s.peak_gpu_usage_pct < 70 && ratio != null && ratio < 0.7;
  let insight: string | null = null;
  if (gpuLoafed) {
    insight = t("monitor.sessionDebrief.gpuLoafedInsight", { pct: s.peak_gpu_usage_pct });
  } else if (topLimiter && ratio != null && ratio < 0.75) {
    insight = t("monitor.sessionDebrief.primeSuspectInsight", {
      limiter: topLimiter.title.toLowerCase(),
      reason: topLimiter.reason,
    });
  }
  // A concrete stutter correlation outranks the generic insight for the single "one thing" slot.
  const shownInsight = s.stutter_insight || insight;

  const topRec = topLimiter
    ? recs.find((r) => r.id === (topLimiter.linked ?? topLimiter.id))
    : undefined;
  const canArm = !!topRec && !topRec.currently_applied;
  // DIR-1a APPLIED TO LIVE (owner direction 2026-08-26: "offering help should only be an option if
  // there an indicator that something was detected from your pc that it would even inquire that").
  // `priorities.limiters` are derived from the MACHINE's readiness checks (priorities.rs —
  // `Attention` → `Bucket::Limiter`), never from this session's frames. So any rig carrying an open
  // limiter handed EVERY session — including one this card had just graded "Smooth session" — a
  // button calling the change "the #1 fix", and suppressed the honest clean line to do it
  // (`cleanSession` used to require `!canArm`). One card, two contradictory sentences, and a
  // problem asserted that nothing here measured.
  //
  // The offer is NOT hidden: hiding is barred (owner reversal 2026-08-06, "intimidation is a
  // STRUCTURE defect… never a switch") and "I want more fps" is a real reason to change something
  // on a healthy rig — it is one of the four goal answers Health's front door gained the same day.
  // What is chosen on evidence is the FRAMING, exactly as Health picks between its symptom half and
  // its goal half on `somethingDetected`. Measured trouble → "Apply the #1 fix"; nothing measured →
  // "Try one change", under a clean line that no longer claims there is nothing worth changing.
  // "Good session" is itself a ratio verdict, so an unmeasured session never earns the clean line.
  const problemMeasured = (ratio != null && ratio < 0.75) || !!shownInsight;
  const cleanSession = ratio != null && !problemMeasured;

  // BACKLOG:236 Ledger half — the ComparisonCard above already owns the rollback control for ITS
  // rec ("Revert it"). In the common flow (apply a fix from this debrief → `arm_comparison` for that
  // rec → the next same-game session resolves it) that rec is exactly the one the What-changed
  // engine names in `next_action_rec_id`, so an unguarded shortcut would put TWO differently-worded
  // buttons for ONE action in one card — the duplication [[flags-name-it-and-fix-it-inline]] exists
  // to prevent. The card stays canonical for its own rec; the shortcut stands down. Nothing is lost:
  // the engine's prose still names the Trust Ledger, which is why that sentence was left intact.
  // Suppressed for EVERY verdict, not only the ones showing "Revert it" — a "Roll back X" hanging
  // under an improved card that just said "Keep it" would contradict it outright.
  const rollbackShortcutFor = useMemo(
    () =>
      activeChangeFor
        ? (recId: string) => (recId === comparison?.rec_id ? undefined : activeChangeFor(recId))
        : undefined,
    [activeChangeFor, comparison?.rec_id],
  );

  const nextSuspect = priorities?.limiters?.[1]?.title ?? null;
  const dismissCmp = async () => {
    await invoke("dismiss_comparison").catch(() => {});
    setComparison(null);
  };
  const revertCmp = async () => {
    // The newest live apply of this change is the one an undo targets (liveChangeGroups), and the
    // result card goes only once that undo is recorded: a cancelled confirm or a failed undo leaves
    // the measured result where it was (codebase review 2026-11-02).
    const { active, cantConfirm } = liveChangeGroups(changes);
    const row = [...active, ...cantConfirm].find((c) => c.rec_id === comparison?.rec_id);
    if (row) {
      setReverting(true);
      const undone = await rollback(row);
      setReverting(false);
      if (!undone) return;
    }
    await dismissCmp();
  };

  return (
    <div className="debrief">
      <div className="debrief-head">
        <span className="debrief-title">
          {prettyGameName(s.process_name) || t("monitor.sessionDebrief.lastSessionFallback")} · {fmtDur(s.duration_secs)} · {range}
        </span>
        <button className="btn-small" onClick={onExport}>
          {t("monitor.sessionDebrief.share")}
        </button>
      </div>

      <h2 className="debrief-verdict">{v.h}</h2>
      <p className="debrief-sub">{v.sub}</p>
      {leftOut != null && !backgroundOnly && (
        <p className="debrief-sub debrief-leftout">
          {t("monitor.sessionDebrief.leftOut", { span: leftOutSpan(leftOut, t) })}
        </p>
      )}

      <div className="debrief-tiles">
        <DebriefTile
          label={<Term id="hz-vs-fps">{t("monitor.sessionDebrief.avgFpsLabel")}</Term>}
          value={fmtFps(avgFps)}
          note={avgFps == null ? t("common.arcGauge.noReading") : undefined}
          grade={avgFps == null ? undefined : gradeFps(avgFps, { refreshHz: readDisplayRefreshHz() })}
        />
        {/* A 1% low is graded against its average, so it needs both readings to carry a grade. */}
        <DebriefTile
          label={<Term id="one-percent-lows">{t("monitor.sessionDebrief.oneLowLabel")}</Term>}
          value={fmtFps(lowFps)}
          note={lowFps == null ? t("common.arcGauge.noReading") : t("monitor.sessionDebrief.estimateNote")}
          grade={lowFps == null || avgFps == null ? undefined : gradeLow1(lowFps, avgFps)}
        />
        {/* Peak GPU is utilization — left neutral on purpose (high is good while gaming). */}
        <DebriefTile
          label={t("monitor.sessionDebrief.peakGpuLabel")}
          value={s.peak_gpu_usage_pct == null ? "—" : `${s.peak_gpu_usage_pct}%`}
        />
        <DebriefTile
          label={t("monitor.sessionDebrief.peakTempLabel")}
          value={s.peak_gpu_temp_c == null ? "—" : `${s.peak_gpu_temp_c}°C`}
          grade={tempGrade(s.peak_gpu_temp_c)}
        />
      </div>

      {/* P9-target: the average against the screen this session was played on (its own recorded
          mode). No line when either reading is unmeasured. */}
      {screenLine && <p className="debrief-sub debrief-screen-target">{screenLine}</p>}

      {/* The shape of the session, from the trace that was already being persisted and never drawn
          (#49 deviation 3 / BACKLOG §A2). Sits between the summary numbers and the analysis on
          purpose: numbers say WHAT it averaged, the trace says what it DID, and everything below
          argues about why. Gaps stay gaps — see FpsTrace.tsx. */}
      <FpsTrace series={s.fps_series} durationSecs={s.duration_secs} />

      {comparison ? (
        <ComparisonCard
          r={comparison}
          nextSuspect={nextSuspect}
          onRevert={revertCmp}
          onDismiss={dismissCmp}
          reverting={reverting}
        />
      ) : (
        shownInsight && (
          <div className="debrief-insight">
            <div className="debrief-insight-tag">{t("monitor.sessionDebrief.oneThingTag")}</div>
            <p>{shownInsight}</p>
          </div>
        )
      )}

      {/* Intelligence Phase 1 — this session vs the previous session of the same game. Additive:
          ComparisonCard above keeps the rec-scoped A/B story; this answers "vs last time". */}
      <WhatChangedPanel
        startedAt={s.started_at}
        activeChangeFor={rollbackShortcutFor}
        onRollback={rollback}
        busy={busyId !== null}
      />

      {/* Intelligence Phase 2 — §4D good-vs-bad investigator (Expert view only). Pick any two
          same-game sessions; the same deterministic engine explains the delta. */}
      {sessions && (
        <SessionInvestigator
          sessions={sessions}
          activeChangeFor={rollbackShortcutFor}
          onRollback={rollback}
          rollbackBusy={busyId !== null}
        />
      )}

      {/* Tuning before/after — temp + stability delta beside the FPS delta (spec §3). Read-only +
          advisory: arming records a vendor-tool undervolt session-side, never a mutating ledger entry. */}
      {vendor && sessions && <TuningDebrief s={s} vendor={vendor} sessions={sessions} />}

      <div className="debrief-ctx">
        <button
          className="debrief-ctx-head"
          onClick={() => setCtxOpen((o) => !o)}
          aria-expanded={ctxOpen}
        >
          <span>
            {s.compy_changes_active == null
              ? t("monitor.sessionDebrief.changesActiveUnknown")
              : t("monitor.sessionDebrief.changesActive", { count: s.compy_changes_active })}
          </span>
          <span>{ctxOpen ? "▾" : "▸"}</span>
        </button>
        {ctxOpen && (
          <div className="debrief-ctx-body">
            <div>
              {t("monitor.sessionDebrief.captureLinePre")}<Term id="etw">{t("monitor.sessionDebrief.captureLineEmph")}</Term>{t("monitor.sessionDebrief.captureLinePost")}
            </div>
            {s.hw_fingerprint && (
              <div>
                {t("monitor.sessionDebrief.rigLinePrefix")}{s.hw_fingerprint.gpu || t("monitor.sessionDebrief.gpuFallback")} · {s.hw_fingerprint.ram_gb}GB
                {s.hw_fingerprint.display ? ` · ${displayModeLabel(s.hw_fingerprint.display, t) ?? ""}` : ""}
              </div>
            )}
            {s.compy_changes_active === 0 && (
              <div>{t("monitor.sessionDebrief.zeroChangesActive")}</div>
            )}
            {s.compy_changes_active == null && (
              <div>{t("monitor.sessionDebrief.unknownChangesActive")}</div>
            )}
          </div>
        )}
      </div>

      {/* The clean line no longer stands DOWN for the offer — it stands ABOVE it, in the shorter
          wording, so the card never says "nothing worth changing" beside a button inviting a
          change. With no offer to make it keeps the full sentence it always had. */}
      {cleanSession && (
        <p className="debrief-clean">
          {canArm && topRec
            ? t("monitor.sessionDebrief.cleanSessionOffer")
            : t("monitor.sessionDebrief.cleanSession")}
        </p>
      )}

      {canArm && topRec ? (
        <button
          className="debrief-cta"
          disabled={busyId !== null}
          onClick={async () => {
            // Don't silently clobber a pending comparison — confirm before replacing its baseline.
            const existing = await invoke<{
              rec_id: string;
              rec_title: string;
              game: string;
            } | null>("get_armed_comparison").catch(() => null);
            if (
              existing &&
              (existing.rec_id !== topRec.id || existing.game !== s.process_name)
            ) {
              const ok = await confirm({
                title: t("monitor.sessionDebrief.replaceComparisonTitle"),
                body: t("monitor.sessionDebrief.replaceComparisonBody", {
                  title: existing.rec_title,
                  game: prettyGameName(existing.game),
                }),
                confirmLabel: t("monitor.sessionDebrief.replaceComparisonConfirm"),
              });
              if (!ok) return; // keep the pending comparison; don't apply a confounding change
            }
            const applied = await apply(topRec);
            // Arm the cross-session comparison: this session's metrics are the baseline. Only for a
            // change that was applied (a cancelled confirm or a failed apply changed nothing), and
            // only from a session that measured both readings: an unmeasured one has nothing for the
            // next session to be compared against (codebase review 2026-11-02).
            if (!applied || avgFps == null || lowFps == null) return;
            await invoke("arm_comparison", {
              recId: topRec.id,
              recTitle: topRec.title,
              game: s.process_name,
              baselineAvgFps: avgFps,
              baselineLow1Fps: lowFps,
            }).catch(() => {});
          }}
        >
          {/* Both branches stay LITERAL t("…") call sites on purpose: affordance-census.test.ts
              walks sources for that exact shape, so folding the choice inside the t() argument
              would read to the census as the "#1 fix" affordance having been dropped — case 2 in
              its own triage list ("moved somewhere the walker cannot see — fix the edge, do not
              re-record"). Nothing here is retired; the wording is chosen, and both wordings ship. */}
          {busyId === topRec.id ? (
            t("monitor.sessionDebrief.applying")
          ) : problemMeasured ? (
            t("monitor.sessionDebrief.applyFix")
          ) : (
            t("monitor.sessionDebrief.applyTry")
          )}
        </button>
      ) : null}
    </div>
  );
}

function DebriefTile({
  label,
  value,
  note,
  grade,
}: {
  label: ReactNode;
  value: string;
  note?: string;
  grade?: Grade;
}) {
  // Hardware-tailored grade color (green/amber/red); neutral metrics inherit the ink.
  const color = grade ? gradeColor(grade) : "";
  return (
    <div className="debrief-tile">
      <div className="debrief-tile-value" style={color ? { color } : undefined}>{value}</div>
      <div className="debrief-tile-label">
        {label}
        {note && <span className="debrief-tile-note"> · {note}</span>}
      </div>
    </div>
  );
}
