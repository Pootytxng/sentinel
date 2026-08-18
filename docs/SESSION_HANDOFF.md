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

**None open as of 2026-08-18.** The data-root lane landed and its two branches are deleted:

- **PR [#132](https://github.com/Pootytxng/sentinel/pull/132)** (`973be73b`) — the §A0 updater-key
  backup tooling: `scripts/backup-updater-key.ps1` / `restore-updater-key.ps1` and
  `scripts/updater-key-backup-guard.test.mjs`.
- **PR [#131](https://github.com/Pootytxng/sentinel/pull/131)** (`6b41f098`), issue
  [#130](https://github.com/Pootytxng/sentinel/issues/130), now CLOSED — `src-tauri/src/data_root.rs`:
  the persistence root resolved by where it LANDS (`canonicalize` + NTFS `(volume serial, file id)`)
  rather than by the `APPDATA` string, with a `MutationRoot` capability every ledger write and every
  rollback must hold, plus `scripts/recover-data-root.mjs` and the owner's split-ledger recovery.

Merged in that order because #131's pre-push branch-disposition audit stayed red until #132's rows
reached `main`. Both rows are now dropped again — a MERGED row is perishable.

A fresh session should NOT resume from this file. Read `CLAUDE.md`, then `docs/RELEASE_STATE.md`
(live gate state) and `docs/BACKLOG.md` (what to pick up next).

## Carried forward — these outlive the lane

- **The shipped build does NOT carry `data_root.rs`.** v0.9.25 still joins `APPDATA`, so launching
  Compy as a child of the packaged Claude app would re-split the Trust Ledger again. **Until a build
  carrying the resolver ships, Compy is launched from the Desktop / Start menu only** — never from
  inside another app's terminal. Shipping that build retires this caveat.
- **Do not touch `C:\Users\Kuya\code\compy-data-root-recovery\`.** It holds the only copies of the
  pre-merge ledgers and the archived overlay (58 files). No deletes, no pruning, not even of
  "duplicates".
- **§A0 is now the owner's to run, and it is 2 minutes.** `pwsh scripts/backup-updater-key.ps1`,
  then `pwsh scripts/restore-updater-key.ps1 -BackupPath <the .txt> -Verify`, passphrase into his
  password manager. Details in `docs/OWNER_ACTION_CHECKLIST.md` §A0.
- **Nice-to-have, unbuilt:** a Settings row surfacing `get_data_root_report()`. The command and the
  support-export line exist, and the halt text already explains itself at the point of failure.

## Verification at the merge heads

`#132` at `8aeacf45` and `#131` at `18685d21`, both `scripts/verify-local.ps1` → **PASS**:
vitest 334 files / 4311 passed · tsc + build clean · cargo 946 passed / 0 failed · clippy clean.
Merge receipts recorded a **warning, not a pass**, on the final independent review: no non-writing
model (Codex) was reachable from the merging session, so that review is unverified rather than
self-approved.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not treat this "none open" note as evidence that nothing is in flight: `docs/WORK_CONTROL.md`
  and `git branch -a` are what say whether another lane holds a claim.
- Do not `git push` casually — `.githooks/pre-push` runs the full local gate (~4 minutes), including
  for a `--delete` refspec. Background it rather than letting it time out.
