import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { type ArcTone } from "../design/console/ArcGauge";
import { Reading } from "../design/console/Reading";
import { Oscilloscope } from "../design/console/Oscilloscope";
import { RoomShell } from "../design/room-shell";
import { RoomEyebrow } from "../design/room-eyebrow";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { Term } from "../design/Term";
import { Icon } from "../design/Icon";
import { BentoGrid, BentoTile } from "../design/bento/BentoGrid";
import { readoutStats, type ReadoutStats } from "./monitor-console-data";
import { DeckScope } from "./monitor/DeckScope";
import { SessionStack } from "./monitor/SessionStack";
import { deckDeltaFrom, fmtDeltaGlyph } from "./monitor/monitor-stack-profile";
import { prettyGameName } from "./game-name";
import { monitorVerdict } from "./monitor-v2-data";
import { fmtDurCoarse } from "./Play";
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
  quiet,
  bar,
}: {
  active: boolean;
  vendor?: GpuVendor;
  /** Session history (newest-first): the stack's rows + the deck's delta row prior. */
  sessions?: SessionSummary[];
  /** Mirrors the room's live capture state up to MonitorV2 (the V2-8 forward-door rule). */
  onFpsActive?: (active: boolean) => void;
  /** THE LIVE FACE OWNS ITS OWN SHELL (issue #49 slice 4). The approved comp puts Start capture
   *  in the narrative column and the last session in an evidence column, and both are built from
   *  state this component owns — the capture stream, the sensors, the session array. Rather than
   *  hoist that ownership (and split the one 1 Hz poll the room has), the face renders the
   *  RoomShell itself and MonitorV2 hands down the two pieces that are the ROOM's, not the
   *  face's: the segment bar and the advisory-presets expander. MonitorV2 keeps its own RoomShell
   *  for the Sessions face, which is a different composition (no evidence column). */
  quiet?: ReactNode;
  bar?: ReactNode;
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

  const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  // What an empty scope says under "no signal" (intimidation pass 2026-08-20): the bare words
  // read as a fault on a room that had not yet explained itself. One plain line names the next
  // press — and, once capture is on, what is being waited for. Same line in both scopes.
  const scopeHint = fpsActive
    ? t("monitor.monitorConsole.scopeCapturingHint")
    : t("monitor.monitorConsole.scopeIdleHint");

  // THE LAST SESSION IS THE EVIDENCE (issue #49 slice 4). The approved Live comp makes the latest
  // COMPLETED session the focal proof, not the live window: name, duration, its average, its 1%
  // low and how many Compy changes were on while it ran. All five are recorded facts on
  // SessionSummary — nothing here is sampled, so the panel holds still while capture starts and
  // stops. `sessions` arrives newest-first (the same array the stack and the delta row read).
  const latest = sessions[0] ?? null;
  const lastGame = latest
    ? capFirst(prettyGameName(latest.process_name) || t("monitor.monitorConsole.unknownGame"))
    : null;
  // The room's session answer, from the one helper that also grades the rows below — it moved OFF
  // the h1 (the narrative now answers "can I start?") and INTO the panel that shows the session it
  // is about. Same sentence, same source, printed once.
  const sessionLine = monitorVerdict(sessions, t);

  // THE NARRATIVE'S ONE VERDICT is about readiness, because the action beneath it is Start capture.
  // Three states, all real: mid-command, recording, idle. Nothing is claimed about a game.
  const headline = fpsBusy
    ? t("monitor.monitorConsole.narrative.busyHeadline")
    : fpsActive
      ? t("monitor.monitorConsole.narrative.capturingHeadline")
      : t("monitor.monitorConsole.narrative.readyHeadline");

  return (
    <RoomShell
      room="play"
      /* V2-8 placement, unchanged: the forward door belongs to the session-END state. The live
         face owns the capture stream, so it owns this answer directly now instead of mirroring
         it up a level first. */
      doorOpen={!fpsActive}
      /* THE NARRATIVE COLUMN (approved four-room direction). Eyebrow → one human verdict → one
         short explanation → one dominant action, exactly as Health composes it. The LED breathes
         only while the helper is actually recording; there is no idle animation to mean nothing. */
      /* ITS OWN SLOT, NOT A PASSENGER IN `verdict` (#211). This is the file that renders when Live
         opens — the segment defaults to "live" — and it was missed on the first pass while the
         other four rooms were corrected. Inside `verdict` the eyebrow renders inside the <h1>, so
         the room's ONE top-level heading read "Session monitor" welded to a live status sentence
         ("Ready when you are"). It only LOOKED like two lines because the base .v2-eyebrow rule is
         a flex block; a screen reader still announced one fused string. The room's NAME is stable
         and belongs in a heading; what the room is currently doing is not and does not. */
      eyebrow={
        <RoomEyebrow
          tone="accent"
          /* NO DOT WHEN NOTHING IS RECORDING (owner ruling 2026-08-23 — match the comps
              exactly). 02-live-approved.png carries no dot beside this label at all, and
              its idle state is the state the app is in most of the time; the label itself
              is drawn in the accent instead. The dot survives ONLY as the recording light,
              which is the one moment this room has a live state to report — so the comp is
              matched where it speaks, and nothing honest is lost where it is silent. */
          dot={fpsActive ? "rec" : undefined}
          label={t("monitor.monitorConsole.narrative.eyebrow")}
        />
      }
      verdict={
        <span className="mc-headline" key={headline}>
          {headline}
        </span>
      }
      sub={t("monitor.monitorConsole.narrative.sub")}
      /* THE ONE DOMINANT ACTION — the room's capture toggle, MOVED here from the control row
         rather than copied: there is still exactly one Start/Stop capture control on this screen
         (one-mention law), it is simply where the comp puts it and where the eye already is after
         reading the sentence above it. It keeps the audited commands and the busy/declined
         semantics it always had. */
      primaryAction={
        <button
          type="button"
          className={`mc-start ${fpsActive ? "mc-start-on" : ""}`}
          disabled={fpsBusy}
          onClick={toggleCapture}
        >
          {fpsBusy
            ? t("monitor.monitorConsole.narrative.busyAction")
            : fpsActive
              ? t("monitor.monitorConsole.stopCapture")
              : t("monitor.monitorConsole.startCapture")}
        </button>
      }
      quiet={quiet}
      /* THE METHOD, at the foot of the story column where the comp puts it — the same honesty
         micro-line the room always carried, moved rather than rewritten: the anti-cheat-safe
         wording is preserved verbatim (the handoff names it explicitly) and it still glosses ETW
         through the same Term. What is new is the padlock beside it, and the company it keeps:
         the room's forward route now sits directly above it instead of at the page foot. */
      footnote={
        <>
          <Term id="etw">{t("monitor.monitorConsole.etwEmph")}</Term>
          {t("monitor.monitorConsole.etwHonestyPost")}
        </>
      }
      /* THE EVIDENCE COLUMN — one panel, in the comp's order: what the last session was, what it
         measured, the live trace, how it compared, and the sensors right now. The pointer
         spotlight and the reticle move with it (stageRef was the bento stage; the instruments
         moved, so their tracking area moved with them — it is still exactly one stage). */
      aside={
        <section
          className="mc-evidence"
          ref={stageRef}
          aria-label={t("monitor.monitorConsole.evidence.aria")}
        >
          <header className="mc-ev-head">
            <h2 className="mc-ev-title">
              {t("monitor.monitorConsole.evidence.lastSession")}
              {lastGame && (
                <>
                  {" "}
                  <span className="mc-ev-sep" aria-hidden="true">
                    ·
                  </span>{" "}
                  {lastGame}
                </>
              )}
            </h2>
            {latest && (
              <span className="mc-ev-dur">
                {/* The comp puts a clock glyph before this duration — it is the one number in the
                    head that is a LENGTH rather than a reading, and the glyph is what says so. */}
                <Icon name="clock" size={14} />
                {fmtDurCoarse(latest.duration_secs)}
              </span>
            )}
          </header>

          {latest ? (
            <>
              <p className="mc-ev-verdict">{sessionLine.headline}</p>
              {sessionLine.sub && <p className="mc-ev-note">{sessionLine.sub}</p>}
              {/* READING_ROWS strip (see Reading.tsx): three row tracks, and the changes-on cell
                  spans all three so a wrapped label in any language cannot move one value out of
                  the row. It is the same contract Health's readout strip satisfies. */}
              <div className="mc-ev-readings">
                <Reading
                  id="avgFps"
                  label={t("monitor.monitorConsole.deltaAvgFps")}
                  value={latest.avg_fps}
                  unit="fps"
                  tone={arcTone(gradeFps(latest.avg_fps, rig))}
                />
                <Reading
                  id="low1"
                  label={t("monitor.monitorConsole.deltaOneLow")}
                  value={latest.low1_fps_est}
                  unit="fps"
                  tone={arcTone(gradeLow1(latest.low1_fps_est, latest.avg_fps))}
                />
                <span className="mc-ev-changes">
                  {t("monitor.monitorConsole.changesOn", { count: latest.compy_changes_active })}
                </span>
              </div>
            </>
          ) : (
            <p className="mc-ev-none">{t("monitor.monitorConsole.evidence.noSession")}</p>
          )}

          {/* The real trace. There is no PERSISTED per-frame series behind a session record — the
              comp's line is a design-pass example — so this is the live buffer, which is the only
              real one Compy has, with its own honest empty state when nothing is being captured.
              Inventing a stored trace to match the picture is exactly what the honesty law bars. */}
          <div className="mc-ev-trace">
            <Oscilloscope
              samples={live ? fpsH.current : []}
              cap={FPS_CAP}
              label={t("monitor.monitorConsole.fpsScopeLabel")}
              unit="fps"
              tone={live ? arcTone(gradeFps(sample.fps, rig)) : "accent"}
              reduced={reduced}
              emptyHint={scopeHint}
              /* ZERO-ANCHORED WITH A LABELLED AXIS (comp fidelity 2026-08-23). The approved trace
                 reads 0 / 80 / 160 / 240 against a fixed floor, which is also the honest scale: a
                 window normalised to its own min-max turns two frames of ordinary jitter into a
                 mountain range. The numbers on OUR axis come from the real cap, never the comp's
                 240 — the picture is the design, the data stays the machine's. */
              scale="zero"
              /* "2m ago … now" — the buffer polls once a second (the tick below), so the drawn
                 window's length in samples IS its length in seconds. Nothing is estimated. */
              span={{
                start: t("monitor.monitorConsole.traceSpanAgo", {
                  span: fmtDurCoarse(Math.min(fpsH.current.length, FPS_CAP)),
                }),
                end: t("monitor.monitorConsole.traceSpanNow"),
              }}
            />
          </div>

          {/* The deck's debrief — recorded facts only; renders NOTHING without a prior session,
              and a cross-game prior is labeled so a genre gap never reads as a regression (the
              v4 law, carried). Moved here whole from the deck hero: it compares the SESSION the
              panel is already about, so this is where it belongs. */}
          {deck && (
            <div className="mc-delta">
              <span className="mc-delta-k">
                {/* Process names arrive lowercase ("valorant"); a sentence wants "Valorant". */}
                {t("monitor.monitorConsole.vsLastSession", {
                  game: capFirst(
                    prettyGameName(deck.prev.process_name) ||
                      t("monitor.monitorConsole.unknownGame"),
                  ),
                })}
                {!deck.sameGame && t("monitor.monitorConsole.differentGameTag")}
              </span>
              <div className="mc-delta-cells">
                {(
                  [
                    ["avg", t("monitor.monitorConsole.deltaAvgFps"), fmtDeltaGlyph(deck.avgFps)],
                    ["low1", t("monitor.monitorConsole.deltaOneLow"), fmtDeltaGlyph(deck.low1)],
                    ["spikes", t("monitor.monitorConsole.deltaSpikes"), fmtDeltaGlyph(deck.spikes)],
                  ] as const
                ).map(([key, k, v]) => (
                  <span key={key} className="mc-delta-v" data-k={key}>
                    <span className="mc-delta-vk">{k}</span>
                    <span className="mc-delta-vv">{v}</span>
                  </span>
                ))}
              </div>
              {/* THE CROSS-GAME CAVEAT (02-live-approved.png prints exactly this under the
                  cells). The header line already TAGS the prior as a different game; this says
                  what that means for the three numbers under it, which is the part a reader
                  acts on. Two different genres can differ by 50 fps with nothing wrong and
                  nothing improved, so a cross-game delta is context and never a verdict.
                  Renders alongside the changes-on tag when both are true: they are two
                  independent reasons the same number is not attributable, and suppressing
                  either one to keep the block tidy would be hiding a caveat. */}
              {!deck.sameGame && (
                <span className="mc-delta-note">
                  {t("monitor.monitorConsole.crossGameNote")}
                </span>
              )}
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

          {/* ONE CALM SENSOR STRIP (the handoff's word). These were five ArcGauges in a bento
              tile; the approved comp reads them as plain readings, so they became the shared kit's
              Reading — same five facts, same sources, same null-is-never-zero rule, and the
              MEASURED attestation now says what the dial's `measured` prop used to.
              GPU temp tone stays vendor-gated (NVIDIA ungraded — LOCKED rule 5), and CPU load
              stays deliberately ungraded (high while gaming is fine). */}
          <div
            className="mc-ev-sensors"
            aria-label={t("monitor.monitorConsole.evidence.sensorsAria")}
          >
            <Reading
              id="gpuTemp"
              label={t("monitor.monitorConsole.gpuTempLabel")}
              value={gpu?.temperature_c ?? null}
              unit="°C"
              tone={arcTone(gpuGrade)}
            />
            <Reading
              id="gpuLoad"
              label={t("monitor.monitorConsole.gpuLoadLabel")}
              value={gpu?.utilization_gpu_pct ?? null}
              unit="%"
            />
            <Reading
              id="cpuLoad"
              label={t("monitor.monitorConsole.cpuLabel")}
              value={cpu ? cpu.usage_overall_pct : null}
              unit="%"
            />
            <Reading
              id="ram"
              label={t("monitor.monitorConsole.ramLabel")}
              value={ramPct}
              unit="%"
              tone={arcTone(gradeRamPct(ramPct))}
            />
            {/* Beside the GPU's temperature, because "is it running hot" is ONE question with two
                answers. Null renders the kit's honest no-reading line; the ladder that turns that
                into a fix (CpuTempOffer) lives on Health's CPU callout, so the same offer is not
                printed twice (one-mention law). */}
            <Reading
              id="cpuTemp"
              label={t("monitor.monitorConsole.cpuTempLabel")}
              value={cpuTemp ? cpuTemp.temp_c : null}
              unit="°C"
              tone={arcTone(gradeCpuTempC(cpuTemp?.temp_c ?? null))}
            />
          </div>

          {/* The game-HUD Target Cursor, stage-scoped (kit handles reduced/coarse-pointer null
              + the rAF pointerleave stop — Phase-1's review fix). */}
          <ReticleCursor scopeRef={stageRef} />
        </section>
      }
      /* BELOW BOTH COLUMNS — everything real that the comp's two columns do not hold. It moved
         down; none of it was deleted to make the picture fit (the shell's own `below` contract). */
      below={
        <div className="mc-below">
          <BentoGrid className="mc-bento">
            <BentoTile title={t("monitor.monitorConsole.bento.deck")} span="hero">
              {/* THE FRAMETIME DECK (v5 Flight Deck): real ms axis, dashed budget line,
                  exact-moment spike pins, hover scrub + drag-zoom. Always mounted — it carries
                  its own honest empty. */}
              <DeckScope
                ftWin={ftWin.current}
                live={live}
                budget={ftBudget}
                tone={live ? arcTone(gradeFrametimeMs(sample.avg_frametime_ms, rig)) : "accent"}
                reduced={reduced}
                cap={FT_CAP}
                emptyHint={scopeHint}
              />
            </BentoTile>

            <BentoTile title={t("monitor.monitorConsole.bento.readouts")} span="half">
              {/* Consumer-term readouts (owner direction §A0 item 6) — the LIVE window, which is a
                  different fact from the last session's averages in the evidence panel above.
                  Measured values only, em-dash when nothing is measured. Same windows the traces
                  draw; spike count = the SAME detector as the markers (one source, can't disagree). */}
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
                  <span className="mc-readout-k">
                    {t("monitor.monitorConsole.lowestLatencyLabel")}
                  </span>
                </div>
                <div className="mc-readout">
                  <span className="mc-readout-v" style={stats.spikeCount ? ink("bad") : undefined}>
                    {stats.spikeCount == null ? "—" : stats.spikeCount}
                  </span>
                  <span className="mc-readout-k">{t("monitor.monitorConsole.spikesLabel")}</span>
                </div>
              </div>
            </BentoTile>
          </BentoGrid>

          {/* THE SESSION STACK — every recent session a flat row on ONE shared axis. */}
          <SessionStack sessions={sessions} reduced={reduced} />
        </div>
      }
    >
      {bar}
      <div className="monitor-console" data-motion={reduced ? "reduced" : "full"}>
        {/* The quiet route the comp puts directly under the action — and it is not a new one:
            `Term` is the glossary affordance this room already used to explain ETW capture. */}
        <p className="mc-how">
          <Term id="etw">{t("monitor.monitorConsole.narrative.howItWorks")}</Term>
        </p>

        {/* What capture is doing right now. The Start/Stop button is NOT repeated here — it moved
            up to the one action slot — so this row is status plus the room's other real control. */}
        <div className="mc-capture">
          <span
            className="mc-cap-status"
            style={live ? { color: gradeColor(low1Grade) || undefined } : undefined}
          >
            {live ? (
              <>
                {Math.round(sample.low1_fps)}{" "}
                <Term id="one-percent-lows">{t("monitor.monitorConsole.oneLowTermLabel")}</Term>
                {t("monitor.monitorConsole.estSuffix")}
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
              {overlayOn
                ? t("monitor.monitorConsole.overlayOn")
                : t("monitor.monitorConsole.overlayLabel")}
            </button>
            {overlayOn && (
              <>
                {CORNERS.map(([c, glyph]) => (
                  <button
                    key={c}
                    type="button"
                    className={`mc-ov-corner ${corner === c ? "mc-ov-corner-on" : ""}`}
                    aria-label={t("monitor.monitorConsole.overlayCornerAria", {
                      corner: cornerLabel(t, c),
                    })}
                    onClick={() => chooseCorner(c)}
                  >
                    {glyph}
                  </button>
                ))}
                <span
                  className="mc-ov-group"
                  role="group"
                  aria-label={t("monitor.monitorConsole.overlayDensityAria")}
                >
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

      </div>
    </RoomShell>
  );
}

export default MonitorConsole;
