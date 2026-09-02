# Branch dispositions — every remote ref, and why it still exists

> **Current state only.** One record per live ref on `origin`, in `docs/dispositions/`.
> `scripts/branch-disposition-audit.mjs` fails the build when a ref has no record, when a record
> names a ref that is gone, or when a `MERGED` record is not actually a no-op against `main`. Run `node scripts/branch-disposition-audit.mjs`.
>
> It reports **PARTIAL**, not OK, on a checkout that cannot see all of `origin` — a shallow or
> single-branch clone (which is what `actions/checkout@v4` makes by default) may not say a ref is
> gone, because it never looked. See `refSetCoverage` in that script.

It exists because `docs/BACKLOG.md` claimed *"every branch has a verified disposition"* while nothing
had ever checked one ([#65](https://github.com/Pootytxng/sentinel/issues/65)); this makes it true.

## How a disposition is proven

The authoritative test is **merge-tree**, not ahead/behind: lanes land through PRs, so the commits
on `main` carry different hashes and `git cherry` / `A...B` both mislead. Run `git merge-tree
--write-tree origin/main origin/<branch>`: a tree equal to `git rev-parse origin/main^{tree}` means
merging changes nothing → **MERGED**. Otherwise diff that tree against `main` and disposition on the
result — **never a two-tree `git diff origin/main <ref>`**, which counts every file `main` gained
afterwards as a deletion and so invents removals a three-way merge would never make (measured, in
the sweeps archive). Ask whether a merge drops anything with `git diff --diff-filter=D --name-only
origin/main <tree>`, never with line counts: marker text inflates those, while the path list
survives conflicts — **provided no conflict is modify/delete**, the one class that could hide a path
loss, since ort keeps the file and reports a conflict instead of a deletion. Check that too. And
read the result for what it is: an empty list bounds **mechanical** risk only. Content `main` gained
can still be lost by a human resolving those conflicts badly, so "drops nothing" never means "safe
to merge blind".

**A branch that landed without a fast-forward stops being a no-op the moment `main` moves**, and
rebase is not the safe half: neither `--squash` nor `--rebase` leaves an ancestry link, so a later
three-way merge reintroduces the branch's own stale copies (it hit this file twice on 2026-08-05 and
destroyed an unreproducible proof on 2026-08-06 — [`archive/BRANCH_DISPOSITION_SWEEPS.md`](archive/BRANCH_DISPOSITION_SWEEPS.md)).

**A MERGED row is therefore perishable: prune the ref in the same breath as recording the merge**,
rather than leave a row that fails its own audit on the next unrelated edit — including the edit that
records the merge. **The audit enforces it**, and its failure text names the prune: `git push origin
--delete <branch>`, neither blocked on this machine nor stopped by the gate (`.githooks/pre-push`
skips a deletion-only push). Pinned in `scripts/branch-disposition-audit.test.mjs`.

**The base is `origin/main`, not the local `main`**, and the audit reads local remote-tracking refs,
so it reflects the last `git fetch` rather than the server. A local `main` is a checkout owned by
whichever worktree holds it, and a merge that lands on the trunk does not update it — that worktree
stays on the commit it had until someone pulls. On 2026-08-05 a `main` 4 commits behind made the
audit call a genuinely-merged branch unmerged. Pinned in `scripts/branch-disposition-audit.test.mjs`.

| disposition | meaning | action |
| --- | --- | --- |
| `MERGED` | merge-tree is a no-op; `main` already contains it | **prune now** |
| `SUPERSEDED` | not a no-op, but its content reached `main` by another path | **prune now** |
| `PRESERVE` | must never be deleted, moved, or merged | leave alone |
| `CLAIMED` | another lane holds it under `docs/WORK_CONTROL.md` | hands off |
| `UNLANDED` | carries real work that is not on `main` | needs a decision |
| `LANDED` | a no-op, but deliberately kept — a named reason, not a pending prune | leave alone |

## Where the records live

**One file per ref, under [`docs/dispositions/`](dispositions/)**, named by the ref's own slug. That
naming is the guarantee: a ref can hold exactly one record, and two lanes can never write the same
file. It is why the table that used to sit here is gone ([#291](https://github.com/Pootytxng/sentinel/issues/291)) —
on 2026-09-02 all eight open PRs edited this one file, so every lane conflicted with every other lane
merely by existing, whatever its subject. A lane now adds `docs/dispositions/<slug>.json` and touches
nothing another lane owns.

A record carries `ref`, `disposition`, `issue` and `evidence` — the same four columns, one file each.
JSON rather than Markdown on purpose: the live-doc prose rules read documents, and a mechanical
record is not a document making a claim about the fleet. **Counts are computed, never written.** Run
`node scripts/branch-disposition-audit.mjs` for the live split; a number written beside an
append-only record is wrong by the next commit, which it was twice on 2026-09-01 alone (#309/#312).

Sweep history (2026-08-04 through 2026-08-21, #126) is archived in [`archive/BRANCH_DISPOSITION_SWEEPS.md`](archive/BRANCH_DISPOSITION_SWEEPS.md).
**Two facts still live here**: the retired detached checkout's work is preserved under tag
`preserve/checklist-disk-item-c5660e`, and **rule C of `scripts/handoff-worktree-truth.test.mjs`
fails on a branchless checkout holding commits no remote has** — the one shape a ref-facing audit
cannot see, because it has no ref.

## Standing rule

A new remote ref is undispositioned until it has a record in `docs/dispositions/`. The audit is the
enforcement; writing the record is part of the work that created the branch, not a later cleanup.
