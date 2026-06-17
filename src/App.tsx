import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Onboarding, { ONBOARDED_KEY } from "./Onboarding";
import FirstCheck, { FIRST_CHECK_KEY } from "./surfaces/FirstCheck";
import TweakEncyclopedia from "./surfaces/TweakEncyclopedia";
import { LibraryContext } from "./surfaces/library-context";
import { Term, GlossText, type GlossRule } from "./design/Term";
import { Wordmark } from "./design/Wordmark";
import { BackButton, ForwardButton } from "./design/BackButton";
import { NavGlyph } from "./design/NavGlyph";
import { readCloseToTray, persistDisplayRefreshHz, readLivingInstrument } from "./design/theme";
import { HardwareGrid } from "./surfaces/HardwareGrid";
import { fmtGB, fmtGHz } from "./surfaces/hardware-format";
import { HOME_RAIL, type HomeRailId } from "./design/homeRail";
import { GamingMode } from "./surfaces/GamingMode";
import { LatencyTab } from "./surfaces/Latency";
import { BenchmarkTab } from "./surfaces/Benchmark";
import CommandCenter from "./surfaces/CommandCenter";
import Fix from "./surfaces/Fix";
import Learn from "./surfaces/Learn";
import Check from "./surfaces/Check";
import { prettyGameName } from "./surfaces/game-name";
import { gpuVendor } from "./surfaces/walkthroughs";
import type { BatchApplyReport } from "./types";
import { bumpLocalStat, readLocalStats, statsLine } from "./data/local-stats";
import Play from "./surfaces/Play";
import Lab from "./surfaces/Lab";
import { SessionDebrief } from "./surfaces/SessionDebrief";
import { GUIDED_STEPS, openGuidedUri } from "./surfaces/guided";
import Settings from "./surfaces/Settings";
import { type GamingSessionFile, isRecoverable, statusLabel } from "./surfaces/gaming-mode";
import "./App.css";
import "./design/doorknob.css";
import { KonamiWhisper } from "./design/KonamiWhisper";
import { useConfirm } from "./design/ConfirmDialog";
import "./design/instrument.css"; // Instrument token layer — after App.css so the accent re-point wins
import "./Onboarding.css";
import "./arc-instrument.css"; // arc re-dress skin (scoped under .arc-v2; after the classics)
import "./design/living-instrument.css"; // "Living Instrument" feel-refresh skin — scoped under [data-living], default OFF
import "./design/dashboard-skin.css"; // "dashboard-energy" premium skin — scoped under [data-dash-v2], default OFF

type DiskInfo = {
  mount_point: string;
  total_bytes: number;
  available_bytes: number;
  file_system: string;
};

export type GpuInfo = {
  name: string;
  vram_bytes: number;
  driver_version: string;
  driver_date: string;
  driver_age_days: number | null;
  video_processor: string;
  current_refresh_rate_hz: number;
};

type PhysicalDiskInfo = {
  friendly_name: string;
  media_type: string;
  bus_type: string;
  size_bytes: number;
};

type DisplayInfo = {
  width: number;
  height: number;
  current_refresh_rate_hz: number;
  max_refresh_rate_hz: number;
};

type MemoryModuleInfo = {
  capacity_bytes: number;
  speed_mhz: number;
  type_name: string;
  manufacturer: string;
};

type WindowsVersionInfo = {
  edition: string;
  display_version: string;
  build: string;
  ubr: number;
  product_name: string;
};

type CpuArchInfo = {
  vendor: string;
  family_label: string;
  architecture: string;
  generation: string;
};

// Classified network adapter (detection train) — `name` is the InterfaceDescription (the evidence
// shown to users), `medium` is "wired" | "wifi" | "other". Serialized snake_case by serde.
type NetAdapterInfo = { name: string; physical: boolean; medium: string; connected: boolean };

export type HardwareInfo = {
  cpu_brand: string;
  cpu_cores_logical: number;
  cpu_cores_physical: number;
  cpu_frequency_mhz: number;
  ram_total_bytes: number;
  ram_used_bytes: number;
  swap_total_bytes: number;
  os_name: string;
  os_version: string;
  kernel_version: string;
  hostname: string;
  disks: DiskInfo[];
  gpus: GpuInfo[];
  physical_disks: PhysicalDiskInfo[];
  display: DisplayInfo | null;
  memory_modules: MemoryModuleInfo[];
  windows_version: WindowsVersionInfo | null;
  cpu_arch: CpuArchInfo | null;
  network_adapters: NetAdapterInfo[];
  has_wired_ethernet_port: boolean;
};

// "Verified"        — Compy directly observes the fact this rec claims.
// "Measured signal" — Third-party benchmarks / community consensus measured it.
// "Expected impact" — Logical from Windows internals, not benchmarked.
// Reserved for the synthetic benchmark suite: any rec whose impact reproduces
// under Compy's own benchmark graduates to "verified."
type Provenance = "verified" | "measured-signal" | "expected-impact";

type Recommendation = {
  id: string;
  title: string;
  category: string;
  severity: "safe" | "moderate" | "advanced";
  description: string;
  impact: string;
  downside: string | null;
  applies_to: string;
  currently_applied: boolean;
  provenance: Provenance;
  eligible?: boolean;
  ineligible_reason?: string | null;
};

type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
  // Trust Ledger fields (per ARCHITECTURE_LOCKS §1.5 — captured at apply
  // time so rollback survives rule updates / CDN outages / app upgrades).
  // Optional because pre-typed-action entries don't have them yet.
  applied_action?: Record<string, unknown> | null;
  rollback_action?: Record<string, unknown> | null;
  app_version_at_apply?: string | null;
  ruleset_version_at_apply?: string | null;
  elevation_used?: boolean | null;
  // Human-readable prior the trust-switch reveals (computed read-only by the backend; see types.ts).
  restores_label?: string | null;
};

type StartupEntry = {
  name: string;
  command: string;
  enabled: boolean;
};

const APPLIABLE_REC_IDS = new Set<string>([
  "game-mode",
  "visual-effects",
  "sysmain-disable",
  "nvidia-telemetry",
  "power-ultimate",
  "nagle-disable",
  "hags-enable",
  "mouse-accel-off",
  "game-bar-disable",
  "diagtrack-disable",
  "windows-search-disable",
  "fast-startup-off",
  "reserved-storage-off",
  "usb-selective-suspend-off",
  "pcie-aspm-off",
  "eee-disable",
]);

// Coarse "how long ago" for the Drift Watch "noticed …" line.
function fmtAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "recently";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// Tabs: Overview is always visible. The category tabs match Recommendation
// .category strings exactly so filtering is a string equality check. Startup
// and History only appear when they have content.
const REC_CATEGORIES = ["Windows", "Power", "GPU", "Display", "Storage", "Network"] as const;
type RecCategory = (typeof REC_CATEGORIES)[number];
// Top-level sections shown in the left command rail. The six rec categories +
// Startup are consolidated into one "Optimize" section (filtered inside) so the
// rail stays short and never needs a horizontal scroll.
type Tab = "Overview" | "Check" | "Readiness" | "Priorities" | "Optimize" | "Play" | "Monitoring" | "Sessions" | "Learn" | "Lab" | "Latency" | "Benchmark" | "Diagnostics" | "History" | "Gaming";

// Inline stroke icons (no icon font/library → offline, zero-outbound).
const ICONS: Record<string, React.ReactNode> = {
  grid: (<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>),
  shield: (<><path d="M12 3l7 2.5v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V5.5L12 3z" /><path d="M9 12l2 2 4-4" /></>),
  target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>),
  sliders: (<><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" /><circle cx="9" cy="8" r="2.3" /><circle cx="15" cy="16" r="2.3" /></>),
  pulse: (<path d="M3 12h4l2-6 4 12 2-6h6" />),
  chart: (<><line x1="4" y1="20" x2="20" y2="20" /><rect x="5.5" y="11" width="3" height="7" /><rect x="10.5" y="7" width="3" height="11" /><rect x="15.5" y="13" width="3" height="5" /></>),
  terminal: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3" /><line x1="13" y1="15" x2="16.5" y2="15" /></>),
  ledger: (<><rect x="5" y="3" width="14" height="18" rx="2" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></>),
  engine: (<><rect x="3" y="10" width="11" height="8" rx="1.5" /><path d="M14 12h3l3 3v3h-6" /><line x1="6" y1="10" x2="6" y2="7" /><line x1="10" y1="10" x2="10" y2="7" /><line x1="5" y1="7" x2="11" y2="7" /><line x1="14" y1="6" x2="20" y2="6" /></>),
  external: (<><path d="M14 4h6v6" /><path d="M20 4l-8 8" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>),
  chevron: (<path d="M6 9l6 6 6-6" />),
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

type CpuSensorSnapshot = {
  usage_overall_pct: number;
  usage_per_core_pct: number[];
  frequency_mhz: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
};

type MemConsumer = { name: string; bytes: number };
type MemoryPressure = {
  used_bytes: number;
  total_bytes: number;
  used_pct: number;
  swap_used_bytes: number;
  swap_total_bytes: number;
  level: "ok" | "tight" | "critical";
  advisory: string | null;
  top_consumers: MemConsumer[];
};

type GpuSensorSnapshot = {
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

type FpsSample = {
  pid: number;
  process_name: string;
  fps: number;
  avg_frametime_ms: number;
  low1_fps: number;
  frames_last_sec: number;
  recent_frametimes_ms: number[];
};

type FpsStatus = {
  active: boolean;
  status: string; // "idle" | "starting" | "stopped" | "declined"
  sample: FpsSample | null;
};

type DiagnosticEntry = {
  label: string;
  value: string;
  note?: string;
};

type DiagnosticSection = {
  name: string;
  entries: DiagnosticEntry[];
};

// Game Readiness (F2): a read-only advisory surface. Mirrors the Rust
// GameReadiness shape from readiness.rs (status strings are kebab-case).
type ReadinessStatus = "ready" | "attention" | "unknown" | "advisory";

// Exactly the three readiness rows the owner approved for tooltips (VRR, driver age, power plan).
// Bounded allowlist, first occurrence per string, so the auto-glossary stays tasteful — no further
// reach this pass (owner decision B, 2026-06-05).
const READINESS_GLOSS: GlossRule[] = [
  { id: "vrr", match: ["variable refresh rate", "vrr"] },
  { id: "drivers", match: ["driver age", "graphics driver", "gpu driver", "driver"] },
  { id: "power-plans", match: ["power plan", "ultimate performance", "high performance"] },
];

type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  value: string | null;
  action_uri?: string | null;
  action_label?: string | null;
};

type GameReadiness = {
  checks: ReadinessCheck[];
  ready_count: number;
  attention_count: number;
  unknown_count: number;
  advisory_count: number;
  advisory: string;
  dismissed_ids: string[];
  drifts: Drift[];
};

// Drift Watch — a check that was good and has since regressed (outside Compy).
type Drift = { id: string; label: string; detail: string; noticed_at: string };

function ReadinessTab({
  readiness,
  onChanged,
}: {
  readiness: GameReadiness | null;
  onChanged: () => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  if (!readiness) {
    return (
      <section className="tab-pane">
        <p className="muted">Run a scan to see game readiness.</p>
      </section>
    );
  }
  const statusLabel: Record<ReadinessStatus, string> = {
    ready: "Ready",
    attention: "Attention",
    unknown: "Unknown",
    advisory: "Advisory",
  };
  const dismissedSet = new Set(readiness.dismissed_ids);
  const active = readiness.checks.filter((c) => !dismissedSet.has(c.id));
  const dismissed = readiness.checks.filter((c) => dismissedSet.has(c.id));
  // Only alert/info findings are dismissable — a clean Ready row has nothing to silence.
  const dismissable = (s: ReadinessStatus) => s === "attention" || s === "advisory";
  const dismiss = async (id: string) => {
    try {
      await invoke("dismiss_readiness_check", { id });
      onChanged();
    } catch {
      /* surfaced on next scan */
    }
  };
  const restore = async (id: string) => {
    try {
      await invoke("restore_readiness_check", { id });
      onChanged();
    } catch {
      /* surfaced on next scan */
    }
  };
  const row = (c: ReadinessCheck, isDismissed: boolean) => (
    <li
      key={c.id}
      className={`readiness-row readiness-row-${c.status}${isDismissed ? " readiness-row-dismissed" : ""}`}
    >
      <div className="readiness-row-head">
        <span className={`readiness-badge readiness-${c.status}`}>{statusLabel[c.status]}</span>
        <span className="readiness-label">
          <GlossText text={c.label} rules={READINESS_GLOSS} />
        </span>
        {c.value && <span className="readiness-value">{c.value}</span>}
      </div>
      <p className="readiness-detail">
        <GlossText text={c.detail} rules={READINESS_GLOSS} />
      </p>
      <div className="readiness-row-actions">
        {c.action_uri && (
          <button
            className="readiness-action"
            onClick={() => openGuidedUri(c.action_uri!)}
            title={`Opens ${c.action_label ?? "settings"}`}
          >
            <Icon name="external" />
            {c.action_label ?? "Open"}
          </button>
        )}
        {isDismissed ? (
          <button className="readiness-dismiss" onClick={() => restore(c.id)}>
            Restore
          </button>
        ) : (
          dismissable(c.status) && (
            <button
              className="readiness-dismiss"
              onClick={() => dismiss(c.id)}
              title="Silence this — you've judged it; it moves to Dismissed and stops counting"
            >
              Dismiss
            </button>
          )
        )}
      </div>
    </li>
  );
  return (
    <section className="tab-pane readiness-pane">
      <div className="readiness-head">
        <h2>Game Readiness</h2>
        <div className="readiness-summary">
          <span className="readiness-pill readiness-ready">
            {readiness.ready_count} Ready
          </span>
          <span className="readiness-pill readiness-attention">
            {readiness.attention_count} Attention
          </span>
          <span className="readiness-pill readiness-unknown">
            {readiness.unknown_count} Unknown
          </span>
          {readiness.advisory_count > 0 && (
            <span className="readiness-pill readiness-advisory">
              {readiness.advisory_count} Advisory
            </span>
          )}
        </div>
      </div>
      <p className="readiness-blurb">{readiness.advisory}</p>
      {readiness.drifts.length > 0 && (
        <div className="drift-watch">
          <div className="drift-watch-head">Changed since you last had it set</div>
          {readiness.drifts.map((d) => {
            const check = readiness.checks.find((c) => c.id === d.id);
            return (
              <div key={d.id} className="drift-row">
                <div className="drift-row-top">
                  <span className="drift-label">{d.label}</span>
                  <span className="drift-when">changed outside Compy · noticed {fmtAgo(d.noticed_at)}</span>
                </div>
                <p className="drift-detail">{d.detail}</p>
                {check?.action_uri ? (
                  <button
                    className="readiness-action"
                    onClick={() => openGuidedUri(check.action_uri!)}
                    title={`Opens ${check.action_label ?? "settings"}`}
                  >
                    <Icon name="external" />
                    {check.action_label ?? "Open settings to restore"}
                  </button>
                ) : (
                  <p className="drift-note">Re-apply it in Optimize to restore — Compy logs it to the Trust Ledger.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ul className="readiness-list">{active.map((c) => row(c, false))}</ul>
      {dismissed.length > 0 && (
        <div className="readiness-dismissed">
          <button
            className="readiness-dismissed-head"
            onClick={() => setShowDismissed((s) => !s)}
          >
            {showDismissed ? "▾" : "▸"} Dismissed ({dismissed.length}) — silenced by you
          </button>
          {showDismissed && (
            <ul className="readiness-list">{dismissed.map((c) => row(c, true))}</ul>
          )}
        </div>
      )}
    </section>
  );
}

// Session summaries (F3): read-only post-session metrics. Mirrors the Rust
// SessionSummary shape. Metrics are live estimates, not benchmark-grade proof.
type SessionSummary = {
  started_at: string;
  duration_secs: number;
  process_name: string;
  samples: number;
  avg_fps: number;
  avg_frametime_ms: number;
  low1_fps_est: number;
  peak_gpu_temp_c: number | null;
  peak_gpu_usage_pct: number | null;
  peak_ram_used_bytes: number | null;
  ram_total_bytes: number | null;
  compy_changes_active: number;
  hw_fingerprint?: {
    hash: string;
    gpu: string;
    gpu_driver: string;
    ram_gb: number;
    display: string;
  } | null;
  stutter_insight?: string | null;
};

function SessionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-metric">
      <span className="session-metric-label">{label}</span>
      <span className="session-metric-value">{value}</span>
    </div>
  );
}

function SessionsTab({
  sessions,
  priorities,
  recs,
  apply,
  busyId,
  onExport,
  changes,
  rollback,
  arcV2,
}: {
  sessions: SessionSummary[];
  priorities: Priorities | null;
  recs: Recommendation[];
  apply: (rec: Recommendation) => Promise<void>;
  busyId: string | null;
  onExport: () => void;
  changes: AppliedChange[];
  rollback: (c: AppliedChange) => Promise<void>;
  arcV2: boolean;
}) {
  if (sessions.length === 0) {
    return (
      <section className="tab-pane">
        <p className="muted">
          No game sessions recorded yet. Enable FPS monitoring while playing a
          borderless/windowed game; when you stop, a summary appears here.
        </p>
      </section>
    );
  }
  const fmtDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };
  const fmtGiB = (b: number | null) =>
    b == null ? "—" : `${(b / 1024 ** 3).toFixed(1)} GB`;
  return (
    <section className="tab-pane sessions-pane">
      <div className="readiness-head">
        <h2>Session Summaries</h2>
      </div>
      <p className="readiness-blurb">
        Live estimates sampled about once per second while monitoring was active
        — not benchmark-grade proof.
      </p>
      <SessionDebrief
        s={sessions[0]}
        priorities={priorities}
        recs={recs}
        apply={apply}
        busyId={busyId}
        onExport={onExport}
        changes={changes}
        rollback={rollback}
        arcV2={arcV2}
      />
      {sessions.length > 1 && <h3 className="priorities-group">Earlier sessions</h3>}
      <ul className="sessions-list">
        {sessions.slice(1).map((s, i) => (
          <li key={`${s.started_at}-${i}`} className="session-card">
            <div className="session-card-head">
              <span className="session-game">
                {prettyGameName(s.process_name) || "Unknown game"}
              </span>
              <span className="session-meta">
                {fmtDuration(s.duration_secs)} ·{" "}
                {new Date(s.started_at).toLocaleString()}
              </span>
            </div>
            <div className="session-metrics">
              <SessionMetric label="Avg FPS" value={s.avg_fps.toFixed(1)} />
              <SessionMetric
                label="Avg frametime"
                value={`${s.avg_frametime_ms.toFixed(1)} ms`}
              />
              <SessionMetric label="1% low (est)" value={s.low1_fps_est.toFixed(1)} />
              <SessionMetric
                label="Peak GPU temp"
                value={s.peak_gpu_temp_c == null ? "—" : `${s.peak_gpu_temp_c}°C`}
              />
              <SessionMetric
                label="Peak GPU usage"
                value={
                  s.peak_gpu_usage_pct == null ? "—" : `${s.peak_gpu_usage_pct}%`
                }
              />
              <SessionMetric label="Peak RAM" value={fmtGiB(s.peak_ram_used_bytes)} />
              <SessionMetric
                label="Compy changes active"
                value={String(s.compy_changes_active)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Export Snapshot (F5): read-only local report. Mirrors the Rust ExportResult.
type ExportResult = { path: string; json_path: string; markdown: string; discord: string };

export function ReportModal({
  report,
  onClose,
  onOpenFolder,
  onReexport,
}: {
  report: ExportResult;
  onClose: () => void;
  onOpenFolder: () => void;
  onReexport: (feedback: string | null) => Promise<void>;
}) {
  // Structured feedback capture (spec 2026-06-11): three OPTIONAL prompts, formatted into the
  // report ONLY when filled and ONLY when the user clicks re-export (never on keystroke, never
  // pre-filled, never auto-sent — the answers exist solely in the file the user chooses to share).
  const [fbWhat, setFbWhat] = useState("");
  const [fbConfusing, setFbConfusing] = useState("");
  const [fbNext, setFbNext] = useState("");
  const [fbState, setFbState] = useState<"idle" | "busy" | "added" | "failed">("idle");
  const feedbackBlock = () => {
    const parts: string[] = [];
    if (fbWhat.trim()) parts.push(`**In one sentence:** ${fbWhat.trim()}`);
    if (fbConfusing.trim()) parts.push(`**Confusing/off:** ${fbConfusing.trim()}`);
    if (fbNext.trim()) parts.push(`**Want next:** ${fbNext.trim()}`);
    return parts.length > 0 ? parts.join("\n\n") : null;
  };
  const addFeedback = async () => {
    setFbState("busy");
    try {
      await onReexport(feedbackBlock()); // blank → null → backend appends nothing
      setFbState("added");
      setTimeout(() => setFbState("idle"), 2000);
    } catch {
      setFbState("failed");
    }
  };
  // Two distinct copies (tester friction, 2026-06-10): the compact SUMMARY card vs the FULL
  // Markdown report — the old single "Copy for Discord" copied the summary while testers believed
  // they were sharing the full diagnostics. Each button says exactly what it copies (doorknob law),
  // with per-button feedback so there's no ambiguity about which landed on the clipboard.
  const [copied, setCopied] = useState<"summary" | "full" | null>(null);
  const copy = async (kind: "summary" | "full") => {
    try {
      await navigator.clipboard.writeText(kind === "summary" ? report.discord : report.markdown);
      if (kind === "summary") bumpLocalStat("shareCardsCopied"); // R3 Lane D
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — the block is still visible to select manually */
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
      >
        <div className="modal-head">
          <h2 id="export-modal-title">Report exported</h2>
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted modal-path">Saved to {report.path}</p>
        <div className="export-feedback">
          <div className="export-feedback-head">
            Before you share — help us improve <span className="muted">(optional)</span>
          </div>
          <label className="export-feedback-field">
            <span>In one sentence, what is Compy to you?</span>
            <textarea rows={2} value={fbWhat} onChange={(e) => setFbWhat(e.target.value)} />
          </label>
          <label className="export-feedback-field">
            <span>Anything confuse you or feel off?</span>
            <textarea rows={2} value={fbConfusing} onChange={(e) => setFbConfusing(e.target.value)} />
          </label>
          <label className="export-feedback-field">
            <span>What would you want next?</span>
            <textarea rows={2} value={fbNext} onChange={(e) => setFbNext(e.target.value)} />
          </label>
          <div className="export-feedback-actions">
            <button
              className="btn"
              onClick={addFeedback}
              disabled={fbState === "busy" || feedbackBlock() === null}
            >
              {fbState === "busy"
                ? "Re-exporting…"
                : fbState === "added"
                  ? "Feedback added ✓"
                  : fbState === "failed"
                    ? "Failed — try again"
                    : "Add my feedback & re-export"}
            </button>
          </div>
        </div>
        <pre className="report-preview">{report.markdown}</pre>
        {/* R3 Lane D — the quiet local-stats line: honest, this-PC-only counters (the future
            opt-in telemetry's seed data). Hidden until there is anything to say. */}
        {statsLine(readLocalStats()) && (
          <p className="muted export-local-stats">{statsLine(readLocalStats())}</p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onOpenFolder}>
            Open folder
          </button>
          <button className="btn" onClick={() => copy("full")}>
            {copied === "full" ? "Copied!" : "Copy full report"}
          </button>
          <button className="btn" onClick={() => copy("summary")}>
            {copied === "summary" ? "Copied!" : "Copy summary card"}
          </button>
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Priority Ranking (F4): read-only/advisory. Mirrors the Rust Priorities shape.
type PriorityStatus = "ready" | "attention" | "unknown";
type Confidence = "high" | "medium" | "low";
type PriorityItem = {
  id: string;
  title: string;
  reason: string;
  linked: string | null;
  confidence: Confidence;
  status: PriorityStatus;
};
type Priorities = {
  limiters: PriorityItem[];
  already_fine: PriorityItem[];
  not_worth_touching: PriorityItem[];
  session_hint: string | null;
  // R3 Lane B — rendered by Check (the classic PrioritiesTab ignores it on purpose).
  upgrade_path: import("./types").UpgradePath | null;
};

function PrioritiesTab({ priorities }: { priorities: Priorities | null }) {
  if (!priorities) {
    return (
      <section className="tab-pane">
        <p className="muted">Run a scan to see priorities.</p>
      </section>
    );
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  // `badge` lets a bucket override the per-item status chip — the "Not worth touching" group is
  // INFO by definition, so its rows read "Info" rather than the raw (often "Unknown") status.
  const row = (i: PriorityItem, badge?: { cls: string; label: string }) => (
    <li key={i.id} className={`readiness-row readiness-row-${badge?.cls ?? i.status}`}>
      <div className="readiness-row-head">
        <span className={`readiness-badge readiness-${badge?.cls ?? i.status}`}>
          {badge?.label ?? cap(i.status)}
        </span>
        <span className="readiness-label">{i.title}</span>
        <span className="priority-confidence">{cap(i.confidence)} confidence</span>
      </div>
      <p className="readiness-detail">{i.reason}</p>
    </li>
  );
  return (
    <section className="tab-pane">
      <div className="readiness-head">
        <h2>Priorities — what matters most</h2>
      </div>
      <p className="readiness-blurb">
        Advisory, ranked by transparent rules — not a score. Based on your hardware,
        readiness, recommendations, and most recent session.
      </p>
      {priorities.session_hint && (
        <p className="priority-session-hint">{priorities.session_hint}</p>
      )}

      <h3 className="priorities-group">Your biggest likely limiters</h3>
      {priorities.limiters.length === 0 ? (
        <p className="muted">Nothing major flagged — nice.</p>
      ) : (
        <ul className="readiness-list">{priorities.limiters.map((i) => row(i))}</ul>
      )}

      <h3 className="priorities-group">Already fine</h3>
      {priorities.already_fine.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="readiness-list">{priorities.already_fine.map((i) => row(i))}</ul>
      )}

      <h3 className="priorities-group">Not worth touching</h3>
      {priorities.not_worth_touching.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="readiness-list">
          {priorities.not_worth_touching.map((i) => row(i, { cls: "info", label: "Info" }))}
        </ul>
      )}
    </section>
  );
}

// (The classic appearance ThemePicker was retired 2026-06-06 — superseded by the Instrument theme
// system: Halfway/Midnight/Hearth via data-itheme, set app-wide at startup and managed in Settings. A
// recorded decision, not a silent loss — see the surface-default governance section in
// docs/superpowers/plans/2026-06-04-beta-build-order.md.)

// New Instrument surfaces ride behind per-surface localStorage flags. Default ON in dev so the owner
// sees them first; OFF in a release build until the reskin lands fully. Additive + reversible — a
// flag off restores the classic surface untouched.
const HOME_V2_KEY = "compy_home_v2";
const FIX_V2_KEY = "compy_fix_v2";
const LEARN_V2_KEY = "compy_learn_v2";
const ARC_V2_KEY = "compy_arc_v2";
const CHECK_V2_KEY = "compy_check_v2";
const PLAY_V2_KEY = "compy_play_v2";
const LAB_V2_KEY = "compy_lab_v2";
const APP_VERSION = "0.1.0";
// The Instrument/Halfway-Home surfaces DEFAULT ON everywhere (the redesign is the shipped app —
// owner sign-off 2026-06-06). A stored "0" is now SELF-HEALED to v2 (removed + default): the
// Settings "New look" UI that wrote "0"s is gone, so a stale "0" had become an exit-less
// soft-lock onto a classic surface — the owner hit it live 2026-06-11 (a leftover
// compy_check_v2="0" routed every Check click to the old Game Readiness page and hid Past
// Tweaks). M3-spec step 2, executed early. Session-scoped classic (Fix's "Classic Optimize"
// escape hatch) still works via its runtime setter; a relaunch restores v2.
function readDevFlag(key: string): boolean {
  try {
    if (localStorage.getItem(key) === "0") {
      localStorage.removeItem(key); // self-heal the lockout
    }
  } catch {
    /* ignore — default v2 */
  }
  return true;
}
function persistFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore persistence failure — still applies this session */
  }
}

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSection[]>([]);
  const [rulesSource, setRulesSource] = useState<string>("embedded");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  // Living Instrument "simplified rail" (2026-06-15): when the preview skin is on, the shell rail
  // shows the everyday rooms and tucks Lab under an "Advanced" group (owner direction: fewer, plainer
  // tabs). `living` mirrors the flag live (Settings toggle broadcasts compy:living-changed); default
  // OFF → the classic six-room rail. Reversible: the flag governs only which rail layout renders.
  const [living, setLiving] = useState<boolean>(readLivingInstrument);
  useEffect(() => {
    const on = () => setLiving(readLivingInstrument());
    window.addEventListener("compy:living-changed", on);
    return () => window.removeEventListener("compy:living-changed", on);
  }, []);
  const [readiness, setReadiness] = useState<GameReadiness | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  // Sessions "new debrief" indicator: the started_at of the latest session the user has seen.
  const [sessionsSeenAt, setSessionsSeenAt] = useState<string>(
    () => localStorage.getItem("compy_sessions_seen_v1") ?? "",
  );
  const [showEncyclopedia, setShowEncyclopedia] = useState(false);
  const [libraryFocusId, setLibraryFocusId] = useState<string | null>(null);
  const libraryApi = useMemo(
    () => ({
      openLibrary: (focusId?: string) => {
        setLibraryFocusId(focusId ?? null);
        setShowEncyclopedia(true);
      },
    }),
    [],
  );
  const [report, setReport] = useState<ExportResult | null>(null);
  const [priorities, setPriorities] = useState<Priorities | null>(null);
  const [exporting, setExporting] = useState(false);
  // Instrument-surface preview flags — see readDevFlag.
  // v2-look flags: read ONCE from localStorage at startup (the hidden dev A/B path — set the key in
  // devtools + reload to drop a surface to its classic version). No runtime setters / no UI anymore:
  // the user-facing "New look" hub was removed now that parity is closed. `fixV2` keeps its setter
  // for the Fix surface's own in-surface "disable preview" escape hatch. `settingsV2` is gone — the
  // lockout fix made Settings always open (no classic settings surface ever existed).
  const [homeV2] = useState<boolean>(() => readDevFlag(HOME_V2_KEY));
  const [fixV2, setFixV2] = useState<boolean>(() => readDevFlag(FIX_V2_KEY));
  const [learnV2] = useState<boolean>(() => readDevFlag(LEARN_V2_KEY));
  const [arcV2] = useState<boolean>(() => readDevFlag(ARC_V2_KEY));
  const [checkV2] = useState<boolean>(() => readDevFlag(CHECK_V2_KEY));
  const [playV2] = useState<boolean>(() => readDevFlag(PLAY_V2_KEY));
  const [labV2] = useState<boolean>(() => readDevFlag(LAB_V2_KEY));
  const [showSettings, setShowSettings] = useState(false);
  // Settings opens from the custom titlebar (window chrome lives outside <App/>, so it signals across
  // the tree — same bridge as the compy:*-changed flags). The titlebar gear is the app-wide entry.
  useEffect(() => {
    const on = () => setShowSettings(true);
    window.addEventListener("compy:open-settings", on);
    return () => window.removeEventListener("compy:open-settings", on);
  }, []);
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem(ONBOARDED_KEY) !== "1",
  );
  // Moment 2 — first-check landing, shown once after onboarding (or via "Re-run check").
  const [showFirstCheck, setShowFirstCheck] = useState(
    () => localStorage.getItem(FIRST_CHECK_KEY) !== "1",
  );
  // Gaming Mode (F1) is gated — the backend returns false until its mutation QA
  // + owner sign-off, so the tab never appears by default (the surface is dark).
  const [gamingEnabled, setGamingEnabled] = useState(false);
  useEffect(() => {
    invoke<boolean>("gaming_mode_enabled").then(setGamingEnabled).catch(() => {});
  }, []);
  // Sync the persisted close-to-tray preference to the backend on startup, so the close handler
  // knows it before the user ever closes the window (default OFF = §1 clean exit until opt-in).
  useEffect(() => {
    invoke("set_close_to_tray", { enabled: readCloseToTray() }).catch(() => {});
  }, []);
  // While the Sessions tab is open, mark the latest debrief as seen — clears the "new" badge.
  useEffect(() => {
    if (activeTab === "Sessions" && sessions[0]) {
      setSessionsSeenAt(sessions[0].started_at);
      try {
        localStorage.setItem("compy_sessions_seen_v1", sessions[0].started_at);
      } catch {
        /* non-fatal */
      }
    }
  }, [activeTab, sessions]);
  // Global crash-recovery: once Gaming Mode is enabled, check on launch — regardless of which tab
  // is open — whether a previous session ended uncleanly, and surface a prompt to restore. Inert
  // while the feature is gated off (gamingEnabled stays false → never checks; no orphans can exist
  // anyway since sessions can't start). This is what makes recovery greet the user on startup
  // instead of only when they happen to open the Gaming tab.
  const [gamingRecovery, setGamingRecovery] = useState<GamingSessionFile | null>(null);
  useEffect(() => {
    if (!gamingEnabled) return;
    invoke<GamingSessionFile | null>("get_gaming_session_state")
      .then((s) => {
        if (s && isRecoverable(s.status)) setGamingRecovery(s);
      })
      .catch(() => {});
  }, [gamingEnabled]);
  const recoverGaming = async (confirm: boolean) => {
    if (!confirm) {
      setGamingRecovery(null);
      return;
    }
    try {
      await invoke("recover_gaming_session", { confirm: true });
      setGamingRecovery(null); // cleared only once restore confirms
    } catch (e) {
      setError(String(e)); // leave the banner up so the user can retry / Review
    }
  };

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      setReport(await invoke<ExportResult>("export_report", { feedback: null }));
      bumpLocalStat("reportsExported"); // R3 Lane D — local-only counter, best-effort
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const refresh = async () => {
    setError(null);
    try {
      const [
        info,
        recommendations,
        history,
        startupEntries,
        diagSections,
        source,
        gameReadiness,
        sessionList,
        prioritiesData,
      ] = await Promise.all([
        invoke<HardwareInfo>("get_hardware_info"),
        invoke<Recommendation[]>("get_recommendations"),
        invoke<AppliedChange[]>("get_applied_changes"),
        invoke<StartupEntry[]>("get_startup_entries"),
        invoke<DiagnosticSection[]>("get_diagnostics"),
        invoke<string>("get_rules_source"),
        invoke<GameReadiness>("get_game_readiness"),
        invoke<SessionSummary[]>("get_session_summaries"),
        invoke<Priorities>("get_priorities"),
      ]);
      setHw(info);
      // Relay the monitor's refresh to the OVERLAY window (localStorage — the existing cross-window
      // channel) so its frametime graph can anchor a fixed scale + frame-budget line. Zero IPC.
      persistDisplayRefreshHz(info.display?.current_refresh_rate_hz);
      setRecs(recommendations);
      setChanges(history);
      setStartup(startupEntries);
      setDiagnostics(diagSections);
      setRulesSource(source);
      setReadiness(gameReadiness);
      setSessions(sessionList);
      setPriorities(prioritiesData);
    } catch (e) {
      setError(String(e));
    }
  };

  // Re-fetch just readiness (after a dismiss/restore) without a full rescan.
  const reloadReadiness = async () => {
    try {
      setReadiness(await invoke<GameReadiness>("get_game_readiness"));
    } catch {
      /* keep the prior readiness on a transient failure */
    }
  };

  const toggleStartup = async (entry: StartupEntry) => {
    setBusyId(`startup:${entry.name}`);
    setError(null);
    try {
      await invoke("set_startup_entry_enabled", {
        name: entry.name,
        enabled: !entry.enabled,
      });
      setStartup((prev) =>
        prev.map((e) => (e.name === entry.name ? { ...e, enabled: !e.enabled } : e))
      );
    } catch (e) {
      setError(`Toggle failed: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const confirm = useConfirm();

  const apply = async (rec: Recommendation) => {
    const tradeoff = rec.downside ? ` Tradeoff: ${rec.downside}` : "";
    const ok = await confirm({
      title: `Apply "${rec.title}"?`,
      body: `${rec.description}${tradeoff} Compy snapshots the prior state so you can roll this back anytime.`,
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setBusyId(rec.id);
    setError(null);
    try {
      await invoke<AppliedChange>("apply_recommendation", {
        recId: rec.id,
        recTitle: rec.title,
      });
      await refresh();
    } catch (e) {
      setError(`Apply failed: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  // Train #3 §4 — "Apply all safe fixes", now via the ONE-elevation batch orchestrator
  // (apply_recommendations_batch): one consent sheet (in Fix), ONE UAC prompt for every elevated
  // item, per-item ledger receipts + failure isolation in the backend (same audited apply path per
  // item — rollback granularity unchanged, each individually undoable). A batch-level refusal
  // (validation) applies nothing and is surfaced honestly on every item.
  const applyBatch = async (
    recIds: string[],
  ): Promise<{ applied: number; skipped: { title: string; reason: string }[] }> => {
    setError(null);
    const items = recIds
      .map((id) => (recs ?? []).find((r) => r.id === id))
      .filter((r): r is Recommendation => !!r)
      .map((r) => ({ recId: r.id, recTitle: r.title }));
    if (items.length === 0) return { applied: 0, skipped: [] };
    try {
      const report = await invoke<BatchApplyReport>("apply_recommendations_batch", { items });
      return {
        applied: report.applied,
        skipped: report.items
          .filter((i) => i.status === "skipped")
          .map((i) => ({ title: i.rec_title, reason: i.reason ?? "" })),
      };
    } catch (e) {
      return { applied: 0, skipped: items.map((i) => ({ title: i.recTitle, reason: String(e) })) };
    } finally {
      await refresh();
    }
  };

  const rollback = async (change: AppliedChange) => {
    const dest = change.restores_label ? ` It'll return to ${change.restores_label}.` : "";
    const ok = await confirm({
      title: `Roll back "${change.rec_title}"?`,
      body: `Compy restores the setting to how it was before.${dest}`,
      confirmLabel: "Roll back",
    });
    if (!ok) return;
    setBusyId(change.id);
    setError(null);
    try {
      await invoke("rollback_change", { changeId: change.id });
      await refresh();
    } catch (e) {
      setError(`Rollback failed: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  // Find the most recent still-active applied change for a given rec_id.
  // Returns undefined if the rec is currently applied but Compy didn't
  // record it (e.g. it was set outside Compy) -- in which case toggling
  // OFF inside Compy isn't possible without a rollback contract.
  const findActiveChangeForRec = (recId: string): AppliedChange | undefined => {
    return changes
      .slice()
      .reverse()
      .find(
        (c) =>
          c.rec_id === recId && c.status === "applied" && c.is_still_active,
      );
  };

  const toggleRec = async (rec: Recommendation) => {
    if (rec.currently_applied) {
      const active = findActiveChangeForRec(rec.id);
      if (!active) {
        // Toggle UI says ON but Compy has no rollback record for this
        // setting — it was applied outside Compy before we started watching.
        setError(
          `"${rec.title}" is currently on but Compy didn't apply it, so there's no rollback record. Toggle it off in the original Windows location instead.`,
        );
        return;
      }
      await rollback(active);
    } else {
      await apply(rec);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Ordered list of sections that have content. The six rec categories +
  // Startup are consolidated into one "Optimize" section (filtered inside),
  // so the rail stays short and never needs a horizontal scroll.
  const visibleTabs: Tab[] = useMemo(() => {
    const list: Tab[] = ["Overview"];
    // Check (compy_check_v2) consolidates Readiness + Priorities into one section; classics show when off.
    if (checkV2) {
      if (readiness || priorities) list.push("Check");
    } else {
      if (readiness) list.push("Readiness");
      if (priorities) list.push("Priorities");
    }
    if ((recs?.length ?? 0) > 0 || startup.length > 0) list.push("Optimize");
    // Learn is a rail room now (one-rail §1b) and is ALWAYS available — the knowledge library is
    // static/offline. Must be in visibleTabs or the reset effect would bounce it back to Overview.
    list.push("Learn");
    // Play (compy_play_v2) consolidates Monitoring + Sessions IN PLACE; Lab (compy_lab_v2) consolidates
    // Benchmark + Latency IN PLACE. When a flag is on the absorbed classics cease to be destinations
    // (halfway-home §1 — navigation never teleports; the old hidden-but-navigable hack is retired).
    if (playV2) {
      if (hw || sessions.length > 0) list.push("Play");
    } else {
      if (hw) list.push("Monitoring");
      if (sessions.length > 0) list.push("Sessions");
    }
    if (labV2) {
      if (hw) list.push("Lab");
    } else {
      if (hw) list.push("Latency");
      if (hw) list.push("Benchmark");
    }
    if (diagnostics.length > 0) list.push("Diagnostics");
    if (changes.length > 0) list.push("History");
    if (gamingEnabled) list.push("Gaming");
    return list;
  }, [recs, startup.length, hw, diagnostics.length, changes.length, readiness, sessions.length, priorities, gamingEnabled, checkV2, playV2, labV2]);

  // If the active section disappears, fall back to Dashboard (Overview).
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("Overview");
    }
  }, [visibleTabs, activeTab]);

  // Truthful label for the rules source — what's actually driving the
  // catalog the user sees. Per ARCHITECTURE_LOCKS §1.3 cold-start contract,
  // "Embedded" is the always-available baseline; "Cached" / "Remote" only
  // appear once signed remote rules are live.
  const rulesSourceLabel =
    rulesSource === "remote"
      ? "Rules: Remote (signed)"
      : rulesSource === "cached"
      ? "Rules: Cached (last-known-good)"
      : "Rules: Built-in";

  // Six-home rail (one-rail §1b) — the shell rail + the CommandCenter rail both render from HOME_RAIL.
  // navHome maps a home id to its tab (flag-aware: a classic falls back when its v2 flag is off);
  // HOME_FOR_TAB maps the active tab back to its home so the right rail item highlights.
  const navHome = (id: HomeRailId) => {
    setActiveTab(
      id === "home"
        ? "Overview"
        : id === "check"
          ? checkV2
            ? "Check"
            : "Readiness"
          : id === "play"
            ? playV2
              ? "Play"
              : "Monitoring"
            : id === "fix"
              ? "Optimize"
              : id === "learn"
                ? "Learn"
                : labV2
                  ? "Lab"
                  : "Benchmark",
    );
  };
  const HOME_FOR_TAB: Partial<Record<Tab, HomeRailId>> = {
    Overview: "home",
    Check: "check",
    Readiness: "check",
    Priorities: "check",
    Play: "play",
    Monitoring: "play",
    Sessions: "play",
    Optimize: "fix",
    History: "fix",
    Learn: "learn",
    Lab: "lab",
    Latency: "lab",
    Benchmark: "lab",
    Diagnostics: "lab",
  };
  const activeHomeId = HOME_FOR_TAB[activeTab];
  // Persistent room name for the narrow (icon-only-rail) layout — the wayfinding-law amendment so you
  // always know where you are even when the rail shows only icons (elastic-window §1).
  const activeRoomName =
    HOME_RAIL.find((r) => r.id === activeHomeId)?.label ?? (activeTab === "Gaming" ? "Gaming" : "Compy");
  // Detected GPU vendor — picks the right panel variant in schematic walkthroughs (show-me §2/§3).
  const detectedVendor = gpuVendor(hw?.gpus?.[0]?.name);

  // ── Back/Forward navigation (wayfinding §1 + its recorded forward follow-up) — two app-level
  // location stacks, browser model. A "location" is the active room/tab (or Settings). In-place
  // expansions are NOT location changes, so they never push (they don't touch activeTab/
  // showSettings). The effect watches the derived location: a normal move pushes the previous
  // location onto Back and CLEARS Forward (a fresh navigation kills the re-walk branch); a
  // back-move banks the departed location onto Forward; a forward-move banks it onto Back.
  // Frontend-only, zero IPC; both stacks capped at 50.
  const currentLocation = showSettings ? "settings" : `tab:${activeTab}`;
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [fwdHistory, setFwdHistory] = useState<string[]>([]);
  const prevLocationRef = useRef(currentLocation);
  const navKindRef = useRef<"normal" | "back" | "forward">("normal");
  useEffect(() => {
    if (currentLocation === prevLocationRef.current) return;
    const prev = prevLocationRef.current;
    const kind = navKindRef.current;
    navKindRef.current = "normal";
    if (kind === "back") {
      setFwdHistory((f) => [...f, prev].slice(-50));
    } else if (kind === "forward") {
      setNavHistory((h) => [...h, prev].slice(-50));
    } else {
      setNavHistory((h) => [...h, prev].slice(-50));
      setFwdHistory([]);
    }
    prevLocationRef.current = currentLocation;
  }, [currentLocation]);
  const navigateTo = useCallback((target: string) => {
    if (target === "settings") {
      setShowSettings(true);
    } else {
      setShowSettings(false);
      setActiveTab(target.slice(4) as Tab);
    }
  }, []);
  // Pop-inside-the-updater keeps pop+navigate atomic; double-invoke-safe under StrictMode (same
  // base state → same target + same slice both times) — the idiom the original goBack shipped with.
  const goBack = useCallback(() => {
    setNavHistory((h) => {
      if (h.length === 0) return h;
      navKindRef.current = "back";
      navigateTo(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, [navigateTo]);
  const goForward = useCallback(() => {
    setFwdHistory((f) => {
      if (f.length === 0) return f;
      navKindRef.current = "forward";
      navigateTo(f[f.length - 1]);
      return f.slice(0, -1);
    });
  }, [navigateTo]);
  const canGoBack = navHistory.length > 0;
  const canGoForward = fwdHistory.length > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+Left / Alt+Right = back / forward (Windows convention). NO Backspace binding (it
      // conflicts with text inputs).
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    };
    // Mouse XButton1/XButton2 (the side back/forward buttons) — buttons 3/4 if the webview
    // surfaces them.
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
      if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [goBack, goForward]);

  // ── Command Center (new home) wiring ──────────────────────────────────────
  // Resolve the #1 limiter + its linked recommendation so the trust-switch routes through the SAME
  // audited apply/rollback flow (toggleRec) the rest of the app uses — no parallel mutation path.
  const ccTopLimiter = priorities?.limiters[0] ?? null;
  const ccLimiterRec = ccTopLimiter
    ? (recs ?? []).find((r) => r.id === (ccTopLimiter.linked ?? ccTopLimiter.id))
    : undefined;
  const ccLimiterAppliable = ccLimiterRec ? APPLIABLE_REC_IDS.has(ccLimiterRec.id) : false;
  const ccLimiterActiveChange = ccLimiterRec
    ? findActiveChangeForRec(ccLimiterRec.id) ?? null
    : null;
  // Settings is a full-surface route (replaces the home/shell while open) so the surfaces under it
  // unmount and re-read their persisted prefs on return — no cross-surface live-sync needed.
  // NOT gated on settingsV2: Settings v2 is the ONLY Settings surface (no classic fallback), and the
  // settings flag was itself toggleable inside Settings → disabling it was a permanent self-lockout
  // (dead gear, no way back in). The gear must always open Settings regardless of the stored flag.
  const settingsActive = showSettings && hw !== null;
  // Only swap in the new home once hardware has resolved (avoids a blank first paint); any other
  // tab falls back to the classic shell, which is where the not-yet-reskinned surfaces still live.
  const ccActive = homeV2 && activeTab === "Overview" && hw !== null && !settingsActive;

  return (
    <LibraryContext.Provider value={libraryApi}>
    <KonamiWhisper />
    <main className={ccActive || settingsActive ? "app app-cc" : "app"}>
      {showOnboarding && (
        <Onboarding
          onDone={() => setShowOnboarding(false)}
          arcV2={arcV2}
          rig={
            hw
              ? [
                  { label: "GPU", value: hw.gpus[0]?.name ?? "No GPU detected" },
                  { label: "CPU", value: hw.cpu_arch?.family_label || hw.cpu_brand },
                  { label: "RAM", value: fmtGB(hw.ram_total_bytes) },
                  {
                    label: "OS",
                    value:
                      hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`,
                  },
                ]
              : []
          }
        />
      )}
      {!showOnboarding && showFirstCheck && (
        <FirstCheck onDone={() => setShowFirstCheck(false)} arcV2={arcV2} />
      )}
      {showEncyclopedia &&
        (learnV2 ? (
          <Learn
            focusId={libraryFocusId}
            vendor={detectedVendor}
            onClose={() => {
              setShowEncyclopedia(false);
              setLibraryFocusId(null);
            }}
          />
        ) : (
          <TweakEncyclopedia
            focusId={libraryFocusId}
            onClose={() => {
              setShowEncyclopedia(false);
              setLibraryFocusId(null);
            }}
          />
        ))}
      {report && (
        <ReportModal
          report={report}
          onClose={() => setReport(null)}
          onOpenFolder={() => {
            invoke("open_export_folder").catch((e) => setError(String(e)));
          }}
          onReexport={async (feedback) => {
            setReport(await invoke<ExportResult>("export_report", { feedback }));
          }}
        />
      )}
      {!ccActive && !settingsActive && (
        <header className="header">
        <BackButton onBack={goBack} canGoBack={canGoBack} />
        <ForwardButton onForward={goForward} canGoForward={canGoForward} />
        <div>
          <h1><Wordmark size={24} /></h1>
          <p className="tag">Hardware-aware PC optimization</p>
        </div>
        <div className="header-right">
          {/* Export is the one header action (one-rail §1b). The rules-source chip moved to
              Settings → About; the version lives only in the footer; the duplicate Refresh retired
              (re-run lives in Check + the Home hero). */}
          <button className="btn" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export report"}
          </button>
        </div>
        </header>
      )}

      {error && <div className="error">Error: {error}</div>}

      {gamingRecovery && (
        <div className="gaming-recovery-banner" role="alert">
          <span>
            A Gaming Mode session didn't end cleanly — {statusLabel(gamingRecovery.status)}. Restore
            your settings?
          </span>
          <span className="gaming-recovery-actions">
            <button className="btn-small btn-small-on" onClick={() => recoverGaming(true)}>
              Restore now
            </button>
            <button
              className="btn-small"
              onClick={() => {
                setActiveTab("Gaming");
                setGamingRecovery(null);
              }}
            >
              Review
            </button>
          </span>
        </div>
      )}

      {hw && settingsActive ? (
        <Settings
          appVersion={APP_VERSION}
          rulesSourceLabel={rulesSourceLabel}
          onBack={goBack}
          canGoBack={canGoBack}
          onForward={goForward}
          canGoForward={canGoForward}
          onRerunSetup={() => {
            // Re-homed from the footer: replay the intro, then flow into the first check.
            setShowSettings(false);
            setShowOnboarding(true);
            setShowFirstCheck(true);
          }}
          onRerunCheck={() => {
            setShowSettings(false);
            setShowFirstCheck(true);
          }}
          onClose={() => setShowSettings(false)}
        />
      ) : hw && ccActive ? (
        <CommandCenter
          hw={hw}
          readiness={readiness}
          priorities={priorities}
          sessions={sessions}
          changes={changes}
          limiterRec={ccLimiterRec}
          limiterAppliable={ccLimiterAppliable}
          limiterActiveChange={ccLimiterActiveChange}
          busyLimiter={
            busyId !== null &&
            (busyId === ccLimiterRec?.id || busyId === ccLimiterActiveChange?.id)
          }
          onToggleLimiter={() => ccLimiterRec && toggleRec(ccLimiterRec)}
          onSeeInFix={() => setActiveTab("Optimize")}
          onNavigate={(tab) => {
            // Check consolidates Readiness+Priorities behind compy_check_v2; route to the classic
            // Readiness tab when the flag is off.
            if (tab === "Check") setActiveTab(checkV2 ? "Check" : "Readiness");
            else if (tab === "Play") setActiveTab(playV2 ? "Play" : "Monitoring");
            else if (tab === "Lab") setActiveTab(labV2 ? "Lab" : "Benchmark");
            else setActiveTab(tab);
          }}
          onRunCheck={() => setShowFirstCheck(true)}
          onOpenSettings={() => setShowSettings(true)}
          onBack={goBack}
          canGoBack={canGoBack}
          onForward={goForward}
          canGoForward={canGoForward}
        />
      ) : hw ? (
        <div className="shell">
            {/* ONE rail (one-rail §1b): the six-home set from the shared HOME_RAIL — identical to the
                Command Center rail (parity-guarded). The legacy SECTION_META rail is retired; the
                posture hero is Home-only (CommandHero removed). */}
            <nav className="rail" role="tablist" aria-label="Sections">
              {(living ? HOME_RAIL.filter((r) => r.id !== "lab") : HOME_RAIL).map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={activeHomeId === item.id}
                  className={`rail-item ${activeHomeId === item.id ? "rail-item-on" : ""}`}
                  onClick={() => navHome(item.id)}
                  title={item.label}
                >
                  <NavGlyph name={item.icon} />
                  <span className="rail-label">{item.label}</span>
                </button>
              ))}
              {/* Living Instrument (owner: fewer, plainer tabs): Lab — the power-user room (benchmarks,
                  latency, diagnostics) — leaves the everyday rail and lives under a compact "Advanced"
                  cell. Routing is unchanged (it still navigates to the Lab surface); only the rail's
                  prominence changes, so the everyday set is shorter and the labels stop truncating. */}
              {living && (
                <button
                  role="tab"
                  aria-selected={activeHomeId === "lab"}
                  className={`rail-item rail-advanced ${activeHomeId === "lab" ? "rail-item-on" : ""}`}
                  onClick={() => navHome("lab")}
                  title="Advanced — Lab: benchmarks, latency, diagnostics"
                >
                  <NavGlyph name="lab" />
                  <span className="rail-label">Advanced</span>
                </button>
              )}
              {gamingEnabled && (
                <button
                  role="tab"
                  aria-selected={activeTab === "Gaming"}
                  className={`rail-item ${activeTab === "Gaming" ? "rail-item-on" : ""}`}
                  onClick={() => setActiveTab("Gaming")}
                  title="Gaming"
                >
                  <Icon name="engine" />
                  <span className="rail-label">Gaming</span>
                </button>
              )}
              {/* Settings moved to the always-visible custom titlebar (reachable on every tab + every
                  responsive layout); the rail gear is retired. Its margin-left:auto was also stretching
                  the "Advanced" cell in the top-strip layout. */}
            </nav>

            <div className="content">
              {/* Persistent room name — shown only in the narrow icon-only-rail layout (CSS), so the
                  wayfinding law holds even when the rail is icons-only (elastic-window §1). */}
              <div className="shell-room-name" aria-hidden="true">{activeRoomName}</div>
              {activeTab === "Overview" && <OverviewTab hw={hw} />}
              {activeTab === "Check" && (
                <Check
                  isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                  onOpenLibrary={(focusId) => libraryApi.openLibrary(focusId)}
                  onChanged={refresh}
                  vendor={detectedVendor}
                  sessions={sessions}
                  gpus={hw?.gpus ?? []}
                />
              )}
              {activeTab === "Readiness" && (
                <ReadinessTab readiness={readiness} onChanged={reloadReadiness} />
              )}
              {activeTab === "Priorities" && <PrioritiesTab priorities={priorities} />}
              {activeTab === "Optimize" &&
                (fixV2 ? (
                  <Fix
                    recs={recs ?? []}
                    startup={startup}
                    changes={changes}
                    busyId={busyId}
                    isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                    activeChangeFor={findActiveChangeForRec}
                    onToggleRec={(recId) => {
                      const r = (recs ?? []).find((x) => x.id === recId);
                      if (r) toggleRec(r);
                    }}
                    onToggleStartup={toggleStartup}
                    onRollback={rollback}
                    onApplyBatch={applyBatch}
                    onOpenLibrary={(focusId) => libraryApi.openLibrary(focusId)}
                    onDisablePreview={() => {
                      setFixV2(false);
                      persistFlag(FIX_V2_KEY, false);
                    }}
                    vendor={detectedVendor}
                  />
                ) : (
                  <OptimizeTab
                    recs={recs ?? []}
                    startup={startup}
                    busyId={busyId}
                    onToggleRec={toggleRec}
                    onToggleStartup={toggleStartup}
                    hasActiveChange={(recId) => findActiveChangeForRec(recId) !== undefined}
                    onOpenEncyclopedia={() => setShowEncyclopedia(true)}
                  />
                ))}
              {activeTab === "Play" && (
                <Play
                  active={activeTab === "Play"}
                  sessions={sessions}
                  sessionsSeenAt={sessionsSeenAt}
                  priorities={priorities}
                  recs={recs ?? []}
                  apply={apply}
                  busyId={busyId}
                  onExport={onExport}
                  changes={changes}
                  rollback={rollback}
                  deepMonitoring={<MonitoringTab active={activeTab === "Play"} embedded />}
                  vendor={detectedVendor}
                />
              )}
              {activeTab === "Monitoring" && (
                <MonitoringTab active={activeTab === "Monitoring"} />
              )}
              {activeTab === "Sessions" && (
                <SessionsTab
                  sessions={sessions}
                  priorities={priorities}
                  recs={recs ?? []}
                  apply={apply}
                  busyId={busyId}
                  onExport={onExport}
                  changes={changes}
                  rollback={rollback}
                  arcV2={arcV2}
                />
              )}
              {activeTab === "Learn" && (
                <Learn
                  asPanel
                  focusId={libraryFocusId}
                  vendor={detectedVendor}
                  onClose={() => setActiveTab("Overview")}
                />
              )}
              {activeTab === "Lab" && (
                <Lab
                  diagnostics={<DiagnosticsTab sections={diagnostics} />}
                  vendor={detectedVendor}
                />
              )}
              {activeTab === "Latency" && <LatencyTab />}
              {activeTab === "Benchmark" && <BenchmarkTab />}
              {activeTab === "Diagnostics" && (
                <DiagnosticsTab sections={diagnostics} />
              )}
              {activeTab === "History" && (
                <HistoryTab changes={changes} busyId={busyId} onRollback={rollback} />
              )}
              {activeTab === "Gaming" && <GamingMode />}
            </div>
          </div>
      ) : null}

      {!ccActive && !settingsActive && (
      <footer className="footer">
        {/* Footer carries the version only (halfway-home §0). Preview toggles live in Settings →
            New look; re-run lives in Settings + Check; the approval-reassurance line lives where
            approval happens (Fix header / the apply confirm), not in global chrome. */}
        <span className="footer-version">v{APP_VERSION}</span>
      </footer>
      )}
    </main>
    </LibraryContext.Provider>
  );
}


// ─── Tabs ────────────────────────────────────────────────────────────────

function OverviewTab({ hw }: { hw: HardwareInfo }) {
  // The "Your hardware" grid now lives in the shared HardwareGrid (rendered here AND on the
  // CommandCenter Home) so the two surfaces can never drift apart again.
  return (
    <section className="tab-pane">
      <HardwareGrid hw={hw} />
    </section>
  );
}

// Optimize: the six rec categories + Startup, consolidated into one section
// with an inline segmented filter. Replaces the old per-category tabs so the
// rail stays short. Behavior (apply/rollback/toggle) is unchanged.
// "Lead the horse to water AND hold the bendy straw" — for settings Compy
// detects but deliberately won't mutate (they live in a vendor app / a Windows
// page with no safe, reversible programmatic toggle), we point the user to the
// exact place to change it AND, where possible, open that place for them.
//
// HONESTY: `state` reflects only what Compy genuinely knows.
//  - "needs-action": the rec ONLY appears because Compy detected a sub-par
//    state (e.g. refresh rate below max). Its presence = action available.
//  - "unknown": Compy cannot read this setting's state at all (e.g. a vendor
//    app's telemetry toggle). We say so plainly rather than fake an indicator.
//
// `openUri` is a FIXED, allowlisted ms-settings: deep link (never from data) —
// opened via the already-permitted opener plugin. Vendor apps (AMD/NVIDIA) have
// no reliable deep link, so they get steps only, honestly labelled.

function GuidedCard({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false);
  const guide = GUIDED_STEPS[rec.id];
  // Status chip — honest: detected-needs-action vs not-readable.
  const status = guide?.state ?? "unknown";
  const statusLabel =
    status === "needs-action" ? "Action available" : "State not readable";
  return (
    <div className="rec rec-guided">
      <div className="rec-head">
        <span className={`rec-cat rec-cat-${rec.category.toLowerCase()}`}>{rec.category}</span>
        <span
          className={`guided-status guided-status-${status}`}
          title={
            status === "needs-action"
              ? "Compy detected this is below its recommended state — worth doing."
              : "Compy can't read this setting's current state (it lives in a vendor app / outside what we probe). Check it yourself; skip if it's already set."
          }
        >
          <span className="guided-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <span className="rec-guided-pill" title="Compy guides you to where this lives — it won't change it for you, by design.">
          Guided
        </span>
      </div>
      <h3 className="rec-title">{rec.title}</h3>
      <div className="rec-impact-line">
        <span className="rec-impact-dot rec-impact-dot-guided" aria-hidden="true" />
        <span className="rec-impact-text">{rec.impact}</span>
      </div>
      <p className="rec-desc">{rec.description}</p>
      {guide && (
        <>
          <div className="guided-actions">
            <button
              className={`rec-details-toggle ${open ? "open" : ""}`}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              <span>{open ? "Hide steps" : `How to → ${guide.where}`}</span>
              <Icon name="chevron" />
            </button>
            {guide.openUri && (
              <button
                className="guided-open-btn"
                onClick={() => openGuidedUri(guide.openUri!)}
                title={`Opens ${guide.where} directly`}
              >
                <Icon name="external" />
                {guide.openLabel ?? "Open it"}
              </button>
            )}
          </div>
          {open && (
            <div className="rec-expand">
              <div className="guided-where">Where: <strong>{guide.where}</strong></div>
              <ol className="guided-steps">
                {guide.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {status === "unknown" && (
                <p className="guided-note">
                  Compy can't read this one's current state, so check before you
                  change it — if it's already set the way you want, you're done.
                </p>
              )}
              <p className="guided-note">
                Compy won't change this for you — it lives outside what we can
                safely undo. Doing it yourself keeps you in control.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OptimizeTab({
  recs,
  startup,
  busyId,
  onToggleRec,
  onToggleStartup,
  hasActiveChange,
  onOpenEncyclopedia,
}: {
  recs: Recommendation[];
  startup: StartupEntry[];
  busyId: string | null;
  onToggleRec: (rec: Recommendation) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  hasActiveChange: (recId: string) => boolean;
  onOpenEncyclopedia: () => void;
}) {
  type Filter = "All" | RecCategory | "Guided" | "Startup";
  const [filter, setFilter] = useState<Filter>("All");
  const [showSatisfied, setShowSatisfied] = useState(false);

  // Split appliable (Compy-owned toggles) from advisory/guided (Compy
  // detects but directs you elsewhere to change). The "All" view shows
  // appliable recs; guided ones live in their own segment so the toggle list
  // stays clean and the guidance is intentional, not a dead switch.
  const appliableRecs = recs.filter((r) => APPLIABLE_REC_IDS.has(r.id));
  const guidedRecs = recs.filter((r) => !APPLIABLE_REC_IDS.has(r.id));

  const catCounts: Record<string, number> = {};
  appliableRecs.forEach((r) => (catCounts[r.category] = (catCounts[r.category] ?? 0) + 1));
  const activeCats = REC_CATEGORIES.filter((c) => (catCounts[c] ?? 0) > 0);

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "All", label: "All", count: appliableRecs.length },
    ...activeCats.map((c) => ({ id: c as Filter, label: c as string, count: catCounts[c] ?? 0 })),
    ...(guidedRecs.length
      ? [{ id: "Guided" as Filter, label: "Guided", count: guidedRecs.length }]
      : []),
    ...(startup.length
      ? [{ id: "Startup" as Filter, label: "Startup", count: startup.length }]
      : []),
  ];

  const shownRecs =
    filter === "All"
      ? appliableRecs
      : filter === "Startup" || filter === "Guided"
      ? []
      : appliableRecs.filter((r) => r.category === filter);
  // Lead with what's still worth doing; fold the already-applied into a collapsed group so the
  // list reads as "a few things to do", not a 29-switch buffet.
  const outstandingRecs = shownRecs.filter((r) => !r.currently_applied);
  const satisfiedRecs = shownRecs.filter((r) => r.currently_applied);

  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          Optimize
          <span className="count-badge">{appliableRecs.length}</span>
        </h2>
        <div className="read-only-pill">Nothing changes without your approval</div>
      </div>

      <button className="tweak-launch" onClick={onOpenEncyclopedia}>
        Look it up — tweaks, jargon &amp; scams →
      </button>

      <div className="segmented" role="tablist" aria-label="Filter optimizations">
        {filters.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`seg ${filter === f.id ? "seg-on" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="seg-count">{f.count}</span>
          </button>
        ))}
      </div>

      {filter === "Guided" ? (
        <>
          <p className="section-help">
            Settings Compy detected but <strong>won't change for you</strong> —
            they live in a vendor app or a Windows page with no safe, reversible
            switch Compy can own. Instead of a dead toggle, here's exactly where
            to find each one so you stay in control.
          </p>
          <div className="rec-list">
            {guidedRecs.map((r) => (
              <GuidedCard key={r.id} rec={r} />
            ))}
          </div>
        </>
      ) : filter === "Startup" ? (
        <>
          <p className="section-help">
            User-scope auto-start entries. Toggle off to keep them from launching
            with Windows. Re-enable any time — nothing is deleted.
          </p>
          <div className="startup-list">
            {startup.map((entry) => (
              <StartupRow
                key={entry.name}
                entry={entry}
                busy={busyId === `startup:${entry.name}`}
                onToggle={() => onToggleStartup(entry)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="rec-list">
            {outstandingRecs.map((r) => (
              <RecCard
                key={r.id}
                rec={r}
                appliable={APPLIABLE_REC_IDS.has(r.id)}
                busy={busyId === r.id}
                canToggleOff={hasActiveChange(r.id)}
                onToggle={() => onToggleRec(r)}
              />
            ))}
            {shownRecs.length === 0 && (
              <div className="empty">No recommendations in this group right now.</div>
            )}
            {shownRecs.length > 0 && outstandingRecs.length === 0 && (
              <div className="empty">All set here — everything in this group is already applied.</div>
            )}
          </div>
          {satisfiedRecs.length > 0 && (
            <div className="rec-satisfied">
              <button
                className="rec-satisfied-head"
                onClick={() => setShowSatisfied((s) => !s)}
              >
                {showSatisfied ? "▾" : "▸"} Already applied ({satisfiedRecs.length})
              </button>
              {showSatisfied && (
                <div className="rec-list">
                  {satisfiedRecs.map((r) => (
                    <RecCard
                      key={r.id}
                      rec={r}
                      appliable={APPLIABLE_REC_IDS.has(r.id)}
                      busy={busyId === r.id}
                      canToggleOff={hasActiveChange(r.id)}
                      onToggle={() => onToggleRec(r)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Monitoring poll cadence and rolling-window size. 1 Hz is plenty granular
// for "is my GPU thermal-throttling" / "is my game CPU-bound" trends; faster
// rates burn battery and HMR-spam the renderer without insight. The 60-sample
// window means each chart shows the last minute — long enough to spot a
// thermal trend, short enough to react to a moment-ago spike.
const MONITORING_POLL_MS = 1000;
const MONITORING_WINDOW = 60;

type CpuTemp = { temp_c: number; source: string; label: string };

function MonitoringTab({ active, embedded = false }: { active: boolean; embedded?: boolean }) {
  const [gpuSamples, setGpuSamples] = useState<GpuSensorSnapshot[][]>([]);
  const [cpuSamples, setCpuSamples] = useState<CpuSensorSnapshot[]>([]);
  const [hasGpu, setHasGpu] = useState<boolean | null>(null);
  const [fps, setFps] = useState<FpsStatus | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);
  const [cpuTemp, setCpuTemp] = useState<CpuTemp | null>(null);
  const [mem, setMem] = useState<MemoryPressure | null>(null);
  const [overlayCorner, setOverlayCorner] = useState<string>(
    () => localStorage.getItem("compy_overlay_corner") ?? "top-left",
  );

  // Sync the overlay toggle with the actual window state on mount (e.g. the
  // overlay may already be open from earlier in this app session).
  useEffect(() => {
    invoke<boolean>("overlay_visible").then(setOverlayOn).catch(() => {});
  }, []);

  const toggleOverlay = async () => {
    try {
      if (overlayOn) {
        await invoke("hide_overlay");
        setOverlayOn(false);
      } else {
        await invoke("show_overlay");
        setOverlayOn(true);
        // Re-apply the saved corner once the window is shown.
        invoke("set_overlay_corner", { corner: overlayCorner }).catch(() => {});
      }
    } catch {
      /* ignore — leave toggle as-is */
    }
  };

  const chooseCorner = async (corner: string) => {
    setOverlayCorner(corner);
    localStorage.setItem("compy_overlay_corner", corner);
    try {
      await invoke("set_overlay_corner", { corner });
    } catch {
      /* overlay may be hidden — the choice applies next time it's shown */
    }
  };

  // Poll only while the tab is active. When the user switches away we drop
  // the interval so we don't burn cycles on charts that aren't visible. The
  // sample buffer is preserved in state so coming back doesn't lose history.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [gpuSnap, cpuSnap, fpsStatus, temp, memp] = await Promise.all([
          invoke<GpuSensorSnapshot[]>("get_gpu_sensors"),
          invoke<CpuSensorSnapshot>("get_cpu_sensors"),
          invoke<FpsStatus>("get_fps_status"),
          invoke<CpuTemp | null>("get_cpu_temp").catch(() => null),
          invoke<MemoryPressure>("get_memory_pressure").catch(() => null),
        ]);
        if (cancelled) return;
        setHasGpu(gpuSnap.length > 0);
        setFps(fpsStatus);
        setCpuTemp(temp);
        if (memp) setMem(memp);
        setGpuSamples((prev) => {
          const next = [...prev, gpuSnap];
          return next.length > MONITORING_WINDOW
            ? next.slice(-MONITORING_WINDOW)
            : next;
        });
        setCpuSamples((prev) => {
          const next = [...prev, cpuSnap];
          return next.length > MONITORING_WINDOW
            ? next.slice(-MONITORING_WINDOW)
            : next;
        });
      } catch {
        if (!cancelled) setHasGpu(false);
      }
    };
    tick();
    const id = window.setInterval(tick, MONITORING_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  const enableFps = async () => {
    setFpsBusy(true);
    try {
      await invoke("start_fps_capture");
    } catch {
      /* surfaced via get_fps_status polling */
    } finally {
      setFpsBusy(false);
    }
  };
  const stopFps = async () => {
    setFpsBusy(true);
    try {
      await invoke("stop_fps_capture");
      setFps((prev) => (prev ? { ...prev, active: false, sample: null } : prev));
    } finally {
      setFpsBusy(false);
    }
  };

  const latestGpu = gpuSamples[gpuSamples.length - 1] ?? [];
  const latestCpu = cpuSamples[cpuSamples.length - 1] ?? null;
  const haveAnything = latestCpu !== null || latestGpu.length > 0;

  return (
    <section className="tab-pane">
      {/* Header overlay controls + telemetry blurb hidden when embedded in Play (Play has its own
          live + overlay cards) — embedded shows only the deep panels Play lacks. */}
      {!embedded && (
      <>
      <div className="section-header">
        <h2 className="section-title">Monitoring</h2>
        <div className="section-header-actions">
          <button
            className={`btn-small ${overlayOn ? "btn-small-on" : ""}`}
            onClick={toggleOverlay}
            title="Show a compact always-on-top HUD over borderless/windowed games"
          >
            {overlayOn ? "Hide overlay" : "Show overlay"}
          </button>
          {overlayOn && (
            <div style={{ display: "flex", gap: 4 }} title="Move the overlay to a screen corner">
              {(
                [
                  ["top-left", "↖"],
                  ["top-right", "↗"],
                  ["bottom-left", "↙"],
                  ["bottom-right", "↘"],
                ] as const
              ).map(([corner, glyph]) => (
                <button
                  key={corner}
                  className={`btn-small ${overlayCorner === corner ? "btn-small-on" : ""}`}
                  onClick={() => chooseCorner(corner)}
                  title={corner.replace("-", " ")}
                  aria-label={`Move the overlay to the ${corner.replace("-", " ")} corner`}
                  aria-pressed={overlayCorner === corner}
                >
                  {glyph}
                </button>
              ))}
            </div>
          )}
          <div className="read-only-pill">
            {!haveAnything
              ? "Starting…"
              : `${cpuSamples.length}s history · 1 Hz`}
          </div>
        </div>
      </div>
      <p className="section-help">
        Live system telemetry. CPU usage via Windows PDH (built-in, no
        driver). GPU sensors via vendor libraries (NVML / ADLX). FPS &
        <Term id="frametime">frametime</Term> via <Term id="etw">ETW</Term>. No injection into your
        games, no <Term id="kernel-driver">kernel driver</Term> —
        anti-cheat compatible. The overlay draws over borderless/windowed
        games (not exclusive fullscreen). Charts show the last minute.
        <br />
        <span className="coverage-note">
          GPU sensor coverage: <strong>AMD — verified</strong> · NVIDIA —
          implemented, not yet hardware-verified · Intel — planned.
        </span>
      </p>
      </>
      )}

      {/* RAM-pressure warning — the invisible stutter cause; shows only when tight/critical */}
      {mem && <MemoryPressureBanner mem={mem} />}

      {/* FPS / frametime — headline metric, opt-in (needs admin). Hidden when embedded in Play (its
          live card already owns capture). */}
      {!embedded && (
        <FpsPanel
          fps={fps}
          busy={fpsBusy}
          onEnable={enableFps}
          onStop={stopFps}
        />
      )}

      {/* CPU panel — vendor-agnostic, always shows */}
      {latestCpu && (
        <CpuMonitorPanel
          cpu={latestCpu}
          history={cpuSamples}
          cpuTemp={cpuTemp}
        />
      )}

      {/* GPU panels — one per detected NVIDIA adapter */}
      {hasGpu === false ? (
        <div className="empty">
          GPU sensors unavailable. Compy reads GPU telemetry from NVML,
          which ships with the NVIDIA driver. AMD (ADLX) and Intel (GPA)
          support is on the roadmap — your GPU will get its own panel here
          once that lands.
        </div>
      ) : (
        latestGpu.map((gpu) => (
          <GpuMonitorPanel
            key={`${gpu.vendor}-${gpu.index}`}
            gpu={gpu}
            history={gpuSamples.map(
              (snap) =>
                snap.find(
                  (g) => g.index === gpu.index && g.vendor === gpu.vendor,
                ) ?? null,
            )}
          />
        ))
      )}

      {!haveAnything && (
        <div className="empty">Collecting first sample…</div>
      )}
    </section>
  );
}

function FpsPanel({
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
  const active = fps?.active ?? false;
  const sample = fps?.sample ?? null;
  const declined = fps?.status === "declined";

  // Not running: invite the user to opt in (this is the one feature that
  // needs elevation, so it's explicit, never automatic).
  if (!active) {
    return (
      <div className="monitor-panel fps-panel">
        <div className="monitor-panel-head">
          <div className="monitor-panel-name">FPS &amp; frametime</div>
          <div className="monitor-panel-sub">ETW · DX11/DX12</div>
        </div>
        <p className="fps-intro">
          Measures frame rate and per-frame timing by observing your game from
          the outside — no injection, no kernel driver, anti-cheat safe. It
          needs Administrator once to start the capture session.
        </p>
        {declined && (
          <p className="fps-declined">
            Administrator permission was declined. FPS capture can't start
            without it.
          </p>
        )}
        <button className="btn btn-primary" onClick={onEnable} disabled={busy}>
          {busy ? "Starting…" : "Enable FPS monitoring (admin)"}
        </button>
      </div>
    );
  }

  // Active but no fresh sample yet — waiting for a game to present.
  if (!sample) {
    return (
      <div className="monitor-panel fps-panel">
        <div className="monitor-panel-head">
          <div className="monitor-panel-name">FPS &amp; frametime</div>
          <button className="btn btn-small" onClick={onStop} disabled={busy}>
            Stop
          </button>
        </div>
        <p className="fps-intro">
          Capturing… launch or focus a DX11/DX12 game to see frames. (Accept
          the admin prompt if it's still showing. Vulkan/OpenGL titles aren't
          counted yet.)
        </p>
      </div>
    );
  }

  return (
    <div className="monitor-panel fps-panel">
      <div className="monitor-panel-head">
        <div className="monitor-panel-name">
          FPS &amp; frametime
          <span className="fps-proc">{prettyGameName(sample.process_name) || `pid ${sample.pid}`}</span>
        </div>
        <button className="btn btn-small" onClick={onStop} disabled={busy}>
          Stop
        </button>
      </div>
      <div className="fps-readout">
        <div className="fps-big">
          <div className="fps-big-value">{Math.round(sample.fps)}</div>
          <div className="fps-big-label">FPS</div>
        </div>
        <div className="fps-stats">
          <div className="fps-stat">
            <span className="fps-stat-label">Frametime</span>
            <span className="fps-stat-value">
              {sample.avg_frametime_ms.toFixed(1)} ms
            </span>
          </div>
          <div className="fps-stat">
            <span className="fps-stat-label">1% low</span>
            <span className="fps-stat-value">~{Math.round(sample.low1_fps)} FPS</span>
          </div>
          <div className="fps-stat">
            <span className="fps-stat-label">Frames/s</span>
            <span className="fps-stat-value">{sample.frames_last_sec}</span>
          </div>
        </div>
      </div>
      <FrametimeGraph data={sample.recent_frametimes_ms} />
      <p className="fps-disclaimer">
        Live estimates from DirectX present events (not injected). FPS and
        average frametime track closely; <strong>1% low is a session signal</strong>,
        not a benchmark-grade figure — Compy isn't a CapFrameX/PresentMon
        replacement.
      </p>
    </div>
  );
}

// Per-frame frametime line. Each point is one frame's interval in ms; spikes
// (stutter) show as upward spikes. Lower and flatter is better. Faint
// reference lines mark common frame budgets (16.7 ms = 60 FPS, 8.3 ms = 120).
function FrametimeGraph({ data }: { data: number[] }) {
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
            {r === 16.7 ? "60 FPS" : "120 FPS"}
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
function MemoryPressureBanner({ mem }: { mem: MemoryPressure }) {
  if (mem.level === "ok") return null;
  return (
    <div className={`mem-banner mem-${mem.level}`}>
      <div className="mem-banner-head">
        <strong>
          {mem.level === "critical" ? "RAM almost full" : "RAM getting tight"}
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

function CpuMonitorPanel({
  cpu,
  history,
  cpuTemp,
}: {
  cpu: CpuSensorSnapshot;
  history: CpuSensorSnapshot[];
  cpuTemp: CpuTemp | null;
}) {
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
        <div className="monitor-panel-name">CPU</div>
        <div className="monitor-panel-sub">
          {coreCount} logical core{coreCount === 1 ? "" : "s"}
          {cpu.frequency_mhz > 0 && ` · ${fmtGHz(cpu.frequency_mhz)}`}
        </div>
      </div>
      <div className="monitor-metrics">
        <MetricRow
          label="Overall CPU usage"
          value={warmingUp ? null : Math.round(cpu.usage_overall_pct)}
          unit="%"
          history={history.map((s) => Math.round(s.usage_overall_pct))}
          min={0}
          max={100}
          color="#6aa9ff"
          sublabel={warmingUp ? "Warming up — first delta in 1 s" : undefined}
        />
        {cpu.frequency_mhz > 0 && (
          <MetricRow
            label="Clock speed"
            value={Math.round(cpu.frequency_mhz)}
            unit=" MHz"
            history={history.map((s) => Math.round(s.frequency_mhz))}
            min={0}
            max={7000}
            color="#34d399"
            sublabel="Live current clock — rises under boost, drops when idle/parked"
          />
        )}
        <MetricRow
          label="CPU temperature"
          value={cpuTemp ? Math.round(cpuTemp.temp_c) : null}
          unit="°C"
          history={[cpuTemp ? Math.round(cpuTemp.temp_c) : 0]}
          min={20}
          max={100}
          color="#f5a35c"
          sublabel={
            cpuTemp
              ? `${cpuTemp.label} · via ${cpuTemp.source}`
              : "Run HWiNFO (Shared Memory Support on) or LibreHardwareMonitor to show CPU temp"
          }
        />
        {cpu.ram_total_bytes > 0 && (
          <MetricRow
            label="Memory used"
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
      {/* Per-core mini-grid — surfaces uneven core loading at a glance.
          Useful for spotting single-threaded bottlenecks vs an evenly
          loaded workload. */}
      <div className="cpu-core-grid">
        {cpu.usage_per_core_pct.map((pct, i) => (
          <CoreBar key={i} index={i} percent={warmingUp ? 0 : pct} />
        ))}
      </div>
      <div className="monitor-note">
        No CPU temperature by design: reading it requires a kernel-level driver,
        and Compy won't install one. GPU temperature comes from the vendor's
        user-mode library, so it's safe to show — CPU temperature has no
        equivalent without going to the kernel.
      </div>
    </div>
  );
}

function CoreBar({ index, percent }: { index: number; percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="cpu-core" title={`Core ${index}: ${Math.round(percent)}%`}>
      <div className="cpu-core-bar">
        <div className="cpu-core-fill" style={{ width: `${clamped}%` }} />
      </div>
      <div className="cpu-core-label">{Math.round(percent)}%</div>
    </div>
  );
}

function GpuMonitorPanel({
  gpu,
  history,
}: {
  gpu: GpuSensorSnapshot;
  history: (GpuSensorSnapshot | null)[];
}) {
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
              title="NVIDIA sensor readings come from NVML but haven't been verified on real NVIDIA hardware yet. Treat values as provisional."
            >
              unverified
            </span>
          )}
        </div>
        <div className="monitor-panel-sub">
          {gpu.vram_total_bytes
            ? `${fmtGB(gpu.vram_total_bytes)} VRAM`
            : "Adapter " + gpu.index}
        </div>
      </div>
      <div className="monitor-metrics">
        {gpu.temperature_c !== null && (
          <MetricRow
            label="GPU temperature"
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
            label="Hotspot (junction)"
            value={gpu.hotspot_temperature_c}
            unit="°C"
            history={history.map((s) => s?.hotspot_temperature_c ?? null)}
            min={20}
            max={110}
            color="#fb923c"
            sublabel="Hottest on-die sensor"
          />
        )}
        {gpu.utilization_gpu_pct !== null && (
          <MetricRow
            label="GPU utilization"
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
            label="VRAM used"
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
                ? `${fmtGB(gpu.vram_used_bytes)} used`
                : undefined
            }
          />
        )}
        {gpu.power_draw_w !== null && (
          <MetricRow
            label="Power draw"
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
            label="Graphics clock"
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
            label="Memory clock"
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
            label="Fan speed"
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

function MetricRow({
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

function Sparkline({
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

function DiagnosticsTab({ sections }: { sections: DiagnosticSection[] }) {
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">Diagnostics</h2>
      </div>
      <p className="section-help">
        Compy's raw view of your PC. These are the observations the
        recommendation engine reads to decide what to surface. If a rec you
        expect doesn't show up — or one you don't expect does — the answer
        usually lives here.
      </p>
      <div className="diag-sections">
        {sections.map((section) => (
          <div key={section.name} className="diag-section">
            <h3 className="diag-section-title">{section.name}</h3>
            <div className="diag-list">
              {section.entries.map((entry, i) => (
                <div key={i} className="diag-row">
                  <div className="diag-row-label">{entry.label}</div>
                  <div className="diag-row-value">{entry.value}</div>
                  {entry.note && (
                    <div className="diag-row-note">{entry.note}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryTab({
  changes,
  busyId,
  onRollback,
}: {
  changes: AppliedChange[];
  busyId: string | null;
  onRollback: (change: AppliedChange) => void;
}) {
  // Trust Ledger preface: explain to the user what this view is and why
  // they should rely on it. Per the cross-LLM "anti-scam differentiator"
  // framing -- this is where Compy proves it's not a tweak pack.
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          Trust Ledger
          <span className="count-badge">{changes.length}</span>
        </h2>
        <div className="read-only-pill">Audit trail · click any row to expand</div>
      </div>
      <p className="section-help">
        Every change Compy has applied to your machine, with the data needed to
        roll it back independently of the live recommendation catalog. This is
        the receipt — Compy can prove what it changed, when, with which
        version, and whether your machine still reflects the change.
      </p>
      <div className="change-list">
        {changes.length === 0 ? (
          <div className="empty">
            No applied changes yet. Anything Compy applies will appear here
            with a full rollback record.
          </div>
        ) : (
          changes
            .slice()
            .reverse()
            .map((c) => (
              <ChangeRow
                key={c.id}
                change={c}
                busy={busyId === c.id}
                onRollback={() => onRollback(c)}
              />
            ))
        )}
      </div>
    </section>
  );
}

// ─── Reusable bits ───────────────────────────────────────────────────────

const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified: "Verified",
  "measured-signal": "Measured signal",
  "expected-impact": "Expected impact",
};

// Tooltip text shown when the user hovers the provenance pill. Each one
// names the honesty level of the rec's IMPACT claim, not the rec itself.
const PROVENANCE_TITLE: Record<Provenance, string> = {
  verified:
    "Compy directly observes this fact (e.g., reads the current refresh rate, measures free disk space, checks driver date). The claim IS the measurement.",
  "measured-signal":
    "Third-party benchmarks or wide community testing has measured this impact. Compy cites established results rather than inventing them.",
  "expected-impact":
    "Logical from Windows internals; Compy has NOT measured this itself. Honest 'we believe this but haven't verified it under our own benchmark suite.'",
};

function RecCard({
  rec,
  appliable,
  busy,
  canToggleOff,
  onToggle,
}: {
  rec: Recommendation;
  appliable: boolean;
  busy: boolean;
  canToggleOff: boolean;
  onToggle: () => void;
}) {
  // Distinct truths Compy surfaces (per cross-LLM review): the toggle
  // position must not pretend Compy owns Windows state. We show three
  // separate facts and let the user reason about them:
  //   1. Recommended state  — what Compy thinks (always "On" for these recs;
  //      they're all framed as "do this thing", so the recommendation is to
  //      apply)
  //   2. Current state      — what Windows actually is right now (live)
  //   3. Applied by Compy — did Compy make this change, or did the user
  //      already have it that way / change it externally?
  //
  // The toggle reflects the Current state (so flipping it asks Windows to
  // change). When Current matches Recommended but Compy didn't apply it,
  // we surface that distinction explicitly rather than offering a rollback
  // we don't actually have a contract for.
  const currentlyOn = rec.currently_applied;
  const compyOwns = canToggleOff; // we have a still-active applied change
  const isInfo = !appliable; // advisory / informational only

  const toggleDisabled =
    busy || isInfo || (currentlyOn && !compyOwns);

  const toggleTitle = isInfo
    ? "Advisory recommendation — Compy can't auto-apply this; follow the description"
    : busy
    ? "Working…"
    : currentlyOn && !compyOwns
    ? "Already on, but Compy didn't apply it. Toggle off in the original Windows location."
    : currentlyOn
    ? "Click to roll back. Compy will restore the prior state recorded at apply time."
    : "Click to apply. Compy will snapshot the prior state so you can roll back at any time.";

  // "Applied by Compy" status — three-way: Yes / No (advisory) / No (external)
  const compyAppliedLabel = isInfo
    ? "N/A — advisory recommendation"
    : compyOwns
    ? "Yes"
    : currentlyOn
    ? "No (set outside Compy)"
    : "No (not applied)";
  const compyAppliedClass = compyOwns
    ? "state-on"
    : currentlyOn && !compyOwns
    ? "state-warn"
    : "state-muted";

  const [open, setOpen] = useState(false);

  // Power-up pulse: when this rec flips off → on, flash a brief "energize"
  // animation. Tracks the previous applied state across renders.
  const [poweredUp, setPoweredUp] = useState(false);
  const prevOn = useRef(currentlyOn);
  useEffect(() => {
    if (currentlyOn && !prevOn.current) {
      setPoweredUp(true);
      const t = setTimeout(() => setPoweredUp(false), 900);
      prevOn.current = currentlyOn;
      return () => clearTimeout(t);
    }
    prevOn.current = currentlyOn;
  }, [currentlyOn]);

  const stateClass = isInfo
    ? "rec-info"
    : currentlyOn
    ? "rec-on"
    : "rec-off";

  return (
    <div className={`rec rec-${rec.severity} ${stateClass} ${poweredUp ? "rec-powerup" : ""}`}>
      <div className="rec-head">
        <span className={`rec-cat rec-cat-${rec.category.toLowerCase()}`}>
          {rec.category}
        </span>
        <span className={`rec-sev rec-sev-${rec.severity}`}>{rec.severity}</span>
        <span
          className={`rec-provenance rec-provenance-${rec.provenance}`}
          title={PROVENANCE_TITLE[rec.provenance]}
        >
          {PROVENANCE_LABEL[rec.provenance]}
        </span>
        {isInfo ? (
          <span className="rec-advisory-pill">Guided</span>
        ) : (
          (() => {
            // Blocked = ON but Compy didn't apply it, so there's no rollback
            // contract to flip it off safely. Surface a clear hover tooltip
            // explaining why (instead of just a bare "no" cursor).
            const blockedExternal = currentlyOn && !compyOwns;
            return (
              <span
                className={`toggle-wrap ${blockedExternal ? "toggle-wrap-blocked" : ""}`}
                data-tip={
                  blockedExternal
                    ? "Already on, but you (or Windows) enabled this — not Compy. Compy has no rollback record for changes it didn't make, so it won't flip it off and risk being unable to restore. Turn it off in its original Windows location if you want it off."
                    : undefined
                }
              >
                <button
                  className={`toggle rec-toggle ${currentlyOn ? "toggle-on" : ""}`}
                  onClick={onToggle}
                  disabled={toggleDisabled}
                  role="switch"
                  aria-checked={currentlyOn}
                  aria-label={`${currentlyOn ? "Roll back" : "Apply"} ${rec.title}`}
                  title={toggleTitle}
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </button>
                {blockedExternal && (
                  <span className="toggle-tip" role="tooltip">
                    <strong>Locked for your safety</strong>
                    Already on, but <em>you</em> or Windows set it — not Compy. With no rollback record, Compy won't flip it off and risk not being able to put it back. Change it in its own Windows location instead.
                  </span>
                )}
              </span>
            );
          })()
        )}
      </div>
      <h3 className="rec-title">{rec.title}</h3>
      <div className="rec-impact-line">
        <span className="rec-impact-dot" aria-hidden="true" />
        <span className="rec-impact-text">{rec.impact}</span>
      </div>
      <button
        className={`rec-details-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{open ? "Hide details" : "Details"}</span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div className="rec-expand">
          <p className="rec-desc">{rec.description}</p>
          <div className="rec-meta">
            {rec.downside && (
              <div className="rec-row">
                <span className="rec-row-label">Tradeoff</span>
                <span className="rec-row-value downside">{rec.downside}</span>
              </div>
            )}
            <div className="rec-row">
              <span className="rec-row-label">Why this</span>
              <span className="rec-row-value muted">{rec.applies_to}</span>
            </div>
          </div>
          <div className="rec-status">
            <div className="rec-status-row">
              <span className="rec-status-label">Recommended</span>
              <span className="rec-status-value state-on">On</span>
            </div>
            <div className="rec-status-row">
              <span className="rec-status-label">Current</span>
              <span className={`rec-status-value ${currentlyOn ? "state-on" : "state-off"}`}>
                {currentlyOn ? "On" : "Off"}
              </span>
            </div>
            <div className="rec-status-row">
              <span className="rec-status-label">Applied by Compy</span>
              <span className={`rec-status-value ${compyAppliedClass}`}>
                {compyAppliedLabel}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StartupRow({
  entry,
  busy,
  onToggle,
}: {
  entry: StartupEntry;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`startup-row ${!entry.enabled ? "startup-row-off" : ""}`}>
      <div className="startup-main">
        <div className="startup-name">{entry.name}</div>
        <div className="startup-command">{entry.command || "(no command)"}</div>
      </div>
      <button
        className={`toggle ${entry.enabled ? "toggle-on" : ""}`}
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={entry.enabled}
        aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
      >
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
      </button>
    </div>
  );
}

function ChangeRow({
  change,
  busy,
  onRollback,
}: {
  change: AppliedChange;
  busy: boolean;
  onRollback: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const when = new Date(change.applied_at).toLocaleString();
  const stale = change.status === "applied" && !change.is_still_active;
  const stateClass = stale ? "change-stale" : `change-${change.status}`;

  const actionKind = (change.applied_action as { kind?: string } | null | undefined)
    ?.kind;
  const rollbackKind = (change.rollback_action as { kind?: string } | null | undefined)
    ?.kind;
  const snapshot = change.snapshot as
    | { kind?: string; [k: string]: unknown }
    | null
    | undefined;

  return (
    <div
      className={`change ${stateClass} ${expanded ? "change-expanded" : ""}`}
      data-rec-id={change.rec_id}
    >
      <div
        className="change-header cmp-door"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <div className="change-main">
          <div className="change-title">
            <span className="change-chevron" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
            {change.rec_title}
          </div>
          <div className="change-when">
            {when}
            {stale && <span className="change-note"> · reverted outside Compy</span>}
          </div>
        </div>
        <div className="change-action-area" onClick={(e) => e.stopPropagation()}>
          {change.status === "rolled_back" ? (
            <span className="change-status">✓ Rolled back</span>
          ) : stale ? (
            <span className="change-status change-status-stale">No longer active</span>
          ) : (
            <button className="btn btn-rollback" onClick={onRollback} disabled={busy}>
              {busy ? "Rolling back…" : "Roll back"}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="change-details">
          <div className="ledger-grid">
            <div className="ledger-row">
              <span className="ledger-label">Rule id</span>
              <span className="ledger-value mono">{change.rec_id}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Change id</span>
              <span className="ledger-value mono">{change.id}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Applied at</span>
              <span className="ledger-value">{when}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Status</span>
              <span className="ledger-value">
                {change.status === "rolled_back"
                  ? "Rolled back by Compy"
                  : stale
                  ? "Applied, but no longer matches current Windows state"
                  : "Applied — Compy-owned"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Compy app version</span>
              <span className="ledger-value mono">
                {change.app_version_at_apply ?? "(pre-versioning entry)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Ruleset version</span>
              <span className="ledger-value mono">
                {change.ruleset_version_at_apply ?? "(pre-versioning entry)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">UAC elevation</span>
              <span className="ledger-value">
                {change.elevation_used == null
                  ? "Unknown (pre-versioning entry)"
                  : change.elevation_used
                  ? "Yes — required admin"
                  : "No — ran as standard user"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Action performed</span>
              <span className="ledger-value mono">
                {actionKind ?? "(legacy: untyped, dispatched by rec_id)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Rollback action</span>
              <span className="ledger-value mono">
                {rollbackKind ?? "(legacy: synthesized from rec_id at rollback time)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Prior state snapshot</span>
              <span className="ledger-value mono ledger-snapshot">
                {snapshot
                  ? JSON.stringify(snapshot, null, 2)
                  : "(none recorded)"}
              </span>
            </div>
          </div>
          <div className="ledger-footer">
            This row is the rollback contract. Compy can restore the prior
            state from the snapshot above, independently of whether this rule
            still exists in the active recommendation catalog.
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
