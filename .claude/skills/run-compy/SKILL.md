---
name: run-compy
description: >-
  Launch, attach to, drive, screenshot, or eval-probe the Compy desktop app
  (Tauri 2, gg.compy.app) via its existing CDP driver scripts. Use when asked
  to run Compy, take a screenshot of the app, click something in the live UI,
  read computed styles/DOM state, or otherwise interact with the running app
  rather than just its test suite. All paths below are relative to the repo
  root (the "unit" — this is a single-project repo).
---

# Running and driving Compy

Compy is a Tauri 2 desktop app: Rust backend (`src-tauri/`) + React/TS
frontend (`src/`), rendered in a WebView2 window. It is **driven over CDP**
(Chrome DevTools Protocol) using three existing, dep-free Node scripts in
`docs/ui-sweep/` — **use these, don't write a new driver.** They already
handle the one hard part (picking the MAIN app window over the small FPS
overlay window) and are the same scripts the `self-reviewer` subagent uses.

**Verified this session:** attached to a live running instance, captured a
real screenshot showing the fully-rendered Home dashboard (hardware panel,
3D rig view, Trust Ledger cards), and ran a live DOM eval that returned
`Compy — Performance Command Center | rails=4`. Both commands below are
copy-pasted from what was actually run, not inferred from docs.

## Prerequisites

- Node ≥21 (the driver scripts use only global `fetch` + `WebSocket`, no
  npm deps — check with `node --version`).
- `pwsh` (PowerShell 7+) for the resize helper — `powershell.exe` 5.1 mangles
  UTF-8 in some of this repo's scripts.
- A checkout with `node_modules` installed, **only if you need to launch a
  fresh instance** (see step 2 below). This worktree does not have
  `node_modules`; the main checkout (`C:\Users\Kuya\code\sentinel` per
  `CLAUDE.md`'s single-source-of-truth note) does.

## Run (agent path) — attach-or-launch, then drive

**Step 1 — check for an already-running instance first.** This project's
standing convention is to keep one `npm run tauri dev` running
(`[[live-dev-build-standing-workflow]]`), and Compy is single-instance (only
one `compy.exe` runs at a time). A concurrent worktree/lane may already own
the running instance — attach to it instead of killing it:

```bash
curl -s -m 3 http://127.0.0.1:9333/json
```

If this returns a JSON target list (look for `"title": "Compy — Performance
Command Center"`), something is already up on the project's conventional CDP
port (9333) — **skip straight to Step 3.** This is the common case and is
exactly what was verified this session (PID already running, port 9333
already live — no launch needed).

**Step 2 — only if Step 1 got connection-refused:** launch fresh, from a
checkout that has `node_modules`, with CDP enabled on port 9333:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" npm run tauri dev
```

(Not re-run this session — a live instance was already up on 9333, and
force-killing it to prove a fresh launch would have risked colliding with
whatever lane started it. See Gotchas.) `scripts/dev-relaunch.ps1` does the
same thing but **force-kills any running `compy.exe` first** — only use it
after confirming (Step 1) that nothing is already listening on 9333.

**Step 3 — (optional but recommended before screenshotting) resize the real
OS window to a consistent, native resolution:**

```powershell
pwsh docs/ui-sweep/resize-main.ps1
```

**Step 4 — screenshot the MAIN window** (auto-picked over the FPS overlay):

```bash
node docs/ui-sweep/cdp-shot.mjs 9333 /path/to/out.png
```

Actually open/Read the resulting PNG — a blank or error-page capture means
you're not done.

**Step 5 — drive it: read state, click, or eval JS** in the live page:

```bash
node docs/ui-sweep/cdp-eval.mjs 9333 "document.title + ' | rails=' + document.querySelectorAll('.cc-rail-item, .rail-item, .v2-nav-item').length"
# -> Compy — Performance Command Center | rails=4
```

For clicks/typing, eval a real DOM interaction, e.g.:
`document.querySelectorAll('.cc-rail-item')[1].click()` to switch rails, or
`getComputedStyle(document.querySelector('.some-class')).color` to check a
computed style (this is how `self-reviewer` proves accent-fill contrast).

For expressions too long/multi-line for a shell arg, write them to a file
and use the file variant instead:

```bash
node docs/ui-sweep/cdp-eval-file.mjs 9333 /path/to/expr.js
```

**Step 6 — stop cleanly.** Don't kill an instance you didn't launch
yourself (see Gotchas).

## Run (human path)

`npm run tauri dev` from a checkout with `node_modules` installed opens the
real window on screen. Useless for an agent (no way to see or click into
it) — that's the whole reason the CDP path above exists.

## Gotchas

- **Single-instance + concurrent lanes.** Only one `compy.exe` runs at a
  time, and this project routinely runs multiple worktree lanes in parallel.
  Before ever invoking `dev-relaunch.ps1` (which force-kills any running
  `compy.exe`), check `curl http://127.0.0.1:9333/json` first — if it
  answers, another lane likely owns that window mid-task. Attach, don't
  kill.
- **MAIN window vs. FPS overlay.** The app also runs a small FPS-overlay
  webview. Both driver scripts pick MAIN by checking for rail-nav elements
  (`.cc-rail-item, .rail-item, .v2-nav-item`) with 5×250ms retries — a
  backgrounded webview can transiently report 0 elements, so width is only a
  fallback tiebreak, never the primary signal. If you hit a tiny/wrong
  screenshot on a very fresh cold launch, wait a few seconds (sidebar not
  mounted yet) and retry.
- **Native-resolution capture.** WebView2's CDP `Emulation.setDeviceMetricsOverride`
  lies about layout on a small window. Resize the *real* OS window first
  (`resize-main.ps1`, Win32 `MoveWindow` to 1500×980) before screenshotting,
  don't trust a viewport override.
- **This worktree has no `node_modules`.** A fresh launch (Step 2) must run
  from a checkout with deps installed — don't try it here.
- **`powershell.exe` 5.1 vs `pwsh`.** Use `pwsh`, not `powershell`, for the
  `.ps1` scripts in this repo — 5.1 mangles UTF-8 em-dashes some of them
  contain.

## Troubleshooting

- `curl: (7) Failed to connect` on port 9333 → nothing has CDP enabled;
  either attach to whatever port an already-running dev instance used, or
  launch fresh per Step 2.
- `cdp-eval.mjs` prints `EXCEPTION: ...` → your expression threw; the
  printed JSON is `exceptionDetails` from `Runtime.evaluate`.
- Screenshot shows the tiny FPS-overlay window, not the dashboard → see the
  MAIN-window Gotcha above; retry after a short wait.

## Related skills

- `self-review` — the forced visual-QA rubric for UI changes; dispatches to
  the `self-reviewer` subagent, which uses these same driver scripts
  internally plus a full evidence rubric. Use that instead of this skill
  when the task is "review a UI change I just made," not "drive the app."
- `ship` — build → `scripts/ship-reinstall.ps1` → verify via
  `get_build_stamp` over CDP. Use that instead of this skill when the task
  is "ship this build to the owner's Desktop install," not "interact with a
  dev instance."
