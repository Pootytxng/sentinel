// Compy Library debunk-page generator — zero dependencies, single source of truth.
// The council's acquisition step (docs/superpowers/specs/2026-06-12-monetization-council.md):
// publishable debunk articles rendered from the SAME src/data/tweaks.json the app ships, so the
// storefront can never drift from the in-app Library. ADDITIVE beside Cowork's landing
// (site/index.html — its copy/design is Cowork's lane; this script never touches it).
//
// Usage:   node site/generate.mjs
// Output:  site/<id>.html per pick + site/library.css — the whole site/ folder stays
//          host-by-drag-and-drop per its README. HOSTING IS OWNER-GATED; building publishes nothing.

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const tweaks = JSON.parse(readFileSync(join(root, "src", "data", "tweaks.json"), "utf8"));
const terms = JSON.parse(readFileSync(join(root, "src", "data", "terms.json"), "utf8"));
const config = JSON.parse(readFileSync(join(here, "debunks.config.json"), "utf8"));

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const picks = config.picks.map((id) => {
  const entry = tweaks.find((t) => t.id === id);
  if (!entry) throw new Error(`debunks.config.json pick '${id}' not found in src/data/tweaks.json`);
  return entry;
});

// Honest stance line per verdict — states what the APP does, promises nothing it doesn't do.
const stance = (t) => {
  if (t.verdict === "risky")
    return "It's on Compy's refuse list. Compy will never apply this tweak — and if a guide already talked you into it, reversibility is the whole point of the app.";
  if (t.verdict === "placebo")
    return "Compy won't recommend it. If you're curious anyway: change one thing at a time, measure it on your own rig, and revert unless it's clearly better — that loop is exactly what Compy is built around.";
  return "Where it genuinely fits a rig, Compy can recommend it — applied with a snapshot first and a one-click rollback after, like every change it makes.";
};

const entryCount = tweaks.length + terms.length;
const year = new Date().getFullYear();

const fill = (template, vars) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template var '${key}' missing`);
    return vars[key];
  });

copyFileSync(join(here, "src", "library.css"), join(here, "library.css"));

const debunkTemplate = readFileSync(join(here, "src", "debunk.template.html"), "utf8");
const verdictLabel = { real: "Real", placebo: "Placebo", risky: "Risky" };
for (const t of picks) {
  const html = fill(debunkTemplate, {
    NAME: escapeHtml(t.name),
    META_DESCRIPTION: escapeHtml(`${t.name}: ${t.what} The honest verdict — ${verdictLabel[t.verdict].toLowerCase()}.`),
    VERDICT: escapeHtml(t.verdict),
    VERDICT_LABEL: escapeHtml(verdictLabel[t.verdict] ?? t.verdict),
    ALIASES: escapeHtml((t.aliases ?? []).join(" · ")),
    WHAT: escapeHtml(t.what),
    WHY: escapeHtml(t.why),
    STANCE: escapeHtml(stance(t)),
    ENTRY_COUNT: String(entryCount),
    YEAR: String(year),
  });
  writeFileSync(join(here, `${t.id}.html`), html);
  console.log(`wrote site/${t.id}.html  [${t.verdict}]`);
}
console.log(`done — ${picks.length} debunk pages, library count ${entryCount}. site/index.html untouched (Cowork's lane).`);
