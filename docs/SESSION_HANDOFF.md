# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template in git history.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

Worktree `.claude/worktrees/admiring-lumiere-648403`, branch
`claude/compy-foreground-courtesy-rebuild-60b17e`, which carries `origin/main` `5a982647` in its
own history.
PR [#102](https://github.com/Pootytxng/sentinel/pull/102) — OPEN, pre-push gate `LOCAL CHECK
RESULT: PASS`. It closes three handoffs at once (PR #90 recovery, the #100 redo, and the
foreground-courtesy ask).

## What this lane did

### 1 · The quiet launch, rebuilt where it can actually work

PR #100's mechanism was inert — `focus = false` through `context.config_mut()` does not survive to
window creation. #100 is **CLOSED**; this is the replacement, not a patch.

- The window is built with `WebviewWindowBuilder` and shown via `SW_SHOWNOACTIVATE`: visible, on the
  taskbar, clickable — it just never takes activation. Hidden would be a worse bug than the one fixed.
- Intent crosses the single-instance boundary as `--no-activate` argv, so a *relaunch* is quiet too;
  `tray::show_or_recreate_main` no longer focuses unconditionally.
- `should_suppress_activation` + its five unit tests kept verbatim — the predicate was never the bug.
- `scripts/launch-focus-guard.test.mjs` has a **RUNTIME tier**: a `GetForegroundWindow` poller across
  a real launch, plus a self-test proving the probe can still SEE an activating launch. It skips by
  name when a compy is already running (single-instance would make it measure the OLD window) and
  fails instead under `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF`.

### 2 · PR #90 recovery, P1–P4 — all four re-proven and repaired

- **P1** Selection now carries a typed `RigSelection` for parts, user-added parts AND fans, so the
  Lab evidence map answers for all three of its clickable lists (it answered for one).
- **P2** Ghost-fan shadowing released only *undetected* ghosts; a detected CPU fan could occlude the
  CPU. Fixed + regression coverage.
- **P3** The hologram was pointer-only (meshes, not DOM). It now has a real keyboard route: one
  native `<button>` per part, built from the same `rigInventory` the meshes come from, off-screen
  until focused, then shown over the stage. `src/surfaces/rig/rig-picker.test.tsx`.
- **P4** `scripts/work-control-gate.mjs` trusted a receipt's self-declared SHA. It resolves the head
  itself, demands a full 40-char SHA, binds gates AND the independent review to that head, and treats
  an unresolvable head as a blocker rather than a pass.

### 3 · Three gates that were describing yesterday's repo

npm audit (five advisories classified with real dependency paths + expiry), RELEASE_STATE
(`source_main_commit`, `owner_installed_stamp` re-stamped to `1214fa9c`), BRANCH_DISPOSITIONS
(this lane's row added after the push; #90 → MERGED, #100 → SUPERSEDED).

**Verification:** `npx tsc --noEmit` clean · 4144 frontend tests · Rust tests + clippy · full
`verify-release.ps1` (the three FAILs above are what it caught; all now green) · citations 30/30.

## Left to do

Nothing in this lane except landing it. PR #102 is green, the build is installed and proved
(`3155c7a0 · release`, installer SHA-256 `3AD4C690…BF8E`), and the self-review came back **PASS** on
round 3. Round 2 is why there was a round 3: it caught that P2 was only half-fixed — the detected-fan
half worked, a hand-added cooler still swallowed every click aimed at the CPU behind it. Fixed in
`3155c7a0` with four regression cases, and the fixtures carry `kind` on purpose (without it the shape
rules judge a manual part as a fan and the tests pass either way — measured).

Next: merge #102, prune the ref with `gh api` (never `--delete-branch`), then clear this file.

### Found on the way, not fixed here

`<RigViewer>` is mounted live only by `LabConsole.tsx`, always `chromeless` — and `chromeless` hides
the "add a part" form. The manual-parts feature is therefore reachable in tests only. Logged in
`docs/BACKLOG.md`.

## Do NOT

- **Do not `Start-Process pwsh -WindowStyle Hidden`** — Windows Terminal ignores `-WindowStyle`.
- **Disposition rows go AFTER the first push, never with it.** The audit rejects a row whose ref it
  cannot resolve, and its vocabulary is exactly MERGED / SUPERSEDED / UNLANDED / PRESERVE / CLAIMED.
- Do not kill another lane's processes or its port; isolate (own `identifier`, own `APPDATA`, free
  port) instead.
- Do not release, publish, or touch signing keys. `npm run tauri build` exits non-zero on the missing
  private key — that is expected here and the NSIS + MSI bundles are still produced.
- Do not pipe a long build through `tail`: it once masked a libuv assertion and looked like success.
  Redirect to a log file instead.

## Resume with

Merge PR #102 if it is still open; otherwise this lane is finished and the file can be cleared.
