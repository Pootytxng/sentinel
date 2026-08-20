# Session handoff — 2026-08-20 (control-font LANDED; self-checkup LANDED)

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`, branch `lane/self-checkup`. `main` is checked
out by `C:\Users\Kuya\code\sentinel`, which is why this worktree keeps a lane branch.

## Landed and merged

**PR [#157](https://github.com/Pootytxng/sentinel/pull/157) → merge `8a1450cd`**, closing issue
[#155](https://github.com/Pootytxng/sentinel/issues/155).

- `aac90cd7` — **the control-font reset.** `.btn-small` + `.debrief-ctx-head` set font-size/weight
  and no family, so Windows rendered them in Arial. Measured: **97 of 290 `<button>` sites across 28
  files** had no family from any rule (the row claimed 26/11), and no stylesheet had a single
  `button` element rule. Fix is ONE unscoped `button, input, select, textarea { font-family: inherit }`
  in `src/App.css`; the 88 existing ad-hoc `font: inherit` declarations were deliberately left (some
  are the shorthand and also reset size/weight). Guard written first: `src/control-font-guard.test.ts`.
- `176d847c` — arc-v2 M1 + dead-radar CSS deleted, `src/arc-v2-reachability-guard.test.ts` added.
- `f8ec8d81` + archive link repair — RELEASE_STATE owner-installed row, BACKLOG `.btn-small` row.

**Shipped and proved:** installed stamp `aac90cd7 · release · shell 0.9.26`, one installer on the
Desktop, installer SHA-256 `9FEDF06E…FD92`. **Self-review VERDICT: PASS** (9/9 at 1500x980).
Issue [#156](https://github.com/Pootytxng/sentinel/issues/156) filed: a silent `/S` install returned
exit 0 and never replaced the exe — the stamp gate caught it. **Do not loosen that gate.**

## The self-checkup (owner-requested), also landed

"Ensure this isn't happening anywhere else … resolve and optimize any other bad habits." Findings
and fixes are in the PR body; the durable ones:

- **arc-v2 is fully dead now** — M3/M4 CSS deleted (274 → 127 lines), the whole `arcV2` prop chain
  out of `SessionDebrief` / `WhatChangedPanel`. Provable no-op: every removed rule needed an
  `.arc-v2` ancestor no mount produced. The guard now pins `arcV2` to `App.tsx` + `FirstCheck.tsx`.
- **The kernel law's one earned celebration has never fired for any user.** `@keyframes
  cmp-winshimmer` lived on `.cmp-improved.arc-v2 .cmp-bar-after` — behind the dead prop. Deliberately
  NOT re-homed here (a deletion commit must not smuggle in a new moving thing). `src/sweep-guard.test.ts`
  keeps the law's teeth and pins the count at zero; open row in `docs/BACKLOG.md`.
- **Owner checklist is real asks only** — six non-asks archived; §A is down to one item.
- **Doc drift + budget slack fixed** — `cpu_temp.rs` ~520 → ~1137, checklist budget 40KB → 33KB,
  C-17b rows archived to keep BACKLOG under its 114KB wall.

### Three process defects found, and what was done

1. **HANDOFF BLOCK misuse.** Emitted mid-work on every reply, telling the owner to paste work back
   into the same session. It is an END-of-work artifact. Memory: `handoff-block-is-end-of-work`.
2. **Over-escalation to the owner's checklist.** `B_arc` was filed as an owner fork; he answered
   *"i have no idea what that arv2 thing even is."* Memory: `owner-checklist-is-real-asks-only`.
3. **PR #157 was merged with NO work-control receipt.** Guard written and proved both directions;
   left unwired because the owner's settings reserve authority-gating hooks to his hand.
   Memory: `proof-dependent-transitions-need-a-receipt`.

## Next session — start here

Nothing is in flight. Take the highest-priority non-gated `[ ]` from `docs/BACKLOG.md`; the newest
row is the win-card shimmer (build it in its own train: re-home the keyframe onto `.cmp-improved
.cmp-bar-after` in `src/App.css`, then build → install → **self-review**, then update
`src/sweep-guard.test.ts` to expect `["cmp-winshimmer"]`).

## Open for the owner

- **§A is down to one item:** delete the redundant `Desktop\COMPY KEY\` copy.
- **Auto-mode rule that cannot be satisfied:** merging is allowed "when required CI checks are
  passing" and must be confirmed when checks are "absent" — hosted CI is OFF by his own decision, so
  checks are ALWAYS absent. Proposed edit: key it to the local gate (`scripts/verify-local.ps1`).
- **The unwired hook**, if he wants it on: settings block is at the bottom of
  `.claude/hooks/work-control-receipt-guard.mjs`.
