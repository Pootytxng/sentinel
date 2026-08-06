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

function killAllCompy() {
  ps(`Get-Process compy -ErrorAction SilentlyContinue | Stop-Process -Force`);
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
 * Pick the MAIN window. Same scoring as e2e-updater-probe.mjs, and for the same reason: Settings
 * REPLACES ShellV2, so a `.v2-shell`-only test falls through to the overlay HUD.
 */
async function attachMain(port) {
  const pages = (await targets(port)).filter((t) => t.type === "page");
  if (!pages.length) throw new Error(`no page targets on port ${port}`);
  let best = null;
  let bestScore = -1;
  for (const p of pages) {
    let s;
    try {
      s = await open(p);
      const probe = await s.call("Runtime.evaluate", {
        expression: `({ shell: !!document.querySelector(".v2-shell"), buttons: document.querySelectorAll("button").length })`,
        returnByValue: true,
      });
      const v = probe.result?.value ?? {};
      const score = (v.shell ? 100000 : 0) + (v.buttons ?? 0);
      if (score > bestScore) {
        bestScore = score;
        if (best) best.close();
        best = s;
      } else s.close();
    } catch {
      s?.close();
    }
  }
  if (!best) throw new Error("no reachable main window");
  return best;
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
 * It does not. Bare -- no debug port, no CDP, no injected script, just the shipped exe under Windows'
 * own per-process processor-time counters -- the same idle app measured 50.71%, and a second
 * independent bare run measured 50.17%. The instrument costs about a quarter of a percentage point.
 * The ~half-a-core is Compy's own, reproducibly, and that is a performance FINDING, not a baseline to
 * budget around (docs/perf/README.md, and the spec's idle section).
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
