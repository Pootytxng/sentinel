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

Worktree `.claude/worktrees/foreground-courtesy-handoff-82687b`, branch
`claude/foreground-courtesy-handoff-82687b`, rebased onto `origin/main` `880a3b5f`.

The prior occupant (command-palette lane) landed as `22fb15b2`; its one still-open item (PR #90
recovery) is carried forward below.

## What this lane did

Two threads, both closed except for one owner decision.

### 1 · PR #100's foreground fix is INERT — proven, do not merge

The handoff asked for the on-screen proof. Ran it three times in isolation (own identifier + own
`APPDATA` + port 1421, so the neighbouring lane's live compy on 1420 was never touched). **All three
took the foreground; one minimised the owner's running game (Soulframe.x64).**

Root cause, instrumented at `setup`: `config-as-seen-at-setup: focus=false visible=false` — the
mutation in `run()` (`for window in &mut context.config_mut().app.windows { window.focus = false }`)
sticks — but `visible_before=true … foreground_is_us=true`. **Tauri 2 ignores `WindowConfig.focus`
and `.visible` at creation time**, so the window is already up and focused before any `setup` code
runs. Nothing done in `setup` can fix it. Findings are posted on PR #100; my exploratory edits in
`.claude/worktrees/nodejs-background-execution-fd4def` were reverted (`git checkout --`, tree clean).

A real fix means building the window through `WebviewWindowBuilder` (`.visible(false)` /
`.focused(false)`) + `SW_SHOWNOACTIVATE`, carrying `decorations: false`, min sizes and the maximize
subclass across. Separate hole: `tray::show_or_recreate_main` (`src-tauri/src/tray.rs:70-86`) calls
`show()` + `set_focus()` unconditionally, so a *relaunch* steals focus regardless — the relauncher's
intent would have to travel via the single-instance plugin's argv. #100 also conflicts with main.

### 2 · The owner's actual complaint — FIXED, guarded, committed

His words: *"the thing that keeps popping up stealing my forground primarily is the windows terminal
… it appears blank then closes on its own shortly after."* Traced with a process-spawn poller to
`npm test`: seven suites spawn `powershell.exe`, and Node's `spawnSync` defaults to
`windowsHide: false`; Win11's default terminal is Windows Terminal, so each spawn opened a real blank
console window (blank because stdout is piped), dozens per run.

- `windowsHide: true` on all seven `scripts/*.test.mjs`: `alias-propagation-harness`,
  `production-adapter-{lookup,native-sandbox}`, `release-{transaction-e2e,pipeline-guard}`,
  `deps-bootstrap-guard`, `public-version-gate`.
- **Guard** `scripts/console-window-guard.test.mjs` — parses each spawn call with a balanced-paren
  scan so one correct call can't cover a wrong one beside it; includes a negative self-test.
  Its interpreter names are **assembled from fragments on purpose** — a quoted `"powershell.exe"`
  literal makes `windows-only-coverage.test.mjs` misclassify it and demand a `runIf(windows)` gate
  that would be wrong (it starts no process). Do not "simplify" those regexes.
- `CompyUsageAudit` scheduled task set `Settings.Hidden` False → True (it flashed the same way).

Also landed here: the `~/.claude/hooks/unloaded-project-config.mjs` mirror re-sync (its drift was
turning EVERY lane's gate red) and an 8 s budget on `preload-apps`' armed case (1 s lost to machine
load, twice). **Verification:** full pre-push gate, `LOCAL CHECK RESULT: PASS`, 4042 tests.

## Left to do

### 1 · Land PR [#101](https://github.com/Pootytxng/sentinel/pull/101)

Branch is on origin and green through the pre-push gate. Merging a green PR is ours, not the
owner's (decree 2026-08-11). After merge: prune the ref via `gh api` — **never**
`gh pr merge --delete-branch`, which once set `core.bare=true` across every worktree — then drop the
row from `docs/BRANCH_DISPOSITIONS.md` in a follow-up.

### 2 · One owner decision, already put to him

Close PR #100, or rework it via `WebviewWindowBuilder`. He has been told not to merge it and why.
Nothing else waits on him.

### 2 · PR #90 recovery — **ours to finish, not a thread to wait on**

PR #90 `agent/rig-evidence-map-clean`, head `98146456`, OPEN / MERGEABLE / no review decision.
The four items below came from a Codex audit, which is **advisory only — no jurisdiction over
building or decisions** (owner, 2026-08-11). Its review never completed (expired OAuth), so every
gate below is an unverified claim to re-prove here, and none of it blocks starting.

- **P1** `LabConsole.tsx` resolves selected IDs only through detected `buildRigParts()` entries —
  manual parts and fans can select into no panel. Keep exact IDs; never collapse to `gpu`/`storage`.
- **P2** `shadowingGhostIds()` releases only *undetected* ghosts — a detected CPU fan or manual
  cooler can still occlude the CPU. Needs regression coverage.
- **P3** Selection is pointer-only through Three.js. #49's a11y acceptance needs a DOM selector:
  tab, Enter/Space, visible focus, name/role/value, 200% reflow, honest unavailable states.
- **P4** Re-verify `scripts/work-control-gate.mjs` itself resolves the real head, binds gates and
  review to that head, and rejects self-authored SHAs — don't re-apply the old governance diff blind.
- Verifier (**we run it, it is not the owner's job**):
  `powershell -NoProfile -File scripts/verify-release.ps1 -EvidencePath src-tauri\target\codex-verification\pr90-final-review-verify-release-evidence.json`

## Do NOT

- **Do not launch a build with nothing visual to show** (owner, 2026-08-11): *"if no major visual
  changes or features have been added or made then if it saves tokens then you dont have to pull up
  the build everytime."* Memory: `dont-launch-build-without-visual-change`.
- **Do not `Start-Process pwsh -WindowStyle Hidden`** — Windows Terminal ignores `-WindowStyle`, so
  that flashes the very window this lane just fixed. Launch helper shells via the Bash tool.
- **Disposition rows go AFTER the first push, never with it** (learned the hard way, 2026-08-11).
  The audit rejects a row whose ref it cannot resolve, so a row written before the branch exists
  fails the very gate that would create the ref. Order: push, then a follow-up commit with the row.
  Rows are perishable both ways — on a conflict there, re-check `git ls-remote --heads origin <ref>`
  before choosing a side.
- Do not kill another lane's processes or its port. `docs/WORK_CONTROL.md`: expiry is an alarm, not a
  takeover. Isolate instead — override `identifier` (the single-instance lock key) and `APPDATA`,
  and use a free port.
- Do not release, publish, or touch signing keys. Do not rebase PR #92 before #90 resolves.
- Do not run `loadLibrary()` without injecting a loader from inside a test — it boots a real Vite
  server inside the worker pool. It refuses when it sees `globalThis.__vitest_worker__` (**not**
  `process.env.VITEST` — that leaks into child processes); `scripts/nested-vite-server-guard.test.mjs`.

## Resume with

**Item 1** (land #101 and clean up its row), then **item 3** (PR #90 recovery) — the real open work.
