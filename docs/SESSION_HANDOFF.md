# Session handoff — 2026-08-19 (PR #145 open · C-12 closed)

**Lane OPEN.** Branch `agent/home-room-question` in `C:\Users\Kuya\code\sentinel-home-room`, three
commits ahead of `main`, all pushed, tree clean. **PR [#145](https://github.com/Pootytxng/sentinel/pull/145)
is open and green and can be merged.** One thing carries forward and it is named at the bottom: the
visual self-review, which still cannot run until the next build.

## What happened

**1 — PR #145 opened for `be4c81ec` (C-17b, the mono debt).** The previous session merged this
branch as #144 (C-04, Home → Health) and then kept the branch and committed C-17b on top: the 12
recorded mono-on-prose violations paid off, census ceiling **12 → 0**. That work had never been
proposed to `main`.

**2 — The disposition row died the moment the branch was kept, and the audit caught it, not a human.**
`branch-disposition-audit` failed on `origin/agent/home-room-question`: the row said MERGED, which was
true at `ad793f63` and false the instant `be4c81ec` landed on top, because merging the branch changes
the tree again. This is the exact perishability `docs/BRANCH_DISPOSITIONS.md` warns about, fired on
the row that warning sits above. Re-dispositioned **CLAIMED** with both landings named and the open
PR (`98447d82`). **Prune the ref when #145 lands — in the same breath, this time.**

**3 — C-12 closed: a shipped feature was filed as dropped.** `CommandPalette` has been mounted in
`ShellV2` behind `compy_command_palette` (**DEFAULT ON**) since `22fb15b2`, when the owner unparked it
because a tester could not navigate the app. Two LIVING docs said otherwise for six weeks —
`UI_VISION_BACKLOG.md` §D ("parked, then dropped — never mentioned again anywhere") and
`OWNER_ACTION_CHECKLIST.md`, which listed it under *"still genuinely open"*, i.e. on the owner's desk
as work he owed for something already built. Both corrected (`8d1e117f`).

This is the **inverse** of ordinary doc rot and the more expensive direction: a stale TODO wastes a
minute, a shipped feature recorded as dropped gets re-proposed and rebuilt beside the one that exists.

**Guard, before the fix counted (bug→guard):** `src/design/shipped-feature-doc-truth.test.ts` fails
the suite when a living doc calls a built-and-mounted feature parked / dropped / not built / a backlog
candidate. It first proves the feature is genuinely reachable (file exists AND the parent imports it),
so a truly retired feature makes the guard say *"drop the row"* rather than demand a false doc.
`<!-- shipped-status-history -->` exempts the **paragraph** it sits in, so a living doc can still say
"this was parked until <date>" — what it cannot do is say so in the present tense. The block splitter
breaks on top-level list items and table rows, not only blank lines; without that, `docs/BACKLOG.md`
is one paragraph and a single marker would exempt the file. **Falsified against the pre-fix tree**
(`git stash` + run): it reports exactly the two sites the conformance audit found by hand.

## State

- Verification at head `8d1e117f`: `tsc --noEmit` clean · vitest **344 files / 4490 tests** (the one
  red was the disposition row above, fixed) · new guard 6/6 · markdown-link-guard PASS (130 links) ·
  doc-budget ALL PASS · pre-push local gate (vitest + cargo test 963 + clippy) PASS at `98447d82`.
- **`docs/BACKLOG.md` is at 111.2KB of a 114KB wall.** The next row that lands here must archive
  first — it is roughly one entry from failing `doc-budget`.
- `docs/RELEASE_STATE.md` untouched — no gate moved, no artifact changed. **Neither the Health rename
  nor the mono work is in any published build**; the fleet is on v0.9.26 and both ship with the next cut.
- Work-control: PR-opening is ordinary execution per `docs/WORK_CONTROL.md` ("routine Git operations
  are not gates"), so no receipt was cut for it. **A merge of #145 does need one**, with the
  independent review recorded honestly if no non-writing model is attached.
- The worktree needs `npm ci` at the root **and** inside `site-app/` on a fresh clone; three site
  tests fail with "site-app dependencies missing" until the second one runs. Environmental.

## Owed, and it is still the one thing that carries forward

**A self-review on the installed binary**, now covering two lanes' visual work: the C-04 rename (rail,
topbar title, palette, tour recap) and the **C-17b RESIDUAL** — 6 of 12 mono selectors were measured,
and the other 6 are recorded as unreached rather than inferred (two need two sessions of the same
game, `.v2-update-*` has no dev fixture seam, `.fct-skip-hint`'s window collapses too fast to sample).
The CSS is not in doubt; the "does it read better" half is. **Next build → `scripts/ship-reinstall.ps1`
→ run the `self-review` skill.**

## Next session

Merge #145 (green) and **prune the ref with the row in the same commit**. Then take the next
non-gated `[ ]` in `docs/BACKLOG.md`, archiving first for the byte wall. Open conformance rows:
**C-13** (axe-core in vitest — the one with a guard shape) and **C-14** (`GpuProfile.tsx`, advisory or
archive — owner fork). Also open and untouched: the dead `.arc-v2` skin finding (do NOT delete on the
current evidence — establish first whether it was parked or the wiring was lost), C-18, #121, #140,
and the Codex weekly-automation scope item.
