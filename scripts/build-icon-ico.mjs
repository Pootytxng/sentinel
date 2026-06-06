// Dev tooling — builds src-tauri/icons/icon.ico with hand-tuned per-size layers (no runtime deps).
//
// The 16/24px layers use the simplified C-only mark (pulse + halo dropped, C bolded) so the icon
// stays crisp in the taskbar/titlebar instead of the auto-downscaled blur; larger layers keep the
// full pulse-c. Renders each layer with headless Chrome (already on the box — no npm rasterizer
// dependency) and assembles a PNG-in-ICO (Windows Vista+). Run from the repo root: `node
// scripts/build-icon-ico.mjs`. Override the browser with CHROME=<path> if needed.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ASSETS = "docs/superpowers/specs/assets";
const OUT = "src-tauri/icons/icon.ico";

// size → source SVG (halfway-home §3): the single-beat small cut for the tiny layers (the plain
// C-only mark is retired — "the plain C is so plain"), the full three-beat master for 32px+.
const LAYERS = [
  { size: 16, svg: "pulse-c-icon-small.svg" },
  { size: 24, svg: "pulse-c-icon-small.svg" },
  { size: 32, svg: "pulse-c-icon-master.svg" },
  { size: 48, svg: "pulse-c-icon-master.svg" },
  { size: 256, svg: "pulse-c-icon-master.svg" },
];

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at: ${CHROME}\nSet CHROME=<path to chrome.exe>.`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "compy-ico-"));

function renderPng(svgFile, size) {
  const svgAbs = join(process.cwd(), ASSETS, svgFile).replace(/\\/g, "/");
  // An <img> sized to the exact target keeps the rasterizer's downscale crisp; the rounded-tile
  // corners stay transparent via the transparent default background.
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style></head><body><img src="file:///${svgAbs}"></body></html>`;
  const htmlPath = join(tmp, `s${size}.html`);
  const pngPath = join(tmp, `s${size}.png`);
  writeFileSync(htmlPath, html);
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${pngPath}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ],
    { stdio: "ignore" },
  );
  return readFileSync(pngPath);
}

// PNG IHDR width/height (big-endian) live at byte offsets 16 and 20.
function pngDims(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const images = LAYERS.map(({ size, svg }) => {
  const png = renderPng(svg, size);
  const { w, h } = pngDims(png);
  if (w !== size || h !== size) console.warn(`! ${svg} @${size} rendered ${w}x${h} (expected ${size})`);
  return { size, png };
});

// ICONDIR (6) + ICONDIRENTRY[count] (16 each) + PNG payloads.
const count = images.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // image type: 1 = icon
header.writeUInt16LE(count, 4);

const dir = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
const payloads = [];
images.forEach((img, i) => {
  const b = i * 16;
  const dim = img.size >= 256 ? 0 : img.size; // 0 means 256 in the ICO spec
  dir.writeUInt8(dim, b + 0); // width
  dir.writeUInt8(dim, b + 1); // height
  dir.writeUInt8(0, b + 2); // color count (0 = no palette)
  dir.writeUInt8(0, b + 3); // reserved
  dir.writeUInt16LE(1, b + 4); // color planes
  dir.writeUInt16LE(32, b + 6); // bits per pixel
  dir.writeUInt32LE(img.png.length, b + 8); // payload size
  dir.writeUInt32LE(offset, b + 12); // payload offset
  offset += img.png.length;
  payloads.push(img.png);
});

writeFileSync(OUT, Buffer.concat([header, dir, ...payloads]));
rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote ${OUT} — ${count} layers: ${images.map((i) => i.size).join(", ")}px`);
