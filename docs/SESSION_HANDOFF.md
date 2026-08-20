# Session handoff — 2026-08-19 (PR #145 open · C-12 closed)

**Lane OPEN.** Branch `agent/home-room-question` in `C:\Users\Kuya\code\sentinel-home-room`, merged up
to date with `main`, all pushed, tree clean. **PR [#145](https://github.com/Pootytxng/sentinel/pull/145)
is open and green and can be merged.**

## What happened

**1 — PR #145 opened for `be4c81ec` (C-17b, the mono debt).** The previous session merged this branch
as #144 (C-04, Home → Health), then kept the branch and committed C-17b on top: the 12 recorded
mono-on-prose violations paid off, census ceiling **12 → 0**. That work had never been proposed to `main`.

**2 — The disposition row died the moment the branch was kept, and the audit caught it, not a human.**
`branch-disposition-audit` failed on `origin/agent/home-room-question`: the row said MERGED, true at
`ad793f63` and false the instant `be4c81ec` landed on top, because merging the branch changes the tree
again. That is the exact perishability `docs/BRANCH_DISPOSITIONS.md` warns about, fired on the row that
warning sits above. Re-dispositioned **CLAIMED** with both landings and the open PR named (`98447d82`).
**Prune the ref with the row when #145 lands — in the same breath, this time.**

**3 — C-12 closed: a shipped feature was filed as dropped.** `CommandPalette` has been mounted in
`ShellV2` behind `compy_command_palette` (**DEFAULT ON**) since `22fb15b2`, when the owner unparked it
because a tester could not navigate the app. Two LIVING docs said otherwise for six weeks —
`UI_VISION_BACKLOG.md` §D ("parked, then dropped — never mentioned again anywhere") and
`OWNER_ACTION_CHECKLIST.md`, which listed it under *"still genuinely open"*, i.e. on the owner's desk
as work he owed for something already built. Both corrected (`8d1e117f`).

This is the **inverse** of ordinary doc rot and the more expensive direction: a stale TODO wastes a
minute; a shipped feature recorded as dropped gets re-proposed and rebuilt beside the one that exists.

**Guard, before the fix counted (bug→guard):** `src/design/shipped-feature-doc-truth.test.ts` fails the
suite when a living doc calls a built-and-mounted feature parked / dropped / not built / a backlog
candidate. It first proves the feature is genuinely reachable (file exists AND the parent imports it),
so a truly retired feature makes the guard say *"drop the row"* rather than demand a false doc.
`<!-- shipped-status-history -->` exempts the **paragraph** it sits in, so a living doc can still say
"this was parked until \<date\>" — what it cannot do is say so in the present tense. The block splitter
breaks on top-level list items and table rows, not only blank lines; without that, `docs/BACKLOG.md` is
one paragraph and a single marker would exempt the file. **Falsified against the pre-fix tree**
(`git stash` + run): it reports exactly the two sites the conformance audit found by hand.

## State

- Verification at head: `tsc --noEmit` clean · vitest **344 files / 4490 tests** (the one red was the
  disposition row above, fixed) · new guard 6/6 · `markdown-link-guard` PASS (130 links) · `doc-budget`
  ALL PASS · `branch-disposition-audit` OK · pre-push local gate (vitest + `cargo test` 963 + clippy) PASS.
- **`docs/BACKLOG.md` is at ~111KB of a 114KB wall.** The next row that lands here must archive first —
  it is roughly one entry from failing `doc-budget`.
- **C-04's self-review debt is DISCHARGED on `main`** (`4fe51859`): the desk runs `40682344`,
  stamp-proved, VERDICT PASS on all four rename surfaces. Nothing about the rename is outstanding.
- **The desk build `40682344` predates `be4c81ec`,** so the mono work is not on it and neither is
  anything in this PR. Published v0.9.26 is source `5e64074c` and carries neither the rename nor the
  mono change; both ship with the next cut. `docs/RELEASE_STATE.md` untouched by this lane.
- Work-control: opening a PR is ordinary execution per `docs/WORK_CONTROL.md` ("routine Git operations
  are not gates"), so no receipt was cut. **Merging #145 does need one**, with the independent review
  recorded honestly if no non-writing model is attached.
- The worktree needs `npm ci` at the root **and** inside `site-app/` on a fresh clone; three site tests
  fail with "site-app dependencies missing" until the second one runs. Environmental, not a defect.

## The one debt that carries forward

**The C-17b RESIDUAL — the visual half is 6/12, and the reason is a finding, not a shortcut.** A dev
instance measured the computed face on `.debrief-head`, `.monitor-panel-sub`, `.strends-sub` and
confirmed the untouched control `.ss-pin-label` still renders mono. The other six are recorded as
**unreached rather than inferred**: `.cmp-head` / `.wcp-head` need two sessions of the SAME game and
this machine has three sessions of three different games; `.v2-update-*` has no dev fixture seam for a
pending update; `.fct-skip-hint`'s render window collapses too fast to sample under the OS's
`prefers-reduced-motion`. **The CSS is not in doubt** — the guard proves those rules left the mono set.
Only the "does it read better" half is open. **Next build → `scripts/ship-reinstall.ps1` → run the
`self-review` skill against those selectors.**

## Next session

Merge #145 (green) and **prune the ref with the row in the same commit**. Then take the next non-gated
`[ ]` in `docs/BACKLOG.md`, archiving first for the byte wall. Open conformance rows: **C-13**
(axe-core in vitest — the one with a guard shape) and **C-14** (`GpuProfile.tsx`, advisory or archive —
owner fork). Also open and untouched: the dead `.arc-v2` skin finding (do NOT delete on the current
evidence — establish first whether it was parked deliberately or the wiring was lost), C-18, #121,
#140, and the Codex weekly-automation scope item.
