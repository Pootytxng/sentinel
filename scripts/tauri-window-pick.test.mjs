import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAIN_LABEL,
  CONCLUSIVE,
  DISQUALIFIED,
  WINDOW_PROBE_EXPRESSION,
  scoreWindow,
  pickMainTarget,
} from "./lib/tauri-window-pick.mjs";

// GUARD for the cold-start window mis-pick (bug → guard, 2026-08-06). Full story in
// scripts/lib/tauri-window-pick.mjs; the short version is that Compy's two windows share a URL, the
// probes guessed between them by page content, and at cold start the main window looks exactly like
// the overlay (no shell, no buttons) — so the overlay won the tie and every later step failed in a
// way that pointed somewhere else. This file pins the discrimination, not the plumbing.

describe("tauri window pick — the label decides, never the page content", () => {
  it("reads the label from Tauri's own metadata, not from rendered DOM", () => {
    // The whole fix rests on this being available before React paints. If the expression stops
    // asking Tauri, the picker silently degrades back to the heuristic that caused the bug.
    expect(WINDOW_PROBE_EXPRESSION).toContain("__TAURI_INTERNALS__");
    expect(WINDOW_PROBE_EXPRESSION).toContain("currentWindow");
    expect(WINDOW_PROBE_EXPRESSION).toContain("label");
  });

  it("a main label outranks everything, and a foreign label loses to a blank page", () => {
    expect(scoreWindow({ label: MAIN_LABEL, shell: false, buttons: 0 })).toBe(CONCLUSIVE);
    expect(scoreWindow({ label: "overlay", shell: true, buttons: 99 })).toBe(DISQUALIFIED);
    // A label-less page is not disqualified — it is merely unproven, and ranks by the old heuristic.
    expect(scoreWindow({ label: null, shell: false, buttons: 0 })).toBe(0);
    expect(scoreWindow({ label: null, shell: false, buttons: 7 })).toBeGreaterThan(
      scoreWindow({ label: null, shell: false, buttons: 0 }),
    );
    expect(scoreWindow({ label: null, shell: true, buttons: 0 })).toBeGreaterThan(
      scoreWindow({ label: null, shell: false, buttons: 500 }),
    );
    expect(scoreWindow(undefined)).toBe(0);
  });

  it("REGRESSION: the cold start that picked the overlay", async () => {
    // The exact observed state: /json/list names the overlay first, both windows are on
    // http://tauri.localhost/, and the main window has not rendered a thing yet. Under the old
    // scoring both scored 0 and strictly-greater handed the tie to first-listed.
    const overlay = { id: "OVL", url: "http://tauri.localhost/" };
    const main = { id: "MAIN", url: "http://tauri.localhost/" };
    const picked = await pickMainTarget({
      listTargets: async () => [overlay, main],
      probeTarget: async (t) =>
        t === overlay
          ? { label: "overlay", shell: false, buttons: 0 }
          : { label: "main", shell: false, buttons: 0 },
      sleep: async () => {},
    });
    expect(picked.target).toBe(main);
    expect(picked.viaHeuristic).toBe(false);
  });

  it("waits for the main window instead of settling for the one that is already up", async () => {
    // Cold launch: the overlay answers immediately, the main window shows up on the third poll.
    // Returning early here is the same defect wearing a different hat.
    const overlay = { id: "OVL" };
    const main = { id: "MAIN" };
    let polls = 0;
    const picked = await pickMainTarget({
      listTargets: async () => (++polls >= 3 ? [overlay, main] : [overlay]),
      probeTarget: async (t) =>
        t === overlay ? { label: "overlay", shell: false, buttons: 0 } : { label: "main" },
      sleep: async () => {},
    });
    expect(picked.target).toBe(main);
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("refuses to hand back a window that says it is not main", async () => {
    // Loudly wrong beats quietly wrong: an overlay session fails 60 seconds later, somewhere else,
    // looking like a completely different bug.
    const overlay = { id: "OVL" };
    let t = 0;
    await expect(
      pickMainTarget({
        listTargets: async () => [overlay],
        probeTarget: async () => ({ label: "overlay", shell: false, buttons: 0 }),
        now: () => (t += 1000),
        timeoutMs: 3000,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/label "main"/);
  });

  it("still falls back to content when the label genuinely cannot be read", async () => {
    // about:blank mid-launch, a non-Tauri page, an older build. Unproven is not disqualified — but
    // the caller is told the pick was a guess.
    const blank = { id: "BLANK" };
    const rich = { id: "RICH" };
    let t = 0;
    const picked = await pickMainTarget({
      listTargets: async () => [blank, rich],
      probeTarget: async (o) =>
        o === blank ? { label: null, shell: false, buttons: 0 } : { label: null, shell: true, buttons: 12 },
      now: () => (t += 1000),
      timeoutMs: 2000,
      sleep: async () => {},
    });
    expect(picked.target).toBe(rich);
    expect(picked.viaHeuristic).toBe(true);
  });

  it("both CDP probes actually use it — a fix in one script is not a fix", () => {
    // These two are the only things in the repo that attach to a Compy webview by hand, and they
    // carried identical copies of the bad heuristic. If a third appears, it belongs on this list.
    for (const file of ["scripts/q7-probe.mjs", "scripts/e2e-updater-probe.mjs"]) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file} no longer imports the shared window picker`).toContain(
        "tauri-window-pick.mjs",
      );
      expect(
        /document\.querySelector\("\.v2-shell"\)/.test(text),
        `${file} re-inlined the .v2-shell content heuristic — that guess is what picked the overlay.\n` +
          `Use WINDOW_PROBE_EXPRESSION / pickMainTarget from scripts/lib/tauri-window-pick.mjs.\n`,
      ).toBe(false);
    }
  });
});
