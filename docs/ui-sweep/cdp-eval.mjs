// CDP eval helper — runs a JS expression in the MAIN Tauri window and prints the JSON result.
// Usage: node cdp-eval.mjs <port> "<expression>"
// Picks the largest viewport (main app window, not the overlay). No deps (Node 21+).
const [, , port, expr] = process.argv;
if (!port || !expr) {
  console.error('usage: node cdp-eval.mjs <port> "<expression>"');
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
let best = null;
for (const p of pages) {
  const c = connect(p.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Runtime.enable");
  // Pick the MAIN window by RAIL PRESENCE (the FPS overlay never has .cc-rail-item), retrying because
  // a backgrounded/re-rendering main webview can transiently report rail-count 0. The rail DOM exists
  // regardless of occlusion, so a short retry resolves it; width is only a tiebreak/fallback. (The old
  // width-dominant score kept landing eval/clicks on the overlay → navigation silently no-op'd.)
  let rail = 0;
  let w = 0;
  for (let i = 0; i < 5; i++) {
    const { result } = await c.send("Runtime.evaluate", { expression: "JSON.stringify({rail:document.querySelectorAll('.cc-rail-item, .rail-item, .v2-nav-item').length, w:innerWidth})", returnByValue: true });
    const m = (() => { try { return JSON.parse(result.value); } catch { return { rail: 0, w: 0 }; } })();
    rail = Math.max(rail, m.rail);
    w = Math.max(w, m.w);
    if (rail > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const area = rail * 10_000_000 + w;
  if (!best || area > best.area) { if (best) best.ws.close(); best = { ...c, area }; }
  else c.ws.close();
}
const { result, exceptionDetails } = await best.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
if (exceptionDetails) console.error("EXC:", JSON.stringify(exceptionDetails.exception?.description || exceptionDetails));
console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 1));
best.ws.close();
