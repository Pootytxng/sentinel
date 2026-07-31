# tools/entry — the Compy Start Work entrypoint

The launcher behind the **Compy – Start work** Desktop shortcut: it picks the task, verifies the
folder, creates what is missing, claims the issue, establishes the context tier, writes the durable
launch brief, and starts Claude in the right root. `cli.mjs` is the entry point; `launch.mjs` is the
sequence; `.claude/hooks/session-root-assert.mjs` is the only component that verifies the session
from inside it. Operating law lives in `docs/WORK_CONTROL.md`.

## Live journey receipt

2026-07-31 — the owner journey ran end to end from the Desktop shortcut into this folder, which the
launcher created from pinned base `d14f031` during the run. Evidence on issues #23 and #25.
