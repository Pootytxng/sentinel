// Tests must resolve React's DEVELOPMENT export condition: React 19 only exports `act` there, and
// @testing-library/react needs it. If the launching shell exports NODE_ENV=production (the release
// and updater lanes do, and it leaks into any tool that inherits that environment), Vite resolves
// React's production build instead and EVERY render test dies with "React.act is not a function" -
// 637 assertions across 161 files, none of them a real defect. Pin it before Vite reads it.
// Proven 2026-08-01: same test, same tree - production => FAIL, development => PASS.
// Guarded by src/design/tokens-qpw-guard.test.ts ("the suite must actually run").
process.env.NODE_ENV = "test";
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // #515: the second file fails any test that walks the real tree or worktree fleet on less than
    // the measured TREE_WALK_TIMEOUT_MS (src/test/tree-walk-budget.ts). #563: it also fails any test
    // or hook that starts GIT_SPAWN_FLOOR or more git processes on less than GIT_SPAWN_TIMEOUT_MS.
    setupFiles: ["./src/test/setup.ts", "./scripts/lib/tree-walk-tripwire-setup.mjs"],
    css: false,
    // Don't scan gitignored local git worktrees (.claude/worktrees/wf_*) — they hold STALE frozen
    // snapshots of these very test files, so vitest would otherwise run duplicate/outdated copies and
    // report phantom failures. CI is unaffected (those dirs aren't committed); this only fixes local runs.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    // Heavier render tests (e.g. TweakEncyclopedia) can take 5–7s under full-suite CPU contention,
    // tripping the 5s default and flaking. Give them headroom — they pass in ~5s isolated.
    testTimeout: 15000,
    // Same failure mode one level up: a file whose SETUP or import is starved dies before any test
    // runs and reports as a bare file-level failure with no assertion to read. Seen on
    // scripts/export-library.test.mjs. The default is 10s.
    hookTimeout: 15000,
    // #339: rule C of scripts/handoff-worktree-truth.test.mjs needs one answer from origin (`git
    // ls-remote --heads`). Asked from inside the pool it competed with 400 files for the same cores,
    // lost its slice, and redded the gate as "origin unreachable" on an online machine. globalSetup
    // runs once in the main process before the pool exists; the answer reaches the worker through
    // provide/inject, and null (unreachable at setup) still fails closed there.
    // #457: a file argument that matches no test file is dropped silently, and the rest of the run
    // reports green. The filter guard refuses that run, and it goes FIRST so a refused run never
    // reaches origin.
    globalSetup: ["./scripts/lib/vitest-filter-guard.mjs", "./scripts/lib/vitest-global-setup.mjs"],
    // No `retry` here, deliberately. A different small set of files failed on nearly every run for
    // days — encoding-guard, export-library, release-transaction-e2e, ExperimentBench — each one
    // passing when re-run alone, which reads exactly like contention and is not: two test files
    // were booting their own nested vite dev servers inside the worker pool (see
    // scripts/lib/library-render.mjs `loadLibrary`, and the guard in
    // scripts/nested-vite-server-guard.test.mjs). Retries would have made that quieter, not fixed,
    // and quieter is how it survives another six months. Anything flaky here is a defect to find.
  },
});
