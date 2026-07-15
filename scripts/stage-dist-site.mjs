// Deploy-staging builder — the ONLY way dist-site/ gets (re)built. Born of the 2026-07-11 Cowork
// audit: dist-site was a manual copy that went stale (claimed 174 entries while the library held
// 191). This script makes staging deterministic: regenerate the site from live data, then clean-
// mirror it. Paired guard: scripts/dist-site-staleness-guard.test.mjs (fails on any stale tree).
//
// 2026-07-14 (Mission Control makeover): the LANDING moved out of site/ into the Astro app
// (site-app/ — spec 2026-07-14-site-makeover-research-spitball). Staging now builds BOTH halves:
//   site/generate.mjs  → curated debunks + full library + legal pages (site/, mirrored)
//   site-app/ (astro)  → the landing (index.html + /assets-app/), overlaid onto the mirror
// Astro's build.assets is "assets-app" so its hashed assets can never collide with the
// generator-owned site/assets/.
//
// BUILD TOOLING ONLY: dist-site/ is gitignored; building publishes nothing. DEPLOY IS OWNER-GATED —
// only on the owner's explicit "deploy": wrangler pages deploy dist-site --project-name compy
//
// Usage: node scripts/stage-dist-site.mjs   (npm run stage:site)

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// site/ files that are build tooling, not deploy artifacts. The staleness guard imports this set —
// keep it the single source of truth for what stays out of the published tree.
export const STAGING_EXCLUDE = new Set(["README.md", "debunks.config.json", "generate.mjs", "src"]);

/** Build the Astro landing (site-app/) and return its dist dir. Exported so the landing
 *  contract test can rebuild-if-stale against the same command staging uses. */
export function buildSiteApp() {
  const siteApp = join(root, "site-app");
  const astroBin = join(siteApp, "node_modules", "astro", "astro.js");
  if (!existsSync(astroBin)) {
    throw new Error("site-app dependencies missing — run `npm ci` inside site-app/ first");
  }
  const build = spawnSync(process.execPath, [astroBin, "build"], { cwd: siteApp, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`astro build failed (exit ${build.status})`);
  return join(siteApp, "dist");
}

export function stageDistSite() {
  // 1. Regenerate site/ content pages from the live library data (curated debunks, site/library/, legal).
  const gen = spawnSync(process.execPath, [join(root, "site", "generate.mjs")], { stdio: "inherit" });
  if (gen.status !== 0) throw new Error(`site/generate.mjs failed (exit ${gen.status})`);

  // 2. Build the landing from the Astro app.
  const appDist = buildSiteApp();

  // 3. Clean mirror: site/ (minus tooling) → dist-site/. A full rm+copy so deleted/renamed
  //    pages can never linger as stale deploy artifacts.
  const dist = join(root, "dist-site");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  for (const d of readdirSync(join(root, "site"), { withFileTypes: true })) {
    if (STAGING_EXCLUDE.has(d.name)) continue;
    cpSync(join(root, "site", d.name), join(dist, d.name), { recursive: true });
  }

  // 4. Overlay the Astro landing (index.html + assets-app/) onto the mirror, then the
  //    repo-root Pages Functions (the same-origin /api/waitlist endpoint).
  cpSync(appDist, dist, { recursive: true });
  cpSync(join(root, "functions"), join(dist, "functions"), { recursive: true });
  return dist;
}

const invokedAsMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  const dist = stageDistSite();
  console.log(`staged ${dist} — deploy stays owner-gated (wrangler pages deploy dist-site --project-name compy)`);
}
