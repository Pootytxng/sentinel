# Branch-disposition sweep history

> Moved out of `docs/BRANCH_DISPOSITIONS.md` on 2026-08-21 under TOKEN LAW §1 (current state only —
> history moves, never gets deleted) to pay for the #126 sweep record. These are point-in-time
> narratives of sweeps whose refs are all long gone; the live file keeps only the CURRENT sweep and
> the CURRENT rows. Back to the live file: [`../BRANCH_DISPOSITIONS.md`](../BRANCH_DISPOSITIONS.md).

## Sweeps of 2026-08-04, 2026-08-05 and 2026-08-12

Swept 2026-08-04 against `main` @ `1a513cb`; the `origin/claude/*` rows added 2026-08-05 against
`origin/main` @ `6712c14`, and re-proven the same day against `origin/main` @ `2e5365d` once the
three-PR stack (#69 → #71 → #72) had landed. Twelve lane refs are **gone rather than listed MERGED**,
pruned on landing per the rule above — `ci-entry-mainmodule-posix`, `ledger-honesty-optimize-station`,
`ci-health-reporter`, and the `claude/*` lanes behind PRs
[#74](https://github.com/Pootytxng/sentinel/pull/74) · [#78](https://github.com/Pootytxng/sentinel/pull/78) ·
[#79](https://github.com/Pootytxng/sentinel/pull/79) · [#80](https://github.com/Pootytxng/sentinel/pull/80) ·
[#81](https://github.com/Pootytxng/sentinel/pull/81) · [#82](https://github.com/Pootytxng/sentinel/pull/82) ·
[#83](https://github.com/Pootytxng/sentinel/pull/83) · [#84](https://github.com/Pootytxng/sentinel/pull/84) ·
[#85](https://github.com/Pootytxng/sentinel/pull/85).
A landed ref's row is its own tombstone: prune the ref and the row in the same commit that records
the merge, so this table only ever lists refs that still exist.

**Swept again 2026-08-12 against `origin/main` @ `4de1cba4` (tree `9e5a790`)** — the sweep the rule
above had been asking for, since a `MERGED` row is perishable and fourteen of them had been sitting
here through several trunk moves. Each of the seven `MERGED` refs was re-proven a no-op with
`git merge-tree --write-tree origin/main origin/<ref>` at that tree before deletion; the seven
`SUPERSEDED` refs kept the file-level evidence recorded when they were dispositioned, which is what
`SUPERSEDED` means and what re-proving cannot add. All fourteen were deleted from `origin` and their
rows dropped in this commit: `claude/harness-context-cleanup-700535`, `fix/fps-pid-identity`,
`recovery/codex-019fb092`, `integration/v0.9.8-hardened`, `release/v0.9.9-candidate`,
`recovery/local-v0.9.8-d9ced24`, `release/0.9.1`, `codex/fix-main-ci-site-stage`,
`codex/work-control`, `chore/ci-encoding-and-state-truth`, `i18n/zh-CN`, `latency-capture`,
`docs/claude-md-split`, `claude/nodejs-background-execution-fd4def`. Fourteen refs remained at that
sweep and none of them is `MERGED` or `SUPERSEDED`. A fifteenth, `origin/claude/bento-conversion`,
appeared later the same day, landed as PRs [#117](https://github.com/Pootytxng/sentinel/pull/117) /
[#120](https://github.com/Pootytxng/sentinel/pull/120) (merged 2026-08-13), and was deleted from
`origin` with its row dropped in this commit — a merged-and-deleted ref carries its evidence in the
PRs and needs no row.

## Why a MERGED row is perishable — the two 2026-08 incidents (moved 2026-08-21)

Moved verbatim out of `docs/BRANCH_DISPOSITIONS.md` "How a disposition is proven", which is under a
hard 120-line budget and had reached it. The operative rules stayed behind; only these two
narratives moved. They are the evidence for the rule that a `MERGED` row must be pruned in the same
breath as it is recorded.

**A branch that landed without a fast-forward stops being a no-op the moment `main` moves.** Neither
`--squash` nor `--rebase` leaves an ancestry link back to the branch — squash writes one new commit,
rebase copies each commit under a new hash — so a later three-way merge reintroduces the branch's own
stale copies of any file `main` has since changed. On 2026-08-05 that was this very file, twice.

**Rebase is not the safe half of that sentence.** On 2026-08-06 a lane rebase-merged cleanly, was
proven a no-op at that instant, and its row was flipped CLAIMED → MERGED in the next commit — a row
the *branch itself* had added. Both sides had then touched the same new line differently, so the
merge became a conflict and the proof could never be produced again. The audit caught it on `main`
within the minute; the fix was to prune, because there was nothing left to re-prove.
