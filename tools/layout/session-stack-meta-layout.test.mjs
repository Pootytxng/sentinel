// @vitest-environment node
// Chromium layout regression for #677: a Live-room session row must show the session's age and
// duration whole, however long the game's name. On main at 01b27929 `.ss-row`'s first track capped
// at 210px while real `.ss-meta` strings need 230–336px, and the whole string ellipsized as one, so
// "Yesterday · 1h 23m" was what got cut. jsdom has no layout engine; this measures text in a real
// Chromium.
//
// The REAL SessionStack renders under App.tsx's stylesheet chain plus monitor-console.css, in hosts
// from 300px to 1100px wide (the sessions half of the Live room spans that range across the 380px
// floor and 1280/1500/1920 windows), in English and Chinese. Read back over CDP:
//   1. every glyph of the age · duration tail lies inside its `.ss-meta` box (not clipped, not
//      under an ellipsis), on one line;
//   2. the meta track stays at most 210px unless the age · duration tail alone needs more (a
//      100-plus-days-old row in English does: "123 DAYS AGO · 12M 34S" is ~207px), and rows within
//      the cap start their canvases at one x;
//   3. no row scrolls sideways at any width (#622-f1). Below 600px the "vs previous" chip used to
//      sit beside the canvas and push the row 81–201px past its box; there the row now stacks
//      meta / canvas / chip, and the canvas keeps a usable width there;
//   4. the timeline canvas is at least 120px wide at every width (#622-f2): from 600px up the chip
//      wraps rather than squeeze it.
// RED on 01b27929: the tail is clipped in all 48 rows (both locales, every width).
// RED on f7ae3854 for #622-f1: rows scroll sideways at 300, 380 and 480px in both locales.
// RED on db3a3d8c for #622-f2: the English canvas is 27 / 67 / 107px at 600 / 640 / 680px.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBundledPage, root } from "./chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = root.replace(/\\/g, "/") + "/src";
const WIDTHS = [300, 380, 420, 480, 560, 600, 640, 680, 720, 900, 1100];
const MIN_CANVAS_PX = 120;
const LOCALES = ["en", "zh-CN"];
const TRACK_CAP_PX = 210;
const TOLERANCE_PX = 0.5;

function appCssImports() {
  return readFileSync(join(root, "src", "App.tsx"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^import\s+"(\.[^"]+\.css)"/)?.[1])
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ""));
}

const tauriStub = {
  name: "tauri-stub",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "tauri-stub" }));
    build.onLoad({ filter: /.*/, namespace: "tauri-stub" }, () => ({
      loader: "js",
      contents: `
        export const invoke = () => Promise.resolve(null);
        export const core = { invoke };
        export const listen = () => Promise.resolve(() => {});
        export const emit = () => Promise.resolve();
        export const getCurrentWindow = () => ({ label: "main", listen, emit });
        export default { invoke };
      `,
    }));
  },
};

const HTML = `<!doctype html>
<html lang="en" data-custom-chrome="1" data-v2="on" data-dash-v2="on" data-living="on" data-hud="on" data-room-identity="on" data-itheme="violet">
  <head>
    <meta charset="utf-8" />
    <title>session stack meta layout fixture</title>
    <link rel="stylesheet" href="./page.css" />
    <style>html, body { margin: 0; padding: 0; } #host { width: 1100px; }</style>
  </head>
  <body>
    <div id="host"></div>
    <script type="module" src="./page.js"></script>
  </body>
</html>`;

// Long real-world names on purpose, with the longest ages and durations the row prints.
const ENTRY = `
import "${src}/i18n/index.ts";
${appCssImports().map((p) => `import "${src}/${p}";`).join("\n")}
import "${src}/surfaces/monitor-console.css";
import { createRoot } from "react-dom/client";
import i18n from "${src}/i18n/index.ts";
import { SessionStack } from "${src}/surfaces/monitor/SessionStack.tsx";

const day = 86_400_000;
const at = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString();
const sess = (process_name, daysAgo, duration_secs) => ({
  started_at: at(daysAgo), duration_secs, process_name, samples: duration_secs, avg_fps: 140,
  avg_frametime_ms: 7.1, low1_fps_est: 96, peak_gpu_temp_c: 70, peak_gpu_usage_pct: 97,
  peak_ram_used_bytes: null, ram_total_bytes: null, compy_changes_active: 0,
  stutter_timeline: [[0, 120], [duration_secs / 2, 90], [duration_secs, 130]],
});
const SESSIONS = [
  sess("TheElderScrollsVOblivionRemastered-Win64-Shipping.exe", 0, 45240),
  sess("Call of Duty Modern Warfare III.exe", 1, 4980),
  sess("RainbowSix_Vulkan.exe", 12, 3600),
  sess("eldenring.exe", 123, 754),
];
const host = document.getElementById("host");
createRoot(host).render(<SessionStack sessions={SESSIONS} reduced={true} />);

const settle = async () => {
  await document.fonts.ready;
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
const rectsOf = (range) => [...range.getClientRects()].filter((r) => r.width > 0.5);

window.__measure = async (lang, widths) => {
  await i18n.changeLanguage(lang);
  const out = [];
  for (const w of widths) {
    host.style.width = w + "px";
    await settle();
    for (const row of host.querySelectorAll(".ss-row")) {
      const meta = row.querySelector(".ss-meta");
      const m = meta.getBoundingClientRect();
      const text = meta.textContent;
      // The tail is everything after the name: the first " · " onward.
      const cut = text.indexOf(" · ");
      // Map the character offset to a DOM position across however many text nodes there are.
      const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      const pos = (offset) => {
        let acc = 0;
        for (const n of nodes) {
          if (offset < acc + n.data.length) return [n, offset - acc];
          acc += n.data.length;
        }
        return null;
      };
      const end = nodes[nodes.length - 1];
      const tailRange = (offset) => {
        const r = document.createRange();
        r.setStart(...pos(offset));
        r.setEnd(end, end.data.length);
        return r;
      };
      const [startNode] = pos(cut + 3);
      const rects = rectsOf(tailRange(cut + 3)).map((r) => ({ left: r.left, right: r.right, mid: (r.top + r.bottom) / 2 }));
      // The whole tail with its leading separator: the least the meta box can be and keep it whole.
      const sep = rectsOf(tailRange(cut));
      const tailWidth = sep.length ? Math.max(...sep.map((r) => r.right)) - Math.min(...sep.map((r) => r.left)) : 0;
      const mids = [...new Set(rects.map((r) => Math.round(r.mid)))];
      // Something between the glyph and the meta box that clips: the meta itself or a child of it.
      let clip = { left: m.left, right: m.right };
      for (let el = startNode.parentElement; el && el !== row; el = el.parentElement) {
        if (getComputedStyle(el).overflowX !== "visible") {
          const b = el.getBoundingClientRect();
          clip = { left: Math.max(clip.left, b.left), right: Math.min(clip.right, b.right) };
        }
      }
      out.push({
        lang, width: w, text,
        tail: text.slice(cut + 3),
        metaWidth: m.width,
        tailWidth,
        canvasLeft: row.querySelector(".ss-canvas-wrap").getBoundingClientRect().left,
        canvasWidth: row.querySelector(".ss-canvas-wrap").getBoundingClientRect().width,
        rowHeight: row.getBoundingClientRect().height,
        chip: (() => { const c = row.querySelector(".ss-chip"); if (!c) return null; const b = c.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width }; })(),
        rects, lines: mids.length, clip,
        rowOverflow: row.scrollWidth - row.clientWidth,
      });
    }
  }
  return out;
};
window.__compyLayoutReady = true;
`;

describe("Live session rows keep age and duration whole in a real Chromium (#677)", () => {
  /** @type {Awaited<ReturnType<typeof openBundledPage>> | null} */
  let page = null;
  /** @type {any[]} */
  let rows = [];
  const where = (r) => `${r.lang} ${r.width}px "${r.text}"`;

  beforeAll(async () => {
    page = await openBundledPage({
      entry: ENTRY,
      resolveDir: here,
      html: HTML,
      plugins: [tauriStub],
      readyExpr: "window.__compyLayoutReady === true && document.querySelectorAll('.ss-row').length === 4",
    });
    for (const lang of LOCALES) rows.push(...(await page.evaluate(`window.__measure(${JSON.stringify(lang)}, ${JSON.stringify(WIDTHS)})`)));
    const dump = process.env.COMPY_LAYOUT_DUMP;
    if (dump) {
      const json = JSON.stringify(rows.map(({ rects, ...r }) => r), null, 1);
      if (dump.endsWith(".json")) writeFileSync(dump, json);
      else console.log(json);
    }
  }, 120_000);

  afterAll(async () => {
    await page?.close();
  }, 30_000);

  it("rendered every row at every width in both locales", () => {
    expect(page.errors).toEqual([]);
    expect(rows).toHaveLength(LOCALES.length * WIDTHS.length * 4);
    for (const r of rows) expect(r.tail.length, where(r)).toBeGreaterThan(0);
  });

  it("shows every glyph of the age and duration inside the row's meta box, on one line", () => {
    const violations = [];
    for (const r of rows) {
      if (r.lines !== 1) violations.push(`${where(r)}: tail spans ${r.lines} lines`);
      for (const g of r.rects) {
        if (g.right > r.clip.right + TOLERANCE_PX || g.left < r.clip.left - TOLERANCE_PX) {
          violations.push(`${where(r)}: tail glyph ${g.left.toFixed(1)}–${g.right.toFixed(1)} clipped at ${r.clip.right.toFixed(1)}`);
          break;
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the meta track at 210px or less unless the tail alone needs more, and aligns rows within the cap", () => {
    const violations = [];
    for (const lang of LOCALES) {
      for (const w of WIDTHS.filter((x) => x >= 720)) {
        const set = rows.filter((r) => r.lang === lang && r.width === w);
        for (const r of set) {
          if (r.metaWidth > Math.max(TRACK_CAP_PX, r.tailWidth + 1) + TOLERANCE_PX) violations.push(`${where(r)}: meta ${r.metaWidth}px, tail ${r.tailWidth.toFixed(1)}px`);
        }
        const lefts = set.filter((r) => r.metaWidth <= TRACK_CAP_PX + TOLERANCE_PX).map((r) => r.canvasLeft);
        if (lefts.length < 3) violations.push(`${lang} ${w}px: only ${lefts.length} rows within the cap`);
        if (Math.max(...lefts) - Math.min(...lefts) > TOLERANCE_PX) violations.push(`${lang} ${w}px: canvases start at ${lefts.join(", ")}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("never scrolls a row sideways, 300px to 1100px (#622-f1)", () => {
    expect(rows.filter((r) => r.rowOverflow > 0).map((r) => `${where(r)}: ${r.rowOverflow}px`)).toEqual([]);
  });

  // Every width (#622-f1 below 600px, #622-f2 from 600px up): neither the stacked layout nor the
  // three-across one may trade the scroll for a vanished timeline. At exactly 600px the English
  // "vs previous" chip used to take 309px and leave the canvas 27px.
  it("keeps the timeline canvas at least 120px wide at every width", () => {
    expect(rows.filter((r) => r.canvasWidth < MIN_CANVAS_PX).map((r) => `${where(r)}: canvas ${r.canvasWidth.toFixed(1)}px`)).toEqual([]);
  });
});
