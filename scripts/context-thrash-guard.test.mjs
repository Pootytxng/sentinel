// bug→guard, 2026-08-07: `.claude/hooks/context-size-advisor.mjs` v4 warned on ABSOLUTE context size
// only — 85% of CLAUDE_CODE_AUTO_COMPACT_WINDOW, i.e. 127,500 tokens at the configured 150k. A
// measured session peaked at 123k and never crossed that line, so the advisor never fired once, while
// the harness's own "Autocompact is thrashing" dialog fired repeatedly and the owner had to notice it
// himself. An advisory that cannot fire is worse than none, because it reads as coverage.
//
// So the FIRST case here is the thrash case: it proves the hook fires at all. That ordering is the
// direct lesson of big-read-guard v1, which was dead in production (a `require` in an ESM file,
// swallowed by a fail-open catch) and whose test suite would have caught it in one assertion.

import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THRASH_LIMITS, appendSeries, describeThrash, detectThrash } from "./lib/context-thrash.mjs";

// Derive the path the way scripts/big-read-guard.test.mjs does, and for the same reason: Vite
// statically rewrites the `new URL("...", import.meta.url)` form for asset handling, so under Vitest
// that expression no longer carries the file: scheme and fileURLToPath throws at COLLECTION time —
// zero tests run, which reads exactly like a passing suite if you only skim the summary line.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, ".claude", "hooks", "context-size-advisor.mjs");

let seq = 0;
/**
 * Unique per call AND per run: the hook keeps per-session markers in tmpdir keyed by session id, and
 * those files outlive the run. `pid-seq` alone is NOT unique — Windows recycles pids, so a later run
 * can inherit an earlier run's thrash series and fire early (or stay silent because the earlier run
 * already tripped the once-per-session marker). Measured 2026-08-11: a full-suite gate run failed two
 * assertions here against 1,389 leftover marker files, while the same file passed in isolation.
 */
const freshSession = () => `test-${process.pid}-${randomUUID()}-${++seq}`;

/**
 * Drive the hook turn by turn against a synthetic transcript, exactly as the Stop event does.
 * Returns one entry per turn: the parsed advisory, or null when the hook stayed silent.
 */
function runTurns(ctxSeries, { sid = freshSession(), stopHookActive = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ctx-advisor-"));
  const tp = join(dir, "transcript.jsonl");
  writeFileSync(tp, "");
  const outs = [];
  for (const ctx of ctxSeries) {
    appendFileSync(
      tp,
      JSON.stringify({
        type: "assistant",
        message: {
          usage: { input_tokens: ctx, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }) + "\n",
    );
    const payload = { session_id: sid, transcript_path: tp };
    if (stopHookActive) payload.stop_hook_active = true;
    const res = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_AUTO_COMPACT_WINDOW: "150000", CLAUDE_PROJECT_DIR: dir },
    });
    expect(res.error).toBeUndefined();
    expect(res.status, `hook exited ${res.status}: ${res.stderr}`).toBe(0);
    outs.push(res.stdout.trim() ? JSON.parse(res.stdout) : null);
  }
  return outs;
}

describe("context-size-advisor fires on the measured thrash signature", () => {
  // THE case v4 could not see: every value here is BELOW the 127.5k warn line, so size alone is blind.
  it("warns once two fast refills have actually happened, and not before", () => {
    const outs = runTurns([100_000, 100_000, 0, 100_000, 100_000, 0, 100_000]);

    // One rebound is noise (THRASH_LIMITS.MIN_REBOUNDS = 2), so everything up to the second is silent.
    expect(outs.slice(0, 6)).toEqual([null, null, null, null, null, null]);

    const last = outs[6];
    expect(last, "the hook must fire on the second fast refill").not.toBeNull();
    expect(last.decision).toBe("block");
    expect(last.reason).toMatch(/thrash/i);
  });

  it("names /clear and the one bounded resume file, since that is the whole point of the advisory", () => {
    const outs = runTurns([100_000, 100_000, 0, 100_000, 100_000, 0, 100_000]);
    const reason = outs[6].reason;
    expect(reason).toContain("/clear");
    expect(reason).toContain("docs/SESSION_HANDOFF.md");
  });

  // #466: the owner ordered sessions to stop pasting a line for HIM to act on and instead launch the
  // next session themselves. "that one line IS the handoff" was the literal old instruction; its
  // replacement must name the script that makes the launch checkable instead of asserted.
  it("launches a successor from the resume point instead of asking the owner to relay one line", () => {
    const outs = runTurns([100_000, 100_000, 0, 100_000, 100_000, 0, 100_000]);
    const reason = outs[6].reason;
    expect(reason).toContain("successor-route");
    expect(reason).not.toContain("that one line IS the handoff");
  });

  it("stays silent through a HEALTHY compaction that actually reclaimed something", () => {
    // The contrast case from the same measured session: 119k -> 88k took 48 turns to climb back.
    expect(runTurns([100_000, 100_000, 60_000, 65_000, 70_000, 75_000])).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("stays silent on a quiet session", () => {
    expect(runTurns([20_000, 30_000, 40_000])).toEqual([null, null, null]);
  });
});

describe("context-size-advisor stays safe at the edges", () => {
  it("does nothing when it is already running inside a stop hook", () => {
    expect(runTurns([100_000, 0, 100_000, 0, 100_000], { stopHookActive: true })).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("exits clean on garbage stdin instead of blocking the turn", () => {
    for (const bad of ["", "not json", "[]", "{}"]) {
      const res = spawnSync(process.execPath, [HOOK], { input: bad, encoding: "utf8" });
      expect(res.error).toBeUndefined();
      expect(res.status, `input ${JSON.stringify(bad)}`).toBe(0);
      expect(res.stdout.trim()).toBe("");
    }
  });

  it("no longer forbids escalating to /clear in the size checkpoint", () => {
    // v4's checkpoint said "do NOT ask the owner to /clear" absolutely, which forbade exactly the
    // move this lane exists to automate. Escalation now routes through the THRASHING advisory.
    const outs = runTurns([130_000]);
    expect(outs[0]).not.toBeNull();
    expect(outs[0].reason).not.toContain("do NOT ask the owner to /clear");
  });
});

describe("thrash arithmetic", () => {
  it("flags a compaction that landed with no headroom, on a single event", () => {
    // 145k -> 106k is a real drop, and 106k is already 71% of the window: nothing left to reclaim.
    const r = detectThrash([145_000, 106_000, 106_000], 150_000);
    expect(r.floorHits.length).toBe(1);
    expect(r.thrashing).toBe(true);
    expect(describeThrash(r, 150_000)).toContain("reclaimed almost nothing");
  });

  it("returns no verdict when nothing is wrong", () => {
    const r = detectThrash([100_000, 90_000, 80_000], 150_000);
    expect(r.thrashing).toBe(false);
    expect(describeThrash(r, 150_000)).toBeNull();
  });

  it("does not count a drop at the very end, where the rebound is not yet knowable", () => {
    expect(detectThrash([100_000, 0], 150_000).rebounds).toEqual([]);
  });

  it("drops a repeated measurement, which would stretch a 1-turn rebound into a 2-turn one", () => {
    expect(appendSeries("100,0", 0).series).toEqual([100, 0]);
    expect(appendSeries("100,0", 100).series).toEqual([100, 0, 100]);
    expect(appendSeries("", 100).series).toEqual([100]);
    expect(appendSeries("junk,,abc", 100).series).toEqual([100]);
  });

  it("stays bounded — an unbounded monitor would be the very thing this fights", () => {
    const long = Array.from({ length: 200 }, (_, i) => i + 1).join(",");
    expect(appendSeries(long, 999, 60).series.length).toBe(60);
  });

  it("keeps the thresholds inside sane ranges so the guard cannot be quietly defanged", () => {
    expect(THRASH_LIMITS.DROP_FRACTION).toBeGreaterThanOrEqual(0.5);
    expect(THRASH_LIMITS.DROP_FRACTION).toBeLessThanOrEqual(0.9);
    expect(THRASH_LIMITS.REFILL_FRACTION).toBeGreaterThanOrEqual(0.75);
    expect(THRASH_LIMITS.REFILL_TURNS).toBeGreaterThanOrEqual(1);
    expect(THRASH_LIMITS.REFILL_TURNS).toBeLessThanOrEqual(4);
    expect(THRASH_LIMITS.MIN_REBOUNDS).toBeGreaterThanOrEqual(2);
    expect(THRASH_LIMITS.MIN_REBOUNDS).toBeLessThanOrEqual(4);
    expect(THRASH_LIMITS.FLOOR_FRACTION).toBeGreaterThanOrEqual(0.6);
    expect(THRASH_LIMITS.FLOOR_FRACTION).toBeLessThanOrEqual(0.85);
  });
});
