// @vitest-environment node
// bug→guard (2026-08-11): no test file may boot its own vite dev server.
//
// scripts/lib/library-render.mjs `loadLibrary()` creates a real vite server (middleware mode) to
// load the app's own knowledge modules. Two TEST files called it, so on every run two extra vite
// servers came up inside the worker pool, alongside vitest's own module runner, each with its own
// esbuild service. One of the three would stop answering, and the failure wore a disguise:
//
//   Error: transport invoke timed out after 60000ms
//   (fetchModule "/src/data/tricks.zh-CN.json" from "src/data/knowledge.ts")
//
// It named a different 6 KB JSON every run, surfaced in a different set of unrelated test files
// every run, and every one of those files passed when re-run alone. That reads as "the suite is
// flaky under load" — and it cost days, a wrong CPU-starvation diagnosis, a pool swap and a retry
// setting that all missed, because the real cause was a nested server nobody was looking at.
//
// The invariant: tests get their data through the runner that is ALREADY running. Production paths
// (npm run export:library, site/generate.mjs) still use the real server and still cover it.
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every test file in the repo, excluding gitignored worktree snapshots (see vitest.config.ts). */
const testFiles = globSync("{src,scripts,site,tools}/**/*.test.{mjs,js,ts,tsx}", { cwd: root })
  .map((rel) => rel.split("\\").join("/"))
  .filter((rel) => !rel.includes("/.claude/"))
  .filter((rel) => !rel.endsWith("scripts/nested-vite-server-guard.test.mjs"));

const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("no test file boots its own vite server", () => {
  it("finds test files to check (the glob itself must not silently go empty)", () => {
    expect(testFiles.length).toBeGreaterThan(200);
  });

  it("no test imports createServer/build from vite", () => {
    const offenders = testFiles.filter((rel) => {
      const src = read(rel);
      return /\bfrom\s+["']vite["']/.test(src) && /\b(createServer|build)\b/.test(src);
    });
    expect(
      offenders,
      "A vite server booted inside a vitest worker deadlocks the pool — it stops answering " +
        "fetchModule and the failure surfaces in unrelated files. Load data through the runner " +
        "that is already running instead (see scripts/lib/library-render.mjs `importFromRepo`).",
    ).toEqual([]);
  });

  it("every test calling loadLibrary() injects a loader instead of taking the default server", () => {
    const offenders = [];
    for (const rel of testFiles) {
      const src = read(rel);
      for (const call of src.match(/loadLibrary\s*\([^)]*\)/g) ?? []) {
        if (!call.includes("load")) offenders.push(`${rel}: ${call}`);
      }
    }
    expect(
      offenders,
      "loadLibrary() with no argument creates a nested vite server. In tests, call " +
        "loadLibrary({ load: importFromRepo }) — same data, no second server.",
    ).toEqual([]);
  });
});

describe("the refusal that catches what grep cannot", () => {
  it("loadLibrary() with no loader refuses under vitest instead of deadlocking", async () => {
    const { loadLibrary } = await import("./lib/library-render.mjs");
    // The grep tests above only see DIRECT calls. exportLibrary() does `lib ??= await
    // loadLibrary()`, which is how this bug came back after the direct sites were fixed.
    await expect(loadLibrary()).rejects.toThrow(/vite server inside a vitest worker/);
  });

  // bug->guard, 2026-08-11. The refusal originally keyed on `process.env.VITEST`, and environment
  // variables are INHERITED by child processes: `node site/generate.mjs`, spawned by
  // scripts/site-seo.test.mjs, is a separate process where a vite server is the correct thing and
  // nothing can deadlock — but it inherited the marker and was refused. It only fired when the site
  // artifacts were stale, so the breakage arrived on an unrelated branch, days later, blocking a
  // push whose diff never touched the site.
  it("refuses by PROCESS, not by an environment variable a child would inherit", () => {
    const source = read("scripts/lib/library-render.mjs");
    expect(source).toMatch(/if \(globalThis\.__vitest_worker__\)/);
    expect(source, "process.env.VITEST is inherited by children and cannot answer 'am I in the pool?'")
      .not.toMatch(/if \(process\.env\.VITEST\)/);
  });

  it("a child process does not inherit the marker, even with VITEST set in its environment", async () => {
    const { execFileSync } = await import("node:child_process");
    const probe =
      "process.stdout.write(JSON.stringify({" +
      "env: Boolean(process.env.VITEST)," +
      "worker: Boolean(globalThis.__vitest_worker__)}))";
    const out = execFileSync(process.execPath, ["-e", probe], {
      encoding: "utf8",
      env: { ...process.env, VITEST: "true" },
    });
    // The two disagree in a child, which is exactly the case the old check got wrong.
    expect(JSON.parse(out)).toEqual({ env: true, worker: false });
  });
});

describe("the injected loader still resolves the real modules", () => {
  it("importFromRepo loads the knowledge module the exporter publishes from", async () => {
    const { importFromRepo, loadLibrary } = await import("./lib/library-render.mjs");
    const lib = await loadLibrary({ load: importFromRepo });
    // Same assertion the exporter depends on: a populated library with real ids.
    expect(Array.isArray(lib.entries)).toBe(true);
    expect(lib.entries.length).toBeGreaterThan(100);
    expect(lib.entries.every((e) => typeof e.id === "string" && e.id.length > 0)).toBe(true);
    expect(typeof lib.site.SITE_URL).toBe("string");
  });
});
