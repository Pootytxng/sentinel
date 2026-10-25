// Intelligence Phase 3 — user-started experiment engine + optimization simulator surface.
// ARMED (experiment_gate() true, owner-signed 2026-07-17). The engine ORCHESTRATES the existing
// audited apply/rollback boundary — it invents no new mutation primitive. Nothing runs without an
// explicit user action: you PICK a change, the simulator gives an honest read (never a promise),
// you START (which applies ONE reversible change against a real captured baseline), you play, and
// you CONCLUDE — Compy judges the real session against the 3% noise floor and auto-restores unless
// the numbers clearly beat it. It measures; it never fabricates a gain.
// Spec: docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { LEDGER_CHANGED_EVENT } from "../types";
import { writeLedger } from "../data/ledger-write";
import { prettyGameName } from "./game-name";
import { knownFps } from "../lib/session-metrics";
import { SectionLabel, VerdictBand, simulationTone } from "./measurement-chrome";
import { BentoTile } from "../design/bento/BentoGrid";
import { Picker } from "../design/Picker";
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
};

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
  | "already-set-unchecked"
  | "no-safe-apply";
type TrialCandidate = {
  id: string;
  title: string;
  passes: boolean;
  reason: SkipReason | null;
  detail: string | null;
};

const SKIP_REASON_KEY: Record<SkipReason, string> = {
  "not-for-this-pc": "lab.experimentBench.skipReason.notForThisPc",
  "already-set": "lab.experimentBench.skipReason.alreadySet",
  "already-set-by-compy": "lab.experimentBench.skipReason.alreadySetByCompy",
  "already-set-by-gaming-mode": "lab.experimentBench.skipReason.alreadySetByGamingMode",
  "already-set-unchecked": "lab.experimentBench.skipReason.alreadySetUnchecked",
  "no-safe-apply": "lab.experimentBench.skipReason.noSafeApply",
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

function confidenceCopy(t: Translate): Record<Confidence, string> {
  return {
    unknown: t("lab.experimentBench.confidence.unknown"),
    low: t("lab.experimentBench.confidence.low"),
    medium: t("lab.experimentBench.confidence.medium"),
    high: t("lab.experimentBench.confidence.high"),
  };
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

// Trial Protocol §2 — the backend's baseline grade (experiment.rs `grade_baseline`), mirrored so the
// bench says why a too-short baseline can't be used instead of offering a start the backend refuses,
// and warns before starting on an uneven or untraced one (owner decision 2026-10-24: warn, don't
// block). The halves floor is the fixed 3% default (experiment.rs `halves_floor_pct`, comparison.rs
// DEFAULT_NOISE_FLOOR_PCT), not the verdict band, which P4-noise measures per game; the halves split
// the 10 s fps buckets by count, and a session without its trace is unknown, never steady.
const MIN_BASELINE_SAMPLES = 600;
const BASELINE_NOISE_FLOOR_PCT = 3;
type BaselineGrade =
  | { kind: "steady" }
  | { kind: "too-short"; samples: number }
  | { kind: "uneven"; first: number; second: number }
  | { kind: "untraced" };

const round1 = (x: number) => Math.round(x * 10) / 10;

function gradeBaseline(s: SessionSummary): BaselineGrade {
  if (s.samples < MIN_BASELINE_SAMPLES) return { kind: "too-short", samples: s.samples };
  const fps = (s.fps_series ?? []).map(([, f]) => f).filter((f) => Number.isFinite(f) && f > 0);
  const half = Math.floor(fps.length / 2);
  if (half < 2) return { kind: "untraced" };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const first = mean(fps.slice(0, half));
  const second = mean(fps.slice(half));
  if ((Math.abs(second - first) / first) * 100 > BASELINE_NOISE_FLOOR_PCT)
    // The same 1-decimal halves the backend stores (experiment.rs `round1`), so the start warning and
    // the receipt round the same numbers and can't read 259 on one screen and 260 on the other.
    return { kind: "uneven", first: round1(first), second: round1(second) };
  return { kind: "steady" };
}

// §2 the record's own baseline grade, said on its receipt (the running panel and its history row):
// a Trial started on an uneven or untraced baseline says so. Steady and older records say nothing.
function baselineReceipt(x: Experiment, t: Translate): string | null {
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

// A past result whose verdict reads like a measured judgment (Better / No change / Worse). Only such
// a row can be mistaken for one judged against the noise floor, so only it needs saying when it wasn't.
function looksJudged(x: Experiment): boolean {
  return x.verdict === "improved" || x.verdict === "no-change" || x.verdict === "regressed";
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
 *  App's `recs`/`changes` (the Optimize station beside the bench) re-read only through it (#621). */
export default function ExperimentBench({ onChanged }: { onChanged?: () => Promise<unknown> | void } = {}) {
  const { t } = useTranslation();
  const [gate, setGate] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [recs, setRecs] = useState<TrialCandidate[]>([]);
  const [showWhy, setShowWhy] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const [pickId, setPickId] = useState<string>("");
  const [sim, setSim] = useState<SimulatorReport | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [hypothesis, setHypothesis] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const reload = useCallback(async () => {
    const [xs, rs, ss] = await Promise.all([
      invoke<Experiment[]>("get_experiments").catch(() => []),
      invoke<TrialCandidate[]>("get_trial_candidates").catch(() => []),
      invoke<SessionSummary[]>("get_session_summaries").catch(() => []),
    ]);
    setExperiments(xs ?? []);
    setRecs(rs ?? []);
    setSessions(ss ?? []);
  }, []);

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

  if (!gate) return null;

  const running = experiments.find((x) => x.status === "running") ?? null;
  const history = experiments.filter((x) => x.status !== "running");

  // The honest baseline: the most recent monitored session with a real frame-rate reading and a known
  // game (the backend refuses anything less). The experiment locks to that game. No sessions → we
  // cannot invent a baseline; the owner plays one monitored session first.
  const baseline =
    [...sessions]
      .filter(isUsableReading)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0] ?? null;

  // §11 notes for the past experiments. Every sentence is said once per list, however many rows it
  // covers — the same sentence down the rows buries the rows it describes (C-11). When every judged
  // row says the same thing, that line is the list's rule, said under the label. A row whose verdict
  // already says it wasn't judged ("—", interfered, not enough evidence) needs no note. "Not
  // comparable" can't say which pair failed (another game, or a crash session Compy can't tie to the
  // change or compare), so that row carries the backend's own reason — never the list's rule. Every
  // other note — a row that LOOKS judged (Better / No change / Worse) but has no record (a crash, an
  // older result), or noise lines that differ between rows — is said once under the list, and its
  // rows carry only its mark.
  const noiseLines = history.map((x) => (x.noise_evidence ? noiseLine(x.noise_evidence, x.game, t) : null));
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
  const pickable = recs.filter((r) => r.passes);
  // A pick kept in the dropdown after a refresh (below) is listed there only, not here as well.
  const skipped = recs.filter((r) => !r.passes && r.id !== pickId);

  // If a refocus-refresh just re-derived the active pick as already-applied (it drops out of `pickable`),
  // keep it in the dropdown so its honest "already configured" verdict stays on screen — the selection
  // must not silently vanish while its simulator card is still showing.
  const options =
    pickId && !pickable.some((r) => r.id === pickId)
      ? [...pickable, ...recs.filter((r) => r.id === pickId)]
      : pickable;

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

  async function startExperiment() {
    if (!sim || !baseline) return;
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
            },
            refresh,
          ),
        () => {
          // The announcement just started a quiet re-simulation of the old pick (the wake listener);
          // claim a newer sim id so its answer is dropped and the cleared card can't come back.
          ++simReq.current;
          setSim(null);
          setPickId("");
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
      await runWrite((refresh) =>
        writeLedger<Experiment>(
          "conclude_experiment",
          {
            experimentId: exp.id,
            // By id only: the backend reads the session itself and refuses one that isn't comparable
            // to the baseline, rather than trusting our same-game filter above.
            treatmentSessionId: treatment.started_at,
            crashed: false,
          },
          refresh,
        ),
      );
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

  const SIM_VERDICT = simVerdictCopy(t);
  const simMeta = sim ? SIM_VERDICT[sim.verdict] ?? { label: sim.verdict, blocked: false } : null;
  const grade = baseline ? gradeBaseline(baseline) : null;
  const canStart = !!sim && !!simMeta && !simMeta.blocked && !!baseline && grade?.kind !== "too-short" && !busy;

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

      {running ? (
        // ── One experiment in flight: single-variable honesty is enforced by hiding the launcher ──
        <RunningPanel
          exp={running}
          treatment={treatmentFor(running, sessions)}
          busy={busy}
          onConclude={concludeExperiment}
          onRestore={restoreExperiment}
        />
      ) : (
        // ── Launcher: pick a change → honest simulator read → start against the real baseline ──
        <div className="exp-launch">
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
                ...options.map((r) => ({ value: r.id, label: r.title })),
              ]}
            />
          </div>
          {options.length === 0 && (
            <p className="exp-note">
              {t("lab.experimentBench.noChangesToTest")}
            </p>
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
                        {r.reason ? t(SKIP_REASON_KEY[r.reason]) : null}
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
                <span className="exp-sim-conf">{confidenceCopy(t)[sim.confidence]}</span>
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
                  <button
                    className="exp-cta"
                    disabled={!canStart}
                    onClick={startExperiment}
                  >
                    {busy ? t("lab.experimentBench.applying") : t("lab.experimentBench.startExperiment")}
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

      {history.length > 0 && (
        <div className="exp-history">
          <SectionLabel>{t("lab.experimentBench.pastExperiments")}</SectionLabel>
          {sharedNoise && <p className="exp-fineprint exp-bench-noise-shared">{sharedNoise}</p>}
          <ul className="exp-bench-list">
            {history.map((x, i) => (
              <li key={x.id} className="exp-bench-row" data-status={x.status}>
                <span className="exp-bench-rec">{x.rec_title}</span>
                <span className="exp-bench-verdict">
                  {x.verdict ? verdictCopy(t)[x.verdict] ?? x.verdict : "—"}
                  {rowMark[i] && <span className="exp-bench-noise-mark">{rowMark[i]}</span>}
                </span>
                {x.treatment && (
                  <span className="exp-bench-delta">
                    {x.treatment.delta_low1_pct >= 0 ? "+" : ""}
                    {x.treatment.delta_low1_pct}
                    {t("lab.experimentBench.deltaSuffix")}
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
                {x.verdict === "too-noisy" && (
                  <span className="exp-bench-abort" data-testid="exp-too-noisy-why">
                    {t("lab.experimentBench.tooNoisyWhy")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {footnotes.map((n, k) => (
            <p key={k} className="exp-fineprint exp-bench-noise">
              <span className="exp-bench-noise-mark">{noteMark(k)}</span> <span>{footnoteText(n)}</span>
            </p>
          ))}
        </div>
      )}
      </div>
    </BentoTile>
  );
}

function RunningPanel({
  exp,
  treatment,
  busy,
  onConclude,
  onRestore,
}: {
  exp: Experiment;
  treatment: SessionSummary | null;
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
    <div className="exp-running" data-testid="experiment-running">
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
      <p className="exp-running-step">
        {legacy ? t("lab.experimentBench.runningLegacy") : t("lab.experimentBench.runningStep", { game })}
      </p>

      <div className="exp-running-actions">
        {!legacy && (
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
          className="exp-cta-ghost"
          disabled={busy}
          onClick={() => onRestore(exp)}
        >
          {t("lab.experimentBench.restoreNow")}
        </button>
      </div>
      {legacy ? null : treatment ? (
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
