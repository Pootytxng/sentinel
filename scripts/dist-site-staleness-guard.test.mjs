// @vitest-environment node
// bug→guard (Cowork audit 2026-07-11): the deploy staging tree dist-site/ shipped copy claiming
// "174 entries" while the live Blackbook held 191 — rebuilding dist-site from site/ was a manual,
// undocumented copy, so it silently went stale. Invariant: PUBLISHED entry counts derive from the
// live library data, never a hand-written or stale literal.
//   Guard A (always): every COMMITTED site/ page that states an entry count states the data's count.
//   Guard B (when dist-site/ exists): dist-site is a byte-exact, complete mirror of the current
//   staging set (site/ minus build tooling, plus the Astro landing overlay from site-app/dist,
//   plus functions/) with no stale extra pages.
// dist-site is regenerated ONLY via scripts/stage-dist-site.mjs (the fix that pairs with this guard).
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./lib/library-render.mjs";
import { STAGING_EXCLUDE, buildSiteApp } from "./stage-dist-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");
const distDir = join(root, "dist-site");
const functionsDir = join(root, "functions");

const { entries } = await loadLibrary();
const count = entries.length;

/** Recursively list files under dir as relative POSIX-ish paths. */
function walk(dir, base = dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(abs, base));
    else out.push(relative(base, abs).split(sep).join("/"));
  }
  return out;
}

describe("Guard A — committed site/ copy states the live library count", () => {
  const pages = walk(siteDir)
    .filter((f) => f.endsWith(".html") && !STAGING_EXCLUDE.has(f.split("/")[0]))
    .map((f) => [f, readFileSync(join(siteDir, f), "utf8")]);

  it("sanity: library data loaded and pages found", () => {
    expect(count).toBeGreaterThan(100);
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it(`every stated entry count equals the data count (${count})`, () => {
    for (const [name, html] of pages) {
      for (const m of html.matchAll(
        /(?:all (\d+) entries|Blackbook holds (\d+) graded entries|All (\d+) Compy Blackbook entries|(\d+) entries — the same library)/g,
      )) {
        const stated = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
        expect(stated, `${name}: states "${m[0]}" but the library holds ${count}`).toBe(count);
      }
    }
  });
});

// dist-site/ is a gitignored deploy artifact — absent on a fresh clone (nothing to guard),
// but when it EXISTS it is what `wrangler pages deploy dist-site` publishes, so it must be current.
describe.skipIf(!existsSync(distDir))(
  "Guard B — dist-site/ deploy staging tree mirrors the current source exactly",
  () => {
    // Expected staging set: site/ minus tooling, plus the Astro landing overlay (site-app/dist —
    // index.html + assets-app/, Mission Control makeover 2026-07-14), plus repo-root functions/.
    // Overlay entries are set AFTER site/ entries so on any name collision the Astro file wins,
    // matching stageDistSite's cpSync order. site-app/dist is gitignored — rebuild it with the
    // same command staging uses if it's absent, so the comparison is never against thin air.
    const siteAppDist = join(root, "site-app", "dist");
    if (!existsSync(siteAppDist)) buildSiteApp();
    const expected = new Map();
    for (const f of walk(siteDir)) {
      if (!STAGING_EXCLUDE.has(f.split("/")[0])) expected.set(f, join(siteDir, f));
    }
    for (const f of walk(siteAppDist)) expected.set(f, join(siteAppDist, f));
    for (const f of walk(functionsDir)) expected.set(`functions/${f}`, join(functionsDir, f));

    it("carries every expected file, byte-identical to the source (stale tree = fail)", () => {
      const missing = [];
      const differing = [];
      for (const [rel, src] of expected) {
        const staged = join(distDir, rel);
        if (!existsSync(staged)) missing.push(rel);
        else if (!readFileSync(src).equals(readFileSync(staged))) differing.push(rel);
      }
      expect(missing, `missing from dist-site (stale tree — rerun scripts/stage-dist-site.mjs): ${missing.slice(0, 5).join(", ")}`).toEqual([]);
      expect(differing, `differ from source (stale tree — rerun scripts/stage-dist-site.mjs): ${differing.slice(0, 5).join(", ")}`).toEqual([]);
    });

    it("contains no stale extra pages (files absent from the current staging set)", () => {
      const extras = walk(distDir).filter((f) => !expected.has(f));
      expect(extras, `stale leftovers in dist-site: ${extras.slice(0, 5).join(", ")}`).toEqual([]);
    });
  },
);
