// Compy dark-site generator — zero dependencies beyond the repo's own toolchain.
// R3 Lane A1+A2: page CONTENT comes from the SHARED rendering core (scripts/lib/library-render.mjs)
// — the same core the full-library exporter uses — so the storefront, the export, and the in-app
// Library can never drift. This script owns only the site CHROME (templates in site/src/).
//
// Usage:   node site/generate.mjs
// Output:  site/index.html (landing — hero copy DRAFT, owner taste-gates before publish)
//          site/<id>.html per curated pick (committed)
//          site/library/*.html — the FULL library w/ site chrome (gitignored artifact; this is
//          the documented pre-deploy step)
//          site/library.css
// Swap points (waitlist embed / Ko-fi / site URL) all live in src/data/site.ts — one file, then
// regenerate. HOSTING IS OWNER-GATED; building publishes nothing.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  articleBody,
  assertExportableIds,
  chipFor,
  entrySummary,
  escapeHtml,
  glossaryBlock,
  indexSections,
  loadLibrary,
} from "../scripts/lib/library-render.mjs";

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
const { entries, site } = lib;
assertExportableIds(entries);
const year = new Date().getFullYear();

const picks = config.picks.map((id) => {
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`debunks.config.json pick '${id}' not found in the Library`);
  return entry;
});

copyFileSync(join(here, "src", "library.css"), join(here, "library.css"));

// ---------- curated debunk pages (committed) + full library (artifact) ----------

const debunkTemplate = readFileSync(join(here, "src", "debunk.template.html"), "utf8");

function articlePage(entry, { cssHref, homeHref, ctaHref }) {
  const title =
    entry.type === "tweak"
      ? `${entry.name} — real, placebo, or risky? | Compy Blackbook`
      : `${entry.name} | Compy Blackbook`;
  return fill(debunkTemplate, {
    TITLE: escapeHtml(title),
    META_DESCRIPTION: escapeHtml(entrySummary(entry)),
    ARTICLE: articleBody(entry, lib), // already-escaped HTML from the core — never re-escape
    ENTRY_COUNT: String(entries.length),
    YEAR: String(year),
    CSS_HREF: cssHref,
    HOME_HREF: homeHref,
    CTA_HREF: ctaHref,
    FOOTER_PROMISE,
  });
}

for (const entry of picks) {
  writeFileSync(
    join(here, `${entry.id}.html`),
    articlePage(entry, { cssHref: "library.css", homeHref: "./", ctaHref: "./#waitlist" }),
  );
  console.log(`wrote site/${entry.id}.html  [${entry.type === "tweak" ? entry.verdict : entry.type}]`);
}

const libDir = join(here, "library");
rmSync(libDir, { recursive: true, force: true });
mkdirSync(libDir, { recursive: true });
for (const entry of entries) {
  writeFileSync(
    join(libDir, `${entry.id}.html`),
    articlePage(entry, { cssHref: "../library.css", homeHref: "../", ctaHref: "../#waitlist" }),
  );
}

const pageTemplate = readFileSync(join(here, "src", "page.template.html"), "utf8");
writeFileSync(
  join(libDir, "index.html"),
  fill(pageTemplate, {
    TITLE: "The Compy Blackbook — every entry, graded honestly",
    META_DESCRIPTION: escapeHtml(
      `All ${entries.length} Compy Blackbook entries — tweaks graded honestly, terms in plain English, snake-oil patterns named.`,
    ),
    MAIN: [
      `<h1>The Compy Blackbook</h1>`,
      `<p>${entries.length} entries — the same library that ships inside the app, none invented. Every verdict is graded, every guide carries its undo.</p>`,
      glossaryBlock(lib),
      indexSections(entries, lib),
    ].join("\n"),
    CSS_HREF: "../library.css",
    HOME_HREF: "../",
    YEAR: String(year),
    FOOTER_PROMISE,
  }),
);
console.log(`wrote site/library/ — ${entries.length} entries + index (gitignored artifact)`);

// ---------- the landing (committed; copy DRAFT — owner taste-gates) ----------

const verdictKey = lib.glossary
  .map(
    (r) =>
      `      <div class="verdict-cell">\n        <span class="chip chip-${escapeHtml(r.verdict)}">${escapeHtml(r.chip)}</span>\n        <p>${escapeHtml(r.definition)}</p>\n      </div>`,
  )
  .join("\n");

const debunkCards = picks
  .map((e) => {
    const chip = chipFor(e, lib);
    return [
      `      <a class="card" href="${escapeHtml(e.id)}.html">`,
      `        <span class="chip ${escapeHtml(chip.cls)}">${escapeHtml(chip.label)}</span>`,
      `        <h3>${escapeHtml(e.name)}</h3>`,
      `        <p>${escapeHtml(e.type === "tweak" ? e.what : entrySummary(e))}</p>`,
      `        <span class="read">Read the honest verdict →</span>`,
      `      </a>`,
    ].join("\n");
  })
  .join("\n");

// Waitlist: the REAL same-origin form (spec 2026-06-12-waitlist-wiring) — native POST to our
// own Pages Function; the slot HTML is the swap point in src/data/site.ts.
const waitlistSlot = site.WAITLIST_SLOT;

// The ONE page script (test-pinned: at most one <script> block): the IntersectionObserver
// scroll reveals (§B0b — html.rv arms them only when the API exists AND reduced-motion is off;
// without it everything is simply visible) + the waitlist progressive enhancement: same-origin
// fetch to /api/waitlist with an inline thanks/error state, plus the ?waitlist= flag handling
// for the no-JS 303 round-trip. ZERO third-party requests either way.
const waitlistJs = [
  ``,
  `  // Waitlist progressive enhancement — same-origin /api/waitlist only (no JS still works:`,
  `  // the form natively POSTs and comes back as /?waitlist=ok).`,
  `  var wlForm = document.querySelector("[data-waitlist]");`,
  `  var wlStatus = document.querySelector("[data-waitlist-status]");`,
  `  var WL_THANKS = "You're on the list — one email at launch, nothing else.";`,
  `  var WL_INVALID = "That doesn't look like an email address — check it and try again.";`,
  `  var WL_ERROR = "Couldn't save that right now — try again in a minute.";`,
  `  function wlShow(msg) { if (wlStatus) { wlStatus.textContent = msg; wlStatus.style.display = "block"; } }`,
  `  var wlFlag = new URLSearchParams(location.search).get("waitlist");`,
  `  if (wlFlag === "ok") wlShow(WL_THANKS);`,
  `  else if (wlFlag === "invalid") wlShow(WL_INVALID);`,
  `  else if (wlFlag === "error") wlShow(WL_ERROR);`,
  `  if (wlForm) wlForm.addEventListener("submit", function (e) {`,
  `    e.preventDefault();`,
  `    fetch("/api/waitlist", { method: "POST", body: new FormData(wlForm), headers: { accept: "application/json" } })`,
  `      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })`,
  `      .then(function (j) { if (j.ok) { wlShow(WL_THANKS); wlForm.reset(); } else wlShow(j.error || WL_ERROR); })`,
  `      .catch(function () { wlShow(WL_ERROR); });`,
  `  });`,
].join("\n");

const pageScript = [
  `<script>`,
  `  // The ONLY script on the page: scroll reveals + the same-origin waitlist enhancement.`,
  `  (function () {`,
  `    var rm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");`,
  `    if ("IntersectionObserver" in window && !(rm && rm.matches)) {`,
  `      document.documentElement.classList.add("rv");`,
  `      var io = new IntersectionObserver(function (entries) {`,
  `        entries.forEach(function (en) {`,
  `          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }`,
  `        });`,
  `      }, { rootMargin: "0px 0px -10% 0px" });`,
  `      document.querySelectorAll(".sr, .sr-kids").forEach(function (el) { io.observe(el); });`,
  `    }`,
  `  })();`,
  waitlistJs,
  `</script>`,
].join("\n");

const kofiSlot = site.KOFI_URL
  ? `    <a class="link-quiet" href="${escapeHtml(site.KOFI_URL)}">Support Compy ☕</a>`
  : `    <!-- KO-FI PLACEHOLDER SLOT: set KOFI_URL in src/data/site.ts and regenerate. -->`;

const indexTemplate = readFileSync(join(here, "src", "index.template.html"), "utf8");
writeFileSync(
  join(here, "index.html"),
  fill(indexTemplate, {
    VERDICT_KEY: verdictKey,
    DEBUNK_CARDS: debunkCards,
    ENTRY_COUNT: String(entries.length),
    WAITLIST_SLOT: waitlistSlot,
    PAGE_SCRIPT: pageScript,
    KOFI_SLOT: kofiSlot,
    FOOTER_PROMISE,
    YEAR: String(year),
  }),
);
console.log(`wrote site/index.html (landing — copy DRAFT, owner taste-gates before publish)`);
console.log(`done — ${picks.length} curated pages + full library + landing, count ${entries.length}.`);
