export type StartupEntry = {
  name: string;
  command: string;
  enabled: boolean;
};

// Read-only local evidence bundle from the `export_report` command. Mirrors the Rust ExportResult
// (src-tauri/src/export.rs). `path`/`json_path` are on-disk files; `markdown` is the full report,
// `discord` the compact share-card summary. Fully local — assembling it sends nothing.
export type ExportResult = {
  path: string;
  json_path: string;
  markdown: string;
  discord: string;
};

// Evidence-export tiers (P2): audience-shaped renders of the same local bundle. Passed to
// `export_report` as `tier`; omitting it means "technical" (the full report, the pre-tier
// behaviour). The Support projection is its own surface (SupportEvidence), not a tier here.
export type ReportTier = "consumer" | "technical";

// Q5 support evidence — mirrors src-tauri/src/support_evidence.rs. Those structs carry no
// `rename_all`, so the wire fields are snake_case; only the two enums are renamed, and their
// variants are lowercase words. The record is local-only: Compy has no way to upload it.
export type SupportEventKind = "lifecycle" | "ledger" | "helper" | "operation";
export type SupportOutcome = "ok" | "failed" | "refused";
export type SupportProjection = "consumer" | "technical" | "support";

export type SupportEvent = {
  at: string;
  kind: SupportEventKind;
  operation: string;
  code: string;
  outcome: SupportOutcome;
  detail: string;
};

// The caps the on-disk log is trimmed to. Rendered from the bundle rather than hard-coded in the
// UI so the numbers can never drift from the ones the backend actually enforces.
export type EvidenceRetention = {
  max_events: number;
  max_bytes: number;
  max_record_bytes: number;
};

export type EvidenceBundle = {
  app_version: string;
  build_stamp: string;
  generated_at: string;
  retention: EvidenceRetention;
  location: string;
  events: SupportEvent[];
  unreadable_records: number;
};

// `preview_support_evidence` returns all three projections of the SAME bundle at once — no
// projection can show something another one hides, and switching between them costs no round-trip.
export type EvidencePreview = {
  bundle: EvidenceBundle;
  consumer: string;
  technical: string;
  support: string;
};

export type SupportExport = {
  path: string;
  json_path: string;
  projection: string;
  events: number;
};

export type ReadinessStatus = "ready" | "attention" | "unknown" | "advisory";
export type PriorityStatus = "ready" | "attention" | "unknown";
export type Confidence = "high" | "medium" | "low";

// A5 rig tagging — the compact rig identity (same shape sessions carry). Local-only.
export type HwFingerprint = {
  hash: string;
  gpu: string;
  gpu_driver: string;
  ram_gb: number;
  display: string;
};

// Fired on `window` whenever the local Trust Ledger changes in-app — an apply, batch apply, rollback,
// or an experiment conclude/restore. Additive, frontend-only, no mutation path: sibling surfaces that
// cache ledger-derived state (e.g. the ExperimentBench simulator read) listen and re-derive, so a
// same-window apply in one surface never leaves another showing a stale "still available" card. OS
// refocus (focus/visibilitychange) covers cross-window applies; this covers same-window ones.
export const LEDGER_CHANGED_EVENT = "compy:ledger-changed";

/** history.rs `ChangedOutside` as the ledger stores it. Only schema 1 with a power-plan reading is
 *  one this build understands ({@link usableChangedOutside}); anything else reads as no record. */
export type ChangedOutsideRecord = {
  schema: number;
  recorded_at: string;
  observed: { kind: string; guid?: string; name?: string };
};

/** The record when this build can act on it (history.rs `ChangedOutside::usable`), else null. */
export function usableChangedOutside(
  c: { changed_outside?: ChangedOutsideRecord | null },
): (ChangedOutsideRecord & { observed: { kind: "power-plan"; name: string } }) | null {
  const r = c.changed_outside;
  if (!r || r.schema !== 1 || r.observed?.kind !== "power-plan" || typeof r.observed.name !== "string") return null;
  return r as ChangedOutsideRecord & { observed: { kind: "power-plan"; name: string } };
}

/** CR-outside-followups (b): the record, when this row is one Game Readiness counts as kept outside
 *  Compy (readiness.rs `with_kept_outside`): applied, reading off, a usable record, and the live read
 *  still showing the recorded state (`changed_outside_holds`, from the same pass). Else null, and
 *  the row reads as before (a plan switched back to Compy's, or on to a third one, is not kept). */
export function keptOutsideCompy(c: {
  status: string;
  is_still_active: boolean;
  changed_outside?: ChangedOutsideRecord | null;
  changed_outside_holds?: boolean | null;
}): ReturnType<typeof usableChangedOutside> {
  if (c.status !== "applied" || c.is_still_active || c.changed_outside_holds !== true) return null;
  return usableChangedOutside(c);
}

export type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
  // What the live re-check established (#392). `is_still_active` stays true for "unreadable" and
  // "unrecognised" so a rollback is never hidden; only "off" is a read that came back not in effect.
  // null when the row is not applied, so nothing was checked.
  active_check?: "on" | "off" | "unreadable" | "unrecognised" | null;
  // Stamped when a change is rolled back (Intelligence Phase 2 — dates the rollback event in the
  // timeline). Additive, #[serde(default)] on the Rust side; absent/null for entries never undone.
  rolled_back_at?: string | null;
  applied_action?: Record<string, unknown> | null;
  rollback_action?: Record<string, unknown> | null;
  app_version_at_apply?: string | null;
  ruleset_version_at_apply?: string | null;
  elevation_used?: boolean | null;
  // Read-only, computed-at-read: what a rollback restores ("Running"/"On"/"Best performance"/…),
  // derived from the captured typed snapshot. null when no clean label → UI shows a generic prior.
  restores_label?: string | null;
  // The "after" half of the before/after pair: the state Compy's change set things TO, derived from
  // the typed applied_action. null for legacy entries with no captured action → UI shows just prior.
  applied_label?: string | null;
  // A5 measured-payoff linkage — the honest per-tweak payoff meter: the KIND of gain a change targets
  // ("Input latency", "Background CPU & RAM", …), NEVER a fabricated FPS/latency number. Derived from
  // the typed applied_action. null for legacy entries + restore-to-stock leftovers → UI shows no meter.
  payoff_label?: string | null;
  // A5 rig tagging: the hardware this change was applied ON, stamped at apply time. null/absent for
  // entries recorded before rig tagging existed.
  hw_fingerprint?: HwFingerprint | null;
  // Read-only, computed-at-read: stamped rig == today's rig, compared on stable identity fields only
  // (gpu · ram · display — deliberately driver-insensitive). null = legacy entry, honest "rig unknown".
  on_this_rig?: boolean | null;
  // CR-outside-followups (b): history.rs `ChangedOutside`, the user's "changed outside Compy" record
  // (ledger-only; nothing on Windows changed when it was written). Absent on every other row.
  changed_outside?: ChangedOutsideRecord | null;
  // Computed at read: whether the live read still shows the recorded state. Absent = not known.
  changed_outside_holds?: boolean | null;
  // P5-outcomes-f1: the Trial behind an apply or undo made from the Trial bench's outcome switch.
  // Additive, #[serde(default)] on the Rust side; absent/null for every other apply and undo.
  justified_by_experiment?: TrialLink | null;
  rollback_justified_by_experiment?: TrialLink | null;
  // CR-footer-reversible: history.rs computes at read whether the row's stored history resolves to
  // an undo (the resolution the undo itself runs first). false = its undo would fail before
  // anything runs. Absent = an older payload that didn't say.
  undo_contract?: boolean;
};

/** Which Trial an outcome-switch apply or undo was based on, copied into the Trust Ledger row. */
export type TrialLink = {
  experiment_id: string;
  /** experiment.rs `trial_link_in`. The bench only switches between Recommended and Maximum FPS, but
   *  the backend names a Smoothest Trial too, so the ledger reads it rather than mislabel it. */
  outcome: "recommended" | "max-fps" | "smoothest";
  concluded_at?: string | null;
};

/** Whether the AppliedChange[] above is the whole story — `get_ledger_health`.
 *
 *  A ledger Compy cannot read degrades to an empty list, and an empty list renders as "nothing is
 *  active on this PC", which is an affirmative claim about the machine made at the exact moment
 *  every apply and every rollback is refusing. This is what lets the surface say "Compy can't tell
 *  you what it did" instead. snake_case: the IPC boundary is not renamed. */
export type LedgerHealth = {
  /** False → the list is not evidence of anything, least of all of a quiet machine. */
  complete: boolean;
  /** The load failure verbatim, already user-readable. `null` while the loss is purely historical
   *  — a quarantined ledger loads clean-and-empty forever after, so `complete: false` with no
   *  error is the durable shape, not a contradiction. */
  error: string | null;
  /** `history.json.corrupt` sits beside the ledger: set aside unopened, not deleted. */
  quarantined: boolean;
};

export type ReadinessCheck = { id: string; label: string; status: ReadinessStatus; detail: string; value: string | null; action_uri?: string | null; action_label?: string | null };
// unreadable_now: the drifted check now reads unknown; the notice stays, said as last seen changed
// (drift.rs `Drift`, always sent).
export type Drift = { id: string; label: string; detail: string; noticed_at: string; unreadable_now?: boolean };
export type GameReadiness = { checks: ReadinessCheck[]; ready_count: number; attention_count: number; unknown_count: number; advisory_count: number; advisory: string; dismissed_ids: string[]; drifts: Drift[] };

export type PriorityItem = { id: string; title: string; reason: string; linked: string | null; confidence: Confidence; status: PriorityStatus };
// R3 Lane B: advisory upgrade path — present only when a verdict names hardware as the limiter.
// Links are plain retailer searches (no affiliate tags); in-app they are COPY-only, never opened.
export type RetailLink = { retailer: string; url: string };
/** P9-limit-source: the recorded session a GPU-limited row was read from (priorities.rs). */
export type MeasuredFrom = {
  game: string;
  started_at: string;
  busy: number;
  readings: number;
  threshold_pct: number;
  /** P9-screen-is-limit: that session's measured average FPS and recorded refresh; absent = unmeasured. */
  avg_fps?: number;
  refresh_hz?: number;
};
export type UpgradeSuggestion = {
  kind: string;
  title: string;
  why: string;
  links: RetailLink[];
  /** Absent when the row isn't from a session, or the session didn't record its game or start. */
  measured_from?: MeasuredFrom;
};
export type UpgradePath = { items: UpgradeSuggestion[]; disclosure: string };
export type Priorities = {
  limiters: PriorityItem[];
  already_fine: PriorityItem[];
  not_worth_touching: PriorityItem[];
  session_hint: string | null;
  upgrade_path: UpgradePath | null;
  /** P9-summary-gpu-limit: per game (`process_name`), its newest measured session, only when that
   *  session was GPU-limited by the sustained rule (priorities.rs). Absent from an older backend. */
  gpu_limited_games?: GameGpuLimit[];
  /** P9-no-upgrade-source: per game, its newest measured session when it recorded enough GPU
   *  readings and was not GPU-limited. A game in neither list was not measured. */
  gpu_clear_games?: GameGpuClear[];
};

export type GameGpuClear = { game: string; busy: number; readings: number; threshold_pct: number };

export type GameGpuLimit = {
  game: string;
  share_pct: number;
  peak_pct: number;
  threshold_pct: number;
  /** P9-summary-screen-limit: that session's average FPS and recorded refresh; absent = unmeasured. */
  avg_fps?: number;
  refresh_hz?: number;
};

export type SessionSummary = {
  started_at: string;
  duration_secs: number;
  process_name: string;
  samples: number;
  avg_fps: number;
  avg_frametime_ms: number;
  low1_fps_est: number;
  peak_gpu_temp_c: number | null;
  peak_gpu_usage_pct: number | null;
  /** P9-bottleneck-sustained: GPU-usage readings seen and how many sat at or above 95% (sessions.rs
   *  GpuLoad). Absent on rows an older Compy wrote: a peak alone is a moment, never "the limiter". */
  gpu_load?: { readings: number; busy: number } | null;
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
  /** Per-second (elapsed_secs, 1%-low fps) pairs — serde tuples; kept for the most-recent 5
   *  sessions only, stripped (empty) for older ones (sessions.rs). */
  stutter_timeline?: [number, number][];
  /** Timestamped signals observed during the session (stutter.rs StutterEvent). */
  stutter_events?: { at_secs: number; kind: string; label: string }[];
  /** Downsampled real FPS trace: (bucket_start_elapsed_secs, mean fps) per 10 s bucket of real
   *  ~1 Hz samples — never interpolated; gaps in play stay gaps. Kept for the most-recent 20
   *  sessions, stripped (empty) for older ones (sessions.rs). */
  fps_series?: [number, number][];
  /** Whether a Gaming Mode session was live at ANY monitoring tick (Intelligence Phase 1).
   *  Absent/null on records written before the field existed — honestly Unknown, never guessed. */
  gaming_mode_active?: boolean | null;
  /** What the capture backend could actually measure for this session (Measurement Platform 2.0).
   *  Absent on sessions recorded before the field existed — honestly Unknown, NEVER assumed to be
   *  today's backend. A `supports_*` flag being false means the metric was never captured: render it
   *  as unavailable, never as a real 0. */
  capture_capabilities?: CaptureCapabilities | null;
  /** The conditions this session ran under (Measurement Platform 2.0, Task E) — resolution, refresh,
   *  driver, Windows build, rig hash, etc. Absent on pre-field sessions — honestly Unknown. Every
   *  field is optional; a `null`/absent field means "we couldn't prove it", NEVER a fabricated value.
   *  Used with `capture_capabilities` to decide whether two sessions are comparable. */
  game_state?: GameStateFingerprint | null;
  /** Peak CPU temp via read-only monitor interop (HWiNFO/LHM/OHM — cpu_temp.rs). Absent/null when
   *  no compatible monitor was running during the session — honestly Unknown, never fabricated
   *  (Compy ships no driver of its own). Absent on pre-field sessions too. */
  peak_cpu_temp_c?: number | null;
  /** Peak GPU hotspot (junction) temperature — AMD-specific; null on NVIDIA (NVML doesn't expose
   *  it) and on pre-field sessions. */
  peak_gpu_hotspot_temp_c?: number | null;
  /** P4-comparable: seconds the game presented while another window was in front, left out of every
   *  number above. null/absent = the session didn't record focus (an older Compy). */
  background_secs_excluded?: number | null;
  /** P4-smooth-measure: true per-frame frame-time percentiles (ms) over `frames` measured frames.
   *  Absent on older sessions, with an older helper, or under 1000 frames. Not shown yet. */
  frame_pacing?: { frames: number; p50_ms: number; p99_ms: number; p999_ms: number } | null;
};

/** Mirror of the Rust `GameStateFingerprint` (game_state.rs) — the honest conditions a session ran
 *  under. V1 collects only the provable fields (resolution/refresh/driver/Windows build/rig hash/
 *  gaming-mode); everything else stays absent = honestly Unknown, never inferred. Display resolution
 *  is the DISPLAY mode, not the game's render resolution. `capture_capabilities` is intentionally NOT
 *  duplicated here — it lives at the SessionSummary level. */
export type GameStateFingerprint = {
  process_name?: string | null;
  executable_version?: string | null;
  executable_hash?: string | null;
  game_build?: string | null;
  launcher_manifest_version?: string | null;
  graphics_api?: string | null;
  /** Display mode resolution, not the game's internal render resolution. */
  resolution_width?: number | null;
  resolution_height?: number | null;
  display_mode?: string | null;
  /** Active display refresh at capture; may differ from an exclusive-fullscreen game's chosen mode. */
  display_refresh_hz?: number | null;
  active_display_identity?: string | null;
  fps_cap?: number | null;
  vsync_state?: string | null;
  vrr_state?: string | null;
  upscaler?: string | null;
  frame_generation_state?: string | null;
  gpu_driver?: string | null;
  /** `"{CurrentBuildNumber}.{UBR}"`, e.g. `"26200.1234"`. */
  windows_build?: string | null;
  hardware_fingerprint_hash?: string | null;
  active_compy_change_ids?: string[];
  gaming_mode_active?: boolean | null;
  collected_at?: string | null;
};

/** Mirror of the Rust `CaptureCapabilities` (capture.rs) — the honest, per-session record of what a
 *  capture backend could measure. Every `supports_*: false` = the metric was never captured (show
 *  "unavailable", never `0`). Additive on SessionSummary; absent = honestly Unknown. */
export type CaptureCapabilities = {
  backend_id: string;
  backend_version: string;
  /** Graphics-API families the backend can observe (ETW-DXGI: DirectX 11/12). */
  graphics_api: string[];
  supports_app_fps: boolean;
  supports_presented_fps: boolean;
  supports_displayed_fps: boolean;
  supports_frame_type: boolean;
  supports_generated_frames: boolean;
  supports_gpu_busy: boolean;
  supports_display_latency: boolean;
  supports_input_latency: boolean;
  supports_dropped_frames: boolean;
  supports_gpu_telemetry: boolean;
  /** Human-readable honest caveats about this backend's numbers. */
  limitations: string[];
  capture_started_at?: string | null;
  methodology_version: string;
};

// Recommendation provenance — the honesty level of a rec's IMPACT claim.
// "verified" (Compy observes it) · "measured-signal" (third-party/community) · "expected-impact"
// (logical from Windows internals, not benchmarked).
export type Provenance = "verified" | "measured-signal" | "expected-impact";
export type Recommendation = {
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
  /** Applicability gating: false when this rig's hardware can't use the rec (→ "Not for this rig",
   *  out of the completion denominator). Defaults true for older payloads without the field. */
  eligible?: boolean;
  ineligible_reason?: string | null;
};

// Cross-session comparison result (mirrors comparison.rs serde).
export type ComparisonKind = "fix" | "tuning";
export type ComparisonResult = {
  rec_id: string;
  rec_title: string;
  game: string;
  baseline_avg_fps: number;
  baseline_low1_fps: number;
  after_avg_fps: number;
  after_low1_fps: number;
  delta_avg_pct: number;
  delta_low1_pct: number;
  noise_floor_pct: number;
  verdict: "improved" | "no-change" | "regressed" | "confounded" | "expired";
  // Tuning extension (spec 2026-06-08) — optional/back-compat (older result files omit them).
  kind?: ComparisonKind;
  baseline_peak_temp_c?: number | null;
  after_peak_temp_c?: number | null;
  delta_temp_c?: number | null;
  crash_reported?: boolean;
};

// §4 one-elevation batch apply (mirrors history.rs BatchApplyReport / BatchItemOutcome serde).
export type BatchItemOutcome = {
  rec_id: string;
  rec_title: string;
  status: "applied" | "skipped";
  reason?: string | null;
};
export type BatchApplyReport = {
  items: BatchItemOutcome[];
  applied: number;
  skipped: number;
  /** 0 or 1 — the whole point of the batch (honest count for the UI/QA). */
  elevation_prompts: number;
};

// The armed baseline, as the tuning surfaces read it (get_armed_comparison). A superset of the lite
// shape Play already uses; all tuning fields are optional/back-compat.
export type ArmedComparison = {
  rec_id: string;
  rec_title: string;
  game: string;
  baseline_avg_fps: number;
  baseline_low1_fps: number;
  armed_at: string;
  kind?: ComparisonKind;
  baseline_peak_temp_c?: number | null;
  crash_reported?: boolean;
};

// ── Latency / Diagnostics (mirrors src-tauri/src/latency.rs serde, snake_case) ──
export type MsiDevice = { name: string; msi_on: boolean; instance_id: string; msi_active: boolean | null };
export type MsiSummary = { total: number; msi_on: number; msi_off: number };
export type MsiActiveSummary = { active_on: number; active_off: number; unknown: number; advertised_but_inactive: number };
export type TimerResolution = { coarsest_100ns: number; finest_100ns: number; current_100ns: number };
export type SleepGranularity = { samples: number; min_ms: number; median_ms: number; max_ms: number; jitter_ms: number };
export type CpuTopology = { logical_processors: number; physical_cores: number; l3_complexes: number };
export type UsbControllerLoad = {
  controller_name: string;
  controller_id: string;
  input_devices: string[];
  streaming_neighbors: string[];
  has_high_rate_input: boolean;
};
export type PollingRate = { reports: number; median_hz: number; min_interval_ms: number; max_interval_ms: number; jitter_ms: number };

export type LineIrqReceipt = { name: string; advertises_msi: boolean; latency_sensitive: boolean };
export type LatencyReport = {
  msi_devices: MsiDevice[];
  msi: MsiSummary;
  msi_active: MsiActiveSummary;
  msi_advisory: string | null;
  line_irq_receipts: LineIrqReceipt[];
  timer: TimerResolution | null;
  timer_current_ms: number | null;
  cpu: CpuTopology | null;
  cpu_affinity_advisory: string | null;
  // Named read-only interrupt-affinity suggestion (multi-complex CPU + latency-sensitive devices); else null.
  affinity_suggestion?: string | null;
  usb: UsbControllerLoad[];
  usb_advisory: string | null;
  // Honest wired-vs-wireless input note; present only when a device name clearly reads as wireless.
  peripheral_link_advisory?: string | null;
  // Platform top USB spec tier ("USB4"/"USB 3.2"/…/"USB 2.0"); capability only, never per-device speed.
  usb_top_spec?: string | null;
  // The TIER half of the USB-port advisory — what the top USB tier does/doesn't mean for input latency.
  usb_tier_advisory?: string | null;
};
export type WakeMeasurement = { granularity: SleepGranularity; note: string };
export type MouseMeasurement = { polling: PollingRate; note: string };

// ── Benchmark / measured-efficacy (mirrors src-tauri/src/benchmark.rs serde) ──
export type BenchComponent = "cpu" | "ram" | "gpu" | "disk";
export type RunConfidence = "clean" | "low";
export type Verdict = "improved" | "no-measurable-change" | "regressed";

export type ComponentScore = { component: BenchComponent; score: number; measured: boolean };
export type RunReport = { components: ComponentScore[]; confidence: RunConfidence; notes: string[] };
export type ComponentEfficacy = {
  component: BenchComponent;
  before: number;
  after: number;
  delta_pct: number;
  verdict: Verdict;
};
export type Efficacy = {
  per_component: ComponentEfficacy[];
  overall: Verdict;
  noise_floor_pct: number;
};
export type BenchmarkState = {
  running: boolean;
  latest: RunReport | null;
  latest_at: string | null;
  baseline: RunReport | null;
  baseline_at: string | null;
  efficacy: Efficacy | null;
  error: string | null;
};

// Live trial / verdict engine (mirrors benchmark_verdict.rs serde; this Verdict is the
// game-frametime Keep/Revert/Inconclusive one — distinct from the synthetic-benchmark Verdict).
export type TrialVerdict =
  | { verdict: "keep"; effect_pct: number; ci_lo_pct: number; ci_hi_pct: number; metric: string }
  | { verdict: "revert"; effect_pct: number; ci_lo_pct: number; ci_hi_pct: number; metric: string }
  | { verdict: "inconclusive"; reason: string };

export type TrialState = {
  running: boolean;
  kind: string;
  status: string;
  collected: number;
  target: number;
  verdict: TrialVerdict | null;
  noise_floor_pct: number | null;
  rolled_back: boolean;
  error: string | null;
};

// Scoreboard — the verified-result ledger (only Keep verdicts earn entries).
export type AwardEntry = {
  points: number;
  rec_id: string;
  rec_title: string;
  metric: string;
  effect_pct: number;
  ci_lo_pct: number;
  ci_hi_pct: number;
  at: string;
};
export type ScoreboardView = {
  total_points: number;
  awards: AwardEntry[];
  // A2 LOCAL display-only stub (parallel to `awards`, same order): each win's effect_pct ranked
  // within the cohort of ALL the user's own verified wins — a self-relative standing, NOT a
  // peer/network percentile (Phase C, gated). null per entry until enough wins exist to rank.
  local_percentiles: (number | null)[];
};

// Memory pressure — RAM-maxed → stutter warning (mirrors monitoring.rs serde).
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

// Black Box v1 (Paramedic Mode) — READ-ONLY crash/freeze evidence reader (mirrors blackbox.rs serde).
// Reports recorded evidence only; zero causal claims. `vitals` is null when no Compy session
// overlapped the crash (honest absence, never invented).
export type CrashVitals = {
  session_started_at: string;
  game: string | null;
  peak_gpu_temp_c: number | null;
  peak_gpu_usage_pct: number | null;
  avg_frametime_ms: number;
  low1_fps_est: number;
  summary: string;
};
export type CrashReceipt = {
  source: string;
  event_ids: number[];
  faulting_app: string | null;
  faulting_module: string | null;
  code: string | null;
  detail: string;
};
// Black Box v2 (behind the backend's default-OFF blackbox_v2_gate()): the triage layer. Strength is a
// WORD, never a percentage. `assessment` is absent on every incident when the gate is OFF (v1 behavior).
export type AssessmentStrength = "strong" | "partial" | "weak";
export type CrashNextStep = {
  headline: string;
  detail: string;
  reversible: boolean; // always true by construction
  research_only: boolean; // "what to research", not "do this"
};
/** Which Black Box starter rule produced an assessment (mirrors blackbox.rs `AssessmentRule`,
 *  kebab-case on the wire). A stable key beside the prose; it names the rule, never a cause. */
export type AssessmentRule =
  | "overheating"
  | "hardware-error"
  | "graphics-driver"
  | "app-specific"
  | "power-hardlock"
  | "beyond-us";
export type CrashAssessment = {
  /** P7-rig-care. Absent on records from a build before the key existed: read as "no rule known". */
  rule?: AssessmentRule;
  consistent_with: string; // "consistent with…" — never "the cause is…"
  strength: AssessmentStrength;
  evidence: string[];
  next_step: CrashNextStep;
  beyond_us: boolean;
};
// Compy Care Tier 1 (mirrors src-tauri/src/case_intelligence.rs). A match against the SIGNED
// public-advisory catalog: somebody else's published write-up, carried verbatim. Every string here
// is the catalog entry's own — Compy contributes the level and which local facts lined up, nothing
// more. There is no confidence, score or percentage, by design and by test.
export type CaseMatchLevel =
  | "no_catalog"
  | "catalog_unavailable"
  | "no_known_match"
  | "possible_known_issue"
  | "matched_known_issue";
export type CaseAdvisoryStep = {
  headline: string;
  detail: string;
  research_only: boolean; // an irreversible real-world fix — "look into", never "do this"
};
export type CaseIntelligenceMatch = {
  case_id: string;
  // `u64` in Rust. Exact here only because `case_intelligence.rs` refuses any manifest whose
  // catalog_version is above MAX_JS_EXACT_INT — do not widen that bound without a bigint here.
  catalog_version: number;
  level: CaseMatchLevel;
  title: string;
  summary: string;
  // Evidence KEYS ("faulting_module"), never the machine's values — the UI translates them.
  evidence_refs: string[];
  next_steps: CaseAdvisoryStep[];
  contraindications: string[];
  source_url: string; // verified against the catalog's compiled origin allowlist before it got here
  source_updated_at: string;
};
export type CrashIncident = {
  // Stable, path-free identity for this merged incident (mirrors `incident_id_for` in
  // src-tauri/src/blackbox.rs). The Care observer persists it across launches so one crash is
  // announced once; the UI also uses it as the one-shot deep-link selector into Crash & Freeze
  // Rescue. Sixteen lowercase hex characters — opaque by construction, never a path or a filename.
  incident_id: string;
  headline: string;
  tag: string;
  when: string;
  when_display: string;
  vitals: CrashVitals | null;
  receipt: CrashReceipt;
  assessment?: CrashAssessment | null;
  // Absent in every shipped build: `case_intelligence_gate()` is hard-false, and the backend omits
  // the field entirely rather than sending a null, so a dark build is byte-identical to pre-Tier-1.
  case_intelligence?: CaseIntelligenceMatch | null;
  // P6-changed (mirrors `ChangedBeforeIncident` in src-tauri/src/intelligence.rs). Absent when the
  // backend could not anchor it; every line it carries is shown tagged "not proven cause".
  changed_before?: ChangedBeforeIncident | null;
};
export type ChangedBeforeCategory =
  | "compy-changes"
  | "driver"
  | "windows-build"
  | "power-plan"
  | "hardware"
  | "drift";
export type ChangedBeforeStatus = "changed" | "no-change" | "unknown";
export type ChangedBeforeUnknownReason =
  | "no-reading-before"
  | "no-reading-after"
  | "cant-place"
  | "readings-differ"
  | "unmatched-readings"
  | "ledger-incomplete"
  | "drift-not-kept";
export type ChangedBeforeItem = {
  category: ChangedBeforeCategory;
  status: ChangedBeforeStatus;
  /** "changed": the events inside the window; "unknown"+"cant-place": the unplaceable ones. */
  events: IntelEvent[];
  unknown_reason: ChangedBeforeUnknownReason | null;
  last_reading_at: string | null;
  checked_between: [string, string] | null;
};
export type ChangedBeforeIncident = {
  /** "clean": no incident on record in that session · "measured": every earlier one had one · "none". */
  anchor_kind: "clean" | "measured" | "none";
  anchor: { started_at: string; game: string } | null;
  window_end: string;
  items: ChangedBeforeItem[];
};
// P6-timeline (mirrors `SinceLastWorked` in src-tauri/src/intelligence.rs): the Care view's one
// "Since it last worked" list. "Worked" = the last clean session, by the same rules as changed_before.
export type SinceLastWorked = {
  anchor: { started_at: string; game: string } | null;
  /** Set exactly when `anchor` is null. */
  none_reason: "no-session" | "none-clean" | null;
  /** Newest first: Compy changes, observed changes, drift and sessions after the anchor started. */
  events: IntelEvent[];
  /** Observed changes whose reading window straddles the anchor's start. */
  unplaced: IntelEvent[];
  /** Every still-open drift not already in `events`/`unplaced`, whatever its age — present even
   *  when there is no anchor, so the drift pointers on Check and Home always land on something. */
  open_drift: IntelEvent[];
};
export type BlackBoxReport = {
  incidents: CrashIncident[];
  skipped_sources: string[];
  /** Station scan only; absent from the background observer's report. */
  since_last_worked?: SinceLastWorked | null;
  /** P6-unknown: the entries of `skipped_sources` that need administrator. The rest are reader
   *  failures, where a re-scan (not "run as admin") is the honest suggestion. */
  skipped_needs_admin?: string[];
};

// The Home card the Care observer surfaces (mirrors src-tauri/src/incident_observer.rs
// PendingCareIncident). Deliberately small: an identity, when it happened, the neutral evidence
// family, the app Windows named if it named one, and Black Box's own plain-English headline.
//
// There is no assessment, cause, confidence or advisory step here ON PURPOSE. A card is an
// invitation to go look at the evidence — a surface with no room to show its working must not make
// a claim the user cannot check.
export type PendingCareIncident = {
  incident_id: string;
  occurred_at: string; // RFC3339, original local offset preserved
  occurred_display: string; // "Aug 20, 9:42 PM" — already offset-correct
  kind: string; // the neutral evidence tag ("App crash", "Blue screen")
  app_label: string | null; // pretty process name when Windows named one; never a path
  summary: string;
};

// Compy Pro — offline license status (mirrors src-tauri/src/license.rs LicenseStatus). DARK: while
// licensing is disarmed the backend always returns tier "free" / reason "licensing not active".
export type LicenseStatus = {
  tier: string; // "free" | "pro"
  valid: boolean;
  armed: boolean; // licensing is active (real signing key embedded) — the gate the UI reads directly
  reason: string; // "no license" | "active" | "license expired …" | "licensing not active" | …
  expires_at: string | null;
};

// ── Intelligence Phase 1 (mirrors src-tauri/src/intelligence.rs — read-only commands
// what_changed_for_session / get_intelligence_headline; the timeline now reaches screens only
// through the Machine Model, #453).
// Confidence is a BAND, never a number — no calibration data exists, so a percentage would be
// probability theater. NOTE: named ConfidenceBand because this file's existing `Confidence`
// (PriorityItem's high|medium|low) has no "unknown" and the two must not be conflated.
export type ConfidenceBand = "unknown" | "low" | "medium" | "high";

// Who moved: Compy did it (ledger) · a measurement happened · the machine changed outside Compy.
export type IntelEventScope = "compy-applied" | "measurement" | "observed";

export type IntelEvent = {
  /** Deterministic `<kind>:<source-key>` — stable across rebuilds, never random. */
  id: string;
  /** RFC3339. For observed deltas this is the LATER bound of the observation window. */
  timestamp: string;
  /** "gpu-driver-change" | "hardware-change" | "windows-build-change" | "power-plan-change" |
   *  "change-applied" | "gaming-mode-active" | "session" | "verified-win" |
   *  "benchmark-baseline" | "comparison-verdict". */
  event_type: string;
  /** Which store produced it (trust-ledger, sessions, identity-snapshot, rig-fingerprint, …). */
  source: string;
  scope: IntelEventScope;
  game: string | null;
  summary: string;
  detail: string | null;
  /** Observed changes only: the two real reading times bounding WHEN it happened — the exact
   *  moment is honestly unknown, only the window. */
  observed_between: [string, string] | null;
  /** Apply events only: the ledger says this change was later rolled back. */
  since_rolled_back: boolean;
  /** Trust-Ledger events only: the catalog rec id, copied verbatim off the ledger row.
   *  `null` for every other source, which has no rec behind it. */
  rec_id: string | null;
  /** P6-changed-f1: the facts behind `summary` as data, so the line is worded in the viewer's
   *  language (event-text.ts). Absent for kinds without parts and for older data: show `summary`. */
  parts?: IntelEventParts | null;
};

/** By event kind (intelligence.rs `EventParts`). Values stay as recorded; only the words around
 *  them are translated. */
export type IntelEventParts =
  | { kind: "applied"; title: string }
  | { kind: "rolled-back"; title: string }
  | { kind: "gpu-driver"; from: string; to: string }
  | { kind: "windows-build"; from: string; to: string }
  | { kind: "power-plan"; from: string; to: string }
  | { kind: "hardware"; changes: { part: "gpu" | "ram" | "display"; from: string; to: string }[] }
  | { kind: "drift"; label: string }
  | { kind: "session"; game: string; duration_secs: number; fps: [string, string] | null }
  | { kind: "benchmark-baseline" };

export type IntelSessionRef = {
  started_at: string;
  game: string;
  duration_secs: number;
  samples: number;
  avg_fps: number;
  low1_fps: number;
  /** null = recorded before the field existed — honestly Unknown. */
  gaming_mode_active: boolean | null;
  hw_hash: string | null;
};

export type IntelObservation = {
  metric: string;
  baseline: number;
  current: number;
  delta_pct: number;
  /** Cleared the cross-session noise floor (judged on 1% low). */
  meaningful: boolean;
  /** Shown for context only, never drives the verdict (avg FPS). */
  reference_only: boolean;
};

export type IntelHypothesis = {
  /** Fixed-catalog id ("gpu-driver-change" … "insufficient-evidence"). */
  id: string;
  title: string;
  confidence: ConfidenceBand;
  supporting_evidence: string[];
  contradicting_evidence: string[];
  missing_evidence: string[];
  next_test: string | null;
  /** The catalog rec `next_test` refers to — present ONLY where the engine could point at a
   *  real id it READ off the Trust Ledger. `null` everywhere else, permanently: matching the
   *  prose against the catalog would be fabrication. A surface that gets `null` renders the
   *  sentence and nothing more. */
  next_test_rec_id: string | null;
};

// ─── Measurement Platform 2.0 (Task F): session comparability ────────────────
// How far two sessions may HONESTLY be compared — composed from their capture capabilities,
// game-state conditions, and rig fingerprints. Additive metadata: it never blocks a surface, it
// EXPOSES the limits so the UI/export can state them plainly and cap any downstream confidence.
// Mirror of `crate::comparability` (kebab-case serde).
export type Comparability =
  /** Same game, same PC, same capture method, no changed condition detected. */
  | "comparable"
  /** Comparable WITH stated limits — a condition changed/wasn't recorded, or only shared metrics
   *  were captured on both sides. "Direct comparison is limited." */
  | "partial"
  /** A direct verdict would mislead (different game, or a GPU change that alters the whole basis). */
  | "not-comparable"
  /** Too little recorded context to judge comparability at all (pre-2.0 sessions). Never assumed
   *  equal — "not enough comparable evidence." */
  | "unknown";

export type SessionComparability = {
  verdict: Comparability;
  /** Plain-language reasons for the verdict. */
  reasons: string[];
  /** Conditions that DIFFERED (both sides known, values not equal). */
  changed_context: string[];
  /** Conditions we could NOT confirm matched — unrecorded on one/both sessions. Never silently
   *  becomes "equal." */
  missing_context: string[];
  /** Candidate explanations for a measured difference — correlated, NEVER asserted as the cause. */
  candidate_causes: string[];
  /** The metric axes BOTH capture backends recorded — the only metrics a comparison may touch. */
  shared_metrics: string[];
  /** The CEILING this comparability puts on any downstream conclusion's confidence band. */
  confidence_limit: ConfidenceBand;
  /** What a surface may honestly conclude at this verdict — plain-language, ready to render. */
  allowed_conclusions: string[];
  /** P4-comparable: one stable key per `changed_context` line ("resolution", "gpu-driver", …). */
  changed_keys?: string[];
  /** One stable key per `missing_context` line ("conditions", "rig", …). */
  missing_keys?: string[];
};

export type WhatChangedReport = {
  baseline: IntelSessionRef;
  current: IntelSessionRef;
  game: string;
  /** Judged on the 1%-low delta vs the noise floor — comparison.rs's shared vocabulary. */
  verdict: "improved" | "regressed" | "no-change" | "inconclusive";
  headline: string;
  observations: IntelObservation[];
  noise_floor_pct: number;
  /** Non-measurement events strictly between the two sessions. */
  events_between: IntelEvent[];
  leading_hypotheses: IntelHypothesis[];
  ruled_out: IntelHypothesis[];
  /** What Compy genuinely cannot know here — stated, never papered over. */
  unknowns: string[];
  next_action: string | null;
  /** The leading hypothesis's `next_test_rec_id`, mirrored so a surface can offer a real
   *  affordance instead of prose alone. `null` unless the leader carries one.
   *
   *  **Destination is the Trust Ledger, not the experiment bench.** The only next test that
   *  can carry an id today prescribes a ROLLBACK, and the bench applies — feeding it a
   *  still-active rec simulates to `already-configured`, a dead end. Route this id only
   *  somewhere the change can actually be rolled back. */
  next_action_rec_id: string | null;
  /** ≥2 change families moved between sessions — single-cause attribution refused. */
  confounded: boolean;
  gap_days: number;
  notes: string[];
  method_note: string;
  /** §4C inspectable evidence graph — a deterministic re-projection of the fields above for
   *  the Expert view. Adds no new data; the plain-language fields ARE the normal view. */
  evidence_graph: EvidenceGraph;
  /** Measurement Platform 2.0 (Task F) — how far these two sessions may HONESTLY be compared.
   *  The backend fills it on every report path (including the inconclusive gates), so the
   *  reader always sees WHY a comparison was limited. Surfaced by WhatChangedReportView. */
  comparability: SessionComparability;
};

export type WhatChangedOutcome =
  | { kind: "unavailable"; reason: string }
  | ({ kind: "report" } & WhatChangedReport);

// ─── §4C evidence graph (Expert view) ───────────────────────────────────────
// The inspectable node/edge re-projection of a WhatChangedReport. Every node cites the
// report field it came from; nothing here is new data. Node/edge vocabularies are the §4C
// sets the two-session engine emits — Intelligence Phase 3 grows them additively.
export type EvidenceNodeType =
  | "symptom"
  | "metric"
  | "event"
  | "driver"
  | "os-update"
  | "compy-change"
  | "external-change"
  | "hypothesis"
  | "experiment"
  | "conclusion";

export type EvidenceRelation =
  | "supports"
  | "correlates-with"
  | "occurred-before"
  | "requires-verification"
  | "ruled-out-by";

export type EvidenceNode = {
  id: string;
  node_type: EvidenceNodeType;
  label: string;
  /** Which report field / record this node was derived from — inspectable provenance. */
  source_reference: string;
  /** A band, never numeric. Passive observation never exceeds "medium". */
  reliability: ConfidenceBand;
};

export type EvidenceEdge = {
  from: string;
  to: string;
  relation: EvidenceRelation;
  /** Band strength of the relation, never numeric. */
  weight: ConfidenceBand;
  explanation: string;
};

export type EvidenceGraph = {
  /** id-sorted for a stable, diffable render. */
  nodes: EvidenceNode[];
  /** (from, to, relation)-sorted. */
  edges: EvidenceEdge[];
};

// ─── Intelligence Phase 2 — cross-session pattern detection (Blackbook) ──────
// Deterministic trend/thermal/memory/driver/mode/fade detectors over recorded sessions.
// Passive observation is hard-capped at "medium"; every silent detector says why in coverage.
export type SessionPattern = {
  /** Detector id, e.g. "performance-trend". Stable, kebab-case. */
  id: string;
  /** Pretty game name, or null for a cross-game synthesis pattern. */
  game: string | null;
  title: string;
  /** Plain-language finding with the real numbers in it. */
  detail: string;
  confidence: ConfidenceBand;
  confidence_reason: string;
  supporting_evidence: string[];
  /** What would raise confidence / what argues against the pattern. */
  raises_confidence: string[];
  next_test: string | null;
};

export type PatternReport = {
  patterns: SessionPattern[];
  /** §0.12: detectors that stayed silent say exactly why (missing data), never vanish. */
  coverage: string[];
  sessions_considered: number;
  games_considered: number;
};

export type IntelligenceHeadline = {
  text: string;
  /** Only "improved" | "regressed" ever reach Home — no-change/inconclusive stay in Monitor. */
  verdict: string;
  game: string;
  session_started_at: string;
};

// ─── Intelligence Phase 4 — component evidence (the §4H hardware twin) ───────
// A PROJECTION of the Intelligence Phase 2 patterns onto the hardware component each one names
// (get_component_evidence). Invents no evidence and reaches no conclusion the Patterns tile
// doesn't: a component appears here ONLY if a real pattern implicates it, at that pattern's own
// band. Absent ⇒ the card renders neutral. Serde mirror of src-tauri/src/component_evidence.rs.
/** Kebab keys that map to HardwareGrid cards (gpu → Graphics, memory → Memory). Grows as
 *  detectors that can honestly name a new component are added; an unknown key simply matches no
 *  card, so the frontend is forward-compatible. */
export type ComponentKind = "memory" | "gpu";

export type ComponentEvidence = {
  component: ComponentKind;
  /** Inherited band (max of the implicating patterns) — never bumped, never numeric. */
  confidence: ConfidenceBand;
  /** One at-a-glance, non-causal line for why the card is lit. */
  headline: string;
  /** The implicating patterns' own plain-language findings — nothing synthesized. */
  reasons: string[];
  /** What would make the picture clearer, from the strongest implicating pattern. */
  next_test: string | null;
  /** Detector ids that implicated this component — inspectable provenance. */
  sources: string[];
};

export type ComponentEvidenceReport = {
  /** ONLY implicated components, fixed order; empty ⇒ every card neutral (the honest common case). */
  components: ComponentEvidence[];
  /** Passthrough so a surface can tell "no sessions yet" from "sessions exist, nothing implicated". */
  sessions_considered: number;
};

// ── Machine Model (mirrors src-tauri/src/machine_model.rs — read-only command get_machine_model) ──
// Wire shape only: snake_case fields, kebab-case enum values, and every field Rust skips when empty
// is optional here. `src/machine-model-contract.test.ts` checks these against
// `src/test/fixtures/machine-model.wire.json`, which a Rust test proves is exactly what serde emits.
// Read it only through `src/data/machine-model.ts`.

/** How a fact was come by. Not a confidence score. */
export const EVIDENCE_CLASSES = [
  "directly-observed",
  "recorded-historically",
  "derived-from-measurement",
  "inferred-bounded",
  "user-declared",
  "unavailable",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Whether a fact carries its own time. `unstamped-cache` must never be shown as live. */
export const FRESHNESS_VALUES = [
  "stamped",
  "live-at-build",
  "unstamped-cache",
  "undated-historical",
  "not-applicable",
] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

/** A producing domain's own word for a fact's state, carried through unchanged. */
export type DomainVocabulary = {
  vocabulary: string;
  value: string;
};

/** `value` is null when unknown (then `unknown_reason` says why) or not applicable. */
export type Fact<T> = {
  value: T | null;
  class: EvidenceClass;
  source: string;
  observed_at?: string;
  freshness: Freshness;
  unknown_reason?: string;
  not_applicable_reason?: string;
  domain?: DomainVocabulary;
};

export type ExcludedProducer = {
  producer: string;
  reason: string;
};

export type IdentityClaim = {
  producer: string;
  value: string;
  observed_at?: string;
  freshness: Freshness;
};

/** Two producers disagree; neither value overwrites the other. */
export type IdentityDisagreement = {
  field: string;
  left: IdentityClaim;
  right: IdentityClaim;
  interpretation: string;
};

export type ComparedField = {
  field: string;
  against: string;
};

export type MachineIdentity = {
  cpu: Fact<string>;
  gpu: Fact<string>;
  gpu_driver: Fact<string>;
  ram_gb: Fact<number>;
  display: Fact<string>;
  windows: Fact<string>;
  rig_hash: Fact<string>;
  canonical_rule: string;
  contributing_producers: string[];
  excluded_producers: ExcludedProducer[];
  compared_fields: ComparedField[];
  disagreements: IdentityDisagreement[];
};

export type ChronologyEntry = {
  /** The source record's own id (`IntelEvent.id`) — the row key (#450). */
  id: string;
  observed_at: string;
  summary: string;
  detail?: string;
  event_type: string;
  source: string;
  scope: IntelEventScope;
  /** [earlier, later] bounds when the exact moment was never witnessed. */
  observed_between?: [string, string];
  class: EvidenceClass;
};

export type ChangeChronology = {
  recorded_from?: string;
  recorded_from_source?: string;
  identity_history_from?: string;
  identity_snapshots: number;
  total_events: number;
  coverage_note: string;
  entries: ChronologyEntry[];
  dropped_unparseable: number;
  causation_note: string;
  /** Set when the chronology could not be read; never render that as "nothing changed". */
  unknown_reason?: string;
};

export type CompyChangeFact = {
  id: string;
  title: string;
  applied_at: Fact<string>;
  status: Fact<string>;
  still_active: Fact<boolean>;
  rolled_back_at: Fact<string>;
  on_this_rig: Fact<boolean>;
  reversible: Fact<boolean>;
  restores?: string;
};

export type CompyChangeTruth = {
  total_recorded: number;
  active_now: number;
  in_effect_other_rig: number;
  in_effect_rig_unknown: number;
  in_effect_total: number;
  applied_but_not_in_effect: number;
  in_effect_unknown: number;
  rolled_back: number;
  on_this_rig: number;
  not_on_this_rig: number;
  rig_unknown: number;
  changes: CompyChangeFact[];
  ledger_note: string;
  /** Set when the Trust Ledger could not be read; counts are then not "zero changes". */
  ledger_unreadable?: string;
};

export type UnknownFact = {
  field: string;
  source: string;
  reason: string;
};

export type AnswerEvidence = {
  answer: string;
  classes: EvidenceClass[];
  oldest_observed_at?: string;
  newest_observed_at?: string;
  unstamped_facts: number;
  unknown_facts: number;
  not_applicable_facts: number;
};

export type EvidenceSummary = {
  built_at: string;
  answers: AnswerEvidence[];
  unknowns: UnknownFact[];
  classes_present: EvidenceClass[];
  vocabulary: EvidenceClass[];
};

export type MachineModel = {
  schema_version: number;
  built_at: string;
  identity: MachineIdentity;
  chronology: ChangeChronology;
  compy_changes: CompyChangeTruth;
  evidence: EvidenceSummary;
};
