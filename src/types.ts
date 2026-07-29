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

export type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
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
};

export type ReadinessCheck = { id: string; label: string; status: ReadinessStatus; detail: string; value: string | null; action_uri?: string | null; action_label?: string | null };
export type Drift = { id: string; label: string; detail: string; noticed_at: string };
export type GameReadiness = { checks: ReadinessCheck[]; ready_count: number; attention_count: number; unknown_count: number; advisory_count: number; advisory: string; dismissed_ids: string[]; drifts: Drift[] };

// `linked` = the ONE thing this row points at (a rec id OR a readiness-check id).
// `rec_ids` = every catalog RECOMMENDATION id the row is about, in display order — the identity
// the Check → Optimize handoff carries. Never re-derive a rec from a row's prose; read this.
// Optional in TS only because a probe-cache payload written by an older build won't have it
// (Rust always emits it) — read it as `rec_ids ?? []`, never assume presence.
export type PriorityItem = { id: string; title: string; reason: string; linked: string | null; rec_ids?: string[]; confidence: Confidence; status: PriorityStatus };
// R3 Lane B: advisory upgrade path — present only when a verdict names hardware as the limiter.
// Links are plain retailer searches (no affiliate tags); in-app they are COPY-only, never opened.
export type RetailLink = { retailer: string; url: string };
export type UpgradeSuggestion = { kind: string; title: string; why: string; links: RetailLink[] };
export type UpgradePath = { items: UpgradeSuggestion[]; disclosure: string };
export type Priorities = { limiters: PriorityItem[]; already_fine: PriorityItem[]; not_worth_touching: PriorityItem[]; session_hint: string | null; upgrade_path: UpgradePath | null };

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
export type CrashAssessment = {
  consistent_with: string; // "consistent with…" — never "the cause is…"
  strength: AssessmentStrength;
  evidence: string[];
  next_step: CrashNextStep;
  beyond_us: boolean;
};
export type CrashIncident = {
  headline: string;
  tag: string;
  when: string;
  when_display: string;
  vitals: CrashVitals | null;
  receipt: CrashReceipt;
  assessment?: CrashAssessment | null;
};
export type BlackBoxReport = {
  incidents: CrashIncident[];
  skipped_sources: string[];
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
// get_intelligence_timeline / what_changed_for_session / get_intelligence_headline).
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
};

export type IntelligenceTimeline = {
  /** Newest first. */
  events: IntelEvent[];
  /** Records dropped for unparseable timestamps — counted, never coerced into rows. */
  dropped_unparseable: number;
  generated_at: string;
};

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
