// Compy dark-site generator — zero dependencies beyond the repo's own toolchain.
// R3 Lane A1+A2: page CONTENT comes from the SHARED rendering core (scripts/lib/library-render.mjs)
// — the same core the full-library exporter uses — so the storefront, the export, and the in-app
// Library can never drift. This script owns only the site CHROME (templates in site/src/).
//
// Usage:   node site/generate.mjs
// Output:  site/<id>.html per curated pick (committed)
//          site/library/*.html — the FULL library w/ site chrome (gitignored artifact; this is
//          the documented pre-deploy step)
//          site/privacy.html + site/eula.html (legal, from docs/*.md)
//          site/library.css
// The LANDING is NOT generated here — it lives in the Astro app (site-app/, Mission Control
// makeover 2026-07-14); scripts/stage-dist-site.mjs builds and overlays it at staging time.
// HOSTING IS OWNER-GATED; building publishes nothing.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  articleBody,
  articleHeader,
  assertExportableIds,
  entrySummary,
  escapeHtml,
  glossaryBlock,
  indexSections,
  loadLibrary,
  stance,
} from "../scripts/lib/library-render.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(readFileSync(join(here, "debunks.config.json"), "utf8"));

const fill = (template, vars) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template var '${key}' missing`);
    return vars[key];
  });

// ---------- minimal, faithful markdown → HTML (legal pages render from the .md source) ----------
// Deliberately tiny + zero-dependency. Handles exactly what PRIVACY.md / EULA.md use: headings,
// paragraphs, **bold**, *italic*, `code`, "- " lists (with wrapped continuation lines),
// "> " blockquotes, and "---" rules. Inline text is HTML-escaped. Bare http(s) URLs are rendered
// as PLAIN TEXT, never <a href> — the legal pages must add ZERO external origins (the contact URLs
// stay readable/copyable; the only links on the page are the relative header/footer ones).
function mdInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    // Cross-link a sibling legal doc to its web page (keeps the ".md" wording verbatim — the legal
    // text is unchanged — but resolves to the published page for web readers; same-origin, relative).
    if (c === "PRIVACY.md") return `<a href="privacy.html"><code>PRIVACY.md</code></a>`;
    if (c === "EULA.md") return `<a href="eula.html"><code>EULA.md</code></a>`;
    return `<code>${c}</code>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  return s;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${mdInline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const isBreak = (t) => t === "" || /^[-*]\s+/.test(t) || /^#{1,6}\s/.test(t) || t === "---" || /^>\s?/.test(t);
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      flushPara();
      i++;
    } else if (t === "---") {
      flushPara();
      out.push("<hr />");
      i++;
    } else if (/^#{1,6}\s/.test(t)) {
      flushPara();
      const h = /^(#{1,6})\s+(.*)$/.exec(t);
      out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`);
      i++;
    } else if (/^[-*]\s+/.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        let item = lines[i].trim().replace(/^[-*]\s+/, "");
        i++;
        // fold wrapped continuation lines (indented, not a new block) into the item
        while (i < lines.length && !isBreak(lines[i].trim())) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(`<li>${mdInline(item)}</li>`);
      }
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (/^>\s?/.test(t)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdInline(quote.join(" "))}</blockquote>`);
    } else {
      para.push(t);
      i++;
    }
  }
  flushPara();
  return out.join("\n");
}

// Still true today (and test-pinned): the shipped app makes zero outbound requests. If the
// opt-in Receipts telemetry phase ever ships (owner-gated), this line gets revised WITH it.
const FOOTER_PROMISE = "Local-only by design · no telemetry · no account";

const lib = await loadLibrary();
const { entries } = lib;
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

// ---------- teaser tier (council decision 2026-07-15 — samples, not free meals) ----------
// Non-pick entries publish as TEASERS: the page still ANSWERS the search query's core question
// in visible text (verdict + what it is — thin/blocked content ranks worse and would contradict
// "shows its receipts"), but the depth — the evidence, the full write-up, the steps — stays in
// the app. One .html per entry id is preserved, so every index link and staleness guard holds.

function teaserSections(entry) {
  const p = (s) => `<p>${escapeHtml(s)}</p>`;
  const inTheApp = (heading, note) =>
    `<section class="in-the-app"><h2>${escapeHtml(heading)}</h2><p class="in-the-app-note">${escapeHtml(
      note,
    )} The Blackbook publishes its verdicts here — the full write-ups stay in the book, on your rig, next to your own measurements.</p></section>`;
  switch (entry.type) {
    case "tweak":
      return [
        `<section><h2>What it does</h2>${p(entry.what)}</section>`,
        `<section><h2>The honest verdict</h2>${p(`Graded ${entry.verdict}.`)}<p class="stance">${escapeHtml(stance(entry.verdict))}</p></section>`,
        inTheApp("The full graded entry", "The evidence and the why behind this grade ship inside the app."),
      ].join("\n");
    case "term":
      return [
        `<section><h2>What it means</h2>${p(entry.what)}</section>`,
        inTheApp("More detail", "The deeper explanation ships inside the app."),
      ].join("\n");
    case "trick":
      return [
        `<section><h2>The pattern</h2>${p(entry.pattern)}</section>`,
        inTheApp(
          "The tell & the honest version",
          "How to spot it in the wild — and what the honest version looks like — ships inside the app.",
        ),
      ].join("\n");
    case "guide":
      return [
        `<section><h2>The goal</h2>${p(entry.goal)}</section>`,
        inTheApp("Steps & the undo", "The step-by-step — with its undo attached — ships inside the app."),
      ].join("\n");
    default:
      throw new Error(`unknown entry type '${entry.type}' (${entry.id})`);
  }
}

function teaserPage(entry, { cssHref, homeHref, ctaHref }) {
  const title =
    entry.type === "tweak"
      ? `${entry.name} — real, placebo, or risky? | Compy Blackbook`
      : `${entry.name} | Compy Blackbook`;
  return fill(debunkTemplate, {
    TITLE: escapeHtml(title),
    META_DESCRIPTION: escapeHtml(entrySummary(entry)),
    ARTICLE: [articleHeader(entry, lib), teaserSections(entry)].join("\n"),
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

const pickIds = new Set(config.picks);
const libDir = join(here, "library");
rmSync(libDir, { recursive: true, force: true });
mkdirSync(libDir, { recursive: true });
let teaserCount = 0;
for (const entry of entries) {
  const opts = { cssHref: "../library.css", homeHref: "../", ctaHref: "../#waitlist" };
  const full = pickIds.has(entry.id);
  if (!full) teaserCount++;
  writeFileSync(join(libDir, `${entry.id}.html`), full ? articlePage(entry, opts) : teaserPage(entry, opts));
}

const pageTemplate = readFileSync(join(here, "src", "page.template.html"), "utf8");
writeFileSync(
  join(libDir, "index.html"),
  fill(pageTemplate, {
    TITLE: "The Compy Blackbook — every verdict on the record",
    META_DESCRIPTION: escapeHtml(
      `All ${entries.length} Compy Blackbook verdicts on the record — ${picks.length} full entries published as the public sample; the complete graded book ships inside the app.`,
    ),
    MAIN: [
      `<h1>The Compy Blackbook</h1>`,
      `<p>${entries.length} entries, every verdict on the record — none invented. ${picks.length} full write-ups are published below as the public sample; the complete graded book ships inside the app, next to your own rig's measurements.</p>`,
      glossaryBlock(lib),
      indexSections(entries, lib),
    ].join("\n"),
    CSS_HREF: "../library.css",
    HOME_HREF: "../",
    YEAR: String(year),
    FOOTER_PROMISE,
  }),
);
console.log(
  `wrote site/library/ — ${entries.length} entries (${picks.length} full, ${teaserCount} teasers) + index (gitignored artifact)`,
);

// ---------- legal pages (rendered from the .md source so they never drift) ----------
// site/privacy.html + site/eula.html — same chrome as the content pages (wordmark, aurora wash,
// glass), legal wording rendered faithfully from docs/PRIVACY.md and docs/EULA.md. Committed
// (they live at the site root like the curated debunk pages, not in the gitignored library/).
const legalPages = [
  {
    file: "privacy.html",
    src: "PRIVACY.md",
    title: "Compy — Privacy Policy",
    desc: "How Compy and the Compy website handle your data — the app is local-only; the launch waitlist stores only your email and a one-way hashed IP, with zero third-party trackers.",
  },
  {
    file: "eula.html",
    src: "EULA.md",
    title: "Compy — End-User License Agreement",
    desc: "The Compy End-User License Agreement & disclaimer — proprietary, all rights reserved; rollback is best-effort; the Software is provided as-is with no warranty.",
  },
];
for (const lp of legalPages) {
  const md = readFileSync(join(here, "..", "docs", lp.src), "utf8");
  writeFileSync(
    join(here, lp.file),
    fill(pageTemplate, {
      TITLE: escapeHtml(lp.title),
      META_DESCRIPTION: escapeHtml(lp.desc),
      MAIN: mdToHtml(md), // already-escaped HTML from the renderer
      CSS_HREF: "library.css",
      HOME_HREF: "./",
      YEAR: String(year),
      FOOTER_PROMISE,
    }),
  );
  console.log(`wrote site/${lp.file}  [legal, from docs/${lp.src}]`);
}

// ---------- landing: NOT generated here anymore ----------
// The landing moved to the Astro app in site-app/ (Mission Control makeover, spec
// 2026-07-14-site-makeover-research-spitball). scripts/stage-dist-site.mjs builds it and
// overlays site-app/dist/ onto the staged tree; this generator now owns only the content
// pages (curated debunks + full library + legal).
console.log(`done — ${picks.length} curated pages + full library + legal (landing: site-app/).`);
