// @vitest-environment node
// Chromium layout regression for #622: Health must compose at every window width down to the 380px
// minWidth (src-tauri/tauri.conf.json). On main at 01b27929 the rail stayed full width at every size
// and the bento never stacked, so at 504 and 380 each tile's content box was squeezed to double digits
// (Detected 86 / 62px, Findings 62px at 380), tile titles ran past their tiles and `.v2-content`
// scrolled sideways. jsdom has no layout engine; this measures what the engine does.
//
// The REAL ShellV2 + HomeConsole render under App.tsx's stylesheet chain inside `main.app.app-v2`, in
// iframes whose viewports are the issue's widths (380 / 504 / 684) and the wide windows whose look must
// not change (1280 / 1500 / 1920). Read back over CDP:
//   1. below 600px the rail is an icon-only strip (≤ 72px) that still names every room; at 600px and
//      up it keeps the full 216px rail with visible labels;
//   2. below 600px the bento stacks: every tile spans the grid's full width; on the wide windows the
//      Detected hero and the Findings tile still sit side by side;
//   3. no tile's content box is narrower than MIN_TILE_CONTENT_PX, no tile scrolls sideways, and no
//      descendant of a tile (title, button) paints past the tile's content edge;
//   4. `.v2-content` never scrolls horizontally.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBundledPage, root } from "./chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = root.replace(/\\/g, "/") + "/src";

const NARROW = [380, 504];
const WIDE = [684, 1280, 1500, 1920];
const FRAMES = [...NARROW, ...WIDE];
const RAIL_PX = 216;
const NARROW_RAIL_MAX_PX = 72;
/** No tile content box may fall to double digits (the issue measured 30–92px on main below 600). */
const MIN_TILE_CONTENT_PX = 100;
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
        export const openUrl = () => Promise.resolve();
        export const relaunch = () => Promise.resolve();
        export const check = () => Promise.resolve(null);
        export const listen = () => Promise.resolve(() => {});
        export const emit = () => Promise.resolve();
        export const getCurrentWindow = () => ({ label: "main", listen, emit, setFocus: () => Promise.resolve(), show: () => Promise.resolve() });
        export default { invoke };
      `,
    }));
  },
};

/** The rig hologram needs WebGL; it sits in the verdict panel, not in the bento. */
const rigStub = {
  name: "rig-hologram-stub",
  setup(build) {
    build.onResolve({ filter: /rig\/RigHologram$/ }, () => ({ path: "rig-stub", namespace: "rig-stub" }));
    build.onLoad({ filter: /.*/, namespace: "rig-stub" }, () => ({
      loader: "js",
      contents: "export const RigHologram = () => null; export default RigHologram;",
    }));
  },
};

const HTML = `<!doctype html>
<html lang="en" data-custom-chrome="1" data-v2="on" data-dash-v2="on" data-living="on" data-hud="on" data-room-identity="on" data-itheme="violet">
  <head>
    <meta charset="utf-8" />
    <title>health narrow layout fixture</title>
    <link rel="stylesheet" href="./page.css" />
    <style>
      html, body { margin: 0; padding: 0; }
      iframe { display: block; border: 0; height: 720px; }
    </style>
  </head>
  <body>
    <div id="frames"></div>
    <script type="module" src="./page.js"></script>
  </body>
</html>`;

const ENTRY = `
import "${src}/i18n/index.ts";
${appCssImports().map((p) => `import "${src}/${p}";`).join("\n")}
import { createRoot } from "react-dom/client";
import { ShellV2 } from "${src}/design/ShellV2.tsx";
import { railFor } from "${src}/design/homeRail.ts";
import { HomeConsole } from "${src}/surfaces/HomeConsole.tsx";
import { hw } from "./hc-specs-fixture.tsx";

const FRAMES = ${JSON.stringify(FRAMES)};
const vw = new URLSearchParams(location.search).get("vw");

function mountFrame() {
  const host = document.getElementById("frames");
  createRoot(host).render(
    <main className="app app-v2">
      <ShellV2 items={railFor(true, true)} activeId="home" onNavigate={() => {}} ledgerCount={3} rig={null}>
        <HomeConsole hw={hw} readiness={null} priorities={null} sessions={[]} changes={[]} onRunCheck={() => {}} onSeeInFix={() => {}} />
      </ShellV2>
    </main>,
  );
  const tick = () => (document.querySelector(".v2-bento .hc-specs-grid") ? (window.__frameReady = true) : requestAnimationFrame(tick));
  tick();
}

const contentBox = (el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    left: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    right: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
  };
};

window.__measure = async () => {
  await document.fonts.ready;
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rail = document.querySelector(".v2-rail");
  const content = document.querySelector(".v2-content");
  const bento = document.querySelector(".v2-content .v2-bento");
  const bentoBox = bento.getBoundingClientRect();
  const tiles = [...bento.querySelectorAll(":scope > .v2-tile")].map((tile) => {
    const r = tile.getBoundingClientRect();
    const cb = contentBox(tile);
    const spill = [];
    for (const el of tile.querySelectorAll("*")) {
      const er = el.getBoundingClientRect();
      if (er.width === 0 || er.height === 0) continue;
      if (getComputedStyle(el).position === "absolute" && el.classList.contains("v2-tile-open")) continue;
      if (er.right > cb.right + 0.5 || er.left < cb.left - 0.5) spill.push(el.className + " " + er.left.toFixed(1) + "–" + er.right.toFixed(1));
    }
    return {
      title: tile.querySelector(".v2-tile-title")?.textContent ?? "",
      left: r.left, top: r.top, width: r.width,
      contentWidth: cb.right - cb.left,
      overflow: tile.scrollWidth - tile.clientWidth,
      spill,
    };
  });
  const items = [...rail.querySelectorAll(".v2-nav-item")].map((b) => {
    const label = b.querySelector("span");
    const lr = label.getBoundingClientRect();
    const svg = b.querySelector("svg").getBoundingClientRect();
    return { name: label.textContent, labelVisible: lr.width > 2 && lr.height > 2, iconWidth: svg.width, right: b.getBoundingClientRect().right };
  });
  const panel = document.querySelector(".hc-panel");
  return {
    vw: Number(vw),
    innerWidth: window.innerWidth,
    railWidth: rail.getBoundingClientRect().width,
    railRight: rail.getBoundingClientRect().right,
    items,
    contentClient: content.clientWidth,
    contentScroll: content.scrollWidth,
    bentoWidth: bentoBox.width,
    tiles,
    panel: panel && { client: panel.clientWidth, scroll: panel.scrollWidth },
    docScroll: document.documentElement.scrollWidth,
  };
};

if (vw) {
  mountFrame();
} else {
  const frames = FRAMES.map((w) => {
    const f = document.createElement("iframe");
    f.src = "./index.html?vw=" + w;
    f.style.width = w + "px";
    f.dataset.vw = String(w);
    document.getElementById("frames").appendChild(f);
    return f;
  });
  const wait = () => (frames.every((f) => f.contentWindow?.__frameReady === true) ? (window.__compyLayoutReady = true) : setTimeout(wait, 50));
  wait();
}
`;

const measureScript = `(async (frames) => {
  const out = [];
  for (const vw of frames) out.push(await document.querySelector('iframe[data-vw="' + vw + '"]').contentWindow.__measure());
  return out;
})(${JSON.stringify(FRAMES)})`;

describe("Health composes at every window width in a real Chromium (#622)", () => {
  /** @type {Awaited<ReturnType<typeof openBundledPage>> | null} */
  let page = null;
  /** @type {any[]} */
  let steps = [];
  const at = (vw) => steps.find((s) => s.vw === vw);

  beforeAll(async () => {
    page = await openBundledPage({
      entry: ENTRY,
      resolveDir: here,
      html: HTML,
      plugins: [tauriStub, rigStub],
      readyExpr: "window.__compyLayoutReady === true",
    });
    steps = await page.evaluate(measureScript);
    if (process.env.COMPY_LAYOUT_DUMP) console.log(JSON.stringify(steps, null, 1));
  }, 120_000);

  afterAll(async () => {
    await page?.close();
  }, 30_000);

  it("rendered the real shell and Health room at every width", () => {
    expect(page.errors).toEqual([]);
    expect(steps.map((s) => s.innerWidth)).toEqual(FRAMES);
    for (const s of steps) {
      expect(s.tiles.length, `vw=${s.vw}`).toBeGreaterThanOrEqual(4);
      expect(s.items.length, `vw=${s.vw}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("collapses the rail to an icon strip below 600px and keeps the full rail at 600px and up", () => {
    const violations = [];
    for (const s of steps) {
      const narrow = s.vw < 600;
      if (narrow && s.railWidth > NARROW_RAIL_MAX_PX) violations.push(`vw=${s.vw}: rail ${s.railWidth}px`);
      if (!narrow && Math.abs(s.railWidth - RAIL_PX) > TOLERANCE_PX) violations.push(`vw=${s.vw}: rail ${s.railWidth}px, want ${RAIL_PX}`);
      for (const it of s.items) {
        if (!it.name.trim()) violations.push(`vw=${s.vw}: a rail item lost its name`);
        if (it.iconWidth < 14) violations.push(`vw=${s.vw}: "${it.name}" icon ${it.iconWidth}px`);
        if (it.labelVisible === narrow) violations.push(`vw=${s.vw}: "${it.name}" label visible=${it.labelVisible}`);
        if (it.right > s.railRight + TOLERANCE_PX) violations.push(`vw=${s.vw}: "${it.name}" pokes out of the rail`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("stacks the bento below 600px and keeps the hero beside Findings on the wide windows", () => {
    const violations = [];
    for (const s of steps) {
      if (s.vw < 600) {
        for (const t of s.tiles) {
          if (Math.abs(t.width - s.bentoWidth) > 1) violations.push(`vw=${s.vw}: "${t.title}" ${t.width.toFixed(1)}px of ${s.bentoWidth.toFixed(1)}`);
        }
      } else {
        const [hero, findings] = s.tiles;
        if (Math.abs(hero.top - findings.top) > 1 || findings.left <= hero.left) violations.push(`vw=${s.vw}: hero and Findings no longer side by side`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("gives every tile a readable content box and lets nothing in a tile run past it", () => {
    const violations = [];
    for (const s of steps) {
      for (const t of s.tiles) {
        if (t.contentWidth < MIN_TILE_CONTENT_PX) violations.push(`vw=${s.vw}: "${t.title}" content ${t.contentWidth.toFixed(1)}px`);
        if (t.overflow > 0) violations.push(`vw=${s.vw}: "${t.title}" scrolls ${t.overflow}px`);
        for (const sp of t.spill) violations.push(`vw=${s.vw}: "${t.title}" spills ${sp}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("never scrolls the content column sideways", () => {
    const violations = [];
    for (const s of steps) {
      if (s.contentScroll > s.contentClient) violations.push(`vw=${s.vw}: .v2-content ${s.contentScroll} > ${s.contentClient}`);
      if (s.docScroll > s.vw) violations.push(`vw=${s.vw}: document ${s.docScroll} > ${s.vw}`);
    }
    expect(violations).toEqual([]);
  });
});
