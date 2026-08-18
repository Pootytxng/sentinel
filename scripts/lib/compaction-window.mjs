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
 * (`.claude/hooks/context-size-advisor.mjs`: `Number(process.env...) || 250_000`).
 * Kept identical on purpose — two fallbacks that disagree would be a second source of truth.
 *
 * Raised 150_000 → 250_000 on 2026-08-07, see MEASURED_COMPACT_FRACTION below for the evidence.
 */
export const DOCUMENTED_FALLBACK_WINDOW = 250_000;

/**
 * Where auto-compaction ACTUALLY fires, as a fraction of the window — measured, not documented.
 *
 * The old literal here was [0.92, 0.95] ("Anthropic default"), which nothing in this repo had ever
 * checked against a transcript. Measuring every sentinel session's peak turn (input + cache_read +
 * cache_creation) says otherwise: under the 150k pin, 20+ independent sessions across three weeks
 * all topped out in a tight 116.0k-119.9k band — 0.77-0.80 of the window, never 0.92. The most
 * likely mechanism is that the harness reserves the max output budget (150k - 32k ≈ 118k), but the
 * ratio is what we can prove, so the ratio is what is stored.
 *
 * CORRECTION 2026-08-18 — that ratio was fitted to ONE window and is wrong at the current one.
 *
 * Re-measured across every transcript under ~/.claude/projects with >=20 assistant turns, split at
 * the 2026-08-07 window change. Under the live 250000 window, 12+ independent sessions pin their
 * peak turn at 216-217k in a +/-1k band. The stored fraction predicts 192.5-200k. It is short by
 * ~24k, i.e. 12% of the window, and every report written since 2026-08-07 has printed a compaction
 * point that does not exist.
 *
 * 250000 - 217000 = 33k, and the code comment above already guessed the mechanism: the harness
 * reserves the max output budget. That reservation is ADDITIVE, so it cannot be modelled as a
 * fraction — a fraction only looked right because it was fitted at a single window.
 *
 * Honest limit of the evidence: with only one window actually in force, additive-33k and
 * proportional-0.867 both fit. Additive is preferred because it matches a known mechanism and
 * because the proportional model has already been falsified once. The falsifying test is one more
 * window change: additive predicts (window - 33k), proportional predicts (window * 0.867).
 */
export const NATIVE_COMPACT_RESERVE = 33_000;

/** Where auto-compaction actually fires for a given window. Measured, single source of truth. */
export function nativeCompactCeiling(window) {
  return Math.max(0, Math.round(window) - NATIVE_COMPACT_RESERVE);
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

/**
 * The smallest working headroom a session may be configured down to.
 *
 * Derived, not chosen: sessions from 2026-07-15 to 2026-07-31 opened at a ~52-66k floor against a
 * ~119k ceiling — ~60k of headroom — and ran to 4,731 turns with no thrash complaint. Sessions from
 * 2026-08-04 on opened at a 75-128k floor against the SAME ceiling, leaving ~30k or in one case a
 * NEGATIVE margin (a 128,085-token first turn), and thrashed immediately. 60k is the last width
 * that is known to have worked.
 */
export const MIN_WORKING_HEADROOM = 60_000;

/**
 * Working headroom = where compaction actually fires − the fixed per-turn floor.
 *
 * This is the number that decides whether a session is usable, and until 2026-08-07 nothing
 * computed it. Both prior fixes missed for the same reason: #84 (big-read guard) only limits new
 * bulk, and #85 (refill-velocity detector) only reports the thrash after it happens. Neither raises
 * the ceiling nor lowers the floor, so neither could change this subtraction.
 *
 * `floorTokens` is the fixed payload re-sent every turn — system prompt, tool + MCP listings,
 * auto-loaded CLAUDE.md/MEMORY.md, skill and agent listings, the carried handoff. Measure it as a
 * session's FIRST recorded turn, before any work: that turn is the floor by definition.
 *
 * @param {ReturnType<typeof resolveCompactionWindow>} resolved
 * @param {number} floorTokens
 * @returns {{ceiling: number, floor: number, headroom: number, ok: boolean, reason: string}}
 */
export function usableHeadroom(resolved, floorTokens) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  const floor = Math.max(0, Number(floorTokens) || 0);
  const ceiling = nativeCompactCeiling(resolved.window);
  const headroom = ceiling - floor;
  const ok = headroom >= MIN_WORKING_HEADROOM;
  return {
    ceiling,
    floor,
    headroom,
    ok,
    reason: ok
      ? `${k(headroom)} of working headroom (compaction fires ≈${k(ceiling)}, fixed floor ${k(floor)})`
      : `🔴 only ${k(headroom)} of working headroom — compaction fires ≈${k(ceiling)} and the fixed ` +
        `per-turn floor is already ${k(floor)}. Below ${k(MIN_WORKING_HEADROOM)} a session refills ` +
        `within a turn or two of every compact, which IS the "Autocompact is thrashing" condition. ` +
        `Raise ${ENV_KEY} or cut the floor (auto-loaded docs, MCP connectors, skill listings).`,
  };
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
  const basis =
    resolved.source === "env"
      ? `${ENV_KEY} in the environment`
      : resolved.source === "settings"
        ? `${ENV_KEY} in .claude/settings.json`
        : `documented fallback — ${ENV_KEY} is not configured`;
  const ignoredNote = resolved.ignored.length
    ? ` · ignored invalid ${resolved.ignored.map((i) => `${i.from}="${i.value}"`).join(", ")}`
    : "";
  return `${k(resolved.window)} (${basis}; native compaction fires ≈${k(nativeCompactCeiling(resolved.window))}, measured 2026-08-18 as window − ${k(NATIVE_COMPACT_RESERVE)} reserve)${ignoredNote}`;
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
export function flagPeakContext(rows, resolved, { configuredSince = null } = {}) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  const threshold = resolved.window;

  // 2026-08-18 — a flag that cannot tell "before the fix" from "after the fix" cries wolf forever.
  // CLAUDE_CODE_AUTO_COMPACT_WINDOW did not exist before 2026-08-07; sessions older than that ran
  // on the model default and peaked as high as 514k. They are not evidence that the boundary is
  // failing NOW, but they stay in the rolling 80-session sample for weeks, re-raising the same 🔴
  // every Monday. Rows dated before `configuredSince` are excluded from the flag and counted
  // separately so the history is reported, not hidden.
  const dated = (rows || []).filter((r) => r && (!configuredSince || !r.date || r.date >= configuredSince));
  const excluded = (rows || []).length - dated.length;

  const over = dated.filter((r) => Number(r?.peakCtx || 0) > threshold);
  if (!over.length) {
    return {
      over,
      threshold,
      excluded,
      flag: null,
      note: excluded
        ? `🟢 0/${dated.length} sessions since ${configuredSince} exceeded the ${k(threshold)} window (${excluded} older sessions predate the setting and are excluded).`
        : null,
    };
  }

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
    excluded,
    note: null,
    flag:
      `🔴 ${over.length}/${dated.length} sessions peaked past the ${basis} — auto-compaction did not fire when it ` +
      `should have. Worst: ${worst}. Cache-read cost per turn scales with carried context.`,
  };
}
