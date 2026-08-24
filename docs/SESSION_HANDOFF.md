# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where `main` is standing — 2026-08-24

`main` = **`39841601`**. Four commits landed this session on one owner turn: *"run the self review
and clear up any remaining work or unfinished task."*

- **`bf1b56c8`** — PR [#160](https://github.com/Pootytxng/sentinel/pull/160) merged, issue #158
  closed: the report-only `src-tauri/target` disk-bloat flag for the weekly usage audit.
- **`83a89f48`** — its receipt, plus the ref prune and row drop that had to ride together.
- **`39841601`** — the handoff-block guard half of PR
  [#163](https://github.com/Pootytxng/sentinel/pull/163), lifted by file.
- (`7eced01d` was another lane's PR #212 — support address, privacy contact, `.codex` header.)

The owner's **installed desk build is `ccc17355`**, from the four-room lane, NOT from `main`. Nothing
this session shipped touches `compy.exe`, so that is still correct — but do not describe `main` as
what he is running.

## What the handoff block must now say — this changed under you

`scripts/lib/handoff-block.mjs` no longer accepts *"archive / delete / leave open"*. His words:
that wording never said *"how im supposed to know when to actually close the tab in vscode"*. Three
parts are now required, and `scripts/handoff-block.test.mjs` fails the build on any missing one:

1. **a tab verdict** — "safe to close", or "keep this tab open **because** …" (a hold with no reason
   is not a verdict he can act on);
2. **a lane** — does the next action continue this lane or start a different one, named;
3. **a next action** — paste-ready, as before.

## The `#49` review that was blocking, and what it could not prove

`FpsTrace` (the Live room's "Session shape") was built, installed and **`self-review` PASS, round
18** on the installed `ccc17355`, at the owner's 1500×980. Two of its three honesty properties were
proved ON SCREEN against real sessions: **a missing bucket ends the run**, and **the axis is
anchored at 0**. The third — a gap-isolated sample rendering as a **dot** — could not be produced:
no real session on this desk has an isolated single-bucket run, so it stays verified in
`geometry.ts` alone. **Do not upgrade it to "observed"** without a session that actually has one.

That work lives in `C:\Users\Kuya\code\sentinel-fourroom` on `feat/four-room-visual-direction`,
**46 ahead of `main`**. Its merge is the owner's call and was not made.

## What is left, and who owns it

- **#49's merge to `main`** — owner's. `main`'s five #209 Optimize copy strings and everything
  landed today are therefore NOT on his desk build.
- **PR #163** — do **not** merge as it stands. It carries the superseded `2026-08-20-merge-pr-160`
  receipt and stale disposition rows. What is worth rescuing by hand: its
  `OWNER_ACTION_CHECKLIST.md` additions and its `BRANCH_DISPOSITION_SWEEPS` archive entry. Written
  on the PR.
- **[#211](https://github.com/Pootytxng/sentinel/issues/211)** — Live's `<h1>` concatenates its
  eyebrow with a dynamic sentence. Inherited, out of scope for #49, needs its own bounded change
  plus the guard that stops the class.
- **One owner decision, recorded on #158, not chased:** the new flag measures **~59 GB** of Rust
  build output across six worktrees (13.0 / 10.2 / 10.1 / 10.1 / 7.8 / 7.8 GB) and **not one tree
  crosses his ~20 GB per-tree threshold**, so the flag is correct and permanently silent here. A
  repo-wide total, or a lower per-tree number, are the two honest fixes. His number, his call.
- **#126** is one ref closer and still a DECISION queue: eight non-`PRESERVE` refs, none retirable
  by proof.

## Live traps

1. **`git checkout <branch> -- <file>` takes the file WHOLE**, not the branch's change to it.
   Lifting one hunk off a 4-day-stale branch reverted five unrelated `CLAUDE.md` improvements here —
   including a module-map line that would have re-asserted a mutation-boundary exception **closed on
   2026-08-03**. The `origin/main...branch` diff hides this completely. Read `git diff HEAD~1 HEAD`
   before pushing, and re-apply the hunk by hand on any high-traffic doc.
2. **A stale remote-tracking ref reds the branch-disposition audit** with a message that reads like
   a missing row. Check `git ls-remote --heads origin` first — if the ref is not there, the cure is
   `git fetch --prune`, not a row.
3. **`main` moves under a long gate.** One run here was invalidated mid-flight by another lane's
   merge; the fix is to remake the merge commit on the new base and re-gate, never to push the one
   proved on the old base.
4. **Refreshing an existing `work-control` receipt's `currentHead` is classifier-refused.** Write a
   NEW receipt at a head that exists — that is the documented way out, and it works.
5. **`.codex/config.toml` regresses every few days**
   ([#196](https://github.com/Pootytxng/sentinel/issues/196)) — a red `codex-config-guard` in the
   push gate IS that regression: discard it, do not debug it.

## Waiting on the owner

**Nothing blocking.** Two things want his eye, neither urgent: the new **Live → a past session →
"Session shape"** trace on his desk build, and the disk-bloat threshold question on #158.
