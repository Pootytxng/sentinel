// Capture the LabDeck review set from a RUNNING Compy over CDP.
//
// Usage:  node scripts/review/labdeck-capture-set.mjs <cdpPort> <outDir> [WxH]
// e.g.    node scripts/review/labdeck-capture-set.mjs 9333 C:\tmp\labdeck-be4636c 1484x971
//
// Launch the app with a debug port first:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'
//   Start-Process "$env:LOCALAPPDATA\Compy\compy.exe"
//
// This file was migrated out of a session scratchpad (2026-07-30) because the acceptance rule it
// carries is repeatable, not disposable. It has no dependency on any particular worktree, session
// directory, or machine — port and output directory are arguments.
//
// TWO MECHANICAL HONESTY PROPERTIES, both of which exist because they failed in practice:
//
//  1. DUPLICATE DETECTION. Every shot reports a sha256 prefix. Two identical hashes mean a
//     navigation silently did nothing and the "different" states are the same picture — detected
//     mechanically instead of eyeballed.
//
//  2. FRAMING (the H7 guard). A capture that is ABOUT an element scrolls that element into view and
//     refuses to shoot unless its pixels are inside the viewport — asserted BEFORE the shutter and
//     again AFTER it, so a late layout shift cannot quietly move the subject out of a frame that has
//     already been recorded as good. The predicate is `framing.mjs`, unit-tested by
//     `framing.test.mjs`; the page reports geometry and node applies the tested rule, so the rule
//     that is enforced is literally the rule that is tested. `scroll:false` asserts framing WITHOUT
//     moving the page, for captures whose hand-picked scroll position the panel already reviewed.
//
//     Subjects also get a CLIPPED companion shot (`<name>.subject.png`) containing only the
//     element's own box, so its pixels are self-evident in the evidence set rather than something a
//     reviewer has to go hunting for inside a full frame.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { framingVerdict } from "./framing.mjs";

const port = process.argv[2] || "9333";
const OUT = process.argv[3];
if (!OUT) throw new Error("usage: labdeck-capture-set.mjs <cdpPort> <outDir> [WxH]");
fs.mkdirSync(OUT, { recursive: true });

// REVIEW VIEWPORT. A UI review is only worth what its resolution is worth, and the native window
// cannot be relied on to hold one: on this machine the WebView stopped tracking the OS window
// entirely (1500x980 and 2000x1200 both produced a 972x567 CSS viewport), so a review that trusted
// the window size would have been conducted at 65% of the owner's real width without anyone
// noticing. The viewport is therefore PINNED over CDP and recorded in the evidence, so every
// capture in a set is provably the same, stated resolution.
//
// This is an emulated viewport, not a natively resized window. It reproduces the owner's CSS pixel
// box faithfully — which is what layout review needs — and it must be reported as what it is.
const [vw, vh] = (process.argv[4] || "1484x971").split("x").map(Number);
if (!(vw > 0 && vh > 0)) throw new Error(`bad viewport: ${process.argv[4]}`);

const target = await pickAppTarget(port);
await target.send("Page.enable");
await target.send("Emulation.setDeviceMetricsOverride", {
  width: vw,
  height: vh,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(900);
const liveViewport = await target.ev(`innerWidth+'x'+innerHeight`);
if (liveViewport !== `${vw}x${vh}`) {
  throw new Error(`viewport pin failed: asked ${vw}x${vh}, got ${liveViewport}`);
}
console.log(`viewport pinned = ${liveViewport} (emulated override, deviceScaleFactor 1)`);

const hashes = new Map();
const results = [];

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);

const shot = async (name, clip) => {
  const params = { format: "png" };
  if (clip) {
    params.clip = { ...clip, scale: 1 };
    params.captureBeyondViewport = false;
  }
  const r = await target.send("Page.captureScreenshot", params);
  const buf = Buffer.from(r.result.data, "base64");
  fs.writeFileSync(path.join(OUT, `${name}.png`), buf);
  const h = sha(buf);
  if (clip) return h; // clipped companions are never duplicate-checked against full frames
  const dupe = hashes.get(h);
  hashes.set(h, name);
  return dupe ? `${h} DUPLICATE-OF:${dupe}` : h;
};

const scrollTo = (y) =>
  target.ev(
    `(()=>{const c=document.querySelector('.v2-content');c.scrollTop=${y};return c.scrollTop})()`,
  );

const toggle = (ctrl) =>
  target.ev(
    `(()=>{const h=document.querySelector('[aria-controls="${ctrl}"]');if(!h)return null;h.click();return h.getAttribute('aria-expanded')})()`,
  );

// Report the subject's geometry. Pure measurement — the verdict is computed in node.
const geometry = (sel, doScroll) =>
  target.ev(
    `(()=>{const e=document.querySelector('${sel}');
      if(!e)return JSON.stringify({found:false});
      ${doScroll ? `e.scrollIntoView({block:'center',behavior:'instant'});` : ""}
      const b=e.getBoundingClientRect();
      return JSON.stringify({found:true,top:b.top,left:b.left,width:b.width,height:b.height,
        viewportHeight:innerHeight,viewportWidth:innerWidth,
        pageX:b.left+scrollX,pageY:b.top+scrollY,
        scroll:document.querySelector('.v2-content').scrollTop})})()`,
  );

const assertFramed = async (sel, { minVisible = 160, scroll = true } = {}, phase) => {
  const raw = await geometry(sel, scroll && phase === "pre");
  const g = JSON.parse(raw);
  if (!g.found) throw new Error(`FRAMING FAIL [${phase}] ${sel}: not in DOM`);
  const v = framingVerdict({
    top: g.top,
    height: g.height,
    viewportHeight: g.viewportHeight,
    minVisible,
  });
  if (!v.framed) {
    throw new Error(
      `FRAMING FAIL [${phase}] ${sel}: ${v.reason} ` +
        `(visible ${Math.round(v.visible)}px of ${Math.round(g.height)}px, need ${Math.round(v.required)}px, ` +
        `top ${Math.round(g.top)}, viewport ${Math.round(g.viewportHeight)})`,
    );
  }
  return { ...g, ...v };
};

const step = async (name, assertExpr, require) => {
  let pre = null;
  let post = null;
  let opts = null;
  let sel = null;
  if (require) {
    ({ sel, ...opts } = typeof require === "string" ? { sel: require } : require);
    // Frame first, settle, THEN assert — so the recorded scroll position is the one that was shot.
    pre = await assertFramed(sel, opts, "pre");
    if (opts.scroll !== false) await sleep(400);
  }
  const state = await target.ev(assertExpr);
  const h = await shot(name);
  if (require) {
    // The shutter has fired. Prove the subject was STILL in frame at that moment — a pre-shot-only
    // check cannot see a layout shift that happened during the settle.
    post = await assertFramed(sel, { ...opts, scroll: false }, "post");
    await shot(`${name}.subject`, {
      x: Math.max(0, post.pageX),
      y: Math.max(0, post.pageY),
      width: Math.max(1, Math.min(post.width, post.viewportWidth)),
      height: Math.max(1, Math.min(post.height, post.viewportHeight - Math.max(0, post.top))),
    });
  }
  results.push({ name, sha: h, state, framed: pre ? { pre, post } : null });
  const f = pre
    ? `  framed=${Math.round(pre.visible)}/${Math.round(pre.height)}px top=${Math.round(pre.top)}→${Math.round(post.top)}`
    : "";
  console.log(`${name}  sha=${h}  ${state}${f}`);
};

const DECK = `JSON.stringify({deck:!!document.querySelector('.lab-deck'),scroll:document.querySelector('.v2-content').scrollTop,vw:innerWidth+'x'+innerHeight})`;
const MAP = `JSON.stringify({focus:document.querySelector('.ld-map').dataset.focus,subject:document.querySelector('.ld-map').dataset.subject,chip:(document.querySelector('.ld-map-all')||{}).textContent||null,scroll:document.querySelector('.v2-content').scrollTop})`;

// ---- GLANCE layer, top to bottom -------------------------------------------------------------
for (const y of [0, 850, 1700, 2600, 3025]) {
  await scrollTo(y);
  await sleep(500);
  await step(`c3-glance-${y}`, DECK);
}

// ---- FULL DETAIL layer on the hero move card --------------------------------------------------
await scrollTo(0);
await sleep(300);
console.log("ld-move-detail expanded =>", await toggle("ld-move-detail"));
await sleep(600);
await step(
  "c3-move-detail",
  `JSON.stringify({open:document.querySelector('[aria-controls="ld-move-detail"]').getAttribute('aria-expanded'),order:[...document.querySelectorAll('#ld-move-detail > *')].map(e=>e.className.split(' ')[0]),words:(document.querySelector('#ld-move-detail').innerText.match(/\\S+/g)||[]).length})`,
  { sel: "#ld-move-detail", scroll: false },
);
await scrollTo(620);
await sleep(400);
await step("c3-move-detail-lower", DECK);
await scrollTo(0);
await sleep(300);
console.log("ld-move-detail collapsed =>", await toggle("ld-move-detail"));
await sleep(400);

// ---- DECISION layer: the comparison-evidence row ----------------------------------------------
// This is the capture H7 destroyed. It now scrolls its own subject into view and proves the pixels
// twice, and ships a clipped companion of the row body itself.
console.log("compare expanded =>", await toggle("ld-prove-compare-body"));
await sleep(700);
await step(
  "c3-row-compare",
  `JSON.stringify({open:document.querySelector('[aria-controls="ld-prove-compare-body"]').getAttribute('aria-expanded'),body:!!document.querySelector('#ld-prove-compare-body'),subject:document.querySelector('.ld-map').dataset.subject,text:(document.querySelector('#ld-prove-compare-body').innerText||'').replace(/\\s+/g,' ').slice(0,220)})`,
  "#ld-prove-compare-body",
);
console.log("compare collapsed =>", await toggle("ld-prove-compare-body"));
await sleep(400);

// ---- The map's two subjects -------------------------------------------------------------------
await scrollTo(430);
await sleep(400);
await step("c3-map-whole", MAP, { sel: ".ld-map", scroll: false });
console.log("tuning expanded =>", await toggle("ld-prove-tuning-body"));
await sleep(700);
await scrollTo(430);
await sleep(400);
await step("c3-map-part", MAP, { sel: ".ld-map", scroll: false });
console.log("tuning collapsed =>", await toggle("ld-prove-tuning-body"));
await sleep(400);
await scrollTo(0);

// ---- Word budget, stated method ---------------------------------------------------------------
const words = await target.ev(
  `JSON.stringify({moveClosed:(document.querySelector('.ld-move').innerText.match(/\\S+/g)||[]).length,deck:(document.querySelector('.lab-deck').innerText.match(/\\S+/g)||[]).length,method:'innerText /\\\\S+/g on the rendered subtree, all rows collapsed'})`,
);
console.log("WORDS", words);

// ---- Preview OFF: the production-default Lab must be untouched --------------------------------
await target.ev(`localStorage.setItem('compy_lab_deck','0')`);
await target.send("Page.reload", {});
await sleep(4200);
await target.ev(
  `(()=>{const b=[...document.querySelectorAll('.v2-nav-item')].find(x=>/Lab/.test(x.textContent||''));if(b)b.click();return !!b})()`,
);
await sleep(1600);
await step(
  "c3-off-labconsole",
  `JSON.stringify({deck:!!document.querySelector('.lab-deck'),console:!!document.querySelector('.lab-console'),root:(document.querySelector('.lab-console')||{}).className||null,tabs:[...document.querySelectorAll('.lab-console [role="tab"], .lab-console .station-tab, .lab-console button')].slice(0,6).map(e=>e.textContent.trim().slice(0,24))})`,
);

// ---- Back ON, leave the runtime on the review state -------------------------------------------
await target.ev(`localStorage.setItem('compy_lab_deck','1')`);
await target.send("Page.reload", {});
await sleep(4200);
await target.ev(
  `(()=>{const b=[...document.querySelectorAll('.v2-nav-item')].find(x=>/Lab/.test(x.textContent||''));if(b)b.click();return !!b})()`,
);
await sleep(1600);
await step("c3-on-restored", DECK);

fs.writeFileSync(
  path.join(OUT, "capture-set.json"),
  JSON.stringify({ viewport: `${vw}x${vh}`, viewportMethod: "CDP Emulation override", captures: results }, null, 2),
);
console.log("\nOK captures:", results.length, "unique:", hashes.size, "viewport:", `${vw}x${vh}`);
await finish(0);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Closing the socket and exiting in the same tick trips a libuv assertion on Windows
// (`!(handle->flags & UV_HANDLE_CLOSING)`), which prints as a crash after a clean run and makes a
// successful capture look like a failure. Let the close settle first.
async function finish(code) {
  // Leave the app as we found it — a pinned viewport that outlived the harness would silently
  // misrepresent every later look at the running app, including the owner's own.
  try {
    await target.send("Emulation.clearDeviceMetricsOverride");
  } catch {
    /* the socket may already be gone; the override dies with the session anyway */
  }
  target.close();
  await sleep(150);
  process.exit(code);
}

async function pickAppTarget(p) {
  const list = await (await fetch(`http://127.0.0.1:${p}/json/list`)).json();
  for (const t of list.filter((x) => x.type === "page" && x.webSocketDebuggerUrl)) {
    const c = await connect(t.webSocketDebuggerUrl);
    if ((await c.ev("document.querySelectorAll('.v2-nav-item').length")) > 0) return c;
    c.close();
  }
  throw new Error("no app target with a nav rail");
}

async function connect(url) {
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
