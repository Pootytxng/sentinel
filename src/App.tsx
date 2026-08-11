import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
// The visible app version is the SAME canonical string the installer + all three manifests carry
// (package.json === tauri.conf.json === Cargo.toml === Cargo.lock, pinned equal by
// scripts/version-drift-guard.test.mjs Guard A). Importing it here, rather than hardcoding a
// literal, is what keeps the rail from silently drifting from the shipped build — Guard D pins it.
import pkg from "../package.json";
// i18next init (side-effect import): guarantees the translator is ready before first render even
// when this module is imported directly (e.g. by ReportModal.test.tsx), not just via main.tsx's
// own "./i18n" import — same convention main.tsx documents at its own import site.
import "./i18n";
import { ONBOARDED_KEY } from "./Onboarding";
import FirstCheck, { FIRST_CHECK_KEY } from "./surfaces/FirstCheck";
import { SetupTour, SETUP_TOUR_KEY } from "./surfaces/setup/SetupTour";
import { LibraryContext } from "./surfaces/library-context";
import { Term } from "./design/Term";
import { Wordmark } from "./design/Wordmark";
import { readCloseToTray, persistDisplayRefreshHz } from "./design/theme";
import { ShellV2 } from "./design/ShellV2";
import { fmtGB } from "./surfaces/hardware-format";
// Deep Monitoring panels + their sensor types — moved verbatim to surfaces/monitor-panels (T3)
// so the summary-first MonitorDomainCards can reuse them as its expanded detail.
import {
  FpsPanel,
  MemoryPressureBanner,
  CpuMonitorPanel,
  GpuMonitorPanel,
  type CpuSensorSnapshot,
  type GpuSensorSnapshot,
  type MemoryPressure,
  type FpsStatus,
  type CpuTemp,
} from "./surfaces/monitor-panels";
import { MonitorDomainCards } from "./surfaces/MonitorDomainCards";
import { readMonitorCards } from "./design/theme";
import { useReducedMotion } from "./design/use-motion";
import { railFor, type HomeRailId } from "./design/homeRail";
import { HomeRoom } from "./surfaces/HomeRoom";
import { TrustMoment } from "./surfaces/TrustMoment";
import { MonitorV2 } from "./surfaces/MonitorV2";
import { BlackbookV2 } from "./surfaces/BlackbookV2";
import { LabGround } from "./surfaces/LabGround";
// Learn is NOT a room any more (Blackbook renders BlackbookV2) — this import survives the generation
// prune solely for the knowledge-library MODAL, which any surface can raise via LibraryContext.
import Learn from "./surfaces/Learn";
import { prewarmScan } from "./surfaces/use-scan";
import { activeChangeCount } from "./surfaces/dashboard-data";
import { gpuVendor } from "./surfaces/walkthroughs";
import type { BatchApplyReport, ExportResult } from "./types";
import { LEDGER_CHANGED_EVENT } from "./types";
import { bumpLocalStat, readLocalStats, statsLine } from "./data/local-stats";
import { lsGet, lsSet } from "./data/safe-storage";
import { invalidateProbe } from "./data/probe-cache";
import type { LabStationKey } from "./surfaces/lab-guided-data";
import { useDocumentVisible } from "./data/use-document-visible";
import Settings from "./surfaces/Settings";
import {
  type GamingSessionFile,
  type RestoredSummary,
  GAMING_SESSION_RESOLVED_EVENT,
  GAMING_PANE_MOUNTED_EVENT,
  GAMING_PANE_UNMOUNTED_EVENT,
  isRecoverable,
  restoredSummary,
  resumeOptionsFrom,
  showGlobalRecoveryBanner,
  showGlobalRestoredBanner,
  statusLabel,
  summarizeChanges,
} from "./surfaces/gaming-mode";
import "./App.css";
import "./design/doorknob.css";
import { KonamiWhisper } from "./design/KonamiWhisper";
import { useConfirm } from "./design/ConfirmDialog";
import "./design/instrument.css"; // Instrument token layer — after App.css so the accent re-point wins
import "./Onboarding.css";
import "./arc-instrument.css"; // arc re-dress skin (scoped under .arc-v2; after the classics)
import "./design/living-instrument.css"; // "Living Instrument" feel-refresh skin — scoped under [data-living], default ON
import "./design/dashboard-skin.css"; // "dashboard-energy" premium skin — scoped under [data-dash-v2], default ON
import "./design/fonts-v2.css"; // Geist Sans/Mono @font-face (OFL, bundled) — inert until tokens-v2 uses them
import "./design/tokens-v2.css"; // V2 shell tokens — scoped under [data-v2="on"], default ON (main.tsx sets that attribute unconditionally; the compy_v2 flag was removed)
import "./surfaces/room-identity.css"; // per-room identity accents — scoped [data-room-identity="on"], default ON
import "./design/tokens-qpw.css"; // Quiet Pit Wall redesign tokens - scoped [data-qpw="on"], DEFAULT OFF (issue #49)
// The qpw COMPONENT layer (design/qpw/*) was deleted in the 2026-08-06 generation prune: nothing
// imported it and nothing ever sets data-qpw, so it was inert code shipping in the bundle. The
// TOKEN layer above stays — tokens-qpw-guard.test.ts is cited as the one source of truth for motion.
import "./design/tokens-hud.css"; // Instrument-HUD tokens — scoped under [data-hud="on"], DEFAULT ON
import "./surfaces/ambient-hud.css"; // T4c ambient skin (grain · glass · holo-foil) — scoped [data-v2][data-hud]

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
  // Serialized by the Rust `HardwareInfo` (hardware.rs) but not previously mirrored here — optional
  // so historical/partial payloads still typecheck. Kept in sync with the struct; the frontend reads
  // `network_pills` (Latency's readiness chips) directly instead of re-casting the invoke result.
  has_active_wired_ethernet?: boolean;
  eee_switch_exposed?: boolean;
  wifi_link?: {
    band: string | null;
    signal_pct: number | null;
    rx_mbps: number | null;
    radio_type: string | null;
    channel: number | null;
  } | null;
  qos_policies?: string[];
  network_pills?: { label: string; tone: string }[];
  // Game-library storage summary; `libraries` detail (GameLibrary) lives backend-side and no surface
  // consumes it, so the scalar SSD/HDD signals are typed and the list is left opaque.
  game_storage?: { libraries: unknown[]; any_fast: boolean; any_slow: boolean };
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

// Top-level sections shown in the left command rail. Four rooms, one face each: the
// Check + Optimize (Tune) tabs are gone — their content lives inside the Lab's Optimize
// station, which is where railFor() has pointed since the proving-ground merge shipped.
type Tab = "Overview" | "Play" | "Learn" | "Lab";

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

// Drift Watch — a check that was good and has since regressed (cause unknown: could be a Windows
// Update revert or the user's own in-app rollback — we never claim which).
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

// Export Snapshot (F5): read-only local report. ExportResult now lives in ./types (shared with the
// Settings → Feedback surface) so the export_report IPC contract has one source of truth.

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
  const { t } = useTranslation();
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
          <h2 id="export-modal-title">{t("app.reportModal.title")}</h2>
          <button className="btn btn-small" onClick={onClose}>
            {t("app.reportModal.close")}
          </button>
        </div>
        <p className="muted modal-path">{t("app.reportModal.savedTo", { path: report.path })}</p>
        <div className="export-feedback">
          <div className="export-feedback-head">
            {t("app.reportModal.feedbackHeadPre")} <span className="muted">{t("app.reportModal.feedbackHeadOptional")}</span>
          </div>
          {/* One reconciled feature, two entry points (self-review 2026-07-23): this modal captures
              guided feedback at the moment you export; Settings → Feedback & help is the always-on
              home that also emails your note straight to the team. Pointer so they don't read as two
              unrelated surfaces. */}
          <p className="export-feedback-pointer muted">
            {t("app.reportModal.feedbackPointerPre")}
            <strong>{t("app.reportModal.feedbackPointerBold")}</strong>
            {t("app.reportModal.feedbackPointerPost")}
          </p>
          <label className="export-feedback-field">
            <span>{t("app.reportModal.whatLabel")}</span>
            <textarea rows={2} value={fbWhat} onChange={(e) => setFbWhat(e.target.value)} />
          </label>
          <label className="export-feedback-field">
            <span>{t("app.reportModal.confusingLabel")}</span>
            <textarea rows={2} value={fbConfusing} onChange={(e) => setFbConfusing(e.target.value)} />
          </label>
          <label className="export-feedback-field">
            <span>{t("app.reportModal.nextLabel")}</span>
            <textarea rows={2} value={fbNext} onChange={(e) => setFbNext(e.target.value)} />
          </label>
          <div className="export-feedback-actions">
            <button
              className="btn"
              onClick={addFeedback}
              disabled={fbState === "busy" || feedbackBlock() === null}
            >
              {fbState === "busy"
                ? t("app.reportModal.reexporting")
                : fbState === "added"
                  ? t("app.reportModal.feedbackAdded")
                  : fbState === "failed"
                    ? t("app.reportModal.feedbackFailed")
                    : t("app.reportModal.addFeedback")}
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
            {t("app.reportModal.openFolder")}
          </button>
          <button className="btn" onClick={() => copy("full")}>
            {copied === "full" ? t("app.reportModal.copied") : t("app.reportModal.copyFull")}
          </button>
          <button className="btn" onClick={() => copy("summary")}>
            {copied === "summary" ? t("app.reportModal.copied") : t("app.reportModal.copySummary")}
          </button>
          <button className="btn btn-small" onClick={onClose}>
            {t("app.reportModal.close")}
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

const APP_VERSION = pkg.version;

function App() {
  const { t } = useTranslation();
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
  // V2 is the shipped shell (2026-07-03) — the ShellV2 rail carries every room; there's no classic
  // rail layout to switch between anymore, so nothing here mirrors the retired compy_v2/living flags.
  // Generation prune (2026-08-06): the compy_optimize / compy_lab_ground / compy_monitor flags are
  // RETIRED. Each had been default-ON and owner-signed-off for weeks, so their "0" branches rendered
  // rooms nobody could reach — five surfaces' worth of tree that every layout edit had to be
  // disambiguated against. One blessed face per room now: Overview · Play · Learn · Lab.
  const [readiness, setReadiness] = useState<GameReadiness | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  // Sessions "new debrief" indicator: the started_at of the latest session the user has seen.
  const [sessionsSeenAt, setSessionsSeenAt] = useState<string>(
    () => lsGet("compy_sessions_seen_v1") ?? "",
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
  // Export re-entrancy latch. This was STATE until the generation prune (2026-08-06) — its only
  // reader was OptimizeV2's export button, which rendered a busy label. That room is gone, and
  // today's one export entry (Monitor → SessionDebrief) has no busy affordance, so nothing renders
  // it. Kept as a ref rather than deleted: it still stops a double-click firing two concurrent
  // export_report calls, and a ref reads correctly inside the async handler, where state would be
  // a stale closure and let both clicks through anyway.
  const exportingRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  // Settings opens from the custom titlebar (window chrome lives outside <App/>, so it signals across
  // the tree — same bridge as the compy:*-changed flags). The titlebar gear is the app-wide entry.
  useEffect(() => {
    const on = () => setShowSettings(true);
    window.addEventListener("compy:open-settings", on);
    return () => window.removeEventListener("compy:open-settings", on);
  }, []);
  // The combined "Setup & Tour" (HoloLens) is the first-run experience AND the always-present Home
  // launcher. The legacy Onboarding auto-modal is retired; FirstCheck stays reachable on demand via
  // the explicit "Re-run check" (Home / Settings), never as an auto-modal.
  const [showFirstCheck, setShowFirstCheck] = useState(false);
  // Auto-open the tour ONLY on a truly fresh install (never toured AND never onboarded) — never
  // re-nag a returning user; they reach it from the Home launcher card or Settings.
  const [showSetupTour, setShowSetupTour] = useState(
    () =>
      lsGet(SETUP_TOUR_KEY) !== "1" && lsGet(ONBOARDED_KEY) !== "1",
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
  // Stable identity so SetupTour's finish→onDone→keydown-effect chain doesn't churn every App render
  // (an inline arrow here re-ran the tour's mount effect and re-stole focus back to Next).
  const handleSetupTourDone = useCallback(() => {
    // Mark the legacy flags satisfied too, so the old auto-modals can never fire later.
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
      localStorage.setItem(FIRST_CHECK_KEY, "1");
    } catch {
      /* non-fatal */
    }
    setShowSetupTour(false);
    // Same class of bug as FirstCheck's onDone (Cowork audit, 2026-07-19): the tour can apply real
    // recommendations via its own internal useScan/rerun (SetupTour.tsx's applyLimiter/applyReversal,
    // invoke("apply_recommendation")), which never touched App's top-level readiness/recs/changes/
    // priorities state. Without this, closing the tour after applying something left Home/Optimize/
    // the Trust Ledger showing pre-tour data until an unrelated action happened to refresh().
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately NOT depending on
    // `refresh` (it's a plain unmemoized arrow, re-created every render): this callback's
    // identity must stay stable across renders (see comment above — SetupTour's mount effect
    // re-fires and steals focus back to Next if onDone churns). `refresh` only calls invoke()
    // + the always-stable useState setters, so an "older" closure over it is functionally
    // identical to a fresh one — nothing it captures changes in a way that matters here.
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
  // Owner ask 2026-07-14: the global recovery prompt is a bottom-right toast with a × that
  // tucks it away. Hidden is THIS-RUN-ONLY presentation state — it never clears
  // gamingRecovery (never-hide law): the Gaming pane's card + Review path stay live, and a
  // relaunch (or a fresh recovery, un-hidden below) re-greets while the session is unresolved.
  const [recoveryToastHidden, setRecoveryToastHidden] = useState(false);
  useEffect(() => {
    if (gamingRecovery) setRecoveryToastHidden(false);
  }, [gamingRecovery]);
  useEffect(() => {
    if (!gamingEnabled) return;
    invoke<GamingSessionFile | null>("get_gaming_session_state")
      .then((s) => {
        if (s && isRecoverable(s.status)) setGamingRecovery(s);
      })
      .catch(() => {});
  }, [gamingEnabled]);
  // Visible restore-success confirmation (owner-caught UX gap 2026-07-07: "Restore now"
  // succeeded silently — he couldn't tell it worked). Set only once the backend confirms.
  const [gamingRestored, setGamingRestored] = useState<RestoredSummary | null>(null);
  // Restore in flight — disables the button so a double-click can't race two restores
  // (the backend also serializes via its session-op lock; this is the polite layer).
  const [gamingRestoring, setGamingRestoring] = useState(false);
  const recoverGaming = async (confirm: boolean) => {
    if (!confirm) {
      setGamingRecovery(null);
      return;
    }
    const changes = gamingRecovery?.changes ?? [];
    setGamingRestoring(true);
    try {
      await invoke("recover_gaming_session", { confirm: true });
      setGamingRecovery(null); // cleared only once restore confirms
      setGamingRestored(restoredSummary(changes, t)); // backend confirmed: every change restored
      setGamingResumed(null); // one confirmation at a time — restore supersedes a stale resume
      window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear the pane's prompts
    } catch (e) {
      // leave the banner up so the user can retry / Review
      fail(t("app.errors.recoverGamingFailed"), e);
    } finally {
      setGamingRestoring(false);
    }
  };
  // The Gaming pane resolved the session (Stop / Return to normal / Resume) → drop the
  // global banner's stale prompt, or it would re-prompt for an already-restored session
  // on the next tab switch (self-review catch, 2026-07-08). Never touches gamingRestored:
  // the surface the user acted on shows the one confirmation.
  useEffect(() => {
    const onResolved = () => setGamingRecovery(null);
    window.addEventListener(GAMING_SESSION_RESOLVED_EVENT, onResolved);
    return () => window.removeEventListener(GAMING_SESSION_RESOLVED_EVENT, onResolved);
  }, []);
  // Is a Gaming pane actually on screen? The global banners defer to its richer cards ONLY
  // while one is mounted — the old tab-name deferral hid a pending recovery anywhere on the
  // Lab/Optimize tabs outside the gaming door (owner-lived gap, T6c train 2026-07-10). A
  // counter (not a boolean) stays honest through StrictMode's symmetric dev double-mount.
  const [gamingPanes, setGamingPanes] = useState(0);
  useEffect(() => {
    const up = () => setGamingPanes((n) => n + 1);
    const down = () => setGamingPanes((n) => Math.max(0, n - 1));
    window.addEventListener(GAMING_PANE_MOUNTED_EVENT, up);
    window.addEventListener(GAMING_PANE_UNMOUNTED_EVENT, down);
    return () => {
      window.removeEventListener(GAMING_PANE_MOUNTED_EVENT, up);
      window.removeEventListener(GAMING_PANE_UNMOUNTED_EVENT, down);
    };
  }, []);
  const gamingPaneMounted = gamingPanes > 0;
  // One-click Resume on the global banner (owner directive 2026-07-10): the pane's audited
  // recover→start sequence, verbatim — roll the interrupted session back to the TRUE prior
  // state first (rollback-first: the fresh session snapshots normal settings, never the
  // half-applied ones), then start anew with the interrupted session's OWN tiers
  // (resumeOptionsFrom). Explicit click only — never zero-click auto-apply on launch.
  const [gamingResuming, setGamingResuming] = useState(false);
  const [gamingResumed, setGamingResumed] = useState<string | null>(null); // honesty line
  const resumeGaming = async () => {
    if (!gamingRecovery) return;
    const opts = resumeOptionsFrom(gamingRecovery.changes);
    setGamingResuming(true);
    try {
      await invoke("recover_gaming_session", { confirm: true });
    } catch (e) {
      // Restore leg failed → the banner stays up so every option is still one click away.
      fail(t("app.errors.recoverGamingFailed"), e);
      setGamingResuming(false);
      return;
    }
    setGamingRecovery(null); // cleared only once the restore leg confirms
    window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear the pane's prompts
    try {
      const file = await invoke<GamingSessionFile>("start_gaming_session", { opts });
      setGamingResumed(summarizeChanges(file.changes, t).line);
      setGamingRestored(null); // one confirmation at a time — the live session supersedes it
    } catch (e) {
      // Start leg failed AFTER a confirmed restore — settings are safely back; say exactly
      // that, and point at the one door to try again (never a vague "resume failed").
      fail(t("app.errors.gamingResumeFailedGround", { room: t("common.rail.lab") }), e);
    } finally {
      setGamingResuming(false);
    }
  };

  const onExport = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setError(null);
    try {
      setReport(await invoke<ExportResult>("export_report", { feedback: null }));
      bumpLocalStat("reportsExported"); // R3 Lane D — local-only counter, best-effort
    } catch (e) {
      fail(t("app.errors.exportFailed"), e);
    } finally {
      exportingRef.current = false;
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
          fail(t("app.errors.readInfoFailed"), e);
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
      .then(([readiness, recommendations, startup, sessions]) => {
        // If ANY of the four probes failed, its own run() catch already surfaced the REAL error.
        // Invoking priorities_from with a missing/undefined arg would reject on the Rust side's
        // deserialization and fire a SECOND, misleading "couldn't rank priorities" toast on top of
        // the true cause — so skip it. Priorities stay as-is; the next clean refresh recomputes them.
        if (
          readiness === undefined ||
          recommendations === undefined ||
          startup === undefined ||
          sessions === undefined
        ) {
          return;
        }
        return invoke<Priorities>("priorities_from", {
          readiness,
          recommendations,
          startup,
          sessions,
        }).then(setPriorities);
      })
      // Only a genuine priorities_from failure (all four present, ranking itself failed) reaches here.
      .catch((e) => fail(t("app.errors.rankPrioritiesFailed"), e));
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
      fail(t("app.errors.startupToggleFailed"), e);
    } finally {
      setBusyId(null);
    }
  };

  const confirm = useConfirm();

  const apply = async (rec: Recommendation) => {
    const tradeoff = rec.downside ? t("app.dialogs.applyTradeoff", { downside: rec.downside }) : "";
    const ok = await confirm({
      title: t("app.dialogs.applyTitle", { title: rec.title }),
      body: t("app.dialogs.applyBody", { description: rec.description, tradeoff }),
      confirmLabel: t("app.dialogs.apply"),
    });
    if (!ok) return;
    setBusyId(rec.id);
    setError(null);
    try {
      await invoke<AppliedChange>("apply_recommendation", {
        recId: rec.id,
        recTitle: rec.title,
      });
      // The ledger changed in-app — let sibling surfaces that cache ledger-derived state (e.g. the
      // armed ExperimentBench simulator read) re-derive without waiting for an OS refocus. Additive,
      // read-only signal; no new mutation path.
      window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
      await refresh();
    } catch (e) {
      fail(t("app.errors.applyFailed"), e);
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
      // A batch that applied anything changed the ledger — signal siblings (see apply()'s note). A
      // batch-level refusal rejects (nothing applied) and is handled in catch, so no false signal.
      if (report.applied > 0) window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
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
    const dest = change.restores_label
      ? t("app.dialogs.rollbackDest", { label: change.restores_label })
      : "";
    const ok = await confirm({
      title: t("app.dialogs.rollbackTitle", { title: change.rec_title }),
      body: t("app.dialogs.rollbackBody", { dest }),
      confirmLabel: t("app.dialogs.rollback"),
    });
    if (!ok) return;
    setBusyId(change.id);
    setError(null);
    try {
      await invoke("rollback_change", { changeId: change.id });
      // Rolling back changes the ledger too — a rec can become available again, so siblings re-derive.
      window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
      await refresh();
    } catch (e) {
      fail(t("app.errors.rollbackFailed"), e);
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
        setError(t("app.errors.recAppliedExternally", { title: rec.title }));
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

  // Ordered list of rooms that have content. There is no standalone Check or Optimize (Tune) room —
  // the Lab's Optimize station is the one door to the toggles (its panel carries Fix + the ledger
  // History; Check lives under "More cleanup"), which is what the rail has shown since the
  // proving-ground merge shipped. Overview and Learn are always available (Learn's knowledge library
  // is static/offline); Learn MUST be listed or the reset effect below bounces it to Overview.
  const visibleTabs: Tab[] = useMemo(() => {
    const list: Tab[] = ["Overview", "Learn"];
    // Play consolidates Monitoring + Sessions IN PLACE; Lab consolidates Benchmark + Latency IN PLACE.
    if (hw || sessions.length > 0) list.push("Play");
    if (hw) list.push("Lab");
    // Diagnostics + History are no longer standalone rooms — Diagnostics embeds inside the Lab and
    // the Trust Ledger (History) lives inside the Lab's Optimize station, so neither is a visible tab.
    return list;
  }, [hw, sessions.length]);

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
      ? t("app.status.rulesRemote")
      : rulesSource === "cached"
      ? t("app.status.rulesCached")
      : t("app.status.rulesBuiltin");

  // Six-home rail (one-rail §1b) — the ShellV2 rail renders from HOME_RAIL. navHome maps a home id
  // to its tab; HOME_FOR_TAB maps the active tab back to its home so the right rail item highlights.
  // railFor() already filters the check + fix ids off the rail, so those two arms only fire for a
  // stale persisted location; both land on the Lab, which is where the toggles live.
  const navHome = (id: HomeRailId) => {
    setActiveTab(id === "home" ? "Overview" : id === "play" ? "Play" : id === "learn" ? "Learn" : "Lab");
  };
  // The check->fix hallway. Every "take me to the fixes" affordance in the app routes through HERE,
  // so there is exactly ONE writer of the station intent and exactly one ordering to get right:
  // persist BEFORE navHome mounts LabConsole (race-free), because LabConsole reads + clears the key
  // on mount. Landing on the Lab dock instead of the station is the bug this closes — naming a fix
  // count and then making the user hunt for the fixes is the dead-end the app exists to avoid.
  // Generalised 2026-08-11 (crash-rescue discoverability, SESSION_HANDOFF §4): the hallway was
  // hard-wired to "optimize" because Optimize was the only station anything deep-linked to. The
  // Home intake band's "it crashed or froze" row needs the SAME race-free handoff to the crash
  // evidence, so the station is now the parameter and this stays the ONE writer of the intent —
  // one ordering to get right, pinned by post-check-lab-route-guard.
  const openLabStation = (station: LabStationKey) => {
    try {
      localStorage.setItem("compy_lab_open_station", station);
    } catch {
      /* non-fatal — the user still lands in the Lab, just on the dock */
    }
    navHome("lab");
  };
  const openFixesInLab = () => openLabStation("optimize");
  const HOME_FOR_TAB: Partial<Record<Tab, HomeRailId>> = {
    Overview: "home",
    Play: "play",
    Learn: "learn",
    Lab: "lab",
  };
  const activeHomeId = HOME_FOR_TAB[activeTab];
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
  // Warm the readiness scan cache during the first idle window after paint, so the user's FIRST
  // open of the Lab's Optimize station seeds the verdict instantly instead of cold-starting the scan
  // (+ replaying the row stagger) on the click. Deferred to idle (requestIdleCallback) so it never
  // competes with Home's first paint; no-op if a real scan already cached. Read-only, zero new IPC.
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
  // Settings is a full-surface route (replaces the home/shell while open) so the surfaces under it
  // unmount and re-read their persisted prefs on return — no cross-surface live-sync needed.
  // NOT gated on settingsV2: Settings v2 is the ONLY Settings surface (no classic fallback), and the
  // settings flag was itself toggleable inside Settings → disabling it was a permanent self-lockout
  // (dead gear, no way back in). The gear must always open Settings regardless of the stored flag.
  const settingsActive = showSettings && hw !== null;
  // V2 shell: ONE rail+topbar chrome wraps every room, Home included — the shipped shell now. Active
  // whenever hardware has resolved and Settings isn't the full-surface route (titlebar gear).
  const v2Shell = hw !== null && !settingsActive;

  // Detected-hardware lines for the intro/tour rig step (shimmer until hardware is read).
  const rigLines = hw
    ? [
        { label: t("app.rig.gpu"), value: hw.gpus[0]?.name ?? t("app.rig.noGpu") },
        { label: t("app.rig.cpu"), value: hw.cpu_arch?.family_label || hw.cpu_brand },
        { label: t("app.rig.ram"), value: fmtGB(hw.ram_total_bytes) },
        { label: t("app.rig.os"), value: hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}` },
      ]
    : [];

  // ── Room renders (generation prune 2026-08-06) ─────────────────────────────
  // There used to be a `roomPanels` fragment here holding the classic Check / Optimize / Play /
  // Learn / Lab trees, kept warm behind a KeepaliveRoom and swapped in by the compy_optimize /
  // compy_monitor / compy_lab_ground flags. Every one of those flags had been default-ON and
  // owner-signed-off for weeks, so the classic side was unreachable tree — and its Learn and Lab
  // branches were doubly dead, excluded unconditionally by the consumer guard below. Each room now
  // renders exactly one face, inline, in the shell below.
  //
  // The rail that survived the prune: railFor's `ground` arm, which filters the check + fix ids out
  // of HOME_RAIL and leaves Home · Monitor · Blackbook · Lab. Both args are now constants (the flags
  // they used to read are gone), so this is computed once and shared by the shell rail and the Home
  // dock — they were always required to agree, and now they cannot drift.
  const rail = railFor(true, true);

  return (
    <LibraryContext.Provider value={libraryApi}>
    <KonamiWhisper />
    <main className={v2Shell ? "app app-v2" : settingsActive ? "app app-cc" : "app"}>
      {showSetupTour && hw && (
        <SetupTour
          hw={hw}
          rig={rigLines}
          onDone={handleSetupTourDone}
        />
      )}
      {showFirstCheck && (
        <FirstCheck
          onDone={() => {
            setShowFirstCheck(false);
            // A Home-triggered re-run resolves its OWN fresh verdict inside FirstCheck (and
            // correctly updates the RerunCheckBand's honest last-check snapshot there) but never
            // touched App's top-level `readiness` — so the console's Readiness gauge (score +
            // "N of M checks passed" note, HomeConsole.tsx) kept showing the PRE-rerun numbers
            // until some unrelated apply/rollback happened to call refresh(). Same resync every
            // other state-changing action already gets (onChanged={refresh} elsewhere) — re-run
            // is exactly that class of event too. Bug found in Cowork audit of 408c860, 2026-07-19.
            void refresh();
          }}
          onGoToLab={() => {
            // Post-check route (tester J 2026-07-22): close the verdict and land the user in the Lab
            // with the Optimize station auto-opened — openFixesInLab owns the race-free handoff.
            setShowFirstCheck(false);
            void refresh();
            openFixesInLab();
          }}
          arcV2
        />
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
            invoke("open_export_folder").catch((e) => fail(t("app.errors.openExportsFolderFailed"), e));
          }}
          onReexport={async (feedback) => {
            setReport(await invoke<ExportResult>("export_report", { feedback }));
          }}
        />
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
            aria-label={t("app.errorBanner.dismiss")}
          >
            ×
          </button>
        </div>
      )}

      {/* Gaming toast stack — a small bottom-right popup, not a top bar (owner ask 2026-07-14:
          "a little popup window down at the bottom right … out of the way that you can easily
          restore or dismiss"). Everything the banners guaranteed carries over unchanged:
          · Defers to the Gaming pane's own richer prompt while one is actually MOUNTED — two
            simultaneous prompts for one event read as a bug (self-review catch, 2026-07-08).
            Mount-aware, not tab-aware (T6c, 2026-07-10).
          · Resume is primary (owner directive 2026-07-10).
          · Never-hide law: the × only tucks the toast away for THIS run — it never clears
            gamingRecovery, so the pane's own card (and Review) keep offering the restore, and
            the next launch re-greets if the session is still unresolved. */}
      <div className="gaming-toast-stack">
        {showGlobalRecoveryBanner(gamingRecovery !== null, gamingPaneMounted) &&
          gamingRecovery &&
          !recoveryToastHidden && (
          <div className="gaming-toast gaming-toast-recovery" role="alert">
            <button
              type="button"
              className="gaming-toast-dismiss"
              onClick={() => setRecoveryToastHidden(true)}
              aria-label={t("app.gamingToast.hideRecoveryAria")}
              title={t("app.gamingToast.hideRecoveryTitle")}
            >
              ×
            </button>
            {/* Protection-first framing (consumer-panel Q4, owner-directed exploration
                2026-07-11): the honest state is "recoverable, nothing at risk". */}
            <p className="gaming-toast-msg">
              <strong>{t("app.gamingToast.recoveryEmph")}</strong>{" "}
              {t("app.gamingToast.recoveryBody", { status: statusLabel(gamingRecovery.status, t) })}
            </p>
            <div className="gaming-toast-actions">
              <button
                className="btn-small btn-small-on"
                disabled={gamingRestoring || gamingResuming}
                onClick={resumeGaming}
              >
                {gamingResuming ? t("app.gamingToast.resuming") : t("app.gamingToast.resumeAction")}
              </button>
              <button
                className="btn-small"
                disabled={gamingRestoring || gamingResuming}
                onClick={() => recoverGaming(true)}
              >
                {gamingRestoring ? t("app.gamingToast.restoring") : t("app.gamingToast.restoreNow")}
              </button>
              <button
                className="btn-small"
                disabled={gamingRestoring || gamingResuming}
                onClick={() => {
                  // Ground: the Gaming pane lives in the Lab's Optimize station (there is no
                  // standalone Optimize tab to review on). The recovery is NOT cleared here —
                  // the toast keeps greeting until the pane's own card takes over on mount,
                  // so Review can never dead-end the restore (the old clear did exactly that
                  // when the pane stayed behind a closed disclosure). Routed through the
                  // hallway so Review opens the station the pane is IN, not the dock above it.
                  openFixesInLab();
                }}
              >
                {t("app.gamingToast.review")}
              </button>
            </div>
          </div>
        )}

        {/* Resume-success confirmation — the honest counterpart of the restored toast below:
            names the live session's measured change count (summarizeChanges of the contract
            the backend returned), never a bare "it worked". */}
        {showGlobalRestoredBanner(gamingResumed !== null, gamingRecovery !== null, gamingPaneMounted) &&
          gamingResumed && (
          <div className="gaming-toast gaming-toast-ready" role="status">
            <p className="gaming-toast-msg">
              <strong>{t("app.gamingToast.resumedHeadline")}</strong>{" "}
              {t("app.gamingToast.resumedBodyGround", { summary: gamingResumed, room: t("common.rail.lab") })}
            </p>
            <div className="gaming-toast-actions">
              <button className="btn-small" onClick={() => setGamingResumed(null)}>
                {t("app.gamingToast.done")}
              </button>
            </div>
          </div>
        )}

        {/* Restore-success confirmation — names exactly what came back (never a silent success).
            Defers to the Gaming pane's own confirmation card while one is mounted, same as the
            recovery toast above (self-review catch, round 2, 2026-07-08). */}
        {showGlobalRestoredBanner(gamingRestored !== null, gamingRecovery !== null, gamingPaneMounted) &&
          gamingRestored && (
          <div className="gaming-toast gaming-toast-ready" role="status">
            <p className="gaming-toast-msg">
              <strong>✓ {gamingRestored.headline}.</strong>{" "}
              {gamingRestored.labels.length > 0
                ? `${gamingRestored.detail} ${gamingRestored.labels.join(" · ")}.`
                : gamingRestored.detail}
            </p>
            <div className="gaming-toast-actions">
              <button className="btn-small" onClick={() => setGamingRestored(null)}>
                {t("app.gamingToast.done")}
              </button>
            </div>
          </div>
        )}
      </div>

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
          onClose={() => setShowSettings(false)}
        />
      ) : v2Shell ? (
        // V2 product shell (V2-2): one rail+topbar chrome; rooms re-skin one stage at a time.
        // Home is the first V2 room (V2-3 — hologram hero + stats + priorities on RoomShell);
        // the remaining rooms still render their classic elements until V2-4..V2-7.
        <ShellV2
          items={rail}
          activeId={activeHomeId}
          onNavigate={navHome}
          ledgerCount={changes.length}
          version={APP_VERSION}
          rig={hw ? [hw.cpu_brand, hw.gpus[0]?.name].filter(Boolean).join(" · ") : null}
          // Command-palette destinations. Each is the SAME single writer the rest of the app routes
          // through — openLabStation persists the station intent before the room mounts,
          // openLibrary is what every inline glossary term already uses — so the palette adds a
          // door without adding a second hallway (navigation never teleports).
          onOpenStation={(s) => openLabStation(s)}
          onOpenEntry={(id) => libraryApi.openLibrary(id)}
          onOpenSettings={() => setShowSettings(true)}
        >
          {/* The OptimizeV2 keepalive stood here until the generation prune (2026-08-06). There is no
              Optimize ROOM any more — the rail has no `fix` door and the Optimize station lives inside
              the Lab (LabGround → lab/OptimizeStation), so there was nothing left for it to keep warm.
              The keepalive idiom itself survives in src/design/KeepaliveRoom.tsx for the next room that
              proves it needs one; src/keepalive-idle-guard.test.ts still pins its contract. */}
          {activeTab === "Overview" && hw ? (
            <>
              {/* One-time "watch it work" trust loop (consumer-panel Phase 2): offered only while
                  the Trust Ledger is empty; runs the SAME audited apply→rollback IPC, consented by
                  a click, never automatic. Renders nothing on a rig with history. */}
              <TrustMoment
                recs={recs}
                changes={changes}
                isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                onChanged={refresh}
              />
            <HomeRoom
              hw={hw}
              readiness={readiness}
              priorities={priorities}
              sessions={sessions}
              changes={changes}
              onRunCheck={() => setShowFirstCheck(true)}
              onSeeInFix={openFixesInLab}
              fixRoomLabel={t("common.rail.lab")}
              // Console-only (compy_home_console): the Home dock's doors are the rail the app
              // actually shows (the shared `rail` above) minus Home itself, navigating through
              // the SAME navHome mapping the rail uses.
              onNavigate={(k) => navHome(k as HomeRailId)}
              // Console intake band only: the crash row lands ON the crash evidence, through the
              // same single writer every other station deep-link uses.
              onOpenLabStation={(s) => openLabStation(s as LabStationKey)}
              rooms={rail
                .filter((r) => r.id !== "home")
                .map((r) => ({
                  key: r.id,
                  // r.label is HOME_RAIL's English literal (homeRail.ts is guard-pinned, out of
                  // scope) — re-derive the DISPLAY name from common.rail instead of using it
                  // directly, so this list localizes too.
                  name: t(`common.rail.${r.id}`),
                }))}
              // Console intake band only (compy_home_intake, BACKLOG:916): the one-tap fast path
              // derives its safe stack from the SAME recs + allowlist Optimize uses, and applies
              // through the SAME audited one-UAC batch primitive — no new mutation boundary.
              recs={recs}
              isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
              onApplyBatch={applyBatch}
            />
            </>
          ) : (
            <>
              {/* V2-5: the Monitor room on RoomShell — the room's ONE face since the generation
                  prune (the compy_monitor="0" fallthrough to the classic Play panels is gone).
                  Mounts per-visit; its pollers are demand-gated on the active tab. */}
              {activeTab === "Play" && hw && (
                <MonitorV2
                  active
                  sessions={sessions}
                  sessionsSeenAt={sessionsSeenAt}
                  priorities={priorities}
                  recs={recs ?? []}
                  apply={apply}
                  busyId={busyId}
                  onExport={onExport}
                  changes={changes}
                  rollback={rollback}
                  deepMonitoring={<MonitoringTab active embedded />}
                  vendor={detectedVendor}
                />
              )}
              {/* V2-6: the Blackbook room on RoomShell — Learn composes verbatim (its v2 prop
                  trims the standalone head + in-panel record; RoomShell's verdict is the ONE
                  summary). Mounts per-visit like the classic path; autopsy/mode continuity
                  lives in sessionStorage, same as classic. */}
              {activeTab === "Learn" && (
                <BlackbookV2
                  focusId={libraryFocusId}
                  vendor={detectedVendor}
                  onClose={() => setActiveTab("Overview")}
                  changes={changes}
                  sessions={sessions}
                  onOpenLab={() => setActiveTab("Lab")}
                />
              )}
              {/* The Lab room on RoomShell — the proving-ground merge, and the room's ONE face since
                  the generation prune (LabV2 and its bento/guided ancestors are deleted). Optimize's
                  fixes + the enable-all fast path live INSIDE the Lab here, on the same audited
                  apply/batch handlers (zero new IPC) alongside the Lab's own instruments.
                  hw-gated: the Ops Console's center hologram (RigViewer) needs the real hardware
                  read; hw is null only for the brief detection window before first refresh. */}
              {activeTab === "Lab" && hw && (
                <LabGround
                  hw={hw}
                  isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                  onOpenLibrary={(focusId) => libraryApi.openLibrary(focusId)}
                  onChanged={refresh}
                  vendor={detectedVendor}
                  sessions={sessions}
                  gpus={hw?.gpus ?? []}
                  recs={recs}
                  readiness={readiness}
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
                  gamingEnabled={gamingEnabled}
                  activeCount={activeChangeCount(changes)}
                  diagnostics={<DiagnosticsTab sections={diagnostics} />}
                  diagnosticsCaptured={diagnostics.length > 0}
                />
              )}
            </>
          )}
        </ShellV2>
      ) : (
        // hw still null — detection in flight (or slow WMI). A calm placeholder, never a blank window.
        // If the read actually FAILED (error set), don't spin forever — say so and offer a retry.
        <div className="app-booting" role="status" aria-live="polite">
          <Wordmark size={30} />
          {error ? (
            <>
              <p className="app-booting-line">{t("app.booting.readFailed")}</p>
              <button className="btn btn-primary app-booting-retry" onClick={() => void refresh()}>
                {t("app.booting.retry")}
              </button>
            </>
          ) : (
            <p className="app-booting-line">{t("app.booting.reading")}</p>
          )}
        </div>
      )}

    </main>
    </LibraryContext.Provider>
  );
}


// ─── Tabs ────────────────────────────────────────────────────────────────

// Monitoring poll cadence and rolling-window size. 1 Hz is plenty granular
// for "is my GPU thermal-throttling" / "is my game CPU-bound" trends; faster
// rates burn battery and HMR-spam the renderer without insight. The 60-sample
// window means each chart shows the last minute — long enough to spot a
// thermal trend, short enough to react to a moment-ago spike.
const MONITORING_POLL_MS = 1000;
const MONITORING_WINDOW = 60;

function MonitoringTab({ active, embedded = false }: { active: boolean; embedded?: boolean }) {
  const { t } = useTranslation();
  // Summary-first domain cards (T3, default ON; classic panel stack is the failsafe). Live-synced
  // so flipping the Settings toggle re-lays this tab without a reload (same pattern as useHudFlag).
  const [cards, setCards] = useState(readMonitorCards);
  useEffect(() => {
    const sync = () => setCards(readMonitorCards());
    window.addEventListener("compy:monitor-cards-changed", sync);
    return () => window.removeEventListener("compy:monitor-cards-changed", sync);
  }, []);
  const reduced = useReducedMotion();
  const visible = useDocumentVisible();
  const [gpuSamples, setGpuSamples] = useState<GpuSensorSnapshot[][]>([]);
  const [cpuSamples, setCpuSamples] = useState<CpuSensorSnapshot[]>([]);
  const [hasGpu, setHasGpu] = useState<boolean | null>(null);
  const [fps, setFps] = useState<FpsStatus | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);
  const [cpuTemp, setCpuTemp] = useState<CpuTemp | null>(null);
  const [mem, setMem] = useState<MemoryPressure | null>(null);
  const [overlayCorner, setOverlayCorner] = useState<string>(
    () => lsGet("compy_overlay_corner") ?? "top-left",
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
    lsSet("compy_overlay_corner", corner);
    try {
      await invoke("set_overlay_corner", { corner });
    } catch {
      /* overlay may be hidden — the choice applies next time it's shown */
    }
  };

  // Poll only while the tab is active AND the window is on screen. When the user switches away we
  // drop the interval so we don't burn cycles on charts that aren't visible — and "not visible"
  // includes minimized/alt-tabbed-into-a-game, which the active flag alone can't see. This is the
  // app's heaviest poll (five IPC calls a second, one of them the vendor GPU SDK). The sample
  // buffer is preserved in state so coming back doesn't lose history.
  useEffect(() => {
    if (!active || !visible) return;
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
  }, [active, visible]);

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
        <h2 className="section-title">{t("app.monitoring.title")}</h2>
        <div className="section-header-actions">
          <button
            className={`btn-small ${overlayOn ? "btn-small-on" : ""}`}
            onClick={toggleOverlay}
            title={t("app.monitoring.overlayToggleTitle")}
          >
            {overlayOn ? t("app.monitoring.hideOverlay") : t("app.monitoring.showOverlay")}
          </button>
          {overlayOn && (
            <div style={{ display: "flex", gap: 4 }} title={t("app.monitoring.moveOverlayTitle")}>
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
                  title={t(`app.monitoring.corners.${corner}`)}
                  aria-label={t("app.monitoring.moveOverlayAria", { corner: t(`app.monitoring.corners.${corner}`) })}
                  aria-pressed={overlayCorner === corner}
                >
                  {glyph}
                </button>
              ))}
            </div>
          )}
          <div className="read-only-pill">
            {!haveAnything
              ? t("app.monitoring.starting")
              : t("app.monitoring.historyDuration", { seconds: cpuSamples.length })}
          </div>
        </div>
      </div>
      <p className="section-help">
        {t("app.monitoring.helpPre")}
        <Term id="frametime">{t("app.monitoring.frametimeTerm")}</Term>
        {t("app.monitoring.helpMid1")}
        <Term id="etw">{t("app.monitoring.etwTerm")}</Term>
        {t("app.monitoring.helpMid2")}
        <Term id="kernel-driver">{t("app.monitoring.kernelDriverTerm")}</Term>
        {t("app.monitoring.helpPost")}
      </p>
      </>
      )}

      {/* vendor-honesty: always rendered (LOCKED rule #5) — this line was silently unreachable for
          weeks because it lived inside the !embedded header above while every live call site embeds
          (self-review catch, 2026-07-07). Do not move it back under a mode gate; pinned by
          vendor-honesty-line-guard.test.ts. */}
      <p className="section-help">
        <span className="coverage-note">
          GPU sensor coverage: <strong>AMD — verified</strong> · NVIDIA —
          implemented, not yet hardware-verified · Intel — planned.
        </span>
      </p>

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

      {/* Domain panels. Cards ON (default): summary-first instrument cards — headline + gauge +
          spark per domain, the FULL classic panel one click away (T3). Cards OFF: the classic
          full-width panel stack, byte-identical (failsafe). */}
      {cards ? (
        <MonitorDomainCards
          cpuSamples={cpuSamples}
          gpuSamples={gpuSamples}
          cpuTemp={cpuTemp}
          mem={mem}
          reduced={reduced}
        />
      ) : (
        <>
          {/* CPU panel — vendor-agnostic, always shows */}
          {latestCpu && (
            <CpuMonitorPanel
              cpu={latestCpu}
              history={cpuSamples}
              cpuTemp={cpuTemp}
            />
          )}

          {/* GPU panels — one per detected adapter */}
          {latestGpu.map((gpu) => (
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
          ))}
        </>
      )}

      {/* GPU sensors missing — same honest explanation in both layouts. */}
      {hasGpu === false && (
        <div className="empty">
          {t("app.monitoring.gpuSensorsUnavailable")}
        </div>
      )}

      {!haveAnything && (
        <div className="empty">{t("app.monitoring.collectingFirstSample")}</div>
      )}
    </section>
  );
}

function DiagnosticsTab({ sections }: { sections: DiagnosticSection[] }) {
  const { t } = useTranslation();
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">{t("app.diagnostics.title")}</h2>
      </div>
      <p className="section-help">
        {t("app.diagnostics.help")}
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

export default App;
