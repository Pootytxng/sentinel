// e2e-updater-probe.mjs - inspect/drive the RUNNING Compy webview over CDP (WebView2).
//
// The installed app must be launched with the debugging port open, e.g.:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9433"
//   & "$env:LOCALAPPDATA\Compy\compy.exe"
//
// Usage: node scripts/e2e-updater-probe.mjs <port> <preset>
// Presets:
//   stamp        -> invoke('get_build_stamp') + rail version + pill text (one JSON line)
//   click-pill   -> click the topbar update pill (opens the panel), returns panel text
//   click-update -> click "Update now" in the open panel (starts download+install)
//   pill         -> pill + panel text only (no clicks)
// Any other arg is evaluated as a raw JS expression in the main window.
//
// Node >= 21 (global WebSocket). ASCII only (see ship-reinstall.ps1 encoding guard).

const [, , portArg, ...rest] = process.argv;
const port = Number(portArg);
const preset = rest.join(" ") || "stamp";
if (!port) {
  console.error("usage: node e2e-updater-probe.mjs <port> <preset|js>");
  process.exit(2);
}

const EXPRS = {
  stamp: `(async () => ({
    stamp: await window.__TAURI_INTERNALS__.invoke("get_build_stamp").catch((e) => "ERR:" + e),
    railVersion: document.querySelector(".v2-version")?.textContent ?? null,
    pill: document.querySelector(".v2-update")?.textContent ?? null,
  }))()`,
  pill: `({
    pill: document.querySelector(".v2-update")?.textContent ?? null,
    panel: document.querySelector(".v2-update-panel")?.textContent ?? null,
  })`,
  "click-pill": `(() => {
    const b = document.querySelector("button.v2-update");
    if (!b) return { clicked: false, reason: "no pill" };
    b.click();
    return { clicked: true, panel: document.querySelector(".v2-update-panel")?.textContent ?? null };
  })()`,
  "click-update": `(() => {
    const b = document.querySelector(".v2-update-go");
    if (!b) return { clicked: false, reason: "no Update now button (panel closed?)" };
    b.click();
    return { clicked: true };
  })()`,
};
const expression = EXPRS[preset] ?? preset;

// "shot <path>" preset: capture the main webview as PNG (visual evidence for UI review).
const shotPath = preset.startsWith("shot ") ? preset.slice(5).trim() : null;

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

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

async function evalIn(target, expr) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const call = rpc(ws);
  const r = await call("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  ws.close();
  return r;
}

const pages = (await targets()).filter((t) => t.type === "page");
if (!pages.length) {
  console.error("no page targets on port", port);
  process.exit(1);
}
// Pick the MAIN window. The obvious marker is the v2 shell, but Settings (and other full-surface
// views) render as a SIBLING that REPLACES ShellV2 (App.tsx), so `.v2-shell` is absent while a
// surface is open — a `.v2-shell`-only test then wrongly falls to pages[0], which can be the overlay
// HUD (found during zh-CN Settings QA, 2026-07-23). So score every page and take the best: the shell
// wins outright when present; otherwise fall back to the button-count heuristic (the main window is
// button-rich in every view — shell OR Settings — while the overlay HUD has almost none).
let main = null;
let bestScore = -1;
for (const p of pages) {
  try {
    const probe = await evalIn(
      p,
      `({ shell: !!document.querySelector(".v2-shell"), buttons: document.querySelectorAll("button").length })`,
    );
    const v = probe.result?.value ?? {};
    const score = (v.shell ? 100000 : 0) + (v.buttons ?? 0);
    if (score > bestScore) {
      bestScore = score;
      main = p;
    }
  } catch {
    /* target may be closing; skip it */
  }
}
if (!main) main = pages[0];
if (shotPath) {
  const fs = await import("node:fs");
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const call = rpc(ws);
  const shot = await call("Page.captureScreenshot", { format: "png" });
  ws.close();
  fs.writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify({ shot: shotPath, bytes: shot.data.length }));
  process.exit(0);
}
const out = await evalIn(main, expression);
if (out.exceptionDetails) {
  console.error("EVAL ERROR:", JSON.stringify(out.exceptionDetails));
  process.exit(1);
}
console.log(JSON.stringify(out.result?.value ?? null));
process.exit(0);
