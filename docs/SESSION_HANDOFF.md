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
Branch `agent/data-root-integrity` @ `24ddd2ba`, worktree
`C:\Users\Kuya\code\sentinel-data-root-integrity` — clean, pushed, **no PR opened**. The ownership
claim is posted on #130 (Claude Code is the write owner).

### What landed

`795d8ff5` — Compy was launched at least once as a child of the MSIX-packaged Claude app, which
inherits that package's filesystem overlay: `APPDATA` still *reads* correctly while resolution
lands in `…\AppData\Local\Packages\<family>\LocalCache\Roaming\`. The Trust Ledger split in two.

- `src-tauri/src/data_root.rs` (new) — `DataRootDecision` resolves by where the root **lands**
  (`std::fs::canonicalize` = `GetFinalPathNameByHandle`, plus NTFS `(volume serial, file id)` vs the
  host package's overlay), never by the env string. Variants `Canonical` · `Sandbox` · `Redirected`
  · `Conflict` · `Unavailable`.
- `MutationRoot` is a capability **type**, constructible only from `Canonical`. Every ledger write
  and every rollback demands possession. `history.rs::begin_mutation()` is the sole acquisition
  point; seven gateways + `actions.rs::dispatch_rollback` route through it.
- `compy_data_dir()` no longer joins `APPDATA`; the `C:\Temp` fallback is gone (unset ⇒
  `Unavailable`). `migrate_legacy_data_once` runs only against a verified canonical root.
- `get_data_root_report()` command (declared in `build.rs` + `capabilities/default.json`) and a
  path-free `- Data root:` line in the support-export header.
- `scripts/lib/canonical-data-root.ps1` — the same decision in PowerShell; `release.ps1` and
  `ship-reinstall.ps1` consume it instead of `Join-Path $env:APPDATA "Compy"` (both previously
  failed **open** twice). Verified refusing on the real desk.

`ee4529db` — checklist item **B_dataroot** (+ three closed §A items archived to stay under budget).
`24ddd2ba` — the `docs/BRANCH_DISPOSITIONS.md` row for this branch.

**Design predicate 1 was falsified and demoted.** Package identity is NOT decisive: this work was
built from Store PowerShell — packaged, identity present, zero redirection. As specified the
resolver would have halted Compy for anyone with a Store terminal. Identity is now evidence + the
overlay lookup key; final-path resolution is decisive; NTFS identity is the new P4.
`docs/decisions/2026-08-18-canonical-data-root.md` is amended to match.

**Guards:** 17 unit guards over a pure `resolve()` (incl.
`package_identity_alone_does_not_halt_a_clean_machine`, pinning the falsification, and
`only_a_canonical_decision_yields_the_mutation_capability`), plus `scripts/data-root-guard.test.mjs`
— inverted corpus over Rust **and** the PowerShell preflights, falsified in both languages.
Legitimate non-root env reads carry a greppable `data-root-allow` marker with its reason.

**One test-build escape:** `mutation_root()` is `#[cfg(test)]`-overridden to issue a token for the
effective root, because this desk is *currently* in `Conflict` and ten pre-existing mutation suites
would otherwise refuse instead of asserting. Release builds have no such path; refusal is falsified
variant-by-variant through the pure `mutation_root_from()`.

**Verification:** cargo 946 passed / 0 failed · clippy clean · tsc clean · vitest 332 files / 4283
passed · `doc-budget` ALL PASS · `verify-module-map` OK · `verify-release-state` 0 broken.

## Blocked on the owner — the ONLY thing stopping this lane

The resolver correctly returns **`Conflict`** on Kuya's machine (canonical 3 receipts vs 61 in
`…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Compy\history.json`), so **this build refuses
every apply and rollback on his desk until recovery.** Designed contract, not a regression.

He must pick **A** (freeze) / **B** (union merge + archive the overlay — recommended; receipt IDs
are provably disjoint) / **D** (archive and accept losing undo for the 12 live-but-unrollbackable
changes). Full evidence + exact preconditions: the recovery comment on #130; owner-facing summary:
`docs/OWNER_ACTION_CHECKLIST.md` §B_dataroot.

**If he answers B:** build the union-merge tool **unit-tested over fixtures first, as its own
commit** — abort on any receipt-ID collision, byte-for-byte backups of both ledgers before
anything, no rollback/reapply/dedupe as part of recovery, the legacy contract-less receipt carried
across as-is, and the overlay copy **moved** (never deleted) only after the merged ledger verifies.

## Also open in this lane (not blocked)

- A dedicated Settings row surfacing `get_data_root_report()`. The command and the support-export
  line are in, and the halt text already explains itself at the point of failure — nice-to-have.
- No PR opened for `agent/data-root-integrity`.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- **Do not touch either data root.** Both stay byte-for-byte: no copy, merge, rename, delete,
  dedupe, quarantine, reapply or rollback. Standing invariant, not a phase.
- Do not run `scripts/release.ps1` or `scripts/ship-reinstall.ps1` in this lane.
- Do not treat a lane note as evidence of what else is in flight: `docs/WORK_CONTROL.md` and
  `git branch -a` are what say whether another lane holds a claim.
