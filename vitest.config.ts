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
    setupFiles: ["./src/test/setup.ts"],
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
    // Worker cap (2026-08-11). Since the pre-push gate started running the full suite on the
    // developer's own 16-core machine, a small and DIFFERENT set of files failed on nearly every
    // gate run while passing every isolated re-run. The reported symptoms pointed at CPU starvation
    // and were not: the underlying error is one stalled Vite module fetch —
    //
    //   Error: transport invoke timed out after 60000ms
    //   (fetchModule "/src/data/tricks.zh-CN.json" from "src/data/knowledge.ts")
    //
    // Vitest's workers share ONE Vite module-runner transport. src/data/knowledge.ts pulls in the
    // large tricks/terms JSON, many test files import it, and with every worker demanding it at once
    // the transport can stall past its own 60s ceiling. Everything downstream then dies wearing a
    // disguise: export-library reports a bare file-level failure with no assertion, encoding-guard
    // reports "Test timed out in 15000ms" on a static content check that cannot actually flake.
    //
    // Capping workers is the lever that fits the cause — fewer simultaneous module requests on the
    // shared transport — rather than raising a timeout the stall already blows through by 4x.
    poolOptions: { forks: { maxForks: 8 }, threads: { maxThreads: 8 } },
    // And a bounded retry for what remains. Worth naming as the trade it is: retries can hide
    // genuine flakiness, and a test that only passes on attempt three is telling you something. It
    // earns its place because the alternative is worse — a gate that invents failures is a gate
    // people learn to pass with `--no-verify`, and then it protects nothing. Anything that fails
    // three times running is still red, which is exactly how the stall above was caught rather than
    // papered over.
    retry: 2,
  },
});
