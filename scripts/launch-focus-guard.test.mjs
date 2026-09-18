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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
 *   a MINIMIZESTART on a window OUTSIDE the family is the owner's window going down: the harm itself
 *     — unless the window is this test run's OWN tooling console, see `isRunnerTooling` below.
 *
 * Pure, so it runs on every machine against recorded traces. It summarises; the gate's verdict is
 * still `classifyForegroundReading` until a measured trace has been read — a summary is not a law.
 */
/** Windows' own class name for a console window. A CLASS, assigned by the OS — not a title. */
export const CONSOLE_WINDOW_CLASS = "ConsoleWindowClass";
/** A pid chain longer than this is a cycle or a lie; stop rather than spin. */
export const ANCESTRY_MAX_HOPS = 24;

/**
 * THE TEST RUN'S OWN CONSOLES ARE NOT THE OWNER'S WINDOW (2026-09-07).
 *
 * The `minimized` assertion below rejected two of six pushes on 2026-09-07 — one of them a diff of
 * two Rust files that touches no window or focus code — on this event:
 *
 *   {"ms":1682,"kind":"MINIMIZESTART","pid":20548,"proc":null,"family":false,
 *    "cls":"ConsoleWindowClass","title":"C:\\Program Files\\nodejs\\node.exe","fgPid":null}
 *
 * A node child's console blinking shut during the 2-second measurement. `proc` is null because the
 * process was already gone when the trace was resolved, and `fgPid` is null because no foreground
 * change was attributed to it at all. A 428-file vitest run produces hundreds of these.
 *
 * TWO CONDITIONS, BOTH REQUIRED, AND NEITHER IS THE TITLE:
 *   1. the window's CLASS is ConsoleWindowClass — assigned by Windows, not by the process; and
 *   2. the owning process's ancestry reaches THIS RUN's own runner tree (`runnerPids`, walked up
 *      from the probe and bounded to node/npm — see Get-RunnerAncestry in foreground-probe.ps1).
 *
 * The title is deliberately never read. It is the one field a process picks for itself, so a guard
 * that excused a window because its title said "node.exe" could be talked out of firing by any
 * window that cared to say so. Ancestry cannot be set by the window being judged.
 *
 * FAIL-CLOSED, EVERY WAY IT CAN FAIL. An empty `runnerPids` (an old trace, a fixture, a probe that
 * could not walk its own parents) excludes NOTHING and the assertion behaves exactly as it did
 * before this existed. An unresolvable ancestry — a dead intermediate, a protected process, a pid
 * chain that runs out — is likewise not a match. Unknown provenance is scored as harm.
 *
 * The first link of the chain can only come from the hook's event-time `ppid` read: by the time
 * anything else runs, the console's process is gone. See foreground-events.cs.
 */
export function isRunnerTooling(event, { runnerPids = [], parents = {} } = {}) {
  const runner = new Set((runnerPids ?? []).filter((p) => Number.isInteger(p) && p > 0));
  if (!runner.size) return false;
  if (String(event?.cls ?? "") !== CONSOLE_WINDOW_CLASS) return false;
  const parentOf = (pid) => {
    const raw = parents?.[pid] ?? parents?.[String(pid)] ?? 0;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const seeded = Number(event?.ppid);
  let cur = Number(event?.pid) || 0;
  const seen = new Set();
  for (let hop = 0; hop < ANCESTRY_MAX_HOPS && cur > 0 && !seen.has(cur); hop++) {
    seen.add(cur);
    if (runner.has(cur)) return true;
    // The event's own ppid wins for the FIRST link — it was read while the process still existed.
    cur = hop === 0 && Number.isInteger(seeded) && seeded > 0 ? seeded : parentOf(cur);
  }
  return false;
}

export function summarizeTrace({ events = [], launchedPid, familyPids = [], runnerPids = [], parents = {} } = {}) {
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
  // NOTE the handoff read above is deliberately NOT filtered this way. "Did a user window go down"
  // and "could Windows have handed the foreground to the next window in Z-order" are different
  // questions: any window leaving the foreground moves the Z-order, tooling included. Narrowing the
  // handoff would turn genuine in-process raises into unmeasurable skips — the wrong direction.
  const outsideMinimized = events.filter((e) => e.kind === "MINIMIZESTART" && !inFamily(e));
  const row = (e) => ({ ms: e.ms, pid: e.pid ?? null, proc: e.proc ?? null, cls: e.cls ?? "", title: e.title ?? "" });
  const toolingCtx = { runnerPids, parents };
  const minimized = outsideMinimized.filter((e) => !isRunnerTooling(e, toolingCtx)).map(row);
  // Kept and reported rather than dropped: an exclusion nobody can see is an exclusion nobody can
  // catch being wrong. Every discounted window is printed with the run that discounted it.
  const minimizedTooling = outsideMinimized.filter((e) => isRunnerTooling(e, toolingCtx)).map(row);
  return {
    firstShowMs: show ? show.ms : -1,
    firstForegroundMs: foreground ? foreground.ms : -1,
    raisedBy,
    taker: taker ? { ms: taker.ms, cls: taker.cls ?? "", proc: taker.proc ?? null, pid: taker.pid } : null,
    handoff: handoff ? { ms: handoff.ms, kind: handoff.kind, proc: handoff.proc ?? null, title: handoff.title ?? "" } : null,
    priorForeground: priorForeground ? { ms: priorForeground.ms, proc: priorForeground.proc ?? null, title: priorForeground.title ?? "" } : null,
    minimized,
    minimizedTooling,
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

/**
 * WHERE A RUNTIME READING IS KEPT — and why it is kept by DEFAULT (issue #121, 2026-08-22).
 *
 * Until today the probe wrote its raw trace only when `COMPY_FOREGROUND_TRACE_DIR` was set by hand.
 * That is exactly backwards for an intermittent failure: the runs that need explaining are the ones
 * nobody was expecting, so the variable is never set when it would have mattered. #121 has been
 * "not root-caused" through at least three occurrences for that reason — on 2026-08-22 this gate
 * rejected a push inside `verify-local.ps1`, and the entire reading (which cause, which taker,
 * which window handed over the foreground) was lost to the wrapper truncating the message, then the
 * suite went green on the next four runs. A guard whose evidence survives only when it is green is
 * not an instrument.
 *
 * So every runtime reading is now written to `logs/foreground-traces/` (gitignored, `logs` is
 * already in `.gitignore`), newest 40 kept. `COMPY_FOREGROUND_TRACE_DIR=<dir>` still redirects it,
 * and `COMPY_FOREGROUND_TRACE_DIR=off` is the opt-out for a machine that must write nothing.
 */
export const DEFAULT_TRACE_DIR = join(ROOT, "logs", "foreground-traces");
export const TRACE_KEEP = 40;

export function traceDirFor(env = process.env) {
  const raw = String(env?.COMPY_FOREGROUND_TRACE_DIR ?? "").trim();
  if (raw.toLowerCase() === "off") return null;
  return raw === "" ? DEFAULT_TRACE_DIR : raw;
}

/**
 * Keep the newest `keep` traces and delete the rest. Names start with an ISO timestamp with `:` and
 * `.` replaced, so a lexicographic sort IS chronological — no stat call per file, and no clock.
 */
export function pruneTraces(dir, { keep = TRACE_KEEP, list = readdirSync, remove = rmSync } = {}) {
  let names = [];
  try {
    names = list(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of doomed) {
    try {
      remove(join(dir, name));
    } catch {
      /* a locked file must never fail a measurement */
    }
  }
  return doomed;
}

/** Write one reading beside its siblings. Never throws: losing a trace must not fail the gate. */
function keepTrace(parsed, { args = [], env = {}, grant = true, dir = traceDirFor() } = {}) {
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${args.join("_") || "plain"}-${parsed.launchedPid}.json`;
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify({ args, env: Object.keys(env), grant, ...parsed }, null, 2));
    pruneTraces(dir);
    return file;
  } catch {
    return null;
  }
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
  keepTrace(parsed, { args, env, grant });
  return {
    ...parsed.initial,
    launchedPid: parsed.launchedPid,
    familyPids: parsed.familyPids ?? [],
    // This run's own tooling tree and the pid->parent chains that reach it. Without these, every
    // `summarizeTrace(result)` call site silently falls back to excluding nothing.
    runnerPids: parsed.runnerPids ?? [],
    parents: parsed.parents ?? {},
    rightsGranted: parsed.rightsGranted,
  };
}

/** The #121 attribution block every runtime message now carries — who raised it, per the trace. */
function describeTrace(result) {
  const s = summarizeTrace(result);
  const taker = s.taker ? `${s.taker.cls} owned by ${s.taker.proc ?? `pid ${s.taker.pid}`} at ${s.taker.ms}ms` : "no focus event in the launched family";
  const handoff = s.handoff ? `; ${s.handoff.proc ?? "?"} "${s.handoff.title}" ${s.handoff.kind} at ${s.handoff.ms}ms just before` : "";
  const prior = s.priorForeground ? `; foreground before that: ${s.priorForeground.proc ?? "?"} "${s.priorForeground.title}" at ${s.priorForeground.ms}ms` : "";
  const name = (m) => `${m.proc ?? "?"}(${m.pid ?? "?"}) ${m.cls ?? ""} "${m.title}" at ${m.ms}ms`;
  const minimized = s.minimized.length ? s.minimized.map(name).join(", ") : "none";
  // Printed on EVERY run, green or red: an exclusion nobody can see is an exclusion nobody can
  // catch being wrong.
  const discounted = s.minimizedTooling?.length
    ? `; DISCOUNTED as this run's own tooling consoles (class ${CONSOLE_WINDOW_CLASS}, ancestry inside runnerPids): ${s.minimizedTooling.map(name).join(", ")}`
    : "";
  return (
    `trace: first SHOW ${s.firstShowMs}ms, first FOREGROUND ${s.firstForegroundMs}ms, raised by ${s.raisedBy} (${taker}${handoff}${prior}); ` +
    `windows outside the launch minimised: ${minimized}${discounted}; ` +
    `${result.eventsKept ?? 0}/${result.eventsTotal ?? 0} events kept${result.eventsDroppedAtCap ? `, ${result.eventsDroppedAtCap} dropped at the hook cap` : ""}\n` +
    formatTrace(result.events ?? []) +
    // Where the RAW reading is, so a message truncated by a wrapper (verify-local.ps1 did
    // exactly that on 2026-08-22) is no longer the only copy of the evidence.
    (traceDirFor() ? `\n  raw traces kept in ${traceDirFor()} (newest ${TRACE_KEEP})` : "")
  );
}

describe("the reading survives the run that produced it (issue #121)", () => {
  it("keeps traces by DEFAULT — the intermittent run is exactly the one nobody armed a flag for", () => {
    expect(traceDirFor({})).toBe(DEFAULT_TRACE_DIR);
    expect(traceDirFor({ COMPY_FOREGROUND_TRACE_DIR: "" })).toBe(DEFAULT_TRACE_DIR);
  });

  it("still honours an explicit directory, and has one opt-out word", () => {
    expect(traceDirFor({ COMPY_FOREGROUND_TRACE_DIR: "D:\\traces" })).toBe("D:\\traces");
    expect(traceDirFor({ COMPY_FOREGROUND_TRACE_DIR: "off" })).toBeNull();
    expect(traceDirFor({ COMPY_FOREGROUND_TRACE_DIR: "OFF" })).toBeNull();
  });

  it("writes where git already ignores — a kept trace must never become a commit", () => {
    expect(DEFAULT_TRACE_DIR.startsWith(join(ROOT, "logs"))).toBe(true);
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8").split(/\r?\n/)).toContain("logs");
  });

  it("keeps the NEWEST n and deletes the rest, by name — the names sort chronologically", () => {
    const names = [
      "2026-08-20T01-00-00-000Z-plain-1.json",
      "2026-08-22T01-00-00-000Z-plain-3.json",
      "2026-08-21T01-00-00-000Z-plain-2.json",
      "notes.txt",
    ];
    const removed = [];
    const doomed = pruneTraces("D:\\traces", { keep: 2, list: () => names, remove: (f) => removed.push(f) });
    expect(doomed).toEqual(["2026-08-20T01-00-00-000Z-plain-1.json"]);
    expect(removed).toEqual([join("D:\\traces", "2026-08-20T01-00-00-000Z-plain-1.json")]);
  });

  it("never throws when the directory is missing or a file is locked", () => {
    expect(
      pruneTraces("D:\\nope", {
        list: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toEqual([]);
    expect(() =>
      pruneTraces("D:\\traces", {
        keep: 0,
        list: () => ["2026-08-20T01-00-00-000Z-plain-1.json"],
        remove: () => {
          throw new Error("EBUSY");
        },
      }),
    ).not.toThrow();
  });
});

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
    expect(s.minimized).toEqual([{ ms: 130, pid: 7, proc: "game", cls: "UnrealWindow", title: "The Game" }]);
  });

  // -- THE TEST RUN'S OWN CONSOLES ARE NOT THE OWNER'S WINDOW (2026-09-07) ----------------------
  // Recorded in .claude/worktrees/resume-385-lease-repair-33429b while pushing a diff of two Rust
  // files that touches no window or focus code: three verify-local.ps1 runs went FAIL, PASS, FAIL
  // on the SAME assertion, at 37ms and at 1682ms. Both readings were a node child's console
  // blinking shut inside the 2-second measurement. `proc` is null on both because the process was
  // already gone when the trace was resolved -- which is why the parent has to be read at EVENT
  // time (foreground-events.cs `ppid`), and why every fixture below carries one.
  //
  // Each test pins one half of the rule: the exclusion stays narrow enough to still catch the harm,
  // and it attributes by ANCESTRY so that no window TITLE can buy its way out of the assertion.
  describe("this run's own tooling consoles are discounted, and nothing else is (2026-09-07)", () => {
    // 20548 = the node child whose console blinked; 21100 = the vitest worker that spawned it;
    // 21000 = vitest; 20900 = npm's node; 20800 = the probe's own powershell -- the runner tree the
    // probe walks up into. 7 is the owner's game, which is in none of it.
    const RUNNER = [20800, 20900, 21000, 21100];
    const PARENTS = { 20548: 21100, 21100: 21000, 21000: 20900, 20900: 20800 };
    const consoleBlink = (over = {}) => ({
      ms: 1682,
      kind: "MINIMIZESTART",
      pid: 20548,
      ppid: 21100,
      proc: null,
      family: false,
      cls: "ConsoleWindowClass",
      title: "C:\\Program Files\\nodejs\\node.exe",
      rootPid: 20548,
      ...over,
    });
    const trace = (events, over = {}) =>
      summarizeTrace({ launchedPid: 100, familyPids: [100], runnerPids: RUNNER, parents: PARENTS, events, ...over });

    it("RECORDED 2026-09-07: the console blink that rejected the #385 push is no longer read as harm", () => {
      const s = trace([ev(12, "SHOW"), consoleBlink()]);
      expect(s.minimized, "a node child's console is not the owner's primary monitor").toEqual([]);
      // Discounted, never disappeared: describeTrace prints this list on every run.
      expect(s.minimizedTooling).toEqual([
        { ms: 1682, pid: 20548, proc: null, cls: "ConsoleWindowClass", title: "C:\\Program Files\\nodejs\\node.exe" },
      ]);
    });

    it("THE HARM STILL FAILS: a real out-of-family window going down is untouched by the exclusion", () => {
      // The fixture this guard has always used, now measured WITH a populated runner tree -- a live
      // proof that arming the exclusion did not disarm the assertion it lives inside.
      const game = ev(130, "MINIMIZESTART", { pid: 7, ppid: 4, proc: "game", family: false, cls: "UnrealWindow", title: "The Game", rootPid: 7 });
      const s = trace([ev(12, "SHOW"), game, consoleBlink()]);
      expect(s.minimized).toEqual([{ ms: 130, pid: 7, proc: "game", cls: "UnrealWindow", title: "The Game" }]);
      expect(s.minimizedTooling.map((m) => m.pid)).toEqual([20548]);
    });

    it("a console that is NOT in this run's tree is still the harm -- the owner has consoles too", () => {
      // Same class, same shape, ancestry that never reaches the runner. The class alone excuses nothing.
      const his = consoleBlink({ pid: 5000, ppid: 4000, proc: "cmd", title: "Administrator: C:\\Windows\\system32\\cmd.exe" });
      expect(trace([ev(12, "SHOW"), his]).minimized.map((m) => m.pid)).toEqual([5000]);
      expect(trace([ev(12, "SHOW"), his]).minimizedTooling).toEqual([]);
    });

    it("A TITLE CANNOT BUY AN EXCLUSION: the owner's game claiming to be node.exe still fails", () => {
      // This is why attribution is by pid ancestry. The window says every word the real tooling
      // console said; it is not in the runner tree, so it is still reported as the harm.
      const liar = ev(130, "MINIMIZESTART", { pid: 7, ppid: 4, proc: "game", family: false, cls: "UnrealWindow", title: "C:\\Program Files\\nodejs\\node.exe", rootPid: 7 });
      expect(trace([liar]).minimized.map((m) => m.pid)).toEqual([7]);
    });

    it("...and neither can the class alone, when the pid chain does not reach the runner", () => {
      // ConsoleWindowClass AND the node.exe title AND a plausible parent -- but the chain dead-ends
      // outside the runner tree. Unknown provenance is scored as harm, never as noise.
      expect(trace([consoleBlink({ pid: 9001, ppid: 9000 })]).minimized.map((m) => m.pid)).toEqual([9001]);
    });

    it("FAIL-CLOSED: with no runner tree recorded, nothing is excluded at all", () => {
      // An old trace, a fixture, or a probe that could not walk its own parents. The assertion must
      // behave exactly as it did before this exclusion existed.
      const s = summarizeTrace({ launchedPid: 100, familyPids: [100], events: [consoleBlink()] });
      expect(s.minimized.map((m) => m.pid)).toEqual([20548]);
      expect(s.minimizedTooling).toEqual([]);
    });

    it("FAIL-CLOSED: an unreadable parent (ppid 0, no map entry) is not a match", () => {
      // foreground-events.cs returns 0 when the process is already gone or the query is refused.
      expect(trace([consoleBlink({ ppid: 0 })], { parents: {} }).minimized.map((m) => m.pid)).toEqual([20548]);
    });

    it("a console owned DIRECTLY by a runner process is discounted without walking anywhere", () => {
      expect(trace([consoleBlink({ pid: 21100, ppid: 21000 })]).minimized).toEqual([]);
    });

    it("a multi-hop chain through a dead intermediate still resolves, via the parent map", () => {
      // 20548 -> 30000 (a node child that also died) -> 21100 (a live vitest worker in the tree).
      const s = summarizeTrace({
        launchedPid: 100,
        familyPids: [100],
        runnerPids: RUNNER,
        parents: { 30000: 21100, ...PARENTS },
        events: [consoleBlink({ ppid: 30000 })],
      });
      expect(s.minimized).toEqual([]);
      expect(s.minimizedTooling.map((m) => m.pid)).toEqual([20548]);
    });

    it("a cyclic or runaway pid chain terminates instead of hanging the guard", () => {
      const cyclic = { 20548: 40001, 40001: 40002, 40002: 40001 };
      expect(isRunnerTooling(consoleBlink({ ppid: 40001 }), { runnerPids: RUNNER, parents: cyclic })).toBe(false);
      // A chain longer than the hop cap is refused rather than followed forever.
      const long = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [50000 + i, 50001 + i]));
      expect(
        isRunnerTooling(consoleBlink({ pid: 50000, ppid: 50001 }), { runnerPids: [50000 + ANCESTRY_MAX_HOPS + 5], parents: long }),
      ).toBe(false);
    });

    it("the predicate never reads the window title -- pinned in the source, not just in behaviour", () => {
      // A behavioural test can be satisfied by a title check that happens to agree today. This one
      // cannot: the function's own text must not mention the field at all.
      const src = isRunnerTooling.toString();
      expect(src, "isRunnerTooling must attribute by class and pid ancestry, never by title").not.toMatch(/title/i);
      expect(src, "the class compared is the OS-assigned one").toContain("CONSOLE_WINDOW_CLASS");
      expect(src, "an empty runner tree must return early and exclude nothing").toMatch(/runner\.size/);
    });

    it("Get-RunnerAncestry excludes nothing when no runner was seen -- pinned in the probe source", () => {
      // Measured at 7a39cc73 (review on PR #391): under a bash-based harness, and from any hand-run
      // terminal, the walk ended without meeting node/npm and returned the SHELL pids it had passed
      // through, so isRunnerTooling armed on the probe's own shell -- fail-OPEN inside the change
      // whose thesis is fail-closed. No vitest reaches that PowerShell, so the guarantee is pinned
      // the same way the title ban is: the function's own text must consult the flag on its way out.
      const ps1 = readFileSync(join(ROOT, "scripts", "lib", "foreground-probe.ps1"), "utf8");
      const start = ps1.indexOf("function Get-RunnerAncestry");
      expect(start, "foreground-probe.ps1 no longer defines Get-RunnerAncestry").toBeGreaterThan(-1);
      const fn = ps1.slice(start, ps1.indexOf("\n}\n", start));
      expect(fn, "no runner seen => exclude nothing").toMatch(/if \(-not \$sawRunner\) \{ return @\(\) \}/);
      const guard = fn.indexOf("if (-not $sawRunner) { return @() }");
      expect(guard, "the guard must exist").toBeGreaterThan(-1);
      expect(guard, "the guard must sit BEFORE the shells-only return, not after it").toBeLessThan(fn.lastIndexOf("return @($out)"));
    });
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
    expect(s.minimized).toEqual([
      { ms: 307, pid: 14724, proc: "WindowsTerminal", cls: "CASCADIA_HOSTING_WINDOW_CLASS", title: "Windows PowerShell" },
    ]);
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

  // The exclusion added on 2026-09-07 is only as good as the fields it reads. If the probe stops
  // emitting them, `isRunnerTooling` silently degrades to "exclude nothing" -- which is the SAFE
  // direction, but it also brings the false positive back, so the wiring is pinned rather than
  // trusted. Pinned in the SOURCE because the runtime tier that would exercise it skips on any
  // machine where a compy is already running.
  it("the parent of every event's process is read AT EVENT TIME, not reconstructed later", () => {
    // A transient console's process is gone by the time Resolve-Trace runs (recorded 2026-09-07:
    // `proc` was null on every one of them), so this read has no second chance.
    expect(HOOK_SRC, "WinEvent must carry a ppid field").toMatch(/public int ppid;/);
    expect(HOOK_SRC, "the hook must fill it inside the callback").toMatch(/e\.ppid = ParentOf\(e\.pid\);/);
    expect(HOOK_SRC, "0 is the fail-closed answer -- an unresolvable ancestry must never match").toMatch(
      /if \(pid <= 0\) return 0;/,
    );
    expect(HOOK_SRC, "the query needs only PROCESS_QUERY_LIMITED_INFORMATION, never elevation").toContain(
      "PROCESS_QUERY_LIMITED_INFORMATION = 0x1000",
    );
    const add = HOOK_SRC.indexOf("Events.Add(e);");
    const fill = HOOK_SRC.indexOf("e.ppid = ParentOf(e.pid);");
    expect(fill, "the ppid must be set before the event is recorded").toBeLessThan(add);
  });

  it("the probe reports its OWN tree, and stops before it reaches the owner's shell", () => {
    expect(PROBE_SRC, "runnerPids is what makes the exclusion attributable").toMatch(/runnerPids\s+= \$runnerPids/);
    expect(PROBE_SRC, "parents is how a dead console's chain is still walkable").toMatch(/parents\s+= \$parents/);
    expect(PROBE_SRC, "the trace must carry the event-time parent through to the caller").toMatch(/ppid\s+= \$e\.ppid/);
    // The bound is the whole safety argument. Walk one hop further -- into the interactive shell,
    // or worse into explorer.exe -- and the owner's own windows land inside the "tooling" set,
    // which is exactly the harm this guard exists to catch.
    const ancestry = PROBE_SRC.slice(PROBE_SRC.indexOf("function Get-RunnerAncestry"), PROBE_SRC.indexOf("function Get-ParentMap"));
    const body = ancestry.slice(ancestry.indexOf("param("));
    expect(ancestry, "the walk must stop at the first non-tooling ancestor").toMatch(/\$sawRunner/);
    expect(body, "the runner set is node/npm-family IMAGE names, not window titles").toMatch(/node = \$true/);
    expect(body, "a hop cap keeps a lying or cyclic chain from spinning").toMatch(/MaxHops/);
    // The shell hop exists only to cross from the probe's own powershell into the node tree. Once a
    // node ancestor has been seen it must NOT be taken again, or the walk climbs out through the
    // interactive shell that ran `npm test` and swallows the owner's own windows.
    expect(body, "the shell hop must be gated on not having seen the runner yet").toMatch(
      /\$shellHop\.ContainsKey\(\$name\) -and -not \$sawRunner/,
    );
    expect(body, "no desktop shell may be walked into -- that is the whole bound").not.toMatch(/explorer|dwm|winlogon/i);
  });

  it("the runner tree is walked while the tree is still alive -- the kill destroys the evidence", () => {
    const walk = PROBE_SRC.indexOf("$runnerPids = @(Get-RunnerAncestry");
    const map = PROBE_SRC.indexOf("$parents = Get-ParentMap");
    const kill = PROBE_SRC.indexOf("Stop-Process -Id $p.Id -Force");
    expect(walk).toBeGreaterThan(-1);
    expect(map).toBeGreaterThan(-1);
    expect(kill, "walk the ancestry before the finally block kills anything").toBeGreaterThan(walk);
    expect(kill).toBeGreaterThan(map);
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

// ── A MEASUREMENT THAT DID NOT HAPPEN MUST NOT READ AS A PASS (issue #121, 2026-08-22) ──────────
// Measured this session: the runtime tier was run TWELVE times in a row to try to reproduce #121's
// intermittent reading. All twelve printed "Tests 47 passed" and not one of them launched anything
// -- a compy left running by an unrelated measurement held the single-instance lock, so the tier
// skipped itself every time. The skip WAS announced, on stdout, which the default vitest reporter
// does not show for a passing test; only `--reporter=verbose` revealed it. Twelve green runs were
// read as twelve clean measurements.
//
// So every path that declines to measure now ends in `ctx.skip()`. The summary line then reads
// "Tests 45 passed | 2 skipped", which is visible in the DEFAULT reporter and cannot be mistaken for
// proof. The console lines stay -- they carry the reason -- but nothing depends on them being seen.
// COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF still turns every one of these into a hard failure.
describe.runIf(windows && BINARY)("RUNTIME: a real launch, watched by GetForegroundWindow", () => {
  // DECLARATION ORDER IS LOAD-BEARING. The self-test runs FIRST because Windows holds a foreground
  // LOCK for a moment after the active window changes, and each measurement ends by killing the app
  // it launched. Measured: with the quiet case first, the following ACTIVATING launch could not
  // reach the foreground either -- a state in which the quiet case proves nothing and passes anyway.
  // The probe's own settle wait covers the same hazard; the ordering is the belt to its braces.
  it(
    "the probe is not blind: an explicit COMPY_ACTIVATE launch DOES take the foreground",
    (ctx) => {
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
        return ctx.skip();
      }
      if (unmeasurableBecauseRunning()) return ctx.skip();
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
    (ctx) => {
      if (unmeasurableBecauseRunning()) return ctx.skip();
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
      // ── THE HARM IS MEASURABLE EVEN WHEN THE CAUSE IS NOT (issue #121, 2026-08-22) ────────────
      // Reproduced this day, 4 times in 15 consecutive runs (27%), traces kept. In all four the
      // launched Compy really did hold the foreground -- 55/55 poll samples, and the hook's own
      // FOREGROUND event carries fgPid == launchedPid, so the foreground genuinely moved. In the
      // eleven clean runs the SAME event fires at the same millisecond with fgPid still 8268: the
      // window announces itself and the foreground never leaves the terminal. That field, not the
      // poll's millisecond ordering, is what tells the two apart.
      //
      // Attributing the four to a CAUSE stays out of reach at this resolution: with --no-activate
      // and no activation path left in the binary, Windows fronting a fresh launch and the app
      // raising itself look identical from outside. But the owner's ask was never about causes --
      // it was "it minimises my primary monitor". THAT is in the trace, on every run, measurable or
      // not: a MINIMIZESTART on a window outside the launched family is his window going down.
      // Asserted here, above every skip below, so the 27% of runs that cannot name a cause still
      // prove the harm did not happen. All 15 runs recorded none.
      //
      // ── AND THIS TEST RUN'S OWN CONSOLES ARE NOT THAT WINDOW (2026-09-07) ────────────────────
      // Measured: three verify-local.ps1 runs, FAIL/PASS/FAIL, against a diff of two Rust files
      // that touches no window or focus code. Both failures were a node child's console blinking
      // shut mid-measurement (class ConsoleWindowClass, `proc` already null, `fgPid` null -- no
      // foreground change attributed to it at all). `isRunnerTooling` discounts exactly those:
      // console CLASS plus an ancestry that reaches this run's own node/npm tree. The title is
      // never read, so nothing can excuse itself by claiming to be node.exe, and an ancestry that
      // cannot be resolved is still scored as harm. What was discounted is printed by
      // describeTrace on every run, so a wrong exclusion is visible rather than silent.
      const { minimized } = summarizeTrace(result);
      expect(
        minimized.map((m) => `${m.proc ?? "?"}(${m.pid ?? "?"}) ${m.cls ?? ""} "${m.title}" at ${m.ms}ms`),
        `a window OUTSIDE the launched app was MINIMISED during the launch. This is the owner's ` +
          `game going down -- the harm this guard exists for -- and it is asserted whether or not ` +
          `the cause of the foreground change can be attributed.\n` + describeTrace(result),
      ).toEqual([]);

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
        return ctx.skip();
      }
      if (verdict === "unmeasurable" && !process.env.COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF) {
        // Reported by name, never silently. Reproduced 3/3 on 2026-08-18 against the 0.9.25 desk
        // build with VS Code holding the foreground: first foreground 7ms, first window 12ms — one
        // poll apart, so the order between them is the poll's, not the machine's.
        console.log(
          `[launch-focus-guard] quiet-launch reading UNMEASURABLE: the foreground (${result.firstForegroundMs}ms) ` +
            `and the window (${result.firstWindowMs}ms) were first seen inside one ${PROBE_INTERVAL_MS}ms poll ` +
            `(${result.ownedForegroundSamples}/${result.samples} samples), which cannot tell an in-process raise ` +
            `apart from Windows fronting a fresh launch (issue #121). This run did not measure Compy either way, `
            + `but no window outside the launch was minimised, which is asserted above on every run. ` +
            `Refuse the skip with COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF=1 — nothing in the repo sets it today, ` +
            `it is the by-hand switch for a run that must not be allowed to skip.\n` +
            // The poll could not tell the two causes apart; the event trace can. Printed every time so
            // the reading that finally closes #121 is on record wherever this run happened.
            describeTrace(result),
        );
        return ctx.skip();
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

describe("a run that measured nothing cannot report itself as a pass (issue #121)", () => {
  const SELF = read("scripts", "launch-focus-guard.test.mjs");
  /** The runtime describe block, from its opening line to the end of the file's runtime section. */
  const runtimeBlock = () => {
    const start = SELF.indexOf('describe.runIf(windows && BINARY)("RUNTIME:');
    expect(start, "the RUNTIME describe block must still exist").toBeGreaterThan(-1);
    const end = SELF.indexOf("\ndescribe(", start);
    return SELF.slice(start, end === -1 ? SELF.length : end);
  };

  it("every declined measurement in the runtime tier skips, and none of them just returns", () => {
    const block = runtimeBlock();
    // A bare `return;` here is the defect itself: it ends the test with no assertion run, which
    // vitest scores as a pass. Every exit that means "did not measure" must say so to the reporter.
    const bare = [...block.matchAll(/^\s*return;\s*$/gm)];
    expect(
      bare.length,
      "a bare `return;` inside the runtime tier reports a measurement that never happened as a " +
        "PASS. Use `return ctx.skip()` so the summary line counts it as skipped.",
    ).toBe(0);
    expect(
      (block.match(/return ctx\.skip\(\)/g) ?? []).length,
      "the runtime tier has four ways to decline a measurement (already running, activation opt-out, " +
        "and two unmeasurable readings); each one must skip",
    ).toBeGreaterThanOrEqual(4);
  });

  it("the minimise check is asserted BEFORE any skip can decline the measurement", () => {
    // The ordering IS the guarantee. A run that cannot attribute the foreground change still knows
    // whether a window outside the launch went down -- that is the owner's actual complaint -- so
    // the assertion has to sit above the two unmeasurable `return ctx.skip()` branches. Move it
    // below them and 27% of runs (measured 2026-08-22: 4 of 15) stop checking for the harm at all.
    // Scoped to the quiet-launch test, which is the one that measures #121; the activation
    // self-test above it declines for its own reasons and has no trace to check.
    const tier = runtimeBlock();
    const block = tier.slice(tier.indexOf('"a quiet launch opens a real visible window'));
    const check = block.indexOf("summarizeTrace(result)");
    const firstDecline = block.indexOf("return ctx.skip()", block.indexOf("const result = measureLaunch"));
    expect(check, "the runtime tier must read the trace's minimised windows").toBeGreaterThan(-1);
    expect(
      check < firstDecline || firstDecline === -1,
      "the `minimized` assertion must run before the first unmeasurable skip, or the runs that " +
        "cannot name a cause stop proving the harm did not happen",
    ).toBe(true);
    expect(block, "and it must assert, not merely compute").toMatch(/minimized[\s\S]{0,600}toEqual\(\[\]\)/);
  });

  it("the skip is still refusable, so a release cannot ship on skips", () => {
    // The escape valve only exists because a skip is honest. If this env var stopped being read,
    // every unmeasurable run would become unrefusable and the tier would be decorative.
    expect(runtimeBlock()).toContain("COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF");
  });
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
