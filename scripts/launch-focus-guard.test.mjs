// @vitest-environment node
//
// Guard: a launch Compy's own TOOLING performs must never take the owner's foreground.
//
// Owner ask, 2026-08-11: "anytime the node.js module is being used ... make it to where it doesnt
// interrupt my forground process ... so it doesnt minimize my primary monitor atleast."
//
// The node processes were never the problem -- npm, vitest and the guards run inside the agent's
// hidden console and create no window at all. What interrupted him was the APP: `npm run tauri dev`
// and scripts/ship-reinstall.ps1's post-build relaunch both open a window that ACTIVATES, and on
// Windows an activating window minimises an exclusive-fullscreen game. A build finishing is not a
// reason to end his session.
//
// The rule this pins is "does not steal activation", NOT "is hidden". The window is still created,
// still visible, still on the taskbar -- he clicks it when he wants it. A hidden app would be a
// worse bug than the one being fixed, so `focusable` is deliberately out of scope: a window he
// cannot click into afterwards is broken, not polite.
//
// Why a text guard when src-tauri/src/lib.rs already unit-tests `should_suppress_activation`:
// those tests prove the DECISION, and a correct decision nothing consumes changes no behaviour.
// This file pins the WIRING -- that run() actually applies it to the window config before the
// window exists, and that the ship path actually sets the variable. Both are one-line deletions
// away from silently reverting, and the symptom (a game minimising after a build) would show up on
// the owner's machine, not in any test output.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const LIB_RS = read("src-tauri", "src", "lib.rs");
const SHIP = read("scripts", "ship-reinstall.ps1");
const CONSOLE_START = read("tools", "console", "start.ps1");

/** The body of `pub fn run()` up to the builder call -- where the decision must be applied. */
function runPrelude(source) {
  const start = source.indexOf("pub fn run() {");
  expect(start, "src-tauri/src/lib.rs must still define `pub fn run()`").toBeGreaterThan(-1);
  const builder = source.indexOf("tauri::Builder::default()", start);
  expect(builder, "`run()` must still build the Tauri app").toBeGreaterThan(start);
  return source.slice(start, builder);
}

describe("the app decides activation BEFORE the window exists", () => {
  it("run() suppresses activation by mutating the window CONFIG, not the built window", () => {
    const prelude = runPrelude(LIB_RS);
    // Applying this in `setup` would be too late: the window is already up and has already taken the
    // foreground, so un-focusing there is a snatch-and-return that has already minimised the game.
    expect(prelude).toMatch(/should_suppress_activation\s*\(/);
    expect(prelude).toMatch(/config_mut\(\)\.app\.windows/);
    expect(prelude).toMatch(/window\.focus\s*=\s*false/);
  });

  it("run() reads both environment levers and hands them to the decision", () => {
    const prelude = runPrelude(LIB_RS);
    expect(prelude).toContain("COMPY_NO_ACTIVATE");
    expect(prelude).toContain("COMPY_ACTIVATE");
    // A dev build is tooling-initiated by definition, so quiet is its DEFAULT rather than something
    // every launcher has to remember to opt into.
    expect(prelude).toMatch(/cfg!\(debug_assertions\)/);
  });

  it("passes the mutated context to run(), not a freshly generated one", () => {
    // `.run(tauri::generate_context!())` would compile, pass every unit test, and silently discard
    // every suppression this guard checks for.
    expect(LIB_RS).toMatch(/\.run\(context\)/);
    expect(LIB_RS).not.toMatch(/\.run\(tauri::generate_context!\(\)\)/);
  });

  it("leaves `focusable` alone, so the owner can still click into the window", () => {
    expect(LIB_RS).not.toMatch(/focusable\s*=\s*false/);
  });
});

describe("the ship path relaunches without stealing the foreground", () => {
  it("sets COMPY_NO_ACTIVATE before it launches the installed exe", () => {
    const setter = SHIP.search(/\$env:COMPY_NO_ACTIVATE\s*=\s*"1"/);
    expect(setter, "scripts/ship-reinstall.ps1 must set COMPY_NO_ACTIVATE").toBeGreaterThan(-1);
    const firstLaunch = SHIP.search(/Start-NativeProcess\s+-Command\s+\$exe/);
    expect(firstLaunch, "ship-reinstall must still launch the installed exe").toBeGreaterThan(-1);
    // Ordering is the whole point: set after the launch and the child has already inherited nothing.
    expect(setter).toBeLessThan(firstLaunch);
  });

  it("sets it on THIS process, because a detached child cannot take a child-only environment", () => {
    // ShellExecute has no per-child environment -- Start-NativeProcess refuses -Detached with
    // -Environment for exactly this reason. Parent-process assignment is the sanctioned route.
    expect(SHIP).not.toMatch(/-Detached[^\r\n]*-Environment/);
  });
});

describe("the console browser opens quietly only when tooling started it", () => {
  it("every browser launch carries an explicit window style", () => {
    const launches = CONSOLE_START.split(/\r?\n/).filter((line) => /^\s*Start-Process\b/.test(line));
    expect(launches.length).toBeGreaterThan(0);
    for (const line of launches) {
      expect(line, `${line.trim()} must name a -WindowStyle`).toMatch(/-WindowStyle\s+\$?\w+/);
    }
  });

  it("opens normally for the owner and minimised for tooling", () => {
    // When HE runs start.ps1 he is asking to look at the console; that window is not an interruption
    // and must not be hidden from him. Only a tooling-initiated start goes quiet.
    expect(CONSOLE_START).toMatch(/COMPY_NO_ACTIVATE/);
    expect(CONSOLE_START).toMatch(/"Minimized"/);
    expect(CONSOLE_START).toMatch(/"Normal"/);
  });

  it("treats an empty or zero value as OFF, matching the Rust reader", () => {
    // Two readers of one variable that disagree about `""` is a lever that cannot be released once
    // anything upstream exports the name. `is_env_flag_set` in lib.rs holds the same contract.
    expect(CONSOLE_START).toMatch(/COMPY_NO_ACTIVATE\.Trim\(\)\s*-ne\s*"0"/);
    expect(LIB_RS).toMatch(/fn is_env_flag_set/);
  });
});
