import { gradeGpuTempC, type Grade } from "./metric-grade";

// Honesty gate — LOCKED rule #5. NVIDIA GPU sensor readings come from NVML and are NOT yet
// hardware-verified (AMD = verified; Intel = planned). So an NVIDIA GPU TEMPERATURE must never be
// presented as an authoritative green/amber/red graded value until a monitored NVIDIA session
// proves the sensor. The classic Monitoring tab already acknowledges this with a per-card
// "unverified" pill + a coverage line; the default Home (DashboardV2) and Play surfaces grade GPU
// temp too, so they must apply the SAME rule. One source of truth so it can't drift across surfaces.
//
// Returns true when this vendor's GPU sensor is trustworthy enough to grade (AMD, or unknown — GPU
// vendor detection is reliable, so an unknown vendor is the dev/AMD path), false for NVIDIA.
export function gpuSensorVerified(vendor: string | null | undefined): boolean {
  return !(vendor ?? "").toLowerCase().includes("nvidia");
}

// THE one vendor-honest GPU-temperature grade (LOCKED rule #5). NVIDIA NVML temp is implemented but
// NOT hardware-verified → never graded authoritatively (returns "neutral"); AMD/unknown grade normally.
// Every surface that shows a graded GPU temp (SessionDebrief, Play, DashboardV2) MUST route through
// this — so the gate can never drift across surfaces (the bug this consolidated: SessionDebrief once
// graded NVIDIA temp bare). Pure → unit-tested in gpu-sensor.test.ts.
export function gradeGpuTempForVendor(
  vendor: string | null | undefined,
  c: number | null | undefined,
): Grade {
  return gpuSensorVerified(vendor) ? gradeGpuTempC(c) : "neutral";
}

// ── A4 (content): vendor-aware, READ-ONLY advisory badges ──────────────────────────────────────
// Plain-English "for YOUR hardware" insight lines derived from GPU state Compy ALREADY read (HAGS,
// power-mode label, peak temp). This is pure content/interpretation — it changes NOTHING, arms
// nothing, and makes no FPS/perf promise (honesty law). It is AMD-only for now: AMD is our
// hardware-verified vendor, so we can name the real Adrenalin surfaces; NVIDIA/Intel/unknown get NO
// fabricated AMD advice (would be wrong on those rigs). This is the read-only advisory half — never
// the gated Phase-B apply/rollback.

/** Advisory tone → drives the badge color token, nothing else. Never a mutation state. */
export type InsightTone = "info" | "good" | "caution";

/** One read-only advisory insight for the GPU profile surface. */
export type VendorInsight = {
  /** Stable key (also the React list key). */
  key: string;
  /** Short badge label. */
  title: string;
  /** Plain-English, vendor-named advisory — no perf/FPS promise. */
  detail: string;
  tone: InsightTone;
};

/** The subset of an already-read GPU profile the advisories interpret (all optional/nullable). */
export type VendorProfileFields = {
  vendor?: string | null;
  model?: string | null;
  hagsEnabled?: boolean | null;
  powerModeLabel?: string | null;
  peakTempC?: number | null;
};

/** True when the readable identity resolves to AMD (vendor field OR a Radeon/AMD model string). */
export function isAmdGpu(fields: VendorProfileFields): boolean {
  const hay = `${fields.vendor ?? ""} ${fields.model ?? ""}`.toLowerCase();
  if (hay.includes("nvidia") || hay.includes("geforce") || hay.includes("intel") || hay.includes("arc")) {
    return false; // an explicit other-vendor signal wins — never mis-label as AMD
  }
  return hay.includes("amd") || hay.includes("radeon");
}

/**
 * Pure, read-only advisory badges tailored to the detected GPU vendor. AMD-only for now (our verified
 * vendor): returns Adrenalin-named, plain-English insights derived from already-read fields. An UNREAD
 * field yields no insight (never fabricates state). NVIDIA/Intel/unknown → [] (no mis-vendored advice).
 * Makes no FPS/performance promise — it explains what a readable setting means, honestly.
 */
export function vendorProfileInsights(fields: VendorProfileFields): VendorInsight[] {
  if (!isAmdGpu(fields)) return [];
  const out: VendorInsight[] = [];

  if (fields.hagsEnabled === true) {
    out.push({
      key: "amd-hags-on",
      title: "GPU scheduling on",
      detail:
        "Hardware-Accelerated GPU Scheduling is on — a modern default on your Radeon. Nothing to do; it's manageable under Windows Graphics settings, not AMD Adrenalin.",
      tone: "good",
    });
  } else if (fields.hagsEnabled === false) {
    out.push({
      key: "amd-hags-off",
      title: "GPU scheduling off",
      detail:
        "Hardware-Accelerated GPU Scheduling is off. On Radeon it's usually fine either way — some games prefer it on, some off. It lives in Windows Graphics settings (not AMD Adrenalin), so you can try toggling it and comparing.",
      tone: "info",
    });
  }

  const mode = (fields.powerModeLabel ?? "").trim();
  if (mode.length > 0) {
    out.push({
      key: "amd-power-mode",
      title: "Power profile",
      detail: `Your GPU power profile reads "${mode}". You can review or switch profiles in AMD Adrenalin under Performance → Tuning — Compy only reads this label, it never changes it.`,
      tone: "info",
    });
  }

  const t = typeof fields.peakTempC === "number" && Number.isFinite(fields.peakTempC) ? fields.peakTempC : null;
  if (t != null) {
    if (t >= 85) {
      out.push({
        key: "amd-temp-hot",
        title: "Thermals running hot",
        detail: `Peak GPU temperature reached ${t} °C. Radeon cards are rated to run warm, but if it stays this high you can check case airflow and, in AMD Adrenalin's Tuning, review the fan curve.`,
        tone: "caution",
      });
    } else {
      out.push({
        key: "amd-temp-ok",
        title: "Thermals healthy",
        detail: `Peak GPU temperature was ${t} °C — comfortable headroom for a Radeon. No thermal action needed.`,
        tone: "good",
      });
    }
  }

  return out;
}
