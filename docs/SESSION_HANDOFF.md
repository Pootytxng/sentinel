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

**`claude/bento-conversion` — follow-ups DONE, awaiting review + merge.** The conversion itself
landed earlier (PR #117 `e468352`, PR #118 `396584a5`). This lane's remaining work — the Lab rig
picker's `data-rig-part` hooks and the fixture-preview harness — is built, proved, pushed, shipped
to the desk, and open as **[PR #120](https://github.com/Pootytxng/sentinel/pull/120)**.

**Root note (verified 2026-08-12).** An older note here claimed a session rooted elsewhere runs with
inert laws and a 150k window. FALSE — `CLAUDE.md` and `.claude/settings.json` are byte-identical
across the worktree roots (the `diff` that said otherwise was CRLF noise) and both set
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000`. The real reason to root here is simpler: **this checkout
holds the lane's work.** Writing lane files from another root orphans them.

## State

Pushed, on `origin/claude/bento-conversion`:
- `a979f123` — rig picker `data-rig-part` + its behavioural guard.
- `9db785d3` — fixture preview (`docs/ui-sweep/fixture/`) + `src/fixture-parity-guard.test.ts`.
- `a71b377c` — the `docs/BRANCH_DISPOSITIONS.md` row pointing at PR #120.
- (+ this docs commit: the RELEASE_STATE ship row and this file.)

Green at `9db785d3`: vitest **327 files / 4221 passed / 4 skipped** (`--maxWorkers=4`), `tsc` clean,
`doc-budget.ps1` ALL PASS, pre-push local gate PASS (929 Rust tests, clippy clean),
`work-control-gate.mjs` PASS, `verify-release-state.mjs` 31/31 + 0 state-drift.

**Self-review: PASS on both verdicts** (self-reviewer subagent, never inline).
- Bench states `start` / `running` / `running-no-session` — contrast all ≥4.5:1 (CTA ink 10.75:1),
  no double tile edge, one heading, conclude CTA correctly disabled in `running-no-session`,
  attribution warning present. Start / Conclude / Restore never clicked.
- Live rig click — 11 `[data-rig-part]` elements; clicking `cpu` moved `.lc-evidence` off its empty
  state to the real CPU reading. The real-reading branch is proved.

**Shipped to the desk 2026-08-12:** runtime proof `a71b377c · release · shell 0.9.15`, one installer
on the Desktop, SHA-256 `BC1F7F6B…68C5D0`. Nothing is running now — no dev server, no fixture server.

## Do, in order

1. **Get PR #120 an independent review.** Codex is the designated non-writing reviewer and was not
   reachable from the writing session; the work-control receipt and the PR body both record the
   review as OUTSTANDING. Merge only after it lands (merging a green PR is Claude's call — memory
   `merging-green-prs-is-mine` — but not while the required review is missing).
2. **Once it lands:** delete the lane branch — never with the `--delete-branch` flag (memory
   `gh-delete-branch-corrupts-worktrees`: it once set `core.bare=true` repo-wide); prune the ref via
   `gh api`. Then reset this file to its template.

## Notes for whoever picks this up

- **The desk build is UNSIGNED and unpublishable.** `npm run tauri build` exits non-zero on its last
  step because `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent. Bundles are written before
  that step, so the desk ship is valid; a *publish* must re-cut from `main` with the key.
- **Edge is not at the usual path on this machine.** It lives under
  `C:\Program Files (x86)\Microsoft\EdgeCore\<version>\msedge.exe` — resolve it dynamically, never
  pin the version. It is Chromium 148, the same build as the WebView2 runtime the app uses.
- **`ship-reinstall.ps1` resolves `$repo` from its own folder.** Run the *worktree's* copy or you
  will ship `main`'s build. It also throws if `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is set — kill
  any dev build and use a clean shell.
- The fixture's vite watcher **must** keep `ignored: ["**/src-tauri/target/**", ...]`. Without it
  `cargo run`'s lock on `compy_lib.dll` throws EBUSY and kills the server mid-capture — it reads as
  a flake because it only dies once something else builds. Pinned by `fixture-parity-guard.test.ts`.

## Owner's hands (do not attempt)

- Eleven MCP connectors need his interactive sign-in: guru, hubspot, intercom, figma, asana,
  atlassian, clickup, linear, monday, notion, slack.
- Open decisions: build-or-park the 3D rig · re-enable subagents/Workflow · the skin choice in
  `scratchpad/ux/directions.html`.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not click **Start / Conclude / Restore** in the Lab bench, in the app or in the fixture. In the
  app they apply real Windows changes; the fixture stub rejects them by name, keep it that way.
- Do not use `git -C` at the shared checkout or another worktree — worktree isolation refuses it.
- Do not treat this note as evidence that nothing else is in flight: `docs/WORK_CONTROL.md` and
  `git branch -a` are what say whether another lane holds a claim.
