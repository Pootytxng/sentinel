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
// BUILD TOOLING ONLY: dist-site/ is gitignored; building publishes nothing. Deploy is autonomous
// since the owner's deploy GO (BACKLOG Cycle 2026-07-15c superseded the old owner-gate):
// wrangler pages deploy dist-site --project-name compy
//
// Usage: node scripts/stage-dist-site.mjs   (npm run stage:site)

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteApp = join(root, "site-app");

// site/ files that are build tooling, not deploy artifacts. The staleness guard imports this set —
// keep it the single source of truth for what stays out of the published tree.
export const STAGING_EXCLUDE = new Set(["README.md", "debunks.config.json", "generate.mjs", "src"]);

// ---------------------------------------------------------------------------------------------
// ONE astro build at a time, per checkout. bug→guard #171 (2026-08-20).
//
// Three test files rebuild site-app/dist when it is stale, and vitest runs them in separate
// worker processes at the same moment. Two `astro build`s in the SAME dist/ collide: astro
// writes its SSR bundle (renderers.mjs, manifest_*.mjs) into dist/, renders the static pages,
// then deletes the bundle — so the first build to finish deletes the second build's
// intermediates out from under it. The second dies with "Cannot find module dist/renderers.mjs"
// and, because Node 24 on Windows aborts inside process.exit() while an async handle is still
// closing (nodejs/node#56645, unfixed upstream), the exit code is not 1 but 0xC0000409 /
// 3221226505 — STATUS_STACK_BUFFER_OVERRUN, a crash that looks like memory corruption and has
// nothing to do with the code under test. Reproduced on demand: three concurrent builds → two
// crash; the leftover manifest_*.mjs files in dist/ after a "green" run are the same collision
// seen from the side that won.
//
// The fix is a cross-process lock (an atomic mkdir, the oldest lock there is) around every
// build, with the freshness check INSIDE the lock: the worker that wins builds, the workers
// that waited find a fresh dist and skip. Pinned by scripts/site-build-collision-guard.test.mjs.
// ---------------------------------------------------------------------------------------------

const SITE_APP_DIST = join(siteApp, "dist");
// Inside node_modules so it is never a tracked file and cannot survive an `npm ci` that
// replaced the tree; node_modules/ must exist anyway for astro to.
const SITE_BUILD_LOCK_DIR = join(siteApp, "node_modules", ".compy-site-build.lock");

/** Outputs that prove a complete static build, and the inputs that make one stale. */
const SITE_APP_OUTPUTS = [join("index.html"), join("compare", "index.html")];
const SITE_APP_INPUTS = ["src", "public", "astro.config.mjs", "package.json"];

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but is not ours to signal — still alive.
    return e.code === "EPERM";
  }
}

function readLockOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Run `fn` while holding the per-checkout site build lock. Serialises across PROCESSES (vitest
 * workers, a parallel `npm run stage:site`, anything), not just within one. A lock whose owner
 * pid is gone, or that is older than `staleMs`, is a crashed holder and gets reclaimed — the
 * astro build this protects takes ~2s, so a minutes-old lock is never a live one. Options exist
 * for the guard test only.
 */
export function withSiteBuildLock(
  fn,
  { lockDir = SITE_BUILD_LOCK_DIR, timeoutMs = 180_000, staleMs = 300_000, pollMs = 50 } = {},
) {
  const started = Date.now();
  mkdirSync(dirname(lockDir), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const owner = readLockOwner(lockDir);
    let ageMs;
    try {
      ageMs = Date.now() - statSync(lockDir).mtimeMs;
    } catch {
      continue; // vanished between our mkdir and stat — try again
    }
    const orphaned = owner !== null && !pidAlive(owner.pid);
    if (orphaned || ageMs > staleMs) {
      rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `site build lock held for over ${timeoutMs}ms by pid ${owner?.pid ?? "unknown"} (${lockDir}) — ` +
          "a live astro build takes seconds; if nothing is building, delete the lock dir",
      );
    }
    sleepSync(pollMs);
  }
  try {
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  for (const name of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, name)));
  return newest;
}

/** True when every expected output exists and none is older than the newest input. `appDir`
 *  is a parameter for the guard test; production always asks about site-app/. */
export function siteAppDistIsFresh(appDir = siteApp) {
  const dist = join(appDir, "dist");
  let oldestOutput = Number.POSITIVE_INFINITY;
  for (const rel of SITE_APP_OUTPUTS) {
    const p = join(dist, rel);
    if (!existsSync(p)) return false;
    oldestOutput = Math.min(oldestOutput, statSync(p).mtimeMs);
  }
  const newestInput = Math.max(...SITE_APP_INPUTS.map((rel) => newestMtime(join(appDir, rel))));
  return oldestOutput >= newestInput;
}

function runAstroBuild() {
  const astroBin = join(siteApp, "node_modules", "astro", "astro.js");
  if (!existsSync(astroBin)) {
    throw new Error("site-app dependencies missing — run `npm ci` inside site-app/ first");
  }
  const build = spawnSync(process.execPath, [astroBin, "build"], { cwd: siteApp, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`astro build failed (exit ${build.status})`);
  return SITE_APP_DIST;
}

/** Build the Astro landing (site-app/) unconditionally and return its dist dir. Staging uses
 *  this; TESTS must use ensureSiteAppBuilt so a fresh dist is reused instead of rebuilt. */
export function buildSiteApp() {
  return withSiteBuildLock(runAstroBuild);
}

/** The test-side entry: rebuild site-app/dist only if it is stale, under the lock, so any number
 *  of vitest workers asking at once produce exactly one build. Returns the dist dir. */
export function ensureSiteAppBuilt() {
  return withSiteBuildLock(() => (siteAppDistIsFresh() ? SITE_APP_DIST : runAstroBuild()));
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
  console.log(`staged ${dist} — deploy with: wrangler pages deploy dist-site --project-name compy`);
}
