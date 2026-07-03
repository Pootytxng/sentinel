import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Onboarding, { ONBOARDED_KEY } from "./Onboarding";
import FirstCheck, { FIRST_CHECK_KEY } from "./surfaces/FirstCheck";
import { SetupTour, SETUP_TOUR_KEY } from "./surfaces/setup/SetupTour";
import { LibraryContext } from "./surfaces/library-context";
import { Term } from "./design/Term";
import { Wordmark } from "./design/Wordmark";
import { BackButton, ForwardButton } from "./design/BackButton";
import { NavGlyph } from "./design/NavGlyph";
import { readCloseToTray, persistDisplayRefreshHz, readLivingInstrument } from "./design/theme";
import { HardwareSection } from "./surfaces/HardwareSection";
import { fmtGB, fmtGHz } from "./surfaces/hardware-format";
import { railFor, type HomeRailId } from "./design/homeRail";
import { GamingMode } from "./surfaces/GamingMode";
import CommandCenter from "./surfaces/CommandCenter";
import Fix from "./surfaces/Fix";
import Learn from "./surfaces/Learn";
import Check from "./surfaces/Check";
// Aliased so the new merged shell never shadows the "Optimize" Tab string literal (which is the
// INTERNAL name of today's Tune slot; the merged tab reuses that same slot — see the wiring below).
import { Optimize as OptimizeShell } from "./surfaces/Optimize";
import { prewarmScan } from "./surfaces/use-scan";
import { activeChangeCount } from "./surfaces/dashboard-data";
import { prettyGameName } from "./surfaces/game-name";
import { gpuVendor } from "./surfaces/walkthroughs";
import type { BatchApplyReport } from "./types";
import { bumpLocalStat, readLocalStats, statsLine } from "./data/local-stats";
import { readOptimizeMerged, readMonitorMerged } from "./data/nav-flags";
import { invalidateProbe } from "./data/probe-cache";
import Play from "./surfaces/Play";
import Monitor from "./surfaces/Monitor";
import Lab from "./surfaces/Lab";
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
  rated_speed_mhz: number;
  type_name: string;
  manufacturer: string;
  xmp_expo_status: string; // "running_below_rated" | "running_at_rated" | "unknown"
};

type BiosInfo = {
  manufacturer: string;
  version: string;
  release_date: string;
  release_date_age_days: number | null;
};

type VirtualizationInfo = {
  hypervisor_present: boolean;
  cpu_virtualization_enabled: boolean | null;
};

type DiskHealth = {
  friendly_name: string;
  health: string; // "Healthy" | "Warning" | "Unhealthy" | "Unknown"
};

type UsbSummary = {
  top_spec: string; // "USB4" | "USB 3.2" | ... | "Unknown"
  controller_count: number;
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

export type MonitorInfo = { model: string; manufacturer: string };
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
  disk_health: DiskHealth[];
  display: DisplayInfo | null;
  memory_modules: MemoryModuleInfo[];
  windows_version: WindowsVersionInfo | null;
  cpu_arch: CpuArchInfo | null;
  network_adapters: NetAdapterInfo[];
  monitors?: MonitorInfo[];
  has_wired_ethernet_port: boolean;
  bios_info: BiosInfo | null;
  virtualization: VirtualizationInfo | null;
  usb: UsbSummary | null;
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

// Top-level sections shown in the left command rail. The six rec categories +
// Startup are consolidated into one "Optimize" section (filtered inside) so the
// rail stays short and never needs a horizontal scroll.
type Tab = "Overview" | "Check" | "Optimize" | "Play" | "Learn" | "Lab" | "Diagnostics" | "History";

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
  // Esc closes the report modal (parity with the other dialogs; mouse users get the backdrop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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

// (The classic appearance ThemePicker was retired 2026-06-06 — superseded by the Instrument theme
// system: Halfway/Midnight/Hearth via data-itheme, set app-wide at startup and managed in Settings. A
// recorded decision, not a silent loss — see the surface-default governance section in
// docs/superpowers/plans/2026-06-04-beta-build-order.md.)

const APP_VERSION = "0.1.0";

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSection[]>([]);
  const [rulesSource, setRulesSource] = useState<string>("embedded");
  const [error, setError] = useState<string | null>(null);
  // One place to turn a raw backend/Rust error into a calm, plain-English banner line for a
  // non-technical user. The technical detail goes to the console for diagnosis (retrievable over the
  // debug port), never shown raw to the user — the owner's "no String(e) in the face" law.
  const fail = useCallback((message: string, detail?: unknown) => {
    if (detail !== undefined) console.error("[compy]", message, detail);
    setError(message);
  }, []);
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
  // Optimize merge (phase 1a, spec 2026-06-21-optimize-merge-design): when on, Check + Tune collapse
  // into one "Optimize" room (Fixes / Applied / History segments). Read once at startup (mirrors the
  // other compy_* dev-flag readers). Reversible: the flag governs only which navigation/render path
  // the shell takes — the classic separate Check + Tune are one localStorage flag away.
  // Merged Optimize tab is the DEFAULT (owner sign-off 2026-06-21). Escape hatch: set
  // compy_optimize="0" to fall back to the classic separate Check + Tune tabs (fully reversible).
  const optimizeMerged = readOptimizeMerged();
  // Monitor restructure (tab #2): segments the Monitor surface into Sessions(default)/Live. DEFAULT ON
  // (owner sign-off 2026-06-21). Escape hatch: compy_monitor="0" restores the classic single Play surface.
  // Guarded readers — a bare getItem in the render body throws (→ blank app) on storage-disabled WebView2.
  const monitorMerged = readMonitorMerged();
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
  const [showSettings, setShowSettings] = useState(false);
  // Settings opens from the custom titlebar (window chrome lives outside <App/>, so it signals across
  // the tree — same bridge as the compy:*-changed flags). The titlebar gear is the app-wide entry.
  useEffect(() => {
    const on = () => setShowSettings(true);
    window.addEventListener("compy:open-settings", on);
    return () => window.removeEventListener("compy:open-settings", on);
  }, []);
  // The combined "Setup & Tour" (HoloLens) is the new first-run experience AND the always-present
  // Home launcher. The legacy Onboarding + FirstCheck auto-modals are SUPERSEDED for fresh installs
  // (kept in the tree as a failsafe; FirstCheck stays reachable via the explicit "Re-run check").
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFirstCheck, setShowFirstCheck] = useState(false);
  // Auto-open the tour ONLY on a truly fresh install (never toured AND never onboarded) — never
  // re-nag a returning user; they reach it from the Home launcher card or Settings.
  const [showSetupTour, setShowSetupTour] = useState(
    () =>
      localStorage.getItem(SETUP_TOUR_KEY) !== "1" && localStorage.getItem(ONBOARDED_KEY) !== "1",
  );
  // Open the tour on demand from the Home launcher card (mirrors the open-settings event pattern).
  useEffect(() => {
    const on = () => {
      setShowSettings(false);
      setShowSetupTour(true);
    };
    window.addEventListener("compy:start-tour", on);
    return () => window.removeEventListener("compy:start-tour", on);
  }, []);
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
  // While the Play room is open, mark the latest debrief as seen — clears the "new" badge.
  // (Play absorbed the classic Sessions tab; this used to key off activeTab === "Sessions".)
  useEffect(() => {
    if (activeTab === "Play" && sessions[0]) {
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
      // leave the banner up so the user can retry / Review
      fail("Couldn't finish restoring your settings just now — try again, or use Review.", e);
    }
  };

  const onExport = async () => {
    setExporting(true);
    setError(null);
    try {
      setReport(await invoke<ExportResult>("export_report", { feedback: null }));
      bumpLocalStat("reportsExported"); // R3 Lane D — local-only counter, best-effort
    } catch (e) {
      fail("Couldn't build the report just now — try again in a moment.", e);
    } finally {
      setExporting(false);
    }
  };

  const refresh = async () => {
    setError(null);
    // A refresh follows app start and every apply/rollback — drop the per-surface probe cache so
    // Advanced/Optimize re-read fresh after any change (between mutations the cache serves instantly).
    invalidateProbe();
    // Paint each field AS ITS data arrives instead of awaiting all 9 together — the slowest probe
    // (get_diagnostics' service-WMI + process scan, get_priorities) no longer gates the fast ones, so
    // Home/hardware/recs appear immediately while diagnostics/priorities hydrate behind them. Each call
    // sets its own state; a failure of one surfaces an error without blanking the rest. Still awaitable
    // (callers apply/rollback await the whole settle) and the data set is byte-identical — only timing.
    const run = <T,>(cmd: string, set: (v: T) => void): Promise<T | undefined> =>
      invoke<T>(cmd)
        .then((v) => {
          set(v);
          return v;
        })
        .catch((e) => {
          fail("Couldn't read some of your system info just now — try again in a moment.", e);
          return undefined;
        });
    // readiness/recs/startup/sessions feed BOTH their own state AND the priority ranking — compute
    // priorities from THEM via the pure priorities_from, instead of get_priorities which re-ran
    // get_game_readiness + get_recommendations a second time (the heaviest, spawn-dominated work).
    const recsP = run<Recommendation[]>("get_recommendations", setRecs);
    const startupP = run<StartupEntry[]>("get_startup_entries", setStartup);
    const readinessP = run<GameReadiness>("get_game_readiness", setReadiness);
    const sessionsP = run<SessionSummary[]>("get_session_summaries", setSessions);
    const prioritiesP = Promise.all([readinessP, recsP, startupP, sessionsP])
      .then(([readiness, recommendations, startup, sessions]) =>
        invoke<Priorities>("priorities_from", {
          readiness,
          recommendations,
          startup,
          sessions,
        }).then(setPriorities),
      )
      .catch((e) => fail("Couldn't rank your priorities just now — try again in a moment.", e));
    await Promise.all([
      run<HardwareInfo>("get_hardware_info", (info) => {
        setHw(info);
        // Relay the monitor's refresh to the OVERLAY window (localStorage — the existing cross-window
        // channel) so its frametime graph can anchor a fixed scale + frame-budget line. Zero IPC.
        persistDisplayRefreshHz(info.display?.current_refresh_rate_hz);
      }),
      run<AppliedChange[]>("get_applied_changes", setChanges),
      run<string>("get_rules_source", setRulesSource),
      run<DiagnosticSection[]>("get_diagnostics", setDiagnostics),
      recsP,
      startupP,
      readinessP,
      sessionsP,
      prioritiesP,
    ]);
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
      fail("Couldn't change that startup item just now — try again.", e);
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
      fail(
        "Couldn't apply that change — it may need an admin OK, or the prompt was cancelled. Nothing was changed; try again.",
        e,
      );
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
      fail("Couldn't undo that change just now — try again, or undo it from the Trust Ledger.", e);
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
    // Optimize merge (phase 1a): when merged, Check folds INTO the "Optimize" slot — there is no
    // standalone Check tab, and the Optimize tab is present whenever EITHER half has content. When
    // off, the two stay separate exactly as before.
    const hasCheck = !!(readiness || priorities);
    const hasTune = (recs?.length ?? 0) > 0 || startup.length > 0 || gamingEnabled;
    if (optimizeMerged) {
      if (hasCheck || hasTune) list.push("Optimize");
    } else {
      if (hasCheck) list.push("Check"); // Check consolidates Readiness + Priorities into one section.
      if (hasTune) list.push("Optimize");
    }
    // Learn is a rail room now (one-rail §1b) and is ALWAYS available — the knowledge library is
    // static/offline. Must be in visibleTabs or the reset effect would bounce it back to Overview.
    list.push("Learn");
    // Play consolidates Monitoring + Sessions IN PLACE; Lab consolidates Benchmark + Latency IN PLACE.
    if (hw || sessions.length > 0) list.push("Play");
    if (hw) list.push("Lab");
    if (diagnostics.length > 0) list.push("Diagnostics");
    if (changes.length > 0) list.push("History");
    return list;
  }, [recs, startup.length, hw, diagnostics.length, changes.length, readiness, sessions.length, priorities, gamingEnabled, optimizeMerged]);

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
  // navHome maps a home id to its tab; HOME_FOR_TAB maps the active tab back to its home so the
  // right rail item highlights.
  const navHome = (id: HomeRailId) => {
    setActiveTab(
      id === "home"
        ? "Overview"
        : id === "check"
          ? // Merged: the rail has no standalone Check room, but map check→Optimize defensively
            // (e.g. a stale persisted location) so it always lands on the merged tab.
            optimizeMerged
            ? "Optimize"
            : "Check"
          : id === "play"
            ? "Play"
            : id === "fix"
              ? "Optimize"
              : id === "learn"
                ? "Learn"
                : "Lab",
    );
  };
  const HOME_FOR_TAB: Partial<Record<Tab, HomeRailId>> = {
    Overview: "home",
    // Merged: Check has no rail room of its own — it folds into the "fix"-id Optimize room, so it
    // highlights that one. Off: Check highlights its own room.
    Check: optimizeMerged ? "fix" : "check",
    Play: "play",
    Optimize: "fix",
    History: "fix",
    Learn: "learn",
    Lab: "lab",
    Diagnostics: "lab",
  };
  const activeHomeId = HOME_FOR_TAB[activeTab];
  // Persistent room name for the narrow (icon-only-rail) layout — the wayfinding-law amendment so you
  // always know where you are even when the rail shows only icons (elastic-window §1).
  const activeRoomName =
    railFor(optimizeMerged).find((r) => r.id === activeHomeId)?.label ?? "Compy";
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
  // Once Optimize has been opened, keep its (heavy) tree MOUNTED and just hide it with display:none on
  // other tabs — so returning to Optimize is an instant CSS show, not a full re-mount/re-render of
  // Check + ~16 rec rows. (Set during render; idempotent. It mounts on first visit, not at app start,
  // so the scan still only runs when the user actually opens Optimize.)
  const optimizeMountedRef = useRef(false);
  // Warm the readiness scan cache during the first idle window after paint, so the user's FIRST
  // open of Optimize/Check seeds the verdict instantly instead of cold-starting the scan (+ replaying
  // the row stagger) on the click. Deferred to idle (requestIdleCallback) so it never competes with
  // Home's first paint; no-op if a real scan already cached. Read-only, reversible, zero new IPC.
  useEffect(() => {
    const ric = (window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (ric) {
      const id = ric(() => void prewarmScan(), { timeout: 3000 });
      return () => (window as typeof window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => void prewarmScan(), 1500);
    return () => window.clearTimeout(t);
  }, []);
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
  // The Command Center is the Home surface once hardware has resolved (avoids a blank first paint);
  // any other tab renders the shell.
  const ccActive = activeTab === "Overview" && hw !== null && !settingsActive;

  // Detected-hardware lines for the intro/tour rig step (shimmer until hardware is read).
  const rigLines = hw
    ? [
        { label: "GPU", value: hw.gpus[0]?.name ?? "No GPU detected" },
        { label: "CPU", value: hw.cpu_arch?.family_label || hw.cpu_brand },
        { label: "RAM", value: fmtGB(hw.ram_total_bytes) },
        { label: "OS", value: hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}` },
      ]
    : [];

  if (activeTab === "Optimize") optimizeMountedRef.current = true;

  return (
    <LibraryContext.Provider value={libraryApi}>
    <KonamiWhisper />
    <main className={ccActive || settingsActive ? "app app-cc" : "app"}>
      {showSetupTour && hw && (
        <SetupTour
          hw={hw}
          rig={rigLines}
          onDone={() => {
            // Mark the legacy flags satisfied too, so the old auto-modals can never fire later.
            try {
              localStorage.setItem(ONBOARDED_KEY, "1");
              localStorage.setItem(FIRST_CHECK_KEY, "1");
            } catch {
              /* non-fatal */
            }
            setShowSetupTour(false);
          }}
        />
      )}
      {showOnboarding && (
        <Onboarding onDone={() => setShowOnboarding(false)} arcV2 rig={rigLines} />
      )}
      {!showOnboarding && showFirstCheck && (
        <FirstCheck onDone={() => setShowFirstCheck(false)} arcV2 />
      )}
      {showEncyclopedia && (
        <Learn
          focusId={libraryFocusId}
          vendor={detectedVendor}
          onClose={() => {
            setShowEncyclopedia(false);
            setLibraryFocusId(null);
          }}
        />
      )}
      {report && (
        <ReportModal
          report={report}
          onClose={() => setReport(null)}
          onOpenFolder={() => {
            invoke("open_export_folder").catch((e) => fail("Couldn't open the exports folder.", e));
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
          {/* ui-sweep: slimmed the repeated room branding (the titlebar already carries the
              wordmark); the full wordmark + tagline stays on Home where it sets the tone. */}
          <h1><Wordmark size={17} /></h1>
        </div>
        <div className="header-right">
          {/* Export left the persistent header (calm chrome) — it lives contextually on the scan
              results (Check) + the session debrief. The header stays clean. */}
        </div>
        </header>
      )}

      {/* Once the app is loaded, action errors (apply/rollback/export/…) show here as a calm,
          dismissable banner. While hw is still null the failed-hardware retry below owns the message,
          so we don't double up. */}
      {error && hw && (
        <div className="error" role="alert">
          <span className="error-msg">{error}</span>
          <button
            type="button"
            className="error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

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
                setActiveTab("Optimize");
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
            // Re-homed: replay the full HoloLens Setup & Tour (guided setup + the room tour).
            setShowSettings(false);
            setShowSetupTour(true);
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
          onNavigate={(tab) => setActiveTab(tab)}
          onRunCheck={() => setShowFirstCheck(true)}
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
              {(() => {
                // railFor collapses Check + Tune → "Optimize" when the merge flag is on (else the
                // blessed six-home set); the living-instrument Lab-tuck filter then rides on top.
                const base = railFor(optimizeMerged);
                return living ? base.filter((r) => r.id !== "lab") : base;
              })().map((item) => (
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
              {/* Gaming Mode is no longer its own rail room — it lives as a featured section inside
                  Tune (Optimize). See the Optimize render below. */}
              {/* Settings moved to the always-visible custom titlebar (reachable on every tab + every
                  responsive layout); the rail gear is retired. Its margin-left:auto was also stretching
                  the "Advanced" cell in the top-strip layout. */}
            </nav>

            <div className="content">
              {/* Persistent room name — shown only in the narrow icon-only-rail layout (CSS), so the
                  wayfinding law holds even when the rail is icons-only (elastic-window §1). */}
              <div className="shell-room-name" aria-hidden="true">{activeRoomName}</div>
              {activeTab === "Overview" && <OverviewTab hw={hw} />}
              {/* Check renders standalone ONLY when the Optimize merge is off; when merged it folds
                  into the Optimize shell below (the Check tab is unreachable then anyway). */}
              {activeTab === "Check" && !optimizeMerged && (
                <Check
                  isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                  onOpenLibrary={(focusId) => libraryApi.openLibrary(focusId)}
                  onChanged={refresh}
                  vendor={detectedVendor}
                  sessions={sessions}
                  gpus={hw?.gpus ?? []}
                  onExport={onExport}
                  exporting={exporting}
                />
              )}
              {optimizeMountedRef.current && (
                <div style={activeTab === "Optimize" ? undefined : { display: "none" }}>
                  {optimizeMerged ? (
                  // Merged shell: Check + Gaming + Fix under Fixes / Applied / History segments + the
                  // persistent active-undo chip. Same props the standalone surfaces receive — pure
                  // composition, no new IPC, same audited apply/rollback handlers.
                  <OptimizeShell
                    isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                    onOpenLibrary={(focusId) => libraryApi.openLibrary(focusId)}
                    onChanged={refresh}
                    vendor={detectedVendor}
                    sessions={sessions}
                    gpus={hw?.gpus ?? []}
                    recs={recs ?? []}
                    startup={startup}
                    changes={changes}
                    busyId={busyId}
                    activeChangeFor={findActiveChangeForRec}
                    onToggleRec={(recId) => {
                      const r = (recs ?? []).find((x) => x.id === recId);
                      if (r) toggleRec(r);
                    }}
                    onToggleStartup={toggleStartup}
                    onRollback={rollback}
                    onApplyBatch={applyBatch}
                    activeCount={activeChangeCount(changes)}
                    gamingSlot={gamingEnabled ? <GamingMode /> : null}
                    onExport={onExport}
                    exporting={exporting}
                  />
                ) : (
                  <>
                    {/* Gaming Mode lives here as a featured section at the top of Tune (its own tab
                        retired — owner 2026-06-19). Only when the gate is on. */}
                    {gamingEnabled && (
                      <div className="tune-gaming-feature">
                        <GamingMode />
                      </div>
                    )}
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
                      vendor={detectedVendor}
                    />
                  </>
                  )}
                </div>
              )}
              {activeTab === "Play" &&
                (() => {
                  // Same props for both surfaces; the Monitor shell adds the Sessions/Live segmented
                  // control and drives Play's `view`. Behind compy_monitor (default off this phase).
                  const monitorProps = {
                    active: activeTab === "Play",
                    sessions,
                    sessionsSeenAt,
                    priorities,
                    recs: recs ?? [],
                    apply,
                    busyId,
                    onExport,
                    changes,
                    rollback,
                    deepMonitoring: <MonitoringTab active={activeTab === "Play"} embedded />,
                    vendor: detectedVendor,
                  };
                  return monitorMerged ? <Monitor {...monitorProps} /> : <Play {...monitorProps} />;
                })()}
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
              {activeTab === "Diagnostics" && (
                <DiagnosticsTab sections={diagnostics} />
              )}
              {activeTab === "History" && (
                <HistoryTab changes={changes} busyId={busyId} onRollback={rollback} />
              )}
            </div>
          </div>
      ) : (
        // hw still null — detection in flight (or slow WMI). A calm placeholder, never a blank window.
        // If the read actually FAILED (error set), don't spin forever — say so and offer a retry.
        <div className="app-booting" role="status" aria-live="polite">
          <Wordmark size={30} />
          {error ? (
            <>
              <p className="app-booting-line">Couldn't read your hardware just now.</p>
              <button className="btn btn-primary app-booting-retry" onClick={() => void refresh()}>
                Try again
              </button>
            </>
          ) : (
            <p className="app-booting-line">Reading your hardware…</p>
          )}
        </div>
      )}

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
      <HardwareSection hw={hw} />
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
        {cpuTemp
          ? "CPU temperature here is read driver-free from a sensor tool you're already running — Compy installs no kernel driver of its own. GPU temperature comes straight from the vendor's user-mode library."
          : "Compy won't install a kernel driver, so it doesn't read CPU temperature on its own — it shows only what a sensor app you run publishes, driver-free (see the row above). GPU temperature comes straight from the vendor's user-mode library, so it always shows."}
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
