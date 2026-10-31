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
import FirstCheck, { FIRST_CHECK_KEY } from "./surfaces/FirstCheck";
import { SetupTour, ONBOARDED_KEY } from "./surfaces/setup/SetupTour";
import { LibraryContext } from "./surfaces/library-context";
import { Wordmark } from "./design/Wordmark";
import { readCloseToTray, persistDisplayRefreshHz } from "./design/theme";
import { ShellV2 } from "./design/ShellV2";
import { GamesRoom } from "./surfaces/glass/GamesRoom";
import { ProblemsRoom } from "./surfaces/glass/ProblemsRoom";
import { HomeGlass } from "./surfaces/glass/HomeGlass";
import { fmtGB } from "./surfaces/hardware-format";
import { railFor, type HomeRailId } from "./design/homeRail";
import { HomeRoom } from "./surfaces/HomeRoom";
import { markInterviewArrival, INTERVIEW_ARRIVAL_EVENT } from "./surfaces/home-arrival";
import { useHomeConsoleFlag, useHomeInterviewFlag } from "./design/use-hud";
import { TrustMoment } from "./surfaces/TrustMoment";
import { FirstWin } from "./surfaces/FirstWin";
import { MonitorV2 } from "./surfaces/MonitorV2";
import { BlackbookV2 } from "./surfaces/BlackbookV2";
import { LabGround } from "./surfaces/LabGround";
// Learn is NOT a room any more (Blackbook renders BlackbookV2) — this import survives the generation
// prune solely for the knowledge-library MODAL, which any surface can raise via LibraryContext.
import Learn from "./surfaces/Learn";
import { prewarmScan } from "./surfaces/use-scan";
import { inEffectCounts, useMachineModel } from "./data/machine-model";
import { gpuVendor } from "./surfaces/walkthroughs";
import type { BatchApplyReport, ExportResult, PendingCareIncident } from "./types";
import { bumpLocalStat, readLocalStats, statsLine } from "./data/local-stats";
import { lsGet } from "./data/safe-storage";
import { invalidateProbe } from "./data/probe-cache";
import { setStartupEntryEnabled } from "./data/startup-toggle";
import { writeLedger } from "./data/ledger-write";
import { isUnrecordedUndo } from "./data/rollback-error";
import type { LabStationKey } from "./surfaces/lab-guided-data";
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
// TYPE-1: the six-step type scale tokens load before every stylesheet that consumes them.
import "./design/type-scale.css";
import "./App.css";
import "./design/doorknob.css";
import { KonamiWhisper } from "./design/KonamiWhisper";
import { useConfirm } from "./design/ConfirmDialog";
import "./design/instrument.css"; // Instrument token layer — after App.css so the accent re-point wins
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
/* The Instrument-HUD ROOM skin. It used to ride into the bundle on `surfaces/hud-masthead.tsx`,
   which was the only module that imported it; that component died in issue #49 slice 6 when Test —
   its last mounting room — took the approved four-room header, and the stylesheet would have died
   with it. It must not: it is far more than the masthead it was filed under. It skins every room
   except Home and Check (panel ground, scanline, verdict type, the mono `.v2-measured` readouts,
   and the whole Fix/Lab instrument chip set). It lives with the other two HUD stylesheets now,
   where losing its owner cannot silently take it out of the build. */
import "./surfaces/hud-rooms.css"; // Instrument-HUD room skin — scoped [data-v2][data-hud], DEFAULT ON

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
// Glass redesign (owner decision 2026-10-30): Games and Problems are the two flagship journeys'
// own doors (MAKE THIS PC BETTER / FIGURE OUT WHAT WENT WRONG).
type Tab = "Overview" | "Games" | "Problems" | "Play" | "Learn" | "Lab";

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
  /** null = not recorded: Compy couldn't read its change history when the session began (#669), or couldn't confirm any of its changes (453-f1). */
  compy_changes_active: number | null;
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

// SHIP-PROOF SEAM (2026-08-18). scripts/lib/runtime-proof.ps1 cross-checks the version the MOUNTED
// FRONTEND was built with against the backend build stamp — that pairing is the only thing that
// catches a stale bundle shipped beside a fresh binary. It used to read the number off the rail;
// navigation audit s4 moved build identifiers into Settings > About, so the DOM can no longer
// answer on an arbitrary room and the check died with the ship script (caught live 2026-08-18).
// The bundle now publishes the value it was compiled with instead. Not rendered, not user-visible,
// read only by the ship proof. Pinned by scripts/version-drift-guard.test.mjs Guard E.
(globalThis as { __COMPY_UI_VERSION__?: string }).__COMPY_UI_VERSION__ = APP_VERSION;

function App() {
  const { t } = useTranslation();
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  // Shared Machine Model (#452): the Lab verdict's "N safe changes are active" count is the model's
  // `active_now`, never a filter over the bare ledger list. `changes` is refresh()'s product, so a
  // new list re-reads the model alongside it (cached across surfaces, shared while in flight).
  // Not yet read or unreadable → 0: the verdict then says "nothing needs applying", a statement
  // about the rec list, never "N changes are active" off a count the model could not give.
  const model = useMachineModel(changes);
  const inEffect = inEffectCounts(model);
  const labActiveCount = inEffect.kind === "counted" ? inEffect.activeNow : 0;
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
  // P7-palette: only the Home console reads an interview arrival, and only with the interview on.
  // Either off → the palette offers no plain-problem rows (no dead doors, and no key left waiting
  // for a reader that will never mount).
  const homeConsoleOn = useHomeConsoleFlag();
  const homeInterviewOn = useHomeInterviewFlag();
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
  // The tour (HoloLens) is an OFFER, never the front door. The legacy Onboarding auto-modal is
  // retired; FirstCheck stays reachable on demand via the explicit "Re-run check" (Home / Settings),
  // never as an auto-modal.
  const [showFirstCheck, setShowFirstCheck] = useState(false);
  // C-05 (docs/decisions/2026-08-11-design-navigation-audit.md §4) — THE TOUR STOPS BEING THE FRONT
  // DOOR. It used to auto-open on a truly fresh install, so the first thing someone whose PC had
  // just crashed met was a ten-step hardware lecture: Compy's own identity is "the first place you
  // go after a crash", and the diagnosis was behind the lecture. It now opens ONLY on an explicit
  // choice — the Home tour card (compy:start-tour) or Settings — and a fresh install lands straight
  // on Home's verdict. The keys are still WRITTEN on finish (SetupTour/handleSetupTourDone) so the
  // "have they seen it" signal survives; nothing READS them to force the modal any more.
  // Pinned by src/first-run-front-door-guard.test.ts — an auto-open regression fails the build.
  const [showSetupTour, setShowSetupTour] = useState(false);
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
      // A toggle is a ledger change (#599): the helper announces it and waits for the re-read, as
      // apply/rollback do. The row flips first so the switch moves before the slower probes land.
      await setStartupEntryEnabled(entry.name, !entry.enabled, () => {
        setStartup((prev) =>
          prev.map((e) => (e.name === entry.name ? { ...e, enabled: !e.enabled } : e))
        );
        return refresh();
      });
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
      // writeLedger announces the ledger change before the refresh, so sibling surfaces that cache
      // ledger-derived state (e.g. the armed ExperimentBench simulator read) re-derive without
      // waiting for an OS refocus. Additive, read-only signal; no new mutation path.
      await writeLedger<AppliedChange>(
        "apply_recommendation",
        { recId: rec.id, recTitle: rec.title },
        refresh,
      );
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
      // Only a batch that applied anything changed the ledger, so only that one is announced (see
      // apply()'s note). A batch-level refusal rejects (nothing applied) and is handled in catch, so
      // no false signal. The refresh stays in finally: it runs for a refusal too.
      const report = await writeLedger<BatchApplyReport>(
        "apply_recommendations_batch",
        { items },
        undefined,
        (r) => r.applied > 0,
      );
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
      // Rolling back changes the ledger too — a rec can become available again, so siblings re-derive.
      await writeLedger("rollback_change", { changeId: change.id }, refresh);
    } catch (e) {
      fail(isUnrecordedUndo(e) ? t("common.undoUnrecorded") : t("app.errors.rollbackFailed"), e);
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
    // Games and Problems (glass redesign) need nothing but the session list and Windows' own records,
    // which every rig has, so they are always visible.
    const list: Tab[] = ["Overview", "Games", "Problems", "Learn"];
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
    setActiveTab(
      id === "home"
        ? "Overview"
        : id === "games"
          ? "Games"
          : id === "problems"
            ? "Problems"
            : id === "play"
              ? "Play"
              : id === "learn"
                ? "Learn"
                : "Lab",
    );
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
  //
  // Extended 2026-08-25 (Care observer, Tier 1 task 9): the optional exact-incident selector. It
  // rides a SEPARATE one-shot key rather than being encoded into the station string, because the
  // two facts have different lifetimes and different failure modes — a station the destination
  // cannot render is dropped and the user lands on the dock, while an incident the destination
  // cannot find must still open the station. Encoding them together makes one unparseable value
  // able to lose both. `home-intake-data.ts` deliberately deferred this parameter until something
  // could fill it; `incident_observer.rs` is that something.
  const openLabStation = (station: LabStationKey, incidentId?: string) => {
    // Crash & Freeze Rescue has its own door now (glass redesign): every hallway that led to the
    // "blackbox" station lands on Problems instead, carrying the exact incident when there is one.
    if (station === "blackbox") {
      setProblemsFocus(incidentId ?? null);
      navHome("problems");
      return;
    }
    try {
      localStorage.setItem("compy_lab_open_station", station);
      if (incidentId) localStorage.setItem("compy_lab_open_incident", incidentId);
    } catch {
      /* non-fatal — the user still lands in the Lab, just on the dock */
    }
    navHome("lab");
  };
  const openFixesInLab = () => openLabStation("optimize");

  // ── The Care observer's Home card (Tier 1 task 9, #222) ───────────────────────────────────────
  // The backend decides what is pending; this only reads it. Read whenever the user is on Home,
  // because the observer's own scans run on their own triggers (launch, window foreground, session
  // end) and a card can appear while the user is in another room.
  //
  // ONE effect, not two. A separate mount-only read was redundant: `activeTab` starts at
  // "Overview", so both fired back to back on every cold start, and on a boot that restores some
  // other tab the mount read fetched a card Home was not rendering anyway. (#222 IPC audit.)
  const [pendingCare, setPendingCare] = useState<PendingCareIncident | null>(null);
  // The exact incident a hallway asked Problems to open (one-time delivery, cleared on leaving).
  const [problemsFocus, setProblemsFocus] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== "Problems") setProblemsFocus(null);
  }, [activeTab]);
  // Health's two views (glass redesign) and the game a Health card asked Games to open.
  const [homeView, setHomeView] = useState<"summary" | "details">("summary");
  const [gamesFocus, setGamesFocus] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== "Overview") setHomeView("summary");
    if (activeTab !== "Games") setGamesFocus(null);
  }, [activeTab]);
  // A problem typed into the palette lands on the console's interview card, so it opens the
  // console view; HomeConsole then reads and clears the arrival exactly as before.
  useEffect(() => {
    const open = () => setHomeView("details");
    window.addEventListener(INTERVIEW_ARRIVAL_EVENT, open);
    return () => window.removeEventListener(INTERVIEW_ARRIVAL_EVENT, open);
  }, []);
  const refreshPendingCare = useCallback(() => {
    invoke<PendingCareIncident | null>("get_pending_care_incident")
      .then((c) => setPendingCare(c ?? null))
      .catch(() => setPendingCare(null));
  }, []);
  // Read on every room change, not only on Health: the Problems door's badge shows the same pending
  // incident wherever the user is (glass redesign). One cheap read per navigation.
  useEffect(() => {
    refreshPendingCare();
  }, [activeTab, refreshPendingCare]);
  // "Find out why" — mark it opened, then route to the EXACT incident. The card is cleared
  // optimistically: the user is on their way to the evidence, so leaving it behind them would be
  // an unacknowledged notice for something they just acknowledged.
  const openCareIncident = (incidentId: string) => {
    setPendingCare(null);
    invoke("mark_care_incident_opened", { incidentId }).catch(() => {
      /* non-fatal — the card reappears on the next read, which is the safe direction */
    });
    openLabStation("blackbox", incidentId);
  };
  // "Not now" — clears Compy's POINTER only. Every Windows record behind it (Event Log entry, WER
  // report, reliability row) is untouched and still readable from Crash & Freeze Rescue.
  const dismissCareIncident = (incidentId: string) => {
    setPendingCare(null);
    invoke("dismiss_care_incident", { incidentId }).catch(() => {});
  };
  const HOME_FOR_TAB: Partial<Record<Tab, HomeRailId>> = {
    Overview: "home",
    Games: "games",
    Problems: "problems",
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
  // of HOME_RAIL and leaves Health · Live · History · Test. Both args are now constants (the flags
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
          badges={{ problems: pendingCare ? 1 : 0 }}
          rig={hw ? [hw.cpu_brand, hw.gpus[0]?.name].filter(Boolean).join(" · ") : null}
          // Command-palette destinations. Each is the SAME single writer the rest of the app routes
          // through — openLabStation persists the station intent before the room mounts,
          // openLibrary is what every inline glossary term already uses — so the palette adds a
          // door without adding a second hallway (navigation never teleports).
          onOpenStation={(s) => openLabStation(s)}
          onOpenEntry={(id) => libraryApi.openLibrary(id)}
          onOpenSettings={() => setShowSettings(true)}
          // P7-palette: a typed problem lands on the interview's card for it — the arrival is
          // written BEFORE Home is navigated to (the same order every station deep-link keeps), and
          // the Home console reads it once, on mount or on the arrival event when it is already up.
          // Offered only while that reader exists (console + interview on).
          onOpenIntent={
            homeConsoleOn && homeInterviewOn
              ? (finding) => {
                  markInterviewArrival(finding);
                  navHome("home");
                }
              : undefined
          }
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
            {/* GLASS REDESIGN (owner decision 2026-10-30): Health opens on the summary page; the
                console with every panel the room had is "Open the full health check", and a typed
                problem from the palette (interview arrival) opens it directly. */}
            {homeView === "summary" ? (
              <HomeGlass
                readiness={readiness}
                priorities={priorities}
                sessions={sessions}
                pendingCare={pendingCare}
                onOpenCareIncident={openCareIncident}
                onDismissCareIncident={dismissCareIncident}
                onOpenGame={(key) => {
                  setGamesFocus(key);
                  navHome("games");
                }}
                onOpenProblems={() => navHome("problems")}
                onOpenLive={() => navHome("play")}
                onRunCheck={() => setShowFirstCheck(true)}
                onSeeChecks={openFixesInLab}
                onOpenDetails={() => setHomeView("details")}
                latestChange={<FirstWin changes={changes} onChanged={refresh} />}
              />
            ) : (
              <>
                <div className="gl-back-row">
                  <button type="button" className="gl-back" onClick={() => setHomeView("summary")}>
                    {t("home.glass.back")}
                  </button>
                </div>
                <HomeRoom
                  hw={hw}
                  /* THE LATEST-CHANGE FOLLOW-THROUGH, NOW SUBORDINATE (#225 finding 1). FirstWin is
                     the other half of the first-win journey (P2 / issue #49): TrustMoment rehearses
                     apply→receipt→rollback on a demo setting while the ledger is EMPTY, FirstWin
                     follows through on the user's own first live change. The two gate on exact
                     complements (`changes.length === 0` vs at least one still-active entry), so they
                     can never both be on screen.

                     It used to render as a sibling ABOVE <HomeRoom>, which put a 147px bordered
                     banner — carrying its own accented button — at the top of the room and pushed the
                     eyebrow from the comp's y127 to y269. Measured: every element below it moved 142px
                     down, and at 1280x720 that alone cropped the rig before its readout strip. The
                     approved comp draws nothing in that position.

                     So it moves into RoomShell's `below` slot, whose contract is exactly this case:
                     full-width content beneath both columns, where a split room keeps what is real but
                     below the fold — content moves down, it is never deleted to make a comp fit. Every
                     handler, phase, verdict, aria-live region and localisation key is untouched; only
                     the mount point moves. Passed as a NODE rather than as data so App keeps owning
                     `changes`/`refresh` and HomeRoom stays presentation-only. */
                  latestChange={<FirstWin changes={changes} onChanged={refresh} />}
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
                  onOpenLabStation={(s, incidentId) => openLabStation(s as LabStationKey, incidentId)}
                  pendingCare={pendingCare}
                  onOpenCareIncident={openCareIncident}
                  onDismissCareIncident={dismissCareIncident}
                  rooms={rail
                    .filter((r) => r.id !== "home")
                    .map((r) => ({
                      key: r.id,
                      // r.label is HOME_RAIL's English literal (homeRail.ts is guard-pinned, out of
                      // scope) — re-derive the DISPLAY name from common.rail instead of using it
                      // directly, so this list localizes too.
                      name: t(`common.rail.${r.id}`),
                    }))}
                  // The interview's one-tap fast path only (issue #177, was the intake band's option C):
                  // derives its safe stack from the SAME recs + allowlist Optimize uses, and applies
                  // through the SAME audited one-UAC batch primitive — no new mutation boundary.
                  recs={recs}
                  isAppliable={(recId) => APPLIABLE_REC_IDS.has(recId)}
                  onApplyBatch={applyBatch}
                />
              </>
            )}
            </>
          ) : (
            <>
              {/* V2-5: the Monitor room on RoomShell — the room's ONE face since the generation
                  prune (the compy_monitor="0" fallthrough to the classic Play panels is gone).
                  Mounts per-visit; its pollers are demand-gated on the active tab. */}
              {activeTab === "Games" && (
                <GamesRoom
                  sessions={sessions}
                  focusKey={gamesFocus}
                  onOpenLive={() => navHome("play")}
                  onOpenTest={() => navHome("lab")}
                />
              )}
              {activeTab === "Problems" && (
                <ProblemsRoom
                  changes={changes}
                  onChanged={refresh}
                  ledgerBusy={busyId !== null}
                  onLedgerBusy={(b) => setBusyId(b ? "care-restore" : null)}
                  focusIncidentId={problemsFocus}
                  pendingIncidentId={pendingCare?.incident_id ?? null}
                />
              )}
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
                  onLedgerBusy={(b) => setBusyId(b ? "care-restore" : null)}
                  gamingEnabled={gamingEnabled}
                  activeCount={labActiveCount}
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
