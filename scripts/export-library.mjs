// Library→web exporter — Receipts Doctrine Phase 1 (docs/RECEIPTS_DOCTRINE.md §4).
// Renders EVERY Learn/Library entry + the verdict glossary to standalone static HTML for compy.gg.
//
// BUILD TOOLING ONLY: zero new dependencies (vite is already the dev toolchain), zero app-runtime
// change, zero IPC, zero outbound network — `createServer` runs in middleware mode (no port, no HMR)
// purely as a TS/JSON module loader so the export consumes the app's OWN `KNOWLEDGE` array from
// src/data/knowledge.ts. Derived entries (tuning guides, how-we-grade) and future additions are
// included automatically — the published Library can never drift from the in-app one.
//
// Usage:   node scripts/export-library.mjs   (or: npm run export:library)
// Output:  dist-web/library/<id>.html per entry + dist-web/library/index.html (gitignored artifact).
// HOSTING IS OWNER-GATED — building publishes nothing.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(root, "dist-web", "library");

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Load the canonical Library data through vite's SSR module loader (same modules the app bundles). */
export async function loadLibrary() {
  const server = await createServer({
    root,
    configFile: false, // data modules only — no plugins/JSX needed; esbuild handles TS + JSON
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const knowledge = await server.ssrLoadModule("/src/data/knowledge.ts");
    const glossary = await server.ssrLoadModule("/src/data/verdict-glossary.ts");
    return {
      entries: knowledge.KNOWLEDGE,
      glossary: glossary.VERDICT_GLOSSARY,
      verdictChip: glossary.verdictChip,
      verdictDefinition: glossary.verdictDefinition,
    };
  } finally {
    await server.close();
  }
}

// Honest stance line per tweak verdict — same voice as site/generate.mjs: states what the APP does,
// promises nothing it doesn't do.
const stance = (verdict) => {
  if (verdict === "risky")
    return "It's on Compy's refuse list. Compy will never apply this tweak — and if a guide already talked you into it, reversibility is the whole point of the app.";
  if (verdict === "placebo")
    return "Compy won't recommend it. If you're curious anyway: change one thing at a time, measure it on your own rig, and revert unless it's clearly better — that loop is exactly what Compy is built around.";
  return "Where it genuinely fits a rig, Compy can recommend it — applied with a snapshot first and a one-click rollback after, like every change it makes.";
};

const TYPE_LABEL = { tweak: "Tweak", term: "Term", trick: "Trick", guide: "Guide" };

/** The chip shown beside the title: the verdict for tweaks, the entry type otherwise. */
function chipFor(entry, lib) {
  if (entry.type === "tweak")
    return {
      cls: `verdict-${entry.verdict}`,
      label: lib.verdictChip(entry.verdict),
      title: lib.verdictDefinition(entry.verdict),
    };
  return { cls: `type-${entry.type}`, label: TYPE_LABEL[entry.type] ?? entry.type, title: "" };
}

/** Type-aware semantic body sections for one entry. */
function bodyFor(entry) {
  const p = (s) => `<p>${escapeHtml(s)}</p>`;
  switch (entry.type) {
    case "tweak":
      return [
        `<section><h2>What it is</h2>${p(entry.what)}</section>`,
        `<section><h2>The honest verdict</h2>${p(entry.why)}</section>`,
        `<section><h2>What Compy does about it</h2>${p(stance(entry.verdict))}</section>`,
      ].join("\n");
    case "term":
      return [
        `<section><h2>What it means</h2>${p(entry.what)}</section>`,
        `<section><h2>More detail</h2>${p(entry.more)}</section>`,
      ].join("\n");
    case "trick":
      return [
        `<section><h2>The pattern</h2>${p(entry.pattern)}</section>`,
        `<section><h2>The tell</h2>${p(entry.tell)}</section>`,
        `<section><h2>The honest version</h2>${p(entry.honest_version)}</section>`,
      ].join("\n");
    case "guide":
      return [
        `<section><h2>The goal</h2>${p(entry.goal)}</section>`,
        `<section><h2>Steps</h2><ol>${entry.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol></section>`,
        `<section><h2>To undo</h2>${p(entry.undo)}</section>`,
      ].join("\n");
    default:
      throw new Error(`unknown entry type '${entry.type}' (${entry.id})`);
  }
}

const FOOTER = `<footer><p><strong>Measured, not promised — Compy.</strong> <a href="https://compy.gg">compy.gg</a></p></footer>`;

// Minimal inline CSS — semantic, dark, readable; no webfonts/CDN/analytics (zero third-party requests).
const CSS = `
  :root{color-scheme:dark}
  body{margin:0 auto;max-width:46rem;padding:2rem 1.25rem;background:#16181b;color:#e8e8e6;
       font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
  a{color:#5fb8b0}
  h1{font-size:1.6rem;line-height:1.25;margin:0 0 .5rem}
  h2{font-size:1.05rem;margin:1.5rem 0 .35rem;color:#bdbdb8}
  p{margin:.35rem 0}
  ol{margin:.35rem 0;padding-left:1.4rem}
  .chip{display:inline-block;font-size:.78rem;font-weight:600;letter-spacing:.02em;
        padding:.15rem .55rem;border-radius:999px;border:1px solid #3a3d42;color:#cfcfca}
  .verdict-real{border-color:#3f7d6b;color:#7fd0b8}
  .verdict-placebo{border-color:#8a7a3a;color:#d8c87a}
  .verdict-risky{border-color:#8a4a42;color:#e09a8e}
  .aliases{color:#9a9a94;font-size:.85rem;margin:.25rem 0 0}
  footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #2a2d31;color:#9a9a94;font-size:.9rem}
  ul.toc{list-style:none;padding:0}
  ul.toc li{margin:.3rem 0}
  dl dt{font-weight:600;margin-top:.6rem}
  dl dd{margin:0;color:#bdbdb8}
`;

const page = (title, metaDescription, main) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title.includes("Compy Library") ? title : `${title} — Compy Library`)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<style>${CSS}</style>
</head>
<body>
<main>
${main}
</main>
${FOOTER}
</body>
</html>
`;

function entryPage(entry, lib) {
  const chip = chipFor(entry, lib);
  const aliases = entry.aliases.length
    ? `<p class="aliases">Also known as: ${escapeHtml(entry.aliases.join(" · "))}</p>`
    : "";
  const main = [
    `<header><span class="chip ${escapeHtml(chip.cls)}"${chip.title ? ` title="${escapeHtml(chip.title)}"` : ""}>${escapeHtml(chip.label)}</span>`,
    `<h1>${escapeHtml(entry.name)}</h1>${aliases}</header>`,
    bodyFor(entry),
    `<p><a href="index.html">← All Library entries</a></p>`,
  ].join("\n");
  const summary =
    entry.type === "tweak" ? `${entry.what} The honest verdict — ${entry.verdict}.` : entryFirstLine(entry);
  return page(entry.name, summary, main);
}

function entryFirstLine(entry) {
  switch (entry.type) {
    case "term":
      return entry.what;
    case "trick":
      return entry.pattern;
    case "guide":
      return entry.goal;
    default:
      return entry.what;
  }
}

function indexPage(entries, lib) {
  const byType = { tweak: [], term: [], trick: [], guide: [] };
  for (const e of entries) byType[e.type].push(e);
  const sectionTitle = {
    tweak: "Tweaks — graded honestly",
    term: "Terms — plain English",
    trick: "Tricks — patterns to watch for",
    guide: "Guides — safe, with the undo attached",
  };
  const sections = Object.entries(byType)
    .filter(([, list]) => list.length > 0)
    .map(([type, list]) => {
      const items = list
        .map((e) => {
          const chip = chipFor(e, lib);
          return `<li><a href="${escapeHtml(e.id)}.html">${escapeHtml(e.name)}</a> <span class="chip ${escapeHtml(chip.cls)}">${escapeHtml(chip.label)}</span></li>`;
        })
        .join("\n");
      return `<section><h2>${sectionTitle[type]} (${list.length})</h2><ul class="toc">\n${items}\n</ul></section>`;
    })
    .join("\n");
  const glossary = `<section><h2>How Compy grades things</h2><dl>${lib.glossary
    .map((r) => `<dt>${escapeHtml(r.chip)}</dt><dd>${escapeHtml(r.definition)}</dd>`)
    .join("")}</dl></section>`;
  const main = [
    `<header><h1>The Compy Library</h1>`,
    `<p>${entries.length} entries — the same library that ships inside the app, none invented. Every verdict is graded, every guide carries its undo.</p></header>`,
    glossary,
    sections,
  ].join("\n");
  return page("The Compy Library", `All ${entries.length} Compy Library entries — tweaks graded honestly, terms in plain English, snake-oil patterns named.`, main);
}

/** Render every entry + the index to outDir. Returns { outDir, pageCount, entryCount }. */
export async function exportLibrary({ lib, outDir = DEFAULT_OUT } = {}) {
  lib ??= await loadLibrary();
  const { entries } = lib;

  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error("duplicate entry ids in KNOWLEDGE");
  for (const e of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id)) throw new Error(`unsafe entry id for a filename: '${e.id}'`);
    if (e.id === "index") throw new Error("entry id 'index' is reserved for the index page");
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const entry of entries) {
    const html = entryPage(entry, lib);
    if (!/<h1>\S/.test(html)) throw new Error(`empty title rendered for '${entry.id}'`);
    writeFileSync(join(outDir, `${entry.id}.html`), html);
  }
  writeFileSync(join(outDir, "index.html"), indexPage(entries, lib));
  return { outDir, pageCount: entries.length + 1, entryCount: entries.length };
}

const invokedAsMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  const { outDir, pageCount, entryCount } = await exportLibrary();
  console.log(`exported ${entryCount} Library entries + index → ${outDir} (${pageCount} pages)`);
}
