// Real-layout harness for vitest (#646): bundle a page with esbuild, serve it from `node:http`, and
// drive the locally installed headless Chromium (Chrome or Edge) over the DevTools protocol with
// Node's built-in WebSocket. The jsdom suite has no layout engine, so a CSS clamp proven there is
// proven by reading text; this proves it by measuring boxes in the engine WebView2 ships.
//
// Deliberately NOT a vite server: scripts/nested-vite-server-guard.test.mjs records why a vite
// server inside a vitest worker deadlocks the pool. esbuild is already a dependency (vite's), the
// server is `node:http`, and the browser is whatever Chromium the machine already has — nothing is
// downloaded or installed, and no new dependency is added. An absent Chromium is a BLOCKED proof,
// never a pass: `findChromium()` throws and the test fails naming the paths it looked at.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `promise`, or a rejection saying `what` once `ms` pass; the timer never outlives the race. */
function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error(what)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Remove a temp tree this harness created. Windows can refuse that for a moment (EPERM, EBUSY,
 * ENOTEMPTY) while some process still has a file in it open, and the error does not say which. Node's
 * own `maxRetries` did not retry the refusal (Node 24, win32: EPERM after 0 ms against a held file), so
 * retry here, without blocking the event loop, for about 5s; a refusal that outlasts that is thrown,
 * so the caller's close() reports it.
 */
export async function removeDir(dir) {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= 20 || !["EPERM", "EBUSY", "ENOTEMPTY"].includes(error.code)) throw error;
      await sleep(250);
    }
  }
}

/**
 * A setup step threw before the caller received a handle: release everything acquired so far through
 * the same `close` the caller would have used, then rethrow the setup failure (a teardown failure rides
 * along). Without this, a failed launch leaves its browser, debugger, listener and temp dirs behind.
 */
async function unwind(error, close) {
  try {
    await close();
  } catch (teardown) {
    throw new AggregateError([error, teardown], `${error.message}\n(teardown after that failure also failed: ${teardown.message})`);
  }
  throw error;
}

/** Where a Chromium may already be installed, in the order they are tried. Env overrides first. */
export function chromiumCandidates(env = process.env) {
  const pf = env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = env.LOCALAPPDATA ?? "";
  return [
    env.COMPY_CHROMIUM,
    env.CHROME_PATH,
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    local && join(local, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
}

export function findChromium(env = process.env) {
  const candidates = chromiumCandidates(env);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "No local Chromium found; the layout proof is BLOCKED, not passed. Looked at:\n  " +
        candidates.join("\n  ") +
        "\nSet COMPY_CHROMIUM to a Chrome/Edge executable.",
    );
  }
  return found;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};

/** Whether `file` is strictly inside `base`: by `relative()`, since `C:\out-peer\x` starts with `C:\out`. */
function inside(base, file) {
  const rel = relative(base, file);
  return !(rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel));
}

/**
 * The regular file a request URL names inside the canonical directory `base`, or null. The named path
 * must be inside it, and so must the file it really leads to: an in-root symlink or junction can land
 * anywhere, so the target is resolved and that canonical file is what gets read. Undecodable paths,
 * directories and anything unreadable are null too, so the handler answers 404 instead of throwing.
 */
function fileWithin(base, url) {
  try {
    const named = resolve(base, "." + decodeURIComponent(new URL(url, "http://127.0.0.1").pathname));
    if (!inside(base, named)) return null;
    const file = realpathSync(named);
    if (!inside(base, file)) return null;
    return statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Serve one directory on 127.0.0.1 at an OS-chosen port. Files inside it only; no index magic. */
export function serveDir(dir) {
  // Canonical, so a directory reached through a link still contains its own files' real paths.
  const base = realpathSync(resolve(dir));
  const server = createServer((req, res) => {
    const file = fileWithin(base, req.url);
    let body = null;
    try {
      body = file && readFileSync(file);
    } catch {
      body = null;
    }
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

/**
 * Bundle a browser page: `entry` is TSX source text resolved from `resolveDir`; CSS imported along
 * the way lands in `page.css`, fonts and images are copied beside it. `plugins` are esbuild plugins
 * (the fixture stubs Tauri IPC with one).
 */
export async function bundlePage({ entry, resolveDir, outdir, plugins = [] }) {
  await esbuild.build({
    stdin: { contents: entry, resolveDir, loader: "tsx", sourcefile: "layout-entry.tsx" },
    bundle: true,
    outdir,
    entryNames: "page",
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: {
      ".woff2": "file",
      ".woff": "file",
      ".ttf": "file",
      ".otf": "file",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".svg": "file",
      ".webp": "file",
      ".gif": "file",
      ".mp4": "file",
    },
    logLevel: "silent",
    plugins,
  });
  return { js: "page.js", css: "page.css" };
}

/** A minimal CDP client over the global WebSocket (Node 22+). */
export function connectCdp(wsUrl) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const listeners = new Map();
    // A handshake that never completes must not hold the launch. The caller never receives this socket,
    // so it is closed here.
    const handshake = setTimeout(() => {
      fail(new Error("CDP socket did not open within 30s"));
      ws.close();
    }, 30_000);
    ws.addEventListener("error", (e) => {
      clearTimeout(handshake);
      fail(new Error(`CDP socket error: ${e.message ?? e.type}`));
    });
    // A browser that dies mid-call never answers: fail what is outstanding instead of waiting forever.
    ws.addEventListener("close", () => {
      clearTimeout(handshake);
      fail(new Error("CDP socket closed before it opened"));
      for (const { rej, timer } of pending.values()) {
        clearTimeout(timer);
        rej(new Error("CDP socket closed"));
      }
      pending.clear();
    });
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && pending.has(m.id)) {
        const { res, rej, timer } = pending.get(m.id);
        clearTimeout(timer);
        pending.delete(m.id);
        if (m.error) rej(new Error(`${m.error.message}${m.error.data ? `: ${m.error.data}` : ""}`));
        else res(m.result);
      } else if (m.method) {
        for (const fn of listeners.get(m.method) ?? []) fn(m.params);
      }
    });
    const client = {
      send: (method, params = {}) =>
        new Promise((res, rej) => {
          const id = ++nextId;
          // An unanswered command must not hold its caller forever: drop it, so the caller unwinds and
          // closes the browser.
          const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`CDP ${method} got no answer within 30s`));
          }, 30_000);
          pending.set(id, { res, rej, timer });
          ws.send(JSON.stringify({ id, method, params }));
        }),
      on: (method, fn) => {
        listeners.set(method, [...(listeners.get(method) ?? []), fn]);
      },
      once: (method) => new Promise((res) => client.on(method, res)),
      close: () => ws.close(),
    };
    ws.addEventListener("open", () => {
      clearTimeout(handshake);
      ok(client);
    });
  });
}

/**
 * Launch a headless Chromium with a throwaway profile and attach to its first page. Returns the CDP
 * client and a `close()` that kills the browser and removes the profile. A launch that fails releases
 * the browser and profile itself; `close()` may be called any number of times.
 */
export async function launchChromium({ exe = findChromium(), width = 1600, height = 1000 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "compy-layout-"));
  let child = null;
  let exited = null;
  let cdp = null;
  let closing = null;
  const close = () =>
    (closing ??= (async () => {
      try {
        cdp?.close();
      } catch {
        /* already closed */
      }
      // Signal only the browser this launch spawned, and only while it runs: once it has exited (or
      // never started) its pid may belong to somebody else's process.
      if (child && child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await Promise.race([exited, sleep(5000)]);
      }
      await removeDir(profile);
    })());
  try {
    const args = [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      "about:blank",
    ];
    child = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    let spawnError = null;
    // Without a listener a failed spawn's "error" event is thrown out of the worker.
    child.on("error", (e) => (spawnError ??= e));
    child.stderr.on("data", (d) => (stderr += d));
    exited = new Promise((r) => child.once("exit", r));

    const portFile = join(profile, "DevToolsActivePort");
    const deadline = Date.now() + 30_000;
    let port = 0;
    while (!port) {
      if (spawnError) throw new Error(`Chromium could not be started (${exe}): ${spawnError.message}`);
      if (child.exitCode !== null) throw new Error(`Chromium exited (${child.exitCode}) before opening its debug port:\n${stderr}`);
      if (Date.now() > deadline) throw new Error(`Chromium did not open its debug port within 30s:\n${stderr}`);
      if (existsSync(portFile)) {
        const [first] = readFileSync(portFile, "utf8").split(/\r?\n/);
        if (Number(first) > 0) port = Number(first);
      }
      if (!port) await sleep(50);
    }

    let page = null;
    while (!page) {
      if (Date.now() > deadline) throw new Error("Chromium opened its debug port but listed no page target within 30s");
      // Bounded by what is left of the deadline and aborted afterwards: a request that never answers
      // would hold this one await past the deadline check above.
      const request = new AbortController();
      const list = await within(fetch(`http://127.0.0.1:${port}/json/list`, { signal: request.signal }).then((r) => r.json()), Math.max(0, deadline - Date.now()), "debug target list did not answer")
        .catch(() => [])
        .finally(() => request.abort());
      page = list.find((t) => t.type === "page") ?? null;
      if (!page) await sleep(50);
    }
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    return { exe, cdp, close };
  } catch (error) {
    return unwind(error, close);
  }
}

/**
 * Bundle + serve + open: returns `evaluate(expr)` (awaits promises, returns by value, throws on a page
 * exception), `errors` (uncaught page exceptions seen so far), `screenshot()` (PNG base64) and
 * `close()`. `html` is the page's HTML text; it must reference `./page.js` and `./page.css`.
 */
export async function openBundledPage({ entry, resolveDir, html, plugins, readyExpr = "true" }) {
  const outdir = mkdtempSync(join(tmpdir(), "compy-layout-out-"));
  let server = null;
  let browser = null;
  let closing = null;
  // One teardown for the caller and for a failed setup: browser, then server, then the bundle directory,
  // each attempted even when the one before it fails.
  const close = () =>
    (closing ??= (async () => {
      try {
        await browser?.close();
      } finally {
        try {
          await server?.close();
        } finally {
          await removeDir(outdir);
        }
      }
    })());
  try {
    await bundlePage({ entry, resolveDir, outdir, plugins });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(outdir, "index.html"), html);
    server = await serveDir(outdir);
    browser = await launchChromium();
    const { cdp } = browser;
    const errors = [];
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    cdp.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "unknown page exception"));
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${server.origin}/index.html` });
    await within(loaded, 30_000, "page never fired its load event within 30s");

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) {
        throw new Error(`page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      }
      return result.value;
    };

    const deadline = Date.now() + 30_000;
    while (!(await evaluate(readyExpr))) {
      if (errors.length) throw new Error(`page failed before it was ready:\n${errors.join("\n")}`);
      if (Date.now() > deadline) throw new Error(`page never satisfied ready expression ${readyExpr}`);
      await sleep(50);
    }

    return {
      evaluate,
      errors,
      screenshot: async () => (await cdp.send("Page.captureScreenshot", { format: "png" })).data,
      close,
    };
  } catch (error) {
    return unwind(error, close);
  }
}
