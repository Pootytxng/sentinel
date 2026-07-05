import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import type { Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { SetupLauncherCard } from "./setup/SetupLauncherCard";
import ElectricBorder from "../design/vendor/ElectricBorder/ElectricBorder";
import CountUp from "../design/vendor/CountUp/CountUp";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import SpotlightCard from "../design/vendor/SpotlightCard/SpotlightCard";
import "./home-v2.css";

// HomeV2 (V2-3, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Home room on the V2 shell,
// laid out per the owner-approved mockup: verdict → hologram hero stage + stat column →
// priorities card → forward door (RoomShell provides the door from DOOR_MAP).
//
// The hero elevates the owner's favorite asset (the REAL WebGL rig hologram — never a stock
// viewer) onto a dedicated stage: ElectricBorder frame (its ONE sanctioned use, per the adopt
// list), measured part-tags projected beside the model, and a scan sweep that renders ONLY
// while checks are actually running (readiness not yet resolved) — motion tied to real
// activity, honesty law intact. Reduced motion: static frame, no sweep, plain numbers.
//
// Every number here is measured or honestly absent: posture verdict from postureLine (real
// readiness/priorities), tags read live sensors through existing read-only commands (a failed
// probe just omits the value), stats are the ledger/session records. Zero new IPC, zero Rust.

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

// Grade → v2 status tone (the token palette has ok/warn/info; "bad" leans on warn — the tag copy
// carries the specifics). Neutral = no LED, no colored value (ungraded, e.g. NVIDIA temp).
const gradeTone = (g: Grade): "ok" | "warn" | null =>
  g === "good" ? "ok" : g === "ok" || g === "bad" ? "warn" : null;

// Resolve the v2 accent for canvas-drawing vendor components (they can't read var(--v2-accent)).
// Falls back to the token default so a failed resolve still renders the approved violet.
function useV2Accent(): string {
  const [accent, setAccent] = useState("#a78bfa");
  useEffect(() => {
    try {
      const got = getComputedStyle(document.documentElement).getPropertyValue("--v2-accent").trim();
      if (got) setAccent(got);
    } catch {
      /* keep fallback */
    }
  }, []);
  return accent;
}

// One projected part-tag: LED (only when a measured value earned a tone) · part · detected
// model name · measured value.
function PartTag({
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
    <div className="hv2-tag">
      {tone && <span className={`hv2-led hv2-led-${tone}`} aria-hidden="true" />}
      <b>{name}</b>
      {detail && <span className="hv2-tag-detail">{detail}</span>}
      {value && (
        <span
          className={`hv2-tag-v ${mono ? "hv2-mono" : ""} ${valueTone ? `hv2-tag-v-${valueTone}` : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// Short marketing-prefix-free model name for a tag ("AMD Radeon RX 9070 XT" → "RX 9070 XT").
// Purely presentational trimming of the DETECTED name — never invents or substitutes a model.
const shortModel = (n: string | undefined): string | undefined =>
  n?.replace(/^\s*(AMD|NVIDIA|Intel)?\s*(Radeon|GeForce|Arc)?\s*(\(TM\))?\s*/i, "").trim() || n;

export function HomeV2({
  hw,
  readiness,
  priorities,
  sessions,
  changes,
  onRunCheck,
  onSeeInFix,
}: Props) {
  const reduced = useReducedMotion();
  const accent = useV2Accent();

  // ── live tag probes (existing read-only commands; a failure just omits the value) ──
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

  // ── rig view state (same persisted pref as the classic Home — Cards vs 3D) ──
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

  // ── measured derivations (all real, all honestly empty when absent) ──
  const posture = postureLine(readiness, priorities, activeChangeCount(changes));
  const strip = liveStrip(sessions);
  const checking = readiness == null; // checks literally still running (boot hydrate / re-scan)
  const vendor = gpuVendor(hw.gpus?.[0]?.name);
  const gpuGrade = gradeGpuTempForVendor(vendor, gpuTemp);

  const measured = readiness
    ? `${readiness.checks.length - readiness.unknown_count}/${readiness.checks.length} checks measured` +
      (readiness.attention_count === 0
        ? " · nothing needs urgent attention"
        : ` · ${readiness.attention_count} need${readiness.attention_count === 1 ? "s" : ""} attention`)
    : "running checks…";

  // Storage tag: the Windows drive (C:) — used% from the same disk probe the hardware cards read.
  const sysDisk = hw.disks?.find((d) => d.mount_point?.toUpperCase().startsWith("C"));
  const diskPct =
    sysDisk && sysDisk.total_bytes > 0
      ? Math.round(((sysDisk.total_bytes - sysDisk.available_bytes) / sysDisk.total_bytes) * 100)
      : null;

  // Ledger stat: newest entry (append-only ledger — last element is newest).
  const latest = changes.length > 0 ? changes[changes.length - 1] : null;
  const latestTime = latest
    ? new Date(latest.applied_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const activeCount = activeChangeCount(changes);

  // ── Glanceable fill (spec 2026-07-05) — measured-only sources for the two glance cards ──
  // Drift watch: the A5 drift signal, surfaced on Home for the first time (no one-mention clash).
  const drifts = readiness?.drifts ?? [];
  const driftNames =
    drifts
      .slice(0, 2)
      .map((d) => d.label)
      .join(" · ") + (drifts.length > 2 ? ` · and ${drifts.length - 2} more` : "");
  // Drive health: SMART reads only — a drive with no reading is omitted from the count, never guessed.
  const smartDrives = (hw.disk_health ?? []).filter((d) => d.health !== "Unknown");
  const flaggedDrives = smartDrives.filter((d) => d.health !== "Healthy");

  // Sparkline: avg FPS across the recent sessions, oldest → newest (real records only).
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

  // The hologram stage (shared by the framed and reduced-motion paths).
  const stage = (
    <div className="hv2-stage">
      {checking && !reduced && <div className="hv2-scan" aria-hidden="true" />}
      {rig3d ? (
        <Suspense fallback={<div className="hv2-stage-loading">Initializing hologram…</div>}>
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
        <div className="hv2-stage-cards">
          <HardwareGrid hw={hw} />
        </div>
      )}
      {rig3d && (
        <>
          <div className="hv2-tags hv2-tags-left">
            <PartTag
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
              <PartTag
                tone={diskPct >= 90 ? "warn" : "ok"}
                name="Storage"
                value={`C: ${diskPct}% full`}
                valueTone={diskPct >= 90 ? "warn" : "ok"}
              />
            )}
          </div>
          <div className="hv2-tags hv2-tags-right">
            <PartTag
              tone={gradeTone(gpuGrade)}
              name="GPU"
              detail={shortModel(hw.gpus[0]?.name)}
              value={gpuTemp != null ? `${Math.round(gpuTemp)}°C` : undefined}
              valueTone={gradeTone(gpuGrade)}
            />
            <PartTag
              tone={null}
              name="CPU"
              detail={hw.cpu_arch?.family_label || undefined}
              value="temp n/a — by design"
              mono={false}
            />
          </div>
          <div className="hv2-stage-hint">
            Drag to orbit · click a part for its live specs · statuses are measured, never guessed
          </div>
        </>
      )}
    </div>
  );

  return (
    <RoomShell
      room="home"
      verdict={
        reduced ? (
          posture.headline
        ) : (
          // The "measurement arriving" moment (adopt list: verdicts ONLY) — the measured verdict
          // resolves character-by-character each time a fresh scan lands. Text is postureLine's
          // real output; the animation never alters what is claimed.
          <DecryptedText
            key={posture.headline}
            text={posture.headline}
            animateOn="view"
            sequential
            speed={22}
            useOriginalCharsOnly
          />
        )
      }
      sub={posture.sentence}
      measured={measured}
      primaryAction={
        <button type="button" className="hv2-btn" onClick={onRunCheck}>
          Re-run check
        </button>
      }
    >
      <div className="hv2-grid">
        {/* ── Hologram hero — the owner's centerpiece on a dedicated stage ── */}
        <div className="hv2-hero">
          <div className="hv2-hero-head">
            <span className="hv2-hero-title">Your rig</span>
            <div className="hv2-view-toggle" role="tablist" aria-label="Rig view">
              <button
                type="button"
                role="tab"
                aria-selected={rig3d}
                className={`hv2-seg ${rig3d ? "hv2-seg-on" : ""}`}
                onClick={() => chooseRig3d(true)}
              >
                3D
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!rig3d}
                className={`hv2-seg ${!rig3d ? "hv2-seg-on" : ""}`}
                onClick={() => chooseRig3d(false)}
              >
                Cards
              </button>
            </div>
            {rig3d && (
              <div className="hv2-stage-controls">
                <button
                  type="button"
                  className={`hv2-seg ${exploded ? "hv2-seg-on" : ""}`}
                  onClick={() => setExploded((v) => !v)}
                >
                  {exploded ? "Reassemble" : "Exploded"}
                </button>
                <button
                  type="button"
                  className={`hv2-seg ${autoRotate ? "hv2-seg-on" : ""}`}
                  onClick={() => setAutoRotate((v) => !v)}
                  aria-pressed={autoRotate}
                >
                  Orbit
                </button>
              </div>
            )}
          </div>
          {reduced ? (
            <div className="hv2-hero-frame">{stage}</div>
          ) : (
            // ElectricBorder's ONE sanctioned use (adopt list): the hero stage frame. Nowhere else.
            <ElectricBorder color={accent} speed={0.4} chaos={0.04} borderRadius={10} className="hv2-eb">
              {stage}
            </ElectricBorder>
          )}
        </div>

        {/* ── Stat column — measured records land with weight (CountUp on real values only) ── */}
        <div className="hv2-stack">
          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            {strip.kind === "data" ? (
              <>
                <span className="hv2-stat-k">Last session · {strip.game}</span>
                <span className="hv2-stat-n hv2-mono">
                  {reduced ? (
                    Math.round(strip.avgFps)
                  ) : (
                    <CountUp to={Math.round(strip.avgFps)} duration={0.9} />
                  )}
                  <span className="hv2-stat-unit">fps avg</span>
                </span>
                <span className="hv2-stat-d">1% low {Math.round(strip.low1Est)} (estimate)</span>
                {sparkValues.length >= 2 && (
                  <div className="hv2-spark">
                    <Sparkline values={sparkValues} height={26} stroke="var(--v2-accent)" />
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="hv2-stat-k">Last session</span>
                <span className="hv2-stat-d">
                  Play a session to see this — Compy captures it from outside the game.
                </span>
              </>
            )}
          </SpotlightCard>

          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">Safe changes active</span>
            <span className="hv2-stat-n hv2-mono">
              {reduced ? activeCount : <CountUp to={activeCount} duration={0.9} />}
            </span>
            <span className="hv2-stat-d">every one reversible from the ledger</span>
          </SpotlightCard>

          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">Trust ledger</span>
            <span className="hv2-stat-n hv2-mono">
              {reduced ? changes.length : <CountUp to={changes.length} duration={0.9} />}
              <span className="hv2-stat-unit">
                change{changes.length === 1 ? "" : "s"} tracked
              </span>
            </span>
            {latest ? (
              // Long titles/task ids truncate with an ellipsis (V2-9 punch b — the wrap produced
              // a mid-word break artifact); the full name stays reachable via the title attr.
              <span className="hv2-stat-d hv2-stat-latest">
                <span className="hv2-stat-latest-t" title={latest.rec_title}>
                  latest: {latest.rec_title}
                </span>
                <span className="hv2-mono">· {latestTime}</span>
              </span>
            ) : (
              <span className="hv2-stat-d">nothing applied yet — your PC is untouched</span>
            )}
          </SpotlightCard>

          {/* ── Glanceable fill (spec 2026-07-05) — below the existing stats, so the verdict →
              hologram → priorities order is untouched (answer-first). Measured or honestly absent. ── */}
          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">Drift watch</span>
            {readiness == null ? (
              <span className="hv2-stat-d">drift status lands with the current check</span>
            ) : drifts.length === 0 ? (
              <>
                <span className="hv2-glance-h">
                  <span className="hv2-led hv2-led-ok" aria-hidden="true" />
                  Nothing's drifted
                </span>
                <span className="hv2-stat-d">every applied change is still holding</span>
              </>
            ) : (
              <>
                <span className="hv2-glance-h hv2-glance-warn">
                  <span className="hv2-led hv2-led-warn" aria-hidden="true" />
                  {drifts.length} setting{drifts.length === 1 ? "" : "s"} drifted off
                </span>
                <span className="hv2-stat-d">{driftNames}</span>
              </>
            )}
          </SpotlightCard>

          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">Drive health</span>
            {smartDrives.length === 0 ? (
              <span className="hv2-stat-d">
                no SMART reading from this rig — Compy won't guess drive health
              </span>
            ) : flaggedDrives.length === 0 ? (
              <>
                <span className="hv2-glance-h">
                  <span className="hv2-led hv2-led-ok" aria-hidden="true" />
                  Drives healthy
                </span>
                <span className="hv2-stat-d">
                  {smartDrives.length} drive{smartDrives.length === 1 ? "" : "s"} · SMART OK
                </span>
              </>
            ) : (
              <>
                <span className="hv2-glance-h hv2-glance-warn">
                  <span className="hv2-led hv2-led-warn" aria-hidden="true" />
                  {flaggedDrives[0].friendly_name} — {flaggedDrives[0].health}
                </span>
                <span className="hv2-stat-d">
                  SMART flagged {flaggedDrives.length === 1 ? "this drive" : `${flaggedDrives.length} drives`} —
                  back up important data
                </span>
              </>
            )}
          </SpotlightCard>
        </div>

        {/* ── Priorities — ranked for THIS hardware, honest when clean ── */}
        <div className="hv2-card hv2-full">
          <div className="hv2-card-hd">
            Worth your attention
            <span className="hv2-card-hd-right">ranked for your hardware, not generic advice</span>
          </div>
          {priorities == null ? (
            <div className="hv2-rows">
              <div className="hv2-row">
                <span className="hv2-skel hv2-skel-dot" />
                <span className="hv2-skel hv2-skel-line" />
              </div>
              <div className="hv2-row">
                <span className="hv2-skel hv2-skel-dot" />
                <span className="hv2-skel hv2-skel-line hv2-skel-short" />
              </div>
            </div>
          ) : limiters.length === 0 ? (
            <div className="hv2-rows">
              <div className="hv2-row hv2-row-clear">
                Nothing worth changing today — measured clean on this rig. A lesser tool would
                invent something; Compy won't.
              </div>
            </div>
          ) : (
            <div className="hv2-rows">
              {limiters.slice(0, 3).map((l, i) => (
                <div className={`hv2-row${i === 0 ? " hv2-row-top" : ""}`} key={l.id}>
                  <span className={`hv2-mark hv2-mark-${statusTone[l.status] ?? "info"}`} />
                  <span className="hv2-row-text">
                    <span className="hv2-row-nm">{l.title}</span>
                    <span className="hv2-row-why">{l.reason}</span>
                  </span>
                  <span
                    className={`hv2-pill hv2-pill-${i === 0 ? "warn" : (statusTone[l.status] ?? "info")}`}
                  >
                    {i === 0 ? "biggest limiter" : `${l.confidence} confidence`}
                  </span>
                  <button type="button" className="hv2-btn hv2-btn-ghost" onClick={onSeeInFix}>
                    See in Optimize
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The guided Setup & Tour front door — quiet, below the answer (parity with classic Home). */}
        <div className="hv2-full">
          <SetupLauncherCard />
        </div>
      </div>
    </RoomShell>
  );
}
