// GPU profile before/after delta — READ-ONLY, advisory, local-only (GPU backlog: "before/after
// delta display (for profiles)"). A "GPU profile" here is a *snapshot* of the readable, advisory
// GPU state Compy already surfaces elsewhere (driver version, HAGS on/off, the vendor power-mode
// label, and the last measured peak GPU temperature). This module lets a user capture two such
// snapshots — a BEFORE and an AFTER — and see a plain-English field-by-field diff of what moved.
//
// HARD BOUNDARIES (this is the read-only/advisory half of the GPU-profile line — NOT the gated
// Phase-B "GPU profile apply / import / rollback"):
//   • It changes NO Windows setting, applies no tweak, arms nothing. It only records what the app
//     already read and computes a diff of two records.
//   • No IPC and no network — snapshots live in localStorage on this PC only, like profile-store.ts.
//   • Guarded storage: a bare localStorage access throws on WebView2 configs where storage is
//     disabled/partitioned; every read/write swallows the throw and degrades safely (never blanks
//     the window). Corrupt/foreign-shaped storage reads back as "no snapshot", never throws.

export const GPU_PROFILE_KEY = "compy_gpu_profile_snapshots_v1";

/**
 * A captured GPU profile snapshot. Every field is optional/nullable because it mirrors reads that
 * can be unavailable (e.g. NVIDIA sensor gated per Rule 5, no session yet for peak temp). We never
 * fabricate a value — an absent read stays absent and the diff reports it as "unknown", not a change.
 */
export type GpuProfileSnapshot = {
  /** ISO timestamp of capture (for the "before" / "after" labels). */
  capturedAt: string;
  /** GPU vendor as detected ("AMD" | "NVIDIA" | "Intel" | other), or null if undetected. */
  vendor?: string | null;
  /** Human GPU model string, or null. */
  model?: string | null;
  /** Installed graphics driver version string, or null. */
  driverVersion?: string | null;
  /** Hardware-Accelerated GPU Scheduling on/off, or null when unread. */
  hagsEnabled?: boolean | null;
  /** Vendor power/performance mode LABEL only (read-only, never set), or null. */
  powerModeLabel?: string | null;
  /** Last measured peak GPU temperature (°C) — the one numeric field with a good→bad direction. */
  peakTempC?: number | null;
};

/** The two-slot store: a before and an after, either of which may be empty. */
export type GpuProfilePair = {
  before: GpuProfileSnapshot | null;
  after: GpuProfileSnapshot | null;
};

const EMPTY_PAIR: GpuProfilePair = { before: null, after: null };

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Coerce arbitrary parsed JSON into a valid snapshot, or null if it has no usable timestamp. */
function coerceSnapshot(v: unknown): GpuProfileSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const capturedAt = str(o.capturedAt);
  if (capturedAt == null) return null; // a snapshot with no capture time is not a snapshot
  return {
    capturedAt,
    vendor: str(o.vendor),
    model: str(o.model),
    driverVersion: str(o.driverVersion),
    hagsEnabled: boolOrNull(o.hagsEnabled),
    powerModeLabel: str(o.powerModeLabel),
    peakTempC: numOrNull(o.peakTempC),
  };
}

/** Read both slots. Missing / corrupt / foreign-shaped storage degrades to an empty pair, never throws. */
export function readGpuProfiles(): GpuProfilePair {
  try {
    const raw = localStorage.getItem(GPU_PROFILE_KEY);
    if (!raw) return { ...EMPTY_PAIR };
    const p = JSON.parse(raw) as Record<string, unknown>;
    return { before: coerceSnapshot(p.before), after: coerceSnapshot(p.after) };
  } catch {
    return { ...EMPTY_PAIR };
  }
}

/** Persist a slot. Storage failures are swallowed (the capture just won't stick) — never throws. */
export function writeGpuProfileSlot(slot: "before" | "after", snap: GpuProfileSnapshot): void {
  const pair = readGpuProfiles();
  pair[slot] = snap;
  try {
    localStorage.setItem(GPU_PROFILE_KEY, JSON.stringify(pair));
  } catch {
    /* storage disabled/full — capture is best-effort by design */
  }
}

/** Clear both slots (start over). Storage failure is swallowed. */
export function clearGpuProfiles(): void {
  try {
    localStorage.removeItem(GPU_PROFILE_KEY);
  } catch {
    /* nothing to do — read already degrades to empty */
  }
}

// ── The pure delta engine ────────────────────────────────────────────────────────────────────

/** Per-field comparison outcome. "unknown" = at least one side was unread (never counted a change). */
export type DeltaStatus = "same" | "changed" | "unknown";

/** Numeric direction, for the one field (temp) that has a good→bad meaning. */
export type DeltaDirection = "up" | "down" | "flat" | "none";

export type FieldDelta = {
  /** Stable field key. */
  key: keyof Omit<GpuProfileSnapshot, "capturedAt">;
  /** Plain-English field label for the UI. */
  label: string;
  /** Value on the before snapshot, formatted for display (or "—" when unread). */
  beforeText: string;
  /** Value on the after snapshot, formatted for display (or "—" when unread). */
  afterText: string;
  status: DeltaStatus;
  /** Only meaningful for numeric fields; "none" for text/boolean fields. */
  direction: DeltaDirection;
  /** Signed numeric delta (after − before) when both sides are numbers; else null. */
  numericDelta: number | null;
};

const FIELDS: { key: FieldDelta["key"]; label: string }[] = [
  { key: "vendor", label: "Vendor" },
  { key: "model", label: "GPU model" },
  { key: "driverVersion", label: "Driver version" },
  { key: "hagsEnabled", label: "Hardware-accelerated GPU scheduling" },
  { key: "powerModeLabel", label: "Power mode" },
  { key: "peakTempC", label: "Peak GPU temperature" },
];

function fmt(key: FieldDelta["key"], v: unknown): string {
  if (v == null) return "—";
  if (key === "hagsEnabled") return v ? "On" : "Off";
  if (key === "peakTempC") return `${v} °C`;
  return String(v);
}

/**
 * Pure field-by-field diff of two snapshots. Either may be null (nothing captured yet). A field is
 * only "changed" when BOTH sides were read AND differ; if either side is unread the field is
 * "unknown" (we never invent a change from missing data — honesty law). For the numeric temp field
 * the signed delta + direction are reported (down = cooler = the good direction).
 */
export function computeGpuProfileDelta(
  before: GpuProfileSnapshot | null,
  after: GpuProfileSnapshot | null,
): FieldDelta[] {
  return FIELDS.map(({ key, label }) => {
    const b = before ? before[key] : null;
    const a = after ? after[key] : null;
    const beforeText = fmt(key, b ?? null);
    const afterText = fmt(key, a ?? null);

    let status: DeltaStatus;
    if (b == null || a == null) status = "unknown";
    else status = b === a ? "same" : "changed";

    let direction: DeltaDirection = "none";
    let numericDelta: number | null = null;
    if (key === "peakTempC") {
      const bn = numOrNull(b);
      const an = numOrNull(a);
      if (bn != null && an != null) {
        numericDelta = an - bn;
        direction = numericDelta > 0 ? "up" : numericDelta < 0 ? "down" : "flat";
      }
    }

    return { key, label, beforeText, afterText, status, direction, numericDelta };
  });
}

/** True when there is at least one field that genuinely moved (both sides read + differ). */
export function hasAnyChange(deltas: FieldDelta[]): boolean {
  return deltas.some((d) => d.status === "changed");
}

/**
 * One honest summary line for the header. Never overstates: "unknown" fields are not called changes,
 * and a temp move is phrased as cooler/warmer (down = cooler is the good direction) without any FPS
 * or performance claim.
 */
export function deltaSummary(deltas: FieldDelta[]): string {
  const changed = deltas.filter((d) => d.status === "changed");
  if (changed.length === 0) return "No changes between these two snapshots.";
  const temp = deltas.find((d) => d.key === "peakTempC" && d.numericDelta != null);
  const parts: string[] = [`${changed.length} setting${changed.length === 1 ? "" : "s"} changed`];
  if (temp && temp.numericDelta != null && temp.numericDelta !== 0) {
    const mag = Math.abs(temp.numericDelta);
    parts.push(temp.numericDelta < 0 ? `peak temp ${mag} °C cooler` : `peak temp ${mag} °C warmer`);
  }
  return `${parts.join(" · ")}.`;
}

// ── The live snapshot builder (C-14, 2026-08-22) ─────────────────────────────────────────────

/** The only two GPU identity fields any surface reads today (structural, so this module keeps no
 *  dependency on App's `GpuInfo`). */
export type LiveGpuIdentity = { name?: string | null; driver_version?: string | null };

/** The only three recommendation fields this builder reads (structural, mirrors `Recommendation`). */
export type LiveRecState = { id: string; currently_applied: boolean; eligible?: boolean };

/** Vendor from a GPU model string. Mirrors `gpuVendor` in surfaces/walkthroughs.ts, but returns the
 *  DISPLAY casing the snapshot/advisory layer expects ("AMD"/"NVIDIA"/"Intel"), or null when the
 *  name resolves to nothing recognisable — never a guess. */
export function gpuVendorLabel(name: string | null | undefined): string | null {
  const n = (name ?? "").toLowerCase();
  if (!n) return null;
  if (n.includes("nvidia") || n.includes("geforce") || n.includes("rtx") || n.includes("gtx")) return "NVIDIA";
  if (n.includes("amd") || n.includes("radeon")) return "AMD";
  if (n.includes("intel") || n.includes("arc")) return "Intel";
  return null;
}

/**
 * Build the LIVE snapshot the GPU profile surface reads from, using ONLY values this rig has already
 * measured — zero new IPC.
 *
 * - `vendor` / `model` / `driverVersion` come from the detected GPU.
 * - `hagsEnabled` is the `hags-enable` recommendation's `currently_applied`, which the backend
 *   derives from a real `HwSchMode` registry read (`lib.rs` `hags_state`). When that rec is absent
 *   from this rig's catalog, or is marked ineligible, the field stays **null** — unread, not false.
 * - `powerModeLabel` is ALWAYS null: vendor power/performance state is not user-mode readable
 *   (LOCKED rule 6, the same reason GPU-profile apply is structurally impossible).
 * - `peakTempC` is ALWAYS null here: it belongs to a monitored session, which this room does not
 *   hold. The delta engine already reports an unread field as "unknown", never as a change.
 *
 * Honesty law: an unavailable read stays absent. Nothing in here fabricates or infers a value.
 */
export function liveGpuProfileSnapshot(
  gpu: LiveGpuIdentity | null | undefined,
  recs: readonly LiveRecState[] | null | undefined,
  capturedAt: string,
): GpuProfileSnapshot {
  const name = str(gpu?.name);
  const hags = (recs ?? []).find((r) => r.id === "hags-enable");
  return {
    capturedAt,
    vendor: gpuVendorLabel(name),
    model: name,
    driverVersion: str(gpu?.driver_version),
    hagsEnabled: hags && hags.eligible !== false ? hags.currently_applied : null,
    powerModeLabel: null,
    peakTempC: null,
  };
}
