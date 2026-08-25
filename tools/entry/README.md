# tools/entry — the Compy Start Work entrypoint

The launcher behind the **Compy – Start work** Desktop shortcut: it picks the task, verifies the
folder, creates what is missing, claims the issue, establishes the context tier, writes the durable
launch brief, and starts Claude in the right root. `cli.mjs` is the entry point; `launch.mjs` is the
sequence; `.claude/hooks/session-root-assert.mjs` is the only component that verifies the session
from inside it. Operating law lives in `docs/WORK_CONTROL.md`.

## What verifies a session (rebuilt for #216, 2026-08-25)

**By facts, not by a launch token.** A session is verified when three things are true of the folder
it is running in, all measured at SessionStart and again on every project write:

1. the folder is a git work tree of `Pootytxng/sentinel`;
2. Work Control names it — an issue's `Worktree / branch` field points at this folder, and the live
   branch is the one the board put that issue on;
3. no **live** competing writer holds it.

Any Claude tab standing in the right folder therefore verifies, whether the launcher started it or
the owner opened it himself. The launcher's remaining job is **creating** the worktree, the claim and
the brief — not admitting anybody to them.

The per-folder record in `%LOCALAPPDATA%\CompyEntry\sessions\` is a **writer lease** and only that:
it names the conversation currently writing here, with its pid, so a second one does not join it. It
authorizes nobody. #216 is what happens when a record like that is treated as authorization: a
launched CLI died with no process and no transcript, and its record held the folder for twelve hours
against the owner's own window standing in the same folder on the same branch. Liveness is now
measured — the pid, and the session's transcript — and a record whose conversation is gone lapses.
`tools/entry/writer-contention.test.mjs` is the guard.

`launch.json` survives as a launcher-internal handshake (the `ide-bridge` nonce and the brief
digest). Nothing in the assert reads it.

## Live journey receipt

2026-07-31 — the owner journey ran end to end from the Desktop shortcut into this folder, which the
launcher created from pinned base `d14f031` during the run. Evidence on issues #23 and #25.
