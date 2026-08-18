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

**DATA-ROOT INTEGRITY — issue [#130](https://github.com/Pootytxng/sentinel/issues/130).**
Branch `agent/data-root-integrity`, worktree `C:\Users\Kuya\code\sentinel-data-root-integrity` —
**no PR opened.** The ownership claim is posted on #130 (Claude Code is the write owner).

### The blocker is CLEARED — the recovery ran 2026-08-18

The owner said *"run the merge"*. It ran, in the approved order, nothing routed around:

1. **Preconditions re-checked** — compy not running, both ledgers present, dry run reproduced the
   rehearsal exactly (canonical `41E8CDC1…B4203` / 3 receipts, overlay `ABB928FE…57EA` / 61).
2. **Union merge applied** — `scripts/recover-data-root.mjs --apply`. Backups of both inputs were
   written first to `C:\Users\Kuya\code\compy-data-root-recovery\` at their verified hashes. Result:
   **64 receipts** (39 applied, 25 rolled back), `2026-05-28` → `2026-07-29`, zero id collisions,
   new hash `8429CEA34230FBB777CD40D9DBD92F964C40100623DC9E09F7FE33BDA90D0F38`. Read-back confirms
   64 receipts and 64 unique ids.
3. **Overlay archived by MOVE** — all 58 files from
   `…\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Compy` to
   `C:\Users\Kuya\code\compy-data-root-recovery\overlay-Compy\`. The source path is gone; nothing
   was deleted.
4. **Resolver re-run on the desk** — `Get-CanonicalCompyDataRoot` returns
   `C:\Users\Kuya\AppData\Roaming\Compy`, Exists = True: **`Canonical`, no longer `Conflict`**, so
   applies and rollbacks are unblocked on this machine. The revert-from-backups condition was never
   reached.

**Scope note, deliberate:** only `history.json` was merged. The overlay also held `sessions.json`
(1.1 MB), `benchmark.json`, `experiments.json`, `drift.json`, `intelligence.json` and `exports/`;
each had a canonical counterpart of its own, so those are archived intact rather than unioned.
Recovering any of them is a copy out of `overlay-Compy\`.

**Live-build caveat for the owner:** the shipped v0.9.25 does NOT yet carry `data_root.rs`. It still
joins `APPDATA`, so launching Compy as a child of the packaged Claude app would re-split the ledger.
Until a build carrying this lane ships, Compy must be launched from the Desktop / Start menu only —
never from inside another app's terminal.

## Still open in this lane

- **No PR opened** for `agent/data-root-integrity` — that is the next step.
- A dedicated Settings row surfacing `get_data_root_report()`. The command and the support-export
  line are in and the halt text explains itself at the point of failure — nice-to-have.
- Shipping a build that carries the resolver, which retires the launch caveat above.

## What landed earlier in this lane (unchanged)

`795d8ff5` — `src-tauri/src/data_root.rs`: the root resolved by where it LANDS (`canonicalize` +
NTFS `(volume serial, file id)` against the host package overlay), never by the env string;
`MutationRoot` as a capability type constructible only from `Canonical`, demanded by every ledger
write and every rollback (`history.rs::begin_mutation()` the sole acquisition point);
`compy_data_dir()` no longer joins `APPDATA` and the `C:\Temp` fallback is gone;
`get_data_root_report()`; `scripts/lib/canonical-data-root.ps1` consumed by `release.ps1` and
`ship-reinstall.ps1` (both previously failed **open**). Design predicate 1 — package identity is
decisive — was **falsified and demoted**: identity is evidence plus the overlay lookup key,
final-path resolution is decisive; `docs/decisions/2026-08-18-canonical-data-root.md` is amended.

`f9057727` — the merge tool: receipts spliced as their **exact source bytes**, never re-serialized.

Guards: 17 unit over the pure `resolve()` + `scripts/data-root-guard.test.mjs` (inverted corpus,
Rust **and** PowerShell) + 15 merge-tool guards. One `#[cfg(test)]` escape in `mutation_root()`
exists because the desk *was* in `Conflict`; release builds have no such path.

Last full verification (at `11ba49b7`): cargo 946 passed / 0 failed · clippy clean · tsc clean ·
vitest 332 files / 4283 passed · doc-budget ALL PASS · verify-module-map OK · verify-release-state
0 broken.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- **Do not touch `C:\Users\Kuya\code\compy-data-root-recovery\`** — it holds the only copies of the
  pre-merge ledgers and the archived overlay. No deletes, no pruning, not even of "duplicates".
- Do not run `scripts/release.ps1` or `scripts/ship-reinstall.ps1` in this lane.
- Do not treat a lane note as evidence of what else is in flight: `docs/WORK_CONTROL.md` and
  `git branch -a` are what say whether another lane holds a claim.
