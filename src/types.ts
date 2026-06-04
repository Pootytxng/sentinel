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
};

export type ReadinessCheck = { id: string; label: string; status: ReadinessStatus; detail: string; value: string | null; action_uri?: string | null; action_label?: string | null };
export type GameReadiness = { checks: ReadinessCheck[]; ready_count: number; attention_count: number; unknown_count: number; advisory_count: number; advisory: string };

export type PriorityItem = { id: string; title: string; reason: string; linked: string | null; confidence: Confidence; status: PriorityStatus };
export type Priorities = { limiters: PriorityItem[]; already_fine: PriorityItem[]; not_worth_touching: PriorityItem[]; session_hint: string | null };

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
};

// ── Latency / Diagnostics (mirrors src-tauri/src/latency.rs serde, snake_case) ──
export type MsiDevice = { name: string; msi_on: boolean; instance_id: string; msi_active: boolean | null };
export type MsiSummary = { total: number; msi_on: number; msi_off: number };
export type MsiActiveSummary = { active_on: number; active_off: number; unknown: number; advertised_but_inactive: number };
export type TimerResolution = { coarsest_100ns: number; finest_100ns: number; current_100ns: number };
export type SleepGranularity = { samples: number; min_ms: number; median_ms: number; max_ms: number; jitter_ms: number };
export type CpuTopology = { logical_processors: number; physical_cores: number; l3_complexes: number };
export type UsbControllerLoad = { controller_name: string; controller_id: string; input_devices: string[] };
export type PollingRate = { reports: number; median_hz: number; min_interval_ms: number; max_interval_ms: number; jitter_ms: number };

export type LatencyReport = {
  msi_devices: MsiDevice[];
  msi: MsiSummary;
  msi_active: MsiActiveSummary;
  msi_advisory: string | null;
  timer: TimerResolution | null;
  timer_current_ms: number | null;
  cpu: CpuTopology | null;
  cpu_affinity_advisory: string | null;
  usb: UsbControllerLoad[];
  usb_advisory: string | null;
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
