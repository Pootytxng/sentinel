// @vitest-environment node
// R4a landing smoke (spec 2026-06-12 §B0): the COMMITTED site/index.html is the artifact the
// owner taste-gates and the deploy ships — pin its publish-grade contract: doctrine hero, the
// §B0 sections, zero outbound requests, zero raster assets until the §D art lands, doorknob
// honesty on the download placeholder.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "site", "index.html"), "utf8");

describe("site landing (R4a publish-grade contract)", () => {
  it("carries the doctrine identity hero + the §B0 sections", () => {
    // Consumer-panel overhaul 2026-07-11: the hook line is the h1, the doctrine line the kicker.
    expect(html).toContain("Know which PC tweaks<br />actually help your rig.");
    expect(html).toMatch(/class="kicker">Measured, not promised\./);
    expect(html).toContain('id="receipts"'); // 3 value cards
    expect((html.match(/class="value-card"/g) ?? []).length).toBe(3);
    expect(html).toContain('id="grades"'); // verdict key (glossary-generated)
    expect(html).toContain('id="library"'); // debunk showcase
    expect(html).toContain('id="waitlist"');
    expect(html).toContain('id="download"'); // future-download placeholder
    expect(html).toContain("Measured, not promised."); // creed footer line
    expect(html).toContain("No fabricated numbers");
  });

  it("consumer-panel overhaul contract: free above the fold, accessible proof loop, start-here curation", () => {
    // "It's free" lives in the hero, before the library section (was footer-only knowledge).
    const freeAt = html.indexOf("Compy is free.");
    expect(freeAt).toBeGreaterThan(-1);
    expect(freeAt).toBeLessThan(html.indexOf('id="library"'));
    // The proof loop is real accessible text (the hero visual), not a decorative aside.
    expect(html).toContain('class="proof-title"');
    expect(html).not.toMatch(/class="proof" aria-hidden/);
    // Every tweak card argues its grade — a one-line "why" beside the chip, not a bare tier chip.
    expect((html.match(/class="card-why"/g) ?? []).length).toBeGreaterThanOrEqual(10);
    // Blackbook leads with the start-here trio, not raw entry counts.
    expect(html).toContain("Start here: three quick reads");
    expect(html).not.toMatch(/class="section-sub">\s*\d+ tweaks/);
    // The full count survives on the browse-all link (honest, just demoted).
    expect(html).toMatch(/Open the full Blackbook — all \d+ entries/);
  });

  it("hero receipt is the REAL measured one, pinned to its provenance record (bug→guard, 2026-07-13)", () => {
    // A consumer-panel persona caught the old strip using fabricated numbers (fast-startup-off
    // "+8 fps" — a boot-time tweak that cannot move fps). The receipt is now a real Lab →
    // Benchmark A/B trial; site/src/proof-receipt.json is its provenance. This guard pins the
    // rendered strip to that record so decorative numbers can't silently return: re-measuring
    // means updating BOTH files together.
    const receipt = JSON.parse(readFileSync(join(root, "site", "src", "proof-receipt.json"), "utf8"));
    expect(html).toContain(receipt.stripLines.title);
    for (const row of [receipt.stripLines.row1, receipt.stripLines.row2, receipt.stripLines.row3]) {
      for (const cell of row) expect(html).toContain(cell);
    }
    // Provenance must be complete enough to audit: a ledger entry, a real trial, a clean rollback.
    expect(receipt.ledgerEntryId).toMatch(/^[a-z-]+-\d+$/);
    expect(receipt.trial.rolledBack).toBe(true);
    expect(receipt.recId).toBe(receipt.ledgerEntryId.replace(/-\d+$/, ""));
    // The known-fabricated mock trio must never reappear in RENDERED copy (the template's
    // provenance comment may name it — comments don't render, so strip them before matching).
    const rendered = html.replace(/<!--[\s\S]*?-->/g, "");
    expect(rendered).not.toContain("+8 fps");
    expect(rendered).not.toContain("an example receipt");
    expect(rendered).not.toMatch(/proof-row"><span class="k">fast-startup-off/);
  });

  it("makes ZERO third-party requests: no external scripts/styles/fonts/trackers, no raster assets yet", () => {
    // Every external http(s) reference would be a third-party request — there must be none.
    // (The waitlist POST is SAME-ORIGIN /api/waitlist — gate-crossing per the 2026-06-12
    // waitlist-wiring spec: the zero-THIRD-PARTY invariant is preserved, not waived.)
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\//);
    expect(html).not.toMatch(/action="https?:\/\//);
    expect(html).not.toMatch(/@import|fonts\.googleapis|analytics|gtag|plausible|hotjar|turnstile|challenges\.cloudflare/i);
    // No raster imagery until Cowork's §D art lands in site/assets/ (slots are comments).
    expect(html).not.toMatch(/<img\b/);
    // The only script is ours, and its only network call is the same-origin waitlist POST.
    expect((html.match(/<script\b/g) ?? []).length).toBeLessThanOrEqual(1);
    if (html.includes("<script")) expect(html).toContain("data-waitlist");
    for (const m of html.matchAll(/fetch\(\s*["']([^"']+)["']/g)) {
      expect(m[1]).toBe("/api/waitlist");
    }
  });

  it("download placeholder is honest text — no dead button wearing a knob (doorknob law)", () => {
    const download = /<section class="wrap" id="download">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
    expect(download).toContain("invite only");
    expect(download).not.toMatch(/<button|class="btn"/);
  });

  it("mobile viewport + og metas present; og:image is LIVE (the §D art exists) and absolute", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain('property="og:title"');
    // Scrapers (Discord/Twitter/Facebook) require an ABSOLUTE og:image URL.
    const active = html.replace(/<!--[\s\S]*?-->/g, "");
    expect(active).toMatch(/<meta property="og:image" content="https:\/\/[^"]+\/assets\/og\.png"/);
    expect(active).toContain('name="twitter:card"');
  });

  it("waitlist is the REAL same-origin form (spec 2026-06-12-waitlist-wiring); Ko-fi stays a placeholder", () => {
    // Native POST to our own Pages Function — no provider, no third-party script.
    expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\/api\/waitlist"/);
    // The hidden honeypot field rides along (bots fill it; the Function drops them silently).
    expect(html).toMatch(/name="website"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*name="website"/);
    // Honesty law on the new boundary: the email DOES leave the browser — to us only — and
    // the copy says so plainly; the app's own zero-outbound line stays scoped to the app.
    expect(html).toContain("stored only to send that one launch message");
    expect(html).toContain("The app itself sends nothing off your PC");
    expect(html).toContain("KO-FI PLACEHOLDER SLOT");
  });

  it("links the published legal pages: footer Privacy · Terms + the waitlist note → privacy (point of collection)", () => {
    expect(html).toMatch(/<a href="privacy\.html">/);
    expect(html).toMatch(/<a href="eula\.html">/);
    // The privacy disclosure stays one click away right where the email is collected.
    const note = /class="waitlist-note">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(note).toMatch(/href="privacy\.html"/);
  });
});

describe("legal pages (rendered from the .md source — privacy.html / eula.html)", () => {
  const privacy = readFileSync(join(root, "site", "privacy.html"), "utf8");
  const eula = readFileSync(join(root, "site", "eula.html"), "utf8");

  it("render the policy + terms content with the right titles", () => {
    expect(privacy).toContain("<title>Compy — Privacy Policy</title>");
    expect(privacy).toContain("Privacy Policy");
    expect(eula).toContain("<title>Compy — End-User License Agreement</title>");
    expect(eula).toContain("End-User License Agreement");
    // The EULA [STATE] placeholder is the owner's to fill — it must render verbatim, never invented.
    expect(eula).toContain("[STATE");
  });

  it("add ZERO external origins: self-hosted CSS only, no external href/src, no trackers/CDNs", () => {
    for (const page of [privacy, eula]) {
      expect(page).not.toMatch(/src="https?:\/\//);
      expect(page).not.toMatch(/href="https?:\/\//); // contact URLs render as plain text, never <a href>
      // No third-party RESOURCES: legal pages are fully static (no <script>), no @import, no
      // web-font/tracker domains. (The policy PROSE legitimately discusses "analytics"/"tracking" —
      // describing what Compy does NOT do — so we match resource markers, not bare words.)
      expect(page).not.toMatch(/<script\b/);
      expect(page).not.toMatch(/@import|fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|plausible\.io|hotjar|challenges\.cloudflare/i);
      expect(page).not.toMatch(/<img\b/);
      // The only stylesheet is our self-hosted library.css.
      expect(page).toMatch(/<link rel="stylesheet" href="library\.css"/);
    }
  });

  it("reach the rest of the site (footer legal links + home)", () => {
    for (const page of [privacy, eula]) {
      expect(page).toMatch(/href="\.\/privacy\.html"/);
      expect(page).toMatch(/href="\.\/eula\.html"/);
    }
  });

  it("EULA §10's PRIVACY.md reference is a same-origin link to the published policy", () => {
    // Lane C: the legal WORDING is unchanged (".md" text intact); only its link-ness is added.
    expect(eula).toMatch(/<a href="privacy\.html"><code>PRIVACY\.md<\/code><\/a>/);
    expect(eula).not.toMatch(/href="https?:\/\//); // still zero external origin
  });
});

// R6 Lane D guard: lock in this session's wins so they can't silently regress. Every COMMITTED
// top-level site page must (1) link Privacy + Terms in its footer, and (2) add zero external
// resource origins (per CC's plain-text-external-URLs decision). The gitignored library/ pages
// render from the same page/debunk templates these pages exercise, so the templates are guarded.
describe("site-wide guard — footer legal links + zero external origins on every committed page", () => {
  const pages = readdirSync(join(root, "site"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => [f, readFileSync(join(root, "site", f), "utf8")]);

  it("finds the committed page set", () => {
    expect(pages.length, "landing + curated debunks + legal").toBeGreaterThanOrEqual(10);
  });

  it("every page links Privacy + Terms in its footer", () => {
    for (const [name, html] of pages) {
      expect(html, `${name}: missing Privacy link`).toMatch(/href="(\.\/)?privacy\.html"/);
      expect(html, `${name}: missing Terms link`).toMatch(/href="(\.\/)?eula\.html"/);
    }
  });

  it("every page adds zero external resource origins (no external href/src, no remote <script>)", () => {
    for (const [name, html] of pages) {
      expect(html, `${name}: external href`).not.toMatch(/href="https?:\/\//);
      expect(html, `${name}: external src`).not.toMatch(/src="https?:\/\//);
      // The landing's one inline <script> is allowed; a <script src=…> (remote) is never.
      expect(html, `${name}: remote <script>`).not.toMatch(/<script\b[^>]*\bsrc=/);
    }
  });
});
