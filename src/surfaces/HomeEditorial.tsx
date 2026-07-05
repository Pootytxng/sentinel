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
import "./home-editorial.css";

// HomeEditorial — the Editorial-Instrument pilot (spec 2026-07-05-ui-deslop-organic-directive,
// LOCKED direction; flag compy_editorial, DEFAULT OFF). Editorial type carries the story: a
// serif verdict masthead over a hairline folio. Instrument precision carries the data: the
// telemetry ledger (a hairline measurement log, not card soup) and the instrument bay — the
// REAL WebGL rig hologram in a bracketed HUD frame with a whisper scanline field and part
// callouts on hairline leaders.
//
// Honesty contract (identical to HomeV2 — this file changes PRESENTATION only): every number
// is measured or honestly absent; the verdict is postureLine's real output; the boot sweep
// renders ONLY while checks are actually running; graded ink comes from metric-grade against
// THIS rig; NVIDIA temp stays ungraded (LOCKED rule 5 — gradeGpuTempForVendor). Zero new IPC.
//
// Motion contract (HARD RAILS): pointer-parallax is event-driven (no rAF loop — nothing runs
// on blur or idle), applies to the callout layer only (never fights drag-orbit inside the
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
    <div className="edh-callout">
      <span className="edh-callout-head">
        {tone && <span className={`edh-led edh-led-${tone}`} aria-hidden="true" />}
        <b>{name}</b>
        {detail && <span className="edh-callout-detail">{detail}</span>}
      </span>
      {value && (
        <span
          className={`edh-callout-v ${mono ? "edh-mono" : ""}${valueTone ? ` edh-callout-v-${valueTone}` : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// One telemetry-ledger entry: letterspaced mono eyebrow · reading · one-line note.
function LedgerEntry({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="edh-entry">
      <span className="edh-eyebrow">{label}</span>
      {children}
    </div>
  );
}

export function HomeEditorial({
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
  // Writes two CSS vars on the stage; ONLY the callout layer + brackets consume them, so the
  // canvas (drag-orbit's home) never moves under the cursor.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const onStageMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    el.style.setProperty("--edh-px", px.toFixed(3));
    el.style.setProperty("--edh-py", py.toFixed(3));
  };
  const onStageLeave = () => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--edh-px", "0");
    el.style.setProperty("--edh-py", "0");
  };

  // ── measured derivations (all real, all honestly empty when absent — HomeV2's exact logic) ──
  const posture = postureLine(readiness, priorities, activeChangeCount(changes));
  const strip = liveStrip(sessions);
  const rig = { refreshHz: hw.display?.current_refresh_rate_hz ?? null };
  const fpsGrade: Grade = strip.kind === "data" ? gradeFps(strip.avgFps, rig) : "neutral";
  const low1Grade: Grade =
    strip.kind === "data" ? gradeLow1(strip.low1Est, strip.avgFps) : "neutral";
  const gradeClass = (g: Grade) => (g === "neutral" ? "" : ` edh-grade-${g}`);
  const gradeInk = (g: Grade) => (g === "neutral" ? undefined : { color: gradeColor(g) });
  const checking = readiness == null; // checks literally still running
  const vendor = gpuVendor(hw.gpus?.[0]?.name);
  const gpuGrade = gradeGpuTempForVendor(vendor, gpuTemp);

  // The masthead dek: postureLine's sentence often opens by restating its own headline
  // ("You're ready to play" / "Ready to play — …"). Under a display-size serif that reads as a
  // stutter, so the dek drops the restated prefix and keeps only the part that ADDS information;
  // a fully-redundant sentence is omitted (the folio line still carries provenance). Text is
  // still postureLine's real output — trimmed, never rewritten.
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
    // Clean state: the docket's clear line is the ONE owner of "measured clean" on this screen
    // (the P5 one-owner-per-screen voice law) — the dek stands down rather than echo it.
    ((priorities?.limiters ?? []).length === 0 && priorities != null && /measured clean/i.test(dek));

  const measured = readiness
    ? `${readiness.checks.length - readiness.unknown_count}/${readiness.checks.length} checks measured` +
      (readiness.attention_count === 0
        ? " · nothing needs urgent attention"
        : ` · ${readiness.attention_count} need${readiness.attention_count === 1 ? "s" : ""} attention`)
    : "running checks…";

  // The folio dateline — the date this report is being read (today), never a fabricated stamp.
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

  // The instrument bay stage (shared by 3D and cards views).
  const stage = (
    <div
      className="edh-stage"
      ref={stageRef}
      onPointerMove={onStageMove}
      onPointerLeave={onStageLeave}
    >
      <span className="edh-corner edh-c-tl" aria-hidden="true" />
      <span className="edh-corner edh-c-tr" aria-hidden="true" />
      <span className="edh-corner edh-c-bl" aria-hidden="true" />
      <span className="edh-corner edh-c-br" aria-hidden="true" />
      {checking && !reduced && <div className="edh-sweep" aria-hidden="true" />}
      {rig3d ? (
        <Suspense fallback={<div className="edh-stage-loading">Initializing hologram…</div>}>
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
        <div className="edh-stage-cards">
          <HardwareGrid hw={hw} />
        </div>
      )}
      {rig3d && (
        <>
          <div className="edh-callouts edh-callouts-left">
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
          <div className="edh-callouts edh-callouts-right">
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
              value="temp n/a — by design"
              mono={false}
            />
          </div>
          <div className="edh-stage-hint">
            Drag to orbit · click a part for its live specs — measured, never guessed
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
          <span className="edh-masthead-eyebrow">
            Rig report <span className="edh-mono">· {dateline}</span>
          </span>
          <span className="edh-headline" key={posture.headline}>
            {posture.headline}
          </span>
        </>
      }
      sub={dekRedundant ? undefined : dek}
      measured={measured}
      primaryAction={
        <button type="button" className="edh-btn" onClick={onRunCheck}>
          Re-run check
        </button>
      }
    >
      <div className="edh-grid" data-editorial-home>
        {/* ── Instrument bay — the real hologram in a bracketed HUD frame ── */}
        <section className="edh-bay">
          <header className="edh-bay-head">
            <span className="edh-eyebrow">Your rig</span>
            <div className="edh-bay-controls">
              <div className="edh-seg-group" role="tablist" aria-label="Rig view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={rig3d}
                  className={`edh-seg ${rig3d ? "edh-seg-on" : ""}`}
                  onClick={() => chooseRig3d(true)}
                >
                  3D
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!rig3d}
                  className={`edh-seg ${!rig3d ? "edh-seg-on" : ""}`}
                  onClick={() => chooseRig3d(false)}
                >
                  Cards
                </button>
              </div>
              {rig3d && (
                <div className="edh-seg-group">
                  <button
                    type="button"
                    className={`edh-seg ${exploded ? "edh-seg-on" : ""}`}
                    onClick={() => setExploded((v) => !v)}
                  >
                    {exploded ? "Reassemble" : "Exploded"}
                  </button>
                  <button
                    type="button"
                    className={`edh-seg ${autoRotate ? "edh-seg-on" : ""}`}
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

        {/* ── Telemetry ledger — a hairline measurement log, not card soup ── */}
        <aside className="edh-ledger">
          <LedgerEntry
            label={strip.kind === "data" ? `Last session — ${strip.game}` : "Last session"}
          >
            {strip.kind === "data" ? (
              <>
                <span className={`edh-reading edh-mono${gradeClass(fpsGrade)}`} style={gradeInk(fpsGrade)}>
                  {reduced ? (
                    Math.round(strip.avgFps)
                  ) : (
                    <CountUp to={Math.round(strip.avgFps)} duration={0.9} />
                  )}
                  <span className="edh-unit">fps avg</span>
                </span>
                <span className="edh-note">
                  1% low{" "}
                  <span className={`edh-mono${gradeClass(low1Grade)}`} style={gradeInk(low1Grade)}>
                    {Math.round(strip.low1Est)}
                  </span>{" "}
                  (estimate)
                </span>
                {sparkValues.length >= 2 && (
                  <div className="edh-trace">
                    <Sparkline values={sparkValues} height={24} stroke="var(--v2-accent)" />
                  </div>
                )}
              </>
            ) : (
              <span className="edh-note">
                Nothing on the books yet — play a session and Compy captures it from outside the
                game.
              </span>
            )}
          </LedgerEntry>

          <LedgerEntry label="Safe changes active">
            <span className="edh-reading edh-mono">
              {reduced ? activeCount : <CountUp to={activeCount} duration={0.9} />}
            </span>
            <span className="edh-note">every one reversible from the ledger</span>
          </LedgerEntry>

          <LedgerEntry label="Trust ledger">
            <span className="edh-reading edh-mono">
              {reduced ? changes.length : <CountUp to={changes.length} duration={0.9} />}
              <span className="edh-unit">change{changes.length === 1 ? "" : "s"} tracked</span>
            </span>
            {latest ? (
              <span className="edh-note edh-note-clip" title={latest.rec_title}>
                latest: {latest.rec_title} <span className="edh-mono">· {latestTime}</span>
              </span>
            ) : (
              <span className="edh-note">nothing applied yet — your PC is untouched</span>
            )}
          </LedgerEntry>

          <LedgerEntry label="Drift watch">
            {readiness == null ? (
              <span className="edh-note">drift status lands with the current check</span>
            ) : drifts.length === 0 ? (
              <span className="edh-note">
                <span className="edh-led edh-led-ok" aria-hidden="true" /> nothing's drifted —
                every applied change is still holding
              </span>
            ) : (
              <span className="edh-note edh-note-warn">
                <span className="edh-led edh-led-warn" aria-hidden="true" /> {drifts.length}{" "}
                setting{drifts.length === 1 ? "" : "s"} drifted off · {driftNames}
              </span>
            )}
          </LedgerEntry>

          <LedgerEntry label="Drive health">
            {smartDrives.length === 0 ? (
              <span className="edh-note">
                no SMART reading from this rig — Compy won't guess drive health
              </span>
            ) : flaggedDrives.length === 0 ? (
              <span className="edh-note">
                <span className="edh-led edh-led-ok" aria-hidden="true" /> {smartDrives.length}{" "}
                drive{smartDrives.length === 1 ? "" : "s"} · SMART OK
              </span>
            ) : (
              <span className="edh-note edh-note-warn">
                <span className="edh-led edh-led-warn" aria-hidden="true" />{" "}
                {flaggedDrives[0].friendly_name} — {flaggedDrives[0].health} · back up important
                data
              </span>
            )}
          </LedgerEntry>
        </aside>

        {/* ── The docket — ranked for THIS hardware; rank numerals are real order ── */}
        <section className="edh-docket">
          <header className="edh-docket-head">
            <span className="edh-eyebrow">Worth your attention</span>
            <span className="edh-docket-note">ranked for your hardware, not generic advice</span>
          </header>
          {priorities == null ? (
            <div className="edh-docket-rows">
              <div className="edh-docket-row">
                <span className="edh-skel edh-skel-rank" />
                <span className="edh-skel edh-skel-line" />
              </div>
              <div className="edh-docket-row">
                <span className="edh-skel edh-skel-rank" />
                <span className="edh-skel edh-skel-line edh-skel-short" />
              </div>
            </div>
          ) : limiters.length === 0 ? (
            <div className="edh-docket-rows">
              <div className="edh-docket-row edh-docket-clear">
                Nothing worth changing today — measured clean on this rig. A lesser tool would
                invent something; Compy won't.
              </div>
            </div>
          ) : (
            <div className="edh-docket-rows">
              {limiters.slice(0, 3).map((l, i) => (
                <div className={`edh-docket-row${i === 0 ? " edh-docket-top" : ""}`} key={l.id}>
                  <span className="edh-rank edh-mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="edh-docket-text">
                    <span className="edh-docket-nm">{l.title}</span>
                    <span className="edh-docket-why">{l.reason}</span>
                  </span>
                  <span
                    className={`edh-pill edh-pill-${i === 0 ? "warn" : (statusTone[l.status] ?? "info")}`}
                  >
                    {i === 0 ? "biggest limiter" : `${l.confidence} confidence`}
                  </span>
                  <button type="button" className="edh-btn edh-btn-ghost" onClick={onSeeInFix}>
                    See in Optimize
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* The guided Setup & Tour front door — quiet, below the answer (parity with HomeV2). */}
        <div className="edh-full">
          <SetupLauncherCard />
        </div>
      </div>
    </RoomShell>
  );
}
