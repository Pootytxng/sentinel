// @vitest-environment node
// Chromium layout proof for P5-enough(-f1): the guided journey's "enough yet?" line in Compy's in-game
// overlay must fit the overlay window (tauri.conf.json: 230x150, overflow hidden in overlay mode, so a
// line that doesn't fit is silently cut off mid-game rather than scrolled). jsdom can't measure, so
// journey-enough.test.tsx pins what the line SAYS and this pins where the engine puts it.
//
// The REAL Overlay renders under App.tsx's stylesheet chain with `html.overlay-mode`, in an iframe the
// size of the overlay window, at every density (minimal / standard / full, full being the tallest:
// FPS, the stats row and the frametime line) and backdrop (plate / no plate), English and Chinese,
// for every line the journey can show: the countdown in seconds and minutes, settling, enough, and the
// P5-enough-f1 cap lines (halves that keep changing, and no trace to check). Read back by value:
//   1. the overlay shows the expected line (the overlay's own wording, journey-enough.ts `enoughLine`);
//   2. the overlay pill and every glyph of the line sit inside the 230x150 window;
//   3. the line never scrolls sideways.
//
// RED on 58d57931: the cap states still read "hasn't settled yet" (no cap), so invariant 1 fails for
// them, and at full density in English that settling line ran the pill to 152.7px, past the window's
// 150px bottom edge (invariant 2). The overlay now has its own two-line wording for both.
// P5-realplay: a real-play session's lines too (the countdown, then "long enough to count", never a
// halves state), with the recording flag set to "real-play" for those states.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBundledPage, root } from "./chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = root.replace(/\\/g, "/") + "/src";

const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const win = conf.app.windows.find((w) => w.label === "overlay");
const W = win.width;
const H = win.height;
const DENSITIES = ["minimal", "standard", "full"];
const BACKDROPS = ["on", "off"];
const LOCALES = ["en", "zh-CN"];
/** Every line the journey can show: [name, samples, first-half fps, second-half fps, traced, session
 *  kind]. A real-play session counts down, then says it is long enough, whatever its halves do. */
const STATES = [
  ["moreSecs", 510, 240, 240, true, "pair"],
  ["moreMin", 0, 240, 240, true, "pair"],
  ["settling", 900, 240, 250, true, "pair"],
  ["enough", 900, 240, 245, true, "pair"],
  ["unsettled", 1200, 240, 250, true, "pair"],
  ["untraced", 1200, 240, 240, false, "pair"],
  ["realPlayMoreSecs", 510, 240, 240, true, "real-play"],
  ["realPlayMoreMin", 0, 240, 240, true, "real-play"],
  ["realPlayCounts", 1200, 240, 250, true, "real-play"],
];
const EXPECTED_KEY = {
  moreSecs: ["lab.experimentBench.journey.enoughMore", { secs: 90 }],
  moreMin: ["lab.experimentBench.journey.enoughMoreMin", { min: 10 }],
  settling: ["lab.experimentBench.journey.enoughSettlingShort", {}],
  enough: ["lab.experimentBench.journey.enough", {}],
  unsettled: ["lab.experimentBench.journey.enoughUnsettledShort", {}],
  untraced: ["lab.experimentBench.journey.enoughUntracedShort", {}],
  realPlayMoreSecs: ["lab.experimentBench.journey.realPlay.enoughMore", { secs: 90 }],
  realPlayMoreMin: ["lab.experimentBench.journey.realPlay.enoughMoreMin", { min: 10 }],
  realPlayCounts: ["lab.experimentBench.journey.realPlay.enoughCountsShort", {}],
};
const TOLERANCE_PX = 0.5;

function appCssImports() {
  return readFileSync(join(root, "src", "App.tsx"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^import\s+"(\.[^"]+\.css)"/)?.[1])
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ""));
}

/** Tauri IPC: the overlay's three sensor polls answer from window globals the frame sets. */
const tauriStub = {
  name: "tauri-stub",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "tauri-stub" }));
    build.onLoad({ filter: /.*/, namespace: "tauri-stub" }, () => ({
      loader: "js",
      contents: `
        export const invoke = (cmd) => {
          if (cmd === "get_fps_status") return Promise.resolve(window.__fps ?? null);
          if (cmd === "get_gpu_sensors") return Promise.resolve([{ vendor: "AMD", name: "RX 7900 XTX", temperature_c: 68, utilization_gpu_pct: 99 }]);
          if (cmd === "get_cpu_sensors") return Promise.resolve({ usage_overall_pct: 45, ram_used_bytes: 8e9, ram_total_bytes: 32e9 });
          return Promise.reject(new Error("layout fixture: no Tauri backend"));
        };
        export const core = { invoke };
        export const listen = () => Promise.resolve(() => {});
        export const emit = () => Promise.resolve();
        export const getCurrentWindow = () => ({ label: "overlay", listen, emit });
        export default { invoke };
      `,
    }));
  },
};

const HTML = `<!doctype html>
<html lang="en" class="overlay-mode" data-living="on" data-itheme="violet">
  <head>
    <meta charset="utf-8" />
    <title>overlay enough layout fixture</title>
    <link rel="stylesheet" href="./page.css" />
    <style>
      html:not(.overlay-mode), body.outer { margin: 0; padding: 0; }
      iframe { display: block; border: 0; width: ${W}px; height: ${H}px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./page.js"></script>
  </body>
</html>`;

/** Without ?frame it is the outer page holding one overlay-sized iframe; with it, the overlay window. */
const ENTRY = `
import "${src}/i18n/index.ts";
${appCssImports().map((p) => `import "${src}/${p}";`).join("\n")}
import { createRoot } from "react-dom/client";
import i18n from "${src}/i18n/index.ts";
import Overlay from "${src}/Overlay.tsx";
import { JOURNEY_RECORDING_KEY } from "${src}/surfaces/journey-enough.ts";

const STATES = ${JSON.stringify(STATES)};
const EXPECTED_KEY = ${JSON.stringify(EXPECTED_KEY)};
const isFrame = new URLSearchParams(location.search).has("frame");

const progress = ([, samples, first, second, traced]) => {
  const n = Math.ceil(samples / 10);
  return { samples, fps_series: traced ? Array.from({ length: n }, (_, i) => [i * 10, i < n / 2 ? first : second]) : [] };
};
const fpsFor = (st) => ({
  active: true,
  status: "running",
  game_running: true,
  sample: {
    process_name: "Valorant",
    fps: 244,
    avg_frametime_ms: 4.1,
    low1_fps: 181,
    recent_frametimes_ms: Array.from({ length: 120 }, (_, i) => 4 + (i % 7) * 0.3),
  },
  progress: progress(st),
});

const settle = async () => {
  await document.fonts.ready;
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
const waitFor = async (cond, what) => {
  const until = Date.now() + 2000; // four of the overlay's 500 ms polls
  while (!cond()) {
    if (Date.now() > until) throw new Error("timed out waiting for " + what);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const glyphRects = (el) => {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode())
    for (let i = 0; i < n.data.length; i++) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      for (const b of r.getClientRects()) if (b.width > 0.5) out.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom });
    }
  return out;
};

window.__measure = async (lang, densities, backdrops) => {
  document.documentElement.lang = lang;
  await i18n.changeLanguage(lang);
  const out = [];
  for (const density of densities)
    for (const backdrop of backdrops) {
      localStorage.setItem("compy_overlay_density", density);
      localStorage.setItem("compy_overlay_backdrop", backdrop);
      window.dispatchEvent(new StorageEvent("storage"));
      for (const st of STATES) {
        const [key, opts] = EXPECTED_KEY[st[0]];
        const expected = i18n.t(key, opts);
        // The main window's flag says which kind of session records; the overlay reads it on "storage".
        localStorage.setItem(JOURNEY_RECORDING_KEY, st[5] === "real-play" ? "real-play" : "1");
        window.dispatchEvent(new StorageEvent("storage"));
        window.__fps = fpsFor(st);
        await waitFor(() => document.querySelector('[data-testid="overlay-enough"]')?.textContent === expected
          && document.querySelector(".ovl2-" + density), st[0] + " " + density + " (saw: " + document.querySelector('[data-testid="overlay-enough"]')?.textContent + ")").catch((e) => {
          out.push({ lang, density, backdrop, state: st[0], expected, error: String(e) });
          return "failed";
        }).then(async (r) => {
          if (r === "failed") return;
          await settle();
          const note = document.querySelector('[data-testid="overlay-enough"]');
          const pill = document.querySelector(".ovl2").getBoundingClientRect();
          out.push({
            lang, density, backdrop, state: st[0], expected,
            text: note.textContent,
            pill: { left: pill.left, right: pill.right, top: pill.top, bottom: pill.bottom },
            glyphs: glyphRects(note),
            noteOverflow: note.scrollWidth - note.clientWidth,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
          });
        });
      }
    }
  return out;
};

if (isFrame) {
  localStorage.setItem(JOURNEY_RECORDING_KEY, "1");
  createRoot(document.getElementById("root")).render(<Overlay />);
  const tick = () => (document.querySelector(".ovl2") ? (window.__frameReady = true) : requestAnimationFrame(tick));
  tick();
} else {
  document.documentElement.classList.remove("overlay-mode");
  document.body.className = "outer";
  const f = document.createElement("iframe");
  f.src = "./index.html?frame=1";
  document.body.appendChild(f);
  const wait = () => (f.contentWindow?.__frameReady === true ? (window.__compyLayoutReady = true) : setTimeout(wait, 50));
  wait();
}
`;

const where = (s) => `${s.lang} ${s.density} backdrop=${s.backdrop} ${s.state}`;

describe("the journey's enough line fits the in-game overlay window (P5-enough-f1)", () => {
  /** @type {Awaited<ReturnType<typeof openBundledPage>> | null} */
  let page = null;
  let all = [];

  beforeAll(async () => {
    page = await openBundledPage({
      entry: ENTRY,
      resolveDir: here,
      html: HTML,
      plugins: [tauriStub],
      readyExpr: "window.__compyLayoutReady === true",
    });
    // One evaluate per combination: the overlay polls every 500 ms, so a whole sweep in one call
    // would outlast the harness's 30 s per-command bound.
    for (const lang of LOCALES)
      for (const d of DENSITIES)
        for (const b of BACKDROPS)
          all.push(
            ...(await page.evaluate(
              `document.querySelector("iframe").contentWindow.__measure(${JSON.stringify(lang)}, ${JSON.stringify([d])}, ${JSON.stringify([b])})`,
            )),
          );
  }, 180_000);

  afterAll(async () => {
    await page?.close();
  }, 30_000);

  it("rendered every state, density, backdrop and locale in an overlay-sized window", () => {
    expect(page.errors).toEqual([]);
    expect(win.width).toBe(230);
    expect(win.height).toBe(150);
    expect(all).toHaveLength(LOCALES.length * DENSITIES.length * BACKDROPS.length * STATES.length);
    for (const s of all) {
      expect(s.error, where(s)).toBeUndefined();
      expect(s.text, where(s)).toBe(s.expected);
      expect(s.innerWidth).toBe(W);
      expect(s.innerHeight).toBe(H);
    }
  });

  it("keeps the pill and every glyph of the line inside the window, never scrolling sideways", () => {
    const violations = [];
    for (const s of all) {
      if (s.error) continue;
      const p = s.pill;
      if (p.left < -TOLERANCE_PX || p.top < -TOLERANCE_PX || p.right > W + TOLERANCE_PX || p.bottom > H + TOLERANCE_PX)
        violations.push(`${where(s)}: pill ${p.left.toFixed(1)},${p.top.toFixed(1)}-${p.right.toFixed(1)},${p.bottom.toFixed(1)} outside ${W}x${H}`);
      if (s.noteOverflow > 0) violations.push(`${where(s)}: line scrolls ${s.noteOverflow}px`);
      expect(s.glyphs.length, where(s)).toBeGreaterThan(0);
      for (const g of s.glyphs)
        if (g.right > W + TOLERANCE_PX || g.bottom > H + TOLERANCE_PX) {
          violations.push(`${where(s)}: glyph at ${g.right.toFixed(1)},${g.bottom.toFixed(1)} outside ${W}x${H}`);
          break;
        }
    }
    expect(violations).toEqual([]);
  });
});
