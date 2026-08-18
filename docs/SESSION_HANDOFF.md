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
Branch `agent/data-root-integrity` @ `47714978`, worktree
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

## Blocked on the owner - the ONLY thing stopping this lane

He answered **B** (union merge, then archive the overlay). The tool is built, tested and pushed;
**the merge itself has NOT run.** The harness auto-mode classifier blocked the write to the real
`%APPDATA%\Compy\history.json` twice. That is the right instinct and was not routed around - it
needs his go-ahead or a Bash permission rule.

`f9057727` - `scripts/recover-data-root.mjs` + 15 falsified guards. Receipts are spliced as their
**exact source bytes**, never re-serialized: a `JSON.parse`/`stringify` round-trip would rewrite
`1.0` to `1` and round an integer past 2^53 *inside a snapshot* - the value a rollback writes back
onto Windows. Aborts on an id present in BOTH ledgers, a repeated id, a missing `id`/`applied_at`,
or a non-array. Dry-run by default; `--apply` takes hash-verified byte-for-byte backups of both
ledgers first and writes via the same temp+rename swap `history.rs` uses. `47714978` - residency
classified `npm-test` (the gate caught the new script, as designed).

**Dry run on the real desk, verified:** 3 + 61 -> **64 receipts** (39 applied, 25 rolled back),
`2026-05-28` -> `2026-07-29`, **zero id collisions**, both source hashes unchanged
(`41E8CDC1...B4203`, `ABB928FE...57EA`). Precondition 1 re-checked: compy not running, no pending
Gaming Mode contract in either root.

**The exact command still to run**, from `C:\Users\Kuya\code\sentinel-data-root-integrity`:

```
node scripts/recover-data-root.mjs --apply \
  --canonical "C:/Users/Kuya/AppData/Roaming/Compy/history.json" \
  --foreign "C:/Users/Kuya/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Compy/history.json" \
  --archive "C:/Users/Kuya/code/compy-data-root-recovery"
```

Then, and only then: **move** (never delete) the overlay `Compy` folder to
`C:\Users\Kuya\code\compy-data-root-recovery\overlay-Compy\`, and re-run the resolver - it must
return `Canonical`. If it does not, revert from the backups the tool just took.

**Correction to the record:** the canonical ledger's mtime moved to `2026-08-18T06:01:50Z` during
`cargo test`. Its **content is byte-identical** (hash unchanged, re-verified today). Cause:
`ensure_ledger_writable()` re-saves the current ledger as a writability canary, reachable in test
builds through the `#[cfg(test)]` `mutation_root()` escape. The earlier "neither data root was
written" phrasing was imprecise - no receipt changed, but a file timestamp did.

## Also open in this lane (not blocked)

- A dedicated Settings row surfacing `get_data_root_report()`. The command and the support-export
  line are in, and the halt text already explains itself at the point of failure — nice-to-have.
- No PR opened for `agent/data-root-integrity`.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- **Do not touch either data root except through the approved option-B steps above.** Outside
  those exact steps the invariant stands: no copy, rename, delete, dedupe, quarantine, reapply
  or rollback. Nothing is ever deleted - the overlay is *moved*, both originals backed up first.
- Do not run `scripts/release.ps1` or `scripts/ship-reinstall.ps1` in this lane.
- Do not treat a lane note as evidence of what else is in flight: `docs/WORK_CONTROL.md` and
  `git branch -a` are what say whether another lane holds a claim.
