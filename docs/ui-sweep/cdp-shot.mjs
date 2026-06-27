// CDP screenshot driver for the live Tauri (WebView2) shell.
// Usage: node cdp-shot.mjs <port> <outPng> [navExpr]
//   navExpr: optional JS evaluated in the MAIN window before the shot (e.g. click a rail item);
//            we then wait briefly for the surface to settle.
// Picks the MAIN app window (largest viewport) — not the small FPS overlay.
// No deps — Node 21+ global fetch + WebSocket. Launch the app first with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
const [, , port, out, navExpr] = process.argv;
if (!port || !out) {
  console.error("usage: node cdp-shot.mjs <port> <outPng> [navExpr]");
  process.exit(1);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return { ws, send, ready };
}

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl && !String(t.url).startsWith("devtools"));
if (!pages.length) {
  console.error("no page targets:", JSON.stringify(list.map((t) => ({ type: t.type, url: t.url }))));
  process.exit(2);
}

// Pick the MAIN window by RAIL PRESENCE (the shell has .cc-rail-item; the FPS overlay never does),
// retrying the query a few times because a backgrounded/re-rendering main webview can transiently
// report rail-count 0 (the old width-dominant score then lost main to the overlay). The rail DOM
// exists regardless of window occlusion, so a short retry resolves the transient. Width is only a
// tiebreak among rail-bearing pages / a fallback if none ever report a rail.
let best = null;
for (const p of pages) {
  const c = connect(p.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Runtime.enable");
  let rail = 0;
  let w = 0;
  for (let i = 0; i < 5; i++) {
    const { result } = await c.send("Runtime.evaluate", {
      expression: "JSON.stringify({rail:document.querySelectorAll('.cc-rail-item, .rail-item').length, w:innerWidth})",
      returnByValue: true,
    });
    const m = (() => { try { return JSON.parse(result.value); } catch { return { rail: 0, w: 0 }; } })();
    rail = Math.max(rail, m.rail);
    w = Math.max(w, m.w);
    if (rail > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const area = rail * 10_000_000 + w; // rail presence DOMINATES; width only tiebreaks/falls back
  if (!best || area > best.area) {
    if (best) best.ws.close();
    best = { ...c, area, rail };
  } else {
    c.ws.close();
  }
}
if (best && best.rail === 0) console.error("WARN: no rail-bearing window found; picked widest as fallback");

await best.send("Page.enable");
if (navExpr) {
  await best.send("Runtime.evaluate", { expression: navExpr, awaitPromise: true });
  await new Promise((r) => setTimeout(r, 1100));
}
const { data } = await best.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const fs = await import("node:fs");
fs.writeFileSync(out, Buffer.from(data, "base64"));
console.log("shot ->", out, "(viewport area", best.area + ")");
best.ws.close();
