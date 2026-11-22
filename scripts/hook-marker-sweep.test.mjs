// @vitest-environment node
// D1f: the four repo hooks that keep per-session marker files in the temp folder remove ONLY their own
// stale markers (scripts/lib/hook-marker-sweep.mjs). One block per hook: the hook really calls the sweep
// for itself, every marker name it writes is one its pattern covers, and the sweep run against a scratch
// folder removes exactly its own old marker files and nothing else.
import { afterEach, describe, expect, it } from "vitest";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKERS, MAX_AGE_MS, RESUME_AFTER_MS, SWEEP_EVERY_MS, sweepOwnMarkers } from "./lib/hook-marker-sweep.mjs";

const HOOKS_DIR = join(import.meta.dirname, "..", ".claude", "hooks");
const DAY = 24 * 60 * 60 * 1000;

let scratch;
afterEach(() => {
  try {
    // `force` does not swallow EBUSY/EPERM on Windows: a failed cleanup must not turn the gate red.
    if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* left in the temp folder */
  }
  scratch = undefined;
});

/** A file `name` in `dir`, last modified `ageMs` before `now`. */
function plant(dir, name, now, ageMs) {
  const p = join(dir, name);
  writeFileSync(p, "x");
  const t = (now - ageMs) / 1000;
  utimesSync(p, t, t);
  return p;
}

/** The marker names a hook's source writes: each `compy-...${sid}...` template, with a sample session id. */
function writtenNames(source) {
  return [...source.matchAll(/`(compy-[a-z-]*)\$\{sid\}([^`]*)`/g)].map((m) => `${m[1]}ab-12-cd${m[2]}`);
}

for (const hook of Object.keys(MARKERS)) {
  describe(`${hook}: sweeps its own stale markers and nothing else`, () => {
    const source = readFileSync(join(HOOKS_DIR, `${hook}.mjs`), "utf8");

    it("calls the sweep for itself, in the temp folder", () => {
      expect(source).toContain(`sweepOwnMarkers("${hook}", tmpdir())`);
    });

    it("every marker name it writes is covered by its pattern, and no other hook's is", () => {
      const names = writtenNames(source);
      expect(names.length, "found the marker names the hook writes").toBeGreaterThan(0);
      for (const name of names) {
        expect(MARKERS[hook].pattern.test(name), name).toBe(true);
        for (const other of Object.keys(MARKERS).filter((h) => h !== hook)) {
          expect(MARKERS[other].pattern.test(name), `${other} must not claim ${name}`).toBe(false);
        }
      }
    });

    it("removes only its own regular files older than two days, once a day", () => {
      scratch = mkdtempSync(join(tmpdir(), "compy-hook-sweep-test-"));
      const now = Date.now();
      const own = writtenNames(source)[0];
      const oldOwn = plant(scratch, own, now, MAX_AGE_MS + DAY);
      const freshOwn = plant(scratch, own.replace("ab-12-cd", "fresh-1"), now, MAX_AGE_MS - DAY);
      const otherHook = Object.keys(MARKERS).find((h) => h !== hook);
      const otherName = writtenNames(readFileSync(join(HOOKS_DIR, `${otherHook}.mjs`), "utf8"))[0];
      const oldOther = plant(scratch, otherName, now, MAX_AGE_MS + DAY);
      const unrelated = plant(scratch, "compy-cmp-race-1234-5", now, MAX_AGE_MS + DAY);
      const lookalike = plant(scratch, `${own}.bak`, now, MAX_AGE_MS + DAY); // not the whole-name pattern
      // A folder that matches the pattern is never touched, nor anything inside it.
      const folder = join(scratch, own.replace("ab-12-cd", "folder-9"));
      mkdirSync(folder);
      const inside = plant(folder, own, now, MAX_AGE_MS + DAY);
      // The folder itself is old too (planting inside it made it fresh), so only its type keeps it.
      const folderTime = (now - MAX_AGE_MS - DAY) / 1000;
      utimesSync(folder, folderTime, folderTime);
      expect(now - lstatSync(folder).mtimeMs, "the folder is past the age limit").toBeGreaterThan(MAX_AGE_MS);

      const removed = sweepOwnMarkers(hook, scratch, now);
      expect(removed).toEqual([own]);
      expect(existsSync(oldOwn)).toBe(false);
      for (const kept of [freshOwn, oldOther, unrelated, lookalike, folder, inside]) {
        expect(existsSync(kept), kept).toBe(true);
      }
      expect(existsSync(join(scratch, MARKERS[hook].stamp)), "the sweep leaves its stamp").toBe(true);

      // Within a day of the last sweep nothing is listed or removed, even a newly stale marker.
      const again = plant(scratch, own, now, MAX_AGE_MS + DAY);
      expect(sweepOwnMarkers(hook, scratch, now + DAY / 2)).toEqual([]);
      expect(existsSync(again)).toBe(true);
      // A day later it sweeps again (by then the "fresh" marker is past two days too).
      const freshName = own.replace("ab-12-cd", "fresh-1");
      expect(sweepOwnMarkers(hook, scratch, now + SWEEP_EVERY_MS + DAY).sort()).toEqual([own, freshName].sort());
      expect(existsSync(oldOther) && existsSync(unrelated) && existsSync(inside)).toBe(true);
    });

    it("out of time, it stops, back-dates its stamp and carries on a minute later", () => {
      scratch = mkdtempSync(join(tmpdir(), "compy-hook-sweep-test-"));
      const now = Date.now();
      const own = writtenNames(source)[0];
      const oldOwn = plant(scratch, own, now, MAX_AGE_MS + DAY);
      // A zero budget is spent before the first entry: nothing is removed this run.
      expect(sweepOwnMarkers(hook, scratch, now, 0)).toEqual([]);
      expect(existsSync(oldOwn)).toBe(true);
      const stampAge = now - lstatSync(join(scratch, MARKERS[hook].stamp)).mtimeMs;
      expect(Math.abs(stampAge - (SWEEP_EVERY_MS - RESUME_AFTER_MS)), "stamp back-dated").toBeLessThan(2000);
      // Not yet due half a minute later; due once the minute has passed, and then it finishes the job.
      expect(sweepOwnMarkers(hook, scratch, now + RESUME_AFTER_MS / 2)).toEqual([]);
      expect(sweepOwnMarkers(hook, scratch, now + RESUME_AFTER_MS + 1000)).toEqual([own]);
      expect(existsSync(oldOwn)).toBe(false);
    });

    it("a stamp path that is not a regular file is left alone and nothing is swept", () => {
      scratch = mkdtempSync(join(tmpdir(), "compy-hook-sweep-test-"));
      const now = Date.now();
      const own = writtenNames(source)[0];
      const oldOwn = plant(scratch, own, now, MAX_AGE_MS + DAY);
      const stampDir = join(scratch, MARKERS[hook].stamp);
      mkdirSync(stampDir);
      expect(sweepOwnMarkers(hook, scratch, now)).toEqual([]);
      expect(lstatSync(stampDir).isDirectory()).toBe(true);
      expect(existsSync(oldOwn)).toBe(true);
    });

    it("never throws: a folder that does not exist is a no-op", () => {
      expect(sweepOwnMarkers(hook, join(tmpdir(), "compy-hook-sweep-test-missing-zz", "nope"), Date.now())).toEqual([]);
    });
  });
}

it("an unknown hook name sweeps nothing", () => {
  expect(sweepOwnMarkers("not-a-hook", tmpdir(), Date.now())).toEqual([]);
});
