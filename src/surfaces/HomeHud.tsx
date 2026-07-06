import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { RoomShell } from "../design/room-shell";
import { Sparkline } from "../design/Sparkline";
import { useReducedMotion } from "../design/use-motion";
import { postureLine, liveStrip } from "./command-center-data";
import { activeChangeCount } from "./dashboard-data";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { gpuVendor } from "./walkthroughs";
import { gradeFps, gradeLow1, gradeColor, type Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { SetupLauncherCard } from "./setup/SetupLauncherCard";
import CountUp from "../design/vendor/CountUp/CountUp";
import "./home-hud.css";

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
}: Props) {
  const reduced = useReducedMotion();

  // ── live callout probes (existing read-only commands; a failure just omits the value) ──
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
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
  const posture = postureLine(readiness, priorities, activeChangeCount(changes));
  const strip = liveStrip(sessions);
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
  const activeCount = activeChangeCount(changes);

  const drifts = readiness?.drifts ?? [];
  const driftNames =
    drifts
      .slice(0, 2)
      .map((d) => d.label)
      .join(" · ") + (drifts.length > 2 ? ` · and ${drifts.length - 2} more` : "");
  const smartDrives = (hw.disk_health ?? []).filter((d) => d.health !== "Unknown");
  const flaggedDrives = smartDrives.filter((d) => d.health !== "Healthy");

  const sparkValues = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .slice(-12)
        .map((s) => s.avg_fps),
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
    strip.kind === "data" && rig.refreshHz ? strip.avgFps / rig.refreshHz : null;

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
        <Suspense fallback={<div className="hud-stage-loading">Loading your rig in 3D…</div>}>
          <RigHologram
            hw={hw}
            exploded={exploded}
            autoRotate={autoRotate}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={(id) => setSelectedId(id || null)}
            onHover={setHoveredId}
            manualParts={manualParts}
            cameraDist={6.9}
          />
        </Suspense>
      ) : (
        <div className="hud-stage-cards">
          <HardwareGrid hw={hw} />
        </div>
      )}
      {rig3d && (
        <>
          <div className="hud-callouts hud-callouts-left">
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
          <div className="hud-callouts hud-callouts-right">
            <Callout
              tone={gradeTone(gpuGrade)}
              name="GPU"
              detail={shortModel(hw.gpus[0]?.name)}
              value={gpuTemp != null ? `${Math.round(gpuTemp)}°C` : undefined}
              valueTone={gradeTone(gpuGrade)}
            />
            <Callout
              tone={null}
              name="CPU"
              detail={hw.cpu_arch?.family_label || undefined}
              value="no temp — Compy won't ship a kernel driver"
              mono={false}
            />
          </div>
          <div className="hud-stage-hint">
            Drag to orbit · click a part for its live specs
          </div>
        </>
      )}
    </div>
  );

  return (
    <RoomShell
      room="home"
      verdict={
        <>
          <span className="hud-masthead-eyebrow">
            <span className={`hud-led hud-led-${ledState}`} aria-hidden="true" />
            Rig diagnostic <span className="hud-eyebrow-sep">·</span>{" "}
            <span className="hud-mono">{dateline}</span>
          </span>
          <span className="hud-headline" key={posture.headline}>
            {posture.headline}
          </span>
        </>
      }
      sub={dekRedundant ? undefined : dek}
      measured={
        checking ? (
          <span className="hud-readout-seg">running checks…</span>
        ) : (
          <>
            <span className="hud-readout-seg">
              checks{" "}
              <span className="hud-mono">
                {readiness!.checks.length - readiness!.unknown_count}/{readiness!.checks.length}
              </span>{" "}
              measured
            </span>
            <span
              className={`hud-readout-seg${(readiness!.attention_count ?? 0) > 0 ? " hud-readout-warn" : ""}`}
            >
              attention <span className="hud-mono">{readiness!.attention_count}</span>
            </span>
          </>
        )
      }
      primaryAction={
        <button type="button" className="hud-btn" onClick={onRunCheck}>
          Re-run check
        </button>
      }
    >
      <div className="hud-grid" data-hud-home>
        {/* ── Instrument bay — the real hologram in a bracketed, ruled HUD frame ── */}
        <section className="hud-bay">
          <header className="hud-bay-head">
            <span className="hud-eyebrow">Your rig</span>
            <div className="hud-bay-controls">
              <div className="hud-seg-group" role="tablist" aria-label="Rig view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={rig3d}
                  className={`hud-seg ${rig3d ? "hud-seg-on" : ""}`}
                  onClick={() => chooseRig3d(true)}
                >
                  3D
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!rig3d}
                  className={`hud-seg ${!rig3d ? "hud-seg-on" : ""}`}
                  onClick={() => chooseRig3d(false)}
                >
                  Cards
                </button>
              </div>
              {rig3d && (
                <div className="hud-seg-group">
                  <button
                    type="button"
                    className={`hud-seg ${exploded ? "hud-seg-on" : ""}`}
                    onClick={() => setExploded((v) => !v)}
                  >
                    {exploded ? "Reassemble" : "Exploded"}
                  </button>
                  <button
                    type="button"
                    className={`hud-seg ${autoRotate ? "hud-seg-on" : ""}`}
                    onClick={() => setAutoRotate((v) => !v)}
                    aria-pressed={autoRotate}
                  >
                    Orbit
                  </button>
                </div>
              )}
            </div>
          </header>
          {stage}
        </section>

        {/* ── Telemetry column — numbers are the heroes; every one measured or absent ── */}
        <aside className="hud-ledger">
          <Module
            label={strip.kind === "data" ? `Last session — ${strip.game}` : "Last session"}
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
                      <span className="hud-ring-cap">vs {rig.refreshHz} Hz</span>
                    </div>
                  )}
                  <div className="hud-hero-num">
                    <span
                      className={`hud-reading hud-mono${gradeClass(fpsGrade)}`}
                      style={gradeInk(fpsGrade)}
                    >
                      {reduced ? (
                        Math.round(strip.avgFps)
                      ) : (
                        <CountUp to={Math.round(strip.avgFps)} duration={0.9} />
                      )}
                    </span>
                    <span className="hud-unit">fps avg</span>
                    <span className="hud-note">
                      1% low{" "}
                      <span
                        className={`hud-mono${gradeClass(low1Grade)}`}
                        style={gradeInk(low1Grade)}
                      >
                        {Math.round(strip.low1Est)}
                      </span>{" "}
                      (estimate)
                    </span>
                  </div>
                </div>
                {sparkValues.length >= 2 && (
                  <div className="hud-trace">
                    <Sparkline values={sparkValues} height={30} stroke="var(--v2-accent)" />
                    <span className="hud-trace-cap">
                      avg fps · last {sparkValues.length} sessions
                    </span>
                  </div>
                )}
              </>
            ) : (
              <span className="hud-note">
                Nothing on the books yet — play a session and Compy captures it from outside the
                game.
              </span>
            )}
          </Module>

          <Module label="Active changes">
            <span className="hud-reading hud-mono">
              {reduced ? activeCount : <CountUp to={activeCount} duration={0.9} />}
            </span>
            <span className="hud-note">every one reversible from the ledger</span>
          </Module>

          <Module label="Trust ledger">
            <span className="hud-reading hud-mono">
              {reduced ? changes.length : <CountUp to={changes.length} duration={0.9} />}
              <span className="hud-unit">change{changes.length === 1 ? "" : "s"} tracked</span>
            </span>
            {latest ? (
              <span className="hud-note hud-note-clip" title={latest.rec_title}>
                latest: {latest.rec_title} <span className="hud-mono">· {latestTime}</span>
              </span>
            ) : (
              <span className="hud-note">nothing applied yet — your PC is untouched</span>
            )}
          </Module>

          <Module label="Drift watch">
            {readiness == null ? (
              <span className="hud-note">drift status lands with the current check</span>
            ) : drifts.length === 0 ? (
              <span className="hud-note">
                <span className="hud-led hud-led-ok" aria-hidden="true" /> nothing's drifted —
                every applied change is still holding
              </span>
            ) : (
              <span className="hud-note hud-note-warn">
                <span className="hud-led hud-led-warn" aria-hidden="true" /> {drifts.length}{" "}
                setting{drifts.length === 1 ? "" : "s"} drifted off · {driftNames}
              </span>
            )}
          </Module>

          <Module label="Drive health">
            {smartDrives.length === 0 ? (
              <span className="hud-note">
                no SMART reading from this rig — Compy won't guess drive health
              </span>
            ) : flaggedDrives.length === 0 ? (
              <span className="hud-note">
                <span className="hud-led hud-led-ok" aria-hidden="true" /> {smartDrives.length}{" "}
                drive{smartDrives.length === 1 ? "" : "s"} · SMART OK
              </span>
            ) : (
              <span className="hud-note hud-note-warn">
                <span className="hud-led hud-led-warn" aria-hidden="true" />{" "}
                {flaggedDrives[0].friendly_name} — {flaggedDrives[0].health} · back up important
                data
              </span>
            )}
          </Module>
        </aside>

        {/* ── Priority queue — ranked for THIS hardware; rank numerals are real order ── */}
        <section className="hud-docket">
          <header className="hud-docket-head">
            <span className="hud-eyebrow">Priority queue</span>
            <span className="hud-docket-note">ranked for your hardware</span>
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
                Nothing worth changing today — measured clean on this rig.
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
                    {i === 0 ? "biggest limiter" : `${l.confidence} confidence`}
                  </span>
                  <button type="button" className="hud-btn hud-btn-ghost" onClick={onSeeInFix}>
                    See in Optimize
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
