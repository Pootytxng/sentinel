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
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Serve one directory on 127.0.0.1 at an OS-chosen port. Files only; no index magic. */
export function serveDir(dir) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = resolve(dir, "." + path);
    if (!file.startsWith(resolve(dir)) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => ok({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })),
  );
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
    ws.addEventListener("error", (e) => fail(new Error(`CDP socket error: ${e.message ?? e.type}`)));
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
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
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        }),
      on: (method, fn) => {
        listeners.set(method, [...(listeners.get(method) ?? []), fn]);
      },
      once: (method) => new Promise((res) => client.on(method, res)),
      close: () => ws.close(),
    };
    ws.addEventListener("open", () => ok(client));
  });
}

/**
 * Launch a headless Chromium with a throwaway profile and attach to its first page. Returns the CDP
 * client and a `close()` that kills the browser and removes the profile.
 */
export async function launchChromium({ exe = findChromium(), width = 1600, height = 1000 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "compy-layout-"));
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
  const child = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((r) => child.once("exit", r));

  const portFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 30_000;
  let port = 0;
  while (!port) {
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
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    page = list.find((t) => t.type === "page") ?? null;
    if (!page) await sleep(50);
  }
  const cdp = await connectCdp(page.webSocketDebuggerUrl);
  return {
    exe,
    cdp,
    close: async () => {
      try {
        cdp.close();
      } catch {
        /* already closed */
      }
      child.kill();
      await Promise.race([exited, sleep(5000)]);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * Bundle + serve + open: returns `evaluate(expr)` (awaits promises, returns by value, throws on a page
 * exception), `errors` (uncaught page exceptions seen so far), `screenshot()` (PNG base64) and
 * `close()`. `html` is the page's HTML text; it must reference `./page.js` and `./page.css`.
 */
export async function openBundledPage({ entry, resolveDir, html, plugins, readyExpr = "true" }) {
  const outdir = mkdtempSync(join(tmpdir(), "compy-layout-out-"));
  await bundlePage({ entry, resolveDir, outdir, plugins });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(outdir, "index.html"), html);
  const server = await serveDir(outdir);
  const browser = await launchChromium();
  const { cdp } = browser;
  const errors = [];
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  cdp.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "unknown page exception"));
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `${server.origin}/index.html` });
  await loaded;

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
    close: async () => {
      await browser.close();
      await server.close();
      rmSync(outdir, { recursive: true, force: true });
    },
  };
}
