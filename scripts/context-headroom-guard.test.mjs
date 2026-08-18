// bug→guard for the recurring "Your context window is full / Autocompact is thrashing" interruption
// the owner hit on 2026-08-07 — for the third time, and the first two fixes could not have stopped
// it.
//
// What actually happened, measured from every sentinel transcript on this machine (peak turn =
// input_tokens + cache_read_input_tokens + cache_creation_input_tokens):
//
//   2026-07-11 .. 07-13   no CLAUDE_CODE_AUTO_COMPACT_WINDOW set
//                         first turn ~59k · peak 270k-393k · no thrash, sessions ran 400 turns
//   2026-07-14            pin introduced at 160000, tightened to 150000 on 07-18
//   2026-07-15 .. 07-31   first turn 52-66k · peak pinned flat at 116-119k · still fine (~60k spread)
//   2026-08-04 .. 08-07   first turn 75-128k · peak STILL 116-119k · thrash every session
//
// The ceiling never moved after the pin: 20+ independent sessions all stop in a 116.0k-119.9k band,
// which is 0.77-0.80 of 150k, NOT the 0.92-0.95 the code claimed. So the usable width of a session
// is `ceiling − floor`, and it went ~60k → ~30k → negative (a 128,085-token FIRST turn on 08-04)
// purely from configuration and auto-loaded payload. Nothing about the work changed.
//
// Why the two earlier fixes missed, stated plainly so this is not attempted a fourth way:
//   #84 big-read guard         — limits new bulk a session ADDS. Does not touch ceiling or floor.
//   #85 refill-velocity detect — reports the thrash after it is already happening. Same.
// Neither one performs this subtraction, so neither could have changed the outcome.
//
// This guard performs it. It fails the build when the configured window and the real measured floor
// leave a session too little room to work in — the one condition that produces the dialog.

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  MIN_WORKING_HEADROOM,
  loadProjectSettings,
  resolveCompactionWindow,
  usableHeadroom,
} from "./lib/compaction-window.mjs";

// Walk up to the checkout that owns .claude/settings.json. Not import.meta.url: vitest rewrites it
// to a non-file scheme, which is how the first version of this guard failed to load at all.
function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".claude", "settings.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}
const REPO_ROOT = findRepoRoot(process.cwd());
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const FRESH_DAYS = 14;

/**
 * The fixed per-turn floor, measured rather than estimated: a session's FIRST recorded assistant
 * turn is by definition all payload and no conversation.
 *
 * Returns the p75 across recent sessions — the max would fail on one freak session, the median
 * would let a steadily-growing floor hide behind older ones.
 */
function measureFloor() {
  let dirs = [];
  try {
    dirs = readdirSync(PROJECTS_DIR).filter((d) => d.includes("sentinel"));
  } catch {
    return null; // not this machine (CI, a fresh clone) — the unit cases below still run
  }
  const cutoff = Date.now() - FRESH_DAYS * 86_400_000;
  const floors = [];
  for (const d of dirs) {
    let files = [];
    try {
      files = readdirSync(join(PROJECTS_DIR, d)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const full = join(PROJECTS_DIR, d, f);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff || st.size < 32 * 1024) continue; // skip stale + trivial sessions
      // The floor is in the first few turns; reading the whole transcript to find it would itself be
      // the disease. 256 KB is comfortably past the first assistant message of any session.
      let head;
      try {
        head = readFileSync(full, "utf8").slice(0, 256 * 1024);
      } catch {
        continue;
      }
      for (const line of head.split("\n")) {
        if (!line.trim()) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue; // last line of the slice is usually partial
        }
        if (o?.isSidechain === true) continue;
        const u = o?.message?.usage;
        if (o?.type !== "assistant" || !u) continue;
        const t = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (t > 0) {
          floors.push(t);
          break;
        }
      }
    }
  }
  if (floors.length < 3) return null;
  floors.sort((a, b) => a - b);
  return floors[Math.min(floors.length - 1, Math.floor(floors.length * 0.75))];
}

describe("working headroom (ceiling − floor) is the number that decides thrash", () => {
  it("is positive and generous for the pre-pin configuration that demonstrably worked", () => {
    // 2026-07-11..07-13: unpinned window, ~59k floor, peaks to 393k with no thrash.
    const r = usableHeadroom(resolveCompactionWindow({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" } }), 59_000);
    expect(r.ok).toBe(true);
    expect(r.headroom).toBeGreaterThan(300_000);
  });

  it("reproduces the August failure: the 150k pin against the grown floor", () => {
    const pinned = resolveCompactionWindow({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } });
    // The ceiling this predicts must match what the transcripts actually show (116.0k-119.9k).
    expect(usableHeadroom(pinned, 0).ceiling).toBeGreaterThanOrEqual(115_000);
    expect(usableHeadroom(pinned, 0).ceiling).toBeLessThanOrEqual(120_000);

    expect(usableHeadroom(pinned, 55_000).ok).toBe(true); // July — was fine, and was
    const august = usableHeadroom(pinned, 86_000);
    expect(august.ok).toBe(false); // August — thrashed, and this says so
    expect(august.reason).toContain("thrashing");
    expect(usableHeadroom(pinned, 128_085).headroom).toBeLessThan(0); // the 2026-08-04 session
  });

  it("does not let a bigger window paper over an unbounded floor", () => {
    // Re-pinned 2026-08-18 (law-3 corollary: a guard whose law the change supersedes gets re-pinned,
    // not deleted). The intent is unchanged — a growing floor must still fail regardless of window.
    // The NUMBERS moved because the ceiling model was corrected from window*0.77 to window-33k:
    // at 250k the real ceiling is 217k, not 192.5k, so the breach point moved from 132.5k to 157k.
    const wide = resolveCompactionWindow({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "250000" } });
    expect(usableHeadroom(wide, 86_000).ok).toBe(true);
    expect(usableHeadroom(wide, 160_000).ok).toBe(false); // floor still wins if it keeps growing

    // The cutoff is exactly ceiling − MIN_WORKING_HEADROOM, with no slack either side.
    const breach = 217_000 - MIN_WORKING_HEADROOM;
    expect(usableHeadroom(wide, breach).ok).toBe(true);
    expect(usableHeadroom(wide, breach + 1).ok).toBe(false);
  });

  it("the corrected ceiling reproduces BOTH measured windows; the retired fraction reproduced only one", () => {
    // This is the whole case for the 2026-08-18 correction, as an assertion rather than a claim.
    // 150k window, measured peak band 116.0k-119.9k (20+ sessions, pre-2026-08-07).
    // 250k window, measured peak band 216k-217k (12+ sessions, post-2026-08-07).
    // additive (window-33k):   150k -> 117k  ✓ inside band   |  250k -> 217k  ✓ inside band
    // proportional (0.77):     150k -> 115.5k ✓ just inside  |  250k -> 192.5k ✗ short by 24k
    const at150 = resolveCompactionWindow({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000" } });
    const at250 = resolveCompactionWindow({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "250000" } });
    expect(usableHeadroom(at150, 0).ceiling).toBeGreaterThanOrEqual(116_000);
    expect(usableHeadroom(at150, 0).ceiling).toBeLessThanOrEqual(120_000);
    expect(usableHeadroom(at250, 0).ceiling).toBeGreaterThanOrEqual(216_000);
    expect(usableHeadroom(at250, 0).ceiling).toBeLessThanOrEqual(218_000);
  });

  it("treats a missing or junk floor as zero rather than passing by accident", () => {
    const w = resolveCompactionWindow({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "250000" } });
    for (const bad of [undefined, null, NaN, "abc", -5_000]) {
      expect(usableHeadroom(w, bad).floor).toBe(0);
    }
  });
});

describe("this repo's live configuration, against this machine's measured floor", () => {
  const resolved = resolveCompactionWindow({ settings: loadProjectSettings(REPO_ROOT) });

  it("has the window configured in .claude/settings.json, not left to a fallback", () => {
    expect(resolved.configured).toBe(true);
    expect(resolved.source).toBe("settings");
    expect(resolved.ignored).toEqual([]);
  });

  it("leaves a real session enough room to work in", () => {
    const floor = measureFloor();
    if (floor === null) {
      // Honest skip, not a silent pass: without transcripts there is nothing to measure.
      console.warn("context-headroom-guard: no recent sentinel transcripts — floor check skipped");
      return;
    }
    const r = usableHeadroom(resolved, floor);
    expect(r.ok, r.reason).toBe(true);
    expect(r.headroom).toBeGreaterThanOrEqual(MIN_WORKING_HEADROOM);
  });
});
