import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { peekProbe, cachedProbe } from "../../data/probe-cache";
import { readHandoff } from "../../data/check-handoff";
import { recDisplayLabel } from "../../data/friendly-labels";
import { measureTuning, tuningEvidence } from "../../data/tuning-measure";
import { tuningGuideForVendorForLanguage } from "../../data/tuning-guides";
import {
  groupByGoal,
  labGoals,
  labProblems,
  nextBestMove,
  proofStationFor,
  type LabGoal,
} from "./lab-deck-data";
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
import "./LabDeck.css";

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
          <span className="ld-row-reading" data-measured={props.measured ? "yes" : "no"}>
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
};

export function LabDeck({
  fast,
  diagnostics,
  diagnosticsCaptured = false,
  priorities = null,
  activeCount = 0,
}: LabDeckProps) {
  const vendor: GpuVendor = fast.vendor ?? "any";
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const { dismissed, dismiss } = useDismissed();

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
        recs: fast.recs,
        isAppliable: fast.isAppliable,
        revertedIds,
        dismissedIds: dismissed,
        carriedRecIds,
        priorities,
        activeCount,
      }),
    [fast.recs, fast.isAppliable, revertedIds, dismissed, carriedRecIds, priorities, activeCount],
  );

  // ───────────────────────── section 2: optimize, by goal ─────────────────────────
  const goalInfo = useMemo(() => labGoals(t), [t]);
  const liveRecs = useMemo(() => (fast.recs ?? []).filter((r) => r.eligible !== false), [fast.recs]);
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
    if (tuningGuide) {
      invoke<SessionSummary[]>("get_session_summaries")
        .then(setSessions)
        .catch(() => {});
      invoke<ArmedComparison | null>("get_armed_comparison")
        .then(setArmed)
        .catch(() => {});
      invoke<ComparisonResult | null>("get_latest_comparison")
        .then(setLatestCmp)
        .catch(() => {});
    }
  }, [tuningGuide]);

  const measurement = measureTuning(armed, sessions, latestCmp);
  const tuningEvidenceVerdict = tuningEvidence(sessions);
  const safeReady =
    fast.recs != null ? safeFixesReady(fast.recs, fast.isAppliable, revertedIds) : 0;
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
  // Open an instrument from somewhere else in the page (section 1's "how you'd prove it") and
  // take the user to it — an explicit, labelled move, never a silent teleport.
  const openAt = (key: LabStationKey, host: DeckSection) => {
    setOpen({ row: key, host });
    jump(host);
  };

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
              onClick={() => openAt("benchmark", "prove")}
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
              onClick={() => openAt("benchmark", "prove")}
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
    return (
      <div className="ld-move">
        <p className="ld-move-goal">{goalInfo[goal].name}</p>
        <h3 className="ld-move-head">{name.headline}</h3>
        {name.tech && <p className="ld-move-tech">{name.tech}</p>}
        <p className="ld-move-why">{why}</p>
        <p className="ld-move-line">{rec.description}</p>
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
        <p className="ld-move-safe">{t("lab.labDeck.move.reversible")}</p>
        <p className="ld-move-line">{t("lab.labDeck.move.doNothing")}</p>
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
            <button type="button" className="ld-btn" onClick={() => openAt(proof, "prove")}>
              {t("lab.labDeck.move.proveCta")}
            </button>
          )}
        </div>
        {!canApply && <p className="ld-move-note">{t("lab.labDeck.move.canApplyNo")}</p>}
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

      {section("move", moveCard)}

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
              reading={stationReading(p.station, facts, t)}
              measured={stationHasReading(p.station, facts)}
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
        <details className="ld-advanced">
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
