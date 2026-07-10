import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { readHologramV2 } from "../design/theme";
import { postureLine, liveStrip } from "./command-center-data";
import { activeChangeCount } from "./dashboard-data";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { gpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, type Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { ArcGauge, type ArcTone } from "../design/console/ArcGauge";
import { Dock, type DockNode } from "../design/console/Dock";
import "./home-console.css";

// HomeConsole — Home as the console cold-open (plan 2026-07-10-console-hud-phase2-home,
// Phase 2 of the Console HUD; design source 2026-07-09-compy-console-hud-direction, owner-
// approved). The Lab Ops Console's language on the app's opening screen: the real 3D rig
// hologram center-stage inside a bracketed console stage, four honest corner arc gauges,
// and (Task 3) a Dock that navigates into the rooms. Behind compy_home_console, DEFAULT OFF.
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

// One instrument annotation: LED (only when a measured value earned a tone) · part · detected
// model · measured value on a hairline leader. HomeHud's Callout in the console's namespace.
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
}: Props) {
  const reduced = useReducedMotion();

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
  const posture = postureLine(readiness, priorities, activeChangeCount(changes));
  const strip = liveStrip(sessions);
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
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").trim();
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
  const topLimiter = priorities?.limiters?.[0] ?? null;

  return (
    <RoomShell
      room="home"
      verdict={
        <>
          <span className="hc-masthead-eyebrow">
            <span className={`hc-led hc-led-${ledState}`} aria-hidden="true" />
            Rig diagnostic <span className="hc-eyebrow-sep">·</span>{" "}
            <span className="hc-mono">{dateline}</span>
          </span>
          <span className="hc-headline" key={posture.headline}>
            {posture.headline}
          </span>
        </>
      }
      sub={dekRedundant ? undefined : dek}
      measured={
        checking ? (
          <span className="hc-readout-seg">running checks…</span>
        ) : (
          <>
            <span className="hc-readout-seg">
              checks{" "}
              <span className="hc-mono">
                {readiness!.checks.length - readiness!.unknown_count}/{readiness!.checks.length}
              </span>{" "}
              measured
            </span>
            <span
              className={`hc-readout-seg${(readiness!.attention_count ?? 0) > 0 ? " hc-readout-warn" : ""}`}
            >
              attention <span className="hc-mono">{readiness!.attention_count}</span>
            </span>
          </>
        )
      }
      primaryAction={
        <button type="button" className="hc-btn" onClick={onRunCheck}>
          Re-run check
        </button>
      }
    >
      <div className="home-console" data-motion={reduced ? "reduced" : "full"}>
        {/* CONSOLE STAGE — bracketed frame, the real 3D hologram center, four honest corner
            gauges. No lede (owner header-slop law 2026-07-10): the console opens straight on
            the stage. */}
        <div className="hc-stage">
          <span className="hc-brk hc-brk-tl" aria-hidden="true" />
          <span className="hc-brk hc-brk-tr" aria-hidden="true" />
          <span className="hc-brk hc-brk-bl" aria-hidden="true" />
          <span className="hc-brk hc-brk-br" aria-hidden="true" />
          <div className="hc-corner hc-tl">
            <ArcGauge label="Readiness" value={readinessScore} max={100} unit="score" tone="accent" />
          </div>
          <div className="hc-corner hc-tr">
            <ArcGauge
              label="Avg FPS"
              value={avgFps}
              max={240}
              unit="fps"
              tone={arcTone(fpsGrade)}
              measured={avgFps != null}
            />
          </div>
          <div className="hc-corner hc-bl">
            <ArcGauge
              label="1% low"
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
              label="GPU temp"
              value={gpuTemp}
              max={100}
              unit="°C"
              tone={arcTone(gpuGrade)}
              measured={gpuTemp != null}
            />
          </div>
          <div className="hc-rig">
            {rig3d ? (
              <Suspense fallback={<div className="hc-stage-loading">Loading your rig in 3D…</div>}>
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
              {/* Instrument annotations — the parallax plane (Task 4); pointer-events none so
                  drag-orbit under them never fights. GPU temp lives in the BR gauge (one owner
                  per number), so the GPU callout carries the detected model only. */}
              <div className="hc-ann hc-ann-left">
                <Callout
                  tone={mem ? gradeTone(mem.level === "ok" ? "good" : "bad") : null}
                  name="RAM"
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
                    name="Storage"
                    value={`C: ${diskPct}% full`}
                    valueTone={diskPct >= 90 ? "warn" : "ok"}
                  />
                )}
              </div>
              <div className="hc-ann hc-ann-right">
                <Callout tone={null} name="GPU" detail={shortModel(hw.gpus[0]?.name)} />
                <Callout
                  tone={null}
                  name="CPU"
                  detail={hw.cpu_arch?.family_label || undefined}
                  value="no temp — Compy won't ship a kernel driver"
                  mono={false}
                />
              </div>
            </>
          )}
          {/* Quiet view controls — the same persisted choices HomeHud offers, console chrome. */}
          <div className="hc-controls">
            <div className="hc-seg-group" role="tablist" aria-label="Rig view">
              <button
                type="button"
                role="tab"
                aria-selected={rig3d}
                className={`hc-seg ${rig3d ? "hc-seg-on" : ""}`}
                onClick={() => chooseRig3d(true)}
              >
                3D
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!rig3d}
                className={`hc-seg ${!rig3d ? "hc-seg-on" : ""}`}
                onClick={() => chooseRig3d(false)}
              >
                Cards
              </button>
            </div>
            {rig3d && (
              <div className="hc-seg-group">
                <button
                  type="button"
                  className={`hc-seg ${exploded ? "hc-seg-on" : ""}`}
                  onClick={() => setExploded((v) => !v)}
                >
                  {exploded ? "Reassemble" : "Exploded"}
                </button>
                <button
                  type="button"
                  className={`hc-seg ${autoRotate ? "hc-seg-on" : ""}`}
                  onClick={() => setAutoRotate((v) => !v)}
                  aria-pressed={autoRotate}
                >
                  Orbit
                </button>
              </div>
            )}
          </div>
        </div>

        {/* THE #1 LIMITER — micro-label · the measured title · quiet confidence tag · jump. */}
        {topLimiter && (
          <div className="hc-limiter">
            <span className="hc-limiter-label">top limiter</span>
            <span className="hc-limiter-title">{topLimiter.title}</span>
            <span className="hc-limiter-tag hc-mono">{topLimiter.confidence} confidence</span>
            <button type="button" className="hc-btn hc-btn-ghost" onClick={onSeeInFix}>
              See in {fixRoomLabel}
            </button>
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
