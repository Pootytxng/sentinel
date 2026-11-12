// Intelligence Phase 3 — user-started experiment engine + optimization simulator surface.
// ARMED (experiment_gate() true, owner-signed 2026-07-17). The engine ORCHESTRATES the existing
// audited apply/rollback boundary — it invents no new mutation primitive. Nothing runs without an
// explicit user action: you PICK a change, the simulator gives an honest read (never a promise),
// you START (which applies ONE reversible change against a real captured baseline), you play, and
// you CONCLUDE — Compy judges the real session against the 3% noise floor and auto-restores unless
// the numbers clearly beat it. It measures; it never fabricates a gain.
// Spec: docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md.

import { withTerms } from "../design/with-terms";
import { confidenceHintKey, confidenceWordKey, type ConfidenceWord } from "../data/confidence-word";
import { Term } from "../design/Term";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import type { AppliedChange, SessionSummary } from "../types";
import { ChangedOutsideRemedy } from "./ChangedOutsideRemedy";
import { LEDGER_CHANGED_EVENT } from "../types";
import { writeLedger } from "../data/ledger-write";
import { liveChangeGroups } from "../data/live-changes";
import { prettyGameName } from "./game-name";
import { knownFps } from "../lib/session-metrics";
import { SectionLabel, VerdictBand, simulationTone } from "./measurement-chrome";
import { BentoTile } from "../design/bento/BentoGrid";
import { Picker } from "../design/Picker";
import {
  outcomeChoices,
  summarizeGame,
  type GameTestSummary,
  LESSON_KEY,
  type Lesson,
  type OutcomeChoice,
  type OutcomeResult,
  type ResultOutcome,
  type StillApplied,
  stillAppliedFrom,
  type RetestReason,
  type TestedChange,
} from "./test-summary";
import { Depth, ReceiptRow, receiptBand, receiptPct } from "../design/Depth";
import {
  costAckLine,
  GuidedJourney,
  interruptedJourneyId,
  JourneyProgressLine,
  needsCostAck,
  RealPlayPanel,
  reusableAsIs,
  trialMovedSince,
  riskChoiceWord,
  useJourneyPhase,
} from "./GuidedJourney";
import {
  asRealPlayProgress,
  isRealPlay,
  realPlayCounts,
  realPlayFace,
  realPlayNoiseLine,
  type RealPlayEvidence,
  type RealPlayProgress,
} from "./journey-realplay";
import { journeyProgress, nextToTest, stillOnFor } from "./journey-resume";
import { gradeBaseline, MIN_BASELINE_SAMPLES } from "./baseline-grade";
import { displayModeLabel } from "../data/display-mode";
import { takeBenchArrival, type BenchArrival } from "./lab-arrival";
import { settingsDoneLine, softwareFirstLine } from "./settings-done";
import { peekScanPriorities } from "./use-scan";
import "./ExperimentBench.css";

type ExperimentStatus = "running" | "kept" | "restored" | "aborted";
type Confidence = "unknown" | "low" | "medium" | "high";

type Treatment = {
  avg_fps: number;
  low1_fps: number;
  samples: number;
  crashed: boolean;
  delta_low1_pct: number;
  recorded_at: string;
  /** The session these numbers were read from (its started_at), looked up by the backend. null on
   *  records concluded before #583 lane 2b, when the webview supplied the numbers. */
  session_id?: string | null;
  /** P4-sessions: the after-session graded on the baseline's check. null on older records. */
  check?: "steady" | "uneven" | "untraced" | null;
  /** Its first- and second-half average fps. null when it had no trace, and on older records. */
  halves?: { first_half_fps: number; second_half_fps: number } | null;
  /** P4-recommended: the average fps %-delta vs baseline, judged on the same band as the 1% low.
   *  null when an average was missing, and on records judged on the 1% low alone. */
  delta_avg_pct?: number | null;
};

/** P4-maxfps-smooth: what the user asked a Trial to aim for (experiment.rs `TrialOutcome`, its serde
 *  names). P4-smooth-offer-b: Smoothest is offered only from a session the backend says it can judge
 *  (`get_smoothest_readiness`, the start's own check); otherwise it is listed disabled with what is
 *  missing beside the picker. */
type TrialOutcome = "recommended" | "max-fps" | "smoothest";

const OUTCOME_KEY: Record<TrialOutcome, string> = {
  recommended: "recommended",
  "max-fps": "maxFps",
  smoothest: "smoothest",
};

/** The picker's entries, in order. */
const OUTCOME_OPTIONS = ["recommended", "max-fps", "smoothest"] as const;

/** Why Smoothest can't start from a session yet (experiment.rs `SmoothestHeld`, serde names). */
type SmoothestHeld = "history-unread" | "unmeasured" | "no-start-pacing";
const SMOOTHEST_HELD_KEY: Record<SmoothestHeld, string> = {
  "history-unread": "historyUnread",
  unmeasured: "unmeasured",
  "no-start-pacing": "noStartPacing",
};
/** experiment.rs `SmoothestReadiness`: `held` null = Smoothest can start from that session. */
type SmoothestReadiness = { held: SmoothestHeld | null; min_sessions: number };

/** P4-smooth-offer-b: the pacing change a Smoothest row was judged on, as experiment.rs
 *  `with_smoothest_outcome` takes it (a % of the lower ratio, to 0.1). null when either is missing. */
export function pacingDeltaPct(start: number | null | undefined, after: number | null | undefined): number | null {
  if (start == null || after == null || !(start > 0) || !(after > 0) || !isFinite(start) || !isFinite(after)) return null;
  return Math.round(((after - start) / Math.min(after, start)) * 1000) / 10;
}

/** §11 — the credible-noise band a verdict was judged against. Present only when it really was. */
type NoiseEvidence = {
  band_pct: number;
  /** This game's own run-to-run noise on this PC. null = never measured (never estimated). */
  measured_noise_pct: number | null;
  /** Measured on this PC but not used: "changed" = an update since; "unconfirmed" = Compy couldn't
   *  confirm nothing changed. Absent/null on older records. */
  measured_noise_stale?: "changed" | "unconfirmed" | null;
  /** P4-noise: this game's 1% low spread between whole unchanged sessions on this PC, which set the
   *  band (never below the fixed floor). Absent/null when too few unchanged sessions existed. */
  between_sessions?: { spread_pct: number; sessions: number } | null;
};

/** P4-comparable — what one session's records say about stretches that weren't play. */
type SessionStretches = {
  /** Seconds left out because the game was in the background. null = focus wasn't recorded. */
  left_out_secs?: number | null;
  /** Seconds the trace held flat (a menu, a frame cap or the background: Compy can't tell), counted. */
  flat_secs?: number;
  /** The frame rate the longest held-flat stretch sat at. */
  flat_fps?: number | null;
};

/** How comparable the before and after sessions were (experiment.rs `SessionPairing`). */
type SessionPairing = {
  verdict: "comparable" | "partial" | "not-comparable" | "unknown";
  missing_context?: string[];
  /** Stable keys of the conditions that differed. Absent on older records. */
  changed?: string[];
  /** Stable keys of the conditions one session didn't record. Absent on older records. */
  unrecorded?: string[];
  baseline_stretches?: SessionStretches | null;
  after_stretches?: SessionStretches | null;
};

type Experiment = {
  id: string;
  rec_id: string;
  rec_title: string;
  game: string;
  hypothesis: string;
  created_at: string;
  status: ExperimentStatus;
  baseline_avg_fps: number;
  baseline_low1_fps: number;
  /** The baseline session's id (its started_at). null on records started before #583 lane 2b. */
  baseline_session_id?: string | null;
  /** When the apply returned; only a session started later can conclude. null on older records. */
  applied_at?: string | null;
  active_changes_at_start: number;
  attribution_warning: string | null;
  noise_floor_pct: number;
  treatment: Treatment | null;
  verdict: string | null;
  kept: boolean;
  stop_reason: string | null;
  concluded_at: string | null;
  /** Task F — how much the EVIDENCE QUALITY justifies trusting this verdict (a band, never a
   *  number). null while Running or on records written before this field existed (honestly unknown). */
  verdict_confidence: Confidence | null;
  /** Plain-language "what supports / limits this verdict" line — the experiment's methodology. */
  verdict_note: string | null;
  /** Absent on records concluded before #583 lane 2b, and on verdicts the band never judged. */
  noise_evidence?: NoiseEvidence | null;
  /** §2 how the start graded the baseline. null on records started before baselines were graded. */
  baseline_check?: "steady" | "uneven" | "untraced" | null;
  /** The baseline's first- and second-half average fps. null when it had no trace, and on older records. */
  baseline_halves?: { first_half_fps: number; second_half_fps: number } | null;
  /** How comparable the two sessions were. null while Running and on older records. */
  session_pairing?: SessionPairing | null;
  /** P4-maxfps-smooth: the outcome picked at start. Absent on older records, which read as Recommended. */
  outcome?: TrialOutcome | null;
  /** P4-smooth-offer: what a Smoothest Trial was judged on (experiment.rs `SmoothestEvidence`). */
  smoothest?: { band_pct: number; start_ratio: number; after_ratio?: number | null } | null;
  /** P5-realplay: "real-play" for a Trial judged on real play; absent on a two-session Trial. */
  mode?: string | null;
  /** P5-realplay: its sessions and verdict numbers (experiment.rs `real_play`). */
  real_play?: RealPlayEvidence | null;
};

type SimulatorReport = {
  rec_id: string;
  rec_title: string;
  verdict: string;
  confidence: Confidence;
  why: string;
  hardware_factor: string;
  metric_to_watch: string | null;
  disproof: string;
  is_promise: boolean;
};

// One catalog change as the Trial picker sees it (`get_trial_candidates`, trial_candidates.rs): it
// passes "worth testing on this PC" (applies / not already set / Compy can do it safely), or it
// carries the first filter it failed (OPTIMIZATION_ENGINE §3.1–3.3).
type SkipReason =
  | "not-for-this-pc"
  | "already-set"
  | "already-set-by-compy"
  | "already-set-by-gaming-mode"
  | "already-set-by-gaming-mode-restore-unfinished"
  | "already-set-unchecked"
  | "already-set-unconfirmed"
  | "no-safe-apply"
  | "too-small-to-measure-here"
  // P8-posture-b (RISK_MODEL §2): the change passed every other filter but its risk is above what
  // the user chose. Checked last in Rust, so it never hides an earlier reason; the change is not set.
  | "outside-chosen-risk";
// P8-posture-b: the user's answer to "How far may Compy go on this PC?" — serde names of Rust's
// `RiskChoice`. Saved per viewer (localStorage); unknown/unreadable falls back to the Rust default.
export type RiskChoice = "low-only" | "low-and-moderate";
export const RISK_CHOICE_STORAGE_KEY = "compy.trial.riskChoice";
export const DEFAULT_RISK_CHOICE: RiskChoice = "low-and-moderate";
export function loadRiskChoice(): RiskChoice {
  try {
    const v = localStorage.getItem(RISK_CHOICE_STORAGE_KEY);
    return v === "low-only" || v === "low-and-moderate" ? v : DEFAULT_RISK_CHOICE;
  } catch {
    return DEFAULT_RISK_CHOICE;
  }
}
function saveRiskChoice(v: RiskChoice): void {
  try {
    localStorage.setItem(RISK_CHOICE_STORAGE_KEY, v);
  } catch {
    /* private window / blocked storage: the choice still applies for this session */
  }
}
// P4-rank (ENGINE §3.5, §3.7): the backend numbers the changes that passed in a suggested test order
// (stronger evidence that it helps, then lower risk, then catalog order) and says why per position.
// A change is "too small to measure here" only when the catalog states its effect AND this game's
// band is measured; no change states one today, so every change says its effect size is unknown.
type Evidence = "measured" | "not-measured" | "unknown";
type Risk = "low" | "moderate" | "unknown";
type TrialCandidate = {
  id: string;
  title: string;
  passes: boolean;
  reason: SkipReason | null;
  detail: string | null;
  position?: number | null;
  evidence?: Evidence;
  risk?: Risk;
  stated_effect_pct?: number | null;
  too_small?: { effect_pct: number; band_pct: number } | null;
  /** P8-ack: the catalog's own words for what the change costs (`downside`); null = it states none. */
  cost?: string | null;
};

const EVIDENCE_KEY: Record<Evidence, string> = {
  measured: "lab.experimentBench.rank.evidence.measured",
  "not-measured": "lab.experimentBench.rank.evidence.notMeasured",
  unknown: "lab.experimentBench.rank.evidence.unknown",
};
const RISK_KEY: Record<Risk, string> = {
  low: "lab.experimentBench.rank.risk.low",
  moderate: "lab.experimentBench.rank.risk.moderate",
  unknown: "lab.experimentBench.rank.risk.unknown",
};

const SKIP_REASON_KEY: Record<SkipReason, string> = {
  "not-for-this-pc": "lab.experimentBench.skipReason.notForThisPc",
  "already-set": "lab.experimentBench.skipReason.alreadySet",
  "already-set-by-compy": "lab.experimentBench.skipReason.alreadySetByCompy",
  "already-set-by-gaming-mode": "lab.experimentBench.skipReason.alreadySetByGamingMode",
  "already-set-by-gaming-mode-restore-unfinished": "lab.experimentBench.skipReason.alreadySetByGamingModeRestoreUnfinished",
  "already-set-unchecked": "lab.experimentBench.skipReason.alreadySetUnchecked",
  "already-set-unconfirmed": "lab.experimentBench.skipReason.alreadySetUnconfirmed",
  "no-safe-apply": "lab.experimentBench.skipReason.noSafeApply",
  "too-small-to-measure-here": "lab.experimentBench.skipReason.tooSmallToMeasureHere",
  "outside-chosen-risk": "lab.experimentBench.skipReason.outsideChosenRisk",
};

// A plain (key, options?) => string signature — avoids importing react-i18next's generic TFunction
// type just to thread the translator into a couple of module-level helper functions.
type Translate = (key: string, options?: Record<string, unknown>) => string;

// Plain-English label for each honest conclude verdict (§4F/§1 — measurement, never a promise).
// Built from `t` (not a module-level constant) so it's translated; called from inside the component.
function verdictCopy(t: Translate): Record<string, string> {
  return {
    improved: t("lab.experimentBench.verdict.improved"),
    "no-change": t("lab.experimentBench.verdict.noChange"),
    regressed: t("lab.experimentBench.verdict.regressed"),
    confounded: t("lab.experimentBench.verdict.confounded"),
    expired: t("lab.experimentBench.verdict.expired"),
    "insufficient-evidence": t("lab.experimentBench.verdict.insufficientEvidence"),
    "not-comparable": t("lab.experimentBench.verdict.notComparable"),
    "too-noisy": t("lab.experimentBench.verdict.tooNoisy"),
  };
}

// Honest label per simulator verdict + whether a controlled test is a meaningful next step.
// `blocked` verdicts have nothing to learn from an experiment (already on / wrong rig / barred).
function simVerdictCopy(t: Translate): Record<string, { label: string; blocked: boolean }> {
  return {
    "worth-testing": { label: t("lab.experimentBench.simVerdict.worthTesting"), blocked: false },
    "plausible-unproven": { label: t("lab.experimentBench.simVerdict.plausibleUnproven"), blocked: false },
    "insufficient-evidence": {
      label: t("lab.experimentBench.simVerdict.insufficientEvidence"),
      blocked: false,
    },
    "unlikely-to-matter": { label: t("lab.experimentBench.simVerdict.unlikelyToMatter"), blocked: false },
    "already-configured": { label: t("lab.experimentBench.simVerdict.alreadyConfigured"), blocked: true },
    // Covers both a hardware mismatch AND an advisory Compy can't one-click apply — either way there's
    // no controlled before/after to run here, so Start stays disabled (blocked). The `why` disambiguates.
    "not-applicable": { label: t("lab.experimentBench.simVerdict.notApplicable"), blocked: true },
    "risk-exceeds-value": { label: t("lab.experimentBench.simVerdict.riskExceedsValue"), blocked: true },
  };
}

// Review 2026-10-28 (P7-confidence): the one shared vocabulary, never "confidence: medium". A
// simulator estimate is engineering reasoning (Expected); a Trial result is a measurement (Measured);
// low or unknown evidence is Unknown.
// Self-review r2 2026-10-28: the word carries the shared gloss, like every other confidence word.
// P5-realplay: a real-play result is a supported inference from sessions played however the owner
// played (Likely), never a controlled measurement, and never High.
function BenchWord({ c, kind }: { c: Confidence; kind: "estimate" | "measured" | "real-play" }) {
  const { t } = useTranslation();
  const word: ConfidenceWord =
    c === "high" || c === "medium" ? (kind === "estimate" ? "expected" : kind === "real-play" ? "likely" : "measured") : "unknown";
  return <Term tip={t(confidenceHintKey(word))}>{t(confidenceWordKey(word))}</Term>;
}

// §11 receipt line: the band the verdict was judged against, and whether this game's own noise on
// this PC is known. An unmeasured noise level is said to be unmeasured, never filled in.
function noiseLine(n: NoiseEvidence, game: string, t: Translate): string {
  const pct = (v: number) => String(Math.round(v * 10) / 10);
  const b = n.between_sessions;
  if (b != null) {
    const [band, measured, sessions] = [pct(n.band_pct), pct(b.spread_pct), b.sessions];
    const name = prettyGameName(game) || game;
    // The band is the measured spread unless that was below the fixed floor, which then judged.
    return b.spread_pct >= n.band_pct
      ? t("lab.experimentBench.noiseBetweenSessions", { band, measured, sessions, game: name })
      : t("lab.experimentBench.noiseBetweenSessionsBelowFloor", { band, measured, sessions, game: name });
  }
  if (n.measured_noise_pct != null)
    return t("lab.experimentBench.noiseMeasured", { band: pct(n.band_pct), measured: pct(n.measured_noise_pct) });
  if (n.measured_noise_stale === "changed") return t("lab.experimentBench.noiseStaleChanged", { band: pct(n.band_pct) });
  if (n.measured_noise_stale === "unconfirmed")
    return t("lab.experimentBench.noiseStaleUnconfirmed", { band: pct(n.band_pct) });
  return t("lab.experimentBench.noiseUnmeasured", { band: pct(n.band_pct) });
}

function whenLabel(iso: string, t: Translate): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return t("lab.experimentBench.when.justNow");
  if (mins < 60) return t("lab.experimentBench.when.minAgo", { count: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("lab.experimentBench.when.hrAgo", { count: hrs });
  return t("lab.experimentBench.when.dAgo", { count: Math.round(hrs / 24) });
}

/** Why a tested change is offered another run, as the summary says it (ONE mapping for the row and
 *  the headline): the newest attempt judged nothing; or its result was judged under a changed
 *  context; or under one that can't be tied to this PC now. */
function retestWhyKey(r: TestedChange): RetestReason {
  return r.measured ? (r.context === "unverified" ? "unverified" : "stale") : "inconclusive";
}

/** The distinct reasons among `rows`, in a fixed order, as one list for the "worth retesting"
 *  headline (round 4 review: the headline names the reasons present, never a fixed pair). */
function retestReasonsLine(rows: readonly TestedChange[], t: Translate, sep: string): string {
  const present = new Set(rows.map(retestWhyKey));
  return (["inconclusive", "stale", "unverified"] as const)
    .filter((k) => present.has(k))
    .map((k) => t(`lab.experimentBench.summary.retestWhy.${k}`))
    .join(sep);
}

// A session the backend will accept as a reading: a real frame rate and 1% low (experiment.rs
// `has_frame_reading`) and a recorded game. The one test the baseline, the hypothesis wording and the
// after-session match all share, so the bench never offers a session the backend then refuses.
function isUsableReading(s: SessionSummary): boolean {
  return (
    Number.isFinite(s.avg_fps) &&
    s.avg_fps > 0 &&
    Number.isFinite(s.low1_fps_est) &&
    s.low1_fps_est > 0 &&
    s.process_name.trim() !== ""
  );
}

/** The honest baseline: the most recent monitored session with a real frame-rate reading and a known
 *  game (the backend refuses anything less). */
function latestUsableReading(sessions: SessionSummary[]): SessionSummary | null {
  return (
    [...sessions]
      .filter(isUsableReading)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0] ?? null
  );
}

// Trial Protocol §2: the backend's baseline grade, shared with the guided journey (baseline-grade.ts).

// §2 the record's own baseline grade, said on its receipt (the running panel and its history row):
// a Trial started on an uneven or untraced baseline says so. Steady and older records say nothing.
function baselineReceipt(x: Experiment, t: Translate): string | null {
  // P5-realplay: real play grades no session's halves, so its anchor session's grade says nothing.
  if (isRealPlay(x)) return null;
  if (x.baseline_check === "uneven" && x.baseline_halves)
    // A "too noisy" result has no result to call less reliable: the line just says what was uneven.
    return t(x.verdict === "too-noisy" ? "lab.experimentBench.receiptBaselineUnevenPlain" : "lab.experimentBench.receiptBaselineUneven", {
      first: Math.round(x.baseline_halves.first_half_fps),
      second: Math.round(x.baseline_halves.second_half_fps),
    });
  if (x.baseline_check === "untraced") return t("lab.experimentBench.receiptBaselineUntraced");
  return null;
}

// P4-sessions: the after-session's own grade, said on its history row when it was uneven.
function afterReceipt(x: Experiment, t: Translate): string | null {
  const tr = x.treatment;
  if (tr?.check !== "uneven" || !tr.halves) return null;
  return t("lab.experimentBench.receiptAfterUneven", {
    first: Math.round(tr.halves.first_half_fps),
    second: Math.round(tr.halves.second_half_fps),
  });
}

// P4-recommended: a judged row says exactly what was compared (the 1% low and the average, on one
// band) and why that kept or restored the change. Older rows, judged on the 1% low alone, say nothing.
function comparedReceipt(x: Experiment, t: Translate): string | null {
  const avg = x.treatment?.delta_avg_pct;
  const band = x.noise_evidence?.band_pct;
  if (!looksJudged(x) || !x.treatment || band == null || judgedOnNoBaseline(x)) return null;
  const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}`;
  const low = x.treatment.delta_low1_pct;
  const one = (v: number) => String(Math.round(v * 10) / 10);
  // P4-smooth-offer-b: a Smoothest row leads with frame pacing, on its own band, beside the 1% low.
  if (x.outcome === "smoothest") {
    const ev = x.smoothest;
    const pacing = pacingDeltaPct(ev?.start_ratio, ev?.after_ratio);
    const rule =
      x.verdict === "improved"
        ? "receiptRuleSmoothKept"
        : x.verdict === "regressed"
          ? pacing != null && ev && pacing > ev.band_pct
            ? "receiptRuleSmoothUneven"
            : "receiptRuleLowFell"
          : pacing == null
            ? "receiptRuleSmoothUnknown"
            : "receiptRuleSmoothInside";
    if (pacing == null || !ev) {
      return t("lab.experimentBench.receiptComparedSmoothestUnknown", { low: signed(low), band: one(band), rule: t(`lab.experimentBench.${rule}`) });
    }
    return t("lab.experimentBench.receiptComparedSmoothest", {
      pacing: signed(pacing),
      pacingBand: one(ev.band_pct),
      low: signed(low),
      band: one(band),
      rule: t(`lab.experimentBench.${rule}`),
    });
  }
  if (avg == null) return null;
  // P5-realplay: a real-play row compared its sessions with the change on against those without it,
  // not one after-session against one baseline; it names how many, with the same rules.
  const rp = isRealPlay(x) ? realPlayCounts(x) : null;
  // Review 2026-11-02: a real-play Likely better can end put back (its change was undone in Test →
  // Applied & history before the conclude, which then keeps nothing), so its rule never says kept.
  // A two-session row can't: every Better is kept (keep_rule) and nothing un-keeps the record later.
  const putBackAfterBetter = rp != null && x.verdict === "improved" && !x.kept;
  // P4-maxfps-smooth: a Maximum FPS row leads with the average.
  if (x.outcome === "max-fps") {
    const rule =
      x.verdict === "improved"
        ? putBackAfterBetter
          ? "receiptRuleMaxPutBack"
          : "receiptRuleMaxKept"
        : x.verdict === "regressed"
          ? avg < -band
            ? "receiptRuleMaxAvgFell"
            : "receiptRuleLowFell"
          : "receiptRuleMaxInside";
    if (rp)
      return t("lab.experimentBench.journey.realPlay.comparedMaxFps", {
        avg: signed(avg),
        low: signed(low),
        band: one(band),
        rule: t(`lab.experimentBench.${rule}`),
        with: rp.with,
        before: rp.before,
      });
    return t("lab.experimentBench.receiptComparedMaxFps", {
      avg: signed(avg),
      low: signed(low),
      band: one(band),
      rule: t(`lab.experimentBench.${rule}`),
    });
  }
  const rule =
    x.verdict === "improved"
      ? putBackAfterBetter
        ? "receiptRulePutBack"
        : "receiptRuleKept"
      : x.verdict === "regressed"
        ? "receiptRuleLowFell"
        : low > band
          ? "receiptRuleAvgFell"
          : "receiptRuleInside";
  if (rp)
    return t("lab.experimentBench.journey.realPlay.compared", {
      low: signed(low),
      avg: signed(avg),
      band: one(band),
      rule: t(`lab.experimentBench.${rule}`),
      with: rp.with,
      before: rp.before,
    });
  return t("lab.experimentBench.receiptCompared", {
    low: signed(low),
    avg: signed(avg),
    band: String(Math.round(band * 10) / 10),
    rule: t(`lab.experimentBench.${rule}`),
  });
}

// P4-comparable: the backend's condition keys (comparability.rs) → their i18n names. A key this build
// doesn't know reads as "a condition", never as nothing.
const PAIR_CONDITION_KEY: Record<string, string> = {
  game: "game",
  rig: "rig",
  resolution: "resolution",
  refresh: "refresh",
  "graphics-api": "graphicsApi",
  "game-build": "gameBuild",
  "frame-generation": "frameGeneration",
  conditions: "conditions",
  capture: "capture",
  gpu: "gpu",
  ram: "ram",
  "display-mode": "displayMode",
  "gpu-driver": "gpuDriver",
  "windows-build": "windowsBuild",
  display: "display",
  "capture-method": "captureMethod",
  // CR-trial-gm-between (comparability.rs): Gaming Mode on for one session and off for the other.
  "gaming-mode": "gamingMode",
};

function pairList(keys: string[], t: Translate): string {
  const names = [...new Set(keys.map((k) => PAIR_CONDITION_KEY[k] ?? "other"))];
  return names.map((k) => t(`lab.experimentBench.pairCondition.${k}`)).join(t("lab.experimentBench.pairListSeparator"));
}

// A Partial pair's receipt says what differed, in one line and the reader's language. An older record
// carries only the English lines, which this line never shows in place of a translation.
function pairingReceipt(x: Experiment, t: Translate): string | null {
  const p = x.session_pairing;
  if (p?.verdict !== "partial") return null;
  const changed = p.changed ?? [];
  const unrecorded = p.unrecorded ?? [];
  if (changed.length > 0 && unrecorded.length > 0)
    return t("lab.experimentBench.pairBoth", { changed: pairList(changed, t), unrecorded: pairList(unrecorded, t) });
  if (changed.length > 0) return t("lab.experimentBench.pairChanged", { changed: pairList(changed, t) });
  if (unrecorded.length > 0) return t("lab.experimentBench.pairUnrecorded", { unrecorded: pairList(unrecorded, t) });
  return null;
}

// "12 min" / "45 s" — a left-out span as the backend words it (experiment.rs `left_out_clause`).
function spanText(secs: number, t: Translate): string {
  return secs < 60
    ? t("lab.experimentBench.spanSeconds", { seconds: secs })
    : t("lab.experimentBench.spanMinutes", { minutes: Math.floor(secs / 60) });
}

// A too-few-readings result whose after-session left time out says how much, so "only 400 readings"
// from a long session is not a mystery (the backend's verdict note says the same).
function tooFewLeftOutReceipt(x: Experiment, t: Translate): string | null {
  const secs = x.session_pairing?.after_stretches?.left_out_secs ?? 0;
  if (x.verdict !== "insufficient-evidence" || !x.treatment || secs <= 0) return null;
  return t("lab.experimentBench.receiptTooFewLeftOut", { readings: x.treatment.samples, span: spanText(secs, t) });
}

// P4-comparable: what each session's records say about time that wasn't play. Background time was
// left out of the numbers; a held-flat stretch Compy can't classify was counted, and is named so.
// Under a full minute is not worth a line (minutes are floored, so "1 min" is at least 60 s). When the
// session recorded focus, a held-flat stretch can't have been the game in the background.
function stretchReceipts(x: Experiment, t: Translate): string[] {
  const p = x.session_pairing;
  // P5-realplay: a real-play result rests on several sessions a side, so the two its pairing names
  // stand for none of them on their own.
  if (!p || isRealPlay(x)) return [];
  const lines: string[] = [];
  // A No change between two sides held at one rate gets ONE line that says it all (minutes, rate,
  // what it means), not the two per-session held lines plus a third restating them (desk review
  // 2026-10-31: three lines in a row on the WARDOGS firing-range row).
  const cap = x.verdict === "no-change" ? sharedHeldRate(p.baseline_stretches, p.after_stretches) : null;
  for (const [s, label] of [
    [p.baseline_stretches, "lab.experimentBench.stretchBefore"],
    [p.after_stretches, "lab.experimentBench.stretchAfter"],
  ] as const) {
    if (!s) continue;
    const session = t(label);
    const leftOut = Math.floor((s.left_out_secs ?? 0) / 60);
    if (leftOut >= 1) lines.push(t("lab.experimentBench.stretchLeftOut", { session, minutes: leftOut }));
    if (cap != null) continue;
    const flat = Math.floor((s.flat_secs ?? 0) / 60);
    const flatKey = s.left_out_secs != null ? "lab.experimentBench.stretchFlatFocused" : "lab.experimentBench.stretchFlat";
    if (flat >= 1 && s.flat_fps != null)
      lines.push(t(flatKey, { session, minutes: flat, fps: Math.round(s.flat_fps) }));
  }
  if (cap != null) {
    lines.push(
      t("lab.experimentBench.stretchCappedBoth", {
        fps: cap,
        before: Math.floor((p.baseline_stretches?.flat_secs ?? 0) / 60),
        after: Math.floor((p.after_stretches?.flat_secs ?? 0) / 60),
      }),
    );
  }
  return lines;
}

// P4-cap-note: both sides held flat for a minute or more at the same rate (within the backend's
// FLAT_SPREAD_FPS, comparability.rs) look like one frame cap. A capped scene can't show a gain, so a
// No change there says little. Only named, never used to judge. Returns the shared rate, or null.
const HELD_SAME_RATE_FPS = 2;
function sharedHeldRate(a?: SessionStretches | null, b?: SessionStretches | null): number | null {
  const held = (s?: SessionStretches | null) =>
    s && (s.flat_secs ?? 0) >= 60 && s.flat_fps != null && Number.isFinite(s.flat_fps) ? s.flat_fps : null;
  const x = held(a);
  const y = held(b);
  if (x == null || y == null || Math.abs(x - y) > HELD_SAME_RATE_FPS) return null;
  return Math.round((x + y) / 2);
}

// A past result whose verdict reads like a measured judgment (Better / No change / Worse). Only such
// a row can be mistaken for one judged against the noise floor, so only it needs saying when it wasn't.
function looksJudged(x: Experiment): boolean {
  return x.verdict === "improved" || x.verdict === "no-change" || x.verdict === "regressed";
}

/** CR-trial-zero-base: a percent change from a 0 or unread baseline 1% low is undefined. Today's
 *  backend never records one (benchmark.rs), but an older record can carry a 0 or NaN baseline, or a
 *  delta serde wrote as null. Such a row shows "—" for its delta and no verdict wording, never a
 *  number. null = no delta to print. */
export function trialDeltaLow(x: Pick<Experiment, "baseline_low1_fps" | "treatment">): number | null {
  if (knownFps(x.baseline_low1_fps) == null) return null;
  const d: unknown = x.treatment?.delta_low1_pct;
  return typeof d === "number" && Number.isFinite(d) ? d : null;
}

/** A row that reads like a measured judgment but whose 1% low comparison is undefined (above). */
function judgedOnNoBaseline(x: Experiment): boolean {
  return looksJudged(x) && !isRealPlay(x) && trialDeltaLow(x) == null;
}

// A §11 note a row carries: its noise line, or "no record" for a row that looks judged without one.
const NO_RECORD = Symbol("no-noise-record");
type RowNote = string | typeof NO_RECORD;

// Marks tie a row to a note said once under the list. Past three, plain numbers.
function noteMark(i: number): string {
  return ["*", "†", "‡"][i] ?? String(i + 1);
}

// The backend tags a stop reason with machine prefixes ("start-aborted: …", "user-restored; …",
// stacked as "crash-during-treatment; target-unreadable-at-conclude; …") so the record stays
// sortable. The owner reads the sentence after them, never a tag.
function abortReasonText(reason: string): string {
  const text = reason.replace(/^(?:[a-z]+(?:-[a-z]+)+[:;]\s+)+/, "") || reason;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A Trial started by an older Compy lacks the baseline session id (pre lane 2b) or the apply time
// (pre #611 r1). The backend refuses to conclude it and says so, so the bench offers only Restore.
function canConclude(exp: Experiment): exp is Experiment & { applied_at: string; baseline_session_id: string } {
  return !!exp.baseline_session_id && !!exp.applied_at;
}

// The treatment session for a running experiment: the most recent monitored session of the SAME game
// that started AFTER the change took effect and carries real frames. Never fabricated — if none exists
// the owner simply hasn't played a qualifying session yet. Timed as the backend times it: from when
// the apply returned, since a session begun while the apply was pending can't measure the change.
// P4-next-f1: each change with a judged Trial on `game` (a Trial ended by the user's own restore before
// a verdict was never judged, so it doesn't count), with the verdict of its newest judged Trial there,
// so the picker can say "Tested: <verdict>" beside it. The store is this PC's own file, so "on this
// rig" is the PC the store lives on. Which of these count as TESTED (a measured result) and which are
// worth another run is journey-resume.ts `nextToTest`'s rule, shared with the P4-exit summary. Pure.
function lastVerdictOn(experiments: Experiment[], game: string): Map<string, string> {
  const when = (x: Experiment) => {
    const t = Date.parse(x.concluded_at ?? x.created_at);
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  const last = new Map<string, string>();
  for (const x of experiments.filter((x) => x.game === game && x.verdict != null).sort((a, b) => when(a) - when(b))) {
    last.set(x.rec_id, x.verdict as string);
  }
  return last;
}

function treatmentFor(exp: Experiment, sessions: SessionSummary[]): SessionSummary | null {
  if (!canConclude(exp)) return null;
  const started = new Date(exp.applied_at).getTime();
  const candidates = sessions
    .filter(
      (s) =>
        s.process_name === exp.game && isUsableReading(s) && new Date(s.started_at).getTime() > started,
    )
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return candidates[0] ?? null;
}

/** `onChanged` is App's refresh (LabGround passes it). Every bench write moves the Trust Ledger, and
 *  App's `recs`/`changes` (the Optimize station beside the bench) re-read only through it (#621).
 *  `ledgerBusy` is App's shared busy flag (`busyId !== null`): while another write runs (e.g. the
 *  Care view's "Put back how it was", busyId "care-restore"), no Trial may start (P6-restore-f1). */
export default function ExperimentBench({
  onChanged,
  ledgerBusy = false,
}: { onChanged?: () => Promise<unknown> | void; ledgerBusy?: boolean } = {}) {
  const { t } = useTranslation();
  const [gate, setGate] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [recs, setRecs] = useState<TrialCandidate[]>([]);
  // Whether get_trial_candidates has answered. Until it has (or when it failed), nothing may say
  // there is nothing worth testing: an empty list before the load is not an empty catalog.
  const [recsLoaded, setRecsLoaded] = useState(false);
  // P4-next: the Trial this visit just concluded, whose result offers the next change to test.
  const [concluded, setConcluded] = useState<Experiment | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  // Counts finished reloads, so a check that depends on more than what the bench holds (the change
  // history behind Smoothest's readiness) is asked again after each one.
  const [reloads, setReloads] = useState(0);
  // The ledger rows as the last reload read them; null = not read (yet), which counts as moved.
  const [ledger, setLedger] = useState<AppliedChange[] | null>(null);

  const [pickId, setPickId] = useState<string>("");
  const [sim, setSim] = useState<SimulatorReport | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [hypothesis, setHypothesis] = useState<string>("");
  const [outcome, setOutcome] = useState<TrialOutcome>("recommended");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P8-posture-b: how far Compy may go on this PC; sent with every candidate read.
  const [riskChoice, setRiskChoice] = useState<RiskChoice>(loadRiskChoice);
  // P5-guided: while the one-button journey runs, it is the bench's only panel.
  const journey = useJourneyPhase();

  // Sequences simulate_optimization responses: a fast reselect must never leave `sim` pointing at a
  // rec the dropdown no longer shows — startExperiment applies the REAL change from sim.rec_id, so a
  // stale read here is a mutation-boundary hazard. Each call claims the next id; only the latest commits.
  const simReq = useRef(0);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("get_experiment_gate")
      .then((g) => alive && setGate(g))
      .catch(() => {
        /* probe failed → stay hidden (fail-dark) */
      });
    return () => {
      alive = false;
    };
  }, []);

  // P8-posture-b review MUST-FIX: reloads overlap (focus, ledger event, risk change). A slower read made
  // under the OLD risk answer must never land after the new one, or changes above the chosen risk would
  // be offered again. Same latest-wins rule as `simReq`.
  const reloadReq = useRef(0);
  const reload = useCallback(async () => {
    const reqId = ++reloadReq.current;
    const [xs, rs, ss, cs] = await Promise.all([
      invoke<Experiment[]>("get_experiments").catch(() => []),
      invoke<TrialCandidate[]>("get_trial_candidates", { riskChoice }).catch(() => null),
      invoke<SessionSummary[]>("get_session_summaries").catch(() => []),
      // CR-next-moved-outside: a "changed outside Compy" record moves the as-is session for the
      // start's §3 check, so the next-test offer reads the ledger too (unread = moved).
      invoke<AppliedChange[]>("get_applied_changes").catch(() => null),
    ]);
    if (reloadReq.current !== reqId) return; // superseded by a newer read - drop it
    setExperiments(xs ?? []);
    setRecs(rs ?? []);
    if (rs != null) setRecsLoaded(true);
    setSessions(ss ?? []);
    setLedger(Array.isArray(cs) ? cs : null);
    setReloads((n) => n + 1);
  }, [riskChoice]);

  useEffect(() => {
    if (!gate) return;
    reload();
  }, [gate, reload]);

  // Whether a real before-reading exists — governs the simulator's hypothesis wording. A primitive so
  // runSim's useCallback stays stable across renders (the focus-refresh effect below depends on it).
  const hasBaseline = sessions.some(isUsableReading);

  // Runs the optimization simulator for a pick. `quiet` (the refresh path) re-derives the verdict from
  // the live ledger WITHOUT the pick/spinner/hypothesis reset — a background refresh never flickers the
  // card or clobbers the owner's typed hypothesis; a user pick (non-quiet) keeps the full behavior.
  const runSim = useCallback(
    async (recId: string, opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet ?? false;
      const reqId = ++simReq.current;
      if (!quiet) {
        setPickId(recId);
        setSim(null);
        setError(null);
      }
      if (!recId) return;
      if (!quiet) setSimBusy(true);
      try {
        const report = await invoke<SimulatorReport>("simulate_optimization", { recId });
        if (simReq.current !== reqId) return; // a newer read superseded this one — drop the stale sim
        setSim(report);
        if (!quiet) {
          const metric = report.metric_to_watch ?? t("lab.experimentBench.hypothesisMetricFallback");
          setHypothesis(
            hasBaseline
              ? t("lab.experimentBench.hypothesisWithBaseline", { metric })
              : t("lab.experimentBench.hypothesisWithoutBaseline", { metric }),
          );
        }
      } catch (e) {
        if (simReq.current !== reqId) return; // stale error from a superseded pick — ignore
        if (!quiet) setError(String(e));
      } finally {
        if (simReq.current === reqId && !quiet) setSimBusy(false);
      }
    },
    [hasBaseline, t],
  );

  // Intelligence Phase 3 fast-follow (W2 + Measurement-2.0 Task A): the bench loads once when the gate
  // arms, so a change applied over in Optimize during the same Lab visit would leave the picker + an
  // active simulator read stale. Two wake signals reload the ledger and re-derive the active pick's
  // verdict: (1) OS refocus (window focus / tab re-shown) covers an apply made while the window was
  // backgrounded; (2) the in-app `compy:ledger-changed` event covers a *same-window* sibling apply (the
  // Optimize station in the same Lab visit fires no focus/visibilitychange, so refocus alone misses it).
  // Either way an externally-applied pick honestly resolves to "already configured" and Start stops being
  // offered. No new mutation path — this is a read-only refresh listening on an additive frontend event.
  useEffect(() => {
    if (!gate) return;
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      reload();
      if (pickId) runSim(pickId, { quiet: true });
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener(LEDGER_CHANGED_EVENT, onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener(LEDGER_CHANGED_EVENT, onWake);
    };
  }, [gate, pickId, reload, runSim]);

  // P7-route: an interview answer ("I want more FPS" / "Did it help?") lands here once, on the
  // journey or on "What Compy tested". Taken on mount (one-shot, like care-arrival), then landed on
  // the first render where its target exists. A target that never renders simply never lands.
  const arrival = useRef<BenchArrival | null>(null);
  useEffect(() => {
    arrival.current = takeBenchArrival();
  }, []);
  useEffect(() => {
    const a = arrival.current;
    if (!gate || !a) return;
    const el = document.querySelector<HTMLElement>(
      a === "journey" ? '[data-testid="journey"]' : '[data-testid="exp-summary"]',
    );
    if (!el) return;
    arrival.current = null;
    el.scrollIntoView?.({ block: "start" });
    if (a === "journey") el.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
  });

  // P4-smooth-offer-b: whether Smoothest can start from the session a Trial would start from, asked
  // of the start's own check. Until it answers, or when it can't, Smoothest isn't offered. Asked again
  // whenever the bench reloads its Trials (an apply, undo or conclude can change what the check reads),
  // so neither a stale yes nor a transient failure outlives the next reload.
  const smoothFrom = latestUsableReading(sessions)?.started_at ?? null;
  const [smoothReady, setSmoothReady] = useState<{ from: string; r: SmoothestReadiness | null } | null>(null);
  useEffect(() => {
    if (!gate || !smoothFrom) return;
    let live = true;
    invoke<SmoothestReadiness>("get_smoothest_readiness", { baselineSessionId: smoothFrom })
      .then((r) => live && setSmoothReady({ from: smoothFrom, r }))
      .catch(() => live && setSmoothReady({ from: smoothFrom, r: null }));
    return () => {
      live = false;
    };
  }, [gate, smoothFrom, reloads]);
  const smoothAnswer = smoothReady && smoothReady.from === smoothFrom ? smoothReady : null;
  const smoothestOpen = smoothAnswer?.r?.held === null;
  // A Smoothest pick the check no longer allows goes back to the default, so the picker never shows a
  // choice it can't start and its "why" line never describes one.
  useEffect(() => {
    if (outcome === "smoothest" && smoothAnswer && !smoothestOpen) setOutcome("recommended");
  }, [outcome, smoothAnswer, smoothestOpen]);

  // P5-realplay: where real play stands, for a running real-play Trial's game, else for the game a
  // Trial would run on (the bench's baseline game, else the one just tested). A read-only backend read
  // asked again after every reload, so the panel is always derived from the records, never from a
  // copy kept here. An answer is used only for the Trial (or no-Trial state) it was asked for.
  const runningNow = experiments.find((x) => x.status === "running") ?? null;
  const rpGame = runningNow
    ? isRealPlay(runningNow)
      ? runningNow.game
      : null
    : (latestUsableReading(sessions)?.process_name ?? concluded?.game ?? null);
  const rpTrial = runningNow?.id ?? null;
  const [rpRead, setRpRead] = useState<{ game: string; trial: string | null; progress: RealPlayProgress | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!gate || !rpGame) return;
    let live = true;
    invoke<unknown>("get_realplay_progress", { game: rpGame })
      .then((p) => live && setRpRead({ game: rpGame, trial: rpTrial, progress: asRealPlayProgress(p), error: null }))
      .catch((e) => live && setRpRead({ game: rpGame, trial: rpTrial, progress: null, error: String(e) }));
    return () => {
      live = false;
    };
  }, [gate, rpGame, rpTrial, reloads]);
  const rp = rpRead && rpRead.game === rpGame && rpRead.trial === rpTrial ? rpRead : null;

  if (!gate) return null;

  const running = experiments.find((x) => x.status === "running") ?? null;
  // The picker's live answer reads a classic running Trial's change as off (stillAppliedFrom, the
  // summary's own read): its panel and the progress line above it say so, never "Testing now".
  const runningOff = running != null && !isRealPlay(running) && stillAppliedFrom(recs.find((r) => r.id === running.rec_id)) === "off";
  const history = experiments.filter((x) => x.status !== "running");

  // The honest baseline: the most recent monitored session with a real frame-rate reading and a known
  // game (the backend refuses anything less). The experiment locks to that game. No sessions → we
  // cannot invent a baseline; the owner plays one monitored session first.
  const baseline = latestUsableReading(sessions);

  // §11 notes for the past experiments. Every sentence is said once per list, however many rows it
  // covers — the same sentence down the rows buries the rows it describes (C-11). When every judged
  // row says the same thing, that line is the list's rule, said under the label. A row whose verdict
  // already says it wasn't judged ("—", interfered, not enough evidence) needs no note. "Not
  // comparable" can't say which pair failed (another game, or a crash session Compy can't tie to the
  // change or compare), so that row carries the backend's own reason — never the list's rule. Every
  // other note — a row that LOOKS judged (Better / No change / Worse) but has no record (a crash, an
  // older result), or noise lines that differ between rows — is said once under the list, and its
  // rows carry only its mark.
  const noiseLines = history.map((x) =>
    x.noise_evidence
      ? isRealPlay(x)
        ? realPlayNoiseLine(x.noise_evidence.band_pct, realPlayCounts(x), prettyGameName(x.game) || x.game, t)
        : noiseLine(x.noise_evidence, x.game, t)
      : null,
  );
  const rowNotes = history.map((x, i): RowNote | null =>
    noiseLines[i] ?? (looksJudged(x) ? NO_RECORD : x.verdict === "not-comparable" ? x.verdict_note || null : null),
  );
  const judgedLines = new Set(noiseLines.filter((n): n is string => n !== null));
  const sharedNoise = judgedLines.size === 1 ? [...judgedLines][0] : null;
  const footnotes = [...new Set(rowNotes.filter((n): n is RowNote => n !== null && n !== sharedNoise))];
  const footnoteText = (n: RowNote) =>
    n === NO_RECORD
      ? t("lab.experimentBench.noiseNotRecorded", { count: rowNotes.filter((r) => r === NO_RECORD).length })
      : n;
  const rowMark = rowNotes.map((n) => (n === null || n === sharedNoise ? null : noteMark(footnotes.indexOf(n))));

  // The testable universe: catalog changes that pass "worth testing on this PC". The rest are listed,
  // each with its reason, behind "Show why others aren't listed" — never dropped silently.
  // In the backend's suggested order (P4-rank); a change without a position keeps its place after them.
  const pickable = recs
    .filter((r) => r.passes)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.position ?? Infinity) - (b.r.position ?? Infinity) || a.i - b.i)
    .map(({ r }) => r);
  const ranked = pickable.filter((r) => r.position != null && r.evidence && r.risk);
  const effectUnknown = ranked.filter((r) => r.stated_effect_pct == null);
  // A pick kept in the dropdown after a refresh (below) is listed there only, not here as well.
  const skipped = recs.filter((r) => !r.passes && r.id !== pickId);

  // P4-next (ENGINE §7): after a Trial, the next change in the suggested order not yet tested on that
  // game here, else one worth another run (journey-resume.ts `nextToTest`: an inconclusive attempt
  // under the retest cap, or a result judged under an older driver or Windows build). An offer only:
  // choosing it sets the test up, and nothing changes until Start. The Trial just concluded counts
  // with its own verdict even before the store re-reads it: it replaces the store's copy of itself
  // (which may still read Running), never only fills a gap.
  const withJudged = (just: { id: string; verdict?: string | null } | null): Experiment[] =>
    just == null || just.verdict == null // not a judged copy (a conclude that answered no record): the store decides
      ? experiments
      : [...experiments.filter((x) => x.id !== just.id), { ...(experiments.find((x) => x.id === just.id) ?? {}), ...just } as Experiment];
  const nextUp = concluded ? nextToTest(concluded.game, withJudged(concluded), ranked, sessions) : null;
  const noEffectStated = recs.every((r) => r.stated_effect_pct == null);

  // P4-exit: the per-game summary, for the game just tested, else the bench's baseline game, else the
  // newest game with a judged Trial. Only a game with a judged Trial has one.
  const summaryGames = [
    concluded?.game,
    baseline?.process_name,
    ...[...history].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((x) => x.game),
  ].filter((g): g is string => !!g);
  const summary =
    summaryGames
      .map((g) => summarizeGame(g, experiments, recsLoaded ? recs : null, sessions))
      .find((s) => s != null) ?? null;
  // P5-outcomes: for the summary's game, the changes whose Recommended and Maximum FPS results disagree.
  const choices = summary ? outcomeChoices(summary.game, experiments, recsLoaded ? recs : null, sessions) : [];
  // No switch while a Trial runs or the journey is anywhere but idle (waiting, uneven, judging, …).
  const switchLocked = running != null || journey.kind !== "idle";

  // If a refocus-refresh just re-derived the active pick as already-applied (it drops out of `pickable`),
  // keep it in the dropdown so its honest "already configured" verdict stays on screen — the selection
  // must not silently vanish while its simulator card is still showing.
  // P4-next-f1: in the picker, a change already tested on the game this Trial would run on (the
  // baseline's, else the one just tested) is marked with its last verdict and listed after the untested
  // ones, each group in the suggested order. It stays pickable: testing it again is allowed.
  const pickGame = baseline?.process_name ?? concluded?.game ?? null;
  const lastVerdict = pickGame ? lastVerdictOn(experiments, pickGame) : new Map<string, string>();
  const pickOrder = [
    ...pickable.filter((r) => !lastVerdict.has(r.id)),
    ...pickable.filter((r) => lastVerdict.has(r.id)),
  ];
  const options =
    pickId && !pickable.some((r) => r.id === pickId)
      ? [...pickOrder, ...recs.filter((r) => r.id === pickId)]
      : pickOrder;
  const verdictText = verdictCopy(t);
  // P5-guided: the journey tests the top-ranked change not yet tested on that game (P4-rank order),
  // else one worth another run (`nextToTest`), never a change with a result that still holds.
  const journeyChange = pickGame
    ? nextToTest(pickGame, experiments, pickable, sessions)
    : pickOrder[0]
      ? { ...pickOrder[0], retest: null }
      : null;
  // P5-continue: after a concluded journey, P4-next's rule for its game (the Trial just judged counts
  // with its verdict). Unknown until the candidates have loaded: an empty list then is not "nothing left".
  const journeyNext =
    journey.kind === "result" && recsLoaded ? nextToTest(journey.exp.game, withJudged(journey.exp), ranked, sessions) : undefined;
  // P8-posture-note (review 2026-11-02): how many changes on the journey's game the chosen risk holds
  // back, by the summary's own count (`outsideRisk`), so the journey's "nothing left" never hides that
  // the risk choice is what stopped it: the finished journey's game, else the game it would run on.
  const journeyGame = journey.kind === "result" ? journey.exp.game : pickGame;
  const journeyHeldByRisk =
    journeyGame && recsLoaded
      ? ((summary?.game === journeyGame ? summary : summarizeGame(journeyGame, experiments, recs, sessions))?.outsideRisk.length ?? 0)
      : 0;
  // P5-resume: the game's journey progress, derived from the experiments store, for the game a
  // running Trial is on, else the journey's game. Unknown until the candidates have loaded.
  const progressGame = running?.game ?? pickGame;
  const heldBack = recs.filter((r) => r.reason === "outside-chosen-risk").map((r) => r.id);
  const progress = progressGame && recsLoaded ? journeyProgress(progressGame, experiments, pickable, sessions, heldBack) : null;
  const optionLabel = (r: TrialCandidate) => {
    const v = lastVerdict.get(r.id);
    return v == null
      ? r.title
      : t("lab.experimentBench.pickTested", { title: r.title, verdict: verdictText[v] ?? v });
  };

  // Every bench write goes through writeLedger, which announces LEDGER_CHANGED_EVENT (the Machine
  // Model, this bench's own wake listener) and then runs `settle`: the bench's re-read and App's
  // refresh, so the Optimize station beside the bench stops showing the ledger as it was (#621).
  const settle = async () => {
    await reload();
    await onChanged?.();
  };

  // A write can fail AFTER it moved the ledger (a start whose target check restored, a conclude or
  // restore whose restore failed part-way). writeLedger announces nothing when the command rejects,
  // so the bench announces and settles itself; when only the refresh failed, the write was already
  // announced and the refresh is simply tried again.
  async function runWrite(write: (refresh: () => Promise<void>) => Promise<unknown>, onWritten?: () => void) {
    let announced = false;
    try {
      await write(async () => {
        announced = true;
        onWritten?.();
        await settle();
      });
    } catch (e) {
      // A loud restore-failed error is surfaced verbatim — never hidden (honesty rail).
      setError(String(e));
      if (!announced) window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
      await settle().catch(() => {});
    }
  }

  // P8-ack: `costAcknowledged` is the tap on "I understand, test it" under the line naming the change's
  // cost; a low-risk change starts as before and sends false (nothing was asked).
  async function startExperiment(costAcknowledged: boolean) {
    // P6-restore-f1: the handler refuses too, not just the button, while another write holds the flag.
    if (!sim || !baseline || ledgerBusy || busy) return;
    setBusy(true);
    setError(null);
    try {
      await runWrite(
        (refresh) =>
          writeLedger<Experiment>(
            "start_experiment",
            {
              recId: sim.rec_id,
              recTitle: sim.rec_title,
              // By id only: the backend reads the game and the numbers from its own session store.
              baselineSessionId: baseline.started_at,
              hypothesis,
              outcome,
              // P8-posture-show: the risk allowed now, kept on the record for its receipt.
              riskChoice,
              costAcknowledged,
            },
            refresh,
          ),
        () => {
          // The announcement just started a quiet re-simulation of the old pick (the wake listener);
          // claim a newer sim id so its answer is dropped and the cleared card can't come back.
          ++simReq.current;
          setSim(null);
          setPickId("");
          setConcluded(null);
        },
      );
    } finally {
      setBusy(false);
    }
  }

  async function concludeExperiment(exp: Experiment, treatment: SessionSummary) {
    setBusy(true);
    setError(null);
    try {
      // A conclude that doesn't keep restores the change through the audited path.
      await runWrite(async (refresh) => {
        const done = await writeLedger<Experiment>(
          "conclude_experiment",
          {
            experimentId: exp.id,
            // By id only: the backend reads the session itself and refuses one that isn't comparable
            // to the baseline, rather than trusting our same-game filter above.
            treatmentSessionId: treatment.started_at,
            crashed: false,
          },
          refresh,
        );
        setConcluded(done?.id ? done : exp);
      });
    } finally {
      setBusy(false);
    }
  }

  async function restoreExperiment(exp: Experiment) {
    setBusy(true);
    setError(null);
    try {
      await runWrite((refresh) => writeLedger<Experiment>("restore_experiment", { experimentId: exp.id }, refresh));
    } finally {
      setBusy(false);
    }
  }

  // P5-outcomes: switch one change to the other outcome's result, only through the audited paths.
  // Keeping it re-applies through apply_outcome_choice (the apply_recommendation path, plus the Trial
  // that judged it Better under that outcome, recorded on the ledger row); putting it back undoes its
  // newest live apply through undo_outcome_choice (the rollback_change path, plus the Trial that
  // didn't keep it).
  async function pickOutcome(c: OutcomeChoice, pick: ResultOutcome) {
    // Never while a Trial or the journey is under way: an undo could take back the running Trial's
    // own apply mid-measurement, and a re-apply would confound it.
    if (busy || switchLocked || c.inEffect == null || c.inEffect === pick) return;
    // Follow-up review §1: a keep Trial judged under a changed GPU, driver or Windows build is
    // history, not proof. The summary already calls it stale; the switch may not re-apply on it.
    if (pick === c.keepOutcome && c.keepStale) return;
    setBusy(true);
    setError(null);
    try {
      if (pick === c.keepOutcome) {
        const better = experiments.find(
          (x) => x.id === c.keepTrialId && x.rec_id === c.recId && x.verdict === "improved" && x.outcome !== "smoothest" && (x.outcome === "max-fps" ? "max-fps" : "recommended") === pick,
        );
        if (!better) return; // no Trial judged it Better under this outcome: there is no keep
        // P5-outcomes-f1: the same audited apply, and the ledger row records which Trial justified
        // it. The backend checks that Trial against its own store before anything changes.
        await runWrite((refresh) =>
          writeLedger("apply_outcome_choice", { recId: c.recId, recTitle: c.title, experimentId: better.id }, refresh),
        );
      } else {
        // The undo targets the newest apply of this change that reads on (the shared #453 rule).
        const rows = await invoke<AppliedChange[]>("get_applied_changes").catch(() => null);
        const live = rows ? liveChangeGroups(rows).active.find((r) => r.rec_id === c.recId) : undefined;
        if (!live) {
          setError(t("lab.experimentBench.outcomeChoice.notFound", { change: c.title }));
          return;
        }
        // The Trial under the picked outcome that didn't keep it is the reason for the undo.
        const because = pick === "max-fps" ? c.maxFps : c.recommended;
        await runWrite((refresh) =>
          writeLedger("undo_outcome_choice", { changeId: live.id, experimentId: because.trialId }, refresh),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const SIM_VERDICT = simVerdictCopy(t);
  const simMeta = sim ? SIM_VERDICT[sim.verdict] ?? { label: sim.verdict, blocked: false } : null;
  const grade = baseline ? gradeBaseline(baseline) : null;
  const canStart = !!sim && !!simMeta && !simMeta.blocked && !!baseline && grade?.kind !== "too-short" && !busy && !ledgerBusy && (outcome !== "smoothest" || smoothestOpen);
  // P8-ack (RISK_MODEL §1 Advanced): the picked change as the picker read it. One the catalog doesn't
  // rate low risk starts only from the tap under the line naming its cost.
  const simCandidate = sim ? recs.find((r) => r.id === sim.rec_id) : undefined;
  // A pick the candidate read no longer lists can't be shown to be low risk: it needs the tap too,
  // as the backend's own lock (P8-ack-enforce) will ask for it.
  const costAck = !!sim && (!simCandidate || needsCostAck(simCandidate.risk));

  // Bento conversion (2026-08-12). span="full" is FORCED, not a taste call: this component can
  // return null (the dark experiment gate above) and this file declares no grid of its own, so
  // rule 3 of one-hero-guard.test.ts ("a tile component that can render null is span=\"full\"")
  // applies. That guard reads raw source TEXT, so prose here must never spell the grid element's
  // opening tag out — a mention in a comment reads as a real grid block and fails rule 1.
  // LabGround mounts this as a SIBLING of <LabConsole> under RoomShell — not inside a grid — which
  // is the same out-of-grid tile idiom LabConsole already uses for its open station panel. The
  // tile draws the room's heading, so the old <h2 className="exp-bench-title"> is gone (one title,
  // not two). The testid rides an inner <div>: BentoTile takes a fixed prop set and does not
  // spread, so a testid on the tile itself would be silently dropped.
  return (
    <BentoTile title={t("lab.experimentBench.title")} span="full">
      <div className="exp-bench" data-testid="experiment-bench">
      <p className="exp-bench-hint">
        {t("lab.experimentBench.hint")}
      </p>

      {error && (
        <p className="exp-bench-error" role="alert">
          {error}
        </p>
      )}
      {error && <ChangedOutsideRemedy reason={error} refresh={settle} />}

      {ledgerBusy && !running && (
        <p className="exp-fineprint" data-testid="exp-ledger-busy" role="status">
          {t("lab.experimentBench.ledgerBusy")}
        </p>
      )}

      {(journey.kind !== "idle" || !running) && (
        <GuidedJourney
          game={pickGame}
          change={
            journeyChange
              ? { id: journeyChange.id, title: journeyChange.title, retest: journeyChange.retest, risk: journeyChange.risk, cost: journeyChange.cost }
              : null
          }
          canStart={!busy && !running && !ledgerBusy}
          outcome={outcome === "smoothest" ? "recommended" : outcome}
          onOutcome={setOutcome}
          next={journeyNext}
          // CR-next-reuse-moved: the offer promises one session only when the start will accept the
          // as-is session; a Trial that moved a change after it (the finished one's own put-back
          // included) means a new before-session, and the offer says so up front.
          nextReuses={
            journey.kind === "result" &&
            reusableAsIs(sessions, journey.asIs, journey.exp.game) != null &&
            !trialMovedSince([...experiments, journey.exp], journey.asIs, ledger)
          }
          refresh={settle}
          riskChoice={riskChoice}
          progress={progress}
          resumeReuses={
            progress != null && reusableAsIs(sessions, progress.asIs, progress.game) != null && !trialMovedSince(experiments, progress.asIs, ledger)
          }
          stillOn={progress ? stillOnFor(progress.game, experiments, recs) : []}
          realPlay={running ? null : (rp?.progress ?? null)}
          heldByRisk={journeyHeldByRisk}
          onFinished={(exp) => {
            // The finished journey hands over to P4-next's offer of the next change to test.
            if (exp) setConcluded(experiments.find((x) => x.id === exp.id) ?? null);
          }}
        />
      )}

      {journey.kind === "idle" && running && (
        // P5-realplay: a real-play Trial runs across restarts by design, so it is never "interrupted".
        // Stopped, its panel says why and offers "Close this test"; the line above says it stopped.
        <JourneyProgressLine
          progress={progress}
          interrupted={!isRealPlay(running) && running.id === interruptedJourneyId()}
          stopped={isRealPlay(running) && rp?.progress?.experiment_id === running.id && rp.progress.phase === "stopped"}
          changeOff={runningOff}
        />
      )}
      {journey.kind !== "idle" ? null : running && isRealPlay(running) ? (
        // P5-realplay: the change stays on while the owner plays; the panel says so, how long, how to
        // put it back, and where the count stands, from the record and the progress read.
        <RealPlayPanel
          exp={running}
          progress={rp?.progress ?? null}
          unread={rp ? (rp.error ?? (rp.progress ? null : "")) : null}
          canAct={!busy && !ledgerBusy}
          refresh={settle}
        />
      ) : running ? (
        // ── One experiment in flight: single-variable honesty is enforced by hiding the launcher ──
        <RunningPanel
          exp={running}
          treatment={treatmentFor(running, sessions)}
          // P5-guided: a journey Trial still running while no journey runs was interrupted (Compy
          // closed, a reload, the room left mid-session). Its change is still on; this says so.
          interrupted={running.id === interruptedJourneyId()}
          changeOff={runningOff}
          busy={busy}
          onConclude={concludeExperiment}
          onRestore={restoreExperiment}
        />
      ) : (
        // ── Launcher: pick a change → honest simulator read → start against the real baseline ──
        <div className="exp-launch">
          {/* P8-posture-b (RISK_MODEL §2): asked once, saved; every candidate read carries it. A change
              above the chosen risk moves to "why not listed" with its reason, never vanishes. */}
          <div className="exp-field" data-testid="exp-risk-choice">
            <span className="exp-field-label" id="exp-risk-label">
              {t("lab.experimentBench.riskChoice.label")}
            </span>
            <Picker
              className="exp-select"
              labelledBy="exp-risk-label"
              value={riskChoice}
              // P8-launch-flash: held until the first read returns. Until then the bench can't know a
              // Trial is running, so it shows this launcher (about 3 s on the owner's rig), and a pick
              // here saved a new risk choice while a Trial ran.
              disabled={busy || simBusy || reloads === 0}
              onChange={(v) => {
                const next: RiskChoice = v === "low-only" ? "low-only" : "low-and-moderate";
                if (next === riskChoice) return;
                // A pick made under the old answer may now be outside it: start over, never carry it.
                runSim("");
                saveRiskChoice(next);
                setRiskChoice(next);
              }}
              options={[
                { value: "low-only", label: t("lab.experimentBench.riskChoice.lowOnly") },
                { value: "low-and-moderate", label: t("lab.experimentBench.riskChoice.lowAndModerate") },
              ]}
            />
          </div>
          {/* C-10: was a native <select>, whose OS-drawn menu ignored every token in the room.
              `<label>` became a plain wrapper + an explicit `labelledBy` because the Picker's
              trigger is a button, and implicit label association only works for form controls. */}
          <div className="exp-field">
            <span className="exp-field-label" id="exp-pick-label">
              {t("lab.experimentBench.pickLabel")}
            </span>
            <Picker
              className="exp-select"
              labelledBy="exp-pick-label"
              value={pickId}
              disabled={busy || simBusy}
              onChange={(v) => runSim(v)}
              // The empty entry is a real, re-selectable option rather than a `placeholder`, because
              // that is what the `<select>` this replaced had: its blank `<option value="">` was how
              // a user backed out of a pick, and `runSim("")` still clears the pick, the sim and the
              // error. Carried as a placeholder it would show once and never be reachable again —
              // a one-way door where the old control had a door (caught in review, 2026-08-18).
              options={[
                { value: "", label: t("lab.experimentBench.chooseChange") },
                ...options.map((r) => ({ value: r.id, label: optionLabel(r) })),
              ]}
            />
          </div>
          {concluded && recsLoaded && (
            <div className="exp-order exp-next" data-testid="exp-next">
              {nextUp ? (
                <>
                  <p className="exp-order-label">
                    {t("lab.experimentBench.next.label", { game: prettyGameName(concluded.game) || concluded.game })}{" "}
                    <span className="exp-why-title">{nextUp.title}</span>
                  </p>
                  <p className="exp-note">
                    {nextUp.retest
                      ? t(`lab.experimentBench.journey.retestWhy.${nextUp.retest}`, { change: nextUp.title })
                      : t("lab.experimentBench.next.why", {
                          evidence: t(EVIDENCE_KEY[nextUp.evidence!]),
                          risk: t(RISK_KEY[nextUp.risk!]),
                        })}
                    {!nextUp.retest && nextUp.stated_effect_pct == null ? ` ${t("lab.experimentBench.rank.effectUnknownOne")}` : null}
                  </p>
                  <button
                    type="button"
                    className="exp-cta-ghost"
                    disabled={busy || simBusy}
                    onClick={() => {
                      setConcluded(null);
                      runSim(nextUp.id);
                    }}
                  >
                    {t("lab.experimentBench.next.setUp")}
                  </button>
                  <p className="exp-fineprint">{t("lab.experimentBench.next.offerOnly")}</p>
                </>
              ) : (
                <>
                  <p className="exp-note" data-testid="exp-next-done">
                    {t("lab.experimentBench.next.none")}
                  </p>
                  <p className="exp-fineprint" data-testid="exp-next-done-why">
                    {/* Round 3 §2: worded from what every change holds (the summary's stop counts), never
                        "every change has a result" when one of them was never judged. */}
                    {summary?.game === concluded.game && summary.stop.noResult + summary.stop.unverified + summary.stop.stale > 0
                      ? [
                          t("lab.experimentBench.summary.stopMeasured", { count: summary.stop.measured }),
                          ...(summary.stop.noResult > 0 ? [t("lab.experimentBench.summary.stopUnjudged", { count: summary.stop.noResult })] : []),
                          ...(summary.stop.unverified > 0 ? [t("lab.experimentBench.journey.progressUnverified", { count: summary.stop.unverified })] : []),
                          ...(summary.stop.stale > 0 ? [t("lab.experimentBench.journey.progressStale", { count: summary.stop.stale })] : []),
                        ].join(" ")
                      : t("lab.experimentBench.next.noneWhy", { game: prettyGameName(concluded.game) || concluded.game })}
                    {summary?.game === concluded.game && summary.staleKept.length > 0
                      ? ` ${t("lab.experimentBench.journey.progressStaleKept", { count: summary.staleKept.length })}`
                      : null}
                    {noEffectStated ? ` ${t("lab.experimentBench.next.noneEffectUnknown")}` : null}
                  </p>
                </>
              )}
            </div>
          )}
          {recsLoaded && options.length === 0 && !concluded && (
            <p className="exp-note">
              {t("lab.experimentBench.noChangesToTest")}
            </p>
          )}
          {ranked.length > 0 && (
            <div className="exp-order">
              <p className="exp-order-label">{t("lab.experimentBench.rank.label")}</p>
              <ol className="exp-order-list">
                {ranked.map((r) => (
                  <li key={r.id} data-rec={r.id}>
                    <span className="exp-why-title">{r.title}</span>{" "}
                    <span className="exp-why-reason">
                      {t("lab.experimentBench.rank.reason", {
                        evidence: t(EVIDENCE_KEY[r.evidence!]),
                        risk: t(RISK_KEY[r.risk!]),
                      })}
                      {effectUnknown.length !== ranked.length && r.stated_effect_pct == null
                        ? ` ${t("lab.experimentBench.rank.effectUnknownOne")}`
                        : null}
                    </span>
                  </li>
                ))}
              </ol>
              {effectUnknown.length === ranked.length && (
                <p className="exp-note">{t("lab.experimentBench.rank.effectUnknownAll")}</p>
              )}
            </div>
          )}
          {skipped.length > 0 && (
            <div className="exp-why">
              <button
                type="button"
                className="exp-why-toggle"
                aria-expanded={showWhy}
                aria-controls="exp-why-list"
                onClick={() => setShowWhy((v) => !v)}
              >
                {showWhy ? t("lab.experimentBench.hideWhyNotListed") : t("lab.experimentBench.showWhyNotListed")}
              </button>
              {showWhy && (
                <ul className="exp-why-list" id="exp-why-list">
                  {skipped.map((r) => (
                    <li key={r.id} data-rec={r.id}>
                      <span className="exp-why-title">{r.title}</span>{" "}
                      <span className="exp-why-reason">
                        {r.reason
                          ? t(SKIP_REASON_KEY[r.reason], {
                              effect: r.too_small?.effect_pct.toFixed(1),
                              band: r.too_small?.band_pct.toFixed(1),
                            })
                          : null}
                        {r.detail ? ` ${r.detail}` : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {simBusy && <p className="exp-note">{t("lab.experimentBench.readingRig")}</p>}

          {sim && simMeta && (
            <div className="exp-sim" data-verdict={sim.verdict}>
              <p className="exp-sim-rec">{sim.rec_title}</p>
              <div className="exp-sim-head">
                <VerdictBand tone={simulationTone(sim.verdict)}>{simMeta.label}</VerdictBand>
                <span className="exp-sim-conf"><BenchWord c={sim.confidence} kind="estimate" /></span>
              </div>
              <p className="exp-sim-why">{sim.why}</p>
              <p className="exp-sim-line">
                <span className="exp-sim-mark">{t("lab.experimentBench.forYourRig")}</span> {sim.hardware_factor}
              </p>
              {sim.metric_to_watch && (
                <p className="exp-sim-line">
                  <span className="exp-sim-mark">{t("lab.experimentBench.watch")}</span> {sim.metric_to_watch}
                </p>
              )}
              <p className="exp-sim-line">
                <span className="exp-sim-mark">{t("lab.experimentBench.disprovedIf")}</span> {sim.disproof}
              </p>
            </div>
          )}

          {sim && simMeta && !simMeta.blocked && (
            <div className="exp-start">
              {baseline ? (
                <>
                  <p className="exp-baseline">
                    <span className="exp-sim-mark">{t("lab.experimentBench.baselineLabel")}</span>{" "}
                    {t("lab.experimentBench.baselinePre", {
                      game: prettyGameName(baseline.process_name) || t("lab.experimentBench.yourLastSession"),
                    })}{" "}
                    <b>{Math.round(baseline.avg_fps)}</b> {t("lab.experimentBench.baselineMid")}{" "}
                    <b>{Math.round(baseline.low1_fps_est)}</b>{" "}
                    {t("lab.experimentBench.baselinePost", { when: whenLabel(baseline.started_at, t) })}
                  </p>
                  {grade?.kind === "too-short" ? (
                    <p className="exp-note" data-testid="exp-baseline-unfit">
                      {t("lab.experimentBench.baselineTooShort", { readings: grade.samples, min: MIN_BASELINE_SAMPLES })}{" "}
                      {(baseline.background_secs_excluded ?? 0) > 0 &&
                        `${t("lab.experimentBench.baselineTooShortLeftOut", { span: spanText(baseline.background_secs_excluded ?? 0, t) })} `}
                      {prettyGameName(baseline.process_name)
                        ? t("lab.experimentBench.baselineRerecord", { game: prettyGameName(baseline.process_name) })
                        : t("lab.experimentBench.baselineRerecordNoGame")}
                    </p>
                  ) : (
                  <>
                  {grade?.kind === "uneven" && (
                    <p className="exp-bench-warn" data-testid="exp-baseline-warn">
                      {t("lab.experimentBench.baselineUneven", { first: Math.round(grade.first), second: Math.round(grade.second) })}
                    </p>
                  )}
                  {grade?.kind === "untraced" && (
                    <p className="exp-bench-warn" data-testid="exp-baseline-warn">
                      {t("lab.experimentBench.baselineUntraced")}
                    </p>
                  )}
                  <label className="exp-field">
                    <span className="exp-field-label">{t("lab.experimentBench.hypothesisLabel")}</span>
                    <input
                      className="exp-input"
                      value={hypothesis}
                      maxLength={200}
                      disabled={busy}
                      onChange={(e) => setHypothesis(e.target.value)}
                    />
                  </label>
                  <div className="exp-field">
                    <span className="exp-field-label" id="exp-outcome-label">
                      {t("lab.experimentBench.outcomeLabel")}
                    </span>
                    <Picker
                      className="exp-select"
                      labelledBy="exp-outcome-label"
                      value={outcome}
                      disabled={busy}
                      onChange={(v) => setOutcome(v as TrialOutcome)}
                      options={OUTCOME_OPTIONS.map((o) =>
                        o === "smoothest"
                          ? {
                              value: o,
                              label: t("lab.experimentBench.outcome.smoothest"),
                              ...(smoothestOpen ? {} : { disabled: true }),
                            }
                          : { value: o, label: t(`lab.experimentBench.outcome.${OUTCOME_KEY[o]}`) },
                      )}
                    />
                  </div>
                  <p className="exp-fineprint" data-testid="exp-outcome-why">
                    {t(`lab.experimentBench.outcomeWhy.${OUTCOME_KEY[outcome]}`)}
                  </p>
                  {smoothAnswer && !smoothestOpen && (
                    <p className="exp-fineprint" data-testid="exp-outcome-smoothest">
                      {smoothAnswer.r?.held
                        ? t(`lab.experimentBench.smoothestHeld.${SMOOTHEST_HELD_KEY[smoothAnswer.r.held]}`, {
                            sessions: smoothAnswer.r.min_sessions,
                          })
                        : t("lab.experimentBench.smoothestHeld.unknown")}
                    </p>
                  )}
                  {costAck && sim && (
                    <p className="exp-note" data-testid="exp-cost-ack">
                      {costAckLine(sim.rec_title, simCandidate?.cost, t)}
                    </p>
                  )}
                  <button
                    className="exp-cta"
                    disabled={!canStart}
                    onClick={() => startExperiment(costAck)}
                  >
                    {busy
                      ? t("lab.experimentBench.applying")
                      : costAck
                        ? t("lab.experimentBench.costAck.button")
                        : t("lab.experimentBench.startExperiment")}
                  </button>
                  <p className="exp-fineprint">
                    {t("lab.experimentBench.fineprint", {
                      game: prettyGameName(baseline.process_name) || t("lab.experimentBench.fineprintGameFallback"),
                    })}
                  </p>
                  </>
                  )}
                </>
              ) : (
                <p className="exp-note">
                  {t("lab.experimentBench.noBaselineYet")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {summary && <TestSummary s={summary} />}
      {choices.length > 0 && <OutcomeChoices choices={choices} busy={busy} locked={switchLocked} onUse={pickOutcome} />}

      {history.length > 0 && (
        <div className="exp-history">
          <SectionLabel>{t("lab.experimentBench.pastExperiments")}</SectionLabel>
          {sharedNoise && <p className="exp-fineprint exp-bench-noise-shared">{withTerms(sharedNoise)}</p>}
          <ul className="exp-bench-list">
            {history.map((x, i) => (
              <li key={x.id} className="exp-bench-row" data-status={x.status}>
                <span className="exp-bench-rec">{x.rec_title}</span>
                <span className="exp-bench-verdict">
                  {x.verdict && !judgedOnNoBaseline(x) ? (isRealPlay(x) ? realPlayFace(x, t) : (verdictCopy(t)[x.verdict] ?? x.verdict)) : "—"}
                  {rowMark[i] && <span className="exp-bench-noise-mark">{rowMark[i]}</span>}
                </span>
                {x.treatment && (
                  <span className="exp-bench-delta" data-testid="exp-bench-delta">
                    {trialDeltaLow(x) == null ? (
                      "—"
                    ) : (
                      <>
                        {trialDeltaLow(x)! >= 0 ? "+" : ""}
                        {trialDeltaLow(x)}
                        {t("lab.experimentBench.deltaSuffix")}
                      </>
                    )}
                  </span>
                )}
                {x.stop_reason && x.status === "aborted" && (
                  <span className="exp-bench-abort">{abortReasonText(x.stop_reason)}</span>
                )}
                {baselineReceipt(x, t) && (
                  <span className="exp-bench-abort" data-testid="exp-baseline-receipt">
                    {baselineReceipt(x, t)}
                  </span>
                )}
                {afterReceipt(x, t) && (
                  <span className="exp-bench-abort" data-testid="exp-after-receipt">
                    {afterReceipt(x, t)}
                  </span>
                )}
                {tooFewLeftOutReceipt(x, t) && (
                  <span className="exp-bench-abort" data-testid="exp-too-few-left-out">
                    {tooFewLeftOutReceipt(x, t)}
                  </span>
                )}
                {comparedReceipt(x, t) && (
                  <span className="exp-bench-abort" data-testid="exp-compared-receipt">
                    {comparedReceipt(x, t)}
                  </span>
                )}
                {pairingReceipt(x, t) && (
                  <span className="exp-bench-abort" data-testid="exp-pairing-receipt">
                    {pairingReceipt(x, t)}
                  </span>
                )}
                {stretchReceipts(x, t).map((line, k) => (
                  <span key={k} className="exp-bench-abort" data-testid="exp-stretch-receipt">
                    {line}
                  </span>
                ))}
                {x.verdict === "too-noisy" && (
                  <span className="exp-bench-abort" data-testid="exp-too-noisy-why">
                    {isRealPlay(x) ? t("lab.experimentBench.journey.realPlay.tooNoisyWhy") : t("lab.experimentBench.tooNoisyWhy")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {footnotes.map((n, k) => (
            <p key={k} className="exp-fineprint exp-bench-noise">
              <span className="exp-bench-noise-mark">{noteMark(k)}</span> <span>{withTerms(footnoteText(n))}</span>
            </p>
          ))}
        </div>
      )}
      </div>
    </BentoTile>
  );
}

const STILL_APPLIED_KEY: Record<StillApplied, string> = {
  on: "lab.experimentBench.summary.stillOn",
  trial: "lab.experimentBench.summary.stillTrial",
  "cant-confirm": "lab.experimentBench.summary.stillCantConfirm",
  off: "lab.experimentBench.summary.stillOff",
  "set-not-by-compy": "lab.experimentBench.summary.stillSetNotByCompy",
  "gaming-mode": "lab.experimentBench.summary.stillGamingMode",
  unknown: "lab.experimentBench.summary.stillUnknown",
};

// P5-learned: the reason a put-back row says (the journey's own words). The lesson's copy key is the
// shared `LESSON_KEY` (test-summary.ts) since P7-teach taught the Debrief and Care from the same rules.
const PUT_BACK_WHY: Record<string, string> = {
  "no-change": "noChange",
  regressed: "regressed",
  confounded: "confounded",
  expired: "expired",
  "insufficient-evidence": "insufficientEvidence",
  "not-comparable": "notComparable",
  "too-noisy": "tooNoisy",
};

function putBackReason(verdict: string, t: Translate): string {
  // An improved Trial is put back only when the user chose to.
  if (verdict === "improved") return t("lab.experimentBench.summary.putBackByYou");
  return t(`lab.experimentBench.journey.putBackWhy.${PUT_BACK_WHY[verdict] ?? "other"}`);
}

// One lesson, its verdict's confidence band beside it, and the numbers and rule behind a toggle.
function LessonBlock({ lesson, game }: { lesson: Lesson; game: string }) {
  const { t } = useTranslation();
  const key = LESSON_KEY[lesson.rule];
  const one = (v: number) => String(Math.round(v * 10) / 10);
  const signed = (v: number) => `${v > 0 ? "+" : ""}${one(v)}`;
  const rule = t(`lab.experimentBench.summary.rule.${key}`);
  const detail =
    lesson.rule === "too-noisy" || lesson.low1Pct == null || lesson.bandPct == null
      ? t("lab.experimentBench.summary.lessonDetailNoisy", { change: lesson.title, rule })
      : t("lab.experimentBench.summary.lessonDetail", {
          change: lesson.title,
          low: signed(lesson.low1Pct),
          avg: lesson.avgPct == null ? t("lab.experimentBench.summary.lessonAvgNotCompared") : `${signed(lesson.avgPct)}%`,
          band: one(lesson.bandPct),
          rule,
        });
  return (
    <>
      <p className="exp-order-label">{t("lab.experimentBench.summary.lessonLabel")}</p>
      <p className="exp-note" data-testid="exp-summary-lesson" data-rule={lesson.rule}>
        {withTerms(t(`lab.experimentBench.summary.lesson.${key}`, { change: lesson.title, game }))}
        {t("lab.experimentBench.summary.contextSeparator")}
        <BenchWord c={lesson.confidence ?? "unknown"} kind="measured" />
      </p>
      <details className="exp-why" data-testid="exp-summary-lesson-detail">
        <summary className="exp-why-toggle">{t("lab.experimentBench.summary.lessonDetailToggle")}</summary>
        <p className="exp-fineprint">{detail}</p>
        <p className="exp-fineprint">{t("lab.experimentBench.summary.lessonRulesNote")}</p>
      </details>
    </>
  );
}

// P4-exit (ROADMAP Phase 4 exit): "We tested what mattered on this PC" for one game. Read-only: every
// line comes from test-summary.ts over records Compy already keeps. Confidence is the verdict's own
// band (unknown/low/medium/high); the only percentages are noise bands Compy measured or its stated
// minimum.
function TestSummary({ s }: { s: GameTestSummary }) {
  const { t } = useTranslation();
  const game = prettyGameName(s.game) || s.game;
  const verdicts = verdictCopy(t);
  const sep = t("lab.experimentBench.summary.contextSeparator");
  const list = t("lab.experimentBench.pairListSeparator");
  const noiseLines = [
    ...new Set(
      s.tested
        .filter((r) => r.noise)
        .map((r) => (r.realPlay ? realPlayNoiseLine(r.noise!.band_pct, r.realPlay, game, t) : noiseLine(r.noise!, s.game, t)))
        .filter((n): n is string => n != null),
    ),
  ];
  // 2026-10-29 owner-rig Trial (PBZ, too-noisy): a result that never reached the band has no noise record
  // by design (`noise_evidence_for`), and "no record was kept" read as a lost record. Say which it is.
  const unjudged = s.tested.filter((r) => !r.noise && r.measured).length;
  const nothingJudged = s.tested.filter((r) => !r.noise && !r.measured).length;
  const names = (rows: { title: string }[]) => rows.map((r) => r.title).join(list);
  const ctx = s.context;
  const ctxParts = ctx
    ? [
        game,
        ctx.gpu,
        ctx.driver && t("lab.experimentBench.summary.contextDriver", { driver: ctx.driver }),
        ctx.windowsBuild && t("lab.experimentBench.summary.contextWindows", { build: ctx.windowsBuild }),
        displayModeLabel(ctx.display, t),
      ].filter((p): p is string => !!p)
    : [];
  // Each line is ONE string: the bench's own rows above and below say the same titles and noise
  // sentences, and a summary line is a summary, not a second copy of those rows.
  // Review 2026-10-28: every part of the line is separated alike ("· Measured · Not applied now.").
  // Self-review r2: the confidence word is the shared vocabulary, so it carries the shared gloss.
  const testedLine = (r: TestedChange) => {
    return (
      <>
        {t("lab.experimentBench.summary.row", {
          title: r.title,
          text: r.realPlay ? realPlayFace({ verdict: r.verdict, kept: r.kept }, t) : (verdicts[r.verdict] ?? r.verdict),
        })}
        {sep}
        {r.realPlay ? (
          <BenchWord c={r.confidence ?? "unknown"} kind="real-play" />
        ) : (
          <BenchWord c={r.confidence ?? "unknown"} kind="measured" />
        )}
        {sep}
        {[
          ...(r.trials > 1 ? [t("lab.experimentBench.summary.trials", { count: r.trials })] : []),
          t(STILL_APPLIED_KEY[r.stillApplied]),
          ...(r.sameContext === false ? [t("lab.experimentBench.summary.contextChanged")] : []),
        ].join(sep)}
      </>
    );
  };
  const skippedLine = (r: GameTestSummary["skipped"][number]) => {
    const why =
      r.reason && r.reason in SKIP_REASON_KEY
        ? t(SKIP_REASON_KEY[r.reason as SkipReason], {
            effect: r.too_small?.effect_pct.toFixed(1),
            band: r.too_small?.band_pct.toFixed(1),
          })
        : "";
    const text = [why, r.detail ?? ""].filter((x) => x !== "").join(" ");
    return t("lab.experimentBench.summary.row", { title: r.title, text });
  };
  const staleAsked = s.staleAsked;
  // P9-settings-done: the last cached scan's limiters, read with no IPC; no scan = "not measured".
  const scanPriorities = peekScanPriorities();
  const settingsDone = settingsDoneLine(s.headline, scanPriorities, s.game);
  // P9-software-first: while changes are still untested (or worth another run), a part the last
  // check named as the limiter is said AFTER the settings to try first; never a shopping line.
  const softwareFirst = softwareFirstLine(s, scanPriorities);
  return (
    <div className="exp-order exp-summary" data-testid="exp-summary" data-headline={s.headline}>
      <SectionLabel>{t("lab.experimentBench.summary.label", { game })}</SectionLabel>
      {/* P7-depth-verdicts (Constitution §13): the summary is ONE conclusion at three depths. ANSWER = the
          headline, what happened and what is left; RECEIPT = the noise band each verdict was judged
          against, the last recorded context, and each change's measured deltas. No explanation door:
          the headline already says why. */}
      <Depth
        testId="exp-summary-depth"
        answer={
          <>
      <p className="exp-note" data-testid="exp-summary-headline">
        {s.headline === "finished-supported-tests"
          ? t("lab.experimentBench.summary.finishedSupportedTests", { game })
          : s.headline === "finished-within-chosen-risk"
            ? t("lab.experimentBench.summary.finishedWithinChosenRisk", { game, count: s.outsideRisk.length })
          : s.headline === "still-worth-testing"
            ? t("lab.experimentBench.summary.stillWorth", { count: s.leftToTest.length, game })
            : s.headline === "worth-retesting"
              ? // Round 4 review: the headline counts and explains only the rows another run is actually
                // asked for — those offered (`retest`) and the stale ones (put back, then test) — never
                // an unverified row the cap has already stopped offering (review of this fix, MUST-FIX).
                // P8-posture-b: a stale result held back by the risk choice is not asked for again.
                t("lab.experimentBench.summary.worthRetesting", {
                  count: new Set([...s.retest, ...staleAsked].map((r) => r.recId)).size,
                  game,
                  why: retestReasonsLine([...s.retest, ...staleAsked], t, list),
                })
              : s.headline === "nothing-testable-now"
                ? // Round 3 §2: the stopping point is worded from what EVERY change holds, never from one.
                  // P8-posture-note: a change held back by the chosen risk is named here too, so
                  // "nothing left to test" never hides that the user's risk choice is what stopped it.
                  `${
                    s.stop.measured > 0
                      ? `${t("lab.experimentBench.summary.stoppedHere", { game })} ${t("lab.experimentBench.summary.stopMeasured", { count: s.stop.measured })} ${t("lab.experimentBench.summary.stopUnjudged", { count: s.stop.noResult })}`
                      : s.staleHeld.length > 0
                        ? // P8-posture-stale-copy: a held change has an older (stale) result, so
                          // "nothing was measured" would be untrue; say what is there instead.
                          `${t("lab.experimentBench.summary.stoppedStaleHeld", { game, count: s.staleHeld.length })}${
                            // Harness review 2026-11-02: a bare "1 couldn't be judged." here has no subject and reads as
                            // the stale change; the unjudged ones are other changes, so they are named so.
                            s.stop.noResult > 0 ? ` ${t("lab.experimentBench.summary.stopUnjudgedOther", { count: s.stop.noResult })}` : ""
                          }`
                        : t("lab.experimentBench.summary.nothingTestableNow", { game })
                  }${s.outsideRisk.length > 0 ? ` ${t("lab.experimentBench.summary.heldByRisk", { count: s.outsideRisk.length })}` : ""}`
                : s.headline === "results-unverified"
                  ? t("lab.experimentBench.summary.resultsUnverified", { count: s.unverified.length, game })
                  : t("lab.experimentBench.summary.unknownLeft")}
      </p>
      {settingsDone && (
        <p className="exp-note" data-testid="exp-summary-settings-done" data-kind={settingsDone.kind}>
          {settingsDone.kind === "setting-limiter"
            ? t("lab.experimentBench.summary.settingsDone.settingLimiter", { title: settingsDone.title })
            : settingsDone.kind === "part-limiter"
              ? t("lab.experimentBench.summary.settingsDone.partLimiter", { title: settingsDone.title })
              : settingsDone.kind === "gpu-limiter"
                ? settingsDone.screenCap
                  ? t("lab.experimentBench.summary.settingsDone.gpuLimiterScreen", {
                      game,
                      share: settingsDone.sharePct,
                      threshold: settingsDone.thresholdPct,
                      hz: settingsDone.screenCap.hz,
                      fps: settingsDone.screenCap.fps,
                    })
                  : t("lab.experimentBench.summary.settingsDone.gpuLimiter", {
                      game,
                      share: settingsDone.sharePct,
                      threshold: settingsDone.thresholdPct,
                    })
                : settingsDone.kind === "nothing-limiting"
                  ? settingsDone.gpuClear
                    ? t("lab.experimentBench.summary.settingsDone.nothingLimitingMeasured", {
                        game,
                        busy: settingsDone.gpuClear.busy,
                        readings: settingsDone.gpuClear.readings,
                        threshold: settingsDone.gpuClear.thresholdPct,
                      })
                    : t("lab.experimentBench.summary.settingsDone.nothingLimiting")
                  : t("lab.experimentBench.summary.settingsDone.notMeasured")}
        </p>
      )}
      {softwareFirst && (
        <p className="exp-note" data-testid="exp-summary-software-first">
          {t("lab.experimentBench.summary.softwareFirst", {
            part: softwareFirst.part,
            list: softwareFirst.candidates.join(list),
            count: softwareFirst.candidates.length,
          })}
        </p>
      )}
      {(s.kept.length > 0 || s.putBack.length > 0) && (
        <>
          <p className="exp-order-label">{t("lab.experimentBench.summary.happenedLabel")}</p>
          <ul className="exp-why-list" data-testid="exp-summary-happened">
            {s.kept.map((r) => (
              <li key={r.recId} data-rec={r.recId} data-outcome="kept">
                {t(r.verdict === "improved" ? "lab.experimentBench.summary.keptBetter" : "lab.experimentBench.summary.keptPlain", {
                  change: r.title,
                })}
              </li>
            ))}
            {s.putBack.map((r) => (
              <li key={r.recId} data-rec={r.recId} data-outcome="put-back">
                {t("lab.experimentBench.summary.putBack", { change: r.title, reason: putBackReason(r.verdict, t) })}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.lesson && <LessonBlock lesson={s.lesson} game={game} />}
      <p className="exp-order-label">{t("lab.experimentBench.summary.testedLabel")}</p>
      <ul className="exp-why-list" data-testid="exp-summary-tested">
        {s.tested.map((r) => (
          <li key={r.recId} data-rec={r.recId} data-still={r.stillApplied}>
            {testedLine(r)}
          </li>
        ))}
      </ul>
      <p className="exp-note" data-testid="exp-summary-stays">
        {s.staysApplied.length > 0
          ? `${t("lab.experimentBench.summary.staysLabel")} ${names(s.staysApplied)}`
          : t("lab.experimentBench.summary.staysNone")}
      </p>
      {s.cantConfirm.length > 0 && (
        <p className="exp-note">{`${t("lab.experimentBench.summary.cantConfirmList")} ${names(s.cantConfirm)}`}</p>
      )}
      {s.leftToTest.length > 0 && (
        <p className="exp-note" data-testid="exp-summary-left">
          {`${t("lab.experimentBench.summary.leftLabel")} ${names(s.leftToTest)}`}
        </p>
      )}
      {s.retest.length > 0 && (
        <p className="exp-note" data-testid="exp-summary-retest">
          {`${t("lab.experimentBench.summary.retestLabel")} ${s.retest
            .map((r) =>
              t("lab.experimentBench.summary.retestRow", {
                title: r.title,
                why: t(`lab.experimentBench.summary.retestWhy.${retestWhyKey(r)}`),
              }),
            )
            .join(list)}`}
        </p>
      )}
      {s.staleKept.length > 0 && (
        <p className="exp-note" data-testid="exp-summary-stale-kept">
          {`${t("lab.experimentBench.summary.staleKeptLabel", { count: s.staleKept.length })} ${names(s.staleKept)}`}
        </p>
      )}
      {s.unjudged.length > 0 && (
        <p className="exp-note" data-testid="exp-summary-unjudged">
          {`${t("lab.experimentBench.summary.unjudgedLabel", { count: s.unjudged.length })} ${names(s.unjudged)}`}
        </p>
      )}
      {s.skipped.length > 0 && (
        <details className="exp-why" data-testid="exp-summary-skipped">
          <summary className="exp-why-toggle">
            {t("lab.experimentBench.summary.skippedLabel", { count: s.skipped.length })}
          </summary>
          <ul className="exp-why-list">
            {s.skipped.map((r) => (
              <li key={r.id} data-rec={r.id}>
                {skippedLine(r)}
              </li>
            ))}
          </ul>
        </details>
      )}
          </>
        }
        receipt={
          <>
      <p className="exp-fineprint" data-testid="exp-summary-noise">
        {withTerms(
          [
            t("lab.experimentBench.summary.noiseLabel"),
            ...noiseLines,
            ...(unjudged > 0 ? [t("lab.experimentBench.noiseNotRecorded", { count: unjudged })] : []),
            ...(nothingJudged > 0 ? [t("lab.experimentBench.noiseNothingJudged", { count: nothingJudged })] : []),
          ].join(" "),
        )}
      </p>
      <p className="exp-fineprint" data-testid="exp-summary-context" data-context-at={s.contextAt ?? undefined}>
        {/* Round 4 review: this is the LAST RECORDED context, dated; whether a result is current is
            each row's `context` against the newest session, never this line. */}
        {`${
          ctxParts.length > 0 && s.contextAt
            ? t("lab.experimentBench.summary.contextLabel", { when: new Date(s.contextAt).toLocaleDateString() })
            : t("lab.experimentBench.summary.contextLabelUndated")
        } ${ctxParts.length > 0 ? ctxParts.join(sep) : t("lab.experimentBench.summary.contextUnknown", { game })}`}
      </p>
      <dl className="exp-summary-receipt" data-testid="exp-summary-receipt">
        {s.tested.map((r) => (
          <ReceiptRow
            key={r.recId}
            label={r.recId}
            value={[
              r.verdict,
              receiptPct(r.deltaLow1Pct) != null ? t("lab.experimentBench.summary.receiptLow", { pct: receiptPct(r.deltaLow1Pct) }) : null,
              receiptPct(r.deltaAvgPct) != null ? t("lab.experimentBench.summary.receiptAvg", { pct: receiptPct(r.deltaAvgPct) }) : null,
              receiptBand(r.noise?.band_pct) != null ? t("lab.experimentBench.summary.receiptBand", { band: receiptBand(r.noise?.band_pct) }) : null,
              t("lab.experimentBench.summary.receiptTrials", { count: r.trials }),
              r.context,
              // P8-posture-show: the risk allowed when this row's Trial started, or "not recorded".
              t("lab.experimentBench.summary.receiptRiskChoice", { choice: riskChoiceWord(r.riskChoice, t) }),
            ]
              .filter((x): x is string => !!x)
              .join(sep)}
          />
        ))}
      </dl>
          </>
        }
      />
      <p className="exp-fineprint">{t("lab.experimentBench.summary.readOnly")}</p>
    </div>
  );
}

// P5-outcomes (ROADMAP Phase 5 step 6, ENGINE §5–6): one change, two results that disagree. The trade
// in one line, then the switch to the side not in effect. One result, or two that agree, shows nothing.
const RESULT_REASON_KEY: Record<OutcomeResult["reason"], string> = {
  "low-up": "lowUp",
  "avg-up": "avgUp",
  "low-fell": "lowFell",
  "avg-fell": "avgFell",
  "low-flat": "lowFlat",
  "avg-flat": "avgFlat",
  "avg-unknown": "avgUnknown",
};
const RESULT_OUTCOME_KEY: Record<ResultOutcome, string> = { recommended: "recommended", "max-fps": "maxFps" };

function OutcomeChoices({
  choices,
  busy,
  locked,
  onUse,
}: {
  choices: OutcomeChoice[];
  busy: boolean;
  /** A Trial or the journey is under way: the trade is shown, the switch is not. */
  locked: boolean;
  onUse: (c: OutcomeChoice, pick: ResultOutcome) => void;
}) {
  const { t } = useTranslation();
  const name = (o: ResultOutcome) => t(`lab.experimentBench.outcome.${RESULT_OUTCOME_KEY[o]}`);
  const one = (v: number) => String(Math.round(v * 10) / 10);
  const why = (r: OutcomeResult) => {
    const flat = r.reason === "low-flat" || r.reason === "avg-flat";
    const pct = r.pct == null ? "" : flat ? `${r.pct > 0 ? "+" : ""}${one(r.pct)}` : one(Math.abs(r.pct));
    return t(`lab.experimentBench.outcomeChoice.reason.${RESULT_REASON_KEY[r.reason]}`, { pct });
  };
  const side = (r: OutcomeResult) =>
    t(r.keeps ? "lab.experimentBench.outcomeChoice.keeps" : "lab.experimentBench.outcomeChoice.keepsOff", {
      outcome: name(r.outcome),
      why: why(r),
    });
  return (
    <div className="exp-order exp-outcome-choice" data-testid="exp-outcome-choice">
      <SectionLabel>{t("lab.experimentBench.outcomeChoice.label")}</SectionLabel>
      {choices.map((c) => {
        const other: ResultOutcome | null = c.inEffect == null ? null : c.inEffect === "recommended" ? "max-fps" : "recommended";
        return (
          <div key={c.recId} data-testid="exp-outcome-choice-row" data-rec={c.recId} data-in-effect={c.inEffect ?? "unknown"}>
            <p className="exp-order-label">{c.title}</p>
            <p className="exp-note" data-testid="exp-outcome-choice-trade">
              {`${side(c.recommended)} ${side(c.maxFps)}`}
            </p>
            {c.inEffect == null || other == null ? (
              <p className="exp-fineprint">{t("lab.experimentBench.outcomeChoice.cantTell")}</p>
            ) : locked ? (
              <p className="exp-fineprint" data-testid="exp-outcome-choice-locked">
                {t("lab.experimentBench.outcomeChoice.busy")}
              </p>
            ) : other === c.keepOutcome && c.keepStale ? (
              // The keep side's Trial ran under a changed context: say so instead of offering it.
              <p className="exp-fineprint" data-testid="exp-outcome-choice-stale" data-context={c.keepContext}>
                {t(c.keepContext === "unverified" ? "lab.experimentBench.outcomeChoice.keepUnverified" : "lab.experimentBench.outcomeChoice.keepStale", {
                  outcome: name(other),
                  change: c.title,
                })}
              </p>
            ) : (
              <>
                <p className="exp-fineprint" data-testid="exp-outcome-choice-current">
                  {t("lab.experimentBench.outcomeChoice.inEffect", { outcome: name(c.inEffect) })}
                </p>
                <button
                  type="button"
                  className="exp-cta-ghost"
                  disabled={busy}
                  data-outcome={other}
                  data-trial={other === c.keepOutcome ? c.keepTrialId : undefined}
                  onClick={() => onUse(c, other)}
                >
                  {t(other === c.keepOutcome ? "lab.experimentBench.outcomeChoice.useKeep" : "lab.experimentBench.outcomeChoice.useOff", {
                    outcome: name(other),
                    change: c.title,
                  })}
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunningPanel({
  exp,
  treatment,
  interrupted = false,
  changeOff = false,
  busy,
  onConclude,
  onRestore,
}: {
  exp: Experiment;
  treatment: SessionSummary | null;
  interrupted?: boolean;
  /** The Trial picker's live answer reads this Trial's change as off (`stillAppliedFrom` "off", the
   *  same read behind the summary's "Not applied now."). A conclude now is recorded confounded
   *  (experiment.rs guard_target_at_conclude), so the panel says so and leads with Restore now. */
  changeOff?: boolean;
  busy: boolean;
  onConclude: (exp: Experiment, treatment: SessionSummary) => void;
  onRestore: (exp: Experiment) => void;
}) {
  const { t } = useTranslation();
  const game = prettyGameName(exp.game) || t("lab.experimentBench.yourGame");
  const legacy = !canConclude(exp);
  const baselineAvg = knownFps(exp.baseline_avg_fps);
  const baselineLow = knownFps(exp.baseline_low1_fps);
  return (
    <div className="exp-running" data-testid="experiment-running" data-change-off={changeOff || undefined}>
      {interrupted && (
        <p className="exp-bench-warn" data-testid="exp-interrupted" role="status">
          {/* Two literal calls, not one call on a ternary: src/affordance-census.test.ts reads each
              surface's copy from its t("…") literals, and a key behind a ternary reads as dropped. */}
          {changeOff
            ? t("lab.experimentBench.journey.interruptedOff", { change: exp.rec_title })
            : t("lab.experimentBench.journey.interrupted", { change: exp.rec_title })}
        </p>
      )}
      <div className="exp-running-head">
        <span className="exp-running-dot" aria-hidden />
        <span className="exp-running-title">{t("lab.experimentBench.runningTitlePrefix")} {exp.rec_title}</span>
      </div>
      <p className="exp-running-baseline">
        {baselineAvg != null && baselineLow != null ? (
          <>
            {t("lab.experimentBench.runningBaselinePre", { game })} <b>{Math.round(baselineAvg)}</b> {t("lab.experimentBench.baselineMid")}{" "}
            <b>{Math.round(baselineLow)}</b> {t("lab.experimentBench.fpsUnit")}
          </>
        ) : (
          // A pre-lane-2b record carries whatever the sampler wrote, unknown included (#671). Each
          // reading says what it is, and the unit rides only with a measured number.
          <>
            {t("lab.experimentBench.runningBaselinePre", { game })}{" "}
            <b>{baselineAvg != null ? Math.round(baselineAvg) : t("lab.experimentBench.notMeasured")}</b>
            {baselineAvg != null && ` ${t("lab.experimentBench.fpsUnit")}`} {t("lab.experimentBench.lowMid")}{" "}
            <b>{baselineLow != null ? Math.round(baselineLow) : t("lab.experimentBench.notMeasured")}</b>
            {baselineLow != null && ` ${t("lab.experimentBench.fpsUnit")}`}
          </>
        )}
      </p>
      {exp.attribution_warning && <p className="exp-bench-warn">{exp.attribution_warning}</p>}
      {baselineReceipt(exp, t) && (
        <p className="exp-bench-warn" data-testid="exp-baseline-receipt">
          {baselineReceipt(exp, t)}
        </p>
      )}
      {/* Desk review 2026-11-02: "The change is applied" stood over a change Windows read as off, with the
          summary below saying "Not applied now." and Conclude leading, which would spend a session on a
          confounded result. */}
      <p className="exp-running-step" data-testid="exp-running-step">
        {legacy
          ? t("lab.experimentBench.runningLegacy")
          : changeOff
            ? t("lab.experimentBench.runningChangeOff", { change: exp.rec_title, game })
            : t("lab.experimentBench.runningStep", { game })}
      </p>

      <div className="exp-running-actions">
        {!legacy && !changeOff && (
          <button
            className="exp-cta"
            disabled={!treatment || busy}
            onClick={() => treatment && onConclude(exp, treatment)}
          >
            {busy
              ? t("lab.experimentBench.working")
              : treatment
                ? t("lab.experimentBench.concludeWithLatest", { game })
                : t("lab.experimentBench.noNewSession", { game })}
          </button>
        )}
        <button
          className={changeOff ? "exp-cta" : "exp-cta-ghost"}
          disabled={busy}
          onClick={() => onRestore(exp)}
        >
          {t("lab.experimentBench.restoreNow")}
        </button>
      </div>
      {legacy || changeOff ? null : treatment ? (
        <p className="exp-fineprint">
          {t("lab.experimentBench.runningLatestPre", { game })} <b>{Math.round(treatment.avg_fps)}</b> {t("lab.experimentBench.baselineMid")}{" "}
          <b>{Math.round(treatment.low1_fps_est)}</b>{" "}
          {t("lab.experimentBench.runningLatestPost", { samples: treatment.samples.toLocaleString() })}
        </p>
      ) : (
        <p className="exp-fineprint">
          {t("lab.experimentBench.runningNoTreatment", { game })}
        </p>
      )}
    </div>
  );
}
