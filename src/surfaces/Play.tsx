import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary, Priorities, Recommendation, AppliedChange } from "../types";
import {
  type OverlayDensity,
  type OverlayBackdrop,
  readOverlayDensity,
  persistOverlayDensity,
  readOverlayBackdrop,
  persistOverlayBackdrop,
  readDisplayRefreshHz,
} from "../design/theme";
import { SessionDebrief } from "./SessionDebrief";
import { SessionTrends } from "./SessionTrends";
import { LiveCharts } from "./LiveCharts";
import { readMonitorCards } from "../design/theme";
import { prettyGameName } from "./game-name";
import { Term } from "../design/Term";
import { type GpuVendor } from "./walkthroughs";
import {
  gradeFps,
  gradeLow1,
  gradeFrametimeMs,
  gradeColor,
  type Grade,
} from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { useDocumentVisible } from "../data/use-document-visible";
import { knownFps } from "../lib/session-metrics";
import "../i18n";
import "./Play.css";

// PLAY — live + debrief (halfway-home §1: navigation never teleports). The live-monitor card +
// overlay controls operate the SAME backend state via the SAME existing commands; session rows
// expand IN PLACE into the full existing debrief (no route to another tab). Zero new IPC.

type GpuLite = { vendor?: string; temperature_c: number | null; utilization_gpu_pct: number | null };
type CpuLite = { usage_overall_pct: number };
type FpsLite = { active: boolean; status: string; sample: { fps: number; low1_fps: number } | null };
type ArmedLite = { game: string } | null;

const CORNERS: [string, string][] = [
  ["top-left", "↖"],
  ["top-right", "↗"],
  ["bottom-left", "↙"],
  ["bottom-right", "↘"],
];

function pickGpu(list: GpuLite[]): GpuLite | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => (b.temperature_c ?? -1) - (a.temperature_c ?? -1))[0];
}

// Exported for MonitorBasic (P2 Basic tiles' last-session line) — same verdict/duration wording
// everywhere, one source. Rendering here is unchanged.
export function shortVerdict(s: SessionSummary): string {
  // Derive the headline from the SAME grade thresholds gradeLow1 uses so the colored 1%-low number and
  // this word can never contradict (previously shortVerdict had its own 0.75/0.55 cuts vs gradeLow1's
  // 0.7/0.5 — at ratio 0.72 the number rendered green "good" next to a "Some dips" headline). neutral
  // (missing data → no color on the number) maps to the non-committal middle, so no contradiction exists.
  switch (gradeLow1(s.low1_fps_est, s.avg_fps)) {
    case "good":
      return "Smooth";
    case "bad":
      return "Rough";
    default:
      return "Some dips"; // "ok" and "neutral"
  }
}

// Display-only i18n label for shortVerdict()'s grade. shortVerdict() itself must keep returning
// the literal English "Smooth" / "Rough" / "Some dips" strings unchanged — monitor-v2-data.ts
// compares its result with === to pick the headline sentence, and that composed sentence is
// pinned verbatim by monitor-v2.test.tsx. This helper only picks which translated word to RENDER;
// it never feeds back into shortVerdict's own return value or any comparison.
export function verdictLabel(t: TFunction, s: SessionSummary): string {
  // The grade IS the 1%-low/average ratio, so without both readings there is nothing to grade.
  // shortVerdict's non-committal "Some dips" would otherwise describe a session nobody measured.
  if (knownFps(s.avg_fps) == null || knownFps(s.low1_fps_est) == null) {
    return t("monitor.play.notGradedVerdict");
  }
  const grade = shortVerdict(s);
  return grade === "Smooth"
    ? t("monitor.play.smoothVerdict")
    : grade === "Rough"
      ? t("monitor.play.roughVerdict")
      : t("monitor.play.someDipsVerdict");
}

export function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

/**
 * The same duration with the seconds dropped — "13m", not "13m 24s" (02-live-approved.png).
 * For the places a length is CONTEXT rather than a measurement: how long the session ran, how
 * far back the trace reaches. Nothing on this screen is decided on those seconds, and reading
 * them costs the eye a beat every time it passes. Under a minute it still says seconds,
 * because "0m" is worse than the precision it saves. `fmtDur` stays exact for the session
 * list and everywhere else a duration is the fact itself.
 */
export function fmtDurCoarse(sec: number): string {
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}h ${Math.floor((sec % 3600) / 60)}m`;
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m` : `${sec}s`;
}

// Inline color for a graded metric value — applied only when the grade is non-neutral (neutral
// inherits). Same hardware-tailored grading as Home / SessionDebrief / Overlay, so the SAME metric
// reads the same green/amber/red everywhere. Utilisation (CPU/GPU %) stays ungraded by design.
function gradeStyle(g: Grade): { color: string } | undefined {
  const c = gradeColor(g);
  return c ? { color: c } : undefined;
}

// A session aggregate is printed only when it is a reading (knownFps: finite and above zero); the
// sampler's unknown is 0, so anything else is the em dash, never "0" (#656, #608). Average
// frametime follows the same rule — a 0.0 ms frame is not a measurement either.
const fmtReading = (v: unknown, digits = 0) => {
  const k = knownFps(v);
  return k == null ? "—" : k.toFixed(digits);
};

export default function Play({
  active,
  sessions,
  sessionsSeenAt,
  priorities,
  recs,
  apply,
  busyId,
  onExport,
  changes,
  rollback,
  activeChangeFor,
  vendor = "any",
  peakTempVendor,
  view = "all",
  onFpsActive,
  v2 = false,
}: {
  active: boolean;
  sessions: SessionSummary[];
  sessionsSeenAt: string;
  priorities: Priorities | null;
  recs: Recommendation[];
  /** Resolves true only when the apply was recorded. */
  apply: (rec: Recommendation) => Promise<boolean>;
  busyId: string | null;
  onExport: () => void;
  changes: AppliedChange[];
  /** Resolves true only when the undo was recorded. */
  rollback: (c: AppliedChange) => Promise<boolean>;
  // BACKLOG:236 Ledger half (additive — absent = prose only): resolves a rec id to its still-active
  // ledger row so the session debrief's "next test" can carry a real rollback button. Same pair
  // (`activeChangeFor` + `rollback`) the Fix/Optimize surfaces already take.
  activeChangeFor?: (recId: string) => AppliedChange | undefined;
  vendor?: GpuVendor;
  /** The vendor a session's PEAK GPU temperature is graded under (`sessionPeakVendor`): a peak is the
   *  hottest reading across every adapter, so any NVIDIA adapter keeps it ungraded (LOCKED rule 5).
   *  Absent → `vendor`, as before. */
  peakTempVendor?: string | null;
  // Monitor restructure (spec 2026-06-21): the Monitor shell renders Play twice under a segmented
  // control. "all" (default) = today's whole surface byte-identical (flag-off path); "sessions" = the
  // session list + trends only (no live cards/charts); "live" = the live monitor + overlay + deep
  // monitoring only (no sessions). Mirrors Fix's `view`.
  view?: "all" | "sessions" | "live";
  // V2-8 (additive — absent = classic byte-identical): reports the polled FPS-capture state up so
  // the V2 Monitor room can close its forward door during a live session (P6 §2). Same
  // get_fps_status read the live card already makes — no second IPC, nothing new polled.
  onFpsActive?: (active: boolean) => void;
  // V2-9 (additive — absent = classic byte-identical): under the v2 room the RoomShell measured
  // line already states "N sessions on record", so the History & trends header drops its own
  // count (one screen never states the same fact twice — the punch (j) law).
  v2?: boolean;
}) {
  const { t } = useTranslation();
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [gpu, setGpu] = useState<GpuLite | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [backdrop, setBackdrop] = useState<OverlayBackdrop>(readOverlayBackdrop);
  const [corner, setCorner] = useState<string>(
    () => localStorage.getItem("compy_overlay_corner") ?? "top-left",
  );
  const [armed, setArmed] = useState<ArmedLite>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Live view collapses the overlay config (density/background/corner) behind a toggle so the landing
  // shows just the on/off button; "all" (flag-off) keeps it inline (byte-identical).
  const [overlayCfgOpen, setOverlayCfgOpen] = useState(false);

  // Hardware-tailored grade context (this rig's monitor refresh) — the same source SessionDebrief
  // uses, so Play's FPS/frametime grade matches Home / debrief / overlay.
  const rig = { refreshHz: readDisplayRefreshHz() };
  const visible = useDocumentVisible();
  // NVIDIA NVML sensors aren't hardware-verified yet (LOCKED rule #5) — don't grade their temp as
  // authoritative; AMD/unknown stay graded. Routed through the shared gpu-sensor helper (one source).
  // A session peak has no adapter on record, so it grades under peakTempVendor; the live reading is
  // one snapshot, so it grades under the vendor whose sensor produced it (codebase review 2026-11-03).
  const peakGrade = (c: number | null | undefined): Grade => gradeGpuTempForVendor(peakTempVendor ?? vendor, c);

  // Live readout — same sensor commands the Monitoring tab uses, polled only while Play is active AND
  // the live view is actually showing. On the Sessions segment (the default landing) the live cards
  // aren't rendered, so polling there was pure waste that also kept the backend sensor threads awake —
  // demand-gate it on the segment, not just the tab. (LiveCharts + the deep MonitoringTab are already
  // mount-gated on `showLive`, so they never polled on Sessions; this closes the last segment-leak.)
  // Q7 idle-cost: and only while the window is on screen — a minimized/alt-tabbed window keeps both
  // `active` and `view` unchanged, so without this the live cards poll three sensors a second for
  // the whole time the user is inside a game.
  useEffect(() => {
    if (!active || view === "sessions" || !visible) return;
    let cancelled = false;
    const tick = () => {
      invoke<GpuLite[]>("get_gpu_sensors").then((g) => !cancelled && setGpu(pickGpu(g))).catch(() => {});
      invoke<CpuLite>("get_cpu_sensors")
        .then((c) => !cancelled && setCpu(Math.round(c.usage_overall_pct)))
        .catch(() => {});
      invoke<FpsLite>("get_fps_status").then((f) => !cancelled && setFps(f)).catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, view, visible]);

  // V2-8: mirror the already-polled capture state up to the shell (no-op without the callback).
  const fpsActive = fps?.active ?? false;
  useEffect(() => {
    onFpsActive?.(fpsActive);
  }, [onFpsActive, fpsActive]);

  // Reflect the actual overlay window state + any armed comparison (existing commands).
  useEffect(() => {
    invoke<boolean>("overlay_visible").then(setOverlayOn).catch(() => {});
    invoke<ArmedLite>("get_armed_comparison").then(setArmed).catch(() => {});
  }, [active, sessions]);

  const toggleCapture = useCallback(async () => {
    setFpsBusy(true);
    try {
      if (fps?.active) {
        await invoke("stop_fps_capture");
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

  const chooseDensity = (d: OverlayDensity) => {
    setDensity(d);
    persistOverlayDensity(d); // overlay window reacts via the cross-window storage event
  };
  const chooseBackdrop = (b: OverlayBackdrop) => {
    setBackdrop(b);
    persistOverlayBackdrop(b); // same relay as density
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

  const sample = fps?.sample ?? null;
  const latest = sessions[0] ?? null;
  const heroAvg = knownFps(latest?.avg_fps);
  const heroLow = knownFps(latest?.low1_fps_est);
  const heroFt = knownFps(latest?.avg_frametime_ms);

  // Monitor restructure: which half(s) to render. "all" (flag-off) shows both, byte-identical to today.
  const showLive = view !== "sessions";
  const showSessions = view !== "live";
  // Live view collapses the overlay config; "all" keeps it inline.
  const collapseOverlayCfg = view === "live";
  const overlayCfgVisible = !collapseOverlayCfg || overlayOn || overlayCfgOpen;

  return (
    <section className="play-root">
      {/* The standalone "Monitor" title only shows in the classic (flag-off) surface; inside the merged
          Monitor shell the Sessions/Live segment label provides the context (no stacked headings). */}
      {view === "all" && (
        <header className="play-head">
          {/* Room label — owned by the rail (common.json), not re-translated here. */}
          <h2 className="play-title">{t("common.rail.play", "Monitor")}</h2>
          <p className="play-sub">{t("monitor.play.subtitle")}</p>
        </header>
      )}

      {/* Last-session hero — the Sessions face surfaces the debrief that's otherwise buried below. */}
      {view === "sessions" && latest && (
        <div className="play-hero">
          <div className="play-hero-top">
            <span className="play-hero-game">{prettyGameName(latest.process_name) || t("monitor.play.lastSessionFallback")}</span>
            {/* "live estimate" = the F3 honesty framing, re-homed from the room verdict sub
                (title-header law 2026-07-10): a 1 Hz sampler's grade never overclaims benchmark
                precision, and the hero is where that grade lives now. */}
            <span className="play-hero-verdict">
              {t("monitor.play.heroVerdict", {
                verdict: verdictLabel(t, latest),
                duration: fmtDur(latest.duration_secs),
              })}
            </span>
          </div>
          <div className="play-hero-metrics">
            <div className="play-hero-metric">
              <span className="play-hero-value" style={heroAvg == null ? undefined : gradeStyle(gradeFps(heroAvg, rig))}>{fmtReading(heroAvg)}</span>
              <span className="play-hero-label"><Term id="hz-vs-fps">{t("monitor.play.avgFpsTermLabel")}</Term></span>
            </div>
            <div className="play-hero-metric">
              <span className="play-hero-value" style={heroLow == null || heroAvg == null ? undefined : gradeStyle(gradeLow1(heroLow, heroAvg))}>{fmtReading(heroLow)}</span>
              <span className="play-hero-label"><Term id="one-percent-lows">{t("monitor.play.oneLowTermLabel")}</Term>{t("monitor.play.estSuffix")}</span>
            </div>
            <div className="play-hero-metric">
              <span className="play-hero-value" style={heroFt == null ? undefined : gradeStyle(gradeFrametimeMs(heroFt, rig))}>{fmtReading(heroFt, 1)}</span>
              <span className="play-hero-label">ms <Term id="frametime">{t("monitor.play.frametimeTermLabel")}</Term></span>
            </div>
            <div className="play-hero-metric">
              <span className="play-hero-value" style={gradeStyle(peakGrade(latest.peak_gpu_temp_c))}>{latest.peak_gpu_temp_c == null ? "—" : `${latest.peak_gpu_temp_c}°C`}</span>
              <span className="play-hero-label">{t("monitor.play.peakGpuLabel")}</span>
            </div>
          </div>
        </div>
      )}

      {/* Live telemetry charts (dashboard energy) — rolling CPU/GPU/memory from real sensors. dash_v2.
          Superseded by the T3 domain cards (same three domains + Cores, one-click detail): when
          compy_monitor_cards is ON, LiveCharts yields — one screen never shows the same domain
          headlines twice (self-review catch, 2026-07-06). */}
      {showLive &&
        !readMonitorCards() &&
        typeof document !== "undefined" &&
        document.documentElement.dataset.dashV2 === "on" && <LiveCharts />}

      {showLive && (
      <div className="play-cards">
        {/* Live monitor card */}
        <div className="play-card">
          <div className="play-card-head">
            <span className="play-card-title">{t("monitor.play.liveMonitorTitle")}</span>
            <button
              className={`play-btn ${fps?.active ? "play-btn-on" : ""}`}
              disabled={fpsBusy}
              onClick={toggleCapture}
            >
              {fpsBusy ? "…" : fps?.active ? t("monitor.play.stopFpsCapture") : t("monitor.play.startFpsCapture")}
            </button>
          </div>
          <div className="play-live">
            <div className="play-metric">
              <div className="play-metric-value" style={sample ? gradeStyle(gradeFps(sample.fps, rig)) : undefined}>{sample ? Math.round(sample.fps) : "—"}</div>
              <div className="play-metric-label"><Term id="hz-vs-fps">{t("monitor.play.fpsTermLabel")}</Term></div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value" style={sample ? gradeStyle(gradeLow1(sample.low1_fps, sample.fps)) : undefined}>{sample ? Math.round(sample.low1_fps) : "—"}</div>
              <div className="play-metric-label"><Term id="one-percent-lows">{t("monitor.play.oneLowTermLabel")}</Term>{t("monitor.play.estSuffix")}</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value" style={gradeStyle(gradeGpuTempForVendor(gpu?.vendor, gpu?.temperature_c ?? null))}>{gpu?.temperature_c == null ? "—" : `${gpu.temperature_c}°C`}</div>
              <div className="play-metric-label">{t("monitor.play.gpuTempLabel")}</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value">{cpu == null ? "—" : `${cpu}%`}</div>
              <div className="play-metric-label">{t("monitor.play.cpuLabel")}</div>
            </div>
          </div>
          {fps?.status === "declined" && (
            <p className="play-honest">
              {t("monitor.play.adminDeclined")}
            </p>
          )}
          {fps?.active && !sample && fps?.status !== "declined" && (
            <p className="play-honest">
              {t("monitor.play.capturingHint")}
            </p>
          )}
          <p className="play-honest"><Term id="etw">{t("monitor.play.etwEmph")}</Term>{t("monitor.play.etwHonestyPost")}</p>
        </div>

        {/* Overlay card */}
        <div className="play-card">
          <div className="play-card-head">
            <span className="play-card-title">{t("monitor.play.inGameOverlayTitle")}</span>
            <button className={`play-btn ${overlayOn ? "play-btn-on" : ""}`} onClick={toggleOverlay}>
              {overlayOn ? t("monitor.play.hideOverlay") : t("monitor.play.showOverlay")}
            </button>
          </div>
          {overlayCfgVisible ? (
            <>
              <div className="play-field-label">{t("monitor.play.densityLabel")}</div>
              <div className="play-seg" role="group" aria-label={t("monitor.play.overlayDensityAria")}>
                {(["minimal", "standard", "full"] as OverlayDensity[]).map((d) => (
                  <button
                    key={d}
                    className={`play-seg-btn ${density === d ? "play-seg-on" : ""}`}
                    aria-pressed={density === d}
                    onClick={() => chooseDensity(d)}
                  >
                    {t(`monitor.play.density.${d}`)}
                  </button>
                ))}
              </div>
              <div className="play-field-label">{t("monitor.play.backgroundLabel")}</div>
              <div className="play-seg" role="group" aria-label={t("monitor.play.overlayBackgroundAria")}>
                {(["on", "off"] as OverlayBackdrop[]).map((b) => (
                  <button
                    key={b}
                    className={`play-seg-btn ${backdrop === b ? "play-seg-on" : ""}`}
                    aria-pressed={backdrop === b}
                    onClick={() => chooseBackdrop(b)}
                  >
                    {b === "on" ? t("monitor.play.onLabel") : t("monitor.play.offLabel")}
                  </button>
                ))}
              </div>
              <div className="play-field-label">{t("monitor.play.cornerLabel")}</div>
              <div className="play-corners">
                {CORNERS.map(([c, glyph]) => (
                  <button
                    key={c}
                    className={`play-corner ${corner === c ? "play-corner-on" : ""}`}
                    onClick={() => chooseCorner(c)}
                    title={t(`monitor.play.corner.${c}`)}
                    aria-label={t("monitor.play.moveOverlayAria", { corner: t(`monitor.play.corner.${c}`) })}
                    aria-pressed={corner === c}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className="play-cfg-toggle" onClick={() => setOverlayCfgOpen(true)}>
              {t("monitor.play.overlaySettingsToggle")}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Sessions — rows expand IN PLACE into the full debrief (no route; navigation never teleports). */}
      {showSessions && (
      <div className="play-sessions">
        <div className="play-section-label">{t("monitor.play.recentSessionsLabel")}</div>
        {sessions.length === 0 ? (
          <p className="play-empty">
            {t("monitor.play.emptySessionsHint")}
          </p>
        ) : (
          <ul className="play-list">
            {/* Free view: the most recent 20. The full retained history + trends is the Pro panel below. */}
            {sessions.slice(0, 20).map((s, i) => {
              const key = `${s.started_at}-${i}`;
              const open = openKey === key;
              const unviewed = i === 0 && latest != null && latest.started_at !== sessionsSeenAt;
              const isArmed = armed != null && armed.game === s.process_name;
              return (
                <li key={key} className={`play-session-item ${open ? "play-session-open" : ""}`}>
                  <button
                    className="play-session cmp-door"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    <span className="play-session-main">
                      {unviewed && <span className="play-dot" aria-label={t("monitor.play.newDotAria")} />}
                      <span className="play-session-game">{prettyGameName(s.process_name) || t("monitor.play.unknownGameFallback")}</span>
                      <span className="play-session-meta">
                        {fmtDur(s.duration_secs)} · {verdictLabel(t, s)}
                        {isArmed && <span className="play-armed">{t("monitor.play.comparisonArmed")}</span>}
                      </span>
                    </span>
                    <span className="play-session-right">
                      <span className="play-session-nums">
                        {t("monitor.play.sessionNums", {
                          avg: fmtReading(s.avg_fps),
                          low1: fmtReading(s.low1_fps_est),
                        })}
                      </span>
                      <span className="cmp-door-chevron" aria-hidden="true">▸</span>
                    </span>
                  </button>
                  {open && (
                    <div className="play-debrief-wrap">
                      <SessionDebrief
                        s={s}
                        priorities={priorities}
                        recs={recs}
                        apply={apply}
                        busyId={busyId}
                        onExport={onExport}
                        changes={changes}
                        rollback={rollback}
                        activeChangeFor={activeChangeFor}
                        vendor={vendor}
                        peakTempVendor={peakTempVendor}
                        sessions={sessions}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* Compy Pro: long-term history & trends over the full retained set (ProGate — inert/free while
            licensing is disarmed, gated when armed + not Pro). Self-hides until there are ≥2 sessions. */}
        <SessionTrends sessions={sessions} hideCount={v2} />
      </div>
      )}
    </section>
  );
}
