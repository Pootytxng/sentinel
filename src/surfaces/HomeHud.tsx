import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
// DIR-1 first-timer walk, 2026-08-26, finding #5: "1% low" is a measurement word, and the
// reader this product is for has never met it. `src/jargon-term-gloss-guard.test.ts` derives
// its worklist from the shipped locale, so every place that prints the bare word is graded.
import { Term } from "../design/Term";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { RoomShell } from "../design/room-shell";
import { LedgerHealthNotice, knownIncomplete, useLedgerHealth } from "../design/LedgerHealthNotice";
import { Sparkline } from "../design/Sparkline";
import { knownFps } from "../lib/session-metrics";
import { useReducedMotion } from "../design/use-motion";
import { readHologramV2 } from "../design/theme";
import { postureLine, liveStrip } from "./command-center-data";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { useDocumentVisible } from "../data/use-document-visible";
import { gpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, gradeColor, type Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { inEffectCounts, useMachineModel } from "../data/machine-model";
import { SetupLauncherCard } from "./setup/SetupLauncherCard";
import { useV2Accent } from "./HomeV2";
import CountUp from "../design/vendor/CountUp/CountUp";
import ElectricBorder from "../design/vendor/ElectricBorder/ElectricBorder";
import "./home-hud.css";
import { confidenceHintKey, confidenceWordKey, wordFromBand } from "../data/confidence-word";

// HomeHud — the pure Instrument-HUD pilot (spec 2026-07-05-ui-deslop-organic-directive,
// LOCKED direction CORRECTED: editorial retired; flag DEFAULT OFF). The whole room reads as
// a high-end diagnostic HUD: a system-console masthead (status LED · letterspaced eyebrow ·
// display verdict · segmented readout), the REAL WebGL rig hologram in a bracketed, ruled
// instrument bay with part callouts on hairline leaders, a telemetry column where numbers are
// the heroes (fps-vs-refresh ring gauge, oscilloscope trace on graph-paper ink), and a ranked
// priority queue. Clean and restrained on purpose — precision strokes + type discipline, no
// neon clutter (the one hard steer).
//
// Honesty contract (identical to HomeV2 — this file changes PRESENTATION only): every number
// is measured or honestly absent; the verdict is postureLine's real output; the scan sweep
// renders ONLY while checks are actually running; graded ink comes from metric-grade against
// THIS rig; the ring gauge is the measured avg-fps over THIS display's refresh ceiling; NVIDIA
// temp stays ungraded (LOCKED rule 5 — gradeGpuTempForVendor). Zero new IPC.
//
// Motion contract (HARD RAILS): pointer-parallax is event-driven (no rAF loop — nothing runs
// on blur or idle), applies to the annotation plane only (never fights drag-orbit inside the
// canvas), transform/opacity only, and reduced-motion renders the still page.

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
  /** Where the "See in …" buttons land: "Lab" on the proving-ground rail, "Optimize" classic. */
  fixRoomLabel?: string;
  /** App's station deep-link. The drift module's pointer opens the Care view ("blackbox"), whose
   *  "Since it last worked" list names and dates each drift (P6-timeline). Absent → text only. */
  onOpenLabStation?: (station: string) => void;
};

const fmtGB1 = (b: number) => (b / 1024 ** 3).toFixed(1);

// Grade → status tone for the callout LEDs (ok/warn only; neutral = no LED — ungraded).
const gradeTone = (g: Grade): "ok" | "warn" | null =>
  g === "good" ? "ok" : g === "ok" || g === "bad" ? "warn" : null;

// Short marketing-prefix-free model name ("AMD Radeon RX 9070 XT" → "RX 9070 XT").
// Purely presentational trimming of the DETECTED name — never invents or substitutes a model.
const shortModel = (n: string | undefined): string | undefined =>
  n?.replace(/^\s*(AMD|NVIDIA|Intel)?\s*(Radeon|GeForce|Arc)?\s*(\(TM\))?\s*/i, "").trim() || n;

// One instrument callout: LED (only when a measured value earned a tone) · part · detected
// model · measured value on a hairline leader.
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
    <div className="hud-callout">
      <span className="hud-callout-head">
        {tone && <span className={`hud-led hud-led-${tone}`} aria-hidden="true" />}
        <b>{name}</b>
        {detail && <span className="hud-callout-detail">{detail}</span>}
      </span>
      {value && (
        <span
          className={`hud-callout-v ${mono ? "hud-mono" : ""}${valueTone ? ` hud-callout-v-${valueTone}` : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// The fps-vs-refresh ring gauge — a real ratio, never a fabricated score: the measured session
// average over THIS display's refresh ceiling (the same reference gradeFps grades against).
// Rendered only when both sides of the ratio were actually read.
function HudRing({ frac, color, pct }: { frac: number; color: string; pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, frac));
  return (
    <svg className="hud-ring" width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--hud-hairline)" strokeWidth="3" />
      <circle
        cx="26"
        cy="26"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={`${(c * clamped).toFixed(2)} ${c.toFixed(2)}`}
        transform="rotate(-90 26 26)"
      />
      <text x="26" y="26" className="hud-ring-pct" textAnchor="middle" dominantBaseline="central">
        {pct}%
      </text>
    </svg>
  );
}

// One telemetry module: letterspaced micro-label · reading · one-line plain-English note.
function Module({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="hud-module">
      <span className="hud-eyebrow">{label}</span>
      {children}
    </div>
  );
}

export function HomeHud({
  hw,
  readiness,
  priorities,
  sessions,
  changes,
  onRunCheck,
  onSeeInFix,
  // "Lab" — the Optimize room was deleted in the 2026-08-06 generation prune.
  fixRoomLabel = "Lab",
  onOpenLabStation,
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // Shared Machine Model (#451): the hardware grid's identity rows read its facts, not bare
  // inventory fields. One read-only IPC per hardware refresh — `hw` is App.refresh()'s product, so a
  // new object re-reads the model alongside it.
  const model = useMachineModel(hw);
  const accent = useV2Accent();

  // ── live callout probes (existing read-only commands; a failure just omits the value) ──
  const [gpuTemp, setGpuTemp] = useState<number | null>(null);
  const [mem, setMem] = useState<{ used: number; total: number; level: string } | null>(null);
  // Q7 idle-cost: pause while the window is hidden (same contract as HomeConsole's port of this poll).
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

  // ── rig view state (same persisted pref as HomeV2 — Cards vs 3D) ──
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
  // classic (flag off) keeps its always-orbiting default — same contract as RigViewer's bay.
  const [autoRotate, setAutoRotate] = useState(() => !readHologramV2());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Stable handler: an inline arrow here breaks RigHologram's memo, letting every 5s live-poll
  // re-render re-commit mesh handlers and repaint the resting bay (the T1.5 idle-repaint class).
  const onRigSelect = useCallback((id: string) => setSelectedId(id || null), []);
  const { parts: manualParts } = useManualParts();

  // ── pointer parallax (JARVIS depth, event-driven — no rAF loop, nothing runs on blur).
  // Writes two CSS vars on the stage; ONLY the annotation plane + brackets consume them, so
  // the canvas (drag-orbit's home) never moves under the cursor.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const onStageMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    el.style.setProperty("--hud-px", px.toFixed(3));
    el.style.setProperty("--hud-py", py.toFixed(3));
  };
  const onStageLeave = () => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--hud-px", "0");
    el.style.setProperty("--hud-py", "0");
  };

  // ── measured derivations (all real, all honestly empty when absent — HomeV2's exact logic) ──
  // The in-effect count is the Machine Model's answer (#452), never `is_still_active` counted off the
  // bare ledger list: that list is EMPTY when the ledger can't be read, and it counts a row whose live
  // check failed as in effect. Only `activeNow` is in effect; `unknown` is named, never added to it.
  const inEffect = inEffectCounts(model);
  const posture = postureLine(readiness, priorities, inEffect, t);
  const strip = liveStrip(sessions, t);
  const rig = { refreshHz: hw.display?.current_refresh_rate_hz ?? null };
  const fpsGrade: Grade = strip.kind === "data" ? gradeFps(strip.avgFps, rig) : "neutral";
  const low1Grade: Grade =
    strip.kind === "data" ? gradeLow1(strip.low1Est, strip.avgFps) : "neutral";
  const gradeClass = (g: Grade) => (g === "neutral" ? "" : ` hud-grade-${g}`);
  const gradeInk = (g: Grade) => (g === "neutral" ? undefined : { color: gradeColor(g) });
  const checking = readiness == null; // checks literally still running
  const vendor = gpuVendor(hw.gpus?.[0]?.name);
  const gpuGrade = gradeGpuTempForVendor(vendor, gpuTemp);

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
    // Clean state: the queue's clear line is the ONE owner of "measured clean" on this screen
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

  const latest = changes.length > 0 ? changes[changes.length - 1] : null;
  const latestTime = latest
    ? new Date(latest.applied_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  // An unreadable ledger loads as an EMPTY one, and this column paints an empty one as "0" +
  // "nothing applied yet — your PC is untouched": a claim ABOUT THE MACHINE, read off a record
  // Compy cannot read. At zero the two are indistinguishable, so here zero is an ABSENCE, not a
  // measurement — and this file's honesty contract says every number is measured or honestly
  // absent. The honest render is the one the last-session module already uses: drop the reading,
  // keep the note. Only the EMPTY branch narrows; a PARTIAL list still names its real (floor)
  // count, with the notice above disclosing that it is a floor. UNKNOWN health (probe failed or
  // disabled) leaves everything byte-identical to healthy — see design/LedgerHealthNotice.tsx.
  const health = useLedgerHealth(changes);
  const ledgerBlank = changes.length === 0 && !!knownIncomplete(health);
  // The EMPTY branch is not the only place this record can lie. With a PARTIAL list the count is
  // still real (a floor), so the reading stays — but "every one reversible from the ledger" is an
  // absolute, and it is false in both incomplete shapes: unreadable refuses undo outright, and
  // quarantined keeps the pre-quarantine changes off this list and out of reach. So the promise is
  // withdrawn on health alone, independent of the count.
  const ledgerUnvouched = !!knownIncomplete(health);
  // The model's own "can't read" is the same absence as a blank ledger: a word, never a 0.
  const activeWithdrawn = ledgerBlank || inEffect.kind === "unreadable";

  const drifts = readiness?.drifts ?? [];
  // P6-timeline: the drift module counts and points; the Care view's "Since it last worked" list
  // is the one place each drift is named and dated.
  const seeWhatChanged = onOpenLabStation && (
    <button type="button" className="hud-inline-link" onClick={() => onOpenLabStation("blackbox")}>
      {t("home.homeHud.ledger.seeWhatChanged")}
    </button>
  );
  const smartDrives = (hw.disk_health ?? []).filter((d) => d.health !== "Unknown");
  const flaggedDrives = smartDrives.filter((d) => d.health !== "Healthy");

  const sparkValues = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((s) => knownFps(s.avg_fps))
        .filter((v): v is number => v !== null)
        .slice(-12),
    [sessions],
  );

  const limiters = priorities?.limiters ?? [];
  const statusTone: Record<string, "ok" | "warn" | "info"> = {
    ready: "ok",
    attention: "warn",
    unknown: "info",
  };

  // The fps-vs-refresh ratio — both sides measured (session avg · this display's Hz) or the
  // ring doesn't render. Same reference gradeFps grades against, so ring and ink agree.
  const ringFrac =
    strip.kind === "data" && strip.avgFps != null && rig.refreshHz ? strip.avgFps / rig.refreshHz : null;

  // The instrument bay stage (shared by 3D and cards views).
  const stage = (
    <div
      className="hud-stage"
      ref={stageRef}
      onPointerMove={onStageMove}
      onPointerLeave={onStageLeave}
    >
      <span className="hud-corner hud-c-tl" aria-hidden="true" />
      <span className="hud-corner hud-c-tr" aria-hidden="true" />
      <span className="hud-corner hud-c-bl" aria-hidden="true" />
      <span className="hud-corner hud-c-br" aria-hidden="true" />
      {checking && !reduced && <div className="hud-sweep" aria-hidden="true" />}
      {rig3d ? (
        <Suspense
          fallback={<div className="hud-stage-loading">{t("home.homeHud.stage.loading3d")}</div>}
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
        <div className="hud-stage-cards">
          <HardwareGrid hw={hw} model={model} />
        </div>
      )}
      {rig3d && (
        <>
          <div className="hud-callouts hud-callouts-left">
            <Callout
              tone={mem ? gradeTone(mem.level === "ok" ? "good" : "bad") : null}
              name={t("home.homeHud.callout.ram")}
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
                name={t("home.homeHud.callout.storage")}
                value={t("home.homeHud.callout.diskFull", { pct: diskPct })}
                valueTone={diskPct >= 90 ? "warn" : "ok"}
              />
            )}
          </div>
          <div className="hud-callouts hud-callouts-right">
            <Callout
              tone={gradeTone(gpuGrade)}
              name={t("home.homeHud.callout.gpu")}
              detail={shortModel(hw.gpus[0]?.name)}
              value={gpuTemp != null ? `${Math.round(gpuTemp)}°C` : undefined}
              valueTone={gradeTone(gpuGrade)}
            />
            <Callout
              tone={null}
              name={t("home.homeHud.callout.cpu")}
              detail={hw.cpu_arch?.family_label || undefined}
              value={t("home.homeHud.callout.cpuNoTemp")}
              mono={false}
            />
          </div>
          <div className="hud-stage-hint">{t("home.homeHud.stage.hint")}</div>
        </>
      )}
    </div>
  );

  return (
    <RoomShell
      room="home"
      // The masthead is the eyebrow slot's, not the verdict's (#513): `verdict` renders inside the
      // <h1>, and with the masthead there the heading read "Rig diagnostic · Sep 22, 2026Monitor
      // below max refresh" — label, date and verdict as one string, the #211 defect hand-rolled.
      eyebrow={
        <span className="hud-masthead-eyebrow">
          <span className={`hud-led hud-led-${ledState}`} aria-hidden="true" />
          {t("home.homeHud.masthead.eyebrow")} <span className="hud-eyebrow-sep">·</span>{" "}
          <span className="hud-mono">{dateline}</span>
        </span>
      }
      verdict={
        <span className="hud-headline" key={posture.headline}>
          {posture.headline}
        </span>
      }
      sub={dekRedundant ? undefined : dek}
      measured={
        checking ? (
          <span className="hud-readout-seg">{t("home.homeHud.readout.running")}</span>
        ) : (
          <>
            <span className="hud-readout-seg">
              {t("home.homeHud.readout.checksPre")}{" "}
              <span className="hud-mono">
                {readiness!.checks.length - readiness!.unknown_count}/{readiness!.checks.length}
              </span>{" "}
              {t("home.homeHud.readout.checksPost")}
            </span>
            {/* A real space between the segments (#513). Only CSS parted them — the strip's gap and
                hairline — so the text itself read "measuredattention 3". Whitespace between flex
                items is not rendered, so this leaves the strip's look exactly as it was. */}{" "}
            <span
              className={`hud-readout-seg${(readiness!.attention_count ?? 0) > 0 ? " hud-readout-warn" : ""}`}
            >
              {t("home.homeHud.readout.attentionLabel")}{" "}
              <span className="hud-mono">{readiness!.attention_count}</span>
            </span>
          </>
        )
      }
      primaryAction={
        <button type="button" className="hud-btn" onClick={onRunCheck}>
          {t("home.homeHud.actions.rerun")}
        </button>
      }
    >
      <div className="hud-grid" data-hud-home>
        {/* ── Instrument bay — the real hologram in a bracketed, ruled HUD frame ── */}
        <section className="hud-bay">
          <header className="hud-bay-head">
            <span className="hud-eyebrow">{t("home.homeHud.bay.title")}</span>
            <div className="hud-bay-controls">
              <div className="hud-seg-group" role="tablist" aria-label={t("home.homeHud.bay.rigViewAria")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rig3d}
                  className={`hud-seg ${rig3d ? "hud-seg-on" : ""}`}
                  onClick={() => chooseRig3d(true)}
                >
                  {t("home.homeHud.bay.view3d")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!rig3d}
                  className={`hud-seg ${!rig3d ? "hud-seg-on" : ""}`}
                  onClick={() => chooseRig3d(false)}
                >
                  {t("home.homeHud.bay.viewCards")}
                </button>
              </div>
              {rig3d && (
                <div className="hud-seg-group">
                  <button
                    type="button"
                    className={`hud-seg ${exploded ? "hud-seg-on" : ""}`}
                    onClick={() => setExploded((v) => !v)}
                  >
                    {exploded ? t("home.homeHud.bay.reassemble") : t("home.homeHud.bay.exploded")}
                  </button>
                  <button
                    type="button"
                    className={`hud-seg ${autoRotate ? "hud-seg-on" : ""}`}
                    onClick={() => setAutoRotate((v) => !v)}
                    aria-pressed={autoRotate}
                  >
                    {t("home.homeHud.bay.orbit")}
                  </button>
                </div>
              )}
            </div>
          </header>
          {reduced ? (
            <div className="hud-eb-frame">{stage}</div>
          ) : (
            // ElectricBorder's ONE sanctioned use (adopt list): the hologram stage frame —
            // owner-requested back onto the HUD bay (2026-07-05 round-2 note). Nowhere else.
            <ElectricBorder color={accent} speed={0.4} chaos={0.04} borderRadius={3} className="hud-eb">
              {stage}
            </ElectricBorder>
          )}
        </section>

        {/* ── Telemetry column — numbers are the heroes; every one measured or absent ── */}
        <aside className="hud-ledger">
          <Module
            label={
              strip.kind === "data"
                ? t("home.homeHud.ledger.lastSessionGame", { game: strip.game })
                : t("home.homeHud.ledger.lastSession")
            }
          >
            {strip.kind === "data" ? (
              <>
                <div className="hud-hero">
                  {ringFrac != null && (
                    <div className="hud-ring-wrap">
                      <HudRing
                        frac={ringFrac}
                        color={gradeColor(fpsGrade)}
                        pct={Math.round(ringFrac * 100)}
                      />
                      <span className="hud-ring-cap">
                        {t("home.homeHud.ledger.vsHz", { hz: rig.refreshHz })}
                      </span>
                    </div>
                  )}
                  <div className="hud-hero-num">
                    <span
                      className={`hud-reading hud-mono${gradeClass(fpsGrade)}`}
                      style={gradeInk(fpsGrade)}
                    >
                      {/* A session that did not measure its average shows the absent mark, never a
                          counted-up number (#671). */}
                      {strip.avgFps == null ? (
                        "—"
                      ) : reduced ? (
                        Math.round(strip.avgFps)
                      ) : (
                        <CountUp to={Math.round(strip.avgFps)} duration={0.9} />
                      )}
                    </span>
                    <span className="hud-unit">
                      {t("home.homeHud.ledger.fpsAvg")}
                      {strip.avgFps == null && ` · ${t("home.homeHud.ledger.notMeasured")}`}
                    </span>
                    <span className="hud-note">
                      <Term id="one-percent-lows">{t("home.homeHud.ledger.onePercentLowLabel")}</Term>{" "}
                      <span
                        className={`hud-mono${gradeClass(low1Grade)}`}
                        style={gradeInk(low1Grade)}
                      >
                        {strip.low1Est != null
                          ? Math.round(strip.low1Est)
                          : t("home.homeHud.ledger.notMeasured")}
                      </span>
                      {strip.low1Est != null && ` ${t("home.homeHud.ledger.estimateSuffix")}`}
                    </span>
                  </div>
                </div>
                {sparkValues.length >= 2 && (
                  <div className="hud-trace">
                    <Sparkline values={sparkValues} height={30} stroke="var(--v2-accent)" />
                    <span className="hud-trace-cap">
                      {t("home.homeHud.ledger.traceCaption", { count: sparkValues.length })}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <span className="hud-note">{t("home.homeHud.ledger.noSession")}</span>
            )}
          </Module>

          {/* Above the two readings it qualifies — a caveat printed under its subject has
              already failed at its job. Self-nulling when health is complete or UNKNOWN. */}
          <LedgerHealthNotice health={health} />

          <Module label={t("home.homeHud.ledger.activeChangesLabel")}>
            {activeWithdrawn ? (
              <span className="hud-note">{t("common.ledgerHealth.activeUnknown")}</span>
            ) : inEffect.kind !== "counted" ? (
              <span className="hud-note">{t("common.ledgerHealth.activePending")}</span>
            ) : (
              <>
                <span className="hud-reading hud-mono">
                  {reduced ? inEffect.activeNow : <CountUp to={inEffect.activeNow} duration={0.9} />}
                </span>
                <span className="hud-note">
                  {ledgerUnvouched
                    ? t("common.ledgerHealth.activeChangesUnvouched")
                    : t("home.homeHud.ledger.activeChangesNote")}
                  {inEffect.unknown > 0 &&
                    ` · ${t("common.ledgerHealth.activeUnchecked", { count: inEffect.unknown })}`}
                </span>
              </>
            )}
          </Module>

          <Module label={t("home.homeHud.ledger.trustLedgerLabel")}>
            {ledgerBlank ? (
              <span className="hud-note">{t("common.ledgerHealth.trackedUnknown")}</span>
            ) : (
              <>
                <span className="hud-reading hud-mono">
                  {reduced ? changes.length : <CountUp to={changes.length} duration={0.9} />}
                  <span className="hud-unit">
                    {t("home.homeHud.ledger.changesTracked", { count: changes.length })}
                  </span>
                </span>
                {latest ? (
                  <span className="hud-note hud-note-clip" title={latest.rec_title}>
                    {t("home.homeHud.ledger.latest", { title: latest.rec_title })}{" "}
                    <span className="hud-mono">· {latestTime}</span>
                  </span>
                ) : (
                  <span className="hud-note">{t("home.homeHud.ledger.nothingApplied")}</span>
                )}
              </>
            )}
          </Module>

          <Module label={t("home.homeHud.ledger.driftWatchLabel")}>
            {readiness == null ? (
              <span className="hud-note">{t("home.homeHud.ledger.driftPending")}</span>
            ) : drifts.length === 0 ? (
              <span className="hud-note">
                <span className="hud-led hud-led-ok" aria-hidden="true" />{" "}
                {t("home.homeHud.ledger.driftNone")}
              </span>
            ) : (
              <span className="hud-note hud-note-warn">
                <span className="hud-led hud-led-warn" aria-hidden="true" />{" "}
                {t("home.homeHud.ledger.driftCount", { count: drifts.length })}
                {" · "}
                {seeWhatChanged ?? t("home.homeHud.ledger.driftWhere")}
              </span>
            )}
          </Module>

          <Module label={t("home.homeHud.ledger.driveHealthLabel")}>
            {smartDrives.length === 0 ? (
              <span className="hud-note">{t("home.homeHud.ledger.driveHealthUnknown")}</span>
            ) : flaggedDrives.length === 0 ? (
              <span className="hud-note">
                <span className="hud-led hud-led-ok" aria-hidden="true" />{" "}
                {t("home.homeHud.ledger.driveCountOk", { count: smartDrives.length })}
              </span>
            ) : (
              <span className="hud-note hud-note-warn">
                <span className="hud-led hud-led-warn" aria-hidden="true" />{" "}
                {flaggedDrives[0].friendly_name} — {flaggedDrives[0].health}
                {t("home.homeHud.ledger.driveFlaggedSuffix")}
              </span>
            )}
          </Module>
        </aside>

        {/* ── Priority queue — ranked for THIS hardware; rank numerals are real order ── */}
        <section className="hud-docket">
          <header className="hud-docket-head">
            <span className="hud-eyebrow">{t("home.homeHud.docket.title")}</span>
            <span className="hud-docket-note">{t("home.homeHud.docket.note")}</span>
          </header>
          {priorities == null ? (
            <div className="hud-docket-rows">
              <div className="hud-docket-row">
                <span className="hud-skel hud-skel-rank" />
                <span className="hud-skel hud-skel-line" />
              </div>
              <div className="hud-docket-row">
                <span className="hud-skel hud-skel-rank" />
                <span className="hud-skel hud-skel-line hud-skel-short" />
              </div>
            </div>
          ) : limiters.length === 0 ? (
            <div className="hud-docket-rows">
              <div className="hud-docket-row hud-docket-clear">
                {t("home.homeHud.docket.clean")}
              </div>
            </div>
          ) : (
            <div className="hud-docket-rows">
              {limiters.slice(0, 3).map((l, i) => (
                <div className={`hud-docket-row${i === 0 ? " hud-docket-top" : ""}`} key={l.id}>
                  <span className="hud-rank hud-mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="hud-docket-text">
                    <span className="hud-docket-nm">{l.title}</span>
                    <span className="hud-docket-why">{l.reason}</span>
                  </span>
                  <span
                    className={`hud-pill hud-pill-${i === 0 ? "warn" : (statusTone[l.status] ?? "info")}`}
                  >
                    {i === 0
                      ? t("home.homeHud.docket.biggestLimiter")
                      : <span data-confidence={l.confidence} title={t(confidenceHintKey(wordFromBand(l.confidence)))}>{t(confidenceWordKey(wordFromBand(l.confidence)))}</span>}
                  </span>
                  <button type="button" className="hud-btn hud-btn-ghost" onClick={onSeeInFix}>
                    {t("home.homeHud.docket.seeIn", { room: fixRoomLabel })}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* The guided Setup & Tour front door — quiet, below the answer (parity with HomeV2). */}
        <div className="hud-full">
          <SetupLauncherCard />
        </div>
      </div>
    </RoomShell>
  );
}
