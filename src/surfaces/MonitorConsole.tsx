import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import {
  readDisplayRefreshHz,
  type OverlayDensity,
  readOverlayDensity,
  persistOverlayDensity,
  type OverlayBackdrop,
  readOverlayBackdrop,
  persistOverlayBackdrop,
} from "../design/theme";
import { useDocumentVisible } from "../data/use-document-visible";
import { useReducedMotion } from "../design/use-motion";
import {
  gradeFps,
  gradeLow1,
  gradeFrametimeMs,
  gradeRamPct,
  gradeCpuTempC,
  gradeColor,
  type Grade,
} from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { ArcGauge, type ArcTone } from "../design/console/ArcGauge";
import { Oscilloscope } from "../design/console/Oscilloscope";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { Term } from "../design/Term";
import { BentoGrid, BentoTile } from "../design/bento/BentoGrid";
import { readoutStats, type ReadoutStats } from "./monitor-console-data";
import { DeckScope } from "./monitor/DeckScope";
import { SessionStack } from "./monitor/SessionStack";
import { deckDeltaFrom, fmtDeltaGlyph } from "./monitor/monitor-stack-profile";
import { prettyGameName } from "./game-name";
import type { GpuVendor } from "./walkthroughs";
import "../i18n";
import "./monitor-console.css";

// MonitorConsole — the Monitor room as v5 "Flight Deck + Session Stack" (owner pick 2026-07-11,
// plan 2026-07-11-monitor-v5-deck-stack; replaces the rejected v4 Session Waterfall). ONE face,
// two halves, no mode toggle: the FLIGHT DECK on top (readout strip · the full-width frametime
// scope hero with scrub + drag-zoom · the plain-number session delta row) and the SESSION STACK
// below (every recent session a flat row on ONE shared 1%-low axis — the stack IS the session
// shelf). Chain law from v3→v4: no depth/perspective over data ink on this face, ever again.
// THE room's only Live face since the 2026-08-20 comprehensibility sweep (issue #180): the
// Basic/Advanced fork and the compy_monitor_console rollout flag are retired — one face, always
// the full cluster (pinned by monitor-one-face-guard.test.tsx).
//
// Honesty contract: presentation only over the SAME audited read-only polls MonitorBasic /
// Play's live card run — the identical three 1 Hz commands, cadence, cancellation, and
// visibility gate, ported verbatim (zero new IPC, zero src-tauri). Every instrument value
// traces to a real sample: the fps trace buffers the real polled capture samples (cleared the
// moment the helper stops — a frozen trace can never pose as live), the frametime trace draws
// the backend's real per-frame window (recent_frametimes_ms, the same stream the Overlay
// draws), and gauges render null as ArcGauge's honest NOT-YET — never a fabricated 0. GPU temp
// tone is vendor-gated via gradeGpuTempForVendor (NVIDIA stays ungraded — LOCKED rule 5).

type CpuSnap = {
  usage_overall_pct: number;
  frequency_mhz: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
};
type GpuSnap = { vendor?: string; temperature_c: number | null; utilization_gpu_pct: number | null };
// Same wire shape monitor-panels/Overlay already type — real backend fields, nothing invented.
type FpsSample = {
  fps: number;
  low1_fps: number;
  avg_frametime_ms: number;
  recent_frametimes_ms: number[];
};
type FpsLite = { active: boolean; status: string; sample: FpsSample | null };

// Same corner set as Play's overlay config (ported, not forked).
const CORNERS: [string, string][] = [
  ["top-left", "↖"],
  ["top-right", "↗"],
  ["bottom-left", "↙"],
  ["bottom-right", "↘"],
];

// Hottest GPU wins (same pick rule as MonitorBasic / Play's live card).
function pickGpu(list: GpuSnap[]): GpuSnap | null {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => (b.temperature_c ?? -1) - (a.temperature_c ?? -1))[0];
}

// Corner id ("top-left" etc.) → its translated label. A lookup (not a literal word-swap of the
// id) because natural phrasing per locale isn't a mechanical translation of "top"/"left".
function cornerLabel(t: TFunction, c: string): string {
  switch (c) {
    case "top-left":
      return t("monitor.monitorConsole.cornerTopLeft");
    case "top-right":
      return t("monitor.monitorConsole.cornerTopRight");
    case "bottom-left":
      return t("monitor.monitorConsole.cornerBottomLeft");
    default:
      return t("monitor.monitorConsole.cornerBottomRight");
  }
}

// Grade → ArcGauge/Oscilloscope tone — HomeConsole's mapping: "ok" rides the accent (fine, not
// celebrated), "bad" warns; neutral never borrows a judgment color.
const arcTone = (g: Grade): ArcTone =>
  g === "good" ? "good" : g === "ok" ? "accent" : g === "bad" ? "warn" : "neutral";

// The fps trace window: 1 Hz polled samples, so ~2 minutes of capture history.
const FPS_CAP = 120;
// The frametime window is the backend's own cap (MAX_FRAMETIME_POINTS in fps.rs).
const FT_CAP = 240;

export function MonitorConsole({
  active,
  vendor = "any",
  sessions = [],
  onFpsActive,
}: {
  active: boolean;
  vendor?: GpuVendor;
  /** Session history (newest-first): the stack's rows + the deck's delta row prior. */
  sessions?: SessionSummary[];
  /** Mirrors the room's live capture state up to MonitorV2 (the V2-8 forward-door rule). */
  onFpsActive?: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [cpu, setCpu] = useState<CpuSnap | null>(null);
  // C-19 — CPU TEMPERATURE ON THE DEFAULT FACE. It was not on this face in either mode, and the
  // surface that did have it (CpuMonitorPanel, via MonitorDomainCards) hangs off Play's
  // `deepMonitoring` slot, which only renders while `showLive` — and Play itself only mounts at
  // advanced+Sessions, where `showLive` is false. So the reading had no path at all on default
  // flags. Backend-memoised (cpu_temp.rs), so joining this 1 Hz tick costs a shared-memory read,
  // or one WMI probe per 15s on a machine with no monitor app.
  const [cpuTemp, setCpuTemp] = useState<{ temp_c: number } | null>(null);
  const [gpu, setGpu] = useState<GpuSnap | null>(null);
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  // In-game overlay — the SAME audited commands Play's live face runs, ported verbatim (owner
  // §A0 item 1: the control must exist on the console face). Density/backdrop joined the row
  // 2026-07-15 (the last §A0 item-1 residual): same persist helpers Settings/Play use — the
  // overlay window reacts via the cross-window `storage` event, zero new IPC.
  const [overlayOn, setOverlayOn] = useState(false);
  const [corner, setCorner] = useState<string>(
    () => localStorage.getItem("compy_overlay_corner") ?? "top-left",
  );
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [backdrop, setBackdrop] = useState<OverlayBackdrop>(readOverlayBackdrop);
  // Caller-owned trace buffer (Oscilloscope is a pure render): real polled fps values only.
  const fpsH = useRef<number[]>([]);
  // The frametime window with a CONTENT-STABLE reference (self-review round-1 catch, bug→guard):
  // every 1 Hz poll deserializes a fresh array even when the frames didn't change, and a
  // reference-new-but-equal array rebuilt the ribbon geometry + repainted the demand-mode canvas
  // every tick. Keep the previous array unless the VALUES differ, so downstream memos hold.
  const ftWin = useRef<number[]>([]);
  const visible = useDocumentVisible();
  const stageRef = useRef<HTMLDivElement>(null);

  // Cursor-follow spotlight (Phase 2's exact mechanism, event-driven — no rAF loop): the
  // pointer handler writes --glow-x/--glow-y/--glow-intensity on the instrument stage; a
  // border-masked ::after consumes them. Reduced pins intensity to 0 (still page).
  // Deliberately NO parallax over the traces — readability outranks depth on a data surface.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (reduced) {
      stage.style.setProperty("--glow-intensity", "0");
      return;
    }
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      stage.style.setProperty("--glow-x", `${nx * 100}%`);
      stage.style.setProperty("--glow-y", `${ny * 100}%`);
      stage.style.setProperty("--glow-intensity", "1");
      // v3 depth chrome (§A0 item 5 amendment): the WHOLE stage tilts a few degrees toward the
      // pointer — a uniform transform, so plot ink and grid move together and a spike's position
      // never lies (the "depth moves the panel, never warps the data ink" rail).
      stage.style.setProperty("--tilt-x", `${(-(ny * 2 - 1) * 2).toFixed(2)}deg`);
      stage.style.setProperty("--tilt-y", `${((nx * 2 - 1) * 2.5).toFixed(2)}deg`);
    };
    const onLeave = () => {
      stage.style.setProperty("--glow-intensity", "0");
      stage.style.setProperty("--tilt-x", "0deg");
      stage.style.setProperty("--tilt-y", "0deg");
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  // Same 1 Hz read-only poll as MonitorBasic / Play live — verbatim commands, cadence,
  // cancellation, and the tab+window visibility gate (sensors idle in the background).
  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    const tick = () => {
      invoke<CpuSnap>("get_cpu_sensors").then((c) => !cancelled && c && setCpu(c)).catch(() => {});
      invoke<GpuSnap[]>("get_gpu_sensors").then((g) => !cancelled && setGpu(pickGpu(g))).catch(() => {});
      invoke<{ temp_c: number } | null>("get_cpu_temp")
        .then((c) => !cancelled && setCpuTemp(c ?? null))
        .catch(() => !cancelled && setCpuTemp(null));
      invoke<FpsLite>("get_fps_status")
        .then((f) => {
          if (cancelled || !f) return;
          // Honesty rail: buffer only live real samples; the moment the helper reports stopped
          // the buffer clears, so the trace goes to its no-signal state (never frozen-as-live).
          if (f.active && f.sample) {
            fpsH.current = [...fpsH.current, f.sample.fps].slice(-FPS_CAP);
            const next = f.sample.recent_frametimes_ms;
            const prev = ftWin.current;
            if (prev.length !== next.length || prev.some((v, i) => v !== next[i])) {
              ftWin.current = next;
            }
          } else if (!f.active) {
            // Idempotent reset (v4 self-review round-1 catch): a fresh [] every idle tick is a
            // NEW reference — it broke the content-stable contract below and repainted the
            // waterfall canvas at 1 Hz while stopped. Reassign only on the actual transition.
            if (fpsH.current.length !== 0) fpsH.current = [];
            if (ftWin.current.length !== 0) ftWin.current = [];
          }
          setFps(f);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, visible]);

  // V2-8: mirror the already-polled capture state up to the shell (no-op without the callback).
  const fpsActive = fps?.active ?? false;
  useEffect(() => {
    onFpsActive?.(fpsActive);
  }, [onFpsActive, fpsActive]);

  // Reflect the actual overlay window state (existing command, same read Play makes).
  useEffect(() => {
    invoke<boolean>("overlay_visible").then(setOverlayOn).catch(() => {});
  }, [active]);

  const toggleOverlay = async () => {
    try {
      if (overlayOn) {
        await invoke("hide_overlay");
        setOverlayOn(false);
      } else {
        await invoke("show_overlay");
        setOverlayOn(true);
        invoke("set_overlay_corner", { corner }).catch(() => {});
      }
    } catch {
      /* leave as-is */
    }
  };

  const chooseCorner = async (c: string) => {
    setCorner(c);
    localStorage.setItem("compy_overlay_corner", c);
    try {
      await invoke("set_overlay_corner", { corner: c });
    } catch {
      /* applies next time the overlay is shown */
    }
  };

  // Density/backdrop persist to localStorage; the overlay (separate window) reacts via `storage`.
  const chooseDensity = (d: OverlayDensity) => {
    setDensity(d);
    persistOverlayDensity(d);
  };
  const chooseBackdrop = (b: OverlayBackdrop) => {
    setBackdrop(b);
    persistOverlayBackdrop(b);
  };

  // The existing audited capture commands — identical semantics to MonitorBasic/Play's button.
  const toggleCapture = useCallback(async () => {
    setFpsBusy(true);
    try {
      if (fps?.active) {
        await invoke("stop_fps_capture");
        fpsH.current = [];
        ftWin.current = [];
        setFps((p) => (p ? { ...p, active: false, sample: null } : p));
      } else {
        await invoke("start_fps_capture");
      }
    } catch {
      /* surfaced via the next poll */
    } finally {
      setFpsBusy(false);
    }
  }, [fps?.active]);

  const rig = { refreshHz: readDisplayRefreshHz() };
  const sample = fps?.sample ?? null;
  const live = fpsActive && sample != null;
  const ramPct = cpu?.ram_total_bytes
    ? Math.round((cpu.ram_used_bytes / cpu.ram_total_bytes) * 100)
    : null;
  // The deck's delta row is SESSION-scoped, not live-scoped: it debriefs the last COMPLETED
  // session against its comparable prior, so it holds steady while capture starts/stops.
  const deck = deckDeltaFrom(sessions);

  const gpuGrade = gradeGpuTempForVendor(vendor, gpu?.temperature_c ?? null);
  const low1Grade: Grade = sample ? gradeLow1(sample.low1_fps, sample.fps) : "neutral";

  // v3 (UI_VISION_BACKLOG §A0): the frame budget for THIS rig's display — the spike detector's
  // floor and the trace's budget line. Consumer-term readouts derive from the same real windows.
  const ftBudget = rig.refreshHz ? 1000 / rig.refreshHz : undefined;
  const stats: ReadoutStats = live
    ? readoutStats(fpsH.current, ftWin.current, ftBudget)
    : { maxFps: null, avgFps: null, lowestLatencyMs: null, spikeCount: null };
  const ink = (g: Grade) => {
    const c = gradeColor(g);
    return c ? { color: c } : undefined;
  };

  return (
    <div className="monitor-console" data-motion={reduced ? "reduced" : "full"}>
      {/* The room's real capture control — same audited toggle the classic tiles carry. */}
      <div className="mc-capture">
        <button
          type="button"
          className={`mc-cap ${fpsActive ? "mc-cap-on" : ""}`}
          disabled={fpsBusy}
          onClick={toggleCapture}
        >
          {fpsBusy ? "…" : fpsActive ? t("monitor.monitorConsole.stopCapture") : t("monitor.monitorConsole.startCapture")}
        </button>
        <span className="mc-cap-status" style={live ? { color: gradeColor(low1Grade) || undefined } : undefined}>
          {live ? (
            <>
              {Math.round(sample.low1_fps)} <Term id="one-percent-lows">{t("monitor.monitorConsole.oneLowTermLabel")}</Term>{t("monitor.monitorConsole.estSuffix")}
            </>
          ) : fps?.status === "declined" ? (
            t("monitor.monitorConsole.declinedStatus")
          ) : fpsActive ? (
            t("monitor.monitorConsole.capturingStatus")
          ) : (
            t("monitor.monitorConsole.idleStatus")
          )}
        </span>
        {/* The in-game overlay's control — the room's other real action (§A0 item 1). */}
        <span className="mc-ov">
          <button
            type="button"
            className={`mc-cap ${overlayOn ? "mc-cap-on" : ""}`}
            onClick={toggleOverlay}
          >
            {overlayOn ? t("monitor.monitorConsole.overlayOn") : t("monitor.monitorConsole.overlayLabel")}
          </button>
          {overlayOn && (
            <>
              {CORNERS.map(([c, glyph]) => (
                <button
                  key={c}
                  type="button"
                  className={`mc-ov-corner ${corner === c ? "mc-ov-corner-on" : ""}`}
                  aria-label={t("monitor.monitorConsole.overlayCornerAria", { corner: cornerLabel(t, c) })}
                  onClick={() => chooseCorner(c)}
                >
                  {glyph}
                </button>
              ))}
              <span className="mc-ov-group" role="group" aria-label={t("monitor.monitorConsole.overlayDensityAria")}>
                {(["minimal", "standard", "full"] as OverlayDensity[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`mc-ov-seg ${density === d ? "mc-ov-seg-on" : ""}`}
                    aria-pressed={density === d}
                    onClick={() => chooseDensity(d)}
                  >
                    {d === "minimal"
                      ? t("monitor.monitorConsole.densityMin")
                      : d === "standard"
                        ? t("monitor.monitorConsole.densityStd")
                        : t("monitor.monitorConsole.densityFull")}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className={`mc-ov-seg ${backdrop === "on" ? "mc-ov-seg-on" : ""}`}
                aria-pressed={backdrop === "on"}
                aria-label={t("monitor.monitorConsole.overlayBackgroundAria")}
                onClick={() => chooseBackdrop(backdrop === "on" ? "off" : "on")}
              >
                {t("monitor.monitorConsole.backdropLabel")}
              </button>
            </>
          )}
        </span>
      </div>

      {/* THE INSTRUMENT STAGE — the signature instruments: the motion IS the data, real
          buffered samples only. Spotlight + reticle live here; NO hologram, NO parallax. */}
      <div className="mc-stage" ref={stageRef}>
        {/* BENTO (2026-08-12) — the stage's four instrument clusters become tiles of deliberately
            unequal weight, so the eye is told where to start (the frametime deck). The grid lives
            INSIDE .mc-stage on purpose: stageRef feeds <ReticleCursor scopeRef> and the pointer
            tilt, so the tracking area must stay exactly the stage it always was. Strict row-major,
            no dense flow: hero(7)+half(5) fills row 1, hero's second row +half(5) fills row 2,
            full(12) closes it — no holes at any width.
            The conditional delta row is folded INSIDE the hero rather than given its own tile:
            without a prior session a conditional TILE would leave a visible gap. */}
        <BentoGrid className="mc-bento">
          <BentoTile title={t("monitor.monitorConsole.bento.deck")} span="hero">
            {/* THE HERO — the full-width frametime scope (v5 Flight Deck): real ms axis, dashed
                budget line, exact-moment spike pins, hover scrub + drag-zoom (ported from the
                deleted waterfall's front trace). Always mounted — it carries its own honest empty. */}
            <DeckScope
              ftWin={ftWin.current}
              live={live}
              budget={ftBudget}
              tone={live ? arcTone(gradeFrametimeMs(sample.avg_frametime_ms, rig)) : "accent"}
              reduced={reduced}
              cap={FT_CAP}
            />

            {/* The deck's plain-number delta row — recorded facts only; renders NOTHING without a
                prior session, and a cross-game prior is labeled so a genre gap never reads as a
                regression (the v4 law, carried). */}
            {deck && (
              <div className="mc-delta">
                <span className="mc-delta-k">
                  {t("monitor.monitorConsole.vsLastSession", {
                    game: (prettyGameName(deck.prev.process_name) || t("monitor.monitorConsole.unknownGame")).toUpperCase(),
                  })}
                  {!deck.sameGame && t("monitor.monitorConsole.differentGameTag")}
                </span>
                <span className="mc-delta-v">{t("monitor.monitorConsole.avgFpsLabel")} {fmtDeltaGlyph(deck.avgFps)}</span>
                <span className="mc-delta-v">{t("monitor.monitorConsole.oneLowCapsLabel")} {fmtDeltaGlyph(deck.low1)}</span>
                <span className="mc-delta-v">{t("monitor.monitorConsole.spikesLabel")} {fmtDeltaGlyph(deck.spikes)}</span>
                {deck.changesOn > 0 && (
                  // Honesty caveat (consumer panel 2026-07-14): with >1 change on, these deltas are
                  // the COMBINED effect — never imply per-change attribution. The one-change-at-a-time
                  // answer is the Lab's A/B benchmark, and the tooltip says so.
                  <span
                    className="mc-delta-tag"
                    title={
                      deck.changesOn > 1
                        ? t("monitor.monitorConsole.combinedEffectTooltip")
                        : undefined
                    }
                  >
                    {t("monitor.monitorConsole.changesOn", { count: deck.changesOn })}
                    {deck.changesOn > 1 && t("monitor.monitorConsole.combinedEffectTag")}
                  </span>
                )}
              </div>
            )}
          </BentoTile>

          <BentoTile title={t("monitor.monitorConsole.bento.readouts")} span="half">
            {/* Consumer-term readouts (owner direction §A0 item 6) — measured values only, em-dash
                when nothing is measured. Same windows the traces draw; spike count = the SAME
                detector as the markers (one source, can't disagree). */}
            <div className="mc-readouts">
              <div className="mc-readout">
                <span className="mc-readout-v" style={ink(gradeFps(stats.maxFps, rig))}>
                  {stats.maxFps == null ? "—" : Math.round(stats.maxFps)}
                </span>
                <span className="mc-readout-k">{t("monitor.monitorConsole.maxFpsLabel")}</span>
              </div>
              <div className="mc-readout">
                <span className="mc-readout-v" style={ink(gradeFps(stats.avgFps, rig))}>
                  {stats.avgFps == null ? "—" : Math.round(stats.avgFps)}
                </span>
                <span className="mc-readout-k">{t("monitor.monitorConsole.avgFpsLabel")}</span>
              </div>
              <div className="mc-readout">
                <span
                  className="mc-readout-v"
                  style={ink(gradeFrametimeMs(stats.lowestLatencyMs, rig))}
                >
                  {stats.lowestLatencyMs == null ? "—" : `${stats.lowestLatencyMs.toFixed(1)} ms`}
                </span>
                <span className="mc-readout-k">{t("monitor.monitorConsole.lowestLatencyLabel")}</span>
              </div>
              <div className="mc-readout">
                <span
                  className="mc-readout-v"
                  style={stats.spikeCount ? ink("bad") : undefined}
                >
                  {stats.spikeCount == null ? "—" : stats.spikeCount}
                </span>
                <span className="mc-readout-k">{t("monitor.monitorConsole.spikesLabel")}</span>
              </div>
            </div>
          </BentoTile>

          <BentoTile title={t("monitor.monitorConsole.bento.gauges")} span="half">
            {/* Honest gauges over the same sensor reads the tiles surface; null ⇒ NOT-YET, never 0.
                CPU utilisation stays deliberately ungraded (high while gaming is fine). */}
            <div className="mc-gauges">
              <ArcGauge
                label={t("monitor.monitorConsole.gpuTempLabel")}
                value={gpu?.temperature_c ?? null}
                max={100}
                unit="°C"
                tone={arcTone(gpuGrade)}
                measured={gpu?.temperature_c != null}
              />
              <ArcGauge
                label={t("monitor.monitorConsole.gpuLoadLabel")}
                value={gpu?.utilization_gpu_pct ?? null}
                max={100}
                unit="%"
                tone="neutral"
                measured={gpu?.utilization_gpu_pct != null}
              />
              {/* Beside the GPU's temperature, because "is it running hot" is ONE question with
                  two answers. Null renders ArcGauge's honest NOT-YET; the ladder that turns that
                  into a fix (CpuTempOffer) lives on Home's CPU callout, so the same offer is not
                  printed twice (one-mention law). */}
              <ArcGauge
                label={t("monitor.monitorConsole.cpuTempLabel")}
                value={cpuTemp ? Math.round(cpuTemp.temp_c) : null}
                max={100}
                unit="°C"
                tone={arcTone(gradeCpuTempC(cpuTemp?.temp_c ?? null))}
                measured={cpuTemp != null}
              />
              <ArcGauge
                label={t("monitor.monitorConsole.cpuLabel")}
                value={cpu ? Math.round(cpu.usage_overall_pct) : null}
                max={100}
                unit="%"
                tone="neutral"
                measured={cpu != null}
              />
              <ArcGauge
                label={t("monitor.monitorConsole.ramLabel")}
                value={ramPct}
                max={100}
                unit="%"
                tone={arcTone(gradeRamPct(ramPct))}
                measured={ramPct != null}
              />
            </div>
          </BentoTile>

          <BentoTile title={t("monitor.monitorConsole.bento.scope")} span="full">
            <div className="mc-scopes">
              <Oscilloscope
                samples={live ? fpsH.current : []}
                cap={FPS_CAP}
                label={t("monitor.monitorConsole.fpsScopeLabel")}
                unit="fps"
                tone={live ? arcTone(gradeFps(sample.fps, rig)) : "accent"}
                reduced={reduced}
              />
            </div>
          </BentoTile>
        </BentoGrid>

        {/* The game-HUD Target Cursor, stage-scoped (kit handles reduced/coarse-pointer null
            + the rAF pointerleave stop — Phase-1's review fix). */}
        <ReticleCursor scopeRef={stageRef} />
      </div>

      {/* Same honesty micro-line the classic face carries — method stated. */}
      <p className="mc-honest">
        <Term id="etw">{t("monitor.monitorConsole.etwEmph")}</Term>{t("monitor.monitorConsole.etwHonestyPost")}
      </p>

      {/* THE SESSION STACK — the face's second half (the stack IS the session shelf): every
          recent session a flat row on ONE shared axis. */}
      <SessionStack sessions={sessions} reduced={reduced} />
    </div>
  );
}

export default MonitorConsole;
