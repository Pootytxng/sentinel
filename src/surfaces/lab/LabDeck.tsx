import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { invoke } from "@tauri-apps/api/core";
import { useReducedMotion } from "../../design/use-motion";
import { OptimizeStation, type LabFastPathProps } from "./OptimizeStation";
import ExperimentBench from "../ExperimentBench";
import { BenchmarkTab } from "../Benchmark";
import { LatencyTab } from "../Latency";
import { BlackBox } from "../BlackBox";
import { TuningInstrument } from "../TuningInstrument";
import {
  labStations,
  stationReading,
  type LabStationFacts,
  type LabStationKey,
} from "../lab-guided-data";
import { stationHasReading } from "../lab-bento-data";
import { changesBetweenRuns } from "../benchmark-view";
import { safeFixesReady } from "../optimize-v2-data";
import { deriveReverted } from "../use-scan";
import { useDismissed } from "../dismissed";
import { useEligibilityOverrides, withOverrides } from "../eligibility-override";
import { peekProbe, cachedProbe } from "../../data/probe-cache";
import { readHandoff } from "../../data/check-handoff";
import { recDisplayLabel } from "../../data/friendly-labels";
import { measureTuning, tuningEvidence } from "../../data/tuning-measure";
import { tuningGuideForVendorForLanguage } from "../../data/tuning-guides";
import {
  groupByGoal,
  labComparison,
  labGoals,
  labProblems,
  nextBestMove,
  proofStationFor,
  rigKindForSubsystem,
  subsystemForStation,
  subsystemOf,
  type LabGoal,
  type LabSubsystem,
} from "./lab-deck-data";
import { subsystemReadings } from "./lab-evidence-map";
import { computeJumpInset, scrollportOf, scrollportTop } from "./jump-inset";
import type {
  ArmedComparison,
  BenchmarkState,
  BlackBoxReport,
  ComparisonResult,
  LatencyReport,
  Priorities,
  SessionSummary,
} from "../../types";
import type { GpuVendor } from "../walkthroughs";
import type { HardwareInfo } from "../../App";
import "./LabDeck.css";

// The REAL rig hologram — the same component Home and the Ops Console mount, not a copy and not a
// stock stand-in. Lazy so the ~600KB three.js bundle is not in the deck's chunk (RigViewer lazies
// the scene itself too; this keeps the viewer's own module out as well) and so the jsdom guards
// render the Suspense fallback instead of WebGL.
const RigViewer = lazy(() => import("../rig/RigViewer").then((m) => ({ default: m.RigViewer })));

// LabDeck — the DECISION-JOURNEY Lab candidate (product-recovery train, 2026-07-28; recovery
// items 9/10/11/12/13/14/15). TEMPORARY, behind `compy_lab_deck` (DEFAULT OFF): this is the
// owner-comparison face, NOT a permanent seventh Lab. The intended end state is ONE canonical
// Lab; the pruning map for getting there is Phase 4 of docs/USER_FEEDBACK_PRODUCT_RECOVERY.md.
//
// WHY IT EXISTS. The shipped face (LabConsole) is a dock of six peer stations — the user has to
// learn how Compy is ORGANISED before they can act (recovery item 13: "the six-station mega-room
// does not represent the desired final product direction"; item 10: "the Lab still feels
// overloaded"). This face is ordered by the user's decision journey instead:
//
//   What did Compy find?  →  What should I do first?  →  Why is it relevant to MY PC?
//                         →  Can Compy do it safely?  →  How do I prove it helped?
//
// ONE NAVIGATION GRAMMAR (recovery item 14): every destination in this face is a ROW THAT OPENS
// IN PLACE. No router, no card grid duplicating an accordion, no dock. Exactly one instrument is
// mounted at a time app-wide (`open` is a single slot identifying ONE row — its own id plus the
// section hosting it), so a problem row in section 4 and an instrument row in section 3 can never
// render two live copies of the same tool.
//
// ZERO NEW MUTATION PATH, ZERO NEW IPC (LOCKED rule 3). Every apply/undo goes through the same
// audited surface the production face uses — OptimizeStation → Fix → apply_recommendations_batch
// / rollback-from-history. The probes below are the same three cached reads LabConsole already
// performs. This file is presentation and ordering; it changes nothing about what Compy can do.

type DeckSection = "move" | "optimize" | "prove" | "diagnose" | "advanced";

// The journey, in order. This array IS the navigation, the rail, and the section order — one list
// so they can never disagree about how many steps there are or what comes next.
const NAV: DeckSection[] = ["move", "optimize", "prove", "diagnose", "advanced"];

// A row that opens in place — the ONE interactive grammar of this face. Native <button> head so
// mouse and keyboard get the same door for free (the "needs your call" lesson, recovery item 6),
// aria-expanded/aria-controls so a screen reader hears the state, and the body is only mounted
// while open so a collapsed instrument costs nothing.
function DeckRow(props: {
  id: string;
  name: string;
  sub: string;
  reading?: string;
  measured?: boolean;
  // Status ink for the reading, for the one row whose reading is a VERDICT on a real measurement.
  // Optional and unset everywhere else: an instrument's live value is a number, not a judgement, and
  // colouring it would be decoration.
  tone?: "ready" | "attention";
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="ld-row" data-open={props.expanded ? "on" : "off"}>
      <button
        type="button"
        className="ld-row-head"
        aria-expanded={props.expanded}
        aria-controls={`${props.id}-body`}
        onClick={props.onToggle}
      >
        <span className="ld-row-text">
          <span className="ld-row-name">{props.name}</span>
          <span className="ld-row-sub">{props.sub}</span>
        </span>
        {props.reading != null && (
          <span
            className="ld-row-reading"
            data-measured={props.measured ? "yes" : "no"}
            data-tone={props.tone}
          >
            {props.reading}
          </span>
        )}
        <span className="ld-row-chev" aria-hidden="true" />
      </button>
      {props.expanded && (
        <div className="ld-row-body" id={`${props.id}-body`}>
          {props.children}
        </div>
      )}
    </div>
  );
}

export type LabDeckProps = {
  fast: LabFastPathProps;
  diagnostics?: ReactNode;
  diagnosticsCaptured?: boolean;
  // The MEASURED limiter ranking, when a monitored session produced one. Optional and honestly
  // absent: with no priorities the next-best-move card cites the catalog instead of inventing a
  // reason. (The GPU vendor is read from `fast.vendor` — one source, so a station's availability
  // and the fix rows can never disagree about which rig this is.)
  priorities?: Priorities | null;
  activeCount?: number;
  // The live hardware snapshot, for the Rig Evidence Map. OPTIONAL and honestly absent: with no
  // snapshot there is no map at all, rather than a hologram of a machine we haven't read. (Several
  // guards mount the deck without hardware; they must keep working.)
  hw?: HardwareInfo | null;
};

export function LabDeck({
  fast,
  diagnostics,
  diagnosticsCaptured = false,
  priorities = null,
  activeCount = 0,
  hw = null,
}: LabDeckProps) {
  const vendor: GpuVendor = fast.vendor ?? "any";
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const { dismissed, dismiss } = useDismissed();
  // ...and its mirror: a rec the user vouched for with "My hardware supports this" is back in the
  // deck's work — next-best-move, the goal groups, and the safe-stack reading all owe it a seat
  // (self-review round 11, 2026-07-29).
  const { overridden } = useEligibilityOverrides();

  // ───────────────────────── section anchors + the jump nav ─────────────────────────
  // Jumping moves FOCUS as well as scroll (each section is tabIndex={-1}), so a keyboard or
  // screen-reader user lands where a mouse user lands. scrollIntoView is optional-chained:
  // jsdom doesn't implement it and the journey tests run there.
  const sections = useRef<Partial<Record<DeckSection, HTMLElement | null>>>({});
  const jump = (s: DeckSection) => {
    const el = sections.current[s];
    el?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
    el?.focus?.({ preventScroll: true });
  };

  // …and it must land BELOW the sticky nav, not behind it. The strip the nav covers is the room
  // scroller's top padding plus the nav's own (wrappable) height — a number no stylesheet can know,
  // so the deck measures it and publishes it as --ld-jump-inset for .ld-section's scroll-margin-top.
  // Re-measured on nav resize (the five names wrap to two rows on a narrow stage) and on window
  // resize; see jump-inset.ts for why a constant was wrong (it clipped four of five headings).
  const deckRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const deck = deckRef.current;
    const nav = navRef.current;
    if (!deck || !nav) return;
    const measure = () => {
      const navBottom = nav.getBoundingClientRect?.()?.bottom ?? 0;
      const inset = computeJumpInset(navBottom, scrollportTop(scrollportOf(deck)));
      if (inset !== null) deck.style.setProperty("--ld-jump-inset", `${inset}px`);
    };
    measure();
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            measure();
          })
        : null;
    ro?.observe(nav);
    window.addEventListener?.("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener?.("resize", measure);
    };
  }, []);

  // WHERE AM I — the deck answers that with the layout itself, not a paragraph (recovery item 9:
  // "orientation should be inherent in layout and controls"). An observer lights the nav pill and
  // the journey rail for whichever section owns the viewport, so the five-step path is always
  // visible AND you can always see your place on it. Falls back to "move" where IntersectionObserver
  // is missing (jsdom): a wrong-but-stable highlight beats a crash, and nothing depends on it.
  const [here, setHere] = useState<DeckSection>("move");
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const seen = new Map<DeckSection, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.section as DeckSection | undefined;
          if (key) seen.set(key, e.intersectionRatio);
        }
        let best: DeckSection | null = null;
        let bestRatio = 0;
        for (const k of NAV) {
          const r = seen.get(k) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = k;
          }
        }
        if (best) setHere(best);
      },
      { threshold: [0, 0.15, 0.4, 0.75, 1] },
    );
    for (const el of Object.values(sections.current)) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  // ───────────────────────── the check → optimize handoff ─────────────────────────
  // One-shot: readHandoff consumes it, so a later Lab visit is an ordinary visit. Intent only —
  // arriving never applies anything. This face MUST own the read: LabConsole isn't mounted
  // behind the deck flag, so if the deck didn't consume the handoff the carried ids would be
  // lost and the check's findings would arrive anonymous (recovery items 3/4).
  const [carriedRecIds, setCarriedRecIds] = useState<string[]>([]);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const handoff = readHandoff();
    if (handoff?.station === "optimize") {
      setCarriedRecIds(handoff.rec_ids);
      setArrived(true);
    }
  }, []);
  useEffect(() => {
    if (!arrived) return;
    // Land ON Optimize, not at the top of the Lab (recovery item 1: "lands somewhere that feels
    // directionless"). The carried rows are already highlighted by OptimizeStation.
    jump("optimize");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one arrival, one scroll
  }, [arrived]);

  // ───────────────────────── section 1: your next best move ─────────────────────────
  const reverted = useMemo(() => deriveReverted(fast.changes ?? []), [fast.changes]);
  const revertedIds = useMemo(() => new Set(reverted.map((r) => r.rec_id)), [reverted]);
  const move = useMemo(
    () =>
      nextBestMove({
        recs: fast.recs && withOverrides(fast.recs, overridden),
        isAppliable: fast.isAppliable,
        revertedIds,
        dismissedIds: dismissed,
        carriedRecIds,
        priorities,
        activeCount,
      }),
    [
      fast.recs,
      fast.isAppliable,
      revertedIds,
      dismissed,
      overridden,
      carriedRecIds,
      priorities,
      activeCount,
    ],
  );

  // ───────────────────────── section 2: optimize, by goal ─────────────────────────
  const goalInfo = useMemo(() => labGoals(t), [t]);
  // `eligible !== false` AFTER the user's overrides, or a rec the user vouched for with "My
  // hardware supports this" would be missing from every goal group on the deck while Fix showed
  // it as ready one panel over (self-review round 11, 2026-07-29).
  const liveRecs = useMemo(
    () => withOverrides(fast.recs ?? [], overridden).filter((r) => r.eligible !== false),
    [fast.recs, overridden],
  );
  // A goal group exists ONLY when this rig really has recommendations in it (recovery §Section 2:
  // "only show a group when real supported recommendations exist") — never an empty shelf.
  const goalGroups = useMemo(() => groupByGoal(liveRecs), [liveRecs]);
  const [goalFilter, setGoalFilter] = useState<LabGoal | null>(null);
  // If the selected group empties (its last rec got applied), fall back to All rather than leave
  // the user staring at a list filtered to nothing.
  const activeGoal =
    goalFilter != null && goalGroups.some((g) => g.goal === goalFilter) ? goalFilter : null;

  // ───────────────────────── instruments: availability + readings ─────────────────────────
  const tuningGuide = tuningGuideForVendorForLanguage(vendor, i18n.language);
  const hasDiagnostics = !!diagnostics;
  const available = useMemo(() => {
    const s = new Set<LabStationKey>(["benchmark", "latency", "blackbox"]);
    if (tuningGuide) s.add("tuning");
    if (hasDiagnostics) s.add("diagnostics");
    return s;
  }, [tuningGuide, hasDiagnostics]);

  // The same three cached probes LabConsole runs — same keys, same TTLs, so switching faces
  // doesn't re-query anything. No new IPC command exists in this file.
  const [bench, setBench] = useState<BenchmarkState | null>(
    () => peekProbe<BenchmarkState>("benchmark-state") ?? null,
  );
  const [latency, setLatency] = useState<LatencyReport | null>(
    () => peekProbe<LatencyReport>("latency-diag") ?? null,
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [armed, setArmed] = useState<ArmedComparison | null>(null);
  const [latestCmp, setLatestCmp] = useState<ComparisonResult | null>(null);
  const [bbReport, setBbReport] = useState<BlackBoxReport | null>(null);
  useEffect(() => {
    cachedProbe<BenchmarkState>(
      "benchmark-state",
      () => invoke<BenchmarkState>("get_benchmark_state"),
      30_000,
    )
      .then(setBench)
      .catch(() => {});
    cachedProbe<LatencyReport>(
      "latency-diag",
      () => invoke<LatencyReport>("get_latency_diagnostics"),
      60_000,
    )
      .then(setLatency)
      .catch(() => {});
    // NOT gated on the tuning guide any more. LabConsole reads these three only when the rig has an
    // AMD/NVIDIA tuning walkthrough, because there they feed the Tuning instrument alone. Here they
    // also feed the before/after receipt in "Measure & prove" — which is about an APPLIED FIX, not
    // about vendor tuning — so gating it on the vendor would have hidden a measured result from every
    // rig without a guide. Same three existing commands, same read-only reads; no new IPC.
    invoke<SessionSummary[]>("get_session_summaries")
      .then(setSessions)
      .catch(() => {});
    invoke<ArmedComparison | null>("get_armed_comparison")
      .then(setArmed)
      .catch(() => {});
    invoke<ComparisonResult | null>("get_latest_comparison")
      .then(setLatestCmp)
      .catch(() => {});
  }, []);

  const measurement = measureTuning(armed, sessions, latestCmp);
  const tuningEvidenceVerdict = tuningEvidence(sessions);
  // The before/after receipt for an APPLIED FIX. `measurement` above is the vendor-tuning half of the
  // same three reads; this is the fix half, and the data module keeps the two apart so neither can
  // borrow the other's numbers.
  const compare = labComparison(latestCmp, armed, sessions);
  const safeReady =
    fast.recs != null
      ? safeFixesReady(
          withOverrides(fast.recs, overridden),
          fast.isAppliable,
          dismissed,
          revertedIds,
        )
      : 0;
  // The honesty rail for every row's reading line: an instrument with no measurement says so.
  const facts: LabStationFacts = {
    bench,
    latency,
    tuningHeadline: measurement?.headline ?? null,
    crash: bbReport,
    diagnosticsCaptured,
    safeReady,
    stackApplied: (fast.recs?.length ?? 0) > 0 && safeReady === 0,
    stackedCount: changesBetweenRuns(bench, fast.changes ?? []).length,
  };
  const stations = labStations(t);

  // The slot identifies a ROW, not a station. Two problem rows can honestly route to the same
  // instrument — "The game hitches or stutters" and "My FPS jumps around" both open Benchmark —
  // so keying the slot on (station, section) made ONE click expand BOTH rows and mount the
  // benchmark twice, the exact opposite of the one-instrument invariant above (self-review round
  // 6). For instrument rows the row id IS the station key; problem rows use their own symptom key.
  const [open, setOpen] = useState<{ row: string; host: DeckSection } | null>(null);
  const toggle = (row: string, host: DeckSection) =>
    setOpen((cur) => (cur && cur.row === row && cur.host === host ? null : { row, host }));
  const isOpen = (row: string, host: DeckSection) =>
    open != null && open.row === row && open.host === host;
  // Section 5 is a native <details>. A jump from section 1 can legitimately target an instrument
  // that lives inside it, and landing on a collapsed summary is a dead end — so the disclosure is
  // controlled, not free-running: `openAt` opens it when it routes there, and `onToggle` keeps this
  // honest when the user opens or closes it by hand (self-review round 7).
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const instrumentBody = (key: LabStationKey): ReactNode => {
    switch (key) {
      case "optimize":
        return null; // section 2 IS optimize — it is never an instrument row
      case "diagnostics":
        return diagnostics ?? null;
      case "benchmark":
        return <BenchmarkTab provingGround />;
      case "latency":
        return <LatencyTab />;
      case "tuning":
        return tuningGuide ? (
          <TuningInstrument
            guide={tuningGuide}
            vendor={vendor}
            measurement={measurement}
            recentSessions={sessions.slice(0, 5)}
            evidence={tuningEvidenceVerdict}
          />
        ) : null;
      case "blackbox":
        return <BlackBox onReport={setBbReport} />;
    }
  };

  const instrumentRow = (key: LabStationKey, host: DeckSection) => (
    <DeckRow
      key={`${host}-${key}`}
      id={`ld-${host}-${key}`}
      name={stations[key].name}
      sub={stations[key].forLine}
      reading={stationReading(key, facts, t)}
      measured={stationHasReading(key, facts)}
      expanded={isOpen(key, host)}
      onToggle={() => toggle(key, host)}
    >
      {instrumentBody(key)}
    </DeckRow>
  );

  const proveKeys: LabStationKey[] = (["benchmark", "latency", "tuning"] as LabStationKey[]).filter(
    (k) => available.has(k),
  );
  const advancedKeys: LabStationKey[] = (["blackbox", "diagnostics"] as LabStationKey[]).filter(
    (k) => available.has(k),
  );
  const problems = labProblems(available, t);

  // An instrument lives in exactly one section, and only these two arrays know which. `openAt` used
  // to be told the host by its caller, and section 1's "how you'd prove it" always said "prove" —
  // so a stability goal (whose proof is the Black Box, hosted under Advanced) jumped to the right
  // section and expanded nothing at all. Resolving the host from the arrays themselves makes that
  // class of dead end unrepresentable: callers name the instrument, the deck finds it.
  const hostForStation = (key: LabStationKey): DeckSection | null =>
    proveKeys.includes(key) ? "prove" : advancedKeys.includes(key) ? "advanced" : null;

  // Open an instrument from somewhere else in the page and take the user to it — an explicit,
  // labelled move, never a silent teleport.
  const openAt = (key: LabStationKey) => {
    const host = hostForStation(key);
    if (!host) return;
    if (host === "advanced") setAdvancedOpen(true);
    setOpen({ row: key, host });
    jump(host);
  };

  // ──────────────────── the before/after receipt (section 3, first row) ────────────────────
  // "Measure & prove" listed five instruments and not one RESULT: the deck could send you off to take
  // a reading, but never showed the reading it already had. Compy's strongest piece of evidence — a
  // baseline measured before a change and the same game measured after it — only ever appeared on the
  // Monitor surface's session debrief, so a user who came to the Lab to answer "did that help?" left
  // with a tool list. This row leads the section because the finished evidence outranks the tools that
  // produce it.
  //
  // WHAT IT MAY AND MAY NOT SAY. Every branch is a state from `labComparison`, and the states carry
  // the honesty rules so no render has to remember them: only a fair verdict is allowed numbers,
  // confounded/expired say why they are holding them back, an armed baseline is the before half and
  // says what is still owed, and the two empty states name the real next action. Nothing here grades,
  // recomputes or estimates — the percentages are the backend's own, and an expected impact is never
  // dressed up as a measured one. The GLANCE layer gets the verdict alone; the values, the method and
  // the noise floor live behind the row's own door.
  const compareRow = (() => {
    const c = compare;
    const fps = (v: number) => String(Math.round(v));
    const pct = (v: number) => (v >= 0 ? `+${v}` : String(v));
    const arrow = (before: number, after: number) =>
      t("lab.labDeck.compare.arrow", { before: fps(before), after: fps(after) });
    // ONE NAME PER REC: the comparison receipt stores the raw catalog title, so the display name is
    // resolved the same way every other surface resolves it. The user meets one name per tweak.
    const changeName = (r: { rec_id: string; rec_title: string }) =>
      recDisplayLabel(r.rec_id, r.rec_title).headline;

    // The two fact pairs, shared by every branch that is allowed to show values.
    const facts = (rows: { label: string; value: string }[]) => (
      <dl className="ld-cmp-facts">
        {rows.map((f) => (
          <div className="ld-cmp-fact" key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    );

    let sub: string;
    let reading: string;
    let measured = false;
    let tone: "ready" | "attention" | undefined;
    let body: ReactNode;

    if (c.state === "measured") {
      const r = c.result;
      measured = true;
      sub = t("lab.labDeck.compare.subMeasured", { change: changeName(r), game: r.game });
      reading =
        r.verdict === "no-change"
          ? t("lab.labDeck.compare.readingNoChange", { noiseFloor: r.noise_floor_pct })
          : t("lab.labDeck.compare.readingDelta", { pct: pct(r.delta_low1_pct) });
      tone = r.verdict === "improved" ? "ready" : r.verdict === "regressed" ? "attention" : undefined;
      body = (
        <div className="ld-cmp">
          <p className="ld-cmp-line">
            {t(`lab.labDeck.compare.${r.verdict === "no-change" ? "noChange" : r.verdict}`, {
              game: r.game,
            })}
          </p>
          {facts([
            {
              label: t("lab.labDeck.compare.avgLabel"),
              value: arrow(r.baseline_avg_fps, r.after_avg_fps),
            },
            {
              label: t("lab.labDeck.compare.lowLabel"),
              value: arrow(r.baseline_low1_fps, r.after_low1_fps),
            },
          ])}
          <p className="ld-cmp-method">
            {t("lab.labDeck.compare.method", {
              avgPct: pct(r.delta_avg_pct),
              lowPct: pct(r.delta_low1_pct),
              noiseFloor: r.noise_floor_pct,
            })}
          </p>
          {/* A measured regression is decision information, so the row says where the undo lives and
              takes the user there. Navigation only — the applied list owns the rollback itself. */}
          {r.verdict === "regressed" && (
            <div className="ld-cmp-actions">
              <button type="button" className="ld-btn" onClick={() => jump("optimize")}>
                {t("lab.labDeck.compare.undoCta")}
              </button>
            </div>
          )}
        </div>
      );
    } else if (c.state === "unfair") {
      const r = c.result;
      sub = t("lab.labDeck.compare.subUnfair", { change: changeName(r), game: r.game });
      reading = t(`lab.labDeck.compare.reading${r.verdict === "expired" ? "Expired" : "Confounded"}`);
      body = (
        <div className="ld-cmp">
          <p className="ld-cmp-line">
            {t(`lab.labDeck.compare.${r.verdict === "expired" ? "expired" : "confounded"}`)}
          </p>
          <p className="ld-cmp-method">{t("lab.labDeck.compare.unfairMethod")}</p>
          <div className="ld-cmp-actions">
            {/* The bench measures a change under repeatable conditions, which is the honest way past a
                baseline the session path can no longer judge. Opening it closes this row — the deck
                keeps one region open at a time — so no disabled state is reachable here. */}
            <button type="button" className="ld-btn" onClick={() => toggle("optimize", "prove")}>
              {t("lab.labDeck.compare.benchCta")}
            </button>
          </div>
        </div>
      );
    } else if (c.state === "armed") {
      const b = c.baseline;
      sub = t("lab.labDeck.compare.subArmed", { change: changeName(b), game: b.game });
      reading = t("lab.labDeck.compare.readingArmed");
      body = (
        <div className="ld-cmp">
          <p className="ld-cmp-line">{t("lab.labDeck.compare.armed", { game: b.game })}</p>
          {facts([
            { label: t("lab.labDeck.compare.baseAvgLabel"), value: fps(b.baseline_avg_fps) },
            { label: t("lab.labDeck.compare.baseLowLabel"), value: fps(b.baseline_low1_fps) },
          ])}
        </div>
      );
    } else {
      const none = c.state === "no-sessions";
      sub = t("lab.labDeck.compare.subNone");
      reading = t(none ? "lab.labDeck.compare.readingNoSessions" : "lab.labDeck.compare.readingIdle");
      body = (
        <div className="ld-cmp">
          <p className="ld-cmp-line">
            {t(none ? "lab.labDeck.compare.noSessions" : "lab.labDeck.compare.idle")}
          </p>
          {/* The bench is a real alternative only once there is something applied to test; with no
              measured session at all it would be a door onto an empty room. */}
          {!none && (
            <div className="ld-cmp-actions">
              <button type="button" className="ld-btn" onClick={() => toggle("optimize", "prove")}>
                {t("lab.labDeck.compare.benchCta")}
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <DeckRow
        id="ld-prove-compare"
        name={t("lab.labDeck.compare.name")}
        sub={sub}
        reading={reading}
        measured={measured}
        tone={tone}
        expanded={isOpen("compare", "prove")}
        onToggle={() => toggle("compare", "prove")}
      >
        {body}
      </DeckRow>
    );
  })();

  // ───────────────────────── the Rig Evidence Map ─────────────────────────
  // The Lab's hologram has a job Home's does not, which is the whole reason it earns a second
  // appearance in the app. Home answers "what IS this machine, and is it healthy". This one answers
  // "which part does the thing I'm looking at touch, and what does that part read right now" — the
  // SAME RigViewer component (not a copy, not a stand-in asset), pointed at a subsystem by the SAME
  // single-slot `open` state every row already uses. No second router and no new selection machine.
  //
  // And no proof door: work through the reachable states and every one of them already carries its
  // own door in the interaction that selected the subject — the move card's Prove button sits a few
  // lines above, and an instrument or symptom subject means the user just expanded that very row. A
  // door here would be the duplicate instrument, not a shortcut.
  const mapSubject: { sub: LabSubsystem; forName: string | null } = (() => {
    const row = open?.row;
    // The experiments row is hosted in "prove" but keyed "optimize" (a deliberate upstream
    // disambiguation) — without this branch it would borrow the Optimize station's name.
    if (row === "optimize" && open?.host === "prove") {
      return { sub: "system", forName: t("lab.labDeck.prove.experimentsName") };
    }
    if (row && row in stations) {
      const key = row as LabStationKey;
      return { sub: subsystemForStation(key), forName: stations[key].name };
    }
    const problem = problems.find((p) => p.key === row);
    if (problem) return { sub: subsystemForStation(problem.station), forName: problem.symptom };
    // "move-detail" and "nothing open" both land here: the map's resting subject is the next move.
    // No `forName` for it — its headline is the h3 a few lines up, and reprinting it would be the
    // duplication the glance pass exists to remove.
    if (move.state === "move") return { sub: subsystemOf(move.move.rec), forName: null };
    return { sub: "system", forName: null };
  })();
  const mapReadings = hw ? subsystemReadings(mapSubject.sub, hw) : [];
  // No hardware snapshot → no map at all. A hologram of a machine Compy hasn't read would be a
  // picture, not evidence.
  // A subject with no single part behind it (system-wide, and the read-only subsystems the map has no
  // audited reading for) lights nothing in the rig — correct, but 4/5 consumer seats read the unlit
  // rig as decoration that failed to do its job. So the two cases are now DECLARED states rather than
  // one state and an absence: `part` highlights, `whole` says in words why there is nothing to
  // highlight. The value is the same typed mapping the highlight already uses — no new inference.
  const mapFocus = rigKindForSubsystem(mapSubject.sub);
  const evidenceMap = hw ? (
    <div className="ld-map" data-focus={mapFocus ? "part" : "whole"}>
      <div className="ld-map-stage">
        <Suspense fallback={<div className="ld-map-wait">{t("lab.labDeck.map.wait")}</div>}>
          <RigViewer hw={hw} chromeless focusKind={mapFocus} />
        </Suspense>
      </div>
      <div className="ld-map-facts">
        <p className="ld-map-part">
          <span className="ld-map-part-name">
            {mapSubject.sub === "system"
              ? t("lab.labDeck.map.touchesSystem")
              : t("lab.labDeck.map.touches", {
                  part: t(`lab.labDeck.map.subsystem.${mapSubject.sub}`),
                })}
          </span>
          {mapSubject.forName && (
            <span className="ld-map-for">
              {t("lab.labDeck.map.for", { name: mapSubject.forName })}
            </span>
          )}
        </p>
        {mapReadings.length > 0 ? (
          <>
            <dl className="ld-map-list">
              {mapReadings.map((r) => (
                <div key={r.key} className="ld-map-item">
                  <dt className="ld-map-name">{t(`lab.labDeck.map.reading.${r.key}`)}</dt>
                  <dd className="ld-map-val">
                    <span className="ld-map-num">{r.value}</span>
                    {r.kind === "gauge" && (
                      <>
                        <span className="ld-map-den">
                          {t("lab.labDeck.map.of", { value: r.den })}
                        </span>
                        {/* The bar is redundant BY DESIGN — the two numbers already carry the
                            reading, so it is aria-hidden and no screen-reader user loses anything.
                            Its width is a real ratio of two real fields; there is no threshold
                            colour because no audited threshold covers these fields. */}
                        <span className="ld-map-bar" aria-hidden="true">
                          <span
                            className="ld-map-bar-fill"
                            style={{ width: `${Math.round(r.pct * 100)}%` }}
                          />
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="ld-map-src">{t("lab.labDeck.map.source")}</p>
          </>
        ) : (
          // Honest absence, in words — and now it always SAYS something. Suppressing this line for
          // `system` left the unlit rig explaining itself with nothing, which is what read as filler.
          <p className="ld-map-src">
            {mapSubject.sub === "system" ? t("lab.labDeck.map.whole") : t("lab.labDeck.map.none")}
          </p>
        )}
      </div>
    </div>
  ) : null;

  // ───────────────────────── section 1 render ─────────────────────────
  const moveCard = (() => {
    if (move.state === "unknown") {
      return (
        <div className="ld-move ld-move-quiet">
          <h3 className="ld-move-head">{t("lab.labDeck.move.unknownHead")}</h3>
          <p className="ld-move-line">{t("lab.labDeck.move.unknownLine")}</p>
          <div className="ld-move-actions">
            <button type="button" className="ld-btn ld-btn-primary" onClick={fast.onChanged}>
              {t("lab.labDeck.move.unknownCta")}
            </button>
          </div>
        </div>
      );
    }
    if (move.state === "all-clear") {
      return (
        <div className="ld-move ld-move-quiet">
          <h3 className="ld-move-head">{t("lab.labDeck.move.allClearHead")}</h3>
          <p className="ld-move-line">
            {t("lab.labDeck.move.allClearLine", { count: move.applied })}
          </p>
          <div className="ld-move-actions">
            <button
              type="button"
              className="ld-btn ld-btn-primary"
              onClick={() => openAt("benchmark")}
            >
              {t("lab.labDeck.move.allClearCta")}
            </button>
          </div>
        </div>
      );
    }
    if (move.state === "none") {
      return (
        <div className="ld-move ld-move-quiet">
          <h3 className="ld-move-head">{t("lab.labDeck.move.noneHead")}</h3>
          <p className="ld-move-line">{t("lab.labDeck.move.noneLine")}</p>
          <div className="ld-move-actions">
            <button
              type="button"
              className="ld-btn ld-btn-primary"
              onClick={() => openAt("benchmark")}
            >
              {t("lab.labDeck.move.noneCta")}
            </button>
          </div>
        </div>
      );
    }

    const { rec, goal, canApply, evidence } = move.move;
    // The evidence line is quoted from the source, never composed: a limiter carries the reason
    // priorities.rs measured, a carried rec says the check named it, and the catalog fallback
    // openly says nothing measured points at one thing yet. No branch invents a number.
    const why =
      evidence.from === "check"
        ? t("lab.labDeck.move.whyCheck")
        : evidence.from === "limiter"
          ? t("lab.labDeck.move.whyLimiter", { reason: evidence.reason })
          : t("lab.labDeck.move.whyCatalog");
    const proof = proofStationFor(goal, available);
    const busy = fast.busyId === rec.id;
    // ONE NAME PER REC: resolved through the shared display-label layer, so the tweak this card
    // nominates reads IDENTICALLY here, in the arrival banner, and in the row you land on.
    const name = recDisplayLabel(rec.id, rec.title);
    // GLANCE FIRST (owner verdict 2026-07-29). The card used to print eleven blocks — goal eyebrow,
    // headline, tech line, evidence line, the full catalog description, a three-fact list, the
    // reversible promise, the do-nothing line, the buttons, the can't-apply note and the remaining
    // line — 282 words and 678px tall inside a 711px viewport, which is how the trade-off column came
    // to overlap the fixed status readout at 1280×720 (panel P4). Nothing is deleted: everything the
    // user needs to DECIDE stays one labelled interaction away, in `detail` below.
    const detailOpen = isOpen("move-detail", "move");
    // EXACTLY ONE PRIMARY, in every state (owner law 2026-07-29: "secondary actions must not compete
    // with the primary"). The earlier rule spent the accent only on an appliable change and left the
    // can't-apply state with three identically-weighted buttons — 5/5 consumer seats read that as a
    // three-way choice with no path, which is the paralysis the glance layer exists to remove.
    //   canApply  → the apply button. It applies a change Compy captured a rollback contract for.
    //   !canApply → "Show me how". It NAVIGATES to the guided steps and mutates nothing, so the accent
    //               marks the next step instead of promising an apply Compy can't perform.
    // A `severity: "advanced"` rec would move the accent to the disclosure instead (read before you
    // act) — the catalog emits only "safe"/"moderate" today, so that branch is deliberately unwritten
    // rather than shipped as dead code.
    return (
      <div className="ld-move">
        <h3 className="ld-move-head">{name.headline}</h3>
        <p className="ld-move-why">{why}</p>
        <div className="ld-move-actions">
          {canApply ? (
            <button
              type="button"
              className="ld-btn ld-btn-primary"
              disabled={busy}
              data-busy={busy ? "1" : undefined}
              onClick={() => fast.onToggleRec(rec.id)}
            >
              {busy ? t("lab.labDeck.move.applying") : t("lab.labDeck.move.applyCta")}
            </button>
          ) : (
            // Compy can't set this one safely, so it says that and hands over the real row —
            // which owns the guided steps — instead of offering a button that can't deliver.
            <button
              type="button"
              className="ld-btn ld-btn-primary"
              onClick={() => {
                setGoalFilter(goal);
                jump("optimize");
              }}
            >
              {t("lab.labDeck.move.showSteps")}
            </button>
          )}
          <button type="button" className="ld-btn" onClick={() => dismiss(rec.id)}>
            {t("lab.labDeck.move.notForMe")}
          </button>
          {proof && (
            <button type="button" className="ld-btn" onClick={() => openAt(proof)}>
              {t("lab.labDeck.move.proveCta")}
            </button>
          )}
        </div>
        <p className="ld-move-meta">
          <span className="ld-move-goal">{goalInfo[goal].name}</span>
          {name.tech && (
            <>
              <span className="ld-move-sep" aria-hidden="true">
                {" · "}
              </span>
              <span className="ld-move-tech">{name.tech}</span>
            </>
          )}
        </p>
        {/* The label NAMES what is inside — what changes, the trade-off, how to undo it — so the
            disclosure never reads like a place safety information went to hide. Same single-slot
            grammar as every instrument row: opening this closes whatever else was open. */}
        <button
          type="button"
          className="ld-more"
          aria-expanded={detailOpen}
          aria-controls="ld-move-detail"
          onClick={() => toggle("move-detail", "move")}
        >
          <span>{t("lab.labDeck.move.detailCta")}</span>
          <span className="ld-more-chev" aria-hidden="true" />
        </button>
        {detailOpen && (
          <div className="ld-move-detail" id="ld-move-detail">
            {/* Labelled facts FIRST, catalog prose last (panel: 4/5 seats hit a wall of text on
                open and several stopped reading before the trade-off). The three labels answer the
                decision; the description is the background behind it. Reordered, not trimmed —
                every word the catalog wrote is still here. */}
            <dl className="ld-move-facts">
              <div className="ld-move-fact">
                <dt>{t("lab.labDeck.move.stateLabel")}</dt>
                <dd>{rec.applies_to}</dd>
              </div>
              <div className="ld-move-fact">
                <dt>{t("lab.labDeck.move.changeLabel")}</dt>
                <dd>{rec.impact}</dd>
              </div>
              {rec.downside && (
                <div className="ld-move-fact">
                  <dt>{t("lab.labDeck.move.downsideLabel")}</dt>
                  <dd>{rec.downside}</dd>
                </div>
              )}
            </dl>
            <p className="ld-move-line">{rec.description}</p>
            {/* MUTUALLY EXCLUSIVE, and it has to be. These two used to render together whenever
                Compy can't apply a rec: "Compy records how to put this back" directly above "Compy
                won't set this one for you" — a rollback promise sitting on top of an item Compy
                never touches, which 4/5 consumer seats read as the app overselling its own undo.
                Compy only promises rollback for changes Compy itself makes; for the rest the honest
                statement is where the steps are and how to reverse them by hand. Neither branch
                deletes safety information — `canApplyNo` now carries the undo route in words. */}
            {canApply ? (
              <p className="ld-move-safe">{t("lab.labDeck.move.reversible")}</p>
            ) : (
              <p className="ld-move-note">{t("lab.labDeck.move.canApplyNo")}</p>
            )}
            <p className="ld-move-line">{t("lab.labDeck.move.doNothing")}</p>
          </div>
        )}
        <p className="ld-move-remaining">
          {move.remaining > 0 ? (
            <>
              {t("lab.labDeck.move.remaining", { count: move.remaining })}{" "}
              <button type="button" className="ld-link" onClick={() => jump("optimize")}>
                {t("lab.labDeck.move.seeAll")}
              </button>
            </>
          ) : (
            t("lab.labDeck.move.remainingNone")
          )}
        </p>
      </div>
    );
  })();

  const section = (key: DeckSection, body: ReactNode) => (
    <section
      id={`ld-${key}`}
      className="ld-section"
      data-section={key}
      data-here={here === key ? "on" : undefined}
      tabIndex={-1}
      aria-labelledby={`ld-${key}-h`}
      ref={(el) => {
        sections.current[key] = el;
      }}
    >
      {/* The rail is the journey made visible: a hairline spine down the section stack with a lit
          node on the step you're reading. Decoration is the wrong word for it — it's the answer to
          "where am I and how much is left", which is why it's aria-hidden (the nav already says it
          in words) and why it's a step COUNT, not a flourish. */}
      <span className="ld-rail" aria-hidden="true">
        <span className="ld-rail-node" />
      </span>
      <h2 id={`ld-${key}-h`} className="ld-h">
        {t(`lab.labDeck.sections.${key}`)}
      </h2>
      {key !== "move" && <p className="ld-h-line">{t(`lab.labDeck.sections.${key}Line`)}</p>}
      {body}
    </section>
  );

  return (
    <div className="lab-deck" data-motion={reduced ? "reduced" : "full"} ref={deckRef}>
      {/* ONE visible navigation grammar for the whole face: five names, in journey order, that
          move you down the same page. Nothing here hides a destination behind a mode. The lit pill
          is where you ARE, so the nav doubles as orientation instead of only as transport. */}
      <nav className="ld-nav" aria-label={t("lab.labDeck.nav.label")} ref={navRef}>
        {NAV.map((s) => (
          <button
            key={s}
            type="button"
            className="ld-nav-item"
            aria-current={here === s ? "true" : undefined}
            onClick={() => jump(s)}
          >
            {t(`lab.labDeck.sections.${s}`)}
          </button>
        ))}
      </nav>

      {section(
        "move",
        <>
          {moveCard}
          {evidenceMap}
        </>,
      )}

      {section(
        "optimize",
        <>
          {/* Goal chips FILTER the one audited list rather than splitting it into five lists —
              five lists would mean five headings and five competing "enable all" buttons, the
              exact overload recovery item 13 names. One group → no chips: a filter with a single
              option is noise, not navigation. */}
          {goalGroups.length > 1 && (
            <div className="ld-chips" role="group" aria-label={t("lab.labDeck.optimize.filterLabel")}>
              <button
                type="button"
                className="ld-chip"
                aria-pressed={activeGoal == null}
                onClick={() => setGoalFilter(null)}
              >
                {t("lab.labDeck.optimize.allChip")}
              </button>
              {goalGroups.map((g) => (
                <button
                  key={g.goal}
                  type="button"
                  className="ld-chip"
                  aria-pressed={activeGoal === g.goal}
                  onClick={() => setGoalFilter(g.goal)}
                  title={goalInfo[g.goal].line}
                >
                  {goalInfo[g.goal].name}
                  <span className="ld-chip-n">{g.recs.length}</span>
                </button>
              ))}
            </div>
          )}
          {activeGoal != null && <p className="ld-chip-line">{goalInfo[activeGoal].line}</p>}
          <OptimizeStation {...fast} carriedRecIds={carriedRecIds} goalFilter={activeGoal} />
        </>,
      )}

      {section(
        "prove",
        <div className="ld-rows">
          {/* Result before tools: the receipt Compy already holds leads the instruments that make one. */}
          {compareRow}
          {proveKeys.map((k) => instrumentRow(k, "prove"))}
          <DeckRow
            id="ld-prove-experiments"
            name={t("lab.labDeck.prove.experimentsName")}
            sub={t("lab.labDeck.prove.experimentsLine")}
            expanded={isOpen("optimize", "prove")}
            onToggle={() => toggle("optimize", "prove")}
          >
            <ExperimentBench />
          </DeckRow>
        </div>,
      )}

      {section(
        "diagnose",
        <div className="ld-rows">
          {problems.map((p) => (
            <DeckRow
              key={p.key}
              id={`ld-problem-${p.key}`}
              name={p.symptom}
              sub={p.because}
              // ONE PLACE PER READING (panel P2). A reading belongs to the instrument that took
              // it, and every instrument already prints its own on its own row. Repeating it here
              // put the SAME sentence on screen three times — "it stutters" and "my fps swings"
              // both route to the benchmark, whose row sits one section up. So a symptom row names
              // the symptom and opens the tool; it does not take readings. Nothing is deleted: the
              // instrument's row states it, and opening this row mounts that instrument in place.
              expanded={isOpen(p.key, "diagnose")}
              onToggle={() => toggle(p.key, "diagnose")}
            >
              {instrumentBody(p.station)}
            </DeckRow>
          ))}
        </div>,
      )}

      {section(
        "advanced",
        <details
          className="ld-advanced"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        >
          <summary className="ld-advanced-summary">{t("lab.labDeck.advanced.summary")}</summary>
          <div className="ld-rows">
            {advancedKeys.map((k) => instrumentRow(k, "advanced"))}
            {/* Honestly unavailable, never silently missing: an instrument this rig can't drive
                says why it isn't here instead of vanishing (LOCKED rule 5 — vendor honesty). */}
            {!available.has("tuning") && (
              <p className="ld-unavailable">{t("lab.labDeck.unavailable.tuning")}</p>
            )}
            {!available.has("diagnostics") && (
              <p className="ld-unavailable">{t("lab.labDeck.unavailable.diagnostics")}</p>
            )}
          </div>
        </details>,
      )}
    </div>
  );
}

export default LabDeck;
