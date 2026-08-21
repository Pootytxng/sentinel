// @vitest-environment node
//
// Guard: a launch Compy's own TOOLING performs must never take the owner's foreground.
//
// Owner ask, 2026-08-11: "anytime the node.js module is being used ... make it to where it doesnt
// interrupt my forground process ... so it doesnt minimize my primary monitor atleast."
//
// The node processes were never the problem -- npm, vitest and the guards run inside the agent's
// hidden console and create no window at all (that half is `console-window-guard.test.mjs`). What
// interrupted him was the APP: `npm run tauri dev` and scripts/ship-reinstall.ps1's post-build
// relaunch both open a window that ACTIVATES, and on Windows an activating window minimises an
// exclusive-fullscreen game. A build finishing is not a reason to end his session.
//
// The rule this pins is "does not steal activation", NOT "is hidden". The window is still created,
// still visible, still on the taskbar -- he clicks it when he wants it. A hidden app would be a
// worse bug than the one being fixed, so `focusable` is deliberately out of scope: a window he
// cannot click into afterwards is broken, not polite.
//
// ── WHY THERE IS A RUNTIME TIER ──────────────────────────────────────────────────────────────────
// The first version of this file was static only. It read lib.rs, asserted the right words were
// present, and passed green across an entire lane while the feature did NOTHING -- the config was
// being set correctly and then overridden a moment later by the window-state plugin's
// `show()` + `set_focus()`. It took three hand-run measurements to find that, and one of them
// minimised the owner's game: the exact harm the guard claimed to prevent.
//
// So the tiers divide like this, and neither replaces the other:
//   STATIC  -- pins the WIRING: that the decision is made before the window exists, that the
//              overriding plugin flag stays off, that the ship path sets both levers. These are all
//              one-line deletions away from silently reverting.
//   RUNTIME -- pins the BEHAVIOUR: launches the real binary and watches GetForegroundWindow. This is
//              the only tier that can tell a working fix from a well-worded one.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { windows } from "./lib/windows-only.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const LIB_RS = read("src-tauri", "src", "lib.rs");
const TRAY_RS = read("src-tauri", "src", "tray.rs");
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

  it("run() reads every lever and hands them to the decision", () => {
    const prelude = runPrelude(LIB_RS);
    expect(prelude).toContain("COMPY_NO_ACTIVATE");
    expect(prelude).toContain("COMPY_ACTIVATE");
    // A dev build is tooling-initiated by definition, so quiet is its DEFAULT rather than something
    // every launcher has to remember to opt into.
    expect(prelude).toMatch(/cfg!\(debug_assertions\)/);
    // argv, because an environment variable cannot reach a process that is already running.
    expect(prelude).toMatch(/argv_asks_for_quiet_launch\s*\(/);
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

describe("nothing downstream is allowed to re-focus the window", () => {
  // THE REGRESSION THIS FILE EXISTS FOR. tauri-plugin-window-state's `on_window_ready` runs before
  // our `setup`, and its `restore_state` ends with an unconditional `show()` + `set_focus()`
  // whenever StateFlags::VISIBLE is set (2.4.1, src/lib.rs:262-264). `set_focus` calls Win32
  // SetForegroundWindow, which overrides the polite SW_SHOWNOACTIVATE the config just bought. Put
  // VISIBLE back -- or drop `with_state_flags` and take the default, which is `all()` -- and the
  // whole feature silently reverts to inert while every other assertion here still passes.
  it("the window-state plugin is configured WITHOUT StateFlags::VISIBLE", () => {
    const plugin = LIB_RS.slice(
      LIB_RS.indexOf("tauri_plugin_window_state::Builder::default()"),
      LIB_RS.indexOf(".invoke_handler("),
    );
    expect(plugin, "window-state plugin registration must still exist").toContain("with_denylist");
    expect(plugin).toMatch(/with_state_flags\s*\(/);
    expect(plugin).toMatch(/StateFlags::all\(\)\s*-\s*tauri_plugin_window_state::StateFlags::VISIBLE/);
  });

  it("a QUIET launch also drops StateFlags::MAXIMIZED, because SW_MAXIMIZE is an activating show", () => {
    // FOUND 2026-08-13 while chasing issue #121: the runtime tier's first-ever strict run (idle
    // desk, foreground rights granted) fronted a --no-activate launch seeded with a maximized saved
    // state for 54/54 samples against the v0.9.17 binary — every earlier green was a skip (Compy
    // already running) or a weak run (rights refused, so nothing could have activated).
    // `restore_state` reaches maximize through ShowWindow(SW_MAXIMIZE), an ACTIVATING show command,
    // so a quiet launch must never issue it — a real vector even though #121's measurement later
    // showed a second, system-level fronting that this fix does not (and cannot) close. The fix
    // branches the state flags on `suppress_activation`; this pins that branch so a one-line
    // "simplification" back to a single flag set cannot silently rearm the steal.
    const plugin = LIB_RS.slice(
      LIB_RS.indexOf("tauri_plugin_window_state::Builder::default()"),
      LIB_RS.indexOf(".invoke_handler("),
    );
    expect(plugin).toMatch(/with_state_flags\s*\(\s*if\s+suppress_activation\b/);
    expect(plugin).toMatch(
      /StateFlags::all\(\)\s*-\s*tauri_plugin_window_state::StateFlags::VISIBLE\s*-\s*tauri_plugin_window_state::StateFlags::MAXIMIZED/,
    );
  });

  it("the relaunch path carries the caller's intent instead of focusing regardless", () => {
    // `show_or_recreate_main` used to call `set_focus()` unconditionally, so a tooling relaunch that
    // found a live instance stole the foreground no matter what the new process had been told.
    //
    // Pinned statically ON PURPOSE -- the runtime tier below deliberately does NOT assert on the
    // relaunch case, and that is a measurement, not an omission. With this handler gutted to a
    // literal no-op and rebuilt, the live window still came forward for 35 of 37 samples: when a
    // second process of the same app starts and exits, Windows can raise the existing instance by
    // itself. `set_focus()` is still worth gating (it reaches SetForegroundWindow through tao's
    // AttachThreadInput dance, which bypasses the foreground lock and therefore raises even where
    // the OS would not), but no in-process change can make a relaunch reliably silent, and a guard
    // that demanded it would be asserting Windows' behaviour, not Compy's.
    // Reproduce: scripts/lib/foreground-probe.ps1 -RelaunchWith quiet|loud.
    expect(TRAY_RS).toMatch(/fn show_or_recreate_main\(app: &AppHandle, activate: bool\)/);
    const body = TRAY_RS.slice(TRAY_RS.indexOf("fn show_or_recreate_main"));
    const focusCall = body.indexOf("set_focus()");
    expect(focusCall, "the restore path must still be able to focus").toBeGreaterThan(-1);
    // The focus must sit inside the `if activate` branch, not beside it.
    expect(body.slice(0, focusCall)).toMatch(/if activate \{\s*$/m);
  });

  it("the single-instance handler reads the second launch's argv", () => {
    const handler = LIB_RS.slice(
      LIB_RS.indexOf("tauri_plugin_single_instance::init("),
      LIB_RS.indexOf(".plugin(tauri_plugin_opener::init())"),
    );
    expect(handler).toMatch(/argv_asks_for_quiet_launch\s*\(/);
    expect(handler).toMatch(/show_or_recreate_main\(app,\s*!quiet\)/);
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

  it("also passes the argv token, which is the half that survives the single-instance hop", () => {
    // If an older Compy is still alive, the new process hands it only its command line and dies.
    // An env-only lever would be dropped exactly when the owner has the app open.
    expect(SHIP).toMatch(/\$quietLaunchArgs\s*=\s*@\("--no-activate"\)/);
    for (const launch of SHIP.split(/\r?\n/).filter((l) => /Start-NativeProcess -Command \$exe/.test(l))) {
      expect(launch, `${launch.trim()} must carry the quiet argv`).toMatch(/-ArgumentList \$quietLaunchArgs/);
    }
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

// ── RUNTIME TIER ────────────────────────────────────────────────────────────────────────────────

const PROBE = join(ROOT, "scripts", "lib", "foreground-probe.ps1");
const TAURI_IDENTIFIER = JSON.parse(read("src-tauri", "tauri.conf.json")).identifier;

/**
 * A saved window state that comes back MAXIMIZED. The riskiest restore path: the window-state plugin
 * reaches maximize through `ShowWindow(SW_MAXIMIZE)`, which is an ACTIVATING show command, so a
 * maximized window is where a "quiet" launch is most likely to come forward anyway. Seeding it costs
 * the measurement nothing and covers the case the owner is one double-click away from creating.
 */
const MAXIMIZED_STATE = {
  main: {
    width: 1148,
    height: 840,
    x: 100,
    y: 50,
    prev_x: 100,
    prev_y: 50,
    maximized: true,
    visible: true,
    decorated: false,
    fullscreen: false,
  },
};

/** The probe's sampling interval, from `scripts/lib/foreground-probe.ps1` (`[int]$IntervalMs`).
 *  It is this file's RESOLUTION: two events stamped less than one interval apart were seen in the
 *  same poll, so their order is an artifact of the poll, not a measurement. Pinned against drift by
 *  a test below. */
const PROBE_INTERVAL_MS = 100;

/**
 * WHICH reading is this? The count alone cannot say, and answering it is the difference between a
 * guard and a coin flip.
 *
 * `"in-process-raise"` — Compy reached the foreground at least one full sample AFTER its own window
 * existed. Nothing outside the process is plausibly waiting 100ms+ past window creation to front a
 * launch; this is something in-process raising it (tao's `set_focus` raises through
 * `AttachThreadInput`, which fronts a window even where the OS would refuse). ALWAYS a failure. The
 * 2026-08-18 readings in BACKLOG — 2430ms, and 132ms with the window at 13ms — classify here.
 *
 * `"unattributable-at-launch"` — Compy owned the foreground, but the foreground and the window were
 * first seen within ONE sample of each other. **This does not prove Windows fronted it**, which is
 * what an earlier version of this function claimed and an independent review correctly rejected on
 * 2026-08-18: inside one loop iteration the probe reads the foreground first and the window second,
 * with a `Process.Refresh()` (a slow, heuristic API) in between, so a few-ms "foreground first" lead
 * is exactly what a fast launch produces whichever cause is real. The honest statement is that at
 * 100ms polling the two causes are indistinguishable — an in-process raise that beat the first
 * sample looks identical to Windows fronting a fresh launch (issue #121). So the run is reported
 * UNMEASURABLE by name, the same category as "a compy was already running", rather than being
 * scored either way. Closing this needs a finer instrument (an event hook on
 * EVENT_SYSTEM_FOREGROUND), not a finer opinion — logged in BACKLOG under #121.
 *
 * This is deliberately NOT a skip of the failing case: the in-process class stays a hard zero, the
 * discriminator is a real margin rather than a sign test, and an unmeasurable run says so by name.
 */
export function classifyForegroundReading({
  ownedForegroundSamples,
  firstForegroundMs,
  firstWindowMs,
  intervalMs = PROBE_INTERVAL_MS,
}) {
  if (!ownedForegroundSamples) return "clean";
  // Owning the foreground with no timing for it is a broken reading; treat it as the defect, never
  // as an excuse.
  if (firstForegroundMs < 0 || firstWindowMs < 0) return "in-process-raise";
  if (firstForegroundMs - firstWindowMs > intervalMs) return "in-process-raise";
  return "unattributable-at-launch";
}

/**
 * WHAT raised it — read off the probe's WinEvent trace (issue #121, the instrument the 2026-08-18
 * split asked for). The poll above sees the foreground at 100ms grain and cannot order two events
 * inside one iteration; the trace is stamped as each event arrives and carries the CLASS and OWNING
 * PROCESS of every window that took focus, so the question "who did this" has an answer:
 *
 *   focus lands on `Chrome_WidgetWin_*` / `Chrome_RenderWidgetHostHWND` owned by msedgewebview2.exe
 *     → the WebView2 runtime raised the window (its process is a child of compy.exe: `family`);
 *   focus lands on the tao top-level / `WRY_WEBVIEW` owned by compy.exe itself
 *     → in-process (tao's set_focus, an activating ShowWindow, the window-state plugin);
 *   the family takes the foreground with NO family focus event near it
 *     → something outside the launched tree fronted it (the launcher, the shell);
 *   a MINIMIZESTART on a window OUTSIDE the family is the owner's window going down: the harm itself.
 *
 * Pure, so it runs on every machine against recorded traces. It summarises; the gate's verdict is
 * still `classifyForegroundReading` until a measured trace has been read — a summary is not a law.
 */
export function summarizeTrace({ events = [], launchedPid, familyPids = [] } = {}) {
  const family = new Set([launchedPid, ...familyPids].filter((p) => Number.isInteger(p)));
  const inFamily = (e) => e.family === true || family.has(e.pid) || family.has(e.rootPid);
  const show =
    events.find((e) => e.kind === "SHOW" && e.pid === launchedPid && e.root === e.hwnd) ??
    events.find((e) => e.kind === "SHOW" && inFamily(e)) ??
    null;
  const foreground = events.find((e) => e.kind === "FOREGROUND" && inFamily(e)) ?? null;
  const focusEvents = events.filter((e) => e.kind === "FOCUS" && inFamily(e));
  const window = 250; // ms either side of the foreground change that still counts as "this raise"
  const focusBefore = foreground
    ? (focusEvents.filter((e) => e.ms <= foreground.ms && e.ms >= foreground.ms - window).pop() ?? null)
    : null;
  const focusAfter = foreground
    ? (focusEvents.find((e) => e.ms >= foreground.ms && e.ms <= foreground.ms + window) ?? null)
    : null;
  const taker = focusBefore ?? focusAfter;
  // A window OUTSIDE the launch leaving the foreground just before the family got it: Windows hands
  // the foreground to the next window in Z-order when the active one minimises or dies, and a
  // freshly created window sits at the top of that order even when it was shown without
  // activation. Recorded 2026-08-20 with a sibling's "hidden" console child: Windows Terminal fronted
  // at +59ms, minimised at +307ms, and the foreground fell to whatever was next. Checked BEFORE the
  // focus taker, because focus lands on the inheriting window afterwards whichever way it got there.
  const handoffWindow = 500;
  const handoff = foreground
    ? (events
        .filter((e) => (e.kind === "MINIMIZESTART" || e.kind === "DESTROY") && !inFamily(e) && e.ms <= foreground.ms && e.ms >= foreground.ms - handoffWindow)
        .pop() ?? null)
    : null;
  const priorForeground = foreground
    ? (events.filter((e) => e.kind === "FOREGROUND" && !inFamily(e) && e.ms <= foreground.ms).pop() ?? null)
    : null;
  let raisedBy = "none";
  if (foreground) {
    if (handoff) raisedBy = "inherited-after-another-window-left";
    else if (!taker) raisedBy = "outside-family";
    else if (/^Chrome_/i.test(taker.cls ?? "") || /msedgewebview2/i.test(taker.proc ?? "")) raisedBy = "webview2-runtime";
    else if (taker.pid === launchedPid) raisedBy = "in-process";
    else raisedBy = "family-child";
  }
  const minimized = events
    .filter((e) => e.kind === "MINIMIZESTART" && !inFamily(e))
    .map((e) => ({ ms: e.ms, proc: e.proc ?? null, title: e.title ?? "" }));
  return {
    firstShowMs: show ? show.ms : -1,
    firstForegroundMs: foreground ? foreground.ms : -1,
    raisedBy,
    taker: taker ? { ms: taker.ms, cls: taker.cls ?? "", proc: taker.proc ?? null, pid: taker.pid } : null,
    handoff: handoff ? { ms: handoff.ms, kind: handoff.kind, proc: handoff.proc ?? null, title: handoff.title ?? "" } : null,
    priorForeground: priorForeground ? { ms: priorForeground.ms, proc: priorForeground.proc ?? null, title: priorForeground.title ?? "" } : null,
    minimized,
  };
}

/** The trace as lines a failure message can carry. Family events and every foreground/focus/minimise
 *  change, in order; capped so a message stays a message. */
export function formatTrace(events = [], { limit = 40 } = {}) {
  const lines = events.slice(0, limit).map((e) => {
    const who = e.proc ? `${e.proc}(${e.pid})` : `pid ${e.pid}`;
    const fam = e.family ? " [family]" : "";
    const title = e.title ? ` "${String(e.title).slice(0, 40)}"` : "";
    return `  ${String(e.ms).padStart(6)}ms ${e.kind.padEnd(13)} ${who} ${e.cls ?? ""}${title}${fam}`;
  });
  if (events.length > limit) lines.push(`  … ${events.length - limit} more`);
  return lines.length ? lines.join("\n") : "  (no events recorded)";
}

/**
 * The gate's verdict on a quiet launch: the poll's reading, corrected by the ONE thing the trace can
 * prove that the poll cannot (issue #121, its "decision 2"). A window OUTSIDE the launched tree
 * minimising or dying ≤500ms before Compy got the foreground is Windows handing the foreground to the
 * next window in Z-order — a fresh never-activated window sits at the top of that order. Recorded
 * 2026-08-20 (a sibling suite's "hidden" console child: Windows Terminal fronted at +59ms, minimised
 * at +307ms). To the poll that is a foreground arriving a few polls AFTER the window: its hard-zero
 * in-process-raise shape. It is not Compy's code, so it is reported UNMEASURABLE by name — the same
 * category as "a compy was already running" — never scored against the app, and never hidden.
 *
 * What this deliberately does NOT do: use the focus taker to resolve the poll's one-sample ambiguity.
 * Windows fronting a fresh launch ALSO lands focus on Compy's own top-level afterwards, so an
 * `in-process` taker at launch is not evidence either way; `unattributable-at-launch` stays
 * unmeasurable on the poll's terms alone. And `outside-family` (a foreground with no focus event
 * near it) is an ABSENCE of evidence, so it stays the hard zero. Under
 * COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF every unmeasurable verdict is a failure again.
 */
export function runtimeVerdict(result) {
  const reading = classifyForegroundReading(result);
  const { raisedBy } = summarizeTrace(result);
  if (reading === "clean") return { verdict: "clean", reading, raisedBy };
  if (raisedBy === "inherited-after-another-window-left") return { verdict: "unmeasurable", reading, raisedBy };
  if (reading === "unattributable-at-launch") return { verdict: "unmeasurable", reading, raisedBy };
  return { verdict: "fail", reading, raisedBy };
}

/**
 * The newest built compy.exe that is actually NEWER than the sources this file pins. A stale binary
 * would let the runtime tier "prove" a fix that predates the code -- the same false-pass, one level
 * down. Returns null when there is nothing honest to measure (a clean checkout, CI, a Linux box).
 */
function measurableBinary() {
  const sourceTouched = Math.max(
    statSync(join(ROOT, "src-tauri", "src", "lib.rs")).mtimeMs,
    statSync(join(ROOT, "src-tauri", "src", "tray.rs")).mtimeMs,
  );
  const candidates = ["release", "debug"]
    .map((profile) => join(ROOT, "src-tauri", "target", profile, "compy.exe"))
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const newest = candidates[0];
  if (!newest || newest.mtime < sourceTouched) return null;
  return newest.path;
}

const BINARY = windows ? measurableBinary() : null;

/**
 * The probe REFUSES to measure while a compy is already running: the single-instance lock would
 * absorb the launch and every reading would describe the window the owner already had open. That
 * refusal is correct. Turning it into a red suite is not -- the owner running his own app is the
 * normal state of this machine, and a gate that refuses a green repo teaches you to pass
 * --no-verify. So it SKIPS, loudly and by name. Where proof is actually being demanded (the release
 * gate sets COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF), an unmeasurable run is a failure again.
 */
function unmeasurableBecauseRunning() {
  const run = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "(Get-Process -Name compy -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  const pids = (run.stdout || "").trim();
  if (!pids) return false;
  const reason =
    `compy is already running (PID ${pids}); the single-instance lock would absorb the launch, ` +
    "so the measurement would describe the OLD window. Close it to measure.";
  if (process.env.COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF) {
    throw new Error(`runtime foreground proof was REQUIRED but could not run: ${reason}`);
  }
  console.log(`[launch-focus-guard] runtime measurement SKIPPED: ${reason}`);
  return true;
}

/** Run the probe and return its parsed result. Throws with the probe's own words on failure. */
function measureLaunch({ args = [], env = {}, seconds = 6, savedState = null, grant = true }) {
  // A throwaway APPDATA so a measurement never writes to the owner's Trust Ledger, and so the
  // window-state file each launch reads is a known one rather than whatever he left behind.
  const sandbox = mkdtempSync(join(tmpdir(), "compy-fg-"));
  if (savedState) {
    // The window-state plugin restores from the app config dir, which is %APPDATA%\<identifier>.
    mkdirSync(join(sandbox, TAURI_IDENTIFIER), { recursive: true });
    writeFileSync(join(sandbox, TAURI_IDENTIFIER, ".window-state.json"), JSON.stringify(savedState));
  }
  const run = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      PROBE,
      "-FilePath",
      BINARY,
      "-DurationSeconds",
      String(seconds),
      ...(args.length ? ["-ArgumentList", args.join(",")] : []),
      ...(grant ? [] : ["-NoGrant"]),
    ],
    {
      encoding: "utf8",
      // Same rule console-window-guard.test.mjs enforces: a measurement of window behaviour must not
      // itself flash a console window across the screen it is measuring.
      windowsHide: true,
      timeout: (seconds + 40) * 1000,
      env: { ...process.env, APPDATA: sandbox, LOCALAPPDATA: sandbox, ...env },
    },
  );
  const stdout = (run.stdout || "").trim();
  const json = stdout.split(/\r?\n/).find((line) => line.startsWith("{"));
  if (!json) {
    throw new Error(`foreground probe produced no result.\nstdout: ${stdout}\nstderr: ${run.stderr}`);
  }
  // The probe can also measure a second, single-instance-absorbed launch (-RelaunchWith); this guard
  // only ever asks for the first one, so flatten that block up and keep the launch-level fields.
  const parsed = JSON.parse(json);
  // Keep the raw reading when asked (COMPY_FOREGROUND_TRACE_DIR=<dir>): a trace that only lives in
  // a vitest message is lost the moment the run is green, and the green runs are the baseline.
  if (process.env.COMPY_FOREGROUND_TRACE_DIR) {
    mkdirSync(process.env.COMPY_FOREGROUND_TRACE_DIR, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${args.join("_") || "plain"}-${parsed.launchedPid}.json`;
    writeFileSync(join(process.env.COMPY_FOREGROUND_TRACE_DIR, name), JSON.stringify({ args, env: Object.keys(env), grant, ...parsed }, null, 2));
  }
  return {
    ...parsed.initial,
    launchedPid: parsed.launchedPid,
    familyPids: parsed.familyPids ?? [],
    rightsGranted: parsed.rightsGranted,
  };
}

/** The #121 attribution block every runtime message now carries — who raised it, per the trace. */
function describeTrace(result) {
  const s = summarizeTrace(result);
  const taker = s.taker ? `${s.taker.cls} owned by ${s.taker.proc ?? `pid ${s.taker.pid}`} at ${s.taker.ms}ms` : "no focus event in the launched family";
  const handoff = s.handoff ? `; ${s.handoff.proc ?? "?"} "${s.handoff.title}" ${s.handoff.kind} at ${s.handoff.ms}ms just before` : "";
  const prior = s.priorForeground ? `; foreground before that: ${s.priorForeground.proc ?? "?"} "${s.priorForeground.title}" at ${s.priorForeground.ms}ms` : "";
  const minimized = s.minimized.length
    ? s.minimized.map((m) => `${m.proc ?? "?"} "${m.title}" at ${m.ms}ms`).join(", ")
    : "none";
  return (
    `trace: first SHOW ${s.firstShowMs}ms, first FOREGROUND ${s.firstForegroundMs}ms, raised by ${s.raisedBy} (${taker}${handoff}${prior}); ` +
    `windows outside the launch minimised: ${minimized}; ` +
    `${result.eventsKept ?? 0}/${result.eventsTotal ?? 0} events kept${result.eventsDroppedAtCap ? `, ${result.eventsDroppedAtCap} dropped at the hook cap` : ""}\n` +
    formatTrace(result.events ?? [])
  );
}

// The discriminator decides whether a reading is Compy's fault or the OS's, so it gets its own
// tests: it runs on every machine (no binary, no Windows needed), and a one-line "simplification"
// that classified the raise case as unmeasurable would disarm the runtime tier completely.
describe("the foreground reading is classified by CAUSE, not by count", () => {
  it("a clean run is clean", () => {
    expect(classifyForegroundReading({ ownedForegroundSamples: 0, firstForegroundMs: -1, firstWindowMs: 40 })).toBe(
      "clean",
    );
  });

  it("the 2026-08-18 BACKLOG reading — foreground 2430ms, long after the window — still FAILS", () => {
    // The reading the owner's note protects: "First foreground at ~2.4s is a window being RAISED
    // well after creation, and if that is real under load it is real while the owner games."
    expect(
      classifyForegroundReading({ ownedForegroundSamples: 33, firstForegroundMs: 2430, firstWindowMs: 120 }),
    ).toBe("in-process-raise");
  });

  it("the 2026-08-18 loaded-gate reading — foreground 132ms, window 13ms — still FAILS", () => {
    // 119ms apart is more than a poll, so the ordering is real and not the probe's own.
    expect(
      classifyForegroundReading({ ownedForegroundSamples: 50, firstForegroundMs: 132, firstWindowMs: 13 }),
    ).toBe("in-process-raise");
  });

  it("a raise INSIDE one poll of the window is unmeasurable, in either order", () => {
    // The correction an independent review forced on 2026-08-18. The probe reads the foreground
    // first and the window second within one iteration, with a Process.Refresh() in between, so a
    // few-ms lead either way is the poll's artifact. Both of these are the same non-answer.
    for (const [fg, win] of [
      [7, 12], // the idle desk reading, reproduced 3/3
      [12, 12],
      [95, 12], // still inside one 100ms poll
    ]) {
      expect(
        classifyForegroundReading({ ownedForegroundSamples: 55, firstForegroundMs: fg, firstWindowMs: win }),
        `${fg}/${win}`,
      ).toBe("unattributable-at-launch");
    }
  });

  it("one poll past the window is the boundary, and the far side of it FAILS", () => {
    const win = 12;
    expect(
      classifyForegroundReading({ ownedForegroundSamples: 55, firstForegroundMs: win + 100, firstWindowMs: win }),
    ).toBe("unattributable-at-launch");
    expect(
      classifyForegroundReading({ ownedForegroundSamples: 55, firstForegroundMs: win + 101, firstWindowMs: win }),
    ).toBe("in-process-raise");
  });

  it("its resolution is the probe's ACTUAL sampling interval, not a number that drifted from it", () => {
    // The whole classification hangs off this constant matching the PowerShell default. If someone
    // retunes the probe and not this file, every reading is scored against the wrong resolution.
    const ps1 = readFileSync(join(ROOT, "scripts", "lib", "foreground-probe.ps1"), "utf8");
    const declared = /\[int\]\$IntervalMs\s*=\s*(\d+)/.exec(ps1);
    expect(declared, "foreground-probe.ps1 no longer declares an IntervalMs default").toBeTruthy();
    expect(Number(declared[1])).toBe(PROBE_INTERVAL_MS);
  });

  it("owning the foreground with no timing recorded is treated as the raise class", () => {
    // Missing evidence never buys the app the benefit of the doubt.
    expect(
      classifyForegroundReading({ ownedForegroundSamples: 9, firstForegroundMs: -1, firstWindowMs: -1 }),
    ).toBe("in-process-raise");
  });
});

// ── THE TRACE (#121) ────────────────────────────────────────────────────────────────────────────
// The attribution runs on recorded traces here, on every machine, because its whole value is that a
// failure explains itself — and an attribution that silently drifted (say, a WebView2 focus scored
// as in-process) would send the fix to the wrong component.
const ev = (ms, kind, extra = {}) => ({ ms, kind, pid: 100, proc: "compy", family: true, cls: "Window Class", title: "Compy", hwnd: "0x1", root: "0x1", rootPid: 100, ...extra });

describe("the trace names WHAT raised the window (#121)", () => {
  it("a launch that never reaches the foreground is clean, and still reports when its window appeared", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100, 101],
      events: [ev(5, "CREATE"), ev(12, "SHOW"), ev(140, "CREATE", { pid: 101, proc: "msedgewebview2", cls: "Chrome_WidgetWin_0", hwnd: "0x2" })],
    });
    expect(s).toMatchObject({ firstShowMs: 12, firstForegroundMs: -1, raisedBy: "none", taker: null, minimized: [] });
  });

  it("focus landing on a Chrome_WidgetWin window owned by msedgewebview2 is the WebView2 runtime, not Compy", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100, 101],
      events: [
        ev(12, "SHOW"),
        ev(131, "FOREGROUND", { fgPid: 100 }),
        ev(133, "FOCUS", { pid: 101, proc: "msedgewebview2", cls: "Chrome_WidgetWin_0", hwnd: "0x2", rootPid: 100 }),
      ],
    });
    expect(s.raisedBy).toBe("webview2-runtime");
    expect(s.taker).toMatchObject({ cls: "Chrome_WidgetWin_0", proc: "msedgewebview2", ms: 133 });
    expect(s.firstForegroundMs - s.firstShowMs).toBe(119);
  });

  it("focus landing on the tao top-level owned by the launched process itself is in-process", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100],
      events: [ev(12, "SHOW"), ev(2430, "FOREGROUND", { fgPid: 100 }), ev(2431, "FOCUS")],
    });
    expect(s.raisedBy).toBe("in-process");
    expect(s.taker).toMatchObject({ cls: "Window Class", pid: 100 });
  });

  it("a focus that preceded the foreground change by a moment is the same raise", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100],
      events: [ev(12, "SHOW"), ev(40, "FOCUS", { cls: "WRY_WEBVIEW" }), ev(41, "FOREGROUND", { fgPid: 100 })],
    });
    expect(s.raisedBy).toBe("in-process");
    expect(s.taker.cls).toBe("WRY_WEBVIEW");
  });

  it("the family taking the foreground with no family focus event near it is something OUTSIDE the launch", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100],
      events: [ev(-3, "CREATE"), ev(7, "FOREGROUND", { fgPid: 100 }), ev(12, "SHOW"), ev(900, "FOCUS")],
    });
    expect(s.raisedBy).toBe("outside-family");
    expect(s.taker).toBeNull();
  });

  it("a window OUTSIDE the launch minimising just before the family got the foreground is an INHERITED foreground, whoever focus lands on", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100, 101],
      events: [
        ev(12, "SHOW"),
        ev(59, "FOREGROUND", { pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows Terminal", rootPid: 14724, fgPid: 14724 }),
        ev(307, "MINIMIZESTART", { pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows PowerShell", rootPid: 14724 }),
        ev(308, "FOREGROUND", { fgPid: 100 }),
        ev(310, "FOCUS", { pid: 101, proc: "msedgewebview2", cls: "Chrome_WidgetWin_0", hwnd: "0x2", rootPid: 100 }),
      ],
    });
    expect(s.raisedBy).toBe("inherited-after-another-window-left");
    expect(s.handoff).toMatchObject({ kind: "MINIMIZESTART", proc: "WindowsTerminal", ms: 307 });
    expect(s.priorForeground).toMatchObject({ proc: "WindowsTerminal", ms: 59 });
    // The same focus taker WITHOUT the handoff is the WebView2 runtime: the order of checks is the point.
    const noHandoff = summarizeTrace({ launchedPid: 100, familyPids: [100, 101], events: [ev(12, "SHOW"), ev(308, "FOREGROUND", { fgPid: 100 }), ev(310, "FOCUS", { pid: 101, proc: "msedgewebview2", cls: "Chrome_WidgetWin_0", hwnd: "0x2", rootPid: 100 })] });
    expect(noHandoff.raisedBy).toBe("webview2-runtime");
  });

  it("a window OUTSIDE the launch being minimised is reported by name — that is the harm", () => {
    const s = summarizeTrace({
      launchedPid: 100,
      familyPids: [100],
      events: [
        ev(12, "SHOW"),
        ev(130, "MINIMIZESTART", { pid: 7, proc: "game", family: false, cls: "UnrealWindow", title: "The Game", rootPid: 7 }),
        ev(131, "FOREGROUND", { fgPid: 100 }),
        ev(132, "FOCUS"),
      ],
    });
    expect(s.minimized).toEqual([{ ms: 130, proc: "game", title: "The Game" }]);
  });

  it("RECORDED 2026-08-20: a launch the POLL would call clean, because the window that came forward was not the launched one", () => {
    // Recorded by this instrument's first smoke test, launching a HIDDEN powershell.exe from a
    // background shell while the owner was in a game. The launched process (14968) never owned the
    // foreground — the poll reads 0/N, a pass — yet Windows Terminal (14724), hosting the "hidden"
    // console, took the foreground at +59ms, was minimised at +307ms, and the foreground fell to VS
    // Code. Whatever was in front before is now behind. The trace sees it; the poll cannot.
    const recorded = [
      { ms: 59, kind: "FOREGROUND", pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows Terminal", rootPid: 14724, fgPid: 14724 },
      { ms: 61, kind: "FOCUS", pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows Terminal", rootPid: 14724 },
      { ms: 99, kind: "SHOW", pid: 14968, proc: "powershell", family: true, cls: "PseudoConsoleWindow", title: "", rootPid: 14968 },
      { ms: 105, kind: "CREATE", pid: 14968, proc: "powershell", family: true, cls: "OleMainThreadWndClass", title: "OleMainThreadWndName", rootPid: 14968 },
      { ms: 307, kind: "MINIMIZESTART", pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows PowerShell", rootPid: 14724 },
      { ms: 307, kind: "FOREGROUND", pid: 14704, proc: "Code", family: false, cls: "Chrome_WidgetWin_1", title: "Visual Studio Code", rootPid: 14704, fgPid: 14704 },
      { ms: 311, kind: "FOCUS", pid: 14704, proc: "Code", family: false, cls: "Chrome_WidgetWin_1", title: "Visual Studio Code", rootPid: 14704 },
    ];
    const s = summarizeTrace({ launchedPid: 14968, familyPids: [14968], events: recorded });
    expect(s.raisedBy).toBe("none");
    expect(s.minimized).toEqual([{ ms: 307, proc: "WindowsTerminal", title: "Windows PowerShell" }]);
    const text = formatTrace(recorded);
    expect(text).toContain("FOREGROUND");
    expect(text).toContain("WindowsTerminal(14724)");
    expect(text).toContain("[family]");
  });

  // The verdict the runtime tier acts on, on recorded readings: a change here is a change to what the
  // gate lets through, so each branch is pinned and the mutation that would disarm it is pinned too.
  describe("the verdict combines the poll and the trace (#121 decision 2)", () => {
    const poll = (firstForegroundMs, firstWindowMs, owned = 50) => ({ ownedForegroundSamples: owned, firstForegroundMs, firstWindowMs, samples: 55 });
    const handoffTrace = [
      ev(59, "FOREGROUND", { pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows Terminal", rootPid: 14724, fgPid: 14724 }),
      ev(99, "SHOW"),
      ev(307, "MINIMIZESTART", { pid: 14724, proc: "WindowsTerminal", family: false, cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows PowerShell", rootPid: 14724 }),
      ev(308, "FOREGROUND", { fgPid: 100 }),
      ev(310, "FOCUS"),
    ];

    it("a poll that never saw Compy own the foreground is clean, whatever the trace holds", () => {
      expect(runtimeVerdict({ ...poll(-1, 12, 0), launchedPid: 100, familyPids: [100], events: handoffTrace }).verdict).toBe("clean");
    });

    it("a foreground the poll calls an in-process raise, that the trace shows was HANDED over, is unmeasurable by name", () => {
      const v = runtimeVerdict({ ...poll(308, 99), launchedPid: 100, familyPids: [100], events: handoffTrace });
      expect(v).toEqual({ verdict: "unmeasurable", reading: "in-process-raise", raisedBy: "inherited-after-another-window-left" });
    });

    it("the same poll reading with NO hand-off in the trace stays the hard zero", () => {
      const inProcess = [ev(99, "SHOW"), ev(308, "FOREGROUND", { fgPid: 100 }), ev(310, "FOCUS")];
      expect(runtimeVerdict({ ...poll(308, 99), launchedPid: 100, familyPids: [100], events: inProcess })).toEqual({ verdict: "fail", reading: "in-process-raise", raisedBy: "in-process" });
      // A hand-off OUTSIDE the 500ms window is not this raise: the mutation that would widen the
      // window into "anything minimised earlier excuses it" fails here.
      const stale = handoffTrace.map((e) => (e.kind === "MINIMIZESTART" ? { ...e, ms: -300 } : e));
      expect(runtimeVerdict({ ...poll(308, 99), launchedPid: 100, familyPids: [100], events: stale }).verdict).toBe("fail");
    });

    it("a foreground with no focus event near it is an absence of evidence, and still fails", () => {
      const bare = [ev(99, "SHOW"), ev(308, "FOREGROUND", { fgPid: 100 })];
      expect(runtimeVerdict({ ...poll(308, 99), launchedPid: 100, familyPids: [100], events: bare })).toEqual({ verdict: "fail", reading: "in-process-raise", raisedBy: "outside-family" });
    });

    it("inside one poll stays unmeasurable on the poll's terms — an in-process focus taker at launch proves nothing", () => {
      const atLaunch = [ev(7, "FOREGROUND", { fgPid: 100 }), ev(9, "FOCUS"), ev(12, "SHOW")];
      expect(runtimeVerdict({ ...poll(7, 12), launchedPid: 100, familyPids: [100], events: atLaunch })).toEqual({ verdict: "unmeasurable", reading: "unattributable-at-launch", raisedBy: "in-process" });
      expect(runtimeVerdict({ ...poll(7, 12), launchedPid: 100, familyPids: [100], events: [] }).verdict).toBe("unmeasurable");
    });
  });

  it("formatTrace caps long traces and says so", () => {
    const many = Array.from({ length: 60 }, (_, i) => ev(i, "FOCUS"));
    const text = formatTrace(many, { limit: 10 });
    expect(text.split("\n")).toHaveLength(11);
    expect(text).toContain("… 50 more");
    expect(formatTrace([])).toBe("  (no events recorded)");
  });
});

describe("the probe carries the event hook (#121)", () => {
  const PROBE_SRC = read("scripts", "lib", "foreground-probe.ps1");
  const HOOK_SRC = read("scripts", "lib", "foreground-events.cs");

  it("hooks every event the attribution reads: foreground, focus, window lifecycle, minimise", () => {
    for (const name of ["EVENT_SYSTEM_FOREGROUND", "EVENT_OBJECT_FOCUS", "EVENT_OBJECT_CREATE", "EVENT_OBJECT_SHOW", "EVENT_SYSTEM_MINIMIZESTART", "EVENT_SYSTEM_MINIMIZEEND"]) {
      expect(HOOK_SRC, `foreground-events.cs must hook ${name}`).toContain(name);
    }
    expect(HOOK_SRC, "the delegate must be held in a field or the GC collects it under the hook").toMatch(/WinEventProc _proc;/);
  });

  it("the poll PUMPS instead of sleeping, or out-of-context events never arrive", () => {
    expect(PROBE_SRC).toMatch(/\$Hook\.Pump\(\$IntervalMs\)/);
    expect(PROBE_SRC, "a Start-Sleep in the poll loop would stall event delivery for the whole interval").not.toMatch(/Start-Sleep -Milliseconds \$IntervalMs/);
  });

  it("the hook is up BEFORE the launch and the trace is resolved BEFORE the kill", () => {
    const hookStart = PROBE_SRC.indexOf("$hook.Start()");
    const launch = PROBE_SRC.indexOf("$started = Start-Target");
    const resolve = PROBE_SRC.indexOf("Resolve-Trace -Hook $hook -Measurement $initial");
    const kill = PROBE_SRC.indexOf("Stop-Process -Id $p.Id -Force");
    expect(hookStart).toBeGreaterThan(-1);
    expect(launch, "the hook must start before Start-Target, or the first CREATE is lost").toBeGreaterThan(hookStart);
    expect(resolve).toBeGreaterThan(launch);
    expect(kill, "names and the parent chain vanish with the kill; resolve first").toBeGreaterThan(resolve);
  });

  it.runIf(windows)(
    "the hook compiles and installs on this machine (no launch, no window)",
    () => {
      const run = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${join(ROOT, "scripts", "lib", "foreground-events.cs")}'); ` +
            "$h = New-Object CompyProbe.EventHook; $h.Start(); $h.Pump(50); $n = $h.HookCount; $h.Dispose(); " +
            "Write-Output \"hooks=$n events=$($h.Events.Count)\"",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 60_000 },
      );
      expect(run.status, `stderr: ${run.stderr}`).toBe(0);
      expect(run.stdout).toMatch(/hooks=4 events=\d+/);
    },
    60_000,
  );
});

describe.runIf(windows && BINARY)("RUNTIME: a real launch, watched by GetForegroundWindow", () => {
  // DECLARATION ORDER IS LOAD-BEARING. The self-test runs FIRST because Windows holds a foreground
  // LOCK for a moment after the active window changes, and each measurement ends by killing the app
  // it launched. Measured: with the quiet case first, the following ACTIVATING launch could not
  // reach the foreground either -- a state in which the quiet case proves nothing and passes anyway.
  // The probe's own settle wait covers the same hazard; the ordering is the belt to its braces.
  it(
    "the probe is not blind: an explicit COMPY_ACTIVATE launch DOES take the foreground",
    () => {
      // Without this, a probe that could never see Compy in the foreground -- a broken P/Invoke, a
      // wrong PID, a window owned by a child process, a machine whose foreground is locked -- would
      // report a perfect pass below forever. That is precisely how the inert fix survived a lane.
      //
      // It is opt-in because proving activation means actually TAKING the owner's foreground for a
      // few seconds, which is the very interruption this lane exists to remove. Run it deliberately,
      // when he is not mid-game:
      //   COMPY_PROVE_ACTIVATION=1 npx vitest run scripts/launch-focus-guard.test.mjs
      if (!process.env.COMPY_PROVE_ACTIVATION && !process.env.COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF) {
        console.log(
          "[launch-focus-guard] activation self-test SKIPPED (set COMPY_PROVE_ACTIVATION=1 to run it; it will steal the foreground once, by design)",
        );
        return;
      }
      if (unmeasurableBecauseRunning()) return;
      const result = measureLaunch({ env: { COMPY_ACTIVATE: "1" } });
      expect(result.exited, `the app exited during the measurement (code ${result.exitCode})`).toBe(false);
      // Whether ANY launch can reach the foreground is decided before Compy runs. Windows only lets a
      // process activate a window if it inherited foreground rights from its launcher, so the whole
      // measurement is conditional on the shell running this test being the foreground app -- which a
      // test harness spawned in the background is not. Measured here: the grant is refused whenever
      // the owner is looking at any other window. That is not a failing fix and not a passing one; it
      // is a measurement that could not be taken, and saying so is the entire point of a self-test.
      expect(
        result.rightsGranted,
        "the harness could not obtain foreground rights, so NOTHING could have taken the foreground and the quiet result below proves nothing. Re-run from a shell that IS the foreground window (click the terminal first).",
      ).toBe(true);
      expect(
        result.everTookForeground,
        "an explicitly-activating launch did NOT reach the foreground, so the probe cannot detect the failure it is meant to catch",
      ).toBe(true);
    },
    120_000,
  );

  it(
    "a quiet launch opens a real visible window and never takes the foreground",
    () => {
      if (unmeasurableBecauseRunning()) return;
      // UNGRANTED BY DESIGN (issue #121) -- the same principle the probe already applies to the
      // relaunch case: a granted launch measures the OS, not Compy. Measured 2026-08-13 on an
      // input-idle desk: with the grant taken, Windows fronted the fresh launch at/before its first
      // window against a binary with no activation path left in it, so the granted configuration is
      // unpassable by ANY correct app. (That "at/before its first window" reading is the same
      // comparison classifyForegroundReading now calls unattributable inside one poll -- the case
      // for going ungranted does not rest on it: production launches ungranted either way.) Ungranted is also the condition production has -- npm,
      // vitest, and ship-reinstall all launch from background tooling. The steal class this guard
      // exists for (tao's set_focus, which raises through AttachThreadInput even where the OS would
      // not) needs no grant, so it still fails this test. The opt-in COMPY_PROVE_ACTIVATION
      // self-test above remains the probe-blindness check.
      const result = measureLaunch({ args: ["--no-activate"], savedState: MAXIMIZED_STATE, grant: false });
      // Ordered most-diagnostic-first: "never took the foreground" is also true of an app that
      // crashed on startup, and that would be a worse bug passing as a fix.
      expect(result.exited, `the app exited during the measurement (code ${result.exitCode})`).toBe(false);
      expect(result.sawWindow, "the app never opened a window at all").toBe(true);
      expect(result.sawVisibleWindow, "the window existed but was hidden or minimised -- the fix must stay out of the foreground, not out of sight").toBe(true);
      // The message carries the fields that tell the two causes APART, because without them a
      // failure is unactionable -- measured 2026-08-18, when this rejected four pushes (one of them
      // docs-only, against a PREBUILT binary the diff could not have changed) and every reading was
      // lost to a message that quoted only the count. It could not be reproduced on demand: green
      // standalone x3, green at 97% CPU x3, green through the gate's own `npm test`. So the next
      // occurrence has to explain itself.
      //
      // firstForegroundMs vs firstWindowMs is the discriminator the probe already returns and this
      // assertion used to discard. A foreground that arrives a full poll or more AFTER the window is
      // something in-process raising it -- the steal this guard is for, and a hard zero. A
      // foreground and a window first seen in the SAME poll are not separable at this resolution and
      // are reported as unmeasurable; see classifyForegroundReading for why the sign of that
      // difference proves nothing.
      const raise =
        result.firstForegroundMs >= 0 && result.firstWindowMs >= 0
          ? `${result.firstForegroundMs - result.firstWindowMs}ms after its window appeared`
          : "with no window timing recorded";
      const { verdict, reading, raisedBy } = runtimeVerdict(result);
      if (verdict === "unmeasurable" && raisedBy === "inherited-after-another-window-left" && !process.env.COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF) {
        // The trace names a window outside the launch leaving the foreground just before Compy got
        // it — Windows' hand-off to the next window in Z-order, not an in-process raise, whatever the
        // poll's timing looked like. Said by name so the sibling that opened that window can be found.
        console.log(
          `[launch-focus-guard] quiet-launch reading UNMEASURABLE: the foreground (${result.firstForegroundMs}ms, ` +
            `${result.ownedForegroundSamples}/${result.samples} samples; poll reading "${reading}") was HANDED to Compy ` +
            `by a window outside the launch leaving the foreground (issue #121). This run did not measure Compy either way. ` +
            `Refuse the skip with COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF=1.\n` +
            describeTrace(result),
        );
        return;
      }
      if (verdict === "unmeasurable" && !process.env.COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF) {
        // Reported by name, never silently. Reproduced 3/3 on 2026-08-18 against the 0.9.25 desk
        // build with VS Code holding the foreground: first foreground 7ms, first window 12ms — one
        // poll apart, so the order between them is the poll's, not the machine's.
        console.log(
          `[launch-focus-guard] quiet-launch reading UNMEASURABLE: the foreground (${result.firstForegroundMs}ms) ` +
            `and the window (${result.firstWindowMs}ms) were first seen inside one ${PROBE_INTERVAL_MS}ms poll ` +
            `(${result.ownedForegroundSamples}/${result.samples} samples), which cannot tell an in-process raise ` +
            `apart from Windows fronting a fresh launch (issue #121). This run did not measure Compy either way. ` +
            `Refuse the skip with COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF=1 — nothing in the repo sets it today, ` +
            `it is the by-hand switch for a run that must not be allowed to skip.\n` +
            // The poll could not tell the two causes apart; the event trace can. Printed every time so
            // the reading that finally closes #121 is on record wherever this run happened.
            describeTrace(result),
        );
        return;
      }
      expect(
        result.ownedForegroundSamples,
        `Compy held the foreground for ${result.ownedForegroundSamples}/${result.samples} samples ` +
          `(first at ${result.firstForegroundMs}ms, ${raise}; window at ${result.firstWindowMs}ms, ` +
          `visible=${result.sawVisibleWindow}; foreground pid before=${result.foregroundPidBefore}, ` +
          `after=${result.foregroundPidAfter}). This is the owner's game being minimised.\n` +
          describeTrace(result),
      ).toBe(0);
      // A clean run leaves its trace too: the day the gate fails, the last green reading is the
      // baseline the red one is compared against.
      console.log(`[launch-focus-guard] quiet launch clean. ${describeTrace(result).split("\n")[0]}`);
    },
    120_000,
  );
});

describe("the runtime tier states plainly when it did not run", () => {
  it("names the reason rather than passing silently", () => {
    if (windows && BINARY) {
      console.log(`[launch-focus-guard] runtime tier measured against ${BINARY}`);
      return;
    }
    const reason = !windows
      ? "not Windows -- there is no foreground to steal"
      : "no built compy.exe newer than src-tauri/src/{lib,tray}.rs (build first: cargo build --manifest-path src-tauri/Cargo.toml)";
    console.log(`[launch-focus-guard] runtime tier NOT RUN: ${reason}`);
    // A release must never ship on the static tier alone -- that is exactly how the inert fix in
    // PR #100 survived a whole lane green. The release gate sets this.
    expect(
      process.env.COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF,
      `runtime foreground proof was REQUIRED but could not run: ${reason}`,
    ).toBeFalsy();
  });
});
