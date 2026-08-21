// @vitest-environment node
// bug→guard #171 (2026-08-20): the pre-push gate "invented" failures under concurrent lane load —
// two 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) crashes in three runs of a byte-identical tree.
//
// Root cause, reproduced on demand: three test files each rebuilt site-app/dist when it looked
// stale, from three vitest worker processes at once. Two `astro build`s in the same dist/ race —
// the first to finish deletes the SSR intermediates (renderers.mjs, manifest_*.mjs) the second is
// still reading, the second dies with "Cannot find module dist/renderers.mjs", and Node 24 on
// Windows turns that process.exit(1) into a libuv abort (nodejs/node#56645), so the child reports
// 3221226505 instead of 1. The crash wore the costume of memory corruption; it was two builds in
// one directory.
//
// The fix: every astro build goes through ONE cross-process lock, and the freshness check runs
// inside it, so the worker that wins builds and the rest reuse the result. This file pins each
// half mechanically, with a real multi-process race, not a source grep alone.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reclaimLock, siteAppDistIsFresh, withSiteBuildLock } from "./stage-dist-site.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperUrl = pathToFileURL(join(root, "scripts", "stage-dist-site.mjs")).href;

let scratch;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "compy-site-lock-"));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A child that takes the lock, records [enter, exit] wall-clock ms into a per-child file while
 *  holding it for `holdMs`, then exits. Plain node, no vitest — the lock must work anywhere. */
function lockHolderScript(lockDir, recordPath, holdMs) {
  return `
    import { withSiteBuildLock } from ${JSON.stringify(helperUrl)};
    import { writeFileSync } from "node:fs";
    withSiteBuildLock(() => {
      const enter = Date.now();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs});
      writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify([enter, Date.now()]));
    }, { lockDir: ${JSON.stringify(lockDir)}, pollMs: 10 });
  `;
}

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => resolve({ code, err }));
  });
}

describe("the site build lock serialises across processes", () => {
  it("four processes contending for the lock never hold it at the same time, and all four get it", async () => {
    const lockDir = join(scratch, "race", "node_modules", ".lock");
    const records = [0, 1, 2, 3].map((i) => join(scratch, `race-${i}.json`));
    const results = await Promise.all(records.map((r) => runNode(lockHolderScript(lockDir, r, 150))));
    for (const { code, err } of results) expect(code, err).toBe(0);

    const spans = records.map((r) => JSON.parse(readFileSync(r, "utf8"))).sort((a, b) => a[0] - b[0]);
    expect(spans).toHaveLength(4);
    for (let i = 1; i < spans.length; i++) {
      const [, prevExit] = spans[i - 1];
      const [enter] = spans[i];
      expect(enter, `holder ${i} entered before holder ${i - 1} left — two astro builds in one dist/`).toBeGreaterThanOrEqual(prevExit);
    }
  }, 30_000);

  it("releases the lock even when the protected build throws", () => {
    const lockDir = join(scratch, "throws", ".lock");
    expect(() => withSiteBuildLock(() => { throw new Error("astro build failed"); }, { lockDir })).toThrow(/astro build failed/);
    // A second taker must not wait on a ghost: it gets the lock immediately.
    const t0 = Date.now();
    expect(withSiteBuildLock(() => "ran", { lockDir, timeoutMs: 2_000 })).toBe("ran");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("reclaims a lock whose owner process is gone instead of waiting for a timeout", () => {
    const lockDir = join(scratch, "orphan", ".lock");
    mkdirSync(lockDir, { recursive: true });
    // A pid no live process can have: the max Windows pid is well below this.
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: 2_147_483_000, at: "2026-08-20T00:00:00Z" }));
    const t0 = Date.now();
    expect(withSiteBuildLock(() => "reclaimed", { lockDir, timeoutMs: 5_000 })).toBe("reclaimed");
    expect(Date.now() - t0, "an orphaned lock should be reclaimed on the first poll").toBeLessThan(1_000);
  });

  it("reclaims a lock older than staleMs even if its owner file is unreadable", () => {
    const lockDir = join(scratch, "stale", ".lock");
    mkdirSync(lockDir, { recursive: true });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lockDir, old, old);
    expect(withSiteBuildLock(() => "reclaimed", { lockDir, timeoutMs: 5_000, staleMs: 300_000 })).toBe("reclaimed");
  });

  it("gives up with a named owner when a live holder never releases", () => {
    const lockDir = join(scratch, "held", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    expect(() => withSiteBuildLock(() => "never", { lockDir, timeoutMs: 200, pollMs: 20 })).toThrow(
      new RegExp(`held for over 200ms by pid ${process.pid}`),
    );
    rmSync(lockDir, { recursive: true, force: true });
  });
});

// bug→guard 2026-08-20: the four-process race above caught this about one run in six — a contender
// judged holder A dead from an owner.json it had read BEFORE A released and exited, and by the time
// it deleted "A's" dir, holder B had already taken the name and written its own owner.json. The
// race test can only catch that by luck; these pin the exact interleaving deterministically by
// handing reclaimLock a judgement made against an earlier incarnation.
describe("a reclaim deletes only the incarnation that was judged dead", () => {
  const dead = { pid: 2_147_483_000, at: "2026-08-20T00:00:00Z" }; // no such pid on any Windows box
  const deadText = JSON.stringify(dead);

  it("never deletes a live lock that replaced the dead one it judged (the caught collision)", () => {
    const lockDir = join(scratch, "replaced", ".lock");
    mkdirSync(lockDir, { recursive: true });
    const live = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
    writeFileSync(join(lockDir, "owner.json"), live);
    // The contender's judgement was about `deadText`; the dir now belongs to a live holder.
    expect(reclaimLock(lockDir, deadText, { staleMs: 300_000 })).toBe(false);
    expect(existsSync(lockDir), "the live holder's lock dir must still be there").toBe(true);
    expect(readFileSync(join(lockDir, "owner.json"), "utf8"), "…with its owner untouched").toBe(live);
    expect(readdirSync(dirname(lockDir)).filter((n) => n.includes(".reclaim-")), "nothing moved aside").toEqual([]);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("does reclaim the judged dead incarnation itself", () => {
    const lockDir = join(scratch, "dead", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), deadText);
    expect(reclaimLock(lockDir, deadText, { staleMs: 300_000 })).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
    expect(readdirSync(dirname(lockDir)).filter((n) => n.includes(".reclaim-"))).toEqual([]);
  });

  it("a stale judgement about an ownerless dir does not touch a fresh ownerless dir (a holder mid-publish)", () => {
    const lockDir = join(scratch, "fresh-empty", ".lock");
    mkdirSync(lockDir, { recursive: true }); // mkdir done, owner.json not written yet
    expect(reclaimLock(lockDir, null, { staleMs: 300_000 })).toBe(false);
    expect(existsSync(lockDir)).toBe(true);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("a stale ownerless dir is reclaimed", () => {
    const lockDir = join(scratch, "old-empty", ".lock");
    mkdirSync(lockDir, { recursive: true });
    const old = new Date(Date.now() - 600_000);
    utimesSync(lockDir, old, old);
    expect(reclaimLock(lockDir, null, { staleMs: 300_000 })).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("two contenders judging the same dead lock cannot both take it", () => {
    // Atomic take: once one rename has moved the dir, the other's must fail and report "not yours".
    const lockDir = join(scratch, "double", ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.json"), deadText);
    const first = reclaimLock(lockDir, deadText, { staleMs: 300_000 });
    const second = reclaimLock(lockDir, deadText, { staleMs: 300_000 });
    expect([first, second]).toEqual([true, false]);
  });
});

describe("freshness is judged on every output against every input", () => {
  function fakeApp(name) {
    const app = join(scratch, name);
    for (const d of ["src", "public", "dist/compare"]) mkdirSync(join(app, d), { recursive: true });
    const t = (ms) => new Date(Date.now() - ms);
    const write = (rel, ageMs) => {
      const p = join(app, rel);
      writeFileSync(p, rel);
      utimesSync(p, t(ageMs), t(ageMs));
    };
    write("src/index.astro", 60_000);
    write("public/robots.txt", 60_000);
    write("astro.config.mjs", 60_000);
    write("package.json", 60_000);
    write("dist/index.html", 30_000);
    write("dist/compare/index.html", 30_000);
    return { app, write };
  }

  it("a dist newer than every input is fresh", () => {
    const { app } = fakeApp("fresh");
    expect(siteAppDistIsFresh(app)).toBe(true);
  });

  it("a newer source, public asset, config or manifest makes it stale", () => {
    for (const rel of ["src/index.astro", "public/robots.txt", "astro.config.mjs", "package.json"]) {
      const { app, write } = fakeApp(`stale-${rel.replace(/[/.]/g, "_")}`);
      write(rel, 0);
      expect(siteAppDistIsFresh(app), `${rel} newer than dist must read as stale`).toBe(false);
    }
  });

  it("a missing page is stale even when the landing is current (the /compare half-build case)", () => {
    const { app } = fakeApp("half");
    rmSync(join(app, "dist", "compare"), { recursive: true, force: true });
    expect(siteAppDistIsFresh(app)).toBe(false);
  });
});

describe("no test rebuilds the site on its own", () => {
  const testFiles = globSync("{src,scripts,site,tools}/**/*.test.{mjs,js,ts,tsx}", { cwd: root })
    .map((rel) => rel.split("\\").join("/"))
    .filter((rel) => !rel.includes("/.claude/"))
    .filter((rel) => !rel.endsWith("scripts/site-build-collision-guard.test.mjs"));

  it("finds test files to check (the glob itself must not silently go empty)", () => {
    expect(testFiles.length).toBeGreaterThan(200);
  });

  it("no test file calls buildSiteApp (unconditional) or spawns astro build — ensureSiteAppBuilt is the only door", () => {
    const offenders = testFiles.filter((rel) => {
      const src = readFileSync(join(root, rel), "utf8");
      return /\bbuildSiteApp\s*\(/.test(src) || /astro(\.js)?["'`,\s]+(?:,\s*)?["'`]?build\b/.test(src);
    });
    expect(
      offenders,
      "Two astro builds in one site-app/dist delete each other's intermediates and crash with " +
        "0xC0000409 (#171). Tests call ensureSiteAppBuilt() from scripts/stage-dist-site.mjs, " +
        "which builds once, under the cross-process lock, only when dist is stale.",
    ).toEqual([]);
  });

  it("every production builder path holds the lock", () => {
    const src = readFileSync(join(root, "scripts", "stage-dist-site.mjs"), "utf8");
    // The raw spawn lives in exactly one private function, and both exported builders wrap it in the lock.
    expect(src.match(/spawnSync\(process\.execPath, \[astroBin, "build"\]/g)).toHaveLength(1);
    expect(src).toMatch(/export function buildSiteApp\(\) \{\s*return withSiteBuildLock\(runAstroBuild\);/);
    expect(src).toMatch(/export function ensureSiteAppBuilt\(\) \{\s*return withSiteBuildLock\(\(\) => \(siteAppDistIsFresh\(\) \? SITE_APP_DIST : runAstroBuild\(\)\)\);/);
  });
});
