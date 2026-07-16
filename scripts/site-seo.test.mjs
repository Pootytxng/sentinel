// @vitest-environment node
// SEO / launch-plumbing contract for compy.gg (site completion train, 2026-07-15).
// Guards the layer BETWEEN the landing contract (site-landing.test.mjs) and the staging
// composition guard (dist-site-staleness-guard.test.mjs): robots + sitemap, canonicals,
// favicons, the 404 page, the /compare page, and the honesty rules that bind them
// (no fabricated lastmod/ratings, no off-origin absolute URLs, picks canonicalized once).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteApp } from "./stage-dist-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const appDir = join(root, "site-app");
const distDir = join(appDir, "dist");

// ---------- regenerate-if-stale: judge the generator's real output, never a stale tree ----------
function newestMtime(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const name of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, name)));
  return newest;
}
const genNewest = Math.max(
  newestMtime(join(siteDir, "generate.mjs")),
  newestMtime(join(siteDir, "debunks.config.json")),
  newestMtime(join(siteDir, "src")),
);
const sitemapPath = join(siteDir, "sitemap.xml");
if (
  !existsSync(sitemapPath) ||
  !existsSync(join(siteDir, "library", "index.html")) ||
  statSync(sitemapPath).mtimeMs < genNewest
) {
  execFileSync("node", [join(siteDir, "generate.mjs")], { stdio: "inherit" });
}

const picks = JSON.parse(readFileSync(join(siteDir, "debunks.config.json"), "utf8")).picks;
const ORIGIN = "https://compy.gg";

describe("robots + sitemap", () => {
  const robots = readFileSync(join(siteDir, "robots.txt"), "utf8");
  const sitemap = readFileSync(sitemapPath, "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("robots allows everything and points at the sitemap", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("every sitemap URL is on our origin and the core routes are present", () => {
    expect(locs.length).toBeGreaterThan(150); // landing + compare + picks + library + legal
    for (const loc of locs) expect(loc, "off-origin sitemap URL").toMatch(/^https:\/\/compy\.gg\//);
    for (const route of ["/", "/compare", "/library/", "/privacy", "/eula"]) {
      expect(locs, `missing ${route}`).toContain(`${ORIGIN}${route}`);
    }
  });

  it("picks are listed ONCE, at top level — never duplicated under /library/", () => {
    for (const id of picks) {
      expect(locs, `pick ${id} missing at top level`).toContain(`${ORIGIN}/${id}`);
      expect(locs, `pick ${id} duplicated under /library/`).not.toContain(`${ORIGIN}/library/${id}`);
    }
  });

  it("carries no fabricated freshness or priority metadata (honesty law)", () => {
    expect(sitemap).not.toMatch(/<lastmod>|<priority>|<changefreq>/);
  });
});

describe("favicons", () => {
  it("favicon.svg is the bracket mark on brand tokens", () => {
    const svg = readFileSync(join(siteDir, "favicon.svg"), "utf8");
    expect(svg).toContain("viewBox");
    expect(svg).toContain("#ff9a1e"); // accent brackets
    expect(svg).toContain("#050403"); // bg tile
  });
  it("favicon.ico is a real ICO", () => {
    const ico = readFileSync(join(siteDir, "favicon.ico"));
    expect(ico.length).toBeGreaterThan(0);
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]); // ICO magic
  });
});

describe("canonicals on generated pages", () => {
  it("committed pick pages canonicalize to the top-level route", () => {
    for (const id of picks) {
      const page = readFileSync(join(siteDir, `${id}.html`), "utf8");
      expect(page, `${id} canonical`).toContain(`<link rel="canonical" href="${ORIGIN}/${id}" />`);
      expect(page, `${id} og:url`).toContain(`<meta property="og:url" content="${ORIGIN}/${id}" />`);
      expect(page, `${id} og:image`).toContain(`content="${ORIGIN}/assets/og.png"`);
      expect(page, `${id} twitter card`).toContain('name="twitter:card" content="summary_large_image"');
      expect(page, `${id} JSON-LD`).toContain('"@type":"TechArticle"');
    }
  });

  it("a pick's LIBRARY copy canonicalizes UP to the top-level page (no duplicate-content split)", () => {
    for (const id of picks) {
      const page = readFileSync(join(siteDir, "library", `${id}.html`), "utf8");
      expect(page, `library/${id} canonical`).toContain(`<link rel="canonical" href="${ORIGIN}/${id}" />`);
    }
  });

  it("a non-pick library page canonicalizes to itself under /library/", () => {
    const nonPick = readdirSync(join(siteDir, "library"))
      .filter((f) => f.endsWith(".html") && f !== "index.html")
      .map((f) => f.replace(/\.html$/, ""))
      .find((id) => !picks.includes(id));
    expect(nonPick, "no non-pick library entry found").toBeTruthy();
    const page = readFileSync(join(siteDir, "library", `${nonPick}.html`), "utf8");
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}/library/${nonPick}" />`);
  });

  it("library index and legal pages carry their canonical routes", () => {
    expect(readFileSync(join(siteDir, "library", "index.html"), "utf8")).toContain(
      `<link rel="canonical" href="${ORIGIN}/library/" />`,
    );
    expect(readFileSync(join(siteDir, "privacy.html"), "utf8")).toContain(
      `<link rel="canonical" href="${ORIGIN}/privacy" />`,
    );
    expect(readFileSync(join(siteDir, "eula.html"), "utf8")).toContain(
      `<link rel="canonical" href="${ORIGIN}/eula" />`,
    );
  });
});

describe("404 page", () => {
  const page = readFileSync(join(siteDir, "404.html"), "utf8");
  it("is noindex, self-contained, and routes home with root-absolute links", () => {
    expect(page).toContain('name="robots" content="noindex"');
    expect(page).toContain("TRACE&nbsp;//&nbsp;404"); // nbsp keeps the kicker on one line
    expect(page).toContain('href="/"');
    expect(page).toContain('href="/library/"');
    expect(page).toContain('href="/privacy.html"');
    expect(page).toContain('href="/eula.html"');
    expect(page).not.toMatch(/<script\b/); // static by design — no JS on the error page
  });
});

describe("compare page + landing plumbing (dist)", () => {
  // Same build-if-stale rule as site-landing.test.mjs: judge what would deploy.
  const srcNewest = Math.max(
    newestMtime(join(appDir, "src")),
    newestMtime(join(appDir, "astro.config.mjs")),
    newestMtime(join(appDir, "package.json")),
  );
  const comparePath = join(distDir, "compare", "index.html");
  if (!existsSync(comparePath) || statSync(comparePath).mtimeMs < srcNewest) buildSiteApp();
  const compare = readFileSync(comparePath, "utf8");
  const compareRendered = compare.replace(/<!--[\s\S]*?-->/g, "");
  const landing = readFileSync(join(distDir, "index.html"), "utf8");

  it("compare exists at /compare with its canonical and the five practice axes", () => {
    expect(compare).toContain(`rel="canonical" href="${ORIGIN}/compare"`);
    for (const axis of ["ROLLBACK", "KERNEL &amp; ANTI-CHEAT", "CATALOG TRANSPARENCY", "TELEMETRY DEFAULT", "COST MODEL"]) {
      expect(compare, `missing axis ${axis}`).toContain(axis);
    }
    expect(compare).toContain("THE USUAL PLAYBOOK");
    expect(compare).toContain("THE TRADEOFF WE ACCEPT");
  });

  it("compare never names a competitor and never fabricates a performance number", () => {
    // Council law: construction axes only. Ban the hype vocabulary and invented gains.
    expect(compareRendered).not.toMatch(/\bboost/i);
    expect(compareRendered).not.toMatch(/\bfaster\b/i);
    expect(compareRendered).not.toMatch(/\+\d+\s*(fps|%)/i);
    // The usual suspects a comparison page would be tempted to name.
    for (const name of ["CCleaner", "Razer Cortex", "Wise Care", "Advanced SystemCare", "Hone", "ExitLag"]) {
      expect(compareRendered, `names competitor ${name}`).not.toContain(name);
    }
  });

  it("compare routes back into the funnel (Blackbook + waitlist)", () => {
    expect(compare).toContain('href="/library/"');
    expect(compare).toContain('href="/#waitlist"');
  });

  it("landing links to /compare (nav + FAQ) and carries the honest JSON-LD + twitter image", () => {
    expect(landing).toContain('href="/compare"');
    expect(landing).toContain('"@type":"SoftwareApplication"');
    expect(landing).toContain('"name":"Compy"');
    expect(landing).not.toMatch(/aggregateRating|reviewCount|ratingValue/); // never fabricate reviews
    expect(landing).toContain('name="twitter:image" content="https://compy.gg/assets/og.png"');
  });
});
