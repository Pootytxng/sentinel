# Branch-disposition sweep history

> Moved out of `docs/BRANCH_DISPOSITIONS.md` on 2026-08-21 under TOKEN LAW §1 (current state only —
> history moves, never gets deleted) to pay for the #126 sweep record. These are point-in-time
> narratives of sweeps whose refs are all long gone; the live file keeps only the CURRENT sweep and
> the CURRENT rows. Back to the live file: [`../BRANCH_DISPOSITIONS.md`](../BRANCH_DISPOSITIONS.md).

## Incident record behind the live rules, moved verbatim 2026-09-15 (line budget)

Moved from [`../BRANCH_DISPOSITIONS.md`](../BRANCH_DISPOSITIONS.md) when it stood at 82/82 lines; the cap ratcheted 82 -> 79 in the same commit. The rules stay live; the incidents that produced them live here, as they stood.

**Why the file exists (#65):**

It exists because `docs/BACKLOG.md` claimed *"every branch has a verified disposition"* while nothing
had ever checked one ([#65](https://github.com/Pootytxng/sentinel/issues/65)); this makes it true.

**Rebase reintroduction (2026-08-05/06):**

**A branch that landed without a fast-forward stops being a no-op the moment `main` moves**, and
rebase is not the safe half: neither `--squash` nor `--rebase` leaves an ancestry link, so a later
three-way merge reintroduces the branch's own stale copies (it hit this file twice on 2026-08-05 and
destroyed an unreproducible proof on 2026-08-06 — [`archive/BRANCH_DISPOSITION_SWEEPS.md`](BRANCH_DISPOSITION_SWEEPS.md)).

**Stale local `main` (2026-08-05):**

**The base is `origin/main`, not the local `main`**, and the audit reads local remote-tracking refs,
so it reflects the last `git fetch` rather than the server. A local `main` is a checkout owned by
whichever worktree holds it, and a merge that lands on the trunk does not update it — that worktree
stays on the commit it had until someone pulls. On 2026-08-05 a `main` 4 commits behind made the
audit call a genuinely-merged branch unmerged. Pinned in `scripts/branch-disposition-audit.test.mjs`.

**Hand-written counts (2026-09-01, #309/#312):**

record is not a document making a claim about the fleet. **Counts are computed, never written.** Run
`node scripts/branch-disposition-audit.mjs` for the live split; a number written beside an
append-only record is wrong by the next commit, which it was twice on 2026-09-01 alone (#309/#312).

## Why the table left the live file (2026-09-02, #291)

Moved here 2026-09-03 to pay for the #337 prune-order paragraph. On 2026-09-02 all eight open PRs
edited the one disposition table that used to sit in the live file, so every lane conflicted with
every other lane merely by existing, whatever its subject. The table became one JSON record per ref
under `docs/dispositions/`, named by the ref's slug, so two lanes can never write the same file.

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

## The remaining-refs count, again (2026-09-01)

Moved here 2026-09-01 from `docs/BRANCH_DISPOSITIONS.md` to pay for five new rows added under
[#323](https://github.com/Pootytxng/sentinel/issues/323): `lane/docs-path-not-branch-310`,
`lane/guard-budget-313`, `lane/prune-list-truth-305`, `lane/receipt-modified-309`,
`lane/wrapper-allowlist-308`. The live file already keeps the law this repeats — re-deriving the
count is part of adding a row — so only the retired paragraph itself moves. Its wording and numbers
are unchanged except for one disclosed edit: the markdown link back to this same file, which cannot
meaningfully link to itself from inside its own body, is flattened below to a bare code span. It
read:

> Earlier sweeps (2026-08-04 · 2026-08-05 · 2026-08-12) and the 2026-08-21 sweep for
> [#126](https://github.com/Pootytxng/sentinel/issues/126) are archived in
> `archive/BRANCH_DISPOSITION_SWEEPS.md`: every ref the earlier three retired is long gone, and what
> the 2026-08-21 sweep proved live is in the table below. **Two live facts stay here**: the retired
> detached checkout's work is preserved under tag `preserve/checklist-disk-item-c5660e`, and **rule C
> of `scripts/handoff-worktree-truth.test.mjs` fails on a branchless checkout** — the shape an
> `origin` audit cannot see.
>
> **Twenty-five non-`PRESERVE` refs remain, and not one is retirable by proof** — each needs either
> an owner product-scope call or the lane that owns it, so #126 is part-discharged, not done: what is
> left is a decision queue, not a cleanup queue. Re-derived 2026-09-01 from
> `git ls-remote --heads origin` after a `--prune` fetch: twenty-eight refs besides `main`, three
> `PRESERVE`. **This is a count, so it goes stale every time the table grows and re-deriving it is
> part of adding a row**; its history of doing that is archived, as are older closed narratives
> (#160's landing and prune, the #193 "free desktop app" fix) — the live warning out of the second is
> in the `claude/review-consolidation-structure-9d13f2` row.

Already stale the day it was written: re-derived directly from `git ls-remote --heads origin` for
this same move (35 heads, minus `main`), the true count is **thirty-four refs besides `main`, three
`PRESERVE`** — no arithmetic on the twenty-eight above is trustworthy; only a fresh `ls-remote` is.

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

## 2026-09-01 — spent-at-zero checkout inventory, moved out of `docs/SESSION_HANDOFF.md`

Moved here to pay a doc-budget FAIL (122/120) from the ARCHIVE rather than from the cap, which is
the standing rule. Nothing in this list is a live obligation: `handoff-worktree-truth` rule C
requires every checkout that CARRIES commits `origin/main` cannot reach to be named in the handoff,
and every entry below carries zero, so rule C credits none of them. It is kept as a record of what
was spent at that moment, not as a claim about what is spent now — re-derive with
`git worktree list` + `git rev-list --count origin/main..<ref>` before relying on any line of it.

> Spent, at zero: `sentinel-fleet-guard-276`, `sentinel-segmented-237`, `sentinel-release-truth-256`,
> `sentinel-q9b-redactor-259`, `sentinel-q9b-stage2-258` (#258/#264 landed out of it), four of the SIX
> under `.claude/worktrees/` (seven entries; `data-root-integrity-432797` is not one), parked
> `sentinel-mission0-accent-landing`, `sentinel-mission1-test-workspace` (Mission 1 is ON main,
> #231/#233), `sentinel-q9b-stage2`. Every detached checkout carries zero, so rule C credits none.

One entry was already stale when it moved: `sentinel-segmented-237` stopped being spent the same day.
It was REUSED for `lane/vacuous-guards-304` (#304) instead of adding a 34th worktree. **Since
superseded**: `docs/SESSION_HANDOFF.md` no longer carries a worktree/fleet bullet at all — #291's
policy change replaced it with `node scripts/fleet-snapshot.mjs`, measured rather than written down —
so no live bullet names this checkout as a carrier today.
