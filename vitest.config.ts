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
