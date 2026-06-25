export type StartupEntry = {
  name: string;
  command: string;
  enabled: boolean;
};

export type ReadinessStatus = "ready" | "attention" | "unknown" | "advisory";
export type PriorityStatus = "ready" | "attention" | "unknown";
export type Confidence = "high" | "medium" | "low";

export type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
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
};

export type ReadinessCheck = { id: string; label: string; status: ReadinessStatus; detail: string; value: string | null; action_uri?: string | null; action_label?: string | null };
export type Drift = { id: string; label: string; detail: string; noticed_at: string };
export type GameReadiness = { checks: ReadinessCheck[]; ready_count: number; attention_count: number; unknown_count: number; advisory_count: number; advisory: string; dismissed_ids: string[]; drifts: Drift[] };

export type PriorityItem = { id: string; title: string; reason: string; linked: string | null; confidence: Confidence; status: PriorityStatus };
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
  reason: string; // "no license" | "active" | "license expired …" | "licensing not active" | …
  expires_at: string | null;
};
