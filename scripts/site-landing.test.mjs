// @vitest-environment node
// Landing contract v2 (Mission Control makeover, spec 2026-07-14-site-makeover-research-spitball):
// the landing is no longer a committed static file — it is BUILT from site-app/ (Astro + React
// islands). The artifact under test is site-app/dist/index.html, rebuilt here when the sources
// are newer (same build command staging uses), so the guards always judge what would deploy.
// The R4a guard CONTRACT carries over: real provenance-pinned numbers, zero third-party requests,
// doorknob honesty, honest waitlist copy, legal links — the assertions target the new markup.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteApp } from "./stage-dist-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "site-app");
const distDir = join(appDir, "dist");

// ---------- build-if-stale: test the real deploy artifact, never a stale one ----------
function newestMtime(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const name of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, name)));
  return newest;
}
const srcNewest = Math.max(
  newestMtime(join(appDir, "src")),
  newestMtime(join(appDir, "astro.config.mjs")),
  newestMtime(join(appDir, "package.json")),
);
const indexPath = join(distDir, "index.html");
if (!existsSync(indexPath) || statSync(indexPath).mtimeMs < srcNewest) buildSiteApp();

const html = readFileSync(indexPath, "utf8");
const rendered = html.replace(/<!--[\s\S]*?-->/g, ""); // comments don't render — strip before copy checks

// Provenance records every number on the page is pinned to.
const replay = JSON.parse(readFileSync(join(appDir, "src", "data", "session-replay.json"), "utf8"));
const session = JSON.parse(readFileSync(join(root, "site", "src", "session-receipt.json"), "utf8"));
const proof = JSON.parse(readFileSync(join(root, "site", "src", "proof-receipt.json"), "utf8"));

describe("landing (Flight Test contract v3)", () => {
  it("carries the Flight Test hero + every section", () => {
    // The monumental h1 is split across three mask spans — pin each line, and the
    // accessible sentence order (small line before the two big lines).
    expect(html).toContain("The PC optimizer that");
    expect(html).toContain(">shows its<");
    expect(html).toContain(">receipts.<");
    expect(html.indexOf("The PC optimizer that")).toBeLessThan(html.indexOf(">shows its<"));
    expect(html.indexOf(">shows its<")).toBeLessThan(html.indexOf(">receipts.<"));
    expect(html).toContain("measured, not promised"); // hero kicker
    for (const id of ["features", "receipts", "pricing", "faq", "waitlist"]) {
      expect(html, `missing section #${id}`).toContain(`id="${id}"`);
    }
    // Trust bar: current product laws. "core free forever" is the SCOPED promise
    // (owner decision 2026-07-15, panel-review brief 3.1): optimize + rollback stay free
    // forever; Pro is paid depth, never a gate — an unscoped absolute must not return.
    for (const vow of [
      "rollback-first",
      "signed update checks; downloads need your click",
      "no kernel driver",
      "no game injection",
      "core free forever",
    ]) {
      expect(html).toContain(vow);
    }
  });

  it("free is above the fold (consumer-panel law: never footer-only knowledge)", () => {
    const freeAt = html.indexOf("Compy's core is free forever.");
    expect(freeAt).toBeGreaterThan(-1);
    expect(freeAt).toBeLessThan(html.indexOf('id="features"'));
  });

  it("replay HUD SSRs the REAL measured results and never a dead play button (doorknob law)", () => {
    // The island's build-time render is the measured summary — no-JS visitors get real content.
    expect(html).toContain("replay · real recorded session");
    expect(html).toContain(replay.avgFps.toFixed(1));
    expect(html).toContain(replay.low1FpsEst.toFixed(1));
    expect(html).toContain(replay.samples.toLocaleString("en-US"));
    expect(html).toContain("nothing attributed to Compy changes");
    // The ▶ control is hydration-gated: static markup must NOT carry a button that can't work.
    expect(rendered).not.toContain("replay the session");
    // Scrub mode (Director #5) is hydration-gated the same way: the runway class, the
    // timeline canvas, and the scrub affordance must never reach static/no-JS markup —
    // reduced-motion and no-JS visitors get the finished summary with no dead runway.
    expect(rendered).not.toMatch(/class="[^"]*record--scrub/);
    expect(rendered).not.toMatch(/class="[^"]*rhud-timeline/);
    expect(rendered).not.toContain("scroll scrubs the record");
    // The runway hooks the arming targets — both anchors must exist for scrub to arm.
    expect(html).toContain("data-record");
    expect(html).toContain("data-runway");
  });

  it("replay record is pinned to its provenance and contains no invented per-frame trace", () => {
    // session-replay.json must stay in lockstep with the audited session receipt.
    expect(replay.durationSecs).toBe(session.durationSecs);
    expect(replay.samples).toBe(session.samples);
    expect(replay.claim).toContain("no gain claim");
    // The replay animates ONLY true time data — this record carries no per-second series
    // (its source session was transcribed summary-only), so a series appearing here would
    // be untraceable to the record and must be rejected.
    for (const key of Object.keys(replay)) {
      if (Array.isArray(replay[key])) expect(key, "only the real event log may be an array").toBe("events");
    }
    expect(replay.events.length).toBeGreaterThan(0);
    for (const e of replay.events) {
      expect(e.atSecs).toBeGreaterThanOrEqual(0);
      expect(e.atSecs).toBeLessThanOrEqual(replay.durationSecs);
    }
  });

  it("flight trace (hero waveform) is a REAL series, internally consistent and honestly labeled", () => {
    const flight = JSON.parse(
      readFileSync(join(appDir, "src", "data", "flight-session.json"), "utf8"),
    );
    // The canvas may only ever draw real recorded data, labeled as exactly what it is.
    expect(flight.metric).toBe("per-second 1% low fps");
    expect(flight.series.length).toBe(flight.seriesPoints);
    expect(flight.series.length).toBe(flight.samples);
    // Declared min/max must match the actual series — a hand-edited value breaks lockstep.
    const values = flight.series.map(([, v]) => v);
    expect(Math.min(...values)).toBe(flight.seriesMin);
    expect(Math.max(...values)).toBe(flight.seriesMax);
    // Timestamps stay monotonic and inside the session window.
    let prev = -1;
    for (const [t] of flight.series) {
      expect(t).toBeGreaterThan(prev);
      expect(t).toBeLessThanOrEqual(flight.durationSecs);
      prev = t;
    }
    for (const e of flight.events) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeLessThanOrEqual(flight.durationSecs);
    }
    // The page must label the trace with its real metric, game, and record stats.
    expect(html).toContain("per-second 1% low fps");
    expect(html).toContain(flight.game);
    expect(html).toContain(flight.avgFps.toFixed(1));
    expect(html).toContain(flight.low1FpsEst.toFixed(1));
    expect(html).toContain(flight.samples.toLocaleString("en-US"));
  });

  it("receipts section is pinned to the real provenance records — including the published miss", () => {
    // Receipt A: the honest null result, from the real Lab trial record.
    expect(html).toContain(`±${proof.noiseFloorPct.toFixed(1)}% session noise floor`);
    expect(html).toContain("restored to the exact prior value");
    expect(proof.trial.rolledBack).toBe(true);
    expect(proof.ledgerEntryId).toMatch(/^[a-z-]+-\d+$/);
    expect(proof.recId).toBe(proof.ledgerEntryId.replace(/-\d+$/, ""));
    // Receipt B: the real session, claiming nothing as Compy's doing.
    expect(html).toContain("Compy claims none of it as its own doing");
  });

  it("known-fabricated copy never returns; no gain-claim phrasing anywhere", () => {
    expect(rendered).not.toContain("+8 fps");
    expect(rendered).not.toContain("an example receipt");
    expect(rendered).not.toContain("fast-startup-off");
    expect(rendered).not.toMatch(/[▲]\s*\d/);
    expect(rendered).not.toMatch(/\+\d+(\.\d+)?\s*(fps|%)/i);
    expect(rendered).not.toMatch(/\bboost/i);
    expect(rendered).not.toMatch(/\bfaster\b/i);
  });

  it("makes ZERO third-party requests: every URL is same-origin or compy.gg, fonts self-hosted", () => {
    // Absolute URLs are allowed ONLY for our own canonical/og metas.
    for (const m of html.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)) {
      expect(m[1], "external origin on the landing").toMatch(/^https:\/\/compy\.gg\//);
    }
    expect(html).not.toMatch(/@import|fonts\.googleapis|fonts\.gstatic|analytics|gtag|plausible|hotjar|turnstile|challenges\.cloudflare/i);
    expect(html).not.toMatch(/<img\b/); // no raster assets on the landing
    // Every <script src> is our own hashed bundle.
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
      expect(m[1]).toMatch(/^\/assets-app\//);
    }
    // The shipped JS makes no absolute-URL fetches and carries no tracker domains; the shipped
    // CSS pulls no remote fonts. (The only network call anywhere is the same-origin waitlist POST.)
    const assets = readdirSync(join(distDir, "assets-app"));
    for (const f of assets.filter((f) => f.endsWith(".js"))) {
      const js = readFileSync(join(distDir, "assets-app", f), "utf8");
      expect(js, `${f}: absolute-URL fetch`).not.toMatch(/fetch\(\s*["']https?:\/\//);
      expect(js, `${f}: tracker domain`).not.toMatch(/googletagmanager|google-analytics|plausible\.io|hotjar/i);
    }
    for (const f of assets.filter((f) => f.endsWith(".css"))) {
      expect(readFileSync(join(distDir, "assets-app", f), "utf8"), `${f}: remote url()`).not.toMatch(
        /url\(\s*["']?https?:/,
      );
    }
    // The ONE webfont is really self-hosted (Fontsource JetBrains Mono subsets in the bundle).
    expect(assets.some((f) => /jetbrains-mono.*\.woff2$/.test(f))).toBe(true);
  });

  it("waitlist is the REAL same-origin form with honest privacy copy; Ko-fi stays a placeholder", () => {
    expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\/api\/waitlist"/);
    expect(html).toMatch(/name="website"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*name="website"/);
    expect(html).toContain("stored only to send that one launch message");
    expect(html).toContain("The app itself sends nothing off your PC");
    expect(html).toMatch(/data-waitlist-status[^>]*role="status"|role="status"[^>]*data-waitlist-status/);
    expect(html).toContain("KO-FI PLACEHOLDER SLOT");
  });

  it("pricing teaser is honest: Pro has no price and nothing to click (doorknob law)", () => {
    const pro = /<article class="[^"]*pcard--pro[^"]*"[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "";
    expect(pro.length).toBeGreaterThan(0);
    expect(pro).toContain("No price yet");
    expect(pro).toContain("in the works");
    expect(pro).toContain("never be required to optimize");
    expect(pro).not.toMatch(/<button|btn--primary|href="#waitlist"/);
  });

  it("FAQ keeps the honesty lines (NVIDIA sensor confidence, no fps promises)", () => {
    expect((html.match(/<details/g) ?? []).length).toBeGreaterThanOrEqual(7);
    // LOCKED rule 5: NVIDIA sensor monitoring stays "implemented but not yet hardware-verified".
    expect(html).toContain("not yet hardware-verified");
    expect(html).toContain("We won't promise a number");
  });

  it("mobile viewport + og metas present; og:image absolute; canonical is compy.gg", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain('property="og:title"');
    expect(rendered).toMatch(/<meta property="og:image" content="https:\/\/compy\.gg\/[^"]*og\.png"/);
    expect(rendered).toContain('name="twitter:card"');
    expect(rendered).toMatch(/rel="canonical" href="https:\/\/compy\.gg/);
  });

  it("links the published legal pages from the footer", () => {
    expect(html).toMatch(/href="\/privacy\.html"/);
    expect(html).toMatch(/href="\/eula\.html"/);
    expect(html).toContain("Measured, not promised."); // the creed line
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
      // Absolute URLs allowed ONLY on our own origin (canonical/og plumbing). Contact URLs in
      // the prose still render as plain text, never <a href>; no third-party origin appears.
      for (const [, url] of page.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)) {
        expect(url, "absolute URL off our origin").toMatch(/^https:\/\/compy\.gg\//);
      }
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
    for (const [, url] of eula.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      expect(url, "still zero external origin").toMatch(/^https:\/\/compy\.gg\//);
    }
  });
});

// R6 Lane D guard: every COMMITTED top-level site/ page must (1) link Privacy + Terms in its
// footer, and (2) add zero external resource origins. The gitignored library/ pages render from
// the same page/debunk templates these pages exercise, so the templates are guarded.
describe("site-wide guard — footer legal links + zero external origins on every committed page", () => {
  const pages = readdirSync(join(root, "site"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => [f, readFileSync(join(root, "site", f), "utf8")]);

  it("finds the committed page set", () => {
    expect(pages.length, "curated debunks + legal").toBeGreaterThanOrEqual(10);
  });

  it("every page links Privacy + Terms in its footer", () => {
    for (const [name, html] of pages) {
      expect(html, `${name}: missing Privacy link`).toMatch(/href="(\.\/|\/)?privacy\.html"/);
      expect(html, `${name}: missing Terms link`).toMatch(/href="(\.\/|\/)?eula\.html"/);
    }
  });

  it("every page adds zero external resource origins (no external href/src, no remote <script>)", () => {
    for (const [name, html] of pages) {
      for (const [, url] of html.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)"/g)) {
        expect(url, `${name}: absolute URL off our origin`).toMatch(/^https:\/\/compy\.gg\//);
      }
      expect(html, `${name}: remote <script>`).not.toMatch(/<script\b[^>]*\bsrc=/);
    }
  });
});

// bug→guard (2026-07-13, kept from the R4a suite): a `padding:` SHORTHAND on a class that rides a
// .wrap element resets library.css's .wrap side padding (same specificity, later in the file) —
// page-edge overflow on mobile. Longhand padding-top/-bottom is the law for wrap-combined classes.
// (The Astro landing is immune by construction: its .wrap sets width+margin only, no padding.)
describe("template CSS guard — wrap-combined classes never clobber .wrap's side padding", () => {
  it("no wrap-combined class block uses a padding shorthand", () => {
    const css = readFileSync(join(root, "site", "library.css"), "utf8");
    const markup =
      readFileSync(join(root, "site", "src", "page.template.html"), "utf8") +
      readFileSync(join(root, "site", "src", "debunk.template.html"), "utf8");
    const combined = new Set(
      [...markup.matchAll(/class="wrap\s+([\w- ]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/)),
    );
    expect(combined.size).toBeGreaterThanOrEqual(2); // topbar + article at minimum
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(50); // the parse actually saw the stylesheet
    let checked = 0;
    for (const [, selectorList, body] of rules) {
      for (const cls of combined) {
        const targetsSelf = selectorList.split(",").some((sel) => {
          const subject = sel.trim().split(/[\s>+~]+/).pop() ?? "";
          return new RegExp(String.raw`\.${cls}(?![\w-])`).test(subject) && !subject.includes(":");
        });
        if (!targetsSelf) continue;
        checked++;
        expect(body, `.${cls} block uses a padding shorthand — it zeroes .wrap's side padding`)
          .not.toMatch(/(^|;|\s)padding\s*:/);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2); // .topbar/.article blocks were really examined
    // And the generated stylesheet must stay in sync with its source.
    expect(css).toBe(readFileSync(join(root, "site", "src", "library.css"), "utf8"));
  });
});
