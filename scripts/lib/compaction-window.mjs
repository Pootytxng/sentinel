// The single resolver for "what auto-compaction window is in effect", plus the usage audit's
// peak-context red flag derived from it.
//
// Why this module exists (bug→guard, issue #16): scripts/usage-audit.mjs used to hard-code
// `peakCtx > 200_000` for a flag whose stated meaning is "compaction failed to fire". That literal
// had no relationship to CLAUDE_CODE_AUTO_COMPACT_WINDOW, so raising the window to 300000 (#15)
// turned every healthy 200-285k session into a false 🔴. The audit is the trial's own measurement
// instrument, so a lying flag is worse than no flag.
//
// It lives in scripts/lib/ rather than in the CLI because usage-audit.mjs scans ~/.claude/projects
// at import time — importable-and-testable required separating the arithmetic from the scan.
//
// Everything here is pure: callers pass the env object and the parsed settings object, so the guard
// test can prove every branch (configured / fallback / invalid) without touching a real filesystem.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The window the context-size advisor falls back to when the env var is missing
 * (`.claude/hooks/context-size-advisor.mjs`: `Number(process.env...) || 150_000`).
 * Kept identical on purpose — two fallbacks that disagree would be a second source of truth.
 */
export const DOCUMENTED_FALLBACK_WINDOW = 150_000;

/**
 * Where native auto-compaction actually fires — a roughly FIXED reserve below the window, not a
 * fraction of it (bug→guard, issue #19; guarded by scripts/compaction-trigger-guard.test.mjs).
 *
 * This used to read `NATIVE_COMPACT_FRACTION = [0.92, 0.95]`, and the docs restated it as
 * "≈276-285k at 300000, ~140k at 150000". Measurement of 13 real `compact_boundary` records
 * disproved both: compaction fired at 268-270k under a 300000 window (0.894-0.900) and at
 * 117-120k under 150000 (0.778-0.800). A single fraction cannot describe both; a fixed reserve can.
 *
 * The consequence is the whole point: because the reserve is fixed, it costs 21% of a 150000
 * window but only 10% of a 300000 one, so doubling the window multiplies USABLE context by ~2.27.
 */
export const NATIVE_COMPACT_RESERVE = { min: 29_915, mean: 31_752, max: 33_302 };

/**
 * The band in which native auto-compaction is expected to fire for a given window.
 * A larger reserve triggers EARLIER, so max-reserve gives the low end of the band.
 */
export function nativeCompactPoint(window) {
  return {
    min: window - NATIVE_COMPACT_RESERVE.max,
    mean: window - NATIVE_COMPACT_RESERVE.mean,
    max: window - NATIVE_COMPACT_RESERVE.min,
  };
}

const ENV_KEY = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";

/** A window is only usable if it parses to a positive, finite, whole number of tokens. */
function parseWindow(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Resolve the effective auto-compaction window.
 *
 * Precedence — most-specific-wins, and always reported:
 *   1. `env`     — CLAUDE_CODE_AUTO_COMPACT_WINDOW as a live session actually runs it
 *   2. `settings`— the project `.claude/settings.json` `env` block for the audited repo
 *   3. `fallback`— DOCUMENTED_FALLBACK_WINDOW, labelled as a fallback, never as configuration
 *
 * A present-but-unparseable value is ignored AND recorded in `ignored[]` — silently coercing a
 * typo'd window to the fallback would make the flag lie again, just more quietly.
 *
 * @param {{env?: Record<string,string|undefined>, settings?: {env?: Record<string,unknown>}|null}} input
 * @returns {{window: number, source: "env"|"settings"|"fallback", configured: boolean, ignored: Array<{from: string, value: string}>}}
 */
export function resolveCompactionWindow({ env = {}, settings = null } = {}) {
  const ignored = [];

  const fromEnv = env?.[ENV_KEY];
  const envWindow = parseWindow(fromEnv);
  if (envWindow !== null) return { window: envWindow, source: "env", configured: true, ignored };
  if (fromEnv !== undefined && String(fromEnv).trim() !== "") ignored.push({ from: "env", value: String(fromEnv) });

  const fromSettings = settings?.env?.[ENV_KEY];
  const settingsWindow = parseWindow(fromSettings);
  if (settingsWindow !== null) return { window: settingsWindow, source: "settings", configured: true, ignored };
  if (fromSettings !== undefined && String(fromSettings).trim() !== "") {
    ignored.push({ from: "settings", value: String(fromSettings) });
  }

  return { window: DOCUMENTED_FALLBACK_WINDOW, source: "fallback", configured: false, ignored };
}

/** Read a project `.claude/settings.json`. Returns null when absent/unreadable/invalid — never throws. */
export function loadProjectSettings(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Human-readable basis line for the report header, so a reader never has to guess the threshold. */
export function describeWindow(resolved) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  const trigger = nativeCompactPoint(resolved.window);
  const basis =
    resolved.source === "env"
      ? `${ENV_KEY} in the environment`
      : resolved.source === "settings"
        ? `${ENV_KEY} in .claude/settings.json`
        : `documented fallback — ${ENV_KEY} is not configured`;
  const ignoredNote = resolved.ignored.length
    ? ` · ignored invalid ${resolved.ignored.map((i) => `${i.from}="${i.value}"`).join(", ")}`
    : "";
  return `${k(resolved.window)} (${basis}; native compaction measured at ≈${k(trigger.min)}-${k(trigger.max)}, a fixed ~${k(NATIVE_COMPACT_RESERVE.mean)} reserve below the window)${ignoredNote}`;
}

/**
 * The peak-context red flag: which audited sessions carried more context than the window allows.
 *
 * Threshold is the window ITSELF, not a round number near it. Peak > window means the boundary did
 * not fire when it should have; a peak between the native trigger point and the window is normal
 * pre-compaction context and must not be flagged.
 *
 * @param {Array<{date?: string, peakCtx?: number}>} rows
 * @param {ReturnType<typeof resolveCompactionWindow>} resolved
 * @returns {{over: Array<object>, threshold: number, flag: string|null}}
 */
export function flagPeakContext(rows, resolved) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  const threshold = resolved.window;
  const over = (rows || []).filter((r) => Number(r?.peakCtx || 0) > threshold);
  if (!over.length) return { over, threshold, flag: null };

  const basis = resolved.configured
    ? `configured window ${k(threshold)}`
    : `documented fallback window ${k(threshold)} (${ENV_KEY} is not configured)`;
  const worst = over
    .slice()
    .sort((a, b) => (b.peakCtx || 0) - (a.peakCtx || 0))
    .slice(0, 3)
    .map((r) => `${r.date || "?"} ${k(r.peakCtx || 0)}`)
    .join(", ");

  return {
    over,
    threshold,
    flag:
      `🔴 ${over.length}/${rows.length} sessions peaked past the ${basis} — auto-compaction did not fire when it ` +
      `should have. Worst: ${worst}. Cache-read cost per turn scales with carried context.`,
  };
}
