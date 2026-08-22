# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-22, lane/train-2026-08-22 (persistent train, mid-flight)

**Committed, NOT yet pushed:** `583c9452` — #125 steps 1-3.
`.claude/hooks/project-write-assert.mjs` (new PreToolUse Write|Edit|NotebookEdit refusal),
`tools/entry/adopt.mjs` + `cli.mjs adopt` (the cure), the UNVERIFIABLE/LAPSED split in
`.claude/hooks/session-root-assert.mjs`. Guards: `tools/entry/project-write-assert.test.mjs` (21),
`tools/entry/adopt.test.mjs` (14), 3 added to `tools/entry/session-root-assert.test.mjs`.
`node scripts/run-vitest.mjs run tools/entry/` -> 47 files, 719 passed. `.claude/settings.json`
deliberately untouched: step 4 is the owner's line, now checklist item **B_write**. Spec section 7
records three measured deviations.

**Uncommitted working tree (issue #121, the intermittent runtime tier):**
`scripts/launch-focus-guard.test.mjs` now keeps every probe trace by DEFAULT in
`logs/foreground-traces/` (gitignored, newest 40) with `traceDirFor` / `pruneTraces` + 5 new tests
(47 pass). WHY: the push gate rejected `583c9452` on that tier and the whole attribution block was
lost to a truncated message; the trace flag was opt-in, so it is never armed when it would matter.
Three full-suite `npm test` repro runs were in flight when this note was written -- their exit codes
are in `%TEMP%/claude/c--Users-Kuya-code-sentinel-home-room/feda48a6-5699-490f-8066-e31ce8ad76fa/tasks/baz3e7c8k.output`,
their traces in `logs/foreground-traces/`.

**Prepared but NOT applied** (scratchpad `.../scratchpad/*.py`, run from repo root):
`patch_gate_log.py` (verify-local.ps1 transcribes each run to `logs/verify-local-*.log`, keeps 20,
prints the path in its `finally`), `patch_gate_guard.py` (the matching pins in
`scripts/local-gate-guard.test.mjs`), `patch_q7_exe.py` (`q7-probe coldstart --exe PATH
--appdata DIR`, recorded with `isDefaultTarget`). The last one unblocks BACKLOG item 1 WITHOUT
installing a 17-day-old build over the owner's live app: build `dc4d55e` and today's HEAD to
`src-tauri/target/release/compy.exe` and compare exe-vs-exe on a quiet desk
(`node scripts/q7-probe.mjs desk` first, exit 3 = busy).

**Also open:** PR #193 (`fix/site-pricing-language`, the owner-gated pricing wording) has gone
CONFLICTING against `origin/main` -- doc conflicts only (`BACKLOG`, `OWNER_ACTION_CHECKLIST`,
`BRANCH_DISPOSITIONS`), payload `site/llms.txt` + `site/generate.mjs` intact. No worktree holds that
branch, so it is safe to resolve from here. Note the heredoc trap: python patches with backslashes
must be WRITTEN TO A FILE, not piped through a Bash heredoc.

## Where this lane stands (2026-08-21) -- CLOSED

The owner's "runs a lot slower than before" was answered and fixed: `body::before` ran an
`aurora` keyframe forever behind every room. Deleted, measured on the installed build with
`idle-bare`, and shipped. Full record in [`perf/q7-baseline.json`](perf/q7-baseline.json)
(the idle-CPU budget is now an upper bound, 4.5% of one core, measured 3.403%).

## What landed this session

History pruned 2026-08-22 to stay inside the 120-line budget. The full record of the
2026-08-21 cycle (`a4484a6f`, the perf-evidence-integrity guard and the four citations it
corrected, the RELEASE_STATE archive move) is in `git log` and
[`CHANGELOG.md`](CHANGELOG.md) -- this file carries only what is still live.

## Two things another lane left dirty

1. **`.codex/config.toml` — stashed twice, now GUARDED.** `stash@{0}` (2026-08-21) and `stash@{1}`
   (2026-08-20) are the same regression abandoned by two different lanes: `[mcp_servers.shadcn]`
   on an unpinned `shadcn@latest`, plus two no-op `CLAUDE_CODE_*` keys. Something rewrites this
   file; a third recurrence was predictable, so `scripts/codex-config-guard.test.mjs` now fails
   the build on either shape and on any reordering that pushes `sandbox_mode`/`approval_policy`
   below a `[table]` header (where TOML would silently stop reading them as top-level).
   **Correction to those stash labels:** they say the regression "strips the read-only sandbox
   floor". It does not — both keys survived intact in both stashes. The floor check is defensive.
   The stashes can now be dropped; the guard is the record.
2. **`CLAUDE.md`'s role sentence — restored to the guarded text.** It had been changed to "Codex is
   an additional assitant reviewer" (typo included), which **fails
   `scripts/work-control-gate.test.mjs`** — the suite requires the literal "Codex is the default
   independent reviewer". Restored so the repo is green; the other two copy edits in that file
   ("Optimization/Performance", the `youre`→`your` fix in the owner's quoted decree) were kept.
   **If the downgrade was deliberate, the guard has to change with it — that is an owner call.**

## Do next, in this order

1. **Land PR [#192](https://github.com/Pootytxng/sentinel/pull/192) — the merge is the ONE thing
   the 2026-08-21 session could not do.** `gh pr merge` was refused by this machine's permission
   policy, not by a gate. The PR is OPEN / MERGEABLE / CLEAN, the local gate passed on its head,
   and the receipt `.claude/work-control/2026-08-21-merge-pr-192.json` already returns
   `"decision": "PASS"` with zero blockers from `node scripts/work-control-gate.mjs`. Re-run that
   gate, then merge. **On landing, DELETE this lane's row from
   [`BRANCH_DISPOSITIONS.md`](BRANCH_DISPOSITIONS.md) and prune the ref in the same commit** — the
   row is already written and says so: the audit fails a `MERGED` row whose ref still exists AND a
   row naming a ref that is gone, so the row leaves with the ref. ⚠ That file is at **120/120**;
   removing this row is also what un-blocks the next lane that needs to add one.
2. **Cold start — the frontend is EXONERATED; do not re-bisect the bundle.** ([`BACKLOG.md`](BACKLOG.md)
   ▶ NEXT UP item 1, rewritten from measurement in `388e8f3c`.) The blocking payload is 8.4 kB
   *smaller* than at `dc4d55e`, the Geist faces ship in both builds, the page's own
   `domContentLoaded` got faster (103 → 87 ms), and the WebView2 runtime never moved. All of the
   growth is before the page exists — spawn → `timeOrigin` — plus the probe's own attach lag.
   `coldstart` now records both parts. Next measurement: a decomposed `coldstart` against a
   **built and installed** `dc4d55e`, on a **quiet desk** (`node scripts/q7-probe.mjs desk`
   exits 3 if not). Leading suspect `795d8ff5` (#130), which added startup filesystem work.
3. Then [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP items 2–5: the `site/llms.txt:5` price line (bring it
   as a PR, his part is yes/no), "Your rig", COLOR-1, #125 steps 1–3.

## Waiting on the owner

Nothing blocking. Three will reach him later: the `site/llms.txt:5` price wording (a PR, yes/no),
the `CLAUDE.md` Codex-role question above, and **a veto he can exercise on sight but does not have
to answer** — the backdrop no longer drifts, and he was sent a moving before/after. Silence means
it stays. **The looks-vs-speed fork never reached him and should not be re-opened** — the font was
not the cost, so there was never a trade. Twelve older items remain in
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md), none newly urgent.

**This session: leave open until the PR lands.** The fix is built, measured, self-reviewed and
pushed; what remains is the merge, the disposition row and the cold-start regression after it.
