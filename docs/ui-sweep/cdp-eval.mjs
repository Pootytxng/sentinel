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
  // Pick the MAIN window deterministically: rail-count dominates (the shell has 6 .cc-rail-item; the
  // hidden overlay has 0), button-count breaks ties (covers the tour, where the rail is hidden). The
  // two windows share the same entry HTML, so plain area/button counts were ambiguous.
  const { result } = await c.send("Runtime.evaluate", { expression: "document.querySelectorAll('.cc-rail-item').length*1000 + document.querySelectorAll('button').length", returnByValue: true });
  const area = result.value || 0;
  if (!best || area > best.area) { if (best) best.ws.close(); best = { ...c, area }; }
  else c.ws.close();
}
const { result, exceptionDetails } = await best.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
if (exceptionDetails) console.error("EXC:", JSON.stringify(exceptionDetails.exception?.description || exceptionDetails));
console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 1));
best.ws.close();
