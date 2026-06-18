import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Heavier render tests (e.g. TweakEncyclopedia) can take 5–7s under full-suite CPU contention,
    // tripping the 5s default and flaking. Give them headroom — they pass in ~5s isolated.
    testTimeout: 15000,
  },
});
