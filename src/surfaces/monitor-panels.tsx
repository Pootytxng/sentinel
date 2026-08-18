import { useTranslation } from "react-i18next";
import { fmtGB, fmtGHz } from "./hardware-format";
import { prettyGameName } from "./game-name";
import { CpuTempOffer } from "./CpuTempOffer";
import "../i18n";

// The deep Monitoring panels — moved VERBATIM out of App.tsx (T3, spec
// 2026-07-06-firstcheck-monitor-mvp-train) so the summary-first MonitorDomainCards can reuse
// them as its one-click expanded detail without a circular App import. Pure move: same JSX,
// same class names, same honesty copy (the kernel-driver CPU-temp note lives HERE, once).

export type CpuSensorSnapshot = {
  usage_overall_pct: number;
  usage_per_core_pct: number[];
  frequency_mhz: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
};

export type MemConsumer = { name: string; bytes: number };
export type MemoryPressure = {
  used_bytes: number;
  total_bytes: number;
  used_pct: number;
  swap_used_bytes: number;
  swap_total_bytes: number;
  level: "ok" | "tight" | "critical";
  advisory: string | null;
  top_consumers: MemConsumer[];
};

export type GpuSensorSnapshot = {
  vendor: string; // "NVIDIA" | "AMD"
  index: number;
  name: string;
  temperature_c: number | null;
  hotspot_temperature_c: number | null; // AMD junction temp; null on NVIDIA
  utilization_gpu_pct: number | null;
  utilization_memory_pct: number | null; // NVIDIA only
  vram_used_bytes: number | null;
  vram_total_bytes: number | null;
  graphics_clock_mhz: number | null;
  memory_clock_mhz: number | null;
  power_draw_w: number | null;
  fan_speed_pct: number | null; // NVIDIA reports %
  fan_speed_rpm: number | null; // AMD reports RPM
};

export type FpsSample = {
  pid: number;
  process_name: string;
  fps: number;
  avg_frametime_ms: number;
  low1_fps: number;
  frames_last_sec: number;
  recent_frametimes_ms: number[];
};

export type FpsStatus = {
  active: boolean;
  status: string; // "idle" | "starting" | "stopped" | "declined"
  sample: FpsSample | null;
};

export type CpuTemp = { temp_c: number; source: string; label: string };

export function FpsPanel({
  fps,
  busy,
  onEnable,
  onStop,
}: {
  fps: FpsStatus | null;
  busy: boolean;
  onEnable: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const active = fps?.active ?? false;
  const sample = fps?.sample ?? null;
  const declined = fps?.status === "declined";

  // Not running: invite the user to opt in (this is the one feature that
  // needs elevation, so it's explicit, never automatic).
  if (!active) {
    return (
      <div className="monitor-panel fps-panel">
        <div className="monitor-panel-head">
          <div className="monitor-panel-name">{t("monitor.monitorPanels.fpsAndFrametime")}</div>
          <div className="monitor-panel-sub">{t("monitor.monitorPanels.etwDx11Dx12")}</div>
        </div>
        <p className="fps-intro">
          {t("monitor.monitorPanels.fpsIntro")}
        </p>
        {declined && (
          <p className="fps-declined">
            {t("monitor.monitorPanels.fpsDeclined")}
          </p>
        )}
        <button className="btn btn-primary" onClick={onEnable} disabled={busy}>
          {busy ? t("monitor.monitorPanels.starting") : t("monitor.monitorPanels.enableFpsMonitoring")}
        </button>
      </div>
    );
  }

  // Active but no fresh sample yet — waiting for a game to present.
  if (!sample) {
    return (
      <div className="monitor-panel fps-panel">
        <div className="monitor-panel-head">
          <div className="monitor-panel-name">{t("monitor.monitorPanels.fpsAndFrametime")}</div>
          <button className="btn btn-small" onClick={onStop} disabled={busy}>
            {t("monitor.monitorPanels.stop")}
          </button>
        </div>
        <p className="fps-intro">
          {t("monitor.monitorPanels.fpsWaiting")}
        </p>
      </div>
    );
  }

  return (
    <div className="monitor-panel fps-panel">
      <div className="monitor-panel-head">
        <div className="monitor-panel-name">
          {t("monitor.monitorPanels.fpsAndFrametime")}
          <span className="fps-proc">{prettyGameName(sample.process_name) || t("monitor.monitorPanels.pidFallback", { pid: sample.pid })}</span>
        </div>
        <button className="btn btn-small" onClick={onStop} disabled={busy}>
          {t("monitor.monitorPanels.stop")}
        </button>
      </div>
      <div className="fps-readout">
        <div className="fps-big">
          <div className="fps-big-value">{Math.round(sample.fps)}</div>
          <div className="fps-big-label">{t("monitor.monitorPanels.fpsBigLabel")}</div>
        </div>
        <div className="fps-stats">
          <div className="fps-stat">
            <span className="fps-stat-label">{t("monitor.monitorPanels.frametimeStatLabel")}</span>
            <span className="fps-stat-value">
              {sample.avg_frametime_ms.toFixed(1)} ms
            </span>
          </div>
          <div className="fps-stat">
            <span className="fps-stat-label">{t("monitor.monitorPanels.oneLowStatLabel")}</span>
            <span className="fps-stat-value">~{Math.round(sample.low1_fps)} FPS</span>
          </div>
          <div className="fps-stat">
            <span className="fps-stat-label">{t("monitor.monitorPanels.framesPerSecLabel")}</span>
            <span className="fps-stat-value">{sample.frames_last_sec}</span>
          </div>
        </div>
      </div>
      <FrametimeGraph data={sample.recent_frametimes_ms} />
      <p className="fps-disclaimer">
        {t("monitor.monitorPanels.fpsDisclaimerPre")}<strong>{t("monitor.monitorPanels.fpsDisclaimerEmph")}</strong>{t("monitor.monitorPanels.fpsDisclaimerPost")}
      </p>
    </div>
  );
}

// Per-frame frametime line. Each point is one frame's interval in ms; spikes
// (stutter) show as upward spikes. Lower and flatter is better. Faint
// reference lines mark common frame budgets (16.7 ms = 60 FPS, 8.3 ms = 120).
export function FrametimeGraph({ data }: { data: number[] }) {
  const { t } = useTranslation();
  const width = 680;
  const height = 130;
  const pad = 4;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  if (data.length < 2) {
    return (
      <svg className="frametime-graph" width="100%" viewBox={`0 0 ${width} ${height}`} />
    );
  }
  // Dynamic Y max: show spikes without flattening normal frames. Clamp to a
  // sane band so a single huge hitch doesn't squash everything.
  const maxFt = data.reduce((m, v) => Math.max(m, v), 0);
  const yMax = Math.min(60, Math.max(20, maxFt * 1.25));
  const yOf = (ms: number) =>
    pad + usableH - (Math.min(yMax, Math.max(0, ms)) / yMax) * usableH;
  const xOf = (i: number) => pad + (i / (data.length - 1)) * usableW;

  let d = "";
  data.forEach((v, i) => {
    d += `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)} `;
  });

  const refs = [16.7, 8.3].filter((r) => r < yMax);
  return (
    <svg
      className="frametime-graph"
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {refs.map((r) => (
        <g key={r}>
          <line
            x1={pad}
            x2={width - pad}
            y1={yOf(r)}
            y2={yOf(r)}
            className="frametime-ref"
          />
          <text x={width - pad - 2} y={yOf(r) - 3} className="frametime-ref-label">
            {r === 16.7 ? t("monitor.monitorPanels.sixtyFps") : t("monitor.monitorPanels.oneTwentyFps")}
          </text>
        </g>
      ))}
      <path d={d} className="frametime-line" fill="none" />
    </svg>
  );
}

// RAM-pressure warning. Renders nothing when memory is fine — it only speaks up
// when RAM is tight/critical, which is the invisible cause of a lot of in-game
// stutter. Shows what's eating RAM so the user knows what to close.
export function MemoryPressureBanner({ mem }: { mem: MemoryPressure }) {
  const { t } = useTranslation();
  if (mem.level === "ok") return null;
  return (
    <div className={`mem-banner mem-${mem.level}`}>
      <div className="mem-banner-head">
        <strong>
          {mem.level === "critical" ? t("monitor.monitorPanels.ramAlmostFull") : t("monitor.monitorPanels.ramGettingTight")}
        </strong>
        <span className="mem-banner-pct">
          {mem.used_pct}% · {fmtGB(mem.used_bytes)} / {fmtGB(mem.total_bytes)}
        </span>
      </div>
      {mem.advisory && <p className="mem-banner-msg">{mem.advisory}</p>}
      {mem.top_consumers.length > 0 && (
        <ul className="mem-consumers">
          {mem.top_consumers.map((c) => (
            <li key={c.name}>
              <span className="mem-consumer-name">{c.name}</span>
              <span className="mem-consumer-bytes">{fmtGB(c.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CpuMonitorPanel({
  cpu,
  history,
  cpuTemp,
}: {
  cpu: CpuSensorSnapshot;
  history: CpuSensorSnapshot[];
  cpuTemp: CpuTemp | null;
}) {
  const { t } = useTranslation();
  const coreCount = cpu.usage_per_core_pct.length;
  // First call after process start returns 0% across the board because
  // sysinfo needs two samples to compute a delta. Surface this honestly:
  // if every core reads exactly 0 AND we have fewer than 2 samples, label
  // it as "warming up" instead of pretending the CPU is idle.
  const warmingUp =
    history.length < 2 &&
    cpu.usage_per_core_pct.every((v) => v === 0);
  return (
    <div className="monitor-panel">
      <div className="monitor-panel-head">
        <div className="monitor-panel-name">{t("monitor.monitorPanels.cpuPanelName")}</div>
        <div className="monitor-panel-sub">
          {t("monitor.monitorPanels.logicalCore", { count: coreCount })}
          {cpu.frequency_mhz > 0 && ` · ${fmtGHz(cpu.frequency_mhz)}`}
        </div>
      </div>
      <div className="monitor-metrics">
        <MetricRow
          label={t("monitor.monitorPanels.overallCpuUsage")}
          value={warmingUp ? null : Math.round(cpu.usage_overall_pct)}
          unit="%"
          history={history.map((s) => Math.round(s.usage_overall_pct))}
          min={0}
          max={100}
          color="#6aa9ff"
          sublabel={warmingUp ? t("monitor.monitorPanels.warmingUpSublabel") : undefined}
        />
        {cpu.frequency_mhz > 0 && (
          <MetricRow
            label={t("monitor.monitorPanels.clockSpeedLabel")}
            value={Math.round(cpu.frequency_mhz)}
            unit=" MHz"
            history={history.map((s) => Math.round(s.frequency_mhz))}
            min={0}
            max={7000}
            color="#34d399"
            sublabel={t("monitor.monitorPanels.clockSpeedSublabel")}
          />
        )}
        <MetricRow
          label={t("monitor.monitorPanels.cpuTemperatureLabel")}
          value={cpuTemp ? Math.round(cpuTemp.temp_c) : null}
          unit="°C"
          history={[cpuTemp ? Math.round(cpuTemp.temp_c) : 0]}
          min={20}
          max={100}
          color="#f5a35c"
          sublabel={
            cpuTemp
              ? t("monitor.monitorPanels.cpuTempVia", { label: cpuTemp.label, source: cpuTemp.source })
              : t("monitor.monitorPanels.cpuTempFallback")
          }
        />
        {cpu.ram_total_bytes > 0 && (
          <MetricRow
            label={t("monitor.monitorPanels.memoryUsedLabel")}
            value={Math.round((cpu.ram_used_bytes / cpu.ram_total_bytes) * 100)}
            unit="%"
            history={history.map((s) =>
              s.ram_total_bytes > 0
                ? Math.round((s.ram_used_bytes / s.ram_total_bytes) * 100)
                : 0,
            )}
            min={0}
            max={100}
            color="#a78bfa"
            sublabel={`${fmtGB(cpu.ram_used_bytes)} / ${fmtGB(cpu.ram_total_bytes)}`}
          />
        )}
      </div>
      {/* No monitor is publishing a CPU temperature: make it an OFFER, not a dead end (Q9c). The
          block detects what the user already has and gives the one next step that fits. */}
      {!cpuTemp && <CpuTempOffer />}
      {/* Per-core mini-grid — surfaces uneven core loading at a glance.
          Useful for spotting single-threaded bottlenecks vs an evenly
          loaded workload. */}
      <div className="cpu-core-grid">
        {cpu.usage_per_core_pct.map((pct, i) => (
          <CoreBar key={i} index={i} percent={warmingUp ? 0 : pct} />
        ))}
      </div>
      <div className="monitor-note">
        {cpuTemp
          ? t("monitor.monitorPanels.kernelDriverNoteWithTemp")
          : t("monitor.monitorPanels.kernelDriverNoteNoTemp")}
      </div>
    </div>
  );
}

export function CoreBar({ index, percent }: { index: number; percent: number }) {
  const { t } = useTranslation();
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="cpu-core" title={t("monitor.monitorPanels.coreTooltip", { index, percent: Math.round(percent) })}>
      <div className="cpu-core-bar">
        <div className="cpu-core-fill" style={{ transform: `scaleX(${clamped / 100})` }} />
      </div>
      <div className="cpu-core-label">{Math.round(percent)}%</div>
    </div>
  );
}

export function GpuMonitorPanel({
  gpu,
  history,
}: {
  gpu: GpuSensorSnapshot;
  history: (GpuSensorSnapshot | null)[];
}) {
  const { t } = useTranslation();
  const vramUsedPct =
    gpu.vram_used_bytes && gpu.vram_total_bytes
      ? Math.round((gpu.vram_used_bytes / gpu.vram_total_bytes) * 100)
      : null;
  // AMD reports fan as RPM, NVIDIA as a percent. Pick whichever this card
  // actually provides and graph it on an appropriate scale.
  const fanIsRpm = gpu.fan_speed_rpm !== null;
  return (
    <div className="monitor-panel">
      <div className="monitor-panel-head">
        <div className="monitor-panel-name">
          <span className={`gpu-vendor-pill gpu-vendor-${gpu.vendor.toLowerCase()}`}>
            {gpu.vendor}
          </span>
          {gpu.name}
          {gpu.vendor.toUpperCase() === "NVIDIA" && (
            <span
              className="gpu-unverified"
              title={t("monitor.monitorPanels.nvidiaUnverifiedTitle")}
            >
              {t("monitor.monitorPanels.unverified")}
            </span>
          )}
        </div>
        <div className="monitor-panel-sub">
          {gpu.vram_total_bytes
            ? `${fmtGB(gpu.vram_total_bytes)}${t("monitor.monitorPanels.vramSuffix")}`
            : t("monitor.monitorPanels.adapterLabel", { index: gpu.index })}
        </div>
      </div>
      <div className="monitor-metrics">
        {gpu.temperature_c !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.gpuTemperatureLabel")}
            value={gpu.temperature_c}
            unit="°C"
            history={history.map((s) => s?.temperature_c ?? null)}
            min={20}
            max={100}
            color="#f87171"
          />
        )}
        {gpu.hotspot_temperature_c !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.hotspotLabel")}
            value={gpu.hotspot_temperature_c}
            unit="°C"
            history={history.map((s) => s?.hotspot_temperature_c ?? null)}
            min={20}
            max={110}
            color="#fb923c"
            sublabel={t("monitor.monitorPanels.hotspotSublabel")}
          />
        )}
        {gpu.utilization_gpu_pct !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.gpuUtilizationLabel")}
            value={gpu.utilization_gpu_pct}
            unit="%"
            history={history.map((s) => s?.utilization_gpu_pct ?? null)}
            min={0}
            max={100}
            color="#6aa9ff"
          />
        )}
        {gpu.vram_used_bytes !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.vramUsedLabel")}
            value={vramUsedPct}
            unit={vramUsedPct !== null ? "%" : ""}
            history={history.map((s) =>
              s?.vram_used_bytes && s?.vram_total_bytes
                ? Math.round((s.vram_used_bytes / s.vram_total_bytes) * 100)
                : null,
            )}
            min={0}
            max={100}
            color="#a78bfa"
            sublabel={
              gpu.vram_used_bytes && gpu.vram_total_bytes
                ? `${fmtGB(gpu.vram_used_bytes)} / ${fmtGB(gpu.vram_total_bytes)}`
                : gpu.vram_used_bytes
                ? t("monitor.monitorPanels.usedSuffix", { gb: fmtGB(gpu.vram_used_bytes) })
                : undefined
            }
          />
        )}
        {gpu.power_draw_w !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.powerDrawLabel")}
            value={Math.round(gpu.power_draw_w)}
            unit="W"
            history={history.map((s) =>
              s?.power_draw_w !== null && s?.power_draw_w !== undefined
                ? Math.round(s.power_draw_w)
                : null,
            )}
            min={0}
            max={400}
            color="#f5c451"
          />
        )}
        {gpu.graphics_clock_mhz !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.graphicsClockLabel")}
            value={gpu.graphics_clock_mhz}
            unit=" MHz"
            history={history.map((s) => s?.graphics_clock_mhz ?? null)}
            min={0}
            max={3500}
            color="#4ade80"
          />
        )}
        {gpu.memory_clock_mhz !== null && (
          <MetricRow
            label={t("monitor.monitorPanels.memoryClockLabel")}
            value={gpu.memory_clock_mhz}
            unit=" MHz"
            history={history.map((s) => s?.memory_clock_mhz ?? null)}
            min={0}
            max={3000}
            color="#38bdf8"
          />
        )}
        {(gpu.fan_speed_rpm !== null || gpu.fan_speed_pct !== null) && (
          <MetricRow
            label={t("monitor.monitorPanels.fanSpeedLabel")}
            value={fanIsRpm ? gpu.fan_speed_rpm : gpu.fan_speed_pct}
            unit={fanIsRpm ? " RPM" : "%"}
            history={history.map((s) =>
              fanIsRpm ? s?.fan_speed_rpm ?? null : s?.fan_speed_pct ?? null,
            )}
            min={0}
            max={fanIsRpm ? 3500 : 100}
            color="#8a93a8"
          />
        )}
      </div>
    </div>
  );
}

export function MetricRow({
  label,
  value,
  unit,
  history,
  min,
  max,
  color,
  sublabel,
}: {
  label: string;
  value: number | null;
  unit: string;
  history: (number | null)[];
  min: number;
  max: number;
  color: string;
  sublabel?: string;
}) {
  return (
    <div className="metric-row">
      <div className="metric-label">
        <div>{label}</div>
        {sublabel && <div className="metric-sublabel">{sublabel}</div>}
      </div>
      <div className="metric-value" style={{ color }}>
        {value === null ? "—" : `${value}${unit}`}
      </div>
      <Sparkline data={history} min={min} max={max} color={color} />
    </div>
  );
}

export function Sparkline({
  data,
  min,
  max,
  color,
}: {
  data: (number | null)[];
  min: number;
  max: number;
  color: string;
}) {
  const width = 360;
  const height = 36;
  const pad = 2;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  // Build the path as a series of M / L commands so null gaps don't draw
  // straight lines across missing data.
  const len = data.length;
  if (len < 2) {
    return <svg className="sparkline" width={width} height={height} />;
  }
  let d = "";
  let penDown = false;
  data.forEach((v, i) => {
    if (v === null) {
      penDown = false;
      return;
    }
    const x = pad + (i / (len - 1)) * usableW;
    const clamped = Math.min(max, Math.max(min, v));
    const y = pad + usableH - ((clamped - min) / (max - min || 1)) * usableH;
    if (!penDown) {
      d += `M${x.toFixed(1)} ${y.toFixed(1)} `;
      penDown = true;
    } else {
      d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
    }
  });
  return (
    <svg className="sparkline" width={width} height={height}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
