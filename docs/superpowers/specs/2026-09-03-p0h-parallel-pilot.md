# P0-H — expanded real parallel pilot, 12 acceptance cases (2026-09-03)

Home: [#362](https://github.com/Pootytxng/sentinel/issues/362) (writer A, this lane) and
[#363](https://github.com/Pootytxng/sentinel/issues/363) (writer B, the second live claim). The design
issue [#291](https://github.com/Pootytxng/sentinel/issues/291) was closed by hand on 2026-09-03T07:17Z;
per the owner's order it is reopened only if the pilot FAILS. This is a point-in-time record: every
result below was measured against the real board, the real origin and the real hooks on the dev PC,
not a fixture in a test file. Where a case could not be finished from this lane, it says so and says
whose hands finish it.

## The two writers

| | Writer A | Writer B |
|---|---|---|
| issue / claim | #362, Active, scope = the P0 toolchain set (see the claim comment) | #363, Active, scope `docs/pilot/` |
| folder | `.claude/worktrees/priority-order-parallel-productivity-ae19bb` | `C:\Users\Kuya\code\sentinel-pilot-b-363` |
| branch | `claude/priority-order-parallel-productivity-ae19bb` (on origin, unlanded) | `pilot/p0h-writer-b` from origin/main `98f49289` (local only until B pushes) |
| session | this one (`3a586081…`), lineage adopted on #362 | launch token minted by `launch.mjs` for `3941f4c6…`; **the session itself has not run** (case 1) |

B's folder, branch, claim, brief and token were all created by the real launcher (`tools/entry/launch.mjs
--issue 363 --scope "\`docs/pilot/\`"`), not by hand.

## Verdicts

| # | case (owner's wording) | verdict | what was measured |
|---|---|---|---|
| 1 | two unrelated writers concurrently | **PARTIAL** | Two live claims on disjoint scopes: A's preflight with #363 Active reads `scope.overlap = disjoint from #363 (Claude Code)` and A's gated push landed `4e7bd25e` while #363 was Active. **B's own session could not be started from A's session**, by design — see *Finding 1*. |
| 2 | unclaimed Write blocked | **PASS** | An unverified session's Write into the project is refused by `project-write-assert.mjs`: `Blocked: this session is not verified for this folder, and this is a project write.` |
| 3 | unclaimed Edit blocked | **PASS** | Same hook, same matcher (`Write\|Edit\|NotebookEdit`), same refusal. |
| 4 | unclaimed Bash modification detected before proof transition | **PASS** | Three layers, each measured: the shell hook denied a redirection into another checkout outright (`Blocked: this command writes into a checkout this session does not own.`); in-lane, the PostToolUse drift check reported `write-scope drift (#356): 1 changed path outside the claim` naming `docs/archive/OWNER_ACTION_HISTORY.md` the moment it changed; and the gate's write-scope step (#356) runs before any push can carry it. |
| 5 | overlapping second writer refused | **PASS** | Launcher for #363 with scope `scripts/`: `REFUSE — scope.overlap #362 (Claude Code) — scripts ∩ scripts; 143 shared files … Overlapping scopes serialize (collision rule 3)`. With no scope at all: `this task declares no write scope while #362 is live — unknown means locked (collision rule 4)`. |
| 6 | disjoint scopes not blocked | **PASS** | Launcher for #363 with scope `docs/pilot/`: `scope.overlap ok`, launch PASS — worktree created from the pinned base, claim posted, brief + token + overlay written. *Finding 2* came out of this run. |
| 7 | new unlanded origin ref does not red unrelated writers | **PASS** | After A's ref appeared on origin (`4e7bd25e`, no disposition record): preflight #363 = PASS (17 checks); `branch-disposition-audit` exit 0 — `1 unrecorded ref(s) measured UNLANDED — reported, not failed`. |
| 8 | unreachable origin blocks proof transitions | **PASS** | Receipt built at the pushed head `4e7bd25e` (`make-receipt`: HEAD == origin's lane ref). Control run: `decision: PASS`. With `GIT_SSH_COMMAND=false`: `decision: BLOCKED — The receipt is not durably reachable: origin could not be asked what it has.` |
| 9 | local/fork-only receipt cannot authorize | **PASS** | Empty local commit (`efe19770`, discarded after): the receipt builder refuses — `origin has 4e7bd25e…, HEAD is efe19770…`; a hand-written receipt claiming that head: `decision: BLOCKED — 1 commit(s) up to and including this head exist on no branch origin currently has.` HEAD restored to `4e7bd25e`, nothing pushed. |
| 10 | merge doesn't strand peers via bookkeeping | **measured at this lane's merge** | Result (preflight #363 + disposition audit, run right after PR merge and ref prune) is posted on #362; it could not be inside a document the same merge lands. |
| 11 | branch not pruned while an open PR uses it as base | **PASS** | Against the REAL pair on origin — open PR #311 is based on `lane/case-receiver-287`. That ref's working-tree record flipped to MERGED for one run: `prune-order-guard` FAILS — `origin/lane/case-receiver-287 is recorded MERGED (prunable) while open PR #311 is based on it -- retarget first: gh pr edit 311 --repo Pootytxng/sentinel --base main`. Record restored from HEAD (`git status`: 0 changes) → 5/5 pass. The pilot-branch variant (a PR based on `pilot/p0h-writer-b`) cannot exist until B pushes: GitHub answered `Base sha can't be blank`. |
| 12 | full gate survives simultaneous lanes without #324/#339 false reds; name the Vite HMR 24678 collision | **PARTIAL** | A's full gate PASSED twice today (the second while #363's claim was live); the run with B's gate in flight at the same time is owed to B's session (case 1). *Finding 3* is the false red that DID fire, and its guard. Vite: `vite.config.ts` pins the dev server to `1420` with `strictPort` and HMR to `1421` (host set); port `24678` (Vite's default HMR port) appears nowhere in the repo, and the gate never opens the dev server, so two gates cannot meet on it. Two `npm run tauri dev` would refuse on `1420` first — the standing one-dev-instance rule, not a gate hazard. |

Ten of twelve PASS; 1 and 12 are PARTIAL on the one thing this lane cannot do (below); 10 is measured after
the merge and posted on #362. Nothing FAILED, so #291 stays closed.

## Findings (each one became a guard or an owner item, not prose)

**Finding 1 — a session cannot start a peer writer, and three guards agree.** Starting B's session from A
(`bash start-writer-b.sh <B folder> …`) was denied by the shell-ownership hook: *"`bash` would act on
C:\Users\Kuya\code\sentinel-pilot-b-363, which belongs to … another checkout of this repository … Make the
change in a session opened on C:\Users\Kuya\code\sentinel-pilot-b-363."* The sanctioned starter is
`compy-entry.ps1` — line 2: *"The one thing Kuya runs"* — which pins its control folder to `main` (refuses
from a lane checkout) and whose `claude-start.mjs` needs a real terminal. Not evaded. **The owner's one
command finishes cases 1, 10 (second half) and 12:** from a console, `pwsh -File
C:\Users\Kuya\code\sentinel\compy-entry.ps1 -Issue 363`. B's brief on #363 carries its six steps (one fixture
file under `docs/pilot/`, commit, disposition audit, gated push, preflight before and after).

**Finding 2 — the launcher narrated `launch brief written to [object Object]`.** The log line had the path;
the terminal line printed the record. Fixed in `tools/entry/launch.mjs` (`briefWrittenLine`), pinned by
`tools/entry/brief-narration.test.mjs`.

**Finding 3 — the Claude Code harness flips the SHARED `core.hooksPath` absolute.** An `Agent` call with
`isolation: "worktree"` rewrote `C:\Users\Kuya\code\sentinel\.git\config` to
`core.hooksPath = C:\Users\Kuya\code\sentinel\.githooks` at 11:27:32Z, in the middle of A's pre-push gate;
`scripts/hookspath-fleet-guard.test.mjs` failed that gate — a true positive (every worktree aimed at one
checkout's hooks) and a false red for the lane. A second minimal isolation agent flipped it again after
the repair. Guard: `.claude/hooks/hookspath-guard.mjs` — PreToolUse(Agent) DENIES the isolation worktree
(it could not write here anyway: the ownership hooks treat it as a sibling checkout), PostToolUse(Agent)
restores an absolute value to `.githooks` and says so; `scripts/hookspath-guard.test.mjs` pins both and
asserts the live shared config is relative.

**Finding 4 — the folder's lineage record lagged the claim.** After the claim moved from closed #337 to
#362, the drift hook still measured against #291 (the record the folder was launched with). Cured by
`cli.mjs adopt --issue 362`; the record now names #362 and the drift check reads the #362 thread. Not a
defect of the tools — a step the re-home procedure has to include.

## What closes the pilot

1. Owner: the one command in Finding 1. B's session runs its brief and pushes through the gate.
2. This lane, after that: preflight #362/#363 and the audit while both refs are on origin (cases 1, 12);
   B's ref pruned in the guarded order (retarget check first — the pilot-branch variant of case 11);
   #363 closed with a pointer here; B's worktree removed from a session that owns it or by the owner
   (the hook refuses it from here: §A of the owner checklist carries the one-line command).
3. Case 10's numbers on #362 after this lane's merge.
