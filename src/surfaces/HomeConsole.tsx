import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type {
  AppliedChange,
  GameReadiness,
  IntelligenceHeadline,
  Priorities,
  Recommendation,
  SessionSummary,
} from "../types";
import type { HardwareInfo } from "../App";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { useIntelligenceFlag, useHomeIntakeFlag } from "../design/use-hud";
import { readHologramV2 } from "../design/theme";
import { postureLine, liveStrip } from "./command-center-data";
import { LedgerHealthNotice, useLedgerHealth } from "../design/LedgerHealthNotice";
import { activeChangeCount } from "./dashboard-data";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { useDocumentVisible } from "../data/use-document-visible";
import { gpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, type Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { ArcGauge, type ArcTone } from "../design/console/ArcGauge";
import { Term } from "../design/Term";
import { Dock, type DockNode } from "../design/console/Dock";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { useConfirmOptional } from "../design/ConfirmDialog";
import { safeFixesReadyList } from "./optimize-v2-data";
import { RerunCheckBand } from "./RerunCheckBand";
import { deriveReverted } from "./use-scan";
import { BentoGrid, BentoTile, Sheet, useSheet } from "../design/bento";
import {
  homeIntakeRows,
  homeCareEntry,
  homeIntakeFastpath,
  fastPathReadyHeadline,
  fastPathApplyLabel,
  fastPathAppliedNote,
} from "./home-intake-data";
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
  onOpenLabStation?: (station: string) => void;
  // ── Home intake band (BACKLOG:916, behind compy_home_intake, DEFAULT ON). The three below
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
};

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
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // Optional confirm — the fast path (default-OFF) is the only consumer, so HomeConsole must not
  // hard-require the provider on every mount (see useConfirmOptional). null → runFastPath no-ops.
  const confirm = useConfirmOptional();
  // The rig tile's popout. Depth goes BEHIND the sheet, never across the surface (bento law): the
  // stage keeps the live picture, the full detected parts list opens over the dimmed room.
  const partsSheet = useSheet<"parts">();
  const intakeOn = useHomeIntakeFlag();
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
  const [fastPathReceipt, setFastPathReceipt] = useState<{
    applied: number;
    skipped: number;
    // J (2026-07-22): the receipt used to keep only the COUNT, which is why "1 safe tweak not
    // applied" was a dead end - the batch already returns title+reason per skip and it was thrown
    // away one line after arriving. Retained so the verdict can name WHICH and WHY.
    skippedItems: { title: string; reason: string }[];
  } | null>(null);

  // Cursor-follow accent spotlight on the stage — a border-masked glow that tracks the pointer
  // (LabConsole's exact mechanism). Custom props only; skipped entirely under reduced motion.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
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
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    el.style.setProperty("--hc-px", px.toFixed(3));
    el.style.setProperty("--hc-py", py.toFixed(3));
  };
  const onStageLeave = () => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--hc-px", "0");
    el.style.setProperty("--hc-py", "0");
  };

  // ── live probes (existing read-only commands; a failure just omits the value) — HomeHud's
  // 5s poll, ported verbatim ──
  const [gpuTemp, setGpuTemp] = useState<number | null>(null);
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
  const posture = postureLine(readiness, priorities, activeChangeCount(changes), t);
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
  // (the fix route still lives in the verdict dek + the Dock). Mirrors the dek/ForwardDoor
  // standdowns. `... and ` anchors the several-flagged headline ("<label> · and N more").
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
  const fastPathAvailable = intakeOn && !!onApplyBatch && !!isAppliable && recs !== undefined;
  const revertedIds = new Set(deriveReverted(changes).map((r) => r.rec_id));
  const eligibleStack =
    recs && isAppliable ? safeFixesReadyList(recs, isAppliable, revertedIds) : [];
  const stackReady = eligibleStack.length;
  // Intent rows (option A) filtered to rooms the live rail actually renders — a row must never
  // point at a room that isn't there (no dead ends). The room LABEL is resolved live from `rooms`.
  // One-owner-per-screen (P5 voice law): the LAST SESSION block below (intelHeadline) already
  // answers "how did my last session go" with the engine's own verdict line + its See-in-Monitor
  // door. When it renders, the intake row asking that same question and routing to that same room
  // stands down and lets the block own it — mirrors the verdictNamesLimiter/topLimiter and
  // dek/ForwardDoor standdowns above (self-reviewer catch 2026-07-14, rubric 3 duplication).
  const lastSessionRendered = !!intelHeadline;
  const intakeRows = homeIntakeRows(t).filter(
    (row) =>
      rooms?.some((rm) => rm.key === row.room) && !(lastSessionRendered && row.room === "play"),
  );
  const intakeRenders = intakeOn && (fastPathAvailable || intakeRows.length > 0);
  // The Care entry (issue #91, discovery contract): ALWAYS visible, independent of `intakeOn` —
  // crash rescue is the one thing a user comes to Home in distress to find, and it must not be
  // behind the same switch as the optimization band. The single condition it does obey is the
  // no-dead-end law every other affordance here obeys: if the rail does not render the room the
  // station lives in, there is nowhere to send the click.
  const care = homeCareEntry(t);
  const careRenders = !!rooms?.some((rm) => rm.key === care.room);
  // Static fast-path copy (option C) — resolved once per render through the live `t`.
  const fastpath = homeIntakeFastpath(t);

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
      verdict={
        <>
          <span className="hc-masthead-eyebrow">
            <span className={`hc-led hc-led-${ledState}`} aria-hidden="true" />
            {t("home.homeConsole.masthead.eyebrow")} <span className="hc-eyebrow-sep">·</span>{" "}
            <span className="hc-mono">{dateline}</span>
          </span>
          {/* Title only in the h1 (owner title-header law 2026-07-10 ×2) — the posture
              verdict lives in its body context strip above the stage. */}
          <span className="hc-headline">{t("common.rail.home", { defaultValue: "Home" })}</span>
        </>
      }
      measured={
        <RerunCheckBand
          readiness={readiness}
          checking={checking}
          onRunCheck={onRunCheck}
          onSeeInFix={onSeeInFix}
          fixRoomLabel={fixRoomLabel}
        />
      }
    >
      <div className="home-console" data-motion={reduced ? "reduced" : "full"}>
        {/* THE COLD-OPEN VERDICT — relocated out of the h1 (title-header law): postureLine's
            real headline + its trimmed sentence, tone-inked, rendered exactly ONCE on this
            screen (one-mention law). */}
        {/* Above the verdict it qualifies — a caveat printed under its subject has already failed
            at its job. */}
        <LedgerHealthNotice health={ledgerHealth} />
        <div className={`hc-verdict hc-verdict-${posture.tone}`}>
          <span className="hc-verdict-line" key={posture.headline}>
            {posture.headline}
          </span>
          {!dekRedundant && <span className="hc-verdict-dek">{dek}</span>}
        </div>
        {/* THE CARE ENTRY (issue #91 Tier 1, visible half) — one compact door to crash rescue,
            rendered OUTSIDE the intake band's gate on purpose. A user whose PC just crashed is the
            least likely person to go turn a Settings band back on to find help, and the tester who
            walked to Event Viewer (SESSION_HANDOFF §4) is the evidence for what happens when this
            sign is not in front of them. It lands ON the evidence station, never the Lab dock. */}
        {careRenders && (
          <section className="hc-care" aria-label={care.label}>
            <button
              type="button"
              className="hc-care-entry"
              onClick={() =>
                onOpenLabStation ? onOpenLabStation(care.station) : onNavigate?.(care.room)
              }
            >
              <span className="hc-care-label hc-mono">{care.label}</span>
              <span className="hc-care-symptom">{care.symptom}</span>
              <span className="hc-care-because">{care.because}</span>
            </button>
          </section>
        )}
        {/* THE INTAKE BAND (BACKLOG:916) — the proven Lab "What are you here to do?" idiom lifted
            one level up to Home: an always-available one-tap fast path (option C) over intent rows
            that route to the right ROOM (option A). The Dock below stays clean room-name doors
            (option B door-hints declined — the band already carries the symptom→room map, so
            duplicating symptoms onto the doors would be the annoyance the owner warned against). */}
        <BentoGrid>
        {/* FULL WIDTH BECAUSE IT IS CONDITIONAL (`bento: no conditional partial tile`). The band
            is hidden by the compy_home_intake setting, so a half-width version of this tile would
            leave a hole beside the hero the moment the owner switched it off. A full-width tile
            always starts its own row, so its absence just moves the rest of the grid up intact —
            and the band was born full-width anyway (it reads as a strip, not a card). */}
        {intakeRenders && (
          <BentoTile title={t("home.homeConsole.intake.prompt")} span="full">
          <section className="hc-intake" aria-label={t("home.homeConsole.intake.prompt")}>
            {/* Option C — the always-available one-tap "just make it faster, safely" fast path.
                Honest state machine: applied receipt › loading › all-clear › ready-with-apply. */}
            {fastPathAvailable && (
              <div className="hc-intake-fast">
                <span className="hc-intake-fast-symptom">{fastpath.symptom}</span>
                {fastPathReceipt ? (
                  <>
                    <span className="hc-intake-fast-line">
                      {fastPathAppliedNote(fastPathReceipt.applied, fastPathReceipt.skipped, t)}
                    </span>
                    {/* J (2026-07-22): "1 safe tweak not applied" named a count and nothing else,
                        so the verdict was a dead end. The reason comes from the batch primitive -
                        never synthesised here, so a skip can only ever say what actually happened. */}
                    {fastPathReceipt.skippedItems.length > 0 && (
                      <details className="hc-intake-fast-skipped">
                        <summary className="hc-intake-fast-skipped-summary">
                          {t("home.homeConsole.intake.fastpath.skippedDisclosure", {
                            count: fastPathReceipt.skippedItems.length,
                          })}
                        </summary>
                        <ul className="hc-intake-fast-skipped-list">
                          {fastPathReceipt.skippedItems.map((item) => (
                            <li key={item.title}>
                              {t("home.homeConsole.intake.fastpath.skippedItemReason", {
                                title: item.title,
                                reason: item.reason,
                              })}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                ) : recs === null ? (
                  <span className="hc-intake-fast-line hc-mono">{fastpath.loading}</span>
                ) : stackReady === 0 ? (
                  <span className="hc-intake-fast-line">{fastpath.allClear}</span>
                ) : (
                  <>
                    <span className="hc-intake-fast-line">
                      {fastPathReadyHeadline(stackReady, t)}
                    </span>
                    <button
                      type="button"
                      className="hc-btn hc-intake-fast-btn"
                      onClick={runFastPath}
                      disabled={fastPathBusy}
                    >
                      {fastPathBusy
                        ? t("home.homeConsole.intake.applying")
                        : fastPathApplyLabel(stackReady, t)}
                    </button>
                    <span className="hc-intake-fast-undo">↺ {fastpath.reversible}</span>
                  </>
                )}
              </div>
            )}
            {/* Option A — the intent rows. Each routes to a ROOM; a row whose symptom has ONE
                answering instrument (today: "it crashed or froze" → the Lab's crash-evidence
                station) routes THROUGH the room to that instrument, so naming the symptom and
                then making the user hunt the dock is not a thing this band does. The because-line
                names the ROOM's action, the label resolves live from the rail. */}
            {intakeRows.length > 0 && (
              <ul className="hc-intake-rows">
                {intakeRows.map((row) => {
                  const roomName = rooms?.find((rm) => rm.key === row.room)?.name ?? row.room;
                  return (
                    <li key={row.symptom}>
                      <button
                        type="button"
                        className="hc-intake-row"
                        onClick={() =>
                          row.station && onOpenLabStation
                            ? onOpenLabStation(row.station)
                            : onNavigate?.(row.room)
                        }
                      >
                        <span className="hc-intake-row-symptom">{row.symptom}</span>
                        <span className="hc-intake-row-because">{row.because}</span>
                        <span className="hc-intake-row-room hc-mono">{roomName} →</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          </BentoTile>
        )}
        {/* CONSOLE STAGE — bracketed frame, the real 3D hologram center, four honest corner
            gauges. No lede (owner header-slop law 2026-07-10): the console opens straight on
            the stage.

            THE HERO TILE, AND WHY IT HAS NO `open` PROP. BentoTile's open affordance stretches a
            button across the whole tile; over the stage that layer would swallow RigHologram's
            drag-orbit pointer events, so the rig would stop turning. The popout is opened from the
            badge slot instead — a real button, no stretched layer, orbit untouched. */}
        <BentoTile
          title={t("home.homeConsole.bento.rig")}
          span="hero"
          badge={
            // Cards mode already prints the same grid on the stage, so the popout would be a
            // second copy of what is on screen. It earns its place only in 3D mode.
            rig3d ? (
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
            ) : null
          }
        >
        <div
          className="hc-stage"
          ref={stageRef}
          onPointerMove={onStageMove}
          onPointerLeave={onStageLeave}
        >
          <span className="hc-brk hc-brk-tl" aria-hidden="true" />
          <span className="hc-brk hc-brk-tr" aria-hidden="true" />
          <span className="hc-brk hc-brk-bl" aria-hidden="true" />
          <span className="hc-brk hc-brk-br" aria-hidden="true" />
          <div className="hc-corner hc-tl">
            {/* The score's whole formula, stated where the number is (consumer-panel Phase 2:
                a bare 0–100 read as a made-up number). */}
            <ArcGauge
              label={t("home.homeConsole.stage.readinessLabel")}
              value={readinessScore}
              max={100}
              unit="score"
              tone="accent"
              note={
                readinessKnown
                  ? t("home.homeConsole.stage.readinessNote", {
                      passed: Math.max(
                        0,
                        readiness!.checks.length - readiness!.attention_count - readiness!.unknown_count,
                      ),
                      total: readiness!.checks.length,
                    })
                  : undefined
              }
            />
          </div>
          <div className="hc-corner hc-tr">
            <ArcGauge
              label={t("home.homeConsole.stage.avgFps")}
              value={avgFps}
              max={240}
              unit="fps"
              tone={arcTone(fpsGrade)}
              measured={avgFps != null}
            />
          </div>
          <div className="hc-corner hc-bl">
            {/* First exposure of "1% low" in the app (the cold-open) — glossed inline via <Term>,
                plan 2026-07-11 Phase 1 (the no-jargon promise). The gloss is exactly why this
                gauge does NOT need to be gated: a term that carries its own definition is
                legible to everyone, and the fourth corner is what makes the frame read as an
                instrument rather than a lopsided one. */}
            <ArcGauge
              label={<Term id="one-percent-lows">{t("home.homeConsole.stage.onePercentLow")}</Term>}
              value={lowFps}
              max={240}
              unit="fps"
              tone={arcTone(low1Grade)}
              measured={lowFps != null}
            />
          </div>
          <div className="hc-corner hc-br">
            {/* NVIDIA renders neutral tone (LOCKED rule 5 — sensor not hardware-verified). */}
            <ArcGauge
              label={t("home.homeConsole.stage.gpuTemp")}
              value={gpuTemp}
              max={100}
              unit="°C"
              tone={arcTone(gpuGrade)}
              measured={gpuTemp != null}
            />
          </div>
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
                  cameraDist={6.9}
                />
              </Suspense>
            ) : (
              <div className="hc-stage-cards">
                <HardwareGrid hw={hw} />
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
                <Callout
                  tone={null}
                  name={t("home.homeConsole.callout.cpu")}
                  detail={hw.cpu_arch?.family_label || undefined}
                  value={t("home.homeConsole.callout.cpuNoTemp")}
                  mono={false}
                />
              </div>
            </>
          )}
          {/* Quiet view controls — the same persisted choices HomeHud offers, console chrome.
              Both groups are standard: 2D/3D, then explode/orbit whenever the 3D rig is up.
              Orbit still DEFAULTS off (T4d contract — the resting bay costs ~0 GPU); showing
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
          </div>
          {/* The game-HUD Target Cursor, stage-scoped (kit handles reduced/coarse-pointer null
              + the rAF pointerleave stop — Phase-1's review fix). */}
          <ReticleCursor scopeRef={stageRef} />
        </div>
        </BentoTile>

        {/* THE TWO HALF TILES BESIDE THE HERO — the #1 limiter, then the last-session verdict: the
            two measured sentences Home is allowed to state, each in its own box. No `open` prop on
            either: each row already carries its own door button, and a stretched tile button would
            put a second, competing target over it.

            WHY THEY ARE TWO TILES, AND WHY BOTH ALWAYS RENDER (self-review 2026-08-12, item 5). The
            hero spans 7 columns × 2 rows, so the grid needs exactly TWO always-present 5-column
            tiles to close those rows — strict row-major with no dense flow is deliberate, so any
            slot that can go empty shows as a hole. They used to be one conditional tile, and on a
            clean PC Home opened with a ~180px dark rectangle at every width. Splitting them is also
            the honest shape: a limiter and a session comparison are different claims with different
            empty states, and a shared "nothing here" line could only be vague about which was which.

            NEITHER EMPTY LINE SAYS "NOTHING IS WRONG" — neither may. `topLimiter` goes null when the
            verdict above already names the limiter (see `verdictNamesLimiter`) and while priorities
            are still loading, so an all-clear claim here would be fabricated. Each line states only
            what is true in its own null case. */}
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

        {/* THE DETECTED RECORD — boxed templates, always open (owner 2026-08-06: "better grouping
            and boxed templates"). Static facts only; everything that MOVES is on the stage above,
            so no number is owned twice. Label/value rows, zero prose. No `open` prop and no
            expander: the owner made the detected record standard and always-open. */}
        {specs.length > 0 && (
          <BentoTile title={t("home.homeConsole.specs.eyebrow")} span="full">
          <section className="hc-specs" aria-label={t("home.homeConsole.specs.eyebrow")}>
            <div className="hc-specs-grid">
              {specs.map((s) => (
                <SpecBox key={s.title} title={s.title} rows={s.rows} />
              ))}
            </div>
          </section>
          </BentoTile>
        )}
        </BentoGrid>

        {/* THE DOCK — navigate into the rooms the rail actually shows. Deliberately OUTSIDE the
            grid: the dock is the room's exit row, not one of its answers, and a door tile sitting
            among the measured tiles is exactly the "twelve equal cards" failure the bento avoids. */}
        {dockNodes.length > 0 && onNavigate && (
          <Dock nodes={dockNodes} activeKey={null} onOpen={onNavigate} />
        )}
      </div>

      {/* The hero's popout — the full detected parts list, grown out of the rig tile. */}
      {partsSheet.is("parts") && (
        <Sheet
          title={t("home.homeConsole.bento.parts")}
          origin={partsSheet.origin}
          onClose={partsSheet.close}
        >
          <HardwareGrid hw={hw} />
        </Sheet>
      )}
    </RoomShell>
  );
}

export default HomeConsole;
