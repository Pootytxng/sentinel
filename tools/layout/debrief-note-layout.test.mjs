// @vitest-environment node
// Chromium layout regression for #608: the Session Debrief tile note (" · no reading", " · estimate")
// must read as one unit next to its label. At the 380px window floor the note broke across lines —
// "Avg FPS · no" / "reading" in English, 暂无 / 读数 split mid-word in Chinese — once #608 put the
// longer "no reading" note on unknown tiles. jsdom has no layout engine, so the jsdom suite
// (src/surfaces/session-debrief-unknown-metrics.test.tsx) pins what the tile SAYS; this pins where
// the engine puts it.
//
// The REAL SessionDebrief renders under App.tsx's stylesheet chain inside its real Live-room wrapper
// (.play-debrief-wrap), in iframes whose viewports are the window floor (380px, so the
// `max-width: 560px` two-column rule applies as it does in the app) and the owner's wide window
// (1484px). Three states, each in English and Chinese: unknown average, unknown 1% low, and a
// measured 1% low (" · estimate"). Read back over CDP from text Ranges, not from element boxes —
// an element box is the union of its wrapped lines and cannot tell a split from a stack:
//   1. the note's visible text ("·" through its last glyph) sits on ONE line box;
//   2. when the "·" shares a line with the label's last glyph, a visible gap separates them;
//   3. every note glyph stays inside its tile's content box, and no tile or label scrolls sideways;
//   4. on the wide window at its real content widths, label and note share one line (the measured
//      " · estimate" reading is not pushed onto a second line).
//
// Tauri IPC rejects (no backend); the apply/rollback/export props are inert. The page records every
// invoke it attempts, and the test proves rendering asked only for the two lookups the debrief makes
// on mount — never an arm, apply, dismiss or rollback.
//
// RED on `.debrief-tile-note { color: var(--faint); }`: 17 notes split across two lines (380px window
// at 340/320/300px in both locales, 1484px window at 600px). `display: inline-block` alone fails
// invariant 2 (the space before the dot collapses to a 0px gap). GREEN with `white-space: nowrap`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openBundledPage, root } from "./chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = root.replace(/\\/g, "/") + "/src";

/**
 * Viewports and the debrief's container widths inside them. At the 380px floor the shell's page
 * padding and the room wrappers leave the debrief about 330–345px; the sweep runs from the whole
 * viewport down past that. On the 1484px window the debrief gets about 1200px; the sweep also
 * covers the narrower wide-window widths where four tiles share a row.
 */
const FRAMES = [
  { vw: 380, widths: [380, 360, 340, 320, 300] },
  { vw: 1484, widths: [1200, 960, 720, 600] },
];
/** Wide-window widths at which label and note must share one line (invariant 4). */
const ONE_LINE_WIDTHS = [1200, 960];
const LOCALES = ["en", "zh-CN"];
/** The only commands the debrief invokes on mount: its comparison lookup and the What-changed panel's. */
const MOUNT_LOOKUPS = ["get_latest_comparison", "what_changed_for_session"];
const STATES = ["unknownAvg", "unknownLow", "measured"];
const TOLERANCE_PX = 0.5;
/** A collapsed-away space measures ~0px; a real one at the 13px label size measures 3px or more. */
const MIN_GAP_PX = 2;

/** App.tsx's CSS imports in file order, so the page runs the cascade the Live room really runs under. */
function appCssImports() {
  return readFileSync(join(root, "src", "App.tsx"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^import\s+"(\.[^"]+\.css)"/)?.[1])
    .filter(Boolean)
    .map((p) => p.replace(/^\.\//, ""));
}

/** Every `@tauri-apps/*` import resolves here: IPC rejects, and each attempt is recorded by name. */
const tauriStub = {
  name: "tauri-stub",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "tauri-stub" }));
    build.onLoad({ filter: /.*/, namespace: "tauri-stub" }, () => ({
      loader: "js",
      contents: `
        export const invoke = (cmd) => {
          (window.__invokeCalls ??= []).push(cmd);
          return Promise.reject(new Error("layout fixture: no Tauri backend"));
        };
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

/** The root attributes src/main.tsx sets on the main window by default, written statically. */
const HTML = `<!doctype html>
<html lang="en" data-custom-chrome="1" data-v2="on" data-dash-v2="on" data-living="on" data-hud="on" data-room-identity="on" data-itheme="violet">
  <head>
    <meta charset="utf-8" />
    <title>debrief note layout fixture</title>
    <link rel="stylesheet" href="./page.css" />
    <style>
      html, body { margin: 0; padding: 0; height: auto; }
      iframe { display: block; border: 0; height: 2400px; }
    </style>
  </head>
  <body>
    <div id="frames"></div>
    <script type="module" src="./page.js"></script>
  </body>
</html>`;

/**
 * One bundle, two roles. Without `?vw=` it is the outer page: it opens one iframe per viewport and
 * reports ready once each has mounted. With `?vw=` it is a frame: it mounts one debrief per state,
 * each in its own host inside the Live room's wrapper, and exposes `__measure` for the test.
 */
const ENTRY = `
import "${src}/i18n/index.ts";
${appCssImports().map((p) => `import "${src}/${p}";`).join("\n")}
import "${src}/surfaces/Play.css";
import { createRoot } from "react-dom/client";
import i18n from "${src}/i18n/index.ts";
import { SessionDebrief } from "${src}/surfaces/SessionDebrief.tsx";
import { ConfirmProvider } from "${src}/design/ConfirmDialog.tsx";

const FRAMES = ${JSON.stringify(FRAMES.map((f) => f.vw))};
const STATES = ${JSON.stringify(STATES)};
const vw = new URLSearchParams(location.search).get("vw");

const base = {
  started_at: "2026-10-16T20:00:00Z",
  duration_secs: 3600,
  process_name: "eldenring.exe",
  samples: 900,
  avg_fps: 160,
  avg_frametime_ms: 6.25,
  low1_fps_est: 140,
  peak_gpu_temp_c: 68,
  peak_gpu_usage_pct: 50,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
  stutter_insight: null,
};
// 0 is the sampler's "unknown"; #608 renders it as an absent reading with a "no reading" note.
const SESSIONS = {
  unknownAvg: { ...base, avg_fps: 0 },
  unknownLow: { ...base, low1_fps_est: 0 },
  measured: base,
};
const inert = () => Promise.resolve();

function mountFrame() {
  const page = document.getElementById("frames");
  for (const state of STATES) {
    const host = document.createElement("div");
    host.className = "debrief-host";
    host.dataset.state = state;
    page.appendChild(host);
    createRoot(host).render(
      <ConfirmProvider>
        <div className="play-debrief-wrap">
          <SessionDebrief
            s={SESSIONS[state]}
            priorities={null}
            recs={[]}
            apply={inert}
            busyId={null}
            onExport={() => {}}
            changes={[]}
            rollback={inert}
          />
        </div>
      </ConfirmProvider>,
    );
  }
  const tick = () =>
    document.querySelectorAll(".debrief-tile").length === STATES.length * 4
      ? (window.__frameReady = true)
      : requestAnimationFrame(tick);
  tick();
}

const settle = async () => {
  await document.fonts.ready;
  document.getAnimations().forEach((a) => { try { a.finish(); } catch {} });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

/** Text nodes under el in document order, minus any inside skip. */
const textNodes = (el, skip) => {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (!skip || !skip.contains(n)) out.push(n);
  return out;
};
const rectsOf = (range) => [...range.getClientRects()].filter((r) => r.width > 0.5);
const glyph = (node, i) => {
  const r = document.createRange();
  r.setStart(node, i);
  r.setEnd(node, i + 1);
  const rs = rectsOf(r);
  return rs[rs.length - 1] ?? null;
};
const box = (r) => r && { left: r.left, right: r.right, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 };
/** Distinct line boxes among rects, by vertical centre. */
const lineCount = (rects) => {
  const mids = [];
  for (const r of rects) {
    const m = (r.top + r.bottom) / 2;
    if (!mids.some((x) => Math.abs(x - m) < 3)) mids.push(m);
  }
  return mids.length;
};

function readTile(tile) {
  const label = tile.querySelector(".debrief-tile-label");
  const note = label.querySelector(".debrief-tile-note");
  const cs = getComputedStyle(tile);
  const t = tile.getBoundingClientRect();
  const content = {
    left: t.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
    right: t.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
  };
  const out = {
    label: label.textContent,
    value: tile.querySelector(".debrief-tile-value")?.textContent ?? "",
    note: note ? note.textContent : null,
    content,
    tileOverflow: tile.scrollWidth - tile.clientWidth,
    labelOverflow: label.scrollWidth - label.clientWidth,
  };
  if (!note) return out;
  // The label's last RENDERED glyph outside the note (a closed glossary tooltip has text but no box).
  let last = null;
  for (const n of textNodes(label, note).reverse()) {
    const i = n.data.search(/\\S\\s*$/);
    last = i < 0 ? null : box(glyph(n, i));
    if (last) break;
  }
  // The note's visible text: its first non-space character (the "·") through its last glyph.
  const parts = textNodes(note).filter((n) => n.data.length);
  const first = parts.find((n) => n.data.trim());
  const fi = first.data.search(/\\S/);
  const end = parts[parts.length - 1];
  const range = document.createRange();
  range.setStart(first, fi);
  range.setEnd(end, end.data.replace(/\\s+$/, "").length);
  const rects = rectsOf(range).map(box);
  const dot = box(glyph(first, fi));
  const sameLine = Boolean(last && dot && Math.abs(last.mid - dot.mid) < 4);
  return {
    ...out,
    dotChar: first.data[fi],
    last,
    dot,
    rects,
    noteLines: lineCount(rects),
    sameLine,
    gap: sameLine ? dot.left - last.right : null,
  };
}

window.__measure = async (lang, widths) => {
  document.documentElement.lang = lang;
  await i18n.changeLanguage(lang);
  const out = [];
  for (const w of widths) {
    for (const h of document.querySelectorAll(".debrief-host")) h.style.width = w + "px";
    await settle();
    for (const h of document.querySelectorAll(".debrief-host")) {
      out.push({
        vw: Number(vw),
        innerWidth: window.innerWidth,
        twoColumns: matchMedia("(max-width: 560px)").matches,
        lang,
        width: w,
        hostWidth: h.getBoundingClientRect().width,
        state: h.dataset.state,
        tiles: [...h.querySelectorAll(".debrief-tile")].map(readTile),
      });
    }
  }
  return {
    out,
    words: {
      noReading: i18n.t("common.arcGauge.noReading"),
      estimate: i18n.t("monitor.sessionDebrief.estimateNote"),
    },
    invokeCalls: window.__invokeCalls ?? [],
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
  const wait = () =>
    frames.every((f) => f.contentWindow?.__frameReady === true)
      ? (window.__compyLayoutReady = true)
      : setTimeout(wait, 50);
  wait();
}
`;

/** Runs in the outer page: every frame, every locale, every width. */
function measureScript() {
  return `(async (frames, locales) => {
    const all = [];
    const words = {};
    const invokeCalls = [];
    for (const { vw, widths } of frames) {
      const win = document.querySelector('iframe[data-vw="' + vw + '"]').contentWindow;
      for (const lang of locales) {
        const r = await win.__measure(lang, widths);
        all.push(...r.out);
        words[lang] = r.words;
        invokeCalls.push(...r.invokeCalls);
      }
    }
    return { all, words, invokeCalls };
  })(${JSON.stringify(FRAMES)}, ${JSON.stringify(LOCALES)})`;
}

const where = (s, tile) => `${s.lang} vw=${s.vw} debrief=${s.width}px ${s.state} "${tile.label}"`;
const noted = (steps) => steps.flatMap((s) => s.tiles.filter((t) => t.note !== null).map((t) => [s, t]));

describe("Session Debrief tile note in a real Chromium (#608)", () => {
  /** @type {Awaited<ReturnType<typeof openBundledPage>> | null} */
  let page = null;
  /** @type {{ all: any[], words: Record<string, { noReading: string, estimate: string }>, invokeCalls: string[] }} */
  let result = { all: [], words: {}, invokeCalls: [] };

  beforeAll(async () => {
    page = await openBundledPage({
      entry: ENTRY,
      resolveDir: here,
      html: HTML,
      plugins: [tauriStub],
      readyExpr: "window.__compyLayoutReady === true",
    });
    result = await page.evaluate(measureScript());
  }, 120_000);

  // close() is bounded but can outlast the default hook timeout (see hc-specs-grid-layout.test.mjs).
  afterAll(async () => {
    await page?.close();
  }, 30_000);

  it("rendered every state, locale and width through the real component, IPC attempting only its mount lookups", () => {
    expect(page.errors).toEqual([]);
    const perFrame = FRAMES.reduce((n, f) => n + f.widths.length, 0);
    expect(result.all).toHaveLength(perFrame * LOCALES.length * STATES.length);
    for (const s of result.all) {
      expect(s.tiles, `${s.lang} ${s.vw} ${s.state}`).toHaveLength(4);
      expect(Math.abs(s.hostWidth - s.width)).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(s.innerWidth).toBe(s.vw);
      expect(s.twoColumns).toBe(s.vw <= 560);
    }
    expect([...new Set(result.invokeCalls)].sort()).toEqual([...MOUNT_LOOKUPS].sort());
  });

  it("puts the expected note on the expected tile in each state", () => {
    for (const s of result.all) {
      const { noReading, estimate } = result.words[s.lang];
      const [avg, low] = s.tiles;
      const notes = s.tiles.map((t) => t.note);
      if (s.state === "unknownAvg") expect(notes.slice(0, 2), where(s, avg)).toEqual([` · ${noReading}`, ` · ${estimate}`]);
      if (s.state === "unknownLow") expect(notes.slice(0, 2), where(s, low)).toEqual([null, ` · ${noReading}`]);
      if (s.state === "measured") expect(notes.slice(0, 2), where(s, low)).toEqual([null, ` · ${estimate}`]);
      expect(notes.slice(2)).toEqual([null, null]);
    }
    // The Chinese run really ran in Chinese.
    expect(result.words["zh-CN"].noReading).not.toBe(result.words.en.noReading);
  });

  it("keeps every note on one line box — never split from its own words", () => {
    const violations = [];
    for (const [s, t] of noted(result.all)) {
      expect(t.dotChar).toBe("·");
      if (t.noteLines !== 1) {
        violations.push(`${where(s, t)}: note spans ${t.noteLines} lines (${t.rects.map((r) => `${r.left.toFixed(1)}–${r.right.toFixed(1)}@${r.mid.toFixed(1)}`).join(", ")})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps a visible gap between the label and the dot when they share a line", () => {
    const violations = [];
    for (const [s, t] of noted(result.all)) {
      if (t.sameLine && t.gap < MIN_GAP_PX) violations.push(`${where(s, t)}: label-to-dot gap ${t.gap.toFixed(2)}px`);
    }
    expect(violations).toEqual([]);
    // Both branches were exercised: notes beside their label and notes on a line of their own.
    const shared = noted(result.all).filter(([, t]) => t.sameLine);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("keeps every note glyph inside its tile, and no tile or label scrolls sideways", () => {
    const violations = [];
    for (const s of result.all) {
      for (const t of s.tiles) {
        if (t.tileOverflow > 0) violations.push(`${where(s, t)}: tile scrolls ${t.tileOverflow}px`);
        if (t.labelOverflow > 0) violations.push(`${where(s, t)}: label scrolls ${t.labelOverflow}px`);
        for (const r of t.rects ?? []) {
          if (r.left < t.content.left - TOLERANCE_PX || r.right > t.content.right + TOLERANCE_PX) {
            violations.push(`${where(s, t)}: note ${r.left.toFixed(1)}–${r.right.toFixed(1)} outside ${t.content.left.toFixed(1)}–${t.content.right.toFixed(1)}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps label and note on one line on the wide window", () => {
    const violations = [];
    for (const [s, t] of noted(result.all.filter((x) => x.vw > 560 && ONE_LINE_WIDTHS.includes(x.width)))) {
      if (!t.sameLine) violations.push(`${where(s, t)}: note moved off the label's line`);
    }
    expect(violations).toEqual([]);
  });
});
