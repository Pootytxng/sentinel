// THE shared Library rendering core (R3 Lane A1) — single source of truth for Library page HTML.
// Both generators consume it:
//   - scripts/export-library.mjs  → full-library standalone export (dist-web/library/)
//   - site/generate.mjs           → curated debunk pages + dark-site library (site chrome)
// The data comes from the app's OWN src/data/knowledge.ts via vite's SSR loader (vite is already
// the dev toolchain; middleware mode = no port, no HMR — a module loader, not a server), so no
// published page can ever drift from the in-app Library. Zero outbound network, zero deps added.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Load the canonical Library data through vite's SSR module loader (same modules the app bundles). */
export async function loadLibrary() {
  const server = await createServer({
    root: repoRoot,
    configFile: false, // data modules only — no plugins/JSX needed; esbuild handles TS + JSON
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const knowledge = await server.ssrLoadModule("/src/data/knowledge.ts");
    const glossary = await server.ssrLoadModule("/src/data/verdict-glossary.ts");
    const site = await server.ssrLoadModule("/src/data/site.ts");
    return {
      entries: knowledge.KNOWLEDGE,
      glossary: glossary.VERDICT_GLOSSARY,
      verdictChip: glossary.verdictChip,
      verdictDefinition: glossary.verdictDefinition,
      site: {
        SITE_URL: site.SITE_URL,
        SITE_TAGLINE: site.SITE_TAGLINE,
        WAITLIST_SLOT: site.WAITLIST_SLOT,
        KOFI_URL: site.KOFI_URL,
      },
    };
  } finally {
    await server.close();
  }
}

// Honest stance line per tweak verdict — states what the APP does, promises nothing it doesn't do.
export const stance = (verdict) => {
  if (verdict === "risky")
    return "It's on Compy's refuse list. Compy will never apply this tweak — and if a guide already talked you into it, reversibility is the whole point of the app.";
  if (verdict === "placebo")
    return "Compy won't recommend it. If you're curious anyway: change one thing at a time, measure it on your own rig, and revert unless it's clearly better — that loop is exactly what Compy is built around.";
  return "Where it genuinely fits a rig, Compy can recommend it — applied with a snapshot first and a one-click rollback after, like every change it makes.";
};

const TYPE_LABEL = { tweak: "Tweak", term: "Term", trick: "Trick", guide: "Guide" };

/** The chip shown beside the title: the glossary verdict chip for tweaks, the entry type otherwise. */
export function chipFor(entry, lib) {
  if (entry.type === "tweak")
    return {
      cls: `chip-${entry.verdict}`,
      label: lib.verdictChip(entry.verdict),
      title: lib.verdictDefinition(entry.verdict),
    };
  return { cls: `chip-${entry.type}`, label: TYPE_LABEL[entry.type] ?? entry.type, title: "" };
}

/** First-line summary used for meta descriptions / card teasers. */
export function entrySummary(entry) {
  switch (entry.type) {
    case "tweak":
      return `${entry.what} The honest verdict — ${entry.verdict}.`;
    case "term":
      return entry.what;
    case "trick":
      return entry.pattern;
    case "guide":
      return entry.goal;
    default:
      return entry.what ?? "";
  }
}

/** Type-aware semantic body sections for one entry — THE single content renderer. */
export function articleSections(entry) {
  const p = (s) => `<p>${escapeHtml(s)}</p>`;
  switch (entry.type) {
    case "tweak":
      return [
        `<section><h2>What it does</h2>${p(entry.what)}</section>`,
        `<section><h2>The honest verdict</h2>${p(entry.why)}</section>`,
        `<section><h2>How Compy treats it</h2><p class="stance">${escapeHtml(stance(entry.verdict))}</p></section>`,
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

/** Chip + title + aliases — the article masthead (chrome-independent). */
export function articleHeader(entry, lib) {
  const chip = chipFor(entry, lib);
  const aliases = entry.aliases.length
    ? `<p class="aliases">Also searched as: ${escapeHtml(entry.aliases.join(" · "))}</p>`
    : "";
  return [
    `<span class="chip ${escapeHtml(chip.cls)}"${chip.title ? ` title="${escapeHtml(chip.title)}"` : ""}>${escapeHtml(chip.label)}</span>`,
    `<h1>${escapeHtml(entry.name)}</h1>${aliases}`,
  ].join("\n");
}

/** Full article inner HTML: masthead + sections (chrome-independent). */
export function articleBody(entry, lib) {
  return [articleHeader(entry, lib), articleSections(entry)].join("\n");
}

/** The "How Compy grades things" glossary block (used on index pages). */
export function glossaryBlock(lib) {
  return `<section><h2>How Compy grades things</h2><dl>${lib.glossary
    .map((r) => `<dt>${escapeHtml(r.chip)}</dt><dd>${escapeHtml(r.definition)}</dd>`)
    .join("")}</dl></section>`;
}

export const SECTION_TITLES = {
  tweak: "Tweaks — graded honestly",
  term: "Terms — plain English",
  trick: "Tricks — patterns to watch for",
  guide: "Guides — safe, with the undo attached",
};

/** Grouped link list over all entries (used on index pages). hrefPrefix e.g. "" or "library/".
 *  pickIds (optional Set): entries in it get a "Sample" marker — the full public write-ups vs the
 *  teasers. Left null by the standalone app export (every export page is full → no marker needed). */
export function indexSections(entries, lib, hrefPrefix = "", pickIds = null) {
  const byType = { tweak: [], term: [], trick: [], guide: [] };
  for (const e of entries) {
    if (!(e.type in byType)) throw new Error(`unknown entry type '${e.type}' (${e.id})`);
    byType[e.type].push(e);
  }
  return Object.entries(byType)
    .filter(([, list]) => list.length > 0)
    .map(([type, list]) => {
      const items = list
        .map((e) => {
          const chip = chipFor(e, lib);
          const sample = pickIds?.has(e.id)
            ? ` <span class="sample-tag" title="Published in full — the rest of the book ships in the app">Sample</span>`
            : "";
          // .toc-card: the site's glass-card vocabulary at index density (Director verdict B
          // change #1); --sample lights the exposure boundary BEFORE the click. The standalone
          // export carries no card CSS, so these classes degrade to the plain list there.
          return `<li class="toc-card${pickIds?.has(e.id) ? " toc-card--sample" : ""}"><a href="${escapeHtml(hrefPrefix + e.id)}.html">${escapeHtml(e.name)}</a><span class="toc-card-meta"><span class="chip ${escapeHtml(chip.cls)}">${escapeHtml(chip.label)}</span>${sample}</span></li>`;
        })
        .join("\n");
      return `<section><h2>${SECTION_TITLES[type]} (${list.length})</h2><ul class="toc">\n${items}\n</ul></section>`;
    })
    .join("\n");
}

/** Validate ids are filename-safe before any write. Throws on the first offender. */
export function assertExportableIds(entries) {
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error("duplicate entry ids in KNOWLEDGE");
  for (const e of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id)) throw new Error(`unsafe entry id for a filename: '${e.id}'`);
    if (e.id === "index") throw new Error("entry id 'index' is reserved for the index page");
  }
}

// ---------- standalone (self-contained, inline-CSS) page variant — the dist-web export ----------

// Minimal inline CSS — semantic, dark, readable; no webfonts/CDN/analytics (zero third-party requests).
const STANDALONE_CSS = `
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
  .chip-real{border-color:#3f7d6b;color:#7fd0b8}
  .chip-placebo{border-color:#8a7a3a;color:#d8c87a}
  .chip-risky{border-color:#8a4a42;color:#e09a8e}
  .aliases{color:#9a9a94;font-size:.85rem;margin:.25rem 0 0}
  footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #2a2d31;color:#9a9a94;font-size:.9rem}
  ul.toc{list-style:none;padding:0}
  ul.toc li{margin:.3rem 0}
  dl dt{font-weight:600;margin-top:.6rem}
  dl dd{margin:0;color:#bdbdb8}
`;

function standaloneFooter(lib) {
  return `<footer><p><strong>${escapeHtml(lib.site.SITE_TAGLINE)}</strong> <a href="${escapeHtml(lib.site.SITE_URL)}">${escapeHtml(lib.site.SITE_URL.replace(/^https?:\/\//, ""))}</a></p></footer>`;
}

export function standalonePage(title, metaDescription, main, lib) {
  const fullTitle = title.includes("Compy Blackbook") ? title : `${title} — Compy Blackbook`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(metaDescription)}">
<style>${STANDALONE_CSS}</style>
</head>
<body>
<main>
${main}
</main>
${standaloneFooter(lib)}
</body>
</html>
`;
}

export function standaloneEntryPage(entry, lib) {
  const main = [
    `<header>${articleHeader(entry, lib)}</header>`,
    articleSections(entry),
    `<p><a href="index.html">← All Library entries</a></p>`,
  ].join("\n");
  return standalonePage(entry.name, entrySummary(entry), main, lib);
}

export function standaloneIndexPage(entries, lib) {
  const main = [
    `<header><h1>The Compy Blackbook</h1>`,
    `<p>${entries.length} entries — the same library that ships inside the app, none invented. Every verdict is graded, every guide carries its undo.</p></header>`,
    glossaryBlock(lib),
    indexSections(entries, lib),
  ].join("\n");
  return standalonePage(
    "The Compy Blackbook",
    `All ${entries.length} Compy Blackbook entries — tweaks graded honestly, terms in plain English, snake-oil patterns named.`,
    main,
    lib,
  );
}
