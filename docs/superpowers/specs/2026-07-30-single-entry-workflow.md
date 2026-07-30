# Single-entry Compy workflow — design specification

**Issue:** [#18](https://github.com/Pootytxng/sentinel/issues/18) · **Status:** design approved by Kuya
2026-07-30, implementation not started · **Branch:** `feat/single-entry-workflow` ·
**Worktree:** `C:\Users\Kuya\code\sentinel-workflow`

This document is the approved design. The implementation plan is a separate document; nothing here
authorizes a merge, a build, an install, a release, or any product change.

---

## 1. Outcome

Kuya opens **one** stable Compy entrypoint and starts work without choosing a worktree folder,
changing directories, remembering which branch belongs to which task, hand-loading branch-specific
Claude settings, copying configuration values, or accidentally starting a session under one worktree
while claiming another.

Separate Git worktrees keep existing — they are what makes parallel lanes safe — but they become an
implementation detail managed by automation.

### The governing invariant

> A task must not begin until its Work Control issue, active claim, actual session root, Git
> worktree, branch, dirty state, active processes, and effective project settings agree.

The entrypoint's job is to **produce a verdict, never a repair**. Its default output is PASS or
REFUSE, and REFUSE happens *before the first write*.

---

## 2. Measured findings this design answers

Read-only inspection of all six checkouts, 2026-07-30. These are measurements, not assumptions.

| # | Finding |
|---|---|
| 1 | **Six checkouts, not five.** `git worktree list` reports five. `code\sentinel-work-control-codex` is a **separate clone** of the same remote on `codex/work-control` — invisible to every worktree-based tool. |
| 2 | **`main` is checked out nowhere.** `code\sentinel` — which hosts `.git` for all five linked worktrees — is parked on `release/v0.9.9-candidate` and dirty (`M CLAUDE.md`, `?? src-tauri/CLAUDE.md`). |
| 3 | **`.claude/settings.json` is tracked branch content.** `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is `300000` in `sentinel-feedback` and `150000` in all five others. Opening the wrong folder silently changes the context window — the exact mechanism behind the invalidated 300k claim in #14. |
| 4 | **The tracked settings register seven hook files that the repo deliberately refuses to carry.** `.gitignore:49` ignores `.claude/hooks/` as "machine-local, personal automation; not shared", yet tracked `settings.json` wires all seven by `$CLAUDE_PROJECT_DIR` path. They exist only in `code\sentinel`, so **five of six checkouts run with every hook missing** — including `subagent-model-guard.mjs`, a real **DENY**. The whole #14 marathon ran hookless. |
| 5 | **`.claude/settings.local.json` exists only in `code\sentinel`** (gitignored), so plugin enablement, MCP disables and the impeccable PostToolUse hook differ between `sentinel` and every worktree. |
| 6 | **`docs/WORK_CONTROL.md` — the claim and collision law — exists only on `main`-tip branches.** Absent from `sentinel`, `sentinel-feedback` and `sentinel-codex-hygiene`: unreadable from the folder doing the work. |
| 7 | **`scripts/lib/compaction-window.mjs`** (a working `resolveCompactionWindow`) exists only on the `sentinel-feedback` branch. Confirmed again after creating this worktree: absent at `main`. Shared tooling committed to one branch is invisible everywhere else. |
| 8 | **Work Control cannot mechanically check its own invariant.** `Worktree / branch` is free text in three incompatible formats; item #12 names two folders and states the active one is unknown. |
| 9 | `CLAUDE_PROJECT_DIR` measured **unset** in the tool environment, while every hook command interpolates `$CLAUDE_PROJECT_DIR`. |
| 10 | Linked worktrees make `.git` a **file**, so `build.rs`'s `rerun-if-changed=../.git/HEAD` never fires; with a zero-`src-tauri` diff, cargo re-bundles the previous binary (proven in #14 — it would have shipped a stale stamp). |

**The decisive constraint, and the reason for the architecture below:** a launcher committed as
ordinary branch content inherits every problem it exists to solve.

**Correction to the issue body.** Issue #18 describes the hooks as "untracked". They are *deliberately
gitignored*, which is a stronger and different fact: the defect is **tracked registration of
untracked files**, not a forgotten `git add`. Tracking them would reverse a deliberate ignore
decision and is therefore an owner call, not a repair — see §5.4.

---

## 3. Architecture

### 3.1 Approved: neutral control folder plus a stable shortcut

`C:\Users\Kuya\code\compy-control\` is a **separate clone** of `Pootytxng/sentinel`, pinned to a
long-lived tooling branch the launcher never routes away from. It holds the launcher, the preflight
reconciler, the guard suite, the canonical `.claude/hooks/` payload, and `compy.code-workspace`. A
single Desktop shortcut opens it. Nothing else is Kuya's entrypoint.

Separate clone rather than a linked worktree, so the control surface keeps working while
`code\sentinel\.git` is mid-surgery — that coupling is precisely what disqualified making `sentinel`
itself the entrypoint. Precedent already exists: `sentinel-work-control-codex` is a separate clone of
the same remote.

The launcher is *developed* in a normal worktree (`sentinel-workflow`) with the repo's existing
toolchain, reviewed and pushed through the existing remote. `compy-control` is a checkout of that
branch, and the launcher **asserts its own pin at startup** as its first guard.

### 3.2 Rejected: `code\sentinel` becomes the entrypoint

Requires mutating its dirty release-candidate state before every launch; couples the daily-driver
folder to the `.git` host for five worktrees, so any `.git` maintenance takes the entrypoint down;
and it still enumerates via `git worktree list`, so it misses the separate clone (finding 1).

### 3.3 Rejected: an unversioned user-level launcher

No history, no diff, no review, and no home for the guard suite. The guards are the deliverable; a
folder that cannot hold tests cannot hold this design.

---

## 4. Components

```
compy-control/                     (separate clone, pinned to tooling branch)
├─ compy-entry.ps1                 the only thing the shortcut runs
├─ compy.code-workspace
└─ tools/entry/
   ├─ preflight.mjs                the reconciler — reads, compares, verdicts. No mutation.
   ├─ checkouts.mjs                discovers ALL checkouts, worktrees and separate clones
   ├─ worktree-field.mjs           canonical `Worktree / branch` grammar + normalizer
   ├─ settings-resolve.mjs         layered effective-settings resolution (lifts #16's resolver)
   ├─ hooks-verify.mjs             every registered hook command must resolve to a real file
   ├─ processes.mjs                live compy/build/helper inventory
   ├─ claim.mjs                    post / renew / release against Work Control
   ├─ session-assert.mjs           runs INSIDE the session: real root vs claimed root
   ├─ context-policy.json          train → intended context window (policy, not a global default)
   └─ *.test.mjs                   the guard suite
```

### 4.1 `compy-entry.ps1` — the launcher

1. Resolves the control folder from `$PSScriptRoot`, **never** from the current directory.
2. Asserts its own pin: correct remote, correct tooling branch, and `git rev-parse --git-common-dir`
   resolves *inside itself* (proving separate clone, not linked worktree).
3. Runs `node tools/entry/preflight.mjs --json`.
4. **PASS** → posts or renews the claim, then opens VS Code with the resolved worktree as the
   workspace folder, and prints the one line Kuya reads.
5. **REFUSE** → prints the failing checks as `expected` vs `actual`, plus the exact remediation
   command. Exit non-zero. **No writes of any kind.**

### 4.2 `preflight.mjs` — the reconciler

Pure functions over injected readers, so every check is unit-testable without a real repository.
Produces `{ verdict: "PASS" | "REFUSE", checks: [{ name, expected, actual, ok }], remediation }`.
Every check is a **named comparison with an expected and an actual value** — that property is what
makes the guards in §6 mechanizable rather than aspirational.

Checks, in order (first failure still evaluates the rest, so Kuya sees the whole picture once):

| Check | Compares |
|---|---|
| `board.reachable` | Work Control responds |
| `task.status` | status ∈ {Ready} for start, {Active + claim is ours} for resume |
| `task.gate` | Gate ≠ Kuya / Security / Release, else REFUSE as owner-gated |
| `task.claim` | no other writer; expiry in the future |
| `field.canonical` | `Worktree / branch` parses under the §5.1 grammar |
| `folder.exists` | the named folder exists (or is safely creatable) |
| `folder.writer` | no other checkout claims the same folder |
| `git.commonDir` | the folder really belongs to the expected repository |
| `git.branch` | checked-out branch == claimed branch |
| `git.clean` | dirty / untracked / staged / stashed / divergent inventory |
| `git.branchElsewhere` | claimed branch is not checked out in another checkout |
| `settings.window` | effective `CLAUDE_CODE_AUTO_COMPACT_WINDOW` == policy value for this train |
| `settings.subagentModel` | effective value == `sonnet` |
| `hooks.present` | every hook command registered in effective settings resolves to a real file |
| `processes` | live compy / installer / cargo / node inventory, disclosed and attributed |

### 4.3 `session-assert.mjs` — verifying the root *after* launch

The launcher writes a disposable launch token to `%LOCALAPPDATA%\CompyEntry\launch.json`
(`{issue, folder, branch, window, expiresAt, nonce}`). Inside the session, `session-assert` compares
the **real** session root against that token and refuses on disagreement.

This is the only component that can catch a launcher which changed shell directories without changing
Claude's actual project root (guard 8), because it is the only component that observes the session
from inside it.

**Injection matrix — stated plainly rather than assumed:**

| Path | How the assert runs | Available |
|---|---|---|
| CLI (`claude`) | `--settings` overlay naming a `SessionStart` hook | now |
| VS Code extension | `SessionStart` hook in the worktree's `settings.local.json` (gitignored, written by the launcher — see §5.3) | now, via the Class A rule |
| Permanent | `SessionStart` hook in tracked `settings.json` | **only after this branch merges — owner-gated** |

The assert is unit-tested independently of injection path (given root X and token Y → refuse), so the
guard is real today; the *automatic* injection under VS Code is what the merge upgrades from
launcher-written overlay to tracked branch content.

---

## 5. Design rules

### 5.1 Canonical `Worktree / branch` grammar

Guards 1, 3 and 4 are blocked until this field is machine-readable (finding 8). Grammar:

```
field  := "none" | entry ( " ; " entry )*
entry  := path " @ " branch
path   := absolute Windows path, uppercase drive letter, backslashes, no trailing separator
branch := a valid git ref name — git forbids spaces in refs, which is what makes " @ " unambiguous
```

Parsing splits on the **last** ` @ `. `normalizeWorktreeField(raw)` accepts the three legacy formats
and rewrites them; where a value is genuinely ambiguous (item #12 names two folders and says the
active one is unknown) it **refuses and reports** rather than guessing — collision rule 4, *unknown
means locked*.

Board migration runs dry-run by default and prints a per-item diff; `--apply` writes; ambiguous items
are listed for Kuya rather than resolved by the tool.

### 5.2 Context window is resolved per train, never globally

`context-policy.json` maps train → intended window. The preflight compares the **policy** value to
the **effective** value it computes from the settings layers, and refuses on mismatch, naming the
file and key.

The 300k window is **not** globally adopted. It stays an explicitly-scoped trial (#15/#16) until
formally accepted. This design must never be the vehicle that quietly makes a routing mistake
invisible — the whole point of finding 3 is that a silently-different window is how the last claim
got invalidated.

### 5.3 The launcher may install verification; it may never install behaviour

A named line, because "the launcher writes settings" needs a limit:

- **Class A — verification only.** The `SessionStart` assert hook. Written by default into the
  target's gitignored `settings.local.json`, *after* preflight PASS and *after* the claim is held,
  disclosed in the launcher's output and recorded in the claim, minimal in content, and followed by a
  re-resolution of effective settings to prove nothing else moved. `--no-overlay` opts out.
- **Class B — anything that changes how the session behaves.** Context window, subagent model, other
  hooks, plugin enablement. **Verify and refuse.** Only an explicit `--repair` writes, and it prints
  what it will write first.

### 5.4 Hooks: verify and refuse (owner-approved)

Missing hooks abort the launch with an exact remediation command. Writing hook files into a
possibly-claimed worktree is mutation; `--repair` is the only path that copies the canonical set from
`compy-control`.

The permanent fix is an **owner decision, surfaced not taken**: either track `.claude/hooks/` (which
reverses the deliberate `.gitignore:49` "not shared" decision) or keep `--repair` as the supported
materialization path. This design implements the second and asks for the first.

### 5.5 No hidden mutation, no destructive Git

The entrypoint never resets, checks out over, stashes, cleans, force-pushes, deletes a worktree, or
kills another tool's process. Dirty state is *reported*, never *cleared*. Collision rule 5 — expiry is
an alarm, not a takeover — is implemented literally: an expired claim produces a REFUSE plus a
prepared **Verified takeover** draft for a human to post.

---

## 6. Required behaviour → mechanism

| # | Required behaviour | Mechanism |
|---|---|---|
| 1 | Read the live Work Control task and status | `preflight` → `board.reachable`, `task.status` |
| 2 | Refuse Needs Kuya / Blocked / already-claimed | `task.status`, `task.gate`, `task.claim` |
| 3 | Resolve or safely create the correct worktree and branch | `checkouts.mjs` + `folder.exists`; creation only via `git worktree add -b` from a fetched base, never over an existing folder |
| 4 | Detect dirty / untracked / staged / stashed / divergent before reuse | `git.clean` (all five counted separately) |
| 5 | Open Claude with the worktree as its **actual project root** | launcher opens the folder as the VS Code workspace folder; §4.3 proves it, rather than trusting it |
| 6 | Resolve the intended context window and other settings | `settings-resolve.mjs` + `context-policy.json` (§5.2) |
| 7 | Verify the session root **after** launch | `session-assert.mjs` (§4.3) |
| 8 | Compare issue / claim / folder / common dir / branch / env / processes | the §4.2 check table, one named comparison each |
| 9 | Fail **before writes** when any value disagrees | REFUSE is the launcher's only non-PASS outcome and it precedes claim posting, overlay writing and launch |
| 10 | Post or renew the claim only **after** preflight passes | `claim.post` refuses unless handed a PASS verdict object |
| 11 | Preserve a recoverable handoff and release the claim when work stops | `claim.release` posts the WORK_CONTROL Handoff block, clears `Claim expires`, sets `Last verified` |
| 12 | Return Kuya to one stable entrypoint | release ends by re-opening the control folder; the shortcut never changes |

---

## 7. Edge cases

| Situation | Behaviour |
|---|---|
| No active task | List Ready items; if none, say so and stop. Never invent work. |
| Several Ready tasks | Numbered choice; no default, no "most recent" heuristic. |
| Owner-gated task | REFUSE naming the gate, and print what Kuya must decide. |
| Expired claim | REFUSE + prepared **Verified takeover** draft. Never an automatic takeover (rule 5). |
| Overlapping claims | REFUSE. Two writers is the failure this exists to prevent. |
| Missing worktree | Offer creation from a freshly fetched base; create only into a non-existent path, on a branch checked out nowhere. |
| Dirty worktree | REFUSE with the file inventory. Never stash, reset or clean. |
| Branch already checked out elsewhere | REFUSE naming the other folder — Git would refuse too, but later and less legibly. |
| Live Compy / build / helper processes | Inventory and disclose; refuse only when a process would contend with this train's writes. Never kill another tool's process (rule 6). |
| Settings requiring a fresh session | Detect before launch; if a change is needed, apply it (Class A) or refuse (Class B) *before* the session starts, never mid-session. |
| Launcher fails halfway | Ordering makes this recoverable: verdict → claim → overlay → launch. A failure after the claim leaves a valid claim and a printed resume command; the launch step itself writes nothing to the repo. |
| Work Control unavailable | REFUSE. Offline is not a licence to start unclaimed. Read-only inspection still prints. |
| User cancellation | Any cancellation before launch leaves zero side effects; after the claim is posted, the launcher prints the exact release command. |

---

## 8. Permanent guards

Automated reproductions. **A documentation checklist is insufficient where the condition can be
mechanized** — each of these encodes a failure that has already happened or that a checklist demonstrably
did not catch.

| # | Guard | Reproduction |
|---|---|---|
| 1 | Claimed `sentinel-feedback`, session root `sentinel-rel` | token names folder A, assert observes root B → refuse |
| 2 | Expected 300000, effective 150000 | policy 300000 vs resolved 150000 → refuse, naming file + key |
| 3 | Correct folder, wrong branch | fixture checkout on `X`, field claims `Y` → refuse |
| 4 | Correct branch, another writer owns the folder | board has a second Active item naming the same canonical folder → refuse |
| 5 | Dirty worktree reuse | each of dirty / untracked / staged / stashed / divergent independently → refuse |
| 6 | Linked-worktree Git metadata | `.git` as a **file**, common-dir resolution, and discovery of the separate clone `git worktree list` omits |
| 7 | Board `Next action` drifts from the newest durable handoff | compare the field to the newest Handoff comment's `Exact next action` → refuse |
| 8 | Launcher changes shell directory without changing the real project root | `cd` performed, root unchanged → assert refuses |

Guards 1, 3 and 4 depend on §5.1 landing first. Guard 2 is the direct mechanization of the #14 lesson.

**Guard-premise law (carried from #14):** a guard built on a premise later disproven must be
**rewritten, not extended**. Each guard above names the condition it detects, not the constant it
happened to observe.

---

## 9. Verification strategy

- Guards run under the repo's existing runner: `node scripts/run-vitest.mjs run tools/entry`.
  Default vitest `include` already covers `tools/entry/*.test.mjs`; node-environment docblocks where
  jsdom is wrong.
- **Guard-first with red-to-green evidence**: every guard is committed failing against the current
  behaviour, then made to pass. The red output is the evidence, not a claim that it was red.
- Fixtures are synthetic repositories created in the scratchpad — real `git init`, real linked
  worktrees, real `.git`-as-file. No mocking of Git's own semantics, because finding 10 is exactly a
  case where Git's real behaviour differed from the assumed behaviour.
- Board interactions are tested against captured fixtures; live `gh` calls are confined to `claim.mjs`
  and exercised once, manually, in §6/step 6.
- `resolveCompactionWindow` is **lifted from `sentinel-feedback`, not rebuilt** (finding 7).

---

## 10. Out of scope

No Compy build, install, release, distribution, Lab change, or product feature work. Specifically not
authorized: touching, merging, rebasing, enabling or reopening `feat/user-feedback-lab-recovery`
(#14, owner-gated, four open owner decisions); modifying `code\sentinel-rel`'s working tree, its
`docs/BACKLOG.md`, or its untracked
`docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md` (#17, preserved exactly);
merging this branch; and globally adopting the 300k context window.

---

## 11. Open owner decisions surfaced by this design

1. **Track `.claude/hooks/` or keep `--repair`?** (§5.4) — tracking reverses the deliberate
   `.gitignore:49` decision; the design ships `--repair` and asks.
2. **Merging this branch** is the step that turns the session-root assert from a launcher-written
   overlay into tracked branch content (§4.3) and makes `docs/WORK_CONTROL.md` and the shared tooling
   readable from every worktree (findings 6, 7). Owner-gated, separate authorization.
3. **Board migration `--apply`** (§5.1) rewrites fields on Kuya's board; dry-run diff first.
