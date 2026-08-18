import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// FIXTURE PREVIEW SERVER — a SECOND Vite dev server, never the product one.
//
// WHY A SECOND SERVER. Two of the Lab bench's states cannot be reached on the owner's machine
// (see main.tsx). Feeding them fixture data means intercepting `invoke`, and in Tauri v2 that is
// impossible at runtime: `window.__TAURI_INTERNALS__` AND its `invoke` property are both
// {writable:false, configurable:false} — a deliberate anti-IPC-hijacking protection. A previous
// attempt to reassign it FAILED SILENTLY, which is worse than not working, because the preview
// still mounts and then quietly shows live data under a fixture banner.
//
// So the interception happens at BUILD time instead: this config aliases the one module the bench
// imports (`@tauri-apps/api/core`) to a stub. Nothing about Tauri's protection is touched or
// defeated — the real app's transport is left exactly as it is, and the app never loads this
// config. The alias CANNOT go in the product `vite.config.ts`: that would stub the real app.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// Two self-reviews in a row lost time to the same trap: `http://localhost:5199/` serves the REPO
// root's index.html — the REAL app — which mounts src/main.tsx, fails its first Tauri IPC call
// outside Tauri, and renders an ErrorBoundary that looks exactly like "the fixture is broken".
// The root is not movable (see below), so redirect the bare root to the fixture page instead.
const redirectRootToFixture = {
  name: "fixture-root-redirect",
  configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const [path, query] = String(req.url ?? "/").split("?");
      if (path !== "/" && path !== "/index.html") return next();
      res.statusCode = 302;
      res.setHeader("Location", `/docs/ui-sweep/fixture/index.html${query ? `?${query}` : ""}`);
      res.end();
    });
  },
};

export default defineConfig({
  // Root is the REPO root, not this folder, so `/src/...` resolves the way the app's own imports
  // expect. The page is served at /docs/ui-sweep/fixture/index.html.
  root: repoRoot,
  plugins: [react(), redirectRootToFixture],
  resolve: {
    alias: [
      // Anchored: `@tauri-apps/api/window`, `/event`, and the plugins must keep resolving to the
      // real packages, so a bare prefix alias would be wrong. Today the bench imports only /core;
      // if a future import reaches the backend by another path, it needs its own stub HERE rather
      // than a widened pattern — an over-broad alias hides which IPC a preview is faking.
      { find: /^@tauri-apps\/api\/core$/, replacement: resolve(here, "stub-core.ts") },
    ],
  },
  // Dep pre-bundling can resolve a bare specifier before `resolve.alias` is consulted, which would
  // route the bench straight back to the real IPC. Excluding the package keeps it on the alias.
  optimizeDeps: { exclude: ["@tauri-apps/api"] },
  // Its own cache, so running this never disturbs the product server's optimized deps.
  cacheDir: resolve(repoRoot, "node_modules/.vite-fixture"),
  clearScreen: false,
  server: {
    // 1420 is the app's; 1421 is Tauri's HMR socket. 5199 collides with neither.
    port: 5199,
    strictPort: true,
    open: false,
    watch: {
      // MUST NOT be dropped. `root` above is the REPO root, so the default watcher walks
      // `src-tauri/target/` — a multi-GB build tree cargo rewrites constantly. Watching it is not
      // merely wasteful: `cargo run` holds an exclusive lock on `target/debug/deps/compy_lib.dll`,
      // node's watcher throws EBUSY on it, and chokidar re-emits that as an 'error' event that
      // takes the whole dev server down with exit 1.
      //
      // That killed a real capture run: the fixture server died the moment the dev build started
      // compiling, and the review needs BOTH alive at once (the bench states come from this server,
      // the live rig-part click from the dev build). The failure also looks like a flake — the
      // server starts fine and dies minutes later, only when something else builds.
      ignored: ["**/src-tauri/target/**", "**/node_modules/**", "**/.git/**"],
    },
  },
});
