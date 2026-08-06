// Pick Compy's MAIN webview out of the CDP target list — by the window LABEL, which is authoritative.
//
// WHY THIS EXISTS (bug → guard, 2026-08-06). Compy runs two Tauri windows, `main` and `overlay`,
// and BOTH are served from http://tauri.localhost/ — the URL cannot tell them apart. Every probe in
// this repo used to guess by content: `.v2-shell` present, else most <button>s. That guess is fine
// on a warm window and WRONG on a cold one. At cold start the main window has not rendered yet, so
// it scores { shell: false, buttons: 0 } — exactly what the overlay HUD scores forever. The tie fell
// to whichever target /json/list happened to name first, which on this machine was the overlay.
//
// The damage was silent and expensive: `q7-probe eval` attached to the overlay, reloaded IT, then
// waited 60 s for `.v2-nav-item` to appear on a window that has no nav rail ("page never became
// usable"), and a get_build_stamp invoke came back "Command get_build_stamp not allowed by ACL"
// because the overlay's capability set excludes that command. Two unrelated-looking failures, one
// cause. That happened while verifying the 0.9.13 install — i.e. it blocked the SILENT REINSTALL
// law's stamp check, which is the whole reason the law is mechanical.
//
// THE FIX: ask the window what it is. `window.__TAURI_INTERNALS__.metadata.currentWindow.label` is
// set by Tauri itself, needs no React, and is correct from the first frame. A label that is present
// and not "main" is a positive DISQUALIFICATION, never a tie — returning the overlay is the bug, so
// we would rather wait, and rather fail loudly, than hand back the wrong window. The old content
// heuristic survives only for the case the label genuinely cannot be read (about:blank mid-launch,
// a non-Tauri page, an older build), and when it is used the caller is told so.
//
// Guarded by scripts/tauri-window-pick.test.mjs — including a regression case that replays the exact
// cold-start tie above.

/** Both windows are on tauri.localhost; the label is the only honest discriminator. */
export const MAIN_LABEL = "main";

/**
 * Evaluated inside each candidate target. Reads the label first and falls back to the legacy content
 * signals, so one round-trip answers both the authoritative and the heuristic question.
 *
 * `.v2-shell` alone is not enough even on a warm window: Settings and other full-surface views
 * REPLACE ShellV2 (App.tsx), so the shell is absent while a surface is open — the reason the button
 * count was added during zh-CN Settings QA (2026-07-23).
 */
export const WINDOW_PROBE_EXPRESSION = `(() => {
  let label = null;
  try {
    label = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null;
  } catch {
    label = null;
  }
  return {
    label,
    shell: !!document.querySelector(".v2-shell"),
    buttons: document.querySelectorAll("button").length,
  };
})()`;

/** A label we trust outright. Nothing else can outrank it, and nothing needs to. */
export const CONCLUSIVE = 1e9;
/** A label that says "not main". Below every heuristic score, including a blank page's zero. */
export const DISQUALIFIED = -1;

/**
 * Score one probe result. Pure — this is the part the guard exercises directly.
 *
 * @param {{label?: string|null, shell?: boolean, buttons?: number}} v
 * @returns {number} CONCLUSIVE, DISQUALIFIED, or a non-negative heuristic score.
 */
export function scoreWindow(v) {
  const label = v?.label ?? null;
  if (label === MAIN_LABEL) return CONCLUSIVE;
  if (typeof label === "string" && label.length > 0) return DISQUALIFIED;
  return (v?.shell ? 100000 : 0) + (v?.buttons ?? 0);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How long the picker waits for the main window before giving up.
 *
 * EXPORTED because a caller that runs this probe under its own watchdog has to set that watchdog
 * LONGER than this, or the two deadlines race and the probe's own error message is lost to a kill
 * (scripts/runtime-proof-guard.test.mjs derives its capture timeout from this constant rather than
 * hard-coding a number that would silently drift back into a tie).
 */
export const DEFAULT_PICK_TIMEOUT_MS = 20000;

/**
 * Poll the target list until the main window identifies itself.
 *
 * Every dependency is injected so the guard can replay a cold start with no browser: pass a
 * `listTargets` that returns page targets and a `probeTarget` that evaluates
 * WINDOW_PROBE_EXPRESSION in one and resolves to its value (or rejects/returns null if the target is
 * gone — that target is skipped, never fatal).
 *
 * Waiting is the point. A cold launch shows the overlay first; the main window appears a beat later.
 * Settling for "best so far" is precisely how the overlay got picked.
 *
 * @returns {Promise<{target: any, label: string|null, viaHeuristic: boolean, score: number}>}
 */
export async function pickMainTarget({
  listTargets,
  probeTarget,
  timeoutMs = DEFAULT_PICK_TIMEOUT_MS,
  intervalMs = 250,
  now = () => Date.now(),
  sleep = defaultSleep,
}) {
  const deadline = now() + timeoutMs;
  let fallback = null;
  let sawAnyTarget = false;

  for (;;) {
    let pages = [];
    try {
      pages = (await listTargets()) ?? [];
    } catch {
      pages = [];
    }
    sawAnyTarget ||= pages.length > 0;

    for (const target of pages) {
      let v = null;
      try {
        v = await probeTarget(target);
      } catch {
        continue; // target closing mid-probe — not our window's problem
      }
      const score = scoreWindow(v);
      if (score === CONCLUSIVE) {
        return { target, label: v?.label ?? MAIN_LABEL, viaHeuristic: false, score };
      }
      // Only a label-less page may stand in, and only if nothing better turns up before the deadline.
      if (score >= 0 && (!fallback || score > fallback.score)) {
        fallback = { target, label: v?.label ?? null, viaHeuristic: true, score };
      }
    }

    if (now() >= deadline) break;
    await sleep(intervalMs);
  }

  if (fallback) return fallback;
  throw new Error(
    sawAnyTarget
      ? `No window reported label "${MAIN_LABEL}" within ${timeoutMs}ms. Every reachable target ` +
        `named a different window (the overlay HUD, most likely). Refusing to return it: attaching ` +
        `to the overlay fails later and confusingly — a 60s "page never became usable" wait, or an ` +
        `ACL denial on a main-only command.`
      : `No page targets found within ${timeoutMs}ms — is Compy running with a remote-debugging port?`,
  );
}
