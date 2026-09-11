# Ownership by target, not by tool — closing the `Bash` and sibling-checkout holes

**Issue:** #278 (sidebar remediation Task 4). **Lane:** `lane/shell-ownership-278`.
**Status:** PREPARED candidate. **Merging this is the activation** — see §7.

Supersedes nothing. Extends `2026-08-21-unverified-session-write-refusal.md` §3b and **revises its
§3c**, which is the only part of that spec this changes.

---

## 1. What is actually broken

The one-writer rule is enforced against the *tool*, not against the *target*. Two consequences, both
read out of the tracked source rather than argued:

**a. `Bash` is unguarded.** `.claude/settings.json` registers `project-write-assert.mjs` for
`Write|Edit|NotebookEdit`. `sed -i`, `git checkout -- <path>`, `git restore`, `> file`, `mv`, `cp`,
`rm`, `Set-Content` all write with no ownership check at all.

**b. Outside the launch folder is treated as outside protection.**
`project-write-assert.mjs:119` returns `allow` for any target that is not inside the resolved session
root, and `project-write-assert.test.mjs:104-108` pins it — with
`C:\Users\Kuya\code\sentinel\src\App.css` in the allowed list, from a session rooted in
`sentinel-home-room`. That is a **sibling worktree of the same repository**: a lane writing into
another lane's checkout, which is precisely the collision the one-writer rule exists to prevent.
`~/.claude/settings.json` — the owner's global configuration — is allowed by the same line.

The #240 session walked both: it was refused `FOLDER_UNCLAIMED` for a config edit, then reached the
same file through a sibling route and restored the shared config through the shell.

## 2. The constraint the task statement does not carry, and why it is not a reason to stop

`2026-08-21` §3c leaves `Bash` unmatched **deliberately**, and §4 step 4 explains why: *"If the hook
misbehaves, `Bash` is still available to unwire it."* `tracked-hooks.test.mjs:135` fails the build if
`Bash` is ever added to the matcher. The hole is load-bearing — it is the escape hatch that keeps a
wrong guard from locking the machine out of its own repair.

So the naive close is not available. A candidate has to close the hole **and leave a working way
back in**. §5 is that design; it is the reason this spec revises §3c rather than deleting it.

§3c's other claim is still true and is honoured, not argued with: *"matching `Bash` would mean
parsing arbitrary shell to decide whether it writes, which fails open on anything clever and fails
closed on plenty that is innocent."* This design does not claim to decide whether an arbitrary
command writes. §4 says exactly what it decides instead.

## 3. Zones — the one thing both hooks ask

A target belongs to exactly one zone. The zone is a fact about **where the path is**, not about which
tool is reaching for it, which is the whole point of the change.

| zone | what it means |
|---|---|
| `own-claim` | inside the resolved session root |
| `sibling-checkout` | inside a **different** checkout of this repository — worktree or separate clone |
| `protected-global` | inside `~/.claude` or `~/.codex` — owner configuration that sits outside every repo guard |
| `unprotected` | anywhere else: the scratchpad, `%TEMP%`, an unrelated project |
| `unknown` | the path could not be resolved to any of the above |

**`unknown` is not `unprotected`.** A path shape the resolver cannot answer for is an absence of
evidence, and the guard that treats it as safety is the fail-open shape this train keeps finding.

Resolution rules:

- A relative target resolves against the session cwd first, and `..` is collapsed **before** any
  comparison — otherwise `..\other-repo\x` reads as a path that starts with the root.
- For a path that does not exist yet, the **nearest existing ancestor** is canonicalized (real path,
  so junctions and reparse points collapse to their target) and the remaining segments are appended.
  A new file in a sibling worktree is a sibling-worktree write before it exists.
- Comparison is case-insensitive and separator-insensitive, and a component boundary is required:
  `sentinel-home-room-2` is not inside `sentinel-home-room`.
- "Which checkout owns this path" is answered by `inspectCheckout` from `tools/entry/checkouts.mjs`
  logic, not by a new one — worktrees **and** separate clones of the same origin both count, because
  `git worktree list` does not see a clone and a launcher that only knew about worktrees would miss
  a whole class of sibling.

## 4. What the shell checker decides — and what it explicitly does not

It does **not** decide whether an arbitrary command writes. It decides three things:

1. **Recognized literal mutation of a resolvable path.** `git checkout/restore/reset/apply/
   stash/clean/rm/mv/switch/commit/add`, honouring `-C <dir>`/`--git-dir`/`--work-tree`; `mv`, `cp`,
   `rm`, `ln`, `touch`, `mkdir`, `chmod`, `dd`, `tee`; `sed -i`, `perl -i`, `awk -i inplace`; the
   PowerShell `Set-/Add-/Clear-Content`, `Out-File`, `Remove-/Move-/Copy-/Rename-/New-Item`,
   `Set-ItemProperty`; and `>`, `>>`, `2>`, `&>` redirection targets. **Every operand is evaluated,
   source and destination both** — a move out of a protected checkout is a protected operation at the
   source end even when the destination is scratch.
2. **Recognized mutation whose target it cannot resolve** — a variable, a command substitution, a
   glob, `eval`, `xargs`, `find -exec`, or an interpreter body (`node -e`, `python -c`). This is the
   case §3c is right about, and it is **not** answered with a guess. It takes the normal explicit
   approval path (`ask`), unless every unresolved operand is provably bounded inside a claim this
   session already holds (relative, no `..`, cwd inside the session's own verified root).
3. **`cd` / `Set-Location` / `pushd` within a chain**, so that `cd <elsewhere> && rm x` is evaluated
   against `<elsewhere>`, and an unresolvable `cd` makes every later mutation in that chain
   unresolved rather than assumed-local.

Everything else is allowed and **that is a documented limit, not a claim of safety**: `npm run
build`, a project script, or any binary that writes without naming a recognized verb passes
untouched. §6 states the limits as a list so a reader does not have to infer them.

## 5. The escape hatch, redesigned rather than removed

Three independent ways back in, none of which requires the guard to be correct:

1. **The direct hook's in-root behaviour is unchanged.** A verified session may still `Write`/`Edit`
   anything inside its own root, including `.claude/settings.json` and the hooks themselves. Removing
   a registration therefore does not depend on the shell checker working.
2. **`COMPY_SHELL_OWNERSHIP_OFF=1` in the hook's own environment disables the shell checker.** It is
   read from `process.env` of the hook process, so setting it **inline** in a command
   (`COMPY_SHELL_OWNERSHIP_OFF=1 git checkout …`) does *not* work — that string is the command the
   hook is inspecting, not the hook's environment. The lever is therefore reachable by the owner from
   outside the session and not by an agent inside it, without any secret and without a second
   authorization system.
3. **It fails open on its own errors.** Unreadable stdin, an unparseable command, an exception in the
   resolver: exit 0, allow. A guard that stops the machine because it could not parse its own input
   is a worse outage than the one it prevents.

Deny is reserved for the case where the checker has **positive knowledge** of a violation
(a resolved path in a checkout this session does not own). Ambiguity gets `ask`, never `deny`.

## 6. Limits, stated rather than discovered

- **`ask` is a real prompt, not a routing hint.** (Corrected 2026-09-04.) A hook's
  `permissionDecision: "ask"` is shown to the user in every permission mode, `defaultMode: "auto"`
  included, and a hook decision overrides `permissions.allow` rules
  (code.claude.com/docs/en/permission-modes, /hooks). This section used to claim the opposite -
  that `ask` "degrades to allow" under auto - and that false premise is why 33 of one day's 40
  prompts were `ask`s on operands whose value was on the same line (#373). Positive-knowledge
  violations are still `deny`; `ask` is reserved for the genuinely unresolvable, because every
  `ask` costs the owner a keystroke.
- **A wrapper is not one of these limits, and was wrongly treated as one.** `env` / `xargs` / `sudo` /
  `command` / `nohup` / `nice` / `time` / `timeout` / `stdbuf` / `doas` / `setsid` / `ionice` / `chrt`
  name the real command in their own argv: verb and target are both literal text, so stepping over
  them is the same move as stepping over `VAR=1`. Independent review measured four spellings of ONE
  write into a sibling with only the bare one refused, so those are closed rather than accepted.
  **The table is an ALLOWLIST, not a closed class**, and the sentence above read as though it were —
  corrected here because a spec that claims a class is handled is worse than one that names the gap.
  Still open and measured: none. Every wrapper this section once listed is now carried, and the
  marker below stays present-but-empty rather than deleted, so the claim keeps costing something.
  Each needed its own positional grammar rather than a bare table row — `flock` swallows a lockfile,
  `su` a username BEFORE its string-taking `-c` — and inventing four grammars at once is how
  `chrt`'s own bug got in. Tracked as [#308](https://github.com/Pootytxng/sentinel/issues/308),
  closed one at a time; `busybox` is closed and carried — a multi-call binary needs no positional
  grammar, the applet already sits in the command position. `taskset` is closed too: its CPU mask is
  the third bare leading positional in this table after `timeout`'s duration and `chrt`'s priority,
  and it failed identically. The last to close was `find`, which is not a wrapper at all and gets
  its own extraction beside `git`'s: its command sits MID-ARGV after `-exec` / `-execdir` / `-ok` /
  `-okdir` terminated by `;` or `+`, `-delete` and `-fprintf` write with no command named anywhere,
  and `{}` resolves to find's own path operands. `-execdir` runs in the directory holding each
  match, so a relative target under it is reported unknown rather than resolved against this one.
  What keeps that list honest is not this sentence: `tools/entry/shell-ownership-assert.test.mjs`
  enumerates the table itself and requires a probe per row, so a name cannot be added here without a
  test or left here after it is carried. The set is machine-read from the marker below rather than
  from this paragraph: the prose cites closed wrappers as precedent, so a reader that scans the
  sentence cannot tell a listing from a citation. The marker and the sentence are pinned to each
  other by the test — in both directions, because the prose went stale on `flock` and `su` while the
  marker was right, and only the marker was being checked.

  <!-- open-wrappers: -->

  Also open, narrowly: `xargs` reading its targets from **stdin** is still class 3, because the
  step-over reaches the argv template only; and a wrapper flag this table does not carry may or may
  not swallow the next word, so it is reported as class 2 rather than guessed past.
- **A wrapper is not only a POSIX shape.** Independent review's second round found the same hole
  standing in the other dialect: PowerShell's `Invoke-Command -ScriptBlock { … }`, `Start-Job`,
  `ForEach-Object` and `%` put verb and target in literal word positions exactly as `sudo` does, so
  `Invoke-Command -ScriptBlock { Remove-Item <sibling> }` was ALLOWED while `bash -c "rm -f <the same
  path>"` was refused — the allowed spelling being the one in this machine's primary shell. Closed by
  making a **bare** `{` or `}` a segment boundary in the powershell dialect, so a scriptblock body is
  its own segment: no cmdlet allowlist to fall behind, and quoted braces are not boundaries, so a
  brace in a string cannot cut a command in half. `chrt` was in the list above yet in no test, and
  that is how its own defect survived: its priority positional was read as the command, so
  `chrt -f 10 rm -f <sibling>` was allowed. Both are pinned in
  `tools/entry/shell-ownership-assert.test.mjs`.
- Text analysis cannot see through an alias, a function, a shell variable's *value*, an interpreter
  body, or a binary that writes without naming a recognized verb. Those reach class 2 (`ask`) when a
  recognized verb is present and are simply allowed when none is. A variable in the **verb** position
  (`& $cmd '…'`) is class 2 rather than allowed — independent review measured it filed as "names no
  recognized mutation", which is the one thing an unreadable verb is not evidence of.
- **Measured and accepted:** `node -e "require('fs').writeFileSync('README.md','x')"` is allowed. An
  ABSOLUTE path inside an interpreter body is detected; a relative one is not, and closing that needs
  the body evaluated. Anything with this much reach can also just call the interpreter — which is why
  the off switch is deliberately not reachable from inside a command (`COMPY_SHELL_OWNERSHIP_OFF=1 rm
  …` is refused; only the hook process's own environment turns it off).
- Here-documents, `| cat`-style status laundering and backslash continuations are lexed
  conservatively; a form that defeats the lexer lands in class 2 or is allowed.
- The guard covers the **tools this harness routes through hooks**. A process this session spawns
  that itself spawns a writer is not intercepted.
- No ownership decision is cached to disk, nothing is logged, and the checker never writes a claim,
  a lineage record or a board row. `verifySession` is called with `persist: false`, and only when a
  protected zone is actually involved — so the common case (an unprotected target) costs no board
  read at all.

## 7. Activation is not part of this lane

The candidate changes the hook that governs the session that wrote it. The handoff's rule 5 —
*"do not have a running agent rewrite its own guard"* — and Task 4's own activation clause put the
apply on a separate authorized process, after the live hook owner is quiescent.

Concretely: **merging this branch is the activation.** `.claude/hooks/` is read from the working
tree of the session root, so the moment `lane/shell-ownership-278` lands on `main`, the live session
rooted at `C:\Users\Kuya\code\sentinel` is running the new guard. The PR is therefore opened and
**left unmerged**, with an activation/rollback receipt in the PR body, and the completion criterion
Task 4 names — *"a fresh session exercising allowed and refused behaviours"* — belongs to whoever
performs the apply, not to this one.

## 8. The filesystem backstop (#356) — landed 2026-09-02, with the harvest

Sections 4 and 6 are honest about the shell checker's ceiling: it reads a command before it runs, and
what it cannot parse it cannot judge. The closeout (#356) declined the obvious next step — a third
shell parser — and added the check that does not parse at all. `scripts/lib/scope-drift.mjs` reads
what the tree actually is (`git status`, untracked included, plus every commit since `origin/main`)
and compares each changed path with the Write scope of the folder's claim, through the same
`claim-scope.mjs` the overlap check uses. Two readers, one library:

- `.claude/hooks/scope-drift-check.mjs` — PostToolUse on Bash, PowerShell, Write, Edit, MultiEdit
  and NotebookEdit; warn-only (`additionalContext`), silent when it cannot measure, and a finding is
  repeated only when the drifting set changes or ten minutes pass. `COMPY_SCOPE_DRIFT_OFF=1` silences it.
- `scripts/scope-drift-gate.mjs` — the verdict. `verify-local.ps1` runs it right after
  `git diff --check` on every push and FAILS on any changed path outside the claim. A folder with no
  session record, or no readable claim, passes with "not measured" on the log; it never pretends.

The claim is cached at `%LOCALAPPDATA%\CompyEntry\claims\<issue>.json` by `claim.mjs` when it
posts and re-read from the thread after ten minutes; the thread stays the record. The parser also
learned, from this repo's own closeout claim, that a disclaimer carries across a bare conjunction:
"No other `src/` or `src-tauri/` writes" used to grant `src-tauri/`. Division of labour, in one
line: the shell checker is early warning, the filesystem comparison is authoritative.
