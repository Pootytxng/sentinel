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
| `vscode://anthropic.claude-code/open?prompt=` | yes — runtime `registerUriHandler`; `contributes.uriHandler` is `null` | **no** | no | rejected |
| `claude-cli://open?cwd=&q=` | yes (HKCU) | cwd only | no — prefill, 5 000-char cap, opens no editor | rejected |
| `code --open-url` / `code --command` | absent from `code --help` | — | — | unavailable |
| `code chat "<prompt>"` | yes | cwd | yes | Copilot, not Claude |
| `.vscode/tasks.json` + `runOn: folderOpen` | yes | yes | yes | rejected — needs `task.allowAutomaticTasks`, a security setting |
| `code --disable-workspace-trust` | yes | yes | n/a | rejected — weakens a security control |
| **Claude CLI, cwd = worktree, positional prompt, `--ide`** | yes | **yes** | **yes** | **chosen** |
| SessionStart hook `additionalContext` | yes, already canonical and tracked | **yes, folder-scoped** | no — delivers context | **chosen carrier for the durable brief** |

Two measurements decided it:

- **The URI cannot be aimed.** Two probes (`PROBE-OK`, `PROBE2-OK`) both landed in the window that
  had already activated the handler, never in the freshly opened folder. The handler is registered at
  activation; `contributes.uriHandler: null` means no on-demand activation, so the URI goes wherever
  the runtime handler already lives. Codex measured the same independently (#23, comment 2).
- **The extension pre-fills, it does not submit.** `webview/index.js`:
  `de(()=>{ if(ge) a.current?.setInputText(ge), e.initialPrompt.value=void 0 },[e,ge])`.

**Honest limitation, disclosed rather than engineered around:** nothing installed can start a turn
inside the VS Code Claude *panel* from outside. Only the CLI submits. So the session runs in its own
console, bound to the VS Code window by `--ide`; VS Code is where the work is read and edited.

**Workspace Trust.** The extension declares `capabilities.untrustedWorkspaces.supported = false`, so
it is disabled in any untrusted folder — and every freshly created worktree is untrusted. VS Code's
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

- no local file, no sidecar → write it, disclose one line;
- file matches its sidecar hash → rewrite freely (ours);
- file exists with no sidecar, or its hash differs → **foreign: refuse, never overwrite**;
- anything above the local layer (process env) disagreeing → refuse, as before.

Establishment happens only after the verdict PASSes, and the verdict is re-taken afterwards, so a
launch cannot manufacture its own PASS.

## 4. The launch brief

A durable, plain-English brief naming the issue, its title, the branch, the folder, the tier, the
board's Next action and the newest handoff. It lives at `%LOCALAPPDATA%\CompyEntry\briefs\<issue>.md`
— **outside the worktree**, because an untracked file inside it would trip the launcher's own
dirty-tree refusal. It is delivered twice, deliberately:

1. as the Claude CLI's positional prompt — this is what makes the session *begin*;
2. as SessionStart `additionalContext` from the tracked hook — this is what makes it *survive*
   compaction, an extension restart, and any session started later in that folder.

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

`main` is not the launcher. The control clone is pinned to a launcher commit and knows it:
fetch, verify, **fast-forward only**, never over a dirty tree, restart into the verified code, and
refuse rather than guess. The Desktop shortcut keeps one stable target and stops passing `-NoExit`.

## 9. Owner-facing output

Glance first, proof on demand. Success is one confirmation naming task, folder, tier, and that Claude
started. Automatic repair is disclosed in one calm line. A refusal leads with the human consequence
and one exact next action. The full check table lives behind `--details`. A provenance failure is
never printed as `expected 150000 / actual 150000 FAIL` without saying what is actually wrong.
