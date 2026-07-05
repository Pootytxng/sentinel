// Like cdp-eval.mjs but reads the (possibly multi-line) expression from a FILE — for fixture
// mounts too long for a shell argument. Usage: node cdp-eval-file.mjs <port> <exprFile>
// Picks the MAIN window by rail presence (same heuristic as cdp-shot.mjs).
import { readFileSync } from "node:fs";
const [, , port, exprFile] = process.argv;
if (!port || !exprFile) {
  console.error("usage: node cdp-eval-file.mjs <port> <exprFile>");
  process.exit(1);
}
const expr = readFileSync(exprFile, "utf8");

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
const pages = list.filter(
  (t) => t.type === "page" && t.webSocketDebuggerUrl && !String(t.url).startsWith("devtools"),
);
let best = null;
for (const p of pages) {
  const c = connect(p.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Runtime.enable");
  let rail = 0;
  for (let i = 0; i < 5; i++) {
    const { result } = await c.send("Runtime.evaluate", {
      expression:
        "document.querySelectorAll('.cc-rail-item, .rail-item, .v2-nav-item').length",
      returnByValue: true,
    });
    rail = Math.max(rail, result.value ?? 0);
    if (rail > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!best || rail > best.rail) {
    if (best) best.ws.close();
    best = { ...c, rail };
  } else {
    c.ws.close();
  }
}
const { result, exceptionDetails } = await best.send("Runtime.evaluate", {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
});
if (exceptionDetails) {
  console.error("EXCEPTION:", JSON.stringify(exceptionDetails, null, 2).slice(0, 2000));
  process.exit(3);
}
console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
best.ws.close();
