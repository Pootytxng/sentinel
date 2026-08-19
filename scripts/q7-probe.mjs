// q7-probe.mjs - the Q7 native measurement harness.
//
// WHY THIS EXISTS. docs/superpowers/specs/2026-07-31-q7-native-baseline.md left five rows
// "not measured" on the stated grounds that they "need a debug port the shipped build deliberately
// does not open ... Measuring them means a purpose-built instrumented build". That is FALSE, and the
// repo's own tooling disproves it: WebView2 reads --remote-debugging-port out of
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS in the environment of the LAUNCHING process, so the SHIPPED
// binary opens a port when we start it that way (scripts/ship-reinstall.ps1 already does exactly
// this for its release proof, and scripts/e2e-updater-probe.mjs already drives it). No instrumented
// build, no rebuild, no divergence between what is measured and what ships.
//
// So this measures the real artifact. Every number it emits is recorded, not asserted:
// docs/perf/q7-baseline.json is the evidence record the Q7 budgets are DERIVED from, and
// scripts/perf-baseline-guard.test.mjs fails the build if a budget stops tracing back to it.
//
// The port is opened by US, for the duration of a measurement, and closed by putting the app back.
// ship-reinstall.ps1:236 refuses to relaunch while WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set in
// the process precisely so a debugging port cannot leak into the owner's desk build; `restore` below
// is this script's half of that contract.
//
// Usage (Node >= 21 for global WebSocket/fetch; ASCII only, per the encoding guard):
//   node scripts/q7-probe.mjs coldstart [--port 9455] [--out FILE]
//   node scripts/q7-probe.mjs rooms     [--port 9455] [--dwell 15000] [--out FILE]
//   node scripts/q7-probe.mjs latency   [--port 9455] [--out FILE]
//   node scripts/q7-probe.mjs idle      [--port 9455] [--minutes 10] [--hidden] [--out FILE]
//   node scripts/q7-probe.mjs idle-bare [--minutes 10] [--settle 45]   <- no CDP; the honest CPU number
//   node scripts/q7-probe.mjs attribute [--port 9455] [--settle 45] [--phase 120] [--inject-css FILE]
//                              <- WHY idle costs what it costs: freeze rAF, then animations, then timers
//                              --inject-css appends FILE's CSS last in the cascade at document-start, so
//                              a styling hypothesis is A/B-ed against the SHIPPED binary in ~6 minutes
//                              instead of a rebuild. The run records the file, its bytes and its text,
//                              so an overridden run can never be mistaken for a clean baseline.
//   node scripts/q7-probe.mjs a11y      [--port 9455] [--w 1280] [--h 720] [--out FILE]
//   node scripts/q7-probe.mjs eval      [--port 9455] --expr "<js>"
//   node scripts/q7-probe.mjs restore   -- kill every port-bearing instance, relaunch clean
//
// Subcommands attach to an instance this script launched (it writes the pid/port to a lockfile in
// the OS temp dir), or launch one if none is live.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WINDOW_PROBE_EXPRESSION, pickMainTarget } from "./lib/tauri-window-pick.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXE = join(process.env.LOCALAPPDATA ?? "", "Compy", "compy.exe");
const LOCK = join(tmpdir(), "q7-probe.lock.json");
const DEFAULT_PORT = 9455;

// ---------------------------------------------------------------------------- args

const [, , cmd, ...rest] = process.argv;
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue;
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("--")) flags[key] = true;
  else {
    flags[key] = next;
    i++;
  }
}
const PORT = Number(flags.port ?? DEFAULT_PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------- process control

function ps(script) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return (r.stdout ?? "").trim();
}

/** Every compy.exe pid, plus the webview host processes each one owns. */
function processTree(rootPid) {
  const out = ps(
    `$root=${rootPid}; $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name;` +
      `$keep=New-Object System.Collections.Generic.HashSet[int]; [void]$keep.Add($root); $changed=$true;` +
      `while($changed){$changed=$false; foreach($p in $all){ if($keep.Contains([int]$p.ParentProcessId) -and -not $keep.Contains([int]$p.ProcessId)){[void]$keep.Add([int]$p.ProcessId); $changed=$true} }}` +
      `$keep | ForEach-Object { $_ } | ConvertTo-Json -Compress`,
  );
  try {
    const v = JSON.parse(out || "[]");
    return Array.isArray(v) ? v : [v];
  } catch {
    return [rootPid];
  }
}

/** One sample of the process group: cpu seconds consumed to date, and memory right now. */
function sampleProcesses(pids) {
  const list = pids.join(",");
  const out = ps(
    `Get-Process -Id ${list} -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ ` +
      `id=$_.Id; name=$_.ProcessName; cpu=$_.CPU; ws=$_.WorkingSet64; priv=$_.PrivateMemorySize64; ` +
      `threads=$_.Threads.Count; handles=$_.HandleCount } } | ConvertTo-Json -Compress`,
  );
  try {
    const v = JSON.parse(out || "[]");
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}

function runningCompyPids() {
  const out = ps(`(Get-Process compy -ErrorAction SilentlyContinue | Select-Object -Expand Id) -join ","`);
  return out ? out.split(",").map(Number).filter(Boolean) : [];
}

/**
 * Kill every compy.exe and WAIT for the kernel to agree.
 *
 * One Stop-Process pass is not enough: process exit is asynchronous, and Compy runs more than one
 * compy.exe (the shell plus the ETW capture helper), so a single-shot kill returns while a pid is
 * still dying and launch() then refuses with "already running". Retries inside PowerShell so the
 * whole wait costs one spawn. Returns the number of survivors -- 0 on success.
 */
function killAllCompy(timeoutSeconds = 12) {
  const out = ps(
    `$deadline=(Get-Date).AddSeconds(${timeoutSeconds});` +
      `while((Get-Date) -lt $deadline){` +
      `$p=Get-Process compy -ErrorAction SilentlyContinue; if(-not $p){break};` +
      `$p | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300 };` +
      `(Get-Process compy -ErrorAction SilentlyContinue | Measure-Object).Count`,
  );
  return Number(out) || 0;
}

function moveWindow(pid, x, y, w, h) {
  return ps(
    `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Q7Win {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int X,int Y,int W,int H,bool r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 };
if (-not $p) { "no-window"; exit }
[Q7Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[Q7Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
[Q7Win]::MoveWindow($p.MainWindowHandle, ${x}, ${y}, ${w}, ${h}, $true) | Out-Null
"ok"`,
  );
}

function showWindow(pid, nCmdShow) {
  return ps(
    `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Q7Show { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c); }
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 };
if (-not $p) { "no-window"; exit }
[Q7Show]::ShowWindow($p.MainWindowHandle, ${nCmdShow}) | Out-Null
"ok"`,
  );
}

// ---------------------------------------------------------------------------- CDP

function rpc(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
}

async function open(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  return { ws, call: rpc(ws), close: () => ws.close() };
}

async function targets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

/**
 * Attach to the MAIN window — identified by its Tauri label, never by what it happens to be
 * rendering. See scripts/lib/tauri-window-pick.mjs for why the old content heuristic picked the
 * overlay at cold start and what that cost.
 */
async function attachMain(port) {
  const { target } = await pickMainTarget({
    listTargets: async () => (await targets(port)).filter((t) => t.type === "page"),
    probeTarget: async (t) => {
      const s = await open(t);
      try {
        const probe = await s.call("Runtime.evaluate", {
          expression: WINDOW_PROBE_EXPRESSION,
          returnByValue: true,
        });
        return probe.result?.value ?? null;
      } finally {
        s.close();
      }
    },
  });
  return open(target);
}

async function evaluate(session, expression, awaitPromise = true) {
  const r = await session.call("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`eval failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)}`);
  }
  return r.result?.value ?? null;
}

// ---------------------------------------------------------------------------- instrumentation
//
// Installed into the LIVE page, either at document start (see session({fresh:true})) or after load.
// Bump Q7_INSTRUMENT_VERSION whenever the payload changes: a window still carrying an older build of
// this instrument reports STALE rather than being silently reused, and session() reloads into the
// new one. Re-running the payload over an existing install would wrap the wrappers and double-count.

const Q7_INSTRUMENT_VERSION = 3;

const INSTRUMENT = `(() => {
  if (window.__q7) {
    return window.__q7.v === ${Q7_INSTRUMENT_VERSION}
      ? { already: true, since: window.__q7.installedAt }
      : { stale: true, v: window.__q7.v ?? 1 };
  }
  const q7 = (window.__q7 = {
    v: ${Q7_INSTRUMENT_VERSION},
    installedAt: Date.now(),
    invokes: Object.create(null),
    rafScheduled: 0,
    rafFired: 0,
    draws: 0,
    liveIntervals: new Map(),
    intervalSeq: 0,
  });
  const origRaf = window.requestAnimationFrame.bind(window);
  const origSI = window.setInterval.bind(window);
  const origCI = window.clearInterval.bind(window);

  // The IPC counter, at the TRANSPORT.
  //
  // The obvious hook -- wrapping window.__TAURI_INTERNALS__.invoke -- cannot work on this build and
  // fails SILENTLY, which is how it first shipped a confident, wrong ZERO. Measured on the installed
  // dc4d55e: the document-start wrapper installs fine at nav+9ms, and then Tauri's own init script
  // redefines invoke as { writable: false, configurable: false }, discarding the wrapper. The object
  // still carries our marker (__q7patched) while invoke is the untouched original, so every
  // identity check says "patched" and every count stays 0. window.ipc.postMessage is locked the
  // same way, and window.chrome.webview.postMessage sees no IPC at all.
  //
  // What Tauri 2 on Windows actually does per invoke is fetch("http://ipc.localhost/<command>")
  // -- verified live: one invoke("get_build_stamp") produced exactly one such fetch. window.fetch
  // IS writable, the command name is the URL's last path segment, and this counts plugin IPC too.
  // q7.ipcCounterLive re-derives liveness from the live global on every snapshot, so a lost patch
  // reports itself instead of reporting zero.
  q7.otherFetches = 0;
  q7.ipcVia = null;
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    const wrapped = function (input, init) {
      try {
        const u = String((input && input.url) || input || "");
        if (u.indexOf("ipc.localhost") !== -1) {
          // Plugin commands arrive percent-encoded ("plugin%3Aevent%7Clisten"); record the name a
          // human reads in a report.
          let cmd = u.slice(u.lastIndexOf("/") + 1) || "(unnamed)";
          try { cmd = decodeURIComponent(cmd); } catch (e) {}
          q7.invokes[cmd] = (q7.invokes[cmd] || 0) + 1;
        } else {
          q7.otherFetches++;
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    wrapped.__q7 = true;
    window.fetch = wrapped;
    q7.ipcVia = window.fetch && window.fetch.__q7 ? "fetch:ipc.localhost" : null;
  }

  // Frame counter, driven by an UNPATCHED rAF so it does not inflate its own subject. Without it
  // rafFired is uninterpretable: it counts callbacks, and N concurrent loops each get one per frame,
  // so "261/s" is N x refresh rate, not a frame rate. frames gives the denominator.
  q7.frames = 0;
  (function tick() {
    q7.frames++;
    origRaf(tick);
  })();

  window.requestAnimationFrame = function (cb) {
    q7.rafScheduled++;
    return origRaf(function (t) {
      q7.rafFired++;
      return cb(t);
    });
  };
  window.setInterval = function (fn, delay) {
    const extra = Array.prototype.slice.call(arguments, 2);
    const id = origSI.apply(window, [fn, delay].concat(extra));
    q7.liveIntervals.set(id, Number(delay) || 0);
    return id;
  };
  window.clearInterval = function (id) {
    q7.liveIntervals.delete(id);
    return origCI(id);
  };
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!ctor) continue;
    for (const m of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const orig = ctor.prototype[m];
      if (typeof orig !== "function") continue;
      ctor.prototype[m] = function () {
        q7.draws++;
        return orig.apply(this, arguments);
      };
    }
  }
  return { already: false, installedAt: q7.installedAt };
})()`;

const SNAPSHOT = `(() => {
  const q7 = window.__q7;
  if (!q7) return null;
  const intervals = Object.create(null);
  for (const d of q7.liveIntervals.values()) intervals[String(d)] = (intervals[String(d)] || 0) + 1;
  return {
    t: Date.now(),
    // Re-derived from the LIVE global every read: a counter that has been unhooked must say so,
    // never silently report 0. Any window where this is false is a void reading.
    ipcCounterLive: !!(window.fetch && window.fetch.__q7),
    ipcVia: q7.ipcVia,
    invokes: Object.assign({}, q7.invokes),
    invokeTotal: Object.values(q7.invokes).reduce((a, b) => a + b, 0),
    frames: q7.frames,
    rafScheduled: q7.rafScheduled,
    rafFired: q7.rafFired,
    draws: q7.draws,
    liveIntervals: q7.liveIntervals.size,
    intervalDelays: intervals,
    visibility: document.visibilityState,
    room: (() => { const b = document.querySelector(".v2-nav-item[aria-selected='true']");
      return b ? (b.querySelector("span")?.textContent ?? b.textContent ?? "").replace(/\\s+/g, " ").trim() : null; })(),
    canvases: document.querySelectorAll("canvas").length,
    animations: typeof document.getAnimations === "function" ? document.getAnimations().length : null,
  };
})()`;

// Rail buttons carry a glyph, a label span and a <kbd> shortcut digit, so raw textContent reads
// "Home1". Speak the LABEL -- and never the nav id, which is a persistence key, not a room name.
const ROOM_LABEL = (el) =>
  `((b) => (b.querySelector("span")?.textContent ?? b.textContent ?? "").replace(/\\s+/g, " ").trim())(${el})`;
const ROOM_LIST = `[...document.querySelectorAll(".v2-nav-item")].map((b) => ${ROOM_LABEL("b")})`;
const ACTIVE_ROOM = `(() => { const b = document.querySelector(".v2-nav-item[aria-selected='true']");
  return b ? ${ROOM_LABEL("b")} : null; })()`;

const RESET = `(() => {
  const q7 = window.__q7;
  if (!q7) return null;
  q7.invokes = Object.create(null);
  q7.rafScheduled = 0;
  q7.rafFired = 0;
  q7.frames = 0;
  q7.draws = 0;
  return { t: Date.now() };
})()`;

/** delta = b - a, for the counters that accumulate. */
function delta(a, b) {
  const invokes = {};
  for (const k of new Set([...Object.keys(a.invokes), ...Object.keys(b.invokes)])) {
    const d = (b.invokes[k] ?? 0) - (a.invokes[k] ?? 0);
    if (d) invokes[k] = d;
  }
  const seconds = (b.t - a.t) / 1000;
  return {
    seconds: Number(seconds.toFixed(2)),
    invokes,
    invokeTotal: b.invokeTotal - a.invokeTotal,
    invokesPerSecond: Number(((b.invokeTotal - a.invokeTotal) / seconds).toFixed(2)),
    rafScheduled: b.rafScheduled - a.rafScheduled,
    rafFired: b.rafFired - a.rafFired,
    frames: b.frames - a.frames,
    // How fast the compositor is running for this window ...
    displayFps: Number(((b.frames - a.frames) / seconds).toFixed(1)),
    // ... and how many independent rAF loops are riding it. This is the honest reading of "does an
    // inactive room stand down": one loop is the shell's, more than one means a room is animating.
    concurrentRafLoops:
      b.frames - a.frames > 0
        ? Number(((b.rafFired - a.rafFired) / (b.frames - a.frames)).toFixed(2))
        : null,
    draws: b.draws - a.draws,
    drawsPerSecond: Number(((b.draws - a.draws) / seconds).toFixed(1)),
    drawsPerFrame:
      b.frames - a.frames > 0 ? Number(((b.draws - a.draws) / (b.frames - a.frames)).toFixed(2)) : null,
    liveIntervals: b.liveIntervals,
    intervalDelays: b.intervalDelays,
    visibility: b.visibility,
    // Carried into every window so a void reading is visible in the artifact, not just at the console.
    ipcCounterLive: a.ipcCounterLive && b.ipcCounterLive,
  };
}

// ---------------------------------------------------------------------------- lifecycle

function readLock() {
  if (!existsSync(LOCK)) return null;
  try {
    return JSON.parse(readFileSync(LOCK, "utf8"));
  } catch {
    return null;
  }
}

async function portAlive(port) {
  try {
    await targets(port);
    return true;
  } catch {
    return false;
  }
}

/** Launch the INSTALLED release exe with the debug port open. Returns { pid, port, spawnedAt }. */
async function launch(port) {
  if (!existsSync(EXE)) throw new Error(`installed build not found: ${EXE}`);
  const live = runningCompyPids();
  if (live.length) {
    throw new Error(
      `compy is already running (pid ${live.join(", ")}) without our port. ` +
        `Close it first, or run: node scripts/q7-probe.mjs restore`,
    );
  }
  const spawnedAt = Date.now();
  const child = spawn(EXE, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  });
  child.unref();
  const lock = { pid: child.pid, port, spawnedAt, exe: EXE };
  writeFileSync(LOCK, JSON.stringify(lock, null, 2));
  return lock;
}

/**
 * Attach to a live instrumented instance, launching one if needed.
 *
 * `fresh` matters more than it looks. Injecting into an already-mounted page can only count what
 * happens NEXT: an interval created during boot is invisible to a setInterval patch installed after
 * boot, so a post-hoc "2 live intervals" reading is really "2 created since I started watching" and
 * the honest live count is unknowable. `fresh` installs the instrument via
 * Page.addScriptToEvaluateOnNewDocument and reloads, so the counters exist before the app's first
 * line runs and every number is a complete census. Cost: it is a warm reload, not a process start --
 * so `coldstart` measures the process, and everything that needs complete counters uses `fresh`.
 */
async function session(port, { launchIfDead = true, fresh = false } = {}) {
  if (!(await portAlive(port))) {
    if (!launchIfDead) throw new Error(`nothing listening on ${port}`);
    await launch(port);
    await waitForPort(port, 30000);
    // A cold launch is ALWAYS a fresh session, whatever the caller asked for. The debug target exists
    // before the app document does, so an instrument evaluated at attach time lands on the throwaway
    // initial document and is wiped by the navigation that follows -- window.__q7 then never appears
    // and the readiness wait can only time out. addScriptToEvaluateOnNewDocument survives navigation,
    // which is the only ordering that works when we started the process ourselves.
    fresh = true;
  }
  const s = await attachMain(port);
  if (!fresh) {
    const installed = await evaluate(s, INSTRUMENT);
    // A window left over from an older instrument cannot be trusted or re-patched in place; the only
    // honest recovery is to reload into the current payload.
    // The readiness wait is NOT optional on this path: a CDP target exists as soon as the webview
    // does, so attaching to a just-launched instance lands on a page whose rail has not mounted.
    // Skipping it once cost a whole a11y run -- every room query returned [] and the first
    // .v2-nav-item click threw on undefined, ~4 s before the app would have been ready.
    if (!installed?.stale) return await waitUsable(s);
    console.error(`instrument v${installed.v} found in the live window; reloading into v${Q7_INSTRUMENT_VERSION}`);
  }
  await s.call("Page.enable");
  await s.call("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  await s.call("Page.reload", { ignoreCache: false });
  return await waitUsable(s);
}

/** Block until the app is genuinely usable: instrument live, rail mounted, body painted. */
async function waitUsable(s, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(
        s,
        `({ q7: !!window.__q7, rail: document.querySelectorAll(".v2-nav-item").length,
            body: document.body ? document.body.innerText.length : 0 })`,
      );
      if (ready.q7 && ready.rail > 0 && ready.body > 400) return s;
    } catch {
      /* execution context swapped mid-reload */
    }
    await sleep(100);
  }
  throw new Error("page never became usable");
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portAlive(port)) return Date.now();
    await sleep(50);
  }
  throw new Error(`port ${port} never opened within ${timeoutMs}ms`);
}

function writeOut(name, data) {
  const out = flags.out ? String(flags.out) : join(ROOT, "docs", "perf", "raw", `${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data, null, 2));
  return out;
}

// ---------------------------------------------------------------------------- tasks

/**
 * COLD START. Wall-clock from spawn to: the debug port answering, the document existing, the rail
 * painted, and Home carrying real content. Timed from OUTSIDE the app so nothing the app reports
 * about itself is taken on trust; the in-page navigation timing is recorded alongside as a
 * cross-check, not as the number.
 */
async function coldstartSample() {
  killAllCompy();
  await sleep(1500);
  const lock = await launch(PORT);
  const marks = { spawnedAt: lock.spawnedAt };

  marks.portOpen = await waitForPort(PORT, 60000);

  // Poll the page for readiness milestones. Re-attaching each round is deliberate: the first target
  // list can name a page that is replaced moments later.
  const READY = `(() => {
    const rail = document.querySelectorAll(".v2-nav-item").length;
    const body = document.body ? document.body.innerText.length : 0;
    return {
      state: document.readyState,
      rail,
      body,
      canvases: document.querySelectorAll("canvas").length,
      selected: (() => { const b = document.querySelector(".v2-nav-item[aria-selected='true']");
        return b ? (b.querySelector("span")?.textContent ?? b.textContent ?? "").replace(/\\s+/g, " ").trim() : null; })(),
      nav: (() => { const n = performance.getEntriesByType("navigation")[0];
        return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null; })(),
      origin: Math.round(performance.timeOrigin),
    };
  })()`;

  const deadline = Date.now() + 60000;
  let s = null;
  let last = null;
  while (Date.now() < deadline) {
    try {
      if (!s) s = await attachMain(PORT);
      const v = await evaluate(s, READY);
      last = v;
      if (!marks.documentReady && v.state !== "loading") marks.documentReady = Date.now();
      if (!marks.railPainted && v.rail > 0) marks.railPainted = Date.now();
      if (!marks.homeContent && v.rail > 0 && v.body > 400) marks.homeContent = Date.now();
      if (marks.homeContent) break;
    } catch {
      s?.close();
      s = null;
    }
    await sleep(50);
  }
  if (!s) s = await attachMain(PORT);
  await evaluate(s, INSTRUMENT);

  // Let the first burst of startup IPC settle, then record what booting actually cost.
  await sleep(8000);
  const settled = await evaluate(s, SNAPSHOT);
  const pids = processTree(lock.pid);
  const procs = sampleProcesses(pids);

  const rel = (k) => (marks[k] ? marks[k] - marks.spawnedAt : null);
  const result = {
    recordedAt: new Date().toISOString(),
    msFromSpawn: {
      portOpen: rel("portOpen"),
      documentReady: rel("documentReady"),
      railPainted: rel("railPainted"),
      usableHome: rel("homeContent"),
    },
    inPageNavigation: last?.nav ?? null,
    firstRoom: last?.selected ?? null,
    // NOT boot IPC: the instrument is installed once the page is already usable, so this is what the
    // app costs at REST on its first room. Boot's own IPC census is the `boot` task, which installs
    // before the app's first line runs. Same caveat on liveIntervals -- counted from injection, so
    // it is "started since Home was usable", not the true live total.
    restAfterUsable: {
      windowSeconds: Number(((settled.t - marks.spawnedAt) / 1000).toFixed(1)),
      ipcTotal: settled.invokeTotal,
      ipcByCommand: settled.invokes,
      intervalsStartedSince: settled.liveIntervals,
      intervalDelays: settled.intervalDelays,
      canvases: settled.canvases,
      documentAnimations: settled.animations,
    },
    processes: procs,
    processTotals: totals(procs),
  };
  s.close();
  return result;
}

/**
 * Cold start is the headline number a budget gets written against, so it is sampled, never taken
 * once. The first two runs of this probe disagreed by 1.3 seconds (3591 ms vs 4909 ms) on the same
 * build and the same machine -- a single sample would have committed the project to whichever run
 * happened to be recorded. The artifact keeps every sample plus min/median/max, and the budget is
 * derived from the WORST sample, not the median: a first-launch budget that only the good runs meet
 * is not a budget.
 */
async function taskColdstart() {
  const n = Math.max(1, Number(flags.n ?? 3));
  const samples = [];
  for (let i = 0; i < n; i++) {
    console.error(`coldstart sample ${i + 1}/${n} ...`);
    samples.push(await coldstartSample());
    if (i < n - 1) await sleep(2000);
  }
  const stat = (pick) => {
    const vals = samples.map(pick).filter((v) => typeof v === "number");
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      min: sorted[0],
      median: sorted[Math.floor((sorted.length - 1) / 2)],
      max: sorted[sorted.length - 1],
      samples: vals,
    };
  };
  const result = {
    task: "coldstart",
    recordedAt: new Date().toISOString(),
    exe: EXE,
    sampleCount: samples.length,
    summary: {
      usableHomeMs: stat((s) => s.msFromSpawn.usableHome),
      railPaintedMs: stat((s) => s.msFromSpawn.railPainted),
      documentReadyMs: stat((s) => s.msFromSpawn.documentReady),
      portOpenMs: stat((s) => s.msFromSpawn.portOpen),
      workingSetMB: stat((s) => s.processTotals.workingSetMB),
      processCount: stat((s) => s.processTotals.processCount),
    },
    samples,
  };
  console.log(JSON.stringify(result.summary, null, 2));
  console.log("written:", writeOut("coldstart", result));
}

/**
 * BOOT CENSUS. Every IPC command the app issues while starting up, and every interval it leaves
 * running afterwards -- complete, because the instrument is installed before the app's first line
 * runs (Page.addScriptToEvaluateOnNewDocument + reload). This is the reading that answers "does
 * exactly one owner supply each sensor stream", because a duplicated owner shows up here as a
 * command called twice as often as its cadence explains.
 */
async function taskBoot() {
  const s = await session(PORT, { fresh: true });
  const settle = Number(flags.settle ?? 20000);
  const first = await evaluate(s, SNAPSHOT);
  await sleep(settle);
  const after = await evaluate(s, SNAPSHOT);

  const result = {
    task: "boot",
    recordedAt: new Date().toISOString(),
    note:
      "Warm reload of the running release build, instrumented from document start. Process-launch " +
      "timing lives in the coldstart record; this is the complete IPC/timer census.",
    room: after.room,
    bootPlusSettle: {
      seconds: Number(((after.t - first.t) / 1000).toFixed(1)) + " after first read",
      ipcTotalAtFirstRead: first.invokeTotal,
      ipcByCommandAtFirstRead: first.invokes,
      ipcDuringSettle: delta(first, after).invokes,
    },
    liveIntervals: { count: after.liveIntervals, byDelayMs: after.intervalDelays },
    canvases: after.canvases,
    documentAnimations: after.animations,
    settleWindow: delta(first, after),
  };
  s.close();
  console.log(JSON.stringify(result, null, 2));
  console.log("written:", writeOut("boot", result));
}

function totals(procs) {
  const sum = (f) => procs.reduce((a, p) => a + (p[f] ?? 0), 0);
  return {
    processCount: procs.length,
    workingSetMB: Number((sum("ws") / 1048576).toFixed(2)),
    privateMB: Number((sum("priv") / 1048576).toFixed(2)),
    threads: sum("threads"),
    handles: sum("handles"),
    cpuSeconds: Number(sum("cpu").toFixed(2)),
  };
}

/**
 * PER-ROOM COST. Visit every room in the rail, dwell, and record what that room costs while it is
 * on screen -- and, critically, what the rooms BEHIND it keep costing. The keepalive rooms stay
 * mounted behind display:none for the rest of the session, so the honest reading of "does an
 * inactive room stand down" is: park on Home LAST, after everything has been mounted, and see
 * whether the idle cost of Home-with-everything-mounted matches Home-before-anything-was.
 */
async function taskRooms() {
  const dwell = Number(flags.dwell ?? 15000);
  const s = await session(PORT, { fresh: true });
  const rooms = await evaluate(s, ROOM_LIST);
  const visits = [];

  // Baseline first: whatever room is open on a fresh boot, before any other room has ever mounted.
  const baselineRoom = await evaluate(s, ACTIVE_ROOM);
  const b0 = await evaluate(s, SNAPSHOT);
  await sleep(dwell);
  const b1 = await evaluate(s, SNAPSHOT);
  visits.push({ room: baselineRoom, phase: "before-any-other-room-mounted", ...delta(b0, b1) });

  for (let i = 0; i < rooms.length; i++) {
    await evaluate(s, `document.querySelectorAll(".v2-nav-item")[${i}].click(); true`);
    await sleep(2500); // let the room mount and its first burst land
    const a = await evaluate(s, SNAPSHOT);
    await sleep(dwell);
    const b = await evaluate(s, SNAPSHOT);
    visits.push({ room: rooms[i], phase: "active", ...delta(a, b) });
  }

  // Back to the first room, now that every room in the app has mounted behind it.
  await evaluate(s, `document.querySelectorAll(".v2-nav-item")[0].click(); true`);
  await sleep(2500);
  const c0 = await evaluate(s, SNAPSHOT);
  await sleep(dwell);
  const c1 = await evaluate(s, SNAPSHOT);
  visits.push({ room: rooms[0], phase: "after-every-room-mounted", ...delta(c0, c1) });

  const result = {
    task: "rooms",
    recordedAt: new Date().toISOString(),
    dwellMs: dwell,
    rooms,
    visits,
  };
  s.close();
  console.log(JSON.stringify(result, null, 2));
  console.log("written:", writeOut("rooms", result));
}

/**
 * TAB-RETURN LATENCY. Click a room, then poll at 10ms for the moment the rail reports it selected
 * AND the room body has content. Measured over several rooms, several times each, because the first
 * visit pays mount cost that later visits do not -- and both numbers matter.
 */
async function taskLatency() {
  // Fresh, so pass 0 is a GENUINE first mount. Run against the warm window and "first" silently means
  // "already mounted by an earlier probe" -- the mount cost would be missing from the one column that
  // exists to show it.
  const s = await session(PORT, { fresh: true });
  const rooms = await evaluate(s, ROOM_LIST);
  const SWITCH = (i) => `(() => {
    const t0 = performance.now();
    document.querySelectorAll(".v2-nav-item")[${i}].click();
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const sel = document.querySelector(".v2-nav-item[aria-selected='true']");
        const main = document.querySelector(".v2-room") || document.querySelector("main") || document.body;
        const painted = sel && sel === document.querySelectorAll(".v2-nav-item")[${i}] && main.innerText.length > 200;
        if (painted) return resolve({ ms: Math.round(performance.now() - t0), body: main.innerText.length });
        if (performance.now() - started > 5000) return resolve({ ms: -1, body: main.innerText.length });
        requestAnimationFrame(tick);
      };
      tick();
    });
  })()`;

  const runs = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < rooms.length; i++) {
      const v = await evaluate(s, SWITCH(i));
      runs.push({ pass, room: rooms[i], ms: v.ms, bodyChars: v.body });
      await sleep(700);
    }
  }
  const byRoom = {};
  for (const r of runs) {
    (byRoom[r.room] ??= []).push(r.ms);
  }
  const summary = Object.fromEntries(
    Object.entries(byRoom).map(([room, ms]) => [
      room,
      { first: ms[0], repeat: ms.slice(1), worst: Math.max(...ms), median: median(ms) },
    ]),
  );
  const result = {
    task: "latency",
    recordedAt: new Date().toISOString(),
    note:
      "Click -> the rAF tick where the rail reports the room selected AND its body carries >200 " +
      "characters of text. Pass 0 is a genuine first mount (fresh reload). The >200-char rule is a " +
      "weak proxy for a room that is mostly canvas: Lab reports ~238 characters, so its figure means " +
      "'chrome painted', not 'scene rendered'.",
    rooms,
    runs,
    summary,
  };
  s.close();
  console.log(JSON.stringify(result, null, 2));
  console.log("written:", writeOut("latency", result));
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Number(((a[m - 1] + a[m]) / 2).toFixed(2));
}

/**
 * IDLE TRACE. The number the Q7 spec cares about most: what does Compy cost while nobody is using
 * it -- visible on a second monitor, and hidden behind a fullscreen game. CPU is taken as consumed
 * processor-seconds across the whole process tree over the window (not a per-sample instantaneous
 * read, which rounds to 0.00% and says nothing), then expressed as a share of one core.
 */
/**
 * BARE IDLE -- the CPU number a budget may actually be written against.
 *
 * Written to test a hypothesis that turned out to be WRONG, which is why it exists and why the
 * hypothesis is recorded here rather than quietly deleted. The instrumented idle trace reported
 * 50.95% of one core, and the expectation was that most of that was the instrument: the probe keeps
 * its own unpatched rAF loop alive as a frame denominator (see INSTRUMENT), and a live rAF loop
 * forces the compositor to keep producing frames, so the probe should pay for a share of the cost it
 * reports.
 *
 * It did not, on that build. Bare -- no debug port, no CDP, no injected script, just the shipped exe
 * under Windows' own per-process processor-time counters -- the same idle app measured 50.71%, and a
 * second independent bare run measured 50.17%, agreeing with the instrumented 50.95% to within a
 * point. The ~half-a-core was Compy's own, reproducibly, and that was a performance FINDING rather
 * than a baseline to budget around (docs/perf/README.md, and the spec's idle section).
 *
 * SINCE THE FIX (ff0ce65f), THAT AGREEMENT IS GONE AND THE ORIGINAL HYPOTHESIS IS LIVE AGAIN IN
 * REVERSE. Bare reads 23.10 / 23.35 over ten minutes; the instrumented attribution over an
 * equivalent 90-second window reads 11.69 -- the observer now appears to HALVE what it measures, and
 * its per-animation subtraction produced a negative band, which is a validity tell rather than a
 * saving. Shorter bare runs of the same build then read 16.69 / 12.23 / 10.51, and an occlusion
 * probe caught a foreign application owning the foreground for its whole window. The likeliest
 * reading is that window visibility, not the instrument, moves the number: a covered WebView2 stops
 * compositing. That is unproven -- the desk was not exclusive -- and until it is, treat any single
 * idle-CPU reading as conditional on window state and record which state it was taken in.
 *
 * The run stays in the suite regardless: it is the only measurement that owes nothing to the
 * observer, so it is what any future idle-CPU claim gets checked against.
 */
async function taskIdleBare() {
  const minutes = Number(flags.minutes ?? 10);
  const settleSeconds = Number(flags.settle ?? 45);
  if (!existsSync(EXE)) throw new Error(`installed build not found: ${EXE}`);
  killAllCompy();
  await sleep(1500);

  const child = spawn(EXE, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  const pid = child.pid;
  process.stderr.write(`bare launch pid ${pid}; settling ${settleSeconds}s\n`);
  await sleep(settleSeconds * 1000);
  const hidden = Boolean(flags.hidden);
  if (hidden) {
    showWindow(pid, 6);
    await sleep(3000);
  }

  const pids = processTree(pid);
  const cores = Number(ps(`[Environment]::ProcessorCount`)) || 1;
  const t0 = Date.now();
  const start = sampleProcesses(pids);
  const samples = [];
  const ticks = Math.max(1, Math.round((minutes * 60) / 30));
  for (let i = 0; i < ticks; i++) {
    await sleep(30000);
    samples.push({ t: Date.now(), ...totals(sampleProcesses(pids)) });
    process.stderr.write(`  bare idle sample ${i + 1}/${ticks}\n`);
  }
  const end = sampleProcesses(pids);
  const seconds = (Date.now() - t0) / 1000;
  const cpuStart = start.reduce((x, p) => x + (p.cpu ?? 0), 0);
  const cpuEnd = end.reduce((x, p) => x + (p.cpu ?? 0), 0);
  // Interpolated into the note below, not retyped there. The first version of this note hardcoded
  // "this measured 50.71%"; the next re-record wrote 50.165 into the cpu block and left the note
  // asserting the old figure, so the file contradicted itself in two adjacent fields. A recording
  // that describes itself has to derive the description from the same value it publishes.
  const percentOfOneCore = Number((((cpuEnd - cpuStart) / seconds) * 100).toFixed(3));

  const result = {
    task: "idle-bare",
    recordedAt: new Date().toISOString(),
    note:
      "No debug port, no CDP, no injected script -- the shipped exe alone, sampled through Windows' "
      + `per-process processor-time counters. This run measured ${percentOfOneCore}% of one core. `
      + "It is the one idle-CPU figure that owes nothing to the observer, and it holds: the "
      + "instrumented trace measured 50.95%, and the two bare runs of 2026-08-05 measured 50.71% "
      + "and 50.17%. The probe is NOT what makes idle Compy expensive -- that cost is the app's own.",
    // State matters for the memory rows and must not be compared blind: this is a FRESH boot parked
    // on Home, never navigated. The instrumented idle trace ran after the room sweep, with every
    // keepalive room still mounted behind display:none -- ~80 MB more working set. Same app, two
    // different amounts of it alive. CPU is comparable; memory is not.
    state: hidden ? "fresh boot, Home only, window minimized" : "fresh boot, Home only, window visible",
    minutes,
    settleSeconds,
    windowSeconds: Number(seconds.toFixed(1)),
    processCount: pids.length,
    cpu: {
      processorSeconds: Number((cpuEnd - cpuStart).toFixed(3)),
      percentOfOneCore,
      percentOfMachine: Number((((cpuEnd - cpuStart) / seconds / cores) * 100).toFixed(4)),
      cores,
    },
    memory: {
      workingSetMB: {
        first: samples[0]?.workingSetMB ?? null,
        last: samples.at(-1)?.workingSetMB ?? null,
        median: median(samples.map((x) => x.workingSetMB)),
        max: Math.max(...samples.map((x) => x.workingSetMB)),
      },
      privateMB: {
        median: median(samples.map((x) => x.privateMB)),
        max: Math.max(...samples.map((x) => x.privateMB)),
      },
      threads: median(samples.map((x) => x.threads)),
      handles: median(samples.map((x) => x.handles)),
    },
    samples,
  };
  console.log(JSON.stringify({ cpu: result.cpu, memory: result.memory }, null, 2));
  console.log("written:", writeOut(flags.hidden ? "idle-bare-hidden" : "idle-bare", result));
}

async function taskIdle() {
  const minutes = Number(flags.minutes ?? 10);
  const hidden = Boolean(flags.hidden);
  const s = await session(PORT);
  const lock = readLock();
  const pid = lock?.pid ?? runningCompyPids()[0];
  const pids = processTree(pid);

  if (hidden) {
    showWindow(pid, 6); // SW_MINIMIZE -- the closest honest stand-in for "occluded by a game"
    await sleep(2000);
  }
  const visibility = await evaluate(s, `document.visibilityState`);

  const start = sampleProcesses(pids);
  const a = await evaluate(s, SNAPSHOT);
  const samples = [];
  const ticks = Math.max(1, Math.round((minutes * 60) / 30));
  for (let i = 0; i < ticks; i++) {
    await sleep(30000);
    const procs = sampleProcesses(pids);
    samples.push({ t: Date.now(), ...totals(procs) });
    process.stderr.write(`  idle sample ${i + 1}/${ticks}\n`);
  }
  const b = await evaluate(s, SNAPSHOT);
  const end = sampleProcesses(pids);

  if (hidden) {
    showWindow(pid, 9); // SW_RESTORE
    await sleep(1000);
  }

  const cpuStart = start.reduce((x, p) => x + (p.cpu ?? 0), 0);
  const cpuEnd = end.reduce((x, p) => x + (p.cpu ?? 0), 0);
  const seconds = (b.t - a.t) / 1000;
  const cores = Number(ps(`[Environment]::ProcessorCount`)) || 1;

  const result = {
    task: "idle",
    recordedAt: new Date().toISOString(),
    minutes,
    hidden,
    visibilityState: visibility,
    windowSeconds: Number(seconds.toFixed(1)),
    cpu: {
      processorSeconds: Number((cpuEnd - cpuStart).toFixed(3)),
      percentOfOneCore: Number((((cpuEnd - cpuStart) / seconds) * 100).toFixed(3)),
      percentOfMachine: Number((((cpuEnd - cpuStart) / seconds / cores) * 100).toFixed(4)),
      cores,
    },
    memory: {
      workingSetMB: {
        first: samples[0]?.workingSetMB ?? null,
        last: samples.at(-1)?.workingSetMB ?? null,
        median: median(samples.map((x) => x.workingSetMB)),
        max: Math.max(...samples.map((x) => x.workingSetMB)),
      },
      privateMB: {
        median: median(samples.map((x) => x.privateMB)),
        max: Math.max(...samples.map((x) => x.privateMB)),
      },
      threads: median(samples.map((x) => x.threads)),
      handles: median(samples.map((x) => x.handles)),
      processCount: samples.at(-1)?.processCount ?? null,
    },
    webview: delta(a, b),
    samples,
  };
  s.close();
  console.log(JSON.stringify(result, null, 2));
  console.log("written:", writeOut(hidden ? "idle-hidden" : "idle-visible", result));
}

// ---------------------------------------------------------------------------- idle attribution
//
// A SEPARATE payload from INSTRUMENT, on purpose. INSTRUMENT installs its own unconditional rAF tick
// (the frame-rate denominator, see line ~295) driven by an unpatched rAF. Harmless for every other
// task; fatal for this one -- it would keep running straight through the frozen phase and turn the
// A/B below into noise, reporting the probe's own cost as the app's residual. taskAttribute()
// therefore never calls session(), and installs ONLY this.
//
// Every internal name is prefixed q7 so the capture frame can be filtered out of its own stack, and
// there is no regex anywhere in here: `\s` and `\/` inside a JS template literal are silently
// unescaped, so a regex written here does not arrive as the regex that was typed.

const RAF_TRAP = `(() => {
  if (window.__q7raf) return { already: true, installedAt: window.__q7raf.installedAt };
  const trap = (window.__q7raf = {
    scheduled: 0,
    fired: 0,
    live: new Map(),
    sites: Object.create(null),
    seq: 0,
    frozenRaf: false,
    frozenAnimations: false,
    frozenTimers: false,
    sampleEvery: 60,
    installedAt: Date.now(),
    // A freeze that merely cancels the armed handles is a one-shot: anything that re-arms from
    // OUTSIDE its own callback (a timer, an event, a self-healing ticker) walks straight back in and
    // the phase measures a half-frozen app. So the freeze is STICKY -- registration is refused while
    // frozen -- and every refusal is tallied WITH ITS STACK. The re-armer is then named rather than
    // merely detected, and the band stays valid instead of voiding.
    refused: { raf: 0, intervals: 0, timeouts: 0 },
    refusedSites: Object.create(null),
    frozenAnimationNames: Object.create(null),
    fakeSeq: 1,
  });
  const origRaf = window.requestAnimationFrame.bind(window);
  const origCaf = window.cancelAnimationFrame.bind(window);

  // WHERE the loop was armed. A CPU sampling profile attributes idle frame work to the browser's
  // frame dispatcher -- true, and useless: the dispatcher is not the code a fix has to touch. The
  // REGISTRATION stack names the module that armed the loop. Sampled 1-in-60, because capturing a
  // stack 60 times a second is itself a measurable cost, which is precisely the subject here. A
  // loop that re-arms every frame is sampled about once a second, so nothing persistent hides.
  function q7sig() {
    let raw = "";
    try { raw = new Error().stack || ""; } catch (e) { return "(no stack)"; }
    const lines = raw.split("\\n");
    const out = [];
    for (let i = 0; i < lines.length && out.length < 3; i++) {
      const ln = lines[i].trim();
      if (!ln) continue;
      if (ln.indexOf("q7") !== -1) continue;
      if (ln.indexOf("Error") === 0) continue;
      out.push(ln);
    }
    return out.join(" <- ") || "(empty stack)";
  }

  // Refuse a registration during a frozen phase and record who tried. Always takes a stack: a
  // re-armer is by definition rare enough to sample every time, and naming it is the whole payoff.
  // The returned handle is a number no real scheduler will hand out, so a later clear/cancel on it
  // is a harmless no-op rather than a cross-wired cancellation of somebody else's live handle.
  function q7refuse(kind) {
    trap.refused[kind]++;
    const key = kind + ": " + q7sig();
    trap.refusedSites[key] = (trap.refusedSites[key] || 0) + 1;
    return 900000000 + trap.fakeSeq++;
  }

  window.requestAnimationFrame = function q7rafSchedule(cb) {
    if (trap.frozenRaf) return q7refuse("raf");
    trap.scheduled++;
    let sig = null;
    if (trap.seq++ % trap.sampleEvery === 0) {
      sig = q7sig();
      trap.sites[sig] = (trap.sites[sig] || 0) + 1;
    }
    const handle = origRaf(function q7rafFire(t) {
      trap.live.delete(handle);
      trap.fired++;
      return cb(t);
    });
    trap.live.set(handle, sig || "(unsampled)");
    return handle;
  };
  window.cancelAnimationFrame = function q7rafCancel(handle) {
    trap.live.delete(handle);
    return origCaf(handle);
  };

  // Timers are the other way to burn a core while nobody is looking, and a self-re-arming setTimeout
  // chain is invisible to a rAF trap. Intervals get a stack every time (they are rare). Timeouts are
  // sampled 1-in-50 -- promise plumbing schedules them constantly and a stack per timeout would be a
  // bigger cost than anything being measured.
  const origSetInterval = window.setInterval.bind(window);
  const origClearInterval = window.clearInterval.bind(window);
  const origSetTimeout = window.setTimeout.bind(window);
  const origClearTimeout = window.clearTimeout.bind(window);
  trap.intervals = new Map();
  trap.timeouts = new Map();
  trap.intervalSites = Object.create(null);
  trap.timeoutSites = Object.create(null);
  trap.timeoutSeq = 0;

  window.setInterval = function q7setInterval(fn, ms) {
    if (trap.frozenTimers) return q7refuse("intervals");
    const rest = Array.prototype.slice.call(arguments, 2);
    const sig = q7sig();
    const id = origSetInterval.apply(null, [fn, ms].concat(rest));
    const key = sig + "  every " + ms + "ms";
    trap.intervals.set(id, key);
    trap.intervalSites[key] = (trap.intervalSites[key] || 0) + 1;
    return id;
  };
  window.clearInterval = function q7clearInterval(id) {
    trap.intervals.delete(id);
    return origClearInterval(id);
  };
  window.setTimeout = function q7setTimeout(fn, ms) {
    if (trap.frozenTimers) return q7refuse("timeouts");
    const rest = Array.prototype.slice.call(arguments, 2);
    let sig = null;
    if (trap.timeoutSeq++ % 50 === 0) {
      sig = q7sig() + "  after " + ms + "ms";
      trap.timeoutSites[sig] = (trap.timeoutSites[sig] || 0) + 1;
    }
    let id = 0;
    const wrapped = function () {
      trap.timeouts.delete(id);
      return typeof fn === "function" ? fn.apply(null, arguments) : fn;
    };
    id = origSetTimeout.apply(null, [wrapped, ms].concat(rest));
    trap.timeouts.set(id, sig || "(unsampled)");
    return id;
  };
  window.clearTimeout = function q7clearTimeout(id) {
    trap.timeouts.delete(id);
    return origClearTimeout(id);
  };

  function q7tally(bag, cap) {
    const out = [];
    for (const key in bag) out.push({ site: key, count: bag[key] });
    out.sort(function (a, b) { return b.count - a.count; });
    return out.slice(0, cap);
  }

  // CSS/WAAPI animations do NOT go through rAF and survive a frame-loop freeze. Naming their target
  // elements is the difference between "something is animating" and a selector to go fix.
  trap.animationInfo = function () {
    if (typeof document.getAnimations !== "function") return [];
    return document.getAnimations().map(function (a) {
      const eff = a.effect;
      const tgt = eff && eff.target ? eff.target : null;
      let sel = "(no target)";
      if (tgt && tgt.tagName) {
        sel = tgt.tagName.toLowerCase();
        if (tgt.id) sel += "#" + tgt.id;
        const cls = typeof tgt.className === "string" ? tgt.className.trim() : "";
        if (cls) sel += "." + cls.split(" ").join(".");
      }
      let name = "";
      try {
        name = a.animationName || a.transitionProperty || "";
      } catch (e) {
        name = "";
      }
      let timing = {};
      try {
        timing = eff && eff.getTiming ? eff.getTiming() : {};
      } catch (e) {
        timing = {};
      }
      return {
        target: sel.slice(0, 220),
        name: String(name),
        playState: a.playState,
        duration: timing.duration,
        iterations: timing.iterations,
      };
    });
  };

  trap.read = function () {
    return {
      t: Date.now(),
      scheduled: trap.scheduled,
      fired: trap.fired,
      // Exact, not sampled: a loop that re-arms every frame holds exactly one armed handle at rest,
      // so at idle this IS the count of concurrent frame loops.
      pending: trap.live.size,
      frozen: { raf: trap.frozenRaf, animations: trap.frozenAnimations, timers: trap.frozenTimers },
      sampleEvery: trap.sampleEvery,
      sites: q7tally(trap.sites, 25),
      liveIntervals: trap.intervals.size,
      intervalSites: q7tally(trap.intervalSites, 25),
      pendingTimeouts: trap.timeouts.size,
      timeoutSites: q7tally(trap.timeoutSites, 15),
      animations: trap.animationInfo(),
      visibility: document.visibilityState,
      refused: { raf: trap.refused.raf, intervals: trap.refused.intervals, timeouts: trap.refused.timeouts },
      refusedSites: q7tally(trap.refusedSites, 20),
    };
  };

  // Cancel every armed frame AND latch the refusal, so nothing can re-arm for the rest of the run.
  // The first cut of this only cancelled, and 250 frames still fired in the frozen window at 16fps:
  // something external kept re-arming. Sticky turns that from an unusable reading into a named site.
  trap.freeze = function () {
    trap.frozenRaf = true;
    let n = 0;
    trap.live.forEach(function (_sig, handle) { origCaf(handle); n++; });
    trap.live.clear();
    trap.frozenRaf = true;
    return { cancelled: n, t: Date.now() };
  };

  // Cancel ONE named animation. "Animations cost 45 points" names no fix; "aurora costs 40 and the
  // foil sweep costs 5" names two, and says which one is worth the risk of touching.
  trap.freezeAnimationsNamed = function (name) {
    const want = String(name);
    let n = 0;
    if (typeof document.getAnimations === "function") {
      document.getAnimations().forEach(function (a) {
        let nm = "";
        try { nm = a.animationName || a.transitionProperty || ""; } catch (e) { nm = ""; }
        if (String(nm) !== want) return;
        try { a.cancel(); n++; } catch (e) { /* already idle */ }
      });
    }
    trap.frozenAnimationNames[want] = true;
    return { name: want, cancelled: n, t: Date.now() };
  };

  // Cancel every running CSS/WAAPI animation. cancel() drops the effect and leaves the element at its
  // unanimated style; nothing re-creates it unless a style rule is re-applied, and a count that grows
  // back is reported rather than smoothed over.
  trap.freezeAnimations = function () {
    const before = trap.animationInfo();
    let n = 0;
    if (typeof document.getAnimations === "function") {
      document.getAnimations().forEach(function (a) {
        try { a.cancel(); n++; } catch (e) { /* already idle */ }
      });
    }
    trap.frozenAnimations = true;
    return { cancelled: n, wasRunning: before, t: Date.now() };
  };

  // Last resort: clear every live interval and pending timeout. This breaks the app -- it is the
  // final phase for a reason. What is still burning CPU after this is not the app's JavaScript.
  trap.freezeTimers = function () {
    trap.frozenTimers = true;
    let i = 0;
    let t = 0;
    trap.intervals.forEach(function (_sig, id) { origClearInterval(id); i++; });
    trap.intervals.clear();
    trap.timeouts.forEach(function (_sig, id) { origClearTimeout(id); t++; });
    trap.timeouts.clear();
    trap.frozenTimers = true;
    return { intervals: i, timeouts: t, t: Date.now() };
  };

  return { already: false, installedAt: trap.installedAt };
})()`;

const TRAP_READ = `(window.__q7raf ? window.__q7raf.read() : null)`;

/** Block until the app is painted. waitUsable() cannot serve: it gates on window.__q7, which the
 *  trap-only session deliberately never installs. */
async function waitPainted(s, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(
        s,
        `({ trap: !!window.__q7raf, rail: document.querySelectorAll(".v2-nav-item").length,
            body: document.body ? document.body.innerText.length : 0 })`,
      );
      if (ready.trap && ready.rail > 0 && ready.body > 400) return s;
    } catch {
      /* execution context swapped mid-reload */
    }
    await sleep(100);
  }
  throw new Error("page never became usable (raf-trap session)");
}

/**
 * One CPU window over the process group. t0 is taken BEFORE the opening sample and elapsed AFTER the
 * closing one, so both PowerShell round-trips fall inside the window they are dividing by -- the same
 * ordering idle-bare uses, and the reason its number is trustworthy.
 */
async function cpuPhase(pids, seconds, label) {
  const t0 = Date.now();
  const start = sampleProcesses(pids);
  await sleep(seconds * 1000);
  const end = sampleProcesses(pids);
  const elapsed = (Date.now() - t0) / 1000;
  const before = new Map(start.map((p) => [p.id, p.cpu ?? 0]));
  const perProcess = end
    .map((p) => {
      const d = (p.cpu ?? 0) - (before.get(p.id) ?? 0);
      return {
        id: p.id,
        name: p.name,
        processorSeconds: Number(d.toFixed(3)),
        percentOfOneCore: Number(((d / elapsed) * 100).toFixed(3)),
      };
    })
    .sort((a, b) => b.processorSeconds - a.processorSeconds);
  const processorSeconds = perProcess.reduce((x, p) => x + p.processorSeconds, 0);
  return {
    label,
    seconds: Number(elapsed.toFixed(1)),
    processorSeconds: Number(processorSeconds.toFixed(3)),
    percentOfOneCore: Number(((processorSeconds / elapsed) * 100).toFixed(3)),
    perProcess,
  };
}

/**
 * Renderer-side counters, read straight off CDP. The OS tells us a process burned N processor-seconds
 * but not on what; these split the RENDERER's share into script / layout / style. The gap between
 * TaskDuration (main-thread work) and the process's own CPU is the part that is NOT on the main
 * thread -- compositor, raster, GPU -- which no amount of JavaScript freezing can ever remove.
 */
const METRIC_DURATIONS = [
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ThreadTime",
  "ProcessTime",
];
const METRIC_COUNTERS = ["LayoutCount", "RecalcStyleCount"];
const METRIC_GAUGES = ["Nodes", "JSEventListeners", "Frames"];

async function readMetrics(s) {
  try {
    const r = await s.call("Performance.getMetrics");
    const out = Object.create(null);
    for (const m of r.metrics || []) out[m.name] = m.value;
    return out;
  } catch {
    return null;
  }
}

function metricsDelta(open, close, elapsed) {
  if (!open || !close || !(elapsed > 0)) return null;
  const out = {};
  for (const k of METRIC_DURATIONS) {
    if (typeof open[k] !== "number" || typeof close[k] !== "number") continue;
    const d = close[k] - open[k];
    out[k] = {
      seconds: Number(d.toFixed(3)),
      percentOfOneCore: Number(((d / elapsed) * 100).toFixed(3)),
    };
  }
  for (const k of METRIC_COUNTERS) {
    if (typeof open[k] !== "number" || typeof close[k] !== "number") continue;
    out[k] = { total: close[k] - open[k], perSecond: Number(((close[k] - open[k]) / elapsed).toFixed(2)) };
  }
  for (const k of METRIC_GAUGES) {
    if (typeof close[k] === "number") out[k] = close[k];
  }
  return out;
}

/** "at http://tauri.localhost/assets/index-abc.js:1:392847" -> { url, line, col }. */
function parseFrame(frame) {
  let s = String(frame).trim();
  // Timer signatures carry a double-space-delimited tail ("  every 500ms") that would otherwise be
  // parsed as part of the column number.
  const tail = s.indexOf("  ");
  if (tail !== -1) s = s.slice(0, tail).trim();
  if (s.endsWith(")")) s = s.slice(0, -1);
  const parts = s.split(":");
  const col = Number(parts.pop());
  const line = Number(parts.pop());
  let url = parts.join(":");
  const sp = url.lastIndexOf(" ");
  if (sp !== -1) url = url.slice(sp + 1);
  if (url.startsWith("(")) url = url.slice(1);
  if (!Number.isFinite(col) || !Number.isFinite(line) || !url.startsWith("http")) return null;
  return { url, line, col };
}

/**
 * The shipped bundle is minified, so a stack frame is a file:line:col and nothing else. Slicing the
 * bundle text around that offset turns it back into something a human can name -- minified, but
 * `.raf(` on a Lenis instance still reads as Lenis. The slice happens IN THE PAGE so a few hundred KB
 * of bundle never crosses the debug socket.
 */
async function enrichSites(s, sites, limit = 6, radius = 160) {
  const out = [];
  for (const entry of sites.slice(0, limit)) {
    const loc = parseFrame(String(entry.site).split(" <- ")[0]);
    if (!loc) {
      out.push({ ...entry, source: null });
      continue;
    }
    let snippet = null;
    try {
      snippet = await evaluate(
        s,
        `fetch(${JSON.stringify(loc.url)}).then((r) => r.text()).then((t) => {
           const ln = t.split("\\n")[${loc.line - 1}] || "";
           return ln.slice(Math.max(0, ${loc.col - radius}), ${loc.col + radius});
         })`,
      );
    } catch {
      snippet = null;
    }
    out.push({ ...entry, source: snippet });
  }
  return out;
}

/**
 * IDLE ATTRIBUTION. docs/perf/raw/idle-bare.json records that Compy burns ~50% of one core sitting
 * idle with nothing on screen and nobody at the keyboard. It does not say WHY, and a budget that
 * names a cost without naming its owner cannot be defended or cut.
 *
 * Method -- a subtraction waterfall. Each phase kills one more class of work and re-measures the SAME
 * window, so every band is a difference between two directly comparable numbers:
 *
 *   running        everything alive                        -> the total idle cost
 *   anim-frozen    every CSS/WAAPI animation cancelled      -> minus declarative animation
 *   raf-frozen     every armed animation frame cancelled    -> minus the frame loops
 *   timers-frozen  every interval + pending timeout cleared -> minus all remaining app JavaScript
 *
 * Animations are frozen FIRST because the bands are not additive when the work contends: with the
 * frame loops frozen first, the animations' style recalcs went from 60/s to 250/s -- freeing the main
 * thread made them cost MORE, and "running" read lower than the frozen phase beneath it. The dominant
 * band has to be the one measured against an unperturbed baseline.
 *
 * What survives the last phase is not the app's JavaScript at all: it is the runtime -- WebView2
 * compositing, the Tauri IPC pump, the Rust core. Naming that band is as important as naming the
 * others, because it is the part no frontend change can ever fix.
 *
 * The FIRST band was the whole of the earlier two-phase probe, and it came back at 6.7% of the idle
 * cost -- which is why this exists: freezing every frame loop in the app barely moved the number, so
 * the answer was somewhere the two-phase design could not see.
 *
 * Each phase also snapshots CDP renderer counters, which split the renderer's own share into script /
 * layout / style, and expose the gap between main-thread work and the process's total CPU. A large
 * gap means the cost is off the main thread (compositor / raster) and no JavaScript change removes it.
 *
 * The run is VOID for the rAF band, and says so rather than publishing it, if frames keep firing
 * after the freeze: that means something re-arms externally and the phase was never actually quiet.
 */
/**
 * Document-start CSS override. Appended to <head> as the LAST stylesheet and re-appended on load,
 * because Vite injects the app's styles during module evaluation -- a sheet added earlier would lose
 * to them. window.__q7css carries the applied length so the caller can PROVE it landed rather than
 * assume it (a silently-missing override would read as "the hypothesis was wrong").
 */
function cssInjector(text) {
  return `(() => {
  var css = ${JSON.stringify(text)};
  function add() {
    var st = document.getElementById("q7-inject-css");
    if (!st) { st = document.createElement("style"); st.id = "q7-inject-css"; st.textContent = css; }
    (document.head || document.documentElement).appendChild(st);
    window.__q7css = css.length;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
  else add();
  window.addEventListener("load", add);
})()`;
}

async function taskAttribute() {
  const settle = Number(flags.settle ?? 45);
  const injectedCss = flags["inject-css"]
    ? (() => {
        const file = String(flags["inject-css"]);
        const text = readFileSync(file, "utf8");
        return { file, bytes: Buffer.byteLength(text), text };
      })()
    : null;
  const phaseSeconds = Number(flags.phase ?? 120);
  // Anything smaller than this is scheduler noise between two separate CPU windows, not a finding.
  const NOISE_FLOOR = 0.5;

  const survivors = killAllCompy();
  if (survivors) throw new Error(`${survivors} compy.exe would not die; cannot measure a clean idle`);
  await sleep(1500);
  const lock = await launch(PORT);
  await waitForPort(PORT, 30000);
  const s = await attachMain(PORT);
  await s.call("Page.enable");
  // Document-start, for the same reason session({fresh:true}) does it: a loop armed during boot is
  // invisible to a trap installed after boot, and the honest live count would be unknowable.
  await s.call("Page.addScriptToEvaluateOnNewDocument", { source: RAF_TRAP });
  // Optional CSS override, appended LAST so it wins the cascade (keyframes resolve to the final
  // definition of a name, which is the whole point: re-declare @keyframes X and the running
  // animation keeps its name -- so the per-animation split below still attributes it by that name).
  if (injectedCss) {
    await s.call("Page.addScriptToEvaluateOnNewDocument", { source: cssInjector(injectedCss.text) });
  }
  await s.call("Page.reload", { ignoreCache: false });
  await waitPainted(s);
  await s.call("Performance.enable").catch(() => {});
  if (injectedCss) {
    const live = await evaluate(s, "String(window.__q7css || 0)");
    if (Number(live) !== injectedCss.text.length) {
      throw new Error(
        `--inject-css did not land (page reports ${live} chars, file has ${injectedCss.text.length}); ` +
          "refusing to report a run whose override may not be applied",
      );
    }
  }

  const pids = processTree(lock.pid);
  const cores = Number(ps(`[Environment]::ProcessorCount`)) || 1;
  process.stderr.write(`  settling ${settle}s (boot animations must finish before phase 1 starts)\n`);
  await sleep(settle * 1000);

  const room = await evaluate(s, ACTIVE_ROOM);

  /** One measured band: trap + renderer counters on both edges of a single CPU window. */
  async function runPhase(label, note) {
    const open = await evaluate(s, TRAP_READ);
    const openMetrics = await readMetrics(s);
    process.stderr.write(`  phase ${label}: ${phaseSeconds}s -- ${note}\n`);
    const cpu = await cpuPhase(pids, phaseSeconds, label);
    const close = await evaluate(s, TRAP_READ);
    const closeMetrics = await readMetrics(s);
    return {
      label,
      note,
      cpu,
      renderer: metricsDelta(openMetrics, closeMetrics, cpu.seconds),
      framesFired: close.fired - open.fired,
      framesPerSecond: Number(((close.fired - open.fired) / cpu.seconds).toFixed(1)),
      open,
      close,
    };
  }

  // A baseline taken while the app is still ramping subtracts wrong for every band beneath it. Take
  // short windows until two consecutive ones agree, then start. Costs seconds; buys a phase-1 number
  // that is not a coin flip.
  async function stabilize() {
    const attempts = [];
    let prev = null;
    for (let i = 0; i < 6; i++) {
      const w = await cpuPhase(pids, 8, `stabilize-${i + 1}`);
      attempts.push(Number(w.percentOfOneCore.toFixed(3)));
      if (prev !== null) {
        const spread = Math.abs(w.percentOfOneCore - prev);
        if (spread <= Math.max(1, prev * 0.12)) {
          return { settled: true, windowSeconds: 8, attempts, spread: Number(spread.toFixed(3)) };
        }
      }
      prev = w.percentOfOneCore;
    }
    return { settled: false, windowSeconds: 8, attempts, spread: null };
  }
  process.stderr.write(`  stabilising the baseline before phase 1\n`);
  const stability = await stabilize();
  process.stderr.write(
    `  baseline ${stability.settled ? "settled" : "NEVER SETTLED"}: ${stability.attempts.join(" -> ")}\n`,
  );

  // ORDER MATTERS, and it is not the obvious one. The bands are only comparable if the DOMINANT cost
  // is measured against an unperturbed baseline: when the frame loops were frozen first, the CSS
  // animations' style recalcs jumped from 60/s to 250/s because the main thread they had been
  // contending with went quiet -- so freezing rAF made the app cost MORE, and the "running" phase read
  // lower than the frozen phase beneath it. Animations first; the frame loops are the cheap band.
  const running = await runPhase("running", "everything alive");

  const band = (hi, lo) => Number((hi.cpu.percentOfOneCore - lo.cpu.percentOfOneCore).toFixed(3));

  // Split the animation band one animation at a time, in the order they were found. Each name gets
  // its own window, so the output is a per-animation cost rather than a lump nobody can act on.
  const animNames = [];
  for (const a of running.open.animations ?? []) {
    const nm = String(a?.name ?? "").trim();
    if (nm && !animNames.includes(nm)) animNames.push(nm);
  }
  const animationSplit = [];
  let prevAnimPhase = running;
  for (const nm of animNames) {
    const one = await evaluate(s, `window.__q7raf.freezeAnimationsNamed(${JSON.stringify(nm)})`);
    await sleep(2000);
    const ph = await runPhase(`anim-frozen:${nm}`, `${one.cancelled} "${nm}" animation(s) cancelled`);
    animationSplit.push({
      name: nm,
      instancesCancelled: one.cancelled,
      percentOfOneCore: band(prevAnimPhase, ph),
      recalcStyleBefore: prevAnimPhase.renderer?.RecalcStyleCount?.perSecond ?? null,
      recalcStyleAfter: ph.renderer?.RecalcStyleCount?.perSecond ?? null,
      phase: ph,
    });
    prevAnimPhase = ph;
  }

  // Sweep whatever the named pass did not catch (unnamed transitions, anything that started late).
  const animFreeze = await evaluate(s, `window.__q7raf.freezeAnimations()`);
  await sleep(2000);
  const animFrozen = await runPhase(
    "anim-frozen",
    `${animFreeze.cancelled} remaining CSS/WAAPI animation(s) cancelled`,
  );

  const rafFreeze = await evaluate(s, `window.__q7raf.freeze()`);
  await sleep(3000);
  const rafFrozen = await runPhase("raf-frozen", `${rafFreeze.cancelled} armed frame(s) cancelled`);

  const timerFreeze = await evaluate(s, `window.__q7raf.freezeTimers()`);
  await sleep(2000);
  const timersFrozen = await runPhase(
    "timers-frozen",
    `${timerFreeze.intervals} interval(s) + ${timerFreeze.timeouts} timeout(s) cleared`,
  );

  const escapedFrames = rafFrozen.framesFired;
  const rafValid = escapedFrames <= 2;
  const firedRunning = running.framesFired;
  const loopsAtRest = running.open.pending;
  const rearms = timersFrozen.close.refused ?? { raf: 0, intervals: 0, timeouts: 0 };

  const animBand = band(running, animFrozen);
  const rafBand = band(animFrozen, rafFrozen);
  const timerBand = band(rafFrozen, timersFrozen);
  const residual = timersFrozen.cpu.percentOfOneCore;
  const total = running.cpu.percentOfOneCore;
  const share = (v) => (total > 0 ? Number(((v / total) * 100).toFixed(1)) : null);
  const verdict = (v) =>
    Math.abs(v) < NOISE_FLOOR ? `below the ${NOISE_FLOOR}-point noise floor -- not a finding` : "measured";

  let bareIdle = null;
  try {
    bareIdle = JSON.parse(readFileSync(join(ROOT, "docs", "perf", "raw", "idle-bare.json"), "utf8"));
  } catch {
    /* not recorded yet */
  }

  // The renderer's main thread vs the whole process group. If main-thread time is a small fraction of
  // the CPU still burning after every timer is dead, the cost lives off the main thread and the fix is
  // not in the app's JavaScript.
  const finalTask = timersFrozen.renderer?.TaskDuration?.percentOfOneCore ?? null;

  const result = {
    task: "attribute",
    recordedAt: new Date().toISOString(),
    room,
    settleSeconds: settle,
    phaseSeconds,
    cores,
    method:
      "subtraction waterfall: running -> anim-frozen -> raf-frozen -> timers-frozen, each phase a " +
      "separate CPU window over the same process group. Freezes are sticky (re-registration refused " +
      "and its stack recorded), so a band cannot be diluted by work that quietly re-arms itself.",
    baselineStability: stability,
    // A run carrying a CSS override is NOT a baseline. Recorded in full so the two can never be
    // confused, and so the exact override that produced a number is reproducible from the evidence.
    injectedCss,
    rafBandValid: rafValid,
    validity: [
      rafValid
        ? `${escapedFrames} frame(s) fired during raf-frozen -- the frame loops were genuinely dead.`
        : `VOID for the rAF band: ${escapedFrames} frames fired AFTER the freeze despite the sticky ` +
          `refusal, so the anim-frozen minus raf-frozen delta is NOT the cost of the frame loops.`,
      stability.settled
        ? `baseline settled to within ${stability.spread} points before phase 1.`
        : `BASELINE NEVER SETTLED (${stability.attempts.join(" -> ")}) -- the running phase may have ` +
          `been taken mid-ramp, so every band below it inherits that error.`,
    ].join(" "),
    // Who tried to come back after being frozen. Empty is the healthy answer; a named site here is a
    // self-healing ticker, and it is a finding in its own right rather than a defect in the reading.
    externalRearms: {
      attempts: rearms,
      sites: await enrichSites(s, timersFrozen.close.refusedSites ?? [], 10),
    },
    attribution: {
      totalPercentOfOneCore: total,
      bands: [
        {
          name: "CSS/WAAPI animations",
          percentOfOneCore: animBand,
          shareOfIdle: share(animBand),
          verdict: verdict(animBand),
          splitByAnimation: animationSplit.map((a) => ({
            name: a.name,
            instancesCancelled: a.instancesCancelled,
            percentOfOneCore: a.percentOfOneCore,
            shareOfIdle: share(a.percentOfOneCore),
            verdict: verdict(a.percentOfOneCore),
            recalcStylePerSecond: { before: a.recalcStyleBefore, after: a.recalcStyleAfter },
          })),
        },
        {
          name: "rAF frame loops",
          percentOfOneCore: rafValid ? rafBand : null,
          shareOfIdle: rafValid ? share(rafBand) : null,
          verdict: rafValid ? verdict(rafBand) : "void -- frames escaped the freeze",
        },
        {
          name: "timers (intervals + timeouts)",
          percentOfOneCore: timerBand,
          shareOfIdle: share(timerBand),
          verdict: verdict(timerBand),
        },
        {
          name: "runtime floor (WebView2 compositing, Tauri IPC, Rust core)",
          percentOfOneCore: residual,
          shareOfIdle: share(residual),
          verdict: "survives every JavaScript freeze -- no frontend change removes this",
        },
      ],
      mainThread: {
        rendererTaskPercentOfOneCoreAtFloor: finalTask,
        processGroupPercentOfOneCoreAtFloor: residual,
        note:
          finalTask === null
            ? "renderer counters unavailable"
            : finalTask < residual / 4
              ? "the floor is overwhelmingly OFF the renderer main thread (compositor / raster / other process)"
              : "a meaningful part of the floor is still renderer main-thread work",
      },
    },
    phases: {
      running,
      ...Object.fromEntries(animationSplit.map((a) => [`animFrozen:${a.name}`, a.phase])),
      animFrozen,
      rafFrozen,
      timersFrozen,
    },
    raf: {
      concurrentLoopsAtRest: loopsAtRest,
      framesFiredRunning: firedRunning,
      callbacksPerSecond: running.framesPerSecond,
      // N concurrent loops each get a callback per frame, so callbacks/s is N x refresh rate. The
      // pending count is the N that makes it readable.
      impliedRefreshHz:
        loopsAtRest > 0 ? Number((firedRunning / running.cpu.seconds / loopsAtRest).toFixed(1)) : null,
      armedAtFreeze: rafFreeze.cancelled,
      firedAfterFreeze: escapedFrames,
    },
    animations: {
      runningAtStart: running.open.animations,
      cancelled: animFreeze.cancelled,
      returnedAfterCancel: animFrozen.close.animations,
    },
    timers: {
      liveIntervalsAtStart: running.open.liveIntervals,
      pendingTimeoutsAtStart: running.open.pendingTimeouts,
      cleared: { intervals: timerFreeze.intervals, timeouts: timerFreeze.timeouts },
      stillLiveAtEnd: {
        intervals: timersFrozen.close.liveIntervals,
        timeouts: timersFrozen.close.pendingTimeouts,
      },
    },
    sites: {
      raf: await enrichSites(s, running.close.sites),
      intervals: await enrichSites(s, running.close.intervalSites, 8),
      timeouts: await enrichSites(s, running.close.timeoutSites, 6),
    },
    // The debug port and the trap are not free. Stating the gap keeps this run honest about being an
    // observed number, not the shipped one -- idle-bare.json is the shipped one.
    observerCost:
      bareIdle && typeof bareIdle?.cpu?.percentOfOneCore === "number"
        ? {
            bareIdlePercentOfOneCore: bareIdle.cpu.percentOfOneCore,
            observedPercentOfOneCore: total,
            overheadPoints: Number((total - bareIdle.cpu.percentOfOneCore).toFixed(3)),
            note: "bare = docs/perf/raw/idle-bare.json, measured with no CDP port and no trap.",
          }
        : null,
  };

  s.close();
  killAllCompy();
  console.log(JSON.stringify(result, null, 2));
  console.log("written:", writeOut("idle-attribution", result));
  console.log("the frozen instance was killed; run `node scripts/q7-probe.mjs restore` for a clean desk build.");
  if (!rafValid) {
    console.error("REFUSING TO CLAIM THE rAF BAND: frames kept firing after the freeze.");
    process.exit(1);
  }
}

/**
 * ACCESSIBILITY MATRIX. Resizes the REAL OS window (not an emulated viewport) and records, per room:
 * the accessible name/role/state of every focusable control, the visible focus ring, the tab order,
 * and any control that is reachable but unnamed. What CDP can only emulate is labelled as emulated.
 */
async function taskA11y() {
  const w = Number(flags.w ?? 1280);
  const h = Number(flags.h ?? 720);
  const s = await session(PORT);
  const lock = readLock();
  const pid = lock?.pid ?? runningCompyPids()[0];
  moveWindow(pid, 40, 40, w, h);
  await sleep(1200);

  const viewport = await evaluate(s, `({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`);
  await s.call("Accessibility.enable").catch(() => {});

  // Read the media state the SHIPPED WebView2 actually reports before any emulation touches it. This
  // is the one part of the matrix that is native by construction, and it is the part most often
  // guessed wrong: this machine's WebView2 reports prefers-reduced-motion: reduce with no OS setting
  // asking for it, which is exactly why the app gates motion on useReducedMotion() and not on the raw
  // query (memory: motion-on-by-default-override-os).
  const nativeMedia = await evaluate(
    s,
    `(() => { const q = (m) => matchMedia(m).matches; return {
        prefersReducedMotion: q("(prefers-reduced-motion: reduce)"),
        forcedColors: q("(forced-colors: active)"),
        prefersContrastMore: q("(prefers-contrast: more)"),
        prefersColorScheme: q("(prefers-color-scheme: dark)") ? "dark" : "light",
        devicePixelRatio, innerWidth, innerHeight,
      }; })()`,
  );

  const rooms = await evaluate(s, ROOM_LIST);

  /** The accessibility tree a screen reader would actually walk -- not the DOM guess above it. A
   *  control can look named in the DOM and still reach the AX tree nameless. */
  async function axSummary() {
    const tree = await s.call("Accessibility.getFullAXTree", {}).catch(() => null);
    if (!tree?.nodes) return { available: false };
    const INTERACTIVE = new Set([
      "button", "link", "tab", "checkbox", "switch", "textbox", "combobox", "slider", "menuitem", "radio",
    ]);
    const nodes = tree.nodes.filter((n) => !n.ignored);
    const interactive = nodes.filter((n) => INTERACTIVE.has(n.role?.value));
    const nameOf = (n) => (n.name?.value ?? "").trim();
    return {
      available: true,
      nodesTotal: tree.nodes.length,
      nodesIgnored: tree.nodes.length - nodes.length,
      interactiveTotal: interactive.length,
      unnamedInteractive: interactive
        .filter((n) => !nameOf(n))
        .map((n) => n.role.value)
        .slice(0, 20),
      tabs: nodes
        .filter((n) => n.role?.value === "tab")
        .map((n) => ({
          name: nameOf(n),
          selected: n.properties?.find((p) => p.name === "selected")?.value?.value ?? null,
        })),
    };
  }

  /** The hologram bay is a WebGL canvas. Sighted users read the rig from it; everyone else reads
   *  whatever text alternative it carries -- or nothing. */
  const HOLOGRAM_ALT = `(() => {
    const c = document.querySelector("canvas");
    if (!c) return { canvas: false };
    const labelledby = c.getAttribute("aria-labelledby");
    return {
      canvas: true,
      ariaLabel: c.getAttribute("aria-label"),
      role: c.getAttribute("role"),
      ariaHidden: c.getAttribute("aria-hidden"),
      labelledbyText: labelledby
        ? labelledby.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim()
        : null,
      fallbackText: (c.textContent || "").replace(/\\s+/g, " ").trim() || null,
      siblingText: (c.parentElement?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200) || null,
    };
  })()`;

  const FOCUSABLES = `(() => {
    const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="tab"], [role="button"], [role="switch"], [role="checkbox"]';
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    });
    const name = (e) =>
      (e.getAttribute("aria-label") ||
        (e.getAttribute("aria-labelledby") &&
          [...e.getAttribute("aria-labelledby").split(/\\s+/)]
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")) ||
        e.textContent ||
        e.getAttribute("title") ||
        e.value ||
        "")
        .replace(/\\s+/g, " ")
        .trim();
    return els.map((e) => ({
      tag: e.tagName.toLowerCase(),
      role: e.getAttribute("role") || null,
      name: name(e),
      disabled: e.disabled === true || e.getAttribute("aria-disabled") === "true",
      cls: (e.className && String(e.className).slice(0, 60)) || null,
    }));
  })()`;

  const CONTRAST_SAMPLE = `(() => {
    // Focus-visibility check: focus each rail tab and record whether a focus indicator is drawn at
    // all (outline, box-shadow or a :focus-visible-driven change). A ring the user cannot see is the
    // failure this looks for.
    //
    // MODALITY TRAP, learned the hard way (2026-08-05). The first version called b.focus() from a
    // cold eval and reported all four rail tabs ring-less. They are not: the app's focus floor is
    // \`:focus-visible\`-scoped (src/design/doorknob.css:58), and Chromium only matches that on
    // programmatic focus when the PREVIOUS focus already matched it -- i.e. when the last real input
    // was a keypress. An eval out of nowhere carries no keyboard modality, so the ring correctly
    // stays off and the probe read its own method as an app defect. The caller now dispatches a real
    // Tab first to establish keyboard modality; the chain then holds tab-to-tab. \`focusVisible\` is
    // recorded outright so a future reader can tell "no ring" from "no ring under this method".
    const out = [];
    for (const b of document.querySelectorAll(".v2-nav-item")) {
      b.focus();
      const st = getComputedStyle(b);
      out.push({
        name: b.textContent.replace(/\\s+/g, " ").trim(),
        outlineWidth: st.outlineWidth,
        outlineStyle: st.outlineStyle,
        outlineColor: st.outlineColor,
        boxShadow: st.boxShadow === "none" ? null : st.boxShadow.slice(0, 90),
        focusVisible: b.matches(":focus-visible"),
        isActiveElement: document.activeElement === b,
      });
    }
    document.activeElement?.blur?.();
    return out;
  })()`;

  // A missing rail item is EVIDENCE at small viewports (the rail may legitimately collapse), so the
  // click reports absence instead of throwing and losing the whole matrix.
  const clickRoom = (i) =>
    evaluate(s, `(() => { const b = document.querySelectorAll(".v2-nav-item")[${i}];
      if (!b) return false; b.click(); return true; })()`);

  const perRoom = [];
  for (let i = 0; i < rooms.length; i++) {
    await clickRoom(i);
    await sleep(2000);
    const controls = await evaluate(s, FOCUSABLES);
    const unnamed = controls.filter((c) => !c.name && !c.disabled);
    const overflow = await evaluate(
      s,
      `({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
          scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight })`,
    );
    perRoom.push({
      room: rooms[i],
      controls: controls.length,
      unnamed: unnamed.map((c) => `${c.tag}${c.role ? `[role=${c.role}]` : ""}${c.cls ? ` .${c.cls}` : ""}`),
      horizontalOverflowPx: overflow.scrollW - overflow.clientW,
      ax: await axSummary(),
      hologram: await evaluate(s, HOLOGRAM_ALT),
    });
  }

  await clickRoom(0);
  await sleep(1200);
  // One real Tab first -- see the MODALITY TRAP note in CONTRAST_SAMPLE. Without it the sample
  // measures Chromium's mouse-modality rule and reports every ring missing.
  await s.call("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
  await s.call("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
  await sleep(200);
  const focusRings = await evaluate(s, CONTRAST_SAMPLE);

  // Keyboard-only journey: real key events through the input pipeline, not synthetic DOM events.
  const journey = [];
  await s.call("Runtime.evaluate", { expression: `document.body.focus(); true` });
  for (let i = 0; i < 12; i++) {
    await s.call("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
    await s.call("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" });
    await sleep(120);
    const at = await evaluate(
      s,
      `(() => { const e = document.activeElement; if (!e || e === document.body) return null;
        const st = getComputedStyle(e);
        return { tag: e.tagName.toLowerCase(), role: e.getAttribute("role") || null,
                 name: (e.getAttribute("aria-label") || e.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
                 outline: st.outlineStyle === "none" ? null : st.outlineWidth + " " + st.outlineStyle,
                 boxShadow: st.boxShadow === "none" ? null : "yes" }; })()`,
    );
    journey.push({ step: i + 1, focus: at });
  }

  /** Re-walk every room under some condition and report only what layout/naming does under it. */
  async function sweep(label) {
    const out = [];
    for (let i = 0; i < rooms.length; i++) {
      const reachable = await clickRoom(i);
      await sleep(1200);
      if (!reachable) { out.push({ condition: label, room: rooms[i], railItemMissing: true }); continue; }
      const o = await evaluate(
        s,
        `({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
            vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
            railVisible: !!document.querySelector(".v2-nav-item")?.getBoundingClientRect().width,
            bodyChars: (document.querySelector("main, [role=main], .v2-body")?.textContent ?? document.body.textContent ?? "").replace(/\\s+/g, " ").trim().length })`,
      );
      out.push({ condition: label, room: rooms[i], horizontalOverflowPx: o.scrollW - o.clientW, ...o });
    }
    return out;
  }

  // 200% Windows display scaling, done HONESTLY. Real 200% is an OS display setting; flipping the
  // owner's monitor scaling mid-session is not this probe's business. What 200% actually does to the
  // app is halve the CSS viewport -- so the window is resized to the same CSS pixel budget a 200%
  // 1280x720 desktop would give it, and the layout is tested there for real. The DPR is NOT doubled,
  // so this measures reflow/overflow (what breaks at 200%), not raster sharpness.
  const chromeW = w - viewport.w;
  const chromeH = h - viewport.h;
  moveWindow(pid, 40, 40, Math.round(w / 2) + chromeW, Math.round(h / 2) + chromeH);
  await sleep(1500);
  const scaled200 = await sweep("cssBudgetOf200PercentScaling");
  moveWindow(pid, 40, 40, w, h);
  await sleep(1200);

  // forced-colors (Windows High Contrast) is EMULATED via CDP: the real thing is a system theme
  // switch. Emulation drives the same CSS media query the app would see, so it proves the app's
  // forced-colors handling; it does NOT prove how the WebView2 host chrome renders under the real theme.
  await s.call("Emulation.setEmulatedMedia", {
    features: [{ name: "forced-colors", value: "active" }],
  }).catch(() => {});
  await sleep(600);
  const forcedColors = {
    emulated: true,
    queryActive: await evaluate(s, `matchMedia("(forced-colors: active)").matches`),
    rooms: await sweep("forcedColorsEmulated"),
  };
  await s.call("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
  await clickRoom(0);

  const result = {
    task: "a11y",
    recordedAt: new Date().toISOString(),
    note:
      "Window sizes are REAL OS window resizes of the shipped build. nativeMedia is what this "
      + "machine's WebView2 reports with nothing emulated. The 200% row is the CSS viewport budget "
      + "200% scaling produces, not an emulated DPR. forced-colors IS emulated (CDP setEmulatedMedia) "
      + "-- it proves the app's own handling, not the WebView2 host chrome under the real Windows theme.",
    window: { requested: { w, h }, viewport },
    nativeMedia,
    rooms: perRoom,
    focusRings,
    tabJourney: journey,
    scaled200,
    forcedColors,
  };
  s.close();
  // Summary only -- the full record is the file. The matrix is long enough that echoing it whole
  // costs more to read than to open.
  console.log(
    JSON.stringify(
      {
        viewport,
        nativeMedia,
        rooms: perRoom.map((r) => ({
          room: r.room,
          controls: r.controls,
          unnamed: r.unnamed.length,
          overflowPx: r.horizontalOverflowPx,
          axInteractive: r.ax?.interactiveTotal ?? null,
          axUnnamed: r.ax?.unnamedInteractive?.length ?? null,
          hologramAlt: r.hologram?.canvas ? r.hologram.ariaLabel ?? r.hologram.labelledbyText ?? null : "no-canvas",
        })),
        focusRingsMissing: focusRings
          .filter((f) => !f.focusVisible && f.outlineStyle === "none" && !f.boxShadow)
          .map((f) => f.name),
        tabStops: journey.filter((j) => j.focus).length,
        tabStopsWithoutIndicator: journey.filter((j) => j.focus && !j.focus.outline && !j.focus.boxShadow).length,
        scaled200Overflow: scaled200.map((r) => ({ room: r.room, px: r.horizontalOverflowPx, vw: r.vw })),
        forcedColorsActive: forcedColors.queryActive,
      },
      null,
      2,
    ),
  );
  console.log("written:", writeOut("a11y", result));
}

/**
 * PROVE THE IPC COUNTER COUNTS. The first version of this probe reported invokeTotal 0 for a whole
 * boot -- not because the app is quiet but because its hook had been silently discarded. A number
 * that can be wrong in the "everything is fine" direction has to be falsified on purpose, so this
 * fires one known read-only command (get_build_stamp) and FAILS the process unless the counter moves.
 * Run it before trusting any recorded IPC figure.
 */
async function taskSelftest() {
  const s = await session(PORT);
  const before = await evaluate(s, SNAPSHOT);
  const stamp = await evaluate(
    s,
    `window.__TAURI_INTERNALS__.invoke("get_build_stamp").then(v => String(v))`,
  );
  await sleep(250);
  const after = await evaluate(s, SNAPSHOT);
  s.close();
  const d = after.invokeTotal - before.invokeTotal;
  const result = {
    task: "selftest",
    recordedAt: new Date().toISOString(),
    buildStamp: stamp,
    ipcCounterLive: after.ipcCounterLive,
    ipcVia: after.ipcVia,
    invokeTotalBefore: before.invokeTotal,
    invokeTotalAfter: after.invokeTotal,
    deltaForOneKnownCall: d,
    countedCommand: after.invokes.get_build_stamp !== before.invokes.get_build_stamp,
    verdict: after.ipcCounterLive && d >= 1 ? "PASS" : "FAIL",
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict !== "PASS") {
    console.error("IPC COUNTER IS DEAD: every invoke figure this probe records would be a false zero.");
    process.exit(1);
  }
}

/** Ad-hoc evaluation against the live instrumented window. */
async function taskEval() {
  const s = await session(PORT);
  const v = await evaluate(s, String(flags.expr ?? SNAPSHOT));
  s.close();
  console.log(JSON.stringify(v, null, 2));
}

/**
 * RESTORE THE DESK. Kill every instance this script (or anything else) left holding a debug port,
 * then relaunch the installed build with a CLEAN environment. ship-reinstall.ps1:236 refuses to
 * relaunch while WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set so a port cannot leak into the owner's
 * build; this is the other half of that contract.
 */
async function taskRestore() {
  killAllCompy();
  await sleep(1500);
  if (existsSync(LOCK)) unlinkSync(LOCK);
  const env = { ...process.env };
  delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
  const child = spawn(EXE, [], { detached: true, stdio: "ignore", env });
  child.unref();
  await sleep(6000);
  const stillOpen = await portAlive(PORT);
  console.log(
    JSON.stringify(
      { task: "restore", relaunchedPid: child.pid, debugPortStillOpen: stillOpen, exe: EXE },
      null,
      2,
    ),
  );
  if (stillOpen) {
    console.error("REFUSING TO CLAIM CLEAN: a debug port is still answering.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------- main

const TASKS = {
  coldstart: taskColdstart,
  boot: taskBoot,
  rooms: taskRooms,
  latency: taskLatency,
  idle: taskIdle,
  "idle-bare": taskIdleBare,
  attribute: taskAttribute,
  a11y: taskA11y,
  selftest: taskSelftest,
  eval: taskEval,
  restore: taskRestore,
};

const task = TASKS[cmd];
if (!task) {
  console.error(`usage: node scripts/q7-probe.mjs <${Object.keys(TASKS).join("|")}> [flags]`);
  process.exit(2);
}
try {
  await task();
  // Let the debugger sockets finish closing. Exiting the instant after ws.close() races libuv's
  // handle teardown on Windows and aborts the process ("UV_HANDLE_CLOSING") after the artifact is
  // already written, which reads like a failed run when the measurement was fine.
  await sleep(120);
  process.exit(0);
} catch (err) {
  console.error(`q7-probe ${cmd} FAILED:`, err.message);
  process.exit(1);
}
