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

### 1 · BLOCKED on the owner — an unrestored Gaming Mode contract

`%APPDATA%\Compy\gaming-session.json` is **active**, started 2026-08-11 06:25, seven staged changes
(Game Mode, Game Bar/DVR, two power settings, SysMain + DiagTrack + WSearch suspended). Closing the
app does not restore — only ending the session does — so `ship-reinstall.ps1` refuses to install over
it, deliberately. Written up as `OWNER_ACTION_CHECKLIST.md` §A_gaming. **Do not delete, move or parse
that file to get past the gate.** Three of the seven need elevation, so a UAC prompt is his click
either way.

### 2 · Then, in this order

1. `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit <full HEAD sha>` — the build is already
   cut at `34443622`+ (NSIS under `src-tauri/target/release/bundle/nsis/`); only the install is blocked.
2. **Re-dispatch `self-reviewer` for a FULL fresh review** of the Lab keyboard picker. Round 1 came
   back FAIL on one real defect (the on-canvas spec card landed across the picker rows); the fix is
   committed (`34443622`) with a behavioural guard, but the law wants a fresh PASS from the top, not
   a spot-check of the fixed item.
3. Hand the owner a before/after of the picker via `SendUserFile` (taste-call rule) — regenerate the
   shots against the newly installed build; the ones in the scratchpad predate the fix.
4. Re-stamp the RELEASE_STATE owner-installed row (stamp + installer SHA-256) in the same commit.
5. Merge #102 — merging a green PR is ours (decree 2026-08-11). Prune the ref with `gh api`, never
   `--delete-branch`.

### 3 · Watch item, not yet a defect

The reviewer flagged `.rig-picker-value` contrast at ~3.0–3.6:1. That is the app's documented
caption tier, so it is a taste call rather than a regression — decide it with the before/after.

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

Ask the owner whether he has ended the Gaming Mode session (§A_gaming) — everything else in this
lane is done and pushed. Once it is clear: install, re-review, show him the before/after, merge #102.
