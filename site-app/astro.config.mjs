// compy.gg — Astro static build (Mission Control makeover).
// Static output only; zero third-party runtime requests (fonts self-hosted via Fontsource,
// all JS build-time bundled). Deploy stays owner-gated via scripts/stage-dist-site.mjs.
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://compy.gg",
  output: "static",
  integrations: [react()],
  build: {
    // Emit page assets under /assets-app/ so they never collide with the generator-owned
    // site/assets/ tree when stage-dist-site.mjs overlays this dist onto the site mirror.
    assets: "assets-app",
    inlineStylesheets: "auto",
  },
});
