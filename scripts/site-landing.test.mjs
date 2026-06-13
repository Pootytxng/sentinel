// @vitest-environment node
// R4a landing smoke (spec 2026-06-12 §B0): the COMMITTED site/index.html is the artifact the
// owner taste-gates and the deploy ships — pin its publish-grade contract: doctrine hero, the
// §B0 sections, zero outbound requests, zero raster assets until the §D art lands, doorknob
// honesty on the download placeholder.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "site", "index.html"), "utf8");

describe("site landing (R4a publish-grade contract)", () => {
  it("carries the doctrine identity hero + the §B0 sections", () => {
    expect(html).toContain("Measured,<br />not promised.");
    expect(html).toContain('id="receipts"'); // 3 value cards
    expect((html.match(/class="value-card"/g) ?? []).length).toBe(3);
    expect(html).toContain('id="grades"'); // verdict key (glossary-generated)
    expect(html).toContain('id="library"'); // debunk showcase
    expect(html).toContain('id="waitlist"');
    expect(html).toContain('id="download"'); // future-download placeholder
    expect(html).toContain("Measured, not promised."); // creed footer line
    expect(html).toContain("No fabricated numbers");
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
});
