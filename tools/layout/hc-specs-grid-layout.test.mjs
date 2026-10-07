// @vitest-environment node
// Chromium layout regression for #614 / PR #624 (asked for by the non-author Codex round-10 review,
// tracked as #646): render the REAL HomeConsole in the locally installed headless Chromium and
// measure the Detected tile's `.hc-specs-grid` at narrow widths. jsdom has no layout engine, so the
// jsdom guard (src/surfaces/hc-specs-grid-overflow-guard.test.ts) can only pin the CSS text; this
// test pins what the engine does with it.
//
// Two invariants, both read back over CDP from `getBoundingClientRect` / `scrollWidth`:
//   1. no `.hc-spec` card's border box leaves its grid track (±0.5px for subpixel rounding);
//   2. the grid never scrolls horizontally (`scrollWidth <= clientWidth`) and never pokes out of its tile.
//
// RED on origin/main's `repeat(auto-fit, minmax(230px, 1fr))` (the grid's scrollWidth pins at 294px
// while the tile shrinks below it); GREEN with PR #624's `minmax(min(230px, 100%), 1fr)`. Both runs
// are recorded on #646. Width sweep: the host (the app's width) from 320px to 1600px, then the
// `.hc-specs` section clamped from 150px to 720px so the 360–720px container range the review named
// is hit exactly, including the 230px minimum on both sides.
//
// $0 and local: esbuild (already a dependency) bundles the page, `node:http` serves it, the machine's
// own Chrome/Edge renders it. No Playwright, no download, no new dependency. No Chromium on the
// machine = the proof is BLOCKED and the test FAILS naming the paths it tried; it never passes vacuously.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBundledPage, root } from "./chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** The host widths swept (the app's full width). Tile ≈ 0.58 × host under the hero bento layout. */
const HOST_WIDTHS = [320, 360, 400, 440, 480, 520, 560, 600, 640, 720, 800, 960, 1120, 1280, 1600];
/** The `.hc-specs` section widths swept with the host held at 1600px, so the grid is exactly this wide. */
const SECTION_WIDTHS = [150, 160, 180, 191, 200, 215, 229, 230, 231, 250, 300, 360, 420, 459, 460, 480, 540, 600, 660, 720];
/** The grid's declared minimum track width; below it a fixed `minmax(230px, 1fr)` overflows. */
const MIN_TRACK_PX = 230;
const TOLERANCE_PX = 0.5;

/** App.tsx's CSS imports in file order, so the page runs the cascade the Health tab really runs under. */
function appCssImports() {
  return readFileSync(join(root, "src", "App.tsx"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^import\s+"(\.[^"]+\.css)"/)?.[1])
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ""));
}

/** Tauri IPC is not present in a browser page; every `@tauri-apps/*` import resolves to an inert stub. */
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

/** The three.js rig hologram needs WebGL; it sits in a different tile and has no bearing on the spec grid. */
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

/**
 * Runs in the page. For each width: set it, finish any running animation, wait two frames, then read
 * the grid's used track sizes (from `grid-template-columns`), the track edges (grid content-left plus
 * gaps), and each card's border box with the track it starts in.
 */
function measureScript(hostWidths, sectionWidths) {
  return `(async (hostWidths, sectionWidths) => {
    await document.fonts.ready;
    const host = document.getElementById("host");
    const section = document.querySelector(".hc-specs");
    const grid = document.querySelector(".hc-specs-grid");
    const settle = async () => {
      document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    };
    const read = (label, w) => {
      const cs = getComputedStyle(grid);
      const tracks = cs.gridTemplateColumns.split(" ").map(parseFloat);
      const gap = parseFloat(cs.columnGap) || 0;
      const g = grid.getBoundingClientRect();
      const contentLeft = g.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
      const edges = [];
      let x = contentLeft;
      for (const t of tracks) { edges.push([x, x + t]); x += t + gap; }
      const tile = grid.parentElement.getBoundingClientRect();
      const cards = [...grid.querySelectorAll(":scope > .hc-spec")].map((card) => {
        const r = card.getBoundingClientRect();
        let track = 0, best = Infinity;
        edges.forEach(([l], i) => { const d = Math.abs(l - r.left); if (d < best) { best = d; track = i; } });
        return {
          title: card.querySelector(".hc-spec-title")?.textContent ?? "",
          left: r.left, right: r.right, width: r.width,
          track, trackLeft: edges[track][0], trackRight: edges[track][1],
        };
      });
      return {
        label, w,
        hostWidth: host.getBoundingClientRect().width,
        tileRight: tile.right, tileWidth: tile.width,
        gridLeft: g.left, gridRight: g.right, gridWidth: g.width,
        clientWidth: grid.clientWidth, scrollWidth: grid.scrollWidth,
        tracks, gap, cards,
      };
    };
    const out = [];
    for (const w of hostWidths) { host.style.width = w + "px"; await settle(); out.push(read("host", w)); }
    host.style.width = "1600px";
    for (const w of sectionWidths) { section.style.maxWidth = w + "px"; await settle(); out.push(read("section", w)); }
    section.style.maxWidth = "";
    await settle();
    return out;
  })(${JSON.stringify(hostWidths)}, ${JSON.stringify(sectionWidths)})`;
}

const stepName = (s) => `${s.label}=${s.w}px (grid ${s.gridWidth.toFixed(1)}px, tracks [${s.tracks.map((t) => t.toFixed(1)).join(", ")}])`;

describe("hc-specs grid in a real Chromium (#646)", () => {
  /** @type {Awaited<ReturnType<typeof openBundledPage>> | null} */
  let page = null;
  /** @type {any[]} */
  let steps = [];

  beforeAll(async () => {
    const entry = [
      `import "${root.replace(/\\/g, "/")}/src/i18n/index.ts";`,
      `import { mount } from "./hc-specs-fixture.tsx";`,
      ...appCssImports().map((p) => `import "${root.replace(/\\/g, "/")}/src/${p}";`),
      `mount(document.getElementById("host")).then(() => { window.__compyLayoutReady = true; });`,
    ].join("\n");
    page = await openBundledPage({
      entry,
      resolveDir: here,
      html: readFileSync(join(here, "hc-specs-fixture.html"), "utf8"),
      plugins: [tauriStub, rigStub],
      readyExpr: "window.__compyLayoutReady === true",
    });
    steps = await page.evaluate(measureScript(HOST_WIDTHS, SECTION_WIDTHS));
  }, 90_000);

  afterAll(async () => {
    await page?.close();
  });

  it("rendered the real component without a page error and with every spec card", () => {
    expect(page.errors).toEqual([]);
    expect(steps).toHaveLength(HOST_WIDTHS.length + SECTION_WIDTHS.length);
    for (const s of steps) expect(s.cards.length, stepName(s)).toBe(4);
  });

  it("sweeps widths that can actually fail: grids narrower than the 230px track minimum and multi-track grids", () => {
    // Without these the two invariants could pass on a sweep that never left the comfortable range.
    const narrowest = Math.min(...steps.map((s) => s.gridWidth));
    const mostTracks = Math.max(...steps.map((s) => s.tracks.length));
    expect(narrowest).toBeLessThan(MIN_TRACK_PX);
    expect(mostTracks).toBeGreaterThanOrEqual(2);
    // The review's container range, hit exactly by the section sweep.
    for (const w of [360, 420, 480, 540, 600, 660, 720]) {
      const s = steps.find((x) => x.label === "section" && x.w === w);
      expect(s, `section=${w}`).toBeDefined();
      expect(Math.abs(s.gridWidth - w), `section=${w} grid width ${s.gridWidth}`).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  it("keeps every .hc-spec card's border box inside its grid track", () => {
    const violations = [];
    for (const s of steps) {
      for (const c of s.cards) {
        if (c.left < c.trackLeft - TOLERANCE_PX || c.right > c.trackRight + TOLERANCE_PX) {
          violations.push(`${stepName(s)}: "${c.title}" ${c.left.toFixed(1)}–${c.right.toFixed(1)} outside track ${c.trackLeft.toFixed(1)}–${c.trackRight.toFixed(1)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never scrolls the grid horizontally and never lets it poke out of the tile", () => {
    const violations = [];
    for (const s of steps) {
      if (s.scrollWidth > s.clientWidth) {
        violations.push(`${stepName(s)}: scrollWidth ${s.scrollWidth} > clientWidth ${s.clientWidth}`);
      }
      if (s.gridRight > s.tileRight + TOLERANCE_PX) {
        violations.push(`${stepName(s)}: grid right ${s.gridRight.toFixed(1)} > tile right ${s.tileRight.toFixed(1)}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
