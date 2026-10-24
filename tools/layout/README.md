# tools/layout — real-browser layout proofs

The vitest suite runs in jsdom, which has no layout engine: a CSS clamp proven there is proven by
reading the stylesheet's text. The tests here prove layout by **measuring boxes in a real Chromium**,
the engine WebView2 ships, so a cascade regression that only shows up in the renderer fails here.

## How it runs ($0, local, no new dependency)

1. `chromium.mjs` bundles a page with **esbuild** (already a dependency, as vite's bundler): the real
   component, the real CSS cascade (App.tsx's stylesheet imports in file order), Tauri IPC replaced by an
   inert stub plugin.
2. The bundle is served from `node:http` on an OS-chosen port.
3. The **machine's own Chrome or Edge** is launched headless with a throwaway profile and driven over
   the DevTools protocol with Node's built-in `WebSocket`. Nothing is downloaded or installed.
4. The test sets widths on the page, lets animations finish, and reads `getBoundingClientRect`,
   `scrollWidth` and the grid's used `grid-template-columns` back by value.

No Chromium on the machine means the proof is **BLOCKED, not passed**: `findChromium()` throws and the
test fails naming every path it tried. Point `COMPY_CHROMIUM` at a Chrome/Edge executable to override.

Why not a vite server: `scripts/nested-vite-server-guard.test.mjs` records that a vite server inside a
vitest worker deadlocks the pool. Why not under `src/`: `src/dom-mutation-census.test.ts` (PR #624)
scans `src/` for DOM writes, and a fixture that mounts a React root is not an app write.

## Tests

| File | Proves | Issue |
| --- | --- | --- |
| `hc-specs-grid-layout.test.mjs` | The Health tab's Detected tile (`.hc-specs-grid`) never scrolls horizontally and no `.hc-spec` card leaves its grid track, host widths 320–1600px and section widths 150–720px. Red on `minmax(230px, 1fr)`, green on `minmax(min(230px, 100%), 1fr)`. | #614, #624, #646 |
| `health-narrow-layout.test.mjs` | The real ShellV2 + Health room at window widths 380 / 504 / 684 / 1280 / 1500 / 1920: below 600px the rail is a ≤72px icon strip that still names every room and the bento stacks to one column; at 600px and up the rail stays 216px and the hero sits beside Findings; no tile's content box drops below 100px, nothing in a tile paints past it, and `.v2-content` never scrolls sideways. Red on 01b27929 (rail 216px everywhere, Findings 30px at 380). | #622 |
| `chromium-ownership-guard.test.mjs` | The harness itself, against fake resources (no browser needed): a setup that fails at any step, including a debug request, handshake or CDP command that never answers, releases every temp dir, listener, browser and debugger it acquired and never hangs; `close()` is idempotent, signals only its own still-running browser, retries a temp-dir removal refused for a moment and reports one that stays refused; the loopback server answers 404 for anything outside its directory (encoded sibling-prefix and parent escapes, and symlinks or junctions that land outside), malformed paths and directories. | #646 |

Fixture for it: `hc-specs-fixture.tsx` (the real `HomeConsole` with a long-model-string hardware
record) and `hc-specs-fixture.html` (the root attributes `src/main.tsx` sets, written statically).

Run one: `npx vitest run tools/layout`. The suite picks the folder up by vitest's default include.
