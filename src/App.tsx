import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Onboarding, { ONBOARDED_KEY } from "./Onboarding";
import { deriveSystemPosture } from "./surfaces/system-posture";
import { activeChangeCount } from "./surfaces/dashboard-data";
import "./App.css";
import "./Onboarding.css";

type DiskInfo = {
  mount_point: string;
  total_bytes: number;
  available_bytes: number;
  file_system: string;
};

type GpuInfo = {
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

type HardwareInfo = {
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
};

// "Verified"        — Sentinel directly observes the fact this rec claims.
// "Measured signal" — Third-party benchmarks / community consensus measured it.
// "Expected impact" — Logical from Windows internals, not benchmarked.
// Reserved for the synthetic benchmark suite: any rec whose impact reproduces
// under Sentinel's own benchmark graduates to "verified."
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

const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const fmtGHz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : "—");

const fmtDriver = (g: GpuInfo) => {
  const version = g.driver_version || "—";
  if (g.driver_age_days == null) return version;
  const months = Math.floor(g.driver_age_days / 30);
  const age = months < 1 ? "<1 mo" : months === 1 ? "1 mo" : `${months} mo`;
  return `${version} · ${age} old`;
};

// Tabs: Overview is always visible. The category tabs match Recommendation
// .category strings exactly so filtering is a string equality check. Startup
// and History only appear when they have content.
const REC_CATEGORIES = ["Windows", "Power", "GPU", "Display", "Storage", "Network"] as const;
type RecCategory = (typeof REC_CATEGORIES)[number];
// Top-level sections shown in the left command rail. The six rec categories +
// Startup are consolidated into one "Optimize" section (filtered inside) so the
// rail stays short and never needs a horizontal scroll.
type Tab = "Overview" | "Readiness" | "Priorities" | "Optimize" | "Monitoring" | "Sessions" | "Garage" | "Diagnostics" | "History";

const SECTION_META: Record<Tab, { label: string; icon: string }> = {
  Overview: { label: "Dashboard", icon: "grid" },
  Readiness: { label: "Readiness", icon: "shield" },
  Priorities: { label: "Priorities", icon: "target" },
  Optimize: { label: "Optimize", icon: "sliders" },
  Monitoring: { label: "Monitor", icon: "pulse" },
  Sessions: { label: "Sessions", icon: "chart" },
  Garage: { label: "Garage", icon: "engine" },
  Diagnostics: { label: "Diagnostics", icon: "terminal" },
  History: { label: "Ledger", icon: "ledger" },
};

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
type ReadinessStatus = "ready" | "attention" | "unknown";

type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  value: string | null;
};

type GameReadiness = {
  checks: ReadinessCheck[];
  ready_count: number;
  attention_count: number;
  unknown_count: number;
  advisory: string;
};

function ReadinessTab({ readiness }: { readiness: GameReadiness | null }) {
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
  };
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
        </div>
      </div>
      <p className="readiness-advisory">{readiness.advisory}</p>
      <ul className="readiness-list">
        {readiness.checks.map((c) => (
          <li key={c.id} className={`readiness-row readiness-row-${c.status}`}>
            <div className="readiness-row-head">
              <span className={`readiness-badge readiness-${c.status}`}>
                {statusLabel[c.status]}
              </span>
              <span className="readiness-label">{c.label}</span>
              {c.value && <span className="readiness-value">{c.value}</span>}
            </div>
            <p className="readiness-detail">{c.detail}</p>
          </li>
        ))}
      </ul>
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
  sentinel_changes_active: number;
};

function SessionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-metric">
      <span className="session-metric-label">{label}</span>
      <span className="session-metric-value">{value}</span>
    </div>
  );
}

function SessionsTab({ sessions }: { sessions: SessionSummary[] }) {
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
      <p className="readiness-advisory">
        Live estimates sampled about once per second while monitoring was active
        — not benchmark-grade proof.
      </p>
      <ul className="sessions-list">
        {sessions.map((s, i) => (
          <li key={`${s.started_at}-${i}`} className="session-card">
            <div className="session-card-head">
              <span className="session-game">
                {s.process_name || "Unknown game"}
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
                label="Sentinel changes active"
                value={String(s.sentinel_changes_active)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Export Snapshot (F5): read-only local report. Mirrors the Rust ExportResult.
type ExportResult = { path: string; json_path: string; markdown: string };

function ReportModal({
  report,
  onClose,
  onOpenFolder,
}: {
  report: ExportResult;
  onClose: () => void;
  onOpenFolder: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Report exported</h2>
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted modal-path">Saved to {report.path}</p>
        <pre className="report-preview">{report.markdown}</pre>
        <div className="modal-actions">
          <button className="btn" onClick={onOpenFolder}>
            Open folder
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
  const row = (i: PriorityItem) => (
    <li key={i.id} className={`readiness-row readiness-row-${i.status}`}>
      <div className="readiness-row-head">
        <span className={`readiness-badge readiness-${i.status}`}>{cap(i.status)}</span>
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
      <p className="readiness-advisory">
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
        <ul className="readiness-list">{priorities.limiters.map(row)}</ul>
      )}

      <h3 className="priorities-group">Already fine</h3>
      {priorities.already_fine.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="readiness-list">{priorities.already_fine.map(row)}</ul>
      )}

      <h3 className="priorities-group">Not worth touching</h3>
      {priorities.not_worth_touching.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="readiness-list">{priorities.not_worth_touching.map(row)}</ul>
      )}
    </section>
  );
}

// Appearance themes — cosmetic palettes applied via the [data-theme] attribute
// on <html>. "graphite" is the default (no attribute). Each reskin UNLOCKS at a
// Tune tier, so climbing the evolution ladder earns new looks. Local-only
// (localStorage); no network.
type Theme = {
  id: string;
  label: string;
  swatch: [string, string, string];
  unlockTier: number; // Tune tier index required (0 = always available)
};
const THEMES: Theme[] = [
  { id: "graphite", label: "Graphite", swatch: ["#0b0d12", "#6aa9ff", "#46d98a"], unlockTier: 0 },
  { id: "frost", label: "Frost", swatch: ["#060a0d", "#38d6e6", "#46d98a"], unlockTier: 1 },
  { id: "aurora", label: "Aurora Noir", swatch: ["#05080c", "#34e0a8", "#6cf0c4"], unlockTier: 2 },
  { id: "ember", label: "Carbon Ember", swatch: ["#0a0807", "#ff8b3d", "#7cd66b"], unlockTier: 2 },
  { id: "synthwave", label: "Synthwave", swatch: ["#0c0718", "#ff5cc8", "#43e8e0"], unlockTier: 3 },
  { id: "viper", label: "Viper", swatch: ["#060806", "#9be83f", "#bcf56e"], unlockTier: 4 },
];

function applyTheme(id: string) {
  const root = document.documentElement;
  if (id === "graphite") root.removeAttribute("data-theme");
  else root.dataset.theme = id;
  try {
    localStorage.setItem("sentinel-theme", id);
  } catch {
    /* ignore persistence failure — theme still applies for this session */
  }
}

function readSavedTheme(): string {
  try {
    return localStorage.getItem("sentinel-theme") || "graphite";
  } catch {
    return "graphite";
  }
}

// Header theme picker — controlled by App so it stays in sync with the Garage.
// Locked themes (above the current Tune tier) are shown but not selectable.
function ThemePicker({
  current,
  maxTier,
  onChange,
}: {
  current: string;
  maxTier: number;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const unlocked = THEMES.filter((t) => t.unlockTier <= maxTier);

  // Esc closes the popover (keyboard parity with the click-out backdrop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const surprise = () => {
    const others = unlocked.filter((t) => t.id !== current);
    if (others.length === 0) return;
    onChange(others[Math.floor(Math.random() * others.length)].id);
  };
  const currentLabel = THEMES.find((t) => t.id === current)?.label ?? "Graphite";

  return (
    <div className="theme-picker">
      <button
        className="theme-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Change appearance theme"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="theme-trigger-dot" aria-hidden="true" />
        {currentLabel}
      </button>
      {open && (
        <>
          <div className="theme-backdrop" onClick={() => setOpen(false)} />
          <div className="theme-pop" role="menu">
            <div className="theme-pop-head">
              <span>Appearance</span>
              <button className="theme-dice" onClick={surprise} title="Surprise me">
                🎲 Surprise
              </button>
            </div>
            <div className="theme-grid">
              {THEMES.map((t) => {
                const locked = t.unlockTier > maxTier;
                return (
                  <button
                    key={t.id}
                    className={`theme-swatch ${current === t.id ? "theme-swatch-on" : ""} ${locked ? "theme-swatch-locked" : ""}`}
                    onClick={() => !locked && onChange(t.id)}
                    disabled={locked}
                    role="menuitemradio"
                    aria-checked={current === t.id}
                    title={locked ? `Unlocks at ${TUNE_TIERS[t.unlockTier].name}` : t.label}
                  >
                    <span className="theme-swatch-chips">
                      <span style={{ background: t.swatch[0] }} />
                      <span style={{ background: t.swatch[1] }} />
                      <span style={{ background: t.swatch[2] }} />
                    </span>
                    <span className="theme-swatch-label">
                      {locked ? `🔒 ${TUNE_TIERS[t.unlockTier].name}` : t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSection[]>([]);
  const [rulesSource, setRulesSource] = useState<string>("embedded");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [readiness, setReadiness] = useState<GameReadiness | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [report, setReport] = useState<ExportResult | null>(null);
  const [priorities, setPriorities] = useState<Priorities | null>(null);
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState<string>(readSavedTheme);
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem(ONBOARDED_KEY) !== "1",
  );

  // App-wide Tune tier — the "evolution" level. Computed from the same honest
  // facts as the hero (readiness cleared + safe optimizations applied). Stamped
  // on <html> as data-tune so the ENTIRE app escalates per tier (every surface
  // gains presence — the "two more cylinders" feel), and gates theme unlocks.
  const tune = useMemo(() => computeTuneState(readiness, changes), [readiness, changes]);
  useEffect(() => {
    document.documentElement.dataset.tune = tune.tier.key;
  }, [tune.tier.key]);

  // Peak tier ever reached — unlocks (skins) are gated on this, so earned
  // cosmetics stay unlocked even if the user temporarily de-tunes (standard
  // progression). The LIVE tier still drives the honest app-wide escalation.
  const [peakTier, setPeakTier] = useState<number>(() => {
    try { return Number(localStorage.getItem("sentinel-peak-tier")) || 0; } catch { return 0; }
  });
  useEffect(() => {
    if (readiness != null && tune.tierIndex > peakTier) {
      setPeakTier(tune.tierIndex);
      try { localStorage.setItem("sentinel-peak-tier", String(tune.tierIndex)); } catch { /* ignore */ }
    }
  }, [tune.tierIndex, readiness, peakTier]);

  const changeTheme = (id: string) => {
    setTheme(id);
    applyTheme(id);
  };
  // If the saved theme is above the current tier, fall back — but ONLY after a
  // real scan has loaded. Before readiness loads, tier reads 0, which would
  // falsely downgrade a legitimately-unlocked equipped skin on every launch.
  useEffect(() => {
    if (readiness == null) return; // pre-load: don't punish the saved theme
    const t = THEMES.find((x) => x.id === theme);
    if (t && t.unlockTier > peakTier) changeTheme("graphite");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peakTier, readiness]);

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      setReport(await invoke<ExportResult>("export_report"));
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
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
    } finally {
      setLoading(false);
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

  const apply = async (rec: Recommendation) => {
    const downsideLine = rec.downside ? `\n\nTradeoff: ${rec.downside}` : "";
    if (
      !window.confirm(
        `Apply "${rec.title}"?\n\nThis will change a Windows setting to match Sentinel's recommendation.\n\n${rec.description}${downsideLine}\n\nSentinel will snapshot the prior state so you can roll this back at any time.`
      )
    )
      return;
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

  const rollback = async (change: AppliedChange) => {
    if (!window.confirm(`Roll back "${change.rec_title}" to its prior state?`)) return;
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
  // Returns undefined if the rec is currently applied but Sentinel didn't
  // record it (e.g. it was set outside Sentinel) -- in which case toggling
  // OFF inside Sentinel isn't possible without a rollback contract.
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
        // Toggle UI says ON but Sentinel has no rollback record for this
        // setting — it was applied outside Sentinel before we started watching.
        setError(
          `"${rec.title}" is currently on but Sentinel didn't apply it, so there's no rollback record. Toggle it off in the original Windows location instead.`,
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
    if (readiness) list.push("Readiness");
    if (priorities) list.push("Priorities");
    if ((recs?.length ?? 0) > 0 || startup.length > 0) list.push("Optimize");
    if (hw) list.push("Monitoring");
    if (sessions.length > 0) list.push("Sessions");
    // Garage (the customization + evolution tab) unlocks once you leave Stock.
    if (tune.tierIndex >= 1) list.push("Garage");
    if (diagnostics.length > 0) list.push("Diagnostics");
    if (changes.length > 0) list.push("History");
    return list;
  }, [recs, startup.length, hw, diagnostics.length, changes.length, readiness, sessions.length, priorities, tune.tierIndex]);

  // If the active section disappears, fall back to Dashboard (Overview).
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("Overview");
    }
  }, [visibleTabs, activeTab]);

  const tabBadgeCount = (tab: Tab): number | null => {
    if (tab === "Readiness") return readiness?.attention_count ?? null;
    if (tab === "Priorities") return priorities ? priorities.limiters.length : null;
    if (tab === "Optimize") return recs?.length ?? null;
    if (tab === "Sessions") return sessions.length;
    if (tab === "History") return changes.length;
    return null;
  };

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

  return (
    <main className="app">
      {showOnboarding && (
        <Onboarding onDone={() => setShowOnboarding(false)} />
      )}
      {report && (
        <ReportModal
          report={report}
          onClose={() => setReport(null)}
          onOpenFolder={() => {
            invoke("open_export_folder").catch((e) => setError(String(e)));
          }}
        />
      )}
      <header className="header">
        <div>
          <h1>Sentinel</h1>
          <p className="tag">Hardware-aware PC optimization · v0.1.0</p>
        </div>
        <div className="header-right">
          <ThemePicker current={theme} maxTier={peakTier} onChange={changeTheme} />
          <span
            className={`rules-source-pill rules-source-${rulesSource}`}
            title="Where Sentinel's recommendation catalog came from on this launch"
          >
            {rulesSourceLabel}
          </span>
          <button className="btn" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export report"}
          </button>
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Scanning…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="error">Error: {error}</div>}

      {hw && (
        <>
          <CommandHero hw={hw} readiness={readiness} changes={changes} />
          <div className="shell">
            <nav className="rail" role="tablist" aria-label="Sections">
              {visibleTabs.map((tab) => {
                const badge = tabBadgeCount(tab);
                const meta = SECTION_META[tab];
                return (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`rail-item ${activeTab === tab ? "rail-item-on" : ""}`}
                    onClick={() => setActiveTab(tab)}
                    title={meta.label}
                  >
                    <Icon name={meta.icon} />
                    <span className="rail-label">{meta.label}</span>
                    {badge !== null && badge > 0 && (
                      <span className="rail-badge">{badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="content">
              {activeTab === "Overview" && <OverviewTab hw={hw} />}
              {activeTab === "Readiness" && <ReadinessTab readiness={readiness} />}
              {activeTab === "Priorities" && <PrioritiesTab priorities={priorities} />}
              {activeTab === "Optimize" && (
                <OptimizeTab
                  recs={recs ?? []}
                  startup={startup}
                  busyId={busyId}
                  onToggleRec={toggleRec}
                  onToggleStartup={toggleStartup}
                  hasActiveChange={(recId) => findActiveChangeForRec(recId) !== undefined}
                />
              )}
              {activeTab === "Monitoring" && (
                <MonitoringTab active={activeTab === "Monitoring"} />
              )}
              {activeTab === "Sessions" && <SessionsTab sessions={sessions} />}
              {activeTab === "Garage" && (
                <GarageTab tune={tune} peakTier={peakTier} theme={theme} onChooseTheme={changeTheme} />
              )}
              {activeTab === "Diagnostics" && (
                <DiagnosticsTab sections={diagnostics} />
              )}
              {activeTab === "History" && (
                <HistoryTab changes={changes} busyId={busyId} onRollback={rollback} />
              )}
            </div>
          </div>
        </>
      )}

      <footer className="footer">
        <span>Sentinel never changes anything without your explicit approval.</span>
        <button className="footer-link" onClick={() => setShowOnboarding(true)}>
          Replay intro
        </button>
      </footer>
    </main>
  );
}

// ─── Command hero ─────────────────────────────────────────────────────────
// The at-a-glance verdict the user sees the instant Sentinel opens: a glowing
// readiness gauge + a confident status headline + live system vitals. Read-only
// — derives entirely from the already-loaded hardware + readiness data; changes
// nothing. This is the "are I dialed in / do I need to look elsewhere" answer.

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="vital">
      <div className="vital-label">{label}</div>
      <div className="vital-value" title={value}>{value}</div>
    </div>
  );
}

// ─── Tune Level — the honest "evolution" system ────────────────────────────
// As the user tunes their PC, the app visibly levels up (Stock → Apex). The
// level is NOT a fake score: it's derived ONLY from real, transparent facts —
// readiness checks cleared + safe optimizations Sentinel actually applied — and
// the exact breakdown is shown. A measured personal-best session FPS rides
// along as a labeled flourish (never as a guarantee). Earning a tier feels
// good *because* it reflects real configuration progress, not a vanity meter.

type TuneTier = {
  key: string;
  name: string;
  min: number; // inclusive lower bound (0–100)
  blurb: string;
};

// Five tiers. The thresholds are deliberate, transparent breakpoints.
const TUNE_TIERS: TuneTier[] = [
  { key: "stock", name: "Stock", min: 0, blurb: "Factory state — let's tune it." },
  { key: "tuned", name: "Tuned", min: 25, blurb: "First gains locked in." },
  { key: "calibrated", name: "Calibrated", min: 50, blurb: "Coming together nicely." },
  { key: "dialed", name: "Dialed In", min: 75, blurb: "Seriously sharp setup." },
  { key: "apex", name: "Apex", min: 100, blurb: "Maxed. Nothing left on the table." },
];

type TuneState = {
  score: number; // 0–100, transparent
  tier: TuneTier;
  tierIndex: number;
  next: TuneTier | null;
  toNext: number; // points to next tier (0 if at apex)
  readyPart: number; // points from readiness
  appliedPart: number; // points from applied optimizations
  readyClear: number;
  readyTotal: number;
  appliedCount: number;
  appliedTotal: number;
};

// Score = 60% readiness-cleared + 40% safe-optimizations-applied. Both are
// facts Sentinel directly observes. Apex (100) requires every readiness check
// clear AND every appliable optimization Sentinel owns being active.
function computeTuneState(
  readiness: GameReadiness | null,
  changes: AppliedChange[],
): TuneState {
  const readyTotal = readiness
    ? readiness.ready_count + readiness.attention_count + readiness.unknown_count
    : 0;
  const readyClear = readiness?.ready_count ?? 0;
  const readyFrac = readyTotal > 0 ? readyClear / readyTotal : 0;

  const appliedTotal = APPLIABLE_REC_IDS.size;
  const appliedActive = new Set(
    changes
      .filter((c) => c.status === "applied" && c.is_still_active && APPLIABLE_REC_IDS.has(c.rec_id))
      .map((c) => c.rec_id),
  );
  const appliedCount = appliedActive.size;
  const appliedFrac = appliedTotal > 0 ? appliedCount / appliedTotal : 0;

  const readyPart = Math.round(readyFrac * 60);
  const appliedPart = Math.round(appliedFrac * 40);
  const score = Math.max(0, Math.min(100, readyPart + appliedPart));

  let tierIndex = 0;
  for (let i = TUNE_TIERS.length - 1; i >= 0; i--) {
    if (score >= TUNE_TIERS[i].min) {
      tierIndex = i;
      break;
    }
  }
  const tier = TUNE_TIERS[tierIndex];
  const next = tierIndex < TUNE_TIERS.length - 1 ? TUNE_TIERS[tierIndex + 1] : null;
  const toNext = next ? next.min - score : 0;

  return {
    score, tier, tierIndex, next, toNext,
    readyPart, appliedPart, readyClear, readyTotal, appliedCount, appliedTotal,
  };
}

function CommandHero({
  hw,
  readiness,
  changes,
}: {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  changes: AppliedChange[];
}) {
  // Honest, transparent posture — derived from real readiness facts + active
  // changes. No opaque "tune score", no tier ladder, no level-up flourish.
  const posture = deriveSystemPosture({
    readiness,
    activeChanges: activeChangeCount(changes),
    monitoringAvailable: true,
  });
  const state =
    posture.state === "attention" ? "attention"
    : posture.state === "dialed-in" ? "ready"
    : "scanning";

  // Ring shows the fraction of readiness checks cleared — a real, explainable
  // count, NOT a synthesized score.
  const total = readiness ? readiness.checks.length : 0;
  const clear = readiness?.ready_count ?? 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = C * (total > 0 ? clear / total : 0);

  const cpu = hw.cpu_arch?.family_label || hw.cpu_brand || "—";
  const gpu = hw.gpus[0]?.name ?? "—";
  const ram = hw.ram_total_bytes > 0 ? fmtGB(hw.ram_total_bytes) : "—";
  const disp =
    hw.display && hw.display.width > 0
      ? `${hw.display.current_refresh_rate_hz} Hz`
      : "—";

  return (
    <section className={`hero hero-${state}`}>
      <div className="hero-core">
        <div
          className="hero-ring-wrap"
          title={readiness ? `${clear}/${total} readiness checks clear` : "Scanning…"}
        >
          <svg className="hero-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle className="hero-ring-track" cx="60" cy="60" r={R} />
            <circle
              className="hero-ring-fill"
              cx="60" cy="60" r={R}
              strokeDasharray={`${dash} ${C}`}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className="hero-ring-center">
            <div className="hero-ring-num">{readiness ? `${clear}/${total}` : "—"}</div>
            <div className="hero-ring-den">{readiness ? "ready" : "scan"}</div>
          </div>
        </div>
        <div className="hero-verdict">
          <div className="hero-eyebrow">System status</div>
          <div className="hero-headline">{posture.headline}</div>
          <div className="hero-subline">{posture.sub}</div>
        </div>
      </div>
      <div className="hero-vitals">
        <Vital label="CPU" value={cpu} />
        <Vital label="GPU" value={gpu} />
        <Vital label="Memory" value={ram} />
        <Vital label="Display" value={disp} />
      </div>
    </section>
  );
}

// ─── Garage — the evolution + customization tab ────────────────────────────
// Unlocks at Tuned. Shows the "engine" visibly gaining cylinders per tier, the
// tier ladder (what you've earned / what's next), and reskins that unlock as
// you climb. Pure cosmetic/read-only; the tier is the honest Tune score.

function GarageTab({
  tune,
  peakTier,
  theme,
  onChooseTheme,
}: {
  tune: TuneState;
  peakTier: number;
  theme: string;
  onChooseTheme: (id: string) => void;
}) {
  // Cylinders earned grow with tier: Stock 4 → Tuned 6 → Calibrated 8 →
  // Dialed In 10 → Apex 12 (the "two more cylinders per evolution" feel).
  const cylinders = 4 + tune.tierIndex * 2;
  const maxCyl = 4 + (TUNE_TIERS.length - 1) * 2;

  return (
    <section className="tab-pane garage">
      <div className="section-header">
        <h2 className="section-title">
          Garage
          <span className="count-badge">{tune.tier.name}</span>
        </h2>
        <div className="read-only-pill">Cosmetic — earned by real tuning</div>
      </div>
      <p className="section-help">
        Your build evolves as you tune. Each tier you earn — by clearing readiness
        checks and applying safe optimizations — drops a bigger engine in and
        unlocks new looks. It's cosmetic; the level reflects your real config.
      </p>

      {/* Engine bay — cylinders light up per tier. */}
      <div className={`engine-bay engine-${tune.tier.key}`}>
        <div className="engine-head">
          <span className="engine-spec">{cylinders}-cyl</span>
          <span className="engine-tier">{tune.tier.name}</span>
        </div>
        <div className="engine-block">
          {Array.from({ length: maxCyl }).map((_, i) => (
            <span
              key={i}
              className={`cyl ${i < cylinders ? "cyl-on" : "cyl-off"}`}
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>
        <div className="engine-readout">
          <div className="engine-score">{tune.score}<span className="engine-score-max">/100</span></div>
          <div className="engine-blurb">{tune.tier.blurb}</div>
        </div>
      </div>

      {/* Tier ladder — progress through the evolution. */}
      <h3 className="priorities-group">Evolution path</h3>
      <div className="tier-ladder">
        {TUNE_TIERS.map((t, i) => {
          const earned = i <= tune.tierIndex;
          const current = i === tune.tierIndex;
          return (
            <div key={t.key} className={`tier-step ${earned ? "earned" : "locked"} ${current ? "current" : ""}`}>
              <div className="tier-step-cyl">{4 + i * 2}<span>cyl</span></div>
              <div className="tier-step-body">
                <div className="tier-step-name">
                  {t.name}
                  {current && <span className="tier-step-here">You are here</span>}
                  {earned && !current && <span className="tier-step-done">✓</span>}
                </div>
                <div className="tier-step-blurb">{t.blurb}</div>
              </div>
              <div className="tier-step-min">{t.min}+</div>
            </div>
          );
        })}
      </div>

      {/* Reskins — unlock as you climb. */}
      <h3 className="priorities-group">Reskins {`(${THEMES.filter((t) => t.unlockTier <= peakTier).length}/${THEMES.length} unlocked)`}</h3>
      <div className="garage-skins">
        {THEMES.map((t) => {
          const locked = t.unlockTier > peakTier;
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              className={`skin-card ${active ? "skin-active" : ""} ${locked ? "skin-locked" : ""}`}
              onClick={() => !locked && onChooseTheme(t.id)}
              disabled={locked}
            >
              <span className="skin-chips">
                <span style={{ background: t.swatch[0] }} />
                <span style={{ background: t.swatch[1] }} />
                <span style={{ background: t.swatch[2] }} />
              </span>
              <span className="skin-name">{t.label}</span>
              <span className="skin-state">
                {active ? "Equipped" : locked ? `🔒 ${TUNE_TIERS[t.unlockTier].name}` : "Equip"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────

function OverviewTab({ hw }: { hw: HardwareInfo }) {
  return (
    <section className="tab-pane">
      <h2 className="section-title">Your hardware</h2>
      <div className="grid">
        <Card label="CPU" value={hw.cpu_arch?.family_label || hw.cpu_brand}>
          {hw.cpu_arch?.architecture && hw.cpu_arch.architecture !== "Unknown" && (
            <Detail
              k="Architecture"
              v={`${hw.cpu_arch.architecture}${
                hw.cpu_arch.generation && hw.cpu_arch.generation !== hw.cpu_arch.architecture
                  ? ` · ${hw.cpu_arch.generation}`
                  : ""
              }`}
            />
          )}
          <Detail k="Logical cores" v={hw.cpu_cores_logical} />
          <Detail k="Physical cores" v={hw.cpu_cores_physical} />
          <Detail k="Base frequency" v={fmtGHz(hw.cpu_frequency_mhz)} />
        </Card>

        <Card label="Memory" value={fmtGB(hw.ram_total_bytes)}>
          <Detail
            k="In use"
            v={`${fmtGB(hw.ram_used_bytes)} (${Math.round(
              (hw.ram_used_bytes / hw.ram_total_bytes) * 100
            )}%)`}
          />
          <Detail k="Swap" v={fmtGB(hw.swap_total_bytes)} />
          {hw.memory_modules.length > 0 && (
            <>
              <div className="sub-divider">Modules</div>
              {hw.memory_modules.map((m, i) => {
                const cap = m.capacity_bytes > 0 ? fmtGB(m.capacity_bytes) : "—";
                const speed = m.speed_mhz > 0 ? `${m.speed_mhz} MHz` : "";
                const type_ = m.type_name !== "Unknown" ? m.type_name : "";
                const desc = [type_, speed].filter(Boolean).join("-");
                const mfg = m.manufacturer && m.manufacturer !== "Undefined"
                  ? ` (${m.manufacturer})`
                  : "";
                return (
                  <Detail
                    key={i}
                    k={`Slot ${i + 1}`}
                    v={`${cap}${desc ? ` ${desc}` : ""}${mfg}`}
                  />
                );
              })}
            </>
          )}
        </Card>

        <Card
          label="Graphics"
          value={hw.gpus.length === 0 ? "No GPU detected" : hw.gpus[0].name}
        >
          {hw.gpus.length === 0 ? (
            <Detail k="Status" v="DXGI and WMI both returned no adapters" />
          ) : (
            hw.gpus.map((g, i) => (
              <div key={i} className="gpu-block">
                {hw.gpus.length > 1 && <Detail k="Adapter" v={g.name} />}
                <Detail k="VRAM" v={g.vram_bytes > 0 ? fmtGB(g.vram_bytes) : "—"} />
                <Detail k="Driver" v={fmtDriver(g)} />
                {g.current_refresh_rate_hz > 0 && (
                  <Detail k="Output" v={`${g.current_refresh_rate_hz} Hz`} />
                )}
              </div>
            ))
          )}
          {hw.display && hw.display.width > 0 && (
            <Detail
              k="Display"
              v={
                hw.display.max_refresh_rate_hz > hw.display.current_refresh_rate_hz
                  ? `${hw.display.width}×${hw.display.height} @ ${hw.display.current_refresh_rate_hz} Hz (max ${hw.display.max_refresh_rate_hz} Hz)`
                  : `${hw.display.width}×${hw.display.height} @ ${hw.display.current_refresh_rate_hz} Hz`
              }
            />
          )}
        </Card>

        <Card
          label="System"
          value={hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`}
        >
          <Detail
            k="Build"
            v={
              hw.windows_version
                ? `${hw.windows_version.build}.${hw.windows_version.ubr}`
                : hw.kernel_version
            }
          />
          <Detail k="Hostname" v={hw.hostname} />
        </Card>

        <Card
          label="Storage"
          value={`${hw.disks.length} drive${hw.disks.length === 1 ? "" : "s"}`}
        >
          {hw.disks.map((d) => (
            <Detail
              key={d.mount_point}
              k={d.mount_point}
              v={`${fmtGB(d.available_bytes)} free of ${fmtGB(d.total_bytes)} · ${d.file_system}`}
            />
          ))}
          {hw.physical_disks.length > 0 && (
            <>
              <div className="sub-divider">Physical drives</div>
              {hw.physical_disks.map((p, i) => (
                <Detail
                  key={i}
                  k={p.friendly_name || `Disk ${i + 1}`}
                  v={`${p.bus_type} ${p.media_type} · ${fmtGB(p.size_bytes)}`}
                />
              ))}
            </>
          )}
        </Card>
      </div>
    </section>
  );
}

// Optimize: the six rec categories + Startup, consolidated into one section
// with an inline segmented filter. Replaces the old per-category tabs so the
// rail stays short. Behavior (apply/rollback/toggle) is unchanged.
// "Lead the horse to water AND hold the bendy straw" — for settings Sentinel
// detects but deliberately won't mutate (they live in a vendor app / a Windows
// page with no safe, reversible programmatic toggle), we point the user to the
// exact place to change it AND, where possible, open that place for them.
//
// HONESTY: `state` reflects only what Sentinel genuinely knows.
//  - "needs-action": the rec ONLY appears because Sentinel detected a sub-par
//    state (e.g. refresh rate below max). Its presence = action available.
//  - "unknown": Sentinel cannot read this setting's state at all (e.g. a vendor
//    app's telemetry toggle). We say so plainly rather than fake an indicator.
//
// `openUri` is a FIXED, allowlisted ms-settings: deep link (never from data) —
// opened via the already-permitted opener plugin. Vendor apps (AMD/NVIDIA) have
// no reliable deep link, so they get steps only, honestly labelled.
type GuideState = "needs-action" | "unknown";
type Guide = {
  where: string;
  steps: string[];
  state: GuideState;
  openUri?: string; // allowlisted ms-settings: target
  openLabel?: string;
};
const GUIDED_STEPS: Record<string, Guide> = {
  "amd-uxp": {
    where: "AMD Software: Adrenalin Edition",
    state: "unknown",
    steps: [
      "Open AMD Software (right-click desktop → AMD Software, or search the Start menu).",
      "Click the gear / Settings (top-right) → Preferences.",
      'Find "User Experience Program" and turn it Off.',
    ],
  },
  "nvidia-low-latency": {
    where: "NVIDIA Control Panel (per-game)",
    state: "unknown",
    steps: [
      "Right-click the desktop → NVIDIA Control Panel.",
      "Manage 3D settings → Program Settings → pick your game.",
      'Set "Low Latency Mode" to Ultra, then Apply.',
    ],
  },
  "gpu-prefer-discrete": {
    where: "Windows Graphics settings",
    state: "unknown",
    openUri: "ms-settings:display-advancedgraphics",
    openLabel: "Open Graphics settings",
    steps: [
      "In Graphics settings, add or select your game's .exe.",
      'Set it to "High performance" (your discrete GPU), then Save.',
    ],
  },
  "monitor-max-refresh": {
    where: "Windows Advanced display",
    state: "needs-action",
    openUri: "ms-settings:display-advanced",
    openLabel: "Open Advanced display",
    steps: [
      'Set "Choose a refresh rate" to the highest value your monitor lists.',
      "If your max isn't shown, check the cable (DisplayPort / HDMI 2.1) and monitor OSD.",
    ],
  },
  "gpu-driver-update": {
    where: "Your GPU vendor's app",
    state: "unknown",
    steps: [
      "NVIDIA: NVIDIA App / GeForce Experience → Drivers → Check for updates.",
      "AMD: AMD Software → Home → Check for Updates.",
      "Intel: Intel Graphics Software → Drivers.",
    ],
  },
  "storage-c-low": {
    where: "Windows Storage settings",
    state: "needs-action",
    openUri: "ms-settings:storagesense",
    openLabel: "Open Storage settings",
    steps: [
      "Run Storage Sense / Cleanup recommendations.",
      "Uninstall unused apps and move large libraries (e.g. game installs) off C:.",
      "Empty the Recycle Bin and Downloads if safe.",
    ],
  },
  "ssd-upgrade-advisory": {
    where: "Hardware (informational)",
    state: "unknown",
    steps: [
      "This is a hardware suggestion, not a setting — an NVMe/SSD dramatically cuts load times.",
      "If you add one, install Windows or your games on it and keep it as the system/boot drive.",
    ],
  },
};

// Security: only fixed ms-settings: targets defined above may ever be opened.
const ALLOWED_OPEN_URIS = new Set(
  Object.values(GUIDED_STEPS).map((g) => g.openUri).filter(Boolean) as string[],
);
async function openGuidedUri(uri: string) {
  if (!ALLOWED_OPEN_URIS.has(uri)) return; // never open anything off the allowlist
  try {
    await openUrl(uri);
  } catch {
    /* opener unavailable / blocked — the written steps still stand */
  }
}

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
              ? "Sentinel detected this is below its recommended state — worth doing."
              : "Sentinel can't read this setting's current state (it lives in a vendor app / outside what we probe). Check it yourself; skip if it's already set."
          }
        >
          <span className="guided-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <span className="rec-guided-pill" title="Sentinel guides you to where this lives — it won't change it for you, by design.">
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
                  Sentinel can't read this one's current state, so check before you
                  change it — if it's already set the way you want, you're done.
                </p>
              )}
              <p className="guided-note">
                Sentinel won't change this for you — it lives outside what we can
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
}: {
  recs: Recommendation[];
  startup: StartupEntry[];
  busyId: string | null;
  onToggleRec: (rec: Recommendation) => void;
  onToggleStartup: (entry: StartupEntry) => void;
  hasActiveChange: (recId: string) => boolean;
}) {
  type Filter = "All" | RecCategory | "Guided" | "Startup";
  const [filter, setFilter] = useState<Filter>("All");

  // Split appliable (Sentinel-owned toggles) from advisory/guided (Sentinel
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

  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          Optimize
          <span className="count-badge">{appliableRecs.length}</span>
        </h2>
        <div className="read-only-pill">Nothing changes without your approval</div>
      </div>

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
            Settings Sentinel detected but <strong>won't change for you</strong> —
            they live in a vendor app or a Windows page with no safe, reversible
            switch Sentinel can own. Instead of a dead toggle, here's exactly where
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
        <div className="rec-list">
          {shownRecs.map((r) => (
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
        </div>
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

function MonitoringTab({ active }: { active: boolean }) {
  const [gpuSamples, setGpuSamples] = useState<GpuSensorSnapshot[][]>([]);
  const [cpuSamples, setCpuSamples] = useState<CpuSensorSnapshot[]>([]);
  const [hasGpu, setHasGpu] = useState<boolean | null>(null);
  const [fps, setFps] = useState<FpsStatus | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);

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
      }
    } catch {
      /* ignore — leave toggle as-is */
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
        const [gpuSnap, cpuSnap, fpsStatus] = await Promise.all([
          invoke<GpuSensorSnapshot[]>("get_gpu_sensors"),
          invoke<CpuSensorSnapshot>("get_cpu_sensors"),
          invoke<FpsStatus>("get_fps_status"),
        ]);
        if (cancelled) return;
        setHasGpu(gpuSnap.length > 0);
        setFps(fpsStatus);
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
        frametime via ETW. No injection into your games, no kernel driver —
        anti-cheat compatible. The overlay draws over borderless/windowed
        games (not exclusive fullscreen). Charts show the last minute.
        <br />
        <span className="coverage-note">
          GPU sensor coverage: <strong>AMD — verified</strong> · NVIDIA —
          implemented, not yet hardware-verified · Intel — planned.
        </span>
      </p>

      {/* FPS / frametime — headline metric, opt-in (needs admin) */}
      <FpsPanel
        fps={fps}
        busy={fpsBusy}
        onEnable={enableFps}
        onStop={stopFps}
      />

      {/* CPU panel — vendor-agnostic, always shows */}
      {latestCpu && (
        <CpuMonitorPanel
          cpu={latestCpu}
          history={cpuSamples}
        />
      )}

      {/* GPU panels — one per detected NVIDIA adapter */}
      {hasGpu === false ? (
        <div className="empty">
          GPU sensors unavailable. Sentinel reads GPU telemetry from NVML,
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
          <span className="fps-proc">{sample.process_name || `pid ${sample.pid}`}</span>
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
        not a benchmark-grade figure — Sentinel isn't a CapFrameX/PresentMon
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

function CpuMonitorPanel({
  cpu,
  history,
}: {
  cpu: CpuSensorSnapshot;
  history: CpuSensorSnapshot[];
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
        and Sentinel won't install one. GPU temperature comes from the vendor's
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
        Sentinel's raw view of your PC. These are the observations the
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
  // framing -- this is where Sentinel proves it's not a tweak pack.
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
        Every change Sentinel has applied to your machine, with the data needed to
        roll it back independently of the live recommendation catalog. This is
        the receipt — Sentinel can prove what it changed, when, with which
        version, and whether your machine still reflects the change.
      </p>
      <div className="change-list">
        {changes.length === 0 ? (
          <div className="empty">
            No applied changes yet. Anything Sentinel applies will appear here
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

function Card({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      <div className="card-details">{children}</div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="detail">
      <span className="detail-key">{k}</span>
      <span className="detail-value">{v}</span>
    </div>
  );
}

const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified: "Verified",
  "measured-signal": "Measured signal",
  "expected-impact": "Expected impact",
};

// Tooltip text shown when the user hovers the provenance pill. Each one
// names the honesty level of the rec's IMPACT claim, not the rec itself.
const PROVENANCE_TITLE: Record<Provenance, string> = {
  verified:
    "Sentinel directly observes this fact (e.g., reads the current refresh rate, measures free disk space, checks driver date). The claim IS the measurement.",
  "measured-signal":
    "Third-party benchmarks or wide community testing has measured this impact. Sentinel cites established results rather than inventing them.",
  "expected-impact":
    "Logical from Windows internals; Sentinel has NOT measured this itself. Honest 'we believe this but haven't verified it under our own benchmark suite.'",
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
  // Distinct truths Sentinel surfaces (per cross-LLM review): the toggle
  // position must not pretend Sentinel owns Windows state. We show three
  // separate facts and let the user reason about them:
  //   1. Recommended state  — what Sentinel thinks (always "On" for these recs;
  //      they're all framed as "do this thing", so the recommendation is to
  //      apply)
  //   2. Current state      — what Windows actually is right now (live)
  //   3. Applied by Sentinel — did Sentinel make this change, or did the user
  //      already have it that way / change it externally?
  //
  // The toggle reflects the Current state (so flipping it asks Windows to
  // change). When Current matches Recommended but Sentinel didn't apply it,
  // we surface that distinction explicitly rather than offering a rollback
  // we don't actually have a contract for.
  const currentlyOn = rec.currently_applied;
  const sentinelOwns = canToggleOff; // we have a still-active applied change
  const isInfo = !appliable; // advisory / informational only

  const toggleDisabled =
    busy || isInfo || (currentlyOn && !sentinelOwns);

  const toggleTitle = isInfo
    ? "Advisory recommendation — Sentinel can't auto-apply this; follow the description"
    : busy
    ? "Working…"
    : currentlyOn && !sentinelOwns
    ? "Already on, but Sentinel didn't apply it. Toggle off in the original Windows location."
    : currentlyOn
    ? "Click to roll back. Sentinel will restore the prior state recorded at apply time."
    : "Click to apply. Sentinel will snapshot the prior state so you can roll back at any time.";

  // "Applied by Sentinel" status — three-way: Yes / No (advisory) / No (external)
  const sentinelAppliedLabel = isInfo
    ? "N/A — advisory recommendation"
    : sentinelOwns
    ? "Yes"
    : currentlyOn
    ? "No (set outside Sentinel)"
    : "No (not applied)";
  const sentinelAppliedClass = sentinelOwns
    ? "state-on"
    : currentlyOn && !sentinelOwns
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
            // Blocked = ON but Sentinel didn't apply it, so there's no rollback
            // contract to flip it off safely. Surface a clear hover tooltip
            // explaining why (instead of just a bare "no" cursor).
            const blockedExternal = currentlyOn && !sentinelOwns;
            return (
              <span
                className={`toggle-wrap ${blockedExternal ? "toggle-wrap-blocked" : ""}`}
                data-tip={
                  blockedExternal
                    ? "Already on, but you (or Windows) enabled this — not Sentinel. Sentinel has no rollback record for changes it didn't make, so it won't flip it off and risk being unable to restore. Turn it off in its original Windows location if you want it off."
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
                    Already on, but <em>you</em> or Windows set it — not Sentinel. With no rollback record, Sentinel won't flip it off and risk not being able to put it back. Change it in its own Windows location instead.
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
              <span className="rec-status-label">Applied by Sentinel</span>
              <span className={`rec-status-value ${sentinelAppliedClass}`}>
                {sentinelAppliedLabel}
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
        className="change-header"
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
            {stale && <span className="change-note"> · reverted outside Sentinel</span>}
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
                  ? "Rolled back by Sentinel"
                  : stale
                  ? "Applied, but no longer matches current Windows state"
                  : "Applied — Sentinel-owned"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Sentinel app version</span>
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
            This row is the rollback contract. Sentinel can restore the prior
            state from the snapshot above, independently of whether this rule
            still exists in the active recommendation catalog.
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
