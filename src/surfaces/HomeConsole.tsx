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
import { activeChangeCount } from "./dashboard-data";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
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
import {
  homeIntakeRows,
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
// With `dense` rows it becomes the index into the full detected record: hover peeks, click
// pins (aria-expanded button). The default face is unchanged — density is per-interaction.
function Callout({
  tone,
  name,
  detail,
  value,
  valueTone,
  mono = true,
  dense,
}: {
  tone: "ok" | "warn" | null;
  name: string;
  detail?: string;
  value?: string;
  valueTone?: "ok" | "warn" | null;
  mono?: boolean;
  dense?: [string, string][];
}) {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expandable = !!dense && dense.length > 0;
  const open = expandable && (pinned || hovered);
  const head = (
    <span className="hc-callout-head">
      {tone && <span className={`hc-led hc-led-${tone}`} aria-hidden="true" />}
      <b>{name}</b>
      {detail && <span className="hc-callout-detail">{detail}</span>}
      {expandable && (
        <span className="hc-callout-more" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      )}
    </span>
  );
  return (
    <div
      className={`hc-callout${expandable ? " hc-callout-x" : ""}${open ? " hc-callout-open" : ""}`}
      onPointerEnter={expandable ? () => setHovered(true) : undefined}
      onPointerLeave={expandable ? () => setHovered(false) : undefined}
    >
      {expandable ? (
        <button
          type="button"
          className="hc-callout-btn"
          aria-expanded={open}
          aria-label={t("home.homeConsole.callout.detailsAria", { name })}
          onClick={() => setPinned((v) => !v)}
        >
          {head}
        </button>
      ) : (
        head
      )}
      {value && (
        <span
          className={`hc-callout-v ${mono ? "hc-mono" : ""}${valueTone ? ` hc-callout-v-${valueTone}` : ""}`}
        >
          {value}
        </span>
      )}
      {open && (
        <span className="hc-callout-dense">
          {dense!.map(([k, v], i) => (
            <span key={`${k}-${i}`} className="hc-dense-row">
              <span className="hc-dense-k">{k}</span>
              <span className="hc-dense-v hc-mono">{v}</span>
            </span>
          ))}
        </span>
      )}
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
  fixRoomLabel = "Optimize",
  onNavigate,
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
  const intakeOn = useHomeIntakeFlag();
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
  useEffect(() => {
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
  }, []);

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
      measured={<RerunCheckBand readiness={readiness} checking={checking} onRunCheck={onRunCheck} />}
    >
      <div className="home-console" data-motion={reduced ? "reduced" : "full"}>
        {/* THE COLD-OPEN VERDICT — relocated out of the h1 (title-header law): postureLine's
            real headline + its trimmed sentence, tone-inked, rendered exactly ONCE on this
            screen (one-mention law). */}
        <div className={`hc-verdict hc-verdict-${posture.tone}`}>
          <span className="hc-verdict-line" key={posture.headline}>
            {posture.headline}
          </span>
          {!dekRedundant && <span className="hc-verdict-dek">{dek}</span>}
        </div>
        {/* THE INTAKE BAND (BACKLOG:916) — the proven Lab "What are you here to do?" idiom lifted
            one level up to Home: an always-available one-tap fast path (option C) over intent rows
            that route to the right ROOM (option A). The Dock below stays clean room-name doors
            (option B door-hints declined — the band already carries the symptom→room map, so
            duplicating symptoms onto the doors would be the annoyance the owner warned against). */}
        {intakeRenders && (
          <section className="hc-intake" aria-label={t("home.homeConsole.intake.prompt")}>
            <div className="hc-intake-head">{t("home.homeConsole.intake.prompt")}</div>
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
            {/* Option A — the intent rows. Each routes to a ROOM (not an in-Lab station); the
                because-line names the ROOM's action, the label resolves live from the rail. */}
            {intakeRows.length > 0 && (
              <ul className="hc-intake-rows">
                {intakeRows.map((row) => {
                  const roomName = rooms?.find((rm) => rm.key === row.room)?.name ?? row.room;
                  return (
                    <li key={row.symptom}>
                      <button
                        type="button"
                        className="hc-intake-row"
                        onClick={() => onNavigate?.(row.room)}
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
        )}
        {/* CONSOLE STAGE — bracketed frame, the real 3D hologram center, four honest corner
            gauges. No lede (owner header-slop law 2026-07-10): the console opens straight on
            the stage. */}
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
            {/* First exposure of "1% low" in the app (the cold-open) — glossed inline, plan
                2026-07-11 Phase 1 (the no-jargon promise). */}
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
              {/* Instrument annotations — the parallax plane (Task 4); the plane stays
                  pointer-events none so drag-orbit under it never fights — only a callout
                  with a dense readout takes the pointer back (hc-callout-x). GPU temp lives
                  in the BR gauge (one owner per number), so the GPU callout carries the
                  detected model only; expanding it is the index into the full record (B6a). */}
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
                  dense={denseRam(hw.memory_modules, t)}
                />
                {diskPct != null && (
                  <Callout
                    tone={diskPct >= 90 ? "warn" : "ok"}
                    name={t("home.homeConsole.callout.storage")}
                    value={t("home.homeConsole.stage.diskFull", { pct: diskPct })}
                    valueTone={diskPct >= 90 ? "warn" : "ok"}
                    dense={denseStorage(hw.physical_disks)}
                  />
                )}
              </div>
              <div className="hc-ann hc-ann-right">
                <Callout
                  tone={null}
                  name={t("home.homeConsole.callout.gpu")}
                  detail={shortModel(hw.gpus[0]?.name)}
                  dense={denseGpu(hw.gpus[0], t)}
                />
                <Callout
                  tone={null}
                  name={t("home.homeConsole.callout.cpu")}
                  detail={hw.cpu_arch?.family_label || undefined}
                  value={t("home.homeConsole.callout.cpuNoTemp")}
                  mono={false}
                  dense={denseCpu(hw, t)}
                />
              </div>
            </>
          )}
          {/* Quiet view controls — the same persisted choices HomeHud offers, console chrome. */}
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

        {/* THE #1 LIMITER — micro-label · the measured title · quiet confidence tag · jump. */}
        {topLimiter && (
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
        )}

        {/* LAST SESSION — Home's ONE intelligence line (Intelligence Phase 1, decision 7): the
            engine's own verdict sentence verbatim; the full report lives in Monitor's debrief.
            Only rendered for a real improved/regressed verdict (the command returns null
            otherwise), and the door only shows when Monitor is actually on the rail. */}
        {intelHeadline && (
          <div className="hc-limiter">
            <span className="hc-limiter-label">{t("home.homeConsole.limiter.lastSessionLabel")}</span>
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
        )}

        {/* THE DOCK — navigate into the rooms the rail actually shows. */}
        {dockNodes.length > 0 && onNavigate && (
          <Dock nodes={dockNodes} activeKey={null} onOpen={onNavigate} />
        )}
      </div>
    </RoomShell>
  );
}

export default HomeConsole;
