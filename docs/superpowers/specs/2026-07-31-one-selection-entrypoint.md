# One-selection owner entrypoint (#23)

Kuya double-clicks **Compy – Start work**, answers at most one plain question, and a verified Claude
session is running in the right folder. Everything else — issue, claim, worktree, branch, hooks,
context tier, session verification, durable handoff, project root — is infrastructure he never sees.

Supersedes nothing in `2026-07-30-single-entry-workflow.md`; it extends it. Every fail-closed rule
there still holds. This spec adds *establishment* where that one only *verified*, and adds the
handoff into a running Claude.

## 1. Capability evidence (measured on this machine, 2026-07-30/31)

The owner's constraint: inspect what is installed; invent no URI, command, extension API, or
injection mechanism. Installed: Claude Code CLI `2.1.220` (`C:\Users\Kuya\.local\bin\claude.exe`),
VS Code `1.131.0`, extension `anthropic.claude-code@2.1.220`.

| Candidate | Exists | Can be aimed at a folder | Starts a turn | Verdict |
|---|---|---|---|---|
| `vscode://anthropic.claude-code/open` | yes — runtime `registerUriHandler`; `contributes.uriHandler` is `null` | **no** | not by itself | **chosen — first attempt, bounded** |
| the same URI's `?prompt=` | yes | no | no — prefills the composer, never submits | rejected as a carrier |
| `claude-cli://open?cwd=&q=` | yes (HKCU) | cwd only | no — prefill, 5 000-char cap, opens no editor | rejected |
| `code --open-url` / `code --command` | absent from `code --help` | — | — | unavailable |
| `code chat "<prompt>"` | yes | cwd | yes | Copilot, not Claude |
| `.vscode/tasks.json` + `runOn: folderOpen` | yes | yes | yes | rejected — needs `task.allowAutomaticTasks`, a security setting |
| `code --disable-workspace-trust` | yes | yes | n/a | rejected — weakens a security control |
| **Claude CLI, cwd = worktree, `--ide`** | yes (`--ide`: "Automatically connect to IDE on startup") | **yes, by construction** | yes, via the hook | **chosen — fallback** |
| **SessionStart `initialUserMessage`** | yes — present in `claude.exe` 2.1.220 | **yes, folder-scoped** | **yes** | **chosen — the only thing that starts a turn** |
| SessionStart `additionalContext` | yes, already canonical and tracked | **yes, folder-scoped** | no — delivers context | **chosen — what survives compaction** |

Three measurements decided it:

- **The URI cannot be aimed.** Two probes (`PROBE-OK`, `PROBE2-OK`) both landed in the window that
  had already activated the handler, never in the freshly opened folder. The handler is registered at
  activation; `contributes.uriHandler: null` means no on-demand activation, so the URI goes wherever
  the runtime handler already lives. Codex measured the same independently (#23, comment 2).
- **The extension pre-fills, it does not submit.** `handleUri` in the installed `extension.js`:
  `case"/open":{let w=x.get("session")??void 0,E=x.get("prompt")??void 0;
  Pe.commands.executeCommand("claude-vscode.primaryEditor.open",w,E);return}` — and the composer end,
  `webview/index.js`: `de(()=>{ if(ge) a.current?.setInputText(ge), e.initialPrompt.value=void 0 },[e,ge])`.
- **The turn is started by the hook, not by whatever opened the session.** `initialUserMessage` is
  present in the installed CLI binary, and the tracked `session-root-assert.mjs` emits it **only when
  `source === "startup"`** — on `compact`, `resume`, `clear` or `fork` an injected instruction would
  read as a fresh order from Kuya and discard what the session was mid-way through.

So the opener is not the thing that has to work; the hook is. That turns an un-aimable URI from a
blocker into a *first attempt*:

    code <folder>  →  wait for a LIVE bridge on that exact folder
                   →  fire the open-URI, wait 45 s for the nonce
                   →  not claimed? start the CLI with cwd = <folder>, wait 90 s
                   →  one line, then exit

Both paths end at the same SessionStart hook in the same folder, so they start identically. The CLI
carries **no positional prompt** even though it accepts one: a second copy of the brief is a copy that
can disagree with the first, and the command-line copy is the one that dies at compaction.

**Honest limitation, disclosed rather than engineered around:** the URI may open a Claude panel in an
unrelated VS Code window that had already activated the extension. It cannot turn a wrong-folder
launch into a reported success — the handoff nonce is per-folder — and the visible cost is a panel the
owner closes. The fallback is what makes the journey finish anyway, and `--ide` is added only when a
live bridge names the target folder.

**Workspace Trust.** The extension declares `capabilities.untrustedWorkspaces.supported = false`, so
it is disabled in any untrusted folder. Whether a *freshly created worktree* is untrusted was **not**
established: the probe that showed the extension inert was created under `%LOCALAPPDATA%\Temp`, not
under `C:\Users\Kuya\code`, and VS Code can inherit trust from an ancestor — so the measurement
proves the scratch case and says nothing about a new folder beside the others in the code root. Treat
it as a possibility to disclose, not a certainty to design around, until the real `code`-root path is
measured in the sandbox journey. VS Code's
trusted-folder store could not be located on this machine (absent from `globalStorage/state.vscdb`,
`.backup`, `storage.json`, and the workspace state DB), so trust cannot be *detected* and must never
be *written*. The launcher discloses in one line and continues; the trust prompt is a legitimate
owner decision (outcome 8).

## 2. IDE bridge readiness (the condition, not a sleep)

`~/.claude/ide/<port>.lock` records `workspaceFolders`. A bridge is READY when a lock names the exact
canonical target folder **and** its port is listening. Lock existence alone is not readiness (three
stale locks naming `sentinel` exist with no listener). The wait is bounded; zero or several matching
live bridges is a stated outcome, not a hang: the CLI still starts in the right root, without `--ide`,
and the launcher says so.

## 3. The tier is established, not merely observed

`settings.window` compared an intended window with an effective one and refused on disagreement. It
had no way to *make* them agree, so a marathon issue in a fresh worktree refused forever and the
owner was left to set an env var by hand — the chore this program exists to delete.

The launcher now writes the intended window into `.claude/settings.local.json` (gitignored, the
documented per-machine layer), and only ever a launcher-owned one. Ownership is proved by a sidecar
under `%LOCALAPPDATA%\CompyEntry\tiers\` recording the exact content hash last written:

Ownership is proved three ways, each giving up strictly less than the one above it:

- **the exact bytes recorded** — the sidecar hash matches the file. The usual case.
- **the window recorded**, in a file holding nothing but launcher-written material. `writeOverlay`
  rewrites this same file after `establishTier` to merge the marked session-root assert, which changes
  the bytes and never the window; byte equality alone therefore called the launcher's own folder
  foreign after every launch that installed the assert.
- **no window at all**, in a file holding nothing but launcher-written material — a pre-sidecar folder
  (overlay-only, written before tier records existed) or an empty stub. It configures nothing, so
  adopting it takes nothing from anybody.

"Launcher-written material" is exact: `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`, and `hooks.SessionStart`
groups carrying the assert marker. One key of the owner's own — any other env var, any unmarked hook,
any other top-level key — and none of the three clauses apply.

What none of them give up: **a window the launcher did not record is the owner's own pin.** Refuse,
never overwrite, not even to reach a PASS. And the tracked `settings.json` must be *readable* before
any of this: absent and unreadable are different facts, and establishing a tier over settings that
could not be parsed is the same mistake aimed at the tracked layer.

Both writes go through temp+rename, and the sidecar is re-stamped after the overlay writes, so the
exact-bytes proof stays primary instead of degrading to the fallback on every folder.

**Sequence.** The `settings.window` row is a failing check whenever the intended tier is absent or
mismatched, so "establish only after the verdict PASSes" could never fire — the first verdict cannot
pass, and the write that would fix it never happens. That is the first-launch deadlock #21 closed,
one layer along. The real order is: full preliminary measurement; the tier row is permitted to pass
*while establishing* and only for a specifically launcher-repairable tier defect, every other
non-repairable safety check still holding; write the owned local tier; then re-resolve the effective
window from disk and refuse if the launch did not actually get it.

That last step is a re-read of the window, not a second full preflight — stated plainly here because
the earlier wording claimed a re-taken verdict that the code does not perform.

## 4. The launch brief

A durable, plain-English brief naming the issue, its title, the branch, the folder, the tier, the
board's Next action and the newest handoff. It lives at `%LOCALAPPDATA%\CompyEntry\briefs\<issue>.md`
— **outside the worktree**, because an untracked file inside it would trip the launcher's own
dirty-tree refusal. One mechanism delivers it — the tracked SessionStart hook in that folder — in two
shapes, deliberately:

1. `initialUserMessage`, on a `startup` start only — this is what makes the session *begin*, in the
   panel and at the CLI alike;
2. `additionalContext`, on *every* start — this is what makes it *survive* compaction, an extension
   restart, and any session started later in that folder.

## 5. Session verification, resumable

The single-use token turned legitimate continuity into "unverified": the first SessionStart consumed
it, and the post-compaction SessionStart of the *same session* then refused. Consumption is the wrong
model — it answers "has this token been used" when the question is "is this session the one that was
launched".

The record becomes per-root and lineage-aware. It keeps verifying issue, root, repository, branch and
tier; it permits resume within a bounded lifetime; it refuses replay from another root, branch or
issue. `consumedAt` becomes a *record* (first-seen, last-seen, count) rather than a gate. Live branch
is now verified too — it was stored and never checked. Expiry is deterministic and stale records are
removed.

## 6. Selection

- Exactly one valid, owned, unexpired, resumable Active task → **resume it without asking**. (This
  supersedes #18's "Enter is a keypress, not an assumption" for the *auto-resume* case only: the rule
  was written against silently starting an *unrelated Ready* task, which stays forbidden.)
- Otherwise a menu: short names, `Resume`/`Start`, `standard`/`marathon`, one stated input rule,
  accepting the displayed position **or** the issue number.
- Items that cannot be started are shown **unavailable with a plain reason**, never hidden and never
  silently selectable: another lane's task, an owner gate, Blocked, an expired foreign claim, a folder
  another Active item is writing in.
- A Ready item belonging to another executor is unavailable to this lane. (Today's only Ready item,
  #13, is lane `Codex`; the old menu offered it and would have claimed it as Claude Code.)

## 7. A live writer is a process fact

`processes.mjs` inventoried builders and installers but not `claude.exe`, so a second writer could be
started on a folder a live session already owns. Claude processes are now inventoried and contend
when they are attached to the target folder, which also gives the resume path its evidence.

## 8. Control activation

`main` is not the launcher — this was live while the program was being written, with the control
clone two merges behind on a branch that would never receive the finished work. The control clone is
pinned to a launcher commit and knows it:
fetch, verify, **fast-forward only**, never over a dirty tree, restart into the verified code, and
refuse rather than guess. The Desktop shortcut keeps one stable target and stops passing `-NoExit`.

## 9. Owner-facing output

Glance first, proof on demand. Success is one confirmation naming task, folder, tier, and that Claude
started. Automatic repair is disclosed in one calm line. A refusal leads with the human consequence
and one exact next action. The full check table lives behind `--details`. A provenance failure is
never printed as `expected 150000 / actual 150000 FAIL` without saying what is actually wrong.

## 10. What is live, and what proved it

Live on this machine at `8bc937f`: the Desktop shortcut runs `compy-control`, which fast-forwarded
itself `d14f031 → 0bdd8c9 → 754a451 → 8bc937f` across the program and re-executed into each verified
commit. Kuya double-clicks, answers at most one question, and the window closes on him.

Proven by running it, not by reading it (2026-07-31, fixture issue #25 in a throwaway worktree):

- **One launch, one session.** The lineage record ended a full journey at `seenCount 1`; a new launch
  resets it, so a second session on one claim is arithmetic, not judgement.
- **Claude begins without pasting.** `SessionStart:startup` returned the `# Task #25` brief as
  `additionalContext` and an opening turn was enqueued; the first thing in the transcript is Claude
  working, not a prompt waiting to be copied.
- **The terminal leaves.** 19s, exit 0, no launcher process alive.
- **Resume is not "unverified".** A session started 8 minutes after the token was consumed was told
  *session resumed*, lineage `1 → 2`, sliding expiry renewed, same brief.
- **Replay refuses without spending anything.** Wrong root, wrong branch and wrong repo each stopped
  with `consumedAt=null` — a replay neither writes nor burns the launch.

Two defects surfaced *after* the acceptance run and are fixed and guarded, in this order because the
first one hid the second:

1. The account of a run stopped at the check table, so everything the launcher did after opening the
   editor lived only in a window that closes on success — including the failure §8 cites the log for.
   `run-account.test.mjs` executes the real source and pins both halves: nothing on disk before there
   is a verdict to write about, then the whole run in order.
2. With the run finally on disk, the success line read `150k ΓÇö standard`. PowerShell was decoding
   node's stdout as the OEM code page, so every word the launcher speaks on success — and every task
   name in the picker, and every sentence of a refusal — was one non-ASCII character away from noise
   on Kuya's screen. `output-encoding.test.mjs` puts code page 850 on a real console and proves the
   fix repairs it.

Honest limits: the open-URI cannot be aimed at a specific window, so the launcher waits for a session
to claim the token rather than assuming the right one appeared; the conflicting-writer refusal is
covered by `preflight.test.mjs` and a pre-merge live proof rather than a fresh live board conflict;
and a fully cold "no VS Code running at all" start cannot be proven from inside a VS Code session.
