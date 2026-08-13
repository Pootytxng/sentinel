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

**`claude/bento-conversion` — bento-conversion FOLLOW-UPS, open.** The conversion itself is done,
merged, installed and runtime-proved (PR #117 `e468352`, PR #118 `396584a5`; live stamp
`262ef91b · release · shell 0.9.15`). The fixture preview and both visual verdicts are now DONE.

**Root correction (verified 2026-08-12, replaces the previous note here).** The old text claimed a
session rooted anywhere else runs with inert laws and a 150k window. That is FALSE and it cost a
session a stall: `CLAUDE.md` and `.claude/settings.json` are **byte-identical** across the worktree
roots (the earlier `diff` that said otherwise was CRLF noise), and both set
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000`. The real reason to root here is simpler and still
binding: **this checkout is the only one holding the lane's work.** `main` is at `b44ec358` and has
neither `a979f123` nor the fixture. Writing lane files from another root orphans them.

## State

Two commits ahead of `origin/main`, both unpushed:
- `a979f123` — rig picker `data-rig-part` + its behavioural guard.
- (this session's commit) — the fixture preview + `src/fixture-parity-guard.test.ts`.

Green: vitest **327 files / 4221 passed / 4 skipped** (`--maxWorkers=4`), `tsc` clean,
`doc-budget.ps1` ALL PASS.

**Self-review: PASS on both verdicts** (self-reviewer subagent, never inline).
- Bench states `running` / `running-no-session` / `start` — contrast all ≥4.5:1 (CTA ink 10.75:1),
  no double tile edge, one heading, conclude CTA correctly disabled in `running-no-session`,
  attribution warning present. Start/Conclude/Restore never clicked.
- Live rig click — 11 `[data-rig-part]` elements; clicking `cpu` moved `.lc-evidence` off its empty
  state to the real CPU reading. The real-reading branch is proved.

Running right now (leave them, or kill before a release build): fixture server on **5199**
(`npx vite --config docs/ui-sweep/fixture/vite.config.mts`) and a dev build on **1420** / CDP
**9222**. The installed release app was killed to free 1420 and still needs relaunching.

## Do, in order

1. **Push both commits and open the PR** against `main`. Run `scripts/work-control-gate.mjs` first;
   add the `docs/BRANCH_DISPOSITIONS.md` row only AFTER the first push (a row for a ref that does
   not exist yet fails the very gate that would create it).
2. **`npm run tauri build`, then `scripts/ship-reinstall.ps1`** from a shell where
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is UNSET (it throws otherwise) — kill the dev build
   first. Verify with `-VerifyRuntime <40-char sha>`; an exe string-scan is NOT proof of the stamp.

## Notes for whoever picks this up

- **Edge is not at the usual path on this machine.** It lives under
  `C:\Program Files (x86)\Microsoft\EdgeCore\<version>\msedge.exe` — resolve it dynamically, never
  pin the version. It is Chromium 148, the same build as the WebView2 runtime the app uses.
- The fixture's vite watcher **must** keep `ignored: ["**/src-tauri/target/**", ...]`. Without it
  `cargo run`'s lock on `compy_lib.dll` throws EBUSY and kills the server mid-capture — it reads as
  a flake because it only dies once something else builds. Pinned by `fixture-parity-guard.test.ts`.

## Owner's hands (do not attempt)

- Eleven MCP connectors need his interactive sign-in: guru, hubspot, intercom, figma, asana,
  atlassian, clickup, linear, monday, notion, slack.
- Open decisions: build-or-park the 3D rig · re-enable subagents/Workflow · the skin choice in
  `scratchpad/ux/directions.html`.
- (The `CLAUDE_CODE_AUTO_COMPACT_WINDOW` item that used to sit here is RESOLVED — it already reads
  `250000` in `C:\Users\Kuya\.claude\settings.json`.)

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not click **Start / Conclude / Restore** in the Lab bench, in the app or in the fixture. In the
  app they apply real Windows changes; the fixture stub rejects them by name, keep it that way.
- Do not use `git -C` at the shared checkout or another worktree — worktree isolation refuses it.
- Do not treat this note as evidence that nothing else is in flight: `docs/WORK_CONTROL.md` and
  `git branch -a` are what say whether another lane holds a claim.
