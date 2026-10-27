import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  AppliedChange,
  GameReadiness,
  IntelligenceHeadline,
  PendingCareIncident,
  Priorities,
  Recommendation,
  SessionSummary,
} from "../types";
import type { HardwareInfo } from "../App";
import { RoomShell } from "../design/room-shell";
import { RoomEyebrow } from "../design/room-eyebrow";
import { useReducedMotion } from "../design/use-motion";
import { useIntelligenceFlag, useHomeInterviewFlag } from "../design/use-hud";
import { readHologramV2 } from "../design/theme";
import { postureLine, liveStrip } from "./command-center-data";
import { LedgerHealthNotice, useLedgerHealth } from "../design/LedgerHealthNotice";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { useDocumentVisible } from "../data/use-document-visible";
import { gpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, gradeCpuTempC, type Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { inEffectCounts, useMachineModel, type InEffectCounts } from "../data/machine-model";
import { ArcGauge, type ArcTone } from "../design/console/ArcGauge";
import { Term } from "../design/Term";
import { Dock, type DockNode } from "../design/console/Dock";
import { Reading } from "../design/console/Reading";
import { Icon } from "../design/Icon";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { useConfirmOptional } from "../design/ConfirmDialog";
import { safeFixesReadyList } from "./optimize-v2-data";
import { RerunCheckBand } from "./RerunCheckBand";
import { SetupLauncherCard } from "./setup/SetupLauncherCard";
import { CpuTempOffer } from "./CpuTempOffer";
import { deriveReverted } from "./use-scan";
import { BentoGrid, BentoTile, Sheet, useSheet } from "../design/bento";
import { headlineFit } from "../design/headline-fit";
import { homeCareEntry, fastPathReadyHeadline, fastPathApplyLabel } from "./home-intake-data";
import { HomeInterview } from "./HomeInterview";
import { isMeasuredVerdict, type SummaryExperiment } from "./test-summary";
import {
  INTERVIEW_ROOT,
  interviewQuestions,
  type InterviewFacts,
  type InterviewStep,
} from "./home-interview-data";
import "./home-console.css";

// HomeConsole — Home as the console cold-open (plan 2026-07-10-console-hud-phase2-home,
// Phase 2 of the Console HUD; design source 2026-07-09-compy-console-hud-direction, owner-
// approved). The Lab Ops Console's language on the app's opening screen: the real 3D rig
// hologram center-stage inside a bracketed console stage, four honest corner arc gauges,
// and (Task 3) a Dock that navigates into the rooms. Behind compy_home_console, DEFAULT ON ("0" is the failsafe).
//
// Honesty contract (identical to HomeHud — presentation only, zero new IPC): every gauge
// value traces to a real measured source; an absent reading is `null` → ArcGauge's NOT-YET,
// never a fabricated 0. Readiness is the ready/total checks ratio (no invented 0–100 score);
// Avg FPS / 1% low come from the most recent real session (liveStrip); GPU temp is the same
// 5s poll HomeHud runs, toned via gradeGpuTempForVendor (NVIDIA stays ungraded — LOCKED
// rule 5). The masthead is HomeHud's proven register, ported verbatim (hc- classes so the
// console never depends on the separate Instrument-HUD flag's data-hud CSS scope).

const RigHologram = lazy(() =>
  import("./rig/RigHologram").then((m) => ({ default: m.RigHologram })),
);

type Props = {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  onRunCheck: () => void;
  onSeeInFix: () => void;
  /** Where limiter jumps land: "Lab" on the proving-ground rail, "Optimize" classic. */
  fixRoomLabel?: string;
  /** Rail navigation — App's navHome. The Dock is doors, not panels. */
  onNavigate?: (key: string) => void;
  /** The rooms the rail actually shows (railFor minus home itself) — honest doors only. */
  rooms?: { key: string; name: string }[];
  /** App's single station-intent writer (openLabStation): persists the intended in-room instrument
   *  BEFORE navigating, so the destination console cannot mount first and lose it. Intake rows that
   *  carry a `station` route through here; without it they fall back to a plain room nav. */
  onOpenLabStation?: (station: string, incidentId?: string) => void;
  // ── The Care observer's Home card (Tier 1 task 9, #222). All three optional: an isolated mount
  //    with no wiring simply renders no card, never a placeholder.
  /** The one incident the observer noticed and has not yet been acknowledged, or null. */
  pendingCare?: PendingCareIncident | null;
  /** "Find out why" — routes to the exact incident inside Crash & Freeze Rescue. */
  onOpenCareIncident?: (incidentId: string) => void;
  /** "Not now" — clears Compy's pointer. Never touches the Windows evidence itself. */
  onDismissCareIncident?: (incidentId: string) => void;
  // ── Home intake band (BACKLOG:916, behind compy_home_intake, DEFAULT OFF). The three below
  //    are the ONLY wiring the pre-room intent router + its one-tap fast path need. All optional:
  //    an isolated mount (no wiring) simply shows no fast-path row — never a misleading "Checking…".
  /** The live recommendation catalog. undefined = not wired (no fast path); null = still loading
   *  (fast-path row shows "Checking…"); array = resolved (ready / all-clear derived honestly). */
  recs?: Recommendation[] | null;
  /** Which rec ids have an audited one-click apply (App's APPLIABLE_REC_IDS membership). */
  isAppliable?: (recId: string) => boolean;
  /** The audited one-UAC batch-apply primitive (App's applyBatch → apply_recommendations_batch).
   *  The fast path reuses it verbatim — it opens NO new mutation boundary. */
  onApplyBatch?: (
    recIds: string[],
  ) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
  /** #225 finding 1 — the latest-change follow-through (App's <FirstWin>), which used to render
   *  ABOVE the whole room and displaced the verdict and the rig by a measured 142px. It leads
   *  `below` now: real, reachable, and subordinate to the verdict/action/rig composition the
   *  approved comp puts in the first viewport. A node, so App keeps owning the ledger data. */
  latestChange?: ReactNode;
};

/* WHICH PICTURE EACH SURFACED ANSWER WEARS (01-health-approved.png). Keyed by the
   interview's own choice id, so this map cannot invent a card for an answer that does not
   exist and cannot outlive one that is removed — the row simply stops rendering with it.
   Presentation lives here rather than in home-interview-data because a glyph is not part of
   the taxonomy: the interview's own screens draw no icons at all. */
const HAPPENING_GLYPH: Record<string, string> = {
  crash: "burst",
  slow: "gauge",
  unsure: "help",
  // The goal half (owner direction 2026-08-26) — the cards Home shows when nothing was detected.
  moreFps: "target",
  watchFps: "pulse",
  scores: "chart",
  specs: "grid",
};

/**
 * WHICH THREE SHORTCUTS HOME OFFERS, and it depends on whether Compy actually found anything.
 *
 * Owner direction 2026-08-26, his words: *"offering help should only be an option if there an
 * indicator that something was detected from your pc that it would even inquire that"*, and
 * *"the home page options all seem to only point towards some sort of 'issue' which shouldnt be
 * the only reason people are here in the first place"*.
 *
 * So the symptom cards are EARNED, not permanent. With a flagged check or a recorded incident on
 * screen, the three answers people arrive with lead. With nothing detected, leading with "it
 * crashed or froze" asks a healthy PC's owner to pick a symptom they do not have — an implied
 * finding Compy never measured, which is the honest-measurement law failing in the direction
 * nobody guards for. In that state Home offers the four things Compy's OTHER specialty is for.
 *
 * Both sets are read out of the interview's own taxonomy by id, so a card can never carry wording
 * Home invented, and an answer that stops existing takes its card with it rather than rendering a
 * row that leads nowhere. Pinned by `home-console-front-door-gate.test.tsx`.
 */
// ── HOW HEALTH'S STAGE FRAMES ITS RIG (#225 finding 3, "the rig is cropped") ──────────────────
// The stage shipped at cameraDist 6.9 with the hologram's default aim (targetY 0.2), and at that
// seat the rig does not fit its own frame: projecting the case box (4.15 x 5.35 x 2.55, centred)
// and the floor ring (outer radius 2.7 at y=-2.75) through the 45deg vertical fov puts the case
// top 2% ABOVE the frame and the ring's near edge 36% of a stage-height BELOW it. That is the
// crop the owner saw, and it is why the case's near panel read as a slab: at 6.9 the camera is
// inside the composition rather than looking at it.
//
// 10.1 / -0.48 is solved, not guessed: it is the (distance, aim) pair that puts 7.98% air above
// the case and 7.97% below the ring, against the ~8.1% the approved comp draws on both edges
// (ring apex comp y668, stage floor y713, stage height 553). It lands a hair from the value the
// Test lane measured for its own bench (10.2 / -0.45) from a different comp -- two independent
// derivations of the same "let the instrument breathe" framing.
//
// ONE PAIR COVERS ALL THREE REQUIRED VIEWPORTS, by construction rather than by luck: the fov is
// VERTICAL, the stage's height is fixed (--hc-stage-max), and fitCameraDistance leaves the base
// distance untouched at any aspect >= 1.2. Only the horizontal margin changes with the viewport.
// ROUND 2 MOVED THOSE ASPECTS and they are re-measured, not carried forward: --hc-stage-max grew
// 500 -> 530 to match the approved comp, which makes the canvas taller without making it wider, so
// Health's stage now measures 1.222 at both 1500x980 and 1920x1080 (canvas 599x490, identical at
// both because the room's content wrap caps at 1160 and centres) and 1.720 at 1280x720, where the
// panel's ceiling binds and the stage gives ground to 335. 1.222 is the FLOOR across every window
// size, and it clears the 1.2 reference by 0.022 -- thin, so home-console-parity-225 asserts that
// margin explicitly. Raising --hc-stage-max again means re-solving this pair, not widening a band.
const HEALTH_CAMERA_DIST = 10.1;
const HEALTH_CAMERA_TARGET_Y = -0.48;

const DETECTED_SHORTCUTS = ["crash", "slow", "unsure"] as const;
const CLEAR_SHORTCUTS = ["moreFps", "watchFps", "scores"] as const;

const fmtGB1 = (b: number) => (b / 1024 ** 3).toFixed(1);

// Grade → status tone for the callout LEDs (ok/warn only; neutral = no LED — ungraded).
const gradeTone = (g: Grade): "ok" | "warn" | null =>
  g === "good" ? "ok" : g === "ok" || g === "bad" ? "warn" : null;

// Grade → ArcGauge tone. "ok" rides the accent ring (fine, not celebrated), "bad" warns;
// neutral stays neutral — an ungraded value never borrows a judgment color.
const arcTone = (g: Grade): ArcTone =>
  g === "good" ? "good" : g === "ok" ? "accent" : g === "bad" ? "warn" : "neutral";

// Short marketing-prefix-free model name ("AMD Radeon RX 9070 XT" → "RX 9070 XT").
// Purely presentational trimming of the DETECTED name — never invents or substitutes a model.
const shortModel = (n: string | undefined): string | undefined =>
  n?.replace(/^\s*(AMD|NVIDIA|Intel)?\s*(Radeon|GeForce|Arc)?\s*(\(TM\))?\s*/i, "").trim() || n;

// RAM speed for the rig annotation (consumer panel 2026-07-14: capacity alone hid the speed/EXPO
// story the cards view already tells). Measured module speed only — no reading, no claim; the
// below-rated case mirrors HardwareGrid's actionable EXPO/XMP flag in compact form.
const ramSpeedNote = (mods: HardwareInfo["memory_modules"], t: TFunction): string | undefined => {
  const below = mods.find((m) => m.xmp_expo_status === "running_below_rated" && m.rated_speed_mhz > 0);
  if (below)
    return t("home.homeConsole.callout.ramBelowRated", {
      speed: below.speed_mhz,
      rated: below.rated_speed_mhz,
    });
  const m = mods.find((x) => x.speed_mhz > 0);
  return m ? `${m.speed_mhz} MT/s` : undefined;
};

// ── Dense readouts behind each callout (owner direction 2026-07-14: "the hologram is the
// index into the dense data"). Expanding a callout shows the full DETECTED record — the same
// HardwareInfo fields the Cards view renders; zero new probes, zero new claims. A missing
// field omits its row entirely (never a placeholder, never a guess).
const fmtGB0 = (b: number) => `${Math.round(b / 1024 ** 3)}`;
const fmtDiskSize = (b: number) =>
  b >= 1000 * 1024 ** 3 ? `${(b / 1024 ** 4).toFixed(1)} TB` : `${fmtGB0(b)} GB`;

export const denseGpu = (
  g: HardwareInfo["gpus"][number] | undefined,
  t: TFunction,
): [string, string][] => {
  if (!g) return [];
  const rows: [string, string][] = [[t("home.homeConsole.dense.model"), g.name]];
  if (g.vram_bytes > 0) rows.push([t("home.homeConsole.dense.vram"), `${fmtGB0(g.vram_bytes)} GB`]);
  if (g.driver_version) rows.push([t("home.homeConsole.dense.driver"), g.driver_version]);
  if (g.driver_date) rows.push([t("home.homeConsole.dense.driverDate"), g.driver_date]);
  return rows;
};

export const denseCpu = (hw: HardwareInfo, t: TFunction): [string, string][] => {
  const rows: [string, string][] = [];
  if (hw.cpu_brand) rows.push([t("home.homeConsole.dense.model"), hw.cpu_brand]);
  if (hw.cpu_cores_physical > 0)
    rows.push([
      t("home.homeConsole.dense.cores"),
      `${hw.cpu_cores_physical}c / ${hw.cpu_cores_logical}t`,
    ]);
  if (hw.cpu_frequency_mhz > 0)
    rows.push([t("home.homeConsole.dense.clock"), `${(hw.cpu_frequency_mhz / 1000).toFixed(1)} GHz`]);
  return rows;
};

export const denseRam = (mods: HardwareInfo["memory_modules"], t: TFunction): [string, string][] =>
  mods.map((m, i) => [
    t("home.homeConsole.dense.slot", { n: i + 1 }),
    [
      m.capacity_bytes > 0 ? `${fmtGB0(m.capacity_bytes)} GB` : null,
      m.type_name || null,
      m.speed_mhz > 0 ? `${m.speed_mhz} MT/s` : null,
      m.manufacturer || null,
    ]
      .filter(Boolean)
      .join(" · "),
  ]);

export const denseStorage = (disks: HardwareInfo["physical_disks"]): [string, string][] =>
  disks.map((d) => [
    d.friendly_name,
    [d.media_type || null, d.bus_type || null, fmtDiskSize(d.size_bytes)]
      .filter(Boolean)
      .join(" · "),
  ]);

// One instrument annotation: LED (only when a measured value earned a tone) · part · detected
// model · measured value on a hairline leader. HomeHud's Callout in the console's namespace.
// A LABEL, nothing more (2026-08-06): it names a rig part and carries what is changing right
// now. The detected record it used to hide behind a hover/click expander lives in the boxed
// `.hc-specs` templates below the stage — one owner per fact, and no mystery meat over the 3D.
function Callout({
  tone,
  name,
  detail,
  value,
  valueTone,
  mono = true,
}: {
  tone: "ok" | "warn" | null;
  name: string;
  detail?: string;
  value?: string;
  valueTone?: "ok" | "warn" | null;
  mono?: boolean;
}) {
  return (
    <div className="hc-callout">
      <span className="hc-callout-head">
        {tone && <span className={`hc-led hc-led-${tone}`} aria-hidden="true" />}
        <b>{name}</b>
        {detail && <span className="hc-callout-detail">{detail}</span>}
      </span>
      {value && (
        <span
          className={`hc-callout-v ${mono ? "hc-mono" : ""}${valueTone ? ` hc-callout-v-${valueTone}` : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// One boxed template in the detected-hardware block. Title + label/value rows, always open —
// the owner's "better grouping and boxed templates" in place of hover-to-reveal. Rows come
// verbatim from the dense builders above (same HardwareInfo the Cards view renders, zero new
// probes); an empty record renders NO box rather than an empty one or a fabricated placeholder.
function SpecBox({ title, rows }: { title: string; rows: [string, string][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="hc-spec">
      <span className="hc-spec-title">{title}</span>
      <dl className="hc-spec-rows">
        {rows.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="hc-spec-row">
            <dt className="hc-spec-k">{k}</dt>
            <dd className="hc-spec-v hc-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// WHAT COMPY HAS IN EFFECT ON THIS PC (#599). The default Health face never said: the count only fed
// the interview, so a change Compy has no live check for (a startup entry is one) left no trace
// here at all. HomeHud's pattern: the verified count, and BESIDE it — never added to it — the ones
// Compy can't confirm, because an unconfirmed change is neither on nor off and "0" alone would
// read as nothing applied. Silent while reading and before Compy has recorded anything, so the
// cold open stays as it was; an unreadable record is a word, never a silence.
function InEffectLine({ inEffect, t }: { inEffect: InEffectCounts; t: TFunction }) {
  if (inEffect.kind === "pending") return null;
  if (inEffect.kind === "counted" && inEffect.totalRecorded === 0) return null;
  return (
    <p className="hc-in-effect" data-testid="hc-in-effect">
      <span className="hc-in-effect-k">{t("home.homeConsole.inEffect.label")}</span>
      {inEffect.kind === "unreadable" ? (
        <span className="hc-in-effect-v">{t("common.ledgerHealth.activeUnknown")}</span>
      ) : (
        <>
          <span className="hc-in-effect-v">
            {t("home.homeConsole.inEffect.active", { count: inEffect.activeNow })}
          </span>
          {/* The separator rides INSIDE the phrase it introduces, so a narrow window wraps the two
              together instead of leaving a "·" dangling at the end of the first row. */}
          {inEffect.unknown > 0 && (
            <span className="hc-in-effect-v hc-in-effect-unknown">
              <span className="hc-in-effect-sep" aria-hidden="true">
                ·
              </span>
              {t("home.homeConsole.inEffect.unconfirmed", { count: inEffect.unknown })}
            </span>
          )}
        </>
      )}
    </p>
  );
}

// WHY THE FOUR RAW READINGS ARE NOT ArcGauges (four-room direction, issue #49). The strip is a
// HIERARCHY, not five equal instruments: the composite readiness score keeps its ring because a
// 0-100 out of a formula is what a ring is for, and the four raw readings beside it are just
// numbers. Five rings in a row would be the "twelve equal tiles" failure the bento exists to
// prevent, in miniature. The cell itself now lives in the kit (slice 3) — see Reading.tsx, whose
// READING_ROWS contract .hc-readout below is what satisfies.

export function HomeConsole({
  hw,
  readiness,
  priorities,
  sessions,
  changes,
  onRunCheck,
  onSeeInFix,
  // "Lab", not "Optimize" — that room was deleted in the 2026-08-06 generation prune. App.tsx
  // always passes t("common.rail.lab"); this default only ever shows up in isolation tests.
  fixRoomLabel = "Lab",
  onNavigate,
  onOpenLabStation,
  rooms,
  recs,
  isAppliable,
  onApplyBatch,
  pendingCare,
  onOpenCareIncident,
  onDismissCareIncident,
  latestChange,
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // Shared Machine Model (#451): the hardware grid's identity rows read its facts, not bare
  // inventory fields. One read-only IPC per hardware refresh — `hw` is App.refresh()'s product, so a
  // new object re-reads the model alongside it.
  const model = useMachineModel(hw);
  // Optional confirm — the fast path (default-OFF) is the only consumer, so HomeConsole must not
  // hard-require the provider on every mount (see useConfirmOptional). null → runFastPath no-ops.
  const confirm = useConfirmOptional();
  // The rig tile's popout. Depth goes BEHIND the sheet, never across the surface (bento law): the
  // stage keeps the live picture, the full detected parts list opens over the dimmed room.
  const partsSheet = useSheet<"parts">();
  const interviewOn = useHomeInterviewFlag();
  // HOME IS UNGATED — STRUCTURE, NOT A SWITCH (owner 2026-08-06, reversing the calm-default pass
  // that shipped the day before): "the expert view doesnt seemingly even need to be an option the
  // information it displayed should be standard my only worry with that was only if it was
  // overbearing or caused to much congestion aesthetically the better option is to integrate and
  // structure the layout in a neat style that avoided too much text or paragraph style
  // descriptions with better grouping and boxed templates".
  //
  // The complaint was never that the information EXISTS — it was congestion. The previous pass
  // answered congestion by hiding half of Home behind useExpertView(); that is a switch, not a
  // layout, and it made the answer conditional on a preference a non-technical user will never
  // find. Home consumes NO expert preference now (the other nine surfaces keep theirs — spec
  // 2026-07-11-expert-layer-middle-ground, owner GO 2026-07-12; this reversal is Home-only).
  //
  // What replaced the switch, and where each number now lives — ONE owner per fact:
  //   · the stage carries LIVE state only — four gauges, and floating labels naming the rig parts
  //     with what is changing right now (RAM used/total, disk % full). Plain text: no hover, no
  //     "+", no button. Nothing on the stage hides behind an interaction.
  //   · the DETECTED record — module timings, driver builds, disk models, core counts — moved off
  //     the stage into `.hc-specs`: four always-visible boxed templates under it (Graphics ·
  //     Processor · Memory · Storage), label/value rows, zero prose.
  // Hover-to-reveal was the congestion: it put a spec sheet on top of the 3D scene and made the
  // rest mystery meat. Boxes below the stage read at a glance and never overlap the rig.
  // Fast-path (option C) transient state: a busy guard against double-submit, and a real receipt
  // built from the batch result (never a fabricated "done" — it names applied AND skipped).
  const [fastPathBusy, setFastPathBusy] = useState(false);
  // THE INTERVIEW (step 3, issue #177). The front door's one action no longer toggles a panel in
  // place — it opens the interview sheet, which grows out of the button. Null means closed; the
  // rect is the button's own, captured at click, so the panel expands from exactly where the user
  // pressed rather than fading in from nowhere.
  const [interviewOrigin, setInterviewOrigin] = useState<DOMRect | null>(null);
  const [interviewOpen, setInterviewOpen] = useState(false);
  // P7-route: whether the Trial bench is armed and how many changes it has MEASURED (a result
  // verdict, P4-exit-truth), read only while the interview is open so the answer can land on the
  // journey or "What Compy tested". A failed read is unknown (`judged: null`, or null when even the
  // gate didn't answer) — the interview then says it couldn't read the records, never that nothing
  // was measured, and never invents a count.
  const [interviewTrials, setInterviewTrials] = useState<InterviewFacts["trials"]>(null);
  useEffect(() => {
    if (!interviewOpen) return;
    let live = true;
    (async () => {
      let armed: boolean | null = null;
      try {
        armed = await invoke<boolean>("get_experiment_gate");
        if (!armed) {
          // Round 4 review: a dark bench is "testing unavailable", not an empty history. The records
          // are not read, so the count stays unknown; the interview says the bench is off.
          if (live) setInterviewTrials({ armed: false, judged: null });
          return;
        }
        const exps = await invoke<SummaryExperiment[] | null>("get_experiments");
        // A null answer is no list, not an empty one: the count stays unknown (review round 2, §5).
        const judged = Array.isArray(exps)
          ? new Set(exps.filter((e) => isMeasuredVerdict(e.verdict)).map((e) => e.rec_id)).size
          : null;
        if (live) setInterviewTrials({ armed: true, judged });
      } catch {
        // Follow-up review 2026-10-26 §5 (and round 3 §4): a failed read is "couldn't read", never
        // "nothing measured", whichever call failed. The gate's answer, if it came, is kept; when even
        // the gate didn't answer, the bench's state is unknown too (`armed: null`).
        if (live) setInterviewTrials({ armed, judged: null });
      }
    })();
    return () => {
      live = false;
    };
  }, [interviewOpen]);
  // Which step the interview opens ON (issue #49). The primary button opens it at the root, exactly
  // as before; a quick-symptom row opens it one answer in. It is a full path, not a cursor, so the
  // interview's own breadcrumb and Back button keep working with no change to how they read state.
  const INTERVIEW_START: InterviewStep[] = [{ kind: "question", id: INTERVIEW_ROOT }];
  const [interviewPath, setInterviewPath] = useState<InterviewStep[]>(INTERVIEW_START);
  // Whether the one-tap safe stack has already been applied in THIS visit. The finding card reads
  // it to stop offering an apply that has landed, instead of re-offering work that is done.
  // The receipt is a RESULT, not a boolean. J (2026-07-22): the fast path once reported only a
  // count, so "1 safe tweak not applied" was unanswerable — the batch primitive returns title +
  // reason per skip and it was discarded one line after arriving. The interview renders the whole
  // thing; nothing here is synthesised, so a skip can only ever say what actually happened.
  const [fastPathReceipt, setFastPathReceipt] = useState<{
    applied: number;
    skipped: number;
    skippedItems: { title: string; reason: string }[];
  } | null>(null);

  // Cursor-follow accent spotlight on the stage — a border-masked glow that tracks the pointer
  // (LabConsole's exact mechanism). Custom props only; skipped entirely under reduced motion.
  const stageRef = useRef<HTMLDivElement>(null);
  // The chrome (and so the border-masked glow) moved from .hc-stage to the .hc-panel that now
  // holds the rig AND the readout strip, so the glow's custom properties have to be written on
  // the panel. stageRef stays on the canvas box: it is what the reticle is scoped to, and the
  // reticle still belongs to the rig, not to the numbers under it.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const stage = panelRef.current;
    if (!stage) return;
    // Reduced motion (incl. a mid-session flip): clear any stale glow the pointer handler left
    // set, and attach nothing.
    if (reduced) {
      stage.style.setProperty("--glow-intensity", "0");
      return;
    }
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      stage.style.setProperty("--glow-x", `${((e.clientX - r.left) / r.width) * 100}%`);
      stage.style.setProperty("--glow-y", `${((e.clientY - r.top) / r.height) * 100}%`);
      stage.style.setProperty("--glow-intensity", "1");
    };
    const onLeave = () => stage.style.setProperty("--glow-intensity", "0");
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.style.setProperty("--glow-intensity", "0");
    };
  }, [reduced]);

  // ── pointer parallax (JARVIS depth, event-driven — no rAF loop, nothing runs on blur).
  // HomeHud's exact mechanism: writes two CSS vars on the stage; ONLY the annotation plane
  // consumes them, so the canvas (drag-orbit's home) never moves under the cursor.
  const onStageMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    el.style.setProperty("--hc-px", px.toFixed(3));
    el.style.setProperty("--hc-py", py.toFixed(3));
  };
  const onStageLeave = () => {
    const el = panelRef.current;
    if (!el) return;
    el.style.setProperty("--hc-px", "0");
    el.style.setProperty("--hc-py", "0");
  };

  // ── live probes (existing read-only commands; a failure just omits the value) — HomeHud's
  // 5s poll, ported verbatim ──
  const [gpuTemp, setGpuTemp] = useState<number | null>(null);
  // C-19 — "is my CPU running hot" is a front-door question, so Home MEASURES it instead of
  // asserting it away. This callout used to print a hardcoded "no CPU temp — needs a sensor app"
  // with no probe behind it at all: it said unavailable even while HWiNFO was publishing, which
  // is a fabricated negative and exactly what the honest-measurement law forbids in both
  // directions. `get_cpu_temp` is memoised backend-side (cpu_temp.rs, hit/miss TTLs), so joining
  // this 5s poll costs a shared-memory read on a machine that has a monitor and one WMI probe per
  // 15s on a machine that does not.
  const [cpuTemp, setCpuTemp] = useState<{ temp_c: number; source: string; label: string } | null>(
    null,
  );
  const [mem, setMem] = useState<{ used: number; total: number; level: string } | null>(null);
  // Q7 idle-cost: pause while the window is hidden. Home is the DEFAULT room, so without this the
  // canonical face calls into the vendor GPU SDK every 5s for the whole time the owner is alt-tabbed
  // into a fullscreen game — the exact hidden cost Compy exists to avoid. Values freeze at their last
  // reading and refresh on the first tick after the window comes back.
  const visible = useDocumentVisible();
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const poll = () => {
      invoke<{ temperature_c: number | null }[]>("get_gpu_sensors")
        .then((g) => !cancelled && setGpuTemp(g?.[0]?.temperature_c ?? null))
        .catch(() => !cancelled && setGpuTemp(null));
      invoke<{ used_bytes: number; total_bytes: number; level: string }>("get_memory_pressure")
        .then(
          (m) =>
            !cancelled &&
            setMem(m ? { used: m.used_bytes, total: m.total_bytes, level: m.level } : null),
        )
        .catch(() => !cancelled && setMem(null));
      invoke<{ temp_c: number; source: string; label: string } | null>("get_cpu_temp")
        .then((c) => !cancelled && setCpuTemp(c ?? null))
        .catch(() => !cancelled && setCpuTemp(null));
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [visible]);

  // ── the Home intelligence line (Intelligence Phase 1, decision 7: Home carries at most ONE
  // concise line). A single read-only fetch, only while the flag is on; the engine returns a
  // headline ONLY when it reached a real improved/regressed verdict — null (or a failed fetch)
  // renders nothing, never a fabricated line. Re-fetched when the session list changes. ──
  const intelOn = useIntelligenceFlag();
  const [intelHeadline, setIntelHeadline] = useState<IntelligenceHeadline | null>(null);
  useEffect(() => {
    if (!intelOn) {
      setIntelHeadline(null);
      return;
    }
    let alive = true;
    invoke<IntelligenceHeadline | null>("get_intelligence_headline")
      .then((h) => alive && setIntelHeadline(h ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [intelOn, sessions]);

  // ── rig view state (same persisted pref as HomeHud/HomeV2 — Cards vs 3D) ──
  const [rig3d, setRig3d] = useState(() => {
    try {
      return localStorage.getItem("compy_home_rig_3d") !== "0";
    } catch {
      return true;
    }
  });
  const chooseRig3d = (v: boolean) => {
    setRig3d(v);
    try {
      localStorage.setItem("compy_home_rig_3d", v ? "1" : "0");
    } catch {
      /* session-only choice */
    }
  };
  const [exploded, setExploded] = useState(false);
  // Orbit is an explicit opt-in under hologram v2 (bay rests on frameloop "demand", idle GPU ~0);
  // classic (flag off) keeps its always-orbiting default — same contract as HomeHud's bay.
  const [autoRotate, setAutoRotate] = useState(() => !readHologramV2());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Stable handler: an inline arrow here breaks RigHologram's memo, letting every 5s live-poll
  // re-render re-commit mesh handlers and repaint the resting bay (the T1.5 idle-repaint class).
  const onRigSelect = useCallback((id: string) => setSelectedId(id || null), []);
  const { parts: manualParts } = useManualParts();

  // ── measured derivations (all real, all honestly empty when absent — HomeHud's exact logic) ──
  // The Machine Model's in-effect answer (#452) — see HomeHud for why never the bare ledger list.
  const inEffect = inEffectCounts(model);
  const posture = postureLine(readiness, priorities, inEffect, t);
  // This is the Home a default-flag user actually lands on (compy_home_console DEFAULT ON), so it
  // is where the ledger-completeness disclosure matters most. postureLine already declines to print
  // a count it doesn't have — at zero changes the change-note is omitted rather than rendered as
  // "0" — so this surface was silent, not lying. Silence is still the wrong answer when the reason
  // for the silence is that Compy cannot read its own record: the verdict below reassures, and an
  // unexplained reassurance over an unreadable ledger reads as "nothing happened". The notice says
  // which of the two it is. Self-nulling when health is complete or UNKNOWN, so the healthy
  // cold-open stays byte-identical.
  const ledgerHealth = useLedgerHealth(changes);
  const strip = liveStrip(sessions, t);
  const rig = { refreshHz: hw.display?.current_refresh_rate_hz ?? null };
  const avgFps = strip.kind === "data" ? strip.avgFps : null;
  const lowFps = strip.kind === "data" ? strip.low1Est : null;
  const fpsGrade: Grade = strip.kind === "data" ? gradeFps(strip.avgFps, rig) : "neutral";
  const low1Grade: Grade =
    strip.kind === "data" ? gradeLow1(strip.low1Est, strip.avgFps) : "neutral";
  const checking = readiness == null; // checks literally still running
  const vendor = gpuVendor(hw.gpus?.[0]?.name);
  const gpuGrade = gradeGpuTempForVendor(vendor, gpuTemp);
  // No vendor gate here: unlike the GPU (LOCKED rule 5 — NVIDIA's sensor path is implemented but
  // not hardware-verified), this number never comes from a Compy sensor path at all. It is
  // whatever monitor the USER installed is publishing, so its trustworthiness does not vary by
  // which CPU is in the socket — only the ramp is generic, and gradeCpuTempC says so.
  const cpuTempGrade = gradeCpuTempC(cpuTemp?.temp_c ?? null);

  // Readiness reuses the same ready/total ratio the Command Center's signal ring derives (no
  // invented 0–100 "score") — LabConsole's exact derivation; null while checks are running.
  const readinessKnown = !!readiness && readiness.checks.length > 0;
  const readinessScore = readinessKnown
    ? Math.round(
        (100 *
          Math.max(0, readiness!.checks.length - readiness!.attention_count - readiness!.unknown_count)) /
          readiness!.checks.length,
      )
    : null;
  const checksGood = readinessKnown
    ? Math.max(
        0,
        readiness!.checks.length - readiness!.attention_count - readiness!.unknown_count,
      )
    : 0;
  /**
   * THE READINESS BAND — the one word 01-health-approved.png prints beside the ring.
   *
   * These thresholds are stated HERE, next to the number they band, because a grade is an
   * interpretation of a measurement and an undocumented interpretation is indistinguishable
   * from an invented one. Nothing is measured here that was not already measured: the score
   * is the share of readiness checks that passed, so the band is arithmetic on a real ratio,
   * never a claim about the machine beyond it. Null score (checks still running, or none at
   * all) yields NO grade — the gauge falls back to its honest not-yet state.
   *
   *   >= 90  GOOD        at 16 checks that is at most one imperfect check
   *   >= 70  FAIR        a handful want a look; the room still works
   *    < 70  NEEDS WORK  a third or more are failing or unreadable
   */
  const readinessGrade =
    readinessScore == null
      ? null
      : readinessScore >= 90
        ? { word: t("home.homeConsole.stage.readinessGrade.good"), tone: "good" as const }
        : readinessScore >= 70
          ? { word: t("home.homeConsole.stage.readinessGrade.fair"), tone: "warn" as const }
          : { word: t("home.homeConsole.stage.readinessGrade.poor"), tone: "bad" as const };

  // The dek: postureLine's sentence often opens by restating its own headline. Under the
  // display verdict that reads as a stutter, so the dek drops the restated prefix and keeps
  // only the part that ADDS information; a fully-redundant sentence is omitted (the readout
  // strip still carries provenance). Text is still postureLine's real output — trimmed,
  // never rewritten.
  // i18n note: Unicode-aware (\p{L}\p{N}, not a-z0-9) so this comparison still works once
  // posture.headline/sentence are Chinese — the old ASCII-only class stripped CJK text down to
  // "", which made every zh-CN dek compare as spuriously redundant (identical for English).
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").trim();
  const headNorm = norm(posture.headline).replace(/^youre /, "");
  const sentNorm = norm(posture.sentence).replace(/^youre /, "");
  const dek = sentNorm.startsWith(headNorm)
    ? posture.sentence
        .slice(posture.sentence.toLowerCase().indexOf("—") >= 0 ? posture.sentence.indexOf("—") + 1 : 0)
        .trim()
    : posture.sentence;
  const dekRedundant =
    sentNorm === headNorm ||
    dek === "" ||
    norm(dek) === headNorm ||
    // Clean state: the verdict is the ONE owner of "measured clean" on this screen
    // (the P5 one-owner-per-screen voice law) — the dek stands down rather than echo it.
    ((priorities?.limiters ?? []).length === 0 && priorities != null && /measured clean/i.test(dek));

  // The status LED next to the eyebrow — real state only: scanning while checks run, warn
  // when measured checks flagged attention, ok otherwise.
  const ledState = checking ? "scan" : (readiness?.attention_count ?? 0) > 0 ? "warn" : "ok";

  // The masthead dateline — the date this diagnostic is being read (today), never fabricated.
  const dateline = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // THE DETECTED RECORD, grouped (owner 2026-08-06: "better grouping and boxed templates").
  // Same HardwareInfo the Cards view renders — zero new probes, zero new claims. A record the
  // machine did not report drops its whole box rather than showing an empty frame or a
  // fabricated placeholder; all four empty drops the block, so a rig that reports no SMBIOS
  // module/disk detail is not handed four hollow boxes.
  const specs: { title: string; rows: [string, string][] }[] = [
    { title: t("home.homeConsole.specs.gpu"), rows: denseGpu(hw.gpus?.[0], t) },
    { title: t("home.homeConsole.specs.cpu"), rows: denseCpu(hw, t) },
    { title: t("home.homeConsole.specs.ram"), rows: denseRam(hw.memory_modules ?? [], t) },
    { title: t("home.homeConsole.specs.storage"), rows: denseStorage(hw.physical_disks ?? []) },
  ].filter((s) => s.rows.length > 0);

  const sysDisk = hw.disks?.find((d) => d.mount_point?.toUpperCase().startsWith("C"));
  const diskPct =
    sysDisk && sysDisk.total_bytes > 0
      ? Math.round(((sysDisk.total_bytes - sysDisk.available_bytes) / sysDisk.total_bytes) * 100)
      : null;

  // ── the Dock into the rooms — doors, not panels (Task 3). Nodes come from the rail App
  // actually shows (honest doors: a room off the rail gets no door); the guided-action room
  // glows primary — the "fix" room when the rail has one, else the Lab (the proving-ground
  // rail's one door to the toggles). Home never marks a room active (activeKey stays null —
  // these are exits, not an open panel).
  const primaryKey = rooms?.some((r) => r.key === "fix") ? "fix" : "lab";
  const dockNodes: DockNode[] = (rooms ?? []).map((r) => ({
    key: r.key,
    name: r.name,
    primary: r.key === primaryKey,
  }));

  // The #1 measured limiter — a context row beside the dock: measured fact + its fix route.
  // Clean or still-loading renders NOTHING (the verdict owns "measured clean" — one-owner law).
  // One-owner-per-screen (P5 voice law): in the attention state the verdict headline now NAMES
  // the top flagged item; if the #1 limiter is that same item its identical title would stack a
  // few hundred px below the verdict, so the limiter row stands down and lets the verdict own it
  // (the fix route then lives in the primary action + the Dock). Mirrors the dek/ForwardDoor
  // standdowns. CORRECTED 2026-08-26: this line used to say the route "still lives in the verdict
  // dek", which stopped being true the day #180 §C stood the dek DOWN in exactly the attention
  // state this standdown fires in. A stand-down justified by a sibling that no longer renders is
  // how a screen quietly loses its last route, so `home-console.test.tsx` now pins this sentence.
  //
  // The `... and ` arm anchored the RETIRED several-flagged headline
  // ("<label> · and N more", dropped by owner ruling 2026-08-26 / #219). It is kept because a
  // catalog label may legitimately contain " and ", and because a ledger written before the
  // ruling can still carry the old phrasing; it can never match the live derivation again.
  const rawTopLimiter = priorities?.limiters?.[0] ?? null;
  const headNormFull = norm(posture.headline);
  const limNorm = rawTopLimiter ? norm(rawTopLimiter.title) : "";
  const verdictNamesLimiter =
    rawTopLimiter != null && (headNormFull === limNorm || headNormFull.startsWith(`${limNorm} and `));
  const topLimiter = verdictNamesLimiter ? null : rawTopLimiter;

  // The Dock IS this room's doors — when it renders, RoomShell's own ForwardDoor would be a
  // second "go to Lab" affordance stacked right under it (self-reviewer catch 2026-07-10,
  // rubric 3; guard-pinned in home-console.test.tsx). No dock (isolated mounts) → the plain
  // door stays, so Home always has exactly ONE forward affordance.
  const dockRenders = dockNodes.length > 0 && !!onNavigate;

  // ── THE INTAKE BAND (BACKLOG:916 — the pre-room intent router + one-tap fast path, behind
  // compy_home_intake). The fast path is available ONLY when fully wired (the catalog resolved
  // to undefined means "no wiring", not "loading") so an isolated mount never shows a stuck
  // "Checking…"; recs===null IS the loading state. Its apply-set is safeFixesReadyList — the
  // SAME predicate the Optimize verdict counts, so the count and the applied ids can't diverge.
  // UX-1: no longer gated on `intakeOn` — the panel's visibility is now the front door's business,
  // and availability is purely "is this wired up", which is what this flag always actually meant.
  const fastPathAvailable = !!onApplyBatch && !!isAppliable && recs !== undefined;
  const revertedIds = new Set(deriveReverted(changes).map((r) => r.rec_id));
  const eligibleStack =
    recs && isAppliable ? safeFixesReadyList(recs, isAppliable, revertedIds) : [];
  const stackReady = eligibleStack.length;
  // THE INTERVIEW'S DOOR (step 3, issue #177). Availability is one question and one only: is there
  // anywhere for a finding to land? The answer is always yes - every branch of
  // home-interview-data.ts falls back onto "run a fresh check", which needs no room, no rail and no
  // wiring. So the ONLY gate is the owner's switch, exactly as 8db70795 required of the band it
  // replaces: this expression leads with the flag and adds nothing to it, so "off" cannot be
  // narrowed later into "off, but the door still renders". That narrowing is the defect 8db70795
  // was written to fix, and the flag DEFAULTS OFF (theme.ts) because off is the owner's last
  // recorded answer - see docs/decisions/2026-08-20-home-interview-default.md for the open fork.
  const interviewAvailable = interviewOn;
  // WHAT HAS BEEN HAPPENING (issue #49) — the rows under the verdict are shortcuts INTO the
  // interview the primary button opens, never a second intake. The heading and every label are read
  // straight out of `interviewQuestions(t)`, so this renders the interview's own wording verbatim
  // and cannot drift from it: not one user-facing string is authored here. Three of the root's five
  // answers are surfaced — the two people actually arrive with, plus the one for the person who
  // cannot name it — and all five stay one click away behind the button, so nothing is removed. Any
  // id that stopped existing simply drops out rather than rendering a row that leads nowhere.
  const interviewRoot = interviewQuestions(t)[INTERVIEW_ROOT];
  // THE DETECTION GATE (owner direction 2026-08-26 — see DETECTED_SHORTCUTS above). Two sources,
  // and both are things Compy MEASURED rather than inferred: a readiness check that flagged, or an
  // incident the observer actually read out of Windows. Anything softer than that would be Compy
  // implying a problem it has not found, which is the exact failure this gate exists to prevent.
  const somethingDetected = posture.tone === "attention" || pendingCare != null;
  const quickSymptoms = (somethingDetected ? DETECTED_SHORTCUTS : CLEAR_SHORTCUTS)
    .map((id) => interviewRoot.choices.find((c) => c.id === id))
    .filter((c): c is (typeof interviewRoot.choices)[number] => c != null);
  // The Care entry (issue #91, discovery contract): ALWAYS visible, independent of the interview
  // flag - crash rescue is the one thing a user comes to Home in distress to find, and it must not
  // sit behind the same switch as anything else. The single condition it does obey is the
  // no-dead-end law every other affordance here obeys: if the rail does not render the room the
  // station lives in, there is nowhere to send the click.
  const care = homeCareEntry(t);
  const careRenders = !!rooms?.some((rm) => rm.key === care.room);
  // The live readings the interview is allowed to speak from. Every field is something this room
  // ALREADY holds and already renders somewhere else on screen - the interview opens no probe and
  // quotes nothing it was not handed. Its one read-only IPC is the Trial count above (P7-route).
  const interviewRooms = (["play", "learn", "lab"] as const).filter((k) =>
    rooms?.some((rm) => rm.key === k),
  );
  const interviewFacts: InterviewFacts = {
    recsLoaded: recs != null,
    safeStackReady: stackReady,
    fastPathWired: fastPathAvailable,
    // Not counted (pending or unreadable) is null, so the interview cannot quote it as a 0.
    activeChanges: inEffect.kind === "counted" ? inEffect.activeNow : null,
    sessionCount: sessions.length,
    // An unmeasured FPS reaches the interview as null (#671): it quotes the FPS only when both were
    // measured, and still quotes the session's peak temperature either way.
    lastSession:
      strip.kind === "data"
        ? { game: strip.game, avgFps: strip.avgFps, low1: strip.low1Est, peakTempC: strip.peakTempC }
        : null,
    readiness: readinessKnown
      ? {
          passed: Math.max(
            0,
            readiness!.checks.length - readiness!.attention_count - readiness!.unknown_count,
          ),
          total: readiness!.checks.length,
          attention: readiness!.attention_count,
        }
      : null,
    gpuTempC: gpuTemp,
    rooms: [...interviewRooms],
    trials: interviewTrials,
  };

  // Option C's apply — mirrors FirstCheck's honest inline-apply idiom: confirm names the rollback
  // guarantee, then the ONE audited batch primitive applies only the safe stack. On success the
  // ledger event makes App re-scan → recs refresh → the row recomputes to all-clear naturally;
  // the receipt line reports the REAL applied/skipped counts in the meantime.
  const runFastPath = async () => {
    if (!confirm || !onApplyBatch || fastPathBusy || stackReady === 0) return;
    const ok = await confirm({
      title: fastPathReadyHeadline(stackReady, t),
      body: t("home.homeConsole.intake.fastpath.confirmBody"),
      confirmLabel: fastPathApplyLabel(stackReady, t),
    });
    if (!ok) return;
    setFastPathBusy(true);
    try {
      const res = await onApplyBatch(eligibleStack.map((r) => r.id));
      setFastPathReceipt({
        applied: res.applied,
        skipped: res.skipped.length,
        skippedItems: res.skipped,
      });
    } finally {
      setFastPathBusy(false);
    }
  };

  return (
    <RoomShell
      room="home"
      doorOpen={!dockRenders}
      /* UX-1: the caveat that qualifies the verdict now outranks it in the shell, because the
         verdict itself moved into the h1. Self-nulls when the ledger is healthy. */
      notice={<LedgerHealthNotice health={ledgerHealth} />}
      /* Its own slot, not a passenger in `verdict` (#211) — inside it the eyebrow rendered inside
         the <h1>, welding the room's stable name to a headline that changes with every scan. */
      eyebrow={
        <RoomEyebrow dot={ledState} label={t("home.homeConsole.masthead.eyebrow")} dateline={dateline} />
      }
      verdict={
        <>
          {/* UX-1 — THE FRONT DOOR IS A VERDICT (docs/decisions/2026-08-11-design-foundation.md,
              decision 1). This REPLACES the owner title-header law of 2026-07-10 for Home only,
              and the replacement is the whole point of the step: the audit measured that the one
              element on this screen bigger than 19px was the word "Home" — a label nobody came
              here to read — while the answer they did come for rendered a third smaller, in the
              body. The room title is redundant with the rail that navigated here; the verdict is
              not redundant with anything. So the h1 now speaks postureLine's real headline at
              --type-verdict (40px), and "Home" is gone rather than demoted, because a second
              copy of a label the rail already shows is exactly the noise TYPE-1 cleared.
              Still rendered exactly ONCE on the screen (one-mention law) — the body copy is
              deleted in the same change, not duplicated up here. */}
          {/* #213 B3 — the hero step is right for the comp's headline and wrong for this app's
              own attention labels. `--type-hero` is comp-derived and stays; what varies is which
              step a LONG headline gets. Measured on the installed build in the 452px narrative
              column: at 52px a 34-character label ("Compy changes were turned back off", the
              state his machine is in) draws THREE lines where the approved comp draws two, and
              the worst multi-flag headline draws four. Past the measured break the headline steps
              down one to --type-verdict, which buys the second line back up to 43 characters.
              The table and the residual are in src/design/headline-fit.ts. */}
          <span
            className={`hc-headline hc-verdict-line hc-verdict-${posture.tone}`}
            data-fit={headlineFit(posture.headline)}
            key={posture.headline}
          >
            {posture.headline}
          </span>
        </>
      }
      /* The because-line. It qualifies the verdict, so it sits directly beneath it in the
         header rather than starting the body — progressive disclosure reads top-down.
         ATTENTION DOES NOT PRINT THE DEK (owner pick 2026-08-20, issue #180 §C, still in
         force): in that state the sentence is the flagged CHECK's full detail paragraph —
         check-row copy, not a dek — and printing it under the verdict re-creates the
         title-header defect the owner caught twice.

         IT DOES PRINT A COUNT (owner ruling 2026-08-23). 01-health-approved.png draws
         "15 of 16 checks look good." under exactly this headline, and §C barred the
         PARAGRAPH, not a line. The two readings of the picture are compatible and the
         count is the better half of both: it is the one fact that stops "one thing needs
         your attention" reading as "your PC is broken" — the proportion. Same numbers the
         readiness ring is derived from, so nothing new is measured or claimed, and it
         self-nulls the moment the checks are not known. */
      sub={
        posture.tone === "attention" ? (
          readinessKnown ? (
            <span className="hc-verdict-dek">
              {t("home.homeConsole.verdict.attentionSub", {
                count: checksGood,
                total: readiness!.checks.length,
              })}{" "}
              {/* THE NEXT STEP, one line (owner ruling 2026-08-26). The DIR-1 first-timer walk
                  found that in this state Home names a problem and shows no way to deal with it:
                  the check's own "why + what to do" is computed into `posture.sub` and then
                  dropped, because #180 §C bars the PARAGRAPH here. Asked directly, the owner chose
                  a short route line over both the paragraph and the status quo.

                  It is a route, not advice, and that is what makes it safe to print: it fires the
                  SAME `onSeeInFix` the Re-run band's own button fires further down this page, and
                  it names that button's room from the same `fixRoomLabel` prop. So the sentence
                  cannot claim a destination the app does not have, and it cannot drift from the
                  destination it names. The full explanation stays where §C put it.

                  Deliberately a quiet inline link, not a second filled button: UX-1 decision 1
                  gives this screen ONE primary, and a second one would mean none. */}
              <button type="button" className="hc-verdict-next" onClick={onSeeInFix}>
                {t("home.homeConsole.verdict.attentionNext", { room: fixRoomLabel })}
              </button>
            </span>
          ) : undefined
        ) : dekRedundant ? undefined : (
          <span className="hc-verdict-dek">{dek}</span>
        )
      }
      /* UX-1 decision 1 + step 3 - ONE ACTION, and now it leads somewhere. "What are you here to
         do?" was the strongest idea in the product and was spending it inside a 9px band the owner
         switched off on sight (2026-08-12). UX-1 promoted it to the single filled primary button;
         this step gives that button its destination, so it stops toggling a panel in place and
         opens the interview instead. Every other control on Home - the re-run outline button, the
         care entry, the dock doors, the view toggles - is quieter than this one by construction, so
         the Duolingo rule (more than one primary = none) holds without deleting anything. */
      primaryAction={
        interviewAvailable ? (
          <button
            type="button"
            className="hc-front-door v2-primary"
            aria-haspopup="dialog"
            aria-expanded={interviewOpen}
            onClick={(e) => {
              setInterviewOrigin(e.currentTarget.getBoundingClientRect());
              setInterviewPath(INTERVIEW_START);
              setInterviewOpen(true);
            }}
          >
            {somethingDetected ? t("home.interview.ui.door") : t("home.interview.ui.doorClear")}
          </button>
        ) : undefined
      }
      /* NO `measured` SLOT ON HEALTH (owner ruling 2026-08-23). The re-run band used to sit
         here, directly under the verdict, and 01-health-approved.png draws nothing in that
         position — the narrative column goes verdict → count → one button → the symptom cards.
         The band is NOT deleted, it moved (see `below`), because it is the only entry point
         to <FirstCheck> and it carries the check→fix hallway. Its provenance (a date, a
         state dot) is already above it in the eyebrow, which is why the comp can leave the
         slot empty without losing a fact: the band was saying the dateline twice. */
      /* THE EVIDENCE COLUMN (approved four-room direction, issue #49). Every approved comp is the
         same composition — a narrative column beside a column of evidence — and on Health the
         evidence is the rig. One panel holds it: the real hologram, then its view controls, then
         the readout strip. The four ArcGauges used to float at the CANVAS corners and the controls
         used to sit on the glass; the approved direction says plainly that neither may cover rig
         content, so both came off it. Nothing was dropped — every gauge is in the strip, every
         knob is in the control row, and the parts popout is a button in that same row. */
      aside={
        <div className="home-console" data-motion={reduced ? "reduced" : "full"}>
          <section
            className="hc-panel"
            ref={panelRef}
            onPointerMove={onStageMove}
            onPointerLeave={onStageLeave}
            aria-label={t("home.homeConsole.bento.rig")}
          >
            {/* The pointer glow and the annotation parallax are written on the PANEL now, not the
                canvas: the chrome (and so the border-masked glow) belongs to the whole instrument.
                `stageRef` stays on the canvas, because the reticle is the rig's, not the strip's. */}
            {/* The four HUD corner brackets are GONE (#225). The approved Health comp draws the
                stage as one uninterrupted surface — no bracket, no tick, nothing in the corners —
                and four 22px accent elbows are exactly the "added visual language" the rejection
                named. They were decorative (aria-hidden, pointer-events:none), so nothing real
                left with them. Their CSS went too rather than being hidden: a hidden rule is a
                rule every session still parses. Guard: home-console-parity-225.test.tsx. */}
            <div className="hc-stage" ref={stageRef}>
              <div className="hc-rig">
                {rig3d ? (
                  <Suspense
                    fallback={<div className="hc-stage-loading">{t("home.homeConsole.stage.loading3d")}</div>}
                  >
                    <RigHologram
                      hw={hw}
                      exploded={exploded}
                      autoRotate={autoRotate}
                      selectedId={selectedId}
                      hoveredId={hoveredId}
                      onSelect={onRigSelect}
                      onHover={setHoveredId}
                      manualParts={manualParts}
                      cameraDist={HEALTH_CAMERA_DIST}
                      cameraTargetY={HEALTH_CAMERA_TARGET_Y}
                    />
                  </Suspense>
                ) : (
                  <div className="hc-stage-cards">
                    <HardwareGrid hw={hw} model={model} />
                  </div>
                )}
              </div>
              {rig3d && (
                <>
                  {/* Instrument annotations — the parallax plane (Task 4). The whole plane is
                      pointer-events:none so drag-orbit under it never fights: nothing here is
                      interactive any more, which is the point. These are the hologram's LABELS —
                      "Memory · 14.2 / 29.4 GB" is the plain-English "here is your PC" moment a
                      non-technical user opened Home for — and they carry LIVE state only.

                      The detected RECORD each label used to hide behind a hover/click expander
                      (module timings, disk models, driver builds) now lives in the boxed .hc-specs
                      templates below the stage. One owner per fact: GPU temp is the BR gauge, the
                      GPU's model is its label, and its driver build is its box. */}
                  <div className="hc-ann hc-ann-left">
                    <Callout
                      tone={mem ? gradeTone(mem.level === "ok" ? "good" : "bad") : null}
                      name={t("home.homeConsole.callout.ram")}
                      detail={ramSpeedNote(hw.memory_modules, t)}
                      value={
                        mem
                          ? `${fmtGB1(mem.used)} / ${fmtGB1(mem.total)} GB`
                          : `${fmtGB1(hw.ram_total_bytes)} GB`
                      }
                      valueTone={mem && mem.level !== "ok" ? "warn" : mem ? "ok" : null}
                    />
                    {diskPct != null && (
                      <Callout
                        tone={diskPct >= 90 ? "warn" : "ok"}
                        name={t("home.homeConsole.callout.storage")}
                        value={t("home.homeConsole.stage.diskFull", { pct: diskPct })}
                        valueTone={diskPct >= 90 ? "warn" : "ok"}
                      />
                    )}
                  </div>
                  <div className="hc-ann hc-ann-right">
                    <Callout
                      tone={null}
                      name={t("home.homeConsole.callout.gpu")}
                      detail={shortModel(hw.gpus[0]?.name)}
                    />
                    {/* C-19 — the CPU callout answers "is it running hot", or hands over the ONE
                        next step that would let it. Measured ⇒ the number, graded and attributed to
                        the monitor it came from. Unmeasured ⇒ still honestly unknown (never a
                        fabricated 0), but no longer a DEAD END: it opens the CpuTempOffer, which was
                        built for exactly this and had become unreachable — its only mount was inside
                        CpuMonitorPanel, which hangs off Play's `deepMonitoring` slot, and that slot
                        only renders when `showLive` is true while Play itself only mounts at
                        advanced+Sessions (MonitorV2.tsx), where `showLive` is false. */}
                    {/* ONE OWNER PER FACT (issue #49). The CPU TEMPERATURE moved down to the
                        readout strip, where it stands beside the other four readings and carries its
                        own measured / not-yet state and its own "see below" line verbatim. Printing
                        it here as well would be the same number twice on one screen. The plane keeps
                        what only it can say: which CPU this is. Nothing was lost — the fact, its
                        grade, its honest empty case and its route to the CpuTempOffer all travelled
                        together. */}
                    <Callout
                      tone={null}
                      name={t("home.homeConsole.callout.cpu")}
                      detail={hw.cpu_arch?.family_label || undefined}
                    />
                  </div>
                </>
              )}
              {/* The game-HUD Target Cursor, canvas-scoped (kit handles reduced/coarse-pointer
                  null + the rAF pointerleave stop — Phase-1's review fix). */}
              <ReticleCursor scopeRef={stageRef} />
            </div>
            {/* Quiet view controls, off the glass now (issue #49) — the same persisted choices
                HomeHud offers, in the same order: 2D/3D, then explode/orbit whenever the 3D rig is
                up. Orbit still DEFAULTS off (T4d contract — the resting bay costs ~0 GPU); showing
                the knob is not the same as spinning the rig. */}
            <div className="hc-controls">
              <div className="hc-seg-group" role="tablist" aria-label={t("home.homeConsole.stage.rigViewAria")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rig3d}
                  className={`hc-seg ${rig3d ? "hc-seg-on" : ""}`}
                  onClick={() => chooseRig3d(true)}
                >
                  {t("home.homeConsole.stage.view3d")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!rig3d}
                  className={`hc-seg ${!rig3d ? "hc-seg-on" : ""}`}
                  onClick={() => chooseRig3d(false)}
                >
                  {t("home.homeConsole.stage.viewCards")}
                </button>
              </div>
              {rig3d && (
                <div className="hc-seg-group">
                  <button
                    type="button"
                    className={`hc-seg ${exploded ? "hc-seg-on" : ""}`}
                    onClick={() => setExploded((v) => !v)}
                  >
                    {exploded
                      ? t("home.homeConsole.stage.reassemble")
                      : t("home.homeConsole.stage.exploded")}
                  </button>
                  <button
                    type="button"
                    className={`hc-seg ${autoRotate ? "hc-seg-on" : ""}`}
                    onClick={() => setAutoRotate((v) => !v)}
                    aria-pressed={autoRotate}
                  >
                    {t("home.homeConsole.stage.orbit")}
                  </button>
                </div>
              )}
            {/* The full detected parts list. It was the hero tile's `badge`; the hero tile is
                gone (the rig is the evidence column now), so its one control lands in the row that
                already holds the rig's other knobs. Same sheet, same 3D-only rule — cards mode
                already prints this grid on the stage, so there the popout would be a second copy of
                what is on screen. `closest(".v2-tile")` still resolves the origin rect when a tile
                is an ancestor and falls back to the button itself here, which is what the grow-out
                animation needs. */}
            {rig3d && (
              <button
                type="button"
                className="hc-btn hc-btn-ghost"
                onClick={(e) =>
                  partsSheet.opener("parts")(
                    (e.currentTarget.closest(".v2-tile") ?? e.currentTarget).getBoundingClientRect(),
                  )
                }
              >
                {t("home.homeConsole.bento.parts")}
              </button>
            )}
            </div>
            {/* THE READOUT STRIP — the four gauges that used to sit on the canvas corners, plus
                the CPU temperature that used to be a value on the annotation plane. It is a
                HIERARCHY, not five equal instruments: readiness keeps its ring because a 0–100 out
                of a formula is what a ring is for, and the four raw readings beside it are numbers,
                so they render as numbers. Five rings in a row would be the "twelve equal tiles"
                failure the bento exists to prevent, in miniature. */}
            <div className="hc-readout">
              <div className="hc-read-arc" data-read="readiness">
                {/* The score's whole formula, stated where the number is (consumer-panel Phase 2:
                    a bare 0–100 read as a made-up number). */}
                <ArcGauge
                  label={t("home.homeConsole.stage.readinessLabel")}
                  value={readinessScore}
                  max={100}
                  unit="score"
                  /* The RING stays the accent. Sampled straight out of the comp: its ring is
                     violet and only the word beside it is green, so the colour-coded ladder
                     lives in the GRADE and the ring stays the room's instrument. */
                  tone="accent"
                  grade={readinessGrade?.word}
                  gradeTone={readinessGrade?.tone}
                  note={
                    readinessKnown
                      ? t("home.homeConsole.stage.readinessNote", {
                          passed: checksGood,
                          total: readiness!.checks.length,
                        })
                      : undefined
                  }
                />
              </div>
              <Reading
                id="avgFps"
                label={t("home.homeConsole.stage.avgFps")}
                value={avgFps}
                unit="fps"
                tone={arcTone(fpsGrade)}
              />
              {/* First exposure of "1% low" in the app (the cold-open) — glossed inline via <Term>,
                  plan 2026-07-11 Phase 1 (the no-jargon promise). The gloss is exactly why this
                  reading does NOT need to be gated: a term that carries its own definition is
                  legible to everyone. */}
              <Reading
                id="low1"
                label={<Term id="one-percent-lows">{t("home.homeConsole.stage.onePercentLow")}</Term>}
                value={lowFps}
                unit="fps"
                tone={arcTone(low1Grade)}
              />
              {/* NVIDIA renders neutral tone (LOCKED rule 5 — sensor not hardware-verified). */}
              <Reading
                id="gpuTemp"
                label={t("home.homeConsole.stage.gpuTemp")}
                value={gpuTemp}
                unit="°C"
                tone={arcTone(gpuGrade)}
              />
              {/* C-19, relocated intact — measured ⇒ the graded number; unmeasured ⇒ still honestly
                  unknown (never a fabricated 0) and still NOT a dead end: the same "see below" line
                  points at the CpuTempOffer tile, which is now literally below this strip. */}
              <Reading
                id="cpuTemp"
                label={t("home.homeConsole.stage.cpuTemp")}
                value={cpuTemp ? cpuTemp.temp_c : null}
                unit="°C"
                tone={arcTone(cpuTempGrade)}
                note={t("home.homeConsole.callout.cpuNoTemp")}
              />
            </div>
          </section>
        </div>
      }
      /* EVERYTHING THE ROOM STILL OWES, BENEATH BOTH COLUMNS (issue #49). The approved comp is one
         viewport, and the direction is explicit that hierarchy — not deletion — is what stops the
         room being intimidating. So the detected record, the findings, the last-session verdict,
         the CPU-temp offer, the tour and the Dock all still render, in full, right where a reader
         who wants more arrives. Nothing here is new and nothing here was cut. */
      below={
        <div className="home-console" data-motion={reduced ? "reduced" : "full"}>
        {/* THE LATEST CHANGE LEADS `below` (#225 finding 1). It is the first thing a reader who
            scrolls past the fold meets, because "what did Compy just do to my PC?" outranks "what
            did it check" — and it is BELOW the fold because the approved comp's first viewport is
            the verdict, the one action and the rig. Reachable, subordinate, unmodified. */}
        {latestChange}
        <InEffectLine inEffect={inEffect} t={t} />
        {/* The check line and its Re-run affordance, relocated out of the shell's `measured`
            slot (see the note above it). It leads `below` rather than trailing it: a reader
            who scrolls past the fold is asking "what did you actually check?", and this
            sentence — with its route to the fixes — is the answer to exactly that. */}
        <RerunCheckBand
          readiness={readiness}
          checking={checking}
          onRunCheck={onRunCheck}
          onSeeInFix={onSeeInFix}
          fixRoomLabel={fixRoomLabel}
        />
        <BentoGrid>
        {/* THE DETECTED RECORD — boxed templates, always open (owner 2026-08-06: "better grouping
            and boxed templates"). Static facts only; everything that MOVES is in the evidence
            column, so no number is owned twice. Label/value rows, zero prose. No `open` prop and no
            expander: the owner made the detected record standard and always-open.

            IT IS THIS GRID'S HERO NOW, AND IT RENDERS UNCONDITIONALLY — both halves of that changed
            together. The rig was the hero and has left the grid for the evidence column, so the
            grid needed a new focal tile, and a hero may not be conditional: whether a room has a
            focal point must not depend on runtime state (one-hero-guard). The empty case is
            therefore an honest line inside a tile that always renders, which is what "no
            conditional partial tile" asks for anyway. It also closes its own rows — hero is 7
            columns × 2 rows, and the two 5-column tiles after it fill exactly those two rows. */}
        <BentoTile title={t("home.homeConsole.specs.eyebrow")} span="hero">
          {specs.length > 0 ? (
            <section className="hc-specs" aria-label={t("home.homeConsole.specs.eyebrow")}>
              <div className="hc-specs-grid">
                {specs.map((s) => (
                  <SpecBox key={s.title} title={s.title} rows={s.rows} />
                ))}
              </div>
            </section>
          ) : (
            <p className="hc-none">{t("home.homeConsole.specs.none")}</p>
          )}
        </BentoTile>

        <BentoTile title={t("home.homeConsole.bento.findings")} span="half">
          <>
            {/* THE #1 LIMITER — micro-label · the measured title · quiet confidence tag · jump. */}
            {topLimiter ? (
              <div className="hc-limiter">
                <span className="hc-limiter-label">{t("home.homeConsole.limiter.topLabel")}</span>
                <span className="hc-limiter-title">{topLimiter.title}</span>
                <span className="hc-limiter-tag hc-mono">
                  {t("home.homeConsole.limiter.confidenceTag", { level: topLimiter.confidence })}
                </span>
                <button type="button" className="hc-btn hc-btn-ghost" onClick={onSeeInFix}>
                  {t("home.homeConsole.limiter.seeIn", { room: fixRoomLabel })}
                </button>
              </div>
            ) : (
              <p className="hc-none">
                {priorities
                  ? t("home.homeConsole.limiter.none")
                  : t("home.homeConsole.limiter.pending")}
              </p>
            )}
          </>
        </BentoTile>

        {/* LAST SESSION — Home's ONE intelligence line (Intelligence Phase 1, decision 7): the
            engine's own verdict sentence verbatim; the full report lives in Monitor's debrief. The
            LINE is still rendered only for a real improved/regressed verdict (the command returns
            null otherwise) and the door only shows when Monitor is actually on the rail — the TILE
            around it is what always renders, and it says which of the two null cases it is in
            rather than inventing a verdict.

            The title reuses `limiter.lastSessionLabel` — the exact string that used to be the row's
            micro-label. Promoting it instead of minting a `bento.lastSession` twin keeps the label
            out of the tile twice AND keeps the affordance census honest: that key stays reached, so
            the guard sees a control that moved rather than one that vanished. */}
        <BentoTile title={t("home.homeConsole.limiter.lastSessionLabel")} span="half">
          <div className="hc-lastsession">
            {intelHeadline ? (
              <div className="hc-limiter">
                <span className="hc-limiter-title">{intelHeadline.text}</span>
                {onNavigate && rooms?.some((r) => r.key === "play") && (
                  <button
                    type="button"
                    className="hc-btn hc-btn-ghost"
                    onClick={() => onNavigate("play")}
                  >
                    {t("home.homeConsole.limiter.seeIn", {
                      room: rooms.find((r) => r.key === "play")?.name,
                    })}
                  </button>
                )}
              </div>
            ) : (
              <p className="hc-none">
                {intelOn
                  ? t("home.homeConsole.limiter.lastSessionNone")
                  : t("home.homeConsole.limiter.lastSessionOff")}
              </p>
            )}
          </div>
        </BentoTile>

        {/* THE TOUR, AS AN OFFER (C-05). The tour used to auto-open over a fresh install and BE
            the front door; the diagnosis above is the front door now, and this is the card the
            decision asked for instead ("offer the tour as a card the user can choose",
            docs/decisions/2026-08-11-design-navigation-audit.md §4).
            It is mounted HERE and not only in HomeV2/HomeHud because HomeConsole is the DEFAULT
            Home — without this tile, removing the auto-open would have stranded the whole flow
            behind Settings, which is the half of C-05 that had "already been built" and was not.
            LAST in the grid, quiet, below the answer — the same placement its two sibling Home
            branches already use. Pinned by src/first-run-front-door-guard.test.ts. */}
        {/* C-19 — THE FIX FOR THE ONE FLAG HOME CAN RAISE ABOUT ITSELF, BOXED.
            The CPU callout on the annotation plane names the gap; the name-it-AND-fix-it-inline
            law says a flag with no fix beside it is a dead end. The fix does NOT go on the plane:
            the owner's 2026-08-06 call is that annotation planes carry live state as plain text,
            labels and not controls (home-console-standard-readout-guard.test.tsx), and congestion
            is answered with layout — "better grouping and boxed templates". So it is a box, and it
            is only here while there is nothing to read: once a sensor app publishes, the whole
            tile goes away rather than becoming permanent furniture. */}
        {!cpuTemp && (
          <BentoTile title={t("home.homeConsole.cpuTemp.tileTitle")} span="full">
            <CpuTempOffer />
          </BentoTile>
        )}

        <BentoTile title={t("home.homeConsole.bento.tour")} span="full">
          <SetupLauncherCard />
        </BentoTile>
        </BentoGrid>

        {/* THE DOCK — navigate into the rooms the rail actually shows. Deliberately OUTSIDE the
            grid: the dock is the room's exit row, not one of its answers, and a door tile sitting
            among the measured tiles is exactly the "twelve equal cards" failure the bento avoids. */}
        {dockNodes.length > 0 && onNavigate && (
          <Dock nodes={dockNodes} activeKey={null} onOpen={onNavigate} />
        )}
        </div>
      }
    >
      <div className="home-console" data-motion={reduced ? "reduced" : "full"}>
        {/* UX-1: the cold-open verdict and its because-line no longer start the body — they ARE
            the header now (RoomShell verdict/sub above), and the ledger caveat that qualifies
            them moved to the shell's notice slot so it still prints ABOVE its subject. What
            starts the body instead is what the one primary button opens.

            WHAT HAS BEEN HAPPENING (issue #49) — shortcuts INTO that same interview, never a second
            copy of it. The primary button above still opens it at its first question with all five
            answers; these rows jump straight past that question for the two things people actually
            arrive with (it crashed / it feels slow) and the answer for the person who cannot name
            it. Every label is the interview's own wording, read from its own data — no mockup copy
            became product copy here — and nothing is removed, because the full set stays one click
            away behind the button. */}
        {interviewAvailable && quickSymptoms.length > 0 && (
          <section className="hc-happening" aria-label={t("home.homeConsole.happening.eyebrow")}>
            {/* NOT the interview's root question, deliberately. The owner deleted a permanent panel
                on Home that asked "What are you here to do?" on sight, and the guard that keeps it
                deleted also pins that the interview's own question does not print on Home until the
                user asks for it (home-interview.test.tsx). The approved comp does not print it
                either — it frames these as what has been HAPPENING, which is the user's own words
                about their PC rather than a demand for a decision, and the ANSWERS below are still
                the interview's verbatim. */}
            {/* The heading follows the gate too. "What's been happening?" is the right question
                to ask someone whose PC just flagged something and the wrong one to ask someone
                whose PC is fine — it presumes an event. With nothing detected the section asks
                what they want to DO, which is the only honest framing left once Compy has
                measured nothing wrong. */}
            {/* Both keys are written as WHOLE literals inside t(), with the branch outside it.
                `t(cond ? "a" : "b")` reads fine and is invisible to the affordance census, which
                walks source for `t("…")` — a control whose key stops being a literal looks exactly
                like a control that was deleted. */}
            <h2 className="hc-happening-q">
              {somethingDetected
                ? t("home.homeConsole.happening.eyebrow")
                : t("home.homeConsole.happening.eyebrowClear")}
            </h2>
            <p className="hc-happening-hint">
              {somethingDetected
                ? t("home.homeConsole.happening.hint")
                : t("home.homeConsole.happening.hintClear")}
            </p>
            <ul className="hc-happening-rows">
              {quickSymptoms.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="hc-happening-row"
                    aria-haspopup="dialog"
                    aria-expanded={interviewOpen}
                    onClick={(e) => {
                      setInterviewOrigin(e.currentTarget.getBoundingClientRect());
                      setInterviewPath([{ kind: "question", id: INTERVIEW_ROOT }, c.next]);
                      setInterviewOpen(true);
                    }}
                  >
                    {/* Icon · title · one grey line · chevron — 01-health-approved.png's card
                        exactly. The glyph is chosen by ANSWER ID, so a choice that stops
                        existing takes its picture with it; the fallback is the not-sure mark
                        rather than a blank, because an unlabelled card is worse than a
                        generic one. Both strings are still the interview's own words. */}
                    <span className="hc-happening-ico" aria-hidden="true">
                      {/* 40, not 28 (#225 round 2). Round 1 read the comp's glyph at ~28 and set
                          the BOX to 28 -- but this Icon's path does not fill its box: at size 28 it
                          inks 21x22 app px, so the comp's glyph was drawn a third smaller than the
                          picture. The number is now measured against the DRAWN mark on both sides.
                          Comp (assets/approved/health.png, comp px / 1.0333): ink 34x33 comp px =
                          32.9x31.9 app. Candidate, measured over CDP on the installed build by
                          overriding the svg box and re-scanning the capture: 36 -> 26x30,
                          40 -> 30x32, 42 -> 32x34. 40 lands the HEIGHT on the comp's 31.9 exactly
                          and stays under it on width; the glyphs are not the same art (the comp's
                          star has ten points and a filled centre, this one has eight and none), so
                          the two axes cannot both land. Row height is unmoved at 76.8 -- the two
                          text lines drive it and 40 + 28px of padding is 68. */}
                      <Icon name={HAPPENING_GLYPH[c.id] ?? "help"} size={40} />
                    </span>
                    <span className="hc-happening-text">
                      <span className="hc-happening-label">{c.label}</span>
                      {c.hint && <span className="hc-happening-sub">{c.hint}</span>}
                    </span>
                    <span className="hc-happening-go" aria-hidden="true">
                      &rsaquo;
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* THE CARE ENTRY (issue #91 Tier 1, visible half) — one compact door to crash rescue,
            rendered OUTSIDE the intake band's gate on purpose. A user whose PC just crashed is the
            least likely person to go turn a Settings band back on to find help, and the tester who
            walked to Event Viewer (SESSION_HANDOFF §4) is the evidence for what happens when this
            sign is not in front of them. It lands ON the evidence station, never the Lab dock.
            P6-door (ROADMAP Phase 6): this is Home's ONE Care door, "Something's wrong". The
            observer's card above and the interview's crash and stutter answers land on the same
            view it opens; there is no second door and no separate stutter room. */}
        {/* THE CARE OBSERVER'S CARD (Tier 1 task 9, #222) — the one thing on Home the user did not
            come looking for. It appears only when the observer has seen a NEW hard incident
            (`incident_observer.rs`), it is the authority rather than the toast (notifications off
            suppresses the nudge, never this), and it states what Windows recorded and nothing more:
            no cause, no confidence, no advice. Two exits, both honest — go read the evidence, or
            say "I know", which clears Compy's pointer and leaves every Windows record intact. */}
        {pendingCare && (
          <section className="hc-notice" aria-label={t("home.homeConsole.care.notice.aria")}>
            <span className="hc-notice-ico" aria-hidden="true">
              <Icon name="burst" size={20} />
            </span>
            <div className="hc-notice-text">
              <p className="hc-notice-head">{pendingCare.summary}</p>
              <p className="hc-notice-meta">
                {pendingCare.app_label
                  ? t("home.homeConsole.care.notice.metaApp", {
                      kind: pendingCare.kind,
                      app: pendingCare.app_label,
                      when: pendingCare.occurred_display,
                    })
                  : t("home.homeConsole.care.notice.meta", {
                      kind: pendingCare.kind,
                      when: pendingCare.occurred_display,
                    })}
              </p>
            </div>
            <div className="hc-notice-acts">
              <button
                type="button"
                className="hc-notice-open"
                onClick={() => onOpenCareIncident?.(pendingCare.incident_id)}
              >
                {t("home.homeConsole.care.notice.open")}
              </button>
              <button
                type="button"
                className="hc-notice-dismiss"
                onClick={() => onDismissCareIncident?.(pendingCare.incident_id)}
              >
                {t("home.homeConsole.care.notice.dismiss")}
              </button>
            </div>
          </section>
        )}
        {careRenders && (
          <section className="hc-care" aria-label={care.label}>
            <button
              type="button"
              className="hc-care-entry"
              onClick={() =>
                onOpenLabStation ? onOpenLabStation(care.station) : onNavigate?.(care.room)
              }
            >
              {/* THE COMP'S ROW: life ring · name · the symptom in the user's words · Open.
                  `care.because` ("reads Windows' own crash & freeze record in plain English")
                  is NOT printed here any more — 01-health-approved.png draws one description
                  line, and of the two this is the one a frightened user is scanning for. The
                  string is deliberately still returned by homeCareEntry: it is a METHOD note,
                  and the honest place for a method note is the station it describes, not a
                  third line on the door. Logged as a substitution in UI_VISION_BACKLOG. */}
              <span className="hc-care-ico" aria-hidden="true">
                <Icon name="lifebuoy" size={22} />
              </span>
              <span className="hc-care-text">
                <span className="hc-care-label">{care.label}</span>
                <span className="hc-care-symptom">{care.symptom}</span>
              </span>
              <span className="hc-care-open">
                {t("home.homeConsole.care.open")}
                <span aria-hidden="true"> &rsaquo;</span>
              </span>
            </button>
          </section>
        )}
      </div>

      {/* THE INTERVIEW (step 3, issue #177) - what the front door opens. It grows out of the button
          and dims the room behind it, so the user can see they never left Home. */}
      {interviewOpen && (
        <HomeInterview
          facts={interviewFacts}
          initialPath={interviewPath}
          origin={interviewOrigin}
          onClose={() => setInterviewOpen(false)}
          onRunCheck={onRunCheck}
          onOpenStation={(station, room) =>
            onOpenLabStation ? onOpenLabStation(station) : onNavigate?.(room)
          }
          onOpenRoom={(room) => onNavigate?.(room)}
          onFastPath={runFastPath}
          fastPathBusy={fastPathBusy}
          fastPathReceipt={fastPathReceipt}
        />
      )}

      {/* The hero's popout — the full detected parts list, grown out of the rig tile. */}
      {partsSheet.is("parts") && (
        <Sheet
          title={t("home.homeConsole.bento.parts")}
          origin={partsSheet.origin}
          onClose={partsSheet.close}
        >
          <HardwareGrid hw={hw} model={model} />
        </Sheet>
      )}

      {/* The CPU-temperature offer, finally on a reachable path (C-19). Rendered verbatim — it
          already owns the whole honest ladder (already publishing / HWiNFO's Shared Memory
          Support off / installed but closed / nothing installed) and its own Re-check. */}
    </RoomShell>
  );
}

export default HomeConsole;
