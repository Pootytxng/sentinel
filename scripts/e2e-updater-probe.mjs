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

import { WINDOW_PROBE_EXPRESSION, pickMainTarget } from "./lib/tauri-window-pick.mjs";

const [, , portArg, ...rest] = process.argv;
const port = Number(portArg);
const preset = rest.join(" ") || "stamp";
if (!port) {
  console.error("usage: node e2e-updater-probe.mjs <port> <preset|js>");
  process.exit(2);
}

const EXPRS = {
  // `railVersion` was dropped 2026-08-18: the rail no longer prints a version number, because the
  // navigation audit §4 moved build identifiers into Settings → About. It cross-checked the
  // rendered version against the backend, so the check is not free to lose — but the surface that
  // replaces it (`.set-about-version`) only exists while Settings is open, and a field that reads
  // null on every other room would be a check in name only. Use the `about` preset below with
  // Settings open when that comparison is the point.
  stamp: `(async () => ({
    stamp: await window.__TAURI_INTERNALS__.invoke("get_build_stamp").catch((e) => "ERR:" + e),
    pill: document.querySelector(".v2-update")?.textContent ?? null,
  }))()`,
  // Settings → About must be OPEN for this one; null means "not on screen", never "absent".
  about: `(async () => ({
    stamp: await window.__TAURI_INTERNALS__.invoke("get_build_stamp").catch((e) => "ERR:" + e),
    aboutVersion: document.querySelector(".set-about-version")?.textContent ?? null,
    aboutStamp: document.querySelector(".set-about-stamp")?.textContent ?? null,
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

// Pick the MAIN window by its Tauri label. Both windows live on http://tauri.localhost/, so the URL
// cannot tell them apart, and guessing from page content picks the overlay whenever the main window
// is not currently rendering the thing being looked for — see scripts/lib/tauri-window-pick.mjs.
let main;
try {
  ({ target: main } = await pickMainTarget({
    listTargets: async () => (await targets()).filter((t) => t.type === "page"),
    probeTarget: async (t) => (await evalIn(t, WINDOW_PROBE_EXPRESSION)).result?.value ?? null,
  }));
} catch (e) {
  console.error(`${e.message} (port ${port})`);
  process.exit(1);
}
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
