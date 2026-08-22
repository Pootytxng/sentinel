// @vitest-environment node
//
// Guard: a measurement must not leave the app running behind it (bug -> guard, 2026-08-22).
//
// WHAT HAPPENED. `q7-probe coldstart` kills every compy.exe at the START of each sample and never at
// the end, so the last sample's app stayed up -- a window the owner did not open, from a worktree's
// `target/release`, live on his desktop for twenty minutes. The untidiness was the small half. The
// real damage: `launch-focus-guard`'s RUNTIME tier refuses to measure while a compy holds the
// single-instance lock, so twelve consecutive attempts to reproduce issue #121 skipped themselves
// and each printed "Tests 47 passed". One instrument's leftover silently disabled another, and the
// twelve green runs were read as twelve clean measurements.
//
// TWO HALVES, and this file pins both:
//   1. THE RULE is a named function with its own unit tests -- kill what this run LAUNCHED, never
//      what it found. A probe that attaches to the owner's own app (`eval`, `restore`) must leave it
//      exactly as it was; killing that would be a worse bug than the leak.
//   2. THE WIRING is pinned by text, because the failure mode is a deleted call, not a wrong rule.
//      Both exits matter: a run that throws leaks as easily as one that succeeds -- more easily,
//      since the throw skips whatever the task would have done next.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldCleanUp, cleanUpReason } from "./lib/probe-cleanup.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = readFileSync(join(ROOT, "scripts", "q7-probe.mjs"), "utf8");

describe("the cleanup rule itself", () => {
  it("kills what this run launched", () => {
    expect(shouldCleanUp({ launchedByProbe: true, keepOpen: false })).toBe(true);
  });

  it("never kills an app it merely attached to", () => {
    // `eval` and `restore` drive an app the owner already had open. Killing it would close his
    // window to tidy up after a measurement that did not open it.
    expect(shouldCleanUp({ launchedByProbe: false, keepOpen: false })).toBe(false);
    expect(shouldCleanUp({ launchedByProbe: false, keepOpen: true })).toBe(false);
  });

  it("honours --keep-open, which is the by-hand case", () => {
    expect(shouldCleanUp({ launchedByProbe: true, keepOpen: true })).toBe(false);
  });

  it("defaults to doing nothing when it is told nothing", () => {
    // A missing state object must not be read as "launched" -- that would kill the owner's app on
    // any call path that forgot to pass it.
    expect(shouldCleanUp()).toBe(false);
    expect(shouldCleanUp({})).toBe(false);
  });

  it("explains each verdict in words, because the probe prints the reason", () => {
    expect(cleanUpReason({ launchedByProbe: true, keepOpen: false })).toMatch(/killing/i);
    expect(cleanUpReason({ launchedByProbe: true, keepOpen: true })).toMatch(/keep-open/i);
    expect(cleanUpReason({ launchedByProbe: false })).toMatch(/did not launch/i);
  });
});

describe("the probe is actually wired to the rule", () => {
  it("records that IT launched the app, in the launcher itself", () => {
    // Set anywhere else and the flag describes something other than "we started an app".
    const launcher = PROBE.slice(PROBE.indexOf("async function launch(port) {"));
    expect(
      launcher.slice(0, launcher.indexOf("\n}\n")),
      "launch() must set launchedByProbe, or the exit path cannot tell our app from his",
    ).toContain("launchedByProbe = true");
  });

  it("cleans up on the success path AND on the failure path", () => {
    const calls = (PROBE.match(/cleanUpLaunchedApp\(\)/g) ?? []).length;
    // One definition plus two call sites. A single call site means one of the two exits leaks.
    expect(
      calls,
      "cleanUpLaunchedApp must be called from BOTH the completed-task path and the catch block -- " +
        "a probe that throws leaks its app exactly like one that finishes",
    ).toBeGreaterThanOrEqual(3);
    const catchBlock = PROBE.slice(PROBE.indexOf("} catch (err) {"));
    expect(catchBlock, "the catch block must clean up before it exits").toContain("cleanUpLaunchedApp()");
  });

  it("decides through the shared rule rather than re-implementing it", () => {
    expect(PROBE).toContain('from "./lib/probe-cleanup.mjs"');
    expect(PROBE).toContain("shouldCleanUp(");
  });

  it("still documents the escape hatch in its own usage block", () => {
    expect(PROBE.slice(0, PROBE.indexOf("import ")), "--keep-open must be documented where the flags are")
      .toContain("--keep-open");
  });
});
