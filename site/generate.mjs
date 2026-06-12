// Compy dark-site generator — zero dependencies beyond the repo's own toolchain.
// R3 Lane A1: page CONTENT comes from the SHARED rendering core (scripts/lib/library-render.mjs)
// — the same core the full-library exporter uses — so the storefront, the export, and the in-app
// Library can never drift. This script owns only the site CHROME (templates in site/src/).
//
// Usage:   node site/generate.mjs
// Output:  site/<id>.html per curated pick (committed) + site/library.css.
// HOSTING IS OWNER-GATED; building publishes nothing. site/index.html is the landing
// (regenerated from site/src/index.template.html — owner taste-gates copy before any publish).

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { articleBody, entrySummary, escapeHtml, loadLibrary } from "../scripts/lib/library-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(readFileSync(join(here, "debunks.config.json"), "utf8"));

const fill = (template, vars) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template var '${key}' missing`);
    return vars[key];
  });

// Still true today (and test-pinned): the shipped app makes zero outbound requests. If the
// opt-in Receipts telemetry phase ever ships (owner-gated), this line gets revised WITH it.
const FOOTER_PROMISE = "Local-only by design · no telemetry · no account";

const lib = await loadLibrary();
const { entries } = lib;
const year = new Date().getFullYear();

const picks = config.picks.map((id) => {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`debunks.config.json pick '${id}' not found in the Library`);
  return entry;
});

copyFileSync(join(here, "src", "library.css"), join(here, "library.css"));

const debunkTemplate = readFileSync(join(here, "src", "debunk.template.html"), "utf8");
for (const entry of picks) {
  const title =
    entry.type === "tweak"
      ? `${entry.name} — real, placebo, or risky? | Compy Library`
      : `${entry.name} | Compy Library`;
  const html = fill(debunkTemplate, {
    TITLE: escapeHtml(title),
    META_DESCRIPTION: escapeHtml(entrySummary(entry)),
    ARTICLE: articleBody(entry, lib), // already-escaped HTML from the core — never re-escape

    ENTRY_COUNT: String(entries.length),
    YEAR: String(year),
    CSS_HREF: "library.css",
    HOME_HREF: "./",
    CTA_HREF: "./",
    FOOTER_PROMISE,
  });
  writeFileSync(join(here, `${entry.id}.html`), html);
  console.log(`wrote site/${entry.id}.html  [${entry.type === "tweak" ? entry.verdict : entry.type}]`);
}
console.log(`done — ${picks.length} debunk pages from the shared core, library count ${entries.length}.`);
