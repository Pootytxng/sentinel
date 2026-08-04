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
  },
});
