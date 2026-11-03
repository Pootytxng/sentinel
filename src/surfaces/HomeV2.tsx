import { ConfidenceWord } from "../design/ConfidenceWord";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { readHologramV2 } from "../design/theme";
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
import { postureLine, liveStrip } from "./command-center-data";
import { gradeGpuTempForVendor, sensorForGpu, type GpuSensorReading } from "../data/gpu-sensor";
import { useDocumentVisible } from "../data/use-document-visible";
import { gradeFps, gradeLow1, gradeColor, type Grade } from "../data/metric-grade";
import { useManualParts } from "./rig/manual-parts";
import { HardwareGrid } from "./HardwareGrid";
import { inEffectCounts, useMachineModel } from "../data/machine-model";
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
  /** Where the "See in …" buttons land: "Lab" on the proving-ground rail, "Optimize" classic. */
  fixRoomLabel?: string;
  /** App's station deep-link. The drift module's pointer opens the Care view ("blackbox"), whose
   *  "Since it last worked" list names and dates each drift (P6-timeline). Absent → text only. */
  onOpenLabStation?: (station: string) => void;
};

const fmtGB1 = (b: number) => (b / 1024 ** 3).toFixed(1);

// Grade → v2 status tone (the token palette has ok/warn/info; "bad" leans on warn — the tag copy
// carries the specifics). Neutral = no LED, no colored value (ungraded, e.g. NVIDIA temp).
const gradeTone = (g: Grade): "ok" | "warn" | null =>
  g === "good" ? "ok" : g === "ok" || g === "bad" ? "warn" : null;

// Resolve the v2 accent for canvas-drawing vendor components (they can't read var(--v2-accent)).
// Falls back to the token default so a failed resolve still renders the approved violet.
// Exported: HomeHud frames its hologram bay with the same accent (ElectricBorder's one use).
export function useV2Accent(): string {
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

  // ── live tag probes (existing read-only commands; a failure just omits the value) ──
  const [gpuSnaps, setGpuSnaps] = useState<GpuSensorReading[] | null>(null);
  const [mem, setMem] = useState<{ used: number; total: number; level: string } | null>(null);
  // Q7 idle-cost: pause while the window is hidden (same contract as HomeConsole's port of this poll).
  const visible = useDocumentVisible();
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const poll = () => {
      invoke<GpuSensorReading[]>("get_gpu_sensors")
        .then((g) => !cancelled && setGpuSnaps(g ?? null))
        .catch(() => !cancelled && setGpuSnaps(null));
      invoke<{ used_bytes: number; total_bytes: number; level: string }>("get_memory_pressure")
        .then(
          (m) =>
            !cancelled &&
            setMem(
              // 0 of 0 is the backend's no-reading (a poisoned lock), never "0.0 / 0.0 GB" in green.
              m && m.total_bytes > 0 ? { used: m.used_bytes, total: m.total_bytes, level: m.level } : null,
            ),
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
  // T4d contract, which this face skipped (codebase review 2026-11-03): v2 rests idle and Orbit is an
  // opt-in, so the bay doesn't render continuously; classic (flag "0") keeps its orbit. The select
  // handler is stable so RigHologram's memo holds.
  const [autoRotate, setAutoRotate] = useState(() => !readHologramV2());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onRigSelect = useCallback((id: string) => setSelectedId(id || null), []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { parts: manualParts } = useManualParts();

  // ── measured derivations (all real, all honestly empty when absent) ──
  // The Machine Model's in-effect answer (#452) — see HomeHud for why never the bare ledger list.
  const inEffect = inEffectCounts(model);
  const posture = postureLine(readiness, priorities, inEffect, t);
  const strip = liveStrip(sessions, t);
  // Session numbers graded against THIS rig (deslop directive #4): fps vs the display's real
  // refresh, 1% low vs the session's own average. Neutral (nothing measured) = uncolored ink.
  const rig = { refreshHz: hw.display?.current_refresh_rate_hz ?? null };
  const fpsGrade: Grade = strip.kind === "data" ? gradeFps(strip.avgFps, rig) : "neutral";
  const low1Grade: Grade = strip.kind === "data" ? gradeLow1(strip.low1Est, strip.avgFps) : "neutral";
  const gradeClass = (g: Grade) => (g === "neutral" ? "" : ` hv2-grade-${g}`);
  const gradeInk = (g: Grade) => (g === "neutral" ? undefined : { color: gradeColor(g) });
  const checking = readiness == null; // checks literally still running (boot hydrate / re-scan)
  // LOCKED rule 5: the named GPU's own snapshot, graded by its own vendor (HomeConsole has why).
  const gpuReading = sensorForGpu(gpuSnaps, hw.gpus?.[0]?.name);
  const gpuTemp = gpuReading?.temperature_c ?? null;
  const gpuGrade = gradeGpuTempForVendor(gpuReading?.vendor, gpuTemp);

  const measured = readiness
    ? t("home.homeV2.header.checksMeasured", {
        done: readiness.checks.length - readiness.unknown_count,
        total: readiness.checks.length,
      }) +
      (readiness.attention_count === 0
        ? t("home.homeV2.header.noAttention")
        : t("home.homeV2.header.needsAttention", { count: readiness.attention_count }))
    : t("home.homeV2.header.runningChecks");

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

  // An unreadable ledger loads as an EMPTY one, and these two cards paint an empty one as "0" +
  // "nothing applied yet — your PC is untouched": a claim ABOUT THE MACHINE, read off a record
  // Compy cannot read. At zero the two are indistinguishable, so here zero is an ABSENCE, not a
  // measurement — and the honest render is the one the card above already uses for a session it
  // can't report: drop the reading, keep the note. Only the EMPTY branch narrows; a PARTIAL list
  // still names its real (floor) count, with the notice above disclosing that it is a floor.
  // UNKNOWN health (probe failed or disabled) leaves everything byte-identical to healthy —
  // see design/LedgerHealthNotice.tsx.
  const health = useLedgerHealth(changes);
  const ledgerBlank = changes.length === 0 && !!knownIncomplete(health);
  // See HomeHud: the absolute reversibility promise is withdrawn on health alone, not on the count.
  const ledgerUnvouched = !!knownIncomplete(health);
  // The model's own "can't read" is the same absence as a blank ledger: a word, never a 0.
  const activeWithdrawn = ledgerBlank || inEffect.kind === "unreadable";

  // ── Glanceable fill (spec 2026-07-05) — measured-only sources for the two glance cards ──
  // Drift watch: the A5 drift signal, surfaced on Home for the first time (no one-mention clash).
  const drifts = readiness?.drifts ?? [];
  // P6-timeline: the drift module counts and points; the Care view's "Since it last worked" list
  // is the one place each drift is named and dated.
  const seeWhatChanged = onOpenLabStation && (
    <button type="button" className="hv2-inline-link" onClick={() => onOpenLabStation("blackbox")}>
      {t("home.homeV2.stats.seeWhatChanged")}
    </button>
  );
  // Drive health: SMART reads only — a drive with no reading is omitted from the count, never guessed.
  const smartDrives = (hw.disk_health ?? []).filter((d) => d.health !== "Unknown");
  const flaggedDrives = smartDrives.filter((d) => d.health !== "Healthy");

  // Sparkline: avg FPS across the recent sessions, oldest → newest (real records only).
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

  // The hologram stage (shared by the framed and reduced-motion paths).
  const stage = (
    <div className="hv2-stage">
      {checking && !reduced && <div className="hv2-scan" aria-hidden="true" />}
      {rig3d ? (
        <Suspense
          fallback={<div className="hv2-stage-loading">{t("home.homeV2.stage.loading")}</div>}
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
        <div className="hv2-stage-cards">
          <HardwareGrid hw={hw} model={model} />
        </div>
      )}
      {rig3d && (
        <>
          <div className="hv2-tags hv2-tags-left">
            <PartTag
              tone={mem ? gradeTone(mem.level === "ok" ? "good" : "bad") : null}
              name={t("home.homeV2.tag.ram")}
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
                name={t("home.homeV2.tag.storage")}
                value={t("home.homeV2.tag.diskFull", { pct: diskPct })}
                valueTone={diskPct >= 90 ? "warn" : "ok"}
              />
            )}
          </div>
          <div className="hv2-tags hv2-tags-right">
            <PartTag
              tone={gradeTone(gpuGrade)}
              name={t("home.homeV2.tag.gpu")}
              detail={shortModel(hw.gpus[0]?.name)}
              value={gpuTemp != null ? `${Math.round(gpuTemp)}°C` : undefined}
              valueTone={gradeTone(gpuGrade)}
            />
            <PartTag
              tone={null}
              name={t("home.homeV2.tag.cpu")}
              detail={hw.cpu_arch?.family_label || undefined}
              value={t("home.homeV2.tag.cpuNoTemp")}
              mono={false}
            />
          </div>
          <div className="hv2-stage-hint">{t("home.homeV2.stage.hint")}</div>
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
          {t("home.homeV2.actions.rerun")}
        </button>
      }
    >
      <div className="hv2-grid">
        {/* ── Hologram hero — the owner's centerpiece on a dedicated stage ── */}
        <div className="hv2-hero">
          <div className="hv2-hero-head">
            <span className="hv2-hero-title">{t("home.homeV2.hero.title")}</span>
            <div
              className="hv2-view-toggle"
              role="tablist"
              aria-label={t("home.homeV2.hero.rigViewAria")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={rig3d}
                className={`hv2-seg ${rig3d ? "hv2-seg-on" : ""}`}
                onClick={() => chooseRig3d(true)}
              >
                {t("home.homeV2.hero.view3d")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!rig3d}
                className={`hv2-seg ${!rig3d ? "hv2-seg-on" : ""}`}
                onClick={() => chooseRig3d(false)}
              >
                {t("home.homeV2.hero.viewCards")}
              </button>
            </div>
            {rig3d && (
              <div className="hv2-stage-controls">
                <button
                  type="button"
                  className={`hv2-seg ${exploded ? "hv2-seg-on" : ""}`}
                  onClick={() => setExploded((v) => !v)}
                >
                  {exploded ? t("home.homeV2.hero.reassemble") : t("home.homeV2.hero.exploded")}
                </button>
                <button
                  type="button"
                  className={`hv2-seg ${autoRotate ? "hv2-seg-on" : ""}`}
                  onClick={() => setAutoRotate((v) => !v)}
                  aria-pressed={autoRotate}
                >
                  {t("home.homeV2.hero.orbit")}
                </button>
              </div>
            )}
          </div>
          {reduced ? (
            <div className="hv2-hero-frame">{stage}</div>
          ) : (
            // ElectricBorder's one sanctioned USE-CLASS (adopt list): the hologram stage frame —
            // here and HomeHud's bay (the flag-switched render of the same room). Nowhere else.
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
                <span className="hv2-stat-k">
                  {t("home.homeV2.stats.lastSessionGame", { game: strip.game })}
                </span>
                <span
                  className={`hv2-stat-n hv2-mono${gradeClass(fpsGrade)}`}
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
                  <span className="hv2-stat-unit">
                    {t("home.homeV2.stats.fpsAvg")}
                    {strip.avgFps == null && ` · ${t("home.homeV2.stats.notMeasured")}`}
                  </span>
                </span>
                <span className="hv2-stat-d">
                  <Term id="one-percent-lows">{t("home.homeV2.stats.onePercentLowLabel")}</Term>{" "}
                  <span
                    className={`hv2-mono${gradeClass(low1Grade)}`}
                    style={gradeInk(low1Grade)}
                  >
                    {strip.low1Est != null
                      ? Math.round(strip.low1Est)
                      : t("home.homeV2.stats.notMeasured")}
                  </span>
                  {strip.low1Est != null && ` ${t("home.homeV2.stats.estimateSuffix")}`}
                </span>
                {sparkValues.length >= 2 && (
                  <div className="hv2-spark">
                    <Sparkline values={sparkValues} height={26} stroke="var(--v2-accent)" />
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="hv2-stat-k">{t("home.homeV2.stats.lastSession")}</span>
                <span className="hv2-stat-d">{t("home.homeV2.stats.noSession")}</span>
              </>
            )}
          </SpotlightCard>

          {/* Above the two readings it qualifies — a caveat printed under its subject has
              already failed at its job. Self-nulling when health is complete or UNKNOWN. */}
          <LedgerHealthNotice health={health} />

          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">{t("home.homeV2.stats.activeChangesLabel")}</span>
            {activeWithdrawn ? (
              <span className="hv2-stat-d">{t("common.ledgerHealth.activeUnknown")}</span>
            ) : inEffect.kind !== "counted" ? (
              <span className="hv2-stat-d">{t("common.ledgerHealth.activePending")}</span>
            ) : (
              <>
                <span className="hv2-stat-n hv2-mono">
                  {reduced ? inEffect.activeNow : <CountUp to={inEffect.activeNow} duration={0.9} />}
                </span>
                <span className="hv2-stat-d">
                  {ledgerUnvouched
                    ? t("common.ledgerHealth.activeChangesUnvouched")
                    : t("home.homeV2.stats.activeChangesNote")}
                  {inEffect.unknown > 0 &&
                    ` · ${t("common.ledgerHealth.activeUnchecked", { count: inEffect.unknown })}`}
                </span>
              </>
            )}
          </SpotlightCard>

          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">{t("home.homeV2.stats.trustLedgerLabel")}</span>
            {ledgerBlank ? (
              <span className="hv2-stat-d">{t("common.ledgerHealth.trackedUnknown")}</span>
            ) : (
              <>
                <span className="hv2-stat-n hv2-mono">
                  {reduced ? changes.length : <CountUp to={changes.length} duration={0.9} />}
                  <span className="hv2-stat-unit">
                    {t("home.homeV2.stats.changesTracked", { count: changes.length })}
                  </span>
                </span>
                {latest ? (
                  // Long titles/task ids truncate with an ellipsis (V2-9 punch b — the wrap
                  // produced a mid-word break artifact); the full name stays reachable via title.
                  <span className="hv2-stat-d hv2-stat-latest">
                    <span className="hv2-stat-latest-t" title={latest.rec_title}>
                      {t("home.homeV2.stats.latest", { title: latest.rec_title })}
                    </span>
                    <span className="hv2-mono">· {latestTime}</span>
                  </span>
                ) : (
                  <span className="hv2-stat-d">{t("home.homeV2.stats.nothingApplied")}</span>
                )}
              </>
            )}
          </SpotlightCard>

          {/* ── Glanceable fill (spec 2026-07-05) — below the existing stats, so the verdict →
              hologram → priorities order is untouched (answer-first). Measured or honestly absent. ── */}
          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">{t("home.homeV2.stats.driftWatchLabel")}</span>
            {readiness == null ? (
              <span className="hv2-stat-d">{t("home.homeV2.stats.driftPending")}</span>
            ) : drifts.length === 0 ? (
              <>
                <span className="hv2-glance-h">
                  <span className="hv2-led hv2-led-ok" aria-hidden="true" />
                  {t("home.homeV2.stats.driftNone")}
                </span>
                <span className="hv2-stat-d">{t("home.homeV2.stats.driftNoneNote")}</span>
              </>
            ) : (
              <>
                <span className="hv2-glance-h hv2-glance-warn">
                  <span className="hv2-led hv2-led-warn" aria-hidden="true" />
                  {t("home.homeV2.stats.driftCount", { count: drifts.length })}
                </span>
                <span className="hv2-stat-d">{seeWhatChanged ?? t("home.homeV2.stats.driftWhere")}</span>
              </>
            )}
          </SpotlightCard>

          <SpotlightCard className="hv2-stat" spotlightColor="rgba(167, 139, 250, 0.10)">
            <span className="hv2-stat-k">{t("home.homeV2.stats.driveHealthLabel")}</span>
            {smartDrives.length === 0 ? (
              <span className="hv2-stat-d">{t("home.homeV2.stats.driveHealthUnknown")}</span>
            ) : flaggedDrives.length === 0 ? (
              <>
                <span className="hv2-glance-h">
                  <span className="hv2-led hv2-led-ok" aria-hidden="true" />
                  {t("home.homeV2.stats.drivesHealthy")}
                </span>
                <span className="hv2-stat-d">
                  {t("home.homeV2.stats.driveCountOk", { count: smartDrives.length })}
                </span>
              </>
            ) : (
              <>
                <span className="hv2-glance-h hv2-glance-warn">
                  <span className="hv2-led hv2-led-warn" aria-hidden="true" />
                  {flaggedDrives[0].friendly_name} — {flaggedDrives[0].health}
                </span>
                <span className="hv2-stat-d">
                  {t("home.homeV2.stats.smartFlagged", { count: flaggedDrives.length })}
                </span>
              </>
            )}
          </SpotlightCard>
        </div>

        {/* ── Priorities — ranked for THIS hardware, honest when clean ── */}
        <div className="hv2-card hv2-full">
          <div className="hv2-card-hd">
            {t("home.homeV2.priorities.title")}
            <span className="hv2-card-hd-right">{t("home.homeV2.priorities.note")}</span>
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
              <div className="hv2-row hv2-row-clear">{t("home.homeV2.priorities.clean")}</div>
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
                    {i === 0
                      ? t("home.homeV2.priorities.biggestLimiter")
                      : <ConfidenceWord band={l.confidence} />}
                  </span>
                  <button type="button" className="hv2-btn hv2-btn-ghost" onClick={onSeeInFix}>
                    {t("home.homeV2.priorities.seeIn", { room: fixRoomLabel })}
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
