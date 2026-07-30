// Walk every LabDeck disclosure row and report what the Rig Evidence Map does for each one.
// Read-only: opens a row, samples the map, closes it. No screenshots, no writes to disk.
//
// Usage: node scripts/review/labdeck-map-probe.mjs <cdpPort>
//
// Migrated out of a session scratchpad 2026-07-30. This probe is what surfaced the `ld-prove-compare`
// subject anomaly (it reports `subject:"move"` where every other row reports `subject:"row"`), so it
// lives in the repo to keep that finding reproducible by a future session rather than resting on one
// expiring Temp file.
const port = process.argv[2] || "9333";

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);

// Same rule the capture harness uses: the real app window is the one with a nav rail.
let target = null;
for (const p of pages) {
  const probe = await open(p.webSocketDebuggerUrl);
  const rail = await probe.ev("document.querySelectorAll('.v2-nav-item').length");
  if (rail > 0 && !target) target = probe;
  else probe.close();
}
if (!target) throw new Error("no app target with a nav rail");

const ROWS = [
  "ld-prove-compare",
  "ld-prove-benchmark",
  "ld-prove-latency",
  "ld-prove-tuning",
  "ld-prove-experiments",
  "ld-problem-stutter",
  "ld-problem-unstableFps",
  "ld-problem-inputDelay",
  "ld-problem-crashes",
  "ld-problem-heat",
  "ld-problem-changed",
  "ld-advanced-blackbox",
  "ld-advanced-diagnostics",
];

const MAP = `JSON.stringify((()=>{const m=document.querySelector('.ld-map');return{focus:m&&m.dataset.focus,subject:m&&m.dataset.subject,part:(document.querySelector('.ld-map-part')||{}).textContent,for:(document.querySelector('.ld-map-for')||{}).textContent||null,chip:(document.querySelector('.ld-map-all')||{}).textContent||null,src:((document.querySelector('.ld-map-src')||{}).textContent||'').slice(0,70)}})())`;

const click = (id) =>
  `(()=>{const h=document.querySelector('[aria-controls="${id}-body"]');if(h){h.click();return true}return false})()`;

console.log("CLOSED  =>", await target.ev(MAP));
for (const id of ROWS) {
  const found = await target.ev(click(id));
  await sleep(450);
  const state = await target.ev(MAP);
  console.log(`${found ? "" : "MISSING "}${id} => ${state}`);
  await target.ev(click(id)); // collapse again
  await sleep(200);
}
target.close();
await sleep(150); // let the socket close settle before exit (libuv assertion on Windows otherwise)
process.exit(0);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function open(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Runtime.enable");
  return {
    send,
    ev: async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true });
      return r.result?.result?.value;
    },
    close: () => ws.close(),
  };
}
