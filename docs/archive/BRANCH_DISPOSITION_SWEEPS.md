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

## Closed narratives of the 2026-08-21 sweep

> Moved 2026-08-26 to pay `docs/BRANCH_DISPOSITIONS.md`'s line budget. Both record work that
> finished: a ref merged and pruned, and a PR landed. Neither is a claim about any ref that is live
> today.

**[#160](https://github.com/Pootytxng/sentinel/pull/160) is no longer one of them — MERGED
2026-08-24** as `bf1b56c8`, adopted on the owner’s *“clear up any remaining work”* turn after four idle
days; its ref is pruned and its row dropped in the same change, because the audit fails both ways.
[#163](https://github.com/Pootytxng/sentinel/pull/163) (`lane/cleanup-train-2026-08-20`) still
belongs to another lane — hands off, not adjudicate. **Eight
non-`PRESERVE` refs remain, and not one of them is retirable by proof**: each needs either an owner
product-scope call or the lane that owns it. #126 is therefore part-discharged, not done — the
proof-retirable refs are gone, and what is left is a decision queue, not a cleanup queue.

**One live finding surfaced by the re-proof — LANDED 2026-08-22 on the owner's word ("land 193").**
`main`'s `site/llms.txt:5` called Compy "a free desktop app"; PR
[#193](https://github.com/Pootytxng/sentinel/pull/193) merged as `d5571766`, changing it and its real
source `site/generate.mjs:441` to "a Windows desktop app with a free tier". The unlanded line on
`claude/review-consolidation-structure-9d13f2` was **not** used — it says "free forever", the exact
phrasing the 2026-07-21 decree supersedes.

## Sweep of 2026-08-21 — the three refs it retired

Moved here 2026-08-31 to pay for the `lane/css-margin-separators-274` row, under the rule the live
file states about itself: it is append-by-design, so a new ref is paid for from the archive, never
from the cap. All three refs below were deleted from `origin` on 2026-08-21 and none has existed
since; this is the point-in-time record of *why*.

**Swept 2026-08-21 against `origin/main` @ `f8969e5f` (tree `37d1907`)** — issue
[#126](https://github.com/Pootytxng/sentinel/issues/126)'s re-proof, run on all fifteen refs, not
remembered from the rows. `git merge-tree --write-tree origin/main origin/<ref>` at that tree: three
are no-ops (one of them the `PRESERVE` beta ref, which stays), twelve carry work. **Three retired —
two `MERGED`, one `SUPERSEDED` on file-level evidence** — deleted from `origin` with their rows
dropped in that commit:

- `claude/foreground-courtesy-handoff-82687b` — **MERGED**, no-op at this tree; landed as PR
  [#101](https://github.com/Pootytxng/sentinel/pull/101) (2026-08-11). Its row still read CLAIMED.
- `docs/design-foundation` — **MERGED**, no-op at this tree; landed as PR
  [#107](https://github.com/Pootytxng/sentinel/pull/107) (2026-08-12). Its row still read CLAIMED.
- `claude/checklist-disk-item-c5660e` — **SUPERSEDED** (not a no-op; content reached `main` by
  another path, which is exactly what that disposition means). Both of its contributions are on the
  trunk: **A_disk** is in `docs/OWNER_ACTION_CHECKLIST.md` and has since been *closed* (2026-08-11/12)
  and archived (2026-08-18), and the duplicate `origin/docs/design-foundation` row it existed to drop
  was dropped by that same commit. Nothing of it is left to land. **Correction 2026-08-26: this row
  used to end "and no worktree held it", which was false for fifteen days.**
  `.claude/worktrees/merge-prs-tauri-visibility-c5660e` held it detached at `defcf0ff`, four commits
  `origin/main` cannot reach — 2026-08-11 edits to two docs since rewritten, so landing them is a
  re-derivation. No guard saw it: an audit that reads `origin` refs is blind to a branchless
  checkout. Rule C of `scripts/handoff-worktree-truth.test.mjs` now fails on that shape. **Disposed
  2026-08-26:** checkout retired, its work preserved under tag `preserve/checklist-disk-item-c5660e`
  — the four commits plus one more holding an uncommitted edit found there that stripped every
  comment out of `.codex/config.toml`, which is the record of why that lane is read-only.

## The remaining-refs count, and its own history of going stale

Moved here 2026-08-31 from `docs/BRANCH_DISPOSITIONS.md` to pay for the `lane/segmented-a11y-237`
row. The live file keeps the LAW the episode taught — re-deriving the count is part of adding a row
— and no longer carries the episode: that paragraph read **"nine"** long after it stopped being
true, having been written before the `claude/exciting-robinson-0ce4d5`, `lane/native-routing-271`
and `lane/css-margin-separators-274` rows existed. It was re-derived to twelve on 2026-08-31, then
to fourteen the same day when `lane/fleet-guard-failclosed-276` and `lane/shell-ownership-278` were
dispositioned. Three wrong values inside one file is the argument for the law: a count carried
forward is not evidence, and `git ls-remote --heads origin` after a `--prune` fetch is.

## 2026-09-01 — two measurements moved out of the live doc

Moved out of `BRANCH_DISPOSITIONS.md` to pay for the row that lane's own first push would
create (#305). Both rules stay in that file; these are the measurements behind them.

**A two-tree `git diff origin/main <ref>` invents deletions.** It counts every file `main`
gained afterwards as a removal, so it reports removals a three-way merge would never make.
Measured on the three rows that sat below it at the time, it would have claimed **345, 372 and
512 deletions against a true zero**.

The companion example — a three-dot diff reporting +195 lines for `latency-capture`, every
symbol of which was already on `main` — was not moved here: it already lives in the header of
`scripts/branch-disposition-audit.mjs`, so the doc was carrying a second copy, not a record.

**A count written beside an append-only table is wrong by the next commit.** The live count of
refs went stale twice on 2026-09-01 alone, both times by the very lane that added the row —
#312's finding in a different costume. The cure is that no count is pinned in that prose at
all: `node scripts/branch-disposition-audit.mjs` prints the live split on OK, *after* it has
proven the rows and origin's refs are one-to-one. That ordering is what makes the printed
number trustworthy rather than merely current.
